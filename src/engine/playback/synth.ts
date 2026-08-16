/**
 * engine/playback/synth.ts — Web Audio 合成音色后端（零外部依赖）
 *
 * 用振荡器 + 泛音 + 指数衰减包络模拟钢琴/钟琴音色。
 * AudioContext 惰性创建（首次播放时，满足浏览器用户手势要求）。
 */
import type { AudioBackend } from './types'

/** 简谱音名（如 C4 / F#5）→ 频率 */
export function pitchToFreq(name: string): number {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name)
  if (!m) return 261.63
  const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const base = semis[m[1]] + (m[2] === '#' ? 1 : 0)
  const octave = Number(m[3])
  // C4 = 261.63Hz
  return 261.63 * Math.pow(2, octave - 4 + base / 12)
}

export class SynthBackend implements AudioBackend {
  readonly kind = 'synth' as const
  private ctx: AudioContext | null = null
  private activeOscs = new Set<OscillatorNode>()

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  play(pitch: string | null, atMs: number, durationMs: number, gain: number): void {
    if (!pitch) return
    const ctx = this.ensure()
    if (!ctx) return
    const t0 = ctx.currentTime + Math.max(0, atMs) / 1000
    const dur = Math.max(0.06, durationMs / 1000)
    const freq = pitchToFreq(pitch)

    // 基频（triangle）+ 2 个泛音（sine），指数衰减包络
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, 'triangle'],
      [2, 0.5, 'sine'],
      [3, 0.25, 'sine'],
    ]
    for (const [mult, vol, type] of partials) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = freq * mult
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain * vol, t0 + 0.012)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
      osc.connect(g)
      g.connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
      this.activeOscs.add(osc)
      osc.onended = () => {
        this.activeOscs.delete(osc)
        g.disconnect()
        osc.disconnect()
      }
    }
  }

  stop(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
      this.activeOscs.clear()
    }
  }

  dispose(): void {
    this.stop()
  }
}
