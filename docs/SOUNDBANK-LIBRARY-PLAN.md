# 多音色库方案（音色库列表 · 选库 · 选库内音色）

> 状态：**方案定稿**（2026-10-21 起草，同日用户拍板：不内置、按推荐口径）。
> 落地编号从 `adj1009` 起（当前最新 `adj1008`）。
> 关联文档：`docs/SOUNDBANKS-SPEC.md`（现有语法与分发口径）、`docs/SETTINGS-AUDIT.md`（分层归属）。

---

## 一、先给结论

1. 你说的现象**不是显示 bug，是四处硬编码叠出来的必然结果**：现在"取音源"永远取默认库、
   "导入音色文件"永远存到默认库名下、"音色列表"永远是引擎里写死的 128 条中文 GM 表。
   所以换一个音色库文件进来，**字节换了、名字和列表没换**。
2. 要做的不是"加一个下拉框"，而是补一层**音色库注册表**：库是可枚举、可添加、可选择的实体，
   音色是"某个库里的音色"（而不是"全局 128 个"）。
3. **有一件事必须保持不变**：谱面里 `Y:` / `@乐器名@` 的**中文音色名到 GM program** 的解析
   （引擎 `GM_VOICES`）。它是"谱面可移植"的根，动了它，同一份谱写 `Y: 长笛` 换个库就解析不到了。
   新方案里它仍然当**语义层**，音色库只当**取声音的实体层**。

---

## 二、现状：为什么导入新库后还是 GeneralUser（带证据）

### 2.1 四条硬编码

| # | 位置 | 现状 | 后果 |
|---|---|---|---|
| ① | `src/dialogs/PlaybackDialog.tsx:200`、`:495`、`src/ui/dock/ExportPanel.tsx:100` | `const hqLib = getHqLibrary()` —— **不带参数**，永远返回 `HQ_LIBRARIES[0]` | 试听/导出永远加载 GeneralUser |
| ② | `src/dialogs/SoundBankPanel.tsx:54` | `const currentHqLib = HQ_LIBRARIES[0]` | 面板上的名字/体积/下载页/导入目标**全是默认库** |
| ③ | 同上 `:129`、`:149` | `hqCache.save(currentHqLib.id, …)` / `importSoundbank(currentHqLib.id)` | 你导入的 FluidR3 被**存进 `generaluser_gs` 这个键**（等于"冒名顶替"） |
| ④ | `packages/ijipu-engine/src/engine/playback/soundbanks.ts:33` | `HQ_LIBRARIES` 只有**一条** | 没有"库列表"这个概念可用 |

补充两条：

- `src/store/uiStore.ts:626` 里的 `playbackHqLibrary` **存了、导出了，但从来没被读来选库**；
  唯一会写它的是"导入收藏 JSON"（`SoundBankPanel.tsx:115`）⇒ **界面上根本没有切库入口**。
- `src/playback/spessaSynthBackend.ts:238`：`if (this.state === 'ready' || this.state === 'loading') return`
  ⇒ 就算把库 id 接对了，**第二次 `load()` 会直接返回**，换库不重载。换库必须重建后端。

### 2.2 两个库的真实差异（我按 phdr 逐字节读出来的，不是猜）

| | `generaluser_gs.sf2` | `FluidR3_GM.sf2` |
|---|---|---|
| 文件体积 | 30.8 MiB（32,319,396 B） | **141.5 MiB**（148,398,306 B） |
| 自带库名（INFO/INAM） | `GeneralUser GS 2.0.3 BETA` | `Fluid R3 GM` |
| 预设总数 | **287** | **189** |
| 用到的 bank | **19 个**（0,1,2…13,16,24,25,26,120,128） | **5 个**（0,8,9,16,128） |
| bank 0 主音色 | 128 个（program 0–127 齐） | 128 个（齐） |
| bank 0 里**名字不同**的 | — | **33 / 128** |
| 许可（INFO/ICMT） | GeneralUser GS License v2.0 | MIT |
| git 状态 | 已跟踪（随包分发） | **未跟踪**（`git status` 显示 `??`，只在本地做参考） |

名字不同的抽样（左 GeneralUser，右 FluidR3）：

```
 0: Grand Piano        | Yamaha Grand Piano
 1: Bright Grand Piano | Bright Yamaha Grand
 4: Tine Electric Piano| Rhodes EP
 8: Celeste            | Celesta
21: Accordion          | Accordian
33: Finger Bass        | Fingered Bass
46: Orchestral Harp    | Harp
48: Fast Strings       | Strings
81: Saw Lead           | Saw Wave
```

⚠ **一个坑，必须写进实现**：这两个 sf2 的 `phdr` **末尾终止记录并不是全 0**，名字字段里写的是
字符串 `"EOP"`。按"丢掉名字为空的那条"来过滤是**错的**——我第一次探针就因此把 program 0
读成了 `EOP`。正确做法是**无条件丢掉最后一条记录**（SF2 规范：presets 数 = phdr 记录数 − 1）。

⚠ 第二个坑：FluidR3 的 `phdr` **不是按 program 排序的**（第一条是 `0:127 Gun Shot`）。
列表必须自己按 `(bank, program)` 排序，**不能拿文件顺序当索引**。

### 2.3 现在到底发生了什么（所以"听起来对、看着不对"）

