# 交付交接清单：CLI（方案 A）与嵌入版命令 API（方案 B）

> 生成于 2026-10-11，goal「按已裁决的方案顺序实现并交付」第 30 轮（上限轮）收口。
> **本清单是给"下一步执行者"（或下一次会话的我自己）用的**：剩余工作已量化到"逐处改动 + 验证命令" ✓，
> 不需重新调研 ✓。

## 一、已完成并验证（可直接测）

| 方案 | 阶段 | 内容 | 机器证据 |
|---|---|---|---|
| A | **P1** | `format` / `lint` / `info`，`--json`（schema 1）、退出码矩阵、stdin/stdout | CLI 断言 **22 项** ✓ |
| A | **P2** | `render -t svg\|midi`、`batch`（目录批量，输出目录自动创建） | 断言 + 实测（`MThd`、7/7 ✓） |
| A | **P4** | `settings`（值+来源）、`config -t effective`、`doctor`（能力如实）、`completions`（3 shell）、**`lint --watch`** | 断言 + `--watch` 端到端实测 ✓ |
| A | P3 | **CLI 侧就绪**：`rasterize`/`synthesize` 宿主注入 + 无能力时**退出码 4 + 原因** | 断言 ✓ |
| B | **B1** | 公开 API（`Object.freeze` + `apiVersion=1` + 能力探测不撒谎）+ 4 条命令 | `adj800` ✓ |
| B | **B2** | 入站 RPC（白名单/来源校验/参数校验/错误码/默认关闭）+ 设置里的开发者开关 | `adj807/808/813` ✓ |
| B | **B3** | 双向通道（`createAppRequester` ⇄ `installObsidianBridge`）+ **SVG/PNG/MIDI 三种导出命令** | `adj809/810/811/821/822` ✓ |
| B | **B4** | 协议版本 `1` + 信封/错误码冻结 + **跨仓一致性闸门**（应用侧清单 ⊆ 插件出站清单） | `adj812/825` ✓ |
| — | T-2 第①步 | `src/playback/headless.ts`（无头播放，**零 React/DOM**）+ 入参 `string \| { parsed, layout }` | `adj826/828` ✓（`tsc -b` ✓） |

**质量门（最近一次运行 ✓）**：应用 `check:encoding` ✓、`tsc -b` ✓、引擎冒烟 **ALL PASSED** ✅、
CLI 断言 **22/22** ✅、`doctor` 能力如实 ✓；插件 `tsc` ✓、冒烟 **387 passed / 0 failed** ✅。
**用户库**：插件 **0.34.2**，`main.js` 与本地构建**哈希一致** ✓（含 B1/B2/B3 全部插件侧功能 ✓）。

## 二、剩余工作（逐处已量化 ✓）

### T-2 第②步：`PlaybackDialog` 切换到无头播放（**下一步第一件事**）
文件：`src/dialogs/PlaybackDialog.tsx`（41 KB，**含中文 ⇒ 只许用编辑工具逐处改** ✗ shell ✗）。
| # | 改动 | 注意事项 |
|---|---|---|
| 1 | 新增 `handleRef = useRef<HeadlessHandle \| null>(null)` | 句柄替代 `backendRef`/`seqRef` 的播放用途 |
| 2 | L330–345 + L497 + L510 播放路径 ⇒ `handleRef.current = (await playHeadless({ parsed, layout }, { bpm, startNoteId, instrumentOverride, onTick })).handle` | `parsed`/`layout` 直接用组件里已有的 ✓（**零重复解析** ✓） |
| 3 | L299 `stop()` ⇒ `handleRef.current?.stop()` | **保留**组件自己的 UI 复位逻辑 ✓ |
| 4 | L112 `backendRef`、L121 `seqRef` | 先确认无其它用途再降级/删除 |
| 5 | L263 `startTimers` | **删除**（计时交 headless 的时钟 ✓，进度走 `onTick` ✓） |
| 6 | `docStore` 的 `playbackMs`/播放轨道写入 | **保留在组件** ✓（UI 状态仍归 UI ✓） |
**验证**：`tsc -b` ✓、`npm run smoke` ✓、**手工**打开对话框：播放 / 停止 / 从某音符播 / 切歌 —— 行为与改动前一致 ✓。

### T-2 第③步：开 RPC `playback.*`
- `src/ipc/obsidianBridge.ts`：把 `playback.play` / `playback.stop` 加进 `APP_BRIDGE_METHODS` ✓ 并接 `playHeadless` ✓；
- `capabilities.audio` 改为**只在音色库就绪时为 true** ✓（否则保持 false ✓ —— 不谎报 ✓）；
- 插件侧 `src/embed/rpc.ts` 的 `APP_METHODS` **已留名** ✓ ⇒ 无需改动 ✓；
- 断言：`adj810` 扩展（应用侧含 `playback.*` 且就绪判定存在 ✓ + 跨仓一致性闸门仍绿 ✓）。

### T-1：A·P3 桌面端「隐藏窗口渲染」（**需桌面构建 + 图形环境**）
- 方案与 **8 项验证清单**：`docs/CLI.md` §七之二 ✓；
- 要点：`src-tauri` 识别"带子命令 ⇒ 不进 GUI" ✓ → 建**不可见窗口** → 复用 `src/export/export.ts`
  （`renderScoreToSvg` → `svgToCanvas` → `toDataURL`；PDF 走既有分页；WAV 走既有离线合成）→ 字节回传 → CLI 落盘 ✓；
- **硬指标**：`ijipu render -t png` 与应用「导出 PNG」**逐像素一致** ✓；双击 `.jps` 仍开 GUI ✓；
  无窗口能力 ⇒ 退出码 4 + 原因 ✓。

## 三、发布建议（等用户一句「更新提交」）
- **插件**：`0.34.2 → 0.35.0`（新增公开 API/RPC/命令 ⇒ **MINOR** ✓）；
- **应用**：`0.51.2 → 0.52.0`（新增 CLI 与 IPC ⇒ **MINOR** ✓）；
- 走既定链路：版本号多处同步 → RELEASE-NOTES（只留当版 + 归档上一版）→ 两库门禁 → tag → 推送 →
  CI 产物与本地重建**逐字节比对** → 装进用户库 → `gh attestation verify` ✓。

## 四、未完成的诚实说明
- **T-1** 不在本环境可完成范围（无 GUI/桌面构建链 ✗）；
- **T-2 第②③步**需要读改一个 41 KB 的交互组件 ✗，本 goal 剩余上下文不足以安全完成 ✗ ——
  因此我把它**做成了上面的逐处清单** ✓，而不是留下改了一半的组件 ✗；
- 因上述两点，goal **不标记完成** ✓（保持 active，等下一位执行者或下一次会话接手 ✓）。
