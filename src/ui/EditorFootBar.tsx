/**
 * ui/EditorFootBar.tsx — 底部状态栏（精简版）
 *
 * adj281 之后：原本的「设置组」（折行 / 字体 / 字号）已移到顶栏工具条的「设置组」中，
 * 状态栏只保留「文件名 / 当前行列（行, 列/总行数）」与未保存标记。
 * adj394：新增语法状态小圆点（绿=通过 / 橙=仅告警 / 红=有错误），悬停显示问题条数与说明。
 * adj462：告警文本**同时是底部 dock「告警面板」的开关**（点击展开/收起——入口保持原位）；
 *         并在右侧给出**导出进行中的动态指示**（切走/关掉 dock 也看得到，点击可跳回导出面板）。
 * adj877（用户要求「要有返回首页的链接点」）：右侧加「官网首页」——
 *         从首页点「打开应用」进来之后，应用自己的界面里原本**没有任何回官网的路**。
 *         网页版/PWA 直接跳 `/`；桌面壳里没有"首页"这回事（窗口无地址栏、无后退），
 *         跳过去会把人困在介绍页 ⇒ 那里改成**用系统浏览器打开官网**。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { problemCopy, dockCopy } from '../brand/copy'
import { summarizeProblems } from './problems'
// adj618（用户要求）：状态栏那条告警按钮的提示后面带快捷键（键名一处定义）
import { KBD, withKbd } from '../brand/shortcuts'
// adj622（用户要求）：状态栏文件名改成「工作区/路径/文件名」格式
import { formatDocLocation } from './docLocation'
// adj877：回官网首页的入口 + adj879：与菜单里那个入口**共用同一实现**（用户要求表现一致）
import { goSiteHome } from '../brand/siteHome'

export function EditorFootBar() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const cursor = useDocStore((s) => s.cursor)
  const errors = useDocStore((s) => s.parseResult.errors)
  // adj622：状态栏展示「工作区/路径/文件名」需要拿三处来源（互斥）
  const binding = useDocStore((s) => s.binding)
  const nativePath = useDocStore((s) => s.nativePath)
  const fileHandle = useDocStore((s) => s.fileHandle)
  // adj462：dock（告警面板开关 + 导出指示）
  const toggleDock = useUiStore((s) => s.toggleDock)
  const dockOpen = useUiStore((s) => s.dockOpen)
  const dockPanel = useUiStore((s) => s.dockPanel)
  const exportJob = useUiStore((s) => s.exportJob)
  const setDockPanel = useUiStore((s) => s.setDockPanel)

  const totalLines = useMemo(() => code.split('\n').length, [code])
  const problems = useMemo(() => summarizeProblems(errors), [errors])
  const dotCls = problems.worst === 'error' ? 'err' : problems.worst === 'warning' ? 'warn' : 'ok'
  // adj622d（用户口径"直接输出 n告警..."）：状态栏告警文本去"个"、整体更紧凑，与上面 [i,j/k] 一致的紧凑口径；
  // ProblemPanel 头部仍走 problemCopy.title() 的完整形式（"X 个问题（Y 个错误 / Z 个告警）"），
  // dock 面板里需要看得清不嫌长，状态栏里嫌占行宽。
  const problemsBadge =
    problems.total === 0
      ? problemCopy.clean
      : (() => {
          const parts: string[] = []
          if (problems.errorCount > 0) parts.push(`${problems.errorCount}错误`)
          if (problems.warnCount > 0) parts.push(`${problems.warnCount}告警`)
          // 一个等级时只输出那一档本身（`parts[0]` 已经含数字，如「5告警」「3错误」）——
          // 不能再前缀 `${problems.total}`，否则总数与档数相同会渲染成「55告警」（真机实测踩到）
          return parts.length === 1
            ? parts[0]
            : `${problems.total}问题 (${parts.join('/')})`
        })()
  // hover/title 仍走完整形式（保留可读性，便于调试 / 解释"那个 5 是什么意思"）
  const dotTitle =
    problems.total === 0
      ? problemCopy.clean
      : `${problems.worst === 'error' ? problemCopy.hasErrors : problemCopy.hasWarnings}：${problemCopy.title(problems.total, problems.errorCount, problems.warnCount)}`
  const problemsShown = dockOpen && dockPanel === 'problems'
  // adj622：状态栏文件名按"工作区绑定 / 桌面外部打开 / 浏览器本地句柄"三种来源渲染
  const docLoc = useMemo(
    () => formatDocLocation({ binding, nativePath, fileHandle, fileName }),
    [binding, nativePath, fileHandle, fileName],
  )

  return (
    <div className="footer">
      <span className="footer-file" title={docLoc.title}>
        {docLoc.display}
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
      </span>

      {/* adj622c（用户口径）：状态栏行/列/总行数从「行5,列10/共123行」改成 `[5,10/123]` 紧凑形式。
          仍走 docStore 的 cursor.line / cursor.col+1 / totalLines 三个数，语义不变；
          hover/focus 在 title 上保留「行 X / 列 Y / 共 Z 行」可读形式（status bar 没法放 hover，
          但浏览器可读 select 到的「行/列」本身是 1 基，等价）。 */}
      <span className="footer-cursor" title={`行 ${cursor.line} / 列 ${cursor.col + 1} / 共 ${totalLines} 行`}>
        [{cursor.line},{cursor.col + 1}/{totalLines}]
      </span>

      {/* adj394/adj462：语法状态指示——本身也是「告警面板」的开关（点击展开/收起 dock） */}
      <button
        type="button"
        className={`footer-cursor footer-problems${problemsShown ? ' is-active' : ''}`}
        title={withKbd(`${dotTitle}（点击${problemsShown ? '收起' : '展开'}底部告警）`, KBD.problems)}
        onClick={() => toggleDock('problems')}
      >
        <span className={`dot ${dotCls}`} />
        {problemsBadge}
      </button>

      <div className="footer-spacer" />

      {/* adj877（用户要求）：回官网首页的入口；adj879：与菜单里的那个共用 `goSiteHome()` */}
      <a
        className="footer-site"
        href="/"
        title="回到爱记谱官网首页"
        onClick={(e) => {
          // 保留 `href`（无 JS 也能用、中键可以开新标签），点击时统一走共用实现：
          // 网页版 = 本窗口返回；桌面壳 = 交系统浏览器（见 brand/siteHome.ts）
          e.preventDefault()
          goSiteHome()
        }}
      >
        官网首页 ↗
      </a>

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
