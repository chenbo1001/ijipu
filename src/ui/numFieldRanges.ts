/**
 * ui/numFieldRanges.ts — 可调数值的「范围 / 步长」单一来源（adj526）
 *
 * 目的：让"按住上下拖数值"与"`−`/`+` 步进"知道每个字段能调到哪，且**只有一处定义**。
 *
 * 关键约定（用户确认）：**谱面类字段的范围直接复用引擎的 `GUIDE_LIMITS` / `GUIDE_LIMITS_EX`**——
 * 那正是预览区排版辅助虚线拖拽在用的同一份表（`margin_*: [20,400]`、`height_shengbu: [-30,300]` …），
 * 引用它就不会出现"拖虚线的范围"与"设置里拖输入框的范围"两处各写一份（本项目
 * `E-2026-129`/`E-2026-143` 反复踩过这个坑）。**引擎里没有范围的字段就不给硬范围**
 * （拖动只做相对增量）——这也保住了设置面板"允许直接填极值"的既有口径
 * （见 `GUIDE_LIMITS_EX.height_shengbu` 的注释：需要更极端的压缩可在设置里直接填）。
 */
import { GUIDE_LIMITS, GUIDE_LIMITS_EX } from '@ijipu/engine'

/** `NumInput` 用到范围的谱面字段（其余字段不限范围） */
export type PageNumKey =
  | 'margin_top'
  | 'margin_bottom'
  | 'margin_left'
  | 'margin_right'
  | 'descAreaH'
  | 'body_margin_top'
  | 'height_ciqu'
  | 'height_quci'
  | 'height_cici'
  | 'height_ciqu_lyric'
  | 'height_shengbu'
  | 'segmentRowGap_bz'
  | 'segmentRowGap_dsb'
  | 'segmentRowGap_tp' // adj629：替谱段与所属歌词行的间距
  | 'barCountInterval'

/**
 * 谱面数值字段 → [min, max]。
 * 值**逐项引用**引擎表（不是抄一份数字）：`GUIDE_LIMITS` 是 `Record<key, [number, number]>`，
 * 这里只做"键名对齐 + 类型收窄"，来源仍是引擎。smoke 有断言逐项比对二者相等。
 */
export const PAGE_NUM_RANGES: Record<PageNumKey, [number, number]> = {
  margin_top: GUIDE_LIMITS.margin_top,
  margin_bottom: GUIDE_LIMITS.margin_bottom,
  margin_left: GUIDE_LIMITS.margin_left,
  margin_right: GUIDE_LIMITS.margin_right,
  height_ciqu: GUIDE_LIMITS.height_ciqu,
  descAreaH: GUIDE_LIMITS_EX.descAreaH,
  body_margin_top: GUIDE_LIMITS_EX.body_margin_top,
  height_quci: GUIDE_LIMITS_EX.height_quci,
  height_cici: GUIDE_LIMITS_EX.height_cici,
  height_ciqu_lyric: GUIDE_LIMITS_EX.height_ciqu_lyric,
  height_shengbu: GUIDE_LIMITS_EX.height_shengbu,
  segmentRowGap_bz: GUIDE_LIMITS_EX.segmentRowGap_bz,
  segmentRowGap_dsb: GUIDE_LIMITS_EX.segmentRowGap_dsb,
  segmentRowGap_tp: GUIDE_LIMITS_EX.segmentRowGap_tp, // adj629
  barCountInterval: GUIDE_LIMITS_EX.barCountInterval,
}

/**
 * 区间够大才启用"横向粗调"：跨度 ≤ 120 的字段（如间距 0~120、字号 10~26）
 * 粗调一下就会跳过头，反而难用；跨度过百的（边距 20~400、声部间距 -30~300）才需要。
 */
export const coarseFor = (range?: readonly [number, number]): boolean =>
  range ? range[1] - range[0] > 120 : false
