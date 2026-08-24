/**
 * ui/StatusBar.tsx — 状态栏
 */
import { useDocStore } from '../store/docStore'
import { brand } from '../brand/tokens'
import { APP_VERSION } from '../brand/version'

export function StatusBar() {
  const cursor = useDocStore((s) => s.cursor)
  const parseResult = useDocStore((s) => s.parseResult)
  const viewType = useDocStore((s) => s.viewType)
  const code = useDocStore((s) => s.code)

  const errors = parseResult.errors.filter((e) => e.severity === 'error').length
  const warnings = parseResult.errors.filter((e) => e.severity === 'warning').length
  const lines = code.split('\n').length
  // adj242：小圆点按严重程度着色——有错误红、仅警告橙、正常绿（以最严重为准）
  const dotClass = errors > 0 ? 'err' : warnings > 0 ? 'warn' : 'ok'

  return (
    <div className="statusbar">
      <span>
        行 {cursor.line}，列 {cursor.col + 1}
      </span>
      <span>共 {lines} 行</span>
      <span className={errors > 0 ? 'accent' : ''}>
        <span className={`dot ${dotClass}`} />
        {errors} 错误
      </span>
      {warnings > 0 && <span>{warnings} 警告</span>}
      <span className="right">
        <span>视图：{viewType}</span>
        <span className="accent">
          {brand.shortName} · v{APP_VERSION}
        </span>
        <span>{brand.taglineFooter}</span>
      </span>
    </div>
  )
}
