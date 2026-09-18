/**
 * preview/zoomFit.ts — 预览比例「按宽度适配」的**纯算式**（adj529）
 *
 * 需求（用户）："**双击顶栏上的预览比率值**时，按宽度适配的比率显示。"
 * 且明确要求 **不新增变量/设置** —— 所以这里只是"一次跳到适配值"的换算，
 * 结果直接写进已有的 `previewZoom`（照常钳制 50~200、照常持久化），没有"适配模式"这种长期状态；
 * 之后窗口再变宽变窄比例保持不动（想再适配就再双击一次）。
 *
 * 预览的显示宽度 = `PREVIEW_BASE_W × zoom%`（见 `PreviewPane` 的 `.preview-zoom-scale`），
 * 于是"让页面宽度撑满预览区"就是一个反算：
 *   `zoom = (预览区可用内容宽) / PREVIEW_BASE_W × 100`
 * 这里只放算式（零 React / 零 DOM，`scripts/smoke.mts` 直接断言）；
 * "现量预览区宽度并写回"在 `ui/TopBar.tsx` 的 `applyFitZoom`。
 *
 * 坑（已在注释里写明）：`clientWidth` 已排除纵向滚动条，所以有/无滚动条会让可用宽度差一条滚动条的宽。
 * 谱面页通常明显高于视口 ⇒ 纵向滚动条常驻、可用宽度稳定；双击是**一次性**取值，也不会来回摆。
 *
 * adj529（用户确认放宽）：**换算用的范围要传"绝对范围"**（`uiStore.PREVIEW_ZOOM_LIMITS` = [30,400]），
 * 不是手动调节范围（[50,200]）——窄预览区（手机分屏 ~340px ⇒ 约 38%）与很宽的预览区（4K 全宽 ⇒ 约 388%）
 * 都要能贴合；手动 `−`/`+`/拖动仍守 [50,200]（边界在顶栏把关）。
 */

/** 预览页基准宽度（px）：显示宽 = 基准宽 × zoom%。**单一来源**，`PreviewPane` 从这里取。 */
export const PREVIEW_BASE_W = 760

/** `.preview-pane` 的左右内边距（与 `index.css` 的 `padding: 24px` 对齐） */
export const PREVIEW_PANE_PAD_X = 24

/** 把比例钳到范围内（并取整）——与 `uiStore.setPreviewZoom` 同一把尺子（范围由调用方传入，避免两处各写一份数字） */
export function clampPreviewZoom(z: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], Math.round(z)))
}

/**
 * 按预览区宽度反算"适配宽度"的比例。
 * @param paneClientW 预览滚动容器（`.preview-pane`）的 `clientWidth`（**已排除滚动条**）
 * @returns 适配比例（%）；宽度未知/过窄时返回 **0**（调用方据此回退到手动比例，而不是硬套一个错值）
 */
export function fitZoomFor(paneClientW: number, range: readonly [number, number]): number {
  const avail = paneClientW - PREVIEW_PANE_PAD_X * 2
  if (!Number.isFinite(avail) || avail <= 0) return 0
  return clampPreviewZoom((avail / PREVIEW_BASE_W) * 100, range)
}
