/**
 * dialogs/PlaybackDialog.tsx — 试听播放（adj344：固定 SpessaSynth 高保真，移除合成/midi-js 试听）
 *
 * 能力：速度 30~240 拍/分（默认取 J 描述头）；固定 SpessaSynth 高保真音源（桌面为随安装包
 * 内置在安装目录的 SF2，直接读取；Web 首次打开即自动下载并缓存到 IndexedDB，后续直接读缓存；
 * 需要下载时显示进度提示）；「音色」下拉
 * 仅列用户启用的收藏音色（GM program，默认含常用音色，由「设置 → 音色库」勾选）；播放/停止；
 * 播放中音符高亮 + 自动滚屏（复用 M3 联动）；反复记号展开。
 * adj347：① 打开试听即自动下载音源（不再要求用户先手动点下载，点播放即可用）；
 * ② 音色默认启用一组常用音色（首次即可选）。
 * adj344：试听简化：①去掉「模式/音色库」下拉（不再提供合成/采样切换），固定 SpessaSynth
 * 高保真；②play() 收敛为高保真，移除合成/midi-js 采样分支；③「音色」只列启用收藏音色。
 * adj416：桌面端音源随安装包内置在**安装目录**（`generaluser_gs.sf2`）——直接读文件、不提示下载；
 * 音源来源统一走 resolveHqBank（缓存 → 内置 → 联网）。
 * adj158：① 内容压缩缩小对话框；② 播放时停靠窗口右下角让开预览区；
 * ③ 播放中双击谱面音符 → 快速跳到该处重新播放（PreviewPane 通过 playbackTick 触发）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { ToolIcon } from '../ui/ToolIcon'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { playbackCopy } from '../brand/copy'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'
import { SpessaSynthBackend, getHqLibrary, hasBuiltinBank, GM_VOICE_OPTIONS, firstEnabledInstrumentRef } from '../playback/spessaSynthBackend'
// adj409：暂停/续播的剩余事件平移（纯函数）
import { shiftEventsFrom } from '../playback/playbackTimeline'
import { layoutScore, buildPlaySequence, inferBpm, schedulePlay } from '@ijipu/engine'

const BPM_OPTIONS = [60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120]

export function PlaybackDialog() {
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  // adj258：批量高亮播放中同时演奏的音符
  const setActiveNoteIds = useDocStore((s) => s.setActiveNoteIds)
  const setVoiceBlocks = useDocStore((s) => s.setVoiceBlocks)
  // adj282：播放轨道 + 当前 ms（RAF 驱动）——PreviewPane 渲染跟随色块
  const setPlayheadTrack = useDocStore((s) => s.setPlayheadTrack)
  const setCurrentMs = useDocStore((s) => s.setCurrentMs)
  // adj326：编辑区方位（左右拆分的排列方向），决定试听对话框停靠到左下/右下角
  const viewType = useDocStore((s) => s.viewType)
  const playbackStartId = useUiStore((s) => s.playbackStartId)
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)
  const playbackTick = useUiStore((s) => s.playbackTick)
  // adj332：已启用音色集合——试听音色下拉只列这些（避免 128 项全列）
  const playbackHqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const playbackHqVoice = useUiStore((s) => s.playbackHqVoice)
  const setPlaybackHqVoice = useUiStore((s) => s.setPlaybackHqVoice)
  // adj354：@@ 恢复默认音色=第一音色——无描述头 Y 时取试听音色列表第一个启用音色（GM program 名）
  const defaultInstrumentRef = useMemo(() => firstEnabledInstrumentRef(playbackHqEnabled), [playbackHqEnabled])
  // adj326：左右拆分方位（previewLeft=左预览右编辑 / editorLeft=左编辑右预览）
  const splitHDir = useUiStore((s) => s.splitHDir)
  // adj323：宽/窄屏（≤1024px 视为窄屏模式，adj322）——角落停靠仅宽屏生效，窄屏保持原样
  const isNarrowMode = useUiStore((s) => s.isNarrow)
  // adj327：加载失败时用 toast 明确告知原因（不再仅复位后静默）
  const showNotice = useUiStore((s) => s.showNotice)

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  const [playing, setPlaying] = useState(false)
  // adj409：暂停态——`playing` 表示"会话仍在进行（含暂停）"，`paused` 表示音频已停住但可续播。
  // 二者分开：播放中按钮显示「暂停」，暂停后显示「继续」，会话未结束时「停止」始终可用、对话框保持停靠。
  const [paused, setPaused] = useState(false)
  // adj409：按播放后的准备期（音源加载/序列构建）——此间按钮置灰，避免连点重入
  const [starting, setStarting] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)
  // adj347/348：音源下载中（首次打开自动后台下载；前台仅文字提示，不阻塞其它交互）
  const [downloading, setDownloading] = useState(false)
  // adj416：音源随安装包内置（安装目录 generaluser_gs.sf2）→ 直接读文件，不显示下载提示
  const [builtinBank, setBuiltinBank] = useState(false)
  // adj293：播放异常提示（async play 若中途抛错此前被静默吞掉 → 无声无色块无法定位）
  const [playError, setPlayError] = useState<string | null>(null)
  // adj：窄屏（≤640px）下对话框已是 bottom-sheet 靠底，播放时不再 dock 到 bottom-right
  // （避免窄屏下还在屏幕中下位置来回移动；只有宽屏播放时才停靠右下角让出预览区）
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const onChange = () => setIsNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const backendRef = useRef<SpessaSynthBackend | null>(null)
  // adj331：SpessaSynth 音源缓存（IndexedDB，音源仅首次使用时下载并缓存，后续直接读缓存）
  const hqCacheRef = useRef<ReturnType<typeof createHqCache> | null>(null)
  // adj347：音源就绪 Promise（初次自动下载/缓存；播放与下载共享，避免重复下载）
  const bankPromiseRef = useRef<Promise<void> | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  // adj158：播完自动复位（playing=false → 对话框回中央）
  const doneTimerRef = useRef<number | null>(null)
  // adj258：播放序列 + 启动时间（本地计时），高亮定时器按当前 atMs 设 activeNoteIds
  const seqRef = useRef<ReturnType<typeof buildPlaySequence> | null>(null)
  const startTimeRef = useRef<number>(0)
  /**
   * adj409：把「时间轴」与「音频调度」拆成两个时钟，暂停/续播才不用改高亮与色块轨道：
   *  · `startTimeRef` = 本次音频调度起点的 `performance.now()`
   *  · `timeBaseRef`  = 该起点对应的**原时间轴**毫秒（首次播放 0；续播 = 暂停时的位置）
   *  于是 `curMs() = timeBase + (now - startTime)` 恒为**原时间轴**位置——
   *  高亮比对与 `playheadTrack`（都在原时间轴）无需任何偏移；音频侧则把剩余事件整体平移到 0 重排。
   */
  const timeBaseRef = useRef<number>(0)
  /** adj409：暂停时已播到的位置（原时间轴毫秒）= 续播起点 */
  const pausedAtRef = useRef<number>(0)
  const highlightTimerRef = useRef<number | null>(null)
  // adj282：RAF 驱动 currentMs（色块平滑滑动）
  const rafRef = useRef<number | null>(null)
  // adj409：播放/暂停按钮——点击后把焦点留在这里，空格即可暂停/继续
  const playBtnRef = useRef<HTMLButtonElement>(null)

  const header = parseResult.header
  // adj326：打开试听对话框即按编辑区方位停靠——编辑区在左（左右拆分 editorLeft）→ 左下角；
  // 编辑区在右/下/全屏（含上下拆分、纯 preview/code）→ 右下角。仅在宽屏模式生效。
  const editorCorner: 'bottom-left' | 'bottom-right' =
    (viewType === 'splitH' || viewType === 'splitHE') && splitHDir === 'editorLeft'
      ? 'bottom-left'
      : 'bottom-right'
  // adj326：最终停靠位置——宽屏模式（>1024）打开即按编辑区方位停靠角落；
  // 窄屏模式（≤1024）保持 adj158 原逻辑（播放时停靠右下让开预览区；≤640 移动端 bottom-sheet 靠底）
  const dockPos = isNarrowMode
    ? (playing && !isNarrow ? 'bottom-right' : undefined)
    : editorCorner
  // adj331：SpessaSynth 音源缓存（IndexedDB，供试听/导出复用；音源首次使用时下载并缓存）
  const hqCache = (hqCacheRef.current ??= createHqCache())

  // adj347：确保音源就绪（优先读缓存；未缓存则自动下载并缓存，带进度提示）。
  // 用共享 Promise：打开试听即自动下载，点播放时复用同一下载，避免重复下载。
  // adj416：桌面端音源随安装包内置在安装目录——先探测（极快），有就直接用、不显示下载提示。
  const ensureBank = (): Promise<void> => {
    if (!bankPromiseRef.current) {
      const hqLib = getHqLibrary()
      setSamplerState('loading')
      bankPromiseRef.current = (async () => {
        // adj416：桌面随安装包内置音源（安装目录 SF2）→ 直接读文件即可，不必再走缓存/下载流程
        if (await hasBuiltinBank(hqLib)) {
          setBuiltinBank(true)
          setSamplerState('ready')
          return
        }
        setDownloading(true)
        try {
          await prefetchHqLibraryProgress(hqLib, hqCache)
          setSamplerState('ready')
        } finally {
          setDownloading(false)
        }
      })()
        .catch((e) => {
          setSamplerState('failed')
          throw e
        })
        .finally(() => {
          bankPromiseRef.current = null
        })
    }
    return bankPromiseRef.current
  }

  // adj347/349：打开试听即后台自动下载音源——延迟到 UI 渲染后再触发，保证打开/交互秒响应
  useEffect(() => {
    const t = window.setTimeout(() => {
      void ensureBank().catch((e) => {
        showNotice(`音色库下载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      })
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // adj448：**每次打开试听，「音色」都从「自动」开始**——选定具体音色会覆盖谱面 `Y:` 乐器，
  // 若把它记住，用户下次打开带多声部 `Y:` 的谱子时音色仍是上次那个，看起来像「谱面 Y: 不生效」
  // （用户实测反馈）。试听音色因此改为**会话级**，不落盘（见 store 的 playbackHqVoice）。
  useEffect(() => {
    setPlaybackHqVoice(null)
  }, [setPlaybackHqVoice])

  // 关闭时停止播放
  useEffect(() => {
    return () => {
      cancelRef.current?.()
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
      if (highlightTimerRef.current !== null) window.clearInterval(highlightTimerRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      backendRef.current?.dispose()
      setActiveNoteId(null)
      setActiveNoteIds([])
      setVoiceBlocks([])
      setPlayheadTrack([])
      setCurrentMs(0)
    }
  }, [setActiveNoteId, setActiveNoteIds, setVoiceBlocks, setPlayheadTrack, setCurrentMs])

  // ---- adj409：播放驱动（RAF 色块 + 50ms 高亮 + 收尾复位）统一在这里启停，暂停/续播复用同一套 ----

  /** 当前（**原时间轴**）播放位置，毫秒 */
  const curMs = () => timeBaseRef.current + (performance.now() - startTimeRef.current)

  /** 清掉三个驱动定时器（收尾 / 高亮 / RAF） */
  const clearTimers = () => {
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
    if (highlightTimerRef.current !== null) {
      window.clearInterval(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  /** 清空播放期的界面态（高亮 / 声部色框 / 色块轨道 / 播放位置） */
  const clearPlaybackUi = () => {
    setActiveNoteId(null)
    setActiveNoteIds([])
    setVoiceBlocks([])
    setPlayheadTrack([])
    setCurrentMs(0)
  }

  /**
   * 启动驱动：RAF 每帧刷新 `currentMs`（色块滑动）、50ms 比对高亮、到点（job.totalMs + 100）自动复位。
   * 暂停后重排的序列是"相对现在"的，故收尾时间直接用 job.totalMs —— 与首次播放同一套语义。
   */
  const startTimers = (job: { totalMs: number }) => {
    clearTimers()
    const rafLoop = () => {
      setCurrentMs(curMs())
      rafRef.current = requestAnimationFrame(rafLoop)
    }
    rafRef.current = requestAnimationFrame(rafLoop)
    const computeActive = () => {
      const cur = curMs()
      const ids: string[] = []
      for (const e of seqRef.current?.events ?? []) {
        if (e.atMs <= cur && cur < e.atMs + e.durationMs) {
          ids.push(e.placed.id.page + '_' + e.placed.id.voice + '_' + e.placed.id.group + '_' + e.placed.id.index)
        }
      }
      setActiveNoteIds(ids)
      // adj285：播放跟随滚动——设当前活动音符 id（首个），使色块/高亮区域保持在视口内
      if (ids.length > 0) setActiveNoteId(ids[0])
    }
    computeActive()
    highlightTimerRef.current = window.setInterval(computeActive, 50)
    // adj158：播放结束后自动复位（playing=false，对话框从右下角回中央）
    doneTimerRef.current = window.setTimeout(() => {
      doneTimerRef.current = null
      clearTimers()
      setPlaying(false)
      setPaused(false)
      pausedAtRef.current = 0
      timeBaseRef.current = 0
      clearPlaybackUi()
    }, job.totalMs + 100)
  }

  const stop = () => {
    cancelRef.current?.()
    cancelRef.current = null
    clearTimers()
    backendRef.current?.stop()
    setPlaying(false)
    setPaused(false)
    pausedAtRef.current = 0
    timeBaseRef.current = 0
    clearPlaybackUi()
  }

  /**
   * adj409：暂停——记住已播位置、撤掉音频调度（后端用 `setTimeout` 排程，只能"撤掉重排"）、
   * 停住三个驱动定时器；**保持 `playing = true`**（会话未结束：「停止」仍可用、对话框保持停靠）。
   * 界面保留暂停瞬间的高亮与色块（不清空），位置定格在暂停点。
   */
  const pause = () => {
    if (!playing || paused) return
    pausedAtRef.current = Math.max(0, curMs())
    cancelRef.current?.()
    cancelRef.current = null
    clearTimers()
    setCurrentMs(pausedAtRef.current)
    setPaused(true)
  }

  /**
   * adj409：续播——把**剩余事件**整体平移到 0 重新调度：
   *  · 已播完的事件丢弃；
   *  · 暂停瞬间正在发声的音符从 0 起重排（时长取它在原时间轴上的**剩余部分**）——
   *    后端没有"从中间起声"的能力，故该音会从头再响一次，这是暂停/续播的已知取舍。
   */
  const resume = () => {
    const seq = seqRef.current
    const backend = backendRef.current
    if (!seq || !backend || !paused) return
    const from = pausedAtRef.current
    // adj409：剩余事件的平移/裁剪收敛在纯函数里（`playbackTimeline.ts`，带 smoke 断言）
    const events = shiftEventsFrom(seq.events, from)
    if (events.length === 0) {
      stop()
      return
    }
    const job = schedulePlay({ events }, backend, undefined, undefined, 0)
    cancelRef.current = job.cancel
    timeBaseRef.current = from
    startTimeRef.current = performance.now()
    setPaused(false)
    startTimers(job)
  }

  /** 播放键（开关语义）：未播放 → 播放；播放中 → 暂停；暂停中 → 继续 */
  const onPlayToggle = () => {
    if (starting) return
    if (!playing) {
      void play()
      return
    }
    if (paused) resume()
    else pause()
  }

  const play = async () => {
    stop()
    // adj409：准备期置位——按钮暂时置灰，避免连点重入（音源加载 + 序列构建要几百毫秒）
    setStarting(true)
    // adj293：整个播放流程包 try/catch——异常不再静默（此前 async 抛错 → 无声无色块）
    try {
      // adj344：固定 SpessaSynth 高保真后端（不再提供合成/midi-js 切换）
      let backend = backendRef.current
      if (!backend || !backend.hq) {
        backendRef.current?.dispose()
        backend = new SpessaSynthBackend()
        backendRef.current = backend
        await (backend as unknown as { ready?: () => Promise<void> }).ready?.()
        await new Promise((r) => setTimeout(r, 200))
      }
      try {
        const hqLib = getHqLibrary()
        // adj347：先确保音源就绪（初次自动下载/缓存；已缓存直接读）；点播放不再重复下载
        await ensureBank()
        // adj416：取音源字节——缓存优先，其次**安装目录内置 SF2**（桌面直接读文件），最后才是联网下载
        const { bank } = await resolveHqBank(hqLib, hqCache)
        await backend.load(bank)
        backend.setVoice(playbackHqVoice)
        setSamplerState('ready')
      } catch (e) {
        setSamplerState('failed')
        backendRef.current?.dispose()
        // adj344：固定高保真后不再回退合成（合成试听已移除），直接明确报错
        showNotice(`音源加载失败，无法试听：${e instanceof Error ? e.message : String(e)}`, 'error')
        return
      }
      // 构建序列（含反复展开；adj88：双击谱面音符定位试听起点）
      // adj310：声音/色块统一的准备延迟（毫秒）——按下播放后延迟才出第一声，色块同步
      const PLAY_FIRST_DELAY_MS = 200
      const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
      const seq = buildPlaySequence(parseResult, layout, bpm, playbackStartId, defaultInstrumentRef)
      setTotalMs(seq.totalMs)
      // adj262：layout 后写入 voiceBlocks（纯曲部 yTop/yBottom）供预览色框覆盖整列
      setVoiceBlocks(
        layout.pages.flatMap((p) =>
          p.voiceBlocks.map((vb) => ({
            x: vb.x,
            yTop: vb.yTop,
            yBottom: vb.yBottom,
            pageIndex: p.index,
            voices: vb.voices.map((v) => v.voice),
          })),
        ),
      )
      // adj282：写入播放轨道（atMs 单调、含反复展开），PreviewPane 跟随色块定位
      // adj299/300：按「拍段」拆分——色块以音符宽度为单位、最大 1 拍（playheadSegs 每段 ≤1 拍）
      const beatMs = 60000 / bpm
      setPlayheadTrack(
        seq.events.flatMap((e) =>
          (e.playheadSegs ?? []).map((s) => ({
            atMs: e.atMs + s.beat * beatMs,
            durationMs: s.beats * beatMs,
            pageIndex: s.pageIndex,
            x: s.x,
            y: s.y,
            width: s.width,
            voice: s.voice,
            group: s.group,
            // adj427：色块按**音色**着色（切换音色时颜色跟着变）
            instrument: s.instrument,
            // adj429：色块按曲行几何动态定界（多声部/临时段不再互相覆盖、不压歌词）
            ...(s.yTopMin !== undefined ? { yTopMin: s.yTopMin } : {}),
            ...(s.yBottomMax !== undefined ? { yBottomMax: s.yBottomMax } : {}),
            // adj432：声部角色（bz upper / dsb upper / dsb lower）→ 预览层颜色区分
            ...(s.playVoice !== undefined ? { playVoice: s.playVoice } : {}),
          })),
        ),
      )
      // adj258：保存序列 + 本地启动时间，启动高亮定时器按当前 atMs 设 activeNoteIds
      // adj409：首次播放的时间轴基点 = 0（续播时由 resume() 设为暂停位置）
      seqRef.current = seq
      timeBaseRef.current = 0
      pausedAtRef.current = 0
      startTimeRef.current = performance.now() + PLAY_FIRST_DELAY_MS
      // adj344：高保真音色由 setVoice(GM program) 决定，无需全局乐器覆盖参数（globalInstrument）
      // adj285：不再用 onNote 同步设置 activeNoteId（循环内逐事件 set → 批处理后为最后一事件）
      // adj309：按下播放后延迟 200ms 才出第一声——给听者准备时间 + 让 ctx resume 完成
      const job = schedulePlay(seq, backend, undefined, undefined, PLAY_FIRST_DELAY_MS)
      cancelRef.current = job.cancel
      setPlaying(true)
      setPaused(false)
      setPlayError(null)
      // adj282/adj409：驱动定时器（RAF 色块 + 高亮 + 收尾复位）统一由 startTimers 启停
      startTimers(job)
      // 起点播放后清除标记，下次播放从头开始
      if (playbackStartId) setPlaybackStart(null)
    } catch (e) {
      // adj293：异常显示在对话框（不再静默失败）
      setPlayError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  // adj158：单击谱面音符 → 从该音符（重）播放（PreviewPane 递增 playbackTick）。
  // adj284：无论是否正在播放都响应——试听对话框打开时单击音符即从该处开始演奏；
  // 首次打开对话框（tick 未变化）不误自动播放
  const firstTick = useRef(playbackTick)
  useEffect(() => {
    if (playbackTick === firstTick.current) return
    firstTick.current = playbackTick
    if (playbackTick > 0) void play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackTick])

  // adj409：播放/暂停后把焦点留在播放按钮上——按钮获得焦点后，**空格/回车**即等于再点一次，
  // 于是「按一下空格」就能暂停或恢复，不必去点按钮（用户要求）。仅在会话进行中出现状态变化时聚焦，
  // 打开对话框时不抢焦点（避免影响谱面/编辑器操作）。
  useEffect(() => {
    if (playing || starting) playBtnRef.current?.focus()
  }, [playing, paused, starting])

  return (
    // adj87：试听时保持看谱——背景不遮罩（maskDim=0）、点击遮罩不关闭（仅 ✕ / Esc）
    // adj158/326：宽屏按编辑区方位停靠到左下/右下角（打开即停靠）；窄屏保持原样；用户可拖动自定义位置
    <Modal title="试听播放" maskDim={0} closeOnMaskClick={false} dock={dockPos} compact>
      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{header.titles[0] ?? '未命名'}</span>
          {header.authors.length > 0 && (
            <span style={{ color: 'var(--jp-text-secondary)' }}>{header.authors.join('；')}</span>
          )}
          <span style={{ color: 'var(--jp-text-muted)', marginLeft: 'auto' }}>
            {header.key ? `${header.key}调` : ''}
            {header.meter ? ` ${header.meter}` : ''}
          </span>
        </div>

        {/* 主体：左「设置框(速度/音色/说明)」 + 右「播放/停止(上下排列)」 */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'stretch', gap: 8 }}>
          {/* 左：设置框 */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '8px 10px',
              border: '1px solid var(--jp-border)',
              borderRadius: 8,
            }}
          >
            {/* 速度 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--jp-text-secondary)', flexShrink: 0 }}>速度</span>
              <select
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                disabled={playing}
                style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {!BPM_OPTIONS.includes(bpm) && <option value={bpm}>{bpm} 拍/分（按乐谱）</option>}
                {BPM_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} 拍/分
                  </option>
                ))}
              </select>
            </div>
            {/* 音色：固定 SpessaSynth 高保真——只列用户启用的收藏音色（adj332/344） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0 }}>{playbackCopy.synthLabel}</span>
              <select
                value={playbackHqVoice ?? ''}
                onChange={(e) => setPlaybackHqVoice(e.target.value === '' ? null : Number(e.target.value))}
                disabled={playing}
                style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {/* adj366：默认项 = 自动（跟随谱面声部/乐器）——也是未选择时的默认值 */}
                <option value="">{playbackCopy.voiceAuto}</option>
                {GM_VOICE_OPTIONS.filter((v) => playbackHqEnabled.includes(v.program)).map((v) => (
                  <option key={v.program} value={v.program}>{v.label}</option>
                ))}
              </select>
              <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                {samplerState === 'loading' ? playbackCopy.loading : samplerState === 'failed' ? playbackCopy.failedFallback : ''}
              </span>
            </div>
            {playbackHqVoice !== null && (
              // adj448：选定具体音色时说明它会覆盖谱面 `Y:`（用户曾据此误判「多声部 Y: 不生效」）
              <div style={{ color: 'var(--jp-text-muted)', fontSize: 11, lineHeight: 1.4 }}>
                {playbackCopy.voiceOverrideHint}
              </div>
            )}
            {playbackHqEnabled.length === 0 && (
              <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>尚未启用音色——请到「设置 → 音色库」勾选要试听的音色</div>
            )}
            {/* adj347/348：首次自动下载音源——后台进行，仅文字提示，不阻塞其它操作 */}
            {downloading && (
              <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>
                ⏳ 正在后台下载音色库（约30MB，仅首次）…下载期间可正常操作。
              </div>
            )}
            {/* adj416：桌面端随安装包内置音源（安装目录 generaluser_gs.sf2）→ 直接使用，不提示下载 */}
            {builtinBank && !downloading && (
              <div style={{ color: 'var(--jp-text-muted)', fontSize: 11 }}>{playbackCopy.builtinBankHint}</div>
            )}

            <div style={{ color: 'var(--jp-text-muted)', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>反复/跳房子自动展开 · 音色「自动」时按谱面声部/乐器路由 · 播放中音符高亮</span>
              {totalMs > 0 && !playing && <span>总时长 {(totalMs / 1000).toFixed(1)}s</span>}
            </div>
            {/* adj293：播放异常提示（不再静默失败） */}
            {playError && (
              <div style={{ color: 'var(--jp-danger)', fontSize: 11, marginTop: 2 }}>✗ 播放失败：{playError}</div>
            )}
          </div>

          {/* 右：播放 / 暂停 / 停止（上下排列，垂直居中） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
            {/* adj170：播放按钮与停止按钮风格一致（去掉 primary 强调样式）
                adj408：按钮图标改用 public/icons/*.png（播放/暂停/停止），与顶栏同一套上色（mask + currentColor）
                adj409：播放键改**开关**——播放中显示「暂停」（暂停.png），按一下暂停；暂停后显示「继续」（播放.png）
                       再按恢复；点击后焦点留在本按钮，空格即可暂停/继续 */}
            <button
              ref={playBtnRef}
              className="btn"
              onClick={onPlayToggle}
              /* adj409：准备期**不用 `disabled`**——被禁用的按钮会立刻失去焦点，
                 而"点播放后焦点留在本按钮、空格即可暂停/继续"正是本需求；
                 改为 `aria-busy` + 降透明度提示忙碌，连点由 onPlayToggle 里的 starting 守卫拦掉 */
              aria-busy={starting}
              aria-label={playing && !paused ? '暂停' : playing && paused ? '继续播放' : '播放'}
              title={
                starting
                  ? '正在准备音源…'
                  : playing && !paused
                    ? '暂停（或按空格）'
                    : playing && paused
                      ? '继续播放（或按空格）'
                      : '开始试听（或按空格）'
              }
              style={{
                padding: '4px 14px',
                fontSize: 12,
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                opacity: starting ? 0.7 : 1,
                cursor: starting ? 'default' : 'pointer',
              }}
            >
              <ToolIcon name={playing && !paused ? 'pause' : 'play'} size={14} />
              {starting ? '准备中…' : playing && !paused ? '暂停' : playing && paused ? '继续' : '播放'}
            </button>
            <button
              className="btn"
              onClick={stop}
              disabled={!playing}
              title="停止并回到开头"
              style={{ padding: '4px 14px', fontSize: 12, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
            >
              <ToolIcon name="stop" size={14} />
              停止
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
