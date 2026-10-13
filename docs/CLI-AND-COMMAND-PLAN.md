# 方案：iJipu 命令行（桌面端 CLI）与「嵌入版供 Obsidian 调用」命令 API

> 状态：**设计方案（历史记录）+ 裁决台账**。**当前口径看 §八「已裁决」**（含 2026-10-11 **二次裁决**：
> CLI = 独立 Node 包 `@ijipu/cli`，`ijipu.exe` 保持**纯 GUI**、不做子命令）。⚠ 本文里 A2/A3 等章节是
> **方案设计**，不等于现状 —— 曾经因为把这里的设计当成现状写进 `docs/CLI.md`，导致用户实测
> `ijipu.exe --help` 弹 UI（见 `docs/ERRORS-LOG.md` 的 `E-2026-390`）✗。
> 两套方案各自独立，可分别决定"做/不做/先做哪一段"。
> 已按项目既有铁律校准：**引擎纯 TS 零 DOM**（§一）、**数值口径同源**（§六之二·4）、
> **设置分层 L0/L1/L1.5/L2**（§七）、**新增依赖必须先询问**（§一）、**adj 编号 + 断言**（§三·2、§六之二·5）。

---

## 〇、先看清可复用的资产（决定了方案的性价比）

| 资产 | 位置 | 对 CLI / 命令 API 的意义 |
|---|---|---|
| 纯 TS 引擎（零 React/DOM，Node 可跑） | `packages/ijipu-engine/src/engine` | **CLI 与插件 API 都能直接调用**，不必重写任何排版/渲染逻辑 |
| `parseJps` / `formatJps` / `tokenizeJps*` / `layoutScore` / `renderScoreToSvg` | 同上 `index.ts` | `lint` `format` `info` `render -t svg` **几乎免费** |
| `eventsToMidi` / `pcmToWav` | 引擎 `playback/*` | `play -t midi` 免费；`wav` 还差"离线合成"（需 AudioContext + 音色库） |
| 应用导出实现 | `src/export/{export,audio,print}.ts` | SVG 纯字符串 ✓；PNG/JPG/PDF 走 **canvas** ✗；WAV 走 **AudioContext + SF2** ✗ |
| Tauri 侧已解析 `.jps` 参数 | `src-tauri/src/lib.rs`（`jps_paths_from_os_args`） | CLI 参数入口可沿用同一处判断（"双击打开文件"不能被 CLI 破坏） |
| 插件本机 HTTP 服务（端口 47821） + iframe 嵌入版 | `obsidian-ijipu/src/embed/{server,appView}.ts` | **Obsidian→嵌入版的通道已存在**，方案 B 不必新造传输 |

**一条贯穿两方案的架构原则**：CLI 与插件都只做"**参数/IO 壳**"，几何与渲染**一律复用引擎** ——
否则必然违反"数值口径同源"（§六之二·4），出现"应用对、CLI 不对"的分裂。

---

## 方案 A：桌面端 CLI（`ijipu <命令> [参数]`）

### A1 目标 / 非目标
- **目标**：可脚本化、可批处理、退出码稳定、**与 GUI 完全同一套引擎与设置口径**；
  便于 CI（语法检查 / 生成谱图 / 导出 MIDI）与批量转换。
- **非目标（首版）**：交互式 TUI、常驻服务、插件系统、修改 `.jps` 语法。

### A2 三种形态与推荐（关键取舍）
| 形态 | 优点 | 代价 | 建议 |
|---|---|---|---|
| ① **同一个 exe 带子命令**（`ijipu render …`；无参数=GUI） | 零额外产物；设置/引用同一份；用户装一次 | 位图类仍需窗口（见下） | **推荐（主干）** |
| ② 独立 `ijipu-cli` 可执行 | 体积小、启动快 | 双份产物/双份发布流程 | 可选（后续） |
| ③ npm 包 `@ijipu/cli`（Node 直接跑引擎源码） | 跨平台、CI 里最省事、**纯文本类零窗口** | PNG/PDF/WAV 能力受限；需 Node 环境 | **推荐（与①并行，覆盖文本类）** |

