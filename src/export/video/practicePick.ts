/**
 * src/export/video/practicePick.ts — 标记段多遍次导出选候选（adj1083）
 *
 * 用户实报：标记段选了第 2/3 遍导出，成片却按第 1 遍出。
 * 根因是导出只把起止音符 id 传给 `createDynamicSession`，没有把标记上
 * 用户选过的 `pass` 一起带过去 ⇒ 解析器永远取 `res.pick`（默认第 1 个候选）。
 *
 * 这里把「用户选的 pass 优先；无效/缺省才回退解析器默认、再回退第一个候选」
 * 收成一个纯函数，渲染器与冒烟共用，避免两端各写一套。
 */
export function pickPracticeCandidate<T>(
  candidates: readonly T[],
  defaultPick: number,
  pass?: number,
): T | undefined {
  const pick = pass ?? defaultPick
  return candidates[pick] ?? candidates[defaultPick] ?? candidates[0]
}
