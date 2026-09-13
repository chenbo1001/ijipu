/**
 * ui/EditorFootBar.tsx — 底部状态栏（精简版）
 *
 * adj281 之后：原本的「设置组」（折行 / 字体 / 字号）已移到顶栏工具条的「设置组」中，
 * 状态栏只保留「文件名 / 当前行列（行, 列/总行数）」与未保存标记。
 * adj394：新增语法状态小圆点（绿=通过 / 橙=仅告警 / 红=有错误），悬停显示问题条数与说明；
 * 具体的错误/告警文字由编辑区底部的 ProblemsBar 展示（此处只作状态指示，避免重复占位）。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'
import { problemCopy } from '../brand/copy'
import { summarizeProblems } from './problems'

export function EditorFootBar() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const cursor = useDocStore((s) => s.cursor)
  const errors = useDocStore((s) => s.parseResult.errors)

  const totalLines = useMemo(() => code.split('\n').length, [code])
  const problems = useMemo(() => summarizeProblems(errors), [errors])
  const dotCls = problems.worst === 'error' ? 'err' : problems.worst === 'warning' ? 'warn' : 'ok'
  const dotTitle =
    problems.total === 0
      ? problemCopy.clean
      : `${problems.worst === 'error' ? problemCopy.hasErrors : problemCopy.hasWarnings}：${problemCopy.title(problems.total, problems.errorCount, problems.warnCount)}`

  return (
    <div className="footer">
      <span className="footer-file">
        {(fileName || '未命名') + '.jps'}
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
      </span>

      <span className="footer-cursor">
        行{cursor.line},列{cursor.col + 1}/共{totalLines}行
      </span>

      {/* adj394：语法状态指示（绿/橙/红），明细见编辑区底部问题条 */}
      <span className="footer-cursor footer-problems" title={dotTitle}>
        <span className={`dot ${dotCls}`} />
        {problems.total === 0 ? problemCopy.clean : problemCopy.title(problems.total, problems.errorCount, problems.warnCount)}
      </span>

      <div className="footer-spacer" />
    </div>
  )
}
