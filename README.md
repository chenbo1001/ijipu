# iJipu（爱记谱）

> **码即成，谱自现** —— 下一代代码式简谱制谱引擎。

我们致力于将编程语言的严谨逻辑，注入中国传统简谱的创作之中。通过一套极简的 `.jps` 标记语言，让音乐人像写代码一样编排音符，让程序员像调参一样调整音高。码即成，谱自现，让简谱创作从此进入"脚本时代"。

- **中文简称**：i记谱（i Jì Pǔ）——"我用 i记谱写了个曲子。"
- **文件后缀**：`.jps`（**iJipu Script** 的后缀，兼容原「番茄简谱」）
- **命令行**：**随桌面版一起发布**（`ijipu.exe cli <命令>` —— 内嵌到 exe，**不需要装 Node**）；
  也保留**独立 Node 包** `@ijipu/cli`（给 CI / 没装应用的环境）：`format` / `lint` / `info` / `render` /
  `play` / `batch` / `settings` / `config` / `doctor` / `completions` —— 用法与退出码见 [docs/CLI.md](docs/CLI.md)
- **用户身份**：谱师（Score Smith）—— 写代码的叫程序员，用 iJipu 写简谱的叫谱师
- **品牌色**：深空蓝 `#1E2A5E`（音乐的深邃与严谨）+ 霓虹青 `#00F0FF`（代码与科技感）

## 这是什么

复刻「番茄简谱」在线简谱编辑器（zhipu.lezhi99.com）的现代重设计版本。核心为**纯前端单页应用**（Web + PWA 可安装），并有 **Tauri v2 桌面端**（Windows 安装器）；兼容原站 `.jps` 脚本语法——原网站的谱子可直接复制进来使用。

## 功能现状

- [x] 项目骨架与品牌体系
- [x] 脚本编辑器：语法高亮（按词法分色）/ 自动格式化 / 行首命令快捷键 / 自动补全（`&` 修饰符、`@` 乐器）/ 撤销重做（输入合并）
- [x] **嵌入式简谱输入工具条**（adj314）：单行可横向滑动，主键/二级键共用；移动端/PAD 默认开启、PC 默认关；「输入条」开关控制，手机端免字母/符号键盘切换
- [x] 实时渲染预览（编码 / 拆分 / 预览 三视图）
- [x] 光标双向联动（编辑器 ↔ 乐谱）
- [x] 页面设置（纸张 / 边距 / 字体 / 行距 / 音符布局模式 时值优先 vs 空间优先）
- [x] 试听播放（Web Audio 合成 + 采样音源可切换，MIDI/WAV/MP3 导出）
- [x] 导出（PDF / JPG / SVG / PNG / MIDI / WAV / MP3）
- [x] 多声部支持（Q1/Q2 纵向堆叠、声部括弧、命名声部）
- [x] PWA（可安装为独立应用，离线可用）；Tauri 桌面端（Windows 安装器）
- [ ] 后端阶段（预留）：Python FastAPI 账号 / 云谱库 / 服务端 PDF

> **音符布局模式**：支持「空间优先」（默认）与「时值优先」两种宽度分配。空间优先按元素本体宽 + 可分配空白比例分配，多声部以小节为对齐单元、每拍不等宽；时值优先按拍级每拍宽。

## 技术栈

- **前端**：Vite 8 + React 19 + TypeScript 6 + Zustand
- **引擎**：纯 TypeScript 实现 `.jps` 解析 → 排版 → SVG 渲染 → 播放序列（零 React/DOM 依赖，可独立单测）；作为本地包 `@ijipu/engine`（`packages/ijipu-engine`）被应用消费，也可独立引入
- **存储**：浏览器本地（localStorage / IndexedDB），架构上预留后端接口

## 快速开始

```bash
npm install          # 依赖安装（自动执行 scripts/patch-vite.js 沙箱适配）
npm run dev          # 本地开发 http://localhost:5173
npm run build        # 类型检查 + 产物构建
npm run lint         # oxlint 代码检查
npm run smoke        # 引擎冒烟测试（覆盖解析/时值/布局/渲染/播放/多声部空间优先等，条数以实际输出为准）
```

## 桌面端（Tauri v2，Windows）

