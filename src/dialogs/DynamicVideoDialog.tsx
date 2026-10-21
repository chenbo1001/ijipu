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
import { dynamicVideoCopy } from '../brand/copy'
import { createDynamicSession, type DynamicSession } from '../export/video/renderer'

const PRESET_IDS: DynamicPresetId[] = ['9x16', '1x1', '16x9']

export function DynamicVideoDialog() {
  const [preset, setPreset] = useState<DynamicPresetId>('9x16')
  const [reloadTick, setReloadTick] = useState(0)
  const [status, setStatus] = useState<'busy' | 'ready' | 'error'>('busy')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)

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

  const toggle = () => {
    const s = sessionRef.current
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
          <span className="dock-muted">{dynamicVideoCopy.noSound}</span>
        </div>
      </div>
    </Modal>
  )
}
