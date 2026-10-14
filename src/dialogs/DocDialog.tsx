/**
 * dialogs/DocDialog.tsx — 帮助文档（操作手册 / 脚本语法说明 / **命令行手册**）
 *
 * 从 docs/*.md 以 ?raw 导入，经 `help/markdown.ts` 的自建 Markdown 渲染器转 HTML 展示。
 * 零第三方依赖；长文档在对话框内滚动查看。
 *
 * adj353：补全行内 Markdown（`code`、**粗体**、*斜体*、[链接](url)）与多级列表（缩进子项）。
 * adj422：支持 **Markdown 表格** 与**引用块**（语法说明要以表格当参考书查）。
 * adj876：渲染器与文档页合并 —— `mdToHtml`/`inlineMd`/`esc` 抽到 `src/help/markdown.ts`，
 *          本文件只保留"读哪几份文档 + 用哪个标题展示"。这样官网 `/manual/`、`/syntax/`
 *          与应用内看到的内容由**同一份 .md + 同一个渲染器**产出，不会两边漂移。
 * adj882：文档里的 ` ```jps ` 示例变成「脚本 / 预览」块 ⇒ 这里必须跟着**挂上交互**
 *          （`mountJpsBlocks`）。不挂的话帮助里会显示一排点不动的标签按钮——比不做还糟。
 * adj957（用户裁定）：**命令行手册并入本对话框**（第三本）。
 *
 * ## adj958：标题栏的「目录」按钮（用户要求）
 *
 * 用户原话：「应用内 DocDialog 标题上是否可以加个目录弹出菜单按钮，跟窄屏的手册里的显示一样，
 * 方便跳转」。可以，而且零件本来就有：
 *  · 目录数据用 `extractToc(md)` —— 与官网文档页**同一个函数**（`docs/render.ts` 也用它）；
 *  · 标题 id 由 `createHeadingIds()` 生成、`mdToHtml` 也用它（`help/markdown.ts`）
 *    ⇒ `#id` 一定对得上。这正是该文件开头警告的"两边各算一遍 slug 迟早对不上"，同源就没这问题。
 *
 * 与官网那套的**两点必要差别**（不能照抄）：
 *  ① **样式不能复用 `.doc-toc`**：官网那套吃的是 `--site-*` 变量（只在官网页面注入），
 *     应用里是 `--jp-*` ⇒ 这里另写 `.doc-toc-pop`，只消费 `--jp-*`；
 *  ② **滚动容器不是 `window`**：对话框里滚动的是 `.doc-content`（它自己 `overflow:auto`），
 *     所以跳转与滚动高亮都挂在这个元素上，而不是 `window.scrollY`。
 *
 * 关闭口径（与官网**刻意不同**）：官网里 ESC 关目录；对话框里 ESC 仍然是**关整个对话框**
 * （模态框的通用语义，`ui/Modal.tsx` 负责）。目录本身用「再点一次按钮 / 点条目 / 点别处」关。
 *
 * ## adj959（**用户实报**：「手册的目录打开后，点击其它地方，菜单不会隐藏」）
 *
 * 查这一条时发现同一处还藏着第二个缺陷（**点目录条目根本不跳**）。两个都是"事件挂错了地方"：
 *  · **点别处不关** ⇒ 根因是 `ui/Modal.tsx` 给 `.modal` 挂了 `onClick={(e) => e.stopPropagation()}`
 *    （点框内不该关掉对话框），而 React 的 `stopPropagation()` **会连带调用原生那次** ⇒
 *    **冒泡阶段**挂在 `document` 上的监听永远收不到框内的点击 ✗。改用**捕获阶段** ✓。
 *  · **点条目不跳** ⇒ 目录浮层 `nav.doc-toc-pop` 是 `.doc-content` 的**兄弟节点**，
 *    挂在 `.doc-content` 上的事件委托**收不到浮层里的点击** ✗。改成直接挂 `<nav onClick>` ✓。
 *
 * 教训（与 `AGENTS §六之二` 那几条同族）：**"事件委托挂在哪个元素上"必须按 DOM 关系核对**，
 * 光看"代码里挂了个监听"是看不出来的；跨组件（`Modal` 的 stopPropagation）时还要考虑
 * 原生化冒泡是否被上游掐断。两条都写成了冒烟的源码级闸门（`adj959`）。
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Modal } from '../ui/Modal'
import { extractToc, mdToHtml } from '../help/markdown'
import { mountJpsBlocks } from '../help/jpsPreview'
import { docCopy } from '../brand/copy'
import manualMd from '../../docs/USER-GUIDE.md?raw'
import syntaxMd from '../../docs/SYNTAX.md?raw'
// adj957（用户裁定）：命令行手册改走本对话框 —— 原先它只能靠"用系统默认程序打开安装目录里的 MD"
// （Windows 默认没有 .md 关联程序 ⇒ 多半弹「你要如何打开此文件」），且三本手册两种开法。
import cliMd from '../../docs/CLI-手册.md?raw'

/** 三本手册：`kind` → 标题 + 正文（正文全部来自 `docs/*.md`，单一真源） */
const docs: Record<'manual' | 'syntax' | 'cli', { title: string; md: string }> = {
  manual: { title: '操作手册', md: manualMd },
  // adj422：与「脚本规则说明」合并后统一叫「脚本语法说明」
  syntax: { title: '脚本语法说明', md: syntaxMd },
  // adj957：命令行手册（原 `/cli/` 网页那份，同一份 md）
  cli: { title: '命令行手册', md: cliMd },
}

