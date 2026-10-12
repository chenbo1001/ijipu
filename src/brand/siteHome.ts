/**
 * brand/siteHome.ts — 「回官网首页」的**单一实现**（adj879）
 *
 * 由来（用户实测）：应用里原本有两个回官网的入口，行为却不一样——
 *   · 帮助菜单的「爱记谱官网」走 `openExternalUrl`（**新标签 / 系统浏览器**）；
 *   · 状态栏的「官网首页」走 `<a href="/">`（**本窗口返回**）。
 * 用户口径：**统一成本窗口返回**。
 *
 * 于是收敛到这里一处：两个入口都调 `goSiteHome()`，行为不可能再不一致。
 *
 * ## 桌面壳那条例外（不是"不一致"，而是同一语义在另一种宿主里的正确落地）
 *
 * 桌面壳（Tauri）里**没有"本窗口返回"这回事**：窗口没有地址栏、也没有后退键，
 * 把应用窗口导航到介绍页会把人困在那儿（只能关掉重开窗口）。
 * 所以那里仍然用系统浏览器打开官网 —— 用户点完之后，应用窗口原样还在。
 */
import { brand } from './tokens'
import { isDesktopShell } from './env'
import { openExternalUrl } from '../preview/openUrl'

/** 回官网首页：网页版 / PWA **本窗口返回**；桌面壳交给系统浏览器（见文件头说明） */
export function goSiteHome(): void {
  if (isDesktopShell()) {
    void openExternalUrl(brand.siteUrl)
    return
  }
  window.location.assign('/')
}