**窗口问题（必须讲清）**：Tauri v2 必须初始化 webview ⇒ 想要 **PNG/JPG/PDF/WAV** 就得有"渲染环境"。
两条路：
- **隐藏窗口渲染**（off-screen，复用 `src/export/*` 与音色库 ✓ 零重写）——推荐；
- 引第三方渲染器（resvg/sharp 等）——**属新增依赖，须先问你**（§一）。
⇒ 因此**分批**：文本类（`format/lint/info/render -t svg|midi`）**零窗口**先落地；
位图/音频类放到 P3，用隐藏窗口。

### A3 命令与参数面（在你要的 `-i/-t/-o/-s` 之上补全）
```
ijipu [全局选项] <命令> [命令选项]

全局：--json（机器可读） --quiet --verbose --config <file> --no-config
      --deterministic（不写时间戳，便于 CI 逐字节比对） --stamp（把版本/提交写入产物元数据）

render   -i <in.jps|->  -t svg|png|jpg|pdf  -o <out|->  -p <页范围 1,3-5>
         -S <缩放>  --view 谱面|满宽|整页  --page A4|Letter|auto
play     -i <in.jps>    -t midi|wav  -o <out>  --bpm <n>  --soundbank <sf2|sf3>
         --from/--to <小节|时间>  --channels <n>
format   -i <in|->  -o <out|->  --in-place  --check（不改，返回码体现）  --diff
lint     -i <in|->  --format text|json|gh（GitHub Actions 注解）
info     -i <in>    -t text|json（标题/调号/拍号/BPM/小节数/行数/错误数）
batch    --in <dir|glob>  --out <dir>  --to <类型>  --jobs N  --on-error skip|stop
settings --get <k> | --set <k=v> | --list | --where <k>（打印"这个值来自哪一层"）
config   --print-effective（把 L0→L2 合并结果打出来，含来源标注）
doctor   自检：嵌入版/音色库/字体/端口/权限，输出可粘贴的体检报告
completions powershell|bash|zsh
```
**统一约定**（这几条决定了它好不好用）：
- `-i -` 读 stdin、`-o -` 写 stdout（管道友好）；`-i a.jps b.jps` 支持多输入；
- `-t` 省略时**按 `-o` 后缀推断**（`-o a.svg` ⇒ svg）；
- **退出码**：`0` 成功 / `1` 用法错误 / `2` 输入不存在 / `3` 语法错误（lint 命中）/ `4` 渲染失败 / `5` 设置非法；
- `--json` 输出**带 schema 版本**（`{"schema":1,...}`），错误项含 `line/col/code/message`（复用引擎 `splitParseIssues`/`jpsBlockMarks`）；
- **与"双击打开 .jps"共存**：无参数⇒GUI；**带子命令⇒CLI**；只带文件路径⇒**保持现状**（GUI 打开）。

### A4 设置口径（严格照 §七，禁止二套口径）
```
命令行 -s k=v  >  源内 # jps-config  >  CLI 配置文件  >  代码默认 defaultPageConfig
```
- **L1（个人偏好）永不写入谱面** ✓；`format --in-place` 只做格式化、**不写设置** ✓；
- `settings --where k` / `config --print-effective` 让"值来自哪一层"可解释（这是本项目多次踩坑的地方）；
- 复用引擎的 `mergeJpsConfig` / `writeJpsConfig(mode:'diff')` / `nonDefaultConfigKeys` ✓。

### A5 代码落点（不重写逻辑）
```
packages/ijipu-engine          现状：纯 TS（Node 可跑）
packages/ijipu-cli   ← 新增   参数解析 + IO + 退出码 + JSON 输出 + 批处理
   ├─ text 层：format / lint / info / settings / config / doctor / render(svg|midi)
   └─ headless 层：png / jpg / pdf / wav → 复用 src/export/*（需窗口/音频）
src-tauri/src/lib.rs ← 改      带子命令时**不进 GUI**，转交 CLI（沿用 jps_paths_from_os_args 的判断位）
docs/CLI.md          ← 新增    命令参考 + CI 示例（GitHub Actions / pre-commit）
```
**禁**：CLI 自己算布局/自己读默认值；**必须**调引擎同一份函数（§六之二·4）。