你导入 FluidR3 后，IndexedDB 的 `ijipu-soundfonts-hq / banks / generaluser_gs` 这个键里
存的是 FluidR3 的字节。播放时加载的**其实已经是 FluidR3 的声音**，但：
界面名字来自 `HQ_LIBRARIES[0].name`、音色列表来自 `GM_VOICES`（128 条中文）、
导出文件名是 `generaluser_gs.sf2`、下载页也还是 GeneralUser 的。
——这就是你看到的"导入新库后显示的还是 generaluser_gs"。

---

## 三、目标与不变量

### 3.1 你要的三件事

1. **能添加音色库**：选一个本地 `.sf2/.sf3` → 成为一个库条目（自动识别名字、体积、音色数）。
2. **有音色库列表**：能看到有哪些库、当前在用哪个、切换、删除、导出。
3. **能选库里的音色**：选定库之后，音色列表是**这个库自己的**（名字、数量都按它来）。

### 3.2 三条不变量（方案的红线）

| 不变量 | 为什么 |
|---|---|
| 谱面里的中文音色名（`GM_VOICES`）**继续是唯一语义层** | 同一份谱写 `Y: 长笛`，换库后仍应奏出长笛（program 73）。库名只影响"哪个采样"，不影响"是什么乐器" |
| 一处谱**同一时刻只用一个库** | 后端只挂一个 bank；切换 = 重建。要"两个库同时响"是另一个量级的事，先不做（见 §八 拍板项 ④） |
| 音色**身份**升级为 `(bank, program)`，但**先只开放 bank 0** | bank 0 就是 GM 主音色；bank≠0 是变体/鼓组，需要 bank select，先不碰 |

---

## 四、数据模型（三层，各自有唯一出处）

```
① 语义层（引擎，跨库稳定，**不改**）
   GM_VOICES: 128 条 { program, label: '73 长笛' }
   ↑ Y: / @乐器名@ 解析、色块配色、`@` 名称 ref 都靠它

② 库层（引擎新增 sf2.ts 解析 + 应用侧注册表）
   Sf2Library {
     id: 'generaluser_gs' | 'fluidr3_gm' | 'imported_ab12cd34'
     name: 'GeneralUser GS 2.0.3 BETA'      ← 读 INAM，不是文件名
     fileName: 'generaluser_gs.sf2'
     sizeBytes: 32319396
     format: 'sf2' | 'sf3'
     origin: 'bundled' | 'downloaded' | 'imported' | 'host'
     source?: string          // 可自动下载的直链（FluidR3 没有）
     downloadPage?: string    // 只能手动下的落地页
     presets: Sf2Preset[]     // 见下，导入时解析一次后持久化
   }
   Sf2Preset { bank, program, name: 'Flute' }   ← 库自己的原始名（英文）

③ 选择层（应用 store，L1 本机偏好）
   playbackHqLibrary: 'fluidr3_gm'                    ← 当前用哪个库（接管已有的这个键）
   playbackHqEnabledByLib: { [libId]: number[] }      ← **每个库一套收藏**
   playbackHqVoice: number | null                     ← 会话级，不动
   libraryCache: Sf2Library[]（持久化在 IndexedDB）
```

**界面上音色行怎么显示**（这是把"库自己的名字"和"谱面能写的名字"缝在一起的地方）：

```
[✓] 073  长笛  ·  Flute                          ← 主行：GM 中文名（谱面能写）
[ ] 000  大钢琴  ·  Yamaha Grand Piano            ← 副行：本库原始名
```

- 勾选存的是 `program`（语义），显示的是"本库实际采样名"（事实）。
- 本库**没有**的 program：整行**灰掉、不可勾选**，并注明"本库无此音色"。
- 本库有 bank≠0 的音色：单列一栏"本库另有 N 个变体/鼓组（暂不可选）"，如实交代数量差异。

---

## 五、关键设计决策

### 5.1 库 id 怎么来（决定"能不能认出你手上这个文件是什么"）

| 情况 | id 规则 | 例子 |
|---|---|---|
| 随包/已知库 | 固定 id（引擎里的 `HQ_LIBRARIES` 声明） | `generaluser_gs`、`fluidr3_gm` |
| 用户导入的文件 | 先读 INAM → 命中已知库的识别规则就用那个 id；否则 `imported_<内容哈希前 8 位>` | `imported_3fa9c1d2` |

已知库带一条 `sf2NamePattern`（正则源串）：`/generaluser/i` → `generaluser_gs`、
`/fluid\s*r3/i` → `fluidr3_gm`。**为什么必须按 INAM 认、而不是按文件名认**：
用户下载到的文件常常叫 `FluidR3_GM.sf2`，但也可能是 `fluid.sf2`、`(1).sf2`；
反过来，你现在的缓存已经"冒名"存在 `generaluser_gs` 键下了，只有按内容才认得出它其实是 FluidR3。

> 这条同时解决了**历史错位**：升级后一次性迁移（见 §七）。

### 5.2 谁负责解析 SF2（为什么不用 spessasynth 的 `presetList`）

新增 `packages/ijipu-engine/src/engine/playback/sf2.ts`（**纯函数、零 DOM**）：

```ts
readSf2Info(buf: ArrayBuffer): { name?: string; engineer?: string; software?: string; comment?: string; version?: string }
readSf2Presets(buf: ArrayBuffer): Sf2Preset[]        // 丢末条 EOP，按 (bank, program) 排序
matchKnownLibrary(info): string | null               // 按 INAM 正则认领
```

