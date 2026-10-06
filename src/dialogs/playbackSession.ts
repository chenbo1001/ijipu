/**
 * dialogs/playbackSession.ts — 试听**单实例**保证（adj723d）
 *
 * 用户口径：「**同一谱子只能有一个试听态**」——`Ctrl+点音符`、点播放、双击音符
 * 都必须汇入**同一个**播放会话，不许另起一个播放进程。
 *
 * 为什么需要它：`PlaybackDialog.play()` 里有多处 `await`（后端就绪、音源缓存、
 * 音源字节、`backend.load`），而音源那一步可能**下载 30MB**。期间用户完全可能再次
 * `Ctrl+点音符`（或按停止）。旧实现只在 `play()` 开头调 `stop()`，而 `stop()` 只能取消
 * **已经调度**的 job；还卡在 `await` 里的那一次随后照样执行 `schedulePlay(...)`
 * ⇒ **两个播放进程同时发声**。
 *
 * 修法是"**代次（generation）守卫**"：每次开始/停止都自增代次，任何异步等待之后
 * 核对自己是否仍是最新代次，过期就立刻放弃且**不落地**（不调度音频、不写色块轨道）。
 *
 * 抽成纯模块是为了让 `npm run smoke` 能直接断言这条并发规则（`.tsx` 组件在 Node 里导不进来）。
 */
export interface PlaybackGeneration {
  /** 开始一次新的播放尝试，返回它的代次 */
  begin: () => number
  /** 作废一切在途尝试（停止播放 / 关闭对话框时调用） */
  invalidate: () => void
  /** 给某个代次用的判据：`true` = 它已被更新的尝试取代，应当放弃 */
  isStale: (gen: number) => boolean
}

/**
 * 创建代次守卫。
 *
 * 初始代次为 0（没有任何尝试）。`begin()` 与 `invalidate()` 都自增——
 * 因此"停止"不仅让新的一次开始，也让**所有**旧的在途尝试一并过期。
 */
export function createPlaybackGeneration(): PlaybackGeneration {
  let current = 0
  return {
    begin: () => ++current,
    invalidate: () => {
      current++
    },
    isStale: (gen: number) => gen !== current,
  }
}
