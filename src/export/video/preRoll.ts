/**
 * export/video/preRoll.ts — 「前奏等待」的两条纯计算（adj1148）
 *
 * 为什么单独一个模块：
 *  · `renderer.ts` 要碰画布/字面量，Node 里跑不起来；但"时间轴后移多少、前奏段画哪一刻"
 *    是**纯算术**，必须能在 `npm run smoke` 里断言（用户给的负向判据就在这里）。
 *  · 出片（`createDynamicSession`）与相机位预览用的是**同一份**会话，所以这两条只有一处实现。
 */

/** 只需要"事件时刻 + 总长"；`barStartsMs` 等其它字段原样透传（它是相对时间，消费时才加偏移） */
export interface PlayTimeline {
  events: { atMs: number }[]
  totalMs: number
}

/**
 * 把整条播放序列**后移** `ms`（片头卡 / 前奏等待共用）。
 *
 * 只动 `events[].atMs` 与 `totalMs`；`ms <= 0` 时原样返回（不复制）。
 * 这样 `totalMs` 一定等于"原总长 + 等待"——用户负向判据要的就是这一条。
 */
export function shiftSequenceBy<T extends PlayTimeline>(seq: T, ms: number): T {
  if (!(ms > 0)) return seq
  return {
    ...seq,
    events: seq.events.map((e) => ({ ...e, atMs: e.atMs + ms })),
    totalMs: seq.totalMs + ms,
  }
}

/**
 * 前奏等待段里，画面应当画**哪一刻**（会话毫秒）；不在等待段返回 `null`。
 *
 * 口径（方案 §4-G）：
 *  · 等待段 = `[leadInMs, leadInMs + headWaitMs)`；
 *  · 画面只取**第 1 拍内**的相位（`% beatMs`）——色块位置与第 0 帧相同（定格），
 *    跳跳球仍原地弹；相位绝不越过一拍，所以不会切到下一条色块；
 *  · 返回的时刻 = 谱面第 1 拍（`leadIn + headWait`）+ 相位。
 */
export function preRollFrameMs(
  tMs: number,
  leadInMs: number,
  headWaitMs: number,
  beatMs: number,
): number | null {
  if (!(headWaitMs > 0) || !(beatMs > 0)) return null
  const start = Math.max(0, leadInMs)
  const end = start + headWaitMs
  if (tMs < start || tMs >= end) return null
  const phase = ((tMs - start) % beatMs + beatMs) % beatMs
  return end + phase
}
