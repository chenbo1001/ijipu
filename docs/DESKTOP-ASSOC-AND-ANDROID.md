# PC 文件关联 `.jps` + Android 工作区壳（方案与决策）

> 状态：**需求 1 已实施（0.28.0，待你验机后发版）；需求 2 真机探针已跑完并已实施（adj540）**。
> 追加要求（adj539）也已落地：桌面/开始菜单快捷方式改名「i记谱 iJipu」+ 备注、右键动词「使用 iJipu 打开」、
> 以及**白屏修复**（陈旧 Service Worker，见 §2.8）。
> 名字首字是**拉丁字母 `i`**（不是「爱记谱」）——因为桌面上已有一个同名的 **Chrome PWA** 快捷方式，
> 用「爱记谱 iJipu」会把它覆盖掉，故按用户最终指定的 `i记谱 iJipu` 落地（见 §4 决策 5）。
> **Android 结论：不做壳**（探针全绿，见 §3.1）；已实现纯网页「工作区目录」（含子目录）。
> 四项决策已确认：允许加单实例依赖 ✓ / Ctrl+S 写回原文件 ✓ / Android 先跑探针 ✓ / 一起补 NSIS 钩子 ✓。
> 本文只写**已核实**的结论，推测项明确标注。
> 证据来源：Tauri v2 源码/模板、**本机真实生成的 NSIS 脚本**、本机 `@tauri-apps/cli` 的 `config.schema.json`、Chrome/MDN/caniuse、Microsoft 文档（见 §5）。
> Android 探针脚本：`D:\Coding\JianpuScript\.ui-preview\fsa-probe-android.js`（真机跑一次即可定方案）。

---

## 1. 需求

1. **PC**：安装时把 `.jps` 关联到 iJipu 桌面版（双击即用 iJipu 打开），卸载时注销关联。
2. **Android**：网页版在手机上"打开/保存"体验差；希望有一个 app 壳，能**选一个目录当工作区**来打开/保存 `.jps`；
   且 UI 仍来自 `https://ijipu.pages.dev`（Cloudflare Pages，push 到 `main` 即自动构建），**不发版就能更新**。

---

## 2. 需求 1：PC 关联（可行，但有 4 个"必须补齐"的点）

### 2.1 配置（唯一必需字段是 `ext`）

```jsonc
// src-tauri/tauri.conf.json → bundle 段内追加
"fileAssociations": [
  {
    "ext": ["jps"],
    "name": "iJipu.jps",              // ⚠️ 同时是 Windows 的 ProgID + macOS 的 CFBundleTypeName
    "description": "简谱工程文件",     // Windows「类型」列显示；空则渲染成 "JPS File"
    "role": "Editor",
    "mimeType": "application/x-jps"   // Linux 的 MimeType=；macOS 需配 exportedType 才进 UTI
  }
]
```

- **`name` 不要省**：NSIS 用 `{{or association.name ext}}` 当 ProgID，省了就得到裸 `jps`（易撞名）。
- 配置项开启 `deny_unknown_fields`：**键写错会直接构建失败**（这对我们是安全网，不是风险）。
- 苹果侧若要"正规自定义类型"，还需 `exportedType`（`{identifier, conformsTo}`）+ macOS 的 `CFBundleDocumentTypes/UTExportedTypeDeclarations`（Tauri 会自动生成）；Tauri 不做 `lsregister`。

### 2.2 安装做了什么（本机 `target/release/nsis/x64/` 实据）

- 安装模式默认 `currentUser` ⇒ `SHCTX/SHELL_CONTEXT` = **HKCU**（不需要管理员）：
  `HKCU\Software\Classes\.jps` = `iJipu.jps`，并建
  `HKCU\Software\Classes\iJipu.jps\{DefaultIcon,shell\open\command}`，命令 = `"$INSTDIR\ijipu.exe" "%1"`
  （**可执行文件名是 `ijipu.exe`**，不是 `iJipu.exe`）。
- 安装前会把**原有** `.jps` 默认处理器备份到 `jps_backup` 值 —— 卸载时**还原**（这点比"删掉不管"好）。

### 2.3 ⚠️ 四个必须补齐的点（否则"看着能用、实际不干净"）

| # | 问题（已核实） | 后果 | 补法 |
|---|---|---|---|
| 1 | 模板**不写** `Software\Classes\.jps\OpenWithProgids` | 右键「打开方式」里**看不到 iJipu**，用户得走"选择其他应用" | 自定义 NSIS 钩子写该键 |
| 2 | 模板**不写** `SHChangeNotify`（`UPDATEFILEASSOC` 定义了但从未 `!insertmacro`） | 资源管理器可能仍显示旧图标/旧关联，需重启或重新登录 | 钩子里 `!insertmacro UPDATEFILEASSOC` |
| 3 | 卸载只**还原 + 删 ProgID**，**不删** `Software\Classes\.jps`；备份为空时写入的是**空串** | 卸载后残留 `HKCU\Software\Classes\.jps`（默认值空）+ 永久 `jps_backup` 值 | 钩子 `NSIS_HOOK_POSTUNINSTALL` 删键/删值 |
| 4 | 一次安装（`/UPDATE` 路径）会把自己的 ProgID 读进 `jps_backup` | 之后卸载会还原成一个**指向已删 ProgID 的悬空默认值** | 同上钩子：卸载时按"是否等于我方 ProgID"决定是否清空 |

