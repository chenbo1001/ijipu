/**
 * scripts/check-assets-installer.mjs — 资源安装器与主安装钩子的静态闸门
 *
 * 用户口径（2026-10-26）：大资源**每个文件单独一个安装包**；安装包名必须体现
 * 「资源类型 + 资源名称」；命名规则唯一出处是 `scripts/asset-naming.mjs`。
 *
 * 这里钉死：
 *  - 命名：iJipu-<Type>-<ResourceId>_<Version>_<Arch>-setup.exe；只允许 SoundFont / Tool；
 *  - 一个安装器只装一个资源文件（无 Components 多选页）；
 *  - 装进主程序目录下的资源子目录；卸载只删自己那一个文件/manifest；
 *  - 每个资源写自己的卸载键 + 在 ResourceUninstallers 里登记，主卸载器能枚举；
 *  - 主安装钩子仍保留旧的 iJipuAssets 兼容与「完全卸载/保留」二选一。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resourceInstallerName, validateResourceDescriptor } from './asset-naming.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nsiPath = join(root, 'src-tauri', 'nsis', 'assets-installer.nsi')
const hooksPath = join(root, 'src-tauri', 'nsis', 'hooks.nsh')
const buildPath = join(root, 'scripts', 'build-assets-installer.mjs')
const nsi = existsSync(nsiPath) ? readFileSync(nsiPath, 'utf8') : ''
const hooks = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : ''
const build = existsSync(buildPath) ? readFileSync(buildPath, 'utf8') : ''

const sample = { type: 'SoundFont', id: 'GeneralUserGS', name: 'GeneralUser GS', version: '1.471.0', source: 'x', dir: 'soundfonts', file: 'x.sf2' }
const checks = [
  ['资源安装器脚本存在', nsi.length > 0],
  ['只允许 SoundFont / Tool 两种类型', nsi.includes('!if "${TYPE}" == "SoundFont"') && nsi.includes('!else if "${TYPE}" == "Tool"')],
  ['一个安装器只装一个资源文件（无 Components 多选页）', !nsi.includes('MUI_PAGE_COMPONENTS') && nsi.includes('Section "${TYPE_CN}：${RESOURCE_NAME}" SecResource')],
  ['按 TYPE / RESOURCE_ID 生成显示名与卸载键', nsi.includes('!define APP_NAME "爱记谱 iJipu ${TYPE_CN} · ${RESOURCE_NAME}"') && nsi.includes('!define APP_KEY "iJipuAsset-${RESOURCE_ID}"')],
  ['每个资源一个 manifest（assets.<Id>.manifest.json）', nsi.includes('!define MANIFEST "assets.${RESOURCE_ID}.manifest.json"')],
  ['装进主程序目录下的资源子目录', nsi.includes('SetOutPath "$INSTDIR\\${SUBDIR}"') && nsi.includes('File "/oname=${FILENAME}" "${SOURCE}"')],
  ['靠 HKCU Software\\iJipu InstallDir 找主程序', nsi.includes('ReadRegStr $0 HKCU "${MAIN_REG_KEY}" "InstallDir"')],
  ['校验主程序 ijipu.exe 才允许安装', nsi.includes('IfFileExists "$INSTDIR\\${MAIN_EXE}"') && nsi.includes('Function .onVerifyInstDir')],
  ['卸载只删自己那一个文件/manifest', nsi.includes('Delete "$INSTDIR\\${SUBDIR}\\${FILENAME}"') && nsi.includes('Delete "$INSTDIR\\${MANIFEST}"') && !nsi.includes('RMDir /r "$INSTDIR\\${SUBDIR}"')],
  ['资源卸载器在 ResourceUninstallers 里登记/注销', nsi.includes('!define RES_KEY "Software\\iJipu\\ResourceUninstallers"') && nsi.includes('WriteRegStr HKCU "${RES_KEY}" "${RESOURCE_ID}"') && nsi.includes('DeleteRegValue HKCU "${RES_KEY}" "${RESOURCE_ID}"')],
  ['版本用资源自身版本（不是应用版本）', nsi.includes('!define RESOURCE_VERSION') && nsi.includes('"resourceVersion": "${RESOURCE_VERSION}"') && !nsi.includes('/DVERSION=') && !build.includes('appVersion')],
  ['构建脚本按规则生成文件名（不再有 iJipu-Assets_ 固定名）', build.includes("from './asset-naming.mjs'") && build.includes('resourceInstallerName(r.type, r.id, r.version)') && !build.includes('iJipu-Assets_')],
  ['命名函数示例：SoundFont-GeneralUserGS', resourceInstallerName('SoundFont', 'GeneralUserGS', '1.471.0') === 'iJipu-SoundFont-GeneralUserGS_1.471.0_x64-setup.exe'],
  ['命名函数示例：Tool-FFmpeg', resourceInstallerName('Tool', 'FFmpeg', '1.0.0') === 'iJipu-Tool-FFmpeg_1.0.0_x64-setup.exe'],
  ['资源描述校验：合法示例通过', validateResourceDescriptor(sample).length === 0],
  ['资源描述校验：小写 id / 未知类型 / 缺版本被拒', validateResourceDescriptor({ ...sample, id: 'generaluser' }).length > 0 && validateResourceDescriptor({ ...sample, type: 'Other' }).length > 0 && validateResourceDescriptor({ ...sample, version: '1.0' }).length > 0],
  ['中文界面 SimpChinese', nsi.includes('MUI_LANGUAGE "SimpChinese"')],
  ['主卸载器能枚举各资源卸载器', hooks.includes('Software\\iJipu\\ResourceUninstallers') && hooks.includes('EnumRegValue')],
  ['主钩子仍保留旧 iJipuAssets 兼容', hooks.includes('Uninstall\\iJipuAssets')],
  ['主卸载器「完全卸载」仍二选一 + keep.flag', hooks.includes('MessageBox MB_YESNO') && hooks.includes('ijipu_keep_assets') && hooks.includes('keep.flag')],
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
