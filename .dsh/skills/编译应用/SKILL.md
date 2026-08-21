---
name: 编译应用
description: 使用 Tauri v2 将 JianpuScript 打包为 Windows 桌面安装程序（官方打包流程）：先加载 scripts/tauri-env.ps1 环境，再 npx tauri build（beforeBuildCommand 自动先 npm run build 前端），产物为 src-tauri/target/release/bundle/nsis/*-setup.exe。打包前必须确认版本三处一致（src/brand/version.ts、package.json、src-tauri/tauri.conf.json）。当用户说"打包""生成 exe""安装包""桌面程序""tauri build"时使用。
whenToUse: 仅当需要生成 Windows 桌面安装包（nsis setup.exe）时使用；日常开发/测试走「环境运行与测试」技能，发布流程走「版本发布」技能。
---

# 编译应用（Tauri 打包 Windows 安装程序）

## 目标

将项目打包为 Windows 桌面安装程序（NSIS 安装包），产出 `src-tauri/target/release/bundle/nsis/*-setup.exe`。**本 skill 只负责打包**；版本管理与发布顺序走「版本发布」技能。

## 前置条件（缺一不可）

1. 前端构建可通过：`npm run build`（gen:info + tsc -b + vite build）无报错
2. **版本三处一致**：`src/brand/version.ts` 的 `APP_VERSION` == `package.json version` == `src-tauri/tauri.conf.json version`；不一致先同步（安装包版本取自 package.json / tauri.conf.json）
3. Rust/Tauri 环境就绪：`scripts/tauri-env.ps1`（CARGO_HOME/RUSTUP_HOME 在工作区）
4. 打包需**完整权限**（沙箱隔离证书存储与 WebView2 初始化）

## 步骤

### 1. 检查版本与环境

```powershell
# 核对三处版本号一致（发布流程见「版本发布」技能）
Select-String -Path src/brand/version.ts -Pattern "APP_VERSION" 
Select-String -Path package.json, src-tauri/tauri.conf.json -Pattern '"version"'
```

### 2. 加载环境并打包

```powershell
. .\scripts\tauri-env.ps1     # 设置 CARGO_HOME/RUSTUP_HOME + MinGW PATH
npx tauri build               # 自动先跑 npm run build（tauri.conf.json beforeBuildCommand）
```

- `tauri.conf.json` 已配置 `beforeBuildCommand: npm run build`，前端 dist 自动构建，无需手动先 build
- 首次构建/依赖变更时 cargo 编译较慢（release 模式全量编译），属正常

### 3. 产物校验

- [ ] `src-tauri/target/release/bundle/nsis/*-setup.exe` 生成，文件名含当前版本号
- [ ] 安装包可安装启动，窗口标题「码上简谱 JianpuScript」、图标正确
- [ ] 关于对话框版本号 = APP_VERSION（构建信息 BUILD_DATE/GIT_COMMIT 由 gen:info 注入）
- [ ] 产物不提交 git（src-tauri/target 已在 .gitignore）

### 4. 换图标（需要时）

```powershell
npx tauri icon app-icon.png   # 从根目录源图重新生成 src-tauri/icons/ 各尺寸
```

- `app-icon.png` 为源图（已 gitignore，注意保留本地）；`src-tauri/gen/` 生成物禁止手改

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| tauri/cargo 命令找不到 | 未加载环境 | 先 `. .\scripts\tauri-env.ps1` |
| 打包中途失败（证书/WebView2） | 沙箱权限不足 | 在完整权限下运行（E-2026-031/032） |
| 安装包版本号不对 | 三处版本号不一致 | 先同步 version.ts / package.json / tauri.conf.json 再打包 |
| cargo 编译慢/内存大 | release 全量编译 | 正常现象；增量编译仅重编改动部分 |
| 前端构建失败 | tsc strict 拦截或 vite 报错 | 先修 `npm run build` 再打包 |

## 约束（AGENTS 十）

- 打包前必须确认版本三处一致，禁止跳过
- 产物 `src-tauri/target/`、`dist/` 禁止提交 git；`src-tauri/gen/` 生成物禁止手改
- 打包需完整权限并先加载 tauri-env.ps1；日常开发用 `npm run dev`，无需打包
