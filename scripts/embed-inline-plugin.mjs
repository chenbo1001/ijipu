/**
 * scripts/embed-inline-plugin.mjs — 把整站打成**单文件 HTML** 的 Vite 插件（嵌入版专用）
 *
 * ## 目标
 *
 * 嵌入版产物要变成一个**自包含 HTML**（塞进 Obsidian 插件的 `main.js`，
 * 由插件内的**内存 HTTP 服务**直出）——所以 JS、CSS、图标、示例谱**都必须内联**，
 * 不能有任何"按相对路径读文件"的引用。
 *
 * ## 为什么自写而不用 `vite-plugin-singlefile`
 *
 * 那个插件不处理 `public/` 目录里的资源（它假设 public 资源仍由 HTTP 服务按路径提供）。
 * 我们需要 **public 里的图标也变成 data URI**（最终没有目录可供服务），自写更短更可控，
 * 也便于构建后打印精确体积。
 *
 * ## 为什么用 `writeBundle` 而不是 `generateBundle`
 *
 * 实测（Vite 8 / rolldown）：`generateBundle` 里**拿不到 `index.html`**（HTML 由 Vite 的
 * html 插件在更早阶段处理，不进 rollup 的 bundle 对象）——按 `generateBundle` 写会产出**空目录**。
 * `writeBundle` 阶段所有文件已落盘 ⇒ 直接"读 HTML → 内联 → 写回 → 删掉中间文件"，最稳。
 *
 * ## 它做四件事
 *
 * 1. `transformIndexHtml`：把 `public/` 的绝对路径（`/icons/x.png`）换成 data URI，
 *    并去掉 PWA 专用标签（manifest / apple-touch-icon）；
 * 2. `writeBundle`：把入口 chunk 与其余 chunk 按 ESM 依赖图**拓扑排序**拼成单个脚本
 *    （顺序必须"被依赖者在前"，否则引用未定义）；
 * 3. 把 CSS 内联成 `<style>`、入口脚本内联成 `<script>`，其余 `/assets/xxx` 引用换 data URI；
 * 4. 删掉中间产物，最终**只留一个 `index.html`**。
 *
 * ⚠ 只用于 `vite.config.embed.mjs`；网页版（PWA）构建完全不受影响。
 */
import { readFile, writeFile, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/** 扩展名 → MIME（只列 public/ 里实际会出现的） */
const MIME = {
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.jps': 'text/plain;charset=utf-8',
  '.txt': 'text/plain;charset=utf-8',
  '.json': 'application/json',
}

const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream'
const toDataUri = (buf, p) => `data:${mimeOf(p)};base64,${buf.toString('base64')}`

/** 递归列文件（相对 outDir 的 POSIX 路径） */
async function listFiles(dir, base = dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(abs, base)))
    else out.push(path.relative(base, abs).split(path.sep).join('/'))
  }
  return out
}

/**
 * @param {{ publicDir: string }} opts `publicDir` 为**绝对路径**
 *   （嵌入版指向 `dist-embed/public`，即 `scripts/embed-assets.mjs` 精简后的资产目录）
 */
