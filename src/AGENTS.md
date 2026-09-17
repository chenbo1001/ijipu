# AGENTS.md src 模块协作规范

> 本文件由 DeepSeek Harness（DSH）在会话进入 `src/` 目录时**动态注入**；项目级规则见根目录 `AGENTS.md`。

## 一、src 模块职责

`src/` 是应用源码统一存放目录，按职责分层：

| 目录 | 职责 | 约束 |
|------|------|------|
| `engine/` | 简谱引擎：解析（parser/tokenizer）、格式化（format）、排版（layout）、渲染（render）、播放（playback）、光标映射（cursorMap）、时值（duration）、类型（types） | **纯 TS，零 React/DOM/浏览器 API 依赖**，可在 Node 中单测；数据流单向 `source → parse → layout → render/playback`，禁止反向依赖；入口统一 `engine/index.ts` |
| `editor/` | 代码编辑器：EditorPane（textarea+高亮层）、highlight、history（撤销/重做）、shortcuts（行首命令快捷键） | 只做编辑交互；解析/格式化调用 engine，不复制引擎逻辑 |
| `preview/` | 乐谱预览：PreviewPane（SVG 渲染消费 + 光标联动 + 排版辅助虚线拖拽） | 渲染消费 engine 输出，虚线位置计算调用 `engine/layout/guides.ts` 纯函数，不重算几何 |
| `store/` | Zustand 状态：docStore（代码/解析结果/页面配置/历史）、uiStore（模态框/主题/缩放/字号） | 唯一状态源；localStorage 键集中定义在文件顶部常量（`ijipu.` 前缀），禁止组件内散落硬编码键名 |
| `ui/` | 通用组件：MenuBar、Toolbar、Modal、StatusBar | 无业务状态，只消费 store；图标/按钮样式走 CSS 变量 |
| `dialogs/` | 功能对话框：PageConfig、Playback、Export、Samples、Shortcuts、About | 每个对话框一个文件，统一用 `ui/Modal`；打开/关闭走 uiStore.modal |
| `export/` | 导出模块：PDF/JPG/SVG/PNG（export.ts） | 纯函数 + 浏览器下载，仅在用户主动触发时执行 |
| `playback/` | 播放辅助：采样音色库离线缓存（浏览器 IndexedDB / Tauri 文件系统，samplerCache.ts，adj323） | 实现 engine 的 `SamplerCache` 接口；只做缓存读写与预缓存编排，音频播放仍走 engine |
| `brand/` | 品牌层：tokens（色板/字体/口号）、copy（面向用户文案）、themes（中国色主题）、version（版本号） | 所有品牌字面量集中于此，禁止在其它代码硬编码文案/色值/版本号 |
| `styles/` | 主题样式：theme.css（品牌 token CSS 变量） | 样式统一用 `var(--jp-*)` 变量，禁止散落魔法色值 |
| `gen/` | 自动生成：buildInfo.ts（BUILD_DATE/GIT_COMMIT） | 由 scripts/gen-build-info.mjs 生成，**禁止手改**（已在 .gitignore） |
| `samples/` | 示例谱登记：index.ts（?raw 导入 samples/*.jps） | 新增示例谱两处同步：`public/samples/*.jps` 原文 + 此登记（id/name/description/code）；**「新建」模板 = `src/samples/未命名.jps`**（adj481 文件驱动：改这个文件即改新建出来的空白谱，代码里不内嵌副本、只有极小兜底；放源码目录而非 `public/`，免得随产物发布） |

> 本职责表是 AI 判断「代码该放哪」的依据：新增/调整目录或职责时，必须先更新本表再动代码。

## 二、engine 引擎约束（强制）

1. **零 React/DOM 依赖**：engine 文件不得 `import` react、react-dom、window/document/localStorage；纯几何/字符串/音频序列计算
2. **入口收敛**：对外 API 统一从 `engine/index.ts` 导出（parseJps、layoutScore、renderScoreToSvg、buildPlaySequence 等）；内部模块按需导入，禁止跨层绕过
3. **数据流单向**：`source(.jps) → parseResult → layout(ScoreLayout) → render(SVG) / playback(sequence)`；layout 不得反向读取 render 产物
4. **数值集中**：默认排版数值（边距/字号/行距/间距）定义在 `engine/types.ts` 的 `defaultPageConfig`，布局计算引用 `engine/layout/index.ts`；调整用 `adjNN` 编号标注
5. **可测性**：引擎关键行为（解析/时值/布局/虚线/播放序列）必须在 `scripts/smoke.mts` 有断言（npm run smoke，147 项）；新增行为先写断言再实现
6. **排版辅助虚线**：位置计算收敛在 `engine/layout/guides.ts`（computeRowTops/computeRowGuides/quciGuideY/dragDelta/clamp）；quci 虚线钳制在「曲部内容下沿」与「歌词文字上沿」之间、cici 虚线不越过歌词下沿（adj53），预览层只消费

## 三、store 状态管理

1. `docStore`（文档态）：code、parseResult、pageConfig、cursor/sel、撤销/重做历史（history.ts，上限 50 步、输入合并窗口）、草稿自动保存（ijipu.draft）
2. `uiStore`（界面态）：modal、showGuides、theme/themeMode、splitPct、editorFontSize、previewZoom；写入 localStorage 前范围钳制（缩放 50~200、字号 10~26、拆分 15~85）
3. **数据流**：组件通过 `useDocStore((s) => s.xxx)` 按字段订阅，禁止解构整个 store 造成全量重渲染；修改一律走 store action，禁止组件直接改 store 内部状态
4. **持久化键**：`ijipu.` 前缀常量集中在 store 文件顶部（DRAFT_KEY/PREVIEW_ZOOM_KEY 等），读取必须 try/catch 回退默认值。
   **adj480：不再有"页面设置"缓存键**——`PageConfig` 只有「代码默认 ← 谱面 `# jps-config`」两层（谱面自包含才谈得上"复制给别人显示一致"）；
   `ijipu.pageConfig` 只保留一次性迁移清理（`docStore.migrateLegacyPageConfig`），**不得再写入**

## 四、品牌与文案集中管理（强制）

1. 品牌 token（应用名/中文名/Slogan/用户身份/色板/字体）统一定义在 `src/brand/tokens.ts`，其余代码经 `brand` 导入引用，禁止硬编码
2. 面向用户的文案集中定义在 `src/brand/copy.ts`（aboutCopy/uiCopy），组件不得直接写字面量文案
3. 主题集中定义在 `src/brand/themes.ts`（中国色主题 + 浅深色模式），样式消费 `var(--jp-*)` CSS 变量
4. 版本号唯一手动维护点 `src/brand/version.ts` 的 `APP_VERSION`；发布时与 `package.json version`、`src-tauri/tauri.conf.json version` 三处一致（根 AGENTS 十一）
5. 新增任何品牌字面量时，先在 brand 对应文件添加常量并写中文注释，再在调用处引用

## 五、UI 与样式约定

1. 组件文件头部写中文说明注释；组件名与文件同名（PascalCase）；一个文件一个组件（oxlint `react/only-export-components`）
2. 布局用 flex；间距/色值统一走 CSS 变量与既有工具类，禁止散落魔法值
3. 工具栏/菜单按钮顺序调整、图标样式调整等 UI 改动标注 `adjNN` 编号并同步 commit message
4. 新增对话框：Modal 标题 + 底部操作区（确定/取消靠右），参考 PageConfigDialog 既有结构
