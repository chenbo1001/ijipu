/**
 * engine/dynamic/ball.ts — 跳跳球的**抛体轨迹**（纯函数）
 *
 * 用户口径（2026-10-22）：「球不要限定在色块范围内，它有自己的轨迹；落点是每一拍开始的位置，
 * 只是每次落下刚好落在色块上」——就是打砖块/接球游戏里那颗球：**在空中划一条抛物线飞过去**。
 *
 * 于是：
 *  - **横向**：从这一拍落点飞到下一拍落点（线性插值，看起来像"被抛出去"）；
 *  - **纵向**：抛物线 `4u(1-u)`，u=0 落地、u=1 落地 ⇒ **每拍起落一次**；
 *  - 落点 = 那一拍开始时**正在响的色块**的上沿中心。
 *
 * 与音符的疏密无关：一拍里两个八分音符，球也只落一次。
 */

/** 一个落点：那一拍开始时色块的位置 */
export interface BallAnchor {
  t0: number
  t1: number
  /** 色块水平中心（页面坐标） */
  cx: number
  /** 色块上沿 y（页面坐标） */
  top: number
  /**
   * 色块左缘与宽度（可选）。给了就按**拍点在这条色块里的比例**落位——
   * 附点/长音的拍点落在音的中间，球落在色块中间偏右，而不是永远压在正中心。
   */
  x?: number
  w?: number
}

export interface BallPos {
  /** 页面坐标 */
  x: number
  y: number
  /** 当前拍内的相位（0~1，0/1 = 落地） */
  u: number
}

/** `ballAt` 的可选项 */
export interface BallOptions {
  /**
   * 跨行判定阈值（页面坐标）：两次落点的纵向差超过它，就认为"换行了"。
   *
   * **默认关闭（Infinity）**：用户 2026-10-22 明确「一行的最后一拍就该往下一行行首飞」——
   * 那是正常的抛体轨迹，不该截断。这个选项只留给将来"想让换行更硬"时用。
   */
  lineJump?: number
}

/** 找 `t` 时刻正在响的那条（t0 ≤ t < t1） */
function anchorAt(anchors: readonly BallAnchor[], t: number): BallAnchor | null {
  let found: BallAnchor | null = null
  for (const a of anchors) {
    if (a.t0 <= t && t < a.t1) {
      /**
       * 取**最晚开始**的那条 —— 必须与色块同口径（`playheadPosIn` 也是取"最后一个 atMs ≤ t"）。
       * 取最早的话，连音/重叠时会落到**前一个**音上，看起来就是"球落在色块界外"（用户实报）。
       */
      if (!found || a.t0 >= found.t0) found = a
    }
  }
  return found
}

/**
 * 拍网格的**相位**（毫秒，0 ≤ phase < beatMs）。
 *
 * 为什么需要：序列时间是从**第一个音**开始算 0 的，弱起谱（如 `( 5 5 6 )`）真正的拍点
 * 会落在半个拍上 ⇒ 直接用 0 当锚点，球整体偏半拍（用户实报「落点晚了」）。
 *
 * 做法：拿**长音（≥ 0.9 拍）的起点**投票——长音基本都压在拍上，取票数最多的余数。
 * 没有长音（全是很短的音）就退回 0，保持原行为。
 */
export function beatPhaseOf(anchors: readonly BallAnchor[], beatMs: number): number {
  if (beatMs <= 0) return 0
  const buckets = new Map<number, number>()
  for (const a of anchors) {
    if (a.t1 - a.t0 < beatMs * 0.9) continue
    const r = Math.round((((a.t0 % beatMs) + beatMs) % beatMs) / 5) * 5
    buckets.set(r, (buckets.get(r) ?? 0) + 1)
  }
  let best = 0
  let bestN = 0
  for (const [r, n] of buckets) {
    if (n > bestN) {
      best = r
      bestN = n
    }
  }
  return best
}
function nextAnchor(anchors: readonly BallAnchor[], t: number): BallAnchor | null {
  for (const a of anchors) if (a.t0 > t) return a
  return null
}

