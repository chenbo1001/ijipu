# 水印层与背景层（设计规格）

> 状态：**规格已定稿，尚未实现**。用户 2026-10-15 提需求并逐条裁定（见 §六）。
> 本文是"动手前的唯一口径"：字段、单位、默认值、层序、裁剪、跨端取图、阶段划分、闸门清单。

## 一、需求（用户原话要点）

谱面设置里增加**水印属性组**与**背景属性组**：

- 水印：文字/图形选择（默认文本）、文本（默认 `""`）、图形文件（默认 `""`）、显示比率（100）、
  旋转角度（默认 45°）、透明度（默认 25，100 为不透明）
- 背景：图形文件（默认 `""`）、页面位置（默认 `(0,0)`）、显示比率（100）、旋转角度（默认 0°）、
  透明度（默认 100，不透明）
- 图形文件用**与 `.jps` 的相对路径**；插件里笔记的 ` ```jps ` 代码块支持**双链** `[[…]]`
- 背景图**只显示页面内**的部分，走出页面的不显示
- 层级从上到下：**曲谱层（现在的内容层）→ 水印层 → 背景层**
- 谱面设置里加两个页签，各自放上述属性
- **排版模式下**：`Ctrl+滚轮` 缩放背景图、`Ctrl+Alt+滚轮` 旋转、`Ctrl+左键按住拖动` 移动位置
  （注意与 `Ctrl+鼠标点击音符开始试听` 区分开）

## 二、字段定稿（引擎 `PageConfig`，全部 L2 谱面级）

### 2.1 建议键名与默认值

| 键 | 类型 / 范围 | 默认 | 语义 |
|---|---|---|---|
| `wmType` | `'text' ｜ 'image'` | `'text'` | 画哪一个（两个字段都保留，互不删除） |
| `wmText` | 字符串（允许 `\n` 多行） | `''` | 空 ⇒ 不画 |
| `wmImage` | 字符串（相对路径 / `[[双链]]` / `data:` URI） | `''` | 空 ⇒ 不画 |
| `wmSize` | 整数 pt，钳 6~400 | `36` | **文本**水印字号（用户裁定：单列一个字段） |
| `wmScale` | 整数 %，钳 10~1000 | `100` | **图形**水印宽度 = 页宽 × 比率（用户裁定：基准是**页宽**） |
| `wmRotate` | 整数 °，钳 -180~180 | `45` | 绕**自身中心**旋转 |
| `wmOpacity` | 整数 0~100 | `25` | 100 = 不透明 |
| `wmOffsetX` / `wmOffsetY` | 整数 pt | `0` / `0` | 水印中心相对**页面中心**的偏移（居中 = 0,0） |
| `bgImage` | 字符串，同上 | `''` | 空 ⇒ 不画 |
| `bgScale` | 整数 %，钳 10~1000 | `100` | 图片宽度 = 页宽 × 比率 |
| `bgRotate` | 整数 °，钳 -180~180 | `0` | 绕图片中心 |
| `bgOpacity` | 整数 0~100 | `100` | 100 = 不透明 |
| `bgOffsetX` / `bgOffsetY` | 整数 pt | `0` / `0` | 图片中心相对**页面中心**的偏移（居中 = 0,0） |

### 2.2 四条语义定义（都必须写进断言）

1. **"显示比率"的 100% = 页面宽度**（用户裁定）。图形宽度 = `页宽 × scale/100`，高度按**原图长宽比**
   推算（所以必须由宿主量出 `naturalWidth/Height` 一并传入）。换纸张尺寸时"相对页宽"的关系自动保持。
2. **位置 = 元素中心相对页面中心的偏移**（用户裁定）。`(0,0)` ⇒ 居中，负值向左/上。
   与旋转、缩放**共用同一个中心**（缩放绕中心、旋转绕中心、位移平移中心）⇒ 三者可交换顺序。
3. **旋转中心**：图形/文本都绕**自身中心**。
4. **只显示页面内**：两层都以**本页页面矩形**做 `clipPath` 裁剪（不依赖 `viewBox` 的隐式裁剪，
   因为插件会改 `viewBox`、导出范围也会改）。**每一页都画**，位置相对**该页**的页面框。

### 2.3 差量写入的天然好处（不用额外交代）

`writeJpsConfig` 的 `mode:'diff'` 会跳过"等于默认值"的键（`packages/ijipu-engine/src/engine/settings.ts:437`）
⇒ **不用这功能的谱，`# jps-config` 一个键都不会多**（`bgImage` 默认 `''`、`wmOpacity` 默认 `25`… 全等默认）。
这正好落在铁律 §五.12：**默认配置下出的谱必须是正规、正确的谱**。

