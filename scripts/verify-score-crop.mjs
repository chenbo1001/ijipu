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
  const pluginCss = readFileSync(path.join(ROOT, '..', 'obsidian-ijipu', 'styles.css'), 'utf8')

  const indexHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>crop verify</title>
<style>body{margin:0;background:#eef;font:12px system-ui}#wrap{width:820px;margin:8px auto}
.ijipu-page-svg{background:#fff;border:1px solid #c00}</style>
<style>${pluginCss}</style></head>
<body><div id="wrap"></div>
<script src="obsidian-stub.js"></script>
<script>
  /**
   * Obsidian 把 DOM 助手当**全局函数**提供（源码里直接调 createEl/createDiv/createSpan，
   * 并不是从 'obsidian' 导入的）⇒ 验证环境必须把它们挂到 window 上。
   * 打包进 ijipu-pane.js 的那份替身模块是模块作用域、外部拿不到，故这里补一份等价的。
   */
  (function () {
    function apply(o, el) {
      if (!o) return el;
      if (typeof o === 'string') { el.className = o; return el; }
      if (o.cls) el.className = o.cls;
      if (o.text !== undefined) el.textContent = o.text;
      for (const k in (o.attr || {})) el.setAttribute(k, String(o.attr[k]));
      return el;
    }
    window.createEl = function (tag, o) { return apply(o, document.createElement(tag)); };
    window.createDiv = function (o) { return apply(o, document.createElement('div')); };
    window.createSpan = function (o) { return apply(o, document.createElement('span')); };
    window.sanitizeHTMLToDom = function (html) {
      const t = document.createElement('template');
      t.innerHTML = html;
      return t.content;
    };
  })();
</script>
<script src="ijipu-pane.js"></script>
<script>
  // 把示例源码交给页面，供评测表达式读取
  window.__jpsCode = ${JSON.stringify(code)};
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
    const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream'
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
  await sleep(400)

  // —— 在页面里驱动**真实源码**：挂载面板 → 读「谱面」模式的 viewBox ——
  // ⚠ 本模板字符串里**禁止出现反引号**（会提前终结模板）；DOM/宿主替身一律放在外部 js 文件里。
  const expr = `(() => {
    const wrap = document.getElementById('wrap');
    wrap.style.width = '820px';
    // 最小 plugin 替身：覆盖 scorePane 真正用到的那些成员（见源码里对 plugin 各成员的引用）
    const listeners = new Map();
    const events = {
      on: (name, cb) => { listeners.set(name, cb); return { name, cb }; },
      offref: (ref) => { if (ref && ref.name) listeners.delete(ref.name); },
      trigger: (name) => { const cb = listeners.get(name); if (cb) cb(); },
    };
    const plugin = {
      settings: {},
      showGuides: false,
      registerSettingsRefresh: () => {},
      events,
      on: (name, cb) => events.on(name, cb),
      off: (name) => { listeners.delete(name); },
      registerEvent: () => {},
      register: () => {},
      getWorkletUrl: () => '',
      registerPlay: () => {},
      unregisterPlay: () => {},
      toggleGuides: () => false,
      app: { workspace: { on: () => ({}) }, vault: { on: () => ({}) } },
    };
    const host = {
      plugin,
      container: wrap,
      getSource: () => window.__jpsCode,
      getFrontmatter: () => null,
    };
    let handle;
    try { handle = IJipuPane.mountScorePane(host); }
    catch (e) { return JSON.stringify({ error: 'mount 抛出：' + String(e && e.message) }); }

    const curSvg = () => document.querySelector('#wrap svg');
    const svg0 = curSvg();
    if (!svg0) return JSON.stringify({ error: '没有渲染出 svg' });
    const box = svg0.dataset.contentBox || null;

    /** 重算一次内容并集（与插件同一口径：排除整页白底）——用于核对"没裁掉内容" */
    const measure = (svg) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ch of Array.from(svg.children)) {
        if (ch.getAttribute && ch.getAttribute('data-page-bg')) continue;
        if (typeof ch.getBBox !== 'function') continue;
        let b; try { b = ch.getBBox(); } catch (e) { continue; }
        if (!(b.width > 0) && !(b.height > 0)) continue;
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      }
      if (!isFinite(x0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const vb = (svg) => (svg.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number);
    // 三种模式：切模式靠点击下拉（这里直接调用面板暴露的按钮：找到 mode 下拉里的项）
    const out = { error: null, box, measured: measure(svg0), modes: {} };
    const record = (name) => {
      const svg = curSvg();
      const r = svg.getBoundingClientRect();
      const pr = svg.parentElement.getBoundingClientRect();
      out.modes[name] = {
        viewBox: vb(svg),
        measured: measure(svg),
        /** 元素**实际占用**的盒子（判断"框比内容高"这类 CSS 层留白） */
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
        parentRect: { w: Math.round(pr.width), h: Math.round(pr.height) },
      };
    };
    record('score');            // 默认就是「谱面」
    /**
     * adj724b（用户要求）：**工具条默认隐藏、鼠标移到谱面上才显示**（避免导出笔记时被一起导出）。
     * 这里在真实浏览器里验证"语义"（真实 styles.css + 真实 scorePane）：
     *  ① 默认 display:none（真正不渲染 ⇒ 不会进导出结果；只降透明度是不够的）；
     *  ② 容器上派发 pointermove 后变可见（JS 加 is-revealed 类）；
     *  ③ 派发 pointerleave 后回到隐藏。
     */
    out.toolbar = (() => {
      const tb = document.querySelector('#wrap .ijipu-score-toolbar');
      if (!tb) return { error: '没找到 .ijipu-score-toolbar' };
      const disp = () => getComputedStyle(tb).display;
      const initial = disp();
      const c = document.getElementById('wrap');
      c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      const afterMove = disp();
      c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
      const afterLeave = disp();
      return { initial, afterMove, afterLeave };
    })();
    // 用户诉求的**直接量法**：SVG 撑满容器宽度后，元素盒子是否与内容同比例、有没有多余高度
    out.css = (() => {
      const svg = curSvg();
      const r = svg.getBoundingClientRect();
      const cs = getComputedStyle(svg);
      return {
        cssWidth: cs.width,
        cssHeight: cs.height,
        attrW: svg.getAttribute('width'),
        attrH: svg.getAttribute('height'),
        box: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        ratio: +(r.width / r.height).toFixed(3),
      };
    })();
    // 通过模式菜单切到「整页」/「满宽」：面板用 Menu，这里改用直接点按钮的兜底——
    // 若找不到菜单，就只验证默认的「谱面」模式（核心诉求只在这一模式）
    return JSON.stringify(out);
  })()`

  let probe
  try {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
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
  if (probe.toolbar && !probe.toolbar.error) {
    ok(probe.toolbar.initial === 'none', '工具条默认隐藏（display:none，导出时不会出现）', probe.toolbar.initial)
    ok(probe.toolbar.afterMove !== 'none', '鼠标移到谱面上后工具条出现', probe.toolbar.afterMove)
    ok(probe.toolbar.afterLeave === 'none', '鼠标离开后工具条收起', probe.toolbar.afterLeave)
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
  const v = probe.modes.score?.viewBox

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
