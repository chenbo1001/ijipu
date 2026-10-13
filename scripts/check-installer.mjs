/**
 * scripts/check-installer.mjs — 打包自检：安装包是否随包带上运行期必需的 DLL（E-2026-134）
 *
 * 背景：本项目用 **GNU 工具链**（`x86_64-pc-windows-gnu`，见 docs/ERRORS-LOG.md E-2026-029），
 * 而 `webview2-com-sys` 只在 `target_env = "msvc"` 时**静态链接** `WebView2LoaderStatic.lib`；
 * GNU 下走**动态** `WebView2Loader.dll` → 必须与 `ijipu.exe` 同目录分发。
 * 0.14.0 之前所有安装包都漏了它（生成的 `installer.nsi` 只 `File` 了 exe），装完启动即报
 * 「找不到 WebView2Loader.dll」。
 *
 * 本脚本读 `tauri build` 生成的 `nsis/x64/installer.nsi`，检查「安装到 $INSTDIR 的文件」清单里
 * 是否包含必需文件——避免下次又漏（`bundle.resources` 被清空、换工具链、换打包目标都会重现）。
 *
 * adj416 增补：内置音源 `generaluser_gs.sf2` 必须随安装包落到安装目录（GNU/任意工具链都一样）——
 * 桌面端试听/导出直接读它（Rust `sf_soundfont_builtin_path`），漏了就会退回联网下载（国内直链不可达）。
 *
 * adj894：随包布局改为 **`soundfonts/`**（用户要求"和 LICENSE 放一起"）⇒ 判定里接受
 * `soundfonts\` 前缀；并**新增一条**：音色库的**许可文件**也必须进安装包 ——
 * 那是分发第三方作品的义务（见 `resources/soundfonts/README.md`），值得机器守住而不是靠自觉。
 *
 * 用法：npm run check:installer（建议紧跟 `npx tauri build` 之后跑）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'

/** 必须在安装目录里的文件：[展示名, 在 installer.nsi 中应出现的片段] */
const REQUIRED = [
  ['主程序 ijipu.exe', /!define\s+MAINBINARYSRCPATH\s+"[^"]*ijipu\.exe"/],
  ['WebView2Loader.dll（GNU 工具链下为动态依赖）', /File\s+\/a\s+"\/oname=WebView2Loader\.dll"/],
  // adj894：落点由"安装目录根"改为 `soundfonts/` ⇒ 前缀可选（两种布局都算过）
  [
    '内置音源 generaluser_gs.sf2（桌面离线试听/导出）',
    /File\s+\/a\s+"\/oname=(?:soundfonts[\\/])?generaluser_gs\.sf2"/,
  ],
  // adj894：第三方音色库的许可必须随包分发（与音源同目录）
  [
    '音色库许可 LICENSE-GeneralUserGS.txt（分发第三方作品的义务）',
    /File\s+\/a\s+"\/oname=soundfonts[\\/]LICENSE-GeneralUserGS\.txt"/,
  ],
]

/** 打包源文件：[展示名, 路径, 最小字节数]——源缺失/是占位符时安装包里也就没有真音源 */
const SOURCES = [
  ['resources/soundfonts/generaluser_gs.sf2', 'resources/soundfonts/generaluser_gs.sf2', 20_000_000],
]

/**
 * adj551（用户要求"快捷方式名与备注要记住、下次发布继续保持"）：把这**两条品牌设置**钉成发布前硬校验。
 *
 * 为什么必须钉：桌面/开始菜单快捷方式的**中文名**与**备注**只能由 `nsis/hooks.nsh` 里的
 * `IJIPU_FixShortcuts` 写入（Tauri 模板只会建 `${PRODUCTNAME}.lnk` = `iJipu.lnk`、且**不写备注**）。
 * 这些是**字符串常量**，一旦被改动/漏 include/钩子没被调用，安装包会"看起来正常"但快捷方式退回英文名、
 * 备注丢失——而这类问题只有装到真机才发现（2026-09-21 用户就是这么报的）。
 * 故：① 断言两个常量**逐字**正确；② 断言模板确实 include 了钩子文件；
 *     ③ 断言钩子确实挂在 POSTINSTALL 与 `.onGUIEnd` 两个时机上（GUI 安装的桌面快捷方式是完成页才建的）；
 *     ④ 交叉校验钩子里的 exe 名 / AUMI 与本次构建生成的值一致（防 E-2026-240 那类"名字对不上"）。
 */
