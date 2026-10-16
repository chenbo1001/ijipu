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
export const APP_VERSION = '0.66.0'

/** 完整版本串：v0.2.0 (2026-08-16 @a1b2c3d4) */
export const APP_VERSION_FULL = `v${APP_VERSION} (${BUILD_DATE} @${GIT_COMMIT})`

/**
 * adj971（**用户 2026-10-18 口径**）：应用标题统一来源。
 *
 * 旧口径（`adj621`）：`爱记谱 iJipu - v0.36.0 (2026-09-23 @4ed877a3)` —— 把版本塞进标题，
 * 靠 OS 任务栏 / Alt+Tab / 浏览器页签"一眼看到版本"。
 *
 * **新口径**（用户原话：「壳端、PWA 标题、网站页签、插件的嵌入版 ijipu 的标题信息改为
 * "文件名.jps - 爱记谱 iJipu"，而版本信息显示在**状态栏的右侧**、**官网首页的左边**」）：
 *   · 标题 = **文件名 + 应用名**（见 `appTitleOf`）—— 打开多个窗口/页签时靠它区分是哪一份谱；
 *   · 版本 = 挪到应用**状态栏右侧**（`ui/EditorFootBar.tsx`，短版本号 + 悬停看完整串）与
 *     **官网首页左侧**（根 `index.html` 顶栏的品牌名右侧，`data-app-version` 占位）。
 *
 * 前缀 `爱记谱 iJipu` 与 `brand/tokens.ts` 的 brand.nameZh + brand.name 一致；
 * 放在 `version.ts` 而非 `tokens.ts`，是因为它天然跟版本号绑定，需要在版本递增
 * 时跟随（与 brand 名称"基本不变"语义不同）。
 */
export const APP_TITLE_PREFIX = '爱记谱 iJipu'

/**
 * adj971：**应用标题** = `文件名.jps - 爱记谱 iJipu`（四处宿主共用这一份：桌面壳窗口标题、
 * PWA 窗口/页签、网页版页签、Obsidian 嵌入版）。
 *
 * @param fileBase 文件名（**不带扩展名**；`docStore.fileName` 就是这个形态）。
 *   这里仍**防御性地**剥掉一次 `.jps`：调用方若手滑传了全名，标题不该变成 `x.jps.jps - …`。
 *   ⚠ 不 import `store/saveSupport` 的 `fileBaseName`：品牌层不许依赖 store 层（分层约束）。
 */
export function appTitleOf(fileBase: string): string {
  const base = String(fileBase ?? '').trim().replace(/\.jps$/i, '')
  return `${base === '' ? '未命名' : base}.jps - ${APP_TITLE_PREFIX}`
}