## 三、渲染设计（引擎侧，纯函数）

### 3.1 插入点与层序

页面 SVG 现在长这样（`packages/ijipu-engine/src/engine/render/index.ts:2054`）：

```
<svg width height viewBox="0 0 w h">
  <rect data-page-bg="1" x=0 y=0 width=100% height=100% fill="#ffffff"/>
  …body…（描述头 / 跳房子 / 连音线 / 音符 / 段层 / 歌词 / 多声部 / 页号 / 说明）
</svg>
```

改成（顺序 = 用户要的层级，**背景在下、水印居中、曲谱在上**）：

```
<svg …>
  <rect data-page-bg="1" …/>
  <g data-overlay="bg"> …背景图… </g>        ← 新
  <g data-overlay="wm"> …水印…   </g>        ← 新
  …body…
</svg>
```

新增纯模块 `engine/render/overlay.ts`：算矩形（页宽基准 / 中心锚点 / 旋转矩阵 / opacity）并产出两段 SVG 字符串。
几何全部纯函数 ⇒ `scripts/smoke.mts` 可直接断言，不必跑浏览器。

### 3.2 ⚠ 必须打标记，并让四处"量尺寸的地方"排除它

`<svg>` 根下新增子元素会被两处"求内容包围盒"的逻辑算进去，后果是**静默**的：

| 地方 | 现状 | 必须做 |
|---|---|---|
| 插件 `scorePane.measureContentBox()` | 遍历 `<svg>` 直接子元素、**除 `data-page-bg` 外**全部 `getBBox()` 求并集（`obsidian-ijipu/src/scorePane.ts:2226`） | 把 `[data-overlay]` 一并排除，否则 `'score'` 视图的裁剪失效（留白裁不干净） |
| 引擎自动裁边 `NEAR_PAGE_RATIO = 0.98`（`engine/render/range.ts:48`） | 墨迹盒 ≥ 整页 98% ⇒ 判"量取不可靠"、退回整页 | 让"墨迹盒/范围盒"的算法忽略这两层（它们不是内容） |
| 应用侧的页面白底透明化 | 按 `data-page-bg` 选（`src/index.css:1066`） | 不动；新层**不吃**透明化规则（背景图该显示就显示） |
| 导出范围 `applyRangeToSvg` | 只改外层 `width/height/viewBox` | 不动（裁剪由新层自己的 `clipPath` 保证） |

**结论**：标记名定为 `data-overlay="bg" ｜ "wm"`，并在上面两处加上排除。

### 3.3 运行时资源注入（引擎零 DOM，不能自己读图）

引擎有机器闸门 `adj770`（禁 `document` / `createElement` / `Image`，`scripts/smoke.mts:1463`）
⇒ **量宽高、读字节都在宿主做**。现有同款先例：`renderScoreToSvg(layout, opts?: RenderFontMeta)`
就是"宿主实测、引擎消费"（`render/index.ts:2070`、`src/preview/fontMeta.ts:97`）。

```ts
// 新增（与 RenderFontMeta 并列）
export interface RenderAssets {
  bg?: { href: string; w: number; h: number }   // href 一律 data: URI
  wm?: { href: string; w: number; h: number }
}
export function renderScoreToSvg(layout: ScoreLayout, opts?: RenderFontMeta & { assets?: RenderAssets }): string[]
```

