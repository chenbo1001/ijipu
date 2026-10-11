# 方案：iJipu 命令行（桌面端 CLI）与「嵌入版供 Obsidian 调用」命令 API

> 状态：**待用户裁决**（2026-10-11）。本文只做设计，不含实现。
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

## 九、后续任务登记（2026-10，本方案实施到 P1–P4 主体后）

> 这两件**不是本环境能完成/验证的**，因此**登记为独立任务**（不混进"已交付"里 ✗），
> 各自写明**前置条件**与**验收方式** ✓。

### T-1 A·P3 桌面端「隐藏窗口渲染」实现（**需桌面构建 + 图形环境**）
- **现状**：CLI 侧**已就绪** ✓（`CliIo.rasterize` / `CliIo.synthesize` 可选能力 + 无能力时退出码 4 ✓，
  断言覆盖 ✓）；**落地方案与 8 项验证清单**见 `docs/CLI.md` §七之二 ✓。
- **待做**：`src-tauri` 入口识别"带子命令"⇒ 不进 GUI ✓；位图/音频类建**不可见窗口** ⇒ 复用
  `src/export/export.ts`（`renderScoreToSvg` → `svgToCanvas` → `toDataURL` ✓；PDF 走既有分页 ✓；
  WAV 走既有离线合成 ✓）⇒ 字节回传 ⇒ 落盘 ✓。
- **前置**：桌面构建环境（`tauri build` ✓）与可用的图形会话 ✓。
- **验收（硬指标）**：`ijipu render -t png` 与应用「导出 PNG」**逐像素一致** ✓；
  双击 `.jps` **仍开 GUI** ✓；无窗口能力时**退出码 4 + 原因** ✓。

### T-2 「播放无头化」重构（`playback.*` 的前置条件）
- **现状**：协议白名单里**保留**方法名 ✓（冻结后只增不改 ✓），但 `capabilities.audio = false` ✓、
  应用侧回 `-32000` + 原因 ✓ —— **不谎报** ✓。
- **为什么不能"直接接线"**（已核实 ✓）：应用侧播放由 **`src/dialogs/PlaybackDialog.tsx`（React 对话框）** 持有，
  并依赖 `src/playback/playbackSession.ts`（**已调度 job 的单例管理** ✓）、
  `src/playback/spessaSynthBackend.ts`（音色库/后端就绪状态 ✓）、`docStore`（`playbackMs`/播放轨道 ✓）
  ⇒ 经 RPC 驱动它 = **驱动一个 UI 对话框** ✗。
- **待做**：抽出无头播放模块（`play(src, opts) → handle{ stop() }` ✓，不依赖 React ✓，复用同一套
  `buildPlaySequence`/`schedulePlay`/音色库 ✓），然后 `PlaybackDialog` 与 RPC **都消费它** ✓（一处实现 ✓）。
- **验收**：`playback.play`/`playback.stop` 经 RPC 可播可停 ✓；`PlaybackDialog` 行为不变 ✓；
  断言：RPC 侧白名单/参数校验 ✓ + 应用侧 `capabilities.audio = true` 只在就绪时为真 ✓。

> **顺序建议**：T-2 可先在**本环境**做"模块抽取 + 断言"（不需 GUI ✓），T-1 必须等桌面验证 ✓。


## 八、已裁决（用户 2026-10-11 决定）

| # | 事项 | 决定 | 对方案的影响 |
|---|---|---|---|
| ① | CLI 形态 | **同一个 exe 带子命令**（`ijipu <命令> [参数]`；无参数=GUI） | 主干按 A2·①；**不再做**独立 `ijipu-cli`；npm 包（③）**暂不做**（保留为后续可选项）；`src-tauri` 里加"带子命令⇒不进 GUI"的分流 |
| ② | 位图/音频（PNG/JPG/PDF/WAV） | **接受「隐藏窗口渲染」**（复用 `src/export/*` 与音色库，**不引新依赖**） | A 的 P3 按"off-screen 窗口"实现；`--deterministic` 需要与窗口渲染配合（字体/尺寸固定） |
| ③ | B 的 RPC 安全边界 | **可以**：总开关**默认关闭** + **只允许 vault 内相对路径** | B2 起按此写死；另加：方法白名单、`event.source` 校验、参数校验、超时/并发上限、大动作 `Notice` 确认 |

**据此确定的实施顺序**（与 §七建议一致，现已无待决项）：
1. **B1**：Obsidian 命令 + 插件纯 TS API（`parse/format/lint/render.svg`）；
2. **A·P1 → P2**：`format/lint/info` + `render -t svg|midi` + `batch`；
3. **B2 + A·P3**（隐藏窗口渲染）；
4. **A·P4 + B4**：`settings/config/doctor`、补全、协议冻结与文档。

> **命令行操作口径见 `docs/CLI.md`**（本方案 A 的对外说明书，同时充当实现口径与验收标准）。
