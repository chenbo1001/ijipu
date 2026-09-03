# iJipu 版本机制（Versioning）

## 版本格式

`MAJOR.MINOR.PATCH`（SemVer）＋ 构建信息（日期 + git commit）

```
示例：v0.2.0 (2026-08-16 @a1b2c3d4)
```

## 递增规则

| 位 | 触发条件 | 示例 |
|---|---|---|
| **MAJOR** | 破坏性变更 / 里程碑（UI 重构、格式不兼容、品牌变更） | 1.0.0 |
| **MINOR** | 功能新增（向后兼容） | 0.2.0 → 0.3.0 |
| **PATCH** | Bug 修复 / 细节调整 / 文案与样式微调 | 0.2.0 → 0.2.1 |

## 版本号维护位置

- **手动维护**：`src/brand/version.ts` 的 `APP_VERSION`
- **自动注入**：`scripts/gen-build-info.mjs` 在构建/开发启动前生成
  `src/gen/buildInfo.ts`（`BUILD_DATE` = 构建日期；`GIT_COMMIT` = 当前 commit 前 8 位，无 git 时回退 "dev"）
  —— 读取 `.git/HEAD` 与 refs 文件实现，**无子进程 spawn**（沙箱兼容）

## 展示位置

- 状态栏右侧：`i记谱 · v{APP_VERSION}`
- 关于对话框：`v{APP_VERSION} (BUILD_DATE @GIT_COMMIT)`

## 构建链

```bash
npm run dev      # → gen:info → vite dev
npm run build    # → gen:info → tsc -b → vite build
npm run tauri:build  # 复用 npm run build（前端 dist），版本随 package.json
```

> 桌面安装包版本取自 `package.json version` 与 `src-tauri/tauri.conf.json version`，与 `APP_VERSION` 保持同步（发布时三处一致）。

---
## 发布操作流程（`ijipu` 应用）

用户以「**更新要提交**」/「**提交更新**」触发时，按以下整串执行：

1. **判断版本递增幅度**——按更新内容大小：
   - **MAJOR**：破坏性变更 / 里程碑（UI 重构、语法/格式不兼容、品牌变更、大功能跨代）
   - **MINOR**（推荐小版本）：功能新增（向后兼容），如新增修饰符、新 UI 模块
   - **PATCH**：Bug 修复 / 细节调整 / 文案与样式微调
   > 实际以**更新内容大小**判定大版本 vs 小版本；拿不准时倾向小版本（MINOR）。
2. **记录更新**：
   - `CHANGELOG.md` 顶部新增 `[x.y.z]` 条目（功能/修复/文档版本）
   - `docs/ERRORS-LOG.md`：排错条目（`E-年份-序号`）+ 末尾 CHANGELOG 表新增 `vx.y.z` 行
   - 涉及语法改动同步 `docs/JPS-SPEC.md` / `docs/SYNTAX.md` / `public/doc/jps-spec.html`
3. **递增版本号（同步多份）**：
   - `src/brand/version.ts`（`APP_VERSION`）、`package.json`、`src-tauri/tauri.conf.json`
   - `package-lock.json`（顶层 + packages[""] 两处）
   - 引擎改动涉及包版本时同步 `packages/ijipu-engine/package.json`、`packages/ijipu-engine/src/engine/...` 相关
4. **验证**：`tsc -b` + `npm run build` 通过；`npm run smoke` 无新增失败（既有预存失败基线除外）。
5. **git 提交 + 打 tag**：
   - 提交（Conventional + adjNN，如 `release: 版本升至 x.y.z（...）`、`feat(engine): ...`）
   - `git tag <版本号>`（无 `v` 前缀，如 `0.10.5`），指向该提交。

---
## 双仓库联动（ijipu 引擎 ↔ obsidian-ijipu）

- **当 ijipu 更新涉及引擎代码**（`packages/ijipu-engine/src/engine/`）时，`obsidian-ijipu` 也需要发布：
  1. 把 ijipu 引擎改动的文件同步到 `obsidian-ijipu/vendor/engine/`（vite 将 `@ijipu/engine` 别名到 `vendor/engine/index.ts`，是自包含镜像）。
     - 用文件 hash 对比确认哪些引擎文件有差异（DIFF），复制覆盖；同步后用 hash 校验一致。
  2. **判断 obsidian-ijipu 版本递增**：若有**引擎更新**（vendored 引擎变化）或**自身插件代码更新**（`src/`、manifest、设置等），则递增 `obsidian-ijipu` 版本号（`package.json` + `manifest.json`）；仅文档/素材变化可不升。
  3. 记录更新（`obsidian-ijipu` 若有 CHANGELOG 则同步）。
  4. 验证：`tsc -noEmit -skipLibCheck` 通过（vite `npm run build` 在 DSH 沙箱可能因 spawn 限制失败，属环境限制、非代码问题；`main.js` 为构建产物且已 gitignore）。
  5. **git 提交 + 打 tag**：`git tag <版本号>`（对齐 ijipu，无 `v` 前缀）。

> 简化准则：**`ijipu` 有代码更新 → 判版本、记录、两库各自升版本、git 提交 + 打 tag；其中引擎更新需同步到 `obsidian-ijipu` 并单独提交 + 打 tag。**

