/**
 * preview/openUrl.ts — 打开**外部链接**（adj652，用户要求："链接文本自动转换为链接，点击即可打开链接"）
 *
 * 为什么不能只靠 SVG 里的 `<a target="_blank">`：
 *  - **浏览器 / PWA**：`target="_blank"` 本来就能开新页签，但我们要统一走"先 preventDefault 再自己开"，
 *    这样将来换实现（比如加个确认）只改这一处；
 *  - **桌面壳（Tauri v2 / WebView2）**：`window.open` 与 `target="_blank"` 默认**不保证**打开系统浏览器
 *    （WebView2 的 `NewWindowRequested` 由宿主决定，Tauri 默认不建新窗口）⇒ 必须走
 *    **opener 插件**：`window.__TAURI__.core.invoke('plugin:opener|open_url', { url })`
 *    （Rust 侧 `tauri-plugin-opener`，见 `src-tauri/Cargo.toml` 与 `capabilities/default.json`）。
 *
 * 兜底顺序：Tauri opener → `window.open`。两条都不成时**不静默失败**：控制台留一条 error，
 * 调用方（预览层）无需关心。
 */

/** 打开外部链接（http/https/mailto 等绝对地址） */
export async function openExternalUrl(url: string): Promise<void> {
  const target = url.trim()
  if (!target) return
  type TauriGlobal = { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } }
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
  if (tauri?.core?.invoke) {
    try {
      await tauri.core.invoke('plugin:opener|open_url', { url: target })
      return
    } catch {
      // 没装 opener 插件（或旧版本壳）→ 落到 window.open
    }
  }
  const win = window.open(target, '_blank', 'noopener,noreferrer')
  if (!win) console.error('[iJipu] 打开链接失败（可能被弹窗拦截）：', target)
}