> 结论修正：**"卸载注销"不是纯配置就干净**。要做到你要求的"卸载时注销"，需要一段约 20 行的 `.nsh`
> 通过 `bundle.windows.nsis.installerHooks` 挂上（键名由 CLI 校验，写错会报错）。
> 这一段我会在实施时**先打包、再检查真实生成的 `installer.nsi`**，确认钩子进了 install/uninstall 两个分支。

### 2.4 双击打开还需要应用侧做 3 件事

| # | 事项 | 说明 |
|---|---|---|
| 1 | 启动时取路径 | Windows 走命令行参数：v2 有 `tauri::Env`（`app.env().args_os`，即 `std::env::args_os()`），**无新依赖**；macOS/iOS/Android 走 `RunEvent::Opened { urls }`（Windows 上无此 variant，需 `#[cfg]`） |
| 2 | 已在运行时再双击 → 交现有窗口 | 官方插件 **`tauri-plugin-single-instance = "2"`**（crates.io 2.4.4，Rust-only、无 npm、无需 ACL）；**必须第一个注册**；回调里要显式 `show/set_focus`（否则最小化时不弹）⇒ **新增依赖，需你同意** |
| 3 | 前端接住 | `emit('ijipu://open-files')` + **冷启动竞态**：`setup()` 里 emit 可能早于前端注册监听 ⇒ 再存一份 `PendingOpen` 状态，前端 mount 时调 `take_pending_open_paths` 握手。<br>`capabilities/default.json` 已有 `core:default`（含 event）⇒ **无需改 capability**；`withGlobalTauri: true` 已开 ⇒ 前端零新依赖 |

配套收益：双击打开后记一个 `nativePath`，Ctrl+S 即可**写回原文件**（比现在"必须另存为"更顺）。

### 2.5 诚实的 UX 现实（Windows 政策，安装器无法绕过）

- **干净机器**（`.jps` 无任何处理器/`UserChoice`）：双击直接回落到我们的 ProgID ⇒ **能直接打开** ✓
- **已有 `.jps` 处理器或用户选择过的机器**：Windows 8+ 的 `UserChoice` 受哈希保护，**安装器不能静默夺走**，会弹"如何打开"选择器，用户勾"始终使用"才行。
  ⚠️ **`.jps` 在现实中不是无人认领的扩展名**（JPEG Stereo 图像、Java Print Service 都在用），所以要预期"部分机器上首次仍要用户确认一次"。
- 卸载后：ProgID 键被删、`.jps` 默认值还原；补了钩子后 `.jps` 键与 `jps_backup` 也清掉，并通知资源管理器刷新。
- Linux（若将来启用 deb/rpm）：Tauri 只写 `MimeType=`，**`.desktop` 的 Exec 没有 `%F`** ⇒ 传不了路径（上游未修，见 tauri#9803 / PR #10358），且需要自备 shared-mime-info 定义。**本次只做 Windows（NSIS）**。

### 2.6 实施状态与验证

**已做（代码/配置/文档均已落地）**

| 项 | 位置 |
|---|---|
| 关联配置（`name`=ProgID）、NSIS 钩子挂载 | `src-tauri/tauri.conf.json` |
| 钩子：安装写 `OpenWithProgids` + 刷新资源管理器；卸载只清我方值名、确空才删键 | `src-tauri/nsis/hooks.nsh`（新增） |
| 钩子：快捷方式改名「i记谱 iJipu」+ 备注、右键动词改「使用 iJipu 打开」、卸载补删改名后的快捷方式 | `src-tauri/nsis/hooks.nsh`（adj539） |
| 启动前物理清掉陈旧 Service Worker 存储（白屏修复，第一道防线） | `src-tauri/src/lib.rs`（`purge_stale_service_worker`） |
| `sw.js` 在桌面壳里自毁（第二道防线，不依赖页面 JS） | `public/sw.js`（`IN_DESKTOP_SHELL`） |
| argv 入队 / 取队列 / 写回（含回读校验）/ 单实例置前 / macOS `RunEvent::Opened` | `src-tauri/src/lib.rs` |
| 单实例依赖 | `src-tauri/Cargo.toml`（`tauri-plugin-single-instance = "2"`） |
| 外部打开桥（惰性、纯网页空转）+ 多文件取舍纯函数 | `src/store/externalOpen.ts`（新增） |
| `nativePath` 与 `fileHandle` 互斥；Ctrl+S 写回原文件 | `src/store/docStore.ts` |
| 冷启动拉取 + 热启动监听 | `src/App.tsx` |
| 文案 | `src/brand/copy.ts`（`externalOpenCopy`） |

**已自动验证**

1. 打包后**逐行核对真实生成的 `installer.nsi`**（唯一可信的"配置生效"证据）：
   L31 `!include …hooks.nsh`、**L649 `APP_ASSOCIATE "jps" "iJipu.jps" "简谱工程文件" … "$INSTDIR\ijipu.exe "%1""`**、
   L708-709 `NSIS_HOOK_POSTINSTALL`（在关联写入之后）、L770 `APP_UNASSOCIATE "jps" "iJipu.jps"`、
   L844-845 `NSIS_HOOK_POSTUNINSTALL`（在关联移除之后）。
   另注意 **L705 / L933**：桌面快捷方式在静默模式由 `Section Install` 建、在 GUI 模式由完成页
   （`MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut`）建 —— 后者在 `POSTINSTALL` **之后**，
   这正是钩子必须再挂一个 `.onGUIEnd` 的原因。