### A6 分阶段（每段独立可验收）
| 阶段 | 内容 | 预估 | 验收 |
|---|---|---|---|
| **P1** | `format` / `lint` / `info` + `--json` + 退出码 + 单测（`samples/*.jps` 全量）+ `docs/CLI.md` | 1–2 天 | `samples` 全量 lint 退出码 0；`format` **幂等**（`f(f(x))==f(x)`，断言） |
| **P2** | `render -t svg|midi` + `batch` + CI 示例 | 1–2 天 | 与 GUI 同设置导出 SVG **逐字节一致**（断言） |
| **P3** | 位图/音频（隐藏窗口）`png/jpg/pdf/wav` | 3–5 天 | 与 GUI 导出像素级一致；`--deterministic` 下可复现 |
| **P4** | `settings/config/doctor` + 补全 + `--watch` | 2–3 天 | `--where` 能正确报出层级；补全可安装 |

### A7 风险与对策
| 风险 | 对策 |
|---|---|
| 位图/音频依赖浏览器能力 | 隐藏窗口渲染（复用现有导出 ✓）；P3 前只承诺 SVG/MIDI |
| CLI 与 GUI 设置分裂 | 只允许"输入源"不同，合并逻辑沿用引擎 ✓；`config --print-effective` 可解释 |
| Windows 控制台中文乱码 | 内部一律 UTF-8；文档建议 `chcp 65001`；**优先写文件**而非 stdout |
| 破坏性写文件 | `format` 默认 stdout；`--in-place` 必须显式；`batch` 默认 `--on-error stop` |
| 参数面膨胀 | 只做上表命令；新命令必须先更新 `docs/CLI.md` 与 `--help` 快照断言 |

---

## 方案 B：嵌入版 iJipu 供 Obsidian 调用（命令 API）

### B0 现状：通道已经有了
- 插件内有**本机 HTTP 服务**（固定端口 47821，占用则回退随机）用于**桌面端**加载 iframe 嵌入版；
- 嵌入版就是应用的**完整构建产物**（`src/gen/webappAssets.ts`）。
⇒ 所以方案 B 的关键不是"怎么通信"，而是**"哪些能力该走哪条路"**（下面 B2 就是答案）。

### B1 三层调用面（建议全给，但分先后）
1. **Obsidian 命令（给人用）** —— `addCommand` 注册：
   「iJipu：格式化当前 jps 代码块」「iJipu：校验当前笔记」「iJipu：导出当前谱为 SVG」「iJipu：导出 MIDI」
   「iJipu：试听选中块」「iJipu：把源码设置固化进谱面」。零新基建，可绑快捷键。
2. **插件 JS API（给插件/脚本用）** —— `app.plugins.plugins['ijipu'].api`：
   `parse / format / lint / render.svg / toMidi / config.{effective,carryover} / apiVersion / capabilities`
   —— **纯 TS 直调 `vendor/engine`**，**不必**走嵌入版（更快、无网络、**手机端也可用** ✓）；
   配 `ijipu-api.d.ts` 类型定义。
3. **嵌入版 RPC（用应用才有的能力）** —— Obsidian ⇄ iframe 嵌入版：
   协议 `{ id, method, params }` → `{ id, ok, result | error }`（JSON-RPC 2.0 风格）；
   方法首版：`engine.version` / `capabilities` / `render.svg` / `render.png` / `export.midi` / `export.pdf` /
   `playback.load` / `playback.play` / `playback.stop` / `settings.get|set`。
   - **传输选 `postMessage`**（同源 iframe ✓ 不需网络 ✓ 手机端也能用 ✓，比 HTTP 更收敛）；
     现有 HTTP 仍只负责"把 iframe 加载出来"（桌面端 ✓）。
   - **安全边界（必须写死）**：只接受 `event.source === iframe.contentWindow` ✓；方法**白名单** ✓；
     参数逐项校验（数值范围/枚举 ✓）；**只允许 vault 内相对路径**（经 `vault.adapter` 解析，禁绝对路径与 `..` ✓）；
     超时 + 并发上限（1 个长任务）✓；**默认总开关关闭**（设置里「开发者：允许外部调用」✓）。
   - **能力探测**：`capabilities` 回报 `svg/png/pdf/midi/audio(audioReady?)` ⇒ 插件按能力**降级**（无音色库就只给 MIDI ✓）。

