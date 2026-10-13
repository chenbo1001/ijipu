/**
 * diff/textDiff.ts — **源码文本差异计算**（纯函数、零依赖；adj928）
 *
 * ## 它给谁用
 *
 * 嵌入版检测到"当前 `.jps` 的内容在别处被改了"（adj927）时，用户在确认条上点「查看差异」，
 * 就打开一个**两栏源码差异框**：左 = 本地正在编辑的那份、右 = 文件里的新内容。
 * 本模块只算差异（`diffTexts` / `inlineDiff` / `collapseDiffRows`），界面在
 * `src/dialogs/FileDiffDialog.tsx`。
 *
 * ## 两条铁律
 *
 * ① **噪声先归一化，但绝不改用户内容**：CRLF↔LF、行尾空白、末尾有没有换行这三类差异
 *    （Obsidian Sync 换行符风格不同最容易造出来）**不算改动**。归一化只作用于"比较与展示"——
 *    「载入外部」写回去的始终是**原始文本**（见 `externalChange.ts` 的 `externalText`）。
 * ② **不许卡死**：常规短谱走 O(N·M) 的行级 LCS；超长/极端输入**退化**为"按区块标改动"、
 *    不做行内高亮，并把 `degraded` 标出来给界面提示（用户口径："不许卡死"）。
 *
 * 行级对齐之外还做**行内字符级高亮**（"改动的行里到底改了哪几个字"）——这是"做好一点"的关键：
 * 只画整行"改过了"，用户还是得自己逐字找。
 */
/** 行内要高亮的字符区间（左闭右开） */
export interface InkSpan {
  start: number
  end: number
}

/** 行级 LCS 的单元格上限（超过就退化：只标改动区块，不做行内高亮） */
const MAX_LCS_CELLS = 1_000_000
/** 行内字符级 LCS 的单元格上限（超过就只做"公共前后缀"那一层定位） */
const MAX_INLINE_CELLS = 200_000

/**
 * 归一化（**仅用于比较与差异展示**）：`\r\n`/`\r` → `\n`、去掉每行行尾空白、去掉末尾空行。
 *
 * 为什么连"末尾空行"一起去掉：用户口径里"末尾有无换行不算改动"；把末尾连续换行一并折掉，
 * 语义一致且更好实现（`a\n` 与 `a` 与 `a\n\n` 归一化后都是 `a`）。
 */
