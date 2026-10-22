# 动态简谱（视频优先）实施方案

> **决策来源**：用户 2026-10-21 拍板 ——
> ① **先做视频**（H5 后置）；② **只做桌面端**（不要求网页端出片）；
> ③ 竖屏排版**先做流式视图**，之后补「A4 放大」模式，**最终两种都要**；
> ④ 音频**两种都支持**：桌面端优先「现场合成」（见 §六 的限定），
> ⑤ 二维码 / 水印**只预留参数位，先不出功能**；
> ⑥ ffmpeg **首次使用时下载**（另出资源包，见 `docs/INSTALLER-ASSETS-PLAN.md`）；
> ⑦ 反复段**展开成重复行**；⑧ 第一版配色**白底墨字**；⑨ 单支**上限 3 分钟**。
>
> **状态**：**M1 已完成**（2026-10-22，`adj1028`–`adj1042`）。开工时按 `git log` 取 `adj` 号。
>
> **开发模式（adj1079，2026-10-23 用户口径）**：`npm run dev` 下动态谱视频入口/相机位/生成默认开放
> （生成仍要求浏览器 WebCodecs）；生产网站/插件仍隐藏（整块桌面专属）；插件宿主桥接不开放。
> 需要 Tauri 原生命令的测试用 `tauri dev`；环境闸门统一走 `brand/env.ts` 的 `isDevBuild()`。
>
> **相关文档**：`docs/APP-PROMO-VIDEO.md`（宣传片脚本，非本功能）、`docs/REQUIREMENTS.md`

---

## 〇、实施更新（2026-10-22：两处方案被推翻）

落地过程中有两条**原方案已被否决**，读下文时以此为准：

### 〇·1 不再"为竖屏重排版面"，改为**相机取景**

原方案（§三、§五）要按 1080×1920 重新排版。实测标题与作者撞在一起——重新排版就要把标题/作者/歌词/
行距在每种比例下重调一遍，永远追不上 A4 那套调好的规则。

**现方案**（用户提出）：版面**一个字不动**，用"相机"决定看哪一块：

| 件 | 在哪 | 干什么 |
|---|---|---|
| `engine/dynamic/camera.ts` | 引擎 | `buildCameraTrack` + `cameraAt(t)`：片头满宽 → 推近 → 尾随色块（4/5 触发、推到 1/5） |
| `src/export/video/renderer.ts` | 宿主 | 按相机从页面位图上取景，画高亮 |
| `src/preview/DynamicFrameOverlay.tsx` | 预览层 | 固定取景框，框外压暗，框内是相机画面 |

`flowView.ts` / `frame.ts`（重排 + 条带）**保留但不作为主线**，留作"以后真要竖屏重排"的底子。

### 〇·2 不再用 ffmpeg，改为 **WebCodecs + Mediabunny**

实测本机 Chrome：`VideoEncoder` 支持 `avc1.640028`、`AudioEncoder` 支持 `mp4a.40.2`。
于是：`CanvasSource` 喂画布、`AudioBufferSource` 喂离线渲染好的 `AudioBuffer`，
Mediabunny 内部调编码器并封装 MP4。**不需要下载 ffmpeg，安装包也不用带**。

⇒ `docs/INSTALLER-ASSETS-PLAN.md` 里"资源包带 ffmpeg"那部分**作废**（资源包只剩音色库）。

### 〇·3 已跑通的东西（实测）

- 应用内导出：1080×1920 / 30fps / H.264 High / AAC 128k，**带声音**（用户实机确认）；
- 3 秒试编：无声 712KB / 带合成音轨 762KB（容器含 `mp4a`），约 1.9 秒；
- 断言：动态谱相关 41 条（时间轴 15 + 流式视图/出帧 17 + 相机 13，另有若干条随修正新增）。

---

## 一、目标与非目标

### 目标（M1 结束时）

