/**
 * export/video/accompaniment.ts — 外部伴奏的**解码 / 波形 / 建轨 / 混音**
 *
 * 用户口径（2026-10-24）：
 *  · 伴奏**随谱文件放同目录**，sidecar 只记文件名（不复制进 `%APPDATA%`）；
 *  · 可**掐头去尾**（`trim`）：只播/只导出保留段；锚点永远记**文件绝对毫秒**；
 *  · 对拍结果（`beatMs`/`offsetMs`）决定"谱面时刻 → 音频时刻"；
 *  · 默认**替换**合成音（速度更快、不依赖音色库），也可 `mix`。
 *
 * 设计要点：
 *  1. **建轨的算式单独抽成纯函数** `accompanimentPlan()`（Node 可断言）——
 *     WebAudio 那层只是"按计划 start()"，不掺业务判断（AGENTS「数值口径同源」）；
 *  2. 输出固定 **44100 双声道**，与 `renderToAudioBuffer` 一致 ⇒ 混音可以直接逐采样相加；
 *  3. 混音的**核心是纯函数** `mixSamples()`（Float32Array 相加 + clamp），
 *     包一层 AudioBuffer 的只是宿主适配。
 */

/** 计划：从音频的哪一刻开始、放到会话时间轴的哪一刻、放多久（全部秒） */
export interface AccompPlan {
  /** 在 `OfflineAudioContext` 里的开始时刻（= 片头静音 + "保留段起点在谱面起点之后"的静默） */
  whenSec: number
  /** 从音频文件的第几秒开始取 */
  offsetSec: number
  /** 放多少秒（0 = 这段没有伴奏，整段静音） */
  durationSec: number
}

/** 建轨需要的会话信息（`DynamicSession` 的结构子集，便于 Node 断言） */
export interface SessionTiming {
  leadInMs: number
  /**
   * adj1148：**前奏等待**（片头卡之后、谱面第 1 拍之前那段音频）。
   *
   * 与 `leadInMs` 分开：`leadInMs` 是"没有声音的片头卡"，这段是"有伴奏、画面定格"；
   * 伴奏要在**片头卡一结束**就从 `trim.startMs` 起放（不是等谱面开始才放），否则前奏会被吞掉。
   */
  headWaitMs?: number
  sourceStartMs: number
  totalMs: number
}

/**
 * adj1148：要不要「前奏等待」，以及等多久（纯函数，Node 可断言）。
 *
 * 判据（方案 §4-G）：谱面第 1 拍对应的音频时刻 `offsetMs` 比保留段起点晚
 * **超过 60ms** ⇒ 前面那段是前奏，视频开头要把它放出来、谱面定格在第 1 拍。
 * 不到 60ms 当误差，不等待（否则每支视频都会多出一个几乎看不见的定格）。
 *
 * ⚠ 只对**整曲**有意义：标记段本身从曲中间开始，没有"前奏"这回事。
 */
export const PRE_ROLL_MIN_MS = 60

export function preRollMsOf(fit: TempoFit, trim: TrimRange): number {
  const gap = fit.offsetMs - trim.startMs
  return gap > PRE_ROLL_MIN_MS ? Math.round(gap) : 0
}

/** 对拍结果的结构子集 */
export interface TempoFit {
  beatMs: number
  offsetMs: number
}

/** 裁剪区间（文件绝对毫秒） */
export interface TrimRange {
  startMs: number
  endMs: number
}

/**
 * **建轨计划**（纯函数）。
 *
 * 推导：
 *  - 谱面时刻 `t` 对应的音频时刻 = `offsetMs + sourceStartMs + t`（`t` 从会话的"音乐起点"算）；
 *  - 会话时间轴 = `leadInMs` 静音 + （adj1148：`headWaitMs` 前奏等待）+ 音乐；
 *  - **有前奏等待时**，谱面第 1 拍在会话里的时刻是 `leadInMs + headWaitMs`，
 *    对应音频 `offsetMs + sourceStartMs` ⇒ 音频要**从片头卡一结束**就起放（`whenSec = leadInMs`），
 *    源起点是 `trim.startMs`；没有前奏等待时退化成原口径（`whenSec = leadInMs + skip`）。
 *  - 只放 `[trim.startMs, trim.endMs]` 里的部分：起点取 `max(谱面起点−headWait, trim.start)`，
 *    长度取"到 trim.end"与"到会话结束"的较小者。
 *
 * 边界：`offsetMs` 可能为负（伴奏比谱面短/从中间开始）；音频时刻必须夹进 trim。
 */
