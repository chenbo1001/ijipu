/**
 * dialogs/SyncDialog.tsx — **对拍台**（应用内独立台面，`adj1119`）
 *
 * 用户口径（2026-10-24）：
 *  · 对拍是**独立操作**，进出片要用它的结果 ⇒ 一块盖住窗口的台面（Esc 关闭），不是相机位里的小条；
 *  · 操作 = **听 + T 打点 + 输入谱位（`2:1`）+ 回退重听 + 每锚点微调 + 锁定**；
 *  · 锚点记**文件绝对毫秒**（掐头去尾不改它们）；微调的对象是"这一条锚点"，不是全局偏移；
 *  · 节拍器**默认关**；点击落在**拍点**（不跟跳跳球落地：球按设计提前 1/20 拍）；
 *  · P0 一条全局拍速（所有锚点最小二乘），段拍速只做诊断；某条锚点偏 > 1 拍才告警。
 *
 * 这一版先跑通"能看到、能对、能出片"的闭环：
 *  - 伴奏用 `<input type=file>` 选（Rust 原生选择器 + sidecar 写盘下一步接）；
 *  - 参数先存 L1（`syncStore`），相机位/导出已经按它重建会话、带上伴奏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildPlaySequence, fitSync, inferBpm, layoutScore, residualBeatsOf, type SyncAnchor } from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useSyncStore } from '../store/syncStore'
import { useUiStore } from '../store/uiStore'
import { decodeAccompaniment, waveformPeaks } from '../export/video/accompaniment'
import { syncDocStale } from '../export/video/syncDoc'
import { canUseDynamicVideo } from '../export/video/capability'
import { syncCopy } from '../brand/copy'
// adj1122：波形下方时间标尺的刻度选择（纯函数）
import { timeLabelOf, timeScaleOf } from './syncRuler'

/** 波形高度（CSS px） */
const WAVE_H = 172
/** 波形**下侧时间标尺**的高度（用户 2026-10-24：「在音频波形图下侧显示时间标尺，以方便定位」） */
const RULER_H = 20
/** 微调步长可选值（用户说"先定一步多长，精细后面再调"） */
const STEPS = [1, 5, 10, 50] as const
/** "回退几秒重听"：锚点前 3 秒 → 锚点后 2 秒 */
const REWIND_MS = 3000
const AFTER_MS = 2000

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(3)}s`

export function SyncDialog() {
  const closeModal = useUiStore((s) => s.closeModal)
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)

  const doc = useSyncStore((s) => s.doc)
  const audio = useSyncStore((s) => s.audio)
  const ensureFor = useSyncStore((s) => s.ensureFor)
  const setAudio = useSyncStore((s) => s.setAudio)
  const addAnchor = useSyncStore((s) => s.addAnchor)
  const updateAnchor = useSyncStore((s) => s.updateAnchor)
  const removeAnchor = useSyncStore((s) => s.removeAnchor)
  const setTrim = useSyncStore((s) => s.setTrim)
  const setMix = useSyncStore((s) => s.setMix)
  const save = useSyncStore((s) => s.save)
  const clear = useSyncStore((s) => s.clear)

  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState(0)
  const [meterOn, setMeterOn] = useState(false)
  const [loopOn, setLoopOn] = useState(true)
  const [stepMs, setStepMs] = useState<number>(5)
  const [zoom, setZoom] = useState<'all' | '30'>('all')
  const [decodeState, setDecodeState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [pending, setPending] = useState<{ audioMs: number } | null>(null)
  const [bar, setBar] = useState(1)
  const [beat, setBeat] = useState(1)
  const [notice, setNotice] = useState('')

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const metaRef = useRef<HTMLSpanElement | null>(null)
  const playheadRef = useRef(0)
  const peaksRef = useRef<{ key: string; peaks: { min: number; max: number }[] } | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const startRef = useRef<{ at: number; from: number } | null>(null)
  const loopRef = useRef<{ startMs: number; endMs: number } | null>(null)
  const rafRef = useRef(0)
  const playingRef = useRef(false)

  // 打开台面：恢复同名谱的副本（没有就新建空 doc）
  useEffect(() => {
    ensureFor(fileName, code)
  }, [ensureFor, fileName, code])

  /**
   * 小节起点**拍位**（与速度无关）：用任意拍速建一次播放序列，`barStartsMs / beatMs` 即拍。
   * `{jz}` 的额外拍已经算在里面 ⇒ 与播放口径一致。
   */
  const barStartBeats = useMemo(() => {
    const lay = layoutScore(parseResult, pageConfig)
    const seq = buildPlaySequence(parseResult, lay, 120)
    return (seq.barStartsMs ?? []).map((ms) => ms / 500)
  }, [parseResult, pageConfig])

  const scoreBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const scoreBeatMs = 60000 / scoreBpm
  const fit = doc?.tempo ?? null
  /** 没有解算结果时（<2 条锚点）也画刻度：用谱面 J + 第一条锚点的偏移 */
  const effFit = useMemo(() => {
    if (fit) return fit
    if (doc && doc.anchors.length > 0) {
      const a = doc.anchors[0]
      return { beatMs: scoreBeatMs, offsetMs: a.audioMs - a.beat * scoreBeatMs }
    }
    return null
  }, [fit, doc, scoreBeatMs])

  const durMs = Math.max(1, doc?.audioDurationMs || (audio ? Math.round(audio.duration * 1000) : 1))
  const trim = doc?.trim ?? { startMs: 0, endMs: durMs }

  /** 拍号 → "第 N 小节第 K 拍"（给锚点列表/打点默认值用） */
  const barBeatLabel = useCallback(
    (b: number): string => {
      for (let i = barStartBeats.length - 1; i >= 0; i--) {
        if (b >= barStartBeats[i] - 1e-6) {
          return `${i + 1}:${Math.round((b - barStartBeats[i]) * 100) / 100 + 1}`
        }
      }
      return `${b}`
    },
    [barStartBeats],
  )

  const beatOfBarBeat = useCallback(
    (barNo: number, beatNo: number): number | null => {
      const start = barStartBeats[barNo - 1]
      if (start === undefined) return null
      return start + (beatNo - 1)
    },
    [barStartBeats],
  )

  // ---------- 播放器（AudioContext + 手动循环，便于节拍器每圈重排） ----------
  const ensureCtx = useCallback((): AudioContext => {
    ctxRef.current ??= new AudioContext()
    return ctxRef.current
  }, [])

  const currentMs = useCallback((): number => {
    const ctx = ctxRef.current
    const si = startRef.current
    if (!ctx || !si || !playingRef.current) return playheadRef.current
    return si.from + (ctx.currentTime - si.at) * 1000
  }, [])

  const stopSource = useCallback(() => {
    const s = srcRef.current
    srcRef.current = null
    if (s) {
      try {
        s.stop()
      } catch {
        /* 已自然结束 */
      }
      s.disconnect()
    }
    cancelAnimationFrame(rafRef.current)
    playingRef.current = false
    setPlaying(false)
  }, [])

  /** 节拍器：从 `fromMs` 到 `toMs` 预先排"嗒"（拍点；最多 2000 下，防止超长曲拖垮） */
  const scheduleClicks = useCallback(
    (fromMs: number, toMs: number) => {
      if (!meterOn || !effFit) return
      const ctx = ensureCtx()
      const k0 = Math.ceil((fromMs - effFit.offsetMs) / effFit.beatMs - 1e-9)
      let n = 0
      for (let k = k0; n < 2000; k++) {
        const at = effFit.offsetMs + k * effFit.beatMs
        if (at >= toMs) break
        if (at < fromMs - 1) continue
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 900
        gain.gain.value = 0.22
        osc.connect(gain)
        gain.connect(ctx.destination)
        const t = ctx.currentTime + Math.max(0, (at - fromMs) / 1000) + 0.02
        osc.start(t)
        osc.stop(t + 0.035)
        n++
      }
    },
    [ensureCtx, effFit, meterOn],
  )

  const startPlayback = useCallback(
    async (fromMs: number, loop?: { startMs: number; endMs: number }) => {
      if (!audio) {
        setNotice(syncCopy.noAudio)
        return
      }
      stopSource()
      const ctx = ensureCtx()
      await ctx.resume()
      const src = ctx.createBufferSource()
      src.buffer = audio
      src.connect(ctx.destination)
      const from = Math.max(0, Math.min(fromMs, trim.endMs - 1))
      src.start(0, from / 1000)
      srcRef.current = src
      startRef.current = { at: ctx.currentTime, from }
      loopRef.current = loop ?? null
      playheadRef.current = from
      playingRef.current = true
      setPlaying(true)
      if (meterOn) scheduleClicks(from, loop ? loop.endMs : trim.endMs)
      const tick = () => {
        if (!playingRef.current) return
        const t = currentMs()
        playheadRef.current = Math.min(t, trim.endMs)
        drawRef.current()
        const lp = loopRef.current
        if (lp && t >= lp.endMs) {
          void startPlayback(lp.startMs, lp)
          return
        }
        if (t >= trim.endMs) {
          stopSource()
          return
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [audio, currentMs, ensureCtx, meterOn, scheduleClicks, stopSource, trim.endMs],
  )

  /** 当前锚点的"回退几秒重听"窗口 */
  const rewindWindow = useCallback(
    (anchorMs: number) => ({
      startMs: Math.max(trim.startMs, anchorMs - REWIND_MS),
      endMs: Math.min(trim.endMs, anchorMs + AFTER_MS),
    }),
    [trim.endMs, trim.startMs],
  )

  const replayAround = useCallback(
    (anchorMs: number) => {
      const w = rewindWindow(anchorMs)
      if (loopOn) void startPlayback(w.startMs, w)
      else void startPlayback(w.startMs)
    },
    [loopOn, rewindWindow, startPlayback],
  )

  // ---------- 波形绘制 ----------
  const drawRef = useRef<() => void>(() => {})

  const draw = useCallback(() => {
    const c = canvasRef.current
    const wrap = wrapRef.current
    if (!c || !wrap || !doc) return
    const W = Math.max(200, wrap.clientWidth)
    const totalH = WAVE_H + RULER_H
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(totalH * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(totalH * dpr)
      c.style.width = `${W}px`
      c.style.height = `${totalH}px`
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 每帧显式定一次文字基线：标尺用 `top`、其它标签用默认 `alphabetic`，
    // 否则上下文状态会跨帧残留、下一帧的小节号整体下移（adj1122 实测）
    ctx.textBaseline = 'alphabetic'
    ctx.clearRect(0, 0, W, totalH)
    // 波形区
    ctx.fillStyle = '#1f2329'
    ctx.fillRect(0, 0, W, WAVE_H)
    // 标尺区（比波形再暗一档：一眼能分出"这是刻度条"）
    ctx.fillStyle = '#171a1f'
    ctx.fillRect(0, WAVE_H, W, RULER_H)

    // 可视窗口：整曲 / 30 秒（以播放头为中心）
    const winMs = zoom === '30' ? Math.min(30000, durMs) : durMs
    const center = playheadRef.current || doc.anchors[sel]?.audioMs || 0
    const v0 = zoom === '30' ? Math.max(0, Math.min(durMs - winMs, center - winMs / 2)) : 0
    const xOf = (ms: number): number => ((ms - v0) / winMs) * W

    // 包络（按像素桶，缓存）
    const buckets = Math.max(200, Math.round(W))
    const key = `${doc.audioDurationMs}|${buckets}|${audio ? audio.length : 0}`
    if (audio && peaksRef.current?.key !== key) {
      const chans: Float32Array[] = []
      for (let i = 0; i < audio.numberOfChannels; i++) chans.push(audio.getChannelData(i))
      peaksRef.current = { key, peaks: waveformPeaks(chans, buckets) }
    }
    const peaks = peaksRef.current?.peaks
    if (peaks) {
      ctx.strokeStyle = '#6f7783'
      ctx.beginPath()
      const mid = WAVE_H / 2
      for (let x = 0; x < W; x++) {
        const ms = v0 + (x / W) * winMs
        const idx = Math.max(0, Math.min(peaks.length - 1, Math.floor((ms / durMs) * peaks.length)))
        const p = peaks[idx]
        ctx.moveTo(x, mid - p.max * mid * 0.9)
        ctx.lineTo(x, mid - p.min * mid * 0.9)
      }
      ctx.stroke()
    }

    // 保留段之外的压暗
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    if (trim.startMs > v0) ctx.fillRect(0, 0, xOf(Math.min(trim.startMs, v0 + winMs)), WAVE_H)
    if (trim.endMs < v0 + winMs) {
      const x1 = xOf(Math.max(trim.endMs, v0))
      ctx.fillRect(x1, 0, W - x1, WAVE_H)
    }

    // 小节刻度 + 拍刻度（有 effFit 才画：没有锚点时不知道音频位置）
    if (effFit) {
      barStartBeats.forEach((b, i) => {
        const ms = effFit.offsetMs + b * effFit.beatMs
        if (ms < v0 || ms > v0 + winMs) return
        const x = xOf(ms)
        ctx.strokeStyle = 'rgba(120,200,255,0.55)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, WAVE_H)
        ctx.stroke()
        if (i % 4 === 0) {
          ctx.fillStyle = 'rgba(160,210,255,0.9)'
          ctx.font = '10px system-ui, sans-serif'
          ctx.fillText(String(i + 1), x + 3, 12)
        }
      })
    }

    // 锚点
    doc.anchors.forEach((a, i) => {
      if (a.audioMs < v0 || a.audioMs > v0 + winMs) return
      const x = xOf(a.audioMs)
      ctx.strokeStyle = i === sel ? '#ffd166' : a.locked ? '#9aa4b2' : '#7ee787'
      ctx.lineWidth = i === sel ? 2 : 1.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, WAVE_H)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x - 5, 0)
      ctx.lineTo(x + 5, 0)
      ctx.lineTo(x, 7)
      ctx.closePath()
      ctx.fillStyle = i === sel ? '#ffd166' : a.locked ? '#9aa4b2' : '#7ee787'
      ctx.fill()
      ctx.fillStyle = '#0b0e12'
      ctx.font = 'bold 9px system-ui, sans-serif'
      ctx.fillText(String(i + 1), x - 3, 6)
    })

    // 打点待确认的临时标记
    if (pending) {
      const x = xOf(pending.audioMs)
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = '#ff7b72'
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, WAVE_H)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // ── 时间标尺（波形下侧，adj1122）────────────────────────────
    const scale = timeScaleOf(v0, v0 + winMs, W, 64)
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.beginPath()
    ctx.moveTo(0, WAVE_H + 0.5)
    ctx.lineTo(W, WAVE_H + 0.5)
    ctx.stroke()
    // 次刻度（不写字）
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.beginPath()
    let minorN = 0
    for (let t = Math.ceil(v0 / scale.minorMs) * scale.minorMs; t <= v0 + winMs && minorN < 2000; t += scale.minorMs, minorN++) {
      const x = xOf(t)
      ctx.moveTo(x, WAVE_H)
      ctx.lineTo(x, WAVE_H + 3)
    }
    ctx.stroke()
    // 主刻度 + 时间文字（`m:ss` / `m:ss.s`）
    ctx.font = '10px system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    for (const t of scale.ticks) {
      const x = xOf(t)
      ctx.strokeStyle = 'rgba(255,255,255,0.42)'
      ctx.beginPath()
      ctx.moveTo(x, WAVE_H)
      ctx.lineTo(x, WAVE_H + 7)
      ctx.stroke()
      const label = timeLabelOf(t, scale.stepMs)
      const tw = ctx.measureText(label).width
      // 首尾的标签往里收，别被画布边缘裁掉
      const lx = Math.min(Math.max(2, x + 3), Math.max(2, W - tw - 2))
      ctx.fillStyle = 'rgba(174,184,204,0.92)'
      ctx.fillText(label, lx, WAVE_H + 7)
    }
    // 保留段的两端在标尺上再标一次（掐头去尾时对齐用）
    ctx.strokeStyle = 'rgba(255,200,87,0.75)'
    for (const ms of [trim.startMs, trim.endMs]) {
      const x = xOf(ms)
      if (x < 0 || x > W) continue
      ctx.beginPath()
      ctx.moveTo(x, WAVE_H)
      ctx.lineTo(x, WAVE_H + RULER_H)
      ctx.stroke()
    }

    // 播放头（贯穿波形与标尺）
    const px = xOf(playheadRef.current)
    if (px >= 0 && px <= W) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, WAVE_H + RULER_H)
      ctx.stroke()
    }

    if (metaRef.current) {
      // 没选伴奏时别显示 `0.000s / 0.001s`（看起来像坏数据）
      metaRef.current.textContent =
        audio !== null || doc.audioDurationMs > 1
          ? `${fmtSec(playheadRef.current)} / ${fmtSec(durMs)}`
          : ''
    }
  }, [audio, doc, durMs, effFit, barStartBeats, pending, sel, trim.endMs, trim.startMs, zoom])

  useEffect(() => {
    drawRef.current = draw
    draw()
  }, [draw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => drawRef.current())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // 卸载：停声、关上下文
  useEffect(
    () => () => {
      stopSource()
      const ctx = ctxRef.current
      ctxRef.current = null
      if (ctx) void ctx.close().catch(() => {})
    },
    [stopSource],
  )

  // ---------- 交互 ----------
  const onPickAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setDecodeState('busy')
    try {
      const buf = await decodeAccompaniment(await f.arrayBuffer())
      setAudio(f.name, buf)
      setDecodeState('idle')
      setNotice('')
    } catch {
      setDecodeState('error')
      setNotice(syncCopy.decodeFailed)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const tap = () => {
    if (!audio) {
      setNotice(syncCopy.noAudio)
      return
    }
    const ms = currentMs()
    stopSource()
    playheadRef.current = Math.max(0, Math.min(ms, durMs))
    draw()
    setPending({ audioMs: Math.round(ms) })
    // 默认谱位：上一条锚点 + 1 拍，方便对照
    const last = doc?.anchors[doc.anchors.length - 1]
    if (last) {
      const label = barBeatLabel(last.beat)
      const [b, k] = label.split(':').map(Number)
      setBar(b)
      setBeat(k)
    }
  }

  const confirmTap = () => {
    if (!pending) return
    const b = beatOfBarBeat(bar, beat)
    if (b === null) {
      setNotice(`谱面没有第 ${bar} 小节`)
      return
    }
    if (doc?.anchors.some((a) => Math.abs(a.beat - b) < 1e-6)) {
      setNotice('这个谱位已有锚点，先删掉旧的再加')
      return
    }
    addAnchor({ beat: b, audioMs: pending.audioMs })
    setPending(null)
    setNotice('')
    // 用户口径：记下之后**回退几秒重听**
    replayAround(pending.audioMs)
  }

  const nudge = (delta: number) => {
    const a = doc?.anchors[sel]
    if (!doc || !a || a.locked) return
    stopSource()
    updateAnchor(sel, { audioMs: Math.round(a.audioMs + delta) })
    if (loopOn) replayAround(a.audioMs + delta)
    else {
      playheadRef.current = Math.max(0, a.audioMs + delta)
      draw()
    }
  }

  /** 点击波形：定位播放头（并停声）；按住 Shift 点到的地方直接试听 */
  const onWaveClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    const wrap = wrapRef.current
    if (!c || !wrap || !doc) return
    const rect = c.getBoundingClientRect()
    const W = rect.width
    const winMs = zoom === '30' ? Math.min(30000, durMs) : durMs
    const center = playheadRef.current || 0
    const v0 = zoom === '30' ? Math.max(0, Math.min(durMs - winMs, center - winMs / 2)) : 0
    const ms = v0 + ((e.clientX - rect.left) / W) * winMs
    stopSource()
    playheadRef.current = Math.max(0, Math.min(ms, durMs))
    draw()
    if (e.shiftKey) void startPlayback(playheadRef.current)
  }

  const keyboard = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Escape') {
        if (pending) setPending(null)
        else closeModal()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (playingRef.current) stopSource()
        else void startPlayback(playheadRef.current)
        return
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        tap()
        return
      }
      if (e.key === 'l' || e.key === 'L') {
        setLoopOn((v) => !v)
        return
      }
      if (e.key === 'g' || e.key === 'G') {
        setMeterOn((v) => !v)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : stepMs
        nudge(e.key === 'ArrowLeft' ? -step : step)
      }
    },
    [closeModal, nudge, pending, startPlayback, stepMs, stopSource],
  )

  useEffect(() => {
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [keyboard])

  /**
   * ⚠ `adj1121`：**所有 hook 必须在下面这个提前返回之前**。
   *
   * 第一版把 `residuals` 的 `useMemo` 写在 `if (!doc) return null` 之后 ⇒ 第一帧（doc 还是 null）
   * 只跑到一半 hook，第二帧（doc 建好）多跑一个 hook ⇒ React #310
   * 「Rendered more hooks than during the previous render」⇒ **整个应用白屏**。
   * `tsc`/`smoke` 都发现不了，只有真浏览器点一次才看得见（已补 `verify:app-ui` 断言）。
   */
  const residuals = useMemo(() => {
    if (!doc || doc.tempo === null) return []
    const f = fitSync(doc.anchors)
    return f === null ? [] : residualBeatsOf(f)
  }, [doc])

  if (!doc) return null

  /**
   * adj1121（AGENTS 五·3）：**功能自己要有闸门**，不能只靠"入口藏在相机位/试听里"。
   * 网站与 Obsidian 插件不该出现对拍台；万一被别的入口打开，这里只显示一行说明。
   */
  if (!canUseDynamicVideo()) {
    return (
      <div className="sync-layer">
        <div className="sync-panel">
          <div className="sync-head">
            <b>{syncCopy.title}</b>
            <span className="sync-grow" />
            <button type="button" className="btn" onClick={() => closeModal()}>
              {syncCopy.close}
            </button>
          </div>
          <div className="sync-dim sync-pad">{syncCopy.desktopOnly}</div>
        </div>
      </div>
    )
  }

  const worst = residuals.length > 0 ? Math.max(...residuals) : 0
  const stale = syncDocStale(doc, code)
  const selAnchor = doc.anchors[sel]
  const usable = doc.tempo !== null && doc.audio !== ''

  return (
    <div className="sync-layer">
      <div className="sync-panel">
        <div className="sync-head">
          <b>
            {syncCopy.title}：{fileName}
          </b>
          <span ref={metaRef} className="sync-meta" />
          <span className="sync-grow" />
          {stale && <span className="sync-warn">{syncCopy.stale}</span>}
          <button type="button" className="btn" onClick={() => { save(code, fileName); setNotice(syncCopy.saved) }}>
            {syncCopy.save}
          </button>
          <button type="button" className="btn" onClick={() => closeModal()}>
            {syncCopy.close}
          </button>
        </div>

        <div className="sync-row">
          <span className="sync-label">{syncCopy.audioLabel}</span>
          {audio ? (
            <span className="sync-name">
              {doc.audio} · {fmtSec(durMs)}
            </span>
          ) : (
            <span className="sync-name sync-dim">
              {doc.audio !== '' ? `${syncCopy.audioMissing}：${doc.audio}` : syncCopy.noAudio}
            </span>
          )}
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.flac" className="sync-file" onChange={(e) => void onPickAudio(e)} />
          <button type="button" className="btn" disabled={decodeState === 'busy'} onClick={() => fileRef.current?.click()}>
            {audio ? syncCopy.repickAudio : syncCopy.pickAudio}
          </button>
          {decodeState === 'busy' && <span className="sync-dim">{syncCopy.decoding}</span>}
          <span className="sync-grow" />
          <button type="button" className="btn" onClick={() => (playing ? stopSource() : void startPlayback(playheadRef.current))} disabled={!audio}>
            {playing ? syncCopy.pause : syncCopy.play}
          </button>
          <button type="button" className="btn" onClick={tap} disabled={!audio}>
            {syncCopy.tap}
          </button>
        </div>

        <div ref={wrapRef} className="sync-wave">
          <canvas ref={canvasRef} onClick={onWaveClick} />
          <div className="sync-wave-hint">{syncCopy.tipPick}</div>
        </div>

        <div className="sync-row">
          <span className="sync-label">{syncCopy.trim}</span>
          <span className="sync-name">
            {fmtSec(trim.startMs)} → {fmtSec(trim.endMs)}
          </span>
          <button type="button" className="btn" disabled={!audio} onClick={() => setTrim({ startMs: Math.round(playheadRef.current), endMs: trim.endMs })}>
            {syncCopy.trimStartNow}
          </button>
          <button type="button" className="btn" disabled={!audio} onClick={() => setTrim({ startMs: trim.startMs, endMs: Math.round(playheadRef.current) })}>
            {syncCopy.trimEndNow}
          </button>
          <button type="button" className="btn" disabled={!audio} onClick={() => setTrim({ startMs: 0, endMs: durMs })}>
            {syncCopy.trimAll}
          </button>
          <span className="sync-grow" />
          <label className="sync-check">
            <input type="checkbox" checked={meterOn} onChange={(e) => setMeterOn(e.target.checked)} />
            {syncCopy.metronome}
          </label>
          <label className="sync-check">
            <input type="checkbox" checked={loopOn} onChange={(e) => setLoopOn(e.target.checked)} />
            {syncCopy.loop}
          </label>
          <span className="sync-label">{syncCopy.step}</span>
          <select className="sync-select" value={stepMs} onChange={(e) => setStepMs(Number(e.target.value))}>
            {STEPS.map((s) => (
              <option key={s} value={s}>
                {s}ms
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setZoom(zoom === 'all' ? '30' : 'all')}>
            {zoom === 'all' ? syncCopy.zoomAll : syncCopy.zoom30}
          </button>
        </div>

        {pending && (
          <div className="sync-row sync-tap">
            <span className="sync-label">{syncCopy.tapTitle}</span>
            <input className="sync-num" type="number" min={1} value={bar} onChange={(e) => setBar(Number(e.target.value) || 1)} />
            <span className="sync-dim">{syncCopy.barLabel}</span>
            <input className="sync-num" type="number" min={1} value={beat} onChange={(e) => setBeat(Number(e.target.value) || 1)} />
            <span className="sync-dim">{syncCopy.beatLabel}</span>
            <span className="sync-dim">
              {fmtSec(pending.audioMs)} → {bar}:{beat}
            </span>
            <button type="button" className="btn" onClick={confirmTap}>
              {syncCopy.tapConfirm}
            </button>
            <button type="button" className="btn" onClick={() => setPending(null)}>
              {syncCopy.tapCancel}
            </button>
          </div>
        )}

        <div className="sync-body">
          <div className="sync-anchors">
            <div className="sync-anchors-head">
              {syncCopy.anchors}（{doc.anchors.length}）
            </div>
            {doc.anchors.length === 0 && <div className="sync-dim sync-pad">{syncCopy.noAnchors}</div>}
            {doc.anchors.map((a: SyncAnchor, i: number) => (
              <div
                key={`${a.beat}-${i}`}
                className={`sync-anchor${i === sel ? ' is-on' : ''}`}
                onClick={() => setSel(i)}
              >
                <span className="sync-anchor-idx">{i + 1}</span>
                <span className="sync-anchor-pos">
                  {barBeatLabel(a.beat)} · {fmtSec(a.audioMs)}
                </span>
                <button
                  type="button"
                  className="btn sync-mini"
                  onClick={(e) => {
                    e.stopPropagation()
                    updateAnchor(i, { locked: !a.locked })
                  }}
                >
                  {a.locked ? '🔒' : syncCopy.lock}
                </button>
                <button
                  type="button"
                  className="btn sync-mini"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeAnchor(i)
                    setSel(0)
                  }}
                >
                  {syncCopy.remove}
                </button>
              </div>
            ))}
          </div>

          <div className="sync-fine">
            {selAnchor ? (
              <>
                <div className="sync-fine-head">
                  锚点 {sel + 1}：{barBeatLabel(selAnchor.beat)} · {fmtSec(selAnchor.audioMs)}
                  {selAnchor.locked && <span className="sync-dim">（已锁定）</span>}
                </div>
                <div className="sync-row sync-row-tight">
                  {[-10, -5, -1, 1, 5, 10].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="btn"
                      disabled={selAnchor.locked}
                      onClick={() => nudge(d)}
                    >
                      {d > 0 ? `+${d}` : d}ms
                    </button>
                  ))}
                </div>
                <div className="sync-row sync-row-tight">
                  <button type="button" className="btn" onClick={() => replayAround(selAnchor.audioMs)}>
                    {syncCopy.rewind}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={selAnchor.locked}
                    onClick={() => updateAnchor(sel, { locked: !selAnchor.locked })}
                  >
                    {selAnchor.locked ? syncCopy.unlock : syncCopy.lock}
                  </button>
                </div>
              </>
            ) : (
              <div className="sync-dim sync-pad">{syncCopy.selectAnchor}</div>
            )}

            <div className="sync-row sync-row-tight">
              <span className="sync-label">{syncCopy.mixSource}</span>
              <select
                className="sync-select"
                value={doc.mix.source}
                onChange={(e) => setMix({ source: e.target.value as 'file' | 'synth' | 'mix' })}
              >
                <option value="file">{syncCopy.mixFile}</option>
                <option value="mix">{syncCopy.mixBoth}</option>
                <option value="synth">{syncCopy.mixSynth}</option>
              </select>
              <span className="sync-label">{syncCopy.accompGain}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={doc.mix.accomp}
                onChange={(e) => setMix({ accomp: Number(e.target.value) })}
              />
              <span className="sync-label">{syncCopy.synthGain}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={doc.mix.synth}
                onChange={(e) => setMix({ synth: Number(e.target.value) })}
              />
            </div>

            <div className="sync-status">
              <span>
                {syncCopy.bpm} ♩={doc.tempo ? Math.round(doc.tempo.bpm) : '—'}（谱面 {Math.round(scoreBpm)}）
              </span>
              <span>
                {syncCopy.offset} {doc.tempo ? fmtSec(doc.tempo.offsetMs) : '—'}
              </span>
              <span>
                {syncCopy.residual} {doc.tempo ? `±${Math.round(worst * doc.tempo.beatMs)}ms` : '—'}
              </span>
              {doc.anchors.length === 1 && <span className="sync-dim">{syncCopy.anchorHint}</span>}
              {usable && (
                <button
                  type="button"
                  className="btn sync-mini"
                  onClick={() => {
                    clear()
                    closeModal()
                  }}
                >
                  {syncCopy.clear}
                </button>
              )}
            </div>
            {worst > 1 && <div className="sync-warn">{syncCopy.residualWarn}</div>}
            {notice !== '' && <div className="sync-dim">{notice}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
