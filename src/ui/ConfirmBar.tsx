/**
 * ui/ConfirmBar.tsx — 顶部**确认条**（adj724b）
 *
 * 应用里第一个需要**用户二选一**的提示：既有的 `Toast` 是自动消失的通知，不能承担这个语义。
 *
 * 首个用途：嵌入版运行时，若当前打开的 `.jps` 被 Obsidian 那边（或同步软件）**外部修改**，
 * 就问一句「xx 已被修改，是否重新载入」——载入会丢掉本地未落盘的编辑，所以必须显式确认。
 *
 * 无待确认项时不渲染任何元素。
 */
import { useUiStore } from '../store/uiStore'

export function ConfirmBar() {
  const ask = useUiStore((s) => s.ask)
  const clearAsk = useUiStore((s) => s.clearAsk)

  if (!ask) return null
  return (
    <div className="confirm-bar" role="alertdialog" aria-live="polite">
      <span className="confirm-bar-text">{ask.text}</span>
      <span className="confirm-bar-actions">
        <button
          type="button"
          className="confirm-bar-btn is-primary"
          onClick={() => {
            // 先关掉再执行动作：动作里可能会再弹一条确认
            clearAsk()
            ask.onConfirm()
          }}
        >
          {ask.confirmLabel}
        </button>
        <button
          type="button"
          className="confirm-bar-btn"
          onClick={() => {
            clearAsk()
            ask.onCancel()
          }}
        >
          {ask.cancelLabel}
        </button>
      </span>
    </div>
  )
}