在桌面端点「导出动态视频」，得到一支**可直接发抖音 / 小红书**的 MP4：

- 1080×1920（9:16）、30fps、H.264 + AAC；
- 谱面跟着音乐走：当前拍高亮、当前行居中、已过行淡出；
- **白色纸面 + 墨色字**（第一版配色，见 §十二）；
- **单支上限 3 分钟**：超出时提示，并让用户选导出的范围；
- 出片过程有进度、可取消，失败有可读原因；
- **导出结果与导出前的实时预览完全一致**（同一个 `frameAt` 算出来的）。

### 非目标（本轮明确不做）

| 不做 | 原因 |
|---|---|
| 网页端出片 | 浏览器里编码太慢（1 分钟视频要几分钟），且占内存 |
| H5 分享页 | 排在 M4；但 `frameAt` 这块内核按「H5 也要用」设计 |
| 二维码 / 水印 | 用户要求先只预留参数位 |
| 用户自带伴奏 / 人声对齐 | M4 以后；但它决定了 `source: 'file'` 的接口形状，先留好 |
| 直播 / 实时推流 | 不在需求内 |

---

## 二、总体架构：一个内核，两个出口

```
 .jps ──parse──▶ ScoreLayout ──┐
                               ├─▶ DynamicTimeline（镜头表，纯函数）
 PlaySequence（含反复展开）───┘            │
                                          ├─▶ FlowView（竖屏流式视图，纯函数）
                                          │
                              t ──────────┴─▶ frameAt(t) ──▶ Frame（纯数据）
                                                            │
                                    ┌───────────────────────┴──────────────┐
                                    ▼                                      ▼
                          canvas 逐帧出图（现在）                  DOM/SVG 播放（将来 H5）
                                    │
                              ffmpeg 管道
                                    │
                                  MP4
```

**三条硬约束**（写进代码注释，并有断言守）：

1. `frameAt(t)` 必须是**纯函数**：不读时钟、不读 DOM、不依赖 `Math.random`。
   同一个 `t` 调两次，结果必须深度相等。视频能帧级复现全靠这条。
2. **所有动画由 `t` 算出来**。禁止 CSS `transition`、禁止 `requestAnimationFrame` 累加、
   禁止「上一帧 + 增量」——这些都是视频里音画漂移的根。
3. **时间以音频采样为准**：`t=0` = 音频第 0 个采样 = 视频第 0 帧。

### 为什么内核放引擎而不是 `src/`

- `src/AGENTS.md` 二·1：两端（应用 / Obsidian 插件）共用的规则先落 `engine`；
- 纯函数才能在 Node 里跑断言（`npm run smoke`），视频这种东西**必须**有确定性断言；
- 将来 H5 与插件版要复用同一套（插件里已经有嵌入版 WebView）。

---

## 三、模块划分（具体到文件）

### 3.1 引擎：`packages/ijipu-engine/src/engine/dynamic/`

| 文件 | 职责 | 约束 |
|---|---|---|
| `timeline.ts` | `buildDynamicTimeline()`：把 `PlaySequence` 的事件与 `playheadSegs` 收成**按时间排好的 cue 列表** | 只读引擎自己的结构；不碰 DOM |
| `flowView.ts` | `buildFlowView()`：竖屏流式视图——行条带、每行的 y 区间与起止时间、视口滚动目标 | 复用 `computeRowTops`（`layout/guides.ts`），不重算行几何 |
| `frame.ts` | `frameAt()`：给 `t` 出 `Frame`（哪些矩形亮、滚到哪、遮罩） | **纯函数**，断言 D1 |
| `presets.ts` | 画布预设（9:16 / 1:1 / 16:9）+ 「视频用页面配置」推导（页宽页高/字号/边距） | 不写回 `.jps`，见 §七 |
| `index.ts` | 汇总导出；并在 `engine/index.ts` 再导出一次 | 遵守「入口收敛」 |

**已有的可复用件**（不重写）：

