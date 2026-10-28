/**
 * dialogs/metronomeSchedule.ts — 节拍器「嗒」的排点计算（adj1172，纯函数）
 *
 * 用户实报：「节拍器的落点没有落到拍子的开头，听起来和合成音不重合、慢了一点」。
 *
 * 根因不在 Click 的声音，而在**时间映射**：旧实现用
 *   `when = ctx.currentTime + (at − 本次排点的 from)`
 * 但 `from` 是"上次排到哪"的游标（可能已经在播放头前面 1.5 秒），
 * 不是"此刻 AudioContext 对应哪个音频时刻"。于是每次续排都把拍点往后/往前错开，
 * 与伴奏/合成音各走各的时钟。
 *
 * 这里只做一件事：用**开播时记下的锚点** `(startAt, startFromMs)` 把音频拍点
 * 映射成 AudioContext 时间；播放中不管什么时候续排，同一个拍点算出来的 `whenSec`
 * 都完全一样，所以节拍器与音源必然重合。
 */

export interface MetronomePlanArgs {
  /** 本次排点窗口的起点（音频 ms，含） */
  fromMs: number
  /** 本次排点窗口的终点（音频 ms，含） */
  untilMs: number
  /** 一拍多少音频 ms（对拍后的有效拍速，或谱面 J:） */
  beatMs: number
  /** 第 0 拍在音频里的位置（对拍后的 offset，或未对拍时的 0） */
  offsetMs: number
  /** 开播时 AudioContext.currentTime（秒） */
  startAt: number
  /** 开播时对应的音频 ms */
  startFromMs: number
  /** 单次最多排多少个，防止参数异常时死循环 */
  maxClicks?: number
}

export interface MetronomeClick {
  /** 这一击对应的音频时刻（ms） */
  audioMs: number
  /** 应该在 AudioContext 的哪个时间 start（秒） */
  whenSec: number
}

/**
 * 纯计算：把 `[fromMs, untilMs]` 内的拍点映射成 `whenSec`。
 *
 * 拍点公式与对拍台其它地方一致：`offsetMs + k × beatMs`（k 为整数，拍点可早于 0，
 * 由调用方用 fromMs 夹住）。函数不做音频调度、不读 DOM。
 */
export function planMetronomeClicks(args: MetronomePlanArgs): MetronomeClick[] {
  const { fromMs, untilMs, beatMs, offsetMs, startAt, startFromMs } = args
  const maxClicks = args.maxClicks ?? 400
  if (!(beatMs > 0) || !Number.isFinite(beatMs)) return []
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs < fromMs) return []
  if (!Number.isFinite(offsetMs) || !Number.isFinite(startAt) || !Number.isFinite(startFromMs)) return []

  const out: MetronomeClick[] = []
  const k0 = Math.ceil((fromMs - offsetMs) / beatMs - 1e-9)
  for (let k = k0; out.length < maxClicks; k++) {
    const audioMs = offsetMs + k * beatMs
    if (audioMs > untilMs) break
    if (audioMs < fromMs) continue
    out.push({ audioMs, whenSec: startAt + (audioMs - startFromMs) / 1000 })
  }
  return out
}
