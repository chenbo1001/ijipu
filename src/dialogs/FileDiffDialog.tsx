/**
 * dialogs/FileDiffDialog.tsx — **两栏源码差异框**（adj928，用户要求）
 *
 * 用户口径（2026-10）：
 *  · 在"文件内容已在别处被改动"的提示上加一个「**查看差异**」按钮，打开**成熟的两栏源码差异**视图；
 *  · 左 = **本地**（正在编辑的这份），右 = **外部**（文件里的新内容）；
 *  · 差异算法**自己写、零新依赖**（见 `src/diff/textDiff.ts`）：行级 LCS 对齐 + **行内字符级高亮**；
 *  · 噪声（CRLF/LF、行尾空白、末尾换行）**不算改动**——只用于比较，绝不改用户内容；
 *  · 可读性：**带行号**、两栏**同步滚动**、默认**只显示改动处上下各 3 行** + 「展开全部」、
 *    顶部摘要（本地 N 行 / 外部 M 行、改动 K 处）；
 *  · 差异框里也能**直接做决定**（保留本地 / 载入外部 / 关闭回原提示）；
 *  · 手机端**上下两栏**（窄屏由 CSS 换成纵向）；复用 `ui/Modal` 与主题变量。
 *
 * 性能兜底：超长输入时 `diffTexts` 会退化（只标改动区块、不做行内高亮），
 * 这里在摘要行里如实提示，**不许卡死**。
 */
import { useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { externalChangeCopy } from '../brand/copy'
import { collapseDiffRows, diffTexts, type DiffBlock, type DiffRow, type InkSpan } from '../diff/textDiff'
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

/** 折叠视图下的一行"内容"：真行（`at >= 0`）或折叠提示（`at < 0`，值 = -(起始行号+1)） */
type PaneItem = { at: number; gap: number | null }

/** 把行表按"展开/折叠"摊成两栏共用的行序列（**两栏序列必须逐项一致**，同步滚动才对得上） */
function paneItems(rows: readonly DiffRow[], blocks: readonly DiffBlock[], expanded: boolean): PaneItem[] {
  if (expanded) return rows.map((_, i) => ({ at: i, gap: null }))
  const out: PaneItem[] = []
  for (const b of blocks) {
    if (b.kind === 'gap') out.push({ at: b.from, gap: b.to - b.from + 1 })
    else for (let i = b.from; i <= b.to; i++) out.push({ at: i, gap: null })
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
}: {
  title: string
  side: 'left' | 'right'
  rows: readonly DiffRow[]
  items: PaneItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
}) {
  return (
    <div className="file-diff-pane">
      <div className="file-diff-pane-head">{title}</div>
      <div className="file-diff-body" ref={scrollRef} onScroll={onScroll}>
        {items.map((it, seq) => {
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

export function FileDiffDialog() {
  const diff = useUiStore((s) => s.fileDiff)
  const close = useUiStore((s) => s.closeFileDiff)
  const [expanded, setExpanded] = useState(false)
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  /** 同步滚动：把另一栏一起滚，用锁避免两边互相触发成环 */
  const lock = useRef(false)

  const result = useMemo(() => (diff ? diffTexts(diff.local, diff.external) : null), [diff])
  const items = useMemo(
    () => (result ? paneItems(result.rows, collapseDiffRows(result.rows, DEFAULT_CONTEXT), expanded) : []),
    [result, expanded],
  )
  if (!diff || !result) return null

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

  return (
    <Modal title={externalChangeCopy.diffTitle(diff.name)} fill width="min(1100px, 96vw)" onClose={close}>
      <div className="file-diff">
        <div className="file-diff-summary">
          <span>{externalChangeCopy.summary(result.leftLines, result.rightLines, result.changeCount)}</span>
          {result.degraded && <span className="file-diff-warn">{externalChangeCopy.degradedHint}</span>}
          <button
            type="button"
            className="file-diff-toggle"
            onClick={() => setExpanded((v) => !v)}
            disabled={result.changeCount === 0}
          >
            {expanded ? externalChangeCopy.collapseToChanges : externalChangeCopy.expandAll}
          </button>
        </div>
        <div className="file-diff-panes">
          <DiffPane
            title={externalChangeCopy.leftTitle}
            side="left"
            rows={result.rows}
            items={items}
            scrollRef={leftRef}
            onScroll={syncScroll(leftRef, rightRef)}
          />
          <DiffPane
            title={externalChangeCopy.rightTitle}
            side="right"
            rows={result.rows}
            items={items}
            scrollRef={rightRef}
            onScroll={syncScroll(rightRef, leftRef)}
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
            className="btn primary"
            onClick={() => {
              close()
              diff.onLoadExternal()
            }}
          >
            {externalChangeCopy.loadExternal}
          </button>
        </div>
      </div>
    </Modal>
  )
}
