# 外部伴奏 + 对拍（P0）实现方案

> 依据：`ijipu-mv/docs/P0-REQUIREMENTS.md`（需求单）+ 本仓库 0.74.2（`41a1b60`）的现有实现。
> 写这份文档时的实测/核对都在下面第 1 节，**行号按 0.74.2 记，提交后会移位**。
> 这份文档给"实现会话"用：按第 6 节的四步走，每一步都能单独验收。

---

## 〇、结论先说

1. **能做，而且比想象中省事**：`buildPlaySequence(parsed, layout, bpm)` 本来就收 bpm，
   `createDynamicSession(code, preset, pageConfig, bpm)` 也已经预留了 bpm 入参，
   `exportDynamicVideo` 只要把 `bpm` 透传下去，"谱面跟着伴奏走"就成立了。
   **音频不变速、不改 layout**，这条原则在现有代码里几乎没有阻力。
2. **最大的坑不是对拍，是 `&jz16` 这个语法**。实测：现在 `0&jz16` 会被拆成
   「休止符 + 音符 1 + 音符 6」三个元素（见 §1.2）。tokenizer 有 **4 处**各自独立的
   `&` 编码解析，必须一处不漏地改。
3. **`&jz` 不能走 `symbols`**。我查了渲染端：不认识的 `&` 编码会落到"音符上方画小文本"
   的兜底分支（`render/index.ts` 的 `sym` 循环，≈1040–1149 行），并把上方层顶抬高。
   放进 `symbols` 就等于"排版变了"，直接违反 P0 的"零宽"要求。必须新增独立字段。
4. **时长也不能进 `tokenDuration`**。layout（`layout/index.ts` 的 `tokenDurationOf`）
   与 playback 共用这个时值口径，改它会改占宽 ⇒ 排版动。
   正确做法：**layout 口径不动，只在播放时间轴里加"额外拍"**（§4-A3）。
5. **真正的难点是"间奏 16 拍"的落点**：事件时间和 `barStartsMs` 都是
   `组起点 + 小节起点 + 小节内拍位 × 拍长` 算出来的，加拍必须让**小节起点与小节内拍位
   同时顺延**，否则后面所有音都会错位（§4-A3 给了一处算清的算法）。

### 需要你拍板的事（详见 §8）

- 间奏小节要不要豁免"小节拍数不符"的告警（现在会报红字，实测见 §1.2）
- 伴奏文件要不要复制进 `%APPDATA%\iJipu\files`（要占空间）
- 对拍工作台放哪：相机位里加一条（我建议）还是独立弹窗
- `&jz16` 只认紧贴写法 `0&jz16`，还是带空格的 `0 &jz16` 也认

### 需要你配合的事（详见 §9）

- **真实谱 + 伴奏 mp3 都不在工作区**（`赤伶/绿野仙踪/知否知否/追光者/一生清贫/花又期二重奏`
  一个都搜不到），P0 验收 ①② 现在没法开工就做
- "间奏略"那几处到底多少拍（谱面没写，"16 拍"是你数出来的还是听出来的）
- 对拍的最终验收只能你听（<50ms 这条我没法自动测）

---

## 一、我看了什么、实测了什么

### 1.1 读过的实现（判断依据）

| 文件 | 我看到的关键事实 |
|---|---|
| `packages/ijipu-engine/src/engine/playback/sequence.ts` | `buildPlaySequence(result, layout, bpm, …)`（≈997 行）；布局拍位 `beatPos` 是**排版算的**；事件时刻 = `passMs + groupStartMs + barStartMsInGroup[bar] + beatPos × beatMs`（≈2459 行）；`barStartsMs` 由同一份小节起点记（≈1944/2476 行） |
| `packages/ijipu-engine/src/engine/layout/index.ts` | 拍位 `beatPos = cumBeat` 是**小节内累计拍**（≈2312/2326 行），时值只用 `tokenDurationOf`（≈6460 行）——**与 bpm 无关** |
| `packages/ijipu-engine/src/engine/parser/tokenizer.ts` | `&` 编码在 **4 处**解析：`collectSuffix`（≈259）、行内独立 `&`（≈531）、`-&`（≈995）、倚音内 `&`（≈789）；编码只收字母，`&dy5/` 的 `5` 故意留给下一个音 |
| `packages/ijipu-engine/src/engine/render/index.ts` | `symbols` 里不认识的编码会走"上方小文本"兜底（≈1144–1149），并抬高上方层顶 |
| `src/export/video/renderer.ts` | `createDynamicSession(code, preset, pageConfig, bpm?)` 已能收 bpm（≈168）；片头用"给事件 atMs 统一加 leadInMs"实现（≈188）；标记段用 `slicePlaySequenceByRange` 切片、时间归零（≈173–186）；`session` 返回 `events/bpm/totalMs/musicEndMs`（≈876） |
| `src/export/video/exportDynamic.ts` | 出片编排；`makeAudio(session)` 是音轨工厂（≈88–97）；**没有 bpm 入参** |
| `src/export/audio.ts` | `renderToAudioBuffer(events, sf2, {bpm})` → 44100 双声道 `AudioBuffer`（调 SpessaSynth 离线渲染） |
| `src/export/video/mp4.ts` | 音轨是 `AudioBuffer`，喂给 Mediabunny；`trimAudio` 把音轨截到画面长 |
| `src/preview/DynamicFrameOverlay.tsx` | 相机位（预览+出片）；音轨缓存 `audioBufferRef`；`renderAudioFor(session)` 走 HQ 音源 |
| `src/store/uiStore.ts` | L1 偏好写法：顶部常量 + `load*` 带 `try/catch` 兜底 + 越界钳制（`panMode`/`rowLeadBeats` 就是现成模板） |
| `src/export/video/cliWorker.ts` | 命令行出片是**第二个进程**，读本机偏好、不写配置 |
| `docs/DYNAMIC-SCORE-PLAN.md` §六 | 旧"对齐约定"写的是 `t = 0 = 音频第 0 个采样`，**与 P0 冲突**（P0 是"谱面 t=0 ↔ 音频 offset"） |

