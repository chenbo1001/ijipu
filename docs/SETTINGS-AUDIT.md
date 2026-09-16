# 设置归属梳理（iJipu 应用 → 嵌入 obsidian-ijipu 的前置分析）

> 目的：把 iJipu 应用里**所有**设置/状态点分门别类，明确「哪些该随 .jps 走、哪些是用户个性、哪些只是会话状态」，
> 作为「应用整体嵌入 Obsidian 插件」方案（见 `docs/EMBED-PLAN.md`）的输入。
>
> 数据来源：本轮对 `src/**` 的全量扫描（localStorage 键、IndexedDB 库、Tauri 分支、`PageConfig` 34 字段、store 定义）。

---

## 一、判定准则（三条提问）

一个设置该放哪一层，用三问决定：

1. **改它会不会改变谱面的外观/排版结果？** 会 → 谱面级（进 `# jps-config`）。
2. **换一台机器/换一个用户打开同一份 .jps，期望看到一样吗？** 期望一样 → 谱面级；允许不一样 → 用户级。
3. **丢掉它用户会不会烦（要重新设置）？** 会 → 用户级（需持久化）；不会 → 会话级（内存即可）。

例外：**编辑器/界面偏好永进谱面级**（方向反了也要按第 2 问归用户级）。

---

## 二、四层模型

| 层 | 含义 | 存储 | 谁能改 | 嵌入 Obsidian 后 |
|---|---|---|---|---|
| **L0 代码默认** | `defaultPageConfig`、`DEFAULT_HQ_ENABLED`、品牌/主题默认 | 源码常量 | 开发者 | 不变 |
| **L1 用户个性** | 只影响"我这个人的使用体验"，与具体谱无关 | 缓存（localStorage / 插件设置 / IndexedDB） | 用户 | 由**宿主**提供与持久化（按库或全局，见 D4） |
| **L1.5 笔记级**（仅 Obsidian） | 一个笔记内多份谱的统一覆盖 | 笔记 frontmatter `ijipu_*` | 用户 | 是否保留待定（见 D3） |
| **L2 谱面级** | 决定这份谱长什么样，必须跟着 .jps 走 | 源码 `# jps-config:{...}` | 用户（按谱） | 不变（核心不变式） |
| **L3 会话级** | 打开期间的临时状态，重开即重建 | 内存 | — | 不变（但需**每实例独立**） |

优先级（现状，保持）：**L0 < L1 < L1.5 < L2**。

---

## 三、L2 谱面级：`PageConfig` 34 字段逐一归属

图例：✅ 随谱（保留） · ⚠️ 随谱但有争议 · ❌ 不该随谱（要移出）

| # | 字段 | 默认 | 现值语义 | 归属 | 说明 |
|---|---|---|---|---|---|
| 1 | `page` | A4 | 纸张 | ✅ | 直接决定分页与可用宽 |
| 2-5 | `margin_top/bottom/left/right` | 40 / 40 / 50 / 50 | 页边距 | ✅ | 拖拽虚线可调；adj418：左右默认 40 → 50 |
| 6 | `body_margin_top` | 20 | 曲部上间距 | ✅ | 描述头区域高的一部分 |
| 7 | `descAreaH` | 80 | 描述头内容区高 | ✅ | |
| 8-9 | `biaoti_font/size` | 系统栈 / 20 | 标题 | ⚠️ | 字体跨机可能缺失（见 D2） |
| 10-11 | `fubiaoti_font/size` | 系统栈 / 15 | 副标题 | ⚠️ | 同上 |
| 12-13 | `miaoshu_font/size` | 系统栈 / 13 | 描述头 | ⚠️ | 同上 |
| 14-15 | `notes_font/size` | 系统栈 / 12 | 说明文字 | ⚠️ | 同上 |
| 16-17 | `geci_font/size` | 系统栈 / 11 | 歌词 | ⚠️ | 歌词字号直接影响行高与分页 → 偏"谱面" |
| 18 | `note_size` | 13 | 音符字号 | ✅ | 决定整行几何（缩放基准） |
| 19 | `shuzi_font` | 系统栈 | 音符数字字体 | ⚠️ | 同上 |
| 20-24 | `height_quci/cici/ciqu/ciqu_lyric/shengbu` | 15/10/20/10/0 | 行距 | ✅ | 拖拽虚线可调 |
| 25 | `bar_gap` | 0 | 小节间距 | ✅ | |
| 26 | `align_min_bars` | 4 | 两端对齐最小小节数 | ✅ | 决定是否拉伸撑满 |
| 27 | `noteSpaceLayout` | space | 空间优先/时值优先 | ✅ | 改变断行结果 |
| 28 | `lianyinxian_type` | 0 自动 | 连音线样式 | ✅ | 绘制样式 |
| 29 | `lyricShrink` | 未设(false) | 歌词压缩避免重叠 | ✅ | 影响歌词占宽 |
| 30 | `showInstrument` | 未设(false) | 显示乐器名 | ✅ | 谱面内容的一部分 |
| 31 | `editorFont` | 未设 | **编辑器**字体 | ❌ | 与谱面外观无关 |
| 32 | `editorFontSize` | 未设 | **编辑器**字号 | ❌ | 同上 |
| 33 | `metaPos` | 未设 | 描述头元素拖拽位置 | ✅ | 版式的一部分 |
| 34 | `heights` | 未设 | 按页行距覆盖（旧） | ✅（只读兼容） | 引擎仍支持 `heights['a'+page]`；当前无 UI 写入 |
| 35 | `segmentRowGap` | 未设 | 临时段（{bz/dsb}）上下层纵向间距（`{bz?,dsb?}`，单位 px） | ✅ | 决定临时叠加段的几何；属于"这份谱长什么样"，应随谱走 |

