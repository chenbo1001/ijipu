/**
 * dialogs/FileDiffDialog.tsx — **两栏源码差异框 + 逐块采纳**（adj928，adj966f 加合并）
 *
 * 用户口径（2026-10，adj928 定、adj966f 续）：
 *  · 在"文件内容已在别处被改动"的提示上加一个「**查看差异**」按钮，打开**成熟的两栏源码差异**视图；
 *  · 左 = **本地**（正在编辑的这份），右 = **外部**（文件里的新内容）；
 *  · 差异算法**自己写、零新依赖**（见 `src/diff/textDiff.ts`）：行级 LCS 对齐 + **行内字符级高亮**；
 *  · 噪声（CRLF/LF、行尾空白、末尾换行）**不算改动**——只用于比较，绝不改用户内容；
 *  · 可读性：**带行号**、两栏**同步滚动**、默认**只显示改动处上下各 3 行** + 「展开全部」、
 *    顶部摘要（本地 N 行 / 外部 M 行、改动 K 处）；
 *  · 差异框里也能**直接做决定**（保留本地 / 载入外部 / 关闭回原提示）；
 *  · 手机端**上下两栏**（窄屏由 CSS 换成纵向）；复用 `ui/Modal` 与主题变量。
 *
 * ## adj966f（用户 2026-10-16 拍板的四条，见 `docs/FILE-MODEL.md` §9）
 *
 *  · 每个改动块给「**用左 / 用右**」（栏目标题已写明本地 / 外部），顶部「全用左 / 全用右」，
 *    底部「**应用（并保存）**」——应用后**立即写回文件**（口径④）；
 *  · 合并**以本地为底**（口径③）：没点过的块用它的默认选择，只有"外部一方改过"的块默认用外部；
 *  · **P1 块级采纳**（没有共同祖先时逐块问）与 **P2 自动三路合并**（有祖先时"互不重叠"的块自动合好）
 *    都由 `src/diff/merge.ts` 的 `planMerge` 给出块表 —— 本文件只负责画与收集选择；
 *  · **P3 不做**：行内字符级自动合并（同一行两边都改 = 一个"冲突块"，只标出来让人选）。
 *
 * 性能兜底：超长输入时 `planMerge` / `diffTexts` 会退化（只标改动区块、不做行内高亮），
 * 这里在摘要行里如实提示，**不许卡死**。
 */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { externalChangeCopy } from '../brand/copy'
import { applyMergePlan, planMerge, type MergeBlock, type MergePlan, type MergeSide } from '../diff/merge'
import { collapseDiffRows, type DiffBlock, type DiffRow, type InkSpan } from '../diff/textDiff'
import { useUiStore } from '../store/uiStore'
import { Modal } from '../ui/Modal'

/** 默认折叠上下文：改动处上下各 3 行（用户口径） */
const DEFAULT_CONTEXT = 3

/** 把一行按"行内高亮区间"切成若干片段（未命中的部分照常显示） */
function InkLine({ text, ink }: { text: string; ink: InkSpan[] }) {
  if (ink.length === 0) return <>{text}</>
  const parts: { s: string; hit: boolean }[] = []
  let cursor = 0
  for (const span of ink) {
    if (span.start > cursor) parts.push({ s: text.slice(cursor, span.start), hit: false })
    parts.push({ s: text.slice(span.start, span.end), hit: true })
    cursor = span.end
  }
  if (cursor < text.length) parts.push({ s: text.slice(cursor), hit: false })
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark className="diff-ink" key={i}>
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </>
  )
}

/**
 * 折叠视图下的一行"内容"：真行（`at >= 0`）或折叠提示（`at < 0`，值 = -(起始行号+1)）。
 * adj966f：`bar` 非空表示"这一项是第 `bar` 块的**操作条**"（用左 / 用右）。
 */
type PaneItem = { at: number; gap: number | null; bar: number | null }

/**
 * 把行表按"展开/折叠"摊成两栏共用的行序列（**两栏序列必须逐项一致**，同步滚动才对得上）。
 *
 * adj966f：每个块的**第一行**之前插一条 `bar` 项（两栏都渲染 ⇒ 高度一致、行不错位）。
 * 块的首行一定是"改动行"，而折叠视图永远保留改动行 ⇒ 不会出现"块的按钮被折掉"。
 */
