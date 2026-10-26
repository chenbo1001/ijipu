# 安装包与资源包方案（音色库 / 视频工具）

> **⚠ 2026-10-26 规则变更（现行）**：不再做「一个资源包 exe 里勾选多个组件」；
> **每个资源文件单独一个安装器**，文件名必须体现「资源类型 + 资源名称 + 资源自身版本」：
>
> `iJipu-<SoundFont|Tool>-<ResourceId>_<ResourceVersion>_x64-setup.exe`
>
> 例：`iJipu-SoundFont-GeneralUserGS_1.471.0_x64-setup.exe`、
> `iJipu-Tool-FFmpeg_1.0.0_x64-setup.exe`。
> **资源版本与应用版本解耦**：应用发新版不重打包资源；资源文件本身更新才升版本。
> 现行规则/实现/闸门见 **`docs/INSTALLER-NAMING.md`**；本文下面 §四 的「一个 exe、三个组件」
> 是历史方案，已作废（保留仅作沿革）。

> **需求来源**：用户 2026-10-21 ——
> ① 卸载时给选项：**完全卸载** / **保留配置和已下载音色库、工具**，保留时**不删主应用目录**，下次安装直接复用；
> ② 把**大的音色库和 ffmpeg 等工具**做成**单独的安装包**，安装时自动识别主应用目录、装进主应用目录；
> ③ 主应用安装包**不再包含**这些大件；
> ④ 资源包的名称要与主应用**强关联**（如「爱记谱 iJipu 资源包」）。
>
> **状态**：**I-1/I-2/I-3 的主要部分已落地**（2026-10-23，`adj1082`）：
> 主包去音色库（`adj1020`）、独立资源包安装器（`src-tauri/nsis/assets-installer.nsi` + 构建/检查脚本）、
> 卸载二选一与 `keep.flag`（经 `installerHooks` 实现，**未接管 Tauri 模板**；§三·2 的 B 方案仍是后续可选项）、
> DisplayName/InstallDir。开工按 `git log` 取 `adj` 号。
>
> **主包音色库口径（用户 2026-10-21 拍板 A）**：**桌面主安装包不含任何音色库**，
> `generaluser_gs.sf2` 一并移进资源包。主包从 33 MB 降到约 3 MB；
> 新用户首次试听走「装资源包 / 联网下载」引导（见 §四 的后果说明）。
>
> **相关**：`tauri.conf.json` 的 `bundle.resources`、`src-tauri/nsis/hooks.nsh`、
> `src-tauri/src/lib.rs` 的音色库定位、`docs/CLI.md`（PATH 注册，卸载时要一起摘）

