/**
 * export/video/cardLayout.ts — 片尾卡的**纵向排版**（纯函数，可断言）
 *
 * 为什么单独抽出来：片尾的三行（品牌名 / 标语 / 网址）原来各写各的 `H × 百分比`，
 * 结果"标题贴着标语、标语到网址一大片空"。这里按**字号**成比例排，同一套系数三种画布居中，
 * 并且能被 smoke 直接断言（不用渲染位图）。
 *
 * 口径（用户 2026-10-23）：「标题和内容之间间距可以均衡点，有点太挤了」——
 *   · 品牌名基线 → 强调线：`0.75 × 标题字号`（旧版 0.45，强调线几乎压着标题下沿）；
 *   · 强调线 → 标语基线：`1.2 × 标语字号`（强调线不压标语，留出一行空隙）；
 *   · 标语 → 网址：网址仍按 `H` 的百分比作"落款"（旧位置不变，不制造下半片空白）。
 *
 * 三个尺寸（9:16 / 1:1 / 16:9）的系数不同：16:9 标题更大、9:16 内容更宽，见下。
 */
export interface EndCardLayout {
  /** 品牌名字号 */
  titleSize: number
  /** 标语字号 */
  sloganSize: number
  /** 网址字号 */
  urlSize: number
  /** 品牌名基线 y */
  titleY: number
  /** 强调线 y（线的高点） */
  accentY: number
  /** 标语基线 y */
  sloganY: number
  /** 网址基线 y */
  urlY: number
  /** 强调线高度（px）——渲染端用它画线，保证"线中心 = 中点"的口径只有一处 */
  lineH: number
  /** 文本最大宽度 */
  maxW: number
  /** 强调线长度占画布宽的比例 */
  lineRatio: number
}

/** 片尾卡纵向排版（W×H 为成片画布像素） */
export function endCardLayout(W: number, H: number): EndCardLayout {
  const unit = Math.min(W, H)
  const aspect = W / H
  const tall = aspect < 0.8
  const wide = aspect > 1.3
  const titleScale = wide ? 1.14 : tall ? 1.0 : 1.04
  const titleSize = Math.round(unit * 0.1 * titleScale)
  const sloganSize = Math.round(unit * (wide ? 0.05 : tall ? 0.043 : 0.045))
  const urlSize = Math.round(unit * (wide ? 0.034 : tall ? 0.03 : 0.032))
  /**
   * adj1098（用户 2026-10-23 看图实报「横线偏下，应在标题与内容的间距中间」）：
   * 强调线**居中对齐**"标题墨迹下沿 ↔ 标语墨迹上沿"的空白带，不再按标题基线的百分比放。
   *
   * 墨迹口径（与项目"以墨迹为准"一致）：标题下沿 ≈ 基线 + 0.2×标题字号（下伸部），
   * 标语上沿 ≈ 基线 − 0.8×标语字号（上伸部）。线中心 = 两者中点。
   * 旧算法 `titleY + 0.75×标题字号`：9:16 时线中心离中点偏下约 23px（用户截图正是这个）。
   */
  const titleY = H * (wide ? 0.42 : tall ? 0.4 : 0.42)
  /** 标语与标题的总距离（先定标语，线再放到两者正中间，避免"先放线、标语跟着线走"的耦合） */
  const sloganY = titleY + titleSize * 0.75 + sloganSize * 1.2
  const lineH = Math.max(2, unit * 0.004)
  const titleInkBottom = titleY + titleSize * 0.2
  const sloganInkTop = sloganY - sloganSize * 0.8
  const accentY = (titleInkBottom + sloganInkTop) / 2 - lineH / 2
  // 网址仍是"落款"，位置不动（旧版 0.8/0.72/0.76），免得片尾下沿空一片
  const urlY = H * (wide ? 0.8 : tall ? 0.72 : 0.76)
  const maxW = W * (wide ? 0.8 : 0.86)
  const lineRatio = wide ? 0.14 : tall ? 0.18 : 0.16
  return { titleSize, sloganSize, urlSize, titleY, accentY, sloganY, urlY, maxW, lineRatio, lineH }
}
