# AGENTS.md 项目AI协作全局规范

> 本文件由 DeepSeek Harness（DSH）作为工作区指令**自动加载**；子目录级规范见 `src/AGENTS.md`（src 分层职责）。参考 `D:\Coding\ShiJi_dev` 项目规范体系整理，框架沿用、内容按本项目（Tauri + React + TS 简谱引擎）适配。

## 一、项目基础信息
1. 品牌信息：iJipu（中文「爱记谱」，简称「i记谱」）
   - Slogan：码即成，谱自现
   - 应用窗口标题：`爱记谱 iJipu`
   - 文件后缀：`.jps`（iJipu Script），兼容原「番茄简谱」在线编辑器语法
   - 品牌 token（色板/字体/口号）集中定义在 `src/brand/tokens.ts`，面向用户文案集中定义在 `src/brand/copy.ts`，主题在 `src/brand/themes.ts`（adj48 浅深色模式）
2. 技术栈：Tauri v2（Windows 桌面壳）+ Vite 8 + React 19 + TypeScript 6（strict）+ Zustand 5
3. 项目定位：代码式简谱制谱引擎——纯前端单页应用，`src/engine` 为纯 TS 引擎（零 React/DOM 依赖，可 Node 单测）
4. 主入口：Web 为 `src/main.tsx`（Vite）；桌面壳为 `src-tauri/`（main.rs → lib.rs → 加载 dist）
5. 版本机制：SemVer（`MAJOR.MINOR.PATCH`），手动维护点仅 `src/brand/version.ts` 的 `APP_VERSION`；构建日期与 git commit 由 `scripts/gen-build-info.mjs` 自动注入 `src/gen/buildInfo.ts`（勿手改）；发布时与 `package.json version`、`src-tauri/tauri.conf.json version` **三处保持一致**（详见 docs/VERSIONING.md）
6. 允许依赖：运行时仅 react / react-dom / zustand；开发依赖 tauri cli、vite、typescript、oxlint、@vitejs/plugin-react。**新增任何第三方依赖必须先说明用途与必要性，经确认后才可安装**

## 二、代码编写规范（强制遵守）
### 1. 命名规则
1. 变量、函数、文件/目录：camelCase（如 `previewZoom`、`computeRowTops`）
2. 组件、类型/接口、类：PascalCase（如 `PreviewPane`、`PageConfig`、`RowGuide`）
3. 常量：UPPER_SNAKE_CASE（如 `DRAFT_KEY`、`PREVIEW_W`）
4. 布尔状态/动作：`is/has/should` 前缀或动词短语（`showGuides`、`setPreviewZoom`）

### 2. 格式与排版
1. 缩进统一 2 空格，禁用 tab；无分号、单引号（项目既有风格，与 prettier 默认一致）
2. 行宽尽量 ≤ 100 字符，超长自动换行（对象/参数换行对齐）
3. 导入顺序：外部包（react 优先）→ 项目内部相对导入；用 `../` 相对路径，禁止别名黑盒
4. `import type` 与值导入分开（`verbatimModuleSyntax` 强制，tsconfig 已开）
5. 严格模式（tsconfig strict 已开）：禁止 `any`、隐式 any、未使用变量/参数（`noUnusedLocals`/`noUnusedParameters` 会报错）

### 3. 注释规范（个人强制习惯）
1. 每个文件头部写中文文件说明注释（`/** 路径/模块名 — 职责 */`），每个导出函数/组件写中文 JSDoc：功能、入参、返回值、关键副作用
2. 复杂逻辑、特殊业务判断行上方添加单行中文注释，**注释只写「为什么这么写」，不重复代码逻辑**；禁止无意义注释
3. **布局/UI 调整用 `adjNN` 连续编号标注**（如 `adj52`、`adj53`），写在注释与 git commit message 中，便于回溯调整历史（编号见 git log，最新 ≈ adj53，新增调整取下一号）
4. 全部注释、文档、沟通使用简体中文，禁止英文注释

### 4. 代码逻辑约束
1. 优先极简代码，拒绝过度封装、多层嵌套、抽象泄漏
2. 禁止硬编码：品牌文案入 `brand/copy.ts`、主题入 `brand/themes.ts`、默认配置入 `engine/types.ts` 的 `defaultPageConfig`、存储键入 store 文件顶部常量、构建信息入 `gen/buildInfo.ts`
3. 函数单一职责，一个函数只做一件事，代码行数尽量控制在 50 行以内
4. 大量循环、重复逻辑必须抽成通用工具函数（如 `engine/layout/guides.ts` 的 `clamp`/`dragDelta`）
5. React 组件遵循 hooks 规则（oxlint `react/rules-of-hooks` 已开 error）；zustand 选择器按字段订阅，避免整 store 重渲染