> ---
>
> **⚠ 2026-10-22 更新：ffmpeg 不再需要。**
> 出片改成 **WebCodecs + Mediabunny**（浏览器原生 H.264 / AAC 编码），实测可用并已跑通导入。
> 于是本文里所有关于 **ffmpeg 的部分（§四 的组件、§八 的"两个来源"、I-4 里程碑）全部作废**，
> 资源包只剩音色库。详见 `docs/DYNAMIC-SCORE-PLAN.md` §〇·2。
>
> 仍然有效的部分：**主包不带音色库**、**资源包装进安装目录的 `soundfonts\`**、
> **卸载二选一（接管 NSIS 模板）**、**命名与显示名**。

---

## 一、现状（本机实测，不是猜的）

| 事实 | 数值 / 位置 |
|---|---|
| 当前安装包 | `iJipu_0.70.1_x64-setup.exe` = **33.0 MB** |
| 其中音色库 | `generaluser_gs.sf2` = **30.82 MB**（`bundle.resources` 里） |
| 库里的另一个大件 | `FluidR3_GM.sf2` = **141.52 MB**（未跟踪、还没进包） |
| 卸载器删文件方式 | 按 `bundle.resources` 生成的**逐个 `Delete` 清单**，末尾 `RMDir /REBOOTOK` 子目录 + `RMDir "$INSTDIR"`（**非递归**） |
| 卸载器已有勾选框 | `$(deleteAppData)`，删 `%APPDATA%\<identifier>` 与 `%LOCALAPPDATA%\<identifier>` |
| 卸载器语言 | **只有 English**（生成的 `installer.nsi` 里只有 `MUI_LANGUAGE "English"`） |
| 随包音色库查找 | `resource_dir()` = **exe 所在目录**，先找 `<file>` 再找 `soundfonts\<file>` |
| 下载缓存位置 | `app_data_dir()/soundfonts/`（另有 IndexedDB 一份） |

**两条直接影响方案的结论**：

1. **卸载器删不到清单以外的文件**，而且 `RMDir` 是非递归的 ⇒ 只要把音色库从
   `bundle.resources` 里摘掉，卸载时它们就**自然留下**，目录也留得下来。
   「保留」不需要接管模板。
2. **已经有「删 AppData」的开关**，但文案是英文、语义也不包含安装目录里的大件。
   要一个真正的中文「完全卸载 / 保留」二选一，就得接管 NSIS 模板（见 §三·2）。

---

## 二、目标拆解

| 编号 | 目标 | 验收 |
|---|---|---|
| R1 | 主安装包瘦身 | 主包 ≤ 5 MB（现在 33 MB） |
| R2 | 资源包独立 | 音色库 + ffmpeg 可单独装、单独卸、可只装一部分 |
| R3 | 卸载二选一 | 完全卸载 / 保留；保留后重装**不重新下载** |
| R4 | 运行时能找到 | 缺件有引导（下载 or 装资源包），不是干报错 |
| R5 | 不破坏现状 | 文件关联、CLI PATH、快捷方式、`/UPDATE` 静默更新全部照旧 |

---

## 三、关键设计判断

### 3.1 谁能删谁的文件（最重要的约定）

两个安装器写同一个目录，最容易出的问题就是「A 卸载把 B 的文件删了，B 的卸载入口还在但文件没了」。

约定：**谁装的谁删**。

- 主应用：只删自己的程序文件（exe / dll / bin / LICENSE…）。
- 资源包：只删自己装的 `soundfonts\*.sf2`、`tools\ffmpeg*`，并删自己的卸载项。
- 主应用「完全卸载」时：**调用**资源包的卸载器（注册表里记的路径，`ExecWait ... /S`），
  调不到（被手删）才兜底 `RMDir /r` 那两个子目录。
- 更新（`/UPDATE`）：**不弹窗、不删任何资产**，沿用现有 `$UpdateMode` 守卫。

### 3.2 二选一界面放哪（**已定：B 接管模板**）

| 方案 | 结论 |
|---|---|
| A 不接管模板（沿用勾选框 + 弹窗） | ✗ 两处控制，用户容易懵；文案还是英文 |
| **B 接管模板**（自定义 `installer.nsi` + 中文单选页） | ✓ **采用** |
| C 只改语言（加 `SimpChinese`） | ✗ 文案仍是「删除应用数据」，和"还要删工具"对不上 |

**接管后的具体改动点**（每一条都要有对应的验证）：

1. `bundle.windows.nsis.template` 指向 `src-tauri/nsis/template/`，里面放从 Tauri 内置模板复制来的 `installer.nsi`；
2. 确认页加中文单选：**完全卸载** / **保留音色库和工具（约 XXX MB）**，默认保留；
3. 卸载段按选择分支（删目录 / 留目录 + 写 `keep.flag`）；
4. 「完全卸载」时 `ExecWait` 调资源包卸载器，调不到再兜底 `RMDir /r`；
5. `DisplayName` 改中文（见 §八），**注册表键名与安装目录一概不动**；
6. 保留现有 `installerHooks` 的 `!include`（`hooks.nsh` 里的关联、快捷方式、PATH 逻辑一行都不能丢）。

⚠ **`installer.nsi` 是 Tauri 生成的，不是手写的**。接管等于把它的生命周期揽过来：
以后 Tauri 升级、模板变了，我们不会自动获得修复。所以发布流程里要加一道
`scripts/check-nsis-template.mjs`（拿本仓库模板与 CLI 内置模板 diff，有差异就打印）。

### 3.3 资源包怎么找到主应用目录

按顺序试，前一条不通走下一跳：

1. `HKCU\Software\iJipu\InstallDir` —— **我们自己**在 `NSIS_HOOK_POSTINSTALL` 里写，路径确定；
2. `%LOCALAPPDATA%\iJipu` —— Tauri 在 currentUser 模式下的默认安装目录；
3. 让用户**手动选** `ijipu.exe`（文件夹选择框）。

选完先校验目标目录里**确实有 `ijipu.exe`**，否则提示「请先安装 iJipu 主程序」并退出。
不依赖 Tauri 模板内部的键名（那是实现细节，升级可能变）。

### 3.4 运行时查找口径（一处定义，别各写一套）

**两个位置，性质完全不同，千万别混**：

| 位置 | 谁写 | 放什么 | 应用自己写 |
|---|---|---|---|
| `%LOCALAPPDATA%\iJipu\`（= 安装目录） | **安装器**（主包 / 资源包） | 随包内置、资源包装的 | 不靠它（要权限） |
| `%APPDATA%\com.ijipu.app\soundfonts\` | **应用自己** | 在线下载、用户导入 | 就是写这里 |

`lib.rs` 的 `builtin_soundfont_candidates()` **现在就是对的**（`adj1013` 已补第三条），
顺序不用改：

1. `<安装目录>\<file>` —— 用户自备覆盖（`adj416` 既有约定，**优先**）
2. `<安装目录>\soundfonts\<file>` —— **资源包装在这里**
3. `<app_data>\soundfonts\<file>` —— 应用自己下载 / 导入的那份

前端那一层还有 IndexedDB（`ijipu-soundfonts-hq`），预取顺序是
**缓存 → 宿主 → 内置（上面三条）→ 联网**。

⇒ **不需要新造 `resolveAsset()`，也不需要另立 `assets\` 目录**：装进安装目录的 `soundfonts\`
自动落进"内置"这一档，`adj1014` 的扫描也会把它标成「随包」。
资源包只额外写一份 **`<安装目录>\assets.manifest.json`**（装了哪些包、版本、来源），
供「资源包较旧」提示和卸载页算体积用。

> ⚠ 我早先在本节写过一条 `%LOCALAPPDATA%\iJipu\assets\` 作为"下载落点"——那是我编的，
> 与实际代码不符（下载落 IndexedDB / `%APPDATA%`）。**已删除**，以本节为准。

---

## 四、两个包各装什么

**主包**（`iJipu_x.y.z_x64-setup.exe`，目标 ≤ 5 MB）

- `ijipu.exe`、`WebView2Loader.dll`、`uninstall.exe`
- `LICENSE`、`THIRD-PARTY.md`、`bin\ijipu.cmd`

**资源包（历史方案，已作废；现行见 `docs/INSTALLER-NAMING.md`）**

> 2026-10-26 起改为**每个资源文件一个安装器**，不再有「一个 exe、三个可选组件」。
> 现行文件名：`iJipu-SoundFont-GeneralUserGS_<资源版本>_x64-setup.exe`、
> `iJipu-SoundFont-FluidR3GM_<资源版本>_x64-setup.exe`、`iJipu-Tool-FFmpeg_<资源版本>_x64-setup.exe`。
> 用户按需下载单个安装包；每个包只装一个文件、单独卸载。

| 资源类型 | 资源 id 示例 | 安装落点 |
|---|---|---|
| 音色库 `SoundFont` | `GeneralUserGS` / `FluidR3GM` | `%LOCALAPPDATA%\iJipu\soundfonts\` |
| 工具 `Tool` | `FFmpeg` | `%LOCALAPPDATA%\iJipu\tools\` |

落点（当前账号下，实际路径）：

- 音色库：`C:\Users\<用户名>\AppData\Local\iJipu\soundfonts\`
- 视频工具：`C:\Users\<用户名>\AppData\Local\iJipu\tools\`

全选约 250 MB；LZMA 压缩后整包大概 120–150 MB。

> ⚠ **和应用自己下载的音色库分开放**：那份在
> `C:\Users\<用户名>\AppData\Roaming\com.ijipu.app\soundfonts\`（`app_data_dir`）。
> 音色库页面两处都扫，列表里分别标「随包」和「本机」（`adj1014` 已定）。

> ✅ **主包口径已定（用户 2026-10-21，选 A）**：**桌面主安装包不含任何音色库**，
> `generaluser_gs.sf2` 一并移进资源包（不再随主包）。
> 后果：主包约 3 MB；新用户装完主程序**不能直接试听**，首次试听走两条引导——
> 「安装资源包」或「联网下载 30 MB」。
> `docs/SOUNDBANK-PAGE-PLAN.md` 顶部已加「口径变更」说明，那边「已随应用内置」的文案
> 只对装过资源包的机器成立。

**安装页必须有一句话说明用途**，否则用户不知道该不该勾：

> 这些文件供「爱记谱 iJipu」试听与视频导出使用。全部不装也能正常打开和编辑谱面，
> 只是试听需要联网下载音色库、导出视频需要再装视频工具。

---

## 五、卸载流程（接管模板后的最终形态）

1. 确认页加一个中文单选：**完全卸载** / **保留音色库和工具（约 XXX MB）**，默认**保留**（安全）。
2. **完全卸载**：删程序 → 调资源包卸载器 → **按目录**清 `soundfonts\`、`tools\`
   （含老版本遗留的那份 `generaluser_gs.sf2`，它已不在卸载清单里）→ 删 `%APPDATA%`/`%LOCALAPPDATA%`
   → 删注册表 / PATH / 关联。
3. **保留**：删程序、快捷方式、关联、PATH，**不删** `soundfonts\`、`tools\`、`%APPDATA%`；
   在目录里写 `keep.flag`（说明这个目录为什么还在）。
4. 静默卸载（`/S`）与更新（`/UPDATE`）：**不弹窗，默认保留**。
5. 再次安装：安装器检测到目录里已有 `soundfonts\`，提示「检测到上次保留的音色库，将直接复用」。

---

## 六、里程碑

| 批次 | 内容 | 能否独立发布 |
|---|---|---|
| **I-1** | 主包瘦身：`generaluser_gs.sf2` 移出 `bundle.resources` + 首次启动缺件引导 | 能 |
| **I-2** | 资源包安装器：三组件 + 定位主应用 + 自己的卸载项 | 能 |
| **I-3** | 卸载二选一（接管模板）+ 保留复用 + `keep.flag` | 依赖 I-1/I-2 |
| **I-4** | ffmpeg 在线下载（与资源包二选一，见动态谱方案 §八） | 能（视频功能的前置） |
| **I-5** | 中文安装界面（`SimpChinese` + 文案） | 能 |

**I-1 与存量用户的兼容**：老版本用户安装目录里已经有一份 `generaluser_gs.sf2`。
新版主包把它移出清单后，这份文件**不要删**——它正好能被 `resolveAsset()` 直接复用，
省掉一次 30MB 下载。代价是它**不在新卸载清单里**了，所以「完全卸载」必须**按目录**清
（`RMDir /r "$INSTDIR\soundfonts"`），不能只按文件名删。§五·2 已按这个口径写。
新装用户则没有这份文件，首次试听会走缺件引导。

---

## 七、风险

1. **模板漂移**：接管 `installer.nsi` 后，Tauri 升级改模板我们不知道。
   → 发布前跑 `scripts/check-nsis-template.mjs`：拿本仓库模板与 `tauri-cli` 内置模板做 diff，
   有差异就打印出来让人看。这条要进发布流程（`docs/VERSIONING.md` 的检查清单）。
2. **两个安装器写同一目录**：装资源包时主应用正在运行 → 文件占用。
   → 资源包安装前检测 `ijipu.exe` 进程，提示先退出。
3. **「保留」之后没有卸载入口**：主应用卸载项没了，只剩资源包那一个。
   → 由资源包卸载项兜底 + 安装器"复用"提示；不再另做清理工具（若你要求，再加）。
4. **首次试听无声**：主包不含音色库后，新用户第一次点试听会没声音。
   → 必须有缺件引导（下载 / 装资源包），**不能只弹一句报错**。这是 I-1 的一部分。
5. **大文件进 NSIS**：141MB 的音色库塞进一个 exe，下载体验差。
   → 备选：资源包拆成「基础包 / 高级包 / 工具包」三个 exe，各自独立卸载项。
6. **PATH 注册**：`adj944` 把安装目录写进了用户 PATH；「保留」时目录还在但程序没了，
   PATH 里的那条会指向空目录。→ 卸载时一律摘掉 PATH（现有 `cli-path.nsh` 已做），
   「保留」不清目录即可。

---

## 八、命名与显示名（用户 2026-10-21 要求：与主应用强关联）

### 8.1 一个必须先说清的约束

主应用在「应用和功能」里现在显示的是 **`iJipu`**（= `tauri.conf.json` 的 `productName`）。
这个字段**同时**决定两件事：

- 安装目录 `%LOCALAPPDATA%\iJipu`；
- 卸载注册表键 `...\Uninstall\iJipu`。

所以**不能**为了让它显示中文就去改 `productName`——老用户会被装到新目录、旧目录整套残留
（`nsis/hooks.nsh` 的注释里已经写明这条，`adj539` 踩过）。

### 8.2 接管模板带来的机会：只改「显示名」

`DisplayName` 只是一个**值**，和键名、目录都无关。接管模板后可以：

| 项 | 现在的值 | 改成 |
|---|---|---|
| 主应用 DisplayName | `iJipu` | `爱记谱 iJipu` |
| 资源包 DisplayName | —— | `爱记谱 iJipu 音色库 · GeneralUser GS`（类型 + 资源名） |
| 资源包卸载键 | —— | `...\Uninstall\iJipuAsset-<ResourceId>`（每个资源一个） |
| 资源包文件名 | —— | `iJipu-<Type>-<ResourceId>_<资源版本>_x64-setup.exe`（ASCII，下载链接/命令行友好） |

这样两个条目在列表里按同一前缀相邻，用户一眼能认出是一套；删资源包不会误删主程序，
反之亦然。

### 8.3 资源包内部文案

- 安装向导标题：`爱记谱 iJipu 资源包`
- 组件：
  - `基础音色库（GeneralUser GS，30.8 MB）`
  - `高级音色库（FluidR3 GM，141.5 MB）`
  - `视频工具（FFmpeg，约 80 MB）`
- 版本：资源包**自己一套 SemVer**，与主应用解耦；装完后把版本写进
  `<主应用目录>\assets.manifest.json`，主应用据此提示「资源包版本较旧，是否更新」。

---

## 九、已定与遗留

### 已定（用户 2026-10-21）

| 项 | 决定 |
|---|---|
| 卸载二选一界面 | **接管 NSIS 模板**，做中文单选页（见 §三·2） |
| 资源包形态 | **一个 exe，三个可选组件**（见 §四） |
| 卸载后没有卸载入口 | **可以接受**，由资源包的卸载项兜底（见 §五） |
| 命名 | 与主应用强关联（见 §八） |
| 主包是否带音色库 | **A：不带**。GeneralUser 也移进资源包，主包约 3 MB（见 §四） |

### 遗留（开工前不必定）

1. FFmpeg 的具体构建来源（gyan.dev 的 static build / 自己编），以及 LICENSE 归档方式。
2. 资源包是否跟随主应用发版节奏（建议：独立版本，主应用只做「较旧」提示）。
3. 保留时的目录占用提示（在卸载页写清「约 XXX MB 将被保留」需要先算体积）。