const HOOKS = 'src-tauri/nsis/hooks.nsh'
const LNK_NAME = 'i记谱 iJipu.lnk'
const LNK_DESC = '爱记谱 - 码即成，谱自现，代码式简谱制谱引擎。'

const NSI = 'src-tauri/target/release/nsis/x64/installer.nsi'
const SETUP_DIR = 'src-tauri/target/release/bundle/nsis'

if (!existsSync(NSI)) {
  console.error(`[check-installer] 未找到 ${NSI}——请先运行 npx tauri build`)
  process.exit(1)
}
const nsi = readFileSync(NSI, 'utf8')
const hooks = existsSync(HOOKS) ? readFileSync(HOOKS, 'utf8') : ''

let failed = 0
console.log('[check-installer] 安装包必需文件自检：')
for (const [label, re] of REQUIRED) {
  const ok = re.test(nsi)
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}

console.log('[check-installer] 快捷方式（中文名 + 备注）自检：')
{
  const bundleId = (nsi.match(/!define BUNDLEID "([^"]+)"/) ?? [])[1] ?? ''
  const mainExe = (nsi.match(/!define MAINBINARYNAME "([^"]+)"/) ?? [])[1] ?? ''
  const checks = [
    ['钩子文件存在且含快捷方式函数', hooks.includes('Function IJIPU_FixShortcuts')],
    [`快捷方式名逐字正确（${LNK_NAME}）`, hooks.includes(`!define IJIPU_LNK_NEW "${LNK_NAME}"`)],
    [`快捷方式备注逐字正确（${LNK_DESC}）`, hooks.includes(`!define IJIPU_LNK_DESC "${LNK_DESC}"`)],
    ['模板已 include 该钩子文件', /!include\s+"[^"]*nsis[\\/]hooks\.nsh"/.test(nsi)],
    ['钩子挂在 NSIS_HOOK_POSTINSTALL', (hooks.match(/macro NSIS_HOOK_POSTINSTALL/g) ?? []).length === 1 && nsi.includes('!insertmacro NSIS_HOOK_POSTINSTALL')],
    ['钩子挂在 .onGUIEnd（GUI 安装的桌面快捷方式是完成页才建的）', hooks.includes('Function .onGUIEnd') && hooks.includes('Call IJIPU_FixShortcuts')],
    ['钩子里的主程序名与本构建一致', hooks.includes(`!define IJIPU_EXE "${mainExe}.exe"`)],
    ['钩子里的 AUMI 与本构建 identifier 一致', hooks.includes(`!define IJIPU_AUMI "${bundleId}"`)],
  ]
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (!ok) failed++
  }
  if (hooks) console.log(`  · 名称 ${LNK_NAME} / 备注 ${LNK_DESC}`)
}