### 1.2 实测：`&jz` 现在根本不成立

用仓库自带的 CLI 解析（不是猜的）：

```
> node packages\ijipu-cli\dist\ijipu.cjs lint -i dist-smoke\_tmp_jz.jps
dist-smoke\_tmp_jz.jps 第 6 行：第 3 小节共 3 拍，与拍号 4/4（每小节 4 拍）不符
```

这份谱第 6 行写的是 `|: 0&jz16 |`。

**结论**：`0&jz16` 被读成「休止符(1 拍) + 音符 1(1 拍) + 音符 6(1 拍)」= 3 拍。
原因就是 `collectSuffix` 只收字母：`jz` 收走，`16` 留给主循环当音符。

再测"只写注记"的写法（你的谱集里就是这种）：

```
> node packages\ijipu-cli\dist\ijipu.cjs lint -i dist-smoke\_tmp_jz2.jps
dist-smoke\_tmp_jz2.jps 第 6 行：第 3 小节共 1 拍，与拍号 4/4（每小节 4 拍）不符
```

谱：`| 0"16拍间奏略" |`。

**结论两条**：
1. 注记只是文本，引擎现在**完全不看**它，播放时就是 1 拍静默；
2. 这种间奏小节**今天就在报"拍数不符"**。加了 `&jz16` 之后这条告警不会自己消失
   （因为排版不变、`tokenDuration` 不变）⇒ 需要专门处理（§4-A5，要你拍板）。

### 1.3 工作区当前状态（会影响开工）

写这份文档的过程中，另一个会话（S5）把 `adj1113`/`adj1114` 提交了。现在：

```
> git status --short   （ijipu/）
?? docs/EXTERNAL-ACCOMPANIMENT-PLAN.md      ← 只有这份新文档
> git log --oneline -2
02f8339 feat(adj1113/adj1114): 导出视频可选「不带片头片尾」；命令行 --card 可选值 + --nosound
41a1b60 chore(release): 0.74.2（导出视频封面 + 片尾网址写完整；插件 0.44.4 跟随）
```

⇒ **工作区是干净的，可以直接开工**。但要留意它刚动了我们也要动的四个文件
（`DynamicFrameOverlay.tsx` / `exportDynamic.ts` / `cliWorker.ts` / `smoke.mts`），带来两处影响：

1. `exportDynamicVideo` 多了 `cards?: boolean`，`cards:false` 时 `leadInMs = 0`。
   ⇒ 伴奏轨的"前置静音"**不能硬编码 3700ms**，必须读会话实际用的 `leadInMs`（§4-D1 已按这个写）。
2. 本文档里引用的行号是按 `41a1b60` 数的，`02f8339` 之后会漂几行，**按函数名找**。

### 1.4 基线冒烟（我跑了，绿）

在 `02f8339` 这个提交上跑的：

```
> npm run smoke
ALL SMOKE TESTS PASSED ✅
> 统计：✓ 4448 条，✗ 0 条
CLI 断言全部通过 ✅（169 项）
```