export function accompanimentPlan(fit: TempoFit, trim: TrimRange, session: SessionTiming): AccompPlan {
  const headWaitMs = Math.max(0, session.headWaitMs ?? 0)
  // 视频时间轴上的"音乐起点"是 leadIn + headWait；音频在此之前 headWait 就已经在放
  const wantStart = fit.offsetMs + session.sourceStartMs - headWaitMs
  const start = Math.max(wantStart, trim.startMs)
  const skipMs = Math.max(0, start - wantStart)
  const remainInSession = session.totalMs - session.leadInMs - skipMs
  const remainInTrim = trim.endMs - start
  const durationMs = Math.max(0, Math.min(remainInSession, remainInTrim))
  return {
    whenSec: (session.leadInMs + skipMs) / 1000,
    offsetSec: start / 1000,
    durationSec: durationMs / 1000,
  }
}

/**
 * 收尾淡出（用户 2026-10-24：「添加终点后应在最后一拍里音量渐小至无声，以免停得太突兀」）。
 *
 * 口径：在 `endMs` 前**最后一拍**（`fadeMs`）里线性降到 0，`endMs` 之后是静音。
 * 返回的是**会话时间轴**上的秒数（与 `accompanimentPlan` 同一坐标系）。
 */
export interface FadeWindow {
  /** 开始降音量的时刻（秒，会话时间轴）；`null` = 不淡出 */
  fadeStartSec: number | null
  /** 完全静音的时刻（秒） */
  fadeEndSec: number
}

/**
 * 算淡出窗口（纯函数，可断言）。
 *
 * @param plan      建轨计划（`whenSec` 是音频真正开始的时刻）
 * @param fadeMs    淡出时长（一般传**一拍**：`60000 / bpm`）
 */
export function fadeWindowOf(plan: AccompPlan, fadeMs: number): FadeWindow {
  const endSec = plan.whenSec + plan.durationSec
  const fade = Math.max(0, Math.min(fadeMs, plan.durationSec * 1000)) / 1000
  if (plan.durationSec <= 0 || fade <= 0) return { fadeStartSec: null, fadeEndSec: endSec }
  return { fadeStartSec: Math.max(plan.whenSec, endSec - fade), fadeEndSec: endSec }
}

/**
 * 波形包络：把整条音频压成 `buckets` 个桶，每桶取 min/max（画竖线用）。
 *
 * **纯函数**（只吃 `Float32Array`）⇒ Node 里可断言。
 * 多声道取**全部声道**的 min/max（不是"绝对值更大"——那样会丢掉负向峰值，
 * 左右声道反相时包络会凭空变平）。
 */
export function waveformPeaks(
  channels: Float32Array[],
  buckets: number,
): { min: number; max: number }[] {
  const out: { min: number; max: number }[] = []
  const n = channels[0]?.length ?? 0
  const count = Math.max(1, Math.floor(buckets))
  if (n === 0) return Array.from({ length: count }, () => ({ min: 0, max: 0 }))
  const step = n / count
  for (let b = 0; b < count; b++) {
    const i0 = Math.floor(b * step)
    const i1 = Math.min(n, Math.max(i0 + 1, Math.floor((b + 1) * step)))
    let min = 0
    let max = 0
    for (let i = i0; i < i1; i++) {
      for (let c = 0; c < channels.length; c++) {
        const x = channels[c][i]
        if (x < min) min = x
        if (x > max) max = x
      }
    }
    out.push({ min, max })
  }
  return out
}

