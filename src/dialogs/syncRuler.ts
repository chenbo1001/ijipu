/**
 * dialogs/syncRuler.ts — 对拍台波形**下方时间标尺**的刻度选择（纯函数，可断言）
 *
 * 用户 2026-10-24：「在音频波形图下侧显示时间标尺，以方便定位」。
 *
 * 为什么单独一个模块：标尺的"该画多密"是一个**纯数学**决定（可视时长 ÷ 像素宽），
 * 抽出来才能在 Node 里断言（`npm run smoke` 的 `adj1122`），也不会散落在画布代码里。
 *
 * 口径：
 *  - 只从**好看的步长**里挑（0.1/0.2/0.25/0.5/1/2/5/10/15/30/60/120/300/600 秒）——
 *    不选"3.7 秒一格"这种算出来的怪数；
 *  - 保证**标签之间至少 `minLabelPx` 像素**（默认 64，够放 `12:34`）；
 *  - 整曲（几分钟）走 `m:ss`，放大到 1 秒以内走 `m:ss.s` / `m:ss.ss`；
 *  - 次刻度 = 主刻度 4 等分（≥1 秒）或 5 等分（<1 秒），只画短线不写字。
 */

/** 候选步长（秒），从细到粗 */
const NICE_STEPS_SEC = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const

export interface TimeScale {
  /** 主刻度间隔（ms） */
  stepMs: number
  /** 落在可视区间内的刻度时刻（ms，整数） */
  ticks: number[]
  /** 次刻度间隔（ms） */
  minorMs: number
}

/**
 * 按可视窗口与像素宽挑刻度。
 *
 * @param viewStartMs 可视左缘（ms，≥0）
 * @param viewEndMs   可视右缘（ms，> start）
 * @param widthPx     画布 CSS 宽度
 * @param minLabelPx  两个标签之间至少多少像素（默认 64）
 */
export function timeScaleOf(
  viewStartMs: number,
  viewEndMs: number,
  widthPx: number,
  minLabelPx = 64,
): TimeScale {
  const start = Math.max(0, Math.min(viewStartMs, viewEndMs - 1))
  const spanMs = Math.max(1, viewEndMs - start)
  const perPx = spanMs / Math.max(1, widthPx)
  const minStepMs = perPx * Math.max(16, minLabelPx)
  const stepSec =
    NICE_STEPS_SEC.find((s) => s * 1000 >= minStepMs) ?? NICE_STEPS_SEC[NICE_STEPS_SEC.length - 1]
  const stepMs = stepSec * 1000
  const first = Math.ceil(start / stepMs) * stepMs
  const ticks: number[] = []
  // 上限 400 个：宽度极小或时长极长时也不会画出天量刻度
  for (let t = first; t <= viewEndMs + 1e-6 && ticks.length < 400; t += stepMs) {
    ticks.push(Math.round(t))
  }
  const minorMs = stepMs / (stepSec >= 1 ? 4 : 5)
  return { stepMs, ticks, minorMs }
}

/** 刻度文字：`m:ss` / `m:ss.s` / `m:ss.ss`（按步长决定小数位，不多写） */
export function timeLabelOf(ms: number, stepMs: number): string {
  const total = Math.max(0, ms)
  const min = Math.floor(total / 60000)
  const restMs = total - min * 60000
  const sec = Math.floor(restMs / 1000)
  const decimals = stepMs >= 1000 ? 0 : stepMs % 100 === 0 ? 1 : 2
  const secText =
    decimals === 0
      ? String(sec).padStart(2, '0')
      : (restMs / 1000).toFixed(decimals).padStart(decimals === 1 ? 4 : 5, '0')
  return `${min}:${secText}`
}
