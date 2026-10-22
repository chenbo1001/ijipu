/**
 * engine/dynamic/ball.ts — 跳跳球的**抛体轨迹**（纯函数）
 *
 * 用户口径（2026-10-22）：「球不要限定在色块范围内，它有自己的轨迹；落点是每一拍开始的位置，
 * 只是每次落下刚好落在色块上」——就是打砖块/接球游戏里那颗球：**在空中划一条抛物线飞过去**。
 *
 * 于是：
 *  - **横向**：从这一拍落点飞到下一拍落点（线性插值，看起来像"被抛出去"）；
 *  - **纵向**：抛物线 `4u(1-u)`，u=0 落地、u=1 落地 ⇒ **每拍起落一次**；
 *  - 落点 = 那一拍开始时**正在响的色块**（拍点=音符起点取正中，在时值里按比例）。
 *
 * 与音符的疏密无关：一拍里两个八分音符，球也只落一次。
 *
 * ## adj1062（用户 2026-10-22 追问「还是会乱跳 / 乱滑动 / 消失再出现」）
 *
 * 这一版把"每帧现算两个锚点"改成**先建一张逐拍落点表**，三条硬口径：
 *  1. **一拍一跳**；落点 = 这一拍开始时正在响的色块。
 *     没音的拍（休止/空隙）在前后两个落点之间**按时间插值**，不再"空隙一开始就朝下一个音跳"。
 *  2. **一拍的终点不越过下一小节起点**（`min(b0+拍长, 下一小节起点)`）。
 *     小节长度不一定是整拍（弱起 / 3.5 拍的小节），旧实现 `b0 + beatMs` 会跨过下一小节
 *     ⇒ 网格在下一小节起点重置时球瞬移。截断后最后那一拍变短，球正好在**下一行/下一小节
 *     的第一个色块**上落地（用户实报「行末又落下才在下一行首出现」就是这条）。
 *  3. 连续两拍**共享同一个落点**（本拍的终点 = 下一拍的起点）⇒ 相邻两拍之间不会瞬移。
 *
 * 换行、反复、`&dc`/`&ds`、跨跳房子的落点是"无缝"的（上一行结束 = 下一行开始），
 * 所以这些大跳跃天然只占**跳跃前一拍**；其余地方一拍只走一格。
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
  /**
   * adj1062：该色块所属**页**（可选）。预览是多页竖排的——有了它，宿主可以把各页锚点
   * 换算到同一套纵向坐标里，让球从上一页末飞进下一页首（否则只能在页边界"消失再出现"）。
   * 引擎不消费这个字段，只原样带到 `BallPos.pageIndex`。
   */
  pageIndex?: number
}