### 现存问题①：`editorFont/editorFontSize` 既进了 .jps，又是"两份存储"（真 bug 级）

- **写进文件**：顶栏的 A−/A+ 与字体下拉**直接写 `pageConfig` 并持久化**：
  `TopBar.tsx:368/380/416/469/483` → `setPageConfig({ ...pageConfig, editorFontSize: v }, true)`
  → `docStore.setPageConfig(cfg, true)` → `writeJpsConfig(code, cfg)`（`engine/settings.ts` 用 `JSON.stringify(cfg)` 写**整份**配置）。
- **两份存储并存**：同一偏好还存在 `uiStore`（localStorage `ijipu.editorFont` / `ijipu.editorFontSize`），
  读取时 `pageConfig.editorFontSize ?? editorFontSize`（`EditorPane.tsx:79-80`、`TopBar.tsx:180-181`）——
  **谁赢取决于谱面里有没有写**；而**页面设置对话框里的字体/字号控件写的是 uiStore**（`PageConfigDialog.tsx:100-103`），
  顶栏写的是 pageConfig → 同一个"编辑器字号"在两个入口写进两个地方。
- 后果：① 把 .jps 发给别人 → 别人的编辑器字体/字号被改；② 用户自己也会困惑"我改了字号，为什么换台机器/换了谱又变了"；
  ③ 想改默认值时要同时改两处。
- 结论：**必须移出 L2**；`editorFont/editorFontSize` 只保留 L1（缓存/宿主），并把两个入口统一到 L1。做法见「六、迁移」。

### 现存问题②：写入策略是"全量"，会永久钉住旧默认

- 现状：`# jps-config` 记录**全部**（含与默认值相同的项，约 930 字符一行）。
- 后果：① 文件冗长；② 将来把某个默认值改得更合理，**旧谱永远按旧默认渲染**（即使那份谱从未被用户改过）；③ 编辑器偏好顺带泄漏。
- 备选策略见「五、决策 D1」。

---

## 四、L1 用户级：全部持久化项清点

### 4.1 localStorage（17 个键，全部 `ijipu.` 前缀）

