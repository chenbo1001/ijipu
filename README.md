# iJipu（爱记谱）

> **码即成，谱自现** —— 下一代代码式简谱制谱引擎。

我们致力于将编程语言的严谨逻辑，注入中国传统简谱的创作之中。通过一套极简的 `.jps` 标记语言，让音乐人像写代码一样编排音符，让程序员像调参一样调整音高。码即成，谱自现，让简谱创作从此进入"脚本时代"。

- **中文简称**：i记谱（i Jì Pǔ）——"我用 i记谱写了个曲子。"
- **文件后缀**：`.jps`（**iJipu Script** 的后缀，兼容原「番茄简谱」）
- **命令行**：`jps run` / `jps compile` —— 像编译代码一样编译乐谱
- **用户身份**：谱师（Score Smith）—— 写代码的叫程序员，用 iJipu 写简谱的叫谱师
- **品牌色**：深空蓝 `#1E2A5E`（音乐的深邃与严谨）+ 霓虹青 `#00F0FF`（代码与科技感）

## 这是什么

复刻「番茄简谱」在线简谱编辑器（zhipu.lezhi99.com）的现代重设计版本。第一版为**纯前端单页应用**，兼容原站 `.jps` 脚本语法——原网站的谱子可直接复制进来使用。

## 第一版功能

- [x] 项目骨架与品牌体系
- [ ] 脚本编辑器（语法高亮 / 自动格式化 / 行首命令快捷键）
- [ ] 实时渲染预览（编码 / 拆分 / 预览 三视图）
- [ ] 光标双向联动（编辑器 ↔ 乐谱）
- [ ] 页面设置（纸张 / 边距 / 字体 / 行距）
- [ ] 试听播放（Web Audio 合成 + 采样音源可切换）
- [ ] 导出（PDF / JPG / SVG / PNG）
- [ ] 后端阶段（预留）：Python FastAPI 账号 / 云谱库 / 服务端 PDF

## 技术栈

- **前端**：Vite 8 + React 19 + TypeScript 6 + Zustand
- **引擎**：纯 TypeScript 实现 `.jps` 解析 → 排版 → SVG 渲染 → 播放序列（无 React 依赖，可独立单测）
- **存储**：浏览器本地（localStorage / IndexedDB），架构上预留后端接口

## 快速开始

```bash
npm install          # 依赖安装（自动执行 scripts/patch-vite.js 沙箱适配）
npm run dev          # 本地开发 http://localhost:5173
npm run build        # 类型检查 + 产物构建
npm run lint         # oxlint 代码检查
npm run smoke        # 引擎冒烟测试（147 项）
```

## 桌面端（Tauri v2，Windows）

环境已建好（Rust GNU 工具链 + MinGW + Tauri CLI，安装器可产出）：

```bash
. .\scripts\tauri-env.ps1   # 设置 Rust 环境变量（CARGO_HOME/RUSTUP_HOME 在工作区）
npx tauri build             # 打包 → src-tauri/target/release/bundle/nsis/*-setup.exe
```

> **DSH 沙箱注意事项**：cargo/tauri 构建与 GUI 运行需完整权限（沙箱隔离了证书存储与 WebView2 初始化）；详见 docs/ERRORS-LOG.md E-2026-031/032。

> **注意（DSH 环境）**：npm 命令需要显式指定缓存目录，因为沙箱只允许写工作区：
> `npm install --cache "D:/Coding/JianpuScript/.npm-cache"`
> 项目 `.npmrc` 已配置 cache 路径，但 DSH 注入的 `npm_config_cache` 环境变量优先级更高，会覆盖它，因此命令行参数 `--cache` 是最终生效手段。

## 开源协议

本项目采用 **[GNU Affero General Public License v3.0（AGPL-3.0）](LICENSE)** 开源。

- **允许**：自由使用、学习、修改、再分发；任何人部署为在线服务/网站时，必须向用户公开其修改后的完整源码（AGPL 网络条款）。
- **遵循方式**：修改本项目衍生作品时，须同样以 AGPL-3.0 发布，并保留版权声明。

> 本项目在 `.jps` 语法上高度兼容「番茄简谱」（闭源免费软件），但所有引擎代码均为独立实现（clean-room 重写），不含原站代码/素材/商标。向「番茄简谱」原作者与社区致敬。

## 目录结构

```
src/
├── brand/       品牌身份（tokens / copy）
├── engine/      简谱引擎（纯 TS，无 React 依赖）
│   ├── types.ts         核心类型（AST / 谱面模型）
│   ├── parser/          .jps 解析器
│   ├── format/          自动格式化
│   ├── layout/          排版引擎（小节 / 分页 / 几何）
│   ├── render/          SVG 渲染与字形
│   └── playback/        播放序列与音频
├── editor/      代码编辑器（textarea + 高亮层）
├── preview/     SVG 乐谱预览与光标
├── store/       Zustand 状态（文档 / UI）
├── ui/          通用组件（菜单栏 / 状态栏 / 对话框）
├── dialogs/     功能对话框（页面设置 / 试听 / 关于）
├── export/      导出模块
└── styles/      主题样式（品牌 token CSS 变量）
samples/         内置 .jps 示例谱
docs/            文档（品牌手册等）
scripts/         工具脚本（patch-vite.js）
```

## 品牌资料

详见 [docs/BRAND.md](docs/BRAND.md)。

## 项目文档

- [需求说明书](docs/REQUIREMENTS.md)（含待补充需求清单，供需求方补充）
- [分期需求分解（迭代路线图）](docs/ROADMAP.md)（M0 已完成，M1 为下一期）
- [错误日志与经验教训](docs/ERRORS-LOG.md)（每次出错必记录，避免重犯）
- [.jps 语法规范 V1.0](docs/JPS-SPEC.md)（逆向自原站官方手册）
- [品牌手册](docs/BRAND.md)
