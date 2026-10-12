/**
 * brand/env.ts — 运行环境的单一判定（adj877）
 *
 * `window.__TAURI__` 的有无 = 是否跑在 **Tauri 桌面壳**里。这个判定在本项目里已有多处内联写法
 * （`src/main.tsx` 的 `isTauriDesktop`、`playback/samplerCache.ts`、`preview/openUrl.ts`）。
 *
 * 本次是**新增**第 4 个消费者（状态栏的「官网首页」要按端区分行为：网页版直接跳、
 * 桌面壳里没有"首页"这个概念 ⇒ 改为用系统浏览器打开官网），与其再复制一遍那段
 * `(window as any).__TAURI__?.core?.invoke` 的类型体操，不如给一个正规出处。
 *
 * ⚠ 上述三处**本次不动**（属成熟代码，无谓改动面越大越危险）；以后再有人要用这个判定，
 *   请把那三处一并改指这里，让口径真正收敛到一处。
 */

/** 是否运行在 Tauri 桌面壳里（`withGlobalTauri: true` 注入的全局对象是判据） */
export function isDesktopShell(): boolean {
  try {
    const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__
    return typeof tauri?.core?.invoke === 'function'
  } catch {
    // 极少数环境下访问 window 属性就会抛（跨源 iframe 等）——按"不是桌面壳"处理
    return false
  }
}