export interface BallPos {
  /** 页面坐标 */
  x: number
  y: number
  /** 当前拍内的相位（0~1，0/1 = 落地） */
  u: number
  /**
   * adj1062：这一拍**从哪一页起飞**（`BallAnchor.pageIndex` 原样带出）。
   * 预览用它保证"跨页飞行时只在起飞的页上画一颗球"，落地后再换到下一页。
   */
  pageIndex?: number
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

/** 一个落点（页面坐标）：`x` = 横向落点，`top` = 色块上沿 */
interface Landing {
  x: number
  top: number
  /** adj1062：落点所在页（跨页预览用） */
  pageIndex?: number
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
 *
 * adj1061：有 `barStartsMs` 时它只作兜底（宿主会跳过这次投票），拍网格由小节起点给出。
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

/** 拍点落在某条色块里的位置（拍点=音符起点 ⇒ 正中；在时值里 ⇒ 按比例） */
function landingOf(a: BallAnchor, beatT: number): Landing {
  const pageIndex = a.pageIndex
  const isNoteStart = Math.abs(beatT - a.t0) <= 5
  if (isNoteStart || a.x === undefined || a.w === undefined || a.t1 <= a.t0) {
    return { x: a.cx, top: a.top, ...(pageIndex !== undefined ? { pageIndex } : {}) }
  }
  const f = Math.max(0, Math.min(1, (beatT - a.t0) / (a.t1 - a.t0)))
  return { x: a.x + a.w * f, top: a.top, ...(pageIndex !== undefined ? { pageIndex } : {}) }
}

/**
 * 拍界时刻表（升序）。
 *
 * · 有小节起点：**每小节从自己的起点重新起拍**，且最后一拍的终点截到下一小节起点
 *   （小节不是整拍时，最后那一拍就短一点——这是"不瞬移"的关键）；
 * · 没有小节起点：从 `anchorMs` 起按固定拍长铺到最后一个音结束；
 * · 第一个音若落在两根拍界之间，补一根界：球出现那一刻 `u=0`，正好落在第一个色块上。
 */
function beatTimesOf(
  anchors: readonly BallAnchor[],
  beatMs: number,
  anchorMs: number,
  barStartsMs?: readonly number[],
): number[] {
  const firstT = anchors[0].t0
  const lastT = anchors[anchors.length - 1].t1
  if (!(lastT > firstT + 0.5)) return []
  const out: number[] = []
  /** 只收升序、去重（相邻两根界至少差 0.5ms） */
  const push = (t: number): void => {
    if (!Number.isFinite(t) || t > lastT + 0.5) return
    const prev = out[out.length - 1]
    if (prev === undefined || t > prev + 0.5) out.push(t)
  }
  const bars = barStartsMs && barStartsMs.length > 1 ? barStartsMs : null
  if (bars) {
    for (let i = 0; i + 1 < bars.length; i++) {
      const s = bars[i]
      const nextBar = bars[i + 1]
      // 起播点之前的小节整段跳过（切片/分页预览只建自己这一段，不白算前面几百拍）
      if (nextBar <= firstT - 0.5) continue
      if (s > lastT + 0.5) break
      const end = Math.min(nextBar, lastT)
      if (end <= s + 0.5) continue
      push(s)
      for (let b = s + beatMs; b < end - 0.5; b += beatMs) push(b)
      push(end) // 这一小节最后一拍：**截到下一小节起点**（可能短于 beatMs）
    }
  } else {
    push(anchorMs)
  }
  /**
   * 兜底：拍界在曲末之前就用完了（旧数据只给"源码小节"、或调用方给的数组比播放短）。
   * 这时从最后一个拍界**按拍长继续铺到曲末**——旧实现本来就是 `barStart + k×拍长` 一路铺，
   * 不补的话最后一段会变成一个巨大的"拍"，球速与 `u` 全失真。
   */
  if (out.length > 0) {
    for (let b = out[out.length - 1] + beatMs; b < lastT - 0.5; b += beatMs) push(b)
  }
  /**
   * adj1062：**小节起点没有块、第一块晚到**（典型：行首/小节首是前倚音，色块在主音那里才出现）
   * ⇒ 把"第一块真正出现的时刻"补成一根拍界。
   *
   * 不补的话，这一拍落在"没有块"的空隙里，球要到下一拍才落到第一块上——
   * 用户看到的就是"行末的最后一跳没有飞到下一行，而是在行末落下、再在下一行首出现"。
   *
   * 用双指针扫（小节与锚点都升序）：`maxEnd` = 已经开始的锚点里最晚的结束时刻；
   * `maxEnd <= s` 说明小节起点这一刻**没有任何块在响**。
   */
  const extras: number[] = []
  if (bars) {
    let ai = 0
    let maxEnd = Number.NEGATIVE_INFINITY
    for (let i = 0; i + 1 < bars.length; i++) {
      const s = bars[i]
      if (s > lastT + 0.5) break
      while (ai < anchors.length && anchors[ai].t0 <= s) {
        if (anchors[ai].t1 > maxEnd) maxEnd = anchors[ai].t1
        ai++
      }
      if (maxEnd > s + 0.5) continue // 小节起点有块在响（普通小节）
      const first = anchors[ai]
      const barEnd = Math.min(bars[i + 1], lastT)
      if (first && first.t0 > s + 5 && first.t0 < barEnd - 0.5) extras.push(first.t0)
    }
  }
  if (extras.length > 0) out.push(...extras)
  push(lastT) // 曲末：最后一个音结束（之后是自由落体）
  /**
   * 统一排序去重（补进来的 `firstT` / `extras` 可能落在已有拍界之间）。
   * 0.5ms 容差：只吸收浮点误差；最小拍长（32 分音符 @120）也有 62.5ms。
   */
  out.sort((a, b) => a - b)
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i] - out[i - 1] <= 0.5) out.splice(i, 1)
  }
  if (out.length === 0 || !out.some((b) => Math.abs(b - firstT) <= 0.5)) {
    out.push(firstT)
    out.sort((a, b) => a - b)
  }
  return out
}

