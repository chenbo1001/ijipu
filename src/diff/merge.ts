/**
 * diff/merge.ts — **"两边都改了"怎么办**：块级采纳（P1）+ 三路自动合并（P2）（adj966f，纯函数）
 *
 * ## 它解决什么
 *
 * 一份 `.jps` 在同步端被改了，本机编辑器里也有未保存的改动 —— 也就是**两边都变了**。
 * `store/externalChange.ts` 能判出"外部改了"，`dialogs/FileDiffDialog.tsx` 能两栏对比，
 * 但用户只能**整体二选一**（保留本地 / 载入外部），中间那件最想要的事做不了：
 * 「这一块用我的、那一块用他的；两边没打架的地方请自动合好」。
 *
 * 用户 2026-10-16 拍板的四条口径（见 `docs/FILE-MODEL.md` §9，**不许改**）：
 *  ① 先做 **P1 块级采纳**，紧接着做 **P2 自动三路合并**；
 *  ② 差异框里的按钮文案是「**用左 / 用右**」（栏目标题已写明本地 / 外部）；
 *  ③ 合并**以本地为底**（本地改动留在编辑器里、历史连续；外部改动以块为单位供采纳）；
 *  ④ 采纳后**立即保存**（写回文件 + 刷新基准）——由调用方做，本模块只管算出文本。
 *  **P3 不做**：行内字符级自动合并（同一行两边都改只做"标出来让人选"，不做自动字符合并）。
 *
 * ## 两种模式（差别只在"有没有共同祖先"）
 *
 * | 模式 | 何时 | 块的粒度 | 能不能自动合 |
 * |---|---|---|---|
 * | `three-way` | 基准里**留着原文**（P2 起：`FileBaseline.text`） | 以**共同祖先**为坐标的"改动簇" | 能：只有一边改过的簇自动合，两边改同一簇才算冲突 |
 * | `two-way` | 没有共同祖先（旧基准 / 没有基准 / 基准换了文件） | 两栏差异里的**连续改动段** | 不能：没有祖先就分不清"谁改的"，逐块都要用户点（默认"用左"＝以本地为底） |
 *
 * **不许另写一套 diff**：行级对齐一律复用 `textDiff.ts` 的 `diffTexts`（含它自己的
 * 公共前后缀剥离、LCS 退化兜底、行内字符级高亮），本模块只在它的**行对齐结果**上做三件事：
 * 把连续改动行收成"改动块"、按共同祖先判"谁改的"、按用户选择拼回文本。
 *
 * ## 块粒度（要说清，否则"自动合"的边界说不明白）
 *
 * 一个块 = **某一侧的一段连续改动行**，与 `git` / `diff3` 的 change-hunk 同口径：
 * 相邻两行都改 ⇒ **一个**块；中间隔着一行没改 ⇒ **两个**块。
 * 这是刻意偏保守的一档：宁可把"邻行改动"并进同一个块一起问用户，也**不**把一段连续改动劈开、
 * 静默拼出半个谱来。（P3 不做行内字符级合并，也是同一条"不替用户猜"的思路。）
 *
 * 于是"互不重叠 ⇒ 自动合"的准确含义是：**两侧的改动段互不重叠**。相邻改动被并进同一个块时，
 * 那一块会**连本地没碰过的那一行一起**交给用户选——不会丢东西，只是多问一句。
 *
 * ## 一条不变量（断言守着它）
 *
 * 两栏显示的**左栏逐行拼起来 == 本地原文、右栏 == 外部原文**（归一化口径）。
 * 它保证：全选「用左」⇒ 合并结果逐字等于本地；全选「用右」⇒ 逐字等于外部。
 * 也正因为这条，"未被采纳的外部块混进来"这种错误在结构上不可能发生（负向判据 ③）。
 */
import { diffTexts, inlineDiff, splitDiffLines, type DiffRow, type InkSpan } from './textDiff'

/** 块的两侧：`local` = 左栏（正在编辑的这份）、`external` = 右栏（文件里的新内容） */
export type MergeSide = 'local' | 'external'