| 键 | 默认 | 作用 | 类别 | 嵌入后的归属 |
|---|---|---|---|---|
| `ijipu.pageConfig` | `{}` | **公共默认页面设置**（L1 默认层） | 用户个性 | → 插件设置（`DEFS`，已实现） |
| `ijipu.theme` | 品牌默认 | 中国色主题 id | 用户个性 | 保留；建议增加"跟随 Obsidian"（D5） |
| `ijipu.themeMode` | auto | 浅/深/跟随系统 | 用户个性 | 跟随 Obsidian 浅深（D5） |
| `ijipu.editorFont` | Consolas | 编辑器字体（限等宽） | 用户个性 | → 插件按库缓存（编辑体验） |
| `ijipu.editorFontSize` | 14 | 编辑器字号 10~26 | 用户个性 | 同上 |
| `ijipu.autoWrap` | true | 自动折行 | 用户个性 | 同上 |
| `ijipu.showScriptPad` | 触屏/窄屏=true | 输入工具条显隐 | 用户个性 | 同上 |
| `ijipu.previewZoom` | 100 | 预览缩放 50~200 | 用户个性 | 保留但**意义有限**（窗格宽度由宿主决定，建议改为"适应宽度"） |
| `ijipu.splitPct` | 50 | 拆分比例 | 用户个性（视口相关） | **改用宿主/窗格**，嵌入时不再持久化 |
| `ijipu.splitHDir` | previewLeft | 左右拆分方向 | 同上 | 同上 |
| `ijipu.viewType` | split | 视图偏好（拆分/编辑/预览） | 同上 | 同上（由宿主决定布局） |
| `ijipu.showGuides` | true | 排版辅助虚线开关 | UI 状态（可持久化可不） | 建议插件级开关或会话状态 |
| `ijipu.playbackHqLibrary` | ''(默认库) | 音源库 id | 用户个性 | → 插件设置（已实现） |
| `ijipu.playbackHqVoice` | null=自动 | 默认音色（GM program） | 用户个性 | → 插件设置（已实现） |
| `ijipu.playbackHqEnabled` | 常用 7 种 | 收藏音色集合 | 用户个性 | → 插件设置（已实现） |
| `ijipu.draft` | — | **未保存草稿正文** | 独立应用专用 | **嵌入时必须禁用**（vault 才是唯一真源） |
| `ijipu.draftName` | — | 草稿文件名 | 独立应用专用 | 同上 |

### 4.2 IndexedDB / Tauri / PWA

| 存储 | 内容 | 类别 | 嵌入后的归属 |
|---|---|---|---|
| IDB `ijipu` / store `fileHandle` | 上次打开的 `FileSystemFileHandle`（免重选文件） | 独立应用专用 | **禁用**（Obsidian 已绑定文件） |
| IDB `ijipu-soundfonts-hq` | HQ 音源缓存（约 30~90MB） | 用户缓存 | 保留（建议共享缓存省流量，见 D4） |
| IDB `ijipu-soundfonts` | 旧采样缓存 | 用户缓存 | 保留/清理 |
| Tauri `sf_cache_read/write/remove` | 桌面版音源缓存落地（应用数据目录） | 平台实现 | 收敛为宿主能力（Obsidian 用 IDB/插件目录） |
| `public/sw.js` + `manifest.webmanifest` + `uiStore.updateReady` | PWA 安装与更新提示 | 独立运行专用 | **嵌入时禁用**（否则抢 Obsidian 的 SW 生命周期） |

### 4.3 其他"隐式用户级"

| 项 | 位置 | 说明 |
|---|---|---|
| 等宽字体白名单 | `uiStore`（`MONO` 集合） | 编辑器字体只允许等宽、且排除连字字体（防止高亮层错位） |
| `isNarrow` / `detectTouch` | `uiStore`（`window.matchMedia`/`innerWidth`） | **必须改为"容器感知"**：Obsidian 侧边面板窄、窗口宽，用 window 判断会误判（嵌入关键改动） |
| `systemLight` | `uiStore`（`prefers-color-scheme`） | 由宿主提供主题更准 |

---

## 五、L3 会话级（内存，重开即丢）

`modal`（当前对话框）、`playbackStartId`、`playbackTick`、`activeNoteId(s)`、`playheadTrack`、`voiceBlocks`、`noteIndexToPage`、`notice`、`dirty`/`fileName`/`fileStateTouched`、撤销重做历史（50 步）、`isNarrow`、`systemLight`、`updateReady`。

**注意（嵌入关键）**：`docStore`/`uiStore` 目前是**模块级单例**（`create()` 各一次）。L3 状态天然"每实例独立"，但单例会让"同时打开两个 .jps 视图"互相污染。

---

## 六、迁移与兼容策略

1. **编辑器偏好移出谱面**（修问题①）
   - 类型拆分：`PageConfig`（谱面级，进源码）与 `EditorPrefs`（用户级，不进源码）分离；
   - `extractJpsConfig` 白名单去掉 `editorFont/editorFontSize`（**保留读入但不写回**，用于一次性迁移）→ 下次任何保存自动清除旧键；
   - `writeJpsConfig` 只接受谱面级类型（编译期保证不会再写回）。
