/**
 * ui/ConfirmBar.tsx — 顶部**确认条**（adj724b）
 *
 * 应用里第一个需要**用户二选一**的提示：既有的 `Toast` 是自动消失的通知，不能承担这个语义。
 *
 * 首个用途：嵌入版运行时，若当前打开的 `.jps` 被别处（Obsidian 编辑器、Sync 同步）**改了内容**，
 * 就问一句「是否载入外部」——载入会丢掉本地未落盘的编辑，所以必须显式确认。
 * adj927 起判据是"**内容真的变了**"（见 `store/externalChange.ts`），文案也不再笼统说"外部变更"。
 *
 * adj928（用户要求）：这一条上再给一个「查看差异」——打开**两栏源码差异框**
 * （左 = 本地正在编辑的、右 = 文件里的新内容），让用户看清差异再决定；点它**不关闭**本确认条
 * （差异框里也能直接做决定，关掉差异框就回到这里）。
 *
 * 无待确认项时不渲染任何元素。
 */
import { externalChangeCopy } from '../brand/copy'
import { useUiStore } from '../store/uiStore'

export function ConfirmBar() {
  const ask = useUiStore((s) => s.ask)
  const clearAsk = useUiStore((s) => s.clearAsk)

  if (!ask) return null
  const diff = ask.diff
  /** 两个决定（保留本地 / 载入外部）共用的收尾：先关确认条与差异框，再执行动作 */
  const decide = (fn: () => void) => {
    clearAsk()
    useUiStore.getState().closeFileDiff()
    fn()
  }
  return (
    <div className="confirm-bar" role="alertdialog" aria-live="polite">
      <span className="confirm-bar-text">{ask.text}</span>
      <span className="confirm-bar-actions">
        {diff && (
          <button
            type="button"
            className="confirm-bar-btn"
            onClick={() => {
              // 本地内容**这时才取**：用户可能一直在编辑（取事件那一刻的快照会过时）
              useUiStore.getState().showFileDiff({
                name: diff.name,
                local: diff.localText(),
                external: diff.externalText,
                onKeepLocal: () => decide(ask.onCancel),
                onLoadExternal: () => decide(ask.onConfirm),
              })
            }}
          >
            {externalChangeCopy.viewDiff}
          </button>
        )}
        <button type="button" className="confirm-bar-btn is-primary" onClick={() => decide(ask.onConfirm)}>
          {ask.confirmLabel}
        </button>
        <button type="button" className="confirm-bar-btn" onClick={() => decide(ask.onCancel)}>
          {ask.cancelLabel}
        </button>
      </span>
    </div>
  )
}
