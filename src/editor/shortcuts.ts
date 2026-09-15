/**
 * editor/shortcuts.ts — 编辑器快捷键辅助（纯函数，可单测）
 *
 * 行首命令：光标位于行首时按 q/c/b/z/d/p/j/v/y/s，在该行插入命令头（如 "Q: "）。
 * 行为对齐原「番茄简谱」：仅当光标前一字符为换行符（或位于文首）时触发，
 * 其余情况不拦截正常输入。**字母大小写都认**（编辑器按 `key.toUpperCase()` 判断，
 * 插入的命令头一律大写，如按 q 得到 "Q: "）——速查里按小写书写。
 * adj419：补上描述头 `Y:`（默认乐器）与 `S:`（说明文字）——解析器早就支持，
 * 行首命令却漏了这两个；同时去掉解析器并不认识的 `H`（按 h 会插出无法解析的 `H:` 行）。
 */

/** 行首命令键（对应 .jps 行头字段，与 parser 的 HEADER_KEYS 对齐 + 曲/词行 Q/C） */
export const LINE_HEADER_KEYS = ['Q', 'C', 'B', 'Z', 'D', 'P', 'J', 'V', 'Y', 'S'] as const

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
 * @param key 命令键（Q/C/B/Z/D/P/J/V/Y/S）
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