2. **写入策略（问题②）**：见 D1。
3. **draft / 文件句柄 / SW / 迁移模块**：嵌入模式统一开关（`host.mode === 'embedded'` 时不注册、不读写）。
4. **缓存命名空间**：L1 缓存键建议加库标识（如 `ijipu.<vaultId>.editorFontSize`）或统一走插件 `saveData`，避免多库串味（音源缓存例外，见 D4）。
5. **旧键不动**：独立应用继续用现有键；插件用新命名空间，互不干扰；`localStorageMigration` 仅在独立模式执行。

---

## 七、对嵌入方案的影响（宿主必须提供/必须禁用/必须改写）

**宿主必须提供（`IJipuHost`）**
`readDocument/writeDocument/onExternalChange`、`notify`、`pickFile`（可选）、`saveExport`、`samplerCache`（可选）、`theme{mode,variables}`、`editorPrefs`（读写 L1 编辑偏好）、`isActive()`、**容器尺寸/窄屏判定**（替代 `window.innerWidth`）。

**嵌入时必须禁用**
draft 草稿、文件句柄库、PWA/SW 与更新提示、Tauri 音源分支、`localStorageMigration`、打开/另存为入口（文件视图下）、`window` 级快捷键捕获（改为容器作用域）。

**必须改写为"容器感知"**
`isNarrow`/`detectTouch`/`detectNarrow`、拖拽与滚动的坐标基准、`document.body` 上的临时元素（测量用 textarea/mirror 需挂到容器或改用 `ResizeObserver`）。

---

## 八、待拍板的决策

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **D1** | `# jps-config` 写入策略 | **A** 只写"与 `defaultPageConfig` 不同"的字段 + 提供「固化全部设置到谱面」动作；**B** 保持全量（仅剔除编辑器偏好） | **A**：文件干净、不会被旧默认钉死；分享保真靠"固化"动作显式触发 |
| **D2** | 字体/字号是否允许用户级覆盖谱面 | 不允许（现状，谱面为准）/ 允许（用户层可覆盖字体字号） | 允许，但**默认关**（开关名如「用我的字体覆盖谱面字体」）——跨机字体缺失是高频痛点 |
| **D3** | Obsidian 笔记 frontmatter（`ijipu_*`）是否保留 | 保留为 L1.5 / 废弃（只留 `# jps-config`） | 保留为**可选**层（多谱块统一覆盖很有用），但文档明确"优先级低于源内" |
| **D4** | 音源缓存是否按库隔离 | 共享（跨库复用，省流量）/ 按库隔离 | **共享**，设置页提供"缓存大小/清除" |
| **D5** | 嵌入后的主题与布局类偏好 | 跟随 Obsidian（主题）＋ 隐藏 split/viewType/previewZoom / 全部保留 | **跟随 Obsidian + 隐藏布局类**（宿主决定布局），保留编辑器字号/字体/折行/输入条 |

---

## 八、决策定稿（2026-09-12，按建议执行）

| # | 决策 | **定稿** |
|---|---|---|
| **D1** | `# jps-config` 写入策略 | **差量写入（默认）**：`writeJpsConfig(code, cfg)` 只写与 `defaultPageConfig` 不同的字段，无差量则**删除该行**；需要"到哪都一样"时用 `{ mode: 'full' }`，界面入口 = 页面设置对话框的「**固化全部到谱面**」 |
| **D2** | 字体是否允许用户层覆盖谱面 | **允许，默认关**：L1 新增 `FontOverride{ enabled, font }`（键 `ijipu.fontOverride`），开启后标题/副标题/描述头/说明/歌词/数字六项**字体族**统一为所选栈（不动字号与其它排版参数），谱面文件不改写；界面在页面设置「全局」标签 |
| **D3** | Obsidian frontmatter 是否保留 | **保留为可选 L1.5**：优先级低于源内 `# jps-config`，文档写明；已降级键（`ijipu_editorFont*`）给专门提示而非"未识别" |
| **D4** | 音源缓存按库隔离？ | **共享**（跨库复用省流量）；插件设置页提供缓存状态与清除入口（后续随嵌入方案落地） |
| **D5** | 嵌入后主题与布局类偏好 | **跟随 Obsidian 主题 + 隐藏布局类偏好**（splitPct/splitHDir/viewType/previewZoom 由宿主/窗格决定）；保留编辑器字号/字体/折行/输入条（L1） |

