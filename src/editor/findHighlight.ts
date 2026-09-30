/**
 * editor/findHighlight.ts — 编辑区里的**查找高亮**（adj642，用户要求）
 *
 * 用户口径："当按下 Ctrl+F 热键时，编辑区选中的文本自动成为查找框的内容，并完成查找，
 * 同时高亮编辑区里已找到的内容"；"高亮层怎么产出可参考系统(浏览器)的查找实现"。
 *
 * ## 做法：照浏览器页内查找那一套 —— CSS Custom Highlight API
 * 浏览器自己的"查找"高亮不是改 DOM，而是把命中的 `Range` 注册进 `CSS.highlights`，
 * 再由 `::highlight(名字)` 上色（Chrome 105+ / WebView2 / Safari 17.2+ / Firefox 140+）。
 * 这里照做：注册两个高亮名——
 *   · `ijipu-find`         = 全部命中；
 *   · `ijipu-find-current` = 当前命中（与 `::highlight` 的层叠顺序一致：后注册的在上）。
 *
 * ## 为什么目标是"语法高亮层"而不是 textarea
 * textarea 是替换元素，内部文本无法用 DOM 选中/高亮；而本项目本来就有一层**语法高亮层**
 * （`.highlight-content` 里的 `.hl-line`，见 `highlight.ts`）**就垫在 textarea 底下、逐字符对应源码**
 * （textarea 背景透明、文字画在上面）⇒ 在这一层的文本节点上建 Range，高亮就正好落在字下面。
 *
 * ## 偏移换算（`data-line` / `data-col` 的用处）
 * 折行后一个源码行会被切成多个 `.hl-line`（这些 div 的文本里**没有换行符**），所以"源码字符偏移"
 * 与"DOM 里的第几个字符"不能直接对齐。`highlight.ts` 给每个视觉行标了 `data-line` / `data-col`
 * （该段在其源码行内的起始列）⇒ 换算变成直读：找到行 → 找到列区间命中的那一段 → 段内偏移 =
 * `列 − data-col`，再在该段的文本节点里数过去。
 *
 * 全部换算失败（DOM 与 code 不一致，例如刚 setState 还没渲染）时**静默放弃**：高亮是锦上添花，
 * 不能因为它让编辑出错。旧浏览器没有 `CSS.highlights` ⇒ 同样安静降级（查找/替换照常可用）。
 */
import type { FindMatch } from './findReplace'

/** 两个高亮名（CSS 里 `::highlight(...)` 用同一对字面量；冒烟有断言锁住两端一致） */
export const FIND_HL = 'ijipu-find'
export const FIND_HL_CURRENT = 'ijipu-find-current'

/** `CSS.highlights` 是否可用（旧浏览器没有 ⇒ 调用方直接跳过） */
const hasHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

/**
 * 在一个视觉行 div 内，按"段内字符偏移"取到对应的 (文本节点, 节点内偏移)。
 * @param lineEl 视觉行 div
 * @param col 该段起始列（`data-col`）
 * @param offset 目标字符在本源码行内的列
 */
function locateInLine(lineEl: Element, col: number, offset: number): { node: Node; at: number } | null {
  let want = offset - col
  if (want < 0) return null
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent?.length ?? 0
    if (want <= len) return { node, at: want }
    want -= len
    node = walker.nextNode()
  }
  return null
}

/** 该源码行里覆盖 `col` 的那个视觉行 div（没有 `data-line` 标记时返回 null） */
function visualLineAt(root: HTMLElement, line: number, col: number): HTMLElement | null {
  const divs = root.querySelectorAll<HTMLElement>(`.hl-line[data-line="${line}"]`)
  let last: HTMLElement | null = null
  for (const div of divs) {
    const start = Number(div.dataset.col ?? '0')
    if (start <= col) last = div
    else break
  }
  return last
}

/**
 * 把 `matches` 注册成编辑区高亮；`currentIndex` 那一项用"当前"颜色。
 *
 * @param root 语法高亮层的容器（`.highlight-content`）
 * @param code 与 DOM 一致（**已归一化换行**）的源码
 * @param matches 命中项（偏移基于同一份 code）
 * @param currentIndex 当前项下标（-1 = 无）
 */
export function applyFindHighlights(
  root: HTMLElement | null,
  code: string,
  matches: readonly FindMatch[],
  currentIndex: number,
): void {
  if (!root) return
  if (!hasHighlightApi()) return
  const lineStarts = (() => {
    const starts = [0]
    for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1)
    return starts
  })()
  const colOf = (offset: number): { line: number; col: number } | null => {
    if (offset < 0 || offset > code.length) return null
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, col: offset - lineStarts[lo] }
  }
  const all: Range[] = []
  const current: Range[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const a = colOf(m.start)
    const b = colOf(m.end)
    if (!a || !b) continue
    const la = visualLineAt(root, a.line, a.col)
    const lb = visualLineAt(root, b.line, Math.max(a.col, b.col - 1))
    if (!la || !lb) continue
    const pa = locateInLine(la, Number(la.dataset.col ?? '0'), a.col)
    const pb = locateInLine(lb, Number(lb.dataset.col ?? '0'), b.col)
    if (!pa || !pb) continue
    try {
      const r = document.createRange()
      r.setStart(pa.node, pa.at)
      r.setEnd(pb.node, pb.at)
      all.push(r)
      if (i === currentIndex) current.push(r)
    } catch {
      // 极端情况下（节点被替换）Range 非法 ⇒ 跳过这一项，不影响其它命中
    }
  }
  CSS.highlights.delete(FIND_HL)
  CSS.highlights.delete(FIND_HL_CURRENT)
  if (all.length > 0) {
    CSS.highlights.set(FIND_HL, new Highlight(...all))
    // 当前项**后注册** ⇒ 叠在全部命中之上（与浏览器查找"当前项颜色不同"一致）
    if (current.length > 0) CSS.highlights.set(FIND_HL_CURRENT, new Highlight(...current))
  }
}

/** 清理（编辑器卸载 / 查找内容清空时用，避免残留旧 Range 指向已替换的节点） */
export function clearFindHighlights(): void {
  if (!hasHighlightApi()) return
  CSS.highlights.delete(FIND_HL)
  CSS.highlights.delete(FIND_HL_CURRENT)
}