export function normalizeForDiff(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

/**
 * 内容指纹：归一化文本的 FNV-1a 32 位（十六进制）+ 归一化后的长度。
 *
 * 只用来回答"内容是不是同一份"，**不是密码学哈希**；带上长度是为了让"同 32 位、长度不同"
 * 这类碰撞不至于被当成"没变"（宁可多提示一次，也不要漏掉真外部改动）。
 */
export function contentFingerprint(text: string): string {
  const s = normalizeForDiff(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}-${s.length.toString(16)}`
}

/** 两段文本在"归一化口径"下是否同一份内容（CRLF / 行尾空白 / 末尾换行不算差异） */
export function sameContent(a: string, b: string): boolean {
  return contentFingerprint(a) === contentFingerprint(b)
}

/** 归一化后按行拆分（比较与展示共用同一份口径；空文本 = 0 行） */
export function splitDiffLines(text: string): string[] {
  const n = normalizeForDiff(text)
  return n === '' ? [] : n.split('\n')
}

export type DiffRowKind = 'same' | 'del' | 'add' | 'change'

/** 差异表里的一行（左右两栏各一格；`null` = 这一侧没有对应行，渲染成占位空行） */
export interface DiffRow {
  kind: DiffRowKind
  leftNo: number | null
  leftText: string | null
  rightNo: number | null
  rightText: string | null
  /** 左栏行内要高亮的字符区间（只有 `change` 行可能有） */
  leftInk: InkSpan[]
  /** 右栏行内要高亮的字符区间 */
  rightInk: InkSpan[]
}

export interface DiffResult {
  rows: DiffRow[]
  /** 本地（左）行数 */
  leftLines: number
  /** 外部（右）行数 */
  rightLines: number
  /** 改动**处**数：连续的改动行合并算 1 处 */
  changeCount: number
  /** 是否退化为"只标改动区块、不做行内高亮"（超长输入的性能兜底） */
  degraded: boolean
}

/** LCS 回表得到的一步操作 */
type Op = { kind: 'same' | 'del' | 'add'; text: string }

/** 经典 LCS 动态规划（返回含 `same` 的操作序列，供逐行对齐用） */
function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ kind: 'del', text: a[i++] })
    } else {
      ops.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++] })
  while (j < m) ops.push({ kind: 'add', text: b[j++] })
  return ops
}

/** 把区间并进列表（相邻/重叠就合并，避免渲染出一串碎片 span） */
function pushSpan(list: InkSpan[], index: number): void {
  const last = list[list.length - 1]
  if (last && last.end >= index) last.end = Math.max(last.end, index + 1)
  else list.push({ start: index, end: index + 1 })
}

/**
 * **行内字符级差异**：先剥公共前后缀（"只改了几个字"最常见），中段再跑字符级 LCS
 * （同一行里改了两处也能各自标出来）；中段过大就只把中段整块标出（性能兜底）。
 */
export function inlineDiff(a: string, b: string): { left: InkSpan[]; right: InkSpan[] } {
  const min = Math.min(a.length, b.length)
  let pre = 0
  while (pre < min && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < min - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const aMid = a.slice(pre, a.length - suf)
  const bMid = b.slice(pre, b.length - suf)
  if (aMid === '' && bMid === '') return { left: [], right: [] }
  if (aMid.length * bMid.length > MAX_INLINE_CELLS) {
    return {
      left: aMid === '' ? [] : [{ start: pre, end: pre + aMid.length }],
      right: bMid === '' ? [] : [{ start: pre, end: pre + bMid.length }],
    }
  }
  const n = aMid.length
  const m = bMid.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        aMid[i] === bMid[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  const left: InkSpan[] = []
  const right: InkSpan[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aMid[i] === bMid[j]) {
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      pushSpan(left, pre + i)
      i++
    } else {
      pushSpan(right, pre + j)
      j++
    }
  }
  while (i < n) pushSpan(left, pre + i++)
  while (j < m) pushSpan(right, pre + j++)
  return { left, right }
}

/**
 * 两栏源码差异。**输入是原始文本**（归一化在内部做，只影响比较与展示）。
 *
 * 先剥公共前后缀行（改动通常只占中间一小段 ⇒ DP 规模骤降），中间那段才做 LCS；
 * 段内"删除 + 新增"按顺序配对成 `change`（逐行行内高亮），多出来的算纯 `del` / 纯 `add`。
 */
export function diffTexts(local: string, external: string): DiffResult {
  const a = splitDiffLines(local)
  const b = splitDiffLines(external)
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const midA = a.slice(pre, a.length - suf)
  const midB = b.slice(pre, b.length - suf)
  const degraded = (midA.length + 1) * (midB.length + 1) > MAX_LCS_CELLS
  const ops: Op[] = degraded
    ? [
        ...midA.map((text): Op => ({ kind: 'del', text })),
        ...midB.map((text): Op => ({ kind: 'add', text })),
      ]
    : lcsOps(midA, midB)

  const rows: DiffRow[] = []
  let ln = 1
  let rn = 1
  for (let k = 0; k < pre; k++) rows.push(sameRow(a[k], ln++, rn++))
  let i = 0
  while (i < ops.length) {
    if (ops[i].kind === 'same') {
      rows.push(sameRow(ops[i].text, ln++, rn++))
      i++
      continue
    }
    // 这一"改动段"里的删除与新增各自收拢（先删后增 ⇒ 便于逐行配对成"修改"）
    const dels: string[] = []
    const adds: string[] = []
    while (i < ops.length && ops[i].kind !== 'same') {
      if (ops[i].kind === 'del') dels.push(ops[i].text)
      else adds.push(ops[i].text)
      i++
    }
    const pairs = Math.min(dels.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      const ink = degraded ? { left: [], right: [] } : inlineDiff(dels[k], adds[k])
      rows.push({
        kind: 'change',
        leftNo: ln++,
        leftText: dels[k],
        rightNo: rn++,
        rightText: adds[k],
        leftInk: ink.left,
        rightInk: ink.right,
      })
    }
    for (let k = pairs; k < dels.length; k++) {
      rows.push({ kind: 'del', leftNo: ln++, leftText: dels[k], rightNo: null, rightText: null, leftInk: [], rightInk: [] })
    }
    for (let k = pairs; k < adds.length; k++) {
      rows.push({ kind: 'add', leftNo: null, leftText: null, rightNo: rn++, rightText: adds[k], leftInk: [], rightInk: [] })
    }
  }
  for (let k = a.length - suf; k < a.length; k++) rows.push(sameRow(a[k], ln++, rn++))

  let changeCount = 0
  let inChange = false
  for (const r of rows) {
    if (r.kind === 'same') inChange = false
    else if (!inChange) {
      changeCount++
      inChange = true
    }
  }
  return { rows, leftLines: a.length, rightLines: b.length, changeCount, degraded }
}

/** 两侧内容相同的行 */
function sameRow(text: string, leftNo: number, rightNo: number): DiffRow {
  return { kind: 'same', leftNo, leftText: text, rightNo, rightText: text, leftInk: [], rightInk: [] }
}

/** 折叠视图的一块：连续的"要显示的行" 或 "被折叠的行" */
export interface DiffBlock {
  kind: 'rows' | 'gap'
  /** 起止行下标（含） */
  from: number
  to: number
}

/**
 * 默认视图只保留"改动处上下各 `context` 行"，其余折成 `gap` 块（界面显示成"… 折叠 N 行 …"）。
 * 「展开全部」= 直接不调用本函数（界面里一行 `blocks`/`rows` 的切换）。
 */
export function collapseDiffRows(rows: readonly DiffRow[], context = 3): DiffBlock[] {
  const keep = new Set<number>()
  rows.forEach((r, idx) => {
    if (r.kind === 'same') return
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) keep.add(k)
  })
  const blocks: DiffBlock[] = []
  let i = 0
  while (i < rows.length) {
    const from = i
    const want = keep.has(i)
    while (i < rows.length && keep.has(i) === want) i++
    blocks.push({ kind: want ? 'rows' : 'gap', from, to: i - 1 })
  }
  return blocks
}
