/**
 * editor/completions.ts — 编辑器自动提示数据源（adj165）
 *
 * 输入 `&` 后列出音符修饰符编码；小节线块内输入 `[` 后列出跳房子可用输入。
 * 与 engine/parser/tokenizer 的 & 解析（字母数字 + 可选尾部 +）保持一致。
 */

/** 统一 & 修饰符字典（adj322 两处同源）：symbol = & 后编码（不含 &），label = 中文说明。
 *  barline: true = 小节线修饰符（仅小节线后 & 合法，&fine/&dc/&ds/&ty/&hs）。
 *  自动补全（NOTE_MODIFIER_HINTS / BARLINE_MODIFIER_HINTS）与输入条「装饰」组（DECOR_KEYS）都从它派生。 */
export const MODIFIER_SYMBOLS: { symbol: string; label: string; barline?: boolean }[] = [
  { symbol: 'tr', label: '颤音（带波浪线）' },
  { symbol: 'cy', label: '颤音（仅 tr 文本）' },
  { symbol: 'cy+', label: '颤音（tr + 细密波浪线）' },
  { symbol: 'bc', label: '波音（横线）' },
  { symbol: 'zy', label: '颤音记号（三角+线）' },
  { symbol: 'dy', label: '实心三角（顿音）' },
  { symbol: 'yc', label: '圆点 + 圆弧（跳音）' },
  { symbol: 'sby', label: '上波音（2.5 齿）' },
  { symbol: 'sby+', label: '上波音（3.5 齿）' },
  { symbol: 'xby', label: '下波音（带竖线）' },
  { symbol: 'xby+', label: '下波音（3.5 齿）' },
  { symbol: 'shy', label: '上滑音（弧线）' },
  { symbol: 'xhy', label: '下滑音（弧线）' },
  { symbol: 'hx', label: '滑音箭头（右侧）' },
  { symbol: 'zkh', label: '左括号（音符前）' },
  { symbol: 'ykh', label: '右括号（音符块后）' },
  { symbol: 'pp', label: '力度：很弱（pp）' },
  { symbol: 'p', label: '力度：弱（p）' },
  { symbol: 'mp', label: '力度：稍弱（mp）' },
  { symbol: 'mf', label: '力度：稍强（mf）' },
  { symbol: 'f', label: '力度：强（f）' },
  { symbol: 'ff', label: '力度：很强（ff）' },
  { symbol: 'fff', label: '力度：最强（fff）' },
  { symbol: 'sf', label: '力度：突强（sf）' },
  { symbol: 'fp', label: '力度：强后立即弱（fp）' },
  { symbol: 'sfp', label: '力度：突强后突弱（sfp）' },
  { symbol: 'rit', label: '渐慢（rit）' },
  { symbol: 'fine', label: '曲终（播放到此结束）', barline: true },
  { symbol: 'dc', label: '从头反复（D.C.）', barline: true },
  { symbol: 'ds', label: '跳到花 S（D.S.）', barline: true },
  { symbol: 'ty', label: '大跳跃（跳至下一 &ty）', barline: true },
  { symbol: 'hs', label: '花 S 记号（&ds 的跳转目标）', barline: true },
]

/** 音符修饰符（& 编码）提示：由 MODIFIER_SYMBOLS 派生（音符+力度，非小节线） */
export const NOTE_MODIFIER_HINTS: { code: string; label: string }[] = MODIFIER_SYMBOLS.filter((m) => !m.barline).map(({ symbol, label }) => ({ code: symbol, label }))

/** 小节线修饰符（& 编码，adj126）提示：由 MODIFIER_SYMBOLS 派生（barline 项） */
export const BARLINE_MODIFIER_HINTS: { code: string; label: string }[] = MODIFIER_SYMBOLS.filter((m) => m.barline).map(({ symbol, label }) => ({ code: symbol, label }))

/** 小节线后输入 [ 的跳房子提示 */
export const VOLTA_HINTS: { code: string; label: string }[] = [
  { code: '"1."', label: '第一遍番号' },
  { code: '"2."', label: '第二遍番号' },
  { code: '+"1."', label: '抬高线 + 番号' },
  { code: '+', label: '抬高横线（可多个）' },
  { code: '/', label: '右侧不封闭（开口）' },
  { code: '"+其他"', label: '自定义注释（引号内任意）' },
]

/** adj186：描述头（行首 Tab 提示）——code + 中文说明；cursorAt 可选（插入后光标停靠位置，
 *  用于带声部名模板让光标落在引号内待输入）；adj192：加入 Q:/C: 及多声部/带声部名变体；
 *  adj281：Q:/C: 系列最常用，将 Q:/C: 相关描述头提前到最前面，其它保持原顺序排列 */
export const HEADER_HINTS: { code: string; label: string; cursorAt?: number }[] = [
  { code: 'Q:', label: '曲行（声部 1，可省略编号）' },
  { code: 'C:', label: '歌词行（依附上一曲行）' },
  { code: 'Q1:', label: '曲行·声部 1' },
  { code: 'Q2:', label: '曲行·声部 2' },
  { code: 'C1:', label: '歌词行·声部 1' },
  { code: 'C2:', label: '歌词行·声部 2' },
  { code: 'Q1"声部名":', label: '曲行·声部 1 带名称', cursorAt: 4 },
  { code: 'Q2"声部名":', label: '曲行·声部 2 带名称', cursorAt: 4 },
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

/**
 * adj202：按行首已输入的描述头前缀过滤提示列表（不区分大小写）——
 * 输入 q → Q:/Q1:/Q2: 等；前缀为空返回全部；无匹配返回空数组。
 */
export function filterHeaderHints(prefix: string): { code: string; label: string; cursorAt?: number }[] {
  const p = prefix.toLowerCase()
  if (p === '') return HEADER_HINTS
  return HEADER_HINTS.filter((h) => h.code.toLowerCase().startsWith(p))
}

/**
 * adj203：判断光标前 & 编码是否位于小节线后（如 `| &`、`:| &`）——
 * 是则提示小节线修饰符（&fine/&dc/&ds/&ty/&hs），否则提示音符修饰符（&tr/&cy 等）。
 * 依据：tokenizer 中小节线后的 & 才解析为 mark，音符后的 & 是音符修饰符。
 */
export function isBarlineModifierContext(lineBefore: string): boolean {
  // adj220：只收字母 + 可选 +（与 tokenizer 一致，&dy5 中 5 是音符起点）
  const m = /&([a-zA-Z+]*)$/.exec(lineBefore)
  if (!m) return false
  const prev = lineBefore.slice(0, m.index).trimEnd()
  return prev !== '' && /[|:]/.test(prev[prev.length - 1])
}

/**
 * adj203：按上下文过滤 & 修饰符提示——小节线后显示 BARLINE_MODIFIER_HINTS，
 * 音符后显示 NOTE_MODIFIER_HINTS；前缀为空返回对应全量；无匹配返回空数组。
 */
export function filterModifierHints(
  prefix: string,
  onBarline: boolean,
): { code: string; label: string }[] {
  const pool = onBarline ? BARLINE_MODIFIER_HINTS : NOTE_MODIFIER_HINTS
  if (prefix === '') return pool
  return pool.filter((h) => h.code.startsWith(prefix))
}
