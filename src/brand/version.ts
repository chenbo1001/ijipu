/**
 * brand/version.ts — 版本常量（手动维护）
 *
 * 版本机制详见 docs/VERSIONING.md：
 *   MAJOR.MINOR.PATCH（SemVer）
 *   - PATCH：Bug 修复 / 细节调整 → +1
 *   - MINOR：功能新增（向后兼容）→ +1
 *   - MAJOR：破坏性变更 / 里程碑 → +1
 *
 * 构建日期与 git commit 由 scripts/gen-build-info.mjs 自动注入（npm run gen:info）。
 * 发布时与 package.json version、src-tauri/tauri.conf.json version 三处保持一致。
 */
import { BUILD_DATE, GIT_COMMIT } from '../gen/buildInfo'

/** 当前版本（手动递增） */
export const APP_VERSION = '0.41.1'

/** 完整版本串：v0.2.0 (2026-08-16 @a1b2c3d4) */
export const APP_VERSION_FULL = `v${APP_VERSION} (${BUILD_DATE} @${GIT_COMMIT})`

/**
 * adj621：应用标题统一来源。
 *
 * 浏览器页签、PWA 打开时的页签、Tauri 桌面窗口标题，三处都用这个常量渲染，
 * 形式为「`爱记谱 iJipu - v0.36.0 (2026-09-23 @4ed877a3)`」——加版本后缀方便查看
 * 当前正在跑的应用版本（OS 任务栏 / Alt+Tab / Chrome 页签一眼可见）。
 *
 * 前缀 `爱记谱 iJipu` 与 `brand/tokens.ts` 的 brand.nameZh + brand.name 一致；
 * 放在 `version.ts` 而非 `tokens.ts`，是因为它天然跟版本号绑定，需要在版本递增
 * 时跟随（与 brand 名称"基本不变"语义不同）。
 */
export const APP_TITLE_PREFIX = '爱记谱 iJipu'

/** 完整应用标题：`爱记谱 iJipu - v0.36.0 (2026-09-23 @4ed877a3)` */
export const APP_TITLE_FULL = `${APP_TITLE_PREFIX} - ${APP_VERSION_FULL}`