（第一次跑我自己踩了个坑：把日志 `Tee` 到 `dist-smoke\` 里，vite 清目录时
`EBUSY: unlink dist-smoke\_smoke_baseline.log` 直接构建失败。**日志别写进 `dist-smoke/`**。）

⇒ 第 1 步做完后，`npm run smoke` 必须是"4448 + 新增条数、✗ 仍是 0"。

---

## 二、现状核对：P0 五项各缺什么

| P0 需求 | 现有基础 | 缺什么 |
|---|---|---|
| ① 间奏时长 `&jzN` | 休止符 token 有 `symbols`/`comment`；`tokenDuration` 统一时值 | 语法（tokenizer 4 处）、字段（`interludeBeats`）、播放时间轴加拍、小节校验豁免 |
| ② 外部音轨 | `<input type=file>` 读取现成（`docStore`/`cardImageStore` 都有先例）；`AudioContext.decodeAudioData` 原生可用 | 选文件 UI、解码、波形、内存/落盘策略 |
| ③ 整段对拍 | `buildPlaySequence` 收 bpm；`createDynamicSession` 收 bpm | 纯函数（锚点→offset/beatMs）、把 bpm 透到出片、`sourceStartMs`（标记段要用） |
| ④ 分段锚点 | 无 | 数据形状 + 分段映射纯函数（全局一个 beatMs） |
| ⑤ 混音 | `renderToAudioBuffer` 出合成音轨 | 伴奏轨构建（补片头静音 + 截取）、两份 PCM 相加、音量 |
| 交互（工作台） | 相机位已有 canvas + 逐帧 `draw(ctx,t)` + 音频播放器 | 波形画布、锚点、循环试听、±5/10ms |
| 存储 | L1 偏好机制成熟（`ijipu.*` + 桌面落 `settings.json`） | 键设计、按谱归档、音频副本策略 |
| 出片 | `exportDynamicVideo({makeAudio})` | `bpm` 入参、外部音轨工厂 |
| 回归 | 不导入伴奏 = 老路径 | 所有新分支都要"无伴奏时完全不进" |

---

## 三、三条关键技术判断（先定，后面照着做）

### 3.1 `&jz16` 不进 `symbols`，新增独立字段

理由（实测代码）：
- `render/index.ts` 的 `for (const sym of t.symbols)` 兜底分支会把不认识的编码**画成上方小文本**，
  还会抬高 `aboveTop` ⇒ 谱面多出 "jz16" 三个字、行高可能变；
- 布局端也可能因为 `symbols` 变化而改变（`hasHx` 这类按 `symbols.includes` 判定的逻辑虽然不认 jz，
  但"零宽"这件事最好靠**根本没有字段**来保证，而不是靠"没人读它"）。

⇒ 在 `RestToken` 上加 `interludeBeats?: number`（可选、旧谱面形状不变）。
注记写法（`0"间奏16拍"`）**不写进 token**，用的时候从 `comment` 现读——这样连解析都零风险。

### 3.2 layout 时值不动，只在"播放时间轴"里加拍

- `tokenDuration` 是全引擎唯一的时值口径，layout 用它算占宽、算拍位；
- 间奏必须是**零宽**，所以 layout 这一侧一个数都不能变；
- 播放侧的"加拍"不是改时值，而是**把这一刻之后的播放时刻整体后移**（§4-A3）。

### 3.3 音频不变速 = 换 `bpm`，不是换 `offset`

数学只有一行：

```
audioMs(谱面时刻 t) = offset + t
```

其中 `t` 是**用 bpmAudio 重建后的播放序列时刻**（`t = 拍 × beatMs`）。
所以：

- 对拍解出 `beatMs`（→ `bpmAudio = 60000 / beatMs`）与 `offset`；
- 用 `bpmAudio` 调 `buildPlaySequence` / `createDynamicSession`；
- 音轨从伴奏的 `offset` 处开始，与谱面同速走。

**⚠ 一个必须注意的"退化"**：锚点不能用"毫秒"当自变量。若锚点写成"谱面第 X 毫秒 ↔ 音频第 Y 毫秒"，
方程恒等于 `Y = offset + X`，解不出 beatMs（任何 beatMs 都成立）。
锚点必须用**音乐拍位**（小节/拍，或"从曲首算第几拍"），它是**与速度无关**的量。

---

## 四、改动清单

### A. 引擎：间奏 `&jzN`

#### A1. 类型（`packages/ijipu-engine/src/engine/types.ts`，`RestToken` ≈237–259）

```ts
/** 间奏拍数（`0&jz16` → 16）：**只影响播放时长，不影响排版**（零宽） */
interludeBeats?: number
```

同理可在 `RhythmToken` 上留同名字段（先不加，`&jz` 写在节奏符上直接告警）。

#### A2. 语法（`parser/tokenizer.ts`）——四处都要改

1. **`collectSuffix`（≈259）**：`&` 后收字母得到 `code` 后，若 `code === 'jz'`，**继续吞数字**
   （`&jz16` → `16`），写进 `base.interludeBeats`；数字非法/缺失（`0&jz`）→ 告警
   「`&jz` 后面要写拍数，如 `&jz16`」，按 1 拍处理。
2. **行内独立 `&`（≈531）**：同一条规则。这样 `0 &jz16`（带空格）也认——但它会先落成
   `decoration` token，需要一个"挂回前面的休止符"的分支（推荐：识别到 `^jz\d+$` 且上一个 token
   是 rest ⇒ 直接写进该 rest，不生成 decoration）。
3. **`-&` 分支（≈984–1010）**：`0-&jz16`（先增时再写 jz）也要认，且 `zkh/ykh/hx` 的独立化
   判断不能受影响。
4. **倚音内 `&`（≈789）**：`jz` 不在 `GRACE_MARK_CODES` 里，走现有的"倚音不支持修饰符"告警即可
   （**别加**进去，否则一个倚音带 16 拍会更乱）。

另外：写在**音符**上（`1&jz16`）要告警「`&jz` 只能写在休止符 `0`/`8` 后面」，并且**不生效**
（避免"音符突然拉长 16 拍"这种不可预期的行为）。

#### A3. 播放时间轴（`playback/sequence.ts`）

目标：让"这个休止符 = N 拍静音"，其后所有事件（含小节起点、跳房子/反复、段层事件）整体顺延，
**而 layout 一个字不动**。

要改 6 处（都按 0.74.2 行号）：

1. **`blockBeatsOf`（≈1854–1864）**：累加时用 `tokenDuration(tk) + jzExtra(tk)`。
   `jzExtra(tk) = max(0, interludeBeats - tokenDuration(tk))`。
   （若谱面写 `0---&jz16`，休止本身 4 拍，额外 12 拍。）
2. **`bsMsOf`（≈1866–1876）**：同样加 `jzExtra`。**小节起点从这里来**，加对了后面小节自动对。
3. **小节内拍位映射**：新增一份 `playBeatOf(group, bar, beatPos)`：
   - 先扫一遍 `result.groups[gi].music.tokens`，按 `小节线 → bar+1、beat 归零` 的口径
     记录每个 `jz` 休止的 `(bar, beatPos, extra)`（这份口径与 layout 的 `barIdx/cumBeat` 完全一致）；
   - 查表：`beatPos + Σ(同 bar 且 at < beatPos 的 extra)`。
4. **事件时钟**：主旋律 ≈2459 行的 `bp * beatMs` 换成 `playBeatOf(...) * beatMs`；
   段层事件（`emitSegmentEvents` ≈2216 行）同样换。**两处都要**，否则 `{bz}/{dsb}` 会错位。
5. **`absBeatOf`（≈2064）**：替谱段（`{tp}`）用的"跨小节绝对拍"是**排版拍**口径，
   不能跟着变。现在它用 `barStartMsInGroup/beatMs` 折算，加了 extra 之后就不纯了
   ⇒ 顺手改成用一份**排版口径的小节起点拍数组**（`barStartBeatsInGroup`），语义更清楚。
6. **`totalMs`（≈3169–3171）**：现在是 `max(lastEndMs, segEndMs)`，**曲末的间奏会被吃掉的**。
   改成：有 `jz` 时 `max(块总长, lastEndMs, segEndMs)`；没有 `jz` 时保持原样（**保证零回归**）。

#### A4. 断言（写在 `scripts/smoke.mts`）

- `&jz16` 解析成 `interludeBeats: 16`，`symbols` 里**没有** jz；
- `0"间奏16拍"` / `0"16拍间奏略"` 两种注记都能读出 16；
- `0&jz16 | 1 |` 的序列：第 1 个音 `atMs = 0`、下一个音 `atMs = 16 × beatMs`；
- **负对照**：把 `interludeBeats` 抹掉 ⇒ 下一音回到 1 拍处（判据必须能变红）；
- 小节起点：`barStartsMs` 里第 2 个小节 = 16 拍（不是 1 拍）；
- 不动排版：同一份谱加/去 `&jz16`，`layout` 的每个音符 `x/y/width` **逐字段相等**；
- 曲末 `0&jz16` 的 `totalMs` 含那 16 拍。

#### A5. 小节校验（`engine/measures.ts` ≈129–146）——要你拍板

实测现状：`0"16拍间奏略"` 会报「第 3 小节共 1 拍，与拍号 4/4 不符」。
P0 建议：**含间奏标记的小节跳过这条校验**，另给一条 `info` 级提示
「第 3 小节：间奏 16 拍（不计入小节时值）」。理由：这条红字会一直挂着，用户会以为谱写错了。

不这么做的替代：让用户把间奏小节写满（`0---`）+ 再写 `&jz16`，红字消失，但多写 4 个字符、
且"16 拍"和"4 拍"两个数并存容易误会。

#### A6. 已知限制（写进文档，不要在 P0 里硬解）

- **多声部**：`&jz` 写在哪个声部，只顺延那个声部。要多个声部一起顺延，就得每个声部都写。
- **`{bz}/{dsb}` 段内**：段层时间轴是另一套构造，P0 不支持（写进去给告警）。
- **曲末间奏**：`track.endMs` 只算到最后一块色块，所以"最后一音之后还有 16 拍间奏"不会延长视频
  （`totalMs` 会延长，但 `renderer` 用的是 `track.endMs`）。P0 只保证"间奏后面还有音"的情形。

### B. 引擎：对拍纯函数（新文件 `playback/sync.ts`）

```ts
/** 一个锚点：谱面拍位 ↔ 伴奏毫秒 */
export interface SyncAnchor { beat: number; audioMs: number }
/** 分段：从 startBeat 这一拍起，伴奏对应 audioStartMs */
export interface SyncSegment { startBeat: number; audioStartMs: number }
/** 对拍结果：全局一个 beatMs；segments 至少一条（整段时 = [{startBeat:0, audioStartMs:offset}]） */
export interface SyncMap { beatMs: number; segments: SyncSegment[] }