## 三、目录与文件约束
1. 严格遵循预设层级（详见 `src/AGENTS.md`），禁止在根目录随意新建脚本、缓存文件、临时产物
2. `src/engine` 为**纯 TS 引擎**：禁止 import React/DOM/浏览器 API，保证可在 Node 中单测（smoke）；数据流单向 `source(.jps) → parse → layout → render / playback`，禁止反向依赖
3. `samples/` 放内置示例谱（`.jps` 原文），`src/samples/index.ts` 用 `?raw` 集中登记；`docs/` 放项目文档；`scripts/` 放工具脚本（patch-vite.js、gen-build-info.mjs、smoke.mts、render-preview.mts、tauri-env.ps1）
4. `src-tauri/` 为桌面壳：`src/`（main.rs/lib.rs）、`tauri.conf.json`、`Cargo.toml`、`icons/`；`src-tauri/gen/` 与 `target/` 为生成物，**禁止手改、禁止提交**（已在 .gitignore）
5. 构建/缓存产物全部 .gitignore：`dist/`、`dist-smoke/`、`dist-preview/`、`node_modules/`、`src-tauri/target`、`src/gen/buildInfo.ts`（自动生成）
6. 新增功能模块先新建对应文件夹，再拆分文件，禁止单文件上千行代码
7. 项目级技能（SKILL）统一放在 `.dsh/skills/<技能名>/SKILL.md`，禁止放在 `.trae/` 或根目录；frontmatter 必须含 `name` + `description`

## 四、运行环境（Node / Tauri）
1. 开发测试默认用 `npm run dev`（Vite 开发服务器，http://localhost:5173，纯 Web 即可验证 UI/引擎）；仅调试桌面壳时才用 `npx tauri dev`
2. **DSH 沙箱下 npm/npx 必须显式带缓存参数**（环境变量 `npm_config_cache` 优先级高于项目 .npmrc，命令行参数最高优先级）：
```bash
npm install --cache "D:/Coding/JianpuScript/.npm-cache"
npx tsc -b --cache "D:/Coding/JianpuScript/.npm-cache"   # 或其它 npm 命令同理
```
   （`.npmrc` 保留作为无环境变量环境下的兜底；涉及 npm 配置先 `npm config list` 查实际生效值）
3. 常用命令：
| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（自动 gen:info） |
| `npm run build` | 类型检查（tsc -b）+ 产物构建（vite build） |
| `npm run lint` | oxlint 代码检查 |
| `npm run smoke` | 引擎冒烟测试（现有 147 项，vite.smoke.config.ts 打包 scripts/smoke.mts 后 node 运行） |
| `npm run preview:render` | 示例谱渲染 SVG 输出 `dist-preview/` |
| `npx tauri dev` / `npx tauri build` | 桌面开发 / 打包 |
4. Tauri/Rust 命令前必须先点引用环境脚本（每条 pwsh 命令独立进程）：
```powershell
. .\scripts\tauri-env.ps1   # 设置 CARGO_HOME/RUSTUP_HOME 到工作区 + MinGW PATH
npx tauri build             # 打包 → src-tauri/target/release/bundle/nsis/*-setup.exe
```
5. cargo/tauri 构建与 GUI 运行需**完整权限**（沙箱隔离证书存储与 WebView2 初始化），详见 docs/ERRORS-LOG.md E-2026-031/032
6. 临时 TS 脚本**禁用 tsx/esbuild**（沙箱禁止 spawn 子进程，E-2026-004）：用 vite 的 lib 模式（参考 vite.smoke.config.ts 或临时 vite config）打包为 CJS 后 `node` 运行

