/**
 * scripts/embed-smoke.mjs — **嵌入版单文件**的真机冒烟（零新依赖）
 *
 * ## 为什么需要它
 *
 * 单文件产物（`dist-embed-app/index.html`：JS/CSS/图标全部内联）是本项目里**唯一**一份
 * "把 28 个模块拼成一段脚本"的产物——拼接顺序、`import()` 内联、`import.meta` 替换
 * 任何一处出错都会在**运行时**炸（而构建照样成功）。所以必须有一步"真的跑起来"的验证。
 *
 * 做法：起一个只读的本地 HTTP 服务托管该文件 → 用系统 Chrome 的**无头 + CDP**打开它 →
 * 收集 console 报错 / 未捕获异常 → 断言应用挂载成功（顶层 DOM 出现预期节点）。
 *
 * 用法：`node scripts/embed-smoke.mjs`
 */
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const HTML = path.join(ROOT, 'dist-embed-app', 'index.html')

/** Chrome 候选路径（Windows 常见位置） */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/** 应用挂载成功时应出现的 DOM 特征（顶栏 + 代码编辑器都是首屏必备） */
const EXPECT_SELECTORS = ['.app-shell, #root > *', 'textarea']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * **已知噪音**（与产品无关，不计入失败）：
 * 浏览器对 `/favicon.ico` 的自发请求。服务按"未知路径 ⇒ 204"处理后，
 * Chrome 会记一条 `The script does not have a MIME type.`（它把空响应也当脚本看）。
 * 嵌入版在 Obsidian 的 iframe 里不显示标签页图标，故不提供 favicon。
 */
const IGNORABLE = ['The script does not have a MIME type']
const isNoise = (s) => IGNORABLE.some((k) => s.includes(k))

/** 极简 CDP over WebSocket（Node 22 内置 WebSocket） */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const events = []
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error(`WS 连接失败: ${e.message ?? e.type}`)))
  })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(JSON.stringify(msg.error)))
      else res(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  return {
    ready,
    events,
    send(method, params = {}) {
      const mid = ++id
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
        setTimeout(() => {
          if (pending.has(mid)) {
            pending.delete(mid)
            rej(new Error(`CDP 超时: ${method}`))
          }
        }, 30000)
      })
    },
    close: () => ws.close(),
  }
}

