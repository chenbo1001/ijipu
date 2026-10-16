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
 *
 * ## adj965d（EP-13）那一段：预览区调水印/背景的 Alt 手势
 *
 * 同一类"源码级断言守不住"的缺陷，而且更隐蔽：`wheel` 监听**挂错容器 / 挂成被动监听**时，
 * 代码看着全对、`tsc`/`lint`/`smoke` 全绿，但用户按下去要么没反应、要么页面跟着滚。
 * 所以这一段一律走 CDP 的 `Input.dispatchMouseEvent`（**浏览器原生输入路径**，
 * `modifiers` 位掩码：Alt=1、Ctrl=2、Shift=8），并**双向**判：
 *   · 正向：`Alt+滚轮` / `Alt+Shift+滚轮` / `Alt+拖动` ⇒ 预览产物**与** `# jps-config` **都真的变了**；
 *   · 负向：关掉「排版辅助」后按 Alt ⇒ 一个字都不许变（前提①）；
 *   · 回归：`Ctrl+单击音符` 仍能从这里试听（不能被同区域的新手势抢走）。
 *
 * ## adj966f 那一段：两边都改了 ⇒ 逐块采纳 / 自动三路合并（`docs/FILE-MODEL.md` §9）
 *
 * 同一类问题的第三次应用：差异框里「用左 / 用右」按钮、底部「应用（并保存）」是否**真的生效**
 * （点了有没有反应、结果有没有写回文件、提示条有没有收口），源码级断言一个都证明不了。
 * 做法：`Page.addScriptToEvaluateOnNewDocument` 注入一个**假 FSA 句柄**
 * （`showOpenFilePicker` + `getFile` / `createWritable`）⇒ 应用走正常的"网页版 FSA 档"，
 * 打开 = 真句柄、监视 = 真轮询（4 秒一跳）；"外部改动"= 直接改那个假文件的内容与 mtime。
 * 两个场景：① 两边改**不同块** ⇒ 确认条应说"已自动合好…互不重叠"并给「应用」，点完**假文件里真出现合并结果**；
 * ② 两边改**同一块** ⇒ 确认条应走"要你决定"、差异框里标"冲突"，选「用右」+ 应用后**外部那一版进文件、本地那版被换掉**。
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
    await waitFor(c, `!!document.querySelector('.pcfg-text')`, '水印页签内容出现（文本/路径输入框）')

    // 先勾「启用水印」——adj965c 起两个总开关**默认关**（用户裁定），不勾就不会画
    await evalJs(
      c,
      `(() => {
         const box = [...document.querySelectorAll('.pcfg-check input[type=checkbox]')][0]
         box.click()
         return box.checked
       })()`,
    )
    await sleep(250)

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
      '在「水印」页签里勾「启用水印」并打字 ⇒ **预览里真的出现了水印层**（且文字对得上）',
      wmInPreview === true && wmText === '内部草稿',
      `tspan="${wmText}"`,
    )

    // 保存设置 ⇒ 真的差量写进 # jps-config（默认关的开关必须落键，否则换台机器打开就又不显示了）
    await evalJs(
      c,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存设置').click(), true`,
    )
    await sleep(500)
    const codeNow = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
    const cfgLine = (codeNow.match(/# jps-config:(.*)/) ?? [])[1] ?? ''
    const cfgKeys = Object.keys(JSON.parse(cfgLine || '{}')).sort()
    check(
      '点「保存设置」⇒ 真的写进 `# jps-config`，且**只写改过的那两项**（启用开关 + 文本）',
      cfgKeys.length === 2 && cfgKeys[0] === 'wmEnabled' && cfgKeys[1] === 'wmText',
      cfgLine,
    )

    // ---- ⑫ adj965：图片路径解析不了时**就地提示**（方案优化 7：绝不静默少画一层）----
    //   本用例里的文档是"未命名模板"（既没绑定工作区、也没有 nativePath）⇒ 相对路径必然解析不了，
    //   而**恰好**能验证"解析失败要说话"这一条 —— 这正是最容易做错的地方：
    //   悄悄不画，用户只会以为"设置了没用"。
    //   走「背景」页签（只填一个路径框即可触发解析），不必去动下拉框。
    //   ⚠ 上一步「保存设置」会**收起底栏** ⇒ 这里必须重新打开面板，否则 `.jp-tab` 已经不在 DOM 里。
    await evalJs(
      c,
      `[...document.querySelectorAll('.topbar-btn')].find((el) => (el.getAttribute('title') || '').includes('谱面')).click(), true`,
    )
    await waitFor(c, `!!document.querySelector('.pcfg-root')`, '谱面设置面板重新出现')
    await waitFor(
      c,
      `[...document.querySelectorAll('.jp-tab')].some((t) => t.textContent.includes('背景'))`,
      '「背景」子页签出现',
    )
    await evalJs(c, `[...document.querySelectorAll('.jp-tab')].find((t) => t.textContent.includes('背景')).click(), true`)
    await waitFor(c, `!!document.querySelector('.pcfg-text')`, '背景页签内容出现')
    // ⚠ 「启用背景」默认关（用户裁定）⇒ 关着时**连解析都不做**（不产生噪音提示），
    //   所以要先勾上，才谈得上"填了路径但解析不了"这个被测场景
    await evalJs(
      c,
      `(() => {
         const box = [...document.querySelectorAll('.pcfg-check input[type=checkbox]')][0]
         box.click()
         return box.checked
       })()`,
    )
    await sleep(250)
    await evalJs(c, `document.querySelector('.pcfg-text').focus(), true`)
    await c.send('Input.insertText', { text: '图.png' })
    await sleep(800)
    const errText = String(await evalJs(c, `document.querySelector('.pcfg-asset-err')?.textContent ?? ''`))
    check(
      '图片路径解析不了时**就地提示**（不静默少画一层）',
      errText.includes('尚未保存') || errText.includes('不支持读取图片'),
      errText.trim().slice(0, 40),
    )

    // ============ adj965d（EP-13）：预览区调「水印 / 背景」的 Alt 手势（**真派发鼠标事件**）============
    //   为什么必须真派发：`adj959` 的教训 —— "代码里挂了监听"与"事件真收得到"是两件事
    //   （监听挂错层、被 `stopPropagation` 掐断、wheel 挂成被动监听…源码级断言全都看不见）。
    //   这里走 CDP 的 `Input.dispatchMouseEvent`（浏览器原生输入路径），不是 `dispatchEvent(new Event(...))`。
    //
    //   本用例开工时的状态（承接上面 ⑫）：水印 = 已启用 + 文本「内部草稿」（已落盘）；
    //   背景 = 草稿里勾了启用 + 填了 `图.png`（未落盘，解析不了但**配置上有内容**）
    //   ⇒ 三层前提齐、且**两层都可用** ⇒ 角落应当出现「调整对象」切换器。
    await sleep(400)
    check(
      'adj965d 两层都可用 ⇒ 预览角落出现「调整对象」切换器（水印 / 背景）',
      (await evalJs(c, `!!document.querySelector('.preview-overlay-hint .poh-chip')`)) === true,
    )
    check(
      'adj965d 切换器默认选中「背景」（两层都可用时，手势默认作用在背景层）',
      (await evalJs(c, `document.querySelector('.poh-chip.is-active')?.textContent ?? ''`)) === '背景',
    )
    check(
      'adj965d 角落提示确实落在**预览区**里（`position: sticky` 生效，矩形在 `.preview-pane` 范围内）',
      await evalJs(
        c,
        `(() => {
           const h = document.querySelector('.preview-overlay-hint')
           const p = document.querySelector('.preview-pane')
           if (!h || !p) return false
           const a = h.getBoundingClientRect(), b = p.getBoundingClientRect()
           return a.height > 0 && a.bottom <= b.bottom + 1 && a.right <= b.right + 1 && a.top >= b.top - 1
         })()`,
      ),
    )
    // 切到「水印」：文本水印**在预览里真的画着** ⇒ 后面的断言既看配置、也看产物
    await evalJs(c, `[...document.querySelectorAll('.poh-chip')].find((el) => el.textContent === '水印').click(), true`)
    await sleep(200)
    check(
      'adj965d 点「水印」⇒ 它成为当前调整对象（切换器是真的在切）',
      (await evalJs(c, `document.querySelector('.poh-chip.is-active')?.textContent ?? ''`)) === '水印',
    )
    /**
     * adj965d：**只读自检钩子**。三条前提不满足时"什么都不发生"是设计使然，
     * 而远程看不见用户机器上的实况（真机上已经踩过一次）⇒ 留一个一句话取证的入口
     * （同 `__ijipuPlayhead` 的套路）。这里真调一次，确认它报的就是"此刻调哪一层"。
     */
    const overlayDiag = String(
      await evalJs(c, `typeof window.__ijipuOverlay === 'function' ? window.__ijipuOverlay() : '（没有自检钩子）'`),
    )
    check(
      'adj965d 自检钩子 `__ijipuOverlay()` 一句话说清"此刻调的是哪一层 / 三条前提各是什么"',
      overlayDiag.includes('排版辅助（前提①）=是') &&
        overlayDiag.includes('当前调整对象=水印') &&
        overlayDiag.includes('配置行=# jps-config'),
      overlayDiag.split('\n')[1] ?? '',
    )

    /** 取一个"同时落在预览容器与第一页里"的屏幕坐标（真鼠标事件必须有坐标，且必须落在监听的那个容器内） */
    const pointInPage = async (xFrac = 0.5, yFrac = 0.35) =>
      await evalJs(
        c,
        `(() => {
           const pane = document.querySelector('.preview-pane')?.getBoundingClientRect()
           const page = document.querySelector('.score-page')?.getBoundingClientRect()
           if (!pane || !page) return null
           const l = Math.max(pane.left, page.left, 0), r = Math.min(pane.right, page.right, window.innerWidth)
           const t = Math.max(pane.top, page.top, 0), b = Math.min(pane.bottom, page.bottom, window.innerHeight)
           if (r - l < 8 || b - t < 8) return null
           return { x: Math.round(l + (r - l) * ${xFrac}), y: Math.round(t + (b - t) * ${yFrac}) }
         })()`,
      )
    /** 预览里文本水印的三个可观测量：字号 / 旋转 / 中心 x（平移就看 tspan 的 x） */
    const wmVisual = async () =>
      await evalJs(
        c,
        `(() => {
           const t = document.querySelector('.score-page svg [data-overlay="wm"] text')
           if (!t) return null
           const span = t.querySelector('tspan')
           return { font: t.getAttribute('font-size'), transform: t.getAttribute('transform'), x: span ? Number(span.getAttribute('x')) : null }
         })()`,
      )
    /** 谱面源码里的 `# jps-config`（手势落盘后看它） */
    const cfgNow = async () => {
      const src = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
      const line = (src.match(/# jps-config:(.*)/) ?? [])[1] ?? '{}'
      try {
        return JSON.parse(line)
      } catch {
        return {}
      }
    }
    /** 派发一次滚轮（`modifiers`：Alt=1、Ctrl=2、Shift=8，CDP 位掩码） */
    const wheel = (pt, deltaY, modifiers) =>
      c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY, modifiers })

    const pt = await pointInPage()
    check('adj965d 夹具自检：取到了"落在预览页内"的坐标（否则下面的真派发等于没发）', pt !== null, JSON.stringify(pt))

    // ---- ① `Alt+滚轮` ⇒ 缩放该层 ----
    const vis0 = await wmVisual()
    const cfg0 = await cfgNow()
    await wheel(pt, -120, 1)
    await sleep(700) // 手势停顿后自动落盘（实现里 OVERLAY_COMMIT_DELAY_MS = 400）
    const vis1 = await wmVisual()
    const cfg1 = await cfgNow()
    check(
      'adj965d **Alt+滚轮 ⇒ 缩放该层**：预览里的水印**真的变了**（文本水印缩的是字号）',
      vis0 !== null && vis1 !== null && Number(vis1.font) > Number(vis0.font),
      `字号 ${vis0?.font} → ${vis1?.font}`,
    )
    check(
      'adj965d 缩放**停顿后落盘**：`# jps-config` 里真的写进了 `wmSize`',
      cfg1.wmSize !== undefined && cfg1.wmSize !== cfg0.wmSize,
      `wmSize ${cfg0.wmSize ?? '（无）'} → ${cfg1.wmSize}`,
    )

    // ---- ② `Alt+Shift+滚轮` ⇒ 旋转该层 ----
    await wheel(pt, -120, 1 | 8)
    await sleep(700)
    const vis2 = await wmVisual()
    const cfg2 = await cfgNow()
    check(
      'adj965d **Alt+Shift+滚轮 ⇒ 旋转该层**：预览里的 `rotate(...)` 角度真的变了（绕元素自身中心由引擎保证）',
      vis2 !== null && /rotate\(/.test(String(vis2.transform)) && vis2.transform !== vis1?.transform,
      `${vis1?.transform ?? '（无）'} → ${vis2?.transform ?? '（无）'}`,
    )
    check(
      'adj965d 旋转停顿后落盘：`# jps-config` 里多了 `wmRotate`',
      cfg2.wmRotate !== undefined && cfg2.wmRotate !== cfg1.wmRotate,
      `wmRotate ${cfg1.wmRotate ?? '（无）'} → ${cfg2.wmRotate}`,
    )

    // ---- ②b 滚轮**累计**（用户 2026-10-15 确认）：不足一档不动，攒够一档才走一步 ----
    //   为什么必须真派发：这是"触控板一次滑动连跳好几档"的修法，纯逻辑断言只能证明函数，
    //   证明不了"事件接线里真的在累计"（余数没留 / 每事件都重置，都会在这里露出来）。
    const sizeBefore = (await cfgNow()).wmSize
    const stepOfSize = Math.max(1, Math.round(Number(sizeBefore) * 0.05))
    await wheel(pt, -50, 1)
    await sleep(700) // 停够时间：证明"不足一档 ⇒ 连落盘都不发生"（不是被吞掉后再补写）
    check(
      'adj965d 滚轮累计：**单次不足一档（50px）⇒ 配置一个字都没动**（余数留着，等下一次）',
      (await cfgNow()).wmSize === sizeBefore,
      `wmSize ${sizeBefore} → ${(await cfgNow()).wmSize}`,
    )
    await wheel(pt, -50, 1)
    await sleep(700)
    check(
      'adj965d 滚轮累计：**再补 50px（累计正好一档）⇒ 正好走一档**（余数没被丢掉）',
      (await cfgNow()).wmSize === Number(sizeBefore) + stepOfSize,
      `wmSize ${sizeBefore} → ${(await cfgNow()).wmSize}（应 +${stepOfSize}）`,
    )
    // 「preventDefault 真的生效」的真派发证据：Alt+滚轮**向下**滚三档，预览区不该跟着滚。
    // （挂成被动监听时 `preventDefault()` 被忽略 ⇒ 这里立刻变红；源码级闸门只是第二道保险。）
    // ⚠ 先把预览区滚回顶：否则"没滚"可能只是"本来就到底了"（空跑判真）。
    await evalJs(c, `(() => { const p = document.querySelector('.preview-pane'); p.scrollTop = 0; return true })()`)
    await sleep(150)
    const st0 = await evalJs(c, `document.querySelector('.preview-pane').scrollTop`)
    await wheel(pt, 300, 1)
    await sleep(700)
    const st1 = await evalJs(c, `document.querySelector('.preview-pane').scrollTop`)
    check(
      'adj965d Alt+滚轮**不会把预览区滚走**（`{ passive: false }` + preventDefault 真的生效）',
      st0 === 0 && st1 === 0,
      `预览区 scrollTop ${st0} → ${st1}（起始必须是 0，否则那条判据是空跑）`,
    )

    // ---- ③ `Alt+左键拖动` ⇒ 平移该层（按下 → 两次移动 → 松手，全走原生输入）----
    const vis3 = await wmVisual()
    const drag0 = await pointInPage(0.4, 0.4)
    const dragSteps = [
      [40, 26],
      [80, 52],
    ]
    await c.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: drag0.x,
      y: drag0.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: 1,
    })
    for (const [dx, dy] of dragSteps) {
      await c.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: drag0.x + dx,
        y: drag0.y + dy,
        button: 'left',
        buttons: 1,
        modifiers: 1,
      })
    }
    const [lastDx, lastDy] = dragSteps[dragSteps.length - 1]
    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: drag0.x + lastDx,
      y: drag0.y + lastDy,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers: 1,
    })
    await sleep(500)
    const vis4 = await wmVisual()
    const cfg4 = await cfgNow()
    check(
      'adj965d **Alt+左键拖动 ⇒ 平移该层**：预览里水印中心真的往右下挪了（tspan 的 x 变大）',
      vis3 !== null && vis4 !== null && Number(vis4.x) > Number(vis3.x),
      `水印中心 x ${vis3?.x} → ${vis4?.x}`,
    )
    check(
      'adj965d 拖动**松手即落盘**：`# jps-config` 里多了 `wmOffsetX` / `wmOffsetY`（且都是整数）',
      Number.isInteger(cfg4.wmOffsetX) && Number.isInteger(cfg4.wmOffsetY) && cfg4.wmOffsetX > 0 && cfg4.wmOffsetY > 0,
      `offset = ${cfg4.wmOffsetX}, ${cfg4.wmOffsetY}`,
    )

    // ---- ④ 切到「背景」再滚一次：证明切换器**真的换了作用对象**（改的是 `bgScale`，不是 `wmScale`）----
    //   背景图在本夹具里解析不了（未保存的谱 + 相对路径）⇒ 预览里没有 bg 层可看，
    //   所以这一条只判**配置**：那正是"背景图能不能摆"的唯一凭据。
    const cfgWmLayer = await cfgNow()
    await evalJs(c, `[...document.querySelectorAll('.poh-chip')].find((el) => el.textContent === '背景').click(), true`)
    await sleep(200)
    /**
     * adj965d（用户要求"加一层保险"）：背景层此刻**只在面板草稿里**（从没点过「保存设置」）
     * ⇒ 角落必须当面说一句"尚未写入谱面"，而不是让用户过一会儿发现"条没了、手势也不动了"。
     * 紧跟着滚一下（下面那条）会把它整层固化 ⇒ 提醒应当随即消失。
     */
    check(
      'adj965d 该层只在草稿里 ⇒ 角落给出「尚未写入谱面」提醒（**加的那层保险**）',
      String(await evalJs(c, `document.querySelector('.poh-unsaved')?.textContent ?? ''`)).includes('尚未写入谱面'),
      String(await evalJs(c, `document.querySelector('.poh-unsaved')?.textContent ?? ''`)).slice(0, 30),
    )
    await wheel(pt, -120, 1)
    await sleep(700)
    const cfgBgLayer = await cfgNow()
    check(
      'adj965d 切到「背景」后 Alt+滚轮 ⇒ 改的是 **`bgScale`**（水印那几个键**原封不动**，两层不串台）',
      cfgBgLayer.bgScale !== undefined &&
        cfgBgLayer.bgScale !== cfgWmLayer.bgScale &&
        cfgBgLayer.wmSize === cfgWmLayer.wmSize &&
        cfgBgLayer.wmRotate === cfgWmLayer.wmRotate &&
        cfgBgLayer.wmOffsetX === cfgWmLayer.wmOffsetX,
      `bgScale ${cfgWmLayer.bgScale ?? '（无）'} → ${cfgBgLayer.bgScale}`,
    )
    /**
     * adj965d（**用户在真机上踩到的那个坑**）：手势落盘**不许留"半截配置"**。
     *
     * 本用例到这一步为止，背景层只在**面板草稿**里开着（`bgEnabled`/`bgImage` 从没点过「保存设置」）
     * ⇒ 生效配置里有、源码层里没有。落盘走的是 `mergeConfigEdits(code, base, cfg)`
     * ——「只并 base 与 cfg 不同的键」：若基线取"按下时的完整快照"，那就**只有 `bgScale`** 被写进去，
     * 源码里留下"一个没启用的背景层 + 一个孤零零的宽度值"；用户随后在编辑器里打字/刷新一次
     * （生效配置重新从源码派生）⇒ 这一层连提示条带手势**一起消失**，而配置行里还留着那个孤儿键。
     *
     * 正确口径：**一次手势 = 把被调的那一层按现在看到的样子固化进谱面**
     * （该层自己的键在基线里置回默认 ⇒ 它们都算"本次改动"），同时**仍然不碰**别的东西。
     */
    check(
      'adj965d **不许留半截配置**：该层自己的键（启用 + 内容）跟手势**一起固化**（`bgEnabled`/`bgImage` 只在草稿里，也得写进去）',
      cfgBgLayer.bgEnabled === true && cfgBgLayer.bgImage === '图.png' && cfgBgLayer.bgScale !== undefined,
      `bgEnabled=${String(cfgBgLayer.bgEnabled)} bgImage=${String(cfgBgLayer.bgImage)} bgScale=${String(cfgBgLayer.bgScale)}`,
    )
    check(
      'adj965d 手势把它写进谱面之后 ⇒ 「尚未写入谱面」提醒**自己消失**（保险不是恒亮的）',
      (await evalJs(c, `!!document.querySelector('.poh-unsaved')`)) === false,
    )

    // ---- ⑤ 负向判据：**非排版辅助模式下按 Alt 什么都不该发生** ----
    await evalJs(
      c,
      `[...document.querySelectorAll('.topbar-btn')].find((el) => (el.getAttribute('title') || '').includes('排版辅助')).click(), true`,
    )
    await sleep(300)
    check(
      'adj965d 关掉「排版辅助」⇒ 角落提示与切换器一并消失（前提①）',
      (await evalJs(c, `!!document.querySelector('.preview-overlay-hint')`)) === false,
    )
    const cfgBeforeNeg = await cfgNow()
    const visBeforeNeg = await wmVisual()
    await wheel(pt, -120, 1)
    await sleep(900)
    const cfgAfterNeg = await cfgNow()
    const visAfterNeg = await wmVisual()
    check(
      'adj965d **负向判据**：排版辅助关着时 Alt+滚轮 ⇒ 配置与预览**一个字都没变**（手势完全不介入）',
      JSON.stringify(cfgAfterNeg) === JSON.stringify(cfgBeforeNeg) &&
        visAfterNeg?.font === visBeforeNeg?.font &&
        visAfterNeg?.transform === visBeforeNeg?.transform,
      `wmSize ${cfgBeforeNeg.wmSize} → ${cfgAfterNeg.wmSize}`,
    )

    // ---- ⑥ 正向回归：`Ctrl+单击音符` = 从这里试听，**照旧可用**（没被 Alt 手势抢走）----
    //     刻意在**排版辅助打开**（手势生效的模式）下测——这才是"两套交互并存"的真实场景。
    await evalJs(
      c,
      `[...document.querySelectorAll('.topbar-btn')].find((el) => (el.getAttribute('title') || '').includes('排版辅助')).click(), true`,
    )
    await sleep(300)
    await evalJs(c, `(() => { const p = document.querySelector('.preview-pane'); p.scrollTop = 0; p.scrollLeft = 0; return true })()`)
    await sleep(250)
    const notePt = await evalJs(
      c,
      `(() => {
         const pane = document.querySelector('.preview-pane')?.getBoundingClientRect()
         if (!pane) return null
         for (const el of document.querySelectorAll('.score-page svg [data-notepos]')) {
           const r = el.getBoundingClientRect()
           const x = r.left + r.width / 2, y = r.top + r.height / 2
           if (r.width > 0 && r.height > 0 && x > pane.left + 4 && x < pane.right - 4 && y > pane.top + 4 && y < pane.bottom - 4) {
             return { x: Math.round(x), y: Math.round(y) }
           }
         }
         return null
       })()`,
    )
    check('adj965d 夹具自检：取到了预览里可见音符的坐标', notePt !== null, JSON.stringify(notePt))
    // `Ctrl+单击`：modifiers=2（Ctrl）
    await c.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: notePt.x,
      y: notePt.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: 2,
    })
    await c.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: notePt.x,
      y: notePt.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers: 2,
    })
    await sleep(800)
    check(
      'adj965d **Ctrl+单击音符 ⇒ 照旧从这里试听**（底栏切到「试听」；Alt 手势没有把这条路抢走）',
      (await evalJs(
        c,
        `[...document.querySelectorAll('.tool-dock-tab')].find((t) => t.textContent.includes('试听'))?.classList.contains('is-active') === true`,
      )) === true,
    )

    // ============ adj966f：两边都改了 ⇒ 逐块采纳 / 自动三路合并（**真点一遍**） ============
    //
    // 为什么这段必须真点（而不是只写源码级断言）：`adj959` 的教训 —— "事件挂错地方"这类缺陷
    // 源码里看着全对（`tsc`/`lint`/`smoke` 全绿），点下去却没反应：差异框里按钮点了不生效、
    // 「应用（并保存）」没把结果写回文件、状态没收口（提示条不走），冒烟全都看不见。
    //
    // 做法：**注入一个假 FSA 句柄**（`showOpenFilePicker` + `getFile` / `createWritable`），
    // 于是应用走的是正常的"网页版 FSA 档"：打开 = 真句柄、监视 = 真轮询（4 秒一跳）、
    // "外部改动" = 我们直接改那个假文件的内容与 mtime ⇒ 从头到尾走完整条链，
    // 直到差异框里逐块点「用左 / 用右」与底部「应用（并保存）」——**并核对假文件真的被写回**。
    const BASE_JPS = [
      'V: 1.0',
      'B: 合并测试',
      'D: C',
      'P: 4/4',
      'Q: 1 2 3 | 4 5 6 |',
      'Q: 1 1 1 | 2 2 2 |',
      'Q: 3 3 3 | 4 4 4 |',
      'Q: 5 5 5 | 6 6 6 |',
      '',
    ].join('\n')
    /** 本地那份：把第 6 行改成 `…2 2 9 |`（`withLocal` 用于两个场景各改一次） */
    const LOCAL_LINE = 'Q: 1 1 1 | 2 2 9 |'
    const CONFLICT_LINE = 'Q: 1 1 1 | 8 8 8 |'
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    await c.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__fakeFile = { name: '合并测试.jps', text: ${JSON.stringify(BASE_JPS)}, mtime: 1000 }
        window.showOpenFilePicker = async () => [{
          kind: 'file',
          name: window.__fakeFile.name,
          getFile: async () => new File([window.__fakeFile.text], window.__fakeFile.name, { lastModified: window.__fakeFile.mtime }),
          createWritable: async () => ({
            write: async (t) => { window.__fakeFile.text = String(t) },
            close: async () => { window.__fakeFile.mtime += 1000 },
            abort: async () => {},
          }),
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted',
        }]
      })()`,
    })
    await c.send('Page.reload')
    await sleep(700)
    await waitFor(
      c,
      `typeof window.showOpenFilePicker === 'function' && !!document.querySelector('.editor-main textarea')`,
      '重载后：假 FSA 就位 + 应用首屏',
    )
    console.log('[verify-app-ui] adj966f：两边都改了 —— 块级采纳 / 自动三路合并（真点）')

    /** 走真实菜单打开那个假文件（用「打开（系统文件选择器）」这一项：它必然调 `openFile`） */
    const openFakeFile = async () => {
      await evalJs(c, `document.querySelector('.topbar-hamburger-btn').click(), true`)
      await waitFor(c, `!!document.querySelector('.topbar-hamburger.open .menu-dropdown')`, '菜单打开')
      const hit = await evalJs(
        c,
        `(() => {
           const el = [...document.querySelectorAll('.topbar-hamburger.open .menu-entry')].find((x) => x.textContent.includes('系统文件选择器'))
           if (!el) return 'no-entry'
           el.click()
           return 'ok'
         })()`,
      )
      if (hit !== 'ok') throw new Error('菜单里找不到「打开（系统文件选择器）」')
      await waitFor(
        c,
        `document.querySelector('.editor-main textarea').value.includes('合并测试')`,
        '假文件已打开（内容进编辑器）',
      )
    }
    /** 把编辑器内容整份换成 `text`（真输入事件，走 React 的 onChange） */
    const retypeEditor = async (text) => {
      await evalJs(
        c,
        `(() => { const ta = document.querySelector('.editor-main textarea'); ta.focus(); ta.setSelectionRange(0, ta.value.length); return true })()`,
      )
      await c.send('Input.insertText', { text })
      await sleep(700)
    }
    const fakeSetText = (text) =>
      evalJs(c, `(window.__fakeFile.text = ${JSON.stringify(text)}, window.__fakeFile.mtime += 5000, true)`)

    // ---- 场景一：两边改**不同块**（互不重叠）⇒ P2 自动合 + 一键「应用」 ----
    await openFakeFile()
    await retypeEditor(BASE_JPS.replace('Q: 1 1 1 | 2 2 2 |', LOCAL_LINE))
    const localNow = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
    check(
      'adj966f 夹具自检：本地那行改动已进编辑器（没被自动格式化改掉）',
      localNow.includes('2 2 9'),
      localNow.split('\n').slice(4, 7).join(' ／ '),
    )
    await fakeSetText(BASE_JPS.replace('Q: 5 5 5 | 6 6 6 |', 'Q: 5 5 5 | 6 6 7 |'))
    await waitFor(c, `!!document.querySelector('.confirm-bar')`, '轮询发现外部改动 ⇒ 确认条出现', 60)
    const autoAsk = String(await evalJs(c, `document.querySelector('.confirm-bar-text').textContent`))
    const autoBtns = await evalJs(c, `[...document.querySelectorAll('.confirm-bar-btn')].map((b) => b.textContent.trim())`)
    check(
      'adj966f **P2 自动合**：两边改的块互不重叠 ⇒ 确认条说"已自动合好…互不重叠"，并给出「应用」按钮',
      autoAsk.includes('互不重叠') && autoBtns.includes('应用'),
      JSON.stringify({ 文案: autoAsk.slice(0, 34), 按钮: autoBtns }),
    )
    await evalJs(
      c,
      `[...document.querySelectorAll('.confirm-bar-btn')].find((b) => b.textContent.trim() === '应用').click(), true`,
    )
    await sleep(900)
    const autoFile = String(await evalJs(c, `window.__fakeFile.text`))
    const autoEditor = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
    check(
      'adj966f **点「应用」⇒ 合并结果真的写回了文件**（假句柄收到的文本 == 编辑器），且**两边都没丢**（本地那行 + 外部那行都在）',
      autoFile === autoEditor && autoFile.includes('2 2 9') && autoFile.includes('6 6 7'),
      JSON.stringify({ 文件尾: autoFile.split('\n').slice(-4).join(' ／ ') }),
    )

    // ---- 场景二：两边改**同一块** ⇒ 必须逐块选（不许自动合并吞掉），选「用右」再应用 ----
    await fakeSetText(BASE_JPS) // 假文件恢复成共同祖先那份（同时推进 mtime）
    await c.send('Page.reload')
    await sleep(700)
    await waitFor(
      c,
      `typeof window.showOpenFilePicker === 'function' && !!document.querySelector('.editor-main textarea')`,
      '重载（冲突场）',
    )
    await openFakeFile()
    await retypeEditor(BASE_JPS.replace('Q: 1 1 1 | 2 2 2 |', LOCAL_LINE)) // 本地改第 6 行
    await fakeSetText(BASE_JPS.replace('Q: 1 1 1 | 2 2 2 |', CONFLICT_LINE)) // 外部改**同一行**（另一种改法）
    await waitFor(c, `!!document.querySelector('.confirm-bar')`, '轮询发现外部改动（冲突场）', 60)
    const clashAsk = String(await evalJs(c, `document.querySelector('.confirm-bar-text').textContent`))
    const clashBtns = await evalJs(c, `[...document.querySelectorAll('.confirm-bar-btn')].map((b) => b.textContent.trim())`)
    check(
      'adj966f **冲突**：两边改同一块 ⇒ 确认条走"要你决定"的说法（不是"已自动合好"），且**不给**「应用」快捷按钮',
      clashAsk.includes('查看差异') && !clashAsk.includes('互不重叠') && !clashBtns.includes('应用'),
      JSON.stringify({ 文案: clashAsk.slice(0, 34), 按钮: clashBtns }),
    )
    await evalJs(
      c,
      `[...document.querySelectorAll('.confirm-bar-btn')].find((b) => b.textContent.trim() === '查看差异').click(), true`,
    )
    await waitFor(c, `!!document.querySelector('.file-diff')`, '差异框打开')
    await waitFor(c, `document.querySelectorAll('.diff-bar').length > 0`, '差异框里有块操作条')
    const barCount = await evalJs(c, `document.querySelectorAll('.diff-bar').length`)
    const barLabels = await evalJs(c, `[...new Set([...document.querySelectorAll('.diff-bar-btn')].map((b) => b.textContent.trim()))]`)
    const barTags = String(await evalJs(c, `[...document.querySelectorAll('.diff-bar-tag')].map((t) => t.textContent).join(' ｜ ')`))
    check(
      'adj966f 差异框：每个改动块给出「用左 / 用右」（两栏各一条 ⇒ 块数 ×2），冲突块标出"两边都改了同一块"',
      barCount >= 2 && barCount % 2 === 0 && barLabels.includes('用左') && barLabels.includes('用右') && barTags.includes('冲突'),
      JSON.stringify({ 操作条: barCount, 按钮: barLabels, 标签: barTags.slice(0, 40) }),
    )
    /**
     * adj967c（**用户截图实报**「有变化处看不到两侧各修改的是什么，遮住了」）：
     * 块操作条早先与"块首那一行"是**同一条 item** ⇒ 那一行被吃掉；单行改动块里"改动的那一行"
     * 正好是块首行 ⇒ 用户只看到操作条、看不到改了什么。这条判据盯的就是"改动的行必须真的在 DOM 里、
     * 两栏各显示自己那一版"，光看"操作条在不在"是抓不住的。
     */
    const changeLines = await evalJs(
      c,
      `[...document.querySelectorAll('.file-diff-pane')].map((p) => [...p.querySelectorAll('.diff-line[data-kind="change"]')].map((l) => l.textContent.trim()).join('\\n'))`,
    )
    const leftChange = String(changeLines?.[0] ?? '')
    const rightChange = String(changeLines?.[1] ?? '')
    check(
      'adj967c **改动的行必须可见**：左栏显示本地那一版、右栏显示外部那一版（不是被操作条盖住/吃掉）',
      leftChange.includes('2 2 9') && rightChange.includes('8 8 8') && !leftChange.includes('8 8 8') && !rightChange.includes('2 2 9'),
      JSON.stringify({ 左栏改动行: leftChange.slice(0, 40), 右栏改动行: rightChange.slice(0, 40) }),
    )
    const barOverRow = await evalJs(
      c,
      `(() => {
         const bars = [...document.querySelectorAll('.diff-bar')].map((b) => b.getBoundingClientRect())
         const rows = [...document.querySelectorAll('.diff-line')].map((r) => r.getBoundingClientRect())
         // 操作条与任何**行**都不许在纵向上相互覆盖
         return bars.some((b) => rows.some((r) => b.top < r.bottom - 1 && r.top < b.bottom - 1))
       })()`,
    )
    check('adj967c 操作条与代码行**不重叠**（几何上各占各的高度）', barOverRow === false, String(barOverRow))
    // 点**第一条**操作条里的「用右」（= 那个冲突块改用外部那一版）
    await evalJs(c, `document.querySelectorAll('.diff-bar')[0].querySelectorAll('.diff-bar-btn')[1].click(), true`)
    await sleep(250)
    const onCls = String(
      await evalJs(c, `document.querySelectorAll('.diff-bar')[0].querySelectorAll('.diff-bar-btn')[1].className`),
    )
    check('adj966f 差异框：点「用右」⇒ 该块选中态真的切过去（按钮挂在该块上，不是点了没反应）', onCls.includes('is-on'), onCls)
    await evalJs(
      c,
      `[...document.querySelectorAll('.file-diff-foot button')].find((b) => b.textContent.includes('应用')).click(), true`,
    )
    await sleep(900)
    const clashFile = String(await evalJs(c, `window.__fakeFile.text`))
    const clashEditor = String(await evalJs(c, `document.querySelector('.editor-main textarea').value`))
    check(
      'adj966f 冲突场：选「用右」+「应用（并保存）」⇒ **外部那一版进了文件、本地那一版被换掉**，编辑器与文件一致',
      clashFile === clashEditor && clashFile.includes('8 8 8') && !clashFile.includes('2 2 9'),
      JSON.stringify({ 第6行: (clashFile.split('\n')[5] ?? '').trim() }),
    )
    check(
      'adj966f 收口：应用并保存后**确认条与差异框都关掉了**（基准已刷新 ⇒ 不会反复提示）',
      (await evalJs(c, `!!document.querySelector('.confirm-bar')`)) === false &&
        (await evalJs(c, `!!document.querySelector('.file-diff')`)) === false,
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
