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

/** 行的结构位置：曲行顶/曲底/歌词位置（adj10 虚线用） */
export interface RowGuide {
  /** 曲行顶 y */
  yTop: number
  /** 曲行底 y（数字下方，容纳减时线） */
  yBottom: number
  /** 第一行歌词基线 y（无歌词为 null） */
  lyricTop: number | null
  /** 最后一行歌词底部 y（无歌词为 null） */
  lyricBottom: number | null
}

/** 计算每页每行的结构位置（供曲词间距/词曲间距虚线） */
export function computeRowGuides(
  layout: ScoreLayout,
  cfg: { quci: number; geci: number },
): RowGuide[][] {
  return layout.pages.map((page) => {
    const rowMap = new Map<number, { yTop: number; lyricYs: number[] }>()
    for (const n of page.notes) {
      const yTop = Math.round((n.y - NOTE_BASELINE_OFFSET) * 10) / 10
      if (!rowMap.has(yTop)) rowMap.set(yTop, { yTop, lyricYs: [] })
    }
    const tops = [...rowMap.keys()]
    for (const l of page.lyrics) {
      let best = -1
      let bestD = Infinity
      for (const yTop of tops) {
        const d = Math.abs(l.y - (yTop + NOTE_BASELINE_OFFSET + cfg.quci))
        if (d < bestD) {
          bestD = d
          best = yTop
        }
      }
      if (best >= 0) rowMap.get(best)!.lyricYs.push(l.y)
    }
    return [...rowMap.values()].map((r) => {
      r.lyricYs.sort((a, b) => a - b)
      const lyricTop = r.lyricYs.length > 0 ? r.lyricYs[0] : null
      const lyricBottom =
        r.lyricYs.length > 0 ? r.lyricYs[r.lyricYs.length - 1] + cfg.geci : null
      return {
        yTop: r.yTop,
        yBottom: r.yTop + NOTE_BASELINE_OFFSET + 18 * 0.6,
        lyricTop,
        lyricBottom,
      }
    })
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
  spec: { key: string; dir: 'v' | 'h'; invert?: boolean },
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

/** 描述头区域高度（下沿；与 layout.metrics.titleAreaH 一致） */
export function metaAreaH(cfg: {
  margin_top: number
  body_margin_top: number
  biaoti_size: number
}): number {
  return cfg.margin_top + cfg.body_margin_top + cfg.biaoti_size * 1.6 + 30
}

/**
 * 描述头元素位置钳制见 metaAnchors.ts（adj16 锚点语义：top-center / bottom-right / bottom-left）。
 */

/** 各字段的调整范围 */
export const GUIDE_LIMITS: Record<GuideDragSpec['key'], [number, number]> = {
  margin_top: [20, 400],
  margin_bottom: [20, 400],
  margin_left: [20, 400],
  margin_right: [20, 400],
  height_ciqu: [0, 300],
}

/** 扩展的可拖拽项（adj10：描述头高度/曲下/词下） */
export type GuideKeyEx =
  | 'body_margin_top'
  | 'height_quci'
  | 'height_cici'

export const GUIDE_LIMITS_EX: Record<GuideKeyEx, [number, number]> = {
  body_margin_top: [0, 400],
  height_quci: [0, 120],
  height_cici: [0, 120],
}
