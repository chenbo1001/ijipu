/**
 * editor/findReplace.ts — 「查找替换」的**纯逻辑**（adj641，用户要求）
 *
 * 用户口径："编辑区只有 Ctrl+F 搜索操作，还缺少一个替换操作……在底栏 dock 里增加一个查找替换页签，
 * 将查找和替换进行整合，页签里有查找内容框、替换内容框，有查找统计，还有查找按钮、替换按钮。"
 *
 * 分工：本文件只做"从代码串算出匹配 / 算出替换结果"的**纯函数**（零 React / 零 DOM / 零 store），
 * 面板 `ui/dock/FindPanel.tsx` 只负责读 store、画界面、把结果写回 store。
 * 这样"匹配与替换的口径"可以直接被 `scripts/smoke.mts` 断言（含边界），而不必去驱动界面。
 *
 * ## 几个刻意的口径
 *  - **字面量查找**（不是正则）：`.jps` 里的 `#`、`$`、`(`、`[` 都是语法字符，用户要查的往往正是它们；
 *    走正则就得先教"转义"，反而容易查错。需要正则的场景用编辑器/引擎的其它工具即可。
 *  - **区分大小写默认开**：`.jps` 里大小写有语义（`Q:` 是声部行命令、`b` 是降号、调号字母 `A-G` 大写），
 *    默认不敏感会让 `q` → `Q` 这类替换误伤谱面；要用不敏感，面板上有开关。
 *  - **不重叠**：命中后从该项**末尾**继续找（`aaa` 查 `aa` 得 1 处，不是 2 处）——替换时不重叠才不会互相破坏。
 *  - **"当前项"由选区判定**：查找下一个会把选区设成命中项 ⇒ 连按即可前进；用户随便点一下就自动
 *    回到"光标之后的第一项"，不需要额外记住一个 index（少一份会与真实光标脱节的状态）。
 */

/** 一处命中（半开区间 `[start, end)`，`text` 便于面板直接展示） */
export type FindMatch = { start: number; end: number; text: string }

/** 查找选项 */
export type FindOptions = {
  /** 区分大小写（默认 **true**，见文件头说明） */
  caseSensitive?: boolean
}

/** 全部命中（按位置升序、互不重叠）；`query` 为空返回 `[]` */
export function findMatches(code: string, query: string, opts?: FindOptions): FindMatch[] {  if (!query) return []
  const caseSensitive = opts?.caseSensitive ?? true
  const out: FindMatch[] = []
  const n = code.length
  const q = query.length
  for (let i = 0; i + q <= n; ) {
    if (hitAt(code, query, i, caseSensitive)) {
      out.push({ start: i, end: i + q, text: code.slice(i, i + q) })
      i += q // 不重叠：从命中末尾继续
    } else {
      i += 1
    }
  }
  return out
}

/**
 * `code[i...]` 是否命中 `query`。
 * 逐字符比较（而不是先整体 `toLowerCase()`）：整体转小写会改变某些字符的长度，
 * 位置一旦漂移，替换就会写错地方（`.jps` 是纯文本源码，位置必须分毫不差）。
 */
function hitAt(code: string, query: string, i: number, caseSensitive: boolean): boolean {
  for (let k = 0; k < query.length; k++) {
    const a = code[i + k]
    const b = query[k]
    if (a === undefined) return false
    if (caseSensitive ? a !== b : a.toLowerCase() !== b.toLowerCase()) return false
  }
  return true
}

/**
 * adj642（用户要求）：**`Ctrl+F` 用编辑区当前选中的文本预填查找框**——
 * 用户口径"当按下 Ctrl+F 热键时，编辑区选中的文本自动成为查找框的内容，并完成查找"。
 *
 * 返回要预填的查找内容；没有可用选区时返回 `null`（调用方保持原查找内容不动）。规则：
 *  · 选区为空（只是光标）⇒ `null`；
 *  · 选区跨行（含 `\n` / `\r`）⇒ `null`——查找框是单行输入，多行内容既填不进去也匹配不到，
 *    与其塞进去一个永远 0 处的串，不如保持原样；
 *  · 首尾空白裁掉（选中" 3 "时查"3"才有意义；谱面里空格是分隔符，带空格基本找不到）。
 */
export function seedQueryFromSelection(code: string, sel: { start: number; end: number }): string | null {
  if (sel.end <= sel.start) return null
  const raw = code.slice(Math.max(0, sel.start), Math.min(code.length, sel.end))
  if (raw.includes('\n') || raw.includes('\r')) return null
  const text = raw.trim()
  return text.length > 0 ? text : null
}

/**
 * 「当前项」= 与选区**完全重合**的命中项；选区不是命中项时返回 -1
 */
export function currentMatchIndex(matches: readonly FindMatch[], sel: { start: number; end: number }): number {
  return matches.findIndex((m) => m.start === sel.start && m.end === sel.end)
}

/**
 * 从当前选区/光标出发，**要跳到**的命中项下标（`dir = 1` 下一个 / `-1` 上一个），**循环**。
 *
 * · 选区正好是一项命中（刚按过"查找"）⇒ 前进/后退一项；
 * · 否则"下一个"= 光标处/之后的**第一项**（光标正好停在某项起点也算它，符合直觉）；
 * · "上一个"= 光标之前的**最后一项**；两端都循环到另一头。
 */
export function targetMatchIndex(
  matches: readonly FindMatch[],
  sel: { start: number; end: number },
  dir: 1 | -1,
): number {
  const n = matches.length
  if (n === 0) return -1
  const cur = currentMatchIndex(matches, sel)
  if (cur >= 0) return (cur + dir + n) % n
  if (dir === 1) {
    const i = matches.findIndex((m) => m.start >= sel.start)
    return i >= 0 ? i : 0
  }
  let i = -1
  for (let k = 0; k < n; k++) {
    if (matches[k].end <= sel.start) i = k
    else break
  }
  return i >= 0 ? i : n - 1
}

/**
 * 「替换」要作用的项：选区正好是命中项就用它，否则用**光标之后的第一项**（找不到则第一项）。
 * 于是"点一下替换"= 替换光标处（或其后）那一项，接着再点就继续往下替换——与常见编辑器的连按手感一致。
 */
export function replaceTargetIndex(matches: readonly FindMatch[], caret: number): number {
  if (matches.length === 0) return -1
  const i = matches.findIndex((m) => m.end > caret)
  return i >= 0 ? i : 0
}

/** 替换单项：返回新代码与替换后光标位置（= 替换串末尾） */
export function replaceOne(code: string, match: FindMatch, replacement: string): { code: string; caret: number } {
  return {
    code: code.slice(0, match.start) + replacement + code.slice(match.end),
    caret: match.start + replacement.length,
  }
}

/**
 * 全部替换：**从后往前**拼接（前面的下标不漂移），一次成型 ⇒ 编辑器里是**一步撤销**。
 * 返回替换处数与第一处的位置（面板据此把光标落到第一处，让人看见改了什么）。
 */
export function replaceAllMatches(
  code: string,
  matches: readonly FindMatch[],
  replacement: string,
): { code: string; count: number; firstStart: number } {
  let next = code
  for (let k = matches.length - 1; k >= 0; k--) {
    const m = matches[k]
    next = next.slice(0, m.start) + replacement + next.slice(m.end)
  }
  return { code: next, count: matches.length, firstStart: matches[0]?.start ?? 0 }
}
