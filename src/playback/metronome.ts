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

/**
 * 排一次「嗒」；返回的节点已 start，调用方负责登记/停止（HMR 停声也靠它）。
 *
 * `strong` = 这一拍是不是小节第一拍：强拍音高约 ×1.16、音量约 ×1.18；
 * 弱拍约 ×0.72。差别刻意做得清楚，但不至于又变成提示音。
 */
export function scheduleMetronomeClick(
  ctx: AudioContext,
  when: number,
  timbre: MetronomeTimbre,
  strong: boolean,
): AudioScheduledSourceNode[] {
  const p = strong ? 1.16 : 1
  const g = strong ? 1.18 : 0.72
  switch (timbre) {
    case 'bangzi':
      // 梆子：偏低的木头，短促、有空腔感
      return [
        tone(ctx, when, 'triangle', 560 * p, 380 * p, 0.06 * g, 0.055),
        noise(ctx, when, 0.008 * g, 0.012, 1800),
      ]
    case 'gear':
      // 齿轮：一截高频噪声 + 很短的金属尖头
      return [
        noise(ctx, when, 0.05 * g, 0.03, 1400),
        tone(ctx, when, 'square', 1800 * p, 1300 * p, 0.012 * g, 0.018),
      ]
    case 'electronic':
      // 电子：柔和的正弦短音（原 adj1170 的软音色）
      return [tone(ctx, when, 'sine', 660 * p, 440 * p, 0.05 * g, 0.045)]
    case 'woodblock':
    default:
      // 木鱼：高频、干脆的木头
      return [
        tone(ctx, when, 'triangle', 1050 * p, 780 * p, 0.055 * g, 0.04),
        noise(ctx, when, 0.006 * g, 0.008, 2400),
      ]
  }
}