/** 两个锚点精确解；三个以上最小二乘（线性回归 b→a） */
export function fitSync(anchors: SyncAnchor[]): { offset: number; beatMs: number } | null
/** 整段 → SyncMap */
export function syncMapOf(fit: { offset: number; beatMs: number }): SyncMap
/** 拍 → 伴奏毫秒（分段线性；段内同斜率，段间可跳） */
export function audioMsOfBeat(map: SyncMap, beat: number): number
/** 伴奏毫秒 → 拍（反解；工作台点波形用） */
export function beatOfAudioMs(map: SyncMap, ms: number): number
/** 谱面毫秒（播放序列时间）→ 伴奏毫秒 */
export function audioMsOfScoreMs(map: SyncMap, scoreMs: number): number
export function bpmOfSync(map: SyncMap): number
```

约定（写进函数头注释，改动前先看）：
- **拍 0 = 播放序列时间 0**（= 曲首，片头静音之前）；
- 整段时 `audioMs = offset + 谱面毫秒`；
- 分段时 `audioMs = audioStartMs_k + (拍 - startBeat_k) × beatMs`；
- `beatMs` 全局唯一（P0 不做段内变速）。

导出到 `playback/index.ts` 与 `engine/index.ts`（与 `buildPlaySequence` 同一段导出区）。

### C. 宿主：伴奏导入 / 解码 / 波形 / 混音

#### C1. 选文件（两条路，二选一，拍板项见 §8）

- **路 A（零 Rust 改动）**：`<input type="file" accept="audio/*,.mp3,.m4a,.wav,.flac">`
  → `File.arrayBuffer()` → `decodeAudioData`。缺点：拿不到路径、关了就得重选。
- **路 B（推荐）**：加一个 Rust 命令 `mv_pick_audio`（`tauri-plugin-dialog` **已经是 Rust 依赖**，
  照 `ws_pick_dir` 的写法加 `set_title` + `add_filter("音频", ["mp3","m4a","wav","flac"])`），
  返回路径后由 Rust **复制**到 `%APPDATA%\iJipu\files\<hash>.<ext>`（同 `prefs_blob_*` 的落点，
  见 `docs/DATA-STORAGE.md` 的"L1 大文件"），配置里只存 `ijipu-audio:<名>`。
  好处：重开/换机（同机）还在；不占 IPC 的 base64。

> 为什么倾向路 B：`decodeAudioData` → `AudioBuffer` 只是内存里的东西，
> 一关相机位就没了。P0 的动线是"导入 → 调 → 再调 → 出片"，中途关掉再开很常见。

#### C2. 解码 + 波形（`src/export/video/accompaniment.ts`，新）

- `decodeAccompaniment(bytes): Promise<AudioBuffer>`：`new AudioContext().decodeAudioData(...)`；
- `waveformPeaks(channels: Float32Array[], buckets: number): { min: number; max: number }[]`
  ——**纯函数**（Node 里可断言），按桶取 min/max）；
- `fileMsOfArrival` 之类不要；音频元信息（文件名、时长、采样率）单独一份内存对象。

#### C3. 建"伴奏轨"（同文件）

```ts
/**
 * 把伴奏裁成"会话时间轴"的一条 AudioBuffer：
 *  - 前 leadInMs 静音（片头卡）；
 *  - 从 sync 算出的起始毫秒开始放；
 *  - 总长 = session.totalMs（放完就静音）。
 * 输出固定 44100 双声道，与 renderToAudioBuffer 一致 ⇒ 后面能直接相加。
 */
