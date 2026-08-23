/**
 * editor/completions.ts — 编辑器自动提示数据源（adj165）
 *
 * 输入 `&` 后列出音符修饰符编码；小节线块内输入 `[` 后列出跳房子可用输入。
 * 与 engine/parser/tokenizer 的 & 解析（字母数字 + 可选尾部 +）保持一致。
 */

/** 音符修饰符（& 编码）提示：code + 中文说明 */
export const NOTE_MODIFIER_HINTS: { code: string; label: string }[] = [
  { code: 'tr', label: '颤音（带波浪线）' },
  { code: 'cy', label: '颤音（仅 tr 文本）' },
  { code: 'cy+', label: '颤音（tr + 细密波浪线）' },
  { code: 'bc', label: '波音（横线）' },
  { code: 'zy', label: '颤音记号（三角+线）' },
  { code: 'dy', label: '实心三角（顿音）' },
  { code: 'yc', label: '圆点 + 圆弧（跳音）' },
  { code: 'sby', label: '上波音（2.5 齿）' },
  { code: 'sby+', label: '上波音（3.5 齿）' },
  { code: 'xby', label: '下波音（带竖线）' },
  { code: 'xby+', label: '下波音（3.5 齿）' },
  { code: 'shy', label: '上滑音（弧线）' },
  { code: 'xhy', label: '下滑音（弧线）' },
  { code: 'hx', label: '滑音箭头（右侧）' },
  { code: 'zkh', label: '左括号（音符前）' },
  { code: 'ykh', label: '右括号（音符块后）' },
  { code: 'mp', label: '力度（如 mf）' },
]

/** 小节线修饰符（& 编码，adj126）提示 */
export const BARLINE_MODIFIER_HINTS: { code: string; label: string }[] = [
  { code: 'fine', label: '曲终（播放到此结束）' },
  { code: 'dc', label: '从头反复（D.C.）' },
  { code: 'ds', label: '跳到花 S（D.S.）' },
  { code: 'ty', label: '大跳跃（跳至下一 &ty）' },
  { code: 'hs', label: '花 S 记号（&ds 的跳转目标）' },
]

/** 小节线后输入 [ 的跳房子提示 */
export const VOLTA_HINTS: { code: string; label: string }[] = [
  { code: '"1."', label: '第一遍番号' },
  { code: '"2."', label: '第二遍番号' },
  { code: '+"1."', label: '抬高线 + 番号' },
  { code: '+', label: '抬高横线（可多个）' },
  { code: '/', label: '右侧不封闭（开口）' },
  { code: '"+其他"', label: '自定义注释（引号内任意）' },
]

/** adj186：描述头（行首 Tab 提示）——code + 中文说明（与 parser HEADER_KEYS 一致） */
export const HEADER_HINTS: { code: string; label: string }[] = [
  { code: 'V:', label: '版本号（必须，如 V: 1.0）' },
  { code: 'B:', label: '标题（首个为主标题，其后为副标题）' },
  { code: 'Z:', label: '作者（居右显示）' },
  { code: 'D:', label: '调式（如 D: C / D: F# / D: bE）' },
  { code: 'P:', label: '拍号（如 P: 4/4，可多个）' },
  { code: 'J:', label: '节拍（数字=拍/分，或文字）' },
  { code: 'Y:', label: '乐器（可多次，显示在副标题下）' },
  { code: 'S:', label: '说明文字（谱尾，支持 \\n 换行）' },
]

/** 判断某字符是否可组成 & 编码（字母数字） */
export function isModifierChar(ch: string): boolean {
  return /[a-zA-Z0-9]/.test(ch)
}
