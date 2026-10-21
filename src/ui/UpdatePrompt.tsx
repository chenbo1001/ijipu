/**
 * ui/UpdatePrompt.tsx — 「已更新，点击刷新」提示（adj379）
 *
 * PWA 部署新版后，新 Service Worker 会立刻接管页面，但页面仍在跑旧 bundle；
 * main.tsx 检测到接管（controllerchange）后把 uiStore.updateReady 置 true，由本组件提示。
 * 点击 = 刷新页面（拿到新代码）；点击后立即隐藏，避免刷新前重复点击。
 *
 * adj1013（用户要求）：位置与 toast 一致——**右上角、顶栏下方**（原先右下 `bottom: 88px`，
 * 宽屏时会压在编辑列底部的操作底栏 dock 上）。两者同处出现时，toast 自动让到它下面。
 */
import { uiCopy } from '../brand/copy'
import { useUiStore } from '../store/uiStore'

export function UpdatePrompt() {
  const updateReady = useUiStore((s) => s.updateReady)
  const setUpdateReady = useUiStore((s) => s.setUpdateReady)
  if (!updateReady) return null
  return (
    <button
      type="button"
      className="update-prompt"
      onClick={() => {
        setUpdateReady(false)
        window.location.reload()
      }}
    >
      {uiCopy.updateReady}
    </button>
  )
}