/**
 * 块的类别（决定它要不要问用户）：
 *  · `local-only`   只有本地改过 ⇒ 自动保留本地（默认「用左」）；
 *  · `external-only` 只有外部改过 ⇒ **自动采用外部**（默认「用右」）——这就是 P2 的"自动合好"；
 *  · `both`         两边都改过同一块 ⇒ `conflict` 时**必须问**；
 *  · `manual`       二路模式（没有共同祖先）⇒ 一律问。
 */
export type MergeBlockKind = 'local-only' | 'external-only' | 'both' | 'manual'

/** 一个决策块（差异框里"一个改动块配一对「用左 / 用右」"就是它） */
export interface MergeBlock {
  /** 块序号（0 基；UI 的 choices 按它索引） */
  index: number
  kind: MergeBlockKind
  /** 两边都改了**同一块**且结果不同 ⇒ 必须由用户选（负向判据 ① 守的就是它） */
  conflict: boolean
  /** 该块占用的**两栏行下标**（含两端）——界面按它插按钮、折叠也按它 */
  rowFrom: number
  rowTo: number
  /** 共同祖先里的行范围（0 基半开）；二路模式为 `null` */
  baseFrom: number | null
  baseTo: number | null
  /** 这一块的"本地版"内容（「用左」取它） */
  localLines: string[]
  /** 这一块的"外部版"内容（「用右」取它） */
  externalLines: string[]
  /** 默认选择（**以本地为底**：只有"外部一方改过"的块默认用外部，其余默认本地） */
  defaultChoice: MergeSide
}

/** 合并计划（纯数据；界面与断言都消费它） */
export interface MergePlan {
  mode: 'three-way' | 'two-way'
  /** 两栏显示用的行（与 `textDiff.diffTexts` 同一形状 ⇒ 折叠/行内高亮直接复用） */
  rows: DiffRow[]
  blocks: MergeBlock[]
  /** 每一行属于哪一块（`null` = 上下文行） */
  blockOfRow: (number | null)[]
  /** 本地行数 / 外部行数（摘要行用） */
  leftLines: number
  rightLines: number
  /** 改动块数 */
  changeCount: number
  /** **冲突块数**（要用户选的块数；P2 的提示条按它决定文案） */
  conflicts: number
  /** 自动合好的块数（只有一边改过 ⇒ 不必打扰用户） */
  autoCount: number
  /** 超长输入退化为"只标改动块、不做行内高亮"（与差异框同口径） */
  degraded: boolean
}

/** 用户的选择（按块序号；缺省 = 用块自己的 `defaultChoice`） */
export type MergeChoices = Readonly<Record<number, MergeSide | undefined>>

/** 共同祖先坐标里的一个改动段（`from == to` = 纯插入） */
interface Hunk {
  from: number
  to: number
  lines: string[]
}

/**
 * 从一个侧（本地 / 外部）相对**共同祖先**的行对齐里，收出改动段。
 *
 * 复用 `diffTexts` 的行对齐（不另写 diff）：把连续的"非 same 行"收成一段 ——
 * 段覆盖的祖先行范围 = 这些行里出现过的 `leftNo`（1 基 ⇒ 半开区间终点就是它），
 * 段的内容 = 这些行里出现过的 `rightText`（＝这一侧**实际的样子**）。
 *
 * ⚠ 内容只取 `rightText`：`diffTexts` 会把"删除 + 新增"配对成 `change` 行**只为显示对齐**，
 * 若把 `change` 行的左侧文本也收进段内容，段内容就会混进祖先那一份（实测过的错法）。
 */
function hunksBetween(baseText: string, sideText: string): { hunks: Hunk[]; degraded: boolean } {
  const d = diffTexts(baseText, sideText)
  const hunks: Hunk[] = []
  let seen = 0 // 已经走过的祖先行数（＝下一行的 0 基下标）
  let cur: Hunk | null = null
  for (const r of d.rows) {
    if (r.kind === 'same') {
      cur = null
      seen += 1
      continue
    }
    if (!cur) {
      cur = { from: seen, to: seen, lines: [] }
      hunks.push(cur)
    }
    if (r.leftNo !== null) {
      seen += 1
      cur.to = seen
    }
    if (r.rightText !== null) cur.lines.push(r.rightText)
  }
  return { hunks, degraded: d.degraded }
}