### B2 谁该走哪条路（避免把简单事做重）
| 需求 | 走 | 为什么 |
|---|---|---|
| 格式化 / 校验 / 错误提示 / 着色 | **②插件 API** | 引擎已在插件内（`vendor/engine`），跨 iframe 纯属绕远 |
| 导出 SVG | **②插件 API** | `renderScoreToSvg` 是纯函数 |
| 导出 PNG / PDF | **③嵌入版 RPC** | 需要 canvas / 字体 / 分页（应用侧已有实现） |
| 试听 / 播放（音色库） | **③嵌入版 RPC** | 需要 AudioContext + SF2（应用侧已有） |
| 面向人的一键操作 | **①命令** | 命令面板 / 快捷键 / 移动端工具栏 |

### B3 落地清单
- 插件：`src/api.ts`（**冻结**的公开面 + `apiVersion`）✓、`src/embed/rpc.ts`（协议 + 白名单 + 校验 + 超时）✓、
  `main.ts` 注册 6 条命令 ✓、`settings.ts` 加"开发者"分区（**默认关**）✓、`docs/OBSIDIAN-API.md` ✓；
- 应用：`src/ipc/obsidianBridge.ts`（唯一新增文件：监听 `message`、白名单分发到**现有**导出/播放模块）✓；
- **版本策略**：`apiVersion` 语义化 ✓；未知方法回 `-32601` ✓；插件对旧版 API 自动降级 ✓；
  嵌入版回传 `engineVersion` ⇒ 复用既有闸门 `adj733` 的口径（三份版本不许漂 ✓）。

### B4 分阶段
| 阶段 | 内容 | 说明 |
|---|---|---|
| **B1** | ①命令 + ②插件 API（`parse/format/lint/render.svg`） | **纯插件内改动、无新基建**，1 天级，收益最大 |
| **B2** | ③RPC 最小面：`engine.version / capabilities / render.svg` | 打通 postMessage 与安全边界 |
| **B3** | `render.png / export.midi / export.pdf / playback.*` | 取决于导出与音色库可用性 |
| **B4** | 协议冻结 + 文档 + 版本策略 + 开关默认关 | 对外承诺 |

### B5 风险与对策
| 风险 | 对策 |
|---|---|
| 手机端没有嵌入版 | ②（纯 TS）**移动端照常可用**；③ 仅桌面（已有 `Platform` 守卫） |
| 恶意笔记/第三方插件触发任意导出或写文件 | **默认关闭** + 白名单 + 仅 vault 内路径 + 大动作弹 `Notice` 确认 |
| 三份版本漂移（插件/嵌入版/引擎） | 已有 `adj733` 闸门 + RPC 回传 `engineVersion` 交叉校验 |
| API 面一次放太大 | 先冻结**最小面**（4 个方法），其余标 `experimental` |

---

## 建议的推进顺序（供你裁决）

1. **方案 B 的 B1**（Obsidian 命令 + 插件纯 TS API）—— **成本最低、当天可用、移动端也受益**；
2. **方案 A 的 P1→P2**（`format/lint/info` + `render -t svg|midi` + `batch`）—— CI 与批处理立竿见影；
3. **方案 B 的 B2**（RPC 最小面）与 **方案 A 的 P3**（位图/音频，隐藏窗口）—— 两者都需要你先拍板
   "是否接受隐藏窗口渲染 / 是否允许新增依赖"；
4. 最后做 `settings/config/doctor`、补全、协议冻结与文档。

---

## 附、后续任务登记（2026-10；与 §八「已裁决」并列的独立清单，不参与编号）

> 这两件**不是本环境能完成/验证的**，因此**登记为独立任务**（不混进"已交付"里 ✗），
> 各自写明**前置条件**与**验收方式** ✓。

### T-1 A·P3 桌面端「隐藏窗口渲染」实现（**需桌面构建 + 图形环境**）
- **现状**：CLI 侧**已就绪** ✓（`CliIo.rasterize` / `CliIo.synthesize` 可选能力 + 无能力时退出码 4 ✓，
  断言覆盖 ✓）；**落地方案与 8 项验证清单**见 `docs/CLI.md` §七之二 ✓。
- **待做**：`src-tauri` 入口识别"带子命令"⇒ 不进 GUI ✗（**二次裁决已推翻**：exe 保持**纯 GUI**，改为只当「能力宿主」）；位图/音频类建**不可见窗口** ⇒ 复用
  `src/export/export.ts`（`renderScoreToSvg` → `svgToCanvas` → `toDataURL` ✓；PDF 走既有分页 ✓；
  WAV 走既有离线合成 ✓）⇒ 字节回传 ⇒ 落盘 ✓。
