/**
 * scripts/embed-emit.mjs — 把嵌入版产物**生成**为插件侧的 `src/gen/webappAssets.ts`
 *
 * ## 在链路里的位置
 *
 * ```
 * ijipu 仓库                                    obsidian-ijipu 仓库
 * ─────────────────────────────────────────    ────────────────────────────────────────
 * scripts/embed-assets.mjs   → dist-embed/public（精简图标/示例谱）
 * vite.config.embed.mjs      → dist-embed-app/index.html（单文件：JS/CSS 已内联）
 *                       └──► scripts/embed-emit.mjs ──► src/gen/webappAssets.ts   ← 本脚本
 *                                                      （生成物**提交入库**，CI 才拿得到）
 * ```
 *
 * ## 为什么"生成物要入库"
 *
 * 插件的 CI（`.github/workflows/release.yml`）只 `actions/checkout` 了**插件仓库自己**，
 * 不会去取 `ijipu` 仓库；且插件仓库**没有 React 等前端构建依赖**。
 * 所以网页产物只能以"构建产物"形式提交进插件仓库——
 * 这与既有的 `vendor/engine`、`vendor/icons`、`vendor/format` **完全同构**。
 *
 * ## 两个产物的形态
 *
 * 1. **单文件 HTML → JSON 字符串字面量**（`WEBAPP_HTML`）。
 *    不用 base64：JSON 内联实测省 **430 KB**（1.74 MB → 1.31 MB），
 *    且 `JSON.stringify` 会把反引号/`${`/`</script`/反斜杠**零风险**转义掉。
 * 2. **精简资产（icons/samples）→ base64 表**（`WEBAPP_ASSETS`）。
 *    它们**没法内联**：应用的工具条图标是**运行时用字符串拼路径**请求的
 *    （实测 `/icons/菜单.png` 等 17 个），所以服务必须能按路径提供。
 *
 * 用法：
 *   node scripts/embed-emit.mjs                 # 默认写到 ../obsidian-ijipu/src/gen/webappAssets.ts
 *   node scripts/embed-emit.mjs <输出路径>
 */
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const HTML_SRC = path.join(ROOT, 'dist-embed-app', 'index.html')
const ASSET_DIR = path.join(ROOT, 'dist-embed', 'public')
const DEFAULT_OUT = path.resolve(ROOT, '..', 'obsidian-ijipu', 'src', 'gen', 'webappAssets.ts')

/** 递归列出相对路径（POSIX 分隔） */
async function listFiles(dir, base = dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(abs, base)))
    else out.push(path.relative(base, abs).split(path.sep).join('/'))
  }
  return out
}

/** 相对路径 → MIME（与插件端 server 共用同一张表；只列精简资产里会出现的） */
function mimeOf(rel) {
  const ext = path.extname(rel).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.ico') return 'image/x-icon'
  if (ext === '.jps' || ext === '.txt') return 'text/plain; charset=utf-8'
  if (ext === '.json') return 'application/json'
  return 'application/octet-stream'
}

async function main() {
  const outPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT

  if (!existsSync(HTML_SRC)) {
    console.error(`[embed-emit] 找不到 ${HTML_SRC} —— 先跑 npm run build:embed`)
    process.exit(1)
  }
  if (!existsSync(ASSET_DIR)) {
    console.error(`[embed-emit] 找不到 ${ASSET_DIR} —— 先跑 node scripts/embed-assets.mjs`)
    process.exit(1)
  }

  const html = await readFile(HTML_SRC, 'utf8')
  const htmlBytes = (await readFile(HTML_SRC)).length

  const rels = (await listFiles(ASSET_DIR)).sort()
  const entries = []
  let assetBytes = 0
  for (const rel of rels) {
    const buf = await readFile(path.join(ASSET_DIR, rel))
    assetBytes += buf.length
    entries.push(`  ${JSON.stringify(rel)}: { mime: ${JSON.stringify(mimeOf(rel))}, b64: ${JSON.stringify(buf.toString('base64'))} },`)
  }

  const version = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version
  const generatedAt = new Date().toISOString()

  const out = `/**
 * gen/webappAssets.ts — **自动生成，禁止手改**（与 \`src/gen/buildInfo.ts\` 同待遇）
 *
 * 由 \`ijipu\` 仓库的 \`scripts/embed-emit.mjs\` 生成并**提交入库**：
 * 插件 CI 只 checkout 本仓库，且本仓库没有前端构建依赖（无 React），
 * 所以嵌入版的网页产物必须以"构建产物"形式随源码走——
 * 与 \`vendor/engine\`/\`vendor/icons\` 同一套路。
 *
 * 来源：ijipu v${version}
 * 生成时间：${generatedAt}
 * 单文件 HTML：${(htmlBytes / 1024).toFixed(1)} KB
 * 精简资产：${entries.length} 个 / ${(assetBytes / 1024).toFixed(1)} KB
 *
 * 重新生成：在 \`ijipu\` 仓库执行
 *   npm run build:embed && node scripts/embed-emit.mjs
 */

/** 嵌入版单文件 HTML（JS/CSS 已内联；JSON 字面量形态，零转义风险且比 base64 省约 430 KB） */
export const WEBAPP_HTML =
${JSON.stringify(html)}

/** 运行时按路径请求的资产（应用的工具条图标等是字符串拼路径取的，构建期内联不了） */
export interface WebappAsset {
  /** 响应用的 Content-Type */
  mime: string
  /** 文件内容的 base64 */
  b64: string
}

export const WEBAPP_ASSETS: Record<string, WebappAsset> = {
${entries.join('\n')}
}

/** 生成信息（供设置页/关于对话框显示"嵌入版来自哪一版应用"） */
export const WEBAPP_META = {
  appVersion: ${JSON.stringify(version)},
  generatedAt: ${JSON.stringify(generatedAt)},
  htmlBytes: ${htmlBytes},
  assetCount: ${entries.length},
  assetBytes: ${assetBytes},
} as const
`

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, out, 'utf8')

  const outBytes = (await readFile(outPath)).length
  console.log(`[embed-emit] 已写 ${outPath}`)
  console.log(`[embed-emit] 单文件 HTML ${(htmlBytes / 1024).toFixed(1)} KB（字符 ${html.length}）`)
  console.log(`[embed-emit] 精简资产 ${entries.length} 个 / ${(assetBytes / 1024).toFixed(1)} KB`)
  console.log(`[embed-emit] 生成文件合计 ${(outBytes / 1024 / 1024).toFixed(2)} MB`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
