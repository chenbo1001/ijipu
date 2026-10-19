/**
 * `src/dialogs/playbackPass.ts` — 试听「第几遍」读数（adj996）
 *
 * 用户 2026-10-19 要求：「在试听对话框里加一个**遍次数字**，实时显示当前播放在第几个反复遍次上」。
 *
 * 引擎在 `PlaySequence.passMarks` 里给了遍次时间轴（每到一遍开头一条 `{atMs, pass}`），
 * 这里只做**纯查表**：给定当前播放时刻，取最后一条 `atMs <= t` 的 `pass`。
 *
 * 抽成纯函数的原因：能在 `npm run smoke` 里直接断言（不必起浏览器），
 * 且对话框每 50ms 一次的重绘只调这一句、不做别的。
 */
export interface PassMark {
  atMs: number
  pass: number
}

/**
 * 当前时刻属于第几遍（1 起）。
 *
 * @param marks 遍次时间轴（`PlaySequence.passMarks`；空/未定义 ⇒ 返回 1）
 * @param ms    当前播放时刻（毫秒）
 */
export function passAt(marks: readonly PassMark[] | undefined, ms: number): number {
  if (!marks || marks.length === 0) return 1
  let cur = marks[0].pass
  for (const m of marks) {
    if (m.atMs <= ms + 0.5) cur = m.pass
    else break
  }
  return cur
}

/**
 * 读数文案：「第 2 / 共 3 遍」。只有一遍时不显示（`null`）——避免界面上多一个恒为 1 的数字。
 *
 * @param marks  遍次时间轴
 * @param ms     当前播放时刻
 * @param maxPass 整首一共几遍（`PlaySequence.maxPass`）
 */
export function passLabel(marks: readonly PassMark[] | undefined, ms: number, maxPass?: number): string | null {
  if (!marks || marks.length === 0) return null
  const total = Math.max(1, maxPass ?? marks.reduce((mx, m) => Math.max(mx, m.pass), 1))
  if (total <= 1) return null
  return `第 ${passAt(marks, ms)} / 共 ${total} 遍`
}
