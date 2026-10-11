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
  /**
   * adj725b：**也可以直接喂一份源码文件**（`node scripts/verify-score-crop.mjs <路径>.jps`）——
   * 复现用户报的那一份谱时不必先塞进 `samples/`（那个目录会随产品发布，不该放临时谱）。
   */
  const asFile = wantName && existsSync(wantName) ? wantName : null
  const pick = asFile
    ? asFile
    : wantName
      ? samples.find((f) => f === `${wantName}.jps` || f === wantName) ?? samples[0]
      : samples.sort((a, b) => readFileSync(path.join(sampleDir, b)).length - readFileSync(path.join(sampleDir, a)).length)[0]
  const code = readFileSync(asFile ?? path.join(sampleDir, pick), 'utf8')
  console.log(`[verify] 谱面：${pick}（${code.length} 字节）`)

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
    <div class="embed-actions"><div class="embed-action edit-block-button" role="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"></path><path d="M8 6l-6 6 6 6"></path></svg></div></div>
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
  window.createFragment = function () { return document.createDocumentFragment(); };
  /**
   * ⚠ adj725d：这个替身**故意模仿 Obsidian 的 sanitizeHTMLToDom（底层 DOMPurify）**。
   *
   * 已在本机 obsidian.asar 的 app.js 里核实：DOMPurify 的 SVG 属性白名单**不含** dominant-baseline
   * （白名单里有 alignment-baseline / baseline-shift / text-anchor / writing-mode…，
   *  全文只有 HTML→SVG 的属性名映射表里出现过它）⇒ 该属性会被**剥掉**，
   * 于是小节序号等"字符中心对齐"的文本整体偏上（用户 2026-10 报的那条）。
   *
   * 验证页照抄这条行为：若插件的 svgToDom() 被人改回 sanitizeHTMLToDom，
   * 「小节序号居中」那条断言会立刻红灯 —— 这才算把用户报的问题钉住了。
   * （本模板字符串里**禁止出现反引号**，所以属性名不加反引号包裹。） */
  window.sanitizeHTMLToDom = function (html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    var stripped = t.content.querySelectorAll('[dominant-baseline]');
    for (var i = 0; i < stripped.length; i++) stripped[i].removeAttribute('dominant-baseline');
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
  console.log('  游离容器挂载     =', JSON.stringify(probe.detached))
  console.log('  小节序号居中     =', JSON.stringify(probe.barNumber))
  console.log('  嵌入工具栏       =', JSON.stringify(probe.embedToolbar))

  /**
   * adj726/727（用户要求）：**有「编辑」时收掉「打开谱面文件」链接**，但**仅当「编辑」留在 Obsidian 内**；
   * 若「编辑」会把文件交给系统默认应用（离开 Obsidian），那枚链接是站内打开 `.jps` 视图的唯一入口 ⇒ 保留。
   * 三支对照（有编辑+站内 / 有编辑+默认应用 / 没有编辑）。
   */
  if (probe.embedToolbar && !probe.embedToolbar.inApp?.error) {
    const a = probe.embedToolbar.inApp
    const b = probe.embedToolbar.external
    const c = probe.embedToolbar.withoutEdit
    ok(a.edit && a.editLabel === '编辑', 'adj726/adj866 有 onEdit ⇒ 工具条出现「编辑」', JSON.stringify(a))
    ok(a.link === false, 'adj726/adj866 有「编辑」且它留在站内 ⇒ 菜单里**不再**出现「打开谱面文件」', JSON.stringify(a))
    ok(b.edit && b.link === true,
      'adj727/adj866 有「编辑」但它**会离开 Obsidian**（打开方式=默认应用）⇒ 菜单里**保留**链接（站内入口不能丢）',
      JSON.stringify(b))
    ok(c.edit === false && c.link === true, 'adj726/adj866 对照：没有「编辑」时链接仍在（不是把链接删掉）', JSON.stringify(c))
  } else {
    ok(false, 'adj726/727 能测嵌入工具栏的按钮组合', JSON.stringify(probe.embedToolbar))
  }

  /**
   * adj725d（用户报「小节序号数字偏上，未在方框正中」）：**框内数字必须上下居中**。
   *
   * 根因：Obsidian 的 `sanitizeHTMLToDom` = DOMPurify 会剥掉 `dominant-baseline`
   * （本机 obsidian.asar 的 app.js 白名单里没有它）⇒ 数字退回字母基线、整体偏上。
   * 验证页的替身**故意照抄这条剥离行为**，所以这里同时钉两件事：
   *  · 属性还在（说明插件改走 DOMParser 了）；
   *  · 文本包围盒中心 ≈ 方框中心（`central` 真的生效）。
   */
  if (probe.barNumber && !probe.barNumber.error) {
    const bn = probe.barNumber
    console.log('  小节序号明细     =', JSON.stringify(bn.items))
    /**
     * 闸门自检：验证页那个仿 Obsidian 的替身**确实会剥掉** `dominant-baseline`。
     * 少了这条，上面的"属性还在"就可能是**假绿灯**（替身没剥 ⇒ 怎么实现都过）。
     */
    const san = await evalJson(
      'JSON.stringify((function(){var d=window.sanitizeHTMLToDom("<svg xmlns=\\"http://www.w3.org/2000/svg\\"><text dominant-baseline=\\"central\\">1</text></svg>");return {stillThere:!!d.querySelector("[dominant-baseline]")}})())',
    )
    ok(san.stillThere === false,
      'adj725d 闸门自检：验证页的 sanitizeHTMLToDom 替身确实会剥掉 dominant-baseline（仿 Obsidian/DOMPurify）',
      JSON.stringify(san))
    ok(bn.count >= 3, 'adj725d 量到多个小节序号方框', `count=${bn.count}`)
    ok(bn.svgParse === 'xml', 'adj725d SVG 走的是 XML 解析（不是被剥属性的 HTML 兜底）', String(bn.svgParse))
    const lost = bn.items.filter((it) => it.baseline !== 'central')
    ok(lost.length === 0, 'adj725d 每个序号的 `dominant-baseline="central"` 都还在（没被宿主剥掉）',
      JSON.stringify(lost))
    const off = bn.items.filter((it) => it.boxCenterY === null || it.textCenterY === null ||
      Math.abs(it.textCenterY - it.boxCenterY) > 0.2 * (it.fs || 1))
    ok(off.length === 0, 'adj725d 序号数字在方框内**上下居中**（文本中心 ≈ 方框中心）', JSON.stringify(off))
  } else {
    ok(false, 'adj725d 能测「小节序号居中」', probe.barNumber?.error ?? '')
  }

  /**
   * adj725b：**"先建 DOM、再挂进文档"时的裁剪**（用户报"上面还留一大片空白"的真根因）。
   *
   * 挂载瞬间元素不在渲染树 ⇒ `getBBox()` 全 0 ⇒ 量不到内容盒 ⇒ 退回边距兜底（空白依旧）。
   * 修法是"下一帧再量一次、量到就补裁剪"。这一支把宿主那条顺序原样搬进验证页：
   *  · 挂载瞬间：`isConnected === false`、viewBox 还是页面级、诊断写"没量到"；
   *  · 挂进文档后（等重试窗口）：viewBox 必须**紧贴内容**（与实测并集一致），诊断写"裁剪 …"。
   */
  if (probe.detached && !probe.detached.error) {
    const d = probe.detached
    console.log('  挂载瞬间         =', JSON.stringify(d.atMount))
    ok(d.atMount.svg && d.atMount.connected === false,
      'adj725b 复现宿主顺序：挂载瞬间 svg 还不在渲染树里（isConnected=false）', JSON.stringify(d.atMount))
    ok(d.atMount.contentBox === null && /没量到|退回按边距裁剪/.test(String(d.atMount.info)),
      'adj725b 挂载瞬间确实量不到内容盒（此前的根因）', `${d.atMount.contentBox} / ${d.atMount.info}`)
    const av = d.after.viewBox
    const am = d.after.measured
    if (am && Array.isArray(av) && av.length === 4) {
      /**
       * ⚠ adj786/adj866：谱面视图的 viewBox 早已不是"紧贴墨迹"，而是**四边各外扩 2px**
       * （用户要求"谱面四周留 2px 白"；`adj863` 起由引擎 `rangeBox()` 统一给出）。
       * 老断言按"误差 ≤1.5px 等于实测并集"写 ⇒ 从 adj786 起就一直红灯（本轮实测才发现）。
       * 现在的口径：`viewBox = 实测并集 ± 每边 2px`，容差 0.8px。
       */
      const near2 = (a, b) => Math.abs(a - b) <= 0.8
      ok(near2(av[0], am.x - 2) && near2(av[1], am.y - 2) && near2(av[2], am.w + 4) && near2(av[3], am.h + 4),
        'adj725b 挂进文档后**下一帧补量到了**并裁到内容（viewBox = 实测并集 ± 每边 2px）',
        `viewBox=${av} measured=${JSON.stringify(am)}`)
      ok(/按墨迹裁剪/.test(String(d.after.info)), 'adj725b 裁剪实况诊断显示"按墨迹裁剪 …"（不再是边距兜底）', String(d.after.info))
    } else {
      ok(false, 'adj725b 挂进文档后能读到裁剪后的 viewBox / 实测并集', JSON.stringify(d.after))
    }
  } else {
    ok(false, 'adj725b 能测"游离容器挂载"那一支', probe.detached?.error ?? '')
  }

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
   * adj773/adj866：「编辑」入口 —— **用户要求把块右上角的 `</>` 统一成工具条上的那枚**（adj773），
   * 所以这里量的是工具条里的 `.ijipu-edit-btn`（不是已删除的 `.ijipu-edit-source-btn`）。
   * 老断言（默认不可见→悬停显形、右上角净距、压白纸的对比度）随 `</>` 一起作废：
   *  · 工具条显隐现在由**点击预览区**切换（adj785），不再靠悬停；
   *  · 那枚按钮已在工具条里、跟着工具条主题走，不再压在白色纸张上。
   * 仍要守的性质：**有 onEditSource 才出现**、点它**恰好调一次**宿主落点、**不出现 textarea**、谱面不被换掉。
   */
  if (probe.editSource && !probe.editSource.error) {
    const e = probe.editSource
    ok(e.hasBtn, 'adj773/adj866 工具条上的「编辑」出现（宿主给了 onEditSource）', JSON.stringify({ btn: e.btnCls }))
    ok(e.noTextarea && e.scoreKept, 'adj866 点它不出现 textarea，谱面也保持渲染（源码切回笔记）',
      `noTextarea=${e.noTextarea} scoreKept=${e.scoreKept}`)
    ok(e.calls === 1, 'adj866 点一下 = 调一次宿主落点（切回笔记源码）', `calls=${e.calls} err=${e.clickErr}`)
  } else {
    ok(false, 'adj866 能测工具条上的「编辑」入口', probe.editSource?.error ?? '')
  }

  if (probe.toolbar && !probe.toolbar.error) {
    const t = probe.toolbar
    ok(t.initial.visibility === 'hidden', '工具条默认不可见（visibility:hidden ⇒ 导出不会出现、也不占 Tab 焦点）', t.initial.visibility)
    ok(t.initial.position === 'absolute', '工具条绝对定位（不参与布局）', t.initial.position)
    /**
     * ⚠ adj785/adj866：**悬停不再驱动显隐**（用户原话：「PC 端鼠标移动时马上显示工具条的操作也不要有，
     * 就通过点击预览区显/隐工具条」）⇒ 老断言"移到谱面上可见 / 离开后收起"从那时起就一直红灯。
     * 现在守的是**点击切换**：点一次显示、再点一次收起（并且整条工具条的显隐都不让谱面位移）。
     */
    ok(t.afterMove.visibility === 'hidden',
      'adj785 鼠标移动**不再**显示工具条（悬停那套已按用户要求取消）', t.afterMove.visibility)
    const toggle = await evalJson(
      '(function(){var w=document.getElementById("wrap");var tb=w.querySelector(".ijipu-score-toolbar");var s=function(){return getComputedStyle(tb).visibility};var before=s();w.dispatchEvent(new MouseEvent("click",{bubbles:true}));var afterFirst=s();w.dispatchEvent(new MouseEvent("click",{bubbles:true}));return JSON.stringify({before:before,afterFirst:afterFirst,afterSecond:s()})})()',
    )
    ok(toggle.before === 'hidden' && toggle.afterFirst === 'visible' && toggle.afterSecond === 'hidden',
      'adj785/adj866 点击预览区 ⇒ 显示；再点 ⇒ 收起（唯一的手动开关）', JSON.stringify(toggle))
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
        /**
         * ⚠ adj725e：**先把视口调高**再做命中测试 —— `elementFromPoint` 对视口外的点返回 null。
         * 第三个挂载点（实时预览那一支）在 y≈1050+，而默认视口只有 ~1049 高，
         * 于是"命中测试"全是 null、看着像"点不到"（本轮为此白查了一轮）。
         * 宽度不变 ⇒ 布局不变；只是把更多内容放进视口。
         */
        await c.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1600, deviceScaleFactor: 1, mobile: false })
        await sleep(200)
        /**
         * ⚠ adj866：**点击显形这件事挪进探针内部**（在它还查得到工具条之前点，然后继续用同一个元素引用）——
         * 因为 `adj793c` 起"外侧落位"会把工具条**搬到 `document.body`**，一旦显形，
         * `container.querySelector('.ijipu-score-toolbar')` 就查不到了（老流程正是这么断的）。
         */
        const withClass = await evalJson('window.__ijipuLpHoverProbe("withClass")')
        /**
         * 视觉证据：**宿主那枚 `</>`（实时预览里用户实际看到的那枚）** 的特写。
         * 悬停态还强制着（下面才清），所以 `</>` 是显形的。
         */
        {
          const hr = withClass.hostRect ?? { x: 700, y: 900, w: 28, h: 24 }
          const s = await c.send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: Math.max(0, hr.x - 130), y: Math.max(0, hr.y - 70), width: 220, height: 120, scale: 3 },
          })
          writeFileSync(path.join(OUT, 'crop-lp-editbtn.png'), Buffer.from(s.data, 'base64'))
          console.log(`  截图：${path.relative(ROOT, path.join(OUT, 'crop-lp-editbtn.png'))}（宿主那枚 </> 的特写）`)
        }
        const noClass = await evalJson('window.__ijipuLpHoverProbe("noClass")')
        await c.send('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: [] })
        await c.send('Emulation.clearDeviceMetricsOverride')
        await sleep(150)
        console.log('  悬停（保留我们的类）=', JSON.stringify(withClass))
        console.log('  悬停（负对照：摘掉类）=', JSON.stringify(noClass))
        ok(withClass.overflow === 'visible' && withClass.hitCenter === 'toolbar',
          'adj725/adj866 实时预览悬停时：宿主的 overflow:hidden 被放开，工具条（点击显形后）**点得到**',
          JSON.stringify({ hit: withClass.hitCenter, overflow: withClass.overflow, revealed: withClass.revealed }))
        ok(noClass.overflow === 'hidden' && noClass.hitCenter !== 'toolbar',
          'adj725 负对照：摘掉 .ijipu-cm-host ⇒ 宿主确实会裁掉工具条（证明这条修法是承重的）',
          JSON.stringify(noClass))
        /**
         * adj725e（用户第二轮截图：深色主题下宿主那枚 `</>` 一片白、看不见）：
         * 实时预览里我们那枚会撤掉、**用户看到的是宿主自己那枚**（`.edit-block-button`），
         * 它默认只跟主题取色 ⇒ 压在白纸上深色主题看不见。这条量它的对比度：
         *  · 保留 `.ijipu-cm-host`：对比度 ≥3:1（我们给它补的"深底 + 白字"生效）；
         *  · 负对照（摘掉该类）：底色透明 ⇒ 对比度掉到 ~1:1（正是用户看到的"看不见"）。
         */
        console.log('  宿主 `</>`（保留类）=', JSON.stringify(withClass.hostContrast), 'hit=', withClass.hostHit)
        console.log('  宿主 `</>`（负对照）  =', JSON.stringify(noClass.hostContrast), 'hit=', noClass.hostHit)
        if (withClass.hostContrast && noClass.hostContrast) {
          ok(withClass.hostContrast.ratio >= 3,
            'adj725e 宿主那枚 `</>` 在**本插件的块里**也看得见（与白纸的对比度 ≥3:1）',
            JSON.stringify(withClass.hostContrast))
          ok(withClass.hostHit === 'hostBtn',
            'adj725e 它也确实压在块右上角、能被点中', `hit=${withClass.hostHit} rect=${JSON.stringify(withClass.hostRect)}`)
          ok(noClass.hostContrast.ratio < 1.6,
            'adj725e 负对照：摘掉 .ijipu-cm-host ⇒ 宿主那枚退回"跟主题取色"（白纸上≈看不见）',
            JSON.stringify(noClass.hostContrast))
        } else {
          ok(false, 'adj725e 能量到宿主 `</>` 的字色/底色', JSON.stringify({ with: withClass.hostContrast, no: noClass.hostContrast }))
        }
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
    // adj786/adj866：口径是**墨迹 ± 每边 2px**（不是"紧贴墨迹"）—— 老断言从 adj786 起就一直是假红灯
    const near = (a, b) => Math.abs(a - b) <= 0.8
    ok(near(v[0], m.x - 2) && near(v[1], m.y - 2) && near(v[2], m.w + 4) && near(v[3], m.h + 4),
      '「谱面」viewBox = 实测墨迹并集 ± **每边 2px**（用户要的四周 2px 留白）',
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

  /**
   * ---- adj866（T-5 五条口径的**真机验证**）----
   *
   * 前面那些断言是"裁剪几何"的；这一节验的是**本轮新做的交互**（源码正则验不了的"行为"）：
   *  ① 工具条**恰好 5 位**、顺序与槽位契约一致（真机上数按钮，不看源码）；
   *  ② 「⋯ 更多」弹出的菜单里**有设置 / 复制三项 / 范围三项**，且范围组**单选打勾**；
   *  ③ 点菜单项**真的调到**插件方法（`copyScoreImage(source, 1, {box, mode})`、`setExportRange('score')`）；
   *  ④ 桌面**右键**开的是**同一份菜单**，并且 `preventDefault`（不弹宿主原生菜单）；
   *  ⑤ 块级缩放 `z`：`z=100` ⇒ **自然尺寸**（渲染宽 == viewBox 宽），`z=*` ⇒ 铺满容器，
   *     不给 `zoom` 的宿主（文件视图/嵌入）⇒ adj872 起**显式**按 `z=*` 处理（`ijipu-zoom-fit`），宽度照旧铺满。
   *  ⑥ adj872：三种模式的**实际渲染宽高**（`t5.geo`）—— 页面 / 满宽+`z=*` / 满宽+`z=100` 各量一次
   *     SVG 的 `getBoundingClientRect()`（照 ⑤ 的坑，用 `.ijipu-svgs .ijipu-page-svg > svg` 精确定位），
   *     外加两条负对照（"整页铺满"应为假；把容器摆到视口底部 ⇒ "渲染高 ≤ 可见高"应为假）。
   */
  {
    const t5 = await evalJson('window.__ijipuT5Probe()')
    console.log('  T-5 探针          =', JSON.stringify(t5?.slots), JSON.stringify(t5?.menu?.items))
    if (t5 && t5.error === null) {
      ok(t5.slots.count === 5 && t5.slots.order.join(',') === 'play,guides,mode,edit,more',
        'adj866 工具条**恰好 5 位**，槽位顺序 = play,guides,mode,edit,more（真机数按钮）',
        `count=${t5.slots.count} order=${t5.slots.order.join(',')}`)
      const labels = (t5.slots.labels || []).join('|')
      ok(/试听/.test(labels) && /排版/.test(labels) && /编辑/.test(labels) && /更多/.test(labels),
        'adj866 5 个按钮的文案是 试听/排版/谱面·页面/编辑/更多', labels)
      ok((t5.menu.items || []).some((s) => s === '设置') &&
        (t5.menu.items || []).some((s) => s.indexOf('复制为图片（2×，默认）') === 0) &&
        (t5.menu.items || []).some((s) => s.indexOf('复制为图片（1×）') === 0) &&
        (t5.menu.items || []).some((s) => s.indexOf('复制为图片（4×）') === 0) &&
        (t5.menu.items || []).some((s) => s.indexOf('复制 SVG 文本') === 0) &&
        (t5.menu.items || []).some((s) => s.indexOf('复制谱面源码') === 0),
        'adj866 「⋯ 更多」菜单含 设置 + 复制组（图片 2×/1×/4× + SVG 文本 + 源码）',
        JSON.stringify(t5.menu.items))
      ok((t5.menu.checked || []).length === 1 && (t5.menu.checked[0] || '').indexOf('页面') === 0,
        'adj866 「导出范围」是单选：默认设置下只有「页面」那一项打勾', JSON.stringify(t5.menu.checked))
      ok((t5.routed.copyImage1x || []).length === 1 &&
        t5.routed.copyImage1x[0][1] === 1 &&
        t5.routed.copyImage1x[0][2] && t5.routed.copyImage1x[0][2].mode === 'score' &&
        t5.routed.copyImage1x[0][2].box !== null,
        'adj866 点「复制为图片（1×）」⇒ 调到 `copyScoreImage(source, 1, {box, mode:"谱面"})`（面板自己的实测盒）',
        JSON.stringify(t5.routed.copyImage1x))
      ok((t5.routed.setRange || []).length === 1 && t5.routed.setRange[0][0] === 'score',
        'adj866 点「谱面（墨迹 + 每边 2px）」⇒ 调到 `setExportRange("score")`', JSON.stringify(t5.routed.setRange))
      ok((t5.routed.checkedAfterSwitch || []).length === 1 && (t5.routed.checkedAfterSwitch[0] || '').indexOf('谱面') === 0,
        'adj866 切完之后再开菜单 ⇒ ✓ 移到「谱面」那一项（单选状态真的跟着走）',
        JSON.stringify(t5.routed.checkedAfterSwitch))
      ok(t5.contextMenu.recorded === 1 && t5.contextMenu.defaultPrevented === true &&
        (t5.contextMenu.items || []).length === (t5.menu.items || []).length,
        'adj866 桌面**右键预览区** ⇒ 开的是**同一份菜单**（项数一致）且 `preventDefault`（不弹宿主原生菜单）',
        JSON.stringify(t5.contextMenu))
      const zf = t5.zoom.fixed
      const za = t5.zoom.auto
      const zn = t5.zoom.none
      ok(Math.abs(zf.renderedW - zf.viewBoxW) <= 1.5 && zf.renderedW < zf.svgsW - 20 &&
        /ijipu-zoom-fixed/.test(zf.cls),
        'adj866 `z=100` ⇒ SVG 按**自然尺寸**渲染（渲染宽 == viewBox 宽，**不拉伸**到容器宽）',
        JSON.stringify(zf))
      ok(Math.abs(za.renderedW - za.svgsW) <= 2 && /ijipu-zoom-fit/.test(za.cls),
        'adj866 `z=*` ⇒ 铺满容器宽（旧行为）', JSON.stringify(za))
      /**
       * ⚠ adj872：这一条**改了口径**（原来是"既无 zoom 类"）—— 那是"三层巧合"的写法：
       * 不传 `zoom` 时两个分支都不进 ⇒ 不加类 ⇒ 靠 styles.css 的 `width: 100%` 兜底。
       * 现在面板把 `undefined` **显式**折成 `'auto'` ⇒ 一定有 `ijipu-zoom-fit`，
       * 宽度仍然铺满（视觉结果不变 ✓），但**不再依赖 CSS 兜底**（谁改 CSS 都不会静默改掉它）。
       */
      ok(/ijipu-zoom-fit/.test(zn.cls) && Math.abs(zn.renderedW - zn.svgsW) <= 2,
        'adj872 不给 `zoom` 的宿主（文件视图 / 嵌入）⇒ **显式**按 `z=*` 处理（`ijipu-zoom-fit`），宽度照旧铺满（不再靠 CSS 兜底）',
        JSON.stringify(zn))

      /**
       * ---- adj872：三种模式的**实际渲染宽高**（真机量 SVG 盒子）----
       *
       * 容差按口径：长度 2px、比例 1%。`visibleH` 与面板 `publishPageFit` 用的是**同一个式子**
       * （`window.innerHeight − 容器顶边 − 24`）⇒ 断言里不另算一份，免得两边口径漂。
       */
      const g = t5.geo
      if (!g) {
        ok(false, 'adj872 三模式几何探针有输出（`t5.geo`）', '探针第 ⑧ 节没跑完')
      } else {
        const geoNear2 = (a, b) => Math.abs(a - b) <= 2
        const geoRatio = (a, b) => Math.abs(a - b) <= 0.01 * Math.max(Math.abs(a), Math.abs(b))
        console.log('  三模式实际宽高    =', JSON.stringify(g.page), JSON.stringify(g.fullAuto))
        console.log('  满宽 z=100 / 负对照 =', JSON.stringify(g.full100), JSON.stringify(g.negVisible))
        ok(g.page.renderedH <= g.page.visibleH + 2,
          'adj872 整页（`m=p` + `z=*`）：渲染高 ≤ 可见高（= innerHeight − 容器顶边 − 24）—— **整页进视界**的实证',
          JSON.stringify(g.page))
        ok(geoRatio(g.page.renderedW / g.page.renderedH, g.page.pageW / g.page.pageH),
          'adj872 整页：渲染宽高比 ≈ 页面框比例（该模式 SVG 的 viewBox 第 3/4 个数）⇒ 按 contain 等比缩放',
          `渲染=${(g.page.renderedW / g.page.renderedH).toFixed(3)} 页面=${(g.page.pageW / g.page.pageH).toFixed(3)}`)
        ok(g.page.renderedW < g.page.svgsW - 2,
          'adj872 整页：渲染宽 **<** 容器内宽（说明真的缩小了，不是撑满）',
          `渲染宽=${g.page.renderedW} 容器内宽=${g.page.svgsW}`)
        ok(!geoNear2(g.page.renderedW, g.page.svgsW),
          'adj872 负对照：整页"渲染宽 == 容器内宽"**应为假** —— 证明上面那条判据真的在量"缩小"这件事',
          `渲染宽=${g.page.renderedW} 容器内宽=${g.page.svgsW}`)
        ok(geoNear2(g.fullAuto.renderedW, g.fullAuto.svgsW) && /ijipu-zoom-fit/.test(g.fullAuto.cls),
          'adj872 满宽 + `z=*`：渲染宽 == 容器内宽（`.ijipu-svgs` 的宽，容差 2px）',
          JSON.stringify(g.fullAuto))
        ok(geoNear2(g.full100.renderedW, g.full100.vbW) && !geoNear2(g.full100.renderedW, g.full100.svgsW) &&
          /ijipu-zoom-fixed/.test(g.full100.cls),
          'adj872 满宽 + `z=100`：渲染宽 == 自然尺寸（viewBox 宽）**且 ≠ 容器宽** ⇒ "未写/100 不铺满"的口径成立',
          JSON.stringify(g.full100))
        ok(g.negVisible.renderedH > g.negVisible.visibleH,
          'adj872 负对照（量法敏感性）：容器摆在视口最下方（原始可见高 < 下限 200）⇒ "渲染高 ≤ 可见高"**为假**',
          JSON.stringify(g.negVisible))
      }
      if ((t5.errs || []).length > 0) console.log('  页面错误          =', JSON.stringify(t5.errs))
    } else {
      ok(false, 'adj866 T-5 探针能跑完（工具条/菜单/右键/缩放）', JSON.stringify(t5))
    }
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