- `playback/playhead.ts`：分组、配色、命中判定（"这一时刻亮哪一段"）已是纯函数 —— **直接消费**；
- `playback/sequence.ts`：反复 / 跳房子已按演奏顺序展开 —— `atMs` 是绝对时间；
- `layout/guides.ts` 的 `computeRowTops()`：行顶 y 由音符基线反推，**与页高无关**
  ⇒ "流式视图"可以在**不改排版引擎**的前提下，把每页的行按行带重新拼成一条逻辑条带。

### 3.1.1 流式视图的行模型（关键设计，别绕开）

`FlowRow` **不存重排后的音符**，只存「从哪一页的哪一段取图、贴到条带的哪个位置」：

```ts
interface FlowRow {
  pageIndex: number
  /** 从该页取图的纵向区间（渲染时按它裁） */
  srcTop: number
  srcBottom: number
  /** 贴到条带上的纵坐标 */
  stripY: number
  t0: number
  t1: number
  /** 第几遍（反复展开后同一段会出现多次） */
  pass: number
}
```

- **行边界 = 相邻行顶的中点**：这样各行的取图区间**不重叠也不漏**（与段层色块切中线同一口径）。
- **反复展开 = 多贴几次**：同一组 `(pageIndex, srcTop, srcBottom)` 出现多次，`stripY` 与 `pass` 不同即可。
  不用复制音符数据、不用重排。
- **渲染一帧** = 对可视行做
  `drawImage(pageCanvas, 0, srcTop, W, h, 0, stripY - scrollY, W, h)`。
- 好处：一次排版、一次光栅，反复只多贴一遍；H5 将来也能用同一份 `FlowRow` 做滚动。

### 3.2 宿主：`ijipu/src/export/video/`

| 文件 | 职责 |
|---|---|
| `videoFrame.ts` | `Frame` → 画到 canvas：**底图只光栅化一次**，每帧只画高亮/遮罩/滚动裁切 |
| `videoAudio.ts` | 音轨：离线渲染（复用 `src/export/audio.ts` 的 `renderToAudioBuffer`）+ 首尾留白 + 与帧表对齐 |
| `videoEncode.ts` | 与 Tauri 命令对接：开任务 / 推帧 / 结束 / 取消 / 进度回调 |
| `VideoExportDialog.tsx` | 参数面板 + 进度条 + 取消 + 失败提示 |
| `videoPreview.tsx` | **实时预览窗**：同一 `frameAt` 在 canvas 上按 `requestAnimationFrame` 演一遍（不编码） |

已有可复用件：`src/export/export.ts` 的 `svgToCanvas()`（SVG → canvas，带 `scale`）。

### 3.3 桌面：`ijipu/src-tauri/src/video/`

| 函数 | 职责 |
|---|---|
| `video_begin(opts)` | 建临时目录、拼 ffmpeg 参数、用 **stdin 管道**启动编码进程，返回任务 id |
| `video_push_frame(id, png)` | 收一帧（PNG 字节），写进 ffmpeg 的 stdin |
| `video_end(id, wavPath)` | 关 stdin、等编码完成、把 MP4 落到目标路径 |
| `video_cancel(id)` | 杀进程、清临时文件 |

**为什么走 stdin 管道**：1800 帧 PNG 落盘约 3–5 GB，且 Windows 上删临时目录经常被占用。
管道省磁盘、省清理、还快。

**为什么不用录屏 / MediaRecorder**：会掉帧、换台机器结果不同、窗口被遮就废、WebM 抖音不收。

---

## 四、数据契约（草案，实现时按需微调）

