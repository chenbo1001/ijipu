/**
 * engine/layout/index.ts — 排版引擎（契约先行，实现见后续迭代）
 *
 * 输入：解析结果 + 页面配置；输出：多页谱面模型（坐标、时值、试听音高），
 * 供 render（SVG 生成）与 playback（播放序列）使用。
 *
 * 排版要点（V1.0 手册）：
 *  - 手动分页：[fenye] 分隔；
 *  - 歌词逐字对齐音符（C 行依附 Q 行；@ 跳过；~ 连字；标点不占位）；
 *  - 多声部（Q1/Q2…）纵向堆叠，共享小节线；
 *  - 自动换行：按页面可用宽度断行，行间距按 PageConfig。
 */
import type { PageConfig, ParseResult, ScoreLayout } from '../types'

/**
 * 排版：ParseResult → ScoreLayout
 * TODO(engine): 实现断行/分页/坐标计算/歌词对齐/多声部堆叠。
 */
export function layoutScore(result: ParseResult, config: PageConfig): ScoreLayout {
  void result
  void config
  return { pages: [], configKey: 'unimplemented' }
}