export function embedInlinePlugin(opts) {
  const publicDir = path.resolve(opts.publicDir)
  /** @type {string} */ let outDir = ''

  return {
    name: 'ijipu-embed-inline',
    enforce: 'post',

    config() {
      return {
        publicDir: false, // 关掉自动拷贝：public 资源由本插件内联
        build: {
          cssCodeSplit: false,
          assetsInlineLimit: 100 * 1024 * 1024, // 一切资产都内联
          modulePreload: { polyfill: false },
          target: 'es2020',
        },
      }
    },

    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir)
    },

    async transformIndexHtml(html) {
      let out = html
      // public/ 绝对路径 → data URI
      const refs = [...out.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
      for (const ref of new Set(refs)) {
        const rel = ref.replace(/^\//, '').split('?')[0]
        try {
          const buf = await readFile(path.join(publicDir, rel))
          out = out.split(`"${ref}"`).join(`"${toDataUri(buf, rel)}"`)
        } catch {
          /* 不是 public 资源（如 /src/main.tsx）——留给 Vite */
        }
      }
      // PWA / 浏览器外壳专用标签：嵌入版（iframe 里，无标签页）没有意义。
      // 特别是 favicon：`Jianpu.ico`/`pwa-*.png` **按体积决定不打包进插件**
      // （见 `scripts/embed-assets.mjs`），若保留 `<link rel="icon">`，浏览器会去请求
      // 一个不存在的文件 ⇒ 控制台报 `unsupported MIME type ('text/html')`（实测）。
      out = out.replace(/<link[^>]+rel="(icon|shortcut icon|apple-touch-icon|manifest)"[^>]*>\s*/g, '')
      return out
    },

    async writeBundle() {
      if (process.env.IJIPU_EMBED_DEBUG) {
        const { appendFile } = await import('node:fs/promises')
        const os = await import('node:os')
        await appendFile(path.join(os.tmpdir(), 'ijipu-embed-debug.log'), `writeBundle @${Date.now()} outDir=${outDir}\n`)
      }
      const files = await listFiles(outDir)
      if (process.env.IJIPU_EMBED_DEBUG) {
        console.log(`[debug] writeBundle files=${files.length}: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ' …' : ''}`)
      }
      const assets = files.filter((f) => f.startsWith('assets/'))
      const cssFiles = assets.filter((f) => f.endsWith('.css'))
      const jsFiles = assets.filter((f) => f.endsWith('.js'))

      /** 读一个产物文件（不存在返回 null） */
      const readIf = async (rel) => {
        try {
          return await readFile(path.join(outDir, rel))
        } catch {
          return null
        }
      }

      // ---- 1. JS：按 ESM 依赖图拓扑排序后拼成单个脚本 ----
      const jsSrc = new Map()
      for (const f of jsFiles) jsSrc.set(f, (await readIf(f)).toString('utf8'))
      /** chunk 之间的依赖：源码里的 `from"./xxx.js"` / `import("./xxx.js")` */
      const depsOf = (rel) => {
        const code = jsSrc.get(rel) ?? ''
        const names = new Set()
        for (const m of code.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) {
          const dep = `assets/${m[1]}`
          if (jsSrc.has(dep)) names.add(dep)
        }
        return [...names]
      }
      const ordered = []
      const seen = new Set()
      const visit = (rel) => {
        if (seen.has(rel)) return
        seen.add(rel)
        for (const d of depsOf(rel)) visit(d)
        ordered.push(rel)
      }
      for (const rel of jsFiles) visit(rel)

      const script = ordered
        .map((rel) => {
          const raw = jsSrc.get(rel) ?? ''
          const after = raw
            // 依赖者已在前 ⇒ 去掉 import 语句
            .replace(/^\s*import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, '')
            .replace(/^\s*import\s+[\w$*{][^\n]*from\s*["'][^"']+["'];?\s*$/gm, '')
            .replace(/^\s*import\s*["'][^"']+["'];?\s*$/gm, '')
            .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
            .replace(/^\s*export\s+default\s+/gm, 'var __ijipuUnused = ')
            .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ')
            .replace(/\bimport\.meta\.url\b/g, 'document.baseURI')
            .replace(/\bimport\.meta\.env\b/g, '{}')
          if (process.env.IJIPU_EMBED_DEBUG) {
            console.log(`[debug] chunk ${rel}: raw=${raw.length} → after=${after.length}`)
          }
          return after
        })
        .join('\n;\n')

      // ---- 2. CSS：全部内联 ----
      let styles = ''
      for (const f of cssFiles) styles += `<style>${(await readIf(f)).toString('utf8')}</style>\n`

      // ---- 3. HTML：摘掉外链、按 /assets/xxx 内联其余资产、插入 style/script ----
      /**
       * adj876（官网分层）：应用外壳搬到了 `app/index.html`（根 `index.html` 现在是介绍首页）。
       * Vite 会保留入口相对 root 的目录 ⇒ 这里的源路径是 `app/index.html`。
       * 最终的单文件产物**仍然写在 outDir 根**（下面的 `writeFile`），所以
       * `embed-emit.mjs` / `embed-smoke.mjs` 读 `dist-embed-app/index.html` 的路径不用改。
       */
      const shell = await readIf('app/index.html')
      if (!shell) {
        throw new Error(
          '[embed-inline] 产物里找不到 app/index.html —— 请核对 vite.config.embed.mjs 的 rollupOptions.input',
        )
      }
      let html = shell.toString('utf8')

      html = html.replace(/<script[^>]*\bsrc="[^"]*"[^>]*><\/script>/g, '')
      html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/g, '')
      // 其余仍按 `/assets/xxx` 引用的资产（图片/字体/worklet 等）→ data URI
      const assetRefs = [...html.matchAll(/(["'(])\/assets\/([^"'()]+)\1/g)].map((m) => m[2])
      for (const name of new Set(assetRefs)) {
        const buf = await readIf(`assets/${name}`)
        if (!buf) continue
        const uri = toDataUri(buf, name)
        // ⚠ 替换串**必须用函数**：`String.replace` 会把替换串里的 `$&`/`$'`/`` $` ``/`$$`
        // 当特殊模式展开，而压缩后的 JS/CSS 里天然含这些序列 ⇒ 会把整段后续内容反复插入
        // （本轮实测：76 KB 的 HTML 插一次脚本后暴涨成 4.5 MB）。
        html = html.split(`/assets/${name}`).join(uri)
      }
      /**
       * 一律用**函数形式**的替换（返回值不做 `$` 展开）。
       * `styles`/`script` 都是压缩过的产物，含 `$'` 之类的序列，用字符串替换会灾难性膨胀
       * （本轮实测：76 KB 的 HTML 插一次脚本后暴涨成 4.5 MB）。
       */
      html = html.replace('</head>', () => `${styles}</head>`)
      /**
       * 脚本声明为 **`type="module"`**：这样 `import.meta`（产物里有 `import.meta.resolve`）
       * 与 ESM 语义都由浏览器原生处理，**不需要**用正则去手改 import/export——
       * 实测按 `type="text/javascript"` 内联会抛
       * `SyntaxError: Cannot use 'import.meta' outside a module`，应用直接白屏。
       */
      html = html.replace('</body>', () => `<script type="module">${script}</script>\n</body>`)
      await writeFile(path.join(outDir, 'index.html'), html, 'utf8')

      // ---- 4. 清掉中间产物，只留 index.html ----
      if (process.env.IJIPU_EMBED_KEEP) {
        console.log(`[debug] 保留 assets/ 以便核对：${cssFiles.join(', ')}`)
      } else {
        await rm(path.join(outDir, 'assets'), { recursive: true, force: true })
        // adj876：应用外壳原本落在产物根，现在 Vite 把它放在 `app/` 下（保留入口目录层级）。
        // 单文件产物已经写到根 index.html，这个中间目录一并清掉。
        await rm(path.join(outDir, 'app'), { recursive: true, force: true })
      }

      const size = (await stat(path.join(outDir, 'index.html'))).size
      const kb = (n) => `${(n / 1024).toFixed(1)} KB`
      console.log(
        `[embed-inline] 单文件 index.html = ${kb(size)}（内联 ${jsFiles.length} 个 JS / ${cssFiles.length} 个 CSS；已清掉 assets/）`,
      )
      if (jsFiles.length > 1) {
        console.log(
          `[embed-inline] ⚠ 存在 ${jsFiles.length} 个 JS chunk —— 动态 import() 已被内联为同序脚本，请用 smoke 断言确认运行时无 "Cannot find module"`,
        )
      }
    },
  }
}