- **前置**：桌面构建环境（`tauri build` ✓）与可用的图形会话 ✓。
- **验收（硬指标）**：`ijipu render -t png` 与应用「导出 PNG」**逐像素一致** ✓；
  双击 `.jps` **仍开 GUI** ✓；无窗口能力时**退出码 4 + 原因** ✓。

### T-2 「播放无头化」重构（`playback.*` 的前置条件）
- **现状**：协议白名单里**保留**方法名 ✓（冻结后只增不改 ✓），但 `capabilities.audio = false` ✓、
  应用侧回 `-32000` + 原因 ✓ —— **不谎报** ✓。
- **已核实的文件地图**（2026-10 实测 ✓，用来判断工作量）：
  | 文件 | 体积 | 角色 |
  |---|---|---|
  | `src/dialogs/PlaybackDialog.tsx` | **41 KB** ✗ | 播放**逻辑与 UI 混在一起**：`buildPlaySequence`/`schedulePlay`/后端就绪判定/进度条/播放态都在这里 |
  | `src/dialogs/playbackSession.ts` | 3.3 KB ✓ | **已调度 job 的单例管理**（文件头注明："已经调度的 job；还卡在 await 里的那一次随后照样执行 schedulePlay"） |
  | `src/dialogs/playbackClock.ts` | 0.9 KB ✓ | 播放时钟（与插件共用 `createPlaybackClock` ✓） |
  | `src/playback/playbackTimeline.ts` | 2.5 KB ✓ | 时间轴/进度推进 |
  | `src/playback/samplerCache.ts` | 4.8 KB ✓ | 音色库离线缓存（实现引擎 `SamplerCache` ✓） |
  ⇒ 结论：**耦合主要在 41 KB 的那个对话框里** ✗ ⇒ 这不是"接一根线"，而是**从 UI 组件里把播放剥出来** ✓。
- **分三步做（每步独立提交、可回滚 ✓）**：
- **第②步的接口修正与精确改动清单**（2026-10 核实后追加，**第②步开工前必须先做这一步** ✓）：
  **发现的问题**：`headless.ts` 现在的入参是**源码字符串**（`playHeadless(source, opts)` ✓），
  但 `PlaybackDialog` 手上已经有 `parseResult` 与 `layout`（来自 `docStore` ✓）⇒ 若直接切过去，
  会**重复解析+重复排版**一次 ✗（开销 + 与"数值口径同源"精神相悖 ✗）。
  ⇒ **先改接口**：`playHeadless(input: string | { parsed: ParseResult; layout: ScoreLayout }, opts)` ✓
  （传对象时**不再 parse/layout** ✓，直接 `buildPlaySequence` ✓）—— 这一步**只改 headless.ts** ✓，风险极低 ✓，
  可独立提交与断言（"传对象时不调用 parseJps" ✓ 用计数桩断言即可 ✓）。
  **然后**按已核实的抽取面改 `PlaybackDialog.tsx`（**逐处用编辑工具 ✓**，含中文 ✗ 不许用 shell ✓）：
  | 改动 | 说明 |
  |---|---|
  | 新增 `handleRef = useRef<HeadlessHandle \| null>(null)` | 持有无头句柄 ✓ |
  | L330–345 + L497 + L510 播放路径 | 换成 `handleRef.current = (await playHeadless({ parsed, layout }, { bpm, startNoteId, instrumentOverride, onTick })).handle` ✓ |
  | L299 `stop()` | 换成 `handleRef.current?.stop()`（**保留**组件内的 UI 复位逻辑 ✓） |
  | L112 `backendRef` / L121 `seqRef` | **降级或删除**（仅当确认无其它用途 ✓ —— 进度/播放头若曾读 `seqRef.events`，改由 `onTick` + `totalMs` 提供 ✓） |
  | L263 `startTimers` | **删除**（计时交 `headless.ts` 的时钟 ✓，进度走 `onTick` ✓） |
  | `docStore` 的 `playbackMs`/播放轨道写入 | **保留在组件里** ✓（UI 状态仍归 UI ✓ —— headless 只回调 ✓） |
  **验证**：`tsc -b` ✓、冒烟 ✓、**手工**打开对话框播放/停止/从某音符播/切歌（行为与改动前一致 ✓）；
  再加一条闸门：`src/playback/headless.ts` 内**不得**出现 `from 'react'` / `document.` / `window.`（已自查 ✓，
  下一步把它写成脚本断言 ✓）。

  **第①步的"抽取面"已定点核实**（2026-10，`src/dialogs/PlaybackDialog.tsx` 实测行号 ✓）——
  要搬进 `src/playback/headless.ts` 的是**这一组**，其余（进度条/播放头/UI 状态）留在组件里 ✓：
  | 位置 | 符号 | 说明 |
  |---|---|---|
  | L112 | `backendRef = useRef<SpessaSynthBackend \| null>(null)` | 合成器后端生命周期（创建/`dispose`：L389–394、L210） |
  | L121 | `seqRef = useRef<ReturnType<typeof buildPlaySequence> \| null>(null)` | 当前播放序列（L497 赋值、L274 读事件） |
  | L263 | `startTimers(job: { totalMs: number })` | 播放计时（按 `seqRef.current.events` 推进 ✓） |
  | L299 | `stop()` | 停止（内部 `backendRef.current?.stop()` ✓） |
  | L330–345 | 播放路径 | `buildPlaySequence` → `schedulePlay({ events }, backend, …, 0)`（L510 是"从这里开始播放"的分支） |
  ⇒ 目标签名：`playHeadless(src, { bpm, startNoteId, instrumentRef, onTick }) → { stop(), totalMs }` ✓
  （`onTick` 供组件更新进度条 ✓ —— **UI 仍归组件** ✓，这是"零 React"闸门能过的关键 ✓）。
  1. **抽模块**：新建 `src/playback/headless.ts`（上面那组 ✓），**先不改 `PlaybackDialog`** ✗；
     断言：该文件**不 import react** ✓、不读 `document`（`AudioContext` 需 `typeof` 守卫 ✓）；
  2. **切消费方**：`PlaybackDialog` 改为调用 `headless.ts`（**UI 行为不得变化** ✓）；
  3. **开 RPC**：`obsidianBridge` 接 `playback.play`/`playback.stop` ✓，`capabilities.audio` 改为
     **只在音色库就绪时为 true** ✓（否则保持 false ✓）。
