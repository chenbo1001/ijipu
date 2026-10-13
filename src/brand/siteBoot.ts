/**
 * brand/siteBoot.ts — 官网页面的**首屏启动层**（adj930）
 *
 * ## 解决的问题（用户实测）
 *
 * 「首页、手册页等这些页面，在 css 还没加载完就开始显示了，结果就是先显示没有格式的文字版，
 * 再闪一下，显示 css 加持的正常版，不美观」—— 用户口径：**先显示背景 + 一个转圈，
 * 等 CSS 等资源都加载完再正常显示出来**；追加口径：**启动层的背景必须与真实页面的背景一致**，
 * 否则"启动层 → 正文"之间又是一次背景闪动。
 *
 * ## 为什么那段 CSS 必须**内联在 HTML 的 `<head>` 里**
 *
 * 外链样式表本身就要等网络 ⇒ 拿它来"防闪烁"等于没防。所以四个官网页（`/`、`/manual/`、
 * `/syntax/`、`/plugin/`）各自的 `<head>` 里都手写了一段**同样的内联块**（含启动层浮层的元素），
 * 本文件是那段内联块里**色值与 id 的唯一口径** —— `npm run smoke` 的 `[168]` 段逐字核对：
 * 四页的内联块必须**逐字相同**、色值必须等于这里的常量与 `styles/theme.css` 的主题 token。
 * 改色：改这里 + 四页（闸门会拦住只改一处的情况）。
 *
 * ⚠ 为什么不去"生成"那段 HTML（构建期注入 / Vite 插件）：
 *   项目既有口径是"官网 HTML 为 SEO 与首屏静态写死"（见 `src/AGENTS.md` 的 `landing/` 一行）。
 *   启动层必须**早于任何构建产物**就存在；用插件注入会把"首屏有没有兜底"变成一个只在构建期
 *   才成立的性质（`npm run dev` 与源码阅读都看不出来）。所以走"手写 + 机器闸门"，
 *   与 `siteVars.ts` 的 `SITE_BG` 同一套做法 —— 区别是**这次补上了闸门**（`SITE_BG` 原来只有注释在提醒）。
 *
 * ## 揭示时机（本文件的运行时部分）
 *
 *   ① 外链样式表**全部 loaded**（失败也算"有结果"，只是记下来）；
 *   ② `document.fonts.ready`（字体不齐会二次跳动）；
 *   ③ 调用方额外要求（文档页要等**正文注入完成**，见 `docs/render.ts`）；
 *   ④ **任一资源失败、或 2.5s 超时 ⇒ 照样揭示**，把原因打进 console —— 绝不让用户对着转圈。
 *
 * 揭示方式**只淡出透明度**：其下 `html`/`body` 与启动层**同色** ⇒ 不引入新的闪动；
 * `prefers-reduced-motion: reduce` 下不淡出、**直接移除**。揭示后启动层**从 DOM 移除**（不留残留）。
 */
import { SITE_BG, type SiteMode } from './siteVars'
import { ui } from './tokens'

/** 启动层元素 id（四页 HTML 的浮层与这里必须一致） */
export const SITE_BOOT_ID = 'ijipu-boot'

/** 揭示时加在启动层上的类名 —— 它**只**改透明度（`opacity: 0`） */
export const SITE_BOOT_OUT_CLASS = 'ijipu-boot-out'

/** 等关键资源的上限：超了就照样揭示（约 2.5s，用户口径里的"大概 2.5 秒"） */
export const SITE_BOOT_TIMEOUT_MS = 2500

/** 淡出时长（毫秒）—— 与四页内联 CSS 里的 `transition` 时长一致 */
export const SITE_BOOT_FADE_MS = 220

/**
 * 「模块脚本压根没跑起来」时的**硬兜底**：`<head>` 里那段内联脚本到点直接把启动层摘掉。
 *
 * 为什么需要它：上面的 2.5s 超时是**模块里**的定时器 —— 模块 404 / 被拦 / 语法错时它根本不会跑，
 * 用户就会一直对着转圈。这条兜底与"慢资源"不冲突：模块一跑就把
 * `SITE_BOOT_ARMED_FLAG` 置上，兜底看到标记就不再插手（否则慢 CSS 会被它提前摘掉启动层，反而闪）。
 */
export const SITE_BOOT_HARD_FALLBACK_MS = 8000

/** 内联脚本与模块之间约定的全局标记（"这里已经接管了"） */
export const SITE_BOOT_ARMED_FLAG = '__ijipuBootArmed'

/**
 * 启动层用到的色值（**必须与四页内联块逐字一致**，大小写不敏感）。
 *
 * 深浅两套都覆盖：`@media (prefers-color-scheme: …)` 管"脚本模式还没挂上"的那一瞬，
 * `html[data-site-mode='light' | 'dark']` 管用户显式选择（故在内联块里写在媒体查询**之后**，
 * 靠"同优先级、后出现者胜"盖住系统偏好）。
 *
 * `bg` 一律取 `SITE_BG`：它同时是内联的 `html/body` 底色 —— 两处同源才谈得上"背景不闪"。
 */
export const SITE_BOOT_COLORS: Record<SiteMode, { bg: string; ink: string; accent: string; track: string }> = {
  dark: {
    bg: SITE_BG.dark,
    ink: ui.textSecondary, // #93A0C8：转圈下方那行"正在加载…"（与 --site-text-2 同值）
    accent: ui.accent, // #00F0FF：转圈的那一弧（与 --site-accent 深色档同值）
    track: 'rgba(147, 160, 200, 0.28)',
  },
  light: {
    bg: SITE_BG.light,
    ink: '#7a86a8', // --site-muted
    accent: '#0891a6', // --site-accent 浅色档（亮青压在浅底上看不清，必须换深青）
    track: 'rgba(70, 83, 122, 0.25)',
  },
}