/**
 * 球在 `t` 时刻的位置。
 *
 * @param anchors 落点表（按 t0 升序；只放主声部的色块，避免多声部各飞一颗）
 * @param t       当前时刻（与 anchors 同一时间轴）
 * @param beatMs  一拍多少毫秒
 * @param anchorMs 第一拍的时刻
 * @param amp     抛物线最高点（页面坐标单位）——球"飞多高"
 *
 * ## 为什么会「时隐时现」「乱飞」（用户实报，2026-10-22）
 *
 * - **隐**：休止拍 / 音与音之间有空档时，`anchorAt` 找不到落点就返回 null ⇒ 球消失。
 *   现在改成：这一拍没音就**朝下一个有音的位置跳**（球只出现一次、之后不再消失）。
 * - **乱飞**：落点为空时回退到"上一个落点"，球会原地上下掉。同一条修法解决。
 * - **收尾**：最后一个音结束后球**自由落体**（离开画面），这是用户要的。
 */
export function ballAt(
  anchors: readonly BallAnchor[],
  t: number,
  beatMs: number,
  anchorMs: number,
  amp: number,
  /**
   * 小节起点时刻（升序）。给了它，拍网格**按小节重置**——
   * 用户口径：「小节开始的第一个音总是第一拍的开始」，弱起/漂移不会累到下一小节。
   */
  barStartsMs?: readonly number[],
): BallPos | null {
  if (beatMs <= 0 || anchors.length === 0) return null
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  // 第一个音之前：不画球（片头标题卡阶段）
  if (t < first.t0) return null
  // 最后一个音结束之后：**自由落体**，球离开视界
  if (t > last.t1) {
    const dt = (t - last.t1) / 1000
    const y = last.top + 0.5 * 2600 * dt * dt
    if (y > 2400) return null // 已经落出画面（页面高约 842）
    return { x: last.cx, y, u: 0 }
  }
  // 有小节起点就用"本小节的拍网格"：小节第一个音 = 第一拍
  let barStart = anchorMs
  if (barStartsMs && barStartsMs.length > 0) {
    for (const s of barStartsMs) {
      if (s <= t) barStart = s
      else break
    }
  }
  const k = Math.floor((t - barStart) / beatMs)
  const b0 = barStart + k * beatMs
  const b1 = b0 + beatMs
  // 这一拍没音 ⇒ 朝下一个有音的落点跳（不再返回 null，球不会消失）
  const a0 = anchorAt(anchors, b0) ?? nextAnchor(anchors, b0) ?? first
  const a1 = anchorAt(anchors, b1) ?? nextAnchor(anchors, b1) ?? a0
  const u = Math.max(0, Math.min(1, (t - b0) / beatMs))
  /**
   * 目标 = **下一拍**那个色块（用户 2026-10-22 口径：不是"下一个音"——八分音符也是音，但不是拍）。
   * 这一拍里球从当前落点飞向下一拍落点；若下一拍换了行/跳转，就朝那边飞。
   *
   * `lineJump` 只作为"整行平移"的兜底开关，默认不启用。
   */
  const target = a1
  /**
   * 落点横向位置：拍点落在色块**内部**时按比例定位（附点/长音的第二拍就在音中间），
   * 拍点在色块起点或外面时就是左缘。
   */
  const landingX = (a: BallAnchor, beatT: number): number => {
    if (a.x !== undefined && a.w !== undefined && a.t1 > a.t0) {
      const f = Math.max(0, Math.min(1, (beatT - a.t0) / (a.t1 - a.t0)))
      return a.x + a.w * f
    }
    return a.cx
  }
  const x0 = landingX(a0, b0)
  const x1 = landingX(target, b1)
  const x = x0 + (x1 - x0) * u
  const base = a0.top + (target.top - a0.top) * u
  return { x, y: base - 4 * u * (1 - u) * amp, u }
}
