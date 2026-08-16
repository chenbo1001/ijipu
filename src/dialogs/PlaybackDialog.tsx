/**
 * dialogs/PlaybackDialog.tsx — 试听播放
 *
 * 能力：速度 30~240 拍/分（默认取 J 描述头）；合成/采样音色切换；
 * 播放/停止；播放中音符高亮 + 自动滚屏（复用 M3 联动）；反复记号展开。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
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

  const defaultBpm = useMemo(() => inferBpm(parseResult), [parseResult])
  const [bpm, setBpm] = useState(defaultBpm)
  const [kind, setKind] = useState<BackendKind>('synth')
  const [playing, setPlaying] = useState(false)
  const [samplerState, setSamplerState] = useState<string>('idle')
  const [totalMs, setTotalMs] = useState(0)

  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const header = parseResult.header

  // 关闭时停止播放
  useEffect(() => {
    return () => {
      cancelRef.current?.()
      backendRef.current?.dispose()
      setActiveNoteId(null)
    }
  }, [setActiveNoteId])

  const stop = () => {
    cancelRef.current?.()
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
    // 构建序列（含反复展开）
    const layout = layoutScore(parseResult, pageConfig)
    const seq = buildPlaySequence(parseResult, layout, bpm)
    setTotalMs(seq.totalMs)
    const job = schedulePlay(seq, backend, (placed) => {
      setActiveNoteId(placed.id.page + '_' + placed.id.voice + '_' + placed.id.group + '_' + placed.id.index)
    })
    cancelRef.current = job.cancel
    setPlaying(true)
  }

  return (
    <Modal title="试听播放">
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{header.titles[0] ?? '未命名'}</div>
        {header.authors.length > 0 && (
          <div style={{ color: 'var(--jp-text-secondary)' }}>{header.authors.join('；')}</div>
        )}
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>
          调式 {header.key ?? '—'} · 拍号 {header.meter ?? '—'} · 默认拍速 {defaultBpm} 拍/分
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            border: '1px solid var(--jp-border)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 60, color: 'var(--jp-text-secondary)' }}>速度</span>
            <select
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              disabled={playing}
              style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '4px 8px' }}
            >
              {BPM_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} 拍/分
                </option>
              ))}
            </select>
            <span style={{ marginLeft: 'auto' }} className="play-buttons">
              <button className="btn primary" onClick={() => void play()} disabled={playing}>
                {playing ? '播放中…' : '▶ 播放'}
              </button>
              <button className="btn" onClick={stop} disabled={!playing} style={{ marginLeft: 8 }}>
                ■ 停止
              </button>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 60, color: 'var(--jp-text-secondary)' }}>音色</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as BackendKind)}
              disabled={playing}
              style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '4px 8px' }}
            >
              <option value="synth">合成音色（默认 · 零依赖）</option>
              <option value="sampler">钢琴采样（实验性 · 需网络）</option>
            </select>
            {kind === 'sampler' && (
              <span style={{ color: samplerState === 'failed' ? 'var(--jp-danger)' : 'var(--jp-text-muted)', fontSize: 12 }}>
                {samplerState === 'loading' && '加载采样中…'}
                {samplerState === 'ready' && '采样就绪'}
                {samplerState === 'failed' && '采样加载失败，已回退合成音色'}
              </span>
            )}
          </div>

          <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>
            支持反复记号（|: :| 两遍、跳房子 [ ] 第一遍/第二遍）、终止线 ||；播放中谱面音符高亮并自动滚动
            {totalMs > 0 && !playing && ` ｜ 总时长 ${(totalMs / 1000).toFixed(1)}s`}
          </div>
        </div>
      </div>
    </Modal>
  )
}