export type DocKind = keyof typeof docs

/** 目录条目的 HTML（一级当分组、二级当条目；与官网 `docs/render.ts` 的 `renderToc` 同口径） */
function tocHtmlOf(md: string): string {
  const items = extractToc(md)
  // 跳过第一个 h1：它是文档标题本身，对话框标题栏已经显示过一次
  const firstH1 = items.findIndex((it) => it.level === 1)
  const list = firstH1 >= 0 ? items.slice(firstH1 + 1) : items
  const html: string[] = []
  for (const it of list) {
    if (it.level === 1) html.push(`<a class="doc-toc-group" href="#${it.id}">${it.text}</a>`)
    else if (it.level === 2) html.push(`<a class="doc-toc-item" href="#${it.id}">${it.text}</a>`)
    // 三级及以下不进目录：文档的 h3 太碎，全列出来反而找不到东西（与官网同一取舍）
  }
  return html.join('\n')
}

export function DocDialog({ kind }: { kind: DocKind }) {
  const doc = docs[kind]
  const ref = useRef<HTMLDivElement>(null)
  const [tocOpen, setTocOpen] = useState(false)

  /**
   * 正文是 `dangerouslySetInnerHTML` 一次性塞进去的 ⇒ 必须在**塞完之后**才挂交互。
   * 依赖 `kind`：切换手册时 DOM 换了，要重新挂。
   * adj958：这里装"滚动高亮"（跳转改由 `<nav>` 自己的 `onClick` 负责，见 `onTocPick`）。
   */
  useEffect(() => {
    const root = ref.current
    if (!root) return
    mountJpsBlocks(root)

    /** 滚动高亮：找"最后一个已经滚过顶部"的标题（与官网 `bindScrollSpy` 同一算法） */
    const heads = Array.from(root.querySelectorAll<HTMLElement>('h1[id], h2[id]'))
    let ticking = false
    const sync = () => {
      ticking = false
      const line = root.scrollTop + 60
      let current: HTMLElement | null = null
      for (const h of heads) {
        // 容器内偏移（`h.offsetTop` 与 `root.offsetTop` 量的是同一个定位祖先）
        if (h.offsetTop - root.offsetTop <= line) current = h
        else break
      }
      const id = current?.id ?? ''
      root.querySelectorAll('a.doc-toc-item, a.doc-toc-group').forEach((a) => {
        a.classList.toggle('active', a.getAttribute('href') === `#${id}`)
      })
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(sync)
    }
    root.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      root.removeEventListener('scroll', onScroll)
    }
  }, [kind])

  /**
   * 点目录条目 ⇒ 跳到对应标题并收起目录。
   *
   * ⚠ adj959（**用户实报**）：「手册的目录打开后，点击其它地方，菜单不会隐藏」——查这条时发现
   * 同一处还藏着第二个：**点条目根本不跳**。
   *
   * 根因（第二个）：目录浮层 `nav.doc-toc-pop` 是 `.doc-content` 的**兄弟节点**（两者都在
   * `.doc-wrap` 里），所以"挂在 `.doc-content` 上的事件委托"**永远收不到浮层里的点击** ✗
   * （第一版就是这么写的）。改成直接挂在 `<nav>` 自己身上 —— React 的 `onClick` 最稳，
   * 也不必再手工 add/remove 监听。
   */
  const onTocPick = (e: ReactMouseEvent<HTMLElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#"]')
    if (a === null) return
    e.preventDefault()
    const root = ref.current
    const id = (a.getAttribute('href') ?? '').slice(1)
    const head = root === null || id === '' ? null : root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
    if (root !== null && head !== null) {
      // `head.offsetTop` 与 `root.offsetTop` 量的是同一个定位祖先 ⇒ 相减即"容器内偏移"
      root.scrollTop = head.offsetTop - root.offsetTop
    }
    setTocOpen(false)
  }

  /**
   * 点面板与按钮之外的地方 ⇒ 关（与官网 `bindTocToggle` 的第三条路同一手感）。
   * 只在打开期间挂监听：不打开就零开销。
   *
   * ⚠ adj959（**用户实报「点其它地方菜单不隐藏」的根因**）：必须用**捕获阶段**监听 `document`。
   *
   * `ui/Modal.tsx` 给 `.modal` 挂了 `onClick={(e) => e.stopPropagation()}`（点框内不该关掉对话框），
   * 而 React 的 `stopPropagation()` **会连带调用原生那次** `stopPropagation()` ⇒
   * **冒泡阶段**挂在 `document` 上的监听，对"对话框内部的点击"永远收不到 ✗（第一版就是这么写的）。
   * 捕获阶段在事件到达目标**之前**跑，不受后面那次 stopPropagation 影响 ✓。
   *
   * 另：打开目录的那一次点击**不会**误关自己 —— 这条 effect 是在该次点击派发结束之后才挂上的；
   * 而且浮层与那个按钮都在豁免名单里 ✓。
   */
  useEffect(() => {
    if (!tocOpen) return
    const onDocClickCapture = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t === null) return
      if (t.closest('.doc-toc-pop') || t.closest('.doc-toc-toggle')) return
      setTocOpen(false)
    }
    document.addEventListener('click', onDocClickCapture, true)
    return () => document.removeEventListener('click', onDocClickCapture, true)
  }, [tocOpen])

  // 切换手册时收起目录（否则新文档的目录浮层会"自己开着"）
  useEffect(() => {
    setTocOpen(false)
  }, [kind])

  const headExtra = (
    <button
      type="button"
      className={`doc-toc-toggle${tocOpen ? ' open' : ''}`}
      title={docCopy.tocTip}
      aria-expanded={tocOpen}
      onClick={() => setTocOpen((v) => !v)}
    >
      {docCopy.tocButton}
    </button>
  )

  return (
    <Modal title={doc.title} maskDim={0.45} compact={false} headExtra={headExtra}>
      <div className="doc-wrap">
        {/* 目录浮层：`.doc-wrap` 是定位祖先且**不参与滚动** ⇒ 浮层永远贴在可视区顶部 */}
        {tocOpen && (
          // adj959：跳转挂在 `<nav>` 自己身上（浮层是 `.doc-content` 的兄弟，委托收不到它的点击）
          <nav className="doc-toc-pop" aria-label={docCopy.tocButton} onClick={onTocPick}>
            <div className="doc-toc-pop-title">{docCopy.tocTitle}</div>
            {/* 目录条目与正文标题 id 同源（见文件头），这里只需把 HTML 塞进去 */}
            <div className="doc-toc-pop-list" dangerouslySetInnerHTML={{ __html: tocHtmlOf(doc.md) }} />
          </nav>
        )}
        <div className="doc-content" ref={ref} dangerouslySetInnerHTML={{ __html: mdToHtml(doc.md) }} />
      </div>
    </Modal>
  )
}
