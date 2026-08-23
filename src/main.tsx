import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// adj155：PWA——生产构建注册 service worker（支持安装为浏览器应用）。
// 仅生产注册：dev 下 Vite 热更新与 SW 缓存会互相干扰。
// Tauri（tauri://localhost 自定义协议）下注册会静默失败，不影响桌面端。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败（如自定义协议/离线环境）静默忽略 */
    })
  })
}
