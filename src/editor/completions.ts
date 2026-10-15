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
  // adj496（用户确认）：`&bc` 是**保持音**（tenuto，音符上方一条短横线），不是波音的变体——
  // 此前标签误写作「波音（横线）」，与渲染代码（render/index.ts 该分支注释即"保持音"）矛盾。
  { symbol: 'bc', label: '保持音（上方短横线）' },
  { symbol: 'zy', label: '颤音记号（三角+线）' },
  { symbol: 'dy', label: '实心三角（顿音）' },
  { symbol: 'tu', label: '吐音（音符上方粗体 T）' },
  { symbol: 'ku', label: '吐音（音符上方粗体 K）' },
  // adj635（用户说明）：打音/叠音是竹笛、葫芦丝的传统装饰音——**会改变演奏**
  //  打音 = 主音→下邻音→主音（辅助音极短，常用来把两个相同的音断开）
  //  叠音 = 上邻音→主音（极快的上倚音）
  { symbol: 'da', label: '打音（扌；演奏：主音→下邻音→主音，辅助音极短）' },
  { symbol: 'die', label: '叠音（又；演奏：上邻音→主音，极快的上倚音）' },
  { symbol: 'yc', label: '圆点 + 圆弧（跳音）' },
  { symbol: 'sby', label: '上波音（2.5 齿）' },
  { symbol: 'sby+', label: '上波音（3.5 齿）' },
  { symbol: 'xby', label: '下波音（带竖线）' },
  { symbol: 'xby+', label: '下波音（3.5 齿）' },
  // adj965（用户指正）：补全标签是**纯文本** ⇒ 去掉字面 `**`（会显示成星号）
  { symbol: 'shy', label: '上滑音（弧线；从下方滑进本音，记号画在音符左侧）' },
  { symbol: 'xhy', label: '下滑音（弧线；从上方滑进本音，记号画在音符左侧）' },
  // adj375：&hx 已独立为标记块（不再依附音符）——可写在音符前或后，占宽；播放时占用
  // 前一个音符总时值（含同音连音/增时线/附点）的 1/4 作呼吸换气（最多 1/2 拍，静音）
  { symbol: 'hx', label: '呼吸记号（独立块，换气静音）' },
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

/**
 * adj632：**倚音括号内**可用的 & 编码（与 `engine/types.ts` 的 `GRACE_MARK_CODES` 同源口径）。
 * 倚音支持这些：`&tu`/`&die`/`&da` 画在倚音正上方、`&shy`/`&xhy` 画在倚音右侧；
 * adj633 起再加 4 个波音 `&sby`/`&xby`/`&sby+`/`&xby+`（画在倚音正上方，随倚音等比缩小）。
 * 其余编码写在倚音括号内会被解析器告警——所以候选池必须单独收窄，不能给用户一份会报错的列表。
 */
export const GRACE_MODIFIER_CODES = ['tu', 'die', 'da', 'shy', 'xhy', 'sby', 'xby', 'sby+', 'xby+'] as const

/** 倚音括号内的 & 编码提示：由 MODIFIER_SYMBOLS 派生（只取 GRACE_MODIFIER_CODES 那几条，标签同源） */
export const GRACE_MODIFIER_HINTS: { code: string; label: string }[] = MODIFIER_SYMBOLS.filter((m) =>
  (GRACE_MODIFIER_CODES as readonly string[]).includes(m.symbol),
).map(({ symbol, label }) => ({ code: symbol, label }))

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
 * adj632：判断光标前的 `&` 编码是否位于**倚音括号内**（如 `6/[5/&`、`3[h5/&s`）——
 * 是则只提示倚音支持的那 9 个编码（见 `GRACE_MODIFIER_HINTS`）。
 *
 * 判定依据与 tokenizer 一致：**光标前最后一个 `[` 之后还没有 `]`**，就还在倚音括号里
 * （跳房子 `[` 内本来也不允许写 `&` 编码，同一判定不会误伤）。
 */
export function isGraceModifierContext(lineBefore: string): boolean {
  const m = /&([a-zA-Z+]*)$/.exec(lineBefore)
  if (!m) return false
  const prev = lineBefore.slice(0, m.index)
  return prev.lastIndexOf('[') > prev.lastIndexOf(']')
}

/**
 * adj203：按上下文过滤 & 修饰符提示——小节线后显示 BARLINE_MODIFIER_HINTS，
 * 音符后显示 NOTE_MODIFIER_HINTS；前缀为空返回对应全量；无匹配返回空数组。
 * adj632：`inGrace`（倚音括号内）优先级最高，用 GRACE_MODIFIER_HINTS。
 */
export function filterModifierHints(
  prefix: string,
  onBarline: boolean,
  inGrace = false,
): { code: string; label: string }[] {
  const pool = inGrace ? GRACE_MODIFIER_HINTS : onBarline ? BARLINE_MODIFIER_HINTS : NOTE_MODIFIER_HINTS
  if (prefix === '') return pool
  return pool.filter((h) => h.code.startsWith(prefix))
}
