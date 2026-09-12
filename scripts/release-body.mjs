/**
 * scripts/release-body.mjs — 生成 GitHub Release 正文（**只含当前版本**的更新内容）
 *
 * 背景：`CHANGELOG.md` 是**累积**文件（每发一版在最上面加一节，保留历史便于查阅）。
 * 手动建 Release 时若直接粘贴整份 CHANGELOG，正文就会带上之前所有版本的内容。
 *
 * 本脚本按 `package.json` 的 version 从 CHANGELOG 中截取**该版本那一节**
 * （`## [<版本>] — 日期` 到下一个 `## [` 之前），写入 `release-body.md`（已 gitignore），
 * 建 Release 时用它作为正文即可。
 *
 * 用法：node scripts/release-body.mjs   （或 npm run release:body）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const version = String(JSON.parse(readFileSync('package.json', 'utf8')).version ?? '').trim()
if (!version) {
  console.error('[release-body] package.json 缺少 version')
  process.exit(1)
}

const SRC = 'CHANGELOG.md'
const OUT = 'release-body.md'
const lines = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').split('\n')
const isVersionHeading = (l) => /^##\s+\[/.test(l)

const start = lines.findIndex((l) => isVersionHeading(l) && l.includes(version))
if (start < 0) {
  console.error(`[release-body] 未在 ${SRC} 找到版本 ${version} 的小节（应形如 "## [${version}] — YYYY-MM-DD"）`)
  process.exit(1)
}
const next = lines.findIndex((l, i) => i > start && isVersionHeading(l))
const body = lines.slice(start, next < 0 ? lines.length : next).join('\n').trim()

writeFileSync(OUT, `${body}\n`, 'utf8')
console.log(`[release-body] 命中：${lines[start]}`)
console.log(`[release-body] 已写 ${OUT}：${body.split('\n').length} 行（CHANGELOG 共 ${lines.length} 行，只取当版）`)