console.log('[check-installer] 打包源文件自检：')
for (const [label, path, minBytes] of SOURCES) {
  const ok = existsSync(path) && statSync(path).size >= minBytes
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? `  ${Math.round(statSync(path).size / 1024)}KB` : '（缺失或体积不足）'}`)
  if (!ok) failed++
}

/**
 * adj942（用户裁定「直接落，修」·路线②）：**`ijipu.exe` 内置了 CLI** ——
 * 这就是"用户不必装 Node 也能用命令行"的交付物本身，所以值得机器守住。
 *
 * 怎么核对（**不需要跑 exe** ✓）：`include_bytes!` 是把产物**逐字节**放进 exe 的 ⇒
 * 在 exe 里一定找得到产物里的标志串。三条一起看才可信：
 *   ① 内嵌产物存在且**像真产物**（体积下限 —— `build.rs` 的占位只有几百字节 ✗ 会被拦下）；
 *   ② exe 里找得到 `__ijipuCliMain`（内嵌入口）与 `__ijipuHost`（宿主接口）；
 *   ③ exe 的 mtime **不早于**产物 ⇒ 打包前**重生成过**产物
 *      （防"先打包、后重生成产物"，与 `E-2026-374` 同族：产物会冻在生成那一刻）。
 * 另配两条负对照：同一个搜索找"一定不存在的标志"必须为假、Node 版产物里不该有这个标志
 * （证明它真在区分"两种产物/有没有内嵌"，而不是恒真 ✗）。
 */
const EMBED_JS = 'packages/ijipu-cli/dist/ijipu-embed.js'
const RELEASE_EXE = 'src-tauri/target/release/ijipu.exe'
const NODE_BUNDLE = 'packages/ijipu-cli/dist/ijipu.cjs'
const EMBED_MIN_BYTES = 50 * 1024

console.log('[check-installer] 内嵌 CLI（adj942：命令行编进 exe）自检：')
{
  const contains = (path, needle) => {
    if (!existsSync(path)) return false
    return readFileSync(path).includes(Buffer.from(needle, 'utf8'))
  }
  const embedSize = existsSync(EMBED_JS) ? statSync(EMBED_JS).size : 0
  const exeSize = existsSync(RELEASE_EXE) ? statSync(RELEASE_EXE).size : 0
  const fresh = embedSize > 0 && exeSize > 0 && statSync(RELEASE_EXE).mtimeMs >= statSync(EMBED_JS).mtimeMs
  const checks = [
    [`内嵌 CLI 产物存在且不是占位（${EMBED_JS} ≥ ${Math.round(EMBED_MIN_BYTES / 1024)}KB）`, embedSize >= EMBED_MIN_BYTES],
    [`exe 里带着内嵌 CLI 入口（找得到 __ijipuCliMain）`, contains(RELEASE_EXE, '__ijipuCliMain')],
    [`exe 里带着宿主接口（找得到 __ijipuHost）`, contains(RELEASE_EXE, '__ijipuHost')],
    [`exe 不比内嵌产物旧（打包前重生成过产物）`, fresh],
    ['负对照①：同一个搜索找"一定不存在"的标志必须为假', !contains(RELEASE_EXE, '__ijipuCliMain_NEVER_EXISTS__')],
  ]
  /**
   * ⚠ 负对照②依赖 **Node 版产物**（`dist/ijipu.cjs`），而它**只有 `npm run cli:build` 才产出**——
   * `tauri build` 只跑 `cli:embed`（内嵌版）⇒ **干净克隆直接打包时它并不存在**（实测踩到：
   * 这条把"全部通过"判成了 ✗）。所以：**有才做这条**，没有就如实说明"跳过"（不当成通过 ✓ 也不误判 ✗）。
   */
  if (existsSync(NODE_BUNDLE)) {
    checks.push([
      '负对照②：Node 版产物（dist/ijipu.cjs）里**不该**有这个标志（两种产物分得开）',
      contains(NODE_BUNDLE, '#!') && !contains(NODE_BUNDLE, '__ijipuCliMain'),
    ])
  } else {
    console.log('  · 负对照②**跳过**：没有 dist/ijipu.cjs（`tauri build` 不产它；跑过 `npm run cli:build`/`smoke` 才有）')
  }
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (!ok) failed++
  }
  console.log(`  · exe ${Math.round(exeSize / 1024)}KB ／ 内嵌产物 ${Math.round(embedSize / 1024)}KB`)
}

if (existsSync(SETUP_DIR)) {
  const files = readdirSync(SETUP_DIR).filter((f) => f.endsWith('.exe'))
  if (files.length === 0) {
    console.log('  ✗ bundle/nsis 下没有安装包产物')
    failed++
  } else {
    for (const f of files) {
      console.log(`  · ${f}  ${Math.round(statSync(`${SETUP_DIR}/${f}`).size / 1024)}KB`)
    }
  }
}

if (failed > 0) {
  console.error(
    `\n[check-installer] ${failed} 项缺失：安装后会缺文件、离线试听不可用。\n` +
      '  修复：确认 src-tauri/tauri.conf.json 的 bundle.resources 含\n' +
      '  { "target/release/WebView2Loader.dll": "WebView2Loader.dll" }（GNU 工具链时必需）\n' +
      '  { "../resources/soundfonts/generaluser_gs.sf2": "soundfonts/generaluser_gs.sf2" }（内置音源，adj894 起落在 soundfonts/）\n' +
      '  { "../resources/soundfonts/LICENSE-GeneralUserGS.txt": "soundfonts/LICENSE-GeneralUserGS.txt" }（许可，必须随包）',
  )
  process.exit(1)
}
console.log('[check-installer] 全部通过 ✓')
