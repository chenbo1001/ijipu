/**
 * engine/dynamic/index.ts — 动态谱（视频出片 / 后续 H5）的模块入口
 *
 * 目前只有时间轴这一层（`timeline.ts`）。流式视图（`flowView.ts`）与帧渲染（`frame.ts`）
 * 随后补进来，统一从这里导出，再由 `engine/index.ts` 转出一次。
 */
export { buildRectTrack, rectsActiveAt, RECT_ABOVE_RATIO, RECT_BELOW_RATIO } from './timeline'
export type { RectTrackOptions } from './timeline'
export type { RectTrack, TimedRect } from './types'