```ts
/** 一个镜头：从 t0 到 t1，亮这些矩形、停在这一行 */
export interface DynamicCue {
  t0: number
  t1: number
  /** 流式视图里的行号（已按演奏顺序展开，含反复） */
  row: number
  /** 同拍可能有多个声部 ⇒ 多个矩形 */
  rects: FrameRect[]
  pageIndex: number
  /** 第几遍（反复时用来显示 "1/2"），M3 才用 */
  pass?: number
}

export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
  /** 直接取 playhead.ts 的配色（已按声部/音色分好） */
  color: string
  alpha: number
}

/** 流式视图的一行：只记「从哪取图、贴到哪」，不重排内容（见 §3.1.1） */
export interface FlowRow {
  index: number
  pageIndex: number
  /** 该行在页面坐标系里的取图区间 */
  srcTop: number
  srcBottom: number
  /** 贴到条带上的纵坐标（同一段第二遍时 stripY 不同、pass 不同） */
  stripY: number
  t0: number
  t1: number
  pass: number
}

export interface FlowView {
  rows: FlowRow[]
  /** 整条带的总高（px） */
  stripHeight: number
  /** 画布宽高 */
  viewW: number
  viewH: number
  /** 当前行居中时的滚动偏移 */
  scrollYOf: (row: number) => number
}

export interface Frame {
  t: number
  row: number
  scrollY: number
  rects: FrameRect[]
  /** 已过行淡出 / 未来行压暗的强度（0~1） */
  dim: number
}
```

**两套坐标别混**（这是最容易写错的地方）：

- `DynamicCue.rects` 用**页面坐标**（直接来自 `playheadSegs` 的 `x/y`）；
- `Frame.rects` 用**条带坐标**，由 `frameAt` 按所在行的映射换算：
  `stripY_of_row + (rect.y − row.srcTop)`。
- 同一段音乐出现第二遍时，`pageIndex/srcTop` 不变、`stripY` 变 ⇒ 矩形跟着换位置，
  **不需要复制 cue 的几何数据**。

---

## 五、渲染管线（一步一步）

1. **排版**：用「视频用页面配置」跑一次 `layoutScore`（会话级，不写文件）。
   页宽 1080、页高 1920（引擎新增预设），约 4–6 行/页；行顶由 `computeRowTops` 给出。
2. **光栅**：**每一页**各渲染成一张 1080×1920 的 canvas（`svgToCanvas(scale=1)`）。
   不拼大图、不缓存整条带——单页画布约 8 MB，内存可控。
3. **拼条带**：按 `FlowRow` 从各页画布上裁行带、贴到 `stripY`；反复段多贴一次（同一个源区间）。
4. **预览**：`frameAt(t)` → 对可视行做
   `drawImage(pageCanvas, 0, srcTop, W, h, 0, stripY - scrollY, W, h)`，再画高亮与遮罩。
   浏览器里就能看动效，不用等编码。
4. **出片**：`t = n / fps` 逐帧重复第 3 步，`OffscreenCanvas.convertToBlob({type:'image/png'})`
   → `invoke('video_push_frame', ...)`。
5. **收尾**：`video_end` 让 ffmpeg 把 WAV 一起编进去，输出 MP4。

参数（建议第一版就这几个，别多）：

```
-c:v libx264 -profile:v high -pix_fmt yuv420p -r 30
-preset medium -crf 20 -maxrate 8M -bufsize 16M
-c:a aac -b:a 160k -ar 44100 -ac 2 -shortest -movflags +faststart
```

---

## 六、音频口径（第 4 条决策的准确落地）

用户口径是「两种都支持，桌面建议实时合成」。落地时要区分两个"实时"：

- **边播边录（不采用）**：音频长度由机器速度决定，与帧时间轴没有硬绑定，音画必错位。
- **现场合成 + 离线渲染（采用）**：`OfflineAudioContext` 把整曲渲染成 `AudioBuffer`。
  它对用户是"不用准备音频、点一下就合成"，对我们则是**确定的采样数与确定的时长**。
  现有 `src/export/audio.ts` 的 `renderToAudioBuffer()` 就是这条路，导出 MP3/WAV 已在用。

两条音源：