export async function buildAccompanimentTrack(
  audio: AudioBuffer,
  map: SyncMap,
  session: DynamicSession,   // 需要 leadInMs / sourceStartMs / totalMs
): Promise<AudioBuffer>
```

实现要点：`OfflineAudioContext(2, ceil(totalMs/1000*44100), 44100)` +
`source.start(leadInMs/1000, audioMsOfScoreMs(map, session.sourceStartMs)/1000)`。
（浏览器会自动把 48k 的 mp3 重采样到 44.1k。）

#### C4. 混音（`src/export/audioMix.ts`，新；纯 PCM）

```ts
/** 两份（或更多）同采样率、同长度的 PCM 按增益相加，clamp 到 [-1,1] */
export function mixPcm(
  tracks: { channels: Float32Array[]; gain: number }[],
  len: number, sampleRate: number,
): AudioBuffer   // 外层薄壳；核心计算是纯函数，Node 可测
```

- 默认**替换**：直接用伴奏轨（不调 SpessaSynth ⇒ 连音色库都不需要，出片更快）；
- 混合模式：`renderToAudioBuffer(session.events, sf2, {bpm: session.bpm})` + 伴奏轨 →
  `mixPcm([{synth, gain: 0.5}, {accomp, gain: 0.8}], ...)`。

### D. 会话与出片接线

1. **`DynamicSession` 加两个字段**（`renderer.ts` 的返回对象）：`leadInMs`、`sourceStartMs`。
   - `leadInMs`：会话实际用的片头时长（`cards:false` 时是 0，见 §1.3）；
   - `sourceStartMs`：标记段切片前、被切掉的那段时长（`seq.events[cand.i0].atMs`，切之前取）；
     整曲 = 0。
   ⇒ 音轨工厂只靠 `session` 就知道该从伴奏哪儿开始，不必回调方另算。
2. **`exportDynamicVideo` 加 `bpm?: number`**，透传给 `createDynamicSession`（第 4 个参数）。
3. **`makeAudio` 的两种实现**：
   - 界面：伴奏（或混音）→ `buildAccompanimentTrack` / `mixPcm`；
   - 命令行：**P0 不变**（CLI 没有伴奏字段，见 §7-P15）。
4. **预览**：`DynamicFrameOverlay` 的 `renderAudioFor` 按"声音来源"分叉；
   音轨缓存失效条件里加上"伴奏变了 / sync 变了 / bpm 变了"。

### E. UI：对拍工作台

推荐：**在相机位里加一条可折叠的"对拍条"**（不新开弹窗）。理由：
它要复用同一份 `session`（画布 + 逐帧 `draw`），弹窗反而要把会话搬来搬去；
而且 P0 的工作流是"调一点、看一眼画面"。

内容（自上而下）：

1. 一行：`导入伴奏…` / 文件名 · 时长 · 采样率 / 声音来源（合成音·伴奏·混合）/ 音量两个滑杆；
2. **波形 canvas**（高 ~90px）：包络 + 拍刻度 + 小节刻度（小节刻度 = `barStartsMs` 经 `sync` 映射到伴奏毫秒）+ 两条锚点竖线；
3. **两行刻度尺**：`谱面拍`（点一下记"拍"）、`伴奏毫秒`（点一下记"毫秒"）；
   两下配成一条锚点，≥2 条自动解 `offset/beatMs`（≥3 条走最小二乘）；
4. `循环试听`：从当前锚点所在拍开始，循环 1 小节（音频用 `source.loop`，以文件内秒为界）；
   画面 `paint(leadInMs + 拍 × beatMs)` 只画一帧；
5. `±5ms / ±10ms`：改 `offset`（只平移，不动 beatMs）；
6. 状态行：`拍速 96.4 → J: 96`、`偏移 3.2s`、`锚点 2 条`、`残差 ±12ms`（三条以上时给残差，帮用户判断锚点选得准不准）。

**关键：改完立刻重建会话**（`bpm` 变了，`events` 全变），与现有 `useEffect` 依赖同一套。

### F. 存储（L1）

桌面落 `%APPDATA%\iJipu\settings.json`（经 `store/prefs.ts` 门面），网站落 `localStorage`。

| 键 | 形状 | 说明 |
|---|---|---|
| `ijipu.mvSync.index` | `{ [谱键]: SyncEntry }` | 对拍参数按谱归档 |
| `ijipu.mvAudioSource` | `'synth' \| 'file' \| 'mix'` | 声音来源（L1） |
| `ijipu.mvMixGain` | `{ accomp: number; synth: number }` | 两个音量（0~1，钳制） |

`SyncEntry`：

```ts
{
  version: 1,
  fileName: string,          // 伴奏文件名（给人看 / 换机器时找文件）
  audioRef?: string,         // 路 B：`ijipu-audio:<名>`；路 A 无
  audioDurationMs: number,
  beatMs: number,
  segments: { startBeat: number; audioStartMs: number }[],
  /** 伴奏调性（手选，A/#A/B/…）；空 = 没填 */
  key?: string,
  /** 存的时候谱面的指纹（FNV-1a）——用来提示"谱改过了，锚点请复核" */
  codeHash: string,
  updatedAt: string,
}
```

- **谱键**：`nativePath ?? fileName`（同一台机器上唯一标识"这份谱"）。不按源码指纹做键，
  否则改一个错字对拍就丢了；
- **不写进 .jps**（P0 明确要求），也不进 `# jps-config`（L2）；
- 谱面 `codeHash` 变了 ⇒ 相机位显示一条淡提示「谱面改过，对拍参数还是上次的」；
- 调性提示：`SyncEntry.key` 与解析结果 `header.key` 不一致 ⇒ 提示
  「谱面 B 调、伴奏 A 调，注意音高」——**P0 只做手选比对，不做自动识调**（见 §7-P14）。

