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

/** 调度播放：按事件 atMs 调度音频（由后端用 AudioContext.currentTime 调度，同 atMs 事件同时响） */
export function schedulePlay(
  seq: { events: { placed: PlacedToken; atMs: number; durationMs: number; pitch?: string | null }[] },
  backend: AudioBackend,
  onNote?: (placed: PlacedToken) => void,
): { cancel: () => void; totalMs: number } {
  for (const ev of seq.events) {
    if (!ev.placed.playable || !ev.placed.audioPitch) continue
    const pitch = ev.pitch ?? ev.placed.audioPitch
    if (!pitch) continue
    // adj261：直接用 ev.atMs 调度（此前 bug 传 0，导致音频延迟/不响）；后端 AudioContext 按 atMs 调度，同 atMs 事件同时响
    backend.play(pitch, ev.atMs, ev.durationMs, 0.5)
    onNote?.(ev.placed)
  }
  const totalMs = seq.events.length > 0 ? seq.events[seq.events.length - 1].atMs + 100 : 0
  return {
    cancel: () => backend.stop(),
    totalMs,
  }
}
