/**
 * brand/platform.ts — 运行环境判定（**单一出处**）
 *
 * adj628（用户报："Ctrl+N 新建 jps 文件后，状态栏显示的还是上一个文件名"）需要一条
 * "现在是桌面壳还是浏览器"的判据，因为**浏览器把 `Ctrl+N` 留给了自己**（开新窗口），
 * 页面根本收不到 keydown ⇒ 网页版必须换一个能拦下的键（见 `brand/shortcuts.ts` 的 `KBD.newDoc`）。
 *
 * 桌面壳由 Tauri 的 `withGlobalTauri: true` 注入 `window.__TAURI__`（与 `store/externalOpen.ts`
 * 原来的判定同源）。收敛到这里，避免"两处各判一次"以后漂移。
 */
export function isDesktopShell(): boolean {
  try {
    const g = (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__
    return !!(g && g.core && typeof g.core.invoke === 'function')
  } catch {
    return false
  }
}
