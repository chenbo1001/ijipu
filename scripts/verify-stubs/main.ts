/**
 * scripts/verify-stubs/main.ts — 验证用 `main.ts` 替身
 *
 * `scorePane.ts` 只从 `main.ts` 取两个事件常量（`GUIDES_CHANGED` / `SETTINGS_CHANGED`）。
 * 但真 `main.ts` 会牵进 `spessasynth_processor.min.js`（worklet）等**与本次验证无关**的东西，
 * 且那类文件在浏览器构建里会报 `MISSING_EXPORT`。
 *
 * ⇒ 验证构建里把 `./main` 指到本文件，只导出那两个常量。**不参与发布产物**。
 */
export const GUIDES_CHANGED = 'ijipu:guides-changed'
export const SETTINGS_CHANGED = 'ijipu:settings-changed'

/** `scorePane.ts` 有 `import type IJipuPlugin from './main'`（类型位）——给个占位 */
export default class IJipuPlugin {}