2. makensis 编译真实 `installer.nsi`：**exit 0 且零告警**（adj539 之前有 2 条 `{BUNDLEID}` 未定义告警，
   它会把**字面量 `{BUNDLEID}`** 当成 AUMI 写进快捷方式 ⇒ 任务栏图标分裂，见 E-2026-239）；
   `iJipu_0.28.0_x64-setup.exe` = 31194 KB；`npm run check:installer` → **全部通过**。
3. `cargo check` 通过；`tsc -b` 通过；`npm run lint` 0 error；`npm run smoke` **ALL SMOKE TESTS PASSED**
   （`[120]` 16 条 + `[121]` 11 条：多文件取舍纯函数、无 Tauri 环境安全、配置/钩子/Rust/前端接线、写回回读校验、
   "禁用 `DeleteRegKey /ifempty`"的负向护栏，以及 **hooks.nsh 必须带 UTF-8 BOM**、快捷方式名/备注原文、
   `SW_SHOWNORMAL`、AUMI 与 `identifier` 同源、`.onGUIEnd` 唯一、PREUNINSTALL 受 `$UpdateMode` 保护、
   sw.js 三处自毁、Rust 只删 `Service Worker` 子目录）。
4. **NSIS 探针（真建 .lnk 再读回，不靠"编译通过"自证效果）**：
   `WScript.Shell.CreateShortcut(…).Description` 读回备注原文（中文正确）、中文文件名正确、无备注对照组为空；
   `Shell.Application … ExtendedProperty("System.AppUserModel.ID")` 读回 `com.ijipu.app`、对照组为空。
   顺带撞出两个只有编译/运行期才暴露的坑：显示方式写数字被拒（`unknown show mode "1"`）、
   含中文的脚本无 BOM 直接 `Bad text encoding` 中止（均记入 E-2026-239）。
5. **白屏根因用 CDP 实证**：旧包启动后 `#root` 的 `innerHTML` 长度为 0、控制台 7 条
   `Failed to load module script … MIME type of "text/html"`；而同一份生产构建在无头 Chrome 里（带/不带 `__TAURI__` 桩）
   零错误、正常挂载 ⇒ 前端产物无辜，问题只在壳里的陈旧 SW 缓存（见 §2.8 与 E-2026-238）。

**只有你能验的（会改你机器的注册表，我不代做）——建议按顺序走一遍**

- [ ] 装 `iJipu_0.28.0_x64-setup.exe`（干净机器或先备份注册表）
- [ ] **桌面快捷方式名为「i记谱 iJipu」**（首字是**拉丁字母 i**）；右键它 →「属性」→
      **备注 = `爱记谱 - 码即成，谱自现，代码式简谱制谱引擎。`**（鼠标悬停也应显示这条备注）；开始菜单里同名同备注
- [ ] 桌面原有的 **「爱记谱 iJipu」PWA 快捷方式仍在**（没有被覆盖，目标仍是 `chrome_proxy.exe`）
      —— 这正是新名首字用拉丁 `i` 的原因：避开同名
- [ ] **不勾选**完成页的"创建桌面快捷方式"再装一次 → 桌面不应凭空多出图标（钩子只在旧名 .lnk 存在时才动手）
- [ ] `HKCU\Software\Classes\.jps` 默认值 = `iJipu.jps`；`…\iJipu.jps\shell\open\command` = `"…\ijipu.exe" "%1"`
- [ ] `HKCU\Software\Classes\.jps\OpenWithProgids` 里有 `iJipu.jps`（右键「打开方式」应能看到 iJipu）
- [ ] 右键菜单里的动词是**「使用 iJipu 打开」**（中文，不再是 `Open with iJipu`）
- [ ] 双击一个 `.jps` → 直接用 iJipu 打开（若这台机器此前把 `.jps` 指给过别的程序，会先弹一次系统选择框，
      勾"始终使用"即可——这是 Windows 策略，非缺陷）
- [ ] **应用已运行时再双击另一个 `.jps`** → 不开新窗口，原窗口置前并载入该文件
- [ ] 改点内容按 **Ctrl+S** → 提示"已保存到 xxx.jps"，且磁盘文件确实变了（不再要求"另存为"）
- [ ] 卸载 → 注册表无 `.jps` / `iJipu.jps` / `iJipu.jps_backup` 残留；**桌面与开始菜单都不再留中文名快捷方式**；
      资源管理器图标恢复正常（若该机器上还有别的程序注册过 `.jps`，它们的内容应**原样保留**）

### 2.8 ⚠️ 白屏（已修）：陈旧 Service Worker 的"毒丸缓存" + 页面自救的死锁

**症状**：之前装好的桌面版**打开就是白屏**。CDP 实测：`#root.innerHTML` 长度 **0**（React 没挂载），
控制台 7 条 `Failed to load module script: … responded with a MIME type of "text/html"`。

**根因（三层，缺一层都解释不通）**：
1. 历史版本在桌面壳里注册过 PWA Service Worker（Tauri 在 Windows 用 `http(s)://tauri.localhost`，是**安全上下文**，
   SW 本可注册）；它把旧构建的 `/index.html`、`/assets/*` 存进了
   `%LOCALAPPDATA%\com.ijipu.app\EBWebView\Default\Service Worker\CacheStorage`（实测 17+ 份 index.html，最早 2026-09-13）；
2. SW 上下文里 `fetch('/assets/index-XXXX.js')` **取不到 Tauri 的自定义协议**，`.catch()` 便回退到缓存的
   **旧 `index.html`**；旧 HTML 引用的 `/assets/index_D_ON1muP.js` 在新安装里**已不存在**，Tauri 资源协议对未知路径
   返回 `index.html`（HTTP 200 + `text/html`）⇒ 模块脚本 MIME 校验失败 ⇒ 前端整包加载失败；