/**
 * 两个改动段是否**打架**（＝必须一起交给用户决定）。
 *
 * 半开区间按常规判交；**纯插入**（`from == to`，长度为 0）按"点"处理：点落在另一段的**闭区间**内即算打架。
 * 取闭区间是**刻意偏保守**：插入点恰好在对方改动段的边界上时（例：一边改写了第 3 小节、
 * 另一边恰好就在第 3 小节前插入一行），"谁前谁后"没有唯一正解 ⇒ 宁可问一句，也不静默拼出一个错谱。
 */
function hunksClash(a: Hunk, b: Hunk): boolean {
  const aEmpty = a.from === a.to
  const bEmpty = b.from === b.to
  if (aEmpty && bEmpty) return a.from === b.from
  if (aEmpty) return a.from >= b.from && a.from <= b.to
  if (bEmpty) return b.from >= a.from && b.from <= a.to
  return a.from < b.to && b.from < a.to
}

/** 一个"改动簇"：一簇里所有段（两侧）互相打架，必须作为**一个**决策块 */
interface Cluster {
  local: Hunk[]
  external: Hunk[]
  from: number
  to: number
}

/** 把两侧的改动段按"打架"关系聚成簇（并查集；段数很小，O(n²) 足够且好读） */
function clusterHunks(local: Hunk[], external: Hunk[]): Cluster[] {
  const all: { h: Hunk; side: MergeSide }[] = [
    ...local.map((h): { h: Hunk; side: MergeSide } => ({ h, side: 'local' })),
    ...external.map((h): { h: Hunk; side: MergeSide } => ({ h, side: 'external' })),
  ]
  const parent = all.map((_, i) => i)
  const find = (i: number): number => {
    let k = i
    while (parent[k] !== k) {
      parent[k] = parent[parent[k]]
      k = parent[k]
    }
    return k
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (hunksClash(all[i].h, all[j].h)) {
        const a = find(i)
        const b = find(j)
        if (a !== b) parent[a] = b
      }
    }
  }
  const byRoot = new Map<number, Cluster>()
  all.forEach((item, i) => {
    const root = find(i)
    let cl = byRoot.get(root)
    if (!cl) {
      cl = { local: [], external: [], from: item.h.from, to: item.h.to }
      byRoot.set(root, cl)
    }
    cl[item.side].push(item.h)
    cl.from = Math.min(cl.from, item.h.from)
    cl.to = Math.max(cl.to, item.h.to)
  })
  return [...byRoot.values()].sort((a, b) => a.from - b.from || a.to - b.to)
}

/**
 * 某一侧在祖先行范围 `[from, to)` 里的**实际内容**：走过的祖先行照抄（这一侧没改它），
 * 被这一侧改动段覆盖的部分用段内容替换；纯插入段在这一刻把行插进来。
 */
function sideContent(baseLines: readonly string[], hunks: readonly Hunk[], from: number, to: number): string[] {
  const out: string[] = []
  let pos = from
  for (const h of [...hunks].sort((a, b) => a.from - b.from || a.to - b.to)) {
    for (; pos < h.from; pos++) out.push(baseLines[pos])
    out.push(...h.lines)
    pos = Math.max(pos, h.to)
  }
  for (; pos < to; pos++) out.push(baseLines[pos])
  return out
}

/** 两侧内容相同的行（上下文行） */
function sameRow(text: string, leftNo: number, rightNo: number): DiffRow {
  return { kind: 'same', leftNo, leftText: text, rightNo, rightText: text, leftInk: [], rightInk: [] }
}

/**
 * 把"本地版 / 外部版"两串行按行配对成两栏行（与 `diffTexts` 的收尾口径一致：
 * 先逐行配对成 `change`、多出来的算纯 `del` / 纯 `add`），行号分别按本地 / 外部计。
 */
