/**
 * scripts/prepare-tauri-soundfont.mjs — 桌面音色库独立附件准备（adj346）
 *
 * 为什么：32MB 的 generaluser_gs.sf2 **不进 Tauri 单文件 exe / NSIS 安装包**（避免体积与"嵌进单文件"），
 * 而是像 WebView2 的 dll 一样作为**独立文件**随发布附带。本脚本在 `npx tauri build` 之后运行，
 * 把 `resources/soundfonts/*.sf2` 复制到下列发布目录（作为独立附件；应用运行时从 exe 旁读它）：
 *   - `src-tauri/target/release/soundfonts/`            → 便携/直运行目录（exe 旁）
 *   - `src-tauri/target/release/bundle/nsis/soundfonts/` → NSIS 安装包旁（与安装包一并分发）
 *
 * 用法：`node scripts/prepare-tauri-soundfont.mjs`
 * 说明：桌面端运行时由 Rust `sf_soundfont_resource_read` 读应用目录下 `soundfonts/<id>.sf2`；
 *        若未放置该独立文件，则回退到远端加载（Web 同源）。
 */
import { readdirSync, copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(__dirname, '../resources/soundfonts')
const RELEASE_DIR = resolve(__dirname, '../src-tauri/target/release')
const TARGETS = [
  join(RELEASE_DIR, 'soundfonts'), // 便携/直运行：exe 旁
  join(RELEASE_DIR, 'bundle', 'nsis', 'soundfonts'), // NSIS 安装包旁
]

if (!existsSync(SRC_DIR)) {
  console.log('未找到 resources/soundfonts，跳过——桌面端将回退到远端加载音源。')
  process.exit(0)
}
if (!existsSync(RELEASE_DIR)) {
  console.log('未找到 src-tauri/target/release（请先执行 npx tauri build）。')
  process.exit(0)
}

let copied = 0
for (const destDir of TARGETS) {
  mkdirSync(destDir, { recursive: true })
  for (const f of readdirSync(SRC_DIR)) {
    copyFileSync(join(SRC_DIR, f), join(destDir, f))
    copied++
  }
  console.log(`✓ 音色库独立附件 → ${destDir}`)
}
console.log(`完成：已复制 ${copied} 个音色文件作为独立附件。`)
process.exit(0)
