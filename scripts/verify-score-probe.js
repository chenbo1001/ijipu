/**
 * scripts/verify-score-probe.js — 「谱面」裁剪 / 工具条显隐 / 源码模式的**页面内探针**
 *
 * 为什么单独成文件（adj724b 的教训）：这些逻辑原先写在 verify 脚本的**模板字符串**里，
 * 而模板里的反引号、换行转义、美元花括号会互相干扰，反复产出
 * SyntaxError: Invalid or unexpected token —— 更要命的是报错行号落在别的脚本里，极难定位。
 * 现在一律放外部文件，verify 脚本只负责引入并调用一行。
 *
 * 约定：页面需先准备好 window.__ijipuPlugin / window.__jpsCode（见 verify 脚本注入的 HTML）。
 */
window.__ijipuProbe = async function () {
  try {
    return await __ijipuProbeBody();
  } catch (e) {
    return JSON.stringify({ fatal: String(e && e.message), stack: String(e && e.stack).slice(0, 900) });
  }
};
window.__ijipuProbeBody = async function () {
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
     * adj724b（用户要求）：**工具条绝对定位浮在左上角、悬停淡入；谱面不因它显隐而位移**。
     * 在真实浏览器里验证语义（真实 styles.css + 真实 scorePane）：
     *  ① 默认不可见（visibility: hidden，**绝对定位 ⇒ 不占位**）；
     *  ② 容器上派发 pointermove 后 visibility: visible（JS 加 is-revealed 类）；
     *  ③ 派发 pointerleave 后回到 hidden；
     *  ④ **关键**：整个显隐过程中，谱面 SVG 的 getBoundingClientRect().top **不变**（不位移）。
     */
    out.toolbar = (async () => {
      const tb = document.querySelector('#wrap .ijipu-score-toolbar');
      if (!tb) return { error: '没找到 .ijipu-score-toolbar' };
      const svg = curSvg();
      const cs = () => getComputedStyle(tb);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      // 悬停**期间**留证：交给外层截图（见下面的 hover 截图步骤）
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
        shift: {
          before: +topBefore.toFixed(1),
          afterReveal: +topAfterReveal.toFixed(1),
          afterLeave: +topAfterLeave.toFixed(1),
        },
      };
    })();
    /**
     * adj724b（用户要求）：**「源码」按钮** —— 在块里直接编辑脚本（与 .jps 文件视图同款口径）。
     * 验证：① 宿主给了 writeSource 时按钮出现；② 点一下进入源码态（谱面换成 textarea）；
     *      ③ 输入后写回被调用、且内容正确；④ 再点一下回到看谱（谱面回来）。
     */
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
    /** 源码模式测试会把 #wrap 的 DOM 换掉 ⇒ **先**把「谱面」viewBox 快照存下来（顺序很关键） */
    out.vbBeforeSource = (() => {
      const svg = curSvg();
      return svg ? (svg.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number) : null;
    })();
    out.sourceMode = await (async () => {
      const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
      /**
       * ⚠ 必须给第二个挂载点**独立的 plugin 对象**（共享同一个 events 总线）。
       *
       * 此前我复用了 `window.__ijipuPlugin` 并改它的 `containerEl` —— 而 `paint()` 会
       * `empty()` 那个容器 ⇒ **把第一个挂载点（#wrap）清空了**，后面读 SVG 自然报
       * `Cannot read properties of undefined`。这是**工具的坑**，不是插件的坑。
       */
      const plugin2 = Object.assign({}, window.__ijipuPlugin, { containerEl: document.getElementById('wrap2') });
      const host2 = {
        plugin: plugin2,
        container: document.getElementById('wrap2'),
        getSource: () => window.__ijipuSrc,
        getFrontmatter: () => null,
        writeSource: (next) => { window.__ijipuWritten.push(next); window.__ijipuSrc = next; },
      };
      let h2;
      try { h2 = IJipuPane.mountScorePane(host2); }
      catch (e) { return { error: 'mount2 抛出：' + String(e && e.message) }; }
      const q = (sel) => document.querySelector('#wrap2 ' + sel);
      const hasBtn = !!q('.ijipu-source-btn');
      const hasScoreBefore = !!q('svg');
      // 诊断：点击前后把 wrap2 的直接子元素类名与异常记下来（定位"点了没反应"）
      const before = Array.from(document.getElementById('wrap2').children).map((c) => c.className);
      // 事件监听器里抛的异常不会冒泡给 click() 的调用者 ⇒ 用 window.onerror 接住
      const caught = [];
      const onErr = (ev) => caught.push(String((ev && (ev.message || ev.reason)) || ev));
      window.addEventListener('error', onErr);
      let clickErr = null;
      try {
        q('.ijipu-source-btn')?.click();
      } catch (e) {
        clickErr = String(e && e.message);
      }
      await sleep2(60);
      window.removeEventListener('error', onErr);
      const after = Array.from(document.getElementById('wrap2').children).map((c) => c.className);
      const wrapCls = document.getElementById('wrap2').className;
      const ta = q('.ijipu-block-source-editor');
      // 判据要严：不仅"没有 svg 元素"，而是**谱面容器整个不在了**（源码态只留工具条 + 编辑区）
      const scoreGone = !q('.ijipu-svgs') && !q('svg');
      // 输入 → 触发 input 事件 → 等过防抖（600ms）后应写回
      let written = null;
      if (ta) {
        ta.value = window.__ijipuSrc + '\nC: 新增歌词\n';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep2(900);
        written = window.__ijipuWritten.slice(-1)[0] ?? null;
      }
      // 再点一下回看谱
      q('.ijipu-source-btn')?.click();
      await sleep2(80);
      const backToScore = !!q('svg');
      h2?.destroy?.();
      return {
        hasBtn,
        hasScoreBefore,
        textareaShown: !!ta,
        scoreGone,
        writtenOk: !!written && written.includes('新增歌词'),
        backToScore,
        before,
        after,
        clickErr,
        caught,
        pageErrs: (window.__ijipuErrs || []).slice(-4),
        wrapCls,
      };
    })();
    /**
     * ⚠ 顺序很重要：`out.sourceMode` 会把 `#wrap2` 挂载起来，而 `out.css` 读的是 `#wrap` 的 SVG，
     * 两边互不影响。但**`out.css` 必须在 `out.sourceMode` 之前**执行 ——
     * 后者内部的 destroy/清理会牵动 `#wrap`（实测把 `out.css` 放后面会读到 NaN）。
     */

    // 通过模式菜单切到「整页」/「满宽」：面板用 Menu，这里改用直接点按钮的兜底——
    // 若找不到菜单，就只验证默认的「谱面」模式（核心诉求只在这一模式）
    // 工具条那段显隐验证是异步的（要等过渡跑完才能读到终值）⇒ **先 await 再赋值**，
    // 否则 out.toolbar 是个 Promise，JSON.stringify 会变成 {}
    out.toolbar = await out.toolbar;
    return JSON.stringify(out);
  };
