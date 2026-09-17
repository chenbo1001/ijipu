/**
 * ui/EditorFootBar.tsx — 底部状态栏（精简版）
 *
 * adj281 之后：原本的「设置组」（折行 / 字体 / 字号）已移到顶栏工具条的「设置组」中，
 * 状态栏只保留「文件名 / 当前行列（行, 列/总行数）」与未保存标记。
 * adj394：新增语法状态小圆点（绿=通过 / 橙=仅告警 / 红=有错误），悬停显示问题条数与说明。
 * adj462：告警文本**同时是底部 dock「告警面板」的开关**（点击展开/收起——入口保持原位）；
 *         并在右侧给出**导出进行中的动态指示**（切走/关掉 dock 也看得到，点击可跳回导出面板）。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { problemCopy, dockCopy } from '../brand/copy'
import { summarizeProblems } from './problems'

export function EditorFootBar() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const cursor = useDocStore((s) => s.cursor)
  const errors = useDocStore((s) => s.parseResult.errors)
  // adj462：dock（告警面板开关 + 导出指示）
  const toggleDock = useUiStore((s) => s.toggleDock)
  const dockOpen = useUiStore((s) => s.dockOpen)
  const dockPanel = useUiStore((s) => s.dockPanel)
  const exportJob = useUiStore((s) => s.exportJob)
  const setDockPanel = useUiStore((s) => s.setDockPanel)

  const totalLines = useMemo(() => code.split('\n').length, [code])
  const problems = useMemo(() => summarizeProblems(errors), [errors])
  const dotCls = problems.worst === 'error' ? 'err' : problems.worst === 'warning' ? 'warn' : 'ok'
  const dotTitle =
    problems.total === 0
      ? problemCopy.clean
      : `${problems.worst === 'error' ? problemCopy.hasErrors : problemCopy.hasWarnings}：${problemCopy.title(problems.total, problems.errorCount, problems.warnCount)}`
  const problemsShown = dockOpen && dockPanel === 'problems'

  return (
    <div className="footer">
      <span className="footer-file">
        {(fileName || '未命名') + '.jps'}
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
      </span>

      <span className="footer-cursor">
        行{cursor.line},列{cursor.col + 1}/共{totalLines}行
      </span>

      {/* adj394/adj462：语法状态指示——本身也是「告警面板」的开关（点击展开/收起 dock） */}
      <button
        type="button"
        className={`footer-cursor footer-problems${problemsShown ? ' is-active' : ''}`}
        title={`${dotTitle}（点击${problemsShown ? '收起' : '展开'}底部告警）`}
        onClick={() => toggleDock('problems')}
      >
        <span className={`dot ${dotCls}`} />
        {problems.total === 0 ? problemCopy.clean : problemCopy.title(problems.total, problems.errorCount, problems.warnCount)}
      </button>

      <div className="footer-spacer" />

      {/* adj462：导出进行中的动态指示（无任务时不渲染）；点击跳回导出面板 */}
      {exportJob !== null && (
        <button
          type="button"
          className="footer-export"
          title={dockCopy.exportRunningHint}
          onClick={() => setDockPanel('export')}
        >
          <span className="footer-export-spinner" aria-hidden="true" />
          {dockCopy.exportRunning(exportJob)}
        </button>
      )}
    </div>
  )
}
