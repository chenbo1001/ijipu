/**
 * src/dialogs/practiceMarkText.ts — 标记段下拉的显示文本（adj1101）
 *
 * 用户口径：「标记段下拉列表够大，可以显示为 `段1 [ 33:1 - 34:2 ]`，这个形式更明确」。
 *
 * 小节/拍的口径**不在这里算**：由引擎 `measureSpotOf(layout, id)` 给（与命令行 `--from 33:1`
 * 同一套换算，`layout/measureMap.ts`）。这里只负责把两个位置格式化成 `33:1 - 34:2`。
 */
export interface MarkSpotLike {
  /** 全局小节号（1 起） */
  bar: number
  /** 小节内累积拍（0 起，引擎 `beatPos` 口径） */
  beatPos: number
}

/** 拍位（0 起）→ 用户看到的拍号（1 起；半拍保留一位小数，如 `3.5`） */
export function beatLabelOf(beatPos: number): string {
  const v = beatPos + 1
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(2)))
}

/**
 * 标记段的区间文本：`33:1 - 34:2`。
 *
 * @param a 起点位置（`measureSpotOf` 的结果；`null` = 这个音在当前排版里找不到）
 * @param b 终点位置
 * @returns 两个位置都有才给文本，否则空串（界面据此只显示段名，不显示半截区间）
 */
export function markRangeText(a: MarkSpotLike | null, b: MarkSpotLike | null): string {
  if (a === null || b === null) return ''
  return `${a.bar}:${beatLabelOf(a.beatPos)} - ${b.bar}:${beatLabelOf(b.beatPos)}`
}

/** 下拉项全文：`段1 [ 33:1 - 34:2 ]`（没有区间时退化成段名本身） */
export function markOptionText(name: string, a: MarkSpotLike | null, b: MarkSpotLike | null): string {
  const range = markRangeText(a, b)
  return range === '' ? name : `${name} [ ${range} ]`
}
