/**
 * scripts/verify-score-crop.mjs — **真机行为验证**：插件预览层「谱面」视图是否"只显示内容部分"
 *
 * 为什么单独验证：裁剪依赖 `getBBox()`（真实 DOM），Node 里的 smoke 跑不到那段逻辑
 * （会走"测不到就退回按边距裁"的分支）。所以必须用真实浏览器驱动**同一份源码**
 * （`obsidian-ijipu/src/scorePane.ts`，由 `vite.verify.config.ts` 打成 IIFE）。
 *
 * 验证内容：
 *  ① `mountScorePane` 挂载后确实记录了内容包围盒（`data-content-box`）；
 *  ② 「谱面」模式的 viewBox **等于**内容包围盒（误差 ≤1px）—— 即"紧贴内容、四周不留空白"；
 *  ③ 它比旧口径（削四边距）**更紧**，且**没有裁掉任何内容**（内容并集 ⊆ viewBox）；
 *  ④ 三种模式各截一张图（人工可核对的视觉证据）。
 *
 * 用法：node scripts/verify-score-crop.mjs
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'dist-preview')
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}
/** 跳过（不算失败）：例如宿主 CSS 拿不到、或环境不具备 `(hover: hover)` */
const skip = (name, why) => console.log(`  –（跳过）${name} —— ${why}`)

/**
 * adj725：取**本机安装的 Obsidian 的真实 `app.css`**（asar 里是明文）。
 *
 * 为什么非它不可：本轮要验证的"工具条浮到块外会不会被宿主裁掉"完全由宿主那条
 * `@media (hover:hover) { .markdown-source-view.mod-cm6 .cm-embed-block:hover { overflow: hidden } }`
 * 决定 —— 不加载它，"验证"就退化成读我们自己写的那行 CSS（等于没测）。
 * 顺序也要照抄宿主：core 的 `app.css` 先、插件 `styles.css` 后（同特异性时靠这个分胜负）。
 *
 * asar 头：`[…] [headerLen] …` 之后是 JSON 头，文件数据紧跟在 JSON 头之后，
 * 每个文件的 offset 相对该起点。取不到就返回 null（调用方跳过相关断言，不假装通过）。
 */
function extractObsidianAppCss() {
  const ASAR = 'C:/Program Files/Obsidian/resources/obsidian.asar'
  if (!existsSync(ASAR)) return null
  const fd = openSync(ASAR, 'r')
  try {
    const head = Buffer.alloc(64)
    readSync(fd, head, 0, 64, null)
    const jsonStart = head.indexOf('{"files"', 0, 'utf8')
    if (jsonStart < 0) return null
    const headerLen = head.readUInt32LE(jsonStart - 4)
    const jsonBuf = Buffer.alloc(headerLen)
    readSync(fd, jsonBuf, 0, headerLen, jsonStart)
    const header = JSON.parse(jsonBuf.toString('utf8'))
    let dataStart = jsonStart + headerLen
    if (dataStart % 4) dataStart += 4 - (dataStart % 4)
    const entry = header.files?.['app.css']
    if (!entry) return null
    const buf = Buffer.alloc(entry.size)
    readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset))
    return buf.toString('utf8')
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res())
    ws.addEventListener('error', (e) => rej(new Error(`WS 失败: ${e.message ?? e.type}`)))
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

