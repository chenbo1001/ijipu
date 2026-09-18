/**
 * ui/dock/ProblemPanel.tsx — dock 的「告警」面板（adj462，由 ui/ProblemsBar 拆来）
 *
 * 脚本不符合语法时在底部 dock 里显式给出可读提示：
 *  - 每条显示 `错误 · 第3行 第5列 · 消息`，**点击即跳到该位置**（复用 docStore.jumpCursor）；
 *  - adj462：**「正确写法」默认收起**，行首 ▶ 按钮按需展开（避免一次铺满、按需取信息）；
 *  - 面板整体展开/收起由面板头部的「收起/展开」控制；列表超高时自身滚动（不挤压编辑区）。
 *
 * 汇总逻辑为纯函数（`ui/problems.ts`），断言在 scripts/smoke.mts。
 */
import { useMemo, useState } from 'react'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { problemCopy, dockCopy } from '../../brand/copy'
import { offsetOf, summarizeProblems } from '../problems'

export function ProblemPanel() {
  const code = useDocStore((s) => s.code)
  const errors = useDocStore((s) => s.parseResult.errors)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const setModal = useUiStore((s) => s.openModal)
  // 面板整体默认展开（有告警时先让人看见）
  const [open, setOpen] = useState(true)
  // adj462：每条「正确写法」的展开态（默认全收起）；键用行/列/级别，与数组下标无关
  const [hintOpen, setHintOpen] = useState<Set<string>>(new Set())

  const summary = useMemo(() => summarizeProblems(errors), [errors])
  if (summary.total === 0) {
    return <div className="dock-empty">{dockCopy.noProblems}</div>
  }

  const isError = summary.worst === 'error'
  const title = problemCopy.title(summary.total, summary.errorCount, summary.warnCount)
  const toggleHint = (key: string) => {
    setHintOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className={`problem-panel is-${isError ? 'error' : 'warn'}`}>
      <div className="problems-head">
        <button
          type="button"
          className="problems-head-main"
          onClick={() => setOpen((v) => !v)}
          title={`${title}（点此${open ? problemCopy.collapse : problemCopy.expand}）`}
        >
          <span className="problems-icon" aria-hidden="true">
            {isError ? '✕' : '!'}
          </span>
          <span className="problems-title">{title}</span>
        </button>
        {/* adj394：直接跳到内置语法速查（每条还会按需给出具体规则与示例） */}
        <button type="button" className="problems-syntax" onClick={() => setModal('syntax')} title="打开内置语法速查">
          {problemCopy.syntaxHelp}
        </button>
        <button type="button" className="problems-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? problemCopy.collapse : problemCopy.expand}
        </button>
      </div>
      {open && (
        <ul className="problems-list">
          {summary.rows.map((r, i) => {
            const key = `${r.line}-${r.col}-${r.severity}-${i}`
            const expanded = hintOpen.has(key)
            return (
              <li key={key}>
                <div className="problem-line">
                  {/* adj462：行首展开按钮——只显示「告警」本身，正确写法按需展开 */}
                  {r.hint ? (
                    <button
                      type="button"
                      className={`problem-expand is-${r.severity}${expanded ? ' is-open' : ''}`}
                      onClick={() => toggleHint(key)}
                      title={expanded ? problemCopy.collapseHint : problemCopy.expandHint}
                      aria-expanded={expanded}
                    >
                      {/* adj512：统一用一个 `▸` 字符 + 旋转 90° 表示展开，告别"▸ 收起 / ▾ 展开"
                          两字符在不同字体下尺寸不一致（用户报"下方向三角太小了"）。同一个字符
                          旋转前后**等比放大**——视觉大小完全一致，只方向不同。 */}
                      <span className="problem-expand-glyph" aria-hidden="true">▸</span>
                    </button>
                  ) : (
                    <span className="problem-expand is-placeholder" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className={`problem-row is-${r.severity}`}
                    title={problemCopy.jumpHint}
                    onClick={() => jumpCursor(offsetOf(code, r.line, r.col))}
                  >
                    <span className="problem-tag">{r.label}</span>
                    <span className="problem-pos">
                      第{r.line}行 第{r.col}列
                    </span>
                    <span className="problem-msg">{r.message}</span>
                  </button>
                </div>
                {expanded && r.hint && (
                  <div className={`problem-hint is-${r.severity}`}>
                    <span className="problem-hint-label">{problemCopy.correctPrefix}</span>
                    {r.hint}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
