/**
 * scripts/verify-score-probe.js — 「谱面」裁剪 / 工具条位置 / 「编辑源码」入口 的**页面内探针**
 *
 * 为什么单独成文件（adj724b 的教训）：这些逻辑原先写在 verify 脚本的**模板字符串**里，
 * 而模板里的反引号、换行转义、美元花括号会互相干扰，反复产出
 * SyntaxError: Invalid or unexpected token —— 更要命的是报错行号落在别的脚本里，极难定位。
 * 现在一律放外部文件，verify 脚本只负责引入并调用一行。
 *
 * 约定：页面需先准备好（见 verify 脚本注入的 HTML）
 *  · `window.__ijipuPlugin`、`window.__jpsCode`（示例谱源码）；
 *  · 三个挂载点：`#wrap`（阅读模式：`el` 就是 `.block-language-jps`）、
 *    `#wrap2`（「编辑源码」入口）、`#wrap3`（**实时预览**：套在 `.cm-embed-block` 里）
 *    —— `#wrap3` 那一支用来量"工具条浮到块外会不会被宿主的 `overflow: hidden` 裁掉"。
 *
 * ⚠ 模板字符串里**禁止出现反引号**；本文件由 verify 脚本原样落盘后由页面引入。
 */
window.__ijipuProbe = async function () {
  try {
    return await __ijipuProbeBody();
  } catch (e) {
    return JSON.stringify({ fatal: String(e && e.message), stack: String(e && e.stack).slice(0, 900) });
  }
};
window.__ijipuProbeBody = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 最小 plugin 替身：覆盖 scorePane 真正用到的那些成员。
   * ⚠ **每个挂载点一个独立实例**（但共用同一条事件总线）——此前复用同一个对象、
   *   只改 `containerEl`，结果 `paint()` 把**前一个挂载点**清空了（工具的坑，不是插件的坑）。
   */
  const listeners = new Map();
  const events = {
    on: (name, cb) => { listeners.set(name, cb); return { name, cb }; },
    offref: (ref) => { if (ref && ref.name) listeners.delete(ref.name); },
    trigger: (name) => { const cb = listeners.get(name); if (cb) cb(); },
  };
  const makePlugin = (containerEl) => ({
    settings: {},
    showGuides: false,
    containerEl,
    events,
    registerEvent: () => {},
    register: () => {},
    getWorkletUrl: () => '',
    registerPlay: () => {},
    unregisterPlay: () => {},
    toggleGuides: () => false,
    app: { workspace: { on: () => ({}) }, vault: { on: () => ({}) } },
  });

  const wrap = document.getElementById('wrap');
  wrap.style.width = '820px';
  let handle;
  try {
    handle = IJipuPane.mountScorePane({
      plugin: makePlugin(wrap),
      container: wrap,
      getSource: () => window.__jpsCode,
      getFrontmatter: () => null,
    });
  } catch (e) {
    return JSON.stringify({ error: 'mount 抛出：' + String(e && e.message) });
  }

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
  const vb = (svg) => (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
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
   * adj724b（用户要求）：工具条**悬停淡入、显隐不让谱面位移**；
   * adj725（用户要求）：工具条要落在**谱面块外侧**（正上方、左缘对齐）。
   *
   * 在真实浏览器里量（真实 styles.css + 真实 scorePane）：
   *  ① 默认不可见（visibility: hidden，**绝对定位 ⇒ 不占位**）；
   *  ② 容器上派发 pointermove 后 visibility: visible（JS 加 is-revealed 类）；
   *  ③ 派发 pointerleave 后回到 hidden；
   *  ④ 整个显隐过程中，谱面 SVG 的 getBoundingClientRect().top **不变**（不位移）；
   *  ⑤ **几何**：工具条整条在容器（`.ijipu-score`）顶边之上、左缘与容器对齐 ⇒ "不压谱面"。
   */
  out.toolbar = (async () => {
    const tb = document.querySelector('#wrap .ijipu-score-toolbar');
    if (!tb) return { error: '没找到 .ijipu-score-toolbar' };
    const svg = curSvg();
    const cs = () => getComputedStyle(tb);
    const snap = () => ({ visibility: cs().visibility, opacity: cs().opacity });
    const initial = { ...snap(), position: cs().position };
    /** 诊断：浮层外观是否真的应用上了（截图看着像竖排、无背景 ⇒ 打出来核对） */
    const look = {
      display: cs().display,
      flexDirection: cs().flexDirection,
      background: cs().backgroundColor,
      padding: cs().padding,
      zIndex: cs().zIndex,
      width: Math.round(tb.getBoundingClientRect().width),
      height: Math.round(tb.getBoundingClientRect().height),
      cls: tb.className,
    };
    const topBefore = svg.getBoundingClientRect().top;
    const c = document.getElementById('wrap');
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    // ⚠ 必须等过渡跑完再读：opacity 有 120ms 过渡、visibility 有 120ms 延迟，
    //    同步读 getComputedStyle 会拿到中间值（实测读到 opacity:0 / visibility:visible）
    await sleep(260);
    const afterMove = snap();
    const topAfterReveal = svg.getBoundingClientRect().top;
    /**
     * adj725 几何：工具条**整条在块外**（下边缘 ≤ 容器顶边）、左缘与容器对齐。
     * 读的是 `getBoundingClientRect()`（真实布局），不是 CSS 文本 —— 换行、缩放都算进去。
     * 悬停**期间**留证：交给外层截图（见 verify 脚本的 hover 截图步骤）。
     */
    const wrapRect = c.getBoundingClientRect();
    const tbRect = tb.getBoundingClientRect();
    const geometry = {
      toolbarBottom: +tbRect.bottom.toFixed(1),
      toolbarLeft: +tbRect.left.toFixed(1),
      containerTop: +wrapRect.top.toFixed(1),
      containerLeft: +wrapRect.left.toFixed(1),
      /** 工具条与块顶边的缝（应为 +2，即 CSS 里那 2px） */
      gap: +(wrapRect.top - tbRect.bottom).toFixed(1),
      aboveContainer: tbRect.bottom <= wrapRect.top + 1,
      leftAligned: Math.abs(tbRect.left - wrapRect.left) <= 1,
      /** 完全落在块外 = 不压谱面（块内一切内容都在 containerTop 之下） */
      outsideContainer: tbRect.bottom <= wrapRect.top,
    };
    window.__ijipuToolbarRevealed = true;
    c.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
    await sleep(260);
    const afterLeave = snap();
    const topAfterLeave = svg.getBoundingClientRect().top;
    return {
      initial,
      look,
      afterMove,
      afterLeave,
      geometry,
      shift: {
        before: +topBefore.toFixed(1),
        afterReveal: +topAfterReveal.toFixed(1),
        afterLeave: +topAfterLeave.toFixed(1),
      },
    };
  })();

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
  /**
   * adj725（用户要求）：**谱面块四周只留 2px 留白**。
   * 直接量"墨迹 → 块外缘"的净距：块（`.ijipu-score`）内边距 + SVG 与块的间隙。
   * 口径：容器 rect 与 svg rect 之差（左右/上下各取最小），单位 px。
   */
  out.padding = (() => {
    const svg = curSvg();
    const inner = svg.closest('.ijipu-svgs');
    const box = document.getElementById('wrap').getBoundingClientRect();
    const r = (inner || svg).getBoundingClientRect();
    return {
      left: +(r.left - box.left).toFixed(1),
      right: +(box.right - r.right).toFixed(1),
      top: +(r.top - box.top).toFixed(1),
      bottom: +(box.bottom - r.bottom).toFixed(1),
      containerCls: document.getElementById('wrap').className,
    };
  })();
  /** 编辑入口测试会把 #wrap2 的 DOM 建起来；这里先把「谱面」viewBox 快照存下来（顺序很关键） */
  out.vbBeforeSource = (() => {
    const svg = curSvg();
    return svg ? (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null;
  })();

  /**
   * adj725（用户要求）：**块右上角的 `</>`「编辑源码」**。
   *
   * 用户口径：「切源码方式是在预览的笔记源码间切换，源码如图，不要再单独的 textarea」
   * +「编辑切换如图的右上角方式」。
   *
   * 验证四件事：
   *  ① 宿主给了 `onEditSource` 才出现；
   *  ② 位置 = 块的**右上角**（内缩几像素，与 Obsidian 的 `.embed-actions` 同款）；
   *  ③ 默认不可见、悬停显形（与工具条同一套）；
   *  ④ 点击 = 调宿主的落点**一次**，且**不再**出现 textarea、谱面也**不被换掉**。
   */
  out.editSource = await (async () => {
    const host2 = {
      plugin: makePlugin(document.getElementById('wrap2')),
      container: document.getElementById('wrap2'),
      getSource: () => window.__ijipuSrc,
      getFrontmatter: () => null,
      onEditSource: () => { window.__ijipuEditCalls = (window.__ijipuEditCalls || 0) + 1; },
    };
    let h2;
    try { h2 = IJipuPane.mountScorePane(host2); }
    catch (e) { return { error: 'mount2 抛出：' + String(e && e.message) }; }
    const q = (sel) => document.querySelector('#wrap2 ' + sel);
    const btn = q('.ijipu-edit-source-btn');
    const box2 = document.getElementById('wrap2').getBoundingClientRect();
    const btnRect = btn ? btn.getBoundingClientRect() : null;
    const hidden = btn ? getComputedStyle(btn).visibility : null;
    document.getElementById('wrap2').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    await sleep(260);
    const shown = btn ? getComputedStyle(btn).visibility : null;
    window.__ijipuEditCalls = 0;
    try { btn?.click(); } catch (e) { window.__ijipuEditErr = String(e && e.message); }
    await sleep(40);
    const res = {
      hasBtn: !!btn,
      hasScore: !!q('svg'),
      noTextarea: !q('textarea') && !q('.ijipu-block-source-editor'),
      scoreKept: !!q('.ijipu-svgs'),
      hidden,
      shown,
      calls: window.__ijipuEditCalls || 0,
      clickErr: window.__ijipuEditErr || null,
      /**
       * adj725c（用户报「`</>` 看不见」）：**按合成后的颜色实算对比度**。
       *
       * 按钮压在**恒为白色**的谱面纸张上，而它的底色是半透明的 ⇒ 真实观感取决于
       * "字色 vs （底色合成到白纸）"。这里把两个颜色取出来、按 alpha 合成到白底上，
       * 用 WCAG 的相对亮度公式算对比度，交给 verify 脚本断言（≥3:1 是图形类的最低线）。
       */
      contrast: (() => {
        if (!btn) return null
        const cs = getComputedStyle(btn)
        const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number)
        const lum = (r, g, b) => {
          const f = (c) => {
            const v = c / 255
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
          }
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        const fg = nums(cs.color)
        const bg = nums(cs.backgroundColor)
        if (fg.length < 3 || bg.length < 3) return null
        const a = bg.length > 3 ? bg[3] : 1
        const comp = [0, 1, 2].map((i) => bg[i] * a + 255 * (1 - a)) // 纸张恒为白
        const l1 = lum(fg[0], fg[1], fg[2])
        const l2 = lum(comp[0], comp[1], comp[2])
        return {
          fg: cs.color,
          bg: cs.backgroundColor,
          compositedOnPaper: comp.map((v) => Math.round(v)),
          ratio: +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)),
        }
      })(),
      /** 右上角：与容器右缘/顶边的净距（应各 ~4px，即 `--size-2-2`） */
      gaps: btnRect
        ? { right: +(box2.right - btnRect.right).toFixed(1), top: +(btnRect.top - box2.top).toFixed(1) }
        : null,
    };
    /**
     * ⚠ **刻意不 destroy**：这一支要继续留在页面上，供外层截"悬停中的界面"那张图
     * （要人眼确认 `</>` 真的落在块右上角、工具条真的在块外）—— 验证页是一次性的。
     */
    return res;
  })();

  /**
   * adj725：**实时预览**那一支（`#wrap3` 在 `.cm-embed-block.cm-lang-jps` 里）。
   *
   * 这里只做"页面内能做的"：挂载、确认宿主 widget 类被加上、把工具条悬停显形、
   * 量它的位置与**命中点**。真正的 `:hover` 伪类由 verify 脚本用 CDP 强制
   * （`CSS.forcePseudoState`）——只有那样才能验证"宿主 `overflow: hidden` 会不会把工具条裁掉"。
   */
  out.lp = await (async () => {
    const embed = document.getElementById('lpEmbed');
    const container3 = document.getElementById('wrap3');
    if (!embed || !container3) return { error: '页面里没有 #lpEmbed / #wrap3' };
    const host3 = {
      plugin: makePlugin(container3),
      container: container3,
      getSource: () => window.__jpsCode,
      getFrontmatter: () => null,
      onEditSource: () => {},
    };
    let h3;
    try { h3 = IJipuPane.mountScorePane(host3); }
    catch (e) { return { error: 'mount3 抛出：' + String(e && e.message) }; }
    // 等"下一帧查宿主按钮"那次 setTimeout 跑完（宿主已有 .embed-actions ⇒ 我们不该重复挂）
    await sleep(60);
    container3.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    await sleep(260);
    const tb = container3.querySelector('.ijipu-score-toolbar');
    const r = tb.getBoundingClientRect();
    return {
      hostClass: embed.className,
      hostActions: !!embed.querySelector('.embed-actions'),
      ourEditBtn: !!container3.querySelector('.ijipu-edit-source-btn'),
      overflow: getComputedStyle(embed).overflow,
      hoverMedia: window.matchMedia('(hover: hover)').matches,
      toolbarRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      /** 命中点：工具条中心处最顶层、可命中的元素（被裁掉时不会是工具条） */
      hitCenter: (() => {
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (!el) return null;
        return el.closest('.ijipu-score-toolbar') ? 'toolbar' : (el.id || el.className || el.tagName);
      })(),
      pageErrs: (window.__ijipuErrs || []).slice(-4),
    };
  })();

  /**
   * adj725b：**复现宿主的真实挂载顺序** —— Obsidian 的代码块/widget 是"**先建 DOM、再挂进文档**"
   * （实时预览 `initDOM` 建的是游离节点；阅读模式同理）。
   *
   * 挂载那一刻元素不在渲染树里 ⇒ `getBBox()` 一律返回 0 ⇒ 量不到内容盒 ⇒ 只能退回"按边距裁"，
   * 现象正是用户报的「谱面模式上面/下面还留一大片空白」。
   * 本仓库此前的验证页把面板挂在**已连接**的容器里，所以怎么测都是好的 —— 这一支专门补上。
   *
   * 判据：挂载瞬间 `isConnected === false` 且 viewBox 还是"页面级"；
   * 挂进文档后（等重试窗口跑完：rAF / 60ms / 300ms）viewBox 必须变成**紧贴内容**。
   */
  out.detached = await (async () => {
    const boxEl = document.createElement('div')
    boxEl.id = 'wrap4'
    boxEl.style.width = '820px'
    const plugin4 = makePlugin(boxEl)
    let h4
    try {
      h4 = IJipuPane.mountScorePane({
        plugin: plugin4,
        container: boxEl,
        getSource: () => window.__jpsCode,
        getFrontmatter: () => null,
      })
    } catch (e) {
      return { error: 'mount4 抛出：' + String(e && e.message) }
    }
    const svgAtMount = boxEl.querySelector('svg')
    const atMount = {
      svg: !!svgAtMount,
      connected: !!(svgAtMount && svgAtMount.isConnected),
      contentBox: svgAtMount ? (svgAtMount.dataset.contentBox || null) : null,
      viewBox: svgAtMount ? (svgAtMount.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null,
      info: plugin4.lastCropInfo || null,
    }
    // 「宿主把这块挂进笔记」——此后元素才进渲染树
    document.body.appendChild(boxEl)
    await sleep(500) // 重试窗口：rAF / +60ms / +300ms
    const svg = boxEl.querySelector('svg')
    const after = {
      connected: !!(svg && svg.isConnected),
      contentBox: svg ? (svg.dataset.contentBox || null) : null,
      viewBox: svg ? (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number) : null,
      measured: svg ? measure(svg) : null,
      info: plugin4.lastCropInfo || null,
    }
    h4?.destroy?.()
    boxEl.remove()
    return { atMount, after }
  })();

  /**
   * adj725d：**小节序号（框内数字）必须上下居中**。
   *
   * 复现的正是宿主那条：Obsidian 的 `sanitizeHTMLToDom`（DOMPurify）会**剥掉 `dominant-baseline`**
   * （见 verify 脚本里那个仿照它的替身）⇒ 数字退回字母基线、整体偏上。
   * 这里挂一个小谱（`showBarCount: true`），逐个方框量：
   *  · 文本上还有没有 `dominant-baseline="central"`（属性有没有被剥掉）；
   *  · 文本包围盒中心 vs 方框中心（`central` 生效时两者应当重合）。
   */
  out.barNumber = await (async () => {
    /** 12 小节（序号默认每 4 小节一个 ⇒ 应有 4/8/12 三个方框，够做"逐个居中"的判断） */
    const BAR = '1 2 3 4 | 5 6 7 1\' | 2\' 1\' 7 6 | 5 - - - |'
    const BAR12 = BAR + ' ' + BAR + ' ' + BAR
    const boxEl = document.createElement('div')
    boxEl.id = 'wrap5'
    boxEl.style.width = '820px'
    document.body.appendChild(boxEl)
    const src = '# jps-config:{"showBarCount":true}\nB: 序号居中\nD: C\nP: 4/4\nJ: 60\nQ: ' + BAR12 + '\n'
    const plugin5 = makePlugin(boxEl)
    let h5
    try {
      h5 = IJipuPane.mountScorePane({
        plugin: plugin5,
        container: boxEl,
        getSource: () => src,
        getFrontmatter: () => null,
      })
    } catch (e) {
      return { error: 'mount5 抛出：' + String(e && e.message) }
    }
    await sleep(80)
    const groups = Array.prototype.slice.call(boxEl.querySelectorAll('[data-barnumber]'))
    const items = groups.map((g) => {
      const rect = g.querySelector('rect')
      const text = g.querySelector('text')
      const rb = rect ? rect.getBBox() : null
      const tb = text ? text.getBBox() : null
      return {
        n: g.getAttribute('data-barnumber'),
        baseline: text ? text.getAttribute('dominant-baseline') : null,
        boxCenterY: rb ? +(rb.y + rb.height / 2).toFixed(3) : null,
        textCenterY: tb ? +(tb.y + tb.height / 2).toFixed(3) : null,
        fs: text ? +Number(text.getAttribute('font-size')).toFixed(2) : null,
      }
    })
    const res = { count: items.length, svgParse: plugin5.lastSvgParse || null, items }
    h5?.destroy?.()
    boxEl.remove()
    return res
  })();

  // 工具条那段显隐/几何验证是异步的（要等过渡跑完才能读到终值）⇒ **先 await 再赋值**，
  // 否则 out.toolbar 是个 Promise，JSON.stringify 会变成 {}
  out.toolbar = await out.toolbar;
  return JSON.stringify(out);
};