三条理由：

1. **不需要真加载就能显示**：导入前、库还没挂到 worklet 时，就要能报"这个文件是什么库、有几个音色"。
   `synth.soundBankManager.presetList` 得先把 141 MB 塞进 worklet 才有，太重。
2. **引擎零 DOM、可在 `npm run smoke` 里逐字节断言**（`sf2.ts` 是纯函数，合成一个最小 SF2 夹具即可）。
3. **它是"名字与数量"的唯一出处**：UI 不做二次推断，避免"两个地方各算一次"。

实现上只读 RIFF 里的 `LIST INFO`（INAM/IENG/ISFT/ICMT/ifil）与 `LIST pdta` 的 `phdr`，
不碰采样数据（`smpl`/`shdr` 完全不读）。

### 5.3 取用与切换（后端）

- `resolveHqBank(lib, cache, hostUrl)` / `prefetchHqLibraryProgress(...)` **保持现有分层语义**
  （引擎 `planHqBankLoad` 不动），只是 `lib` 从"默认库"改成"当前选中的库"。
- `SpessaSynthBackend` 新增 `loadedBankId`：`load(bank, id)` 时若 id 与已加载的不同 ⇒ 先
  `dispose()` 再重建（AudioContext 一起关掉，避免 worklet 里同时挂两份 141 MB）。
- 切库的用户可见流程：停播 → 「正在加载音色库…」（带库名与体积）→ 就绪/失败回退上一个库。
- 音色下拉的候选 = **当前库的 presets ∩ 本库收藏集合**；两边都不为空才出选项。

### 5.4 分发策略与"去哪下载"（2026-10-21 用户拍板：**不内置**）

先定每个库给用户什么：

| | GeneralUser GS | FluidR3 GM |
|---|---|---|
| 随安装包内置 | ✅ 现在就是（`bundle.resources`，32.3 MB） | ❌ **不内置**（安装包 +141.5 MB） |
| 自动联网下载 | ✅ 有直链（部分网络不可达，已有手动导入兜底） | ❌ 做不了：下载页返回的是 HTML、且没有 CORS 头（见下） |
| 手动导入 | ✅ | ✅ **主路径** |
| 下载入口 | `[下载并导入]` + `[打开下载页]` | **只给** `[打开下载页]`（点了明确说"下完回来导入"） |
| 桌面便携 | 把 `<id>.sf2` 放进安装目录（或 `soundfonts/`）即认成"内置" | 同左，Rust 侧**零改动**（它本来就按 `<id>.sf2` 找） |

#### 为什么不把第三方收藏集（`Daniel-176/Usefull-Soundfonts`）写进应用

你提到的那份收藏集，我用 `api.github.com` 一次拿到 **56 个条目**、真实音源合计约 0.9 GB。
**决定不用它**——你担心的"商业音源"问题确有其事，四个硬理由：

| 事实 | 证据（我拉到的原始值） | 后果 |
|---|---|---|
| **11 个文件走 Git LFS**，仓库里只有 134 字节的指针 | `.gitattributes` 里逐个文件写了 `filter=lfs`；contents API 里 `FluidR3_GM2-2.SF2` 的 `size` 就是 **134**（全库正好 11 个 134 字节的条目） | 直链下到的是 `version https://git-lfs.github.com/spec/v1` 那段文本，**不是音源**。FluidR3 正好在这 11 个里 |
| 同一个"列表"里，有的能直下、有的必然失败 | `GeneralUser GS v1.471.sf2` = 31,281,186 B（真文件）；`Florestan_Basic_GM_GS.sf2` = 3,272,882 B（真文件） | 用户看不出哪个能点 |
| 没有许可说明，来源混杂 | 仓库 README 只有 204 字节（只列了 SNES/NES/N64/Wii 那几个），**没有 LICENSE**；还含 `SC-55`、`Timbres Of Heaven` 这类商业合成器/ROM 衍生音源 | 我们不能把它当"推荐库"分发或承诺可用 |
| 我这台机器上直链根本不通 | `api.github.com` 200 ✓，`raw.githubusercontent.com` **和** `cdn.jsdelivr.net` 都 `fetch failed` ✗（jsDelivr 另有 20 MB 单文件上限） | 与你 `ERRORS-LOG` 里记的"raw 直链在部分网络不可达"一致 ⇒ "点一下自动下"必须永远有兜底 |

> 所以应用里**不出现**这个仓库的任何链接或列表。用户想要更多库，走「**添加音色库…**」本地文件
> （§5.1 的导入流程）——任何 `.sf2/.sf3` 都能进来，这比维护一份第三方清单稳，也不替别人的许可背书。

#### FluidR3 的下载页（这个我实测过）

`https://sourceforge.net/projects/pianobooster/files/pianobooster/1.0.0/FluidR3_GM.sf2/download`

| 查了什么 | 实测结果 | 影响 |
|---|---|---|
| 文件大小 | SF 目录页写着 **148.4 MB**（= 148,398,306 B），与你本地那份**一字不差的同大小** | 极可能就是同一个文件 ⇒ 归到同一条库条目（判定不靠字节等价，靠 INAM，见 §5.1） |
| 这个 URL 返回什么 | `200`、`text/html`、126 KB 的页面 | **不是文件流**，`fetch` 拿不到字节 |
| CORS | 该页与 `downloads.sourceforge.net` / `master.dl.sourceforge.net` 都**没有** `Access-Control-Allow-Origin` | 应用里 `fetch()` **必然被浏览器拦死** |
| 结论 | 只能当**下载页**（`window.open`，浏览器里点一下就下），下完回来导入 | `source` 留空、`autoDownload:false` |