### G. 文档与断言

- `docs/SYNTAX.md` 增 `&jzN` 一节（位置建议紧邻 `&hx`），写清：只写休止符后、N 是**绝对拍数**、
  **不影响排版**、多声部要各声部都写、段内不支持；
- `docs/DYNAMIC-SCORE-PLAN.md` §六 的"对齐约定"要改（旧口径 `t=0 = 音频 0` 作废，
  新口径 = `audioMs = offset + 谱面时刻`，片头静音由 `leadInMs` 补）；
- `docs/USER-GUIDE.md` 增"外部伴奏与对拍"一节；
- `docs/ERRORS-LOG.md`：本功能踩的坑按 `E-2026-NNN` 记；
- `docs/SETTINGS-AUDIT.md`：登记 3 个新 L1 键；
- `scripts/verify-app-ui.mjs`：新按钮/新面板的"点了要动"必须真浏览器点一遍（adj959 的教训）。

---

## 五、数据流（一图看清）

```
导入 mp3 ──decodeAudioData──▶ AudioBuffer（内存/可选落盘）
                                   │
谱面 ──parse──▶ layout（不动）      │
        └──▶ buildPlaySequence(parsed, layout, bpmAudio)   ← bpmAudio 由对拍反推
                    │
                    ├─ events（atMs = 拍 × beatMs + leadIn）
                    ├─ barStartsMs ──▶ 相机/跳跳球/波形小节刻度
                    └─ totalMs
                                   │
对拍 SyncMap ──▶ buildAccompanimentTrack(audio, map, session) ──▶ 伴奏轨
                                   │
（混合模式）renderToAudioBuffer(events, sf2) ──▶ 合成轨 ──mixPcm──▶ 最终音轨
                                   │
                        createDynamicSession(...) ──▶ draw() 逐帧
                                   │
                          encodeMp4(session, {audio}) ──▶ MP4
```

---

## 六、分四步落地（每步可独立验收）

> 编号取当时 `git log` 最大 `adj` +1（`02f8339` 之后是 `adj1115`；开工前再看一眼，别的会话可能先占）。

### 第 1 步（引擎，1 天）：`&jzN` 打通

- 改 `types.ts` / `tokenizer.ts`（4 处）/ `sequence.ts`（6 处）/ `measures.ts`；
- smoke 断言 7 条 + 负对照；
- **验收**：`npm run smoke` 从"✓ 4448 / ✗ 0"变成"更多条 / ✗ 0"；用一份带 `0&jz16` 的谱，
  `play -t midi` 看第二个音是否晚 16 拍；
  同一份谱加/去 `&jz` 的 layout 逐字段相等。
- 顺带更新 `docs/SYNTAX.md`。

### 第 2 步（宿主，1~1.5 天）：导入 + 波形 + 只调偏移

- `accompaniment.ts`（解码/波形/建轨）+ 相机位"导入伴奏"与波形显示；
- 只支持"一个锚点"（只调 `offset`，`beatMs` 用谱面 `J:`）——先把"人对得上眼"跑通；
- **验收**：导入 mp3，波形能看、能播、能循坏；`offset` 一改，音画一起动；不导入时行为与今天一致。

### 第 3 步（对拍 + 出片，1.5 天）：两锚点解 beatMs

- `sync.ts` + 工作台（两锚点 + ±5/10ms + 残差）；
- `exportDynamicVideo` 收 `bpm`，出片用伴奏轨；
- **验收**：P0 验收 ①（赤伶 + 伴奏）人耳 <50ms；导出 MP4 音画同源、时长一致（无"画面 3:00、声音 3:42"）。