`assets` 缺省 ⇒ 输出与现在**逐字节相同**（这条要作为回归断言）。

### 3.4 为什么 `href` 必须是 data URI（硬约束）

PNG/JPG/PDF 三条导出都是"把 SVG 交给 `new Image()` 栅格化"
（`src/export/export.ts:40` 的 `svgToCanvas`、PDF 在 `pdf.ts` 里以 JPEG 的 `/DCTDecode` 内嵌）。
**以图片方式加载的 SVG 不允许引用外部资源** ⇒ 相对路径/`http:` 一律读不到。
打印那条路虽然是把 SVG `innerHTML` 进 DOM（`src/export/print.ts:72`，外部引用"或许"能行），
但为了四路一致，**统一 data URI**。

## 四、跨端取图（本功能最大的工作量）

### 4.1 现状缺口（已核实）

| 载体 | 基准目录 | 读图通道 | 缺口 |
|---|---|---|---|
| **桌面端**（双击 `.jps`） | `nativePath` 的目录 | ❌ | 桌面端**没有**"按任意绝对路径读内容"的命令（只有写文本的 `write_external_file`、要工作区根+相对段的 `ws_read_text`）；唯一返原始字节的 `sf_soundfont_resource_read` 路径被限死在安装目录。**需新增** |
| 桌面端（工作区） | 工作区根 + `segs` | 半 ✓ | `ws_*` 系列只有文本读写，**需新增二进制读** |
| **网页版**（工作区 FSA） | 工作区根 | 定位 ✓ / 读 ❌ | `resolveFileHandle` 能逐级拿到句柄，但只有 `readTextRaw`；**需新增 ArrayBuffer 读** |
| 网页版（单文件句柄） | — | ❌ | FSA 单文件句柄**拿不到父目录**（硬限制）⇒ 只能提示"改用工作区 / 把图内嵌" |
| **手机 PWA** | 同工作区 | 同上 | 移动端打开常走 `<input type=file>` 降级、**连句柄都没有** ⇒ 现实路径是"工作区"或"图内嵌" |
| **插件（嵌入版）** | vault（`welcome.root` + 当前 `segs`） | 半 ✓ | 桥的 `read` 是**纯文本**（`obsidian-ijipu/src/embed/bridge.ts:344`）；`adapter.readBinary` 插件里已有用例（`src/bankFile.ts:86`）⇒ **需新增桥 op** |
| 插件（代码块 `[[…]]`） | 笔记所在目录 | 解析 ✓ | `metadataCache.getFirstLinkpathDest(link, sourcePath)` 有先例（`obsidian-ijipu/src/embed.ts:176`），但代码块面板（`scorePane.ts`）今天不做链接解析 ⇒ **需新增**，且"当前笔记路径"要送到 iframe |
| CLI（Node / 内嵌） | 输入文件目录 | 半 ✓ | `CliIo` 只有文本 `readFile` ⇒ 读不到就**跳过该层 + stderr 说明**（另给 `--no-assets`），**绝不静默出不带背景的图** |

### 4.2 统一解析器（应用侧一处）

新增 `src/store/assetSource.ts`：

```
resolveAsset(raw: string, base: AssetBase): Promise<{ href, w, h } | { error }>
  · raw：去掉 [[ ]] 包裹 → 相对路径 / data: URI 直通
  · base：nativePath 目录 ｜ 工作区(根+segs) ｜ 插件 vault+笔记路径
  · 白名单：png/jpg/jpeg/webp/gif/bmp（**拒绝 svg** —— SVG 可含脚本，安全）
  · 上限：单文件 ≤ 16MB
  · 降采样：长边 > 目标像素×2 时 canvas 缩 + 重编码（JPEG/WebP q≈0.85）
  · 缓存：内存 + IndexedDB（键 = 真实路径 + mtime）
```

