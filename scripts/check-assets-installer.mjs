/**
 * scripts/check-assets-installer.mjs — 资源包安装器与主安装钩子的静态闸门
 *
 * 为什么要有：资源包安装器不进 Cargo/tsc/smoke 的编译链（它是 .nsi 脚本），
 * 一旦改坏只有"装的时候"才发现。这里把几条**产品口径**钉死，打包/发布前跑：
 *  - 资源包显示名与主应用强关联；卸载键固定 iJipuAssets；
 *  - 靠 HKCU\Software\iJipu\InstallDir 找主程序，且校验 ijipu.exe；
 *  - 装进 soundfonts\，写 assets.manifest.json；
 *  - 卸载器只删自己的 sf2/manifest，不整目录删（用户自己的库要留住）；
 *  - 主安装钩子：记录 InstallDir、中文 DisplayName、卸载二选一/keep.flag。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nsiPath = join(root, 'src-tauri', 'nsis', 'assets-installer.nsi')
const hooksPath = join(root, 'src-tauri', 'nsis', 'hooks.nsh')
const nsi = existsSync(nsiPath) ? readFileSync(nsiPath, 'utf8') : ''
const hooks = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : ''

const checks = [
  ['资源包脚本存在', nsi.length > 0],
  ['显示名：爱记谱 iJipu 资源包', nsi.includes('"DisplayName" "${APP_NAME}"') && nsi.includes('!define APP_NAME "爱记谱 iJipu 资源包"')],
  ['卸载键固定 iJipuAssets（不跟中文名）', nsi.includes('!define APP_KEY "iJipuAssets"') && nsi.includes('Uninstall\\${APP_KEY}')],
  ['靠 HKCU Software\\iJipu InstallDir 找主程序', nsi.includes('ReadRegStr $0 HKCU "${MAIN_REG_KEY}" "InstallDir"')],
  ['校验主程序 ijipu.exe 才允许安装', nsi.includes('IfFileExists "$INSTDIR\\${MAIN_EXE}"') && nsi.includes('Function .onVerifyInstDir')],
  ['装进 soundfonts\\', nsi.includes('SetOutPath "$INSTDIR\\soundfonts"')],
  ['写 assets.manifest.json', nsi.includes('!define MANIFEST "assets.manifest.json"') && nsi.includes('FileOpen $0 "$INSTDIR\\${MANIFEST}" w')],
  ['卸载只删自己的 sf2/manifest（不 RMDir /r）', nsi.includes('Delete "$INSTDIR\\soundfonts\\generaluser_gs.sf2"') && !nsi.includes('RMDir /r "$INSTDIR\\soundfonts"')],
  ['中文界面 SimpChinese', nsi.includes('MUI_LANGUAGE "SimpChinese"')],
  ['主钩子记录 InstallDir + 中文 DisplayName', hooks.includes('WriteRegStr HKCU "Software\\iJipu" "InstallDir" "$INSTDIR"') && hooks.includes('"DisplayName" "爱记谱 iJipu"')],
  ['主钩子卸载二选一 + keep.flag', hooks.includes('MessageBox MB_YESNO') && hooks.includes('ijipu_keep_assets') && hooks.includes('keep.flag')],
  ['完全卸载调用资源包卸载器', hooks.includes('Uninstall\\iJipuAssets') && hooks.includes('ExecWait')],
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) failed++
}
if (failed > 0) {
  console.error(`\n[check-assets-installer] ${failed} 项失败`)
  process.exit(1)
}
console.log('\n[check-assets-installer] 全部通过 ✅')
