/**
 * dialogs/PlaybackDialog.tsx — 试听播放
 *
 * 能力：速度 30~240 拍/分（默认取 J 描述头）；合成/采样音色切换；
 * 播放/停止；播放中音符高亮 + 自动滚屏（复用 M3 联动）；反复记号展开。
 * adj158：① 内容压缩缩小对话框；② 播放时停靠窗口右下角让开预览区；
 * ③ 播放中双击谱面音符 → 快速跳到该处重新播放（PreviewPane 通过 playbackTick 触发）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import {
  layoutScore,
  buildPlaySequence,
  inferBpm,
  createBackend,
  schedulePlay,
  INSTRUMENT_OPTIONS,
} from '../engine'

const BPM_OPTIONS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200]

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
  const playbackStartId = useUiStore((s) => s.playbackStartId)
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)
  const playbackTick = useUiStore((s) => s.playbackTick)

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  // adj283：音色选择——auto = 按声部名自动路由合成乐器；具体乐器 = 全局指定；sampler = 采样后端
  const [timbre, setTimbre] = useState<string>('auto')
  const [playing, setPlaying] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)
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

  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null)
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
      const wantSampler = timbre === 'sampler'
      let backend = backendRef.current
      if (!backend || backend.kind !== (wantSampler ? 'sampler' : 'synth')) {
        backendRef.current?.dispose()
        backend = createBackend(wantSampler ? 'sampler' : 'synth')
        backendRef.current = backend
        // adj308：等待 AudioContext 创建/resume 完成（避免首拍漏播 + 旧 ctx 叠加杂音）
        await (backend as unknown as { ready?: () => Promise<void> }).ready?.()
        // adj309：给听者/演奏准备时间——按下播放后延迟 200ms 才出第一声
        await new Promise((r) => setTimeout(r, 200))
      }
      if (wantSampler) {
        setSamplerState('loading')
        try {
          await (backend as import('../engine').SamplerBackend).load()
          setSamplerState('ready')
        } catch {
          setSamplerState('failed')
          // 回退到合成音色（自动路由）
          backendRef.current?.dispose()
          backend = createBackend('synth')
          backendRef.current = backend
          setTimbre('auto')
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
      // adj299/300：按「拍段」拆分——色块以音符宽度为单位、最大 1 拍（playheadSegs 每段 ≤1 拍）：
      // 增时线每拍一段、附点拆分、密集拍单段；连音合并时 playheadSegs 含被合并音符拍段
      //（如 (1 - - - | 1) - 0 0 中 1 合并 6 拍，色块依次滑过 1 - - - 1 - 0 0）
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
        // adj285：播放跟随滚动——设当前活动音符 id（首个），使色块/高亮区域保持在视口内；
        // 音符 id 不变时不触发滚动（zustand 相同值不通知），播放开始不再滚到底
        if (ids.length > 0) setActiveNoteId(ids[0])
      }
      computeActive()
      highlightTimerRef.current = window.setInterval(computeActive, 50)
      // adj283：全局乐器覆盖（auto = 按事件声部名自动路由；sampler 由采样后端忽略）
      const globalInst = timbre === 'auto' || timbre === 'sampler' ? undefined : timbre
      // adj285：不再用 onNote 同步设置 activeNoteId（循环内逐事件 set → 批处理后为最后一事件，
      // 导致开始播放时页面滚到最后）；高亮与滚动跟随均由 computeActive 负责
      // adj309：按下播放后延迟 200ms 才出第一声——给听者准备时间 + 让 ctx resume 完成
      const job = schedulePlay(seq, backend, undefined, globalInst, PLAY_FIRST_DELAY_MS)
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
    // adj158：播放时停靠窗口右下角（dock），让开预览区域；用户可拖动自定义位置
    <Modal title="试听播放" maskDim={0} closeOnMaskClick={false} dock={playing && !isNarrow ? 'bottom-right' : undefined} compact>
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

        {/* 主体：左「设置框(速度/音色/说明)」 + 右「播放/停止(上下排列)」——
            把播放/停止挪到框外右侧上下排，从而把设置框宽度收窄、整体对话框更紧凑 */}
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
            {/* 速度 + 音色上下两行（每行 label + select，select flex:1 撑满框宽）——进一步收窄对话框宽度 */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--jp-text-muted)', flexShrink: 0 }}>音色</span>
              <select
                value={timbre}
                onChange={(e) => setTimbre(e.target.value)}
                disabled={playing}
                style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12, flex: 1, minWidth: 0 }}
              >
                {INSTRUMENT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {timbre === 'sampler' && samplerState !== 'ready' && (
                <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', flexShrink: 0, fontSize: 11 }}>
                  {samplerState === 'loading' ? '加载中…' : samplerState === 'failed' ? '已回退合成' : ''}
                </span>
              )}
            </div>

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
