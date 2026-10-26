/**
 * scripts/release-body.mjs — 生成 GitHub Release 正文（**只含当前版本**的更新内容）
 *
 * 背景：`CHANGELOG.md` 是**累积**文件（每发一版在最上面加一节，保留历史便于查阅）。
 * 手动建 Release 时若直接粘贴整份 CHANGELOG，正文就会带上之前所有版本的内容。
 *
 * 本脚本按版本号从 CHANGELOG 中截取**该版本那一节**
 * （`## [<版本>] — 日期` 到下一个 `## [` 之前），写入 `release-body.md`（已 gitignore），
 * 建 Release 时用它作为正文即可。
 *
 * 用法：
 *   node scripts/release-body.mjs          # 取 package.json 的当前版本（或 npm run release:body）
 *   node scripts/release-body.mjs 0.13.0   # 取指定版本（补历史 Release 正文用）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const version = String(process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version ?? '').trim()
if (!version) {
  console.error('[release-body] package.json 缺少 version，且未在命令行给出版本号')
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
const body = lines
  .slice(start, next < 0 ? lines.length : next)
  .join('\n')
  .trim()
  .replace(/\n---\s*$/, '') // 各节之间用 --- 分隔，正文不需要

/**
 * 固定尾注（2026-10-26）：资源安装包独立发布，**不随应用版本更新**。
 * 每次应用 Release 都挂同一个资源 Release 链接，用户按需下载；不把资源资产混进应用 Release。
 */
const RESOURCES_RELEASE = 'https://github.com/snailhome/ijipu/releases/tag/resources'
const footer = `

---

## 资源包（音色库 / 工具，独立发布）

资源安装包**不随应用版本更新**；只有资源文件本身更新时才升资源版本、重发资源 Release。
需要音色库/工具请到固定资源 Release 按需下载单个安装包：

<${RESOURCES_RELEASE}>
`
writeFileSync(OUT, `${body}${footer}\n`, 'utf8')
console.log(`[release-body] 命中：${lines[start]}`)
console.log(`[release-body] 已写 ${OUT}：${body.split('\n').length} 行（CHANGELOG 共 ${lines.length} 行，只取当版）`)
