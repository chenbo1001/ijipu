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
