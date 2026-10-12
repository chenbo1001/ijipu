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
 *   · 提交进仓库的素材：`public/site/{hero,view-*,voice-multi,playback}.webp`、`public/site/og.png`
 *     （`demo-score.webp` 在 adj898 删除 —— 示例区改成现场渲染后它就是多余的了）
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
/**
 * adj890（用户决定）：仓库**整体开源** ⇒ 对外链接全部指主仓库（不再用单独的发布仓库）。
 * `adj889` 那套"源码私有 ⇒ 指向 `ijipu-releases`"已撤销。
 */
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
/**
 * 首页示例区的**预置源码**（adj898 起就是《小星星》，原来的"最小示例"一行谱已被替换）。
 *
 * ⚠ 必须与 `src/landing/samples.ts` 的 `BRAND_SAMPLES[0]` **逐字一致** ——
 * 用户第一眼看到的、和点第一个示例按钮得到的，应当是同一段。
 * 那条一致性由 smoke 的 `[164]` 段守着（verify 是独立脚本，读不了 TS 模块）。
 */
const HOME_SAMPLE_STARS = [
  'B: 小星星',
  'D: C',
  'P: 4/4',
  "Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - ||",
  'C: 一 闪 一 闪 亮 晶 晶 满 天 都 是 小 星 星',
].join('\n') + '\n'
/** 多声部/临时段（取自 docs/SYNTAX.md §2.12 的示例，smoke 有"文档示例零错误"的断言） */
const SONG_DSB = "V: 1.0\nB: 临时多声部\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
/** Obsidian 示意图里的谱（取自 obsidian-ijipu 的 README 示例，短、歌词好认） */
const SONG_TIGER =
  'V: 1.0\nB: 两只老虎\nZ: 法国童谣 词曲\nD: C\nP: 4/4\nJ: 120\nQ: 1 2 3 1 | 1 2 3 1 | 3 4 5 - | 3 4 5 - |\nC: 两 只 老 虎 两 只 老 虎 跑 得 快 跑 得 快\n'

/**
 * Obsidian 插件示意图（adj877）。
 *
 * **诚实说明**：本机没有 Obsidian，所以窗口外壳（侧栏、笔记正文、代码块）是我用 HTML/CSS 画的；
 * 但**谱面部分是把引擎真实渲染出的 SVG 内联进来的**——不是画的、也不是贴图。
 * 这样既不用假装有真截图，又能保证"插件里长什么样"这件事是可信的。
 */
