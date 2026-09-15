---
name: 版本发布
description: JianpuScript 版本发布全流程：按 SemVer 递增 src/brand/version.ts 的 APP_VERSION 并同步 package.json 与 src-tauri/tauri.conf.json 三处版本号、同步项目文档（docs/ERRORS-LOG.md 错误日志、语法变更同步 docs/SYNTAX.md、功能状态更新 ROADMAP/REQUIREMENTS）、Conventional Commits 提交 git（feat/fix/refactor/chore + 中文描述，布局调整带 adjNN 编号）、需要交付时走「编译应用」技能打包。当用户说"发布版本""递增版本号""准备发布""打新版本"或功能/修复开发完成需要落地时使用。
whenToUse: 仅当功能/修复/重构开发完成需要走完整发布流程（文档同步 → 版本号三处递增 → git 提交 → 打包交付）时使用；仅打包走「编译应用」技能，仅运行/测试走「环境运行与测试」技能，语法文档同步走「语法规范同步」技能。
---

# 版本发布

## 目标

把一次功能/修复/重构按项目固定节奏落地为正式发布：**改代码 → 同步文档 → 递增版本号（三处）→ 提交 git → 打包交付**（AGENTS 十一），保证版本号唯一来源、文档可追溯、交付包版本一致。

## 涉及文件

| 文件 | 角色 | 更新范围 |
|---|---|---|
| `src/brand/version.ts` | 版本号唯一手动维护点 | `APP_VERSION` 常量 |
| `package.json` | 安装包版本来源之一 | `version` 字段（与上同步） |
| `src-tauri/tauri.conf.json` | 安装包版本来源之二 | `version` 字段（与上同步） |
| `docs/ERRORS-LOG.md` | 错误日志 | 本次排错记录（E-年份-序号） |
| `docs/SYNTAX.md` | .jps 语法说明（唯一对外口径） | 仅语法行为变更时（走「语法规范同步」技能） |
| `docs/ROADMAP.md` / `docs/REQUIREMENTS.md` | 路线图 / 需求清单 | 功能完成勾选、状态更新 |
| `src/gen/buildInfo.ts` | 构建信息（自动生成） | 无（gen:info 自动注入 BUILD_DATE/GIT_COMMIT） |

## 步骤

### 第 1 步：同步项目文档

- 本次排错/踩坑 → `docs/ERRORS-LOG.md` 追加一条：编号 `E-年份-序号`（取现有最大序号 +1），格式 = 现象/根因/解决/预防，中文简洁
- 语法/解析行为变更 → 同步 `docs/SYNTAX.md`（走「语法规范同步」技能）
- 功能完成/路线图变化 → 更新 `docs/ROADMAP.md` / `docs/REQUIREMENTS.md` 勾选与状态
- 布局/UI 调整 → 注释与 commit 标注 `adjNN` 编号（取 git log 最新编号下一个）

### 第 2 步：递增版本号（三处同步）

SemVer 规则（docs/VERSIONING.md）：

| 位 | 触发条件 | 示例 |
|---|---|---|
| MAJOR | 破坏性变更 / 里程碑（UI 重构、格式不兼容） | 0.2.0 → 1.0.0 |
| MINOR | 功能新增（向后兼容） | 0.2.0 → 0.3.0 |
| PATCH | Bug 修复 / 细节调整 / 文案样式微调 | 0.2.0 → 0.2.1 |

三处同步（**一处都不能漏**）：

```bash
# 1. src/brand/version.ts 的 APP_VERSION（唯一手动维护点）
# 2. package.json 的 version
# 3. src-tauri/tauri.conf.json 的 version
```

验证：`src/brand/version.ts` 的 `APP_VERSION_FULL` 会带出构建日期与 commit（由 gen:info 注入，无需手改）。

### 第 3 步：git 提交

- 功能/修复/重构按改动各自提交，message 用 Conventional Commits 前缀 + 中文描述：
  - `feat(adj53): 排版辅助虚线曲词间距线钳制 - 不穿歌词、不超曲部下沿`
  - `fix: 歌词标点独立渲染 - 字严格对中音符`
  - `refactor: 模块命名规范化` / `chore: 打包流程梳理`
- 版本号递增 + 文档同步单独提交：`chore: 版本号递增至 v0.2.1 + 文档同步`
- 布局调整带 `adjNN` 编号，便于回溯

### 第 4 步：打包交付（需要交付时）

走「编译应用」技能：`. .\scripts\tauri-env.ps1` + `npx tauri build`，产出 `src-tauri/target/release/bundle/nsis/*-setup.exe`；打包前确认三处版本号一致。

## 检查清单

- [ ] docs/ERRORS-LOG.md 本次排错已记录（E-年份-序号）
- [ ] 语法行为变更时 docs/SYNTAX.md 已同步；功能状态在 ROADMAP/REQUIREMENTS 已更新
- [ ] 三处版本号一致（version.ts / package.json / tauri.conf.json），递增符合 SemVer
- [ ] 布局/UI 调整带 adjNN 编号
- [ ] git 提交完整：各改动提交 + `chore: 版本号递增至 …` 提交
- [ ] 需要交付时安装包已生成，版本号与三处一致

## 发布顺序（AGENTS 十一.5）

> 改代码 → 同步文档 → 递增版本号（三处）→ 提交 git → 打包交付

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 安装包版本号与 APP_VERSION 不一致 | 三处只改了一处 | 三处同步（version.ts/package.json/tauri.conf.json） |
| 漏记错误日志 | 发布时未走第 1 步 | 补齐 ERRORS-LOG.md 记录再发布 |
| 语法文档与实现不一致 | 语法变更未同步 docs/SYNTAX.md | 走「语法规范同步」技能补齐 |
| 状态栏版本号显示 dev | 构建信息未注入 | 重跑 `npm run gen:info` 或 dev/build |

## 约束（AGENTS 十一）

- 版本号唯一手动维护点 `src/brand/version.ts` 的 APP_VERSION，全项目禁止在其它地方硬编码版本号
- 每次功能/修复/重构后必须同步项目文档，禁止跳过
- 三处版本号必须一致后再打包；`src-tauri/target/` 产物禁止提交 git
