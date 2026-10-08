import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { UPDATE_CHECK_INTERVAL_MS, shouldPromptUpdate } from './pwa/swUpdate'
import { installAppHeight } from './pwa/appHeight'

// adj404：应用高度跟随可视视口——软键盘弹出时（浏览器/PWA/自建外壳）编辑区自动让位，
// 不再被键盘盖住（`.app { height: var(--app-h, 100dvh) }`，见 index.css）
installAppHeight()

/**
 * adj724b（用户实测）：「嵌入版 iJipu 深浅主题设置没有记住」。
 *
 * 根因：这里原先**无条件**调 `setThemeMode(宿主主题)`——
 *  · 用户自己选过深/浅，每次启动都被盖掉；
 *  · 更糟的是 `setThemeMode` 会**写进存储** ⇒ 这个覆盖值被当成"用户的选择"持久化。
 *
 * 正确做法：**不碰用户的 `themeMode`**，而是把 Obsidian 的深浅当成"系统深浅"喂给
 * `setSystemLight()` —— 应用本来就有这个语义（`effectiveMode = themeMode === 'auto' ? systemLight : themeMode`）。
 * 于是：
 *  · 用户选「跟随系统（auto）」 ⇒ 跟随 Obsidian 的深浅（这正是"跟随 Obsidian 主题"该有的行为）；
 *  · 用户**显式**选了浅/深 ⇒ 那是他的选择，宿主不再覆盖它。
 *
 * 插件设置里关掉「跟随 Obsidian 主题」时（`followTheme === false`）**完全不动**应用的深浅相关状态。
 */
function applyHostTheme(
  ui: {
    getState: () => {
      setSystemLight?: (b: boolean) => void
      setThemeMode?: (m: 'dark' | 'light') => void
    }
  },
  bridge: { welcome: { theme: 'dark' | 'light'; followTheme?: boolean } },
  mode?: 'dark' | 'light',
): void {
  if (bridge.welcome.followTheme === false) return
  const dark = (mode ?? bridge.welcome.theme) === 'dark'
  ui.getState().setSystemLight?.(!dark)
}

/**
 * adj724b：**首屏前先完成"嵌入版握手 + 偏好预载"**。
 *
 * 为什么必须串行、且必须在**求值 store 模块之前**：
 *  · `uiStore` / `editorPrefs` 在**模块求值阶段**就读 `localStorage`
 *    （主题、缩放、拆分比例、音色库选择…）；而 store 模块由 `App.tsx` 的 import 链带进来
 *    ——只要 `App` 还是静态 import，就会在我们拿到宿主数据之前先跑一遍，
 *    于是那份"空快照"会被当成用户设置、还可能把默认值回写覆盖掉真值（用户实测 bug 的放大版）。
 *  · 所以：握手 → 预载 → **再**动态 import store 与 App → 渲染。真正嵌入时这只是本机
 *    回环的两次往返（毫秒级）；非嵌入（`window.parent === window`）时握手直接返回 `null`，零开销。
 */