- **验收**：RPC 可播可停 ✓；`PlaybackDialog` 行为不变 ✓；`capabilities.audio` 如实 ✓；
  断言：RPC 侧白名单/参数校验 ✓ + `headless.ts` 的"零 React"闸门 ✓。

> **顺序建议**：T-2 可先在**本环境**做"模块抽取 + 断言"（不需 GUI ✓），T-1 必须等桌面验证 ✓。


## 八、已裁决（用户 2026-10-11 决定）

| # | 事项 | 决定 | 对方案的影响 |
|---|---|---|---|
| ① | CLI 形态 | **同一个 exe 带子命令**（`ijipu <命令> [参数]`；无参数=GUI） | 主干按 A2·①；**不再做**独立 `ijipu-cli`；npm 包（③）**暂不做**（保留为后续可选项）—— ⚠ **本条已被 2026-10-11 二次裁决推翻**，见下方「二次裁决」✗；`src-tauri` 里加"带子命令⇒不进 GUI"的分流 |
| ② | 位图/音频（PNG/JPG/PDF/WAV） | **接受「隐藏窗口渲染」**（复用 `src/export/*` 与音色库，**不引新依赖**） | A 的 P3 按"off-screen 窗口"实现；`--deterministic` 需要与窗口渲染配合（字体/尺寸固定） |
| ③ | B 的 RPC 安全边界 | **可以**：总开关**默认关闭** + **只允许 vault 内相对路径** | B2 起按此写死；另加：方法白名单、`event.source` 校验、参数校验、超时/并发上限、大动作 `Notice` 确认 |

**据此确定的实施顺序**（与 §七建议一致，现已无待决项）：
1. **B1**：Obsidian 命令 + 插件纯 TS API（`parse/format/lint/render.svg`）；
2. **A·P1 → P2**：`format/lint/info` + `render -t svg|midi` + `batch`；
3. **B2 + A·P3**（隐藏窗口渲染）；
4. **A·P4 + B4**：`settings/config/doctor`、补全、协议冻结与文档。