3. **死锁**：`src/main.tsx` 里那段"发现自己在壳里就注销 SW"的自救代码（adj443）属于**页面 JS**，
   而页面 JS 恰恰被这个 SW 挡着 ⇒ 自救永远跑不到。
   旁证：同一份生产构建放进无头 Chrome（带/不带 `__TAURI__` 桩）**零错误正常挂载** ⇒ 前端产物无辜。

**修复（两道防线，都不依赖页面 JS）**：
- **Rust 启动前物理清理**：`purge_stale_service_worker()` 删 `<LOCALAPPDATA>\<identifier>\EBWebView\Default\Service Worker`，
  在 `run()` 最开始、webview 起来**之前**调用（identifier 取自 `generate_context!().config()`，不写死）；
  **只删 `Service Worker`**，不碰 `Local Storage`/`IndexedDB`（用户设置、草稿、音色库缓存都在里面）。
- **`sw.js` 自毁保险**：`IN_DESKTOP_SHELL = hostname === 'tauri.localhost'` 时，`install` 直接 `skipWaiting`、
  `activate` 清空所有缓存并 `self.registration.unregister()`、`fetch` 直接 return 不拦截。

详细踩坑与预防见 `docs/ERRORS-LOG.md` **E-2026-238**。

### 2.7 建议版本

- **0.28.0（MINOR）**——已按此把 5 处版本号升到 0.28.0（`version.ts` / `package.json` / `tauri.conf.json` / `package-lock.json` ×2），
  等你说「更新提交」时再补 CHANGELOG 与 ERRORS-LOG 变更记录行、提交、打 tag、发包。

---

## 3. 需求 2：Android（**真机探针已跑，结论：不需要壳**）

### 3.1 真机探针结果（2026-09-19，用户实机）

关键事实：**`showDirectoryPicker()` 在 Chrome for Android 已支持**，而我们**在移动端强制降级**：
`saveSupport.shouldUseFileInputPicker()` 只要 `coarsePointer` 就返回 `true`（adj405 为绕开"PWA 里
`showOpenFilePicker` 点了没反应"）⇒ **手机上一次都没走过 FSA 路径**，所以"手机上打开/保存不好用"
是**降级路径的产物**，不是 Android 的限制。探针就是为验证这点而做（临时页面 `/probe-fsa.html`，已删除）。

| 探针项 | 实测结果 |
|---|---|
| 环境 | Android 10 / **Chrome 151** / `https:` + `isSecureContext = true` |
| ① 能力 | `showDirectoryPicker` / `showOpenFilePicker` / `showSaveFilePicker` 均为 `function` |
| ② 选目录 → 写 | `queryPermission(readwrite) = granted` → `createWritable/write/close` **成功** → **回读一致** → 目录可列举（27 项） |
| ② 句柄持久化 | 目录句柄存入 IndexedDB **成功** |
| ③ 刷新后 | 句柄取回成功；`queryPermission = prompt` →（用户手势内）`requestPermission = granted` → **刷新后仍可写** |

**结论：`②③` 全绿 ⇒ 走纯网页「工作区目录」，不做 Android 壳**（§3.2 的三方案对比随之作废，保留供追溯）。

两个必须写进方案的实测细节：
1. **刷新/重开后首次使用是 `prompt`**，需要在**用户手势内**补一次 `requestPermission` 才变 `granted`
   （第二次同会话内直接 `granted`）⇒ 工作区对话框必须提供「继续访问（需授权）」按钮，
   **不能在挂载时静默申请**（浏览器会拒绝：权限申请要求用户手势）。