## 八之二、字体策略（三原则，已落地）

| 原则 | 做法 |
|---|---|
| ① 跨机尽量有 | 候选只选 Windows/macOS/iOS/Android/Linux 至少一到两个平台内置的字体：微软雅黑 / PingFang SC / Hiragino Sans GB / Noto Sans CJK SC / 思源黑体 / 文泉驿；宋体侧用 Songti SC / SimSun / Noto Serif CJK SC |
| ② 适合简谱 | 音符数字默认无衬线（醒目）；黑体、宋体、楷体作为风格选项；另提供西文衬线（Georgia）与等宽（数字等距） |
| ③ 保证有可用字体 | 每个候选都是**完整 font-family 栈**且**末尾必须落到通用族**（`sans-serif`/`serif`/`monospace`）；旧文件里的裸字体名（`SimHei`、`KaiTi`…）在读取时经 `normalizeFontStack()` **自动补 fallback**，无需用户改谱 |

集中定义在 `engine/fonts.ts`（`SYS_FONT`、`SCORE_FONT_OPTIONS`、`EDITOR_FONT_OPTIONS`、`normalizeFontStack`），应用与插件共用同一份，不再各写一套（此前应用 10 项裸名、插件 5 项，两处还不一致）。

## 八之三、本次已实施清单

| 项 | 位置 |
|---|---|
| `PageConfig` 移除 `editorFont/editorFontSize`；L1 偏好集中到 `EditorPrefs`/`defaultEditorPrefs` | `engine/types.ts`、`engine/fonts.ts` |
| 差量写入 + 空差量删除行 + 全量模式 + 白名单过滤 + 字体 fallback 归一 | `engine/settings.ts`（`writeJpsConfig` / `extractJpsConfig` / `extractLegacyEditorPrefs`） |
| L1 读写唯一入口（编辑器字体/字号、字体覆盖）+ 旧谱面值一次性迁移 | `src/store/editorPrefs.ts`（新） |
| 顶栏 A−/A+/字体下拉不再写谱面；读取只认 L1 | `src/ui/TopBar.tsx`、`src/editor/EditorPane.tsx` |
| 生效配置解析收敛为 `resolveConfig()`（含 L1 字体覆盖）；新增 `persistFullConfig()` | `src/store/docStore.ts` |
| 页面设置：字体候选取自引擎、编辑器项标注为 L1、字体覆盖开关、「固化全部到谱面」 | `src/dialogs/PageConfigDialog.tsx` |
| 40 项断言（差量/删除行/全量/编辑器键不进谱面/迁移/字体归一/候选兜底/覆盖开关/字号钳制） | `scripts/smoke.mts` 的 `[90]` |

## 九、变更清单（按文档执行时要动的文件）

| 文件 | 动作 |
|---|---|
| `src/engine/types.ts`（实际在 `packages/ijipu-engine/src/engine/types.ts`） | 拆 `PageConfig` / `EditorPrefs`；`heights` 标注 legacy |
| `engine/settings.ts` | `extractJpsConfig` 白名单去 `editor*`；`writeJpsConfig` 收窄入参类型 + D1 的差量写入 |
| `src/store/uiStore.ts` | 编辑器偏好/布局偏好分离；`isNarrow` 改容器感知；嵌入模式禁用 SW 相关 |
| `src/store/docStore.ts` | draft/文件句柄/打开另存按 `mode` 分流；L1 默认层来自 host |
| `src/store/localStorageMigration.ts`、`fileHandleDb.ts`、`pwa/swUpdate.ts`、`main.tsx` | 嵌入模式跳过 |
| `src/playback/samplerCache.ts`、`spessaSynthBackend.ts` | Tauri 分支收敛到宿主接口 |
| `obsidian-ijipu/src/*` | 实现 `IJipuHost`（vault I/O、Notice、主题、编辑偏好按库缓存）；`defs.ts` 中编辑器无关字段保留、编辑器项移入"编辑偏好" |

---

## 十、一句话结论

**该随 .jps 走的是"排版与谱面外观"（L2，28 项左右，剔除 `editorFont/editorFontSize`）；用户个性（L1，主题/编辑体验/音色/缩放）留在缓存并交由宿主持久化；会话状态（L3）保持内存但必须每实例独立。** 顺手修掉两个现存问题：编辑器偏好被写进谱面、全量写入把旧默认钉死。