function pairRows(
  localLines: readonly string[],
  externalLines: readonly string[],
  no: { left: number; right: number },
  degraded: boolean,
): DiffRow[] {
  const out: DiffRow[] = []
  const pairs = Math.min(localLines.length, externalLines.length)
  for (let k = 0; k < pairs; k++) {
    const ink: { left: InkSpan[]; right: InkSpan[] } = degraded
      ? { left: [], right: [] }
      : inlineDiff(localLines[k], externalLines[k])
    out.push({
      kind: 'change',
      leftNo: no.left++,
      leftText: localLines[k],
      rightNo: no.right++,
      rightText: externalLines[k],
      leftInk: ink.left,
      rightInk: ink.right,
    })
  }
  for (let k = pairs; k < localLines.length; k++) {
    out.push({ kind: 'del', leftNo: no.left++, leftText: localLines[k], rightNo: null, rightText: null, leftInk: [], rightInk: [] })
  }
  for (let k = pairs; k < externalLines.length; k++) {
    out.push({ kind: 'add', leftNo: null, leftText: null, rightNo: no.right++, rightText: externalLines[k], leftInk: [], rightInk: [] })
  }
  return out
}

/**
 * 二路模式（没有共同祖先）：块的粒度 = 两栏差异里的**连续改动段**，
 * 每一段都要用户点（默认「用左」＝以本地为底）。**不自动合**——没有祖先就分不清"谁改的"。
 */
function planTwoWay(local: string, external: string): MergePlan {
  const d = diffTexts(local, external)
  const blocks: MergeBlock[] = []
  const blockOfRow: (number | null)[] = d.rows.map(() => null)
  let i = 0
  while (i < d.rows.length) {
    if (d.rows[i].kind === 'same') {
      i++
      continue
    }
    const from = i
    const localLines: string[] = []
    const externalLines: string[] = []
    const index = blocks.length
    while (i < d.rows.length && d.rows[i].kind !== 'same') {
      const r = d.rows[i]
      if (r.leftText !== null) localLines.push(r.leftText)
      if (r.rightText !== null) externalLines.push(r.rightText)
      blockOfRow[i] = index
      i++
    }
    blocks.push({
      index,
      kind: 'manual',
      conflict: true, // 分不清谁改的 ⇒ 必须问（这也是 P1 与 P2 的分界）
      rowFrom: from,
      rowTo: i - 1,
      baseFrom: null,
      baseTo: null,
      localLines,
      externalLines,
      defaultChoice: 'local', // 口径③：以本地为底
    })
  }
  return {
    mode: 'two-way',
    rows: d.rows,
    blocks,
    blockOfRow,
    leftLines: d.leftLines,
    rightLines: d.rightLines,
    changeCount: blocks.length,
    conflicts: blocks.length,
    autoCount: 0,
    degraded: d.degraded,
  }
}

/**
 * 三路模式（有共同祖先）：块的粒度 = 以祖先为坐标的**改动簇**。
 * 只有一边改过的簇**自动合**（P2），两边改同一簇且结果不同才标 `conflict`。
 */
