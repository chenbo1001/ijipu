/**
 * playback/metronome.ts — 节拍器的音色与合成（adj1173）
 *
 * 用户口径：
 *  · 「节拍器可以选择音色吗？如梆子、齿轮、木鱼等音色」⇒ 提供 4 种可选的合成音色；
 *  · 「强拍和弱拍应该有所区分」⇒ 每小节第一拍（barStartBeats 命中的那一拍）用
 *    更高的音高 + 更大的音量，其余拍为轻拍。
 *
 * 为什么不用采样：节拍器要**零延迟、随时可播**，采样还要额外资源与解码；
 * 这几种音色都能用短包络的振荡器/噪声合成出可辨识的木头/机械质感，
 * 而且与音频上下文共用同一条时钟（adj1172 的锚点映射）。
 */
export const METRONOME_TIMBRES = ['woodblock', 'bangzi', 'gear', 'electronic'] as const
export type MetronomeTimbre = (typeof METRONOME_TIMBRES)[number]
export const DEFAULT_METRONOME_TIMBRE: MetronomeTimbre = 'woodblock'

export function isMetronomeTimbre(v: unknown): v is MetronomeTimbre {
  return typeof v === 'string' && (METRONOME_TIMBRES as readonly string[]).includes(v)
}

/**
 * 这一拍是不是小节的强拍。
 *
 * 用 `barStartBeats`（谱面拍位）判断，容差 0.02 拍：
 *  - 2ms 的浮点/取整误差不会漏掉强拍；
 *  - 也不会把相邻半拍误判成强拍。
 *
 * 单独抽出来是为了在 smoke 里直接断言，而不是只能靠"听起来对不对"。
 */
export function isStrongMetronomeBeat(
  beat: number,
  barStartBeats: readonly number[],
  epsilon = 0.02,
): boolean {
  if (!Number.isFinite(beat)) return false
  return barStartBeats.some((b) => Math.abs(beat - b) <= epsilon)
}

/** 每个 AudioContext 一份噪声缓冲（齿轮/木鱼的起音用；不重复分配） */
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>()
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const key = ctx
  let buf = noiseBuffers.get(key)
  const need = Math.max(1, Math.ceil(ctx.sampleRate * seconds))
  if (!buf || buf.length < need) {
    buf = ctx.createBuffer(1, need, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffers.set(key, buf)
  }
  return buf
}

/** 一个带 2ms 起音、指数收尾的短音；返回可 stop 的振荡器 */
function tone(
  ctx: AudioContext,
  when: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  peak: number,
  seconds: number,
): OscillatorNode {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(Math.max(20, f0), when)
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + seconds)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + seconds)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(when)
  osc.stop(when + seconds + 0.01)
  return osc
}

/** 一截带高通滤波的噪声，用来做木头/齿轮的"起音" */
function noise(
  ctx: AudioContext,
  when: number,
  peak: number,
  seconds: number,
  highpassHz: number,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, seconds + 0.01)
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = highpassHz
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), when + 0.001)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + seconds)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  src.start(when)
  src.stop(when + seconds + 0.01)
  return src
}

export type MetronomeClickLayer =
  | {
      kind: 'tone'
      type: OscillatorType
      fromHz: number
      toHz: number
      peak: number
      seconds: number
    }
  | { kind: 'noise'; peak: number; seconds: number; highpassHz: number }

/**
 * 强拍/弱拍的**两套发音**（用户口径：嘣恰恰恰）。
 *
 * 不是把同一个音简单调大/调高：强拍是**低音「嘣」**（低频、稍长、带一点噪声木体），
 * 弱拍是**高音「恰」**（高频、很短）。四种音色分别有自己的强/弱材料，
 * 所以换音色时"嘣/恰"的音色也会跟着变，但强弱关系始终是"低—高—高—高"。
 *
 * 抽成纯函数是为了让 smoke 能直接量"强拍频率一定低于弱拍"。
 */
export function metronomeClickSpec(timbre: MetronomeTimbre, strong: boolean): MetronomeClickLayer[] {
  if (strong) {
    switch (timbre) {
      case 'bangzi':
        // 梆子：低沉的空腔"梆"
        return [
          { kind: 'tone', type: 'sawtooth', fromHz: 210, toHz: 120, peak: 0.06, seconds: 0.095 },
          { kind: 'noise', peak: 0.006, seconds: 0.018, highpassHz: 600 },
        ]
      case 'gear':
        // 齿轮：低频的机械"咔"
        return [
          { kind: 'tone', type: 'square', fromHz: 150, toHz: 95, peak: 0.035, seconds: 0.08 },
          { kind: 'noise', peak: 0.03, seconds: 0.045, highpassHz: 350 },
        ]
      case 'electronic':
        // 电子：低音"嘣"
        return [{ kind: 'tone', type: 'sine', fromHz: 220, toHz: 130, peak: 0.07, seconds: 0.09 }]
      case 'woodblock':
      default:
        // 木鱼：低音木体"笃"
        return [
          { kind: 'tone', type: 'triangle', fromHz: 320, toHz: 180, peak: 0.07, seconds: 0.085 },
          { kind: 'noise', peak: 0.008, seconds: 0.012, highpassHz: 800 },
        ]
    }
  }
  switch (timbre) {
    case 'bangzi':
      // 梆子：高音短"梆"
      return [
        { kind: 'tone', type: 'sawtooth', fromHz: 900, toHz: 700, peak: 0.04, seconds: 0.035 },
        { kind: 'noise', peak: 0.003, seconds: 0.008, highpassHz: 1500 },
      ]
    case 'gear':
      // 齿轮：高频棘轮"嚓"
      return [
        { kind: 'noise', peak: 0.045, seconds: 0.025, highpassHz: 2000 },
        { kind: 'tone', type: 'square', fromHz: 2100, toHz: 1700, peak: 0.012, seconds: 0.018 },
      ]
    case 'electronic':
      // 电子：高音短"嘀"
      return [{ kind: 'tone', type: 'sine', fromHz: 1100, toHz: 820, peak: 0.04, seconds: 0.035 }]
    case 'woodblock':
    default:
      // 木鱼：高音短"嗒"
      return [
        { kind: 'tone', type: 'triangle', fromHz: 1250, toHz: 1000, peak: 0.045, seconds: 0.032 },
        { kind: 'noise', peak: 0.003, seconds: 0.006, highpassHz: 2800 },
      ]
  }
}

/**
 * 排一次「嗒」；返回的节点已 start，调用方负责登记/停止（HMR 停声也靠它）。
 *
 * 强/弱由 `metronomeClickSpec` 给出**完全不同的材料**，不是同一个音变音量。
 */
export function scheduleMetronomeClick(
  ctx: AudioContext,
  when: number,
  timbre: MetronomeTimbre,
  strong: boolean,
): AudioScheduledSourceNode[] {
  return metronomeClickSpec(timbre, strong).map((layer) =>
    layer.kind === 'tone'
      ? tone(ctx, when, layer.type, layer.fromHz, layer.toHz, layer.peak, layer.seconds)
      : noise(ctx, when, layer.peak, layer.seconds, layer.highpassHz),
  )
}
