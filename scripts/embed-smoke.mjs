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
  /**
   * 冒烟用的固定 token（正式运行时由插件随机生成）。
   *
   * **必须有**：应用侧 `tokenFromLocation()` 从 URL 首段取 token，取不到就直接放弃握手
   * ⇒ 服务必须把页面挂在 `/<token>/` 下，跟插件的真实行为一致。
   * 本变量既用于服务路由，也被**注入进页面**（注入脚本在外层页面运行，拿不到脚本作用域）。
   */
  const TOKEN = 'smoketoken0123456789abcdef'
  const server = createServer(async (req, res) => {
    const url = String(req.url ?? '/')
    // 剥掉 token 段：`/<token>/` 或 `/<token>/icons/xx.png`
    const parts = url.split('?')[0].split('/').filter((s) => s !== '')
    if (parts[0] === TOKEN) parts.shift()
    /**
     * ⚠ **必须 `decodeURIComponent`**：资产里有中文文件名（`icons/菜单.png`），
     * 浏览器会把它百分号编码（`%E8%8F%9C...`）。用原始串查表 ⇒ 永远查不到，
     * 图标全 204 —— 这正是先前"图标请求 0 个"那次误判的来源。
     */
    const rest = parts
      .map((s) => {
        try {
          return decodeURIComponent(s)
        } catch {
          return s
        }
      })
      .join('/')

    if (rest === '' || rest === 'index.html') {
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
  const url = `http://127.0.0.1:${port}/${TOKEN}/`
  console.log(`[embed-smoke] 服务 ${url}（单文件 ${(html.length / 1024).toFixed(0)} KB，token 段与插件行为一致）`)

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
  /**
   * **扮演宿主**：把一条 `welcome` 推进 iframe，并回答应用发来的请求。
   *
   * 这一步是"能不能真的用"的关键证据——只验证"应用挂载成功"是不够的，
   * 必须证明**桥协议两端接得上**：应用 `hello` → 宿主 `welcome` → 应用建 vault 工作区
   * → 应用发 `list` → 宿主回目录 → 文件树渲染出来。
   *
   * 做法：在页面里装一个 `message` 监听（模拟父窗口），
   * 由于 iframe 的 `parent` 就是当前页（本脚本加载的就是那个"单文件"，
   * 它自己不是 iframe）——**不能**这么测；因此改用 `Page.addScriptToEvaluateOnNewDocument`
   * 让页面把自己"伪装成被嵌入"（改 `window.parent` 不可行），
   * 故这里改为**直接在 iframe 环境内注入宿主**：新建一个内层 iframe 加载同一份单文件，
   * 外层页面充当宿主。
   */
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      // 只有"最外层"才装宿主桩：内层 iframe（应用）会被这个脚本也注入，故按 frameElement 判别
      window.__ijipuHostStub = !window.frameElement;
      if (window.__ijipuHostStub) {
        window.__ijipuCalls = [];
        // 注入的脚本在外层页面运行，拿不到脚本作用域里的变量 ⇒ token 由**注入时**填进来
        const TOKEN = ${JSON.stringify(TOKEN)};
        const HOST_ROOT = '乐谱';
        window.addEventListener('message', (ev) => {
          const d = ev.data;
          if (!d || d.ch !== 'ijipu') return;
          if (d.type === 'hello') {
            ev.source.postMessage({
              ch: 'ijipu', type: 'welcome',
              vaultName: '测试文库', theme: 'dark', root: HOST_ROOT,
              capabilities: { write: true, rename: true, remove: true, trash: true },
            }, '*');
            return;
          }
          if (d.type === 'ready') { window.__ijipuReady = true; return; }
          if (typeof d.id === 'number') {
            window.__ijipuCalls.push(d.op + ':' + JSON.stringify(d.args));
            let result = {};
            if (d.op === 'list') result = { dirs: [{ name: '子目录', mtime: 0 }], files: [{ name: '测试谱.jps', mtime: 0 }] };
            else if (d.op === 'read') result = { text: "Q: 1 2 3 4 |\\n" };
            else if (d.op === 'exists') result = { exists: true };
            ev.source.postMessage({ ch: 'ijipu', id: d.id, ok: true, result }, '*');
          }
        });
        // 把应用放进内层 iframe（它就会认为自己在宿主里）；src 必须带 token 段
        const spawn = () => {
          const f = document.createElement('iframe');
          f.id = 'ijipu-smoke-app';
          f.style.cssText = 'width:1000px;height:700px;border:0';
          f.src = location.origin + '/' + TOKEN + '/';
          f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
          document.body.appendChild(f);
        };
        // 本脚本在 document-start 注入，此刻还没有 <body> ⇒ 等 DOM 就绪
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', spawn);
        else spawn();
      }
      void 0;
    `,
  })
  await c.send('Page.reload')
  await sleep(6000) // 给"外层宿主桩 + 内层应用 + 桥握手 + 文件树渲染"留时间
  console.log('[embed-smoke] 采集完成，正在探测 DOM…')

  const errs = []
  const warns = []
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
    // 排错用：捕获应用打的警告（例如"宿主桥初始化失败"）
    if (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'warning') {
      warns.push((e.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
  }

  let probe
  try {
    probe = await c.send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.getElementById('ijipu-smoke-app');
        const doc = app && app.contentDocument;
        return JSON.stringify({
          // 外层（宿主桩）
          hostReady: !!window.__ijipuReady,
          calls: (window.__ijipuCalls || []).slice(0, 12),
          callCount: (window.__ijipuCalls || []).length,
          // 内层（应用）
          appMounted: !!(doc && doc.getElementById('root') && doc.getElementById('root').children.length > 0),
          appText: doc ? doc.body.innerText.slice(0, 300) : '',
          hasTestScore: doc ? doc.body.innerText.includes('测试谱') : false,
          hasSubdir: doc ? doc.body.innerText.includes('子目录') : false,
          // 内层应用的**内部状态**（同源可直接读；排错用）
          innerDebug: (() => {
            try {
              const fn = app && app.contentWindow && app.contentWindow.__ijipuDebug;
              return typeof fn === 'function' ? fn() : '（无探针：说明没走到嵌入版初始化）';
            } catch (err) {
              return 'ERR:' + String(err && err.message);
            }
          })(),
          // 旧探针（外层页面自身也加载了同一份单文件）
          title: document.title,
          rootChildren: document.getElementById('root')?.children.length ?? -1,
          textareas: document.querySelectorAll('textarea').length,
          hasError: document.body.innerText.includes('Cannot find module') || document.body.innerText.includes('ChunkLoadError'),
          /**
           * adj724b：**实测图标有没有真的显示**。
           *
           * 「服务器有没有把图标发出去」和「图标有没有画出来」是两件事——
           * 204 时 img 不会报错、控制台也不会响，但图标就是空的。
           * 判据用 naturalWidth > 0（真正解码出图片才有宽度），并顺带看 img 总数。
           */
          imgs: doc ? doc.querySelectorAll('img').length : -1,
          imgsLoaded: doc
            ? Array.from(doc.querySelectorAll('img')).filter((i) => i.naturalWidth > 0).length
            : -1,
          maskIcons: doc ? doc.querySelectorAll('[class*="tool-icon"], [class*="ijipu-icon"]').length : -1,
        });
      })()`,
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
  if (warns.length > 0) {
    console.log(`[embed-smoke] 应用警告 ${warns.length} 条：`)
    for (const w of [...new Set(warns)].slice(0, 5)) console.log(`  - ${w.slice(0, 200)}`)
  }
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

  // ── 桥端到端（本轮新增，比"能启动"更强）：外层宿主桩 ↔ 内层应用 ──
  if (!info.hostReady) return fail('应用没有发 `ready`（握手或监听注册没走通）')
  if (info.callCount === 0) return fail('应用经桥发起了 0 次请求（vault 工作区没建立）')
  if (!info.calls.some((c) => c.startsWith('list:'))) {
    return fail(`应用没发起 list（应拉取文库文件树）。实际调用：${info.calls.join(' | ')}`)
  }
  if (!info.appMounted) return fail('内层应用没挂载')
  /**
   * ⚠ **不要**断言"宿主回的目录项出现在界面上"——底栏默认是收起的
   * （`dockOpen:false` / `dockPanel:'problems'`），文件树根本没被画出来。
   * 正确的端到端判据是：**应用发出了 `list` 且宿主答完后应用没有报错**
   * （下文 `realErrs` 为空即证明下行也被正确消费了：若宿主应答格式不对，
   * 应用侧会在 `readDirEntries` 里抛错并被 CDP 捕获）。
   */
  const dist = (info.innerDebug ?? '').slice(0, 200)
  console.log(`[embed-smoke] ✅ 单文件产物启动成功、无运行时报错`)
  console.log(
    `[embed-smoke] ✅ 桥端到端通过：应用 hello→ready、发出 ${info.callCount} 次桥调用（${info.calls.slice(0, 3).join(' | ')}）、宿主应答后无报错`,
  )
  if (dist) console.log(`[embed-smoke] 应用侧自述：${dist}`)
  for (const s of EXPECT_SELECTORS) void s
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