/**
 * 球在 `t` 时刻的位置。
 *
 * @param anchors 落点表（按 t0 升序；只放主声部的色块，避免多声部各飞一颗）
 * @param t       当前时刻（与 anchors 同一时间轴）
 * @param beatMs  一拍多少毫秒
 * @param anchorMs 没有小节起点时的第一拍时刻（有 `barStartsMs` 时不用它）
 * @param amp     抛物线最高点（页面坐标单位）——球"飞多高"
 * @param barStartsMs 小节起点（升序；**展开后逐遍**，末尾一条是「曲末」）。
 *   给了它，拍网格按小节重置，且每拍终点截到下一小节起点（见 `beatTimesOf`）。
 *
 * 边界：
 *  - 第一个音之前不画球（片头标题卡阶段）；
 *  - 最后一个音结束后**自由落体**出画（用户口径；之后才出片尾卡）。
 */
export function ballAt(
  anchors: readonly BallAnchor[],
  t: number,
  beatMs: number,
  anchorMs: number,
  amp: number,
  barStartsMs?: readonly number[],
): BallPos | null {
  if (beatMs <= 0 || anchors.length === 0) return null
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  // 第一个音之前：不画球（片头标题卡阶段）
  if (t < first.t0) return null
  // 最后一个音结束之后：**自由落体**，球离开视界
  // adj1061：用 `>=`——结束那一刻就不再属于"最后一拍"，否则会落到一个不存在的拍网格上
  if (t >= last.t1) {
    const dt = (t - last.t1) / 1000
    const y = last.top + 0.5 * 2600 * dt * dt
    if (y > 2400) return null // 已经落出画面（页面高约 842）
    return {
      x: last.cx,
      y,
      u: 0,
      ...(last.pageIndex !== undefined ? { pageIndex: last.pageIndex } : {}),
    }
  }
  const times = beatTimesOf(anchors, beatMs, anchorMs, barStartsMs)
  if (times.length < 2) {
    // 极短谱 / 零时长：至少落在当前色块上，不要消失
    const a = anchorAt(anchors, t) ?? first
    const p = landingOf(a, t)
    return {
      x: p.x,
      y: p.top,
      u: 0,
      ...(p.pageIndex !== undefined ? { pageIndex: p.pageIndex } : {}),
    }
  }
  /**
   * 逐拍落点。`null` = 这一拍没有正在响的色块（休止/空隙）。
   */
  const points: (Landing | null)[] = times.map((bt) => {
    const a = anchorAt(anchors, bt)
    return a ? landingOf(a, bt) : null
  })
  /**
   * 空拍补位：在**前一个落点**与**后一个落点**之间按时间线性插值。
   *
   * 这样一拍只走一格：如果中间空了 3 拍，球会用 3 拍慢慢飞过去，而不是在空隙第一拍
   * 就突然跳到下一个音（那正是用户看到的"乱跳"）。前后都没有落点时才原地不动/等第一个音。
   */
  let prev = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i]) {
      prev = i
      continue
    }
    let next = -1
    for (let j = i + 1; j < points.length; j++) {
      if (points[j]) {
        next = j
        break
      }
    }
    if (prev >= 0 && next >= 0) {
      const p = points[prev] as Landing
      const q = points[next] as Landing
      const span = times[next] - times[prev]
      const f = span > 0 ? (times[i] - times[prev]) / span : 0
      points[i] = {
        x: p.x + (q.x - p.x) * f,
        top: p.top + (q.top - p.top) * f,
        // 跨页飞行时**仍在起飞的页上画**：落地那一刻下一拍才换成下一页
        ...(p.pageIndex !== undefined ? { pageIndex: p.pageIndex } : {}),
      }
    } else if (prev >= 0) {
      points[i] = points[prev]
    } else if (next >= 0) {
      points[i] = points[next]
    }
  }
  // 二分找 t 所在的拍：times[lo] ≤ t < times[hi]
  let lo = 0
  let hi = times.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  const b0 = times[lo]
  const b1 = times[hi]
  /** 相邻两拍共享落点（本拍终点 = 下一拍起点）⇒ 拍与拍之间不会瞬移 */
  const p0 = points[lo] ?? points[hi] ?? landingOf(first, b0)
  const p1 = points[hi] ?? p0
  const u = b1 > b0 ? Math.max(0, Math.min(1, (t - b0) / (b1 - b0))) : 0
  const x = p0.x + (p1.x - p0.x) * u
  const top = p0.top + (p1.top - p0.top) * u
  return {
    x,
    y: top - 4 * u * (1 - u) * amp,
    u,
    // 这一拍从哪一页起飞（预览据此只画一颗球；视频/出片忽略）
    ...(p0.pageIndex !== undefined ? { pageIndex: p0.pageIndex } : {}),
  }
}
