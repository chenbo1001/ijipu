/**
 * export/audio.ts — 音频导出：离线渲染（OfflineAudioContext）+ WAV/MP3 编码（adj290）
 *
 * 复用试听合成音色（renderSynthNote，多乐器按声部名路由），播放事件序列 →
 * AudioBuffer → WAV（零依赖）/ MP3（lamejs 纯 JS 编码，浏览器/桌面均离线可用）。
 */
import { renderSynthNote, pcmToWav } from '@ijipu/engine'
import { Mp3Encoder } from '@breezystack/lamejs'
import type { PlayEvent } from '@ijipu/engine'

/** 渲染采样率 */
export const RENDER_SAMPLE_RATE = 44100

/**
 * 播放事件序列 → AudioBuffer（OfflineAudioContext 离线渲染，与试听音色一致）。
 * 时长由事件 atMs/durationMs 决定（已含拍速换算），无需 bpm。
 * globalInstrument 非空 = 全局指定乐器（覆盖所有事件），否则按事件声部名自动路由。
 */
export async function renderToAudioBuffer(
  events: PlayEvent[],
  globalInstrument?: string,
): Promise<AudioBuffer> {
  // 总时长 = 最后事件结束 + 尾部余量 0.5s
  let endMs = 500
  for (const e of events) endMs = Math.max(endMs, e.atMs + e.durationMs)
  const len = Math.max(1, Math.ceil((endMs / 1000) * RENDER_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(2, len, RENDER_SAMPLE_RATE)
  for (const e of events) {
    if (!e.placed.playable || !e.placed.audioPitch) continue
    const pitch = e.pitch ?? e.placed.audioPitch
    if (!pitch) continue
    renderSynthNote(ctx, pitch, e.atMs / 1000, e.durationMs / 1000, 0.5, globalInstrument ?? e.instrument)
  }
  return ctx.startRendering()
}

/** AudioBuffer → WAV（PCM16）字节 */
export function audioBufferToWav(buf: AudioBuffer): Uint8Array {
  const chans: Float32Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  return pcmToWav(chans, buf.sampleRate)
}

/** Float32（-1~1）→ Int16（供 lamejs） */
function toInt16(data: Float32Array): Int16Array {
  const out = new Int16Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** AudioBuffer → MP3 字节（lamejs，分帧编码控制内存） */
export function audioBufferToMp3(buf: AudioBuffer, kbps = 128): Uint8Array {
  const chans = buf.numberOfChannels
  const enc = new Mp3Encoder(chans, buf.sampleRate, kbps)
  const parts: Uint8Array[] = []
  const block = 1152 // 一帧采样数
  const left = toInt16(buf.getChannelData(0))
  const right = chans > 1 ? toInt16(buf.getChannelData(1)) : undefined
  for (let i = 0; i < left.length; i += block) {
    parts.push(enc.encodeBuffer(left.subarray(i, i + block), right?.subarray(i, i + block)))
  }
  parts.push(enc.flush())
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}
