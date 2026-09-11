/**
 * pwa/swUpdate.ts — Service Worker「新版本就绪」判定（纯逻辑，可在 smoke 断言）
 *
 * 背景（adj379）：部署新构建后，浏览器会装上新 SW（`public/sw.js` 在 install 时
 * `skipWaiting()`、activate 时 `clients.claim()`），新 SW **立刻接管**页面 —— 但**当前页面
 * 仍在跑旧 bundle**，只有刷新才会换成新代码。表现就是用户以为「我明明部署了新版/修了 bug，
 * 怎么还是旧界面」，因此需要在接管时提示一次「已更新，点击刷新」。
 *
 * 关键区分：**首次注册**（页面此前没有 SW 控制者）同样会触发 `controllerchange`，
 * 但那不是"更新"——页面本来跑的就是当前版本，**不应提示**。
 */

/** 是否应提示「已更新」：仅当页面此前已有 SW 控制者（= 这次是被新版接管） */
export function shouldPromptUpdate(hadController: boolean): boolean {
  return hadController
}

/** 自动检查新版本的间隔（毫秒）——SPA/PWA 可能长期开着，需定期 `reg.update()` 才能发现新版 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