## 五、AI 交互输出规则与 DSH 协作约定（个人习惯）
### 1. AI 交互输出规则（沿用）
1. 回答分层清晰，多用小标题+分点，大段文字分段换行，不堆砌长文本
2. 修改已有代码时：优先输出**仅变更片段**，不完整复制整个文件；如需全量替换，先说明改动范围
3. 生成完整代码前，先输出实现思路、核心逻辑方案，确认后再贴代码
4. 代码块必须标注语言类型（```ts / ```tsx / ```bash），关键代码行添加行内注释
5. 拒绝冗余解释，直击重点；提问补充信息时，简洁列出需要的参数/上下文
6. 若需求存在多种实现方案，主动对比各方案优缺点，给出推荐选择

### 2. DeepSeek Harness 协作约定
1. 长周期任务（跨多轮/跨会话）必须用**目标工具**跟踪，写明客观完成条件；会话恢复后先恢复目标（resume）再继续
2. 独立可并行的任务优先后台**子代理**，指令必须自包含（背景/目标/约束/产出/文件路径）；多个委派一起发出，并行推进
3. 后台任务（构建/长命令）必须有始有终：结束就收集结果（job_output），不再需要就终止（job_kill）
4. 涉及多文件的大改动先给完整**计划**（计划模式）确认后再动手；多步任务用 todo 清单跟踪
5. 文件操作遵循「先读后改」；edit 目标串必须精确唯一，禁止凭印象直接覆盖
6. 项目级技能统一沉淀在 `.dsh/skills/<技能名>/SKILL.md`（frontmatter 必须含 `name` + `description`，否则 DSH 忽略该技能）

## 六、业务特殊约束（简谱引擎）
1. `.jps` 语法规范以 `docs/JPS-SPEC.md` 为准（兼容原「番茄简谱」语法，原站谱子可直接使用）；**修改 parser/tokenizer 语法行为必须同步更新 JPS-SPEC.md**（走「语法规范同步」技能）
2. 引擎数据流单向：`source → parseResult → layout → pages → render/playback`；`engine/layout` 不得依赖 `engine/render` 之外的上层，`engine` 整体不得依赖 `store/ui`；新能力先确认放在哪一层
3. 光标联动契约：音符/歌词元素带 `data-notepos` / `data-cipos` 属性，编辑器↔谱面双向跳转（`engine/cursorMap.ts` 负责 id ↔ 代码位置换算），改动联动逻辑必须同步两端
4. 布局数值规则（间距/字号/行距）集中定义在 `engine/types.ts` 的 `defaultPageConfig` 与 `engine/layout/index.ts`；调整记录用 `adjNN` 编号，commit message 带编号
5. 排版辅助虚线（guides）：位置计算收敛在 `engine/layout/guides.ts` 纯函数（`computeRowTops` / `computeRowGuides` / `quciGuideY` / `dragDelta`），预览层（PreviewPane）只消费不重算；**quci 虚线钳制在「曲部内容下沿」与「歌词文字上沿」之间，cici 虚线不越过歌词下沿（adj53 约定）**
6. 配置持久化：浏览器 localStorage，键统一 `ijipu.` 前缀（草稿/页面配置/主题/缩放等），**存储键集中定义在 store 文件顶部常量，禁止散落硬编码**
7. 试听播放：`engine/playback`（Web Audio 合成 + 采样音源），UI 在 PlaybackDialog；改动播放序列逻辑同步 smoke 断言

## 七、禁用行为（AI禁止执行）
1. 不主动重构现有成熟代码，仅在明确要求重构时优化
2. 不擅自新增第三方依赖库（react/react-dom/zustand 之外），新增库必须先询问确认
3. 不简化、删减业务必要校验逻辑、异常捕获代码（parse 错误处理、localStorage 损坏回退、导出容错）
4. 不使用废弃、过时 API 与语法，优先使用 TypeScript 6 / React 19 现代标准写法
5. 不输出英文注释、英文说明，全部沟通、注释使用简体中文

## 八、配置与数据保护规则
1. **损坏回退**：`ijipu.pageConfig` JSON 解析失败或字段类型非法时，必须回退 `defaultPageConfig` 并静默忽略，禁止崩溃、禁止向用户抛错
2. **草稿容错**：`ijipu.draft` 读取失败（损坏/无权限）时静默忽略，回退默认新谱，不影响启动
3. **存储键集中**：所有 localStorage 读写键统一 `ijipu.` 前缀，常量集中在 `src/store/uiStore.ts` / `src/store/docStore.ts` 顶部；禁止在组件中散落硬编码键名
4. **无隐含写**：应用纯前端无后端、不写用户文件；导出（PDF/JPG/SVG/PNG）仅在用户主动触发时生成到浏览器下载，验证脚本不得污染 samples/docs/ 真实文件
5. **写入校验**：写入 localStorage 前做范围钳制（如预览缩放 50~200、编辑器字号 10~26、拆分比例 15~85），参考 uiStore 既有实现

## 九、资源与路径规则
1. 应用图标：根目录 `app-icon.png` 为源图，`src-tauri/icons/` 为各尺寸图标（由 tauri icon 生成），`src-tauri/gen/` 生成物禁止手改；改图标走 `npx tauri icon app-icon.png`
2. 示例谱：`samples/*.jps` 原文 + `src/samples/index.ts` 登记（id/name/description/code），新增示例两处同步
3. 静态资源：`public/`（Vite 静态目录）；代码中禁止硬编码路径字符串，一律经 import 或变量
4. 文档：`docs/`（BRAND/JPS-SPEC/REQUIREMENTS/ROADMAP/ERRORS-LOG/VERSIONING），文档路径禁止硬编码在代码中
5. 运行日志：Tauri 调试输出重定向到根目录 `tauri-run-stdout.txt` / `tauri-run-stderr.txt`（调试用，勿删勿提交新内容）

## 十、打包规则（桌面端）
1. 桌面打包统一走 `npx tauri build`（tauri.conf.json 已配 `beforeBuildCommand: npm run build` 自动先构建前端 dist）
2. 打包产物：`src-tauri/target/release/bundle/nsis/*-setup.exe`（NSIS 安装包，bundle.targets 当前为 nsis）
3. 打包前必须确认**版本三处一致**：`src/brand/version.ts` 的 `APP_VERSION`、`package.json version`、`src-tauri/tauri.conf.json version`；不一致先同步再打包
4. 打包需完整权限并先加载环境：
```powershell
. .\scripts\tauri-env.ps1
npx tauri build
```
5. `src-tauri/target/` 产物禁止提交 git（已 gitignore）；`dist/` 前端产物由 build 生成，禁止手改

## 十一、版本发布流程（强制遵守）
1. 版本号 SemVer（MAJOR/MINOR/PATCH），**唯一手动维护点**：`src/brand/version.ts` 的 `APP_VERSION`；语义见 docs/VERSIONING.md（PATCH=修复/微调，MINOR=功能新增，MAJOR=破坏性变更）
2. 每次功能/修复/重构后，**必须同步项目文档**：
   - 排错/踩坑 → `docs/ERRORS-LOG.md` 追加（编号 `E-年份-序号`，格式见文末「记录 = 现象 + 根因 + 解决 + 预防」）
   - 语法/解析行为变更 → 同步 `docs/JPS-SPEC.md`（走「语法规范同步」技能）
   - 功能完成/路线图变化 → 更新 `docs/ROADMAP.md` / `docs/REQUIREMENTS.md` 勾选与状态
3. 布局/UI 调整在注释与 commit message 标注 `adjNN` 编号（取当前最新编号的下一个）
4. 递增版本号后**三处同步**（version.ts / package.json / tauri.conf.json），再统一 git 提交（Conventional Commits：`feat:`/`fix:`/`refactor:`/`chore:` + 中文描述，adj 调整带编号）
5. 需要交付时执行打包（第十章），发布顺序：**改代码 → 同步文档 → 递增版本号（三处）→ 提交 git → 打包交付**

## 十二、临时验证脚本约定
1. 一次性验证脚本统一命名 `scripts/_tmp_*.mts`（或根目录 `_tmp_*.mts`），验证通过后**必须删除**，禁止提交 git
2. 引擎层验证**优先并入** `scripts/smoke.mts`（`npm run smoke`，现有 147 项断言）：新增引擎行为先写断言再实现，保持「冒烟即回归」
3. 渲染/几何类验证用 `npm run preview:render` 输出到 `dist-preview/`（已 gitignore）人工核对；需叠加辅助线/标注时在临时脚本中生成带注释的 SVG 再检查
4. 运行方式：临时脚本用 vite lib 模式打包为 CJS 后 `node` 运行（参考 `vite.smoke.config.ts` 或临时 vite config）；**禁用 tsx/esbuild**（沙箱 spawn 限制）
5. 验证脚本禁止修改真实数据：samples/、docs/、localStorage 内容（浏览器侧）；只读分析优先
6. 验证完成后清理：删除临时脚本、临时打包产物（dist-smoke/ 下对应 cjs）、临时输出（dist-preview/ 下对应文件）

## 十三、错误日志纪律（docs/ERRORS-LOG.md）
1. 每次排错**必须记录**（开发纪律）：编号 `E-年份-序号`（如 E-2026-078），按类别分节（沙箱/环境、工具链、代码、测试、流程…）
2. 记录格式：**现象 → 根因 → 解决 → 预防**，语言简洁中文；根因必须写清机理，预防必须可执行
3. 类别高频项：沙箱/环境（npm 缓存、spawn 限制、权限）、工具链（Vite/tsc/tauri/cargo）、代码（引擎/UI）、测试（smoke）
