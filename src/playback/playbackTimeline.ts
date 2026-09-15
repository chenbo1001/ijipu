/**
 * playback/playbackTimeline.ts — 试听「暂停 / 续播」的时间轴换算（adj409）
 *
 * 为什么需要这一层：试听后端（`src/playback/spessaSynthBackend.ts`）是用 **`setTimeout` 逐个排程**
 * 音符的（`noteOn`/`noteOff` 各一个定时器），**没有** AudioContext 级别的暂停可借——
 * 音频不是按 `ctx` 绝对时间排的，`ctx.suspend()` 只会让声音静音、定时器照旧跑完，
 * 恢复后什么都不会再响。所以暂停只能是"**撤掉全部待触发排程**"，续播时把**剩余事件**重新排一遍。
 *
 * 本模块只做这一件事（纯函数，可单测）：
 *  - 已播完的事件（`atMs + durationMs <= fromMs`）**丢弃**；
 *  - 起点重定位到 0：`atMs' = max(0, atMs - fromMs)`；
 *  - 暂停瞬间**正在发声**的音符从 0 起重排，时长取它在原时间轴上的**剩余部分**
 *    —— 后端没有"从中间起声"的能力，该音会从头再响一遍，这是暂停/续播的已知取舍。
 *
 * 注意：**高亮与播放色块不走这条时间轴**。调用方用 `timeBase + (now - startTime)` 还原
 * **原时间轴**位置（`playheadTrack` 与序列事件都存原时间轴 `atMs`），故这里只平移音频侧，
 * 不影响界面时间基准。
 */

/** 只关心时间轴两个字段的最小结构（`PlayEvent` 等结构均可直接传入） */
export interface TimedEvent {
  atMs: number
  durationMs: number
}

/**
 * 取出「从 `fromMs` 起仍要播放」的事件，并把时间轴整体平移到 0。
 * @param events 原序列事件（原时间轴）
 * @param fromMs 已播到的位置（原时间轴毫秒）
 * @returns 平移后的事件（新数组、新对象；**不修改入参**）。全部播完时返回空数组，
 *          调用方据此收尾（停止）而不是排一个没有事件的序列。
 */
export function shiftEventsFrom<T extends TimedEvent>(events: readonly T[], fromMs: number): T[] {
  const from = Math.max(0, fromMs)
  const out: T[] = []
  for (const e of events) {
    const end = e.atMs + e.durationMs
    if (end <= from) continue // 已播完
    const at = Math.max(0, e.atMs - from)
    // 时长 = 原终点 − 已播位置 − 新起点（正在发声者即"剩余部分"；未开始者保持原时长）
    // 下限 1ms：后端对 noteOff 取 max(100, duration)，0 时长没有意义
    out.push({ ...e, atMs: at, durationMs: Math.max(1, end - from - at) })
  }
  return out
}