| `source` | 说明 | 状态 |
|---|---|---|
| `'synth'` | 现场离线渲染（默认，桌面） | M1 |
| `'file'` | 用户给的 WAV/MP3，按同一时间轴对齐 | 预留接口，M4 |

**对齐约定**（写死，别各算各的）：

- `t = 0` = 音频第 0 个采样 = 视频第 0 帧；
- 开头补 `leadInMs`（默认 300ms，画面淡入）、结尾补 `tailMs`（默认 800ms）；
- 视频总时长 = `ceil((音频时长 + 余量) / 1000 * fps)` 帧；
- 断言 D4 守这条：`|音频时长 − 帧表末尾 − 尾留白| ≤ 1 帧`。

⚠ 现有试听后端用 `setTimeout` 逐个排程（见 `src/playback/playbackTimeline.ts` 头注释），
**不能**拿来当视频主时钟。视频这条链路完全绕开它。

---

## 七、页面配置的层级（别踩 `adj480` 的坑）

视频用的页面配置（页宽、字号、边距、行距）是**会话级（L3）**：

- 只在导出 / 预览时算一次，**绝不写进 `.jps`**；
- 用户看到的 `.jps` 仍然是他自己的 A4 配置；
- 沿用 `adj480` 的口径：谱面自包含，导出不污染文件。

---

## 八、ffmpeg 怎么带（**已定：首次使用时下载**）

用户 2026-10-21 拍板：**首次使用时下载并缓存**，不随主安装包分发。

| 方式 | 结论 |
|---|---|
| 随包带 `ffmpeg.exe`（+约 80MB） | ✗ 主安装包会从 3MB 级涨到 80MB 级 |
| **首次使用时下载并缓存** | ✓ 采用；与现有音源库下载同一条路 |
| 用系统已装的 ffmpeg | ✗ 普通用户没有；报错难解释 |

**同时**：用户还要求把大件（音色库、ffmpeg）做成**独立的资源包安装器**。于是同一份
ffmpeg 会有**两个来源**，落成一条规则：

1. 先查本地（`assets/manifest.json` 记的路径）；
2. 没有 ⇒ 提示用户二选一：**在线下载**（小、快）或**安装资源包**（大、离线可用）；
3. 两处都不通 ⇒ 允许**手动指定 `ffmpeg.exe` 路径**（兜底，写进配置）。

⚠ 必须提供第 3 条。国内网络下"下载失败就只能放弃"会变成硬故障。

打包与卸载的完整设计见 **`docs/INSTALLER-ASSETS-PLAN.md`**。

---

## 九、断言清单（`npm run smoke`）

> 按项目规矩：先写断言再实现。每条都要有**负对照**意识（写得出红灯的样子）。

| 编号 | 断言 | 说明 |
|---|---|---|
| D1 | `frameAt(t)` 两次调用深度相等 | 确定性；视频可复现的根 |
| D2 | cue 首尾相接：起点 0、终点 = 总时长，无空洞无重叠 | 镜头表完整性 |
| D3 | 行号随时间**严格单调不减**，且每行 `t0 < t1` | 反复已展开成重复行，见 §十·5 |
| D4 | 音频时长与帧表末尾差 ≤ 1 帧 | 音画对齐 |
| D5 | 任一 cue 的矩形滚动后仍落在 `[0, viewH]` 内 | 高亮不出画 |
| D6 | 谱面墨迹不进入竖屏底部 15% 安全区 | 平台 UI 遮挡 |
| D7 | 同一时刻 N 个声部 ⇒ N 个矩形（不合并、不丢） | 多声部 |
| D8 | `t=0` 与 `t=总时长` 都能取到帧、不抛异常 | 边界 |
| D9 | `t_n = n/fps`，累计舍入误差 < 0.5 帧 | 帧率换算 |
| D10 | 现有 `playhead.ts` 的命中 / 配色断言不变 | 新层只消费，不改老口径 |

