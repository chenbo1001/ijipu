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
import {
  buildPlaySequence,
  fitSync,
  inferBpm,
  layoutScore,
  residualBeatsOf,
  sessionMsOfAudioMs,
  type DynamicPresetId,
  type SyncAnchor,
} from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useSyncStore } from '../store/syncStore'
import { useUiStore } from '../store/uiStore'
import { createDynamicSession, type DynamicSession } from '../export/video/renderer'
import { renderToAudioBuffer } from '../export/audio'
import { createHqCache, resolveHqBank } from '../playback/spessaCache'
import { resolveActiveLibrary } from '../playback/spessaSynthBackend'
import { hostBankUrl } from '../store/hostBridge'
import { decodeAccompaniment, waveformPeaks } from '../export/video/accompaniment'
import { parseSyncDoc, mixPlanOf, serializeSyncDoc, sidecarPathOf, syncDocStale } from '../export/video/syncDoc'
import { readSidecarText, writeSidecarText, downloadSidecarText } from '../export/video/syncIo'
import { canUseDynamicVideo } from '../export/video/capability'
import { syncCopy } from '../brand/copy'
// adj1122：波形下方时间标尺的刻度选择（纯函数）
import { timeLabelOf, timeScaleOf } from './syncRuler'
// adj1126：波形视野（缩放/平移；`spanMs = 0` = 整曲，默认）
import {
  VIEW_ALL,
  VIEW_PRESETS_MS,
  clampView,
  panView,
  scrollThumb,
  viewWindow,
  zoomView,
  type WaveView,
} from './syncRuler'
// adj1124：台面尺寸/分区高度/预览比例（可调整、存 L1）
import {
  PREVIEW_ZOOMS,
  loadSyncLayout,
  normalizeSyncLayout,
  resizePreviewH,
  resizeSyncLayout,
  resizeWaveH,
  saveSyncLayout,
  type SyncLayout,
} from './syncLayout'

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
  const replaceDoc = useSyncStore((s) => s.replaceDoc)
  /** adj1128：保存要写同目录的 sidecar —— 只有桌面壳打开的 `.jps` 才有绝对路径 */
  const nativePath = useDocStore((s) => s.nativePath)

  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState(0)
  const [meterOn, setMeterOn] = useState(false)
  const [loopOn, setLoopOn] = useState(true)
  const [stepMs, setStepMs] = useState<number>(5)
  /**
   * adj1126（用户 2026-10-24：「波形也要能缩放，单位宽度上显示的波形时长，默认整曲」）：
   * 视野 = `{spanMs, startMs}`；**`spanMs = 0` 就是整曲**（默认）。
   * 滚轮缩放、拖动平移、`0` 回整曲；刻度/播放头/点击定位全部走同一个 `viewWindow` 口径。
   */
  const [view, setView] = useState<WaveView>(VIEW_ALL)
  const [decodeState, setDecodeState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [pending, setPending] = useState<{ audioMs: number } | null>(null)
  const [bar, setBar] = useState(1)
  const [beat, setBeat] = useState(1)
  const [notice, setNotice] = useState('')
  /**
   * adj1124（用户 2026-10-24）：**台面尺寸/分区高度/预览比例**可调，并记住（L1）。
   * 拖的过程中只改 state（不写盘），松手/离散操作才 `saveSyncLayout`。
   */
  const [layout, setLayout] = useState<SyncLayout>(() =>
    loadSyncLayout(typeof window === 'undefined' ? 1440 : window.innerWidth, typeof window === 'undefined' ? 900 : window.innerHeight),
  )
  const viewportRef = useRef({ w: 1440, h: 900 })
  /** 拖拽用的临时状态（pointerdown 时记起点，move 时算 delta） */
  const dragRef = useRef<{ kind: 'panel' | 'preview' | 'wave'; x: number; y: number; base: SyncLayout } | null>(null)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** adj1123：波形上方的**动态谱预览**（按谱面 J: 建一次，对拍只按比例缩放） */
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const previewSessionRef = useRef<DynamicSession | null>(null)
  const previewInfoRef = useRef<HTMLSpanElement | null>(null)
  const [previewState, setPreviewState] = useState<'building' | 'ready' | 'error'>('building')
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

  /** 打开台面：恢复同名谱的副本（没有就新建空 doc） */
  useEffect(() => {
    ensureFor(fileName, code)
  }, [ensureFor, fileName, code])

  /**
   * adj1128：打开台面时**先读同目录的 sidecar**（比 L1 兜底权威）。
   * 只在"本地还没有锚点"时采用磁盘内容，免得覆盖用户刚打的点。
   */
  useEffect(() => {
    if (!nativePath) return
    let cancelled = false
    void (async () => {
      const r = await readSidecarText(sidecarPathOf(nativePath))
      if (cancelled || !r.ok || r.text === null) return
      const parsed = parseSyncDoc(r.text)
      if (parsed.doc === null) return
      const cur = useSyncStore.getState().doc
      if (cur !== null && cur.anchors.length > 0) return
      replaceDoc(parsed.doc)
    })()
    return () => {
      cancelled = true
    }
  }, [nativePath, replaceDoc])

  /** adj1128（用户实报「保存没有实现」）：真的写 sidecar；网页/开发模式退回本机缓存并如实说明 */
  const onSave = useCallback(async () => {
    if (doc === null) return
    save(code, fileName)
    const latest = useSyncStore.getState().doc
    if (latest === null) return
    const text = serializeSyncDoc(latest)
    if (!nativePath) {
      // adj1129：网页/开发模式没有同目录写入 ⇒ 下载一份真文件（别只写本机缓存）
      // `fileName` 可能已经被去掉了 `.jps`（网页/示例稿），这里补回来，文件名才对得上
      const base = fileName === '' ? '未命名.jps' : /\.jps$/i.test(fileName) ? fileName : `${fileName}.jps`
      const name = sidecarPathOf(base).split(/[\\/]/).pop() ?? '未命名.jps.sync.json'
      downloadSidecarText(name, text)
      setNotice(syncCopy.savedDownloaded(name))
      return
    }
    const target = sidecarPathOf(nativePath)
    const res = await writeSidecarText(target, text)
    const name = target.split(/[\\/]/).pop() ?? target
    setNotice(res.ok ? syncCopy.savedFile(name) : syncCopy.saveFailed(res.error))
  }, [code, doc, fileName, nativePath, save])

  // ---------- adj1124：台面尺寸（可拖右下角 / 最大化 / 记 L1） ----------
  /** 记住上一次渲染出来的 layout（拖拽松手时要在监听里读它，而监听只挂一次） */
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
    // 拖动过程中不写盘（每帧写一次 localStorage 会卡），松手才写
    if (dragRef.current === null) saveSyncLayout(layout)
  }, [layout])

  /** 视口大小变了：重新夹紧（比如把窗口拖小了，台面不能比视口还大） */
  useEffect(() => {
    const sync = () => {
      viewportRef.current = { w: window.innerWidth, h: window.innerHeight }
      setLayout((l) => normalizeSyncLayout(l, window.innerWidth, window.innerHeight))
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  /**
   * 三处拖拽统一在 window 上收 move/up（指针可能在拖动中离开那个 6px 的分隔条）：
   *  - `panel`：右下角 ⇒ 同时改宽高；
   *  - `preview`：预览与波形之间 ⇒ 只改预览高度（下面的区域自然让位）；
   *  - `wave`：波形与参数行之间 ⇒ 只改波形高度。
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const { w, h } = viewportRef.current
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      setLayout(
        d.kind === 'panel'
          ? resizeSyncLayout(d.base, dx, dy, w, h)
          : d.kind === 'preview'
            ? resizePreviewH(d.base, dy, h, w)
            : resizeWaveH(d.base, dy, h, w),
      )
    }
    const onUp = () => {
      if (dragRef.current === null) return
      dragRef.current = null
      saveSyncLayout(layoutRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const startDrag = (kind: 'panel' | 'preview' | 'wave') => (e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { kind, x: e.clientX, y: e.clientY, base: layoutRef.current }
  }

  /**
   * adj1123（用户 2026-10-24：「波形上面还应放谱的预览图，锚定位后播放时同步显示动态谱」）：
   * 在台面里建一个**放映会话**，播放时按伴奏走。
   *
   * 为什么按**谱面 `J:`** 建、而不是按对拍拍速建：微调每按一次 ±5ms 拍速都会变，
   * 按拍速建就要重建会话（几百毫秒/次，手感全毁）。这两个时间轴只差一个**比例**
   * （`sessionMsOfAudioMs`：拍数不变、只换秒数），所以建一次、按比例缩放即可。
   * 片头/片尾卡不要（`leadInMs: 0, endCardMs: 0`）——对拍只看谱面那一帧。
   */
  useEffect(() => {
    let cancelled = false
    setPreviewState('building')
    void createDynamicSession(code, '16x9' as DynamicPresetId, pageConfig, undefined, {
      leadInMs: 0,
      endCardMs: 0,
    })
      .then((s) => {
        if (cancelled) return
        previewSessionRef.current = s
        setPreviewState('ready')
        // 会话好了立刻画一帧（此时可能还停在 0）
        drawRef.current()
      })
      .catch(() => {
        if (!cancelled) setPreviewState('error')
      })
    return () => {
      cancelled = true
      previewSessionRef.current = null
    }
  }, [code, pageConfig])

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
  /** adj1126：波形当前视野（整曲 or 缩放后的窗口），刻度与读数都用它 */
  const viewWin = viewWindow(view, durMs)
  /** adj1127：横向滚动条的滑块位置/宽度（整曲时 `visible=false`） */
  const thumb = scrollThumb(view, durMs)

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

  /**
   * 画一帧**动态谱预览**：音频时刻 → 会话时刻（按拍速比例换算），顺带更新"当前位置"读数。
   * 没对拍（`effFit` 为空）时按"谱面从音频 0 开始"的假设走，至少能看谱。
   */
  const paintPreview = useCallback(
    (audioMs: number) => {
      const s = previewSessionRef.current
      const c = previewRef.current
      if (!s || !c) return
      if (c.width !== s.width || c.height !== s.height) {
        c.width = s.width
        c.height = s.height
      }
      const ctx = c.getContext('2d')
      if (!ctx) return
      const fitForPreview = effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 }
      const t = Math.max(0, Math.min(s.totalMs - 1, sessionMsOfAudioMs(audioMs, fitForPreview, scoreBeatMs)))
      /**
       * adj1127（用户 2026-10-24：「预览的显示比率不是 9:16 为类的比率，是**缩放比率**」）：
       * 画布固定 16:9（与成片同一套相机），这里只是把渲染结果**以中心为原点整体缩放**看细节。
       * 先无条件清一遍整块画布：`s.draw` 内部那次 `clearRect` 会被缩放变换带着走，
       * 缩小时清不干净（会留上一帧的边）。
       */
      const zoom = Math.min(3, Math.max(0.5, layout.previewZoom))
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      if (Math.abs(zoom - 1) > 1e-6) {
        ctx.setTransform(zoom, 0, 0, zoom, (c.width * (1 - zoom)) / 2, (c.height * (1 - zoom)) / 2)
      }
      s.draw(ctx, t)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (previewInfoRef.current) {
        const beat = t / scoreBeatMs
        previewInfoRef.current.textContent = `${syncCopy.previewNow} ${barBeatLabel(beat)}（第 ${Math.floor(beat) + 1} 拍）${
          Math.abs(zoom - 1) > 1e-6 ? ` · ${zoom}×` : ''
        }`
      }
    },
    [barBeatLabel, effFit, scoreBeatMs, layout.previewZoom],
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

  /** 正在播放的所有音源（adj1128 起可能同时有"伴奏 + 合成音"两条） */
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  /** 已经排进 AudioContext 的"嗒"——关掉节拍器时必须把它们全停掉（否则听起来"关不掉"） */
  const clicksRef = useRef<OscillatorNode[]>([])
  /** 节拍器已经排到哪一刻（音频 ms） */
  const schedRef = useRef(0)

  const clearClicks = useCallback(() => {
    for (const o of clicksRef.current) {
      try {
        o.stop()
        o.disconnect()
      } catch {
        /* 已经停了 */
      }
    }
    clicksRef.current = []
    schedRef.current = 0
  }, [])

  /**
   * adj1128：`meterOn` 要放 ref 里读——`tick` 是启动播放那一刻的闭包，
   * 直接读 state 会**永远读到 true**（关掉开关后还在排"嗒"）。这是"关不掉"的第二个根因。
   */
  const meterRef = useRef(meterOn)
  const loopRefOn = useRef(loopOn)
  useEffect(() => {
    meterRef.current = meterOn
    loopRefOn.current = loopOn
  }, [meterOn, loopOn])

  const stopSource = useCallback(() => {
    for (const s of sourcesRef.current) {
      try {
        s.stop()
      } catch {
        /* 已自然结束 */
      }
      s.disconnect()
    }
    sourcesRef.current = []
    srcRef.current = null
    clearClicks()
    cancelAnimationFrame(rafRef.current)
    playingRef.current = false
    setPlaying(false)
  }, [clearClicks])

  /**
   * 节拍器（adj1128 修"关不掉"）：**只排未来 4 秒**，`tick` 每帧续排。
   *
   * 第一版是一次把整段（甚至整个循环窗口）都排出去 —— 点关掉开关时那些已经排进
   * `AudioContext` 的振荡器照样会响，看起来就是"关不掉"。现在：
   *  · 只排窗口内 4 秒，关掉时 `clearClicks()` 立刻全停；
   *  · 点击时刻**就是拍点**（`offsetMs + k × beatMs`），不再额外加 20ms 延迟（那会让"嗒"总是晚一点）。
   */
  const scheduleClicksUntil = useCallback(
    (untilMs: number) => {
      if (!meterRef.current) return
      const ctx = ctxRef.current
      if (!ctx) return
      /**
       * 拍点 = **谱面拍点**。还没对拍（0/1 条锚点）时没有 `effFit`，
       * 按"谱面从音频 0 开始、速度用谱面 J:"先响着 —— 这样"没对拍也能听拍子"，
       * 对拍之后再跟着锚点走（不再是"点了没反应"）。
       */
      const clock = effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 }
      const from = Math.max(schedRef.current, playheadRef.current - 40, 0)
      if (untilMs <= from) return
      const beatMs = clock.beatMs
      const k0 = Math.ceil((from - clock.offsetMs) / beatMs - 1e-9)
      let n = 0
      for (let k = k0; n < 400; k++) {
        const at = clock.offsetMs + k * beatMs
        if (at > untilMs) break
        if (at >= from) {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.frequency.value = 1000
          gain.gain.value = 0.22
          osc.connect(gain)
          gain.connect(ctx.destination)
          const when = ctx.currentTime + Math.max(0, (at - from) / 1000)
          osc.start(when)
          osc.stop(when + 0.04)
          clicksRef.current.push(osc)
        }
        n++
      }
      schedRef.current = Math.max(from, untilMs)
    },
    [effFit, scoreBeatMs],
  )

  /**
   * adj1128（用户 2026-10-24 实报「声音选合成音还是伴奏、音量也没用」）：
   * 台面里的试听改为**按混音设置真的播**——
   *  - `file`：只播伴奏（音量 = 伴奏音量）；
   *  - `synth`：只播合成音（按谱面 `J:` 渲染，按拍速比例变速对齐）；
   *  - `mix`：两条一起播，各自音量。
   *
   * 合成音要现渲染（SpessaSynth 离线渲一遍），所以懒加载 + 缓存；渲染期间显示提示。
   */
  const synthBufRef = useRef<{ key: string; buf: AudioBuffer } | null>(null)
  const [synthState, setSynthState] = useState<'idle' | 'loading' | 'error'>('idle')

  const ensureSynthBuffer = useCallback(async (): Promise<AudioBuffer | null> => {
    const s = previewSessionRef.current
    if (!s) return null
    const key = `${s.totalMs}|${s.bpm}|${code.length}`
    if (synthBufRef.current?.key === key) return synthBufRef.current.buf
    setSynthState('loading')
    try {
      const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
      const cache = createHqCache()
      const { bank } = await resolveHqBank(lib, cache, hostBankUrl(lib.id))
      const buf = await renderToAudioBuffer(s.events, bank, { bpm: s.bpm })
      synthBufRef.current = { key, buf }
      setSynthState('idle')
      return buf
    } catch {
      setSynthState('error')
      return null
    }
  }, [code.length])

  const startPlayback = useCallback(
    async (fromMs: number, loop?: { startMs: number; endMs: number }) => {
      if (!audio) {
        setNotice(syncCopy.noAudio)
        return
      }
      stopSource()
      const ctx = ensureCtx()
      await ctx.resume()
      const from = Math.max(0, Math.min(fromMs, trim.endMs - 1))
      const mix = useSyncStore.getState().doc?.mix ?? { source: 'file' as const, accomp: 1, synth: 0.5 }
      const plan = mixPlanOf(mix)
      const sources: AudioBufferSourceNode[] = []
      /**
       * adj1129（用户 2026-10-24：「添加终点后应在最后一拍里音量渐小至无声，以免停得太突兀」）：
       * 台面试听也在**结束前最后一拍**把音量线性压到 0（与出片音轨同一口径）。
       */
      const beatMsNow = effFit?.beatMs ?? scoreBeatMs
      const endMs = loop ? loop.endMs : trim.endMs
      const fadeStartMs = Math.max(from, endMs - beatMsNow)
      const canFade = endMs - fadeStartMs > 20
      const applyFade = (gain: GainNode, base: number) => {
        if (!canFade || base <= 0) return
        const t0 = ctx.currentTime + (fadeStartMs - from) / 1000
        const t1 = ctx.currentTime + (endMs - from) / 1000
        gain.gain.setValueAtTime(base, t0)
        gain.gain.linearRampToValueAtTime(0, t1)
      }
      // ① 伴奏（按设定的伴奏音量）
      if (plan.playAcc) {
        const src = ctx.createBufferSource()
        src.buffer = audio
        const gain = ctx.createGain()
        gain.gain.value = mix.accomp
        applyFade(gain, mix.accomp)
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(0, from / 1000)
        sources.push(src)
      }
      // ② 合成音（按设定的合成音量；按拍速比例变速，才能跟伴奏同进）
      if (plan.playSynth) {
        const sb = await ensureSynthBuffer()
        if (sb) {
          const fitForPreview = effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 }
          const scoreStartSec = Math.max(0, sessionMsOfAudioMs(from, fitForPreview, scoreBeatMs)) / 1000
          const src = ctx.createBufferSource()
          src.buffer = sb
          src.playbackRate.value = scoreBeatMs / fitForPreview.beatMs
          const gain = ctx.createGain()
          gain.gain.value = mix.synth
          applyFade(gain, mix.synth)
          src.connect(gain)
          gain.connect(ctx.destination)
          src.start(0, Math.min(scoreStartSec, Math.max(0, sb.duration - 0.01)))
          sources.push(src)
        }
      }
      if (sources.length === 0) {
        setNotice(syncCopy.synthFailed)
        return
      }
      sourcesRef.current = sources
      srcRef.current = sources[0] ?? null
      startRef.current = { at: ctx.currentTime, from }
      loopRef.current = loop ?? null
      playheadRef.current = from
      playingRef.current = true
      setPlaying(true)
      schedRef.current = from
      if (meterRef.current) scheduleClicksUntil(from + 4000)
      const tick = () => {
        if (!playingRef.current) return
        const t = currentMs()
        playheadRef.current = Math.min(t, trim.endMs)
        if (meterRef.current) scheduleClicksUntil(Math.min(trim.endMs, t + 4000))
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
    [audio, currentMs, ensureCtx, effFit, ensureSynthBuffer, meterOn, scheduleClicksUntil, scoreBeatMs, stopSource, trim.endMs],
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
    // adj1124：波形高度由「拖分隔条」控制（`layout.waveH`）；标尺高度固定
    const WAVE_H = layout.waveH
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

    // 视野：整曲（默认）或缩放后的窗口——刻度、播放头、点击定位都走这一个口径
    const { v0, winMs } = viewWindow(view, durMs)
    // 缩放状态下播放：播放头跑出视野就重新居中（暂停时不动，免得抢用户的平移）
    if (view.spanMs > 0 && playingRef.current) {
      const t = playheadRef.current
      if (t < v0 || t > v0 + winMs) {
        const start = Math.max(0, Math.min(durMs - view.spanMs, t - view.spanMs / 2))
        setView(clampView({ spanMs: view.spanMs, startMs: start }, durMs))
      }
    }
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

    // 动态谱预览与波形共用同一个播放头（adj1123）
    paintPreview(playheadRef.current)
  }, [audio, doc, durMs, effFit, barStartBeats, paintPreview, pending, sel, trim.endMs, trim.startMs, view, layout.waveH])

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
    /**
     * adj1130（用户 2026-10-24 问「第 1 小节第 1 拍写 1:1 还是 1:0」）：
     * 谱位是 **1 起**（与标记段、`--from 27:3` 同一套口径）⇒ 第 1 小节第 1 拍 = `1:1`。
     * 写 0 会算到**上一小节的最后一拍**去（错得还很像样），所以这里直接挡住并说清怎么写。
     */
    if (!Number.isFinite(bar) || !Number.isFinite(beat) || bar < 1 || beat < 1) {
      setNotice(syncCopy.beatPosInvalid)
      return
    }
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

  /** 把屏幕上某一点换成音频时刻（视野的唯一映射，点击与拖动都用它） */
  const msOfClientX = useCallback(
    (clientX: number): number => {
      const c = canvasRef.current
      if (!c) return 0
      const rect = c.getBoundingClientRect()
      const { v0, winMs } = viewWindow(view, durMs)
      const x = Math.min(Math.max(0, clientX - rect.left), Math.max(1, rect.width))
      return v0 + (x / Math.max(1, rect.width)) * winMs
    },
    [durMs, view],
  )

  /** 点击波形：定位播放头（并停声）；按住 Shift 点到的地方直接试听 */
  const seekTo = useCallback(
    (ms: number, shiftKey: boolean) => {
      stopSource()
      playheadRef.current = Math.max(0, Math.min(ms, durMs))
      drawRef.current()
      if (shiftKey) void startPlayback(playheadRef.current)
    },
    [durMs, startPlayback, stopSource],
  )

  /**
   * adj1126：拖动平移 + 点击定位（同一个指针手势里区分）——
   * 位移 < 4px 当作点击（定位播放头），超过就当作平移（视野左缘动，播放头不动）。
   */
  const panRef = useRef<{ x: number; moved: boolean; winMs: number; width: number } | null>(null)

  const onWavePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { winMs } = viewWindow(view, durMs)
    panRef.current = { x: e.clientX, moved: false, winMs, width: Math.max(1, rect.width) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onWavePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = panRef.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 4) return
    d.moved = true
    if (view.spanMs === 0) return
    // 往右拖 = 看更早的地方（视野左缘左移）
    setView((v) => panView(v, durMs, (-dx * d.winMs) / d.width))
  }

  const onWavePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = panRef.current
    panRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已经不在了 */
    }
    if (!d || !d.moved) seekTo(msOfClientX(e.clientX), e.shiftKey)
  }

  /**
   * 滚轮缩放：**保持鼠标那一处的时刻在屏幕上不动**。
   * 用原生监听（React 的 wheel 是被动事件，`preventDefault` 无效，页面会跟着一起滚）。
   */
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const x = Math.min(Math.max(0, e.clientX - rect.left), Math.max(1, rect.width))
      setView((v) => {
        const { v0, winMs } = viewWindow(v, durMs)
        const anchor = v0 + (x / Math.max(1, rect.width)) * winMs
        return zoomView(v, durMs, e.deltaY > 0 ? 1.25 : 0.8, anchor)
      })
    }
    c.addEventListener('wheel', onWheelNative, { passive: false })
    return () => c.removeEventListener('wheel', onWheelNative)
  }, [durMs])

  /** 以播放头为中心缩放（键盘 `+` / `-` 用） */
  const zoomAtPlayhead = useCallback(
    (factor: number) => {
      setView((v) => zoomView(v, durMs, factor, playheadRef.current))
    },
    [durMs],
  )

  /**
   * adj1127（用户 2026-10-24「波形放大后要一个横向滚动条」）：
   * 滑块拖动 = 平移视野；点轨道空白 = 把视野中心挪到那里。
   */
  const scrollDragRef = useRef<{ x: number; baseStart: number; width: number } | null>(null)

  const onScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const thumb = scrollThumb(view, durMs)
    const x = e.clientX - rect.left
    const leftPx = (thumb.leftPct / 100) * rect.width
    const rightPx = leftPx + (thumb.widthPct / 100) * rect.width
    if (x < leftPx || x > rightPx) {
      const centerMs = (Math.min(Math.max(0, x), rect.width) / Math.max(1, rect.width)) * durMs
      const span = view.spanMs > 0 ? view.spanMs : durMs
      setView(clampView({ spanMs: span, startMs: centerMs - span / 2 }, durMs))
      return
    }
    scrollDragRef.current = { x: e.clientX, baseStart: viewWin.v0, width: Math.max(1, rect.width) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onScrollPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = scrollDragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    setView((v) => clampView({ spanMs: v.spanMs, startMs: d.baseStart + (dx / d.width) * durMs }, durMs))
  }

  const onScrollPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrollDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已经不在了 */
    }
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
      // adj1126：`+/-` 缩放（以播放头为中心），`0` 回整曲
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomAtPlayhead(0.8)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomAtPlayhead(1.25)
        return
      }
      if (e.key === '0') {
        setView(VIEW_ALL)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 1 : stepMs
        nudge(e.key === 'ArrowLeft' ? -step : step)
      }
    },
    [closeModal, nudge, pending, startPlayback, stepMs, stopSource, zoomAtPlayhead],
  )

  useEffect(() => {
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [keyboard])

  /** adj1128：关掉节拍器立刻静音（只排了未来 4 秒，但已排的那几秒也要停） */
  useEffect(() => {
    if (!meterOn) clearClicks()
  }, [meterOn, clearClicks])

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
      {/* adj1124：面板宽高可拖、可最大化；拖右下角那个斜纹把手（`.sync-resize`） */}
      <div
        className="sync-panel"
        style={layout.maximized ? { width: '100%', height: '100%' } : { width: `${layout.w}px`, height: `${layout.h}px` }}
      >
        <div
          className="sync-head"
          onDoubleClick={(e) => {
            // adj1129：双击标题条才最大化——**点在按钮/输入上不算**（用户实报"双击保存变成最大化"）
            if ((e.target as HTMLElement).closest('button, input, select')) return
            setLayout({ ...layoutRef.current, maximized: !layoutRef.current.maximized })
          }}
        >
          <b>
            {syncCopy.title}：{fileName}
          </b>
          <span ref={metaRef} className="sync-meta" />
          <span className="sync-grow" />
          {stale && <span className="sync-warn">{syncCopy.stale}</span>}
          <button
            type="button"
            className="btn"
            onClick={() => setLayout({ ...layoutRef.current, maximized: !layoutRef.current.maximized })}
            title={syncCopy.maximizeHint}
          >
            {layout.maximized ? syncCopy.restore : syncCopy.maximize}
          </button>
          <button
            type="button"
            className="btn"
            data-sync="save"
            onClick={() => void onSave()}
            title={syncCopy.saveHint}
          >
            {syncCopy.save}
          </button>
          <button type="button" className="btn" onClick={() => closeModal()} title={syncCopy.closeHint}>
            {syncCopy.close}
          </button>
        </div>

        {/* adj1123/adj1124：波形**上方**的动态谱预览；高度可拖（分隔条），比例可切（16:9 / 9:16 / 1:1） */}
        <div className="sync-preview" style={{ height: `${layout.previewH}px` }}>
          <div className="sync-preview-box">
            <canvas ref={previewRef} />
            {previewState !== 'ready' && (
              <span className="sync-preview-tip">
                {previewState === 'building' ? syncCopy.previewBuilding : syncCopy.previewFailed}
              </span>
            )}
          </div>
          <div className="sync-preview-side">
            <div className="sync-preview-pos">
              <span ref={previewInfoRef}>{syncCopy.previewNow}</span>
            </div>
            <label className="sync-row">
              <span className="sync-label">{syncCopy.previewZoom}</span>
              <select
                className="sync-select"
                data-sync="preview-zoom"
                value={layout.previewZoom}
                onChange={(e) =>
                  setLayout(
                    normalizeSyncLayout(
                      { ...layoutRef.current, previewZoom: Number(e.target.value) },
                      viewportRef.current.w,
                      viewportRef.current.h,
                    ),
                  )
                }
              >
                {PREVIEW_ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z}×
                  </option>
                ))}
              </select>
            </label>
            <div className="sync-dim">{syncCopy.previewHint}</div>
          </div>
        </div>
        {/* 预览 ↔ 下方：往上拖 = 预览变高（下面整体跟着平移） */}
        <div className="sync-split" onPointerDown={startDrag('preview')} title={syncCopy.splitPreviewHint} />

        <div ref={wrapRef} className="sync-wave">
          <canvas
            ref={canvasRef}
            onPointerDown={onWavePointerDown}
            onPointerMove={onWavePointerMove}
            onPointerUp={onWavePointerUp}
            onPointerCancel={() => {
              panRef.current = null
            }}
          />
          <div className="sync-wave-hint">{syncCopy.tipPick}</div>
        </div>

        {/* adj1127：放大后给一条横向滚动条（整曲时它没有意义，隐藏） */}
        {thumb.visible && (
          <div
            className="sync-scroll"
            onPointerDown={onScrollPointerDown}
            onPointerMove={onScrollPointerMove}
            onPointerUp={onScrollPointerUp}
            onPointerCancel={onScrollPointerUp}
            title={syncCopy.scrollHint}
          >
            <div className="sync-scroll-thumb" style={{ left: `${thumb.leftPct}%`, width: `${thumb.widthPct}%` }} />
          </div>
        )}
        {/* 波形 ↔ 参数行：往上拖 = 波形变高 */}
        <div className="sync-split" onPointerDown={startDrag('wave')} title={syncCopy.splitWaveHint} />
        {/* 第一排（紧贴波形下沿）：伴奏 + 播放 + 打点 + 视野 —— 用户 2026-10-24 要求
            「这些按钮放到波形下面、跟下面的按钮整合，节省上面的空间」 */}
        <div className="sync-row sync-audio-row">
          <div className="sync-audio-left">
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
          </div>
          {/* adj1129（用户 2026-10-24）：播放 / T打点 **在这一行居中** */}
          <div className="sync-audio-mid">
            <button type="button" className="btn" onClick={() => (playing ? stopSource() : void startPlayback(playheadRef.current))} disabled={!audio}>
              {playing ? syncCopy.pause : syncCopy.play}
            </button>
            <button type="button" className="btn" onClick={tap} disabled={!audio}>
              {syncCopy.tap}
            </button>
          </div>
          {/* adj1126：视野（单位宽度显示的时长）；滚轮也能缩放，`0` 回整曲 */}
          <div className="sync-audio-right">
          <span className="sync-label">{syncCopy.viewSpan}</span>
          <select
            className="sync-select"
            data-sync="view"
            value={view.spanMs === 0 ? 0 : view.spanMs}
            onChange={(e) => {
              const spanMs = Number(e.target.value)
              setView(
                spanMs === 0
                  ? VIEW_ALL
                  : clampView({ spanMs, startMs: Math.max(0, playheadRef.current - spanMs / 2) }, durMs),
              )
            }}
            title={syncCopy.viewHint}
          >
            {VIEW_PRESETS_MS.map((ms) => (
              <option key={ms} value={ms}>
                {ms === 0
                  ? syncCopy.viewAll
                  : ms >= 60000
                    ? syncCopy.viewMinutes(ms / 60000)
                    : syncCopy.viewSeconds(ms / 1000)}
              </option>
            ))}
            {view.spanMs > 0 && !VIEW_PRESETS_MS.includes(view.spanMs as (typeof VIEW_PRESETS_MS)[number]) && (
              <option value={view.spanMs}>{syncCopy.viewSeconds(Math.round(view.spanMs / 100) / 10)}</option>
            )}
          </select>
          <span className="sync-name sync-dim sync-view-readout">
            {fmtSec(viewWin.v0)} – {fmtSec(viewWin.v0 + viewWin.winMs)}
          </span>
          </div>
        </div>

        {/* 第二排：保留段 + 节拍器/循环/步长（都在波形正下方，用户口径「与音频相关的放波形条上下」） */}
        <div className="sync-row sync-row-tight">
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
          <label className="sync-check" title={syncCopy.metronomeHint}>
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
          <span className="sync-grow" />
        </div>

        {/* adj1124（用户口径「与音频相关的放波形条上下」）：对拍读数 + 混音都紧贴波形，不再散到右下角 */}
        <div className="sync-row sync-row-tight">
          <span className="sync-name">
            {syncCopy.bpm} ♩={doc.tempo ? Math.round(doc.tempo.bpm) : '—'}（谱面 {Math.round(scoreBpm)}）
          </span>
          <span className="sync-name">
            {syncCopy.offset} {doc.tempo ? fmtSec(doc.tempo.offsetMs) : '—'}
          </span>
          <span className="sync-name">
            {syncCopy.residual} {doc.tempo ? `±${Math.round(worst * doc.tempo.beatMs)}ms` : '—'}
          </span>
          {worst > 1 && <span className="sync-warn">{syncCopy.residualWarn}</span>}
          <span className="sync-grow" />
          <span className="sync-label">{syncCopy.mixSource}</span>
          <select
            className="sync-select"
            data-sync="mix-source"
            value={doc.mix.source}
            onChange={(e) => setMix({ source: e.target.value as 'file' | 'synth' | 'mix' })}
          >
            <option value="file">{syncCopy.mixFile}</option>
            <option value="mix">{syncCopy.mixBoth}</option>
            <option value="synth">{syncCopy.mixSynth}</option>
          </select>
          {/* adj1128：选合成音时要现渲染（第一次慢），如实显示状态 */}
          {synthState === 'loading' && <span className="sync-dim">{syncCopy.synthLoading}</span>}
          {synthState === 'error' && <span className="sync-warn">{syncCopy.synthFailed}</span>}
          <span className="sync-label">{syncCopy.accompGainShort}</span>
          <input
            className="sync-mix-range"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={doc.mix.accomp}
            onChange={(e) => setMix({ accomp: Number(e.target.value) })}
          />
          <span className="sync-label">{syncCopy.synthGainShort}</span>
          <input
            className="sync-mix-range"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={doc.mix.synth}
            onChange={(e) => setMix({ synth: Number(e.target.value) })}
          />
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
            {/* adj1130：把"1 起"写在这儿，省得猜 1:0 还是 1:1 */}
            <span className="sync-dim">{syncCopy.beatPosHint}</span>
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

            {/* 混音已挪到波形下面（adj1124）；这里只留"清空"与提示 */}
            <div className="sync-status">
              {doc.anchors.length === 1 && <span className="sync-dim">{syncCopy.anchorHint}</span>}
              {notice !== '' && <span className="sync-dim">{notice}</span>}
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
          </div>
        </div>
        {/* adj1124：右下角拖拽把手（改面板宽高；松手才写 L1） */}
        {!layout.maximized && (
          <div className="sync-resize" onPointerDown={startDrag('panel')} title={syncCopy.resizeHint} />
        )}
      </div>
    </div>
  )
}
