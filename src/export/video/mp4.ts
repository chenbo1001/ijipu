/**
 * export/video/mp4.ts — 动态谱 → MP4（WebCodecs 编码 + mp4-muxer 封装）
 *
 * ## 为什么不用 ffmpeg
 *
 * 浏览器自带 H.264 / AAC 编码（Windows 上走系统硬件编码器）。实测（本机 Chrome）：
 * `VideoEncoder` 支持 `avc1.640028`（H.264 High）、`AudioEncoder` 支持 `mp4a.40.2`（AAC）。
 * 于是不必让用户下 80MB 的 ffmpeg，也不用起子进程。
 *
 * ## 为什么仍然是"确定性"的
 *
 * 每一帧都是 `session.draw(ctx, n/fps)` 现画出来的，时间戳由帧号算出（`n*1e6/fps`），
 * 不是录屏、不依赖机器快慢 ⇒ 同一份谱两次导出逐帧一致。
 *
 * ## 约束
 *
 * - 时间戳必须单调递增（WebCodecs 硬要求）；
 * - 每 2 秒插一个关键帧（seek/播放器拖动更稳）；
 * - 编码队列要背压（`encodeQueueSize`），否则一次性塞几千帧会吃爆内存。
 *
 * ⚠ `mp4-muxer` 已被作者标记为 superseded（推荐 Mediabunny）。这里用它的理由：
 * 体积小（~30KB）、API 直给、无运行时依赖；将来若换，替换面只在本文件。
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { DynamicSession } from './renderer'

export interface Mp4Options {
  /** 帧率（缺省 30） */
  fps?: number
  /** 视频码率（缺省 8 Mbps） */
  bitrate?: number
  /** 进度回调（0~1） */
  onProgress?: (p: number) => void
  /** 取消 */
  signal?: AbortSignal
  /** 只编前 N 毫秒（导出范围 / 试编一段用） */
  maxMs?: number
}

/** 关键帧间隔（秒） */
const KEYFRAME_SEC = 2

/**
 * 把一次放映会话编成 MP4。
 *
 * @param session `createDynamicSession()` 的结果（已含相机与页面位图）
 * @returns MP4 字节（Blob，可直接触发下载）
 */
export async function encodeMp4(session: DynamicSession, opts: Mp4Options = {}): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('当前环境不支持 WebCodecs（请更新 WebView2 / 换 Chrome）')
  }
  const fps = opts.fps ?? 30
  const { width, height, totalMs } = session
  const spanMs = Math.min(totalMs, opts.maxMs ?? totalMs)
  const frameCount = Math.max(1, Math.round((spanMs / 1000) * fps))

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
  })

  let encodeError: unknown = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e
    },
  })
  encoder.configure({
    codec: 'avc1.640028',
    width,
    height,
    bitrate: opts.bitrate ?? 8_000_000,
    framerate: fps,
  })

  // 用 OffscreenCanvas：不占主线程的可见画布，也不需要往 DOM 里挂节点
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建离屏画布')

  try {
    for (let i = 0; i < frameCount; i++) {
      if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      if (encodeError) throw encodeError
      const t = (i * 1000) / fps
      session.draw(ctx, t)
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      })
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * KEYFRAME_SEC)) === 0 })
      frame.close()
      // 背压：让编码器追上来，避免队列无限增长
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0))
      opts.onProgress?.((i + 1) / frameCount)
    }
    await encoder.flush()
    if (encodeError) throw encodeError
  } finally {
    encoder.close()
  }

  muxer.finalize()
  const { buffer } = muxer.target as ArrayBufferTarget
  return new Blob([buffer], { type: 'video/mp4' })
}
