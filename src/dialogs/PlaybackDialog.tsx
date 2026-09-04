/**
 * dialogs/PlaybackDialog.tsx — 试听播放
 *
 * 能力：速度 30~240 拍/分（默认取 J 描述头）；「模式」下拉（合成快速 / 采样高质量）
 * 与「音色库」下拉（采样时选具体库，adj323 拆分，两域不再混用）；播放/停止；
 * 播放中音符高亮 + 自动滚屏（复用 M3 联动）；反复记号展开。
 * adj323：① 合成乐器（快速试听）与采样色库（高质量试听）拆成独立下拉；
 * ② 选择持久化到 uiStore（记住用户上次偏好）；③ 离线时仅可播放已缓存库。
 * adj158：① 内容压缩缩小对话框；② 播放时停靠窗口右下角让开预览区；
 * ③ 播放中双击谱面音符 → 快速跳到该处重新播放（PreviewPane 通过 playbackTick 触发）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { playbackCopy } from '../brand/copy'
import { createSamplerCache, prefetchLibrary, libraryCached } from '../playback/samplerCache'
import { SpessaSynthBackend, HQ_LIBRARIES, getHqLibrary, loadHqBank, GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'
import { createHqCache } from '../playback/spessaCache'
import {
  layoutScore,
  buildPlaySequence,
  inferBpm,
  createBackend,
  schedulePlay,
  INSTRUMENT_OPTIONS,
  SAMPLER_LIBRARIES,
  getSamplerLibrary,
  classifyNetwork,
} from '@ijipu/engine'
import type { SamplerBackend, SamplerCache, NetworkClass } from '@ijipu/engine'

const BPM_OPTIONS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200]

/** 当前联网分类（在线事件实时刷新；P1 用其控制「预缓存大库」开关） */
function currentNetworkClass(): NetworkClass {
  try {
    const nav = navigator as Navigator & { connection?: { type?: string; effectiveType?: string; downlink?: number } }
    return classifyNetwork({
      online: navigator.onLine,
      type: nav.connection?.type,
      effectiveType: nav.connection?.effectiveType,
      downlink: nav.connection?.downlink,
    })
  } catch {
    return classifyNetwork({ online: true })
  }
}

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
  // adj323：试听偏好（持久化——记住用户上次选择）
  const playbackMode = useUiStore((s) => s.playbackMode)
  const setPlaybackMode = useUiStore((s) => s.setPlaybackMode)
  const playbackSynthInstrument = useUiStore((s) => s.playbackSynthInstrument)
  const setPlaybackSynthInstrument = useUiStore((s) => s.setPlaybackSynthInstrument)
  const playbackSamplerLibrary = useUiStore((s) => s.playbackSamplerLibrary)
  const setPlaybackSamplerLibrary = useUiStore((s) => s.setPlaybackSamplerLibrary)
  // adj330：SpessaSynth 音源库 + 全局音色（GM program）
  const playbackHqLibrary = useUiStore((s) => s.playbackHqLibrary)
  const setPlaybackHqLibrary = useUiStore((s) => s.setPlaybackHqLibrary)
  const playbackHqVoice = useUiStore((s) => s.playbackHqVoice)
  // adj332：已启用音色集合——试听音色下拉只列这些（避免 128 项全列）
  const playbackHqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const setPlaybackHqVoice = useUiStore((s) => s.setPlaybackHqVoice)
  // adj326：左右拆分方位（previewLeft=左预览右编辑 / editorLeft=左编辑右预览）
  const splitHDir = useUiStore((s) => s.splitHDir)
  // adj323：宽/窄屏（≤1024px 视为窄屏模式，adj322）——角落停靠仅宽屏生效，窄屏保持原样
  const isNarrowMode = useUiStore((s) => s.isNarrow)
  // adj327：采样加载失败时用 toast 明确告知原因（不再仅复位后静默）
  const showNotice = useUiStore((s) => s.showNotice)

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  const [playing, setPlaying] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)
  // adj323：采样库缓存状态（cached/notcached），按库 id 记录
  const [cacheState, setCacheState] = useState<Record<string, 'cached' | 'notcached'>>({})
  // adj323：正在预缓存的库 id（null=当前无预缓存动作）
  const [caching, setCaching] = useState<string | null>(null)
  const [networkClass, setNetworkClass] = useState<NetworkClass>(currentNetworkClass)
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

  // adj323：联网状态实时刷新（online/offline 事件）
  useEffect(() => {
    const update = () => setNetworkClass(currentNetworkClass())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const conn = (navigator as Navigator & { connection?: EventTarget }).connection
    conn?.addEventListener?.('change', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      conn?.removeEventListener?.('change', update)
    }
  }, [])

  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null)
  // adj323：采样库离线缓存（惰性创建——Tauri 桌面→文件系统；否则→IndexedDB）
  const cacheRef = useRef<SamplerCache | null>(null)
  // adj331：SpessaSynth 音源缓存 ref（惰性）
  const hqCacheRef = useRef<ReturnType<typeof createHqCache> | null>(null)
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
  const samplerLib = getSamplerLibrary(playbackSamplerLibrary)
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
  // adj323：采样库离线缓存（惰性创建，首次使用时定位环境）
  const cache = (cacheRef.current ??= createSamplerCache())
  // adj331：SpessaSynth 音源缓存（IndexedDB，供「音色库管理」下载的 SF2 复用）
  const hqCache = (hqCacheRef.current ??= createHqCache())

  // adj323：刷新某库缓存状态（写入 cacheState）
  const refreshCacheState = async (libId: string) => {
    const hit = await libraryCached(getSamplerLibrary(libId), cache).catch(() => false)
    setCacheState((prev) => ({ ...prev, [libId]: hit ? 'cached' : 'notcached' }))
  }
  // 选中库变化 → 刷新其缓存状态
  useEffect(() => {
    void refreshCacheState(samplerLib.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samplerLib.id])
  // adj323：预缓存当前选中库
  const cacheCurrent = async () => {
    setCaching(samplerLib.id)
    try {
      await prefetchLibrary(samplerLib, cache)
    } catch {
      /* 下载失败——离线/网络异常，交由播放回退处理 */
    }
    setCaching(null)
    void refreshCacheState(samplerLib.id)
  }
  // adj323：预缓存全部库（WIFI 下批量下载）
  const cacheAll = async () => {
    setCaching('*')
    try {
      for (const l of SAMPLER_LIBRARIES) await prefetchLibrary(l, cache)
    } finally {
      setCaching(null)
      for (const l of SAMPLER_LIBRARIES) void refreshCacheState(l.id)
    }
  }

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
      const wantHq = playbackMode === 'samplerHq'
      const wantSamplerNow = playbackMode === 'sampler'
      const libNow = getSamplerLibrary(playbackSamplerLibrary)
      let backend = backendRef.current
      if (wantHq) {
        // adj328：SpessaSynth 高质量采样（SF2/SF3/DLS，worklet 合成器）
        if (!backend || !(backend as SpessaSynthBackend).hq) {
          backendRef.current?.dispose()
          backend = new SpessaSynthBackend()
          backendRef.current = backend
          await (backend as unknown as { ready?: () => Promise<void> }).ready?.()
          await new Promise((r) => setTimeout(r, 200))
        }
        setSamplerState('loading')
        try {
          const hqLib = getHqLibrary(playbackHqLibrary)
          // adj331：优先用「音色库管理」下载的缓存，未缓存则联网下载并写回缓存
          let bank = await hqCache.load(hqLib.id)
          if (!bank) {
            bank = await loadHqBank(hqLib)
            await hqCache.save(hqLib.id, bank)
          }
          await (backend as SpessaSynthBackend).load(bank)
          ;(backend as SpessaSynthBackend).setVoice(playbackHqVoice)
          setSamplerState('ready')
        } catch (e) {
          setSamplerState('failed')
          backendRef.current?.dispose()
          backend = createBackend('synth')
          backendRef.current = backend
          setPlaybackMode('synth')
          showNotice(`音源下载失败，已回退合成：${e instanceof Error ? e.message : String(e)}`, 'error')
        }
      } else {
        // adj323：后端 kind 不匹配或采样库切换（库 id 变化）→ 重建后端
        const needBuild =
          wantSamplerNow
            ? !backend ||
              backend.kind !== 'sampler' ||
              (backend as SamplerBackend).library.id !== libNow.id
            : !backend || backend.kind !== 'synth'
        if (needBuild) {
          backendRef.current?.dispose()
          backend = createBackend(
            wantSamplerNow ? 'sampler' : 'synth',
            wantSamplerNow ? libNow : undefined,
            wantSamplerNow ? cache : undefined,
          )
          backendRef.current = backend
          // adj308：等待 AudioContext 创建/resume 完成（避免首拍漏播 + 旧 ctx 叠加杂音）
          await (backend as unknown as { ready?: () => Promise<void> }).ready?.()
          // adj309：给听者/演奏准备时间——按下播放后延迟 200ms 才出第一声
          await new Promise((r) => setTimeout(r, 200))
        }
        if (wantSamplerNow) {
          setSamplerState('loading')
          try {
            await (backend as SamplerBackend).load()
            setSamplerState('ready')
          } catch (e) {
            setSamplerState('failed')
            // 回退到合成音色（自动路由）
            backendRef.current?.dispose()
            backend = createBackend('synth')
            backendRef.current = backend
            setPlaybackMode('synth')
            // adj327：明确告知加载失败原因（网络/CORS/解码），便于定位
            showNotice(`采样音色加载失败，已回退合成：${e instanceof Error ? e.message : String(e)}`, 'error')
          }
        }
      }
      // 构建序列（含反复展开；adj88：双击谱面音符定位试听起点）
      // adj310：声音/色块统一的准备延迟（毫秒）——按下播放后延迟才出第一声，色块同步
      const PLAY_FIRST_DELAY_MS = 200
      const layout = layoutScore(parseResult, pageConfig)
      const seq = buildPlaySequence(parseResult, layout, bpm, playbackStartId)
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
      // adj323：全局乐器覆盖（仅合成模式；auto = 按声部名自动路由；采样后端忽略）
      const globalInst = !wantSamplerNow && playbackSynthInstrument !== 'auto' ? playbackSynthInstrument : undefined
      // adj285：不再用 onNote 同步设置 activeNoteId（循环内逐事件 set → 批处理后为最后一事件）
      // adj309：按下播放后延迟 200ms 才出第一声——给听者准备时间 + 让 ctx resume 完成
      const job = schedulePlay(seq, backend!, undefined, globalInst, PLAY_FIRST_DELAY_MS)
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

        {/* 主体：左「设置框(速度/模式/音色/说明)」 + 右「播放/停止(上下排列)」 */}
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
            {/* 速度 + 模式上下两行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--jp-text-secondary)', flexShrink: 0 }}>速度</span>
              <select
                value={bpm}
                onChange={(e) => setBpm(Number(e.target.value))}
                disabled={playing}
                style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {BPM_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v} 拍/分
                  </option>
                ))}
              </select>
            </div>
            {/* 模式：合成（快速）/ 采样（高质量）——决定后端 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--jp-text-secondary)', flexShrink: 0 }}>模式</span>
              <select
                value={playbackMode}
                onChange={(e) => setPlaybackMode(e.target.value as 'synth' | 'sampler' | 'samplerHq')}
                disabled={playing}
                style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
              >
                <option value="synth">{playbackCopy.modeSynth}</option>
                <option value="sampler">{playbackCopy.modeSampler}</option>
                <option value="samplerHq">{playbackCopy.modeSamplerHq}</option>
              </select>
            </div>
            {/* 音色 / 音色库（按模式动态显示） */}
            {playbackMode === 'samplerHq' ? (
              // adj330：SpessaSynth 高保真采样——音源库下拉 + GM 音色下拉
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0 }}>{playbackCopy.samplerLabel}</span>
                  <select
                    value={getHqLibrary(playbackHqLibrary).id}
                    onChange={(e) => setPlaybackHqLibrary(e.target.value)}
                    disabled={playing}
                    style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
                  >
                    {HQ_LIBRARIES.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                    {samplerState === 'loading' ? playbackCopy.loading : samplerState === 'failed' ? playbackCopy.failedFallback : ''}
                  </span>
                </div>
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
                </div>
                {playbackHqEnabled.length === 0 && (
                  <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>尚未启用音色——请到「音色库」管理勾选要试听的音色</div>
                )}
              </>
            ) : playbackMode === 'sampler' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0 }}>{playbackCopy.samplerLabel}</span>
                  <select
                    value={samplerLib.id}
                    onChange={(e) => setPlaybackSamplerLibrary(e.target.value)}
                    disabled={playing}
                    style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
                  >
                    {SAMPLER_LIBRARIES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                    {samplerState === 'loading' ? playbackCopy.loading : samplerState === 'failed' ? playbackCopy.failedFallback : ''}
                  </span>
                </div>
                {/* adj323：缓存状态 + 预缓存（WIFI 下可先下载，离线也能试听） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                    {cacheState[samplerLib.id] === 'cached' ? `✓ ${playbackCopy.cacheCached}` : playbackCopy.cacheMiss} · {(samplerLib.sizeBytes / 1_000_000).toFixed(1)}MB
                  </span>
                  <button
                    className="btn"
                    onClick={() => void cacheCurrent()}
                    disabled={playing || caching !== null || networkClass === 'offline'}
                    style={{ padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {caching === samplerLib.id ? playbackCopy.caching : playbackCopy.cacheButton}
                  </button>
                  <button
                    className="btn"
                    onClick={() => void cacheAll()}
                    disabled={playing || caching !== null || networkClass === 'offline'}
                    style={{ padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {caching === '*' ? playbackCopy.caching : playbackCopy.cacheAllButton}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0 }}>{playbackCopy.synthLabel}</span>
                <select
                  value={playbackSynthInstrument}
                  onChange={(e) => setPlaybackSynthInstrument(e.target.value)}
                  disabled={playing}
                  style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
                >
                  {INSTRUMENT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ color: 'var(--jp-text-muted)', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>反复/跳房子自动展开 · 多声部按声部名路由音色 · 播放中音符高亮</span>
              {totalMs > 0 && !playing && <span>总时长 {(totalMs / 1000).toFixed(1)}s</span>}
            </div>
            {/* adj323：离线提示——仅能播放已缓存库 */}
            {networkClass === 'offline' && (
              <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>⚠ {playbackCopy.offline}</div>
            )}
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