> 若以后真要"应用内一键下 141 MB"，得走**桌面端 Rust 下载命令**（绕过 CORS + 边下边写盘 + 进度事件）。
> 本期不做：这条路只覆盖桌面端，而"下载页 + 导入"零风险、Web 端也能用。

#### 落地的具体条目（两条，都用作者/官方发布页）

| id | 界面名 | 体积 | 许可 | `source`（可自动下载） | `downloadPage`（打开下载页） |
|---|---|---|---|---|---|
| `generaluser_gs` | 通用音源（GeneralUser GS） | 32,319,396 B | GeneralUser GS License v2.0 | `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2`（现有） | `https://github.com/mrbumpy409/GeneralUser-GS` |
| `fluidr3_gm` | Fluid R3 GM | 148,398,306 B（141.5 MiB） | MIT | **无** | `https://sourceforge.net/projects/pianobooster/files/pianobooster/1.0.0/FluidR3_GM.sf2/download` |

三处细节别漏：

- **`source` 只给"真能 `fetch` 到字节"的那一个**（GeneralUser 官方 raw）。FluidR3 没有 ⇒ 界面不出
  `[下载并导入]`，只出 `[打开下载页]`，**不给用户一个点了必然失败的按钮**。
- `sf2NamePattern`：`/generaluser/i`、`/fluid\s*r3/i`。同 id 不同版本（如 GeneralUser v1.471 与 2.0.3）
  导入时走"覆盖确认"，列表显示**实际文件名与体积**。
- **仍要拦 LFS 指针**（用户可能从别处右键另存）：文件 < 4 KB 且开头是 `version https://git-lfs` ⇒
  明确报"这是 Git LFS 指针文件，不是音源本体"，**不新增条目**。

---

## 六、分阶段落地（每阶段独立可提交）

> 编号是建议值，落地时按当时最新 `adj` 号取（当前 `adj1008`）。

**进度**：

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 1（adj1009） | ✅ **已完成** | 引擎 `sf2.ts` + 库清单两条 + smoke `[200]`（30 条断言全绿，含两个真文件） |
| Phase 2（adj1010） | ✅ **已完成** | `bankRegistry.ts`（libs 表 v2）+ 导入识别 + 一次性迁移；smoke `[201]` 20 条；`verify:app-ui` 85 项全绿 |
| Phase 3（adj1011） | ✅ **已完成** | 试听/导出/面板统一走 `resolveActiveLibrary`；后端换库即重建；smoke `[202]` 12 条；`verify:app-ui` 85 项 |
| Phase 4（adj1012） | ✅ **已完成** | 库列表 + 「使用」+ 每库一套收藏 + 按库选音色（双行）；smoke `[203]` 13 条；`verify:app-ui` 85 项 |
| Phase 5（插件同步） | 待开工（另开会话） | 见下 |

### Phase 1（adj1009）：引擎 SF2 元数据解析 + 库清单扩展
- 新增 `packages/ijipu-engine/src/engine/playback/sf2.ts`（上面三个函数 + `Sf2Preset` 类型）。
- `soundbanks.ts`：`HqSampleLibrary` 增加 `sf2NamePattern`、`presetCount?`、`autoDownload: boolean`、
  `license?: string`；**复用已有的 `downloadPage`**（给用户手动下载的落地页）与 `source`（可 `fetch` 的直链）；
  `HQ_LIBRARIES` 追加 `fluidr3_gm`（`autoDownload:false`、**无 `source`**、`downloadPage` = SourceForge，见 §5.4）；
  `getHqLibrary` 改成 `findKnownLibrary(id) → HqSampleLibrary | undefined`（**不再默默回退默认库**，
  调用方自己决定回退，否则"库 id 写错"会静默变成"用默认库"——这正是本轮要消灭的那类 bug）。
- `engine/index.ts`、`engine/playback/index.ts` 导出新符号。
- smoke 断言（新增一段 `[200]`，实现在 §六 Phase 1 的落地记录里）：
  - 合成夹具（自带一个 200 字节的最小 SF2）：`readSf2Info` 读出 INAM；`readSf2Presets` 条数=记录数−1、
    **末条 EOP 必须不在结果里**、顺序按 (bank, program)；
  - `matchKnownLibrary({name:'Fluid R3 GM'}) === 'fluidr3_gm'`；
  - `matchKnownLibrary({name:'GeneralUser GS v1.471'}) === 'generaluser_gs'`（**老版本也要认**）；
  - 真实文件（**存在才跑**，因为 FluidR3 未跟踪）：generaluser=287/19 bank、FluidR3=189/5 bank、两库 bank0 都 128、
    **名字不同的正好 33 条**（这条是"真的读了内容"的机器证据）。

**落地记录（2026-10-21，adj1009）**：