2. **目录选择器与文件选择器是两条通道**：本机实测目录选择器可用，而 `showOpenFilePicker` 在 Android 上
   有已知回归（[Chromium 457203705：Android showOpenFilePicker broken since M142](https://issues.chromium.org/issues/457203705)），
   与 adj405 的"点了没反应"吻合 ⇒ **移动端 `打开`/`另存为` 的老降级逻辑保持不动**，工作区是**新增通道**。

⚠️ **仍需真机确认的一点（不要跳过）**：探针是在 **Chrome 浏览器标签页**里跑的，**不是在已安装的 PWA**
（桌面图标启动的独立窗口）里。adj405 的经验正是"同一个地址在浏览器里正常、在已安装 PWA 里点了没反应"。
所以装好新版本后，请**在手机上用桌面图标的那个「爱记谱 iJipu」**打开，点「文件 → 工作区…」→「选择文件夹当工作区」：
- 系统弹出文件夹选择器 ⇒ 一切成立，工作区就是移动端的最终方案；
- **没弹**（界面 5 秒后会提示「系统没有弹出文件夹选择器…请改用 Chrome 浏览器打开本站」）⇒ 结论是
  "纯网页可行，但**已安装的 PWA 里被限制**"，此时对策是引导用户用浏览器打开本站（PWA 仍可编辑/导出），
  真要"桌面图标里也能选目录"才需要回头考虑 §3.2 的壳。

### 3.1.2 文档 ↔ 工作区文件的**绑定与三道校验**（adj544；背景见 ERRORS-LOG E-2026-251）

**不变量：绑定必须是「(哪个工作区, 区内相对路径)」，写盘前必须校验。**

| 概念 | 位置 | 说明 |
|---|---|---|
| 工作区身份 | `WorkspaceRecord.id`（IndexedDB） | 首次选定目录时 `crypto.randomUUID()` 生成；**旧记录读取时自动补发**。FSA 不给磁盘路径，身份只能自己发 |
| 最近工作区 | `fileHandleDb` 键 `workspaceList`（上限 8，最近在前） | 面板可一键切回；也解决"重新选同一文件夹 = 新工作区"的别扭 |
| 文档绑定 | `docStore.binding = { wsId, wsName, segs }` | 与 `fileHandle` / `nativePath` **三者互斥** |
| 绑定持久化 | `localStorage['ijipu.draftSrc']` | 随草稿写/读；损坏回退 null。恢复出来的是**待校验绑定** `pendingBinding` |
| 绑定恢复 | `resolvePendingBinding()` | 启动时、以及面板"授权成功"后各试一次；三个条件全满足才升级成正式绑定 |

**保存（`saveFile`）对工作区文档的三道校验**（任一不过 ⇒ **不写盘**）：

1. **身份**：`ws.id === binding.wsId`？否 ⇒ 用户换了工作区 ⇒ 拒绝并提示「这份谱绑定在工作区「A」的 …，
   当前是「B」——为避免写错文件，本次未保存；请切回 A，或用『操作 → 另存』存到当前工作区」。
2. **存在性**：绑定的文件还在吗（`hasEntry`）？否 ⇒ 提示「原文件已不在（可能被移动/删除）」并转另存
   ——**不静默重建同名文件**。
3. **权限**：由 `writeWorkspaceText` → `ensureWritePermission` 在**用户手势内**申请（工作区授权是目录级）。

**验收（实测口径）**：

- [ ] 在 A 打开 `2.曲谱集/小星星.jps` → 切到工作区 B → 按保存：**B 里既不能多出该文件、也不能被覆盖**，
      并且**弹出解释**（含"A 的哪个文件、当前是 B、怎么办"）
- [ ] 「操作 → 最近的工作区…」能一键切回 A → 再保存**写回 A** 的原文件
- [ ] **刷新页面（=关了再开）**后：日志出现「已恢复工作区绑定」，此时保存仍写回原文件；
      若浏览器把权限重置为待确认，面板会显示「这份谱来自工作区「A」的 …：重新授权后即可写回原文件」
- [ ] 同一工作区内保存**照旧**写回原文件（不能因新校验把正常路径改坏）

### 3.1.1 已实现的方案：工作区目录（adj540，含子目录）

| 层 | 位置 | 说明 |
|---|---|---|
| 句柄持久化 | `store/fileHandleDb.ts`（`saveWorkspace`/`loadWorkspace`） | 同一个 IndexedDB 库，新增键 `workspace`：存**根目录句柄 + 上次所在子目录的相对路径**。存根句柄 + 相对路径（而不是一串子目录句柄）⇒ 路径是纯数据，便于持久化与面包屑显示 |
| 工作区逻辑 | `store/workspace.ts`（新增） | 选目录（`showDirectoryPicker({id:'ijipu-workspace', mode:'readwrite', startIn:'documents'})`）/ 只查权限 / 申请权限 / 列目录（**子目录 + `.jps`**，其它文件过滤）/ 读写（写后**回读校验**）/ **新建文件夹 / 重命名 / 移动 / 删除**（见下"安全约束"）/ 纯函数：`.jps` 判定、条目名校验、目录优先排序、路径规整拼接 |
| 文档绑定 | `store/docStore.ts` | **adj544：`binding = { wsId, wsName, segs }`**（带**工作区身份**，见 §3.1.2），与 `fileHandle` / `nativePath` **三者互斥**，并随草稿持久化（`ijipu.draftSrc`）；`openWorkspaceFile()` / `saveToWorkspace()` / `createWorkspaceDir()` / `renameWorkspaceFile()` / `moveWorkspaceFiles()` / `deleteWorkspaceEntries()`；`doSaveFile()` 里对工作区文档**写回同一文件**（含子目录）且**先过三道校验**，与桌面 `nativePath` 同语义；重命名/移动会同步绑定，删除则**解绑并提示**（内容仍在编辑器里） |
| UI | `ui/dock/WorkspacePanel.tsx`（新增，**底栏 dock 页签「工作区」，排第一**） | **左列表（带复选框）+ 右按钮**。列表：面包屑（**首段=工作区根目录名，做成按钮样式**，点它=切换工作区目录，悬浮提示写明"切换工作区目录（当前：X）"）+ **过滤框**（默认**层级列表**；一过滤就把**整个工作区（含子目录）**符合条件的 `.jps` 收成**平坦列表**，每行显示所在目录，点一条**直接打开**；**支持 `*` `?` 通配符**，不带通配符按子串；旁边有**一键 `*` 按钮**列出全部、再点一次清空）+「上级目录」/目录进入 / `.jps` 打开；右侧只有 **打开** + **一个「操作▾」下拉**（点它**弹出菜单**再选 保存/另存/新建/新建夹/改名/移动/删除）。**列表与过滤都跳过 `.` 开头的条目**（`.git`/`.obsidian`/`.trash` 这类系统目录不算谱，还会吃光搜索配额）。图标用 `public/icons/工作区.png`（`toolIcons.ICON_FILES.workspace`，同时登记进 `public/sw.js` 预热清单——两处必须同步，smoke 有断言） |
| 权限复用 | `saveSupport.ensureWritePermission()` | 参数放宽到**目录句柄**（授权是目录级的，子目录/文件继承）——不另写一套权限逻辑 |
| 平台分流 | `ui/TopBar.tsx` + `saveSupport.isCoarsePointerDevice()` | **手机端（粗指针）以工作区优先**；**窄屏菜单**只留平台无关项：工作区 / 打开示例 / 粘贴源码导入 / 试听播放 / 导出（「打开…/系统选择器/新建/保存/另存为」都收进面板或只在桌面成立）。桌面端保持原样。粗指针判据收敛到 `isCoarsePointerDevice()` 一处 |

**交互模型（"左列表 + 右按钮" + 复选框）**：
- **点文件名/图标 = 打开**（目录则进入）——一步到位，不需要点两次；
- **点前面的复选框 = 选中**（**支持多选**）——右侧「操作」里的 改名/移动/删除 作用在勾选项上；
  未勾选时右侧标签显示「勾选后可操作」，多选时显示「已选 N 项」；
- 改名只对"恰好选中一个文件"开放；选中里含文件夹时「移动」不可用（移动只支持 `.jps`）；
- 批量移动/删除**逐个执行并汇总**：部分失败会如实报「N 项成功、M 项失败（原因）」，不假装全成功。

**授权（重新授权）视图**：刷新/重开后浏览器会把目录权限重置为「待确认」，此时面板显示
**「需要重新授权访问这个文件夹」+ `文件夹名 / 子目录…`** 再给「继续访问（需授权）」按钮。
⚠️ **拿不到完整磁盘路径**：File System Access 出于隐私只暴露**文件夹名**（句柄的 `name`），
`resolve()` 也只能算工作区内的相对路径 ⇒ 界面里如实注明这一点，别让用户以为是显示不全。

**安全约束（破坏性操作，必须遵守）**：
1. **重命名 / 移动 = 读 → 写新位置 → 回读校验一致 → 才删原文件**。
   为什么不用 `FileSystemHandle.move()`：它**只对 OPFS 生效**，用户选中的目录上没有
   （非 OPFS 移动还停在 WICG 提案 [MovingNonOpfsFiles](https://github.com/whatwg/fs/blob/main/proposals/MovingNonOpfsFiles.md)）。
   中途失败宁可**留下重复文件**，也绝不出现"两个都没了"。
2. **删除是永久的**（浏览器文件 API **没有回收站**）⇒ 一律**二次确认**，并如实写明"删了找不回来"。
3. **目录只允许删空的**：`removeEntry(name)` 不带 `recursive`（带 `recursive` 会把用户放在同一文件夹里的
   照片/文档一起抹掉）。非空时给明确提示而不是"删了没反应"。
4. 重名**不静默覆盖**：「另存到此处」遇到已存在的同名文件（且不是本文档当前绑定的那个）会拒绝并提示；
   重命名/新建目录遇同名同样拒绝。
5. 删除/重命名/移动的若是**当前正在编辑的文件**：绑定跟着改（重命名/移动）或**解绑**（删除，并提示内容仍在编辑器里）。

**边界（诚实记录）**：
- **iOS Safari / Firefox 没有 `showDirectoryPicker`** ⇒ 那条通道不可用；菜单项仍在（点了给明确提示
  「当前浏览器不支持选择文件夹…请改用「文件 → 导出」保存」），iPhone 上仍走原来的"文件/导出"路径
  （平台分流也会自动退回系统选择器）。
- **文件夹暂不支持重命名/移动**（要对整个目录递归搬运，里面可能混着非 `.jps` 文件，风险大）；文件操作齐全。
- 桌面 Chrome 同样可用工作区；Tauri 桌面版仍优先走原生路径（`nativePath`）。

**验收清单（真机，建议按顺序）**：
- [ ] 手机上用**桌面图标**（已安装 PWA）打开 → 菜单里**只剩**：工作区 / 打开示例 / 粘贴源码导入 / 试听播放 / 导出（窄屏已隐藏打开·新建·保存·另存为）
- [ ] 底栏页签：**工作区在第一个**、图标是设计图那枚（`工作区.png`）；窄屏下**6 个页签整栏放得下**（图标自动隐藏、不用横滑）
- [ ] 「选择文件夹当工作区」→ 能弹出选择器；选一个含子目录的文件夹
- [ ] 面板是**左列表（每行前有复选框）+ 右按钮**；右侧只有 **打开** 与 **一个「操作▾」**，
      点「操作▾」应**弹出菜单**（在底栏之外弹出、不被裁、不溢出屏幕边缘），里面是 保存/另存/新建/新建夹/改名/移动/删除
- [ ] **底色栏收起/展开**（adj541）：底栏收起时，编辑区**行号栏位置**（不压代码内容）有一个「展开底栏」悬浮按钮
      （`public/icons/底栏展开.png`）；点它展开底栏并保留上次页签；输入条显示时该按钮位于输入条**上方**
- [ ] 底栏页签栏里、**高度档位按钮左边**是「收起底栏」按钮（`public/icons/底栏收起.png`），点它收起底栏并让悬浮按钮回来
- [ ] 行号栏宽度（adj542）：**默认两位数宽**（46px），只有滚动到**超过两位数的行号**时才加宽（不缩回，避免滚动时左右跳动）
- [ ] 面板是**左右两栏**（adj545）：**左栏**=切换工作路径按钮 + 路径面包屑 + 列表；
      **右栏固定宽度**=过滤框 / `*`（所有）/ `✕`（消除过滤，无过滤时置灰）/ 「操作▾」
      （窄屏右栏 116px、宽屏 132px；过滤框占满列宽，列表因此拿到全部纵向空间）
- [ ] **过滤框**输入关键词（如「星星」）→ 立刻变成**平坦列表**：跨子目录列出所有匹配的 `.jps`，
      每行显示它所在目录；**点一条直接打开**（底栏自动收起）；清空过滤即回到层级列表；
      **通配符**：`小星*`（只匹配以"小星"开头）、`*星星*`、`小?星*`、`*曲谱*`（连目录名一起匹配）
- [ ] 过滤框旁的 **`*` 按钮**：点一下列出工作区**全部** `.jps`（含子目录，一次看全），再点一下清空回层级列表
- [ ] 过滤**响应要快**（adj543/adj546）：索引**落盘**（10 分钟内直接秒开；过期或点「操作 → 重新扫描工作区」才重扫）；
      扫描期间显示「正在扫描…已查 N 项 / 找到 M 个 / X.Xs」，**边扫边出结果**；命中超过 300 个时只渲染前 300 并提示
- [ ] 过滤速度参考（5499 份 `.jps` / 117 目录）：落盘索引首屏 **<100ms**、内存再过滤 **~15ms**；
      真机若仍慢，看控制台 `[iJipu] 工作区索引完成：扫描 N 项 / 命中 M 个 / Xms（Y ms 每项）` 里的 **ms/项**
- [ ] 扫描**不进入 `.` 开头的目录**（`.git`/`.obsidian` 里的文件既不出现在结果里，也不计入"已查 N 项"）
- [ ] 面板左上的**切换工作区按钮与底栏「收起底栏」按钮同款**（1px 边框 + 7px 圆角 + 主文字色，28×28）
- [ ] **`.git` / `.obsidian` 这类 `.` 开头的目录不出现在列表里**，过滤（含 `*`）也不会进它们里面找
- [ ] 头部只有面包屑：**工作区根目录名是按钮样式**（有边框），**悬浮提示**为「切换工作区目录（当前：X）」，
      点它 = 换一个工作区目录；「移动到…」模式下点它 = 选工作区根目录作目标
- [ ] **点文件名 = 直接打开**（目录则进入）；**点复选框 = 选中**（不触发打开）——两件事不打架
- [ ] 勾选两个文件 → 右侧显示「已选 2 项」；操作▾ 里 **改名灰掉、移动/删除可用**
- [ ] 操作▾ → **移动** → 进目标子目录 →「移到此处」→ 两个文件都搬过去了
- [ ] 操作▾ → **删除** → 确认文案是「永久删除选中的 2 项？删了就找不回来了」→ 删掉后列表刷新
- [ ] 保存▾ → **保存**（写回当前文件）/ **另存**（改个名字存到当前目录）；新建▾ → **新建**（空谱，建完自动打开）/ **新建夹**
- [ ] 对有内容的目录点删除应被拒绝（提示"还有东西"）；空目录可删
- [ ] **刷新/重开后再进工作区** → 显示「**需要重新授权访问这个文件夹**」+ **目录名** → 点一下即可继续；
      面板**每次打开都重读目录**（用系统工具刚存进去的 `.jps` 应立刻可见）

### 3.2 若确实需要壳：三方案对比（引自调研原文，**结论已作废，仅留档**）

| 方案 | 工作量 | 远端 UI | SAF 选目录 | 离线 | 主要风险 |
|---|---|---|---|---|---|
| **手写 Kotlin Activity + WebView + SAF 桥** ⭐推荐 | 中（无 Rust、无框架链） | ✅ `loadUrl` | ✅ 直接做（`ACTION_OPEN_DOCUMENT_TREE` + `takePersistableUriPermission`） | **可控**（可自带本地错误页） | 桥安全 + WebView 生命周期自己负责 |
| Tauri v2 Android | **高**（Rust + SDK/NDK + 4 个 rustup target + capability ACL） | ✅ `frontendDist` 可填 URL，需 capability `remote.urls` | ✅ 靠 `tauri-plugin-android-fs`（`pick_dir`/`persist_uri_permission`/`read_dir`） | ❌ **无**内置"远端+本地兜底"，也无 Capacitor 的 `errorPath` | 变数最大：单人维护插件（37★、频繁大版本）、**远端 UI 拿本地权限**的信任边界（官方说 capability 不防供应链攻击；Android 上**无法 iframe 隔离**；历史 [CVE-2026-42184](https://advisories.gitlab.com/cargo/tauri/CVE-2026-42184/) 8.8 分，需 ≥2.11.1） |
| Capacitor | 低 | ⚠️ `server.url` 官方标注"**不适用于生产**" | ⚠️ 仅 4★ 社区插件 | 有 `errorPath` | 依赖"官方劝退"的开关 |
| TWA / Bubblewrap | 低 | ✅ | ❌ **做不到**（无直接 web 状态访问，只能 postMessage 绕） | Chrome 自身缓存 | 不满足"选目录当工作区" |

**本仓库硬约束**：`src-tauri/Cargo.toml` **故意去掉 `cdylib`**（MinGW 导出序号超 PE 上限），而 **Android 目标必须要 `cdylib`**
⇒ **壳必须独立成项目**，不要塞进 `ijipu/src-tauri`。

### 3.3 "随网站更新"的真相

- 不需要新造：`src/pwa/swUpdate.ts` + `src/ui/UpdatePrompt.tsx` + `sw.js` 构建指纹（adj379/adj400）已解决"网页版如何发现并切到新版本"。
- 代价必须认：**UI 在远端 ⇒ 离线只剩 SW 缓存兜底；且"谁控制网站谁就拿到壳授出的原生权限"**。
- Tauri 远端 `frontendDist` 场景**没有**内置离线兜底（需自己写 Rust）；Kotlin 壳则可由你自带本地错误页 —— 这也是推荐 Kotlin 壳的理由之一。
- 壳内注意**两层缓存**（App 自身 WebView 缓存 vs SW 缓存）别互相挡住更新。
- Google Play 对"纯 WebView 套壳"有"最低功能性"风险；"壳 + 真实 SAF 工作区集成"通常被视为具备真实功能（实施前会再核政策原文）。

---

## 4. 决策记录（已确认）

1. **PC 关联**：✅ 允许新增 `tauri-plugin-single-instance = "2"` —— 已加，且按要求**第一个注册**。
2. **PC 关联保存行为**：✅ Ctrl+S **写回原文件** —— 已实现（写回 + Rust 侧回读校验；失败如实提示并建议「另存为」，不自动弹对话框）。
3. **Android**：✅ **先跑真机探针** —— 已跑完（2026-09-19，Chrome 151 / Android 10）：**全绿**（§3.1），
   故**不做壳**，改为纯网页「工作区目录」并**已实施**（含子目录，adj540；用户追加要求）。
4. **NSIS 钩子**：✅ **一起补** —— 已实现（`OpenWithProgids` + `SHChangeNotify` + 卸载清理残留）。
5. **快捷方式中文名 + 备注**（用户追加要求）：✅ 桌面/开始菜单都改为「**i记谱 iJipu**」+ 备注
   `爱记谱 - 码即成，谱自现，代码式简谱制谱引擎。`；顺手把右键动词改成中文「使用 iJipu 打开」（adj539）。
   ⚠️ 名字首字是**拉丁字母 `i`**：最初用户要求的是「爱记谱 iJipu」，但查机发现桌面上**已经有一个同名文件**，
   它是 **Chrome 装的网页版(PWA)** 快捷方式（`chrome_proxy.exe` + `--app-id=…`），同名会被安装器**静默覆盖**；
   用户得知后把桌面版定为 `i记谱 iJipu` 以区分（用户答复原文："桌面版叫 i记谱 iJipu"）。
6. **白屏**（用户报告）：✅ 根因 = 桌面壳里历史遗留的 Service Worker 缓存了旧 `index.html`（E-2026-238）；
   已加"Rust 启动前清理 + sw.js 自毁"两道防线。
7. **Android 工作区范围**（用户确认）：✅ 按 **MVP + 子目录**实施 —— 选/切换工作区、列目录（**含子目录**）、
   点开 `.jps`、保存写回、另存到当前目录、权限补授；随后按用户追加要求扩展为
   **打开 / 保存 / 另存 / 新建文件夹 / 重命名 / 移动 / 删除**，并**集成进底栏 dock**（adj540）。
8. **临时探针页**：✅ 已删除（`public/probe-fsa.html`，用户确认"探针可以删除"）。
9. **打开/另存为的入口**（用户确认）：✅ **手机端以工作区优先**（粗指针 ⇒ 直接开工作区面板；未设工作区时
   面板里就是"选文件夹"大按钮）；桌面端保持系统选择器；另留「打开（系统文件选择器）…」独立入口。
   手机端「另存为」= 开面板并把文件名输入框直接展开（少点一步）。
10. **目录列表刷新时机**（用户确认）：✅ **每次打开面板都重读**（不缓存）——手机上刚用系统工具/微信存进去的
    `.jps` 立刻可见。
11. **破坏性操作策略**（本轮默认，已写进文档与断言）：删除**永久**（无回收站）⇒ 二次确认 + 目录只允许删空；
    重命名/移动 = 写新→校验→删旧；重名一律拒绝不覆盖。

### 仍需你做的

- PC：按 §2.6 的清单**装一次、卸一次**（会动注册表，我不代做）。
- Android：装好后按 §3.1.1 的验收清单在**已安装 PWA**里试一次工作区（重点是"选择文件夹"能不能弹出选择器）。
- 发版：说「更新提交」即按流程补 CHANGELOG / ERRORS-LOG 变更记录行 → 提交 → tag → 打包（版本已是 0.28.0）。

---

## 5. 关键证据来源

- Tauri v2 配置：`crates/tauri-utils/src/config.rs`（`FileAssociation` / `BundleTypeRole` / `HandlerRank`）
- NSIS 模板与宏：`crates/tauri-bundler/src/bundle/windows/nsis/{installer.nsi,FileAssociation.nsh}`；**本机实据** `src-tauri/target/release/nsis/x64/FileAssociation.nsh`
- 上游未修问题：[tauri#9803](https://github.com/tauri-apps/tauri/issues/9803)（Windows 关联不完整 / MSI 全不生效）、[tauri#10968](https://github.com/tauri-apps/tauri/issues/10968)（"打开方式"显示描述而非应用名）、[PR#10358](https://github.com/tauri-apps/tauri/pull/10358)（Linux 缺 `%F`）
- 单实例插件：`tauri-apps/plugins-workspace` → `plugins/single-instance`（crates.io 2.4.4）
- Android 远端 UI 安全：[CVE-2026-42184 / GHSA-7gmj-67g7-phm9](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9)
- Android FSA 支持：caniuse `mdn-api_window_showdirectorypicker`（Chrome for Android / Samsung Internet 29+ 支持）、W3C WebDX web-features（Chrome Android 132）
- 我机内已存的运行时证据：`src-tauri/target/release/nsis/x64/installer.nsi`（`!define INSTALLMODE "currentUser"`、关联块位置）
