/**
 * engine/playback/index.ts — 播放引擎入口
 *
 * 管线：buildPlaySequence（含反复记号展开）→ AudioBackend 播放。
 * 两种后端（可切换）：
 *  - synth：Web Audio 合成音色（零依赖，默认）
 *  - sampler：钢琴采样（外部 soundfont，需网络，实验性）
 */
import type { PlacedToken } from '../types'
import type { AudioBackend, BackendKind } from './types'
import { SynthBackend, pitchToFreq } from './synth'
import { SamplerBackend } from './sampler'

export { buildPlaySequence, inferBpm } from './sequence'
export type { PlayEvent, PlaySequence } from './sequence'
export { SynthBackend, pitchToFreq }
export { SamplerBackend }
export type { AudioBackend, BackendKind } from './types'

/** 创建音频后端 */
export function createBackend(kind: BackendKind): AudioBackend {
  if (kind === 'sampler') return new SamplerBackend()
  return new SynthBackend()
}

/** 调度播放：按事件延迟触发；返回取消函数 */
export function schedulePlay(
  seq: { events: { placed: PlacedToken; atMs: number; durationMs: number }[] },
  backend: AudioBackend,
  onNote?: (placed: PlacedToken) => void,
): { cancel: () => void; totalMs: number } {
  const timers: number[] = []
  for (const ev of seq.events) {
    if (!ev.placed.playable || !ev.placed.audioPitch) continue
    timers.push(
      window.setTimeout(() => {
        backend.play(ev.placed.audioPitch, 0, ev.durationMs, 0.5)
        onNote?.(ev.placed)
      }, ev.atMs),
    )
  }
  const totalMs = seq.events.length > 0 ? seq.events[seq.events.length - 1].atMs + 100 : 0
  return {
    cancel: () => timers.forEach((t) => window.clearTimeout(t)),
    totalMs,
  }
}
