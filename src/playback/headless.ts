/**
 * headless.ts — **无头播放**（方案 T-2 第 ① 步：只加不改 ✗，暂不动 `PlaybackDialog`）
 *
 * 目的：把"给一段 `.jps` 就出声、可停止"这件事从 `src/dialogs/PlaybackDialog.tsx`
 * （41 KB，播放逻辑与 UI 混在一起 ✗）里**剥出来**，供两处共用：
 *  · 应用自己的 `PlaybackDialog`（第 ② 步切过来 ✓）；
 *  · Obsidian 插件的 `playback.play` / `playback.stop`（第 ③ 步 ✓）。
 *
 * 硬约束（本文件的"闸门"口径）：
 *  1. **零 React、零 DOM**：不 import react，不读 `document`；`AudioContext` 之类由后端内部处理 ✓；
 *  2. **不写 `docStore`**：进度通过 `onTick` **回调**交给调用方 ✓（UI 状态仍归 UI ✓）；
 *  3. **复用既有链路**：`buildPlaySequence` / `schedulePlay` / `SpessaSynthBackend` 一律引用现成实现 ✓，
 *     不复制播放算法 ✗（AGENTS 六之二·4"数值口径同源"）。
 */
import { buildPlaySequence, parseJps, layoutScore, schedulePlay, createPlaybackClock, mergeJpsConfig, defaultPageConfig, type PageConfig, type ParseResult, type ScoreLayout } from '@ijipu/engine'
import { SpessaSynthBackend } from './spessaSynthBackend'

/**
 * 入参：**源码字符串** 或 **已解析的 `{ parsed, layout }`** ✓。
 *
 * 为什么要支持后者（adj828，第②步开工前的接口修正 ✓）：`PlaybackDialog` 手上**已经有**
 * `parseResult` 与 `layout`（来自 `docStore` ✓）⇒ 若只收源码，切过去时会**再解析+再排版一遍** ✗
 * （多余开销，也违背"数值口径同源"的精神 ✓）。传对象时**直接 `buildPlaySequence`** ✓。
 */
export type HeadlessInput = string | { parsed: ParseResult; layout: ScoreLayout }

export type HeadlessPlayOptions = {
  /** 速度（默认 60，与对话框现状一致 ✓） */
  bpm?: number
  /** 从哪个音符开始（`LayoutId` 风格 id；省略=从头 ✓） */
  startNoteId?: string | null
  /** 全篇乐器覆盖（音色名 ref ✓） */
  instrumentOverride?: string
  /** 页面配置覆盖（省略=用源码 `# jps-config` + 默认 ✓） */
  pageConfig?: Partial<PageConfig>
  /** 进度回调（毫秒 ✓）—— **UI 由调用方更新** ✓ */
  onTick?: (ms: number) => void
  /** 播完回调 ✓ */
  onEnded?: () => void
}

export type HeadlessHandle = {
  /** 总时长（毫秒 ✓，用于进度条 ✓） */
  totalMs: number
  /** 停止播放并释放后端 ✓（幂等 ✓） */
  stop: () => void
}

/** 播放失败的原因（**如实返回**，由调用方决定怎么提示 ✓） */
export type HeadlessFailure = { ok: false; error: string }

/**
 * 无头播放：解析 → 排版 → 播放序列 → 合成器 → 调度 ✓。
 * @returns 成功给句柄（含 `stop` ✓）；失败给原因（不抛异常给调用方 ✓）。
 */
export async function playHeadless(
  input: HeadlessInput,
  opts: HeadlessPlayOptions = {},
): Promise<{ ok: true; handle: HeadlessHandle } | HeadlessFailure> {
  /**
   * 传对象时**不解析、不排版** ✓（对象来自调用方已有的结果 ⇒ 零重复计算 ✓）；
   * 传字符串时才走 `parseJps → layoutScore` ✓（CLI/插件那条"给源码就出声"的路径 ✓）。
   */
  let parsed: ParseResult
  let layout: ScoreLayout
  if (typeof input === 'string') {
    parsed = parseJps(input)
    if (parsed.errors.length > 0) return { ok: false, error: `${parsed.errors.length} 个语法错误（先修好再播放）` }
    const cfg = mergeJpsConfig(input, { ...defaultPageConfig, ...(opts.pageConfig ?? {}) } as PageConfig)
    layout = layoutScore(parsed, cfg)
  } else {
    parsed = input.parsed
    layout = input.layout
    if (typeof opts.pageConfig !== 'undefined') {
      // 传对象时页面配置已被排版消费过 ⇒ 忽略并如实说明（避免"改了配置却没生效"的困惑 ✗）
      return { ok: false, error: '传入 { parsed, layout } 时不能再指定 pageConfig（配置已在排版阶段生效）' }
    }
  }
  const seq = buildPlaySequence(parsed, layout, opts.bpm ?? 60, opts.startNoteId ?? null, undefined, opts.instrumentOverride)

  const backend = new SpessaSynthBackend()
  let stopped = false
  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    try {
      backend.stop()
    } catch {
      /* 停止失败不影响释放 ✓ */
    }
    try {
      backend.dispose()
    } catch {
      /* 同上 */
    }
  }

  try {
    // 就绪（可选方法 ✓，与对话框同一调用方式 ✓）
    await (backend as unknown as { ready?: () => Promise<void> }).ready?.()
    if (stopped) return { ok: false, error: '已被停止' }
    const job = schedulePlay(seq, backend, undefined, undefined, 0)
    const totalMs = (job as { totalMs?: number }).totalMs ?? 0
    // 进度：用引擎时钟（与插件共用同一套 ✓），只**回调**不写 store ✓
    if (opts.onTick !== undefined || opts.onEnded !== undefined) {
      /**
       * 进度：用引擎时钟（与插件共用同一套 ✓），只**回调**不写 store ✓。
       * ⚠ `PlaybackClock` 没有 `stop()` ✗（我第一版想当然）⇒ 用 `dispose()`（若存在 ✓）；
       * 结束时**必调**，避免时钟常驻 ✓。
       */
      const clock = createPlaybackClock({
        onTick: (ms) => {
          opts.onTick?.(ms)
          if (totalMs > 0 && ms >= totalMs) {
            opts.onEnded?.()
            ;(clock as unknown as { dispose?: () => void }).dispose?.()
          }
        },
      })
      clock.start()
    }
    return { ok: true, handle: { totalMs, stop: cleanup } }
  } catch (e) {
    cleanup()
    return { ok: false, error: `播放失败：${e instanceof Error ? e.message : String(e)}` }
  }
}
