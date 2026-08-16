/**
 * engine/render/index.ts — SVG 渲染（契约先行，实现见后续迭代）
 *
 * 输入：排版结果；输出：每页一个 SVG 字符串。
 * 数字字形方案：内置 SVG path 字形（<defs> + <use>，3 套样式 a/b/c），
 * 与光标联动契约：音符 <use> 带 data-notepos 属性；歌词 <text> 带 data-cipos。
 */
import type { ScoreLayout } from '../types'

/**
 * 将排版结果渲染为 SVG 页面数组（每个元素是一页的完整 <svg> 字符串）。
 * TODO(engine): 实现字形、坐标绘制、连音线/反复记号/跳房子等符号绘制。
 */
export function renderScoreToSvg(layout: ScoreLayout): string[] {
  void layout
  return []
}