环境准备：安装 [Rust](https://rustup.rs/)（Windows 上 MSVC 或 GNU 工具链均可）与
[Tauri CLI](https://tauri.app/)，系统依赖见 [Tauri 官方前置条件](https://tauri.app/start/prerequisites/)。
装好后：

```bash
. .\scripts\tauri-env.ps1   # 可选：有工作区工具链时用它，否则沿用你自己的 rustup/cargo
npx tauri build             # 打包 → src-tauri/target/release/bundle/nsis/*-setup.exe
```

> **DSH 沙箱注意事项**：cargo/tauri 构建与 GUI 运行需完整权限（沙箱隔离了证书存储与 WebView2 初始化）；详见 docs/ERRORS-LOG.md E-2026-031/032。

> **仅 DSH 沙箱环境需要**：npm 命令要显式指定缓存目录（沙箱只允许写工作区）：
> `npm install --cache "<工作区>/.npm-cache"`
> 项目 `.npmrc` 已配置 cache 路径，但 DSH 注入的 `npm_config_cache` 环境变量优先级更高会覆盖它，
> 因此命令行参数 `--cache` 是最终生效手段。**普通开发环境不需要这一步。**

## 开源协议

本项目采用 **[GNU Affero General Public License v3.0（AGPL-3.0）](LICENSE)** 开源。

**作者**：蜗牛🐌（[snail.zh@foxmail.com](mailto:snail.zh@foxmail.com)）

- **允许**：自由使用、学习、修改、再分发；任何人部署为在线服务/网站时，必须向用户公开其修改后的完整源码（AGPL 网络条款）。
- **遵循方式**：修改本项目衍生作品时，须同样以 AGPL-3.0 发布，并保留版权声明。

> 本项目在 `.jps` 语法上高度兼容「番茄简谱」（闭源免费软件），但所有引擎代码均为独立实现（clean-room 重写），不含原站代码/素材/商标。向「番茄简谱」原作者与社区致敬。

## 第三方资源

- **GeneralUser GS v1.471**（作者 S. Christian Collins，[主页](http://www.schristiancollins.com)）——
  内置音色库 `resources/soundfonts/generaluser_gs.sf2`，按 **GeneralUser GS License v2.0** 随安装包分发。
  许可原文见 `resources/soundfonts/LICENSE-GeneralUserGS.txt`；来源、署名，以及一处**使用者必须知道的保留说明**
  （原作者声明部分采样来源无法 100% 追证）见 [`resources/soundfonts/README.md`](resources/soundfonts/README.md)。

  该许可**明确允许**用在软件项目与按需调整打包方式，并要求"不要直链作者的下载文件、改为提供本地副本"——
  我们随安装包分发本地副本，正是这条要求的做法。

## 目录结构

```
ijipu/
├── src/                 应用源码（React）—— 按职责分层，数据流单向
│   ├── brand/           品牌身份（tokens / copy / themes / version）
│   ├── editor/          代码编辑器（textarea + 高亮层 + 行号栏 + 输入工具条）
│   ├── preview/         SVG 乐谱预览与光标联动
│   ├── store/           Zustand 状态（docStore / uiStore）
│   ├── ui/              通用组件（TopBar / Modal / Toast / 状态栏）
│   ├── dialogs/         功能对话框（页面设置 / 试听 / 导出 / 关于 / 示例）
│   ├── export/          导出模块（PDF/JPG/SVG/PNG/MIDI/WAV/MP3）
│   ├── styles/          主题样式（品牌 token CSS 变量）
│   └── samples/         示例谱登记（构建期用 `import.meta.glob` 自动发现 `public/samples/*.jps`）
├── packages/ijipu-engine/  简谱引擎（纯 TS，零 React/DOM 依赖，可单测）
│   └── src/engine/      types / parser / format / layout / render / playback / cursorMap
├── src-tauri/          Tauri 桌面端配置
├── public/samples/     .jps 示例谱（应用「打开示例」、首页示例、冒烟测试共用）
├── resources/soundfonts/  内置音色库与它的许可/来源说明（第三方作品，见「第三方资源」）
├── docs/               文档（语法说明 / 操作手册 / 需求 / 路线图 / 错误日志）
└── scripts/            工具脚本（patch-vite.js / gen-build-info.mjs / smoke.mts / verify-site.mjs 等）
```

> 引擎数据流单向：`source(.jps) → parse → layout → render / playback`，可从 `@ijipu/engine` 独立引入。

## 品牌资料

详见 [docs/BRAND.md](docs/BRAND.md)。

## 项目文档

- [需求说明书](docs/REQUIREMENTS.md)（含待补充需求清单，供需求方补充）
- [分期需求分解（迭代路线图）](docs/ROADMAP.md)（M0 已完成，M1 为下一期）
- [错误日志与经验教训](docs/ERRORS-LOG.md)（每次出错必记录，避免重犯）
- [脚本语法说明](docs/SYNTAX.md)（**`.jps` 语法的唯一对外口径**：入门手册 + 语法参考书 + 组合示例）
- [品牌手册](docs/BRAND.md)
