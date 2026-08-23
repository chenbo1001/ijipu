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
} from '../engine'
import type { BackendKind } from '../engine'

const BPM_OPTIONS = [40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 160, 180, 200]

export function PlaybackDialog() {
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const playbackStartId = useUiStore((s) => s.playbackStartId)
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)
  const playbackTick = useUiStore((s) => s.playbackTick)

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  const [kind, setKind] = useState<BackendKind>('synth')
  const [playing, setPlaying] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)

  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  // adj158：播完自动复位（playing=false → 对话框回中央）
  const doneTimerRef = useRef<number | null>(null)

  const header = parseResult.header

  // 关闭时停止播放
  useEffect(() => {
    return () => {
      cancelRef.current?.()
      if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
      backendRef.current?.dispose()
      setActiveNoteId(null)
    }
  }, [setActiveNoteId])

  const stop = () => {
    cancelRef.current?.()
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
    backendRef.current?.stop()
    setPlaying(false)
    setActiveNoteId(null)
  }

  const play = async () => {
    stop()
    let backend = backendRef.current
    if (!backend || backend.kind !== kind) {
      backendRef.current?.dispose()
      backend = createBackend(kind)
      backendRef.current = backend
    }
    if (kind === 'sampler') {
      setSamplerState('loading')
      try {
        await (backend as import('../engine').SamplerBackend).load()
        setSamplerState('ready')
      } catch {
        setSamplerState('failed')
        // 回退到合成音色
        backendRef.current?.dispose()
        backend = createBackend('synth')
        backendRef.current = backend
        setKind('synth')
      }
    }
    // 构建序列（含反复展开；adj88：双击谱面音符定位试听起点）
    const layout = layoutScore(parseResult, pageConfig)
    const seq = buildPlaySequence(parseResult, layout, bpm, playbackStartId)
    setTotalMs(seq.totalMs)
    const job = schedulePlay(seq, backend, (placed) => {
      setActiveNoteId(placed.id.page + '_' + placed.id.voice + '_' + placed.id.group + '_' + placed.id.index)
    })
    cancelRef.current = job.cancel
    setPlaying(true)
    // adj158：播放结束后自动复位（playing=false，对话框从右下角回中央）
    if (doneTimerRef.current !== null) window.clearTimeout(doneTimerRef.current)
    doneTimerRef.current = window.setTimeout(() => {
      doneTimerRef.current = null
      setPlaying(false)
      setActiveNoteId(null)
    }, seq.totalMs + 300)
    // 起点播放后清除标记，下次播放从头开始
    if (playbackStartId) setPlaybackStart(null)
  }

  // adj158：播放中双击谱面音符 → 从该音符重新播放（PreviewPane 递增 playbackTick）。
  // 仅在「正在播放」时响应，避免首次打开对话框时误自动播放。
  const firstTick = useRef(playbackTick)
  const playingRef = useRef(playing)
  playingRef.current = playing
  useEffect(() => {
    if (playbackTick === firstTick.current) return
    firstTick.current = playbackTick
    if (playbackTick > 0 && playingRef.current) void play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackTick])

  return (
    // adj87：试听时保持看谱——背景不遮罩（maskDim=0）、点击遮罩不关闭（仅 ✕ / Esc）
    // adj158：播放时停靠窗口右下角（dock），让开预览区域；用户可拖动自定义位置
    <Modal title="试听播放" maskDim={0} closeOnMaskClick={false} dock={playing ? 'bottom-right' : undefined} compact>
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

        <div
          style={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            border: '1px solid var(--jp-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--jp-text-secondary)' }}>速度</span>
            <select
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              disabled={playing}
              style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
            >
              {BPM_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} 拍/分
                </option>
              ))}
            </select>
            <span style={{ color: 'var(--jp-text-muted)' }}>音色</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as BackendKind)}
              disabled={playing}
              style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
            >
              <option value="synth">合成</option>
              <option value="sampler">采样</option>
            </select>
            {kind === 'sampler' && samplerState !== 'ready' && (
              <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)' }}>
                {samplerState === 'loading' ? '加载中…' : samplerState === 'failed' ? '已回退合成' : ''}
              </span>
            )}
            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              <button className="btn primary" onClick={() => void play()} disabled={playing} style={{ padding: '3px 12px', fontSize: 12 }}>
                {playing ? '播放中…' : '▶ 播放'}
              </button>
              <button className="btn" onClick={stop} disabled={!playing} style={{ padding: '3px 12px', fontSize: 12, marginLeft: 6 }}>
                ■ 停止
              </button>
            </span>
          </div>

          <div style={{ color: 'var(--jp-text-muted)', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>反复/跳房子自动展开 · 播放中音符高亮</span>
            {totalMs > 0 && !playing && <span>总时长 {(totalMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
