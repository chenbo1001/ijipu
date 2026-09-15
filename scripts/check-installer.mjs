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
 * 用法：npm run check:installer（建议紧跟 `npx tauri build` 之后跑）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'

/** 必须在安装目录里的文件：[展示名, 在 installer.nsi 中应出现的片段] */
const REQUIRED = [
  ['主程序 ijipu.exe', /!define\s+MAINBINARYSRCPATH\s+"[^"]*ijipu\.exe"/],
  ['WebView2Loader.dll（GNU 工具链下为动态依赖）', /File\s+\/a\s+"\/oname=WebView2Loader\.dll"/],
  ['内置音源 generaluser_gs.sf2（桌面离线试听/导出）', /File\s+\/a\s+"\/oname=generaluser_gs\.sf2"/],
]

/** 打包源文件：[展示名, 路径, 最小字节数]——源缺失/是占位符时安装包里也就没有真音源 */
const SOURCES = [
  ['resources/soundfonts/generaluser_gs.sf2', 'resources/soundfonts/generaluser_gs.sf2', 20_000_000],
]

const NSI = 'src-tauri/target/release/nsis/x64/installer.nsi'
const SETUP_DIR = 'src-tauri/target/release/bundle/nsis'

if (!existsSync(NSI)) {
  console.error(`[check-installer] 未找到 ${NSI}——请先运行 npx tauri build`)
  process.exit(1)
}
const nsi = readFileSync(NSI, 'utf8')

let failed = 0
console.log('[check-installer] 安装包必需文件自检：')
for (const [label, re] of REQUIRED) {
  const ok = re.test(nsi)
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}

console.log('[check-installer] 打包源文件自检：')
for (const [label, path, minBytes] of SOURCES) {
  const ok = existsSync(path) && statSync(path).size >= minBytes
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? `  ${Math.round(statSync(path).size / 1024)}KB` : '（缺失或体积不足）'}`)
  if (!ok) failed++
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
      '  { "../resources/soundfonts/generaluser_gs.sf2": "generaluser_gs.sf2" }（内置音源，adj416）',
  )
  process.exit(1)
}
console.log('[check-installer] 全部通过 ✓')
