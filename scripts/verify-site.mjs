#!/usr/bin/env node
/**
 * scripts/verify-site.mjs — 官网四页的**实机验证** + 首页素材截图（adj876）
 *
 * 为什么需要它：
 *   `npm run smoke` 是**源码级**断言（快、不依赖浏览器），它能守住"配置指向对不对"，
 *   但守不住"页面打开后到底长什么样"——例如文档页的目录锚点点不动、首页图片 404、
 *   应用挂载失败白屏。这些只有真的用浏览器打开过才知道。
 *
 * 做法（与 `embed-smoke.mjs` 同一套）：
 *   ① 用 `node:http` 起一个只读静态服务托管 `dist/`，**按 Cloudflare Pages 的口径路由**
 *      （目录请求 → 目录下的 `index.html`；带扩展名按文件；越界拒绝）；
 *   ② 用系统 Chrome 的**无头 + CDP** 逐页打开，检查 title / 关键 DOM / 控制台错误与失败请求；
 *   ③ 顺手把首页要用的素材图截出来（`public/site/*.webp` 与 `dist/site/*.webp` 各写一份）。
 *
 * 用法：
 *   npm run build && npm run verify:site
 *   加 `--no-shots` 只验证不截图（CI 里用这个，省时间）
 *   加 `--shots-only` 只截图不验证
 *
 * 产物：
 *   · 提交进仓库的素材：`public/site/{hero,demo-score,view-*,voice-multi,playback}.webp`、`public/site/og.png`
 *   · 仅供人工检查的整页图：`dist-site-shots/*.webp`（**不入库**，见 .gitignore）
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const SITE_ASSETS = path.join(ROOT, 'public', 'site') // 提交进仓库的素材
const DIST_SHOTS = path.join(ROOT, 'dist-site-shots') // 仅供人工检查（不入库）
const SITE_REPO = 'https://github.com/snailhome/ijipu'
const SITE_PLUGIN = 'https://github.com/snailhome/obsidian-ijipu'

const ARGS = new Set(process.argv.slice(2))
const DO_SHOTS = !ARGS.has('--no-shots')
const DO_CHECKS = !ARGS.has('--shots-only')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

let passed = 0
let failed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) passed++
  else {
    failed++
    failures.push(`${name}${detail ? ` ← ${detail}` : ''}`)
  }
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ← ${detail}`}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// 静态服务（按 Cloudflare Pages 的口径）
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.jps': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/** 把 URL 路径映射到 dist 下的实际文件（目录 → index.html；无扩展名也试 index.html） */
function resolveDistFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p.endsWith('/')) p += 'index.html'
  const abs = path.join(DIST, p)
  // 越界保护：必须仍在 dist 内（`..` 之类一律拒绝）
  if (!abs.startsWith(DIST + path.sep)) return null
  if (existsSync(abs) && statSync(abs).isFile()) return abs
  // `/app` 这种没带尾斜杠的：Pages 会 308 到 `/app/`，这里直接给出它的 index.html
  if (!path.extname(abs) && existsSync(path.join(abs, 'index.html'))) return path.join(abs, 'index.html')
  return null
}

