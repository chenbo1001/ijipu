/**
 * landing/main.ts — 官网**介绍首页**的脚本（adj876）
 *
 * 设计取舍（为什么首页只做这么点事）：
 *   首页正文全部写在 `index.html` 里，不走 JS 渲染 —— 一是搜索引擎（尤其中文场景的百度）
 *   对不执行 JS 的抓取更友好，二是首屏不依赖 JS、没有"先白屏再出内容"的闪烁。
 *   所以这个文件的职责被刻意压到最小，只有五件事：
 *     ① 把品牌色注入 CSS 变量（色值只在 `brand/tokens.ts` 定义一处）；
 *     ② 填外部链接地址（GitHub / 下载 / 插件 —— 同样只在 tokens 里定义）；
 *     ③ 填版本号（`data-app-version` 占位，发版即自动更新）；
 *     ④ 一点交互：顶栏滚动加背景、窄屏菜单、赞赏弹层；
 *     ⑤ 「你以前用过 → 直接进应用」提示条。
 *   首页**没有**引入 React 或引擎，JS 体积保持在一个很小的量级。
 */
import { injectSiteColors } from '../brand/siteVars'
import { fillExternalLinks } from '../brand/siteLinks'
import { APP_VERSION } from '../brand/version'
import './landing.css'

/**
 * 首页自己的存储键前缀。
 * 判定「以前用过」时要**排除**这一族键 —— 否则用户点一次"关闭提示"，
 * 首页自己写下的键就会被当成"用过应用"的证据，下次访问又弹出来。
 */
const SITE_KEY_PREFIX = 'ijipu.site.'
const TIP_DISMISSED_KEY = `${SITE_KEY_PREFIX}tipDismissed`

/** 版本号占位符：`<b data-app-version>` 在首页出现多处（Hero 小字与页脚） */
function fillVersion(): void {
  document.querySelectorAll('[data-app-version]').forEach((el) => {
    el.textContent = `v${APP_VERSION}`
  })
}

/** 顶栏：滚动过一点就加背景，避免内容从顶栏底下透出来 */
function bindTopbar(): void {
  const topbar = document.getElementById('topbar')
  if (!topbar) return
  const sync = () => topbar.classList.toggle('scrolled', window.scrollY > 8)
  sync()
  window.addEventListener('scroll', sync, { passive: true })
}

/** 窄屏菜单：点汉堡展开导航，点任一链接后收起 */
function bindBurger(): void {
  const burger = document.getElementById('burger')
  const nav = document.getElementById('nav')
  if (!burger || !nav) return
  const setOpen = (open: boolean) => {
    nav.classList.toggle('open', open)
    burger.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  burger.addEventListener('click', () => setOpen(!nav.classList.contains('open')))
  nav.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false)
  })
}

/** 赞赏弹层：用原生 `<dialog>`（无需第三方库，Esc 关闭是内建行为） */
function bindDonate(): void {
  const dlg = document.getElementById('donate') as HTMLDialogElement | null
  const open = document.getElementById('donate-open')
  if (!dlg || !open) return
  open.addEventListener('click', (e) => {
    // 保留 `href="#donate"` 作为无 JS 时的兜底（会跳到页面末尾的弹层锚点）
    e.preventDefault()
    dlg.showModal()
  })
  // 点遮罩（dialog 自身）也关闭 —— 原生行为只覆盖 Esc
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close()
  })
}

/**
 * 「以前用过 → 直接进应用」提示条。
 *
 * 判据：localStorage 里有**应用**写入的 `ijipu.*` 键（草稿、主题、缩放…都是它写的），
 * 且用户没有手动关过这条提示。这样老用户回访首页能一键进应用，而第一次来的人
 * 不会被"你已经用过了"这种莫名其妙的话打扰。
 */
function bindReturningTip(): void {
  const tip = document.getElementById('tip')
  if (!tip) return
  let dismissed = false
  let visited = false
  try {
    dismissed = localStorage.getItem(TIP_DISMISSED_KEY) === '1'
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('ijipu.') && !k.startsWith(SITE_KEY_PREFIX)) {
        visited = true
        break
      }
    }
  } catch {
    // 无痕模式等禁用存储的环境：当作"没用过"，不弹提示（也绝不因此报错）
    return
  }
  if (!visited || dismissed) return
  tip.hidden = false
  document.getElementById('tip-close')?.addEventListener('click', () => {
    tip.hidden = true
    try {
      localStorage.setItem(TIP_DISMISSED_KEY, '1')
    } catch {
      /* 存不下就只关掉本次，不强求 */
    }
  })
}

injectSiteColors()
fillExternalLinks()
fillVersion()
bindTopbar()
bindBurger()
bindDonate()
bindReturningTip()