> **命令行操作口径见 `docs/CLI.md`**（本方案 A 的对外说明书，同时充当实现口径与验收标准）。

---

## 九、二次裁决（2026-10-11，用户口径；`adj874` 起生效）

| # | 事项 | 决定 | 影响 |
|---|---|---|---|
| ①′ | **CLI 形态** | **独立 Node 包 `@ijipu/cli`**（命令名 `ijipu`，即 A2 的形态③） | **推翻上面的 ①**：`ijipu.exe` **不做**子命令分流、**也不打印 `--help`**，保持**纯 GUI**（双击即界面）；CLI 走 Node 分发，引擎打进单文件产物（**运行期零依赖** ✓）。包名**带 scope**（用户 2026-10-11 定：与引擎包 `@ijipu/engine` 对齐；代价是首次发布前要在 npm 上拥有 `ijipu` 这个 scope） |
| ②′ | **位图/音频能力** | **两条通道都做**：应用在跑 ⇒ **命名管道**（`\\.\pipe\ijipu-cli-<用户>`，仿 Obsidian CLI 的 `Obsidian.com` + `\\.\pipe\obsidian-cli-*`）；没跑 ⇒ **一次性子进程**（起一个隐藏窗口当渲染宿主，拿完字节即退） | 应用只暴露**能力**（`rasterize` / `synthesize`）而不是「命令」；总开关**默认关**（沿用上表 ③ 的安全口径） |
| ③′ | **文本类落点** | `format` / `lint` / `info` / `settings` / `config` / `doctor` / `completions` / `render -t svg\|midi` / `play -t midi` **完全不碰 exe**，直接调引擎 ✓ | A2·③「纯文本类零窗口」成立 ✓ |

**实施顺序（二次裁决后）**：
1. **CLI 包化** —— `packages/ijipu-cli` 成为可安装包（`bin` / `--help` / `--version` / tsconfig 类型闸门 /
   产物零依赖），`-t png|pdf|wav` 无宿主时**如实退 4** ✓ **（已完成 `adj874`）**；
2. **CLI 侧宿主客户端** —— 找 `ijipu.exe`（注册表 `HKCU\...\Uninstall\iJipu` 的 `InstallLocation`，
   注意该值**带引号**；且 Chrome/豆包的 PWA 卸载项同名「爱记谱 iJipu」，**只能按 key 名精确取** ✗ 按 DisplayName 匹配）
   + 两条通道 + 能力缺失时的退出码 4（**待做**）；
3. **应用侧能力宿主** —— 命名管道服务端（**已落 `adj875`**：`src-tauri/src/cli_host.rs`，管道名
   `\\.\pipe\ijipu-cli-<USERNAME>`、一行一个 JSON、方法白名单 `ping`/`capabilities`/`rasterize`/`synthesize`；
   默认**关**，用 `IJIPU_CLI_HOST=1` 或内部开关 `--cli-host` 开启；Rust 单测真连真收发 ✓）
   + **把请求转交前端**、由前端复用 `src/export` 渲染后回传（**待做**）；一次性子进程的隐藏窗口模式（**待做**）；
4. **安装器** —— exe 路径发现与（可选的）PATH/`App Paths` 注册（**待做**）。
   > ⚠ **本节第 4 条的定位已被 §十（三次裁决）订正**：`adj942` 起 CLI **内嵌在 `ijipu.exe` 里**
   > ⇒ "CLI 能不能用"**不再依赖** exe 路径发现；剩下的只是"想直接敲 `ijipu` 而不是 `ijipu.exe`"
   > 这一件可选的便利（本轮不做 ✗，用户口径）。
   >
   > ✅ **`adj944` 已把这一件做掉**（用户 2026-10 要求"全局设置里加注册按钮"）：见 §十一 ——
   > **PATH 注册做了**（`ijipu cli register|unregister|status` + 全局设置里的按钮 + 卸载自动解除），
   > **`App Paths` 也顺手做了**（"运行"对话框/资源管理器地址栏也能敲 `ijipu`）。

> 仍适用的硬指标（来自 §七之二）：`ijipu render -t png` 与应用的「导出 PNG」**逐像素一致**；
> 无窗口能力时**退出码 4 + 原因**、绝不产半成品 ✗；**不重写渲染**（一律复用 `src/export/*` 与音色库）。