/** og 分享卡片：用 Chrome 渲染一张 1200×630 的卡片（比 PIL 拼图更可控、也更好看） */
function ogCardHtml(heroDataUri) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;background:#0F1526;color:#E8ECF8;overflow:hidden;
       font-family:system-ui,"Microsoft YaHei",sans-serif;
       background-image:radial-gradient(900px 420px at 88% -10%,rgba(0,240,255,.20),transparent 62%),
                        radial-gradient(700px 380px at 4% 108%,rgba(30,42,94,.95),transparent 60%)}
  .wrap{display:flex;height:100%;padding:56px 60px;gap:44px;align-items:center}
  .left{flex:1 1 auto;min-width:0}
  .brand{display:flex;align-items:center;gap:12px;font-size:24px;color:#93A0C8;margin-bottom:22px}
  .brand b{color:#00F0FF}
  h1{font-size:74px;letter-spacing:.05em;line-height:1.16;
     background:linear-gradient(96deg,#fff 22%,#00F0FF 104%);-webkit-background-clip:text;background-clip:text;color:transparent}
  p.sub{margin-top:20px;font-size:25px;line-height:1.6;color:#93A0C8}
  .meta{margin-top:30px;font-size:20px;color:#5A6A99}
  .right{flex:0 0 400px;height:330px;border:1px solid #24315E;border-radius:14px;overflow:hidden;background:#161D3A}
  .right img{width:100%;height:100%;object-fit:cover;object-position:top left}
  </style></head><body><div class="wrap">
    <div class="left">
      <div class="brand"><img src="/icons/Jianpu.png" width="34" height="34" alt=""> 爱记谱 <b>iJipu</b></div>
      <h1>码即成，谱自现</h1>
      <p class="sub">用文本写简谱：左边敲代码，右边立刻出谱。<br>实时试听、一键导出，免安装、免费开源。</p>
      <div class="meta">ijipu.pages.dev · Windows 桌面版 · Obsidian 插件</div>
    </div>
    <div class="right">${heroDataUri ? `<img src="${heroDataUri}" alt="">` : ''}</div>
  </div></body></html>`
}

// ---------------------------------------------------------------------------
// 极简 CDP over WebSocket（Node 22 内置 WebSocket）—— 与 embed-smoke.mjs 同一套
// ---------------------------------------------------------------------------
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

async function evalJs(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
  }
  return r.result.value
}

// ---------------------------------------------------------------------------
// 截图用的谱面（都用仓库里**已经有断言守着**的示例——避免截图里出现语法错误提示）
// ---------------------------------------------------------------------------
const SONG_SONG = String(readFileSync(path.join(ROOT, 'public', 'samples', '送别.jps'), 'utf8'))
/** 首页 demo 区那段（与 index.html 里写的是同一段） */
const SONG_STARS = 'B: 小星星\nQ: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |\nC: 一 闪 一 闪 亮 晶 晶，满 天 都 是 小 星 星\n'
/** 多声部/临时段（取自 docs/SYNTAX.md §2.12 的示例，smoke 有"文档示例零错误"的断言） */
const SONG_DSB = "V: 1.0\nB: 临时多声部\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"

async function main() {
  if (!existsSync(DIST)) {
    console.error('[verify-site] 找不到 dist/ —— 先跑 npm run build')
    process.exit(1)
  }
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) {
    console.error('[verify-site] 未找到 Chrome/Edge —— 跳过（请手动在浏览器里打开 dist/ 验证）')
    process.exit(0)
  }
  mkdirSync(SITE_ASSETS, { recursive: true })
  mkdirSync(DIST_SHOTS, { recursive: true })
  mkdirSync(path.join(DIST, 'site'), { recursive: true })

  let ogHtml = null
  const server = createServer((req, res) => {
    const urlPath = String(req.url ?? '/')
    if (urlPath === '/__og') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(ogHtml ?? '<!doctype html><body>og</body>')
      return
    }
    const file = resolveDistFile(urlPath)
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`

  const profile = path.join(tmpdir(), `ijipu-site-${Date.now()}`)
  const debugPort = 9400 + Math.floor(Math.random() * 120)
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
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  const cleanup = async (code) => {
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    server.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {})
    process.exit(code)
  }

  let target = null
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = list.find((t) => t.type === 'page')
      if (target) break
    } catch {
      /* 还没起来 */
    }
  }
  if (!target) {
    console.error('[verify-site] ❌ Chrome CDP 未就绪')
    return cleanup(1)
  }

  const c = cdp(target.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  await c.send('Log.enable')
  await c.send('Page.enable')
  await c.send('Network.enable')

  /** 当前页面的运行时错误（控制台 error + 未捕获异常 + 本站失败请求） */
  let pageErrors = []
  /** requestId → URL：`Network.loadingFailed` 只给 requestId，没有这张表就查不出是哪个请求失败 */
  const reqUrls = new Map()
  const noteEvents = () => pageErrors.length
  const collectErrors = (from) => {
    const out = []
    for (const m of c.events.slice(from)) {
      if (m.method === 'Network.requestWillBeSent') {
        reqUrls.set(m.params.requestId, m.params.request.url)
        continue
      }
      if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
        const e = m.params.entry
        const u = e.url ?? ''
        /**
         * 网络类控制台错误（`Failed to load resource: …`）**带 url**：
         * 非本站的一律不计——音色库的 CDN 在离网/受限网络下必然失败，
         * 那不是"站点坏了"。真正要抓的是本站资源 404 / 脚本异常（后者没有 url）。
         */
        if (u && !u.startsWith(origin)) continue
        out.push(`[console] ${e.text}${u ? ` ${u}` : ''}`)
      }
      if (m.method === 'Runtime.exceptionThrown') {
        out.push(`[exception] ${m.params?.exceptionDetails?.text ?? ''} ${m.params?.exceptionDetails?.exception?.description ?? ''}`)
      }
      if (m.method === 'Network.loadingFailed' && !m.params?.canceled) {
        // 只看**本站**请求：跨域（音色库 CDN 等）在离网/受限环境必然失败，不是"站点坏了"
        const u = reqUrls.get(m.params.requestId) ?? ''
        if (u.startsWith(origin)) out.push(`[net] ${m.params.errorText} ${u}`)
      }
      if (m.method === 'Network.responseReceived' && (m.params?.response?.status ?? 0) >= 400) {
        const u = m.params.response.url
        if (u.startsWith(origin)) out.push(`[http ${m.params.response.status}] ${u}`)
      }
    }
    return [...new Set(out)]
  }

  const setupShotEnv = (source, name, view) =>
    c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        if (!localStorage.getItem('__siteShotInit')) {
          localStorage.setItem('__siteShotInit', '1')
          localStorage.setItem('ijipu.draft', ${JSON.stringify(source)})
          localStorage.setItem('ijipu.draftName', ${JSON.stringify(name)})
          localStorage.setItem('ijipu.viewType', ${JSON.stringify(view)})
          /**
           * 关掉**排版辅助虚线**（页边距线、行距线…）。
           * 它们是编辑时的参考线，出现在宣传图里会像"瑕疵"（本轮实测：
           * demo 图裁到墨迹后，虚线仍贯穿整张图——因为它们不是 SVG 元素，
           * 而是盖在预览区上的 HTML 覆盖层，按 SVG 遍历根本筛不掉）。
           * 键的取值口径见 uiStore 的 loadBool：只认 '1'/'true' 为真，故写 '0'。
           */
          localStorage.setItem('ijipu.showGuides', '0')
        }
      } catch (e) {}`,
    })

  const setView = async (view) => {
    await evalJs(c, `localStorage.setItem('ijipu.viewType', ${JSON.stringify(view)})`)
  }
  const reload = async () => {
    await c.send('Page.reload', { ignoreCache: false })
    await sleep(900)
  }
  const viewport = (width, height, dsf) =>
    c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: false })

  const shoot = async (format, extra = {}) => {
    const r = await c.send('Page.captureScreenshot', { format, fromSurface: true, ...extra })
    return Buffer.from(r.data, 'base64')
  }
  /** 素材图：同时写 `public/site/`（要提交）与 `dist/site/`（首页马上要用） */
  const saveAsset = async (name, buf) => {
    await writeFile(path.join(SITE_ASSETS, name), buf)
    await writeFile(path.join(DIST, 'site', name), buf)
    console.log(`    · public/site/${name}  ${(buf.length / 1024).toFixed(0)} KB`)
  }
  /** 仅供人工检查的整页图 */
  const saveShot = async (name, buf) => {
    await writeFile(path.join(DIST_SHOTS, name), buf)
    console.log(`    · dist-site-shots/${name}  ${(buf.length / 1024).toFixed(0)} KB`)
  }
  /**
   * 首页的插图大多是 `loading="lazy"`（首屏只留 Hero 一张），而懒加载的图**进入视口才会真的去取**。
   * 所以无论是"整页截图"还是"检查有没有破图"，都得先滚到底把它们都触发一遍。
   * 不做这一步会得到两个假象：整页图下半部分是空白；"无破图"断言把没加载当成加载失败。
   *
   * ⚠ 还必须**等 `decode()`**：`img.complete` 只说明"下载完了"，
   *   位图解码是异步的，没解完就截图 ⇒ 截出来是一排**空框**（本轮实测踩到，图上像是"图都没了"）。
   */
  const primeLazyImages = async () => {
    await evalJs(c, `window.scrollTo(0, document.body.scrollHeight)`)
    await evalJs(
      c,
      `(async () => {
        const t0 = Date.now()
        while (Date.now() - t0 < 8000) {
          if ([...document.images].every((i) => i.complete)) break
          await new Promise((r) => setTimeout(r, 150))
        }
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})))
        return document.images.length
      })()`,
    )
    await evalJs(c, `window.scrollTo(0, 0)`)
    await sleep(300)
  }

  try {
    /**
     * 注入"上次编辑的谱面"到 localStorage（应用启动时会读它）。
     * ⚠ 必须在**任何模式**下都做：截图要让画面里有真谱面，而验证阶段要靠它断言
     *   "应用确实读到了草稿"（真实场景：关掉浏览器再打开，还在上次那份谱上）。
     *   只放在截图分支里的话，`--no-shots` 模式会拿不到草稿、把一条正常的功能判红。
     */
    await setupShotEnv(SONG_SONG, '送别', 'split')

    // =====================================================================
    // 第一阶段：截图（首页要用的素材先落地，后面验证首页时图片才不是 404）
    // =====================================================================
    if (DO_SHOTS) {
      console.log('[verify-site] 生成素材图…')

      // ---- /app/ 拆分视图 = 首页 Hero（最大的一张，2 倍图） ----
      await viewport(1440, 880, 2)
      await c.send('Page.navigate', { url: `${origin}/app/` })
      await sleep(1800)
      await saveAsset('hero.webp', await shoot('webp', { quality: 82 }))

      // ---- 三个视图的小图（1.4 倍够用，省体积） ----
      for (const [file, view] of [
        ['view-code.webp', 'code'],
        ['view-split.webp', 'split'],
        ['view-preview.webp', 'preview'],
      ]) {
        await setView(view)
        await reload()
        await sleep(700)
        await saveAsset(file, await shoot('webp', { quality: 76 }))
      }
      // 上面的循环结束在 preview 视图，接着用它截多声部示例
      await viewport(1440, 880, 1.6)
      await evalJs(
        c,
        `localStorage.setItem('ijipu.draft', ${JSON.stringify(SONG_DSB)});
         localStorage.setItem('ijipu.draftName', '临时多声部');
         localStorage.setItem('ijipu.viewType', 'preview')`,
      )
      await reload()
      await sleep(900)
      await saveAsset('voice-multi.webp', await shoot('webp', { quality: 78 }))
      // 状态栏里若带告警，宣传图上会出现一个「⚠」——把原文打出来，好回去修示例谱
      console.log(`    · 状态栏：${await evalJs(c, `(document.querySelector('footer, [class*="status"]')?.textContent ?? '').trim().slice(0, 80)`)}`)

      /**
       * ---- 导出面板 ----
       * ⚠ 这里**不要**去点「试听」：截图环境离网，应用会尝试下载 30MB 音色库，
       *   拍出来的是「正在后台下载音色库…」+ 一条下载失败提示（本轮实测踩过）。
       *   导出面板不依赖网络，展示的信息（PDF/图片/音频各档格式）也更有用。
       */
      await evalJs(c, `localStorage.setItem('ijipu.draft', ${JSON.stringify(SONG_SONG)})`)
      await reload()
      await sleep(800)
      const opened = await evalJs(
        c,
        `(() => {
          const btns = [...document.querySelectorAll('button, a')]
          const b = btns.find((el) => /导出/.test((el.textContent || '') + (el.title || '') + (el.getAttribute('aria-label') || '')))
          if (!b) return false
          b.click()
          return true
        })()`,
      )
      if (opened) {
        await sleep(1000)
        await evalJs(c, `document.querySelectorAll('.toast').forEach((el) => el.remove())`)
        await sleep(300)
        await saveAsset('export.webp', await shoot('webp', { quality: 78 }))
      } else {
        console.log('    · 跳过 export.webp（没找到「导出」按钮）')
      }

      /**
       * ---- 首页 demo 区那张谱面 ----
       * 两个讲究：
       * ① **用浅色主题**：首页整体是深色，而示意的谱面如果也是深色，
       *    与左边的代码块糊成一片、看不出"这是渲染出来的乐谱"。
       *    浅色主题下预览区是白纸黑字，跟深色代码块并排，一眼就是"代码 → 谱"。
       * ② **只截有墨迹的范围**：预览区 SVG 是整页尺寸，而《小星星》只有一行音符
       *    ⇒ 直接截 svg 会得到一张 2/3 是空白的图（本轮第一版就是这样，实测发现了）。
       *    这里遍历 svg 子元素求墨迹并集，并按两条规则剔除"不是墨迹"的东西：
       *      · 只认 `text` 与 `path`（音符/歌词/标题是 text，连线是 path）；
       *      · 面积超过整页 40% 的也丢掉——纸张背景就是一个铺满整页的 `<rect>`，
       *        带上它等于没裁（本轮第二版实测：裁出来仍有 1075px 高，就是它在作祟）；
       *      · 带 `stroke-dasharray` 的同样是辅助线，不算墨迹。
       */
      await evalJs(
        c,
        `localStorage.setItem('ijipu.draft', ${JSON.stringify(SONG_STARS)});
         localStorage.setItem('ijipu.draftName', '小星星');
         localStorage.setItem('ijipu.viewType', 'preview');
         localStorage.setItem('ijipu.themeMode', 'light')`,
      )
      await reload()
      await sleep(1000)
      const rect = await evalJs(
        c,
        `(() => {
          const svgs = [...document.querySelectorAll('#root svg')]
          if (svgs.length === 0) return null
          // 谱面那个 SVG 的 <text> 一定最多（图标类 SVG 没有文字）
          const svg = svgs.sort((a, b) => b.querySelectorAll('text').length - a.querySelectorAll('text').length)[0]
          const vb = svg.viewBox.baseVal
          const pageArea = (vb.width || 0) * (vb.height || 0)
          let box = null
          for (const el of svg.querySelectorAll('text, path')) {
            if (el.getAttribute('stroke-dasharray')) continue // 辅助虚线
            let b
            try { b = el.getBBox() } catch { continue }
            if (!b || (b.width === 0 && b.height === 0)) continue
            // 铺满整页的背景块（纸张）不是墨迹：面积超过四成页面的整块直接忽略
            if (pageArea > 0 && b.width * b.height > pageArea * 0.4) continue
            box = box
              ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), x2: Math.max(box.x2, b.x + b.width), y2: Math.max(box.y2, b.y + b.height) }
              : { x: b.x, y: b.y, x2: b.x + b.width, y2: b.y + b.height }
          }
          if (!box) return null
          const r = svg.getBoundingClientRect()
          const sx = r.width / (vb.width || r.width)
          const sy = r.height / (vb.height || r.height)
          return {
            x: r.x + (box.x - vb.x) * sx,
            y: r.y + (box.y - vb.y) * sy,
            width: (box.x2 - box.x) * sx,
            height: (box.y2 - box.y) * sy,
          }
        })()`,
      )
      if (rect && rect.width > 100 && rect.height > 40) {
        const pad = 14
        const x = Math.max(0, rect.x - pad)
        const y = Math.max(0, rect.y - pad)
        await saveAsset('demo-score.webp', await shoot('webp', {
          quality: 88,
          clip: { x, y, width: rect.width + pad * 2, height: rect.height + pad * 2, scale: 2 },
        }))
        console.log(`    · （demo 图裁到墨迹：${Math.round(rect.width)}×${Math.round(rect.height)} CSS px）`)
      } else {
        console.log('    · 跳过 demo-score.webp（没找到谱面 svg 或量不出墨迹）')
      }
      // 后面的 og 缩略图回到深色主题（与应用默认一致）
      await evalJs(c, `localStorage.setItem('ijipu.themeMode', 'dark')`)

      // ---- og 分享卡片（1200×630）：先把首页截图缩进去当配图 ----
      await viewport(1440, 880, 1)
      await setView('split')
      await evalJs(
        c,
        `localStorage.setItem('ijipu.draft', ${JSON.stringify(SONG_SONG)});
         localStorage.setItem('ijipu.viewType', 'split')`,
      )
      await reload()
      await sleep(900)
      const thumb = await shoot('webp', { quality: 70, clip: { x: 720, y: 60, width: 700, height: 560, scale: 1 } })
      ogHtml = ogCardHtml(`data:image/webp;base64,${thumb.toString('base64')}`)
      await viewport(1200, 630, 1)
      await c.send('Page.navigate', { url: `${origin}/__og` })
      await sleep(800)
      await saveAsset('og.png', await shoot('png'))

      // ---- 仅供检查：四个页面的整页图 ----
      await viewport(1440, 900, 1)
      await c.send('Page.navigate', { url: `${origin}/` })
      await sleep(900)
      await primeLazyImages()
      await saveShot('home.png', await shoot('png', { captureBeyondViewport: true }))
      await c.send('Page.navigate', { url: `${origin}/manual/` })
      await sleep(900)
      await saveShot('manual.png', await shoot('png', { captureBeyondViewport: true }))
      await c.send('Page.navigate', { url: `${origin}/syntax/` })
      await sleep(1200)
      await saveShot('syntax.png', await shoot('png', { captureBeyondViewport: true }))
    }

    // =====================================================================
    // 第二阶段：逐页功能验证
    // =====================================================================
    if (DO_CHECKS) {
      // ---------------- 首页 ----------------
      console.log('[verify-site] 验证 `/`（介绍首页）…')
      await viewport(1440, 900, 1)
      pageErrors = []
      let mark = noteEvents()
      await c.send('Page.navigate', { url: `${origin}/` })
      await sleep(1200)
      await primeLazyImages()
      const home = await evalJs(
        c,
        `(() => {
          const q = (s) => document.querySelector(s)
          const qa = (s) => [...document.querySelectorAll(s)]
          const ver = q('[data-app-version]')?.textContent ?? ''
          const imgs = qa('img').map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }))
          const links = Object.fromEntries(qa('a[data-l]').map((a) => [a.dataset.l, a.getAttribute('href')]))
          return {
            title: document.title,
            h1: q('.hero h1')?.textContent ?? '',
            cards: qa('.cards .card').length,
            entries: qa('.link-grid .link-card').length,
            navLinks: qa('.nav a').length,
            cta: q('.hero-actions a.btn-primary')?.getAttribute('href') ?? '',
            ver,
            verCount: qa('[data-app-version]').filter((e) => /^v\\d+\\.\\d+\\.\\d+$/.test(e.textContent.trim())).length,
            verTotal: qa('[data-app-version]').length,
            imgs,
            links,
            hasDialog: !!q('dialog#donate'),
            donateImg: q('dialog#donate img')?.getAttribute('src') ?? '',
            faq: qa('.faq details').length,
          }
        })()`,
      )
      check('首页 title 含 Slogan「码即成，谱自现」', home.title.includes('码即成，谱自现'), home.title)
      check('首页 H1 = 码即成，谱自现', home.h1 === '码即成，谱自现', home.h1)
      check('首页特性卡 8 张', home.cards === 8, String(home.cards))
      check('首页入口链接 6 个（应用/手册/语法/桌面/插件/赞赏）', home.entries === 6, String(home.entries))
      check('首页顶栏导航 ≥ 6 条', home.navLinks >= 6, String(home.navLinks))
      check('首页主按钮指向 `/app/`', home.cta === '/app/', home.cta)
      check('首页版本号占位全部填成 vX.Y.Z（没有漏成「·」）',
        home.verTotal > 0 && home.verCount === home.verTotal, `${home.verCount}/${home.verTotal}：${home.ver}`)
      const brokenImgs = home.imgs.filter((i) => !i.ok).map((i) => i.src)
      check('首页所有图片都真的加载出来了（无破图）', brokenImgs.length === 0, brokenImgs.join(', '))
      check('首页外部链接都由 brand/tokens.ts 填好（不是 `#`）',
        home.links.repoUrl === SITE_REPO && (home.links.desktopDownloadUrl ?? '').startsWith(SITE_REPO) && home.links.obsidianRepoUrl === SITE_PLUGIN,
        JSON.stringify(home.links))
      // 这条是**负对照**：证明上面的"链接填好了"不是碰巧——`#` 与真地址必须能区分开
      check('首页链接负对照：`#` 与真实地址确实不同（判据在量东西）', '#'.startsWith(SITE_REPO) === false)
      check('首页赞赏弹层用微信赞赏码 `/icons/good.png`', home.hasDialog && home.donateImg === '/icons/good.png', home.donateImg)
      check('首页 FAQ 至少 4 条', home.faq >= 4, String(home.faq))
      const homeErrs = collectErrors(mark)
      check('首页无控制台错误 / 无本站 4xx（含图片与脚本）', homeErrs.length === 0, homeErrs.slice(0, 4).join(' | '))

      // ---------------- 应用页 ----------------
      console.log('[verify-site] 验证 `/app/`（应用）…')
      mark = noteEvents()
      await c.send('Page.navigate', { url: `${origin}/app/` })
      await sleep(2200)
      const app = await evalJs(
        c,
        `(() => {
          const q = (s) => document.querySelector(s)
          return {
            title: document.title,
            rootKids: q('#root')?.children.length ?? 0,
            hasEditor: !!q('textarea'),
            svgCount: document.querySelectorAll('#root svg').length,
            draftLen: (localStorage.getItem('ijipu.draft') || '').length,
          }
        })()`,
      )
      check('应用 title = 「爱记谱 iJipu - vX.Y.Z (…）」形式', /^爱记谱 iJipu - v\d+\.\d+\.\d+/.test(app.title), app.title)
      check('应用挂载成功（#root 有内容）', app.rootKids > 0, String(app.rootKids))
      check('应用编辑器在位（textarea 存在）', app.hasEditor)
      check('应用谱面渲染出来了（有 svg）', app.svgCount > 0, String(app.svgCount))
      check('应用读到了注入的谱面草稿（说明 localStorage 草稿链路正常）', app.draftLen > 0, String(app.draftLen))
      const appErrs = collectErrors(mark).filter((e) => !/音色|soundfont|sampler|sf2|midi-js/i.test(e))
      check('应用无本站资源错误（音色库等跨域资源失败不计）', appErrs.length === 0, appErrs.slice(0, 4).join(' | '))

      // ---------------- 文档页（两份都要：正文 + 目录 + 锚点） ----------------
      for (const [label, url, minToc, minKids, needTable] of [
        ['操作手册', '/manual/', 5, 20, false],
        ['脚本语法说明', '/syntax/', 8, 40, true],
      ]) {
        console.log(`[verify-site] 验证 \`${url}\`（${label}）…`)
        mark = noteEvents()
        await c.send('Page.navigate', { url: `${origin}${url}` })
        await sleep(1500)
        /**
         * 检查页内锚点。⚠ 两个坑都踩过了，写在这里免得下次重犯：
         *
         * ① **判据必须用 `getElementById`，不能用 `querySelector`**：
         *    中文标题 slug 可能是 `1-1-什么是-jps` 这种**数字开头**的（标题里的 `1.1` 去标点后如此），
         *    而 `querySelector` 拿 `#1-1-…` 当 CSS 选择器时是**非法的**，会直接抛异常。
         *    浏览器自己的锚点跳转走的是 getElementById 语义，所以"数字开头"对用户没问题。
         * ② 下面这段是**模板字符串**，里面（**注释里也不行**）不能出现反引号——
         *    一出现就提前终止字符串，报一个跟真实位置差很远的语法错。
         *    `embed-smoke.mjs` 为此专门有 `assertNoBackticksInTemplates()` 自检。
         */
        const doc = await evalJs(
          c,
          `(() => {
            const q = (s) => document.querySelector(s)
            const qa = (s) => [...document.querySelectorAll(s)]
            const toc = qa('#doc-toc a.toc-item').map((a) => a.getAttribute('href'))
            const dead = toc.filter((h) => !document.getElementById(h.slice(1)))
            return {
              title: document.title,
              kids: q('#doc-body')?.children.length ?? 0,
              tocCount: toc.length,
              dead: dead.slice(0, 3),
              tables: qa('#doc-body table.doc-md-table').length,
              codes: qa('#doc-body pre').length,
              firstHead: q('#doc-body h1')?.textContent ?? '',
              bodyHasContent: (q('#doc-body')?.textContent ?? '').trim().length > 300,
            }
          })()`,
        )
        check(`${label}：title 正确`, doc.title.includes(label), doc.title)
        check(`${label}：正文渲染出来了（子节点 ≥ ${minKids}）`, doc.kids >= minKids, String(doc.kids))
        check(`${label}：正文有实质内容`, doc.bodyHasContent)
        check(`${label}：左侧目录条目 ≥ ${minToc}`, doc.tocCount >= minToc, String(doc.tocCount))
        check(`${label}：目录锚点**全部**能在正文里找到（不会点不动）`, doc.dead.length === 0, doc.dead.join(', '))
        check(`${label}：代码块渲染成 <pre>`, doc.codes > 0, String(doc.codes))
        if (needTable) check(`${label}：表格渲染成真 <table>`, doc.tables > 0, String(doc.tables))

        /**
         * 真点一下目录（第 3 条）：断言 hash 变了、页面滚动了、且目标标题就落在视口上方附近。
         * 只查"元素存在"不够——`scroll-padding-top` 配错、`scroll-behavior` 失效、
         * 或 id 与 toc 的 href 差一个字符，都会表现为"点了没反应"。
         */
        const hit = await evalJs(
          c,
          `(() => {
            const a = document.querySelectorAll('#doc-toc a.toc-item')[2]
            if (!a) return null
            a.click()
            return a.getAttribute('href').slice(1)
          })()`,
        )
        await sleep(900)
        /**
         * ⚠ 这里必须 `decodeURIComponent`：`location.hash` 里中文是**百分号编码**的
         * （`#%E4%B8%89-…`），直接拿它去 `getElementById` 一定找不到 ——
         * 而"找不到"会被读成"目录点不动"，把一个正常的跳转判成红灯（本轮就先判错了一次）。
         */
        const jumped = await evalJs(
          c,
          `(() => {
            const raw = location.hash.slice(1)
            const id = decodeURIComponent(raw)
            const el = document.getElementById(id)
            return {
              id,
              y: Math.round(window.scrollY),
              top: el ? Math.round(el.getBoundingClientRect().top) : null,
            }
          })()`,
        )
        check(`${label}：点目录真的会跳（hash 指向该标题 + 滚到目标标题附近）`,
          !!hit && jumped.id === hit && jumped.y > 0 && jumped.top !== null && jumped.top >= -20 && jumped.top < 240,
          `目标 ${hit} → ${JSON.stringify(jumped)}`)
        const docErrs = collectErrors(mark)
        check(`${label}：无控制台错误 / 无本站 4xx`, docErrs.length === 0, docErrs.slice(0, 4).join(' | '))
      }

      // ---------------- 负对照：确认"验证器真的在量东西" ----------------
      console.log('[verify-site] 负对照…')
      const missing = await fetch(`${origin}/definitely-not-a-page/`)
      check('负对照：不存在的路径确实 404（说明静态服务没有偷偷兜底成 200）', missing.status === 404, String(missing.status))
      const shellRes = await fetch(`${origin}/app/`)
      const shellBody = await shellRes.text()
      // 用产物里的特征判断（首页产物有 `class="hero"`，应用外壳有 `id="root"`）
      check('负对照：`/app/` 返回的是**应用外壳**而不是首页',
        shellBody.includes('id="root"') && !shellBody.includes('class="hero"'))
    }
  } catch (e) {
    console.error(`[verify-site] ❌ 脚本异常：${e?.message ?? e}`)
    await cleanup(1)
    return
  }

  c.close()
  console.log('')
  if (DO_CHECKS) {
    console.log(`[verify-site] 断言 ${passed} 通过 / ${failed} 失败`)
    if (failed > 0) {
      console.log('失败项：')
      for (const f of failures) console.log(`  · ${f}`)
    } else {
      console.log('[verify-site] 全部通过 ✅')
    }
  } else {
    console.log('[verify-site] 只截图模式：完成')
  }
  await cleanup(failed > 0 ? 1 : 0)
}

main()