## 五、界面与交互

### 5.1 设置界面

`src/dialogs/PageConfigDialog.tsx` 加两个子页签（`水印` / `背景`），各 6 行左右，复用 `Row` + `.pcfg-*`。
要同步登记 **5 处**：`TabId` / `ALL_TABS` / `FIELDS_TABS` / `TAB_CONFIG_KEYS` / `renderPanel` 的 `case`；
顺手把 `uiStore.SettingsTabId` 与 `TabId` 那**两份已经不同步的名单**（前者缺 `cli`）合并成一处。
图形文件那一行：路径输入框 + 「选图…」+ 「内嵌进谱面（自包含）」+ 「置空」+ 插件下 `[[图片.png]]` 提示。

**插件侧（闸门强制）**：`obsidian-ijipu/src/defs.ts` 的 `DEFS` 加这两组（用户裁定：**插件设置面板也加**），
`obsidian-ijipu/README.md` 的设置键对照表补行且默认值必须与引擎一致。

### 5.2 排版模式下的交互

仅当 `showGuides`（排版辅助，默认开）**且已设背景图**时生效：

| 操作 | 行为 | 步进 / 钳制 |
|---|---|---|
| `Ctrl+滚轮` | 缩放背景图（改 `bgScale`） | 5%，钳 10~1000；`Ctrl+Shift` ⇒ 1% |
| `Ctrl+Alt+滚轮` | 旋转背景图（改 `bgRotate`） | 5°，钳 -180~180；`+Shift` ⇒ 1° |
| `Ctrl+左键按住拖动` | 平移（改 `bgOffsetX/Y`） | 1pt 取整；`Shift` 吸附页面中心 |

**与 `Ctrl+单击音符 = 试听` 的区分（双保险）**：

1. **位移阈值 4px**：`pointerdown` 后位移 < 4px 且抬起 ⇒ **不介入**，让原有的
   `Ctrl+单击`（`src/preview/noteClickAction.ts:35` 的 `ctrl-tryout`）照旧触发；超过阈值才进入拖动，
   并在松手时抑制这一次 `click`。
2. **仅排版模式**：非排版模式下这条逻辑完全不注册 ⇒ 试听行为一字不变。

实现要点：滚轮监听挂在预览容器上且 `{ passive: false }` + `preventDefault()`（否则触发浏览器页面缩放；
预览现在**没有任何 wheel 监听**，Ctrl+滚轮是空的 ✓）；拖动复用 `src/ui/dragGesture.ts` 的指针捕获范式，
**松手才写盘**（复用 `setPageConfig(最新, true, 按下时快照)` ⇒ 一次拖动 = 一条撤销、差量只含本次改动）。

## 六、决策记录

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 图形"显示比率"以什么为 100% | **相对页宽**（100 ⇒ 宽度撑满页宽） |
| 2 | 文本水印的字号怎么给 | **单列一个"字号(pt)"字段**（默认 36） |
| 3 | 背景 `(0,0)` 指什么 | **图片中心相对页面中心的偏移**（0,0 = 居中） |
| 4 | 插件设置面板要不要也暴露这两组 | **要**（作为"新谱默认值"，与现有 30+ 键同一套） |
| 5 | 桌面端保存走底栏还是系统对话框（同批裁定，与本功能无关但同轮） | 系统保存对话框 |

待定（P2，先按"不做"实现，需要时再加）：仅首页/每页开关、水印位置也可拖、水印文本的多行与变量占位符、
预览用 blob URL 省内存（导出仍用 data URI）。