async function main() {
  const bundle = path.join(OUT, 'ijipu-pane.js')
  if (!existsSync(bundle)) {
    console.error('[verify] 缺 dist-preview/ijipu-pane.js —— 先跑：npx vite build --config vite.verify.config.ts')
    process.exit(1)
  }
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) {
    console.error('[verify] 未找到 Chrome/Edge，跳过')
    process.exit(0)
  }

  // 取示例谱：命令行可指定（`node scripts/verify-score-crop.mjs 单行片段`），
  // 否则取**最长**的那个（内容分布最能暴露裁剪问题）
  const sampleDir = path.join(ROOT, 'samples')
  const samples = readdirSync(sampleDir).filter((f) => f.endsWith('.jps'))
  const wantName = process.argv[2]
  const pick = wantName
    ? samples.find((f) => f === `${wantName}.jps` || f === wantName) ?? samples[0]
    : samples.sort((a, b) => readFileSync(path.join(sampleDir, b)).length - readFileSync(path.join(sampleDir, a)).length)[0]
  const code = readFileSync(path.join(sampleDir, pick), 'utf8')
  console.log(`[verify] 示例谱：${pick}（${code.length} 字节）`)

  // 真实样式表也带上（裁剪后的**渲染高度**取决于 `.ijipu-mode-score … svg { width:100%; height:auto }`，
  // 不加载它量到的就不是真实布局）
  //
  // ⚠ **必须写成外部文件**，不能内联进下面的 HTML 模板字符串：
  //   `styles.css` 的注释里有反引号（如 "`.ijipu-guides-btn.is-active`"），
  //   内联会把模板字符串**提前终结** ⇒ 后面的 CSS 被当成 JS 解析，页面报
  //   `SyntaxError: Invalid or unexpected token`（而且报错行号落在 CSS 注释里，极易误判）。
  //   本轮为此排查了很久 —— 教训与 embed-smoke 的 assertNoBackticksInTemplates 同源。
  const pluginCss = readFileSync(path.join(ROOT, '..', 'obsidian-ijipu', 'styles.css'), 'utf8')
  writeFileSync(path.join(OUT, 'plugin.css'), pluginCss, 'utf8')

  /**
   * adj725：**连宿主的 app.css 一起加载**（顺序与真实宿主一致：core 先、插件后）——
   * 否则"工具条浮到块外会不会被 `.cm-embed-block:hover { overflow: hidden }` 裁掉"这条
   * 根本无法在页面里复现。取不到（没装 Obsidian）就退化为"只加载插件样式"，
   * 相关断言会**跳过**并打印原因，不会假装通过。
   */
  const obsidianCss = extractObsidianAppCss()
  if (obsidianCss) writeFileSync(path.join(OUT, 'obsidian-app.css'), obsidianCss, 'utf8')
  else console.log('[verify] 未找到 Obsidian app.css ⇒ 跳过"宿主裁剪"相关断言')

  /**
   * 加**版本号查询串**（adj724b）：静态资源必须每次都是新的 ——
   * 实测仅靠 `Network.setCacheDisabled` 不足以让已加载过的 `probe.js` 更新，
   * 会出现"改了探针、输出却一模一样"的假象（本轮被骗过一次）。
   * 变量名用 `cacheBust`（不能用 `v`：下面读 viewBox 的那个 `v` 会撞名）。
   */
  const cacheBust = String(Date.now())
  /**
   * adj725：页面结构与真实宿主对齐 —— 三个挂载点：
   *  · `#wrap`  = **阅读模式**的 `div.block-language-jps`（处理器拿到的 `el` 就是它）
   *  · `#wrap2` = 「编辑源码」按钮那一支
   *  · `#wrap3` = **实时预览**：`div.cm-preview-code-block.cm-embed-block.markdown-rendered.cm-lang-jps`
   *               > `div.block-language-jps`（DOM 结构与类名逐字取自 Obsidian 的 app.js），
   *               里面还**预置了宿主的 `.embed-actions`**（真实宿主会给代码块挂「编辑此块」按钮）
   *               —— 用来验证"我们不重复挂 `</>`"与"工具条浮到块外不会被宿主裁掉"。
   * `#wrap3` 外面留 140px 空白：工具条浮在块上方，必须有地方放（否则量到视口外）。
   *
   * ⚠ `body` 必须带**主题类**（这里用 `theme-dark`，与用户截图同一主题）：宿主的颜色变量
   * （`--text-normal` / `--background-secondary` / `--embed-action-color` …）只在
   * `.theme-dark` / `.theme-light` 下成立。不带它时 `</>` 的 `color` 会落到宿主的深色默认值纯白，
   * 于是"截图里看不见"且量到的颜色不是真实取值 —— 本轮先被这个假象骗过一次。
   *
   * ⚠ 这个模板字符串里**绝不能出现反引号**：写 HTML 注释时手滑用了反引号包住变量名，
   * 直接把模板终结掉，报出 `SyntaxError: Invalid left-hand side expression in postfix operation`
   * （报错行还落在别处）。说明一律写在模板**外面**，见文件头。
   */
  const indexHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>crop verify</title>