/**
 * 这个 `<link>` 是不是同源 —— `cssRules` 读不出来时用它区分"失败"与"跨域正常"
 */
function isSameOrigin(link: HTMLLinkElement): boolean {
  try {
    return new URL(link.href, location.href).origin === location.origin
  } catch {
    return true // 解析不出来就按同源处理（宁可报成失败，也别假装成功）
  }
}

/**
 * 等"关键资源就绪"。
 *
 * 返回值是**失败清单**（空数组＝都拿到了）——失败**不阻塞**揭示，只作为 console 里的原因。
 * 事件（`load` / `error`）只用来"知道有结果了"，**是不是真的到了**由 `settle()` 自己判
 * （失败的样式表也会走 `load`、`sheet` 还非空 —— 只看事件会把失败当成功，见下面的注释）。
 */
function criticalAssetsReady(extra?: Promise<unknown>): Promise<string[]> {
  const failed: string[] = []
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
  const css = Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          /** 某个样式表"有结果了"（成功或失败）——**看它到底有没有内容**，别只看事件名 */
          const settle = (): void => {
            /**
             * ⚠ 实测（无头 Chrome，见 `scripts/verify-site.mjs` 的失败兜底那几条）：样式表**加载失败**时
             * ① 也照样走 `load` 事件；② `link.sheet` 是个**空表对象**（不是 null）；
             * ③ 读它的 `cssRules` 直接抛 `SecurityError`（同源但"不可访问"）。
             * 只看"有没有事件 / sheet 是不是 null"会把失败当成功 ⇒ "失败原因打进 console"永远不会触发
             * （本轮实测踩到，闸门红在这里）。所以判据是 **`cssRules` 读得出来且非空**；
             * 读不出来时再看是不是同源：同源读不出来 = 失败，跨域读不出来 = 正常（不误报）。
             */
            let ok = false
            if (link.sheet) {
              try {
                ok = link.sheet.cssRules.length > 0
              } catch {
                ok = !isSameOrigin(link)
              }
            }
            if (!ok) failed.push(link.getAttribute('href') || '(样式表)')
            resolve()
          }
          // 已经就绪（或已经失败）的：直接结算，别等一个不会再来的事件
          if (link.sheet) {
            settle()
            return
          }
          link.addEventListener('load', settle, { once: true })
          link.addEventListener('error', settle, { once: true })
        }),
    ),
  )
  // `document.fonts` 个别旧内核没有 ⇒ 用可选调用兜住，别为了字体把整个揭示卡死
  const fonts: Promise<void> = document.fonts
    ? document.fonts.ready.then(
        () => undefined,
        () => {
          failed.push('document.fonts.ready')
        },
      )
    : Promise.resolve()
  const after: Promise<void> = extra ? extra.then(() => undefined, () => undefined) : Promise.resolve()
  return Promise.all([css, fonts, after]).then(() => failed)
}

/** 淡出（或不淡出）并**从 DOM 移除**启动层 */
function hideBoot(el: HTMLElement): void {
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const remove = (): void => el.remove()
  if (reduce) {
    // 用户要求"减少动效"：不淡出，直接消失（其下背景同色 ⇒ 也不会闪）
    remove()
    return
  }
  /**
   * 只改**透明度**：不动尺寸/位置，其下 `html`/`body` 与它同色 ⇒ 看不到任何"换背景"的痕迹。
   * `transitionend` 之外还留一个定时兜底：过渡被打断（掉帧、页面隐藏）时事件可能不来，
   * 没有兜底就会留下一个 opacity:0 的元素盖在页面上（挡点击）。
   */
  el.classList.add(SITE_BOOT_OUT_CLASS)
  el.addEventListener('transitionend', remove, { once: true })
  window.setTimeout(remove, SITE_BOOT_FADE_MS + 200)
}

/**
 * 接管启动层：等关键资源就绪后揭示正文。**同步返回**，绝不抛（它不该成为页面的风险点）。
 *
 * @param extra 额外要等的（文档页传"正文注入完成"的那个 promise）
 */
export function revealSiteBoot(extra?: Promise<unknown>): void {
  const el = document.getElementById(SITE_BOOT_ID)
  // 没有启动层（老 HTML / 被别处删了）也要把标记置上：硬兜底不必再空跑一遍
  ;(window as unknown as Record<string, unknown>)[SITE_BOOT_ARMED_FLAG] = true
  if (!el) return

  let timedOut = false
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(() => {
      timedOut = true
      resolve()
    }, SITE_BOOT_TIMEOUT_MS)
  })
  Promise.race([criticalAssetsReady(extra), timeout])
    .then((result) => {
      const failed = Array.isArray(result) ? result : []
      if (timedOut) {
        console.warn(`[iJipu] 启动层：${SITE_BOOT_TIMEOUT_MS}ms 内关键资源没全部就绪，照样揭示（不让用户对着转圈）`)
      } else if (failed.length > 0) {
        console.warn(`[iJipu] 启动层：这些关键资源加载失败，照样揭示：${failed.join('、')}`)
      }
      hideBoot(el)
    })
    .catch(() => hideBoot(el)) // 兜底：上面的链路本身出错也必须揭示
}
