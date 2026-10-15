/**
 * verify-app-ui.mjs — **应用内 UI 的真浏览器实测**（`adj959` 起）
 *
 * ## 为什么要有这个脚本（而不是只写源码级断言）
 *
 * `adj959`（**用户实报**「手册的目录打开后，点击其它地方，菜单不会隐藏」）暴露了一类
 * **源码级断言守不住**的缺陷："**事件挂错了地方**" ——
 *   · 代码里**确实**挂了监听、`tsc` / `lint` / `smoke` 全绿，但那个监听**收不到事件**：
 *     ① 挂在冒泡阶段 `document` 上的"点外面就关"，被 `ui/Modal.tsx` 给 `.modal` 挂的
 *        `onClick={(e) => e.stopPropagation()}` 掐断（React 的 `stopPropagation()` 会连带调用原生那次）；
 *     ② 挂在 `.doc-content` 上的事件委托收不到目录浮层的点击（浮层是它的**兄弟节点**）。
 *   · 源码级判据只能钉住"结构长什么样"（捕获阶段 / 处理器挂在 `<nav>` 上），**钉不住"点得动"**。
 * ⇒ 所以留一个**真点**的脚本。冒烟（`npm run smoke`）刻意**不含**它：那是 Node 纯逻辑套件，
 *   不该依赖 Chrome；这里与 `npm run verify:site`（官网）并列，按需 / 发布前跑。
 *
 * ## 前置
 *
 * 必须先有**当前源码构建出来的** `dist/`：`npm run build`（或至少 `npx vite build`）。
 * 脚本只**读** `dist/`、只**写**临时 user-data-dir（跑完删掉），不碰仓库。
 *
 * ## 判据为什么这么写
 *
 * · **点浮层自己的标题行 ⇒ 不许关**：这条是"负向判据"——只测"点别处能关"的话，把实现写成
 *   "任何点击都关"也能过，而那会把浮层变成一点就消失的废按钮。
 * · **点条目要真的滚动**：只看"浮层关掉了"不够（关掉可能是别的原因）；这里比对跳转前后的
 *   `scrollTop`，要求**明显变大**（实测 0 → 11500）⇒ 证明确实跳到了后面某一节。
 * · 每一条都对应 `adj959` 的一个真实症状，改坏任何一条都会当场判红。
 *
 * ## 复现反证（脚本外的手工操作，写在这里备查）
 *
 * 把 `src/dialogs/DocDialog.tsx` 里那两处 `, true)` 去掉（＝退回冒泡阶段）→ `npx vite build` → 再跑本脚本
 * ⇒ 「点正文里的一段文字 ⇒ 目录浮层收起」**判红**（这正是用户实报的现象），加回 `true` 即全绿。
 * 本轮就是这么确认根因的。
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

/** 只列 `dist/` 里真会出现的扩展名（少了哪个，那个资源就是 404、页面会静默缺东西） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.jps': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.sf2': 'application/octet-stream',
}

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
let passed = 0
function check(label, ok, extra = '') {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
}

/** `dist/` 里按 URL 找文件；目录（`/app/`）回退 `index.html`。越界/不存在一律 null（由调用方 404） */
function resolveDistFile(urlPath) {
  let rel = urlPath.split('?')[0]
  if (rel === '/' || rel.endsWith('/')) rel += 'index.html'
  const abs = path.join(DIST, decodeURIComponent(rel).replace(/^\//, ''))
  if (!abs.startsWith(DIST) || !existsSync(abs) || !statSync(abs).isFile()) return null
  return abs
}

// ---- 极简 CDP over WebSocket（Node 22 内置 WebSocket）—— 与 verify-site.mjs / embed-smoke.mjs 同一套 ----
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
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
    }
  })
  return {
    ready,
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

/** 轮询等条件成立；超时抛错（比"睡固定时间"稳：慢机器上不会假红） */
async function waitFor(c, expression, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(c, expression)) return true
    await sleep(150)
  }
  throw new Error(`等待超时：${label}`)
}

/** 打开应用内手册对话框（走真实的「菜单 → 帮助 → 命令行手册」，不绕过 UI 直接调 store） */
async function openCliManualDialog(c) {
  await waitFor(c, `!!document.querySelector('.topbar-hamburger-btn')`, '应用首屏（顶栏菜单按钮）')
  await evalJs(c, `document.querySelector('.topbar-hamburger-btn').click(), true`)
  // ⚠ 菜单项是 `div.menu-entry`（不是 `button`，见 TopBar 的 MenuPanel）
  await waitFor(
    c,
    `[...document.querySelectorAll('.menu-entry')].some((el) => el.textContent.includes('命令行手册'))`,
    '菜单里有「命令行手册」',
  )
  await evalJs(
    c,
    `[...document.querySelectorAll('.menu-entry')].find((el) => el.textContent.includes('命令行手册')).click(), true`,
  )
  await waitFor(c, `!!document.querySelector('.doc-toc-toggle')`, '帮助对话框 + 目录按钮')
}

