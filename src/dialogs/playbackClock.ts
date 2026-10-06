/**
 * dialogs/playbackClock.ts — 播放进度读数（adj722）
 *
 * 抽成**纯模块**而不是留在 `PlaybackDialog.tsx` 里：`npm run smoke` 能直接断言纯函数，
 * 而 `.tsx` 组件无法在 Node 里导入（与 `pageConfigReset.ts` 同样的理由）。
 */

/**
 * 毫秒 → `mm:ss`（向下取整到秒）。
 *
 * 为什么向下取整：播放中读数**只增不减**地跨秒——若四舍五入，
 * `59.6s` 会先显示 `1:00`、再回到 `0:59`（视觉上"倒跳一秒"）。
 *
 * 负数 / `NaN` / `Infinity` 一律归零：收尾复位与暂停续播的边界值都会经过这里，
 * 不该把 `NaN:NaN` 显示给用户。
 */
export function fmtClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
