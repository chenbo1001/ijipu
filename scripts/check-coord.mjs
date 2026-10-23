/**
 * scripts/check-coord.mjs — 多会话协调闸门（pre-commit 调用）
 *
 * 背景：多个会话可以同时改同一个工作区，但彼此看不见对方的对话。
 * 今天已经出过一次事故：两个会话都用了 `adj1062`，工作区里混着两边的改动。
 *
 * 做法见 `.coord/BOARD.md`：每个会话开工前在任务板认领路径；提交时若暂存的文件
 * 落在**别的会话**的认领里，就拒绝提交（避免把别人没写完的东西带进自己的 commit）。
 *
 * 身份来自环境变量 `IJIPU_SESSION`（如 `S2`）。没设就只警告不拦——
 * 目的是"让知道约定的人被保护"，而不是"让不知道的人被卡死"。
 *
 * 绕过：`git commit --no-verify`。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const repoRoot = process.cwd()
const repoName = basename(repoRoot)
// 任务板在工作区根（仓库的上一级），可用环境变量覆盖
const boardPath = process.env.COORD_BOARD
  ? resolve(process.env.COORD_BOARD)
  : join(dirname(repoRoot), '.coord', 'BOARD.md')

if (!existsSync(boardPath)) process.exit(0)

const ACTIVE = new Set(['进行中', '暂停'])

/** `- [S1] ijipu/src/xx | adj1062 | 任务 | 2026-10-23 13:00 | 进行中` */
function parseClaims(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^-\s*\[([^\]]+)\]\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*$/.exec(line.trim())
    if (!m) continue
    const [, session, path, adj, task, time, status] = m
    if (session === '示例') continue
    if (!ACTIVE.has(status)) continue
    out.push({ session, path: path.replace(/^\.\//, ''), adj, task, time, status })
  }
  return out
}

const claims = parseClaims(readFileSync(boardPath, 'utf8'))
if (claims.length === 0) process.exit(0)

let staged = []
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
} catch {
  process.exit(0)
}
if (staged.length === 0) process.exit(0)

const me = (process.env.IJIPU_SESSION || '').trim()

/** 认领路径 → 仓库内相对路径（允许写 `ijipu/...` 或 `src/...`） */
function toRepoPath(p) {
  const s = p.trim().replace(/^\.\//, '')
  if (s.startsWith(repoName + '/')) return s.slice(repoName.length + 1)
  return s
}

const conflicts = []
for (const c of claims) {
  if (me && c.session === me) continue
  const rel = toRepoPath(c.path)
  const prefix = rel.endsWith('/') ? rel : rel + '/'
  const hit = staged.filter((f) => f === rel || f.startsWith(prefix))
  if (hit.length > 0) conflicts.push({ claim: c, files: hit })
}

if (conflicts.length === 0) process.exit(0)

const lines = conflicts.map(
  (c) => `  · [${c.claim.session}] ${c.claim.path}（${c.claim.adj}） ← ${c.files.join(', ')}`,
)
console.warn('')
console.warn('⚠ 协调板：以下文件正被别的会话认领（.coord/BOARD.md）')
console.warn(lines.join('\n'))
console.warn(`  本次会话标识 IJIPU_SESSION=${me || '(未设置)'}`)
console.warn('')

if (!me) {
  // 没设标识 ⇒ 只提醒，不拦（不认识的约定不该把人卡死）
  console.warn('  未设置 IJIPU_SESSION，仅提示不拦截。设置后再提交会被拦。')
  process.exit(0)
}

console.error('❌ 提交被拒绝：暂存区里有别的会话认领的文件。')
console.error('   要么换范围，要么等对方释放认领；确需提交可加 --no-verify。')
process.exit(1)