async function main() {
  if (!existsSync(DIST) || !existsSync(path.join(DIST, 'app', 'index.html'))) {
    console.error(`[verify-app-ui] 找不到 ${path.join(DIST, 'app', 'index.html')} —— 先跑 npm run build`)
    process.exit(2)
  }
  const chrome = CHROME_CANDIDATES.find((p) => p !== '' && existsSync(p))
  if (!chrome) {
    console.error('[verify-app-ui] 找不到 Chrome（本脚本只走真浏览器，不替代 smoke）')
    process.exit(2)
  }

  const server = createServer((req, res) => {
    const file = resolveDistFile(String(req.url ?? '/'))
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

  const profile = path.join(tmpdir(), `ijipu-app-ui-${Date.now()}`)
  const debugPort = 9600 + Math.floor(Math.random() * 300)
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

  try {
    let target = null
    for (let i = 0; i < 40 && target === null; i++) {
      await sleep(250)
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
        target = list.find((t) => t.type === 'page') ?? null
      } catch {
        /* 调试端口还没起来 */
      }
    }
    if (target === null) throw new Error('连不上 Chrome 调试端口')

    const c = cdp(target.webSocketDebuggerUrl)
    await c.ready
    await c.send('Page.enable')
    await c.send('Runtime.enable')
    await c.send('Page.navigate', { url: `${origin}/app/` })

    console.log('[verify-app-ui] adj959：应用内手册的「目录」浮层（真点）')

    // ---- ① 从真实入口打开对话框 ----
    await openCliManualDialog(c)
    check('顶栏「菜单 → 帮助 → 命令行手册」能打开应用内手册对话框', true)
    const scrollable = await evalJs(
      c,
      `(() => { const el = document.querySelector('.doc-content'); return el ? el.scrollHeight > el.clientHeight + 50 : false })()`,
    )
    check('手册正文确实是一份长文档（内容可滚动）', scrollable === true)

    // ---- ② 「目录」按钮弹出浮层，且条目来自正文标题 ----
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await waitFor(c, `!!document.querySelector('.doc-toc-pop')`, '目录浮层出现')
    const itemCount = await evalJs(c, `document.querySelectorAll('.doc-toc-pop a').length`)
    check('点「目录」按钮弹出浮层，且里面有可点条目', itemCount > 0, `条目 ${itemCount} 条`)

    // ---- ③ **用户实报的那条**：点正文里的一段文字 ⇒ 收起 ----
    //      （修复前这里是红的：冒泡阶段的监听被 Modal 的 stopPropagation 掐断）
    await evalJs(c, `document.querySelector('.doc-content p').click(), true`)
    await sleep(250)
    check(
      '点正文里的一段文字 ⇒ 目录浮层收起（**用户实报的那条**）',
      (await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)) === false,
    )

    // ---- ④ 点正文容器本身 ⇒ 收起 ----
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await waitFor(c, `!!document.querySelector('.doc-toc-pop')`, '浮层再次出现')
    await evalJs(c, `document.querySelector('.doc-content').click(), true`)
    await sleep(250)
    check('点正文容器本身 ⇒ 目录浮层收起', (await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)) === false)

    // ---- ⑤ 点对话框内的空白（`.modal-body` 的 padding 区）⇒ 收起 ----
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await waitFor(c, `!!document.querySelector('.doc-toc-pop')`, '浮层第三次出现')
    await evalJs(c, `document.querySelector('.modal-body').click(), true`)
    await sleep(250)
    check('点对话框内的空白处 ⇒ 目录浮层收起', (await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)) === false)

    // ---- ⑥ 负向判据：点浮层**自己** ⇒ 不许关（否则浮层是一点就没的废按钮）----
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await waitFor(c, `!!document.querySelector('.doc-toc-pop')`, '浮层第四次出现')
    await evalJs(c, `document.querySelector('.doc-toc-pop-title').click(), true`)
    await sleep(250)
    check(
      '点浮层自己的标题行 ⇒ **不**收起（不能误关）',
      (await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)) === true,
    )

    // ---- ⑦ **查③时发现的第二个 bug**：点条目要真的跳（比对 scrollTop）+ 收起 ----
    const before = await evalJs(c, `document.querySelector('.doc-content').scrollTop`)
    const clicked = await evalJs(
      c,
      `(() => {
         const items = [...document.querySelectorAll('.doc-toc-pop a.doc-toc-item')]
         const el = items[items.length - 1]
         if (!el) return 'no-item'
         el.scrollIntoView()   // 先滚进浮层的可视区，再点（模拟真人）
         el.click()
         return 'clicked'
       })()`,
    )
    await sleep(400)
    const after = await evalJs(c, `document.querySelector('.doc-content').scrollTop`)
    const stillOpen = await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)
    check(
      '点最后一节目录条目 ⇒ 正文**真的滚动**且浮层收起（**查③时发现的第二个 bug**）',
      clicked === 'clicked' && after > before + 100 && stillOpen === false,
      `跳前 scrollTop=${before} 跳后=${after} 浮层还在=${stillOpen}`,
    )

    // ---- ⑧ 再点一次「目录」按钮 ⇒ 收起（按钮在豁免名单里，不会被"点别处"逻辑抢跑）----
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await waitFor(c, `!!document.querySelector('.doc-toc-pop')`, '浮层第五次出现')
    await evalJs(c, `document.querySelector('.doc-toc-toggle').click(), true`)
    await sleep(250)
    check(
      '再点一次「目录」按钮 ⇒ 收起（按钮本身在豁免名单里）',
      (await evalJs(c, `!!document.querySelector('.doc-toc-pop')`)) === false,
    )

    // ================= adj963：新建/保存的入口与行为（用户要求） =================
    await evalJs(c, `document.querySelector('.modal-close').click(), true`)
    await sleep(250)
    check(
      '关掉帮助对话框后回到编辑器（后面的用例要在编辑器上做）',
      (await evalJs(c, `!!document.querySelector('.editor-main textarea')`)) === true,
    )

    // ---- ⑨ 窄屏菜单**常驻**「新建 / 保存 / 另存为」----
    //   来源：用户实报"菜单里没有新建和保存了" —— 窄屏分支（adj540）曾把这三项收进工作区面板，
    //   而嵌入版又隐藏了「工作区」项 ⇒ 窄的插件面板里一个文件操作入口都没有。
    //   这里把视口调窄（`isNarrow` 由视口宽度驱动）再打开菜单，**真看**这三个词在不在。
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 420,
      height: 820,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await sleep(500)
    await evalJs(c, `document.querySelector('.topbar-hamburger-btn').click(), true`)
    await waitFor(c, `!!document.querySelector('.topbar-hamburger.open .menu-dropdown')`, '窄屏菜单打开')
    const narrowLabels = await evalJs(
      c,
      `[...document.querySelectorAll('.topbar-hamburger.open .menu-entry')].map((el) => el.textContent.trim())`,
    )
    check(
      '窄屏菜单里有「新建 / 保存 / 另存为」（**用户要求恢复**；adj540 曾把三项收进工作区面板）',
      narrowLabels.some((l) => l.startsWith('新建')) &&
        narrowLabels.some((l) => l.startsWith('保存')) &&
        narrowLabels.some((l) => l.startsWith('另存为')),
      narrowLabels.slice(0, 4).join(' ／ '),
    )

    // ---- ⑩ 有未保存修改时点「新建」⇒ 先问一句；确认后才真的新建 ----
    //   为什么要这条：`newDoc()` 会直接换掉草稿槽（原文件不动，但当前的未保存编辑就此消失）⇒
    //   没有这一问，"点错一下"就等于丢内容（E-2026-310 同族）。
    await evalJs(c, `document.querySelector('.topbar-hamburger-btn').click(), true`) // 先收起菜单
    await sleep(150)
    await evalJs(c, `document.querySelector('.editor-main textarea').focus(), true`)
    await c.send('Input.insertText', { text: '\nQ: 5 6 7 1 |' }) // 真打字 ⇒ 走 React 的 onChange
    await sleep(300)
    const dirtyShown = await evalJs(c, `!!document.querySelector('.dirty-dot')`)
    check('在编辑器里真打字之后出现未保存标记（`.dirty-dot`）', dirtyShown === true)
    const beforeNew = await evalJs(c, `document.querySelector('.editor-main textarea').value`)

    await evalJs(c, `document.querySelector('.topbar-hamburger-btn').click(), true`)
    await waitFor(c, `!!document.querySelector('.topbar-hamburger.open .menu-dropdown')`, '菜单再开（准备点新建）')
    await evalJs(
      c,
      `[...document.querySelectorAll('.topbar-hamburger.open .menu-entry')].find((el) => el.textContent.includes('新建')).click(), true`,
    )
    await waitFor(c, `!!document.querySelector('.confirm-bar')`, '确认条出现')
    const askText = String(await evalJs(c, `document.querySelector('.confirm-bar-text').textContent`))
    const afterAsk = await evalJs(c, `document.querySelector('.editor-main textarea').value`)
    check(
      '有未保存修改时点「新建」⇒ 出现确认条，且**此时还没有**真的新建（内容原封不动）',
      askText.includes('未保存') && afterAsk === beforeNew,
      askText.slice(0, 28),
    )

    await evalJs(c, `document.querySelector('.confirm-bar-btn.is-primary').click(), true`)
    await sleep(400)
    const afterOk = await evalJs(c, `document.querySelector('.editor-main textarea').value`)
    const footText = String(await evalJs(c, `document.querySelector('.footer-file')?.textContent ?? ''`))
    check(
      '确认后真的新建：内容换成未命名模板、状态栏回到「未命名」、未保存标记消失（新文档＝缓存里的无主之物）',
      afterOk !== beforeNew &&
        afterOk.includes('B: 未命名') &&
        footText.includes('未命名') &&
        (await evalJs(c, `!!document.querySelector('.dirty-dot')`)) === false,
      `${footText.trim()} ／ 首行 ${afterOk.split('\n')[0]}`,
    )

    // ============ adj965：水印设置 → 预览 → 写进谱面（端到端真点） ============
    //   这条覆盖的是"设置界面 → 引擎渲染 → 差量写盘"整整一条链，只靠源码级闸门是证明不了的：
    //   源码级只能证明"有那一行"，证明不了"点了真的出层、保存真的落键"。
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const dockBtn = await evalJs(
      c,
      `(() => {
         const b = [...document.querySelectorAll('.topbar-btn')].find((el) => (el.getAttribute('title') || '').includes('谱面'))
         if (!b) return 'no-btn'
         b.click()
         return 'ok'
       })()`,
    )
    check('顶栏能找到「谱面设置」按钮并点开', dockBtn === 'ok')
    await waitFor(c, `!!document.querySelector('.pcfg-root')`, '谱面设置面板出现')
    await waitFor(
      c,
      `[...document.querySelectorAll('.jp-tab')].some((t) => t.textContent.includes('水印'))`,
      '「水印」子页签出现',
    )
    await evalJs(
      c,
      `[...document.querySelectorAll('.jp-tab')].find((t) => t.textContent.includes('水印')).click(), true`,
    )
    await waitFor(c, `!!document.querySelector('.pcfg-text')`, '水印页签内容出现（路径/文本输入框）')

    // 真打字：聚焦水印文本输入框后走 CDP 输入（React 的 onChange 才会触发）
    await evalJs(c, `document.querySelector('.pcfg-text').focus(), true`)
    await c.send('Input.insertText', { text: '内部草稿' })
    await sleep(400)
    const wmInPreview = await evalJs(c, `!!document.querySelector('.score-page svg [data-overlay="wm"]')`)
    const wmText = await evalJs(
      c,
      `document.querySelector('.score-page svg [data-overlay="wm"] tspan')?.textContent ?? ''`,
    )
    check(
      '在「水印」页签里打字 ⇒ **预览里真的出现了水印层**（且文字对得上）',
      wmInPreview === true && wmText === '内部草稿',
      `tspan="${wmText}"`,
    )

    // 保存设置 ⇒ 真的差量写进 # jps-config（只该出现 wmText 这一项）
    await evalJs(
      c,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存设置').click(), true`,
    )
    await sleep(500)
    const codeNow = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
    const cfgLine = (codeNow.match(/# jps-config:(.*)/) ?? [])[1] ?? ''
    const cfgKeys = Object.keys(JSON.parse(cfgLine || '{}'))
    check(
      '点「保存设置」⇒ 真的写进 `# jps-config`，且**只写这一项**（差量写入：15 个新字段里只有 wmText 落键）',
      cfgKeys.length === 1 && cfgKeys[0] === 'wmText',
      cfgLine,
    )

    c.close()
  } catch (e) {
    check(`脚本自身出错：${e instanceof Error ? e.message : String(e)}`, false)
  }

  console.log('')
  console.log(failed === 0 ? `[verify-app-ui] 全部通过 ✅（${passed} 项）` : `[verify-app-ui] 失败 ${failed} 项 ❌`)
  await cleanup(failed === 0 ? 0 : 1)
}

void main()