### 第 4 步（兜底 + 打磨，1 天）：分段锚点 + 混音 + 调性提示 + 存储

- 分段锚点（全局一个 `beatMs`）、混合音量、调性比对、`SyncEntry` 落 L1、`codeHash` 提示；
- **验收**：P0 验收 ②（"间奏略"那份加 `&jz` 或分段锚点后能对齐）；
  P0 验收 ③（不导入伴奏，整条链路与今天一致：`npm run smoke` + 手工回归）。

---

## 七、目前存在的问题（按"会不会挡路"分三档）

### 会挡路

- **P1 `&jz16` 现在被拆成两个音**（实测 §1.2）。语法不改，后面全是空中楼阁。
- **P4 真实谱不在工作区**：`赤伶 / 绿野仙踪 / 知否知否 / 追光者 / 一生清贫 / 花又期二重奏`
  一份都没有（工作区只有 9 个示例谱）。P0 验收 ①② 做不了。
- **P5 伴奏音频也没有**：工作区里没有任何 mp3/m4a/wav。
- **P3 四个关键文件刚被另一个会话改过**（`02f8339`，`adj1113/1114`）：`DynamicFrameOverlay.tsx` /
  `exportDynamic.ts` / `cliWorker.ts` / `smoke.mts`。现在工作区干净、可以开工，但**动手前先看一眼
  `git status`**：如果又出现别人的未提交改动，先停下来问，别硬改（本工作区允许会话并行）。

### 会踩坑

- **P6 引擎改动要进 Obsidian 插件**：`types.ts` / `tokenizer.ts` / `sequence.ts` 都在
  `vendor/engine` 同步范围 ⇒ 插件要同步引擎、升插件版本、跑插件 smoke（`adj733/767/770` 三道闸门）。
  只改应用不同步插件 = 插件里 `&jz` 不生效，而且闸门会红。
- **P7 旧文档口径冲突**：`DYNAMIC-SCORE-PLAN.md` §六 写死 `t=0 = 音频第 0 采样`，
  与 P0 的"谱面起拍 ↔ 音频 offset"相反。照旧文档实现必错。
- **P2 间奏小节一直在报"拍数不符"**（实测 §1.2）。不处理的话，用户加了 `&jz` 还是满屏红字。
- **P8 片头卡显示的速度是谱面 `J:`**（`renderer.ts` 的 `introMeta.tempoNum`）。对拍后实际 bpm
  变了（比如谱面写 80、实际 96.4），卡片会写错。要么改成显示实际 bpm，要么按谱面写（要拍板）。
- **P9 间奏期间画面是"静止的"**：16 拍里没有色块，相机不动、球会按 `ballAt` 的空拍补位慢慢飘过去。
  推广视频里 8 秒不动有点闷——P0 先接受，P0.5 再决定是否叠"间奏"字样。
- **P10 3 分钟上限与对拍互相影响**：`maxMs` 会"切在最后一个完整小节"，bpm 一变，切点也变；
  音频会被 `trimAudio` 截到画面长（正常，但要写进用户文档，否则用户以为丢音乐）。
- **P11 伴奏比谱长（尾奏）会被截掉**：P0 不做"尾部多留 N 秒"。

### 只是限制（写进文档即可）

- **P12 曲末间奏不延长视频**（§A6）：`track.endMs` 只到最后一块色块。
- **P13 段内 `{bz}/{dsb}` 的 `&jz` 不支持**；多声部要每个声部各写一份。
- **P14 <50ms 这条没法自动测**：对拍只能人耳。自动化能守的是"数学"和"接线"：
  映射公式、序列顺延、混音长度、`bpm` 是否真的透传到会话。
- **P15 CLI 出片不带伴奏**：任务文件没有音频字段。P0 明确不碰；P1 再加 `--audio/--sync`
  （技术可行：出片窗口能只读本机偏好）。
- **P16 波形内存**：4 分钟 mp3 解码后 ≈ 80MB（44.1k 双声道 Float32）。P0 只留一份、
  关相机位就释放；不做多首缓存。

---

## 八、要你拍板的事

| # | 问题 | 我的建议 | 代价 |
|---|---|---|---|
| 1 | `&jz16` 只认紧贴写法，还是 `0 &jz16`（带空格）也认？ | **两种都认**（tokenizer 多一条"挂回上一个休止符"的分支，约 20 行） | 多一处语法分支要维护 |
| 2 | 间奏小节要不要豁免"小节拍数不符"告警？ | **豁免**，改报 `info`「间奏 N 拍（不计入小节时值）」 | 校验行为变化，要写进文档 |
| 3 | 伴奏文件复制进 `%APPDATA%\iJipu\files`？ | **复制**（路 B）。一首 5MB，换来"关了还在、出片不依赖原文件" | 占磁盘；要加一个 Rust 命令 |
| 4 | 对拍参数按什么键存？ | **`nativePath ?? fileName`** + 存 `codeHash` 做"改过"提示 | 改文件名会丢参数 |
| 5 | 工作台放哪？ | **相机位里加一条可折叠的对拍条** | 相机位会更"满"；若你嫌挤就改弹窗 |
| 6 | 伴奏调性怎么来？ | **手选下拉**（P0 不做自动识调） | 用户要多填一个字段 |
| 7 | 间奏期间画面？ | P0 **保持静止**，先看效果 | 8 秒不动可能发闷 |
| 8 | 片头卡的 `J:` 显示哪个？ | **显示实际拍速**（对拍后），并在括号里标谱面原值 | 卡片文案要改 |
| 9 | 引擎改了要不要一起发插件？ | **要**（不同步必红闸门） | 多一轮插件发布 |
| 10 | 尾奏超长怎么处理？ | P0 **截掉**，文档写清 | 用户可能觉得音乐被切 |

