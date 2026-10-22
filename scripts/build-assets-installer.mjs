/**
 * scripts/build-assets-installer.mjs — 构建「爱记谱 iJipu 资源包」安装器
 *
 * 用户口径（2026-10-21 / 2026-10-22）：
 *  - 主安装包不含音色库；资源包单独一个 exe，装进主程序目录的 soundfonts\；
 *  - 资源包只做音色库（ffmpeg 已不需要，见 INSTALLER-ASSETS-PLAN 顶部更新）；
 *  - 文件名 ASCII：`iJipu-Assets_<version>_x64-setup.exe`。
 *
 * 工具链：直接复用 Tauri 下载的 NSIS（`%LOCALAPPDATA%\tauri\NSIS`），不额外装 `makensis`。
 * 用法：
 *   node scripts/build-assets-installer.mjs \
 *     --generaluser resources/soundfonts/generaluser_gs.sf2 \
 *     [--fluidr3 resources/soundfonts/FluidR3_GM.sf2] \
 *     [--version 0.1.0] [--outdir src-tauri/target/release/bundle/nsis]
 *
 * 资源文件默认从 `resources/soundfonts/` 找；不在仓库里（体积大），发布时显式传入。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'src-tauri', 'nsis', 'assets-installer.nsi')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const version = arg('version', '0.1.0')
const outDir = resolve(root, arg('outdir', 'src-tauri/target/release/bundle/nsis'))
const generalUser = resolve(
  root,
  arg('generaluser', existsSync(join(root, 'resources/soundfonts/generaluser_gs.sf2'))
    ? 'resources/soundfonts/generaluser_gs.sf2'
    : 'public/soundfonts/generaluser_gs.sf2'),
)
const fluidR3 = arg('fluidr3', existsSync(join(root, 'resources/soundfonts/FluidR3_GM.sf2'))
  ? 'resources/soundfonts/FluidR3_GM.sf2'
  : '')

if (!existsSync(generalUser)) {
  console.error(`[assets-installer] 缺少基础音色库：${generalUser}`)
  console.error('  请用 --generaluser <generaluser_gs.sf2> 指定（文件不进仓库，发布时传入）。')
  process.exit(1)
}
if (fluidR3 && !existsSync(resolve(root, fluidR3))) {
  console.error(`[assets-installer] 指定的高级音色库不存在：${fluidR3}`)
  process.exit(1)
}

const candidates = [
  process.env.MAKENSIS,
  join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'Bin', 'makensis.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'makensis.exe'),
  'makensis',
].filter(Boolean)
const makensis = candidates.find((p) => p === 'makensis' || existsSync(p))
if (!makensis) {
  console.error('[assets-installer] 找不到 makensis（先跑一次 npx tauri build 让 Tauri 下载 NSIS）')
  process.exit(1)
}
const nsisDir = makensis.includes(join('tauri', 'NSIS'))
  ? (makensis.includes(join('NSIS', 'Bin')) ? dirname(dirname(makensis)) : dirname(makensis))
  : process.env.NSISDIR
const outFile = join(outDir, `iJipu-Assets_${version}_x64-setup.exe`)
mkdirSync(outDir, { recursive: true })

const args = [
  '/V2',
  `/DGENERALUSER=${generalUser}`,
  `/DVERSION=${version}`,
  `/DOUTFILE=${outFile}`,
]
if (fluidR3) args.push(`/DFLUIDR3=${resolve(root, fluidR3)}`)
args.push(script)

console.log(`[assets-installer] ${makensis}`)
console.log(`[assets-installer] -> ${outFile}`)
const r = spawnSync(makensis, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...(nsisDir ? { NSISDIR: nsisDir } : {}) },
})
if (r.status !== 0) {
  console.error(`[assets-installer] makensis 退出码 ${r.status}`)
  process.exit(r.status ?? 1)
}
console.log(`[assets-installer] ✓ ${outFile}`)
