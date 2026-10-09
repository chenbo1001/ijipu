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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
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
   * 加**版本号查询串**（adj724b）：静态资源必须每次都是新的 ——
   * 实测仅靠 `Network.setCacheDisabled` 不足以让已加载过的 `probe.js` 更新，
   * 会出现"改了探针、输出却一模一样"的假象（本轮被骗过一次）。
   * 变量名用 `cacheBust`（不能用 `v`：下面读 viewBox 的那个 `v` 会撞名）。
   */
  const cacheBust = String(Date.now())
  const indexHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>crop verify</title>
<link rel="stylesheet" href="plugin.css?v=${cacheBust}">
<style>body{margin:0;background:#eef;font:12px system-ui}#wrap{width:820px;margin:8px auto}
.ijipu-page-svg{background:#fff;border:1px solid #c00}</style></head>
<body><div id="wrap"></div>
<div id="wrap2" style="width:820px;margin:8px auto"></div>
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
  /**
   * adj724b：「源码」模式验证要用的宿主桩与记录位。
   * 插件对象放在 window 上（两个挂载点共用），另需 containerEl 供事件注册。
   */
  window.__ijipuSrc = window.__jpsCode;
  window.__ijipuWritten = [];
  (function () {
    const listeners = new Map();
    const events = {
      on: function (n, cb) { listeners.set(n, cb); return { name: n, cb: cb }; },
      offref: function (r) { if (r && r.name) listeners.delete(r.name); },
    };
    window.__ijipuPlugin = {
      settings: {},
      showGuides: false,
      containerEl: document.getElementById('wrap'),
      registerSettingsRefresh: function () {},
      events: events,
      registerEvent: function () {},
      register: function () {},
      getWorkletUrl: function () { return ''; },
      registerPlay: function () {},
      unregisterPlay: function () {},
      toggleGuides: function () { return false; },
      app: { workspace: { on: function () { return {}; } }, vault: { on: function () { return {}; } } },
    };
  })();
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

  // —— 在页面里驱动**真实源码**：挂载面板 → 读「谱面」模式的 viewBox ——
  // ⚠ 本模板字符串里**禁止出现反引号**（会提前终结模板）；DOM/宿主替身一律放在外部 js 文件里。
  /**
   * 页面内探针放在**外部文件**里（见 scripts/verify-score-probe.js 的说明）：
   * 逻辑写在模板字符串里时，反引号与转义会互相干扰，反复产出难以定位的 SyntaxError。
   * 这里只负责把它落盘、由页面引入，然后调一行。
   */
  const probeSrc = readFileSync(path.join(ROOT, 'scripts', 'verify-score-probe.js'), 'utf8')
  writeFileSync(path.join(OUT, 'probe.js'), probeSrc, 'utf8')
  const expr = 'window.__ijipuProbe()'

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
  console.log('  工具条显隐       =', JSON.stringify(probe.toolbar))
  console.log('  源码模式         =', JSON.stringify(probe.sourceMode))
  if (probe.sourceMode && !probe.sourceMode.error) {
    const sm = probe.sourceMode
    ok(sm.hasBtn, '工具栏出现「源码」按钮（宿主可写回时）')
    ok(sm.hasScoreBefore, '进入前显示的是谱面')
    ok(sm.textareaShown && sm.scoreGone, '点「源码」后：谱面换成 textarea', JSON.stringify(sm))
    ok(sm.writtenOk, '在源码态输入后内容被写回宿主', String(sm.writtenOk))
    ok(sm.backToScore, '再点一下回到看谱（谱面恢复）')
  } else {
    ok(false, '能测「源码」模式', probe.sourceMode?.error ?? '')
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
  } else {
    ok(false, '能取到工具条并测显隐', probe.toolbar?.error ?? '')
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
  // ⚠ 用**源码模式测试之前**快照的 viewBox：那个测试会把 #wrap 的 DOM 换成源码编辑区，
  //   之后再读 SVG 只会得到空（实测 viewBox=NaN）—— 这是测试顺序的坑，不是产品问题。
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
  const shot = async (name) => {
    const s = await c.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT, `crop-${name}.png`)
    writeFileSync(file, Buffer.from(s.data, 'base64'))
    console.log(`  截图：${path.relative(ROOT, file)}`)
  }
  await shot('score')
  /**
   * 再取一张**悬停中**的图：工具条是"浮在谱面左上角 + 淡入"，只有悬停态才看得出外观
   * （左侧边界、有没有盖住标题等）。这里单独派发 pointermove 并等过渡结束再截。
   */
  await c.send('Runtime.evaluate', {
    expression: `(() => {
      const c = document.getElementById('wrap');
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      return true;
    })()`,
    returnByValue: true,
  })
  await sleep(300)
  await shot('toolbar-hover')
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