/**
 * 逐采样混音（纯函数）：多轨同长 PCM 按各自增益相加，clamp 到 [-1, 1]。
 *
 * 为什么手算而不套 `OfflineAudioContext`：这是**纯数学**，能在 Node 里断言；
 * 而且合成轨与伴奏轨都已经是 44100 双声道（同源），直接相加没有重采样问题。
 */
export function mixSamples(
  tracks: { channels: Float32Array[]; gain: number }[],
  len: number,
  channelCount = 2,
): Float32Array[] {
  const out: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) out.push(new Float32Array(len))
  for (const t of tracks) {
    if (!(t.gain > 0)) continue
    for (let c = 0; c < channelCount; c++) {
      const src = t.channels[c] ?? t.channels[0]
      if (!src) continue
      const dst = out[c]
      const n = Math.min(len, src.length)
      for (let i = 0; i < n; i++) {
        const v = dst[i] + src[i] * t.gain
        dst[i] = v < -1 ? -1 : v > 1 ? 1 : v
      }
    }
  }
  return out
}

/** 渲染采样率（与 `export/audio.ts` 的 `RENDER_SAMPLE_RATE` 同值；这里不反向依赖它） */
export const ACCOMP_SAMPLE_RATE = 44100

/** 解码（浏览器/WebView 均可；48k 文件会在建轨时自动重采样到 44.1k） */
export async function decodeAccompaniment(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) throw new Error('当前环境不支持 WebAudio，无法解码伴奏')
  const ctx = new Ctx()
  try {
    return await ctx.decodeAudioData(bytes.slice(0))
  } finally {
    void ctx.close().catch(() => {})
  }
}

/**
 * 按计划把伴奏**裁成会话时间轴的一条 AudioBuffer**：
 * 片头静音 → 按 offset 起放 → 到 trim 结束或会话结束为止，其余静音。
 *
 * 输出固定 44100 双声道 ⇒ 与 `renderToAudioBuffer` 的合成轨可直接用 `mixSamples` 相加。
 */
export async function buildAccompanimentTrack(
  audio: AudioBuffer,
  fit: TempoFit,
  trim: TrimRange,
  session: SessionTiming,
  /** 收尾淡出时长（ms，一般传一拍）；0 = 不淡出 */
  fadeOutMs = 0,
): Promise<AudioBuffer> {
  const plan = accompanimentPlan(fit, trim, session)
  const len = Math.max(1, Math.ceil((session.totalMs / 1000) * ACCOMP_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(2, len, ACCOMP_SAMPLE_RATE)
  if (plan.durationSec > 0) {
    const src = ctx.createBufferSource()
    src.buffer = audio
    const gain = ctx.createGain()
    const fade = fadeWindowOf(plan, fadeOutMs)
    // 收尾淡出：最后一拍线性降到 0（用户要求"不要停得太突兀"）
    if (fade.fadeStartSec !== null) {
      gain.gain.setValueAtTime(1, fade.fadeStartSec)
      gain.gain.linearRampToValueAtTime(0, fade.fadeEndSec)
    }
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start(plan.whenSec, plan.offsetSec, plan.durationSec)
  }
  return ctx.startRendering()
}

/** 把两条 AudioBuffer 按增益混成一条（同采样率时逐采样相加；否则先报错，不静默走样） */
export function mixAudioBuffers(
  tracks: { buffer: AudioBuffer; gain: number }[],
  totalMs: number,
): AudioBuffer {
  const len = Math.max(1, Math.ceil((totalMs / 1000) * ACCOMP_SAMPLE_RATE))
  const chans = tracks.map((t) => ({
    gain: t.gain,
    channels: [0, 1].map((c) => t.buffer.getChannelData(Math.min(c, t.buffer.numberOfChannels - 1))),
  }))
  const mixed = mixSamples(chans, len, 2)
  const buf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: ACCOMP_SAMPLE_RATE })
  buf.getChannelData(0).set(mixed[0])
  buf.getChannelData(1).set(mixed[1])
  return buf
}