void (async () => {
  let bridge: Awaited<ReturnType<typeof import('./store/hostBridge').initHostBridge>> = null
  try {
    const { initHostBridge } = await import('./store/hostBridge')
    bridge = await initHostBridge()
    if (bridge) {
      const { preloadEmbedStorage } = await import('./store/embedStorage')
      await preloadEmbedStorage()
    }
  } catch (e) {
    // 不是嵌入环境、或宿主不可用：照旧走 fsa/path 后端
    console.warn('[iJipu] 宿主桥初始化失败：', e)
  }

  // 存储就绪后才求值 store 模块（见上面的说明）
  await import('./store/uiStore')
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  if (!bridge) return
  try {
    const { setWorkspace, makeVaultWorkspaceRecord, isVaultWorkspace, getWorkspace } = await import('./store/workspace')
    const { useUiStore } = await import('./store/uiStore')
    const rec = makeVaultWorkspaceRecord(bridge.welcome.vaultName, bridge.welcome.root)
    // 已有同源工作区且是 vault 后端 ⇒ 不重复设置（避免刷掉用户当前所在目录）
    const cur = await getWorkspace()
    if (!(cur && isVaultWorkspace(cur))) await setWorkspace(rec)
    // 跟随 Obsidian 主题 ⇒ 把它的深浅喂给应用的 `systemLight`（走应用自己的 auto 语义）
    applyHostTheme(useUiStore, bridge)
    bridge.on({
      theme: (mode) => applyHostTheme(useUiStore, bridge, mode),
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
      /**
       * adj724b（用户口径 2026-10）：**检测 `.jps` 被外部修改**，并让用户选「重新载入 / 保留我的修改」。
       *
       * 关键点：**我们自己即时保存时 Obsidian 也会触发 modify**。所以这里必须**比对内容**——
       * 只有当"宿主读到的内容"与"应用手里的内容"不一致时，才是真的外部改动，才提示。
       * （每次自动保存后会多一次 `read` 往返，本地回环、毫秒级，可接受。）
       */
      fileChanged: (path) => {
        void (async () => {
          const segs = path.split('/').filter((s) => s !== '')
          if (segs.length === 0) return
          const { useDocStore } = await import('./store/docStore')
          const { readWorkspaceText, getWorkspace } = await import('./store/workspace')
          const { useUiStore } = await import('./store/uiStore')
          const st = useDocStore.getState()
          // 只关心"当前正在编辑的这个文件"
          const bind = st.binding
          if (!bind || bind.segs.join('/') !== segs.join('/')) return
          const ws = await getWorkspace()
          if (!ws) return
          let disk: string
          try {
            disk = await readWorkspaceText(ws, segs)
          } catch {
            return // 读不到（刚被删等）交给其它路径处理，这里不打扰
          }
          if (disk === st.code) {
            // 内容一致 ⇒ 是我们自己刚写的（或外部改动恰好相同）⇒ 不打扰
            return
          }
          const name = segs[segs.length - 1]
          useUiStore.getState().showAsk({
            text: `「${name}」已在 Obsidian 中被修改，是否重新载入？（重新载入会丢弃本地未保存的编辑）`,
            confirmLabel: '重新载入',
            cancelLabel: '保留我的修改',
            onConfirm: () => {
              // 用磁盘内容覆盖当前文档（仍走 store 的打开逻辑，历史会记一步，可撤销）
              void useDocStore.getState().openWorkspaceFile(segs)
            },
            onCancel: () => {
              // 保留本地：什么都不做。用户下次保存会用本地内容覆盖外部改动（提示里已说明）
              console.info('[iJipu] 保留本地修改，忽略外部改动')
            },
          })
        })()
      },
    })
    // 监听已就绪 ⇒ 告诉宿主可以下发"本页签要打开的文件"了
    bridge.signalReady()
    /**
     * **预热一次文库根目录**。
     *
     * 为什么需要：底栏默认是收起的（`dockOpen:false` / `dockPanel:'problems'`），
     * 而列目录只发生在"工作区面板被画出来"的时候 ⇒ 嵌入版刚打开时**一次桥调用都不会发生**，
     * 用户点开「工作区」才现拉（还会先闪一下空列表）。
     * 这里主动拉一次，既让文件树/整树搜索立刻可用，也给"桥是否真的通了"留下可验证的痕迹。
     *
     * 失败**不影响**其它功能（面板打开时会自己再拉一次），故只在控制台留痕。
     */
    void (async () => {
      const { readDirEntries } = await import('./store/workspace')
      await readDirEntries(rec, [])
    })().catch((e) => console.warn('[iJipu] 预热文库目录失败：', e))
    /**
     * 排错探针：把"嵌入版是否生效"的关键状态挂到 window 上。
     *
     * 嵌入版失败时的表现是"页面能开、但显示的不是文库"，而控制台里往往什么都看不到
     * （初始化在动态 import 里，宿主侧也无从观察）⇒ 留一个可读探针，
     * 供自动化冒烟与真机排错直接读取（`scripts/embed-smoke.mjs` 用的就是它）。
     */
    ;(window as unknown as { __ijipuDebug?: () => string }).__ijipuDebug = () =>
      JSON.stringify({
        vaultName: bridge.welcome.vaultName,
        root: bridge.welcome.root,
        calls: bridge.callCount,
        lastOps: bridge.recentOps.slice(-8),
        // adj724b：深浅相关的现场（排错"设置没记住"时必须能看到）
        themeMode: localStorage.getItem('ijipu.themeMode'),
        hostTheme: bridge.welcome.theme,
        followTheme: bridge.welcome.followTheme,
      })
  } catch (e) {
    // 忽略：不是嵌入环境（或宿主不可用）时，走原有的 fsa/path 后端。
    // 但**要留痕**：嵌入版初始化失败会表现为"打开了但显示的不是文库"，
    // 静默吞掉会让排错无从下手（冒烟脚本也靠这条日志定位）。
    console.warn('[iJipu] 嵌入版初始化失败：', e)
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
          if (!shouldPromptUpdate(hadController)) return
          /**
           * adj724b：**动态**导入而不是顶部静态导入——
           * 静态导入会让 `uiStore` 在"嵌入版偏好预载完成之前"就求值（读到空设置）。
           * 这条路径只在**网页版**触发，动态导入的额外一步可忽略。
           */
          void import('./store/uiStore').then((m) => m.useUiStore.getState().setUpdateReady(true))
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
