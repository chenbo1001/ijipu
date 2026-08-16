/**
 * engine/layout/guides.ts — 排版辅助虚线数据（纯函数）
 * 供预览页叠加可拖拽虚线（边距/行距）使用。
 */
import type { ScoreLayout } from '../types'

/** 音符数字基线到行顶的偏移（noteSize×1.1） */
const NOTE_BASELINE_OFFSET = 18 * 1.1

/** 每页的行顶 y 列表（从音符基线 y 推导，去重排序） */
export function computeRowTops(layout: ScoreLayout): number[][] {
  return layout.pages.map((page) => {
    const tops = new Set<number>()
    for (const n of page.notes) {
      tops.add(Math.round((n.y - NOTE_BASELINE_OFFSET) * 10) / 10)
    }
    return [...tops].sort((a, b) => a - b)
  })
}

/** 可拖拽的排版项：key 对应 PageConfig 字段，dir 为拖拽方向 */
export interface GuideDragSpec {
  key: 'margin_top' | 'margin_bottom' | 'margin_left' | 'margin_right' | 'height_ciqu'
  /** 拖拽方向：v 垂直（改上下/行距）、h 水平（改左右边距） */
  dir: 'v' | 'h'
  /** 反向（右线向左拖 = 右边距增大） */
  invert?: boolean
}

export const GUIDE_ITEMS: GuideDragSpec[] = [
  { key: 'margin_top', dir: 'v' },
  { key: 'margin_bottom', dir: 'v' },
  { key: 'margin_left', dir: 'h' },
  { key: 'margin_right', dir: 'h', invert: true },
  { key: 'height_ciqu', dir: 'v' },
]

/** 拖拽增量（显示像素 → 页面 pt），scale = 显示宽度 / 页面宽 */
export function dragDelta(
  spec: GuideDragSpec,
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  scale: number,
): number {
  const raw = spec.dir === 'v' ? curY - startY : curX - startX
  let delta = raw / scale
  if (spec.invert) delta = -delta
  return delta
}

/** 数值范围钳制 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 各字段的调整范围 */
export const GUIDE_LIMITS: Record<GuideDragSpec['key'], [number, number]> = {
  margin_top: [20, 400],
  margin_bottom: [20, 400],
  margin_left: [20, 400],
  margin_right: [20, 400],
  height_ciqu: [0, 300],
}