| 文件 | 改动 |
|---|---|
| `packages/ijipu-engine/src/engine/playback/sf2.ts` | **新增**：`isSf2` / `isGitLfsPointer` / `readSf2Info` / `readSf2Presets` / `summarizeSf2Presets` / `matchKnownLibrary`（纯函数、零 DOM） |
| `packages/ijipu-engine/src/engine/playback/soundbanks.ts` | 清单加 `sf2NamePattern`/`autoDownload`/`license`/`presetCount`；追加 `fluidr3_gm`；新增 `findKnownLibrary`、`hqBankManualOnlyText`；`getHqLibrary` 标 **@deprecated**（Phase 3 改完调用点再删） |
| `packages/ijipu-engine/src/engine/index.ts` | 导出上面两组符号 |
| `src/playback/spessaSynthBackend.ts` | 转导出新符号；`loadHqBank` 加**手动下载闸**：`autoDownload === false` 或 `source` 为空 ⇒ 直接抛"照做"提示，**绝不用空串 `fetch`**（`fetch('')` 会请求当前页面） |
| `scripts/smoke.mts` | 新增 `[200]` 段（30 条断言）；修正 `adj767` 里钉死导出串的正则（改成点名式，不再要求字面顺序） |

实测输出（`node dist-smoke/smoke.cjs`，退出码 0）：

```
[200] sf2 metadata: info / presets / known-library matching (adj1009)
  ✓ adj1009 phdr：条数 = 记录数 − 1（5 条记录 ⇒ 4 个预设）
  ✓ adj1009 **负对照**：末条 "EOP" 不在结果里
  ✓ adj1009 真 GeneralUser：287 个预设 / 19 个 bank / bank0 恰好 128
  ✓ adj1009 真 FluidR3：189 个预设 / 5 个 bank / bank0 恰好 128
  ✓ adj1009 真 FluidR3：结果**已排序**（文件里第一条是 `0:127 Gun Shot`，排序后第一条应是 0:0）
  ✓ adj1009 两库 bank0 音色名**确有差异**（实测 33 / 128）
  ✓ adj1009 FluidR3 抛错前**一次 fetch 都没发**
ALL SMOKE TESTS PASSED ✅
```

另跑过：`npx tsc -b` 退出 0、`npx oxlint` 0 error（58 条 warning 均为既有）。

### Phase 2（adj1010）：库注册表 + 导入 + 迁移
- 新增 `src/playback/bankRegistry.ts`：IndexedDB `ijipu-soundfonts-hq` **v1 → v2**，
  新增 objectStore `libs`（键=libId，值=`Sf2Library`）。`banks` 存字节的语义不变。
- 导入流程（`SoundBankPanel` 的「导入音色文件」改为）：读 `File.arrayBuffer()` →
  `readSf2Info`/`readSf2Presets` → `matchKnownLibrary` → **弹出确认**（显示识别到的库名、
  体积、音色数、是否覆盖已有库）→ 写 `banks/<id>` + `libs/<id>` → 刷新列表 → 自动选中。
- 导入失败（不是 SF2 / 读不动 / 配额不足）要**明确报错且不新增条目**；配额失败时提示
  "本次可用，退出后需重新导入"（141 MB 在部分机器上会超配额）。
- **拦 Git LFS 指针**（§5.4）：文件 < 4 KB 且开头是 `version https://git-lfs` ⇒ 报
  "这是 Git LFS 指针文件，不是音源本体，请到下载页重新下载"，不新增条目、不留半截缓存。
- **一次性迁移**（只跑一次，标记 `ijipu.soundbankLibsV2`）：`libs` 为空且 `banks` 里有 `generaluser_gs` 时，
  读那份字节的 INAM：是 GeneralUser ⇒ 登记为内置库的"用户提供"副本；是 FluidR3 ⇒
  **把字节搬到 `fluidr3_gm` 键**并登记；都不是 ⇒ `imported_<hash>`。**这就是修好你现在这台机器状态的那一步。**
- smoke：迁移函数抽成纯编排（注入假 cache + 假解析器），断言三种归位结果。

**落地记录（2026-10-21，adj1010）**：

| 文件 | 改动 |
|---|---|
| `src/playback/bankRegistry.ts` | **新增**：`fingerprintOf` / `bankIdOf` / `readBankFile`（纯函数）、`openSoundfontDb`（**全应用唯一的 `indexedDB.open`**，v1→v2 增 `libs`）、字节读写四个函数、`BankRegistry`（list/get/put/remove）、`planLegacyMigration`（纯决策）、`migrateLegacyBanks`（可注入 IO 的编排）、`ensureBankRegistry`（启动入口，带 `ijipu.soundbankLibsV2` 标记） |
| `src/playback/spessaCache.ts` | `HqCache` 四个方法改为委托 `bankRegistry` 的字节读写（**接口一字未变**），删掉自己那份 `indexedDB.open(…, 1)` |
| `src/main.tsx` | `render()` **之后** fire-and-forget 跑一次迁移（141 MB 的读/搬不该挡首屏）；失败只 `console.warn`，不阻断启动 |
| `src/dialogs/SoundBankPanel.tsx` | 「导入音色文件」改成：读字节 → `readBankFile` 认库 → （同名库先 `confirm`）→ 写 `banks/<id>` → 登记 `libs/<id>`；三种拒绝分别给原因 |
| `scripts/smoke.mts` | 新增 `[201]` 段 20 条断言；把 SF2 夹具提成 `buildSf2Fixture`（`[200]`/`[201]` 共用，避免两份手搓字节漂移） |

这一步刻意**没做**的两件事（留到 Phase 4）：

- 覆盖确认用的是 `window.confirm`（临时）：Phase 4 换成应用内的确认条/对话框。
- 「库列表」界面还没做：导入成功后只是写进了 `libs`，界面上要 Phase 4 才看得见（现在仍显示默认库那一行）。

