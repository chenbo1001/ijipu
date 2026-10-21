/**
 * engine/dynamic/index.ts — 动态谱（视频出片 / 后续 H5）的模块入口
 *
 * 分层：`timeline`（时间 → 矩形）→ `flowView`（矩形 → 条带行）→ `frame`（时刻 → 一帧）。
 * `presets` 给画布尺寸与字号。之上才是宿主的事（canvas 光栅 / ffmpeg 编码）。
 */
export { buildRectTrack, rectsActiveAt, RECT_ABOVE_RATIO, RECT_BELOW_RATIO } from './timeline'
export type { RectTrackOptions } from './timeline'
export { buildFlowView, ROW_MERGE_RATIO } from './flowView'
export type { FlowViewOptions } from './flowView'
export { frameAt, scrollYOfRow, frameTimeMs, frameIndexAt } from './frame'
export {
  DYNAMIC_PRESETS,
  DEFAULT_DYNAMIC_PRESET,
  dynamicPageConfig,
} from './presets'
export type { DynamicPreset, DynamicPresetId } from './presets'
export type { RectTrack, TimedRect, FlowRow, FlowView, FrameRect, Frame } from './types'