async function main() {
  if (!existsSync(HTML)) {
    console.error(`[embed-smoke] 找不到 ${HTML} —— 先跑 npm run build:embed`)
    process.exit(1)
  }
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) {
    console.error('[embed-smoke] 未找到 Chrome/Edge，跳过（请手动在浏览器里打开产物验证）')
    process.exit(0)
  }

  const html = await readFile(HTML)
  /**
   * 服务两份东西：
   * ① 根路径 → 单文件 HTML（JS/CSS 已内联）；
   * ② `/icons/*`、`/samples/*` → **精简后的资产目录**
   *    （`scripts/embed-assets.mjs` 产出的 `dist-embed/public`）。
   *
   * 为什么必须有 ②：应用的工具条图标是**运行时用字符串拼路径**请求的
   * （实测会请求 `/icons/菜单.png` 等 17 个），构建期无法内联。
   * 若服务对它们回 204/HTML，控制台会报 `The script does not have a MIME type`
   * 或 `unsupported MIME type ('text/html')`，且**界面会缺图标**。
   * 插件端同理：`webapp-assets/` 必须随 `main.js` 一起提供（见方案 §5.1）。
   */
  const ASSET_DIR = path.join(ROOT, 'dist-embed', 'public')
  const server = createServer(async (req, res) => {
    const url = String(req.url ?? '/')
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(html)
      return
    }
    // 资产：只允许 icons/ 与 samples/，且拒绝越界
    const rel = decodeURIComponent(url.replace(/^\//, '').split('?')[0])
    if ((rel.startsWith('icons/') || rel.startsWith('samples/')) && !rel.includes('..')) {
      try {
        const buf = await readFile(path.join(ASSET_DIR, rel))
        const ext = path.extname(rel).toLowerCase()
        const mime =
          ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : ext === '.jps' ? 'text/plain; charset=utf-8' : 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' })
        res.end(buf)
        return
      } catch {
        /* 落到下面 204 */
      }
    }
    res.writeHead(204).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/`
  console.log(`[embed-smoke] 服务 ${url}（单文件 ${(html.length / 1024).toFixed(0)} KB）`)

  const profile = await mkdtemp(path.join(tmpdir(), 'ijipu-embed-smoke-'))
  const debugPort = 9333
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--window-size=1280,900',
      url,
    ],
    { stdio: 'ignore' },
  )

  const fail = async (msg) => {
    console.error(`[embed-smoke] ❌ ${msg}`)
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    server.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})
    process.exit(1)
  }

  // 等 CDP 端点就绪
  let target = null
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1:'))
      if (target) break
    } catch {
      /* 还没起来 */
    }
  }
  if (!target) return fail('Chrome CDP 未就绪')
  console.log('[embed-smoke] CDP 已就绪，开始收集运行时错误…')

  const c = cdp(target.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  await c.send('Log.enable')
  await c.send('Page.enable')
  await c.send('Network.enable')
  await sleep(3500) // 给 React 挂载 + 首屏渲染留时间
  console.log('[embed-smoke] 采集完成，正在探测 DOM…')

  const errs = []
  const reqs = []
  for (const e of c.events) {
    if (e.method === 'Network.requestWillBeSent') reqs.push(String(e.params?.request?.url ?? ''))
    if (e.method === 'Runtime.exceptionThrown') {
      errs.push(`未捕获异常: ${e.params?.exceptionDetails?.exception?.description ?? JSON.stringify(e.params)}`)
    }
    if (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error') {
      const en = e.params.entry
      errs.push(`console.error: ${en.text}${en.url ? `  ← ${en.url}` : ''}`)
    }
    if (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error') {
      errs.push(`console.error: ${(e.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')}`)
    }
  }

  let probe
  try {
    probe = await c.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        textareas: document.querySelectorAll('textarea').length,
        bodyLen: document.body.innerHTML.length,
        hasError: document.body.innerText.includes('Cannot find module') || document.body.innerText.includes('ChunkLoadError'),
      })`,
      returnByValue: true,
    })
  } catch (e) {
    c.close()
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    server.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})
    console.error(`[embed-smoke] ❌ Runtime.evaluate 失败：${e.message}`)
    console.error(`[embed-smoke] 采集到的页面错误 ${errs.length} 条：\n  - ${errs.slice(0, 8).join('\n  - ') || '（无）'}`)
    process.exit(1)
  }
  const info = JSON.parse(probe.result.value)

  c.close()
  try {
    child.kill()
  } catch {
    /* 忽略 */
  }
  server.close()
  // Chrome 退出后 profile 目录可能仍被占用（Crashpad 的 .pma）——清理失败不影响验证结论
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})

  console.log(`[embed-smoke] 页面探测: ${JSON.stringify(info)}`)
  /** 已知噪音过滤见下（`isNoise`） */
  const realErrs = errs.filter((s) => !isNoise(s))
  if (errs.length > realErrs.length) {
    console.log(`[embed-smoke] 忽略已知噪音 ${errs.length - realErrs.length} 条（favicon 204）`)
  }
  /**
   * 允许的"额外请求"：只有 `favicon.ico` 与 `icons/*`（应用的工具条图标是**运行时字符串拼路径**
   * 请求的，没法在构建期内联）。
   *
   * 判据说明：对这两类返回 **204**（本脚本）或真实图标（插件端由 `webapp-assets/` 提供）都算通过；
   * **不允许**的是"服务器回 HTML 导致 MIME 报错"——那说明服务端把未知路径当页面返了。
   * 只回 204 时图标会缺（视觉缺图标），插件端必须真的提供它们（见方案 §5.1）。
   */
  const allowed404 = (u) => u.endsWith('/favicon.ico') || u.includes('/icons/')
  const unexpected = [...new Set(reqs)].filter(
    (u) => u.startsWith('http://127.0.0.1:') && !u.endsWith('/') && !u.endsWith('/index.html') && !allowed404(u),
  )
  if (unexpected.length > 0) {
    console.log(`[embed-smoke] ⚠ 出现了预期外的请求（单文件产物本不该再取别的资源）：`)
    for (const u of unexpected) console.log(`  - ${u.slice(0, 140)}`)
  }
  const iconReqs = [...new Set(reqs)].filter((u) => u.includes('/icons/'))
  console.log(
    `[embed-smoke] 图标请求 ${iconReqs.length} 个（运行时按路径取，插件端须由 webapp-assets/ 提供；本脚本回 204 ⇒ 无图标但不报错）`,
  )
  if (realErrs.length > 0) {
    return fail(`运行时报错 ${realErrs.length} 条：\n  - ${realErrs.slice(0, 8).join('\n  - ')}`)
  }
  if (info.rootChildren <= 0 || info.textareas < 1) {
    return fail(`应用未挂载（root 子节点 ${info.rootChildren}，textarea ${info.textareas}）`)
  }
  if (info.hasError) return fail('页面出现 "Cannot find module"/"ChunkLoadError"')

  console.log('[embed-smoke] ✅ 单文件产物启动成功、无运行时报错')
  for (const s of EXPECT_SELECTORS) void s
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
