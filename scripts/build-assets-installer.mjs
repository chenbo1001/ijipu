/**
 * scripts/build-assets-installer.mjs — 按**资源文件**逐个构建独立安装器（2026-10-26 规则）
 *
 * 用户口径：音色库/工具等资源文件较大，**每个资源文件单独一个安装包**；
 * 安装包名必须体现「资源类型 + 资源名称」，方便用户按需下载与区分。
 *
 * 命名规则唯一出处：`scripts/asset-naming.mjs`
 *   iJipu-<Type>-<ResourceId>_<Version>_<Arch>-setup.exe
 *
 * 资源清单：`resources/installers.json`（每项一个文件，`version` 是**资源自身版本**）。
 * **音色库必须带 `license`**（第三方作品的分发义务）；许可文件会一起装进资源目录。
 * 源文件不在仓库里时默认跳过；发布时传 `--strict` 让缺文件直接失败。
 *
 * **应用发版不重新构建资源**：只有资源文件/资源版本变化时，才构建对应资源安装器。
 *
 * 用法：
 *   node scripts/build-assets-installer.mjs
 *   node scripts/build-assets-installer.mjs --only GeneralUserGS
 *   node scripts/build-assets-installer.mjs --strict --outdir src-tauri/target/release/bundle/nsis
 *
 * 工具链：直接复用 Tauri 下载的 NSIS（`%LOCALAPPDATA%\tauri\NSIS`），不额外装 `makensis`。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resourceInstallerName, validateResourceDescriptor } from './asset-naming.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'src-tauri', 'nsis', 'assets-installer.nsi')

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const configPath = resolve(root, arg('config', 'resources/installers.json'))
const outDir = resolve(root, arg('outdir', 'src-tauri/target/release/bundle/nsis'))
const only = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const strict = hasFlag('strict')

if (!existsSync(configPath)) {
  console.error(`[assets-installer] 找不到资源清单：${configPath}`)
  process.exit(1)
}
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (!Array.isArray(config.resources)) {
  console.error('[assets-installer] resources/installers.json 里必须有 resources 数组')
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
  ? makensis.includes(join('NSIS', 'Bin'))
    ? dirname(dirname(makensis))
    : dirname(makensis)
  : process.env.NSISDIR

mkdirSync(outDir, { recursive: true })

let built = 0
let skipped = 0
for (const r of config.resources) {
  if (only.length > 0 && !only.includes(r?.id)) continue
  const errors = validateResourceDescriptor(r)
  if (errors.length > 0) {
    console.error(`[assets-installer] 资源描述非法（${r?.id ?? '?'}）：${errors.join('；')}`)
    process.exit(1)
  }
  const source = resolve(root, r.source)
  if (!existsSync(source)) {
    const msg = `[assets-installer] 跳过 ${r.type}/${r.id}：源文件不存在 ${r.source}`
    if (strict) {
      console.error(msg)
      process.exit(1)
    }
    console.warn(msg)
    skipped++
    continue
  }
  // 许可文件是分发义务：配置了就必须存在；SoundFont 必须配置（见 asset-naming 校验）
  const license = r.license ? resolve(root, r.license) : ''
  if (license && !existsSync(license)) {
    console.error(`[assets-installer] ${r.type}/${r.id} 的许可文件不存在：${r.license}`)
    process.exit(1)
  }
  const outFile = join(outDir, resourceInstallerName(r.type, r.id, r.version))
  const args = [
    '/V2',
    `/DTYPE=${r.type}`,
    `/DRESOURCE_ID=${r.id}`,
    `/DRESOURCE_NAME=${r.name}`,
    `/DSUBDIR=${r.dir}`,
    `/DFILENAME=${r.file}`,
    `/DSOURCE=${source}`,
    `/DRESOURCE_VERSION=${r.version}`,
    `/DOUTFILE=${outFile}`,
  ]
  if (license) args.push(`/DLICENSE_SRC=${license}`, `/DLICENSE_FILENAME=${basename(license)}`)
  console.log(`[assets-installer] ${r.type}/${r.id} -> ${outFile}`)
  const res = spawnSync(makensis, [...args, script], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(nsisDir ? { NSISDIR: nsisDir } : {}) },
  })
  if (res.status !== 0) {
    console.error(`[assets-installer] makensis 退出码 ${res.status}（${r.id}）`)
    process.exit(res.status ?? 1)
  }
  built++
}

if (built === 0 && skipped === 0) {
  console.warn('[assets-installer] 清单里没有匹配的资源；什么都没构建')
} else {
  console.log(`[assets-installer] 完成：构建 ${built} 个，跳过 ${skipped} 个`)
}
