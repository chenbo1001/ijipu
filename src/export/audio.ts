/**
 * export/audio.ts — 音频导出：OfflineAudioContext + SpessaSynth 高保真离线渲染（adj345）
 *
 * 与试听同一 SpessaSynth 高保真音源（SF2 内置本地）：播放事件序列 → 标准 MIDI 字节
 * （engine.eventsToMidi 复用）→ BasicMIDI → WorkletSynthesizer 在 OfflineAudioContext
 * 上离线渲染 → AudioBuffer → WAV（零依赖）/ MP3（lamejs 纯 JS 编码，浏览器/桌面均离线可用）。
 * adj345：导出由「合成渲染」改为 SpessaSynth 高保真离线渲染（导出也高保真，与试听一致）；
 * 音源由调用方负责「仅首次使用时下载并缓存」（见 ExportDialog）。
 */
import { eventsToMidi, pcmToWav, type PlayEvent } from '@ijipu/engine'
import { Mp3Encoder } from '@breezystack/lamejs'

/** 渲染采样率 */
export const RENDER_SAMPLE_RATE = 44100

/** SpessaSynth worklet 处理器（已拷贝到 public/spessasynth/，经 BASE_URL 定位，与试听后端一致） */
const WORKLET_URL = `${import.meta.env.BASE_URL}spessasynth/spessasynth_processor.min.js`

/**
 * 播放事件序列 → AudioBuffer（OfflineAudioContext + SpessaSynth 高保真离线渲染）。
 * 时长由事件 atMs/durationMs 决定（已含拍速换算）。bpm 用于构造 MIDI 速度元数据；
 * soundBank 为 SF2/SF3 ArrayBuffer（由调用方保证已缓存，仅首次使用时下载）。
 */
export async function renderToAudioBuffer(
  events: PlayEvent[],
  soundBank: ArrayBuffer,
  opts: { bpm: number; title?: string },
): Promise<AudioBuffer> {
  // adj349：动态加载 spessasynth_core/spessasynth_lib（大库）——导出时才按需加载，减首包
  const { BasicMIDI } = await import('spessasynth_core')
  const { WorkletSynthesizer } = await import('spessasynth_lib')

  // 1. 播放序列 → 标准 MIDI 字节（含反复展开/多声部分轨；复用引擎，保证与试听一致）
  const midiBytes = eventsToMidi(events, { bpm: opts.bpm, title: opts.title })
  const midiBuf = midiBytes.buffer.slice(midiBytes.byteOffset, midiBytes.byteOffset + midiBytes.byteLength) as ArrayBuffer
  const midi = BasicMIDI.fromArrayBuffer(midiBuf)

  // 2. OfflineAudioContext 离线渲染（SpessaSynth 高保真）
  let endMs = 500
  for (const e of events) endMs = Math.max(endMs, e.atMs + e.durationMs)
  const len = Math.max(1, Math.ceil((endMs / 1000) * RENDER_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(2, len, RENDER_SAMPLE_RATE)
  await ctx.audioWorklet.addModule(WORKLET_URL)
  const synth = new WorkletSynthesizer(ctx)
  synth.connect(ctx.destination)
  // 音源仅首次使用时由调用方下载并缓存；此处直接使用传入 ArrayBuffer
  await synth.startOfflineRender({
    midiSequence: midi,
    soundBankList: [{ bankOffset: 0, soundBankBuffer: soundBank }],
    loopCount: 0,
  })
  // startRendering() 渲染整图（含 worklet 输出 downmix 到 2ch），返回播放序列对应的 AudioBuffer
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
