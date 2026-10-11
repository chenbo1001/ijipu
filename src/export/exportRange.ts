/**
 * export/exportRange.ts — 「导出范围」在应用侧的**实测墨迹盒**（adj873）
 *
 * ## 这个模块只做一件事：**量**
 * 「范围」的几何只有一份 —— 引擎 `engine/render/range.ts`（`rangeBox()` 算盒、`applyRangeToSvg()` 改外框）。
 * 应用这边缺的恰恰是"墨迹盒从哪来"：只有**渲染到 DOM 里**的 SVG 才量得到真实字形（`getBBox()`），
 * 而引擎是纯 TS、零 DOM ⇒ 它**接收**墨迹盒，不瞎估。
 *
 * 所以这里就是那个"把预览区已渲染的 SVG 量成墨迹盒"的桥：**只量、不裁、不算留白** ✓。
 *
 * ## 口径（与 Obsidian 插件 `scorePane.ts` 的 `measureContentBox` **同一套**）
 * 1. **不能用 `svg.getBBox()`**：引擎产物第一层是整页白底 `<rect data-page-bg="1" width="100%" …>`
 *    ⇒ 量出来永远等于整页（等于没裁 ✗）。必须**排除 `data-page-bg`**；
 * 2. 对其余顶层子元素**逐个** `getBBox()` 求并集 —— 对"元素直接挂在 svg 下"和"包在若干 `<g>` 里"都成立；
 * 3. 量不到（无子元素 / 元素还不在渲染树里 / 过程中抛错）⇒ 返回 `null`，
 *    由调用方**明确报错**（"先显示一次谱面"），**绝不静默退回整页** ✗。
 */
import type { RangeBox } from '@ijipu/engine'

/** 预览区已渲染的页面 SVG（按页面顺序；一个 `.preview-svg` 装一页） */
function previewSvgElements(root: ParentNode): SVGSVGElement[] {
  return Array.from(root.querySelectorAll<SVGSVGElement>('.preview-svg > svg'))
}

/**
 * 量**一页**的墨迹盒（页面坐标）。返回 `null` = 这一页量不出来。
 * 口径见文件头：排除整页白底，其余顶层子元素求并集。
 */
function inkOfSvg(svg: SVGSVGElement): RangeBox | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const child of Array.from(svg.children)) {
    if (child.getAttribute('data-page-bg') !== null) continue // 整页白底不是"内容"
    const el = child as SVGGraphicsElement
    if (typeof el.getBBox !== 'function') continue
    let b: DOMRect
    try {
      b = el.getBBox()
    } catch {
      continue // 未渲染/不可见元素取不到盒
    }
    if (!(b.width > 0) && !(b.height > 0)) continue
    if (b.x < x0) x0 = b.x
    if (b.y < y0) y0 = b.y
    if (b.x + b.width > x1) x1 = b.x + b.width
    if (b.y + b.height > y1) y1 = b.y + b.height
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * 量预览区**每一页**的墨迹盒（按页面顺序；量不到的页为 `null`）。
 * @param root 预览区容器（缺省 = `document`，即整个预览面板）
 */
export function measureInkFromPreview(root?: ParentNode): (RangeBox | null)[] {
  const scope = root ?? document
  return previewSvgElements(scope).map(inkOfSvg)
}
