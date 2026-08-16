/**
 * engine/layout/metaAnchors.ts — 描述头元素锚点（adj16）
 *
 * 描述头元素以「区域锚点 + 相对偏移」定位；区域宽/高变化时元素跟随各自锚点：
 *  - top-center    标题/副标题    —— 描述区上边中点
 *  - bottom-right  词曲作者       —— 描述区右下角
 *  - bottom-left   调式/拍号/速度 —— 描述区左下角
 *
 * metaPos[key] = { x, y } 为相对锚点的偏移（x 向右、y 向下为正，SVG 坐标）。
 */
import { clamp, metaAreaH } from './guides'

export type MetaAnchor = 'top-center' | 'bottom-right' | 'bottom-left'

/** key → 锚点类型（title/subtitle_i → 上居中，author_i → 右下，keyline/tempo → 左下） */
export function metaAnchorOf(key: string): MetaAnchor {
  if (key === 'title' || key.startsWith('subtitle')) return 'top-center'
  if (key.startsWith('author')) return 'bottom-right'
  return 'bottom-left'
}

export interface MetaAreaCfg {
  margin_top: number
  margin_left: number
  margin_right: number
  body_margin_top: number
  biaoti_size: number
}

/** 锚点绝对坐标（页面 pt） */
export function metaAnchorPt(
  anchor: MetaAnchor,
  pageW: number,
  cfg: MetaAreaCfg,
): { x: number; y: number } {
  const areaW = pageW - cfg.margin_left - cfg.margin_right
  const areaH = metaAreaH(cfg) - cfg.margin_top
  switch (anchor) {
    case 'top-center':
      return { x: cfg.margin_left + areaW / 2, y: cfg.margin_top }
    case 'bottom-right':
      return { x: pageW - cfg.margin_right, y: cfg.margin_top + areaH }
    case 'bottom-left':
      return { x: cfg.margin_left, y: cfg.margin_top + areaH }
  }
}

/**
 * 描述头元素偏移钳制（相对各自锚点，adj16）：元素不超出描述头区域。
 * 区域宽 = 页宽 - 左右边距，区域高 = metaAreaH - margin_top。
 * 调式/拍号/节拍（左下锚）向右偏移留 40 防文本越界。
 */
export function clampMetaPos(
  key: string,
  relX: number,
  relY: number,
  pageW: number,
  cfg: MetaAreaCfg,
): { x: number; y: number } {
  const areaW = pageW - cfg.margin_left - cfg.margin_right
  const areaH = metaAreaH(cfg) - cfg.margin_top
  switch (metaAnchorOf(key)) {
    case 'top-center':
      return { x: clamp(relX, -areaW / 2, areaW / 2), y: clamp(relY, 0, areaH) }
    case 'bottom-right':
      return { x: clamp(relX, -areaW, 0), y: clamp(relY, -areaH, 0) }
    case 'bottom-left': {
      const xMax =
        key.startsWith('keyline') || key.startsWith('tempo') ? Math.max(0, areaW - 40) : areaW
      return { x: clamp(relX, 0, xMax), y: clamp(relY, -areaH, 0) }
    }
  }
}
