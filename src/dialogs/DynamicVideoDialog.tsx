/**
 * dialogs/DynamicVideoDialog.tsx — 动态谱预览（adj1031）
 *
 * 定位：**先把"看得见"这一步接到应用里**，用用户自己的谱验证动效；
 * 声音与出片（ffmpeg）是后续两步，所以这里只画画面、不编码。
 *
 * 三个刻意的取舍：
 *  1. **不随编辑实时重建**：排版 + 逐页光栅是重活（一页约 20–40ms），每敲一个字都重来会卡。
 *     ⇒ 打开时用当前源码建一次，编辑后点「重新载入当前谱」。
 *  2. **rAF 驱动、按 `cursor + dt` 推进**：`frameAt` 是纯函数，时间由这里给，所以画面与出片一致。
 *  3. **画布尺寸跟着预设走**（1080×1920 等），CSS 只做缩放 ⇒ 看到的就是将来视频的分辨率。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DYNAMIC_PRESETS, type DynamicPresetId } from '@ijipu/engine'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { dynamicVideoCopy } from '../brand/copy'
import { createDynamicSession, type DynamicSession } from '../export/video/renderer'
import { encodeMp4 } from '../export/video/mp4'
import { renderToAudioBuffer } from '../export/audio'
import { createHqCache, resolveHqBank } from '../playback/spessaCache'
import { resolveActiveLibrary } from '../playback/spessaSynthBackend'
import { hostBankUrl } from '../store/hostBridge'

const PRESET_IDS: DynamicPresetId[] = ['9x16', '1x1', '16x9']

/** 单支导出上限（3 分钟；画面与音轨**同时**截断到这个长度） */
const EXPORT_MAX_MS = 180_000

