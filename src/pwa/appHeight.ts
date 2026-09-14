/**
 * pwa/appHeight.ts — 应用高度跟随**可视视口**（adj404）
 *
 * 为什么需要：软键盘弹出时"窗口跟不跟着缩"取决于宿主，而各家不一致——
 *  - 浏览器（Chrome Android 标签页）：默认缩**布局视口**，`100vh/100dvh` 变小 ✓
 *  - 已安装 PWA（standalone）：默认只缩**视觉视口**（`resizes-visual`），布局视口不变 ✗
 *    → 键盘直接盖住编辑区下半部分（用户反馈"输入法占据了大部分编辑区"）。
 *    `interactive-widget=resizes-content`（adj403）本可纠正，但该声明只在较新内核生效，
 *    国产浏览器/自建 WebView 外壳往往不认。
 *  - 某些宿主还会自己再扣一次键盘高度 → 双重扣减（Obsidian 插件侧即此，见 plugins 的 adj404）。
 *
 * 做法：不猜宿主策略，**直接量** `visualViewport`（它在以上所有情况下都等于"真正看得见的区域"）：
 *   `--app-h` = `visualViewport.height`（缩放≠1 或不可用时回退窗口内高）
 *   → CSS：`.app { height: var(--app-h, 100dvh) }`。
 * 于是键盘弹出 → 可视区变小 → 应用高度跟着变小、编辑区自动让位；键盘收起 → 还原满屏。
 * 浏览器里该值本就等于视口高，等于无副作用。
 */

/** 计算应用高度（px）。纯函数，便于单测：仅当缩放为 1（未被双指放大）时采用可视视口 */
export function appHeightPx(vv: { height: number; scale: number } | null, winHeight: number): number {
  if (!vv || vv.scale !== 1) return Math.round(winHeight)
  return Math.round(vv.height)
}

/** 把可视高度写进 `documentElement` 的 CSS 变量 `--app-h`，并跟随键盘/地址栏变化 */
export function installAppHeight(): void {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  const apply = () => {
    root.style.setProperty('--app-h', `${appHeightPx(window.visualViewport, window.innerHeight)}px`)
  }
  apply()
  const vv = window.visualViewport
  if (vv) {
    // 键盘弹出/收起、地址栏收缩都会触发 resize；滚动时 offsetTop 变化也要重算
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
  }
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
}
