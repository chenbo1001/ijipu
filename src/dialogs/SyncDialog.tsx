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
  pitchToMidiNote,
  layoutScore,
  residualBeatsOf,
  sessionMsOfAudioMs,
  type SyncAnchor,
} from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useSyncStore } from '../store/syncStore'
import { useUiStore } from '../store/uiStore'
// adj1133：预览直接用应用自己的预览（排版/渲染/高亮/缩放/滚动都不再自己造）
import { PreviewPane } from '../preview/PreviewPane'
import { renderToAudioBuffer } from '../export/audio'
import { createHqCache, resolveHqBank } from '../playback/spessaCache'
import { resolveActiveLibrary } from '../playback/spessaSynthBackend'
import { hostBankUrl } from '../store/hostBridge'
import { decodeAccompaniment, waveformPeaks } from '../export/video/accompaniment'
import { mixPlanOf, serializeSyncDoc, sidecarPathOf, syncDocStale, codeFingerprint, playStartMsOf, effectiveSyncFitOf, audioRefOf } from '../export/video/syncDoc'
import { writeSidecarText, downloadSidecarText, pickAudioFileNative, readSidecarAudio } from '../export/video/syncIo'
// adj1150：sidecar 定位/读取抽到 store 层，相机位与对拍台共用同一套路径规则
import { loadSidecarDocAt, loadSidecarAudioFor, resolveSidecarPath } from '../store/syncSidecar'
// adj1155：sidecar 里的练习段/选中段/相机段也灌回 UI
import { applySyncExtrasToUi } from '../store/syncExtras'
// adj1137：波形上方那条"音符格子排"（纯几何）
import { barLabelsOf, cellRectPct, pitchHeightOf, stripCellsOf } from './noteStrip'
import { canUseDynamicVideo } from '../export/video/capability'
import { syncCopy } from '../brand/copy'
import { isTauriShell } from '../brand/env'
// adj1122：波形下方时间标尺的刻度选择（纯函数）
import { timeLabelOf, timeScaleOf } from './syncRuler'
// adj1126：波形视野（缩放/平移；`spanMs = 0` = 整曲，默认）
import {
  VIEW_ALL,
  VIEW_PRESETS_MS,
  audioClockOf,
  clampView,
  panView,
  scrollThumb,
  viewWindow,
  zoomView,
  type WaveView,
} from './syncRuler'
// adj1124：台面尺寸/分区高度（可调整、存 L1）
import {
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
/**
 * adj1170：节拍器"嗒"的软音色（用户实报「不好听、太抢耳」）。
 *
 * 旧版是 1000Hz 正弦 + 0.22 增益、方起方停 ⇒ 像提示音，且 HMR 时旧模块排出去的
 * 振荡器还会继续响几声。现在改成短衰减的三角波（660Hz → 440Hz、峰值 0.07），
 * 起音 2ms、45ms 内收干净；并把已排进 AudioContext 的节点登记到模块级集合，
 * HMR dispose 时统一停掉（见 `stopLiveClicks`）。
 */
const METRONOME_HZ = 660
const METRONOME_GAIN = 0.07
const METRONOME_MS = 45
/** adj1170：节拍器只预排 1.5 秒（旧 4 秒；HMR/改 CSS 时残余的"嗒"更少） */
const CLICK_LOOKAHEAD_MS = 1500
const liveClicks = new Set<OscillatorNode>()
function stopLiveClicks(): void {
  for (const o of liveClicks) {
    try {
      o.stop()
      o.disconnect()
    } catch {
      /* 已经自然结束 */
    }
  }
  liveClicks.clear()
}
if (import.meta.hot) import.meta.hot.dispose(stopLiveClicks)

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(3)}s`

/** 路径最后一段（显示用：绝对路径只露文件名） */
function baseNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i < 0 ? path : path.slice(i + 1)
}

/**
 * adj1157：把原生选中的伴奏路径写成 sidecar 里的 `audio`（实现收在 syncDoc，相机位共用）。
 */

export function SyncDialog() {
  const closeModal = useUiStore((s) => s.closeModal)
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)

  const doc = useSyncStore((s) => s.doc)
  const docAudio = doc?.audio ?? ''
  const audio = useSyncStore((s) => s.audio)
  const ensureFor = useSyncStore((s) => s.ensureFor)
  const setAudio = useSyncStore((s) => s.setAudio)
  const setAudioBuffer = useSyncStore((s) => s.setAudioBuffer)
  const addAnchor = useSyncStore((s) => s.addAnchor)
  const updateAnchor = useSyncStore((s) => s.updateAnchor)
  const removeAnchor = useSyncStore((s) => s.removeAnchor)
  const setTrim = useSyncStore((s) => s.setTrim)
  const setMix = useSyncStore((s) => s.setMix)
  const save = useSyncStore((s) => s.save)
  const clear = useSyncStore((s) => s.clear)
  const replaceDoc = useSyncStore((s) => s.replaceDoc)
  /** adj1133：预览直接用应用的预览 ⇒ 位置/色块走 docStore 的既有通道 */
  const setCurrentMs = useDocStore((s) => s.setCurrentMs)
  const setPlayheadTrack = useDocStore((s) => s.setPlayheadTrack)
  const setPlayheadBeat = useDocStore((s) => s.setPlayheadBeat)
  /** adj1133：缩放跟顶栏同一个偏好（`ijipu.previewZoom`），不再自己造一套 */
  const previewZoom = useUiStore((s) => s.previewZoom)
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom)
  /** adj1128：保存要写同目录的 sidecar —— 只有桌面壳打开的 `.jps` 才有绝对路径 */
  const nativePath = useDocStore((s) => s.nativePath)
  /** adj1131：从**工作区**打开的谱没有 `nativePath`（只有 `binding`）——保存也要能落到磁盘 */
  const binding = useDocStore((s) => s.binding)

  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState(0)
  const [meterOn, setMeterOn] = useState(false)
  const [loopOn, setLoopOn] = useState(true)
  const [stepMs, setStepMs] = useState<number>(5)  /**
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
  /** adj1143：格子条 + 波形的公共容器（滚轮缩放/平移挂在它上面，两排都能用） */
  const groupRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewInfoRef = useRef<HTMLSpanElement | null>(null)
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
    const d = useSyncStore.getState().doc
    if (d !== null) applySyncExtrasToUi(d)
  }, [ensureFor, fileName, code])

  /**
   * adj1128：打开台面时**先读同目录的 sidecar**（比 L1 兜底权威）。
   * 只在"本地还没有锚点"时采用磁盘内容，免得覆盖用户刚打的点。
   *
   * adj1150：路径定位/读取抽到 `store/syncSidecar.ts`——相机位"打开时自己找 sidecar"
   * 与这里共用同一套规则（`nativePath` 优先、工作区 `binding` 兜底）。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const parsed = await loadSidecarDocAt(await resolveSidecarPath(nativePath, binding))
      if (cancelled || parsed === null) return
      const cur = useSyncStore.getState().doc
      if (cur !== null && cur.anchors.length > 0) return
      replaceDoc(parsed)
      // adj1155：盘上的练习段/选中段/相机段也一起生效
      applySyncExtrasToUi(parsed)
    })()
    return () => {
      cancelled = true
    }
  }, [nativePath, binding, replaceDoc])

  /**
   * adj1157（用户 2026-10-25 实报「刷新后每次都找不到伴奏」）：打开台面时**自动读伴奏**。
   *
   * 相机位 adj1154 已有这一步，对拍台漏了 ⇒ 每次刷新都只能看到「找不到上次那条伴奏」。
   * 路径规则与相机位共用 `loadSidecarAudioFor`：`doc.audio` 是绝对路径就原样读，
   * 是相对名就拼 `.jps` 同目录；读不到保持手动入口（不弹错、不挡台面）。
   */
  useEffect(() => {
    if (docAudio === '' || audio !== null) return
    let cancelled = false
    void (async () => {
      setDecodeState('busy')
      try {
        const cur = useSyncStore.getState().doc
        if (cur === null) {
          setDecodeState('idle')
          return
        }
        const bytes = await loadSidecarAudioFor(nativePath, binding, cur)
        if (cancelled) return
        if (bytes === null) {
          setDecodeState('idle')
          return
        }
        const buf = await decodeAccompaniment(bytes)
        if (cancelled) return
        // 用 setAudioBuffer：只按新长度夹紧保留段终点，不重置用户的 trim/锚点
        setAudioBuffer(buf)
        setDecodeState('idle')
      } catch {
        if (!cancelled) {
          setDecodeState('error')
          setNotice(syncCopy.decodeFailed)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docAudio, nativePath, binding, audio, setAudioBuffer])

  /** adj1128（用户实报「保存没有实现」）：真的写 sidecar；实在没有磁盘路径就下载一份 */
  const onSave = useCallback(async () => {
    if (doc === null) return
    save(code, fileName)
    const latest = useSyncStore.getState().doc
    if (latest === null) return
    const text = serializeSyncDoc(latest)
    const target = await resolveSidecarPath(nativePath, binding)
    if (target === null) {
      // adj1156：桌面壳里不能"下载到 Downloads"就算完——那份谱是浏览器句柄打开的，
      // 壳拿不到目录；提示用户重新「打开/拖入」一次（拿到 nativePath 后就会写到同目录）。
      if (isTauriShell()) {
        setNotice(syncCopy.saveNoNativePath)
        return
      }
      // adj1129：网页/开发模式没有同目录写入 ⇒ 下载一份真文件（别只写本机缓存）
      // `fileName` 可能已经被去掉了 `.jps`（网页/示例稿），这里补回来，文件名才对得上
      const base = fileName === '' ? '未命名.jps' : /\.jps$/i.test(fileName) ? fileName : `${fileName}.jps`
      const name = sidecarPathOf(base).split(/[\\/]/).pop() ?? '未命名.jps.sync.json'
      downloadSidecarText(name, text)
      setNotice(syncCopy.savedDownloaded(name))
      return
    }
    const res = await writeSidecarText(target, text)
    const name = target.split(/[\\/]/).pop() ?? target
    setNotice(res.ok ? syncCopy.savedFile(name) : syncCopy.saveFailed(res.error))
  }, [binding, code, doc, fileName, nativePath, save])

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
   * adj1133（用户 2026-10-24：「预览能否就放应用的预览，缩放也参考应用的顶栏，别重复造轮子」）：
   * 预览直接用应用自己的 `PreviewPane`（同一份排版/渲染/缩放/滚动），这里只负责：
   *  · 按对拍结果把**播放位置**推到 `docStore.currentMs`（预览就会跟着高亮走）；
   *  · 建一次**色块轨道**（与试听同一套数据：`event.playheadSegs`）。
   *
   * 时间基准：色块轨道按**谱面 `J:`** 建（`beatMs = 500` = 120bpm 占位），
   * `currentMs` 用 `sessionMsOfAudioMs` 从音频时刻换算过来（拍数不变、只换秒数）。
   */
  /** 谱面拍速（`J:`）——轨道与游标换算都只用它，`adj1134` 起在下面两处共用同一个值 */
  const scoreBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const scoreBeatMs = 60000 / scoreBpm

  useEffect(() => {
    if (doc === null) return
    /**
     * ⚠ adj1142（用户 2026-10-24 实报「第 1 个格子点下去没色块、第 2 个格子却跳到第 3 个音符」）：
     * 轨道必须用**同一份序列 + 同一个拍速**（`scoreSeq` 就是按谱面 `J:` 建的）。
     * 之前这里另外按 120bpm 重建了一次，`e.atMs`（拍×500）与 `s.beat×scoreBeatMs` 混着用，
     * 轨道被压成 0.54 倍 ⇒ 色块整体往前窜。**别在这里再建第二条序列。**
     */
    const beatMs = scoreBeatMs
    setPlayheadTrack(
      scoreSeq.events.flatMap((e) =>
        (e.playheadSegs ?? []).map((s) => ({
          atMs: e.atMs + s.beat * beatMs,
          durationMs: s.beats * beatMs,
          pageIndex: s.pageIndex,
          x: s.x,
          y: s.y,
          width: s.width,
          voice: s.voice,
          group: s.group,
          ...(s.instrument !== undefined ? { instrument: s.instrument } : {}),
          ...(s.yTopMin !== undefined ? { yTopMin: s.yTopMin } : {}),
          ...(s.yBottomMax !== undefined ? { yBottomMax: s.yBottomMax } : {}),
          ...(s.playVoice !== undefined ? { playVoice: s.playVoice } : {}),
          ...(s.gain !== undefined ? { gain: s.gain } : {}),
          ...(s.interlude === true ? { interlude: true } : {}),
        })),
      ),
    )
    // 跳跳球的拍网格也用**同一套**时间（否则球和色块会各走各的）
    setPlayheadBeat(beatMs, 0, barStartBeats.map((b) => b * beatMs))
    return () => {
      setPlayheadTrack([])
      setPlayheadBeat(0, 0, [])
    }
  }, [doc === null, parseResult, pageConfig, scoreBeatMs, setPlayheadBeat, setPlayheadTrack])

  /**
   * 小节起点**拍位**（与速度无关）：用任意拍速建一次播放序列，`barStartsMs / beatMs` 即拍。
   * `{jz}` 的额外拍已经算在里面 ⇒ 与播放口径一致。
   */
  /**
   * 谱面播放序列（按 120bpm 建一次，只用来取**拍位几何**：小节起点 / 音符起拍与时值）。
   * 时间换算一律由 `audioMsOfBeat(fit, beat)` 负责，所以这里用什么 bpm 建都无所谓。
   */
  /**
   * 谱面播放序列（**按谱面 J: 的拍速**建）——台面里"格子 / 小节线 / 色块轨道"三处都用它，
   * 且三处的毫秒都是**谱面时间轴**（`beat × scoreBeatMs`）。
   *
   * ⚠ adj1142（用户 2026-10-24 实报「第 1 个格子点下去没有色块、第 2 个格子却跳到第 3 个音符」）：
   * 之前这里按 **120bpm** 建，却用 `scoreBeatMs` 换算 —— `e.atMs = 拍×500` 与 `s.beat×923` 两个基准混用，
   * 轨道整整压扁成 0.54 倍，色块自然跑到后面的音符上。**一个时间轴只能有一个拍速。**
   */
  const scoreSeq = useMemo(() => {
    const lay = layoutScore(parseResult, pageConfig)
    return buildPlaySequence(parseResult, lay, scoreBpm)
  }, [parseResult, pageConfig, scoreBpm])

  const barStartBeats = useMemo(
    () => (scoreSeq.barStartsMs ?? []).map((ms) => ms / scoreBeatMs),
    [scoreSeq, scoreBeatMs],
  )

  /**
   * adj1144（用户 2026-10-25 实报「台面小节序号比谱面差 1」）：
   * 序号**用引擎给的源码小节号**（`barNos`），不再用"下标 + 1"——反复段会让下标整首错开。
   * 引擎没给（比如切片结果）才回退到下标。
   */
  const barNoOf = useCallback(
    (i: number): number => scoreSeq.barNos?.[i] ?? i + 1,
    [scoreSeq],
  )

  /** adj1146：要画的小节号（缺号补在同一根线上；见 `noteStrip.ts` 的口径说明） */
  const barLabels = useMemo(() => barLabelsOf(barStartBeats, barNoOf), [barStartBeats, barNoOf])

  /** adj1137（用户 2026-10-24 的想法）：主音符合成一条"格子排"，与波形共用同一时间轴 */
  const noteCells = useMemo(
    () =>
      scoreSeq.events
        .filter((e) => e.placed.playable && e.durationMs > 0)
        .map((e) => {
          // adj1144：带上音高（MIDI 半音），用来画"亮柱高度 = 音高"
          const name = e.pitch ?? e.placed.audioPitch
          const midi = typeof name === 'string' && name !== '' ? pitchToMidiNote(name) : undefined
          return {
            beat: e.atMs / scoreBeatMs,
            beats: e.durationMs / scoreBeatMs,
            ...(midi !== undefined && Number.isFinite(midi) ? { midi } : {}),
          }
        }),
    [scoreSeq, scoreBeatMs],
  )

  /** adj1144：全曲音高范围（最低/最高各占一个端点，用来把音高换算成柱高） */
  const midiRange = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const c of noteCells) {
      if (c.midi === undefined) continue
      lo = Math.min(lo, c.midi)
      hi = Math.max(hi, c.midi)
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null
  }, [noteCells])

  /**
   * 有效拟合（adj1153 集中到 `effectiveSyncFitOf`）：
   * **0 条锚点 ⇒ 保留段起点 = 谱面第 1 拍**；1 条 ⇒ 速度用谱面 `J:`、锚点只解偏移；
   * 2 条以上才由锚点解速度。
   */
  const effFit = useMemo(() => effectiveSyncFitOf(doc, scoreBeatMs), [doc, scoreBeatMs])

  const durMs = Math.max(1, doc?.audioDurationMs || (audio ? Math.round(audio.duration * 1000) : 1))
  const trim = doc?.trim ?? { startMs: 0, endMs: durMs }
  /**
   * adj1136（用户 2026-10-24 看到"打开台面时绝对零时落在第 4 小节"）：
   * 只有 **1 条**锚点时，速度按谱面 `J:` 走 ⇒ "谱面第 1 拍"被推到音频 0 **之前**
   * （他这条：beat 16.5 @ 3.91s ⇒ 谱面起点在 −11.3s，等于"前 16.5 拍只用了 3.9 秒"）。
   * 这多半是拍号填错、或伴奏有前奏——把隐含结论摆出来提醒，**不自动改用户数据**。
   */
  const singleAnchorWarn = useMemo(() => {
    if (doc === null || doc.anchors.length !== 1) return ''
    const a = doc.anchors[0]
    const impliedOffset = a.audioMs - a.beat * scoreBeatMs
    if (impliedOffset >= -2 * scoreBeatMs) return ''
    return syncCopy.anchorImplausible(String(Math.round(a.beat * 100) / 100), audioClockOf(a.audioMs))
  }, [doc, scoreBeatMs])

  /**
   * adj1139（用户 2026-10-24「长度不一致 ⇒ 两个都做」）：
   * **伴奏比谱面长**时，谱面第 1 拍落在音频 `offsetMs`（>0）⇒ 前面那段是「前奏等待」：
   *  - 波形上淡淡标出来；
   *  - 播放到这段时，预览的谱面时刻夹在 0（球停在第一个音上原地跳，直到谱面开始）。
   * 反过来（谱面先于音频开始）由 `singleAnchorWarn` 那条红字提醒，不在这里处理。
   */
  const headWaitMs = useMemo(() => {
    if (effFit === null) return 0
    const wait = effFit.offsetMs - trim.startMs
    return wait > 0 ? wait : 0
  }, [effFit, trim.startMs])
  /** adj1126：波形当前视野（整曲 or 缩放后的窗口），刻度与读数都用它 */
  const viewWin = viewWindow(view, durMs)
  /** adj1127：横向滚动条的滑块位置/宽度（整曲时 `visible=false`） */
  const thumb = scrollThumb(view, durMs)
  /**
   * adj1137（用户 2026-10-24 的想法）：**音符格子排**——每个主音符一格、宽度=时值，
   * 与波形**同一时间轴**（`offsetMs + 拍 × beatMs`）。锚点落在拍上时，格子左缘正好压在锚点线上，
   * 所以"对没对上"一眼可见。点击格子 ⇒ 播放头/色块跳到那个音。
   * 还没对拍时按"谱面从音频 0 开始、速度用 J:"先画出来（否则没锚点就看不到，没法用来找位置）。
   */
  const stripFit = useMemo(
    () => effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 },
    [effFit, scoreBeatMs],
  )
  const stripCells = useMemo(() => stripCellsOf(noteCells, stripFit), [noteCells, stripFit])

  /** 拍号 → "第 N 小节第 K 拍"（给锚点列表/打点默认值用） */
  const barBeatLabel = useCallback(
    (b: number): string => {
      for (let i = barStartBeats.length - 1; i >= 0; i--) {
        if (b >= barStartBeats[i] - 1e-6) {
          return `${barNoOf(i)}:${Math.round((b - barStartBeats[i]) * 100) / 100 + 1}`
        }
      }
      return `${b}`
    },
    [barStartBeats, barNoOf],
  )

  const beatOfBarBeat = useCallback(
    (barNo: number, beatNo: number): number | null => {
      // adj1144：按**源码小节号**找起点（反复段同一个小节号可能出现两次 ⇒ 取第一次出现的那个）
      const i = barStartBeats.findIndex((_, idx) => barNoOf(idx) === barNo)
      const start = i >= 0 ? barStartBeats[i] : undefined
      if (start === undefined) return null
      return start + (beatNo - 1)
    },
    [barStartBeats, barNoOf],
  )

  /**
   * adj1135（用户 2026-10-24 实报「当前位置位数不一，这一行一直晃」）：
   * 读数用**定长**格式（拍号两位小数，`11:2.72`）——原来是"能省就省"的 `2.7199999999999998`，
   * 宽度一会儿长一会儿短，后面几个控件就跟着左右跳。
   */
  const barBeatLabelFixed = useCallback(
    (b: number): string => {
      for (let i = barStartBeats.length - 1; i >= 0; i--) {
        if (b >= barStartBeats[i] - 1e-6) {
          return `${barNoOf(i)}:${(b - barStartBeats[i] + 1).toFixed(2)}`
        }
      }
      return b.toFixed(2)
    },
    [barStartBeats, barNoOf],
  )

  /**
   * adj1133：把**音频时刻**换算成谱面时刻，并推给应用预览（`currentMs` ⇒ 高亮/色块跟着走）。
   * 顺带更新"当前位置"读数（`小节:拍`）。没对拍时按"谱面从音频 0 开始"的假设走。
   */
  const paintPreview = useCallback(
    (audioMs: number) => {
      const fitForPreview = effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 }
      const t = Math.max(0, sessionMsOfAudioMs(audioMs, fitForPreview, scoreBeatMs))
      setCurrentMs(t)
      if (previewInfoRef.current) {
        const beat = t / scoreBeatMs
        // adj1136：`小节:拍（第 N 拍）` + **绝对时点**（音频文件里的 m:ss.ss）
        previewInfoRef.current.textContent = `${syncCopy.previewNow} ${barBeatLabelFixed(beat)}（第 ${Math.floor(beat) + 1} 拍）· ${audioClockOf(audioMs)}`
      }
    },
    [barBeatLabelFixed, effFit, scoreBeatMs, setCurrentMs],
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
  /**
   * adj1149（用户 2026-10-25：「滑条滑了没变化、声音选合成音还是伴奏」）：
   * 两条轨各自的 GainNode。**播放中**改音量要直接改它们（`startPlayback` 只在开头设一次值，
   * 不保存引用的话滑杆就只在"下一次播放"生效——用户看到的就是"死滑杆"）。
   */
  const accGainRef = useRef<GainNode | null>(null)
  const synthGainRef = useRef<GainNode | null>(null)
  /** 声音三档的"上一档"：播放中换档要从当前播放头重开（否则已排进 AudioContext 的轨不会变） */
  const mixSourceRef = useRef<'file' | 'synth' | 'mix' | null>(null)
  /** 已经排进 AudioContext 的"嗒"——关掉节拍器时必须把它们全停掉（否则听起来"关不掉"） */
  const clicksRef = useRef<OscillatorNode[]>([])
  /** 节拍器已经排到哪一刻（音频 ms） */
  const schedRef = useRef(0)
  /**
   * adj1135：播放"代次"。每次开播 +1；`stopSource()` 也 +1。
   * 合成音渲染是 `await`，回来时若代次变了就说明用户已经停了 ⇒ 不许再 `start()`。
   */
  const playGenRef = useRef(0)

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
    // adj1170：连同 HMR 前旧模块排出去的"嗒"一起停掉
    stopLiveClicks()
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
    // adj1135：让"正在渲染合成音"的那一路知道已经作废（否则它渲染完还会 start 出一条没人管的音轨）
    playGenRef.current += 1
    for (const s of sourcesRef.current) {
      try {
        s.stop()
      } catch {
        /* 已自然结束 */
      }
      s.disconnect()
    }
    sourcesRef.current = []
    // adj1149：GainNode 跟着音源一起作废（否则下一次播放的实时音量会改到已断开的旧节点上）
    accGainRef.current = null
    synthGainRef.current = null
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
          const when = ctx.currentTime + Math.max(0, (at - from) / 1000)
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          /**
           * adj1170：短衰减的软"嗒"——旧版 1000Hz/0.22 方起方停太像提示音。
           * 三角波从 660Hz 落到 440Hz，2ms 起音、45ms 内衰减到静音；
           * 音头/音尾都有包络，不再有硬切的爆音。
           */
          osc.type = 'triangle'
          osc.frequency.setValueAtTime(METRONOME_HZ, when)
          osc.frequency.exponentialRampToValueAtTime(METRONOME_HZ * 0.667, when + METRONOME_MS / 1000)
          gain.gain.setValueAtTime(0.0001, when)
          gain.gain.exponentialRampToValueAtTime(METRONOME_GAIN, when + 0.002)
          gain.gain.exponentialRampToValueAtTime(0.0001, when + METRONOME_MS / 1000)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(when)
          osc.stop(when + METRONOME_MS / 1000 + 0.01)
          liveClicks.add(osc)
          osc.onended = () => liveClicks.delete(osc)
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
    // adj1133：不再借"放映会话"，按谱面 J: 现建一条序列（与台面的时间基准一致）
    const lay = layoutScore(parseResult, pageConfig)
    const seq = buildPlaySequence(parseResult, lay, scoreBpm)
    /**
     * adj1149：缓存键改用**源码指纹**（原来是 `code.length`）——
     * 改了音高/拍子但字数不变时，旧缓存会被当成"还是那首歌"，合成音一直放旧旋律。
     */
    const codeKey = codeFingerprint(code)
    const key = `${seq.totalMs}|${scoreBpm}|${codeKey}`
    if (synthBufRef.current?.key === key) return synthBufRef.current.buf
    setSynthState('loading')
    try {
      const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
      const cache = createHqCache()
      const { bank } = await resolveHqBank(lib, cache, hostBankUrl(lib.id))
      const buf = await renderToAudioBuffer(seq.events, bank, { bpm: scoreBpm })
      synthBufRef.current = { key, buf }
      setSynthState('idle')
      return buf
    } catch {
      setSynthState('error')
      return null
    }
  }, [code, pageConfig, parseResult, scoreBpm])

  const startPlayback = useCallback(
    async (fromMs: number, loop?: { startMs: number; endMs: number }) => {
      if (!audio) {
        setNotice(syncCopy.noAudio)
        return
      }
      stopSource()
      /** 代次令牌要在 `await` **之前**取（`stopSource` 也会 +1） */
      const gen = (playGenRef.current += 1)
      const alive = () => playGenRef.current === gen
      const ctx = ensureCtx()
      await ctx.resume()
      if (!alive()) return
      /**
       * adj1135（用户 2026-10-24 实报「合成音停下来停不住，只能在试听里停」）：
       * 合成音要**先渲染**（`await ensureSynthBuffer()`，可能几秒）。这段等待期间如果用户按了
       * 暂停/关闭，`stopSource()` 跑的时候 `sourcesRef` 还是空的 ⇒ 之后再 `start()` 的那条
       * 合成音**没人管**，只能靠别处停。现在用**代次令牌**：等到渲染完先看这一代还活着没，
       * 死了就立刻取消；而且创建一条就立刻登记一条（不再攒到最后）。
       */
      // adj1151：起点必须夹进保留段——设了 7.277s 的起点，按播放不能从音频 0 开始
      const from = playStartMsOf(fromMs, trim)
      const mix = useSyncStore.getState().doc?.mix ?? { source: 'file' as const, accomp: 1, synth: 0.5 }
      const plan = mixPlanOf(mix)
      /**
       * adj1129（用户 2026-10-24：「添加终点后应在最后一拍里音量渐小至无声，以免停得太突兀」）：
       * 台面试听也在**结束前最后一拍**把音量线性压到 0（与出片音轨同一口径）。
       */
      const beatMsNow = effFit?.beatMs ?? scoreBeatMs
      const endMs = loop ? loop.endMs : trim.endMs
      const fadeStartMs = Math.max(from, endMs - beatMsNow)
      const canFade = endMs - fadeStartMs > 20
      /** 从**音频时刻** `atAudioMs`（当前播放到哪）推算淡出的绝对时刻 */
      const applyFade = (gain: GainNode, base: number, atAudioMs: number) => {
        if (!canFade || base <= 0) return
        const t0 = ctx.currentTime + Math.max(0, (fadeStartMs - atAudioMs) / 1000)
        const t1 = ctx.currentTime + Math.max(0, (endMs - atAudioMs) / 1000)
        gain.gain.setValueAtTime(base, t0)
        gain.gain.linearRampToValueAtTime(0, t1)
      }
      /**
       * adj1149：声音三档要**真的换**（用户 2026-10-25：「选合成音还是伴奏」）。
       *
       * 分两种时机：
       *  · 只有合成音（`synth`）：**先渲染**再起播——没有第二条轨可以垫，渲染失败就按文案
       *    回退到伴奏（`synthFailed` 写的"这次只播伴奏"以前没做到）；
       *  · 伴奏+合成（`mix`）：先让伴奏响，合成音渲染完再从**那一刻的谱面位置**接进来
       *    （不能等渲染完才起播，否则前几秒是静音；也不能用旧的 `from`，否则音画错开渲染时长）。
       */
      const synthOnly = plan.playSynth && !plan.playAcc
      let synthBuf: AudioBuffer | null = null
      if (synthOnly) {
        synthBuf = await ensureSynthBuffer()
        if (!alive()) return
      }
      /** adj1149：所有音源的时间基准（必须在 await 之前/之后取对，见上面两种时机） */
      const startedAt = ctx.currentTime
      const fallbackToAcc = synthOnly && synthBuf === null
      const startSynth = (buffer: AudioBuffer, atAudioMs: number) => {
        const fitForPreview = effFit ?? { beatMs: scoreBeatMs, offsetMs: 0 }
        const scoreStartSec = Math.max(0, sessionMsOfAudioMs(atAudioMs, fitForPreview, scoreBeatMs)) / 1000
        /**
         * adj1148/adj1149：从**前奏里**起播时（`atAudioMs < offsetMs`），谱面第 1 拍还没到，
         * 合成音不能立刻响——要等 `offsetMs − atAudioMs` 再起，否则比伴奏早 1.2s（音画错开）。
         */
        const delaySec = Math.max(0, (fitForPreview.offsetMs - atAudioMs) / 1000)
        const cur = useSyncStore.getState().doc?.mix ?? mix
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.playbackRate.value = scoreBeatMs / fitForPreview.beatMs
        const gain = ctx.createGain()
        gain.gain.value = cur.synth
        applyFade(gain, cur.synth, atAudioMs)
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(ctx.currentTime + delaySec, Math.min(scoreStartSec, Math.max(0, buffer.duration - 0.01)))
        sourcesRef.current.push(src)
        synthGainRef.current = gain
      }
      // ① 伴奏（按设定的伴奏音量；合成音失败时也走这里回退）
      if (plan.playAcc || fallbackToAcc) {
        const src = ctx.createBufferSource()
        src.buffer = audio
        const gain = ctx.createGain()
        gain.gain.value = mix.accomp
        applyFade(gain, mix.accomp, from)
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(0, from / 1000)
        sourcesRef.current.push(src)
        accGainRef.current = gain
      }
      // ② 合成音：只有合成音时已经渲染好；mix 时先放伴奏，稍后补进来
      if (plan.playSynth && synthBuf !== null) startSynth(synthBuf, from)
      if (sourcesRef.current.length === 0) {
        setNotice(syncCopy.synthFailed)
        return
      }
      if (fallbackToAcc) setNotice(syncCopy.synthFailed)
      srcRef.current = sourcesRef.current[0] ?? null
      startRef.current = { at: startedAt, from }
      loopRef.current = loop ?? null
      playheadRef.current = from
      playingRef.current = true
      setPlaying(true)
      schedRef.current = from
      if (meterRef.current) scheduleClicksUntil(from + CLICK_LOOKAHEAD_MS)
      const tick = () => {
        if (!playingRef.current) return
        const t = currentMs()
        playheadRef.current = Math.min(t, trim.endMs)
        if (meterRef.current) scheduleClicksUntil(Math.min(trim.endMs, t + CLICK_LOOKAHEAD_MS))
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
      // ③ mix：合成音渲染完再接到"此刻"（伴奏已经在响，不能停下重来）
      if (plan.playSynth && !synthOnly && synthBuf === null) {
        void (async () => {
          const rendered = await ensureSynthBuffer()
          if (!alive()) return
          if (rendered === null) {
            setNotice(syncCopy.synthFailed)
            return
          }
          const nowAudioMs = from + (ctx.currentTime - startedAt) * 1000
          if (nowAudioMs >= endMs) return
          startSynth(rendered, nowAudioMs)
        })()
      }
    },
    [audio, currentMs, ensureCtx, effFit, ensureSynthBuffer, meterOn, scheduleClicksUntil, scoreBeatMs, stopSource, trim.endMs],
  )

  /**
   * adj1149：**播放中**改音量要立刻听到（用户 2026-10-25：「滑条滑了没什么变化」）。
   *
   * `startPlayback` 只在开播那一刻把 `mix.accomp/synth` 写进 GainNode；不在这里补一刀的话，
   * 拖动滑杆只改 store、声音要等下一次播放才变。
   */
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || !playingRef.current) return
    const now = ctx.currentTime
    const apply = (g: GainNode | null, v: number) => {
      if (!g) return
      try {
        // 20ms 平滑：不取消已排的收尾淡出（`setTargetAtTime` 不会把后面的事件删掉）
        g.gain.setTargetAtTime(v, now, 0.02)
      } catch {
        g.gain.value = v
      }
    }
    apply(accGainRef.current, doc?.mix.accomp ?? 1)
    apply(synthGainRef.current, doc?.mix.synth ?? 0.5)
  }, [doc?.mix.accomp, doc?.mix.synth])

  /**
   * adj1149：**播放中换档**（伴奏 / 合成音 / 伴奏+合成）要立刻换声音——
   * 从当前播放头重开一次；暂停状态下只更新值，下次播放自然按新档走。
   */
  useEffect(() => {
    const src = doc?.mix.source
    if (src === undefined) return
    if (mixSourceRef.current === null) {
      mixSourceRef.current = src
      return
    }
    if (mixSourceRef.current === src) return
    mixSourceRef.current = src
    if (!playingRef.current) return
    const lp = loopRef.current
    if (lp) void startPlayback(lp.startMs, lp)
    else void startPlayback(playheadRef.current)
  }, [doc?.mix.source, startPlayback])

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

    /**
     * adj1139（用户 2026-10-24 拍板的两种"长度不一致"处理之一）：
     * **伴奏比谱面长** ⇒ 谱面开始之前那段音频是「前奏等待」，在这里淡淡标出来，
     * 播放时球停在第一个音（`paintPreview` 把负的谱面时刻夹到 0）。
     */
    if (headWaitMs > 60) {
      const h0 = Math.max(trim.startMs, v0)
      const h1 = Math.min(effFit ? effFit.offsetMs : trim.startMs, v0 + winMs)
      if (h1 > h0) {
        const xa = xOf(h0)
        const xb = xOf(h1)
        ctx.fillStyle = 'rgba(255,205,110,0.16)'
        ctx.fillRect(xa, 0, xb - xa, WAVE_H)
        ctx.fillStyle = 'rgba(255,225,160,0.95)'
        ctx.font = '10px system-ui, sans-serif'
        ctx.fillText(syncCopy.headWaitLabel, xa + 4, WAVE_H - 6)
      }
    }

    // 小节刻度 + 拍刻度（有 effFit 才画：没有锚点时不知道音频位置）
    if (effFit) {
      barStartBeats.forEach((b) => {
        const ms = effFit.offsetMs + b * effFit.beatMs
        if (ms < v0 || ms > v0 + winMs) return
        const x = xOf(ms)
        ctx.strokeStyle = 'rgba(120,200,255,0.55)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, WAVE_H)
        ctx.stroke()
        /**
         * adj1141（用户 2026-10-24）：**小节号挪到上面"音符格子"那排**（那里亮色、字更大），
         * 波形这一侧只保留贯穿下来的竖线，不再写字。
         */
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
  }, [audio, doc, durMs, effFit, barStartBeats, headWaitMs, paintPreview, pending, sel, trim.endMs, trim.startMs, view, layout.waveH])

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

  /**
   * adj1157：桌面壳走原生对话框（拿绝对路径），并把路径写进 sidecar；
   * 网页仍用上面的 `<input type=file>`（浏览器不给路径）。
   */
  const onPickAudioNative = async () => {
    const path = await pickAudioFileNative()
    if (path === null) return
    setDecodeState('busy')
    try {
      const bytes = await readSidecarAudio(path)
      if (bytes === null) {
        setDecodeState('error')
        setNotice(syncCopy.decodeFailed)
        return
      }
      const buf = await decodeAccompaniment(bytes)
      setAudio(audioRefOf(path, nativePath), buf)
      setDecodeState('idle')
      setNotice('')
    } catch {
      setDecodeState('error')
      setNotice(syncCopy.decodeFailed)
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
      /**
       * adj1136：默认值要**取整**——`barBeatLabel` 返回 `4:1.33` 这种带小数的显示，
       * 直接塞回输入框就会造出"第 1.33 拍"这种半拍锚点（用户 sidecar 里的 `beat: 16.5` 就是这么来的）。
       */
      setBar(b)
      setBeat(Math.max(1, Math.round(k)))
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
   *
   * adj1143（用户 2026-10-24）：「音符格子条也要跟波形一样响应滚轮」——
   * 所以监听挂在**两排的公共容器** `.sync-wave-group` 上（格子条 + 波形都算），
   * 水平方向的换算仍用波形画布的矩形（它和容器同宽）。
   */
  useEffect(() => {
    const group = groupRef.current
    const c = canvasRef.current
    if (!group || !c) return
    const onWheelNative = (e: WheelEvent) => {
      /**
       * adj1131（用户 2026-10-24）：
       *  · 无修饰键 + 滚轮 = 缩放；
       *  · **Shift + 滚轮 = 左右平移**（新加）；
       *  · **Ctrl / ⌘ / Alt + 滚轮一律不接管**——交给浏览器（Ctrl+滚轮是页面缩放），
       *    免得"想缩小页面"却把波形缩了。
       */
      if (e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      if (e.shiftKey) {
        // 多数鼠标在 Shift 下把纵向滚动塞进 deltaY；触控板可能是 deltaX
        const d = e.deltaY !== 0 ? e.deltaY : e.deltaX
        setView((v) => {
          const { winMs } = viewWindow(v, durMs)
          return panView(v, durMs, (d * winMs) / width)
        })
        return
      }
      const x = Math.min(Math.max(0, e.clientX - rect.left), width)
      setView((v) => {
        const { v0, winMs } = viewWindow(v, durMs)
        const anchor = v0 + (x / width) * winMs
        return zoomView(v, durMs, e.deltaY > 0 ? 1.25 : 0.8, anchor)
      })
    }
    group.addEventListener('wheel', onWheelNative, { passive: false })
    return () => group.removeEventListener('wheel', onWheelNative)
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
  // adj1152：0/1 条锚点也算"有对拍数据"（清空按钮不该只在 ≥2 条时才出现）
  const usable = doc.audio !== '' || doc.anchors.length > 0

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
          {/* adj1140（用户 2026-10-24）：谱面缩放挪到右上角（和最大化/保存/关闭一排） */}
          <span className="sync-row sync-preview-zoom">
            <span className="sync-label">{syncCopy.previewZoom}</span>
            <button
              type="button"
              className="btn sync-mini"
              data-sync="zoom-out"
              disabled={previewZoom <= 50}
              onClick={() => setPreviewZoom(Math.max(50, previewZoom - 10))}
              title={syncCopy.zoomOutHint}
            >
              −
            </button>
            <span className="sync-name" data-sync="zoom-value">
              {previewZoom}%
            </span>
            <button
              type="button"
              className="btn sync-mini"
              data-sync="zoom-in"
              disabled={previewZoom >= 200}
              onClick={() => setPreviewZoom(Math.min(200, previewZoom + 10))}
              title={syncCopy.zoomInHint}
            >
              +
            </button>
          </span>
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

        {/* adj1133（用户 2026-10-24）：预览直接**复用应用自己的预览**（同一份排版/渲染/高亮/滚动），
            高度仍可拖；缩放走顶栏同一个偏好 `ijipu.previewZoom` */}
        <div className="sync-preview" style={{ height: `${layout.previewH}px` }}>
          <div className="sync-preview-box">
            <PreviewPane disableGuides />
          </div>
          {/* adj1136：单锚点推出的不可能结论（不静默） */}
          {singleAnchorWarn !== '' && <div className="sync-warn sync-preview-warn">{singleAnchorWarn}</div>}
        </div>
        {/* adj1160（用户 2026-10-25 选「底部放一起」）：第一条拖动条在预览/音符格子之间 */}
        <div className="sync-split" onPointerDown={startDrag('preview')} title={syncCopy.splitPreviewHint} />

        {/* adj1137：音符格子排（在波形**上面**，与波形同一时间轴、同步缩放；点一格跳过去）
            adj1142：和波形包在同一个 `gap:0` 的组里，两排之间没有缝
            adj1144：高度=波形 3/4；格子分上下两段，下段亮、柱高按音高（十二律等分） */}
        <div className="sync-wave-group" ref={groupRef}>
        {stripCells.length > 0 && (
          <div
            className="sync-notes"
            data-sync="note-strip"
            style={{ height: `${Math.max(32, Math.round((layout.waveH * 3) / 4))}px` }}
            title={syncCopy.stripHint}
          >
            {/* adj1141：小节线画在**这一排**（亮色），锚点解出来后同一根线在波形里也贯通
                adj1146：小节号单独一层——把缺掉的号（空小节）补在同一根线上，号一个不少 */}
            {barStartBeats.map((b, i) => {
              const ms = stripFit.offsetMs + b * stripFit.beatMs
              const pct = ((ms - viewWin.v0) / viewWin.winMs) * 100
              if (pct < 0 || pct > 100) return null
              return <div key={`bar-${i}`} className="sync-bar-line" style={{ left: `${pct}%` }} />
            })}
            {barLabels.map((lb, i) => {
              const every = viewWin.winMs > 90000 ? 8 : viewWin.winMs > 45000 ? 4 : viewWin.winMs > 15000 ? 2 : 1
              // 补号一律显示；正常号按视野密度抽稀（但第 1 小节总显示）
              if (lb.stack === 0 && (lb.no - 1) % every !== 0) return null
              const ms = stripFit.offsetMs + lb.beat * stripFit.beatMs
              const pct = ((ms - viewWin.v0) / viewWin.winMs) * 100
              if (pct < 0 || pct > 100) return null
              return (
                <span
                  key={`no-${lb.no}-${i}`}
                  className={`sync-bar-no${lb.stack > 0 ? ' is-fill' : ''}`}
                  style={{ left: `calc(${pct}% + 3px)`, top: `${1 + lb.stack * 11}px` }}
                >
                  {lb.no}
                </span>
              )
            })}
            {stripCells.map((cell, i) => {
              const rect = cellRectPct(cell, viewWin.v0, viewWin.winMs)
              if (rect === null) return null
              return (
                <button
                  key={`${cell.beat}-${i}`}
                  type="button"
                  className="sync-note-cell"
                  style={
                    {
                      left: `${rect.leftPct}%`,
                      width: `${rect.widthPct}%`,
                      // adj1144：下段亮柱的高度比例（最低音 0.1、最高音 1；按半音等分）
                      '--h': String(midiRange ? pitchHeightOf(cell.midi, midiRange.lo, midiRange.hi) : 0.1),
                    } as React.CSSProperties
                  }
                  title={`${barBeatLabel(cell.beat)} · ${audioClockOf(cell.audioMs)}`}
                  onClick={(e) => {
                    /**
                     * adj1145（用户 2026-10-25：「点格子不对，点波形同一位置就对了」）：
                     * 以前点格子用的是**格子自己的起始时刻**（`cell.audioMs`），而点波形用的是
                     * **鼠标那一像素对应的时刻**。两者在"格子很长 / 格子起点被窗口裁掉 / 多个格子挤在一起"
                     * 时会差半拍甚至一拍 —— 用户看到的就是"点格子跳到旁边那个音"。
                     * 现在格子直接复用波形那套换算（同一个 `msOfClientX`），点哪儿就是哪儿。
                     */
                    seekTo(msOfClientX(e.clientX), false)
                  }}
                />
              )
            })}
          </div>
        )}

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
          <div className="sync-wave-hint">
            {syncCopy.tipPick} · {syncCopy.barLabelHint}
          </div>
        </div>
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
        {/* adj1160（用户 2026-10-25 选「底部放一起」）：伴奏名称紧挨在当前位置上面 */}
        <div className="sync-preview-info">
          <span className="sync-label">{syncCopy.audioLabel}</span>
          {audio ? (
            <span className="sync-audio-name">
              {baseNameOf(doc.audio)} · {fmtSec(durMs)}
            </span>
          ) : (
            <span className="sync-audio-name sync-dim">
              {doc.audio !== '' ? `${syncCopy.audioMissing}：${baseNameOf(doc.audio)}` : syncCopy.noAudio}
            </span>
          )}
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.flac" className="sync-file" onChange={(e) => void onPickAudio(e)} />
          <button
            type="button"
            className="btn sync-mini"
            disabled={decodeState === 'busy'}
            onClick={() => {
              // adj1157：桌面壳用原生对话框拿真实路径；网页仍走 <input>
              if (isTauriShell()) void onPickAudioNative()
              else fileRef.current?.click()
            }}
          >
            {audio ? syncCopy.repickAudio : syncCopy.pickAudio}
          </button>
          {decodeState === 'busy' && <span className="sync-dim">{syncCopy.decoding}</span>}
          <span className="sync-dim sync-preview-hint">{syncCopy.previewHint}</span>
        </div>
        {/* 第一排（紧贴波形下沿）：**当前位置** + 播放 + 打点 + 视野 ——
            adj1140：伴奏信息挪到预览下面那一排，这里换成当前位置（两处对调） */}
        <div className="sync-row sync-audio-row">
          <div className="sync-audio-left">
            <span className="sync-preview-pos">
              <span ref={previewInfoRef}>{syncCopy.previewNow}</span>
            </span>
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
            {syncCopy.bpm} ♩={effFit ? Math.round(60000 / effFit.beatMs) : '—'}（谱面 {Math.round(scoreBpm)}）
          </span>
          <span className="sync-name">
            {syncCopy.offset} {effFit ? fmtSec(effFit.offsetMs) : '—'}
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
            title={syncCopy.mixLiveHint}
            onChange={(e) => setMix({ source: e.target.value as 'file' | 'synth' | 'mix' })}
          >
            <option value="file">{syncCopy.mixFile}</option>
            <option value="mix">{syncCopy.mixBoth}</option>
            <option value="synth">{syncCopy.mixSynth}</option>
          </select>
          {/* adj1128：选合成音时要现渲染（第一次慢），如实显示状态 */}
          {synthState === 'loading' && <span className="sync-dim">{syncCopy.synthLoading}</span>}
          {synthState === 'error' && <span className="sync-warn">{syncCopy.synthFailed}</span>}
          {/* adj1149：标签写全（用户 2026-10-25 问「这几个滑条是干什么的」），并显示百分比 */}
          <span className="sync-label" title={syncCopy.mixLiveHint}>{syncCopy.accompGain}</span>
          <input
            className="sync-mix-range"
            data-sync="mix-accomp"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={doc.mix.accomp}
            title={syncCopy.mixLiveHint}
            aria-label={syncCopy.accompGain}
            onChange={(e) => setMix({ accomp: Number(e.target.value) })}
          />
          <span className="sync-dim sync-mix-val">{Math.round(doc.mix.accomp * 100)}%</span>
          <span className="sync-label" title={syncCopy.mixLiveHint}>{syncCopy.synthGain}</span>
          <input
            className="sync-mix-range"
            data-sync="mix-synth"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={doc.mix.synth}
            title={syncCopy.mixLiveHint}
            aria-label={syncCopy.synthGain}
            onChange={(e) => setMix({ synth: Number(e.target.value) })}
          />
          <span className="sync-dim sync-mix-val">{Math.round(doc.mix.synth * 100)}%</span>
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
            {/* adj1139：两种"长度不一致"的快捷入口（等价于打一条特殊锚点，数据仍是 anchors） */}
            <div className="sync-quick">
              <span className="sync-dim">{syncCopy.quickAlignTitle}</span>
              <button
                type="button"
                className="btn sync-mini"
                data-sync="align-head"
                title={syncCopy.quickAlignHeadWaitHint}
                onClick={() => {
                  const at = Math.round(playheadRef.current)
                  if (doc.anchors.some((a) => Math.abs(a.beat) < 1e-6)) {
                    setNotice(syncCopy.anchorDup)
                    return
                  }
                  addAnchor({ beat: 0, audioMs: at })
                  setNotice(syncCopy.quickAlignHeadWaitDone(audioClockOf(at)))
                }}
              >
                {syncCopy.quickAlignHeadWait}
              </button>
              <button
                type="button"
                className="btn sync-mini"
                data-sync="align-skip"
                title={syncCopy.quickAlignSkipHint}
                onClick={() => {
                  const b = beatOfBarBeat(bar, beat)
                  if (b === null || bar < 1 || beat < 1) {
                    setNotice(syncCopy.beatPosInvalid)
                    return
                  }
                  addAnchor({ beat: b, audioMs: 0 })
                  setNotice(syncCopy.quickAlignSkipDone(`${bar}:${beat}`))
                }}
              >
                {syncCopy.quickAlignSkip} {bar}:{beat}
              </button>
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
