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
export const APP_VERSION = '0.24.0'

/** 完整版本串：v0.2.0 (2026-08-16 @a1b2c3d4) */
export const APP_VERSION_FULL = `v${APP_VERSION} (${BUILD_DATE} @${GIT_COMMIT})`