/**
 * adj725：**实时预览里的裁剪验证**（供 verify 脚本在强制 `:hover` 之后调用）。
 *
 * 为什么要分两步：`:hover` 是伪类，页面脚本**无法**用 `dispatchEvent` 造出来
 * （派发 pointermove 只会触发我们自己的 JS，不会让 CSS 的 `:hover` 匹配）。
 * 只有 CDP 的 `CSS.forcePseudoState` 能强制它 —— 于是这里只负责"量"，强制那一步在 Node 侧。
 *
 * @param mode 'withClass' = 保留 `.ijipu-cm-host`（我们的修法）；'noClass' = 摘掉它（负对照）
 */
window.__ijipuLpHoverProbe = function (mode) {
  const embed = document.getElementById('lpEmbed');
  const container3 = document.getElementById('wrap3');
  if (!embed || !container3) return JSON.stringify({ error: '没有 #lpEmbed / #wrap3' });
  if (mode === 'noClass') embed.classList.remove('ijipu-cm-host');
  const tb = container3.querySelector('.ijipu-score-toolbar');
  if (!tb) return JSON.stringify({ error: '没有工具条' });
  const r = tb.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return JSON.stringify({
    mode,
    hasClass: embed.classList.contains('ijipu-cm-host'),
    overflow: getComputedStyle(embed).overflow,
    toolbarRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    hitCenter: el ? (el.closest('.ijipu-score-toolbar') ? 'toolbar' : (el.id || el.className || el.tagName)) : null,
  });
};
