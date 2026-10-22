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
  resolvePracticeRange,
  slicePlaySequenceByRange,
  DYNAMIC_PRESETS,
  type DynamicPresetId,
  type PageConfig,
  type CameraFrame,
  type CameraTrack,
  type PlayEvent,
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
/** 跳跳球颜色（同一套强调色，落地那一刻最显眼） */
export const BALL_FILL = 'rgba(255, 93, 108, 0.95)'

/** 2D 上下文（离屏画布与页面画布都行；编码时用 OffscreenCanvas 不占可见画布） */
export type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DynamicSession {
  camera: CameraTrack
  /** 每页一张已光栅化的画布 */
  pages: HTMLCanvasElement[]
  totalMs: number
  width: number
  height: number
  /** 播放事件（给音轨离线渲染用，与画面同一份序列） */
  events: PlayEvent[]
  /** 拍速（音轨渲染要用同一个值，否则音画对不上） */
  bpm: number
  /** 画一帧，返回相机位置与"是否在跟拍"（供界面显示） */
  draw: (ctx: DrawCtx, tMs: number) => { frame: CameraFrame; following: boolean }
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
  opts?: {
    followZoom?: number
    /** 只导某个标记段（起止音符 id）；缺省 = 整曲 */
    range?: { startId: string; endId: string } | null
    /** 片头时长（ms，默认 2000；0 = 不要片头）。片头是**前置静音**，音画一起后移 */
    leadInMs?: number
    /** 跳跳球（节拍指示，默认开） */
    ball?: boolean
  },
): Promise<DynamicSession> {
  const preset = DYNAMIC_PRESETS[presetId]
  const parsed = parseJps(code)
  const layout = layoutScore(parsed, pageConfig)
  const beat = bpm !== undefined && bpm > 0 ? bpm : inferBpm(parsed)
  let seq = buildPlaySequence(parsed, layout, beat)

  // 标记段：用与试听**完全相同**的口径切出这一段（时间归零），并跳过满宽片头
  let skipIntro = false
  if (opts?.range) {
    const res = resolvePracticeRange(seq, opts.range.startId, opts.range.endId)
    if (res.missing) throw new Error('标记段已失效（起止音符找不到），请重新标记')
    const cand = res.candidates[res.pick] ?? res.candidates[0]
    const sliced = cand ? slicePlaySequenceByRange(seq, cand.i0, cand.i1) : null
    if (!sliced) throw new Error('标记段无效，请重新标记')
    seq = sliced
    skipIntro = true
  }

  // 片头：整条时间轴后移 + 前置静音（音轨用同一份事件，所以天然同步）
  const leadInMs = Math.max(0, opts?.leadInMs ?? 2000)
  if (leadInMs > 0) {
    seq = {
      ...seq,
      events: seq.events.map((e) => ({ ...e, atMs: e.atMs + leadInMs })),
      totalMs: seq.totalMs + leadInMs,
    }
  }

  const track = buildRectTrack(seq, { noteSize: pageConfig.note_size })
  const view = buildFlowView(layout, track, pageConfig)
  if (view.rows.length === 0) throw new Error('这份谱没有可播放的音符')

  const camera = buildCameraTrack(view, track, pageConfig, {
    viewW: preset.width,
    viewH: preset.height,
    // 片头对准描述头（页顶 → margin_top + descAreaH 的中点）
    headerCy: pageConfig.margin_top + pageConfig.descAreaH / 2,
    ...(opts?.followZoom !== undefined ? { followZoom: opts.followZoom } : {}),
    ...(skipIntro ? { skipIntro: true } : {}),
  })
  const ball = opts?.ball !== false
  // 段导出：片头用"第 1 页描述头"的标题卡，再交叉淡入到段首（不平移，免得横跨几页乱飞）
  const crossfadeIntro = skipIntro
  // 标题卡：满宽 + 整页居中（9:16 的取景框比页高，纵向只能居中）
  const headerFrame: CameraFrame = {
    pageIndex: 0,
    cx: camera.pageW / 2,
    cy: camera.pageH / 2,
    zoom: camera.viewW / camera.pageW,
  }

  // 字体没就绪就光栅化 ⇒ 字形回退，第一帧和后面不一样
  await document.fonts.ready
  const svgs = renderScoreToSvg(layout)
  const pages: HTMLCanvasElement[] = []
  for (const svg of svgs) pages.push(await svgToCanvas(svg, RASTER_SCALE, '#ffffff'))

  const draw = (ctx: DrawCtx, tMs: number) => {
    const frame = cameraAt(camera, tMs)
    const W = camera.viewW
    const H = camera.viewH
    const noteSize = pageConfig.note_size

    /** 按给定相机画一帧（alpha<1 用于片头交叉淡入） */
    const paintCamera = (c: CameraFrame, alpha: number, t: number) => {
      const z = c.zoom
      const left = c.cx - W / z / 2
      const top = c.cy - H / z / 2
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)

      const page = pages[c.pageIndex]
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
      const active = rectsActiveAt(track, t).filter((r) => r.pageIndex === c.pageIndex)
      for (const r of active) {
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

      /**
       * 跳跳球：每拍弹一次，**落地那一刻正好是下一拍开始**。
       * 高度用抛物线 `4u(1-u)`，u = 本拍已过的比例 ⇒ u=0 落地、u=1 落地。
       */
      if (ball && active.length > 0) {
        const r = active.find((q) => q.playVoice !== 'accomp' && q.playVoice !== 'second') ?? active[0]
        const dur = r.t1 - r.t0
        if (dur > 0) {
          const u = Math.min(1, Math.max(0, (t - r.t0) / dur))
          const hop = 4 * u * (1 - u)
          // 弹幅压到一个字号以内：再高就会飞到上一行（首行还会压到调号/拍号）
          const amp = noteSize * 0.8
          const bx = (r.x + r.w / 2 - left) * z
          const baseY = (r.y - top) * z - noteSize * z * 0.35
          const by = baseY - hop * amp * z
          const rad = Math.max(4, noteSize * z * 0.26)
          ctx.beginPath()
          ctx.arc(bx, by, rad, 0, Math.PI * 2)
          ctx.fillStyle = BALL_FILL
          ctx.fill()
          // 白圈：压在浅色谱面上也能看清边界
          ctx.lineWidth = Math.max(1.5, rad * 0.18)
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    /**
     * 段导出：片头先给"第 1 页描述头"的整宽标题卡，再 **200ms 交叉淡入**到段首。
     * 为什么不像整首那样平移过去：标记段可能在别的页，横跨几页的平移会变成乱飞。
     */
    if (crossfadeIntro && tMs < camera.firstT) {
      const fadeMs = 200
      const k = Math.max(0, Math.min(1, (tMs - (camera.firstT - fadeMs)) / fadeMs))
      paintCamera(headerFrame, 1, tMs)
      if (k > 0) paintCamera(cameraAt(camera, camera.firstT), k, camera.firstT)
      return { frame, following: false }
    }

    paintCamera(frame, 1, tMs)
    return { frame, following: tMs >= camera.firstT }
  }

  return {
    camera,
    pages,
    totalMs: track.endMs,
    width: camera.viewW,
    height: camera.viewH,
    events: seq.events,
    bpm: beat,
    draw,
  }
}
