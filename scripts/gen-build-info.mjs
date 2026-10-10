/**
 * scripts/gen-build-info.mjs — 生成构建信息（src/gen/buildInfo.ts）
 * 读取 .git/HEAD 与 refs 文件（无子进程 spawn，沙箱兼容），
 * 输出构建日期与当前 commit 前 8 位。
 * 由 npm run gen:info（build/dev 前置）自动执行。
 *
 * adj772（Obsidian 社区审核的 Build verification）：日期改按 **UTC** 取值。
 * 原来用本地时区，若构建发生在"本地已跨日 / UTC 未跨日"的时段，同一提交在两台机器上会得到
 * 不同的 `BUILD_DATE` ⇒ 产物字节不同（嵌入版进插件后同样如此）。UTC 取值让"同 commit ⇒ 同产物"。
 * 插件侧 `obsidian-ijipu/scripts/gen-build-info.mjs` 已同步同一改动。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`

let commit = 'dev'
try {
  const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
  if (head.startsWith('ref:')) {
    const ref = head.split(' ')[1].trim()
    commit = readFileSync(join(root, '.git', ref), 'utf8').trim().slice(0, 8)
  } else {
    commit = head.slice(0, 8)
  }
} catch {
  /* 无 git 环境回退 dev */
}

const out = `// 由 scripts/gen-build-info.mjs 自动生成（勿手改）
export const BUILD_DATE = '${date}'
export const GIT_COMMIT = '${commit}'
`
mkdirSync(join(root, 'src', 'gen'), { recursive: true })
writeFileSync(join(root, 'src', 'gen', 'buildInfo.ts'), out)
console.log(`build info: ${date} @${commit}`)
