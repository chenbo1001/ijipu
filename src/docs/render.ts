/**
 * docs/render.ts — 官网文档页（`/manual/`、`/syntax/`）的渲染逻辑（adj876）
 *
 * 与应用内帮助**同源**：同一份 `.md`（`docs/USER-GUIDE.md` / `docs/SYNTAX.md`）
 * + 同一个渲染器（`src/help/markdown.ts`）⇒ 网页上看到的和应用里看到的必然一致。
 *
 * 为什么正文在运行时渲染、而不是构建期预渲染成静态 HTML：
 *   · 渲染器是 TS 模块（`help/markdown.ts`），构建脚本（`.mjs`）直接用它要先过一遍编译，
 *     而应用内帮助本来就依赖运行时渲染 ⇒ 两端同源这条路代价最小。
 *   · 文档页的主要入口是首页/应用里的链接，不靠搜索引擎带量；真需要 SEO 预渲染时，
 *     再加一个构建期插件即可（记在 docs/WEBSITE-PLAN.md 的 P1 里）。
 *   · 代价是一次"先出骨架、再出正文"的闪烁 —— 用 `#doc-body` 里的占位文字与
 *     固定最小高度吸收掉。
 *
 * ⚠ 两份 md 由**各自**的入口文件 import（`manual.ts` / `syntax.ts`），
 *   本文件只收 `md` 参数、不自己 import —— 否则 `/manual/` 会连带下载整份语法说明。
 */
import { extractToc, mdToHtml } from '../help/markdown'
import { mountJpsBlocks } from '../help/jpsPreview'
import { injectSiteColors, currentSiteMode, saveSiteMode, type SiteMode } from '../brand/siteVars'
import { fillExternalLinks } from '../brand/siteLinks'
import './docs.css'

export interface DocPage {
  /** 文档标识：与两份 md 一一对应 */
  kind: 'manual' | 'syntax'
  /** 浏览器页签后缀（形如「操作手册 - 爱记谱 iJipu」） */
  title: string
  /** Markdown 原文 */
  md: string
}

/** 目录：一级标题作分组、二级标题作条目（正文第一个 h1 就是文档标题，跳过） */
function renderToc(page: DocPage): void {
  const toc = document.getElementById('doc-toc')
  if (!toc) return
  const items = extractToc(page.md)
  // 跳过第一个 h1（它是文档标题本身，已经在页头显示过一次了）
  const firstH1 = items.findIndex((it) => it.level === 1)
  const list = firstH1 >= 0 ? items.slice(firstH1 + 1) : items
  const html: string[] = []
  for (const it of list) {
    if (it.level === 1) html.push(`<p class="toc-group">${it.text}</p>`)
    else if (it.level === 2) html.push(`<a class="toc-item" href="#${it.id}">${it.text}</a>`)
    // 三级及以下不进目录：这两份文档的 h3 太碎，全列出来反而找不到东西
  }
  toc.innerHTML = html.join('\n')
}

/** 目录滚动高亮：找"最后一个已经滚过顶部"的标题 */
function bindScrollSpy(): void {
  const toc = document.getElementById('doc-toc')
  if (!toc) return
  const heads = Array.from(document.querySelectorAll<HTMLElement>('#doc-body h1[id], #doc-body h2[id]'))
  if (heads.length === 0) return
  let ticking = false
  const sync = () => {
    ticking = false
    const line = window.scrollY + 140
    let current: HTMLElement | null = null
    for (const h of heads) {
      if (h.offsetTop <= line) current = h
      else break
    }
    const id = current?.id ?? ''
    toc.querySelectorAll('a.toc-item').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#${id}`)
    })
  }
  sync()
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(sync)
    },
    { passive: true },
  )
}

/** 窄屏目录抽屉 */
function bindTocToggle(): void {
  const btn = document.getElementById('toc-toggle')
  const toc = document.getElementById('doc-toc')
  if (!btn || !toc) return
  btn.addEventListener('click', () => {
    const open = toc.classList.toggle('open')
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
  })
  toc.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) {
      toc.classList.remove('open')
      btn.setAttribute('aria-expanded', 'false')
    }
  })
}

/**
 * adj878（用户要求）：右上角的深浅主题开关。
 * 与首页同一套变量、同一套行为：图标由 CSS 按 `data-site-mode` 显示，这里只切换并记住。
 */
function bindThemeToggle(): void {
  const btn = document.getElementById('theme-toggle')
  if (!btn) return
  btn.addEventListener('click', () => {
    const next: SiteMode = currentSiteMode() === 'light' ? 'dark' : 'light'
    injectSiteColors(next)
    saveSiteMode(next)
  })
}

/**
 * 入口：把文档渲染进骨架（骨架在各自的 index.html 里）。
 *
 * 页内大标题由**正文自己的第一个 h1** 承担（两份 md 的第一行就是文档名），
 * 页头不再另放一个标题——否则同一个名字会出现两遍，而且目录也要跟着特判。
 */
export function renderDoc(page: DocPage): void {
  // 主题：`<head>` 的内联脚本已经把模式定在 `<html>` 上（防闪烁），
  // 这里注入完整配色（否则 var(--site-*) 全是空值，会先闪一下无色版式）并接上右上角开关
  injectSiteColors(currentSiteMode())
  bindThemeToggle()
  // 页脚那几个外部链接（"提建议"等）：地址来自 brand/tokens.ts
  fillExternalLinks()
  document.title = `${page.title} - 爱记谱 iJipu`
  const body = document.getElementById('doc-body')
  if (body) {
    body.innerHTML = mdToHtml(page.md)
    // adj882：正文里的每个 ```jps 块都变成「脚本 / 预览」小组件
    //（引擎按需加载——不点「预览」就不会去下那 68KB，见 help/jpsPreview.ts）
    mountJpsBlocks(body)
  }
  // 当前是哪一份文档：给另一份的切换链接加高亮
  document.body.dataset.doc = page.kind
  renderToc(page)
  bindScrollSpy()
  bindTocToggle()
}
