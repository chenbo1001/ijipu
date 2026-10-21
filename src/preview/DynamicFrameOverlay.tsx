/**
 * preview/DynamicFrameOverlay.tsx — 预览区上的**取景框**（adj1033）
 *
 * 用户口径：「在预览区放一个固定比例的取景框，框不动，播放时页面在下面走」。
 * 于是这里只做三件事：
 *  1. 框外压暗（box-shadow 撑满画面的经典做法）、框边高亮；
 *  2. 框内画**相机画面**（引擎 `cameraAt`，与出片同一条渲染管线）；
 *  3. 播放 / 暂停 / 换比例 / 关闭。
 *
 * ## 为什么不直接截预览的 DOM
 *
 * 截 DOM 要重新解释 CSS/SVG（糊、慢、不可复现，窗口被挡还废）。这里用同一份
 * `createDynamicSession` 重绘——像素级等于将来导出的视频，只是尺寸小。
 *
 * ## 为什么用 `position: fixed`
 *
 * 预览区是滚动容器（`.preview-pane`），挂在里面的绝对定位元素会随内容滚走。
 * 取景框必须**钉在视口上**，所以按 `.preview-pane` 的 `getBoundingClientRect()` 定位。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore, type DynamicAspect } from '../store/uiStore'
import { createDynamicSession, type DynamicSession } from '../export/video/renderer'

const ASPECTS: { id: DynamicAspect; label: string; ratio: number }[] = [
  { id: '9x16', label: '9:16', ratio: 9 / 16 },
  { id: '1x1', label: '1:1', ratio: 1 },
  { id: '16x9', label: '16:9', ratio: 16 / 9 },
]

export function DynamicFrameOverlay() {
  const on = useUiStore((s) => s.dynamicFrame.on)
  const aspect = useUiStore((s) => s.dynamicFrame.aspect)
  const setDynamicFrame = useUiStore((s) => s.setDynamicFrame)
  const code = useDocStore((s) => s.code)
  const pageConfig = useDocStore((s) => s.pageConfig)
  /**
   * 试听时钟：有声音的那条路已经把它推进到 `currentMs` 了。
   * 取景框直接跟它 ⇒ **音画同源**，不用另写一套音频；>0 就表示试听正在跑。
   */
  const currentMs = useDocStore((s) => s.currentMs)
  const following = currentMs > 0

  const [rect, setRect] = useState<DOMRect | null>(null)
  const [status, setStatus] = useState<'busy' | 'ready' | 'error'>('busy')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sessionRef = useRef<DynamicSession | null>(null)
  const cursorRef = useRef(0)
  const lastTsRef = useRef(0)
  const rafRef = useRef(0)
  const metaRef = useRef<HTMLSpanElement | null>(null)

  // 跟着预览区的位置走（窗口缩放、布局拆分都会变）
  useEffect(() => {
    if (!on) return
    const el = document.querySelector('.preview-pane')
    if (!el) return
    const update = () => setRect(el.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [on])

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
    if (metaRef.current) {
      metaRef.current.textContent = `${(t / 1000).toFixed(1)}s / ${(s.totalMs / 1000).toFixed(1)}s · ${res.frame.zoom.toFixed(1)}×`
    }
  }, [])

  // 开启 / 换比例 / 换谱 ⇒ 重建会话
  useEffect(() => {
    if (!on) return
    let cancelled = false
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setStatus('busy')
    setError('')
    cursorRef.current = 0
    lastTsRef.current = 0
    sessionRef.current = null
    createDynamicSession(code, aspect, pageConfig)
      .then((s) => {
        if (cancelled) return
        sessionRef.current = s
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
  }, [on, aspect, code, pageConfig, paint])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // 试听在跑 ⇒ 取景框跟着它走（暂停自己的那套时钟，避免两个时钟打架）
  useEffect(() => {
    if (following) {
      cancelAnimationFrame(rafRef.current)
      setPlaying(false)
      cursorRef.current = currentMs
      paint(currentMs)
    }
  }, [following, currentMs, paint])

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

  if (!on || !rect) return null

  const spec = ASPECTS.find((a) => a.id === aspect) ?? ASPECTS[0]
  const maxH = rect.height * 0.88
  const maxW = rect.width * 0.92
  let h = maxH
  let w = h * spec.ratio
  if (w > maxW) {
    w = maxW
    h = w / spec.ratio
  }
  const left = rect.left + (rect.width - w) / 2
  const top = rect.top + (rect.height - h) / 2

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
    <div className="dyn-frame-layer" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div className="dyn-frame-box" style={{ left: left - rect.left, top: top - rect.top, width: w, height: h }}>
        <canvas ref={canvasRef} />
        {status !== 'ready' && (
          <div className="dyn-frame-mask">{status === 'busy' ? '正在准备画面…' : error || '没有可播放的音符'}</div>
        )}
        <div className="dyn-frame-bar">
          <button type="button" className="btn" onClick={toggle} disabled={status !== 'ready' || following}>
            {following ? '跟随试听' : playing ? '暂停' : '播放'}
          </button>
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`btn dyn-frame-ratio${a.id === aspect ? ' is-on' : ''}`}
              onClick={() => setDynamicFrame({ aspect: a.id })}
            >
              {a.label}
            </button>
          ))}
          <span ref={metaRef} className="dyn-frame-meta" />
          <button type="button" className="btn dyn-frame-close" onClick={() => setDynamicFrame({ on: false })} title="关闭取景框">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
