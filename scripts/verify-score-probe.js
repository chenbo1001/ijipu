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
/**
 * adj725c/725e：按"字色 vs 底色（合成到**白纸**）"实算 WCAG 对比度。
 *
 * 为什么按白纸合成：谱面纸张恒为白色（`.ijipu-svgs .ijipu-page-svg > svg { background: #ffffff }`），
 * 而块右上角那两枚 `</>`（本插件的一枚 + 宿主自己的一枚）就压在白纸上；
 * 底色是半透明的 ⇒ 真实观感 = 字色 vs 底色合成到白之后的结果。
 */
window.__ijipuContrastOnPaper = function (el) {
  if (!el) return null
  const cs = getComputedStyle(el)
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
  const comp = [0, 1, 2].map((i) => bg[i] * a + 255 * (1 - a))
  const l1 = lum(fg[0], fg[1], fg[2])
  const l2 = lum(comp[0], comp[1], comp[2])
  return {
    fg: cs.color,
    bg: cs.backgroundColor,
    compositedOnPaper: comp.map((v) => Math.round(v)),
    ratio: +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)),
  }
};

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
    /**
     * adj773/adj866：编辑入口**已统一成工具条上那枚**（`.ijipu-edit-btn`）——
     * 块右上角的 `.ijipu-edit-source-btn` 是用户要求删掉的旧形态（老探针还在找它 ⇒ 一直被当成"没出现"✗）。
     */
    const btn = q('.ijipu-edit-btn');
    const btnCls = btn ? btn.className : null;
    window.__ijipuEditCalls = 0;
    try { btn?.click(); } catch (e) { window.__ijipuEditErr = String(e && e.message); }
    await sleep(40);
    return {
      hasBtn: !!btn,
      btnCls,
      hasScore: !!q('svg'),
      noTextarea: !q('textarea') && !q('.ijipu-block-source-editor'),
      scoreKept: !!q('.ijipu-svgs'),
      calls: window.__ijipuEditCalls || 0,
      clickErr: window.__ijipuEditErr || null,
    };
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

  /**
   * adj726/727（用户要求）：**有了「编辑」按钮之后就收掉「打开谱面文件」链接**；
   * adj727 细化：**仅当「编辑」留在 Obsidian 内时收掉** —— 若「编辑」会把文件交给系统默认应用
   * （离开 Obsidian），那枚链接是"在站内打开 `.jps` 视图"的唯一入口 ⇒ 保留。
   *
   * 三支对照（防止后人把判据改坏）：
   *  ① 有编辑 + 站内（`editLeavesObsidian` 未给/false）⇒ 链接**不在**；
   *  ② 有编辑 + 默认应用（`editLeavesObsidian: true`）  ⇒ 链接**在**；
   *  ③ 没有编辑（宿主没给 `onEdit`）              ⇒ 链接**在**（回退路径不许删）。
   */
  out.embedToolbar = await (async () => {
    const mountOne = async (id, opts) => {
      const el = document.createElement('div')
      el.id = id
      el.style.width = '820px'
      document.body.appendChild(el)
      const host = {
        plugin: makePlugin(el),
        container: el,
        embedded: true,
        embedTitle: '茶花开了',
        getSource: () => window.__jpsCode,
        getFrontmatter: () => null,
        onOpenFile: () => {},
        filePath: '曲谱集/茶花开了.jps',
      }
      if (opts.withEdit) host.onEdit = () => {}
      if (opts.leavesObsidian) host.editLeavesObsidian = true
      let h
      try {
        h = IJipuPane.mountScorePane(host)
      } catch (e) {
        el.remove()
        return { error: 'mount 抛出：' + String(e && e.message) }
      }
      await sleep(40)
      /**
       * adj863/adj866：**「打开谱面文件」已从工具条移进「⋯ 更多」菜单**（工具条定稿 5 位），
       * 所以这里改成"开一次菜单、看里面有没有那一项" —— 老探针查 `.ijipu-embed-link` 元素，
       * 从 adj863 起必然落空（那是"入口搬家"造成的假红灯，不是行为变了）。
       * 工具条上现在只有统一的那枚「编辑」（`.ijipu-edit-btn`）。
       */
      globalThis.__ijipuMenus = []
      const more = el.querySelector('.ijipu-more-btn')
      if (more) more.click()
      await sleep(20)
      const items = ((globalThis.__ijipuMenus || [])[0] || []).filter((it) => !it.isLabel).map((it) => it.title)
      const editBtn = el.querySelector('.ijipu-edit-btn')
      const res = {
        case: opts.name,
        edit: !!editBtn,
        editLabel: (el.querySelector('.ijipu-edit-btn .ijipu-btn-label') || {}).textContent || null,
        menuItems: items,
        link: items.some((t) => t.indexOf('打开谱面文件') === 0),
        linkLabel: (items.find((t) => t.indexOf('打开谱面文件') === 0) || null),
      }
      h?.destroy?.()
      el.remove()
      return res
    }
    return {
      inApp: await mountOne('wrap6', { name: '有编辑+站内', withEdit: true }),
      external: await mountOne('wrap7', { name: '有编辑+默认应用', withEdit: true, leavesObsidian: true }),
      withoutEdit: await mountOne('wrap8', { name: '没有编辑', withEdit: false }),
    }
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
  /**
   * ⚠ adj866：工具条**显形后会被搬到 `document.body`**（`adj793c` 的外侧落位）⇒
   * 容器查询会落空。所以：**先**在容器里取到它（此刻还挂着）→ 点击显形 → 之后一律用**同一个元素引用**；
   * 第二次调用（负对照）靠 `window.__ijipuLpTb` 复用引用。
   */
  let tb = container3.querySelector('.ijipu-score-toolbar') || window.__ijipuLpTb;
  if (tb) window.__ijipuLpTb = tb;
  if (!tb) return JSON.stringify({ error: '没有工具条' });
  /**
   * adj785：显隐是**点击预览区**切换（悬停那套已按用户要求取消）⇒ 这里点一下把它显出来，
   * 否则下面的命中测试必然落在别的元素上（老流程靠"悬停显形"，从 adj785 起就一直红灯）。
   */
  const revealed = (() => {
    container3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return getComputedStyle(tb).visibility;
  })();
  /**
   * ⚠ 必须先**滚进视口**再量：`elementFromPoint` 对视口外的点返回 null
   * （实测第三次挂载点的 `</>` 在 y≈1062、视口只有 1049 ⇒ 命中测试全是 null，看着像"点不到"）。
   * 量完滚回顶部，免得把后面几张截图的内容带跑偏。
   */
  embed.scrollIntoView({ block: 'center' });
  const r = tb.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  /**
   * adj725e：**宿主自己那枚 `</>`**（`.embed-actions .edit-block-button`）也一起量 ——
   * 实时预览里我们那枚会撤掉，用户看到/点到的是宿主这枚，它默认只跟主题取色，
   * 压在白纸上深色主题下看不见。这里量它的字色/底色（合成到白纸后的对比度）与命中点。
   */
  const hostBtn = embed.querySelector('.embed-actions .edit-block-button, .embed-actions .embed-action');
  let hostHit = null;
  let hostRect = null;
  if (hostBtn) {
    const hr = hostBtn.getBoundingClientRect();
    hostRect = { x: Math.round(hr.left), y: Math.round(hr.top), w: Math.round(hr.width), h: Math.round(hr.height) };
    const hel = document.elementFromPoint(Math.round(hr.left + hr.width / 2), Math.round(hr.top + hr.height / 2));
    hostHit = hel ? (hel.closest('.edit-block-button, .embed-action') ? 'hostBtn' : (hel.id || hel.className || hel.tagName)) : null;
  }
  const out = {
    mode,
    revealed,
    hasClass: embed.classList.contains('ijipu-cm-host'),
    overflow: getComputedStyle(embed).overflow,
    toolbarRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    hitCenter: el ? (el.closest('.ijipu-score-toolbar') ? 'toolbar' : (el.id || el.className || el.tagName)) : null,
    hostRect,
    hostHit,
    hostContrast: hostBtn ? window.__ijipuContrastOnPaper(hostBtn) : null,
    hostOpacity: hostBtn ? getComputedStyle(hostBtn).opacity : null,
  };
  window.scrollTo(0, 0); // 截图用：滚回顶部（上面的命中测试已经量完）
  return JSON.stringify(out);
};

/**
 * adj866（T-5 五条口径的**真机验证**）：工具条是不是**恰好 5 位**、「⋯ 更多」弹出来的菜单里有什么、
 * 点了菜单项**真的调到**插件方法没有、桌面右键是不是**同一份菜单**、块级缩放 `z` 是不是"自然尺寸"。
 *
 * 为什么值得单开一个探针：这几件事全是**真实 DOM + 真实事件**才成立的性质
 * （按钮个数、类名顺序、菜单项、`contextmenu` 的 `defaultPrevented`、`calc()` 后的实际宽度），
 * Node 里的 smoke 只能核对源码文本 —— 文本对不等于行为对。
 *
 * 宿主替身要点：
 *  · `plugin` 上挂**记录型**方法（`copyScoreImage` / `copyScoreSvg` / `copyScoreSource` / `setExportRange`），
 *    调用参数原样记下 ⇒ "菜单项 → 插件方法"这条路由是被**执行**验证的；
 *  · `Menu` 由 `scripts/verify-stubs/obsidian.ts` 记录进 `globalThis.__ijipuMenus`（真实宿主里是弹出菜单）。
 *
 * adj872 追加第 ⑧ 节：三种显示模式的**实际渲染宽高**（`out.geo`）—— adj871 的三模式几何此前
 * 只有源码级断言，没量过真实尺寸；见那一节的注释（含"可见高度"为什么要靠 `position: fixed` 定住）。
 */
window.__ijipuT5Probe = async function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const calls = { copyScoreImage: [], copyScoreSvg: [], copyScoreSource: [], setExportRange: [] };
  /** 所有替身**共用同一份设置对象**（真实插件也只有一份）——菜单里的"当前范围打勾"读的就是它 */
  const settings = { exportRange: 'page' };
  const mkWrap = (id, widthPx) => {
    let d = document.getElementById(id);
    if (!d) {
      d = document.createElement('div');
      d.id = id;
      d.style.width = widthPx + 'px';
      document.body.appendChild(d);
    }
    d.empty?.();
    return d;
  };
  const makeHost = (container, extra = {}) => ({
    plugin: {
      settings,
      showGuides: false,
      events: { on: () => ({ name: 'x' }), offref: () => {}, trigger: () => {} },
      register: () => {},
      registerEvent: () => {},
      getWorkletUrl: () => '',
      registerPlay: () => {},
      unregisterPlay: () => {},
      toggleGuides: () => false,
      app: { workspace: { on: () => ({}) }, vault: { on: () => ({}) } },
      copyScoreImage: (...a) => calls.copyScoreImage.push(a.map((x) => (x && typeof x === 'object' ? { box: x.box, mode: x.mode } : x))),
      copyScoreSvg: (...a) => calls.copyScoreSvg.push(a.map((x) => (x && typeof x === 'object' ? { box: x.box, mode: x.mode } : x))),
      copyScoreSource: (...a) => calls.copyScoreSource.push(a),
      setExportRange: (...a) => {
        calls.setExportRange.push(a);
        /**
         * ⚠ 假替身也要**像真插件那样把设置写进去** —— 否则"切完之后再开菜单，✓ 应该移过去"这条断言
         * 永远失败（探针自己的锅，不是产品的）。真实 `IJipuPlugin.setExportRange` 就是写设置 + 存盘。
         */
        if (a[0] === 'view' || a[0] === 'page' || a[0] === 'score') settings.exportRange = a[0];
      },
    },
    container,
    getSource: () => window.__jpsCode,
    getFrontmatter: () => null,
    writeSource: () => {},
    onEditSource: () => {},
    ...extra,
  });

  const out = { error: null, slots: null, menu: null, routed: null, contextMenu: null, zoom: {}, geo: null, errs: null };
  try {
    // —— ① 工具条槽位（真机上数按钮 + 读 dataset.slot，不看源码）——
    const wrap = mkWrap('wrapT5', 820);
    const h = IJipuPane.mountScorePane(makeHost(wrap));
    await sleep(60);
    const tb = wrap.querySelector('.ijipu-score-toolbar');
    if (!tb) throw new Error('没有工具条');
    const btns = Array.from(tb.querySelectorAll('button'));
    out.slots = {
      count: btns.length,
      order: btns.map((b) => b.dataset.slot || '(无 slot)'),
      labels: btns.map((b) => (b.textContent || '').trim()),
      /** 每个按钮的**墨迹盒**（中心命中测试用；手机尺寸那条另在 CDP 里量） */
      rects: btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    };

    // —— ② 「⋯ 更多」弹出来的菜单（Menu 记录在 globalThis.__ijipuMenus）——
    const more = tb.querySelector('.ijipu-more-btn');
    if (!more) throw new Error('没有 ⋯ 更多 按钮');
    globalThis.__ijipuMenus = [];
    more.click();
    await sleep(30);
    const first = (globalThis.__ijipuMenus || [])[0] || [];
    const items = first.filter((it) => !it.isLabel).map((it) => it.title);
    const labels = first.filter((it) => it.isLabel).map((it) => it.title);
    const checkedFirst = first.filter((it) => it.checked === true).map((it) => it.title);
    out.menu = { sections: labels, items, checked: checkedFirst };

    // —— ③ 路由：点「复制为图片（1×）」→ 必须调到 plugin.copyScoreImage(source, 1, {box, mode}) ——
    const item1x = first.find((it) => it.title.indexOf('复制为图片（1×）') === 0);
    if (item1x && item1x.onClick) item1x.onClick();
    await sleep(20);
    // —— ④ 路由：切「导出谱面」→ setExportRange('score')；再开菜单应看到 ✓ 移到谱面那一项 ——
    globalThis.__ijipuMenus = [];
    more.click();
    await sleep(20);
    const second = (globalThis.__ijipuMenus || [])[0] || [];
    const scoreItem = second.find((it) => it.title.indexOf('谱面（墨迹 + 每边 2px）') === 0);
    if (scoreItem && scoreItem.onClick) scoreItem.onClick();
    globalThis.__ijipuMenus = [];
    more.click();
    await sleep(20);
    const third = (globalThis.__ijipuMenus || [])[0] || [];
    out.routed = {
      copyImage1x: calls.copyScoreImage,
      setRange: calls.setExportRange,
      checkedAfterSwitch: third.filter((it) => it.checked === true).map((it) => it.title),
      copySourceItem: third.some((it) => it.title.indexOf('复制谱面源码') === 0),
      svgItem: third.some((it) => it.title.indexOf('复制 SVG 文本') === 0),
    };

    // —— ⑤ 桌面右键：与「⋯ 更多」**同一份菜单**（且要 preventDefault）——
    globalThis.__ijipuMenus = [];
    const r = wrap.querySelector('.ijipu-svgs').getBoundingClientRect();
    const ev = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(r.left + 20),
      clientY: Math.round(r.top + 20),
    });
    const notCancelled = wrap.dispatchEvent(ev);
    await sleep(20);
    const ctx = (globalThis.__ijipuMenus || [])[0] || [];
    out.contextMenu = {
      recorded: globalThis.__ijipuMenus.length,
      defaultPrevented: ev.defaultPrevented,
      dispatchReturned: notCancelled,
      items: ctx.filter((it) => !it.isLabel).map((it) => it.title),
    };
    h.destroy();

    // —— ⑥ 块级缩放 `z`：**固定 100% = 自然尺寸**（= viewBox 宽），`z=*` = 铺满容器 ——
    //   ⚠ 必须用 `.ijipu-svgs .ijipu-page-svg > svg` 精确定位**谱面**那份 ——
    //     容器里还有工具条的图标 `<svg>`（15×15），`querySelector('svg')` 会先抓到它（本轮踩过）。
    const zWrap = mkWrap('wrapZoom', 820);
    const zPane = IJipuPane.mountScorePane(makeHost(zWrap, { zoom: 100 }));
    await sleep(80);
    const zSvg = zWrap.querySelector('.ijipu-svgs .ijipu-page-svg > svg');
    const zVb = (zSvg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const zRect = zSvg.getBoundingClientRect();
    out.zoom.fixed = {
      zoom: 100,
      viewBoxW: +zVb[2].toFixed(2),
      renderedW: +zRect.width.toFixed(2),
      /** 比宽度要对**谱面容器**（`.ijipu-svgs`）比，不能对最外层 div（那里面有 2px padding 等） */
      svgsW: +zWrap.querySelector('.ijipu-svgs').getBoundingClientRect().width.toFixed(2),
      containerW: +zWrap.getBoundingClientRect().width.toFixed(2),
      cls: zWrap.querySelector('.ijipu-svgs').className,
      cssVar: getComputedStyle(zWrap.querySelector('.ijipu-page-svg')).getPropertyValue('--ijipu-zoom-w').trim(),
    };
    zPane.destroy();
    const aWrap = mkWrap('wrapZoomAuto', 820);
    const aPane = IJipuPane.mountScorePane(makeHost(aWrap, { zoom: 'auto' }));
    await sleep(80);
    const aSvg = aWrap.querySelector('.ijipu-svgs .ijipu-page-svg > svg');
    out.zoom.auto = {
      zoom: 'auto',
      renderedW: +aSvg.getBoundingClientRect().width.toFixed(2),
      svgsW: +aWrap.querySelector('.ijipu-svgs').getBoundingClientRect().width.toFixed(2),
      containerW: +aWrap.getBoundingClientRect().width.toFixed(2),
      cls: aWrap.querySelector('.ijipu-svgs').className,
    };
    aPane.destroy();

    // —— ⑦ 不带 zoom 的宿主（文件视图/嵌入）—— adj872 起**显式**按 `z=*` 处理（加 `ijipu-zoom-fit`），
    //      不再靠 styles.css 的 `width: 100%` 兜底（那是"三层巧合"）；宽度仍照旧铺满容器 ✓ ——
    const nWrap = mkWrap('wrapNoZoom', 820);
    const nPane = IJipuPane.mountScorePane(makeHost(nWrap));
    await sleep(80);
    const nSvg = nWrap.querySelector('.ijipu-svgs .ijipu-page-svg > svg');
    out.zoom.none = {
      cls: nWrap.querySelector('.ijipu-svgs').className,
      renderedW: +nSvg.getBoundingClientRect().width.toFixed(2),
      svgsW: +nWrap.querySelector('.ijipu-svgs').getBoundingClientRect().width.toFixed(2),
      containerW: +nWrap.getBoundingClientRect().width.toFixed(2),
    };
    nPane.destroy();

    /**
     * ---- ⑧ adj872：三种显示模式的**实际渲染宽高**（真机上量 SVG 的 getBoundingClientRect）----
     *
     * 为什么非量不可：adj871 的三模式几何此前**只有源码级断言**（smoke 里量公式、量类名、量 CSS），
     * 从没量过"真实渲染出来到底多大" ⇒ 「整页真的进视界了吗」「满宽 + z=100 真的没铺满吗」
     * 这些**结果**性的话没人守。这里用**已知宽度（820）的容器**挂三次：
     * `{mode:'page', zoom:'auto'}` / `{mode:'full', zoom:'auto'}` / `{mode:'full', zoom:100}`，
     * 照 ⑥ 的风格量 `.ijipu-svgs .ijipu-page-svg > svg`（**不能**用 querySelector('svg') ——
     * 容器里还有工具条的图标 svg 15×15，那个坑已经踩过一次）。
     *
     * ⚠ 整页拟合的"可见高度" = `window.innerHeight − 容器顶边 − 24`（下限 200，见 publishPageFit），
     * 所以容器**摆在哪**决定量到什么。这里把它 `position: fixed` 摆在视口内一个已知位置
     * （top ≈ innerHeight − 650 ⇒ 可见高 ≈ 624），**刻意让高度成为限制方向** ——
     * 只有高度受限时，"渲染宽 < 容器宽"才能证明"真的按 contain 缩小了"（而不是恰好没撑到边）。
     * 量到的四个数（innerHeight / svgsTop / 可见高 / 渲染宽高）全部原样带回去，便于人核对；
     * 若 `window.innerHeight` 与真实窗口不一致，这几个数就是判据的现场证据。
     */
    const gWrap = document.createElement('div');
    gWrap.id = 'wrapGeo';
    gWrap.style.width = '820px';
    gWrap.style.position = 'fixed';
    gWrap.style.left = '0px';
    document.body.appendChild(gWrap);
    const geoTop = Math.max(0, window.innerHeight - 650);
    const geoMeasure = async (label, extra, topPx) => {
      gWrap.style.top = (topPx === undefined ? geoTop : topPx) + 'px';
      const pane = IJipuPane.mountScorePane(makeHost(gWrap, extra));
      await sleep(140);
      const svgs = gWrap.querySelector('.ijipu-svgs');
      const svg = gWrap.querySelector('.ijipu-svgs .ijipu-page-svg > svg');
      const r = svg.getBoundingClientRect();
      const sr = svgs.getBoundingClientRect();
      /** 页面框（含页边距）= 该 SVG 的**原始** viewBox 的第 3/4 个数（`data-orig-vb`） */
      const orig = (svg.dataset.origVb || svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      /** 当前 viewBox（整页/满宽 = 页面框；谱面 = 墨迹盒）—— 满宽 + z=100 的"自然尺寸"就是它 */
      const cur = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const rec = {
        label,
        mode: extra.mode || '(缺省=score)',
        zoom: String(extra.zoom),
        pageW: +orig[2].toFixed(2),
        pageH: +orig[3].toFixed(2),
        vbW: +cur[2].toFixed(2),
        vbH: +cur[3].toFixed(2),
        renderedW: +r.width.toFixed(2),
        renderedH: +r.height.toFixed(2),
        svgsW: +sr.width.toFixed(2),
        svgsTop: +sr.top.toFixed(2),
        innerH: window.innerHeight,
        /** 与 `publishPageFit` **同一个式子**（未钳到下限 200 之前的原值） */
        visibleH: +(window.innerHeight - sr.top - 24).toFixed(2),
        cls: svgs.className,
      };
      pane.destroy();
      return rec;
    };
    out.geo = {
      note: '容器 #wrapGeo = 820px 定宽 + position:fixed（已知的视口位置）；量的是 .ijipu-svgs .ijipu-page-svg > svg',
      page: await geoMeasure('page', { mode: 'page', zoom: 'auto' }),
      fullAuto: await geoMeasure('fullAuto', { mode: 'full', zoom: 'auto' }),
      full100: await geoMeasure('full100', { mode: 'full', zoom: 100 }),
      /**
       * 负对照（量法敏感性）：把容器摆到**视口最下方** ⇒ 原始可见高只剩 ~174px（< 下限 200）
       * ⇒ 拟合系数被下限顶到 200 ⇒ 「渲染高 ≤ 可见高」这条判据在这里**应当为假**。
       * 它证明第 1 条判据真的在按"可见高"判，而不是恒真（恒真的断言等于没写）。
       */
      negVisible: await geoMeasure('negVisible', { mode: 'page', zoom: 'auto' }, Math.max(0, window.innerHeight - 200)),
    };
    /** 量完就摘掉：它是 `position: fixed`，留着会盖在后面的截图（视觉证据）上 */
    gWrap.remove();
    out.errs = (window.__ijipuErrs || []).slice(-5);
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return JSON.stringify(out);
};
