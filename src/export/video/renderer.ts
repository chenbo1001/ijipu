/**
 * export/video/renderer.ts — 把「相机 + 页面」画成画面（宿主层）
 *
 * 分工：**引擎**算"这一刻相机在哪、多大"（`cameraAt`，纯函数）；
 * **这里**把页面图画出来（SVG → 位图 → 按相机取景）。
 *
 * ## 为什么按"页面"光栅，而不是拼一条大图
 *
 * 3 分钟的谱有 30+ 页；拼整条带会得到几万像素高的画布，WebView 里分配失败。
 * 这里每页一张位图（按 `RASTER_SCALE` 放大，保证推近不糊），逐帧只画当前页的一块。
 *
 * ## 为什么用用户自己的页面配置
 *
 * 相机方案的全部意义就在这：**不重排**。用户看到什么样的 A4 版面，视频里就是什么样，
 * 只是镜头推近/平移。所以这里吃 `pageConfig`（来自文档），不吃"视频预设"——
 * 预设只决定**输出画布多大**。
 */
import {
  parseJps,
  layoutScore,
  renderScoreToSvg,
  buildPlaySequence,
  inferBpm,
  buildRectTrack,
  buildFlowView,
  rectsActiveAt,
  buildCameraTrack,
  cameraAt,
  DYNAMIC_PRESETS,
  type DynamicPresetId,
  type PageConfig,
  type CameraFrame,
  type CameraTrack,
} from '@ijipu/engine'
import { svgToCanvas } from '../export'

/**
 * 页面位图的放大倍数：4 倍跟拍时，取景框宽 = 1080/4 = 270 页面单位，
 * 而位图按 3 倍存（595×3 = 1786px 宽）⇒ 取 270 宽那段约 810px，再放大到 1080，
 * 略软但可接受；再高会吃内存（每页 ≈ 18MB）。
 */
export const RASTER_SCALE = 3

/** 高亮块配色（占位：正式版按声部/音色走 `playback/playhead.ts` 的调色板） */
export const HIGHLIGHT_FILL = 'rgba(255, 93, 108, 0.20)'
export const HIGHLIGHT_STROKE = 'rgba(255, 93, 108, 0.85)'

export interface DynamicSession {
  camera: CameraTrack
  /** 每页一张已光栅化的画布 */
  pages: HTMLCanvasElement[]
  totalMs: number
  width: number
  height: number
  /** 画一帧，返回相机位置与"是否在跟拍"（供界面显示） */
  draw: (ctx: CanvasRenderingContext2D, tMs: number) => { frame: CameraFrame; following: boolean }
}

/**
 * 建一次放映会话。
 *
 * @param code       `.jps` 源码
 * @param presetId   输出画布（只决定宽高与比例）
 * @param pageConfig **用户自己的**页面配置（决定版面，绝不能被预设覆盖）
 * @param bpm        覆盖拍速（缺省按谱面推断）
 */
export async function createDynamicSession(
  code: string,
  presetId: DynamicPresetId,
  pageConfig: PageConfig,
  bpm?: number,
  opts?: { followZoom?: number },
): Promise<DynamicSession> {
  const preset = DYNAMIC_PRESETS[presetId]
  const parsed = parseJps(code)
  const layout = layoutScore(parsed, pageConfig)
  const beat = bpm !== undefined && bpm > 0 ? bpm : inferBpm(parsed)
  const seq = buildPlaySequence(parsed, layout, beat)
  const track = buildRectTrack(seq, { noteSize: pageConfig.note_size })
  const view = buildFlowView(layout, track, pageConfig)
  if (view.rows.length === 0) throw new Error('这份谱没有可播放的音符')

  const camera = buildCameraTrack(view, track, pageConfig, {
    viewW: preset.width,
    viewH: preset.height,
    ...(opts?.followZoom !== undefined ? { followZoom: opts.followZoom } : {}),
  })

  // 字体没就绪就光栅化 ⇒ 字形回退，第一帧和后面不一样
  await document.fonts.ready
  const svgs = renderScoreToSvg(layout)
  const pages: HTMLCanvasElement[] = []
  for (const svg of svgs) pages.push(await svgToCanvas(svg, RASTER_SCALE, '#ffffff'))

  const draw = (ctx: CanvasRenderingContext2D, tMs: number) => {
    const frame = cameraAt(camera, tMs)
    const W = camera.viewW
    const H = camera.viewH
    const z = frame.zoom
    const left = frame.cx - W / z / 2
    const top = frame.cy - H / z / 2

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const page = pages[frame.pageIndex]
    if (page) {
      // 只画"取景框 ∩ 页面"这一块：满宽片头时取景框比页面高，两侧/上下会露白，属正常
      const ix = Math.max(0, left)
      const iy = Math.max(0, top)
      const iw = Math.min(camera.pageW, left + W / z) - ix
      const ih = Math.min(camera.pageH, top + H / z) - iy
      if (iw > 0 && ih > 0) {
        ctx.drawImage(
          page,
          ix * RASTER_SCALE,
          iy * RASTER_SCALE,
          iw * RASTER_SCALE,
          ih * RASTER_SCALE,
          (ix - left) * z,
          (iy - top) * z,
          iw * z,
          ih * z,
        )
      }
    }

    // 高亮：只画当前页上的（跨页时不会把上一页的块贴过来）
    for (const r of rectsActiveAt(track, tMs)) {
      if (r.pageIndex !== frame.pageIndex) continue
      const x = (r.x - left) * z
      const y = (r.y - top) * z
      const w = r.w * z
      const h = r.h * z
      ctx.beginPath()
      ctx.roundRect(x - 4, y - 3, w + 8, h + 6, Math.max(4, 8 * (z / 4)))
      ctx.fillStyle = HIGHLIGHT_FILL
      ctx.fill()
      ctx.lineWidth = Math.max(2, 3 * (z / 4))
      ctx.strokeStyle = HIGHLIGHT_STROKE
      ctx.stroke()
    }

    return { frame, following: tMs > camera.firstT }
  }

  return {
    camera,
    pages,
    totalMs: track.endMs,
    width: camera.viewW,
    height: camera.viewH,
    draw,
  }
}
