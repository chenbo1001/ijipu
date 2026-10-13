/**
 * scripts/gen-build-info.mjs — 生成构建信息（src/gen/buildInfo.ts）
 * 读取 .git/HEAD 与 refs 文件（**不依赖子进程**，沙箱兼容），输出构建日期与当前 commit 前 8 位。
 * 由 npm run gen:info（build/dev 前置）自动执行。
 *
 * adj772（Obsidian 社区审核的 Build verification）：让"同一提交 ⇒ 同产物"在两处成立：
 *  · 日期按 **UTC** 取值（原来用本地时区，"本地已跨日 / UTC 未跨日"时会不同）；
 *  · 日期取**该提交自身的时间**（先读 `.git` 松散对象；打包克隆读不到时用
 *    `git log -1 --format=%ct` 取同一个值；两条都失败才写"未知日期"）——
 *    **绝不**回退到"构建时刻"，否则 CI 与本地必然不一致（这正是审核那条警告的根因）。
 * 插件侧 `obsidian-ijipu/scripts/gen-build-info.mjs` 是同一套逻辑。
 *
 * adj945：`.git` 的位置改由 `scripts/git-dir.mjs` 解析 —— **普通克隆**（`.git` 是目录）与
 * `git worktree` 的**链接工作树**（`.git` 是文件、对象库在 `commondir` 指的地方）都支持。
 * 为什么必须支持工作树：嵌入版产物是按**用户要求的流程**在"干净 HEAD 工作树"里生成的，
 * 而构建信息会被**冻进插件仓库**；旧写法在工作树里读 `.git/HEAD` 直接抛 ⇒ 会写成
 * `dev` / `未知日期` 并永久留在插件里（`E-2026-374` 同族）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// adj945：git 目录解析（普通克隆 / 链接工作树两种形态；有 smoke 断言 + 负对照守着）
import { resolveGitDirs } from './git-dir.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pad = (n) => String(n).padStart(2, '0')

/** 本仓库的 git 目录（拿不到 ⇒ null，下面的两处读取都会退回"未知"） */
const git = resolveGitDirs(root)

/** 读 `.git/HEAD` 得到完整 commit（不 spawn 子进程） */
function readCommitSha() {
  if (git === null) return null
  try {
    const head = readFileSync(join(git.gitDir, 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref:')) {
      const ref = head.split(' ')[1].trim()
      return readFileSync(join(git.gitDir, ref), 'utf8').trim()
    }
    return head
  } catch {
    return null
  }
}

/** 该提交的时间：先读松散对象，读不到再用 git（打包克隆场景）——两条路径给出同一个值 */
function commitTime(sha) {
  if (!sha) return null
  if (git !== null) {
    try {
      const objPath = join(git.commonDir, 'objects', sha.slice(0, 2), sha.slice(2))
      if (existsSync(objPath)) {
        const raw = inflateSync(readFileSync(objPath)).toString('utf8')
        const m = /^committer .*? (\d+) [+-]\d{4}$/m.exec(raw)
        if (m) return new Date(Number(m[1]) * 1000)
      }
    } catch {
      /* 落到 git 兜底 */
    }
  }
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', sha], { cwd: root, encoding: 'utf8' }).trim()
    const ts = Number(out)
    if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000)
  } catch {
    /* 两条都失败 ⇒ 不写时间 */
  }
  return null
}

const sha = readCommitSha()
const when = commitTime(sha)
const date = when ? `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())}` : '未知日期'
const commit = sha ? sha.slice(0, 8) : 'dev'

const out = `// 由 scripts/gen-build-info.mjs 自动生成（勿手改）
export const BUILD_DATE = '${date}'
export const GIT_COMMIT = '${commit}'
`
mkdirSync(join(root, 'src', 'gen'), { recursive: true })
writeFileSync(join(root, 'src', 'gen', 'buildInfo.ts'), out)
console.log(`build info: ${date} @${commit}${when ? '（提交日期，可复现）' : '（提交日期不可读，已写未知日期以保证确定性）'}`)
