/**
 * editor/shortcuts.ts — 编辑器快捷键辅助（纯函数，可单测）
 *
 * 行首命令：光标位于行首时按 Q/C/B/Z/D/P/J/V/H，在该行插入命令头（如 "Q: "）。
 * 行为对齐原「番茄简谱」：仅当光标前一字符为换行符（或位于文首）时触发，
 * 其余情况不拦截正常输入。
 */

/** 行首命令键（对应 .jps 行头字段） */
export const LINE_HEADER_KEYS = ['Q', 'C', 'B', 'Z', 'D', 'P', 'J', 'V', 'H'] as const

export type LineHeaderKey = (typeof LINE_HEADER_KEYS)[number]

export function isLineHeaderKey(k: string): k is LineHeaderKey {
  return (LINE_HEADER_KEYS as readonly string[]).includes(k)
}

export interface InsertResult {
  text: string
  /** 插入后的光标位置（selectionStart/End 相同） */
  pos: number
}

/**
 * 在行首插入命令头。
 * @param text 编辑器当前全文
 * @param selectionStart 光标位置（0-based）
 * @param key 命令键（Q/C/B/Z/D/P/J/V/H）
 * @returns 插入结果；若光标不在行首则返回 null（不拦截）
 */
export function insertLineHeader(
  text: string,
  selectionStart: number,
  key: LineHeaderKey,
): InsertResult | null {
  const atLineStart = selectionStart === 0 || text[selectionStart - 1] === '\n'
  if (!atLineStart) return null
  const header = `${key}: `
  const next = text.slice(0, selectionStart) + header + text.slice(selectionStart)
  return { text: next, pos: selectionStart + header.length }
}

/**
 * 计算光标在文本中的行/列（1-based 行、0-based 列），供状态栏与错误定位使用。
 */
export function lineColOf(text: string, pos: number): { line: number; col: number } {
  let line = 1
  let col = 0
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      col = 0
    } else {
      col++
    }
  }
  return { line, col }
}
