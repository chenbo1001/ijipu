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

/**
 * adj724b：**嵌入版启动**——先试握手（`http://127.0.0.1` 的宿主桥）。
 *
 * 成功 ⇒ 以 Obsidian **文库为工作区**：不弹"选文件夹"、不需要文件系统授权，
 * 文件树的根就是文库（或设置里的子目录）。
 * 失败（普通浏览器/桌面壳/独立页签，3 秒超时）⇒ 什么都不做，一切照旧。
 *
 * 放在 `createRoot` **之后**、且不 `await`：握手失败也不该拖慢首屏。
 */
void (async () => {
  try {
    const { initHostBridge } = await import('./store/hostBridge')
    const bridge = await initHostBridge()
    if (!bridge) return
    const { setWorkspace, makeVaultWorkspaceRecord, isVaultWorkspace, getWorkspace } = await import('./store/workspace')
    const { useUiStore } = await import('./store/uiStore')
    const rec = makeVaultWorkspaceRecord(bridge.welcome.vaultName, bridge.welcome.root)
    // 已有同源工作区且是 vault 后端 ⇒ 不重复设置（避免刷掉用户当前所在目录）
    const cur = await getWorkspace()
    if (!(cur && isVaultWorkspace(cur))) await setWorkspace(rec)
    // 跟随 Obsidian 主题
    useUiStore.getState().setThemeMode?.(bridge.welcome.theme)
    bridge.on({
      theme: (mode) => useUiStore.getState().setThemeMode?.(mode),
      /**
       * 宿主推来"要打开的文件"（双击 `.jps` 时）。
       *
       * 传的是**工作区相对路径**（宿主已按工作区根换算好）⇒ 直接切段交给
       * `openWorkspaceFile`（它收 `string[]`，相对当前工作区根）。
       */
      openFile: (path) => {
        void (async () => {
          const { useDocStore } = await import('./store/docStore')
          const segs = path.split('/').filter((s) => s !== '')
          if (segs.length === 0) return
          await useDocStore.getState().openWorkspaceFile(segs)
        })()
      },
    })
    // 监听已就绪 ⇒ 告诉宿主可以下发"本页签要打开的文件"了
    bridge.signalReady()
  } catch {
    /* 忽略：不是嵌入环境（或宿主不可用）时，走原有的 fsa/path 后端 */
  }
})()

/**
 * adj443：是否运行在 **Tauri 桌面端**（`window.__TAURI__` 由 `withGlobalTauri` 注入）。
 * 与 `playback/samplerCache.ts` 的判定同源。
 */
function isTauriDesktop(): boolean {
  try {
    return typeof (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__?.core?.invoke === 'function'
  } catch {
    return false
  }
}

/**
 * adj443：**桌面端绝不注册 Service Worker，并主动注销 + 清缓存**。
 *
 * 问题（用户报）：PC 版重新安装后打开还是**旧界面**，要按 Ctrl+R 才更新 —— 普通用户会以为"没更新"。
 *
 * 根因：Tauri v2 在 Windows 用 `http(s)://tauri.localhost`，**是安全上下文、SW 能正常注册**
 * （原注释以为"自定义协议下注册会静默失败"，与实际不符）。于是重装后磁盘上虽是新 bundle，
 * **SW 仍从 Cache Storage 返回旧的 index.html / JS / CSS** ⇒ 界面停在旧版。
 *
 * 为什么桌面端不需要 SW：PWA 的离线能力是为**网页版**服务的；桌面端资源已随安装包落盘
 * （`tauri://localhost` 下本地读取），SW 只会带来"装了新版还显示旧界面"的陈旧缓存。
 *
 * 处理：① 桌面端**不注册**；② 若此前版本已注册过（老用户），**主动 unregister + 清空
 * cacheStorage + 重载一次**，把被污染的缓存一次性摘掉（否则老用户仍然看到旧界面）。
 */
/**
 * adj724b：是否运行在**宿主 iframe** 里（Obsidian 嵌入版 / 其它宿主嵌入）。
 *
 * 用途：iframe 里**不注册 Service Worker**——SW 的作用域是 origin（嵌入版是
 * `http://127.0.0.1:<port>`），而那个服务只为本次会话提供单文件页面，
 * 完全没有 `/sw.js`；更糟的是 SW 会跨会话存活，可能在下次打开时把页面搞坏。
 * PWA 的离线能力只对**独立网页版**有意义。
 */
function isEmbeddedFrame(): boolean {
  try {
    return window.parent !== window
  } catch {
    return true // 跨源访问 parent 抛错 ⇒ 一定在 iframe 里
  }
}

if (import.meta.env.PROD && 'serviceWorker' in navigator && !isEmbeddedFrame()) {
  if (isTauriDesktop()) {
    // 老版本可能已注册过 SW：注销 + 清缓存 + 重载一次（仅在确有注册/缓存时重载，避免每次启动都刷新）
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        const names = 'caches' in window ? await caches.keys() : []
        if (regs.length === 0 && names.length === 0) return
        await Promise.all(regs.map((r) => r.unregister()))
        await Promise.all(names.map((n) => caches.delete(n)))
        // 只重载一次：用 sessionStorage 标记，避免"注销失败→无限刷新"
        if (sessionStorage.getItem('ijipu.swPurged') !== '1') {
          sessionStorage.setItem('ijipu.swPurged', '1')
          window.location.reload()
        }
      } catch {
        /* 忽略：注销失败也不影响本次会话（下次启动再试） */
      }
    })()
  } else {
    // 网页版 / PWA：注册 SW 以获得离线能力 + 新版接管提示
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
}