export function DynamicVideoDialog() {
  const [preset, setPreset] = useState<DynamicPresetId>('9x16')
  // adj1033：把取景框叠到预览区上看（框不动、内容走）
  const setDynamicFrame = useUiStore((s) => s.setDynamicFrame)
  const closeModal = useUiStore((s) => s.closeModal)
  const [reloadTick, setReloadTick] = useState(0)
  const [status, setStatus] = useState<'busy' | 'ready' | 'error'>('busy')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [totalMs, setTotalMs] = useState(0)
  const [encoding, setEncoding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  /** 是否带声音（默认带；音源拿不到时降级为无声并提示） */
  const [withAudio, setWithAudio] = useState(true)
  /** 超过 3 分钟时：是否导整首（默认不勾 ⇒ 两边都截到 3 分钟） */
  const [fullLength, setFullLength] = useState(false)
  const cacheRef = useRef<ReturnType<typeof createHqCache> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seekRef = useRef<HTMLInputElement | null>(null)
  const metaRef = useRef<HTMLSpanElement | null>(null)
  const sessionRef = useRef<DynamicSession | null>(null)
  const cursorRef = useRef(0)
  const lastTsRef = useRef(0)
  const rafRef = useRef(0)

  /** 画某一时刻；顺带刷新进度条与读数（**不走 state**，否则 60fps 会把整棵树重渲染一遍） */
  const paint = useCallback((t: number) => {
    const s = sessionRef.current
    const c = canvasRef.current
    if (!s || !c) return
    if (c.width !== s.width || c.height !== s.height) {
      c.width = s.width
      c.height = s.height
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    const res = s.draw(ctx, t)
    if (seekRef.current) seekRef.current.value = String(Math.round(t))
    if (metaRef.current) {
      metaRef.current.textContent =
        `${(t / 1000).toFixed(1)}s / ${(s.totalMs / 1000).toFixed(1)}s` +
        ` · ${res.following ? '跟拍' : '满宽'} ${res.frame.zoom.toFixed(1)}×`
    }
  }, [])

  // 打开 / 换画布 / 点重新载入 ⇒ 重建一次会话
  useEffect(() => {
    let cancelled = false
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setStatus('busy')
    setError('')
    cursorRef.current = 0
    lastTsRef.current = 0
    sessionRef.current = null
    createDynamicSession(useDocStore.getState().code, preset, useDocStore.getState().pageConfig)
      .then((s) => {
        if (cancelled) return
        sessionRef.current = s
        setTotalMs(s.totalMs)
        if (seekRef.current) {
          seekRef.current.max = String(Math.round(s.totalMs))
          seekRef.current.value = '0'
        }
        setStatus('ready')
        paint(0)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [preset, reloadTick, paint])

  // 卸载时收掉动画帧
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const tick = useCallback(
    (ts: number) => {
      const s = sessionRef.current
      if (!s) return
      if (lastTsRef.current === 0) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      cursorRef.current = Math.min(s.totalMs, cursorRef.current + dt)
      paint(cursorRef.current)
      if (cursorRef.current >= s.totalMs) {
        setPlaying(false)
        lastTsRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [paint],
  )

  /**
   * 导出 MP4：逐帧编码（WebCodecs 硬件编码 + mp4-muxer 封装）。
   * 上限 3 分钟——与方案一致，超出只导前 3 分钟（界面有提示）。
   */
  const exportVideo = async () => {
    const s = sessionRef.current
    if (!s || encoding) return
    setPlaying(false)
    cancelAnimationFrame(rafRef.current)
    setEncoding(true)
    setProgress(0)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // 音轨：与画面同一份事件序列、同一个 bpm（离线渲染 ⇒ 长度确定，不随机器快慢）
      let audio: AudioBuffer | null = null
      if (withAudio) {
        setPhase('正在渲染音轨…')
        try {
          const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
          const cache = (cacheRef.current ??= createHqCache())
          const { bank } = await resolveHqBank(lib, cache, hostBankUrl(lib.id))
          audio = await renderToAudioBuffer(s.events, bank, { bpm: s.bpm })
        } catch (e) {
          setError(`音轨没渲染成，本次导出无声：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      setPhase('正在编码画面…')
      const blob = await encodeMp4(s, {
        fps: 30,
        maxMs: fullLength ? undefined : EXPORT_MAX_MS,
        audio,
        signal: ac.signal,
        onProgress: setProgress,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `动态谱-${preset}.mp4`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setEncoding(false)
      setPhase('')
      abortRef.current = null
    }
  }

  const toggle = () => {    const s = sessionRef.current
    if (!s) return
    if (playing) {
      setPlaying(false)
      cancelAnimationFrame(rafRef.current)
      lastTsRef.current = 0
      return
    }
    if (cursorRef.current >= s.totalMs) cursorRef.current = 0
    setPlaying(true)
    lastTsRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
  }

  return (
    <Modal title={dynamicVideoCopy.title} width="min(880px, 96vw)">
      <div className="dynamic-video">
        <div className="dynamic-video-stage">
          <canvas ref={canvasRef} />
          {status !== 'ready' && (
            <div className="dynamic-video-mask">
              {status === 'busy' ? dynamicVideoCopy.preparing : error || dynamicVideoCopy.empty}
            </div>
          )}
        </div>
        <div className="dynamic-video-bar">
          <button type="button" className="btn" onClick={toggle} disabled={status !== 'ready'}>
            {playing ? dynamicVideoCopy.pause : dynamicVideoCopy.play}
          </button>
          <input
            ref={seekRef}
            type="range"
            min={0}
            max={1000}
            step={10}
            disabled={status !== 'ready'}
            onChange={(e) => {
              cursorRef.current = Number(e.target.value)
              paint(cursorRef.current)
            }}
          />
          <span ref={metaRef} className="dock-muted" />
        </div>
        <div className="dynamic-video-bar">
          <label className="dock-field">
            <span>{dynamicVideoCopy.presetLabel}</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as DynamicPresetId)}>
              {PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {DYNAMIC_PRESETS[id].label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => setReloadTick((v) => v + 1)}>
            {dynamicVideoCopy.reload}
          </button>
          {/* adj1033：回到预览区，用固定取景框看（框不动、内容走） */}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDynamicFrame({ on: true, aspect: preset })
              closeModal()
            }}
          >
            在预览区看取景
          </button>
          <label className="dock-field">
            <input
              type="checkbox"
              checked={withAudio}
              disabled={encoding}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
            <span>带声音</span>
          </label>
          {totalMs > EXPORT_MAX_MS && (
            <label className="dock-field">
              <input
                type="checkbox"
                checked={fullLength}
                disabled={encoding}
                onChange={(e) => setFullLength(e.target.checked)}
              />
              <span>整首</span>
            </label>
          )}
          <button
            type="button"
            className="btn"
            onClick={encoding ? () => abortRef.current?.abort() : exportVideo}
            disabled={status !== 'ready'}
            title="逐帧编码为 MP4（上限 3 分钟）"
          >
            {encoding ? `取消（${Math.round(progress * 100)}%）` : dynamicVideoCopy.exportMp4}
          </button>
          <span className="dock-muted">
            {encoding
              ? phase
              : totalMs > EXPORT_MAX_MS
                ? fullLength
                  ? '整首导出（画面与声音都完整，时长较长）'
                  : dynamicVideoCopy.overCap
                : dynamicVideoCopy.audioHint}
          </span>
          {error && !encoding && <span className="dock-error">✗ {error}</span>}
        </div>
      </div>
    </Modal>
  )
}
