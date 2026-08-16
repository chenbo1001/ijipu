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
export { buildPlaySequence } from './playback'
export type { PlayEvent, PlaySequence, AudioBackend } from './playback'
