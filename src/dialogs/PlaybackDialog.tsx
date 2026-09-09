/**
 * dialogs/PlaybackDialog.tsx — 试听播放（adj344：固定 SpessaSynth 高保真，移除合成/midi-js 试听）
 *
 * 能力：速度 30~240 拍/分（默认取 J 描述头）；固定 SpessaSynth 高保真音源（SF2 内置本地、
 * 首次打开即自动下载并缓存到 IndexedDB，后续直接读缓存；下载中显示进度提示）；「音色」下拉
 * 仅列用户启用的收藏音色（GM program，默认含常用音色，由「音色库管理」勾选）；播放/停止；
 * 播放中音符高亮 + 自动滚屏（复用 M3 联动）；反复记号展开。
 * adj347：① 打开试听即自动下载音源（不再要求用户先手动点下载，点播放即可用）；
 * ② 音色默认启用一组常用音色（首次即可选）。
 * adj344：试听简化：①去掉「模式/音色库」下拉（不再提供合成/采样切换），固定 SpessaSynth
 * 高保真；②play() 收敛为高保真，移除合成/midi-js 采样分支；③「音色」只列启用收藏音色。
 * adj158：① 内容压缩缩小对话框；② 播放时停靠窗口右下角让开预览区；
 * ③ 播放中双击谱面音符 → 快速跳到该处重新播放（PreviewPane 通过 playbackTick 触发）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { playbackCopy } from '../brand/copy'
import { createHqCache, prefetchHqLibraryProgress } from '../playback/spessaCache'
import { SpessaSynthBackend, getHqLibrary, GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'
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
  // adjNN：@@ 恢复默认音色=第一音色——无描述头 Y 时取试听音色列表第一个启用音色（GM program 名）
  const firstEnabledInstrumentRef = useMemo(() => {
    if (playbackHqEnabled.length === 0) return undefined
    const prog = Math.min(...playbackHqEnabled)
    const v = GM_VOICE_OPTIONS.find((o) => o.program === prog)
    return v ? v.label.replace(/^\d+\s+/, '') : undefined
  }, [playbackHqEnabled])
  // adj326：左右拆分方位（previewLeft=左预览右编辑 / editorLeft=左编辑右预览）
  const splitHDir = useUiStore((s) => s.splitHDir)
  // adj323：宽/窄屏（≤1024px 视为窄屏模式，adj322）——角落停靠仅宽屏生效，窄屏保持原样
  const isNarrowMode = useUiStore((s) => s.isNarrow)
  // adj327：加载失败时用 toast 明确告知原因（不再仅复位后静默）
  const showNotice = useUiStore((s) => s.showNotice)

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  const [playing, setPlaying] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)
  // adj347/348：音源下载中（首次打开自动后台下载；前台仅文字提示，不阻塞其它交互）
  const [downloading, setDownloading] = useState(false)
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
  const highlightTimerRef = useRef<number | null>(null)
  // adj282：RAF 驱动 currentMs（色块平滑滑动）
  const rafRef = useRef<number | null>(null)

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
  const ensureBank = (): Promise<void> => {
    if (!bankPromiseRef.current) {
      setDownloading(true)
      setSamplerState('loading')
      bankPromiseRef.current = (async () => {
        const hqLib = getHqLibrary()
        await prefetchHqLibraryProgress(hqLib, hqCache)
        setSamplerState('ready')
      })()
        .catch((e) => {
          setSamplerState('failed')
          throw e
        })
        .finally(() => {
          setDownloading(false)
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

  const stop = () => {
    cancelRef.current?.()
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
    backendRef.current?.stop()
    setPlaying(false)
    setActiveNoteId(null)
    setActiveNoteIds([])
    setVoiceBlocks([])
    setPlayheadTrack([])
    setCurrentMs(0)
  }

  const play = async () => {
    stop()
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
        const bank = await hqCache.load(hqLib.id)
        if (!bank) throw new Error('音源缓存缺失')
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
      const layout = layoutScore(parseResult, pageConfig)
      const seq = buildPlaySequence(parseResult, layout, bpm, playbackStartId, firstEnabledInstrumentRef)
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
          })),
        ),
      )
      // adj258：保存序列 + 本地启动时间，启动高亮定时器按当前 atMs 设 activeNoteIds
      seqRef.current = seq
      startTimeRef.current = performance.now() + PLAY_FIRST_DELAY_MS
      // adj282：RAF 驱动 currentMs（每帧更新 → PreviewPane 色块平滑滑动）
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      setCurrentMs(0)
      const rafLoop = () => {
        setCurrentMs(performance.now() - startTimeRef.current)
        rafRef.current = requestAnimationFrame(rafLoop)
      }
      rafRef.current = requestAnimationFrame(rafLoop)
      if (highlightTimerRef.current !== null) window.clearInterval(highlightTimerRef.current)
      const computeActive = () => {
        const cur = performance.now() - startTimeRef.current
        const ids: string[] = []
        const es = seqRef.current?.events ?? []
        for (const e of es) {
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
      // adj344：高保真音色由 setVoice(GM program) 决定，无需全局乐器覆盖参数（globalInstrument）
      // adj285：不再用 onNote 同步设置 activeNoteId（循环内逐事件 set → 批处理后为最后一事件）
      // adj309：按下播放后延迟 200ms 才出第一声——给听者准备时间 + 让 ctx resume 完成
      const job = schedulePlay(seq, backend, undefined, undefined, PLAY_FIRST_DELAY_MS)
      cancelRef.current = job.cancel
      setPlaying(true)
      setPlayError(null)
      // adj158：播放结束后自动复位（playing=false，对话框从右下角回中央）
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = window.setTimeout(() => {
        doneTimerRef.current = null
        setPlaying(false)
        setActiveNoteId(null)
        setActiveNoteIds([])
        setVoiceBlocks([])
        setPlayheadTrack([])
        setCurrentMs(0)
        if (highlightTimerRef.current !== null) {
          window.clearInterval(highlightTimerRef.current)
          highlightTimerRef.current = null
        }
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      }, job.totalMs + 100)
      // 起点播放后清除标记，下次播放从头开始
      if (playbackStartId) setPlaybackStart(null)
    } catch (e) {
      // adj293：异常显示在对话框（不再静默失败）
      setPlayError(e instanceof Error ? e.message : String(e))
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
                <option value="">自动（按声部名）</option>
                {GM_VOICE_OPTIONS.filter((v) => playbackHqEnabled.includes(v.program)).map((v) => (
                  <option key={v.program} value={v.program}>{v.label}</option>
                ))}
              </select>
              <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                {samplerState === 'loading' ? playbackCopy.loading : samplerState === 'failed' ? playbackCopy.failedFallback : ''}
              </span>
            </div>
            {playbackHqEnabled.length === 0 && (
              <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>尚未启用音色——请到「音色库管理」勾选要试听的音色</div>
            )}
            {/* adj347/348：首次自动下载音源——后台进行，仅文字提示，不阻塞其它操作 */}
            {downloading && (
              <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>
                ⏳ 正在后台下载音色库（约30MB，仅首次）…下载期间可正常操作。
              </div>
            )}

            <div style={{ color: 'var(--jp-text-muted)', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>反复/跳房子自动展开 · 多声部按声部名路由音色 · 播放中音符高亮</span>
              {totalMs > 0 && !playing && <span>总时长 {(totalMs / 1000).toFixed(1)}s</span>}
            </div>
            {/* adj293：播放异常提示（不再静默失败） */}
            {playError && (
              <div style={{ color: 'var(--jp-danger)', fontSize: 11, marginTop: 2 }}>✗ 播放失败：{playError}</div>
            )}
          </div>

          {/* 右：播放 / 停止（上下排列，垂直居中） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
            {/* adj170：播放按钮与停止按钮风格一致（去掉 primary 强调样式） */}
            <button className="btn" onClick={() => void play()} disabled={playing} style={{ padding: '4px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
              {playing ? '播放中…' : '▶ 播放'}
            </button>
            <button className="btn" onClick={stop} disabled={!playing} style={{ padding: '4px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
              ■ 停止
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
