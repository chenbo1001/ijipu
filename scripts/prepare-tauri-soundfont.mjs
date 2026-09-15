/**
 * scripts/prepare-tauri-soundfont.mjs — 桌面端音源文件准备（adj346，adj416 起改为「非安装包目录」）
 *
 * adj416：**安装包已随包内置** `generaluser_gs.sf2`（`bundle.resources` 把
 * `resources/soundfonts/generaluser_gs.sf2` 映射到安装目录根的 `generaluser_gs.sf2`，
 * 见 src-tauri/tauri.conf.json）——装完即 `<安装目录>\generaluser_gs.sf2` 存在，
 * 运行时 Rust `sf_soundfont_builtin_path` / `sf_soundfont_resource_read` 直接读该文件，不再联网下载。
 *
 * 因此本脚本只处理**不会经过安装包**的运行目录（这些目录里没有随包资源）：
 *   - `src-tauri/target/release/`  → 便携/直运行（exe 旁，与安装目录同一布局）
 *   - `src-tauri/target/debug/`    → `npx tauri dev` 调试时也能用内置音源
 * （旧版把它复制到 `bundle/nsis/soundfonts/` 作为「安装包旁的独立附件」——现已随包内置，不再需要。）
 *
 * 用法：`node scripts/prepare-tauri-soundfont.mjs`
 */
import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(__dirname, '../resources/soundfonts')
const TARGETS = [
  resolve(__dirname, '../src-tauri/target/release'), // 便携/直运行：exe 旁（与安装目录同布局）
  resolve(__dirname, '../src-tauri/target/debug'), // tauri dev 调试
]

if (!existsSync(SRC_DIR)) {
  console.log('未找到 resources/soundfonts，跳过——桌面端将回退到远端加载音源。')
  process.exit(0)
}

let copied = 0
let skipped = 0
for (const destDir of TARGETS) {
  if (!existsSync(destDir)) {
    console.log(`· 跳过（目录不存在，请先构建）：${destDir}`)
    skipped++
    continue
  }
  mkdirSync(destDir, { recursive: true })
  for (const f of readdirSync(SRC_DIR)) {
    copyFileSync(join(SRC_DIR, f), join(destDir, f))
    copied++
  }
  console.log(`✓ 音源文件 → ${destDir}`)
}
console.log(`完成：已复制 ${copied} 个音源文件${skipped > 0 ? `（跳过 ${skipped} 个未构建的目录）` : ''}。`)
process.exit(0)
