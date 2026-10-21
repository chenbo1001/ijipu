/**
 * engine/dynamic/camera.ts — 动态谱「相机」：给定时刻，决定看页面的哪一块、放大多少
 *
 * ## 为什么是"相机"而不是"重新排版"
 *
 * 重新排版要把标题/作者/歌词/行距在每种画布比例下重调一遍，永远追不上应用里那套调好的 A4 规则
 * （实测：9:16 下标题会和作者撞在一起）。相机方案**不动版面**，只决定"镜头对着哪、推多近"：
 *   - 用户自己的字体、主题、分页原样进视频；
 *   - "放大"是连续的推镜头，不是改字号；
 *   - 9:16 / 1:1 / 16:9 只是取景框比例不同。
 *
 * ## 片子里的四个阶段
 *
 * ```
 *  t < 第一拍        满宽（zoomFit）：标题、作者、整页都看得见
 *  第一拍 ~ +introMs  平滑推近到 zoomFollow，同时把第一行移到画面中央
 *  跟拍              横向"安全区"推移（与试听的 followScroll 同一套手感），纵向按行平移
 *  最后一拍之后       停在最后一行，不缩回
 * ```
 *
 * ## 纯函数约定
 *
 * `buildCameraTrack` 可以带状态（建表时扫一遍），但 `cameraAt` 必须是 `t` 的纯函数：
 * 不读上一帧、不读时钟。否则视频不可复现（同一个 t 两帧不一样）。
 */
import { PAPER_SIZE, type PageConfig } from '../types'
import type { FlowView, RectTrack } from './types'

/** 默认跟拍倍数（屏幕像素 / 页面单位）。4 倍时 9:16 取景框约覆盖 270×480，音符约 72px */
export const CAMERA_FOLLOW_ZOOM = 4
/** 片头推近时长（ms） */
export const CAMERA_INTRO_MS = 700
/** 换行平移时长（ms）——在"该行第一拍"之前完成 */
export const CAMERA_LINE_MS = 350
/** 横向跟拍过渡时长（ms） */
export const CAMERA_PAN_MS = 450
/** 安全区半宽（占取景框宽的比例）：当前音超出这个范围才推镜头 */
export const CAMERA_SAFE_HALF = 0.25

export interface CameraOptions {
  /** 成片画布像素宽高 */
  viewW: number
  viewH: number
  /** 跟拍倍数（缺省 4） */
  followZoom?: number
  introMs?: number
  lineMs?: number
  panMs?: number
  safeHalf?: number
}

/** 相机某一刻的位置（页面坐标系 + 缩放） */
export interface CameraFrame {
  pageIndex: number
  /** 画面中心（页面坐标） */
  cx: number
  cy: number
  /** 屏幕像素 / 页面单位 */
  zoom: number
}

/** 条带上的一行 → 相机的一段（时间、页、纵向中心） */
export interface CameraRow {
  t0: number
  t1: number
  pageIndex: number
  cy: number
}

/** 横向关键帧（只在"该推了"的时候记一条） */
export interface CameraPan {
  t: number
  cx: number
  /** 这次推移从何时开始（缺省 = t − panMs）。**换行时 = t**：绝不提前离开上一行 */
  from: number
  /** 推移时长（换行时约 0：在行边界上直接归位） */
  dur: number
}

export interface CameraTrack {
  viewW: number
  viewH: number
  pageW: number
  pageH: number
  /** 满宽（整页并排进去）的缩放 */
  zoomFit: number
  zoomFollow: number
  /** 推近结束时刻（= 第一拍 + introMs） */
  zoomEnd: number
  firstT: number
  rows: CameraRow[]
  pans: CameraPan[]
  safeHalf: number
  introMs: number
  lineMs: number
  panMs: number
}