---

## 十、三次裁决（2026-10-13，`adj942`；用户裁定「直接落，修」）

| # | 事项 | 决定 | 影响 |
|---|---|---|---|
| ①″ | **CLI 的交付形态** | **把 CLI 内嵌进 `ijipu.exe`**（内嵌 QuickJS `rquickjs` 跑编进二进制的那段 JS）⇒ 用户**不必装 Node**；调用形态 = **明确子命令** `ijipu.exe cli <命令>` | 与 §九①′（独立 Node 包）**并存、不推翻**：`@ijipu/cli` 继续给 CI / 无应用的环境 ✓；exe 侧**新增**一条"零依赖"路径。**§九①′ 里"exe 不做子命令分流"这条作废** ⇒ 双击 `.jps` 与关联打开**照旧进 GUI**（只有**第一个参数恰为 `cli`** 才走命令行；判据是 `cli_embed::split_cli_args`，有 Rust 单测钉着 ✓） |
| ②″ | 内嵌版的 IO | **不硬造 `node:fs`**：文件读写 / stdin / stdout 全由 Rust 侧注入 `__ijipuHost`（`packages/ijipu-cli/src/embedEntry.ts` 只做接线） | 两套入口共用**同一份** `runCli(argv, io)`（`packages/ijipu-cli/src/cli.ts`）⇒ 退出码与数值口径完全同源 ✓ |
| ③″ | 能力（位图/音频/监视） | 内嵌 CLI **不注入** `rasterize` / `synthesize` / `watchFile` ⇒ `-t png\|jpg\|pdf`、`play -t wav`、`lint --watch` **如实报错**（退出码 4 / 1），与"独立 Node 环境"**同一口径** | §九②′ 的能力通道（命名管道 + 隐藏窗口）**仍然待做**；本轮**不**改那条口径 |

**内嵌之后仍未做的（如实登记，别当成已完成 ✗）**：
- **能力转交前端**（`src-tauri/src/cli_host.rs` 的 `rasterize`/`synthesize` 落地）—— **待做**；
- **一次性子进程的隐藏窗口宿主**（应用没在跑时自己起宿主）—— **待做**。

---

## 十一、四次裁决（2026-10-14，`adj944`；用户要求「全局设置里加注册 iJipu CLI 的按钮」）

| # | 事项 | 决定 | 影响 |
|---|---|---|---|
| ①‴ | **交付形态** | **注册 = 把"安装目录本身"写进当前用户 PATH**（用户已选定：不建 bin 垫片） | 终端里直接 `ijipu cli lint x.jps` ✓ —— **§十 末尾"PATH 本轮不做"作废**（已被本条取代） |
| ②‴ | **入口** | 两条，**同一份逻辑**：① 全局设置 →「命令行」子页签的按钮；② `ijipu cli register\|unregister\|status` | 字符串口径只在 `packages/ijipu-cli/src/envPath.ts` 一处（纯函数 + 编排），界面与命令行都调它 ✓；Rust（`src-tauri/src/cli_path.rs`）只做读写注册表 / 写前备份 / 回读校验 / 广播 ✓ |
| ③‴ | **副作用边界** | 只写 `HKCU`（当前用户，**不要管理员**）；解除**只摘自己那一条**（其余逐字不动、幂等）；写前备份、写完回读、失败还原 | 与安装模式 currentUser 一致；PATH > 2047 字符 ⇒ **不写**并给出可执行建议 |
| ④‴ | **`App Paths`** | **做了**（顺手，可选便利）：注册写 `…\App Paths\ijipu.exe`，解除只删**指向我们的**那一条 | "运行"对话框 / 资源管理器地址栏也能敲 `ijipu`；**终端靠的仍然是 PATH** ✓ |
| ⑤‴ | **卸载** | `nsis/hooks.nsh` 的卸载段 → `nsis/cli-path.nsh`：**幂等摘掉自己那一条** + 清 App Paths + 删我方备份键 + 广播 `WM_SETTINGCHANGE` | 受 `$UpdateMode` 保护（更新流程不摘，免得"更新一次丢一次注册"）；值的类型按原样写回（`REG_EXPAND_SZ` 里的 `%USERPROFILE%` 不会被写坏） |

用户口径原文、真机实测输出与四条使用口径见 `docs/CLI.md` §二之二。