实测输出（`npm run smoke`，退出码 0）：

```
[201] soundbank registry: import recognition + one-time migration (adj1010)
  ✓ adj1010 库 id：已知库按 INAM 认领，与指纹无关（同库不同版本归同一个 id）
  ✓ adj1010 导入识别：Git LFS 指针被拒，并说清"去下载页下真正的 .sf2"
  ✓ adj1010 导入识别：能打开但一个音色都没有 ⇒ 也拒收
  ✓ adj1010 迁移②：**冒名的键**（generaluser_gs 里装的是 FluidR3）⇒ 搬到 fluidr3_gm 并按 INAM 改名
  ✓ adj1010 迁移编排：**幂等**——再跑一次直接跳过
  ✓ adj1010 迁移编排：老缓存里是垃圾字节（下载中断）⇒ 跳过、不搬不登记
ALL SMOKE TESTS PASSED ✅
```

另跑过：`npm run build` 退出 0；`npm run verify:app-ui` **全部通过（85 项）**。

⚠ **我没能验的一条**：真实 IndexedDB 的 v1→v2 升级路径（Node 里没有 `indexedDB`，smoke 用的是假 IO）。
按标准 IDB 语义它是安全的（`onupgradeneeded` 里只 `createObjectStore` 缺的那张表），
但我**没有**在真浏览器里做过"带着 v1 数据升级到 v2"的实测。Phase 3 之前建议在 dev 里手点一次导入确认。

### Phase 3（adj1011）：播放/导出接上"当前库"
- `PlaybackDialog.ensureBank` / 播放段 / `ExportPanel` / `SoundBankPanel` 全部改成
  `findKnownLibrary(playbackHqLibrary) ?? 默认库`。
- `SpessaSynthBackend.load(bank, libId)`：换库即重建（见 §5.3）。
- 切库时：`useEffect` 依赖 `playbackHqLibrary` → 重置 `bankPromiseRef`、`hqDl` 状态、停播、重载。
- `brand/copy.ts:736` 的 `builtinBankHint` 改成 `builtinBankHint(fileName)`（不再硬编码 generaluser_gs.sf2）。
- smoke：`resolveHqBank` 用**传入 lib 的 id** 取缓存（负对照：传 fluidr3 时不得读到 generaluser 的键）。

**落地记录（2026-10-21，adj1011）**：

| 文件 | 改动 |
|---|---|
| `engine/playback/soundbanks.ts` | 新增 `resolveActiveLibrary(id)` —— **"当前用哪个库"的唯一判据**：空 id ⇒ 默认库且 `fallback:false`；命中 ⇒ 那个库；有值但查不到 ⇒ 默认库 + **`fallback:true`**（界面必须告知） |
| `src/playback/spessaSynthBackend.ts` | `HqCache` 之外那层：`SpessaSynthBackend` 新增 `loadedBankId`；`load(bank, url, libId)` 遇到**不同 id 就 `dispose()` 整段重建**（原来第二次调用直接 return，切库根本不换声）；失败时也 `dispose()` 清半成品（否则重试会跳过 `addSoundBank`，静默无声） |
| `src/dialogs/PlaybackDialog.tsx` | 取音源改 `activeLib.lib`；预取 effect 依赖 `playbackHqLibrary`（切库作废旧 Promise 与状态）；`backend.load(bank, undefined, lib.id)`；失败提示里的库名改成当前库 |
| `src/ui/dock/ExportPanel.tsx` | 导出音频用当前库（原来是无参取默认库） |
| `src/dialogs/SoundBankPanel.tsx` | 面板显示/预取/导出都跟当前库；新增一行"你选的音色库不在了…已临时用默认库"（`fallback` 时才出） |
| `src/brand/copy.ts` | `builtinBankHint` 改成 `(fileName) => …`，不再硬编码 `generaluser_gs.sf2` |
| `scripts/smoke.mts` | 新增 `[202]` 段 12 条断言（判据 4 条 + 接线 6 条 + 负对照 1 条 + 文案 1 条） |

实测输出（`npm run smoke`，退出码 0）：

```
[202] active soundbank wiring: pick library / reload backend (adj1011)
  ✓ adj1011 判据：id 有值但查不到 ⇒ 回退默认库且 **fallback=true**
  ✓ adj1011 试听/导出/面板**都不再**无参取默认库
  ✓ adj1011 后端重建：`load()` 记库 id，id 变了就 `dispose()` 整段重来
  ✓ adj1011 取字节**负对照**：GeneralUser 不会串用 FluidR3 的缓存
ALL SMOKE TESTS PASSED ✅
```

另跑过：`npx tsc -b` 0、`npx oxlint` 0 error、`npm run build` 0、`npm run verify:app-ui` **85 项全绿**。

⚠ **这一步做完，用户还看不出变化**：因为"选库"的按钮在 Phase 4 才做。现在 `playbackHqLibrary` 只有
"导入收藏 JSON"能改；等 Phase 4 把库列表和「使用」按钮做出来，切换才会真正生效（底层已经全部接好）。