/** 平滑缓动（0→1，两端速度为 0） */
function ease(x: number): number {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/**
 * 建相机表。
 *
 * @param view 用**用户自己的页面配置**建出来的流式视图（行按演奏顺序，含反复）
 * @param cfg  同一份 `PageConfig`（只取 `page` 定页宽页高）
 */
export function buildCameraTrack(
  view: FlowView,
  track: RectTrack,
  cfg: PageConfig,
  opts: CameraOptions,
): CameraTrack {
  const paper = PAPER_SIZE[cfg.page]
  const viewW = opts.viewW
  const viewH = opts.viewH
  const zoomFollow = opts.followZoom ?? CAMERA_FOLLOW_ZOOM
  const introMs = opts.introMs ?? CAMERA_INTRO_MS
  const lineMs = opts.lineMs ?? CAMERA_LINE_MS
  const panMs = opts.panMs ?? CAMERA_PAN_MS
  const safeHalf = opts.safeHalf ?? CAMERA_SAFE_HALF

  const zoomFit = viewW / paper.width
  const firstT = view.rows.length > 0 ? view.rows[0].t0 : 0

  const rows: CameraRow[] = view.rows.map((r) => ({
    t0: r.t0,
    t1: r.t1,
    pageIndex: r.pageIndex,
    // 按**行内容**居中（音符 + 歌词），不按取图带——第一行的带是从页顶起的，会把标题拉进画面
    cy: (r.contentTop + r.contentBottom) / 2,
  }))

  /**
   * 横向关键帧：按时间扫一遍矩形，只在"当前音要出安全区"时推一次。
   * 不能每拍都记——那样镜头会一直抖；也不计时插值——那样永远在慢慢漂。
   */
  const halfW = viewW / zoomFollow / 2
  const pans: CameraPan[] = []
  let cx = paper.width / 2
  let lastRow = -1
  let rowStartT = firstT
  for (let i = 0; i < track.rects.length; i++) {
    const r = track.rects[i]
    const rowIdx = view.rectRow[i]
    if (rowIdx < 0) continue
    // 换行：本行的第一个音 ⇒ 横移**在行边界上归位**，不许提前（否则上一行最后一个音会被挤出框）
    const isRowStart = rowIdx !== lastRow
    if (isRowStart) {
      lastRow = rowIdx
      rowStartT = r.t0
    }
    const rectCx = r.x + r.w / 2
    const safeL = cx - halfW * safeHalf
    const safeR = cx + halfW * safeHalf
    if (rectCx > safeR) cx = rectCx - halfW * safeHalf
    else if (rectCx < safeL) cx = rectCx + halfW * safeHalf
    else continue
    cx = Math.max(halfW, Math.min(paper.width - halfW, cx))
    const last = pans[pans.length - 1]
    if (last && Math.abs(last.cx - cx) < 0.5) continue
    pans.push(
      isRowStart
        ? { t: r.t0, cx, from: r.t0, dur: 0 }
        : { t: r.t0, cx, from: Math.max(rowStartT, r.t0 - panMs), dur: panMs },
    )
  }
  if (pans.length === 0) pans.push({ t: firstT, cx: paper.width / 2, from: firstT, dur: 0 })

  return {
    viewW,
    viewH,
    pageW: paper.width,
    pageH: paper.height,
    zoomFit,
    zoomFollow,
    zoomEnd: firstT + introMs,
    firstT,
    rows,
    pans,
    safeHalf,
    introMs,
    lineMs,
    panMs,
  }
}

/** 某时刻所在的行段（没开始前用第一行） */
function rowAt(cam: CameraTrack, t: number): { row: CameraRow; prev?: CameraRow } {
  const { rows } = cam
  if (rows.length === 0) {
    return { row: { t0: 0, t1: 0, pageIndex: 0, cy: cam.pageH / 2 } }
  }
  let i = 0
  for (let k = 0; k < rows.length; k++) {
    if (rows[k].t0 <= t) i = k
    else break
  }
  return { row: rows[i], prev: i > 0 ? rows[i - 1] : undefined }
}

/**
 * 出相机。**必须是 t 的纯函数**（同一个 t 永远同一结果）。
 */
export function cameraAt(cam: CameraTrack, t: number): CameraFrame {
  const { row, prev } = rowAt(cam, t)

  // 纵向：换行的平移**从行边界开始**（与横移同一原则：不提前离开上一行）
  let cy = t <= cam.firstT ? cam.pageH / 2 : row.cy
  if (prev && row.t0 > prev.t0) {
    const k = ease((t - row.t0) / Math.max(1, cam.lineMs))
    cy = prev.cy + (row.cy - prev.cy) * k
  }

  // 缩放：第一拍之前满宽；第一拍之后 introMs 内推到跟拍倍数
  let zoom = cam.zoomFit
  if (t > cam.firstT) {
    const k = ease((t - cam.firstT) / Math.max(1, cam.introMs))
    zoom = cam.zoomFit + (cam.zoomFollow - cam.zoomFit) * k
  }

  // 横向：按关键帧的 from/dur 推移；**换行那一帧 dur=0**，直接在边界上归位
  let cx = cam.pans[0]?.cx ?? cam.pageW / 2
  for (let i = 0; i < cam.pans.length; i++) {
    const p = cam.pans[i]
    const next = cam.pans[i + 1]
    if (p.t <= t) cx = p.cx
    if (next && t < next.t) {
      if (t > next.from && next.dur > 0) {
        const k = ease((t - next.from) / next.dur)
        cx = cx + (next.cx - cx) * k
      }
      break
    }
  }

  // 横向夹紧：按**当前缩放**算半宽（片头满宽时半宽接近页宽的一半，不能再用跟拍那套常量）
  const hw = cam.viewW / zoom / 2
  cx = cam.pageW <= 2 * hw ? cam.pageW / 2 : Math.max(hw, Math.min(cam.pageW - hw, cx))

  return { pageIndex: row.pageIndex, cx, cy, zoom }
}