## 七、实现阶段（每阶段可独立验收）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 引擎** | 字段 + `expectDescOf`/`roundPxIntegers` 补段 + `render/overlay.ts` + 插入层 + `assets` 参数 + 标记 | smoke：几何/层序/裁剪/opacity；**`assets` 缺省时输出与现在逐字节相同**；默认值 ⇒ `# jps-config` 不出现新键 |
| **P2 取图（桌面端 + 插件）** | Rust `read_asset_file`（照 `sf_soundfont_resource_read` 的 `tauri::ipc::Response`）+ 注册；插件桥 `readAsset`（`adapter.readBinary`）+ `hostBridge` 方法 + `workspace.ts` 二进制原语；`assetSource.ts`（含降采样/缓存/白名单） | 桌面端双击打开的谱能出背景图；插件里能出；路径失效给明确提示 |
| **P3 界面** | 两个页签 + 5 处登记 + 选图/内嵌按钮 + 插件 `DEFS`/`README` | 冒烟两条双向闸门；真点：改一项 → `*` 出现 → 保存后写进 `# jps-config` |
| **P4 交互** | 排版模式下的滚轮/拖动 + 阈值判定 | `verify-app-ui` 真点：滚轮/拖动真的改了配置；**非排版模式下 Ctrl+单击仍能试听**（负向判据） |
| **P5 网页版 / CLI（可选）** | FSA 二进制读；`CliIo.readBinary` + 读不到就跳过并说明 | 工作区场景可用；CLI `--no-assets` 明确跳过 |

## 八、优化清单（本规格采纳的）

1. **降采样 + 重编码**：长边压到"目标像素 × 2"。**必须做** —— 多页谱每页 SVG 各嵌一份 base64，
   10 页 × 2MB 会是 20MB 字符串，PDF（JPEG 内嵌）与内存都会炸。
2. **资源缓存**（内存 + IndexedDB，路径 + mtime 作键）：预览重排不重复解码。
3. **`data-overlay` 标记贯穿四处**（见 §3.2）——否则静默破坏插件裁剪与自动裁边。
4. **水印位置字段预留**（`wmOffsetX/Y`）：水印同样需要定位，交互将来可复用同一套。
5. **自包含对策**：默认相对路径（用户要的）+「内嵌为 data URI」按钮 + 设置里标出"⚠ 引用了外部图片"。
6. **拖拽体验**：`Shift` 吸附中心；滚轮/旋转双步进（5% / 1%）；预览角落显示操作提示（可关）。
7. **导出前一致性检查**：图片解析失败时预览与导出都给明确提示，**不静默降级**。
8. **顺手修名单重复**：`uiStore.SettingsTabId` 与 `PageConfigDialog.TabId` 合并成一处。
9. **文档连锁更新**（高发漏点）：`docs/SETTINGS-AUDIT.md`（标题仍写"34 字段"，表体已 37 行）、
   `docs/SYNTAX.md`（`# jps-config` 键的对外口径）、CLI 手册与 `cli-assert` 里逐字比对的
   **"可用键 35 个"/"可设置项：35 个（含可选字段 5 个）"**、插件 `DEFS` + `README`。
10. **安全**：读图命令只收图片扩展名 + 大小上限（`.jps` 是纯文本、可能来自别人）；拒绝 SVG 图源。

## 九、与既有铁律的关系

- **铁律 §五.12（默认配置下必须出正经谱）**：默认全部"不画"或"等于默认"，差量写入不落键 ⇒ 满足。
- **§五.9（谱面元素墨迹不重叠）**：**不适用**于这两层（它们是页面级底图，不参与元素排布）。
  必须在实现与文档里写明，避免以后有人拿它去算重叠。
- **adj480（谱面自包含）**：**本功能与之正面冲突**（相对路径 ⇒ 换机器/发别人会丢图）。
  对策见优化清单第 5 条；这条冲突要在文档与设置界面里对用户讲明白。
- **adj770（引擎零 DOM）**：新模块必须零 DOM；量尺寸/读字节一律宿主侧完成。
- **§五.8.1（嵌入门槛顺序）**：改引擎 ⇒ `vendor/engine` 逐字节同步 + 升版本 + 重生成嵌入产物，
  否则插件那份嵌入版仍是旧引擎（闸门 `adj733`）。
