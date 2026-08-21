---
name: 环境运行与测试
description: JianpuScript（码上简谱）项目的开发运行与测试规范：开发测试用 npm run dev（Vite 5173 纯 Web）、桌面壳调试用 npx tauri dev；构建用 npm run build（gen:info + tsc -b + vite build）；引擎回归用 npm run smoke（147 项断言，新增行为先写断言再实现）；渲染检查用 npm run preview:render 输出 dist-preview/；临时验证脚本统一 scripts/_tmp_*.mts（vite lib 模式打包 CJS 后 node 运行，禁用 tsx/esbuild）用后必删。当用户说"运行一下""跑起来""测试""构建""冒烟""验证引擎""npm 命令"或需要开发调试本项目时使用。
whenToUse: 仅当需要在本项目内运行/构建/测试/调试时使用；桌面打包（生成安装包 exe）走「编译应用」技能，发布流程走「版本发布」技能。
---

# 环境运行与测试

## 目标

保证本项目所有开发操作（运行/构建/测试/临时验证）遵循统一可复现的方式执行，验证脚本不污染项目，回归断言沉淀在 smoke 中。

## 运行环境速查（AGENTS 四）

| 场景 | 命令 | 说明 |
|---|---|---|
| 开发测试（默认） | `npm run dev` | Vite 开发服务器 http://localhost:5173，纯 Web 即可验证 UI/引擎，自动 gen:info |
| 桌面壳调试 | `npx tauri dev` | 需先 `. .\scripts\tauri-env.ps1` + 完整权限（WebView2） |
| 类型检查 + 构建 | `npm run build` | = gen:info → tsc -b → vite build |
| 代码检查 | `npm run lint` | oxlint（react hooks 等规则） |
| 引擎冒烟测试 | `npm run smoke` | vite.smoke.config.ts 打包 scripts/smoke.mts → node 运行，147 项断言 |
| 示例谱渲染输出 | `npm run preview:render` | 生成 SVG 到 dist-preview/（已 gitignore），人工核对几何 |
| 安装依赖 | `npm install --cache "D:/Coding/JianpuScript/.npm-cache"` | 显式缓存参数（沙箱下 .npmrc 会被环境变量覆盖） |

## 步骤

### 第 1 步：选择运行方式

1. **开发测试**：`npm run dev` 后浏览器打开 http://localhost:5173；引擎改动只需 Web 侧验证
2. **桌面壳相关**（Tauri 窗口/托盘/系统集成）：`. .\scripts\tauri-env.ps1` 后再 `npx tauri dev`；输出重定向到根目录 `tauri-run-stdout.txt` / `tauri-run-stderr.txt` 供排错
3. **构建验证**：改动后跑 `npm run build`（含 tsc -b 类型检查，strict 模式会拦截 any/未使用变量）
4. **npm 命令一律显式带 `--cache "D:/Coding/JianpuScript/.npm-cache"`**（DSH 沙箱只允许写工作区；ERRORS-LOG E-2026-001/002）

### 第 2 步：引擎测试（npm run smoke）

- 断言全部写在 `scripts/smoke.mts`（parse/tokenizer/时值/布局/虚线/播放序列），`npm run smoke` 全绿才算通过
- **新增引擎行为先写断言再实现**，保持「冒烟即回归」；断言失败输出实际值核对再改期望（数值比较，不用字符串包含）
- 渲染/几何类验证：`npm run preview:render` 输出 SVG 到 `dist-preview/`；需叠加辅助线时在临时脚本中生成带注释的 SVG 再检查

### 第 3 步：编写临时验证脚本（需要时）

1. **命名与位置**：`scripts/_tmp_*.mts`（或根目录 `_tmp_*.mts`），验证通过后**必须删除**，禁止提交 git
2. **运行方式**：临时 vite config（lib 模式，参考 vite.smoke.config.ts）打包为 CJS 后 `node` 运行；**禁用 tsx/esbuild**（沙箱 spawn EPERM，E-2026-004）
3. **只读真实数据**：禁止修改 samples/、docs/ 真实文件；localStorage 属浏览器侧，Node 脚本无法触达，无需处理
4. **输出隔离**：临时产物写到 dist-smoke/、dist-preview/（已 gitignore），验证后删除对应文件

### 第 4 步：收尾

1. 验证通过后删除 `_tmp_*.mts` 及其打包产物（dist-smoke/ 对应 cjs、dist-preview/ 对应输出）
2. 确认未改动 samples/、docs/ 真实文件、未残留临时目录
3. 排错/踩坑记录到 `docs/ERRORS-LOG.md`（编号 E-年份-序号，现象/根因/解决/预防）

## 检查清单

- [ ] 开发用 `npm run dev`，构建用 `npm run build`（tsc -b 通过）
- [ ] 引擎改动后 `npm run smoke` 全绿；新增行为有 smoke 断言
- [ ] `_tmp_*.mts` 验证后已删除，未提交 git
- [ ] npm 命令带 `--cache` 显式缓存参数
- [ ] 未修改 samples/、docs/ 真实文件；临时产物已清理
- [ ] 桌面壳调试用 tauri-env.ps1 + 完整权限

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| npm install/build EPERM（写缓存失败） | DSH 沙箱只允许写工作区，npm 默认缓存被拒 | 命令显式加 `--cache "D:/Coding/JianpuScript/.npm-cache"` |
| tsc/vite 报错但代码看起来没问题 | strict 模式拦截（any/未使用变量/类型不匹配） | 按报错修正类型，禁止用 any 绕过 |
| tsx/esbuild 运行报 spawn EPERM | 沙箱禁止子进程 spawn+pipe | 改用 vite lib 模式打包 CJS 后 node 运行（E-2026-004） |
| tauri dev/build 失败 | 未加载环境或权限不足 | `. .\scripts\tauri-env.ps1`；完整权限下运行（E-2026-031/032） |
| smoke 断言失败 | 引擎行为变化或期望值过期 | 输出实际值核对；数值比较不写字符串包含 |

## 约束（AGENTS 四 / 十二）

- npm/npx 命令必须显式带 `--cache` 工作区内缓存路径；禁用 tsx/esbuild（沙箱 spawn 限制）
- 引擎测试优先并入 smoke.mts（147 项回归）；临时验证脚本 `_tmp_*.mts` 用后必删、禁止提交 git
- 验证脚本禁止修改 samples/、docs/ 真实文件；产物只写 dist-smoke/、dist-preview/
- 排错必记 docs/ERRORS-LOG.md（E-年份-序号）
