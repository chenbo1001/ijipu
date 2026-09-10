/**
 * store/playbackVoice.ts — 试听「音色」选择值的解析与持久化格式（adj366）
 *
 * 纯函数、无 DOM / 无 store 依赖：可在 scripts/smoke.mts 直接断言（uiStore 顶层会读
 * localStorage，无法在 Node 里导入，故把解析规则单独抽到此处）。
 *
 * 持久化格式（localStorage 键 `ijipu.playbackHqVoice`）：
 *  - 空串 ''：**自动**（跟随谱面 `@乐器` / 声部名路由，不做全局音色覆盖）
 *  - '0'..'127'：指定的 GM program（固定全局音色）
 */

/** GM program 上限（0-127） */
const GM_PROGRAM_MAX = 127

/**
 * 解析持久化的音色值。
 *  - 未设置（首次使用，`null`）/ 空串 / 空白 / 非法值 → `null` = **自动**
 *  - 合法 GM program（0-127）→ 该音色
 * 注意：**不可直接 `Number(raw)`**——`Number(null)` 与 `Number('')` 都等于 0（大钢琴），
 * 会把「自动」误判成大钢琴：默认音色永远不是「自动」，且选了「自动」也存不住（回读变 0）。
 */
export function parseStoredVoice(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const v = Number(raw)
  return Number.isInteger(v) && v >= 0 && v <= GM_PROGRAM_MAX ? v : null
}

/** 音色值 → 持久化字符串（自动 = 空串，与 localStorage 既有格式一致） */
export function formatStoredVoice(program: number | null): string {
  return program === null ? '' : String(program)
}