function obsidianCardHtml(scoreSvg, theme) {
  /** 代码块围栏：`String.fromCharCode(96)` 拼出来，避免在本文件的模板字符串里写出反引号字面量 */
  const FENCE = String.fromCharCode(96).repeat(3)
  /**
   * 两套配色（adj881）。
   * 跟的是 **Obsidian 自己的深浅主题**，不是 iJipu 官网的主题——但这张图要贴在官网首页上，
   * 官网切浅色时留一张深色截图会很跳，所以两套都出一份、由 `applyShots()` 跟着换。
   * 写成 CSS 变量注入到 `<body style>`：样式表里只留 `var(--ob-*)`，加/改配色不必动 CSS。
   */
  const palette =
    theme === 'light'
      ? {
          bg: '#ffffff', side: '#f6f6f6', border: '#e3e5e8', text: '#2e3338', dim: '#8b8f95',
          file: '#4b5058', cur: '#e8e9eb', curText: '#1a1a1a', h1: '#1a1a1a',
          code: '#f5f6f7', codeBorder: '#e3e5e8', codeText: '#3c4149', fence: '#7c3aed',
        }
      : {
          bg: '#1e1e1e', side: '#262626', border: '#333333', text: '#dcddde', dim: '#8a8a8a',
          file: '#b9b9b9', cur: '#333333', curText: '#ffffff', h1: '#e8e8e8',
          code: '#1a1a1a', codeBorder: '#2f2f2f', codeText: '#cfcfcf', fence: '#a882ff',
        }
  const vars = Object.entries(palette)
    .map(([k, v]) => `--ob-${k}:${v}`)
    .join(';')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:780px;overflow:hidden;background:var(--ob-bg);color:var(--ob-text);
       font-family:system-ui,"Microsoft YaHei",sans-serif;font-size:14px}
  .win{display:flex;height:100%}
  .side{width:196px;flex:0 0 196px;background:var(--ob-side);border-right:1px solid var(--ob-border);padding:14px 10px}
  .side .vault{font-size:12px;color:var(--ob-dim);padding:0 6px 12px;letter-spacing:.04em}
  .side .f{padding:5px 8px;border-radius:5px;color:var(--ob-file);font-size:13px}
  .side .f.on{background:var(--ob-cur);color:var(--ob-curText)}
  .main{flex:1;min-width:0;padding:30px 44px;overflow:hidden}
  .main h1{font-size:25px;color:var(--ob-h1);margin-bottom:12px}
  .main p{color:var(--ob-file);line-height:1.8;margin-bottom:12px}
  .cb{background:var(--ob-code);border:1px solid var(--ob-codeBorder);border-radius:7px;padding:11px 14px;margin:12px 0;
      font-family:ui-monospace,Consolas,monospace;font-size:12.5px;line-height:1.8;color:var(--ob-codeText);white-space:pre}
  .cb .k{color:var(--ob-fence)}
  .score{background:#fff;border-radius:7px;padding:10px 12px;position:relative}
  .score svg{width:100%;height:auto;display:block}
  .play{position:absolute;right:10px;top:10px;background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.14);
        border-radius:6px;padding:3px 9px;font-size:12px;color:#333}
  </style></head><body style="${vars}"><div class="win">
    <div class="side">
      <div class="vault">我的音乐笔记</div>
      <div class="f">乐理笔记.md</div>
      <div class="f on">儿歌练习.md</div>
      <div class="f">两只老虎.jps</div>
      <div class="f">送别.jps</div>
    </div>
    <div class="main">
      <h1>儿歌练习</h1>
      <p>记几首简单的儿歌，方便带孩子唱。下面这个代码块由 iJipu 插件渲染成简谱：</p>
      <div class="cb"><span class="k">${FENCE}jps</span>
V: 1.0
B: 两只老虎
D: C
P: 4/4
Q: 1 2 3 1 | 1 2 3 1 | 3 4 5 - | 3 4 5 - |
C: 两只老虎 两只老虎 跑得快 跑得快
<span class="k">${FENCE}</span></div>
      <div class="score"><span class="play">▶ 试听</span>${scoreSvg}</div>
    </div>
  </div></body></html>`
}

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
  let obsidianHtml = null
  const server = createServer((req, res) => {
    const urlPath = String(req.url ?? '/')
    // 两张"卡片页"（分享卡 / Obsidian 示意图）由本脚本现拼 HTML，不走 dist
    if (urlPath === '/__og' || urlPath === '/__obsidian') {
      const html = urlPath === '/__og' ? ogHtml : obsidianHtml
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(html ?? '<!doctype html><html><body></body></html>')
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
    /**
     * ⚠ 必须**分段**滚到底，不能一步 `scrollTo(0, scrollHeight)`：
     * 一步跳过去时中间那些区块**从未进入视口**，`loading="lazy"` 的图压根不会开始下载
     * （本轮实测：一步滚动之后 voice-multi / export 两张图始终是破图）。
     */
    await evalJs(
      c,
      `(async () => {
        const h = document.body.scrollHeight
        for (let y = 0; y <= h; y += 500) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 70))
        }
        window.scrollTo(0, h)
      })()`,
    )
    await evalJs(
      c,
      `(async () => {
        /**
         * ⚠ 每一步等待都要**自带上限**：
         *   ① 轮询「complete」最多 8 秒；
         *   ② 「decode()」必须包一层超时——实测它在个别情况下**永不 resolve**
         *      （已解码过的图 / 懒加载边界），会让整次「Runtime.evaluate」一直挂着，
         *      直到 CDP 自己的 30 秒超时才报错（本轮就是这么炸的）。
         *   ⚠ 本段是**模板字符串**：里面（注释里也算）不能出现反引号，一律用「」。
         */
        const race = (p, ms) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))])
        const t0 = Date.now()
        while (Date.now() - t0 < 8000) {
          if ([...document.images].every((i) => i.complete)) break
          await new Promise((r) => setTimeout(r, 150))
        }
        await Promise.all([...document.images].map((i) => race(i.decode(), 2500)))
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

      /**
       * ---- 应用界面截图：**深色 / 浅色各截一套**（adj881，用户要求）----
       * 为什么要两套：官网切到浅色主题时插图也要跟着换——图展示的是"应用长什么样"，
       * 应用已经换成浅色主题了、图却还是深色的，就自相矛盾了。
       * 命名约定（与 `landing/main.ts` 的 `applyShots()` 一一对应，改一处要改两处）：
       *   `<名字>.webp`（深色） / `<名字>-light.webp`（浅色）
       * ⚠ 每轮开始**必须**先设 `ijipu.themeMode`——否则两套图会一模一样，
       *   而"两套图长得一样"恰恰是最难一眼看出来的缺陷。
       */
      for (const theme of ['dark', 'light']) {
        const sfx = theme === 'light' ? '-light' : ''
        /**
         * ⚠ 顺序要紧：**先 navigate 再动 localStorage**。
         * Chrome 刚起来时当前页是 `about:blank`，在那里读 localStorage 会抛
         * `SecurityError: Access is denied for this document`（本轮实测踩到）。
         */
        await c.send('Page.navigate', { url: `${origin}/app/` })
        await sleep(1300)
        await evalJs(c, `localStorage.setItem('ijipu.themeMode', ${JSON.stringify(theme)})`)
        await reload()
        await sleep(1300)

        // ---- /app/ 拆分视图 = 首页 Hero（最大的一张，2 倍图） ----
        await viewport(1440, 880, 2)
        await saveAsset(`hero${sfx}.webp`, await shoot('webp', { quality: 82 }))

        // ---- 三个视图的小图（1.6 倍够用，省体积） ----
        for (const [file, view] of [
          ['view-code', 'code'],
          ['view-split', 'split'],
          ['view-preview', 'preview'],
        ]) {
          await setView(view)
          await reload()
          await sleep(700)
          await saveAsset(`${file}${sfx}.webp`, await shoot('webp', { quality: 76 }))
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
        await saveAsset(`voice-multi${sfx}.webp`, await shoot('webp', { quality: 78 }))
        // 状态栏里若带告警，宣传图上会出现一个「⚠」——把原文打出来，好回去修示例谱
        console.log(`    · [${theme}] 状态栏：${await evalJs(c, `(document.querySelector('footer, [class*="status"]')?.textContent ?? '').trim().slice(0, 80)`)}`)

        /**
         * ---- 导出面板 ----
         * ⚠ 这里**不要**去点「试听」：截图环境离网，应用会尝试下载 30MB 音色库，
         *   拍出来的是「正在后台下载音色库…」+ 一条下载失败提示（本轮实测踩过）。
         *   导出面板不依赖网络，展示的信息（PDF/图片/音频各档格式）也更有用。
         * ⚠ 必须先 `Page.navigate` 回 `/app/`：`reload` 重载的是**当前页**，
         *   上一轮循环结束时停在别处就会拍错页面（见 `E-2026-397`）。
         */
        await c.send('Page.navigate', { url: `${origin}/app/` })
        await sleep(900)
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
          await saveAsset(`export${sfx}.webp`, await shoot('webp', { quality: 78 }))
        } else {
          console.log(`    · 跳过 export${sfx}.webp（没找到「导出」按钮）`)
        }
      }

      /**
       * ---- 首页 demo 区那张静态谱面图：**adj898 起不再生成** ----
       *
       * 由来：原来首页有一段「一行文本，就是一段旋律」，是"左边源码 + 右边一张截图"。
       * 那张截图（`public/site/demo-score.webp`）是用下面这套办法裁出来的：
       * 临时把《小星星》写进 `ijipu.draft`、切浅色主题、reload，再遍历谱面 SVG 的
       * `text` / `path` 求墨迹并集，剔掉铺满整页的纸张背景与 `stroke-dasharray` 辅助线。
       *
       * adj898（用户要求把两个区块**整合成一个**）：示例区改成**现场用引擎渲染**，
       * 静态图没有存在意义了（而且它只能表现《小星星》这一段，新的 7 个示例它一个都覆盖不了）
       * ⇒ 整套裁图逻辑连同那张图一起删掉。
       *
       * ⚠ 浅色主题那一步不再需要：后面的 og 图直接用首页截图，而首页默认就是深色。
       */

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

      /**
       * ---- Obsidian 插件示意图（adj877，adj881 起出深浅两套）----
       * 谱面从 `/app/` 里**取引擎真实渲染出的 SVG**（`outerHTML`），再内联进"仿笔记"卡片里截图。
       * 于是：窗口是我画的、**乐谱是真的**——比"贴一张来路不明的截图"诚实，也不用假装有 Obsidian。
       * 谱面本身是白底黑字，所以两套图**共用同一份 SVG**，只有卡片外壳的配色不同。
       */
      for (const theme of ['dark', 'light']) {
        const sfx = theme === 'light' ? '-light' : ''
        await viewport(1440, 900, 1.6)
        await evalJs(
          c,
          `localStorage.setItem('ijipu.draft', ${JSON.stringify(SONG_TIGER)});
           localStorage.setItem('ijipu.draftName', '两只老虎');
           localStorage.setItem('ijipu.viewType', 'preview');
           localStorage.setItem('ijipu.themeMode', ${JSON.stringify(theme)})`,
        )
        /**
         * ⚠ 这里必须是 `Page.navigate` 回 `/app/`，**不能** `reload()`：
         * 上一轮已经把页面导航到卡片页（`/__og` 或 `/__obsidian`）了，而 `reload` 重载的是**当前页**
         * ⇒ 会把卡片页再加载一遍，应用一个元素都没有（本轮实测：`svgs:0, text:""`，图被跳过）。
         * localStorage 是同源的，所以"在卡片页上写设置"没问题，问题只在"回哪一页"。
         */
        await c.send('Page.navigate', { url: `${origin}/app/` })
        await sleep(1200)
        /** 轮询等谱面渲染出来（不要只 sleep 一次就取——本轮第一版就是这么"取不到"的） */
        let scoreSvg = ''
        for (let i = 0; i < 20 && !scoreSvg; i++) {
          await sleep(300)
          scoreSvg = await evalJs(
            c,
            `(() => {
              const svgs = [...document.querySelectorAll('#root svg')]
              if (svgs.length === 0) return ''
              return svgs.sort((a, b) => b.querySelectorAll('text').length - a.querySelectorAll('text').length)[0].outerHTML
            })()`,
          )
        }
        if (scoreSvg && scoreSvg.length > 500) {
          obsidianHtml = obsidianCardHtml(scoreSvg, theme)
          await viewport(1200, 780, 1.6)
          await c.send('Page.navigate', { url: `${origin}/__obsidian` })
          await sleep(900)
          await saveAsset(`obsidian${sfx}.webp`, await shoot('webp', { quality: 84 }))
        } else {
          const diag = await evalJs(
            c,
            `JSON.stringify({ svgs: document.querySelectorAll('#root svg').length, len: ${JSON.stringify(scoreSvg.length)}, text: (document.querySelector('#root')?.textContent ?? '').slice(0, 160) })`,
          )
          console.log(`    · 跳过 obsidian${sfx}.webp（取不到谱面 SVG）：${diag}`)
        }
      }

      // ---- 仅供检查：四个页面的整页图 ----
      await viewport(1440, 900, 1)
      await c.send('Page.navigate', { url: `${origin}/` })
      await sleep(900)
      await primeLazyImages()
      await saveShot('home.png', await shoot('png', { captureBeyondViewport: true }))

      /**
       * 浅色版首页（**仅供人工检查**）：浅色下最容易出问题的是"对比度"与"深色截图贴在浅底上"，
       * 这两样都不是断言能判的，只能看图。用完把用户选择清掉，别把状态留给后面的断言。
       */
      await evalJs(c, `localStorage.setItem('ijipu.site.theme', 'light')`)
      await c.send('Page.navigate', { url: `${origin}/` })
      await sleep(900)
      await primeLazyImages()
      await saveShot('home-light.png', await shoot('png', { captureBeyondViewport: true }))
      await evalJs(c, `localStorage.removeItem('ijipu.site.theme')`)
      await c.send('Page.navigate', { url: `${origin}/manual/` })
      await sleep(900)
      await saveShot('manual.png', await shoot('png', { captureBeyondViewport: true }))
      await c.send('Page.navigate', { url: `${origin}/syntax/` })
      await sleep(1200)
      await saveShot('syntax.png', await shoot('png', { captureBeyondViewport: true }))
      /* adj905x：插件手册（新增页）的整页图 */
      await c.send('Page.navigate', { url: `${origin}/plugin/` })
      await sleep(1200)
      await saveShot('plugin.png', await shoot('png', { captureBeyondViewport: true }))
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
            /* adj877：Obsidian 插件专区 与 playground */
            obPoints: qa('.ob-points li').length,
            obMarket: q('.ob-actions a[data-l="obsidianMarketUrl"]')?.getAttribute('href') ?? '',
            obRepo: q('.ob-actions a[data-l="obsidianRepoUrl"]')?.getAttribute('href') ?? '',
            /* adj882：首页「看看它长什么样」—— 示例按钮 + 一个 jps 块 */
            pgSamples: qa('[data-pg-sample]').length,
            pgBlocks: qa('#playground .jps-block').length,
            /* adj878：右上角的深浅主题开关 */
            hasTheme: !!q('#theme-toggle'),
            /* adj905x（用户要求）：顶栏那一排的「插件手册」入口 */
            navPlugin: qa('.nav a').find((a) => (a.textContent || '').trim() === '插件手册')?.getAttribute('href') ?? '',
          }
        })()`,
      )
      check('首页 title 含 Slogan「码即成，谱自现」', home.title.includes('码即成，谱自现'), home.title)
      check('首页 H1 = 码即成，谱自现', home.h1 === '码即成，谱自现', home.h1)
      check('首页特性卡 8 张', home.cards === 8, String(home.cards))
      /**
       * adj898：首页示例区**预置的源码**必须是《小星星》。
       * 用户第一眼看到的那段，就是"一行文本，就是一段旋律"这句话的证据 ——
       * 它要是还停在过去那行 `Q: 1 2 3 4 | 5 6 7 1' |`，整段文案就说不通了。
       */
      const pgCode = await evalJs(c, `document.querySelector('#pg-block .jps-block-code code')?.textContent ?? ''`)
      check('adj898 首页示例区预置的源码就是《小星星》（含 `D:` / `P:` 与收尾 `||`）',
        pgCode.replace(/\s+$/, '') === HOME_SAMPLE_STARS.replace(/\s+$/, ''),
        JSON.stringify(pgCode.slice(0, 80)))
      /**
       * adj897（用户反馈）：功能卡的**图标与标题必须在同一行**。
       * 原来图标 / 标题 / 内容各占一行，手机上卡片窄 ⇒ 三行显得很散。
       * 这条**在手机视口下量真实几何**（用户说的正是那个场景），桌面也量一遍（是统一改的）。
       */
      const measureCard = () =>
        evalJs(
          c,
          `(() => {
            const out = []
            // adj897：**两类卡都要量** —— 功能卡（.features .card）与入口卡（.links .link-card）
            for (const sel of ['.features .card', '.links .link-card']) {
              const root = document.querySelector(sel)
              if (!root) { out.push({ sel, missing: true }); continue }
              const ico = root.querySelector('[class$="-ico"]')            // .card-ico / .link-ico
              const title = root.querySelector('h3, b')                    // 功能卡是 h3、入口卡是 b
              const body =
                root.querySelector('p:not(.card-ico)') ?? root.querySelector('span:last-child')
              if (!ico || !title || !body) { out.push({ sel, missing: true }); continue }
              const a = ico.getBoundingClientRect(), b = title.getBoundingClientRect(), d = body.getBoundingClientRect()
              out.push({
                sel,
                sameRow: Math.abs(a.top - b.top) <= 12,
                icoLeftOfTitle: b.left >= a.right - 2,
                bodyBelow: d.top >= Math.max(a.bottom, b.bottom) - 2,
                icoTop: Math.round(a.top), titleTop: Math.round(b.top), bodyTop: Math.round(d.top),
              })
            }
            return out
          })()`,
        )
      const cardsOk = (r) =>
        Array.isArray(r) && r.length === 2 && r.every((x) => !x.missing && x.sameRow && x.icoLeftOfTitle && x.bodyBelow)
      await viewport(390, 844, 2)
      await sleep(350)
      const cardMobile = await measureCard()
      check('adj897 手机视口（390px）下：**功能卡与入口卡**的图标、标题都在同一行，内容落在下一行',
        cardsOk(cardMobile), JSON.stringify(cardMobile))
      await viewport(1440, 900, 1)
      await sleep(350)
      const cardDesktop = await measureCard()
      check('adj897 桌面视口下同样成立（两类卡都是图标与标题一行，不是只在手机上改的）',
        cardsOk(cardDesktop), JSON.stringify(cardDesktop))
      // ⚠ adj899 的换行测试放在下面"切示例"那组**之后**（它要点击示例，会改变初始状态）
      check('首页入口链接 6 个（应用/手册/语法/桌面/插件/赞赏）', home.entries === 6, String(home.entries))
      check('首页顶栏导航 ≥ 6 条', home.navLinks >= 6, String(home.navLinks))
      check('adj905x 首页顶栏有「插件手册」入口（指向 `/plugin/`，用户要求）',
        home.navPlugin === '/plugin/', home.navPlugin)
      check('首页主按钮指向 `/app/`', home.cta === '/app/', home.cta)
      check('首页版本号占位全部填成 vX.Y.Z（没有漏成「·」）',
        home.verTotal > 0 && home.verCount === home.verTotal, `${home.verCount}/${home.verTotal}：${home.ver}`)
      const brokenImgs = home.imgs.filter((i) => !i.ok).map((i) => i.src)
      check('首页所有图片都真的加载出来了（无破图）', brokenImgs.length === 0, brokenImgs.join(', '))
      // ⚠ 首页**没有** `feedbackUrl`（那是文档页页脚的键）⇒ 这里只查首页真正用到的三个
      check('首页外部链接都由 brand/tokens.ts 填好（不是 `#`）',
        home.links.repoUrl === SITE_REPO &&
          home.links.desktopDownloadUrl === `${SITE_REPO}/releases/latest` &&
          home.links.obsidianRepoUrl === SITE_PLUGIN,
        JSON.stringify(home.links))
      /**
       * adj896（用户反馈「官网首页少挂了个更新记录」）：顶栏与页脚都要有「更新记录」，
       * 且指向 **全部发布** 页（`…/releases`）—— 与 `desktopDownloadUrl` 的 `releases/latest`
       * （直接拿最新安装包）是两件事，别写成同一个。
       */
      const releasesLinks = await evalJs(
        c,
        `[...document.querySelectorAll('a[data-l="releasesUrl"]')].map((a) => a.href)`,
      )
      check('adj896 首页有「更新记录」入口（顶栏 + 页脚），指向**全部发布**页而非 latest',
        releasesLinks.length >= 2 && releasesLinks.every((h) => h === `${SITE_REPO}/releases`),
        JSON.stringify(releasesLinks))
      /**
       * 负对照（**保留 adj889 的修正**）：原来那条是 `'#'.startsWith(SITE_REPO) === false`，
       * 而 `'#'` 不以任何地址开头 ⇒ **恒为真、证不了任何事**。换成真正有风险的那件事：
       * 下载地址必须是"主仓库 + `/releases/latest`"这个确定形态，且**不能被插件仓库的地址匹配上**
       * —— 判据写错前缀（少个 `/` 之类）在这里就会露出来。
       */
      check('首页链接负对照：`repoUrl` 与 `desktopDownloadUrl` 的判据能区分开（判据真的在量东西）',
        `${SITE_REPO}/releases/latest` !== SITE_REPO &&
          `${SITE_REPO}/releases/latest`.startsWith(`${SITE_REPO}/`) &&
          !`${SITE_PLUGIN}/releases/latest`.startsWith(`${SITE_REPO}/`))
      check('首页赞赏弹层用微信赞赏码 `/icons/good.png`', home.hasDialog && home.donateImg === '/icons/good.png', home.donateImg)
      check('首页 FAQ 至少 4 条', home.faq >= 4, String(home.faq))
      check('首页有 Obsidian 插件专区（功能清单 ≥ 6 条）', home.obPoints >= 6, String(home.obPoints))
      /**
       * adj888（用户口径「**原则上先应用的功能介绍，再插件介绍**」）：
       * 这条顺序被用户调过两次（adj884 先放到最前、adj884b 退回一个位置、adj888 再对调一次），
       * 所以钉成断言 —— 以后谁打乱它，这里会红，而不是等用户再说一遍。
       */
      const deepOrder = await evalJs(
        c,
        `[...document.querySelectorAll('.deep h2, .obsidian h2')].map((h) => h.textContent.trim())`,
      )
      check('首页「先应用功能、再插件介绍」：Obsidian 段排在两个应用功能段**之后**',
        JSON.stringify(deepOrder) ===
          JSON.stringify(['写谱像写代码一样爽', '复杂谱子也扛得住', '在笔记里直接写谱', '写给谁']),
        JSON.stringify(deepOrder))
      check('插件专区两个按钮地址正确（社区市场 / GitHub 仓库）',
        home.obMarket === 'https://obsidian.md/plugins?id=ijipu' && home.obRepo === SITE_PLUGIN,
        `${home.obMarket} | ${home.obRepo}`)
      check('首页示例区：7 个示例按钮 + 恰好一个 ```jps 块',
        home.pgSamples === 7 && home.pgBlocks === 1, `${home.pgSamples} 个示例 / ${home.pgBlocks} 个块`)

      // ---- adj878：右上角的深浅主题开关（点一下要真的换掉配色，不只是改个属性） ----
      check('首页右上角有深浅主题开关', home.hasTheme)
      const themeBefore = await evalJs(c, `document.documentElement.dataset.siteMode ?? ''`)
      const themeAfter = await evalJs(
        c,
        `(() => {
          document.getElementById('theme-toggle')?.click()
          return document.documentElement.dataset.siteMode ?? ''
        })()`,
      )
      const themeVars = await evalJs(
        c,
        `(() => {
          const cs = getComputedStyle(document.documentElement)
          return { bg: cs.getPropertyValue('--site-bg').trim(), accent: cs.getPropertyValue('--site-accent').trim() }
        })()`,
      )
      check('点主题开关后模式翻转（深 ⇄ 浅）',
        (themeBefore === 'dark' || themeBefore === 'light') && themeAfter !== themeBefore,
        `${themeBefore} → ${themeAfter}`)
      // 判据取"强调色"：深色是霓虹青 #00f0ff、浅色必须换成 #0891a6（亮青压浅底根本看不见）
      check('切换后配色真的换了（浅色下强调色不再是霓虹青）',
        themeAfter === 'light'
          ? themeVars.accent.toLowerCase() === '#0891a6' && themeVars.bg.toLowerCase() === '#f2f5fb'
          : themeVars.accent.toLowerCase() === '#00f0ff',
        JSON.stringify(themeVars))
      // 点回去：后面的检查与截图都按深色预期，别留下副作用
      await evalJs(c, `document.getElementById('theme-toggle')?.click()`)
      const themeBack = await evalJs(c, `document.documentElement.dataset.siteMode ?? ''`)
      check('再点一下能切回原模式（开关是双向的）', themeBack === themeBefore, `${themeBack} vs ${themeBefore}`)

      // ---- adj881（用户要求）：插图也要跟着主题换 ----
      const shotsDark = await evalJs(c, `[...document.querySelectorAll('img[data-shot]')].map((i) => i.getAttribute('src'))`)
      check('首页插图带 data-shot 标记，且默认是深色那套',
        shotsDark.length >= 6 && shotsDark.every((s) => s && !s.includes('-light.')), shotsDark.join(', '))
      await evalJs(c, `document.getElementById('theme-toggle')?.click()`)
      await sleep(400)
      const shotsLight = await evalJs(c, `[...document.querySelectorAll('img[data-shot]')].map((i) => i.getAttribute('src'))`)
      check('切到浅色后插图**全部**换成浅色那套（`-light.webp`）',
        shotsLight.length === shotsDark.length && shotsLight.every((s) => s.includes('-light.')),
        shotsLight.join(', '))
      // 换完还要真的能加载（截图阶段没生成浅色图的话，这里就是破图）
      await primeLazyImages()
      const lightBroken = await evalJs(
        c,
        `[...document.images].filter((x) => x.getAttribute('data-shot') && !(x.naturalWidth > 0)).map((x) => x.getAttribute('src'))`,
      )
      check('浅色那套插图都能加载（没有因为缺文件而破图）', lightBroken.length === 0, lightBroken.join(', '))
      await evalJs(c, `document.getElementById('theme-toggle')?.click()`)
      await sleep(400)
      const shotsBack = await evalJs(c, `[...document.querySelectorAll('img[data-shot]')].map((i) => i.getAttribute('src'))`)
      check('切回深色后插图还原（可逆）',
        JSON.stringify(shotsBack) === JSON.stringify(shotsDark), shotsBack.join(', '))

      /**
       * ---- adj882：首页「看看它长什么样」——一排示例 + 一个 ` ```jps ` 块 ----
       * 用户口径：首页不该让使用者自己改代码（那还不如直接进应用），
       * 而是给几个例子让他切着看 —— 所以这里**没有 textarea**。
       * 下面这条"真的点一下「预览」"是"引擎能在首页跑"的**唯一硬证据**（源码级断言做不到）。
       */
      const pgTabsOk = await evalJs(
        c,
        `(() => {
          const block = document.getElementById('pg-block')
          if (!block) return -1
          return block.querySelectorAll('[data-jps-tab]').length
        })()`,
      )
      check('首页有这个 ```jps 块，且带「脚本 / 预览」两个标签', pgTabsOk === 2, String(pgTabsOk))
      const pgInitial = await evalJs(
        c,
        `(() => {
          const b = document.getElementById('pg-block')
          if (!b) return null
          return {
            codeHidden: b.querySelector('.jps-block-code')?.hidden ?? null,
            prevHidden: b.querySelector('.jps-block-preview')?.hidden ?? null,
            mode: b.dataset.jpsMode ?? '',
            zoom: b.dataset.jpsZoom ?? '',
            samples: [...document.querySelectorAll('[data-pg-sample]')].length,
          }
        })()`,
      )
      check('首页示例按钮 7 个（小星星 / 茉莉花 / 倚音与连音 / 跳房子与反复 / 临时伴奏 / 临时多声部 / 多声部）',
        pgInitial?.samples === 7, JSON.stringify(pgInitial))
      /**
       * adj900（用户决定「用文本串导入功能」）：示例区那个「在应用里试听这段」
       * 把**当前示例的完整源码**挂在 `?jps=` 上带进应用 ——
       * 于是首页不用下 30MB 音色库，用户又能在应用里看到（并试听）自己刚看的那段。
       * ⚠ 这条要在"切示例"那组**之前**量：那时 href 里装的才是首屏的小星星。
       */
      const handoff = await evalJs(
        c,
        `(() => {
          const a = document.getElementById('pg-open-app')
          if (!a) return null
          const href = a.getAttribute('href') ?? ''
          let decoded = ''
          try { decoded = decodeURIComponent(href.replace('/app/?jps=', '')) } catch { decoded = '' }
          return { href: href.slice(0, 60), decoded, text: (a.textContent ?? '').trim() }
        })()`,
      )
      check('adj900 示例区有「在应用里试听」入口，链接指向 `/app/?jps=…`',
        !!handoff && handoff.href.startsWith('/app/?jps='), JSON.stringify(handoff))
      check('adj900 链接里带的是**当前示例（小星星）的完整源码**（含标题行与收尾 `||`）',
        !!handoff && handoff.decoded.includes('B: 小星星') && handoff.decoded.includes('||'),
        JSON.stringify(handoff?.decoded?.slice(0, 70)))
      /**
       * adj900b（用户要求）：首页那个入口**不许**出现"要下载音色库 / 30MB"这类说明 ——
       * 「要提示也是到应用后，在试听里没有音色库时再提示」。
       * 钉成**负向断言**：以后谁"好心"把它加回来，这里会红。
       */
      const pgOpenText = await evalJs(c, `document.querySelector('.pg-open')?.textContent ?? ''`)
      check('adj900b 首页试听入口**不提**音色库 / 30MB / 下载（该提示的地方是应用）',
        !/30\s*MB|音色库|下载|音源/i.test(pgOpenText), JSON.stringify(pgOpenText))
      check('adj900b 那个入口就是一个按钮，文案逐字是「在应用里试听」',
        pgOpenText.trim() === '在应用里试听', JSON.stringify(pgOpenText))
      check('首屏停在「脚本」标签（预览要按需下引擎，不该在首屏发生）',
        pgInitial?.codeHidden === false && pgInitial?.prevHidden === true, JSON.stringify(pgInitial))
      check('首页这个块声明了显示范围与缩放（`v=` / `z=`，与插件同口径）',
        pgInitial?.mode === 's' && pgInitial?.zoom === '*', JSON.stringify(pgInitial))

      const pgClicked = await evalJs(
        c,
        `(() => {
          const b = document.querySelector('#pg-block [data-jps-tab="preview"]')
          if (!b) return false
          b.click()
          return true
        })()`,
      )
      let pgSvg = 0
      for (let i = 0; i < 30 && pgSvg === 0; i++) {
        await sleep(300)
        pgSvg = await evalJs(c, `document.querySelectorAll('#pg-block .jps-block-preview svg').length`)
      }
      const pgMsg = await evalJs(c, `document.querySelector('#pg-block .jps-block-msg')?.textContent ?? ''`)
      check('点「预览」后首页的块真的渲染出谱面（引擎在首页加载并跑通了）',
        pgClicked && pgSvg > 0, `svg=${pgSvg} msg=${pgMsg}`)
      check('首页块的渲染结果无错误/告警提示', pgMsg === '', pgMsg.slice(0, 120))

      // ---- 切示例：源码与预览都要跟着换（这是这个区块的核心用途） ----
      const swap = await evalJs(
        c,
        `(async () => {
          const btns = [...document.querySelectorAll('[data-pg-sample]')]
          const code = document.querySelector('#pg-block .jps-block-code code')
          if (btns.length < 2 || !code) return null
          const before = code.textContent
          btns[1].click()
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 200))
            if (code.textContent !== before && document.querySelectorAll('#pg-block .jps-block-preview svg').length > 0) break
          }
          return { before: before.length, after: code.textContent.length, active: btns[1].classList.contains('active') }
        })()`,
      )
      check('点另一个示例后：源码换了、预览重渲染了、按钮高亮跟着走',
        !!swap && swap.after > 0 && swap.after !== swap.before && swap.active === true, JSON.stringify(swap))
      await evalJs(c, `document.querySelectorAll('[data-pg-sample]')[0]?.click()`)
      await sleep(900)

      /**
       * adj899（用户反馈「示例的脚本块没有允许自动换行，应开启自动换行，不然脚本看不全」）：
       * 量**真实溢出**而不是只看 CSS 属性 —— 切到曲行最长的「茉莉花（完整）」，
       * 若脚本块不折行，它的 `scrollWidth` 必然远大于 `clientWidth`。
       *
       * ⚠ 这段必须待在"切示例"那组**之后**：它自身要点击示例，会把块的初始状态改掉。
       * 跑完**切回索引 0**，不给后面的断言留副作用。
       */
      await evalJs(c, `document.querySelectorAll('[data-pg-sample]')[1]?.click()`)
      await sleep(500)
      const codeBox = await evalJs(
        c,
        `(() => {
          const pre = document.querySelector('#pg-block .jps-block-code')
          if (!pre) return null
          return {
            ws: getComputedStyle(pre).whiteSpace,
            wrap: getComputedStyle(pre).overflowWrap,
            scrollW: pre.scrollWidth,
            clientW: pre.clientWidth,
          }
        })()`,
      )
      check('adj899 示例脚本块会**自动换行**（`pre-wrap`，长曲行不再被横向截掉）',
        codeBox?.ws === 'pre-wrap', JSON.stringify(codeBox))
      check('adj899 长曲行（茉莉花）不再横向溢出：`scrollWidth ≤ clientWidth`（用户要求"不然看不全"）',
        !!codeBox && codeBox.scrollW <= codeBox.clientW + 2, JSON.stringify(codeBox))
      await evalJs(c, `document.querySelectorAll('[data-pg-sample]')[0]?.click()`)
      await sleep(500)

      const pgErrs = collectErrors(mark)
      check('首页（含示例切换与引擎加载）无控制台错误 / 无本站 4xx',
        pgErrs.length === 0, pgErrs.slice(0, 4).join(' | '))

      const homeErrs = collectErrors(mark)
      check('首页无控制台错误 / 无本站 4xx（含图片与脚本）', homeErrs.length === 0, homeErrs.slice(0, 4).join(' | '))

      // ---------------- 应用页 ----------------
      console.log('[verify-site] 验证 `/app/`（应用）…')
      /**
       * 截图阶段把 `viewType` 留在 `preview`（demo 图与 Obsidian 图要它）——
       * 验证前**显式设回**应用默认的「左右拆分」：断言不该依赖"上一步碰巧留下的状态"，
       * 否则截图顺序一改，这里就会莫名其妙地红（本轮实测就是这个）。
       */
      await evalJs(c, `localStorage.setItem('ijipu.viewType', 'split')`)
      /**
       * adj900（用户决定「用文本串导入功能」）：**端到端**验一次 ——
       * 首页那个链接带过来的 `?jps=` 到底有没有被应用载入。
       *
       * 不能只靠纯函数断言：`App.tsx` 里那个 effect 有没有跑、
       * 会不会被 docStore 启动时读的本地草稿盖掉，**只有真打开一次才知道**。
       */
      await c.send('Page.navigate', { url: `${origin}/app/?jps=${encodeURIComponent(HOME_SAMPLE_STARS)}` })
      await sleep(2200)
      const urlImport = await evalJs(
        c,
        `(() => {
          const ta = document.querySelector('textarea')
          const val = ta ? ta.value : ''
          return {
            loaded: val.includes('B: 小星星') && val.includes('||'),
            len: val.length,
            // 地址栏里的 jps 参数应当已被抹掉（否则一刷新又被打回示例）
            search: location.search,
          }
        })()`,
      )
      check('adj900 打开 `/app/?jps=…` 后编辑器里**确实载入了那段示例**（端到端）',
        urlImport?.loaded === true, JSON.stringify(urlImport))
      check('adj900 载入后地址栏参数被抹掉（不然用户一刷新又被打回示例）',
        urlImport?.search === '', JSON.stringify(urlImport))

      pageErrors = []
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
            /* adj877（用户要求）：应用里回官网的路 */
            siteHref: q('.footer-site')?.getAttribute('href') ?? '',
            siteText: (q('.footer-site')?.textContent ?? '').trim(),
          }
        })()`,
      )
      check('应用 title = 「爱记谱 iJipu - vX.Y.Z (…）」形式', /^爱记谱 iJipu - v\d+\.\d+\.\d+/.test(app.title), app.title)
      check('应用挂载成功（#root 有内容）', app.rootKids > 0, String(app.rootKids))
      check('应用编辑器在位（textarea 存在）', app.hasEditor)
      check('应用谱面渲染出来了（有 svg）', app.svgCount > 0, String(app.svgCount))
      check('应用读到了注入的谱面草稿（说明 localStorage 草稿链路正常）', app.draftLen > 0, String(app.draftLen))
      // adj877（用户要求「要有返回首页的链接点」）：应用自己的界面里原本没有任何回官网的路
      check('应用状态栏有「官网首页」链接（网页版 href = `/`）',
        app.siteHref === '/' && app.siteText.includes('官网'), `${app.siteHref} / ${app.siteText}`)
      const appErrs = collectErrors(mark).filter((e) => !/音色|soundfont|sampler|sf2|midi-js/i.test(e))
      check('应用无本站资源错误（音色库等跨域资源失败不计）', appErrs.length === 0, appErrs.slice(0, 4).join(' | '))

      // ---------------- 文档页（三份都要：正文 + 目录 + 锚点） ----------------
      for (const [label, url, minToc, minKids, needTable] of [
        ['操作手册', '/manual/', 5, 20, false],
        ['脚本语法说明', '/syntax/', 8, 40, true],
        /* adj905x（用户要求）：插件功能介绍 + 使用手册 */
        ['插件手册', '/plugin/', 8, 30, true],
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
              /* adj877（用户要求）：顶栏的返回首页链接 */
              docHome: q('.doc-home')?.getAttribute('href') ?? '',
              /* adj878：顶栏的深浅主题开关 */
              hasTheme: !!q('.theme-toggle'),
            }
          })()`,
        )
        check(`${label}：title 正确`, doc.title.includes(label), doc.title)
        check(`${label}：顶栏有「返回首页」链接（adj877 用户要求）`, doc.docHome === '/', doc.docHome)
        check(`${label}：顶栏有深浅主题开关（adj878，与首页同一套）`, doc.hasTheme)
        check(`${label}：正文渲染出来了（子节点 ≥ ${minKids}）`, doc.kids >= minKids, String(doc.kids))
        check(`${label}：正文有实质内容`, doc.bodyHasContent)
        check(`${label}：左侧目录条目 ≥ ${minToc}`, doc.tocCount >= minToc, String(doc.tocCount))
        check(`${label}：目录锚点**全部**能在正文里找到（不会点不动）`, doc.dead.length === 0, doc.dead.join(', '))
        /**
         * adj886（用户反馈「左侧栏一级菜单无链接、不可点击」）：
         * 目录里**每一行**都必须是能跳的链接（`dead === 0`）。
         * ⚠ 不要求"一定有一级"：**操作手册本来就没有一级标题**（它用「一、二、三」当二级），
         *   只有语法说明才有 `# 第一部分` 这类一级 —— 所以"有没有一级"单独对语法说明断言。
         */
        const tocAll = await evalJs(
          c,
          `(() => {
            const links = [...document.querySelectorAll('#doc-toc a')]
            const dead = links.filter((a) => !document.getElementById((a.getAttribute('href') || '').slice(1)))
            return { total: links.length, groups: document.querySelectorAll('#doc-toc a.toc-group').length, dead: dead.length }
          })()`,
        )
        check(`${label}：目录里每一行都是可点链接（共 ${tocAll?.total ?? 0} 行，其中一级 ${tocAll?.groups ?? 0} 个）`,
          !!tocAll && tocAll.dead === 0 && tocAll.total > 0, JSON.stringify(tocAll))
        if (label === '脚本语法说明') {
          check('语法说明的目录里，一级标题也是链接（用户反馈过"一级不可点"）',
            (tocAll?.groups ?? 0) > 0, JSON.stringify(tocAll))
        }
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

        /**
         * adj905x（用户要求）：「**操作手册 / 脚本语法说明 的页眉要浮动固定在顶部**，不随内容上滚，
         * 这样随时可以点目录、跳到需要的标题 —— 类似首页的显示方式」。
         *
         * 判据用**实测矩形**，不看 CSS 里写了什么（"写了 sticky 却没生效"正是这类问题的形态：
         * 祖先有 overflow、被 transform/filter 生成包含块、或 sticky 的容器高度不对，都会静默失效）。
         * 此刻页面已经被上面那步滚过了（`jumped.y > 0`）⇒ 正好是量它的时机。
         * 顺带量"目录是否仍在视口内" —— 用户要的是"随时可以点目录"。
         */
        const sticky = await evalJs(
          c,
          `(() => {
            const tb = document.querySelector('.doc-topbar')
            const toc = document.querySelector('.doc-toc')
            const tr = tb ? tb.getBoundingClientRect() : null
            const cr = toc ? toc.getBoundingClientRect() : null
            return {
              y: Math.round(window.scrollY),
              vh: window.innerHeight,
              pos: tb ? getComputedStyle(tb).position : '',
              top: tr ? Math.round(tr.top) : null,
              bottom: tr ? Math.round(tr.bottom) : null,
              tocTop: cr ? Math.round(cr.top) : null,
              tocInView: !!cr && cr.bottom > 0 && cr.top < window.innerHeight,
            }
          })()`,
        )
        check(`${label}：滚到 ${sticky?.y ?? 0}px 后页眉**仍固定在顶部**（不随内容上滚）`,
          !!sticky && sticky.y > 0 && sticky.top === 0 && sticky.bottom > 0 &&
            (sticky.pos === 'sticky' || sticky.pos === 'fixed'),
          JSON.stringify(sticky))
        check(`${label}：滚动中目录仍在视口内（"随时可以点目录"）`,
          !!sticky && sticky.tocInView, JSON.stringify(sticky))

        /**
         * ---- adj882（用户要求）：文档里的 ` ```jps ` 示例要变成「脚本 / 预览」块 ----
         * 这是这个功能的**核心验收**：语法说明里几十个示例，页面上都该是可切换的。
         */
        const jpsBlocks = await evalJs(c, `document.querySelectorAll('#doc-body .jps-block').length`)
        check(`${label}：正文里的 \`\`\`jps 示例都变成了「脚本 / 预览」块（共 ${jpsBlocks} 个）`,
          jpsBlocks > 0, String(jpsBlocks))
        const jpsInit = await evalJs(
          c,
          `(() => {
            const b = document.querySelector('#doc-body .jps-block')
            if (!b) return null
            return {
              codeHidden: b.querySelector('.jps-block-code')?.hidden ?? null,
              prevHidden: b.querySelector('.jps-block-preview')?.hidden ?? null,
              mode: b.dataset.jpsMode ?? '',
              zoom: b.dataset.jpsZoom ?? '',
            }
          })()`,
        )
        check(`${label}：jps 块默认停在「脚本」（预览要按需加载引擎，不该在打开文档时就下）`,
          jpsInit?.codeHidden === false && jpsInit?.prevHidden === true, JSON.stringify(jpsInit))
        const docClicked = await evalJs(
          c,
          `(() => {
            const b = document.querySelector('#doc-body .jps-block [data-jps-tab="preview"]')
            if (!b) return false
            b.click()
            return true
          })()`,
        )
        let docSvg = 0
        for (let i = 0; i < 30 && docSvg === 0; i++) {
          await sleep(300)
          docSvg = await evalJs(c, `document.querySelectorAll('#doc-body .jps-block .jps-block-preview svg').length`)
        }
        check(`${label}：点示例块的「预览」真的渲染出谱面（引擎按需加载跑通）`,
          docClicked && docSvg > 0, `svg=${docSvg}`)

        /**
         * adj890：文档页页脚的「发现问题 / 提建议」指向源码仓库 —— 仓库已开源 ⇒ 访客点得开、也提得了 Issue。
         */
        const docFeedback = await evalJs(
          c,
          `(() => { const a = document.querySelector('.doc-foot a[data-l="repoUrl"]'); return a ? a.href : '' })()`,
        )
        check(`${label}：页脚反馈链接指向公开的源码仓库`, docFeedback === SITE_REPO, docFeedback)

        const docErrs = collectErrors(mark)
        check(`${label}：无控制台错误 / 无本站 4xx`, docErrs.length === 0, docErrs.slice(0, 4).join(' | '))
      }

      /**
       * ---------------- 窄屏（手机视口）的目录抽屉 ----------------
       *
       * adj905x（**用户实测反馈**）：「手机上点『目录』，面板开在离我很远的上方 —— 点了没反应」。
       *
       * 根因：窄屏下目录是抽屉，而它是 `position: static` 的普通块、DOM 排序在正文**之前** ⇒
       * 你滚到第 5 节再点「目录」，面板其实是展开在**文档最顶部**，视口里什么都没发生。
       * 现在它是**贴在吸顶页眉之下的浮层**（`position: fixed` + `top: var(--site-topbar-h)`），
       * 与首页手机菜单同一手法。
       *
       * 判据都在 390×844 的手机视口下**实测**（不看 CSS 写了什么）：
       *  ① 滚过之后页眉仍吸顶；
       *  ② **滚到中部**点「目录」⇒ 面板必须出现在**视口内**（用户报的就是这一条）；
       *  ③ 点面板里的一条 ⇒ 跳到该标题 + 面板自动收起。
       */
      console.log('[verify-site] 验证窄屏（手机视口）的目录抽屉…')
      await viewport(390, 844, 2)
      for (const [label, url] of [['操作手册', '/manual/'], ['脚本语法说明', '/syntax/']]) {
        mark = noteEvents()
        await c.send('Page.navigate', { url: `${origin}${url}` })
        await sleep(1400)
        // 注意：`html` 上有 `scroll-behavior: smooth` ⇒ 必须显式 instant，否则量到的是动画中间态
        await evalJs(c, `window.scrollTo({ top: 1500, behavior: 'instant' })`)
        await sleep(400)
        const scrolled = await evalJs(
          c,
          `(() => {
            const tb = document.querySelector('.doc-topbar')
            return {
              y: Math.round(window.scrollY),
              top: tb ? Math.round(tb.getBoundingClientRect().top) : null,
              btnVisible: !!document.getElementById('toc-toggle'),
            }
          })()`,
        )
        check(`窄屏 ${label}：页眉仍吸顶（滚到 ${scrolled?.y ?? 0}px、top=${scrolled?.top ?? 'n/a'}），且「目录」按钮在手边`,
          !!scrolled && scrolled.y > 0 && scrolled.top === 0 && scrolled.btnVisible, JSON.stringify(scrolled))
        const opened = await evalJs(
          c,
          `(() => {
            const btn = document.getElementById('toc-toggle')
            const toc = document.getElementById('doc-toc')
            if (!btn || !toc) return null
            btn.click()
            const r = toc.getBoundingClientRect()
            return {
              open: toc.classList.contains('open'),
              pos: getComputedStyle(toc).position,
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              vh: window.innerHeight,
              inView: r.bottom > 0 && r.top < window.innerHeight,
              links: toc.querySelectorAll('a').length,
            }
          })()`,
        )
        check(`窄屏 ${label}：滚到中部点「目录」⇒ 面板出现在**视口内**（修前它开在文档顶部，看着像点不动）`,
          !!opened && opened.open && opened.inView && opened.links > 0,
          JSON.stringify(opened))
        const tapped = await evalJs(
          c,
          `(() => {
            const a = document.querySelectorAll('#doc-toc a.toc-item')[2]
            if (!a) return null
            const href = a.getAttribute('href')
            a.click()
            return href
          })()`,
        )
        await sleep(1000)
        const afterTap = await evalJs(
          c,
          `(() => {
            const toc = document.getElementById('doc-toc')
            const id = decodeURIComponent(location.hash.slice(1))
            const el = document.getElementById(id)
            return {
              id,
              open: toc ? toc.classList.contains('open') : false,
              y: Math.round(window.scrollY),
              top: el ? Math.round(el.getBoundingClientRect().top) : null,
            }
          })()`,
        )
        check(`窄屏 ${label}：点面板里的条目会跳过去、并且面板自动收起`,
          !!tapped && afterTap.id === tapped.slice(1) && afterTap.y > 0 && !afterTap.open,
          `${tapped} → ${JSON.stringify(afterTap)}`)
        const narrowErrs = collectErrors(mark)
        check(`窄屏 ${label}：无控制台错误 / 无本站 4xx`, narrowErrs.length === 0, narrowErrs.slice(0, 3).join(' | '))
      }
      await viewport(1440, 900, 1)

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