---

## 十、风险与已知坑

1. **位图内存**：按页光栅（每页一张 1080×1920，约 8 MB），不做整条带大图 ⇒ 内存可控；
   仍要限制同时缓存的页数（例如只留当前页 ±1 页），3 分钟的谱子可能有 30+ 页。
2. **字体**：视频用本机字体，换台机器字形会变 ⇒ 固定成品牌字体栈并写进文档（用户会问"为什么你那台不一样"）。
3. **长曲子**：3 分钟 = 5400 帧，按 20ms/帧约 2 分钟出片，可接受；必须有进度与取消。
4. **平台压缩**：抖音会二次压缩。高亮色要饱和、线要粗，竖屏下数字高度建议 ≥ 48px。
5. **反复 / 跳房子会让行号倒退**：`playheadSegs` 按演奏顺序展开，第 2 遍会回到第 1 行。
   **已定（用户 2026-10-21）：展开成重复行**——同一段音乐在条带上出现两次/多次，
   行号随时间严格单调、镜头不倒退。代价只是 `FlowRow` 多几条（同一源区间、不同 `stripY`），
   **不额外占位图内存**（见 §五）。
6. **临时文件**：即使走管道，WAV 仍要落盘；取消 / 崩溃后要能清干净（`video_cancel` + 启动时扫残留）。
7. **`svgToCanvas` 的字体等待**：`Image` 加载 SVG 时若字体未就绪，字形会回退。
   出片前要 `document.fonts.ready`，否则第一帧可能和后面不一样。

---

## 十一、里程碑

| 批次 | 内容 | 验收 |
|---|---|---|
| **M1-1** | 引擎：`timeline` + `flowView` + `frame.ts` + 预设 | D1/D2/D3/D8/D9 绿 |
| **M1-2** | 宿主：canvas 帧渲染 + 实时预览窗（浏览器里能看动效） | 肉眼对齐试听；切换主题不重排 |
| **M1-3** | 桌面：ffmpeg 管道 + 进度 + 取消 | 出一支 9:16 / 30fps / 单主题 MP4，能传抖音 |
| **M2** | 参数面板（尺寸 / 主题 / 歌词 / 范围）+ **A4 放大模式**（第二个 frame 源） | 两种视图都能出片 |
| **M3** | 节拍光标、渐入淡出、封面帧导出（指定帧出 PNG） | —— |
| **M4** | H5 承接页（复用 `frameAt`，AudioContext 驱动）+ 用户音频 `source:'file'` | 手机能点开就播 |

---

## 十二、已定与遗留

### 已定（用户 2026-10-21）

| 项 | 决定 |
|---|---|
| 第一出口 | 视频（H5 后置） |
| 平台 | 只做桌面端 |
| 竖屏排版 | 先流式视图 → 再补「A4 放大」→ 最终两种都保留 |
| 音频 | 两种都支持；桌面默认现场合成（= 离线渲染，见 §六） |
| 二维码 / 水印 | 只留参数位，暂不出功能 |
| ffmpeg | 首次使用时下载（见 §八） |
| 反复段 | 展开成重复行（见 §十·5） |
| 第一版配色 | **白底墨字**（像纸，平台压缩后仍清楚） |
| 时长上限 | **3 分钟**，超出提示并让用户选范围 |

**配色口径**：纸面 `#FFFFFF`、音符/歌词墨色 `#1b1b1b`（与品牌规范的「乐谱预览区」一致，
见 `docs/BRAND.md`）；高亮只用**一层半透明色块**，不改音符本身颜色；已过行整体降到 55% 不透明度。

### 遗留（实现中再定，不挡开工）

1. ffmpeg 的下载源（自有 CDN / GitHub Release）——发布前要定。
2. 封面帧：第一版是否自动出「首帧 PNG」当视频封面。
3. 节拍光标形态（跳动圆点 / 竖线）——M3 才做。