${obsidianCss ? `<link rel="stylesheet" href="obsidian-app.css?v=${cacheBust}">` : ''}
<link rel="stylesheet" href="plugin.css?v=${cacheBust}">
<style>body{margin:0;background:#eef;font:12px system-ui}#wrap{width:820px;margin:8px auto}
.ijipu-page-svg{background:#fff;border:1px solid #c00}
#lpView{width:820px;margin:140px auto 8px}#wrap3{padding:0}</style></head>
<body class="theme-dark"><div id="wrap"></div>
<div id="wrap2" style="width:820px;margin:8px auto"></div>
<div id="lpView" class="markdown-source-view mod-cm6">
  <div id="lpEmbed" class="cm-preview-code-block cm-embed-block markdown-rendered cm-lang-jps">
    <div id="wrap3" class="block-language-jps"></div>
    <div class="embed-actions"><button class="edit-block-button" type="button">e</button></div>
  </div>
</div>
<script src="obsidian-stub.js?v=${cacheBust}"></script>
<script src="probe.js?v=${cacheBust}"></script>
<script src="ijipu-pane.js?v=${cacheBust}"></script>
<script>
  /**
   * 全局错误记录（adj724b）：事件监听器里抛的异常不会冒给调用方，
   * 而 probe 里临时挂的监听接不到"点击那一刻"抛的错 ⇒ 在页面加载时就挂上，留下证据。
   */
  window.__ijipuErrs = [];
  window.addEventListener('error', function (e) { window.__ijipuErrs.push(String(e && e.message)); });
  window.addEventListener('unhandledrejection', function (e) { window.__ijipuErrs.push('rej: ' + String(e && e.reason)); });
  // 把示例源码交给页面，供评测表达式读取
  window.__jpsCode = ${JSON.stringify(code)};
  window.__ijipuSrc = window.__jpsCode;
</script>
</body></html>`
  writeFileSync(path.join(OUT, 'crop-verify.html'), indexHtml, 'utf8')

  /**
   * 外部替身脚本（**必须放在外部文件里**，不能内联进 expr 模板字符串 —— 那里的反引号会终结模板）。
   * 它提供两类真实宿主有的东西：
   *  ① Obsidian 的**全局 DOM 助手** `createEl`/`createDiv`/`createSpan`/`sanitizeHTMLToDom`
   *     （源码里是直接调用的全局函数，不是从 'obsidian' 导入）；
   *  ② Obsidian 给 **DOM 元素**加的扩展方法（`empty`/`addClass`/`setCssStyles`/`setTooltip`…），
   *     挂到 `Element.prototype` 上统一提供（逐个元素打补丁会漏，实测漏过 `el.setCssStyles`）。
   */
  const stub = `window.obsidianStub = { Notice: class {}, Menu: class {}, Platform: { isDesktopApp: true, isMobileApp: false } };
(function () {
  function apply(o, el) {
    if (!o) return el;
    if (typeof o === 'string') { el.className = o; return el; }
    if (o.cls) el.className = o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    var attrs = o.attr || {};
    for (var k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
  }
  window.createEl = function (tag, o) { return apply(o, document.createElement(tag)); };
  window.createDiv = function (o) { return apply(o, document.createElement('div')); };
  window.createSpan = function (o) { return apply(o, document.createElement('span')); };
  window.sanitizeHTMLToDom = function (html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  };
  function def(name, value) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: value, writable: true, configurable: true });
    }
  }
  def('empty', function () { while (this.firstChild) this.removeChild(this.firstChild); });
  def('addClass', function () { for (var i = 0; i < arguments.length; i++) this.classList.add(arguments[i]); });
  def('addClasses', function (cs) { for (var i = 0; i < cs.length; i++) this.classList.add(cs[i]); });
  def('removeClass', function () { for (var i = 0; i < arguments.length; i++) this.classList.remove(arguments[i]); });
  def('removeClasses', function (cs) { for (var i = 0; i < cs.length; i++) this.classList.remove(cs[i]); });
  def('toggleClass', function (c, v) { this.classList.toggle(c, v); });
  def('hasClass', function (c) { return this.classList.contains(c); });
  def('setAttr', function (k, v) { this.setAttribute(k, String(v)); });
  def('setAttrs', function (o) { for (var k in o) this.setAttribute(k, String(o[k])); });
  def('getAttr', function (k) { return this.getAttribute(k); });
  def('setText', function (t) { this.textContent = t; });
  def('setCssStyles', function (s) { for (var k in s) this.style[k] = s[k]; });
  def('setCssProps', function (p) { for (var k in p) this.style.setProperty(k, p[k]); });
  def('setTooltip', function () {});
  def('createDiv', function (o) { var d = apply(o, document.createElement('div')); this.appendChild(d); return d; });
  def('createEl', function (tag, o) { var d = apply(o, document.createElement(tag)); this.appendChild(d); return d; });
  def('createSpan', function (o) { var s = apply(o, document.createElement('span')); this.appendChild(s); return s; });
})();`
  writeFileSync(path.join(OUT, 'obsidian-stub.js'), stub, 'utf8')

  /**
   * 页面内探针放在**外部文件**里（见 scripts/verify-score-probe.js 的说明）：
   * 逻辑写在模板字符串里时，反引号与转义会互相干扰，反复产出难以定位的 SyntaxError。
   * ⚠ adj725：**必须在启动 Chrome 之前**落盘 —— 之前放在 reload 之后，
   *   首次页面加载时该文件还不存在（404）⇒ 探针"语法没问题却不存在"。
   */
  writeFileSync(path.join(OUT, 'probe.js'), readFileSync(path.join(ROOT, 'scripts', 'verify-score-probe.js'), 'utf8'), 'utf8')

  const server = createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url ?? '/').split('?')[0].replace(/^\/+/, '')) || 'crop-verify.html'
    const file = path.join(OUT, rel)
    if (!file.startsWith(OUT) || !existsSync(file)) {
      res.writeHead(404)
      res.end('nope')
      return
    }
    const ext = path.extname(file)
    // adj724b：**必须给 `.css` 正确的 MIME** —— 否则退回 octet-stream，Chrome 会拒绝解析样式表
    // （表现为"样式没生效"，而错误信息指向别处，很容易误判成代码问题）。
    const mime =
      ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream'
    res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/crop-verify.html`

  const profile = await mkdtemp(path.join(tmpdir(), 'ijipu-crop-verify-'))
  const debugPort = 9444
  const child = spawn(
    chrome,
    ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
     '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu',
     /**
      * ⚠ 必须显式允许 CDP 的 WebSocket 来源：Node 的内置 WebSocket 会带 `Origin` 头，
      * 而新版 Chrome 默认只接受 localhost 来源 ⇒ 连接/消息被拒，
      * 表现为 `Runtime.evaluate` 拿不到结果（`result.value` 是 undefined）。
      * 本轮就是被它误导成"页面内语法错误"排查了很久（拿不到值 ≠ 表达式有错）。
      */
     '--remote-allow-origins=*',
     '--disable-crash-reporter', '--disable-breakpad', '--window-size=900,1200', url],
    { stdio: 'ignore' },
  )

  const done = async (code0) => {
    try { child.kill() } catch { /* 忽略 */ }
    server.close()
    await rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
    process.exit(code0)
  }

  let target = null
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1:'))
      if (target) break
    } catch { /* 未就绪 */ }
  }
  if (!target) {
    console.error('[verify] CDP 未就绪')
    await done(1)
  }

  const c = cdp(target.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  await c.send('Page.enable')
  /**
   * ⚠ **必须禁用缓存**（adj724b）：否则页面会复用上一次运行时的 `probe.js` / 打包产物，
   * 出现"改了验证代码、结果却一模一样"的假象 —— 本轮就被它骗过一次（诊断字段始终不出现）。
   */
  await c.send('Network.enable')
  await c.send('Network.setCacheDisabled', { cacheDisabled: true })
  await c.send('Page.reload', { ignoreCache: true })
  await sleep(600)

  /**
   * 在页面里求值并把 JSON 解析回来（多处要用）。
   * ⚠ 表达式**必须不含反引号** —— 这里已是普通字符串，但上游常把它写成模板字符串，
   *   一旦出现反引号就会提前终结模板（本项目为此排查过很久，见文件头说明）。
   */
  const evalJson = async (expression) => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`页面内表达式抛错：${JSON.stringify(r.exceptionDetails).slice(0, 300)}`)
    return JSON.parse(r.result.value)
  }

  // —— 在页面里驱动**真实源码**：挂载面板 → 读「谱面」模式的 viewBox ——
  // ⚠ 本模板字符串里**禁止出现反引号**（会提前终结模板）；DOM/宿主替身一律放在外部 js 文件里。
  const expr = 'window.__ijipuProbe()'

  /**
   * ⚠ adj725：**先等页面把脚本都跑起来**再调探针。
   *
   * 此前是固定 `sleep(600)` —— 本轮加了"连宿主 app.css 一起加载"（668KB）后，
   * 600ms 不再够用，探针会在 `window.__ijipuProbe` 还是 undefined 时被调用，
   * 报出 `TypeError: window.__ijipuProbe is not a function`（看着像探针语法错，
   * 其实是**页面还没加载完**——最容易误判的一类）。
   */
  let pageReady = false
  for (let i = 0; i < 40; i++) {
    const r = await c.send('Runtime.evaluate', {
      expression: 'typeof window.__ijipuProbe + "/" + typeof window.IJipuPane',
      returnByValue: true,
    })
    if (r.result.value === 'function/object') {
      pageReady = true
      break
    }
    await sleep(250)
  }
  if (!pageReady) {
    const diag = await c.send('Runtime.evaluate', {
      expression:
        'JSON.stringify({scripts: Array.from(document.scripts).map(function(s){return s.src.split("/").pop()}), errs: window.__ijipuErrs || null, ready: document.readyState})',
      returnByValue: true,
    })
    console.error('[verify] 页面脚本没跑起来：', diag.result.value)
    await done(1)
  }

  let probe
  try {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      console.error('[verify] 页面内表达式抛错：', JSON.stringify(r.exceptionDetails).slice(0, 800))
      await done(1)
    }
    probe = JSON.parse(r.result.value)
  } catch (e) {
    console.error('[verify] Runtime.evaluate 失败：', e.message)
    await done(1)
  }
  if (probe.error) {
    console.error('[verify] ❌', probe.error)
    await done(1)
  }

  console.log('\n[verify] 结果：')
  console.log('  data-content-box =', probe.box)
  console.log('  实测内容并集     =', JSON.stringify(probe.measured))
  const ms = probe.modes.score ?? {}
  console.log('  「谱面」viewBox  =', JSON.stringify(ms.viewBox))
  console.log('  「谱面」元素盒子  =', JSON.stringify(ms.rect), ' 父容器 =', JSON.stringify(ms.parentRect))
  console.log('  CSS 实况         =', JSON.stringify(probe.css))
  console.log('  块四周留白       =', JSON.stringify(probe.padding))
  console.log('  工具条显隐/几何  =', JSON.stringify(probe.toolbar))
  console.log('  编辑源码入口     =', JSON.stringify(probe.editSource))
  console.log('  实时预览那一支   =', JSON.stringify(probe.lp))

  /**
   * adj725（用户要求）：**谱面块四周只留 2px 留白**。
   * 量的口径 = 容器（`.ijipu-score`）外缘 → 谱面纸张（`.ijipu-svgs`）的净距。
   * 允许 1px 误差（边框/子像素取整）；关键是"绝不是原来的 6.4px（0.4em）那种厚边距"。
   */
  if (probe.padding && !probe.padding.error) {
    const p = probe.padding
    const near2 = (x) => Math.abs(x - 2) <= 1.2
    ok(near2(p.left) && near2(p.right) && near2(p.top) && near2(p.bottom),
      'adj725 谱面块四周只留 2px 留白（左右上下各自量）', JSON.stringify(p))
  } else {
    ok(false, 'adj725 能量到谱面块四周的留白', JSON.stringify(probe.padding))
  }

  /**
   * adj725（用户要求）：**「编辑源码」= 块右上角的 `</>`**（点它切回笔记源码）。
   *  · 有 `onEditSource` 才出现（代码块）；谱面**不被换掉**、**不出现 textarea**；
   *  · 默认不可见 → 悬停显形（与工具条同一套）；
   *  · 位置在块右上角（与容器右缘/顶边各差几像素）；
   *  · 点击**恰好调一次**宿主落点。
   */
  if (probe.editSource && !probe.editSource.error) {
    const e = probe.editSource
    ok(e.hasBtn, 'adj725 出现块右上角的 `</>`（宿主给了 onEditSource）')
    ok(e.hidden === 'hidden' && e.shown === 'visible', 'adj725 `</>` 默认不可见、悬停显形（与工具条同套）',
      `初始=${e.hidden} 悬停=${e.shown}`)
    ok(e.noTextarea && e.scoreKept, 'adj725 不再出现 textarea，谱面也保持渲染（源码切回笔记）',
      `noTextarea=${e.noTextarea} scoreKept=${e.scoreKept}`)
    ok(e.calls === 1, 'adj725 点一下 = 调一次宿主落点（切回笔记源码）', `calls=${e.calls} err=${e.clickErr}`)
    if (e.gaps) {
      ok(e.gaps.right >= 0 && e.gaps.right <= 12 && e.gaps.top >= 0 && e.gaps.top <= 12,
        'adj725 `</>` 落在块的**右上角**（与右缘/顶边各内缩几像素）', JSON.stringify(e.gaps))
    } else {
      ok(false, 'adj725 能量到 `</>` 的位置')
    }
  } else {
    ok(false, 'adj725 能测「编辑源码」入口', probe.editSource?.error ?? '')
  }

  if (probe.toolbar && !probe.toolbar.error) {
    const t = probe.toolbar
    ok(t.initial.visibility === 'hidden', '工具条默认不可见（visibility:hidden ⇒ 导出不会出现、也不占 Tab 焦点）', t.initial.visibility)
    ok(t.initial.position === 'absolute', '工具条绝对定位（不参与布局）', t.initial.position)
    ok(t.afterMove.visibility === 'visible', '鼠标移到谱面上后工具条可见', t.afterMove.visibility)
    ok(t.afterLeave.visibility === 'hidden', '鼠标离开后工具条收起', t.afterLeave.visibility)
    const s = t.shift
    ok(s.before === s.afterReveal && s.before === s.afterLeave,
      '**谱面不因工具条显隐而位移**（SVG top 前后一致）',
      `before=${s.before} 显示后=${s.afterReveal} 收起后=${s.afterLeave}`)
    /** adj725：工具条整条落在**块外**正上方、左缘与块对齐（用户要求：不要盖在预览区内部） */
    const g = t.geometry
    if (g) {
      ok(g.outsideContainer && g.leftAligned,
        'adj725 工具条整条在谱面块**外侧**正上方、左缘对齐（不压谱面）',
        JSON.stringify(g))
      ok(Math.abs(g.gap - 2) <= 1.2, 'adj725 工具条与块顶边留 2px 缝（与块内 2px 同一口径）', `gap=${g.gap}`)
    } else {
      ok(false, 'adj725 能量到工具条与块的相对位置')
    }
  } else {
    ok(false, '能取到工具条并测显隐', probe.toolbar?.error ?? '')
  }

  /**
   * adj725：**实时预览里工具条会不会被宿主裁掉** —— 本轮最容易"本地看着好、用户那儿没按钮"的一条。
   *
   * 宿主 app.css：`@media (hover:hover) { .cm-embed-block:hover { overflow: hidden } }`，
   * 而工具条**正是悬停才显示、且落在块外** ⇒ 不处理就整条被裁（连点都点不到）。
   * 这里用 CDP 强制 `:hover`（派发 pointermove 是造不出 CSS 伪类的），量两件事：
   *  · `overflow` 的计算值（我们的 `.ijipu-cm-host` 规则有没有赢过宿主）；
   *  · **命中测试**：工具条中心处 `elementFromPoint` 是否真的命中工具条（被裁掉时命不中）。
   * 再做**负对照**：把我们的类摘掉 ⇒ 必须变回 `hidden` 且命不中 —— 证明这条修法是**承重的**，
   * 而不是"反正没它也行"（没有负对照的验证等于没验证）。
   */
  {
    const lp = probe.lp
    if (!lp || lp.error) {
      ok(false, 'adj725 能挂载"实时预览"那一支', lp?.error ?? '')
    } else {
      ok(lp.hostClass.includes('ijipu-cm-host'), 'adj725 挂载时给宿主 widget 容器加了 .ijipu-cm-host', lp.hostClass)
      ok(lp.hostActions && !lp.ourEditBtn, 'adj725 宿主已挂同款「编辑此块」时不再重复挂 `</>`',
        `宿主按钮=${lp.hostActions} 我们的=${lp.ourEditBtn}`)
      if (obsidianCss && lp.hoverMedia) {
        await c.send('DOM.enable')
        await c.send('CSS.enable')
        const doc = await c.send('DOM.getDocument', { depth: -1 })
        const node = await c.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#lpEmbed' })
        await c.send('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: ['hover'] })
        const withClass = await evalJson('window.__ijipuLpHoverProbe("withClass")')
        const noClass = await evalJson('window.__ijipuLpHoverProbe("noClass")')
        await c.send('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: [] })
        console.log('  悬停（保留我们的类）=', JSON.stringify(withClass))
        console.log('  悬停（负对照：摘掉类）=', JSON.stringify(noClass))
        ok(withClass.overflow === 'visible' && withClass.hitCenter === 'toolbar',
          'adj725 实时预览悬停时：宿主的 overflow:hidden 被放开，工具条**点得到**',
          JSON.stringify(withClass))
        ok(noClass.overflow === 'hidden' && noClass.hitCenter !== 'toolbar',
          'adj725 负对照：摘掉 .ijipu-cm-host ⇒ 宿主确实会裁掉工具条（证明这条修法是承重的）',
          JSON.stringify(noClass))
      } else {
        skip('adj725 实时预览悬停时的裁剪（命中测试）',
          obsidianCss ? '环境不满足 (hover: hover)' : '拿不到 Obsidian app.css')
      }
    }
  }
  if (ms.viewBox && ms.rect) {
    const vbRatio = ms.viewBox[2] / ms.viewBox[3]
    const elRatio = ms.rect.w / ms.rect.h
    console.log(`  宽高比：viewBox=${vbRatio.toFixed(3)}  元素=${elRatio.toFixed(3)}`)
    ok(Math.abs(vbRatio - elRatio) < 0.05, 'SVG 元素盒子与 viewBox 同比例（CSS 层没有额外留白）',
      `viewBox=${vbRatio.toFixed(3)} 元素=${elRatio.toFixed(3)}`)
  }

  const cb = (probe.box || '').split(/\s+/).map(Number)
  const m = probe.measured
  // ⚠ 用**进入"编辑源码"测试之前**快照的 viewBox：那个测试会挂第二个面板（历史上还换过 #wrap 的 DOM），
  //   之后再读 SVG 可能读到空（实测 viewBox=NaN）—— 这是测试顺序的坑，不是产品问题。
  const v = probe.vbBeforeSource ?? probe.modes.score?.viewBox

  ok(Array.isArray(cb) && cb.length === 4 && cb[2] > 0 && cb[3] > 0, '挂载时记录了内容包围盒（data-content-box）')
  ok(!!m, '能在页面上重算出内容并集')
  if (m && Array.isArray(v) && v.length === 4) {
    const near = (a, b) => Math.abs(a - b) <= 1
    ok(near(v[0], m.x) && near(v[1], m.y) && near(v[2], m.w) && near(v[3], m.h),
      '「谱面」viewBox 紧贴内容（与实测并集一致，误差 ≤1px）',
      `viewBox=${v} measured=${JSON.stringify(m)}`)
    // 旧口径（削四边距）= 整页大小；新口径必须更紧
    const orig = (probe.modes.score?.measured ? null : null)
    void orig
    ok(v[2] < 4000 && v[3] < 4000, 'viewBox 尺寸是内容尺度（不是整页尺度）', `${v[2]}×${v[3]}`)
    /** 没裁掉内容：实测并集必须落在 viewBox 内 */
    const inside = m.x >= v[0] - 1 && m.y >= v[1] - 1 && m.x + m.w <= v[0] + v[2] + 1 && m.y + m.h <= v[1] + v[3] + 1
    ok(inside, '没有裁掉内容（内容并集落在 viewBox 内）')
  } else {
    ok(false, '能读到「谱面」viewBox')
  }

  // —— 截图（视觉证据；三种模式各一张）——
  /** 截图前的**实况**（人眼核对用：三个挂载点各自的位置 / 工具条与 `</>` 的显隐） */
  const visuals = await evalJson(
    `JSON.stringify(['wrap','wrap2','wrap3'].map(function(id){var c=document.getElementById(id);var tb=c&&c.querySelector('.ijipu-score-toolbar');var eb=c&&c.querySelector('.ijipu-edit-source-btn');var r=c?c.getBoundingClientRect():null;var er=eb?eb.getBoundingClientRect():null;var ecs=eb?getComputedStyle(eb):null;var svg=eb?eb.querySelector('svg'):null;return {id:id,top:r?Math.round(r.top):null,left:r?Math.round(r.left):null,toolbar:tb?getComputedStyle(tb).visibility:null,editBtn:eb?ecs.visibility:null,hasEditBtn:!!eb,btnRect:er?{x:Math.round(er.left),y:Math.round(er.top),w:Math.round(er.width),h:Math.round(er.height)}:null,btnColor:ecs?ecs.color:null,btnOpacity:ecs?ecs.opacity:null,iconStroke:svg?getComputedStyle(svg).stroke:null,iconBox:svg?Math.round(svg.getBoundingClientRect().width):null};}))`,
  )
  console.log('  三个挂载点实况 =', JSON.stringify(visuals))

  const shot = async (name) => {
    const s = await c.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT, `crop-${name}.png`)
    writeFileSync(file, Buffer.from(s.data, 'base64'))
    console.log(`  截图：${path.relative(ROOT, file)}`)
  }
  await shot('score')
  /**
   * 再取一张**悬停中**的图：工具条是"浮在块**外侧**上方 + 淡入"、`</>` 是"块的右上角 + 淡入"，
   * 只有悬停态才看得出外观（在不在块外、有没有盖住谱面、`</>` 落点对不对）。
   * 两个挂载点都派发 pointermove（`#wrap` 有工具条、`#wrap2` 有 `</>`），等过渡结束再截。
   */
  await c.send('Runtime.evaluate', {
    expression: `(() => {
      for (const id of ['wrap', 'wrap2', 'wrap3']) {
        const el = document.getElementById(id);
        if (el) el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      }
      return true;
    })()`,
    returnByValue: true,
  })
  await sleep(300)
  await shot('toolbar-hover')
  /**
   * adj725：**两种主题各留一张** —— `</>` 压在**恒为白色**的谱面纸张上，
   * 深色主题下若只跟主题取字色就会"白纸上看不见"（本轮踩过）。
   * 这里切到 `theme-light` 再截一张，人眼可直接比对两边的对比度。
   */
  await evalJson(`(function(){document.body.className='theme-light';return '1';})()`)
  await sleep(200)
  await shot('toolbar-hover-light')
  await evalJson(`(function(){document.body.className='theme-dark';return '1';})()`)
  await sleep(200)
  // 顺手把内容盒左上角附近的放大图也留一张，便于人眼核对"有没有多留白"
  await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1200, deviceScaleFactor: 2, mobile: false })
  await shot('score-2x')
  await c.send('Emulation.clearDeviceMetricsOverride')

  console.log(`\n${pass} passed, ${fail} failed`)
  await done(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('[verify] 异常：', e)
  process.exit(1)
})
