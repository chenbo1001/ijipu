/**
 * ui/ProblemsBar.tsx — 编辑区「问题提示条」（adj394）
 *
 * 脚本不符合语法时，在**编辑区内**显式给出可读提示（此前只有行号栏着色与悬停 tooltip）：
 *  - 有错误/告警时自动出现在编辑区底部：`✕ 2 个问题（1 个错误 / 1 个告警）`；
 *  - 默认展开，每条显示 `错误 · 第3行 第5列 · 消息`，**点击即跳到该位置**（复用 docStore.jumpCursor）；
 *  - adj394：每条下方再给出**正确语法规则**（引擎 `parseError.hint`，含最小示例）；
 *    标题行右侧提供「语法速查」入口（打开内置语法文档对话框）；
 *  - 可折叠（折叠后仅剩标题行，状态一眼可见）；列表超高时自身滚动（不挤压编辑区）；
 *  - 无问题时整条不渲染（不占编辑区空间）。
 *
 * 汇总逻辑为纯函数（`ui/problems.ts`），断言在 scripts/smoke.mts。
 */
import { useMemo, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { problemCopy } from '../brand/copy'
import { offsetOf, summarizeProblems } from './problems'

export function ProblemsBar() {
  const code = useDocStore((s) => s.code)
  const errors = useDocStore((s) => s.parseResult.errors)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const setModal = useUiStore((s) => s.openModal)
  const [open, setOpen] = useState(true)

  const summary = useMemo(() => summarizeProblems(errors), [errors])
  if (summary.total === 0) return null

  const isError = summary.worst === 'error'
  const title = problemCopy.title(summary.total, summary.errorCount, summary.warnCount)

  return (
    <div className={`problems-bar${isError ? ' is-error' : ' is-warn'}`} role="status" aria-live="polite">
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
        {/* adj394：直接跳到内置语法速查（每个问题还会在下方给出具体规则与示例） */}
        <button type="button" className="problems-syntax" onClick={() => setModal('syntax')} title="打开内置语法速查">
          {problemCopy.syntaxHelp}
        </button>
        <button type="button" className="problems-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? problemCopy.collapse : problemCopy.expand}
        </button>
      </div>
      {open && (
        <ul className="problems-list">
          {summary.rows.map((r, i) => (
            <li key={`${r.line}-${r.col}-${i}`}>
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
              {r.hint && (
                <div className={`problem-hint is-${r.severity}`}>
                  <span className="problem-hint-label">{problemCopy.correctPrefix}</span>
                  {r.hint}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