function planThreeWay(base: string, local: string, external: string): MergePlan {
  const baseLines = splitDiffLines(base)
  const a = hunksBetween(base, local)
  const b = hunksBetween(base, external)
  const clusters = clusterHunks(a.hunks, b.hunks)
  const degraded = a.degraded || b.degraded
  const rows: DiffRow[] = []
  const blockOfRow: (number | null)[] = []
  const blocks: MergeBlock[] = []
  const no = { left: 1, right: 1 }
  let pos = 0
  for (const cl of clusters) {
    // 簇之前的共同区：三份都一样 ⇒ 上下文行
    for (; pos < cl.from; pos++) {
      rows.push(sameRow(baseLines[pos], no.left++, no.right++))
      blockOfRow.push(null)
    }
    const localLines = sideContent(baseLines, cl.local, cl.from, cl.to)
    const externalLines = sideContent(baseLines, cl.external, cl.from, cl.to)
    const localChanged = cl.local.length > 0
    const extChanged = cl.external.length > 0
    const kind: MergeBlockKind = localChanged && extChanged ? 'both' : localChanged ? 'local-only' : 'external-only'
    // 两边改成了**同一样子**（例：都补了同一个记号）⇒ 没什么可决定的，当上下文行处理
    if (localChanged && extChanged && localLines.join('\n') === externalLines.join('\n')) {
      for (const line of localLines) {
        rows.push(sameRow(line, no.left++, no.right++))
        blockOfRow.push(null)
      }
      pos = Math.max(pos, cl.to)
      continue
    }
    const from = rows.length
    const pushed = pairRows(localLines, externalLines, no, degraded)
    // 两侧都是空（都删掉了同一段）⇒ 没有行可显示，也就没有可决定的东西 ⇒ 不进块表
    if (pushed.length === 0) {
      pos = Math.max(pos, cl.to)
      continue
    }
    rows.push(...pushed)
    const blockOfRowEnd = rows.length
    for (let k = from; k < blockOfRowEnd; k++) blockOfRow.push(blocks.length)
    blocks.push({
      index: blocks.length,
      kind,
      conflict: kind === 'both',
      rowFrom: from,
      rowTo: rows.length - 1,
      baseFrom: cl.from,
      baseTo: cl.to,
      localLines,
      externalLines,
      // 口径③：只有"外部一方改过"的块默认用外部；冲突与"只本地改过"都默认本地
      defaultChoice: kind === 'external-only' ? 'external' : 'local',
    })
    pos = Math.max(pos, cl.to)
  }
  for (; pos < baseLines.length; pos++) {
    rows.push(sameRow(baseLines[pos], no.left++, no.right++))
    blockOfRow.push(null)
  }
  const conflicts = blocks.filter((x) => x.conflict).length
  return {
    mode: 'three-way',
    rows,
    blocks,
    blockOfRow,
    leftLines: splitDiffLines(local).length,
    rightLines: splitDiffLines(external).length,
    changeCount: blocks.length,
    conflicts,
    autoCount: blocks.length - conflicts,
    degraded,
  }
}

/**
 * 算出"怎么合"（**纯函数**，逐例可断言）。
 *
 * `base` = 共同祖先的原文（`FileBaseline.text`）；**拿不到就传 `null`** ⇒ 自动退化为
 * 二路逐块采纳（P1）——能力不足时降级而不是报错，与 `docs/FILE-MODEL.md` 的总口径一致。
 */
export function planMerge(base: string | null, local: string, external: string): MergePlan {
  if (base === null) return planTwoWay(local, external)
  return planThreeWay(base, local, external)
}

/** 按计划与用户选择拼出合并文本（**以本地为底**：没选的地方用块自己的默认选择） */
export function applyMergePlan(plan: MergePlan, choices?: MergeChoices): string {
  const out: string[] = []
  let i = 0
  while (i < plan.rows.length) {
    const bi = plan.blockOfRow[i]
    if (bi === null) {
      const r = plan.rows[i]
      out.push(r.leftText ?? r.rightText ?? '')
      i++
      continue
    }
    const blk = plan.blocks[bi]
    const side = choices?.[bi] ?? blk.defaultChoice
    out.push(...(side === 'external' ? blk.externalLines : blk.localLines))
    i = blk.rowTo + 1 // 整块一次落地
  }
  return out.join('\n')
}

/**
 * 一步到位：算计划 + 应用选择 ⇒ 合并文本。
 *
 * 输出是**归一化口径**（LF、无行尾空白、无末尾空行）——与差异框"比较与展示"同一把尺子
 * （`textDiff.normalizeForDiff`）；回写文件时按这个文本写，不夹带 CRLF 之类的噪声。
 */
export function applyMerge(base: string | null, local: string, external: string, choices?: MergeChoices): string {
  return applyMergePlan(planMerge(base, local, external), choices)
}
