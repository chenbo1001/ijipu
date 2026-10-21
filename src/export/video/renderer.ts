/**
 * export/video/renderer.ts — 把动态谱引擎的输出画到画布上（宿主层）
 *
 * 分层：**引擎**回答"这一帧滚到哪、亮哪几块"（`frameAt`，纯函数）；
 * **这里**只负责把那些数字变成像素（SVG → 位图 → 逐帧合成）。
 * 这样同一份引擎，预览用它、将来出片也用它，H5 也能拿它改 DOM。
 *
 * ## 为什么要"按页光栅"
 *
 * 不要拼一张"整条带"的大图：3 分钟的谱能有 30+ 页，拼起来几万像素高，
 * WebView 里会分配失败。这里每页一张画布（1080×1920 约 8MB），逐帧按行带裁剪贴图。
 *
 * ## 为什么底色要单独铺
 *
 * 导出 PNG 时画面必须是不透明白（视频没有透明通道）；而 SVG 自身是透明的，
 * 不铺底会得到黑底/透明帧。所以 `svgToCanvas(..., 1, '#ffffff')`。
 */
import {
  parseJps,
  layoutScore,
  renderScoreToSvg,
  buildPlaySequence,
  inferBpm,
  buildRectTrack,
  buildFlowView,
  frameAt,
  dynamicPageConfig,
  type DynamicPresetId,
  type FlowView,
  type RectTrack,
  type Frame,
} from '@ijipu/engine'
import { svgToCanvas } from '../export'

/** 高亮块配色（占位：正式版按声部/音色走 `playback/playhead.ts` 的调色板） */
export const HIGHLIGHT_FILL = 'rgba(255, 93, 108, 0.20)'
export const HIGHLIGHT_STROKE = 'rgba(255, 93, 108, 0.85)'

/** 一次"动态谱放映"的完整状态（建好之后逐帧只读） */
export interface DynamicSession {
  view: FlowView
  track: RectTrack
  /** 每页一张已光栅化的画布（下标 = pageIndex） */
  pages: HTMLCanvasElement[]
  /** 总时长（ms） */
  totalMs: number
  /** 画布尺寸 */
  width: number
  height: number
  /** 画一帧，返回该帧的引擎数据（行号等，供界面显示） */
  draw: (ctx: CanvasRenderingContext2D, tMs: number) => Frame
}

/**
 * 建一次放映会话：解析 → 排版（动态预设）→ 序列 → 轨道 → 视图 → 逐页光栅。
 *
 * @param code     `.jps` 源码
 * @param presetId 画布预设（9:16 / 1:1 / 16:9）
 * @param bpm      覆盖拍速（缺省按谱面 `J:` 推断）
 * @throws 解析失败时抛错（调用方负责提示，不要把半成品画到画布上）
 */
export async function createDynamicSession(
  code: string,
  presetId: DynamicPresetId,
  bpm?: number,
): Promise<DynamicSession> {
  const cfg = dynamicPageConfig(presetId)
  const parsed = parseJps(code)
  const layout = layoutScore(parsed, cfg)
  const beat = bpm !== undefined && bpm > 0 ? bpm : inferBpm(parsed)
  const seq = buildPlaySequence(parsed, layout, beat)
  const track = buildRectTrack(seq, { noteSize: cfg.note_size })
  const view = buildFlowView(layout, track, cfg)
  if (view.rows.length === 0) throw new Error('这份谱没有可播放的音符')

  // 字体没就绪就光栅化 ⇒ 字形会回退（第一帧和后面长得不一样，出片就穿帮）
  await document.fonts.ready
  const svgs = renderScoreToSvg(layout)
  const pages: HTMLCanvasElement[] = []
  for (const svg of svgs) pages.push(await svgToCanvas(svg, 1, '#ffffff'))

  const draw = (ctx: CanvasRenderingContext2D, tMs: number): Frame => {
    const frame = frameAt(view, track, tMs)
    const W = view.viewW
    const H = view.viewH
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    // 只贴"当前可视"的行带：条带比画布高时，看不见的行不必画
    for (const row of view.rows) {
      const bandH = row.srcBottom - row.srcTop
      const y = row.stripY - frame.scrollY
      if (y + bandH < 0 || y > H) continue
      const page = pages[row.pageIndex]
      if (!page) continue
      ctx.drawImage(page, 0, row.srcTop, W, bandH, 0, y, W, bandH)
    }
    for (const r of frame.rects) {
      const y = r.y - frame.scrollY
      ctx.beginPath()
      ctx.roundRect(r.x - 4, y - 3, r.w + 8, r.h + 6, 8)
      ctx.fillStyle = HIGHLIGHT_FILL
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = HIGHLIGHT_STROKE
      ctx.stroke()
    }
    return frame
  }

  return {
    view,
    track,
    pages,
    totalMs: track.endMs,
    width: view.viewW,
    height: view.viewH,
    draw,
  }
}
