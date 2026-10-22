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
}

export interface BallPos {
  /** 页面坐标 */
  x: number
  y: number
  /** 当前拍内的相位（0~1，0/1 = 落地） */
  u: number
}

/** 找 `t` 时刻正在响的那条（t0 ≤ t < t1） */
function anchorAt(anchors: readonly BallAnchor[], t: number): BallAnchor | null {
  let found: BallAnchor | null = null
  for (const a of anchors) {
    if (a.t0 <= t && t < a.t1) {
      // 同一时刻可能有多条（多声部），取"最先开始"的那条作为主落点
      if (!found || a.t0 < found.t0) found = a
    }
  }
  return found
}

/**
 * 球在 `t` 时刻的位置。
 *
 * @param anchors 落点表（按 t0 升序；只放主声部的色块，避免多声部各飞一颗）
 * @param t       当前时刻（与 anchors 同一时间轴）
 * @param beatMs  一拍多少毫秒
 * @param anchorMs 第一拍的时刻
 * @param amp     抛物线最高点（页面坐标单位）——球"飞多高"
 */
export function ballAt(
  anchors: readonly BallAnchor[],
  t: number,
  beatMs: number,
  anchorMs: number,
  amp: number,
): BallPos | null {
  if (beatMs <= 0 || anchors.length === 0) return null
  const k = Math.floor((t - anchorMs) / beatMs)
  const b0 = anchorMs + k * beatMs
  const b1 = b0 + beatMs
  const a0 = anchorAt(anchors, b0)
  if (!a0) return null // 这一拍没在响（休止/片头）⇒ 不画球
  // 下一拍的落点：如果那一拍没有音，就把球"抛回原地"（它会落回同一处）
  const a1 = anchorAt(anchors, b1) ?? a0
  const u = Math.max(0, Math.min(1, (t - b0) / beatMs))
  const x = a0.cx + (a1.cx - a0.cx) * u
  const base = a0.top + (a1.top - a0.top) * u
  return { x, y: base - 4 * u * (1 - u) * amp, u }
}
