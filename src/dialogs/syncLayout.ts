/**
 * dialogs/syncLayout.ts — 对拍台的**窗口尺寸与分区高度**（可调整、可记忆，纯函数可断言）
 *
 * 用户 2026-10-24：「窗口无法调整大小和最大化」「波形要能调高度」「预览区应能调高度、
 * 其它跟随上下平移、最下一排跟随缩放」「预览谱面要能调整**缩放比率**（不是 16:9 那种比例）」。
 *
 * 所以台面不再是"固定 1240×760"：
 *  - 面板宽高可拖右下角改、可最大化/还原（双击标题条也行）；
 *  - 预览区高度、波形高度各自可拖分隔条改；
 *  - 中间的锚点/微调区吃剩余高度（`flex:1`），面板变大它就变大；
 *  - 预览固定 16:9 画布（与成片同一套相机），另给一个 **`previewZoom`（0.5~3 倍）** 看细节。
 *
 * 这些是**这台机器上的偏好**（L1），换台机器不一样很正常 —— 存 `ijipu.syncLayout`。
 */
export interface SyncLayout {
  /** 面板宽（px；最大化时不用它） */
  w: number
  /** 面板高（px；最大化时不用它） */
  h: number
  /** 波形高度（px，含下侧时间标尺之外的波形本体） */
  waveH: number
  /** 预览区高度（px） */
  previewH: number
  /**
   * 预览**缩放比率**（1 = 原样；2 = 放大两倍看细节）。
   * 注意：这不是"16:9 / 9:16"那种画布比例——画布固定 16:9（与成片一致），
   * 这里只是把渲染结果整体放大/缩小（用户 2026-10-24 明确要"缩放比率"）。
   */
  previewZoom: number
  /** 是否最大化 */
  maximized: boolean
}

/** L1 键（`ijipu.` 前缀；与其它偏好同一命名空间） */
export const SYNC_LAYOUT_KEY = 'ijipu.syncLayout'

export const DEFAULT_SYNC_LAYOUT: SyncLayout = {
  w: 1240,
  h: 820,
  waveH: 172,
  previewH: 230,
  previewZoom: 1,
  maximized: false,
}

/** 预览缩放的可选档位（下拉里列这些，避免拖出一个 1.037× 这种怪数） */
export const PREVIEW_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const

/** 各区块的合理范围（拖太狠会"看不出东西"，这里兜住） */
export const SYNC_LAYOUT_LIMITS = {
  wMin: 760,
  hMin: 520,
  waveMin: 90,
  waveMax: 420,
  previewMin: 120,
  previewMax: 520,
  zoomMin: 0.5,
  zoomMax: 3,
  /**
   * 除了预览/波形，标题条 + 三排参数 + 分隔条 + 底部状态/按钮 + **至少一二百像素的锚点区**
   * 至少要这么多高（少了它，底部就会只剩一条缝、内容被切——adj1124 实测）。
   */
  chromeMin: 360,
} as const

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 夹进合法范围。
 *
 * 除了逐项夹紧，还要保证「预览 + 波形」不要吃光面板高度（否则底部锚点/微调区会被压成 0）：
 * 先压预览，再压波形，都留最小值。
 */
export function normalizeSyncLayout(l: SyncLayout, viewW: number, viewH: number): SyncLayout {
  const lim = SYNC_LAYOUT_LIMITS
  const wMax = Math.max(lim.wMin, viewW - 24)
  const hMax = Math.max(lim.hMin, viewH - 24)
  const w = clamp(Number.isFinite(l.w) ? l.w : DEFAULT_SYNC_LAYOUT.w, lim.wMin, wMax)
  const h = clamp(Number.isFinite(l.h) ? l.h : DEFAULT_SYNC_LAYOUT.h, lim.hMin, hMax)
  const waveH = clamp(Number.isFinite(l.waveH) ? l.waveH : DEFAULT_SYNC_LAYOUT.waveH, lim.waveMin, lim.waveMax)
  let previewH = clamp(
    Number.isFinite(l.previewH) ? l.previewH : DEFAULT_SYNC_LAYOUT.previewH,
    lim.previewMin,
    lim.previewMax,
  )
  const previewZoom = clamp(
    Number.isFinite(l.previewZoom) ? l.previewZoom : DEFAULT_SYNC_LAYOUT.previewZoom,
    lim.zoomMin,
    lim.zoomMax,
  )
  // 预览 + 波形 + 其它，最少要留 `chromeMin`
  const budget = h - waveH - lim.chromeMin
  if (previewH > budget) previewH = Math.max(lim.previewMin, budget)
  return { w, h, waveH, previewH, previewZoom, maximized: l.maximized === true }
}

/** 从 L1 读（坏值/没有 ⇒ 默认；一律过一遍夹紧） */
export function loadSyncLayout(viewW = 1440, viewH = 900): SyncLayout {
  try {
    const raw = localStorage.getItem(SYNC_LAYOUT_KEY)
    if (raw === null) return normalizeSyncLayout(DEFAULT_SYNC_LAYOUT, viewW, viewH)
    const o = JSON.parse(raw) as Partial<SyncLayout>
    return normalizeSyncLayout({ ...DEFAULT_SYNC_LAYOUT, ...o } as SyncLayout, viewW, viewH)
  } catch {
    return normalizeSyncLayout(DEFAULT_SYNC_LAYOUT, viewW, viewH)
  }
}

/** 写 L1（失败静默：内存里的台面照常用） */
export function saveSyncLayout(l: SyncLayout): void {
  try {
    localStorage.setItem(SYNC_LAYOUT_KEY, JSON.stringify(l))
  } catch {
    /* 配额满/隐私模式 */
  }
}

/** 用户拖右下角：按指针位移算新宽高（再夹紧） */
export function resizeSyncLayout(
  l: SyncLayout,
  dx: number,
  dy: number,
  viewW: number,
  viewH: number,
): SyncLayout {
  return normalizeSyncLayout(
    { ...l, w: l.w + dx, h: l.h + dy, maximized: false },
    viewW,
    viewH,
  )
}

/**
 * 预览 ↔ 波形之间拖：改预览高度。
 *
 * 用户 2026-10-24：「预览区应能调整高度，其它跟随上下平移」——所以往下拖时，
 * 若面板余量不够（底部锚点区会被压没），**面板自己长高**（上限 = 视口）；
 * 面板已经到顶时，底部区域按最小高度兜住并允许滚动。
 * 往上拖只把预览压小，面板不自动缩（要缩就拖右下角，避免"拖一下窗口自己变小"的意外）。
 */
export function resizePreviewH(l: SyncLayout, dy: number, viewH: number, viewW = 1440): SyncLayout {
  const lim = SYNC_LAYOUT_LIMITS
  const want = clamp(l.previewH + dy, lim.previewMin, lim.previewMax)
  const h = Math.max(l.h, Math.min(viewH - 24, want + l.waveH + lim.chromeMin))
  return normalizeSyncLayout({ ...l, previewH: want, h }, viewW, viewH)
}

/** 波形下沿拖：改波形高度（同理，余量不够就让面板长高） */
export function resizeWaveH(l: SyncLayout, dy: number, viewH: number, viewW = 1440): SyncLayout {
  const lim = SYNC_LAYOUT_LIMITS
  const want = clamp(l.waveH + dy, lim.waveMin, lim.waveMax)
  const h = Math.max(l.h, Math.min(viewH - 24, l.previewH + want + lim.chromeMin))
  return normalizeSyncLayout({ ...l, waveH: want, h }, viewW, viewH)
}
