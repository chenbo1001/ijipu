import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UPDATE_CHECK_INTERVAL_MS, shouldPromptUpdate } from './pwa/swUpdate'
import { installAppHeight } from './pwa/appHeight'
import { useUiStore } from './store/uiStore'

// adj404：应用高度跟随可视视口——软键盘弹出时（浏览器/PWA/自建外壳）编辑区自动让位，
// 不再被键盘盖住（`.app { height: var(--app-h, 100dvh) }`，见 index.css）
installAppHeight()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// adj155：PWA——生产构建注册 service worker（支持安装为浏览器应用）。
// 仅生产注册：dev 下 Vite 热更新与 SW 缓存会互相干扰。
// Tauri（tauri://localhost 自定义协议）下注册会静默失败，不影响桌面端。
// adj379：部署新版后，新 SW 会立刻接管（sw.js 里 skipWaiting/claim），但**页面仍在跑旧
// bundle** —— 用户在 controllerchange 时提示「发现新版本，点击刷新」，避免"我明明部署了
// 新版却还是旧界面"的困惑；首次注册（此前无控制者）不算更新、不提示。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 快照：注册前页面是否已有 SW 控制者（决定这次接管是不是"更新"）
    const hadController = !!navigator.serviceWorker.controller
    navigator.serviceWorker
      // adj400：updateViaCache:'none' —— SW 脚本本身也绕开 HTTP 缓存，保证 reg.update() 每次
      // 都真的拿到线上最新 sw.js（配合 scripts/stamp-sw.mjs 给每个构建打指纹 → 一定能检出更新）
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (shouldPromptUpdate(hadController)) useUiStore.getState().setUpdateReady(true)
        })
        // SPA/PWA 可能长期不重载：定期 + 每次窗口重新获焦时主动检查是否有新版
        const check = () => {
          void reg.update().catch(() => {
            /* 离线/网络异常时忽略 */
          })
        }
        window.addEventListener('focus', check)
        window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
      })
      .catch(() => {
        /* 注册失败（如自定义协议/离线环境）静默忽略 */
      })
  })
}
