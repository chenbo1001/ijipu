/**
 * engine/index.ts — 简谱引擎统一入口
 *
 * 引擎设计原则：
 *  - 纯 TypeScript，零 React / 零 DOM 依赖，可在 Node 中单测；
 *  - 数据流单向：source(.jps) → parse → layout → render / playback。
 */
export * from './types'
export { parseJps } from './parser'
export { formatJps } from './format/format'
export { tokenDuration, durationMs } from './duration'
export { layoutScore } from './layout'
export { renderScoreToSvg } from './render'
export { buildPlaySequence, inferBpm, createBackend, schedulePlay, SynthBackend, SamplerBackend, pitchToFreq } from './playback'
export { codePosToNoteId, noteIdToCodePos, parseNoteId } from './cursorMap'
export { computeRowTops, computeRowGuides, dragDelta, clamp, metaAreaH, GUIDE_ITEMS, GUIDE_LIMITS, GUIDE_LIMITS_EX } from './layout/guides'
export { metaAnchorOf, metaAnchorPt, clampMetaPos } from './layout/metaAnchors'
export type { GuideDragSpec } from './layout/guides'
export type { NoteIdParts } from './cursorMap'
export type { AudioBackend, BackendKind, PlayEvent, PlaySequence } from './playback'