### Phase 4（adj1012）：UI——库列表 + 库内音色
- `SoundBankPanel` 重排为三块（沿用 adj509 的分块风格）：
  1. **音色库列表**：每行 `显示名 · 来源[内置/已导入/需自行下载] · 实际文件名 · 体积 · N 音色 · 许可 · ✓当前` +
     `[使用] [下载并导入]（有 source 才出） [打开下载页] [导出] [删除]`；底部 `[添加音色库…]`；
  2. **当前库的音色**：搜索 + 14 组分组 + 双行显示（§四）+ `[全选本库] [全消本库]` + "已选 x / 本库 y"；
  3. **数据导入导出**：收藏 JSON（v2：带 `hqLibrary` + `hqEnabledByLib`，仍兼容读 v1）+ 音色文件导入导出。
- `VoicePickerDialog`：数据源从 `GM_VOICE_OPTIONS` 改为当前库 presets（没有库元数据时回退 GM 表并提示）。
- `uiStore`：`playbackHqEnabled` → `playbackHqEnabledByLib`，新增纯选择器
  `enabledVoicesOf(state)`；改 6 个调用点（`docStore:92`、`ScriptToolbar:91`、`PreviewPane:128`、
  `PlaybackDialog:91`、`ExportPanel:70`、`VoicePickerDialog:27`）。旧值（`number[]`）迁移到 `generaluser_gs`。
- 新库默认收藏：该库存在的"常用 7 个"（`DEFAULT_HQ_ENABLED`）；一个都不存在时全选 bank 0。
- **UI 改完必须跑 `npm run verify:app-ui`**（AGENTS：adj959 的教训，源码级断言守不住"点了没动"）。

**落地记录（2026-10-21，adj1012）**：

| 文件 | 改动 |
|---|---|
| `src/store/uiStore.ts` | `playbackHqEnabled: number[]` → **`playbackHqEnabledByLib: Record<string, number[]>`**；新增唯一读取口 `enabledVoicesOf(state)`（用 `hasOwnProperty` 区分"没配过"和"全消成空"）；新增 `replacePlaybackHqEnabledByLib`（导入收藏 v2 用）；**旧版单数组自动迁移**到默认库并删旧键；改 7 个调用点（docStore / ScriptToolbar / PreviewPane / PlaybackDialog / ExportPanel / VoicePickerDialog / SoundBankPanel） |
| `src/playback/bankRegistry.ts` | 新增 `BankRow` / `buildBankRows`（已知库**永远在**、导入库追加在后）/ `libViewOfRecord`（用户库没有直链，不会出"注定失败"的下载按钮）/ `presetCountOf` |
| `src/dialogs/SoundBankPanel.tsx` | **重写为三块**：① 音色库列表（行内 `[使用][下载并导入*][下载页*][从插件目录导入*][导出][删除*]` + 底部 `[添加音色库…]`）② 当前库的音色（已选/本库可选数 + 全选/指定/全消 + "另有 N 个变体/鼓组暂不可选"）③ 收藏导入导出（JSON v2） |
| `src/dialogs/VoicePickerDialog.tsx` | 数据源改为**当前库的 presets**（只 bank 0）；每行 `GM 中文名 · 本库原始名`；本库音色表未读到时回退 GM 128 并**如实说明** |
| `src/brand/copy.ts` | `voicePickerCopy.summary` 带库名；新增 `fallbackHint` |
| `scripts/smoke.mts` | 新增 `[203]` 段 13 条；`adj581` 的标题断言跟着改成「音色库 / 当前库的音色」 |

**几个刻意的取舍**（写下来免得以后当成 bug）：

- 新库**不预置**收藏：`enabledVoicesOf` 对"没配过"的库回落常用 7 个，所以新库一上手就能试听；
  点过「全消」之后就是空（不会又冒出来 7 个）。
- 变体/鼓组（bank≠0）**只统计不开放**：行里写"另有 N 个"，不假装能选。
- 收藏 JSON 导出 `version:2`（含每库一套），同时保留 `hqEnabled` 兼容字段；导入能读 v1/v2。
- 覆盖同名库仍用 `window.confirm`（Phase 4 没做应用内确认框，避免动 `ui/Modal` 的层级）。

实测输出（`npm run smoke`，退出码 0）：

```
[203] multi-library UI: rows / per-library favorites / picker (adj1012)
  ✓ adj1012 收藏：**配过但全消** ⇒ 就是空（不能退回默认 7 个，否则「全消」点不动）
  ✓ adj1012 列表：已知库**必定出现在列表里**（默认库永远第一行，即便还没下载）
  ✓ adj1012 面板：**不再**写死默认库（`HQ_LIBRARIES[0]` 已清零）
  ✓ adj1012 选择器：按当前库列音色（读 `record.presets`）并显示"中文名 + 本库原名"
ALL SMOKE TESTS PASSED ✅
```

另跑过：`npx tsc -b` 0、`npx oxlint` 0 error、`npm run build` 0、`npm run verify:app-ui` **85 项全绿**。

⚠ **仍然没验的两条**（和 Phase 2/3 一样，需要真机手点）：

1. 真实 IndexedDB 的 v1→v2 升级；
2. 两个新按钮的实际点击效果（`使用` 之后声音是否真的换、`添加音色库…` 选 141 MB 文件后的表现）。

`verify:app-ui` 覆盖的是既有 85 项，**不含**音色库面板——这两条只能手点或另写一段 CDP 用例。

### Phase 5（另开会话）：Obsidian 插件同步
- `vendor/engine` 逐字节同步 → 插件 `settings.ts` 的"音色库"改成列表 + 「导入为新库」；
  `bankUrls()` 要按**所有** lib 给 URL；`bankFile.ts` 的 `<id>.sf2` 落点规则不变。