---

## 九、需要你配合的内容

### 资料（缺了就没法验收）

1. **真实谱**（至少 `赤伶.jps` + `绿野仙踪.jps`，最好把带「间奏略」的那几份都给）+ **伴奏 mp3**
   （至少 `赤伶A调伴奏.mp3`）。
   放到工作区某个目录（比如 `D:\Coding\JianpuScript\.dsh-tmp\p0\`）并把路径告诉我。
   我先读一遍这 5 处的实际写法，确认 `&jz` 的语法形态够不够用。
2. **"间奏略"那 5 处到底多少拍**：谱面写的是"略"，"16 拍"这个数是你数出来的、还是听出来的？
   如果每条都不一样，`&jzN` 的 N 要逐处填，可能要写个对照表。
3. **《赤伶》的调性**：谱面 `D:` 是 B 调还是别的？伴奏是 A 调？——决定第 4 步"调性提示"值不值得做。

### 环境/操作

4. **人耳验收**：P0 验收 ①② 只能你来听。我会给出"听什么"的具体做法（改 ±10ms 各出一版，盲听哪版更咬合）。
5. **`tauri dev` 跑一次**（只在走路 B 时需要）：我这边不能开 GUI，`mv_pick_audio` 与
   `%APPDATA%\iJipu\files` 的落盘要你实机确认一次。
6. **基线我已经跑过**（§1.4：✓ 4448 / ✗ 0，CLI 169 项全过）。开工后每次改完照旧跑 `npm run smoke`；
   如果红灯，先用 `git stash` 比一比是不是自己引起的。

### 协作口径

7. 引擎改完，插件那侧是否由我这边一并同步 `vendor/engine` + 升插件版本，还是留给插件会话？

---

## 十、验收与命令

```powershell
# 基线（开工前、每次改动后）
cd D:\Coding\JianpuScript\ijipu
npm run smoke     # 现在的结果：✓ 4448 / ✗ 0 + CLI 169 项

# 语法与时间轴（第 1 步）：自己写一份临时谱，放在工作区 .dsh-tmp/ 下
# ⚠ 别放 dist-smoke/——vite 构建会先清空它
node packages\ijipu-cli\dist\ijipu.cjs lint -i ..\.dsh-tmp\p0\jz.jps
node packages\ijipu-cli\dist\ijipu.cjs play -i ..\.dsh-tmp\p0\jz.jps -t midi -o ..\.dsh-tmp\p0\jz.mid

# 真浏览器点一遍（第 2~4 步，UI 改动必跑）
npm run verify:app-ui
```

**正向判据**
- `npm run smoke` 全绿，新增断言 ≥12 条（间奏 7 + 对拍 5），带负对照；
- 不导入伴奏时，同一份谱的 `session.events` 与改动前**逐字段相等**（回归）；
- 出片：`ffprobe`（或 Windows 属性）看到的音轨长 = 视频长（±1 帧）。

**负向判据（必须能变红的）**
- 把 `interludeBeats` 抹掉 ⇒ 间奏后第一个音的 `atMs` 必须变回 1 拍，断言红；
- 把 `playBeatOf` 换回 `beatPos` ⇒ 小节起点断言红；
- 把 `bpm` 透传删掉 ⇒ "会话 bpm == 对拍 bpm"断言红；
- 把 `leadInMs` 从伴奏轨里去掉 ⇒ "音轨前 leadInMs 为静音"断言红。

---

## 十一、可直接粘贴的开工开场白（给实现会话）

```
工作区 D:\Coding\JianpuScript，做 ijipu 的 P0「外部伴奏 + 对拍」。

先读：
 1) ijipu-mv/docs/P0-REQUIREMENTS.md（需求）
 2) ijipu/docs/EXTERNAL-ACCOMPANIMENT-PLAN.md（实现方案，看 §4 改动清单、§7 问题、§8 拍板项）
 3) ijipu/AGENTS.md（引擎零 DOM、含中文文件只用编辑器工具改、adjNN 编号）

开工顺序（方案 §6 的四步，别跳）：
 第 1 步只做引擎 &jzN：types.ts / tokenizer.ts（4 处 &）/ playback/sequence.ts（6 处）/
   measures.ts；先写 smoke 断言再实现。验收：npm run smoke 全绿 + 同谱加去 &jz 的 layout 逐字段相等。
 第 2 步才碰宿主（导入/波形/只调 offset）。

硬约束：
 - 不改 layout、不改音频速度、不加新依赖；无伴奏时行为必须与今天逐字段一致。
 - 引擎改动会进 obsidian-ijipu/vendor/engine，插件要同步并升版本、跑插件 smoke（adj733/767/770）。
 - 开工前先 git status：若 DynamicFrameOverlay.tsx / exportDynamic.ts / cliWorker.ts / smoke.mts
   有别人的未提交改动，先停下来问用户，别硬改。

验收命令：npm run smoke；UI 改动另跑 npm run verify:app-ui。
人耳验收（<50ms）由用户做，我这边只保证数学与接线。
```