function paneItems(rows: readonly DiffRow[], plan: MergePlan, blocks: readonly DiffBlock[], expanded: boolean): PaneItem[] {
  const out: PaneItem[] = []
  const pushRow = (at: number): void => {
    const b = plan.blockOfRow[at]
    if (b !== null && (at === 0 || plan.blockOfRow[at - 1] !== b)) out.push({ at, gap: null, bar: b })
    else out.push({ at, gap: null, bar: null })
  }
  if (expanded) {
    for (let i = 0; i < rows.length; i++) pushRow(i)
    return out
  }
  for (const b of blocks) {
    if (b.kind === 'gap') out.push({ at: b.from, gap: b.to - b.from + 1, bar: null })
    else for (let i = b.from; i <= b.to; i++) pushRow(i)
  }
  return out
}

/** 一栏（左或右）：行号 + 代码；另一侧没有对应行时留占位空行（**逐行对齐**靠这个） */
function DiffPane({
  title,
  side,
  rows,
  items,
  scrollRef,
  onScroll,
  renderBar,
}: {
  title: string
  side: 'left' | 'right'
  rows: readonly DiffRow[]
  items: PaneItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  /** 块操作条的内容（两栏用**同一个**节点：高度一致 ⇒ 行不错位） */
  renderBar: (blockIndex: number) => ReactNode
}) {
  return (
    <div className="file-diff-pane">
      <div className="file-diff-pane-head">{title}</div>
      <div className="file-diff-body" ref={scrollRef} onScroll={onScroll}>
        {items.map((it, seq) => {
          if (it.bar !== null) {
            return (
              <div className="diff-bar" key={`b${seq}`}>
                {renderBar(it.bar)}
              </div>
            )
          }
          if (it.gap !== null) {
            return (
              <div className="diff-line is-gap" key={`g${seq}`}>
                <span className="diff-no" />
                <span className="diff-code">{externalChangeCopy.collapsed(it.gap)}</span>
              </div>
            )
          }
          const row = rows[it.at]
          const no = side === 'left' ? row.leftNo : row.rightNo
          const text = side === 'left' ? row.leftText : row.rightText
          const ink = side === 'left' ? row.leftInk : row.rightInk
          return (
            <div className="diff-line" data-kind={row.kind} key={`r${seq}`}>
              <span className="diff-no">{no ?? ''}</span>
              <span className="diff-code">{text === null ? '' : <InkLine text={text} ink={ink} />}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 块的类别标签（冲突 / 只本地 / 只外部 / 二路）——文案集中在 `brand/copy.ts` */
function blockTag(b: MergeBlock): string {
  if (b.conflict) return externalChangeCopy.blockConflict
  if (b.kind === 'external-only') return externalChangeCopy.blockExternalOnly
  if (b.kind === 'local-only') return externalChangeCopy.blockLocalOnly
  return externalChangeCopy.blockManual
}

export function FileDiffDialog() {
  const diff = useUiStore((s) => s.fileDiff)
  const close = useUiStore((s) => s.closeFileDiff)
  const [expanded, setExpanded] = useState(false)
  /**
   * 逐块选择（**只记用户点过的块**；没点过的用块自己的默认选择 ⇒ "以本地为底"是默认行为）。
   * 换一次差异框（`diff` 变了）要重置，否则上一份文件的选择会串到这一份上。
   */
  const [choices, setChoices] = useState<{ key: unknown; map: Record<number, MergeSide> }>({ key: null, map: {} })
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  /** 同步滚动：把另一栏一起滚，用锁避免两边互相触发成环 */
  const lock = useRef(false)

  /** 计划（纯函数；`base` 为 null 时自动退化为二路逐块采纳） */
  const plan: MergePlan | null = useMemo(
    () => (diff ? planMerge(diff.base, diff.local, diff.external) : null),
    [diff],
  )
  // 换了一份差异 ⇒ 丢掉上一次的逐块选择（`key` 用 `diff` 对象本身，`uiStore` 每次都是新对象）
  const picked = choices.key === diff ? choices.map : {}
  const items = useMemo(
    () => (plan ? paneItems(plan.rows, plan, collapseDiffRows(plan.rows, DEFAULT_CONTEXT), expanded) : []),
    [plan, expanded],
  )
  if (!diff || !plan) return null

  const pick = (blockIndex: number, side: MergeSide): void =>
    setChoices({ key: diff, map: { ...picked, [blockIndex]: side } })
  const pickAll = (side: MergeSide): void => {
    const map: Record<number, MergeSide> = {}
    for (const b of plan.blocks) map[b.index] = side
    setChoices({ key: diff, map })
  }
  const sideOf = (b: MergeBlock): MergeSide => picked[b.index] ?? b.defaultChoice

  const syncScroll =
    (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => (): void => {
      if (lock.current) return
      const a = from.current
      const b = to.current
      if (!a || !b) return
      lock.current = true
      b.scrollTop = a.scrollTop
      lock.current = false
    }

  /** 块的操作条：类别 + 序号 + 「用左 / 用右」（当前选中项高亮） */
  const renderBar = (blockIndex: number): ReactNode => {
    const b = plan.blocks[blockIndex]
    const cur = sideOf(b)
    return (
      <>
        <span className={`diff-bar-tag${b.conflict ? ' is-conflict' : ''}`}>
          {externalChangeCopy.blockLabel(blockIndex + 1)} · {blockTag(b)}
        </span>
        <span className="diff-bar-actions">
          {(['local', 'external'] as const).map((side) => (
            <button
              type="button"
              className={`diff-bar-btn${cur === side ? ' is-on' : ''}`}
              key={side}
              onClick={() => pick(blockIndex, side)}
            >
              {side === 'local' ? externalChangeCopy.useLeft : externalChangeCopy.useRight}
            </button>
          ))}
        </span>
      </>
    )
  }

  return (
    <Modal title={externalChangeCopy.diffTitle(diff.name)} fill width="min(1100px, 96vw)" onClose={close}>
      <div className="file-diff">
        <div className="file-diff-summary">
          <span>{externalChangeCopy.summary(plan.leftLines, plan.rightLines, plan.changeCount)}</span>
          {plan.conflicts > 0 && (
            <span className="file-diff-warn">{externalChangeCopy.mergeConflicts(plan.conflicts)}</span>
          )}
          {plan.autoCount > 0 && <span>{externalChangeCopy.mergeAuto(plan.autoCount)}</span>}
          {plan.degraded && <span className="file-diff-warn">{externalChangeCopy.degradedHint}</span>}
          <span className="file-diff-foot-gap" />
          {/* adj966f：顶部批量选择（口径②的"全用左 / 全用右"） */}
          <button type="button" className="file-diff-toggle" onClick={() => pickAll('local')}>
            {externalChangeCopy.useAllLeft}
          </button>
          <button type="button" className="file-diff-toggle" onClick={() => pickAll('external')}>
            {externalChangeCopy.useAllRight}
          </button>
          <button
            type="button"
            className="file-diff-toggle"
            onClick={() => setExpanded((v) => !v)}
            disabled={plan.changeCount === 0}
          >
            {expanded ? externalChangeCopy.collapseToChanges : externalChangeCopy.expandAll}
          </button>
        </div>
        <div className="file-diff-panes">
          <DiffPane
            title={externalChangeCopy.leftTitle}
            side="left"
            rows={plan.rows}
            items={items}
            scrollRef={leftRef}
            onScroll={syncScroll(leftRef, rightRef)}
            renderBar={renderBar}
          />
          <DiffPane
            title={externalChangeCopy.rightTitle}
            side="right"
            rows={plan.rows}
            items={items}
            scrollRef={rightRef}
            onScroll={syncScroll(rightRef, leftRef)}
            renderBar={renderBar}
          />
        </div>
        <div className="file-diff-foot">
          <button type="button" className="btn" onClick={close}>
            {externalChangeCopy.closeDiff}
          </button>
          <span className="file-diff-foot-gap" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              close()
              diff.onKeepLocal()
            }}
          >
            {externalChangeCopy.keepLocal}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              close()
              diff.onLoadExternal()
            }}
          >
            {externalChangeCopy.loadExternal}
          </button>
          {/* adj966f（口径④）：应用 = 写回文件 + 立刻保存（一步历史，可撤销） */}
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const merged = applyMergePlan(plan, picked)
              close()
              diff.onApplyMerge(merged)
            }}
          >
            {externalChangeCopy.applyMerge}
          </button>
        </div>
      </div>
    </Modal>
  )
}
