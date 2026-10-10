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
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pad = (n) => String(n).padStart(2, '0')

/** 读 .git/HEAD 得到完整 commit（不 spawn 子进程） */
function readCommitSha() {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref:')) {
      const ref = head.split(' ')[1].trim()
      return readFileSync(join(root, '.git', ref), 'utf8').trim()
    }
    return head
  } catch {
    return null
  }
}

/** 该提交的时间：先读松散对象，读不到再用 git（打包克隆场景）——两条路径给出同一个值 */
function commitTime(sha) {
  if (!sha) return null
  try {
    const objPath = join(root, '.git', 'objects', sha.slice(0, 2), sha.slice(2))
    if (existsSync(objPath)) {
      const raw = inflateSync(readFileSync(objPath)).toString('utf8')
      const m = /^committer .*? (\d+) [+-]\d{4}$/m.exec(raw)
      if (m) return new Date(Number(m[1]) * 1000)
    }
  } catch {
    /* 落到 git 兜底 */
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