- 按插件自己的更新量单独升版本、补 RELEASE-NOTES、单独提交 + tag。
- 顺序铁律：**应用版本号定稿 → `npm run build:embed && node scripts/embed-emit.mjs` → 再发插件**。

---

## 七、迁移：把你现在这台机器的状态掰正

现状：`banks/generaluser_gs` 里其实是 FluidR3 的字节（见 §2.3）。Phase 2 的迁移会：

1. 读该字节的 INAM → `Fluid R3 GM`；
2. 命中 `fluidr3_gm` → 字节搬到 `banks/fluidr3_gm`、登记 `libs/fluidr3_gm`（来源标 `imported`）；
3. `generaluser_gs` 回到"随包内置"状态（桌面直接读安装目录那份，不占缓存）；
4. 你当前的收藏（`[0,10,40,48,56,71,73]`）迁到 `generaluser_gs` 名下；
   新库 `fluidr3_gm` 默认同样勾这 7 个（它 bank 0 全齐，都有）。

结果：升级后打开设置，列表里**两条**——GeneralUser（内置，人在用）和 Fluid R3 GM（已导入，141.5 MB，189 音色）。

---

## 八、拍板记录（2026-10-21 用户确认，已定稿）

| # | 事项 | 结论 |
|---|---|---|
| ① | FluidR3 要不要内置进安装包 | **不内置**。下载入口 = SourceForge 的 `/download` 页（`[打开下载页]`）；没有可 `fetch` 的直链所以**不出** `[下载并导入]` |
| ② | 音色行显示口径 | **`GM 中文名` 主行 + `本库原始名` 副行**（`Y:` 仍写中文名，谱面可移植） |
| ③ | bank≠0 的变体/鼓组 | **先只做 bank 0**；列表里如实写"本库另有 N 个变体/鼓组（暂不可选）"，以后单开一期 |
| ④ | 收藏粒度 | **每库一套**（`playbackHqEnabledByLib`，切库即切收藏） |
| ⑤ | 第三方收藏集（Daniel-176）怎么用 | **不用**：理由见 §5.4（11 个 LFS 指针、无 LICENSE、混商业/ROM 音源）。要更多库就走「添加音色库…」本地文件 |
| ⑥ | 两个库的下载地址 | GeneralUser = **官方 GitHub**（`mrbumpy409/GeneralUser-GS`，直链沿用现有）；FluidR3 = **SourceForge（PianoBooster 1.0.0）** 的 `/download` 页 |

落地时**不需要再确认什么**；只有一条维护约定：SourceForge 页面若改版，改 `HQ_LIBRARIES` 里
`fluidr3_gm.downloadPage` 一处即可（库本身已在用户机器上时不受影响）。

---

## 九、验收（命令 + 负向判据）

| 层 | 命令 | 判据 |
|---|---|---|
| 引擎 | `npm run smoke` | 新增 `[200]` 段全绿；末条 EOP 不在结果里；真实文件 287/189、33 条名字差异 |
| 类型/构建 | `npm run build` | `tsc -b` + `vite build` 通过（含 `check:encoding` 前置） |
| 界面 | `npm run verify:app-ui` | 列表出现两条库；点「使用」后音色区标题/数量/名字**跟着变**；点「指定音色」弹窗是当前库的音色 |
| 桌面 | `npm run check:installer` | 若动打包，安装清单仍含 `generaluser_gs.sf2` 与许可 |

**负向判据（必须逐条手测）**：

1. 导入一个 `.txt` 改名成 `.sf2` → 明确报错（"不是有效的 SF2"），列表**不新增**条目。
2. 导入一个 **134 字节的 Git LFS 指针**（从第三方仓库右键另存 raw 就会拿到）→ 报
   "这是 LFS 指针文件，不是音源本体"，**不新增**条目。这条最容易真实发生。
2. 选中 FluidR3 → 重启应用 → 仍是 FluidR3（`playbackHqLibrary` 真的被读）。
3. 切回 GeneralUser → 试听面板音色下拉**立刻**变成 GeneralUser 名单（证明后端真的重载了，不是只改了文字）。
4. 删掉当前库 → 自动回退默认库、不白屏、不报 uncaught。
5. 断网 + 缓存里没有该库 → 提示说清是**哪个库**、去哪手动导入（不能还写 generaluser_gs）。
6. 导出音频 → 用的是**当前库**；导出文件名是 `<当前库 id>.sf2`。

---

## 十、风险与边界

| 风险 | 处理 |
|---|---|
| 141 MB 内存 ×2（主线程 + worklet） | 切库前确认；加载中显示库名与体积；失败回退上一个库并提示 |
| IndexedDB 配额（Chrome 约 60% 磁盘） | 写入 `catch` 后降级为"本次会话可用"，**不静默失败** |
| 启动变慢 | 元数据（presets）只在**导入时解析一次**并持久化，启动只读 `libs` 表 |
| 两个库混用 | 本方案明确"一次只用一个库"；§八 ③ 之后才谈 |
| SourceForge 页面改版 / 文件被撤 | 它只当外链，失效最坏是"点开下不到"；已导入的库不受影响。维护点只有 `downloadPage` 一个字符串 |
| 未跟踪的 FluidR3 进 git | 141 MB 会撑爆仓库 ⇒ 明确**不进**；smoke 用合成夹具，真文件"存在才跑" |
