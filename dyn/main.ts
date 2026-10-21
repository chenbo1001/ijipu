/**
 * dyn/main.ts — 动态谱**调试页**（临时）
 *
 * 走的是应用里的同一条渲染管线（`src/export/video/renderer.ts`）：
 * **不重排**，用 A4 版面 + 相机（满宽片头 → 4× 跟拍）。
 *
 * ⚠ 不进构建产物（`vite.config.ts` 的 input 里没有它），只在 `npm run dev` 时按路径提供。
 * 接进应用并验证完就删本目录。
 *
 * 打开：<http://localhost:5173/dyn/>（`?p=1x1` 切画布，`?t=12` 定位到第 12 秒）
 */
import { defaultPageConfig, DYNAMIC_PRESETS, type DynamicPresetId } from '@ijipu/engine'
import { createDynamicSession, type DynamicSession } from '../src/export/video/renderer'
import { encodeMp4, trimAudio } from '../src/export/video/mp4'

/** 素材：够长，能看出"换行 + 横向跟拍" */
const DEMO = [
  'V: 1.0',
  'B: 小星星',
  'D: C',
  'P: 4/4',
  'Q: |: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - :|',
  'C: 一 二 三 四 五 六 七 八',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'C: 九 十 百 千 万 亿 兆 京',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 4 4 3 3 | 2 2 1 - |',
  '',
].join('\n')

const BPM = 100

const canvas = document.getElementById('view') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const playBtn = document.getElementById('play') as HTMLButtonElement
const seek = document.getElementById('seek') as HTMLInputElement
const meta = document.getElementById('meta') as HTMLElement
const presetSel = document.getElementById('preset') as HTMLSelectElement
const hint = document.getElementById('hint') as HTMLElement

let session: DynamicSession | null = null
let cursor = 0
let playing = false
let lastTick = 0

function paint(t: number): void {
  if (!session) return
  const res = session.draw(ctx, t)
  meta.textContent =
    `${(t / 1000).toFixed(1)}s / ${(session.totalMs / 1000).toFixed(1)}s` +
    ` · ${res.following ? '跟拍' : '满宽'} ${res.frame.zoom.toFixed(2)}×`
  seek.value = String(Math.round(t))
}

async function rebuild(presetId: DynamicPresetId): Promise<void> {
  hint.textContent = '正在准备画面…'
  // ?z= 跟拍倍数（页面单位）。缺省 4；用 7.24 可看"满宽的 4 倍"是什么样
  const zParam = Number(new URLSearchParams(location.search).get('z'))
  const followZoom = Number.isFinite(zParam) && zParam > 0 ? zParam : undefined
  const s = await createDynamicSession(DEMO, presetId, defaultPageConfig, BPM, { followZoom })
  session = s
  canvas.width = s.width
  canvas.height = s.height
  seek.max = String(Math.round(s.totalMs))
  const tParam = Number(new URLSearchParams(location.search).get('t'))
  cursor = Number.isFinite(tParam) && tParam > 0 ? Math.min(s.totalMs, tParam * 1000) : 0
  hint.textContent = `${DYNAMIC_PRESETS[presetId].label} · ${s.width}×${s.height} · 共 ${(s.totalMs / 1000).toFixed(1)}s`
  paint(cursor)
}

function tick(now: number): void {
  if (!playing || !session) return
  const dt = lastTick > 0 ? now - lastTick : 0
  lastTick = now
  cursor = Math.min(session.totalMs, cursor + dt)
  if (cursor >= session.totalMs) {
    playing = false
    playBtn.textContent = '播放'
  }
  paint(cursor)
  if (playing) requestAnimationFrame(tick)
}

playBtn.addEventListener('click', () => {
  if (playing) {
    playing = false
    playBtn.textContent = '播放'
    return
  }
  if (session && cursor >= session.totalMs) cursor = 0
  playing = true
  lastTick = 0
  playBtn.textContent = '暂停'
  requestAnimationFrame(tick)
})

seek.addEventListener('input', () => {
  cursor = Number(seek.value)
  paint(cursor)
})

presetSel.addEventListener('change', () => {
  playing = false
  playBtn.textContent = '播放'
  void rebuild(presetSel.value as DynamicPresetId)
})

const pParam = new URLSearchParams(location.search).get('p')
if (pParam === '9x16' || pParam === '1x1' || pParam === '16x9') presetSel.value = pParam

void rebuild(presetSel.value as DynamicPresetId).catch((e) => {
  hint.textContent = `出错了：${String(e)}`
  console.error(e)
})

/**
 * 调试用：编一小段 MP4 并回报体积与文件头（`ftyp`）。
 * 从控制台/CDP 调：`await window.__testMp4(3)`；带音频：`__testMp4(3, true)`
 */
;(window as unknown as { __testMp4: (sec?: number, withAudio?: boolean) => Promise<unknown> }).__testMp4 = async (
  sec = 3,
  withAudio = false,
) => {
  if (!session) throw new Error('还没有会话')
  let audio: AudioBuffer | null = null
  if (withAudio) {
    // 合成一段正弦当"音轨"，专门验 AAC 能不能进 MP4（不碰音色库）
    const sr = 44100
    const oac = new OfflineAudioContext(2, Math.ceil(sr * sec), sr)
    const osc = oac.createOscillator()
    const gain = oac.createGain()
    gain.gain.value = 0.2
    osc.frequency.value = 440
    osc.connect(gain).connect(oac.destination)
    osc.start(0)
    audio = await oac.startRendering()
  }
  const t0 = performance.now()
  const blob = await encodeMp4(session, { fps: 30, maxMs: sec * 1000, audio })
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const magic = String.fromCharCode(...head.slice(4, 8))
  // 扫一遍容器里有没有音频轨（fastStart 下 moov 在前，但小文件直接全扫也很快）
  const all = new Uint8Array(await blob.arrayBuffer())
  const text = new TextDecoder('latin1').decode(all)
  return { size: blob.size, magic, ms: Math.round(performance.now() - t0), audio: !!audio, hasAudioTrack: text.includes('mp4a') }
}

/** 调试：音轨截断（画面 3 分钟上限时，声音必须跟着截） */
;(window as unknown as { __testTrim: () => Promise<unknown> }).__testTrim = async () => {
  const sr = 44100
  const oac = new OfflineAudioContext(2, sr * 6, sr)
  const osc = oac.createOscillator()
  osc.connect(oac.destination)
  osc.start(0)
  const buf = await oac.startRendering()
  const cut = trimAudio(buf, 3000)
  return { before: buf.duration, after: cut.duration, channels: cut.numberOfChannels }
}
