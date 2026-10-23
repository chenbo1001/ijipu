/**
 * preview/DynamicFrameOverlay.tsx — 预览区的**动态谱相机位**（adj1065，合并 adj1033 + adj1031）
 *
 * 用户口径：
 *  - 取消独立的「动态视频预览」弹窗；导出菜单的「动态谱视频」和试听里的「导出标记段」
 *    都只打开**预览区这块相机位**；
 *  - 框里是成片画面（同一份 `createDynamicSession`，与导出逐像素同源），
 *    后方静态预览压暗做背景；播放/进度/比例/时长/声音/生成视频都在**框外暗部**；
 *  - 片头先**静止 3 秒描述头**，再用 0.7 秒推近/平移到第一拍（第一拍在 3.7s）；
 *  - 预览播完整片尾（含品牌落版），与导出内容一致（adj1068）。
 *  - 片头/片尾卡片模板由“卡片”下拉框选择（adj1073），默认品牌深空蓝，样式可持久化。
 *
 * ## 为什么不直接变换后方预览的 DOM
 *
 * 动态相机的推近/换行/球在静态预览里不存在；拿静态预览做 CSS 变换等于把动态渲染
 * 再实现一遍，无法保证"框里看到的 = 导出的"。这里复用导出的那份会话画布，
 * 只做等比缩放——这才是"不重复造轮子"。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DynamicPresetId } from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useUiStore, type DynamicAspect, type DynamicCardStyleId, type DynamicMode } from '../store/uiStore'
import { dynamicVideoCopy } from '../brand/copy'
import { createDynamicSession, type DynamicSession } from '../export/video/renderer'
import { CARD_TEMPLATES, cardStyleById } from '../export/video/cardTemplates'
import { canGenerateVideo, canUseDynamicVideo } from '../export/video/capability'
import { EXPORT_MAX_MS, LEAD_IN_MS, exportDynamicVideo } from '../export/video/exportDynamic'
import { DynamicAudioPlayer } from '../export/video/audioPlayer'
import { renderToAudioBuffer } from '../export/audio'
import { createHqCache, resolveHqBank } from '../playback/spessaCache'
import { resolveActiveLibrary } from '../playback/spessaSynthBackend'
import { hostBankUrl } from '../store/hostBridge'

const ASPECTS: { id: DynamicAspect; label: string; ratio: number }[] = [
  { id: '9x16', label: '9:16', ratio: 9 / 16 },
  { id: '1x1', label: '1:1', ratio: 1 },
  { id: '16x9', label: '16:9', ratio: 16 / 9 },
]
const MODES: { id: DynamicMode; label: string }[] = [
  { id: '3min', label: dynamicVideoCopy.mode3min },
  { id: 'full', label: dynamicVideoCopy.modeFull },
]

/** 单支视频上限 / 片头时长：**唯一来源**在 `export/video/exportDynamic.ts`（界面与命令行同口径） */

export function DynamicFrameOverlay() {
  const on = useUiStore((s) => s.dynamicCamera.on)
  const aspect = useUiStore((s) => s.dynamicCamera.aspect)
  const range = useUiStore((s) => s.dynamicCamera.range)
  const mode = useUiStore((s) => s.dynamicCamera.mode)
  const setDynamicCamera = useUiStore((s) => s.setDynamicCamera)
  const cardStyle = useUiStore((s) => s.dynamicCardStyle)
  const setDynamicCardStyle = useUiStore((s) => s.setDynamicCardStyle)
  const customCardStyle = useUiStore((s) => s.dynamicCardStyleCustom)
  const openModal = useUiStore((s) => s.openModal)
  const effectiveCardStyle =
    cardStyle === 'custom' && customCardStyle ? customCardStyle : cardStyleById(cardStyle)
  /**
   * adj1078：网站/插件整块不显示相机位（连预览也不并入）；桌面壳才显示。
   * adj1077：桌面壳里生成视频还要 WebCodecs；缺 WebCodecs 时只保留预览并禁用生成。
   */
  const dynamicVideoEnabled = canUseDynamicVideo()
  const videoExportEnabled = canGenerateVideo()
  const code = useDocStore((s) => s.code)
  const pageConfig = useDocStore((s) => s.pageConfig)

  const [rect, setRect] = useState<DOMRect | null>(null)
  const [status, setStatus] = useState<'busy' | 'ready' | 'error'>('busy')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [preparingAudio, setPreparingAudio] = useState(false)
  const [encoding, setEncoding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [withAudio, setWithAudio] = useState(true)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seekRef = useRef<HTMLInputElement | null>(null)
  const metaRef = useRef<HTMLSpanElement | null>(null)
  const sessionRef = useRef<DynamicSession | null>(null)
  const cursorRef = useRef(0)
  const lastTsRef = useRef(0)
  const rafRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef<ReturnType<typeof createHqCache> | null>(null)

  const audioPlayerRef = useRef<DynamicAudioPlayer | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioLoadRef = useRef<Promise<AudioBuffer | null> | null>(null)
  const withAudioRef = useRef(withAudio)

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

  // 播放器：AudioContext 在第一次播放的点击栈里才创建
  useEffect(() => {
    const player = new DynamicAudioPlayer()
    audioPlayerRef.current = player
    return () => {
      player.destroy()
      audioPlayerRef.current = null
    }
  }, [])

  useEffect(() => {
    withAudioRef.current = withAudio
  }, [withAudio])

  /** 画某一帧；进度条/读数走 ref，避免 60fps 重渲染整棵树 */
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
        ` · ${res.frame.zoom.toFixed(1)}×`
    }
  }, [])

  /** 音源按会话渲染（预览与生成视频共用） */
  const renderAudioFor = useCallback(async (session: DynamicSession): Promise<AudioBuffer> => {
    const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
    const cache = (cacheRef.current ??= createHqCache())
    const { bank } = await resolveHqBank(lib, cache, hostBankUrl(lib.id))
    return renderToAudioBuffer(session.events, bank, { bpm: session.bpm })
  }, [])

  const prepareAudio = useCallback(async (): Promise<AudioBuffer | null> => {
    if (audioBufferRef.current) return audioBufferRef.current
    if (audioLoadRef.current) return audioLoadRef.current
    const s = sessionRef.current
    if (!s) return null
    const job = (async () => {
      const buffer = await renderAudioFor(s)
      if (sessionRef.current !== s) return null
      audioBufferRef.current = buffer
      audioPlayerRef.current?.setBuffer(buffer)
      return buffer
    })()
    audioLoadRef.current = job
    try {
      return await job
    } finally {
      audioLoadRef.current = null
    }
  }, [renderAudioFor])

  /**
   * 事件序列真的换了（源码/页面/标记段/3 分钟口径）才作废音轨；
   * 换比例不算——比例只影响相机画布，不影响声音。
   */
  useEffect(() => {
    audioPlayerRef.current?.stop()
    audioPlayerRef.current?.setBuffer(null)
    audioBufferRef.current = null
    audioLoadRef.current = null
  }, [code, pageConfig, range, mode])

  // 打开 / 换比例 / 换源码或页面 / 换范围 / 换时长 ⇒ 重建会话
  useEffect(() => {
    if (!on) return
    let cancelled = false
    cancelAnimationFrame(rafRef.current)
    audioPlayerRef.current?.stop()
    setPlaying(false)
    setPreparingAudio(false)
    setStatus('busy')
    setError('')
    cursorRef.current = 0
    lastTsRef.current = 0
    sessionRef.current = null
    createDynamicSession(code, aspect as DynamicPresetId, pageConfig, undefined, {
      range,
      leadInMs: LEAD_IN_MS,
      maxMs: mode === '3min' ? EXPORT_MAX_MS : undefined,
      cardStyle: effectiveCardStyle,
    })
      .then((s) => {
        if (cancelled) return
        sessionRef.current = s
        setStatus('ready')
        if (seekRef.current) {
          seekRef.current.max = String(Math.round(s.totalMs))
          seekRef.current.value = '0'
        }
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
  }, [on, aspect, code, pageConfig, range, mode, effectiveCardStyle, paint])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const tick = useCallback(
    (ts: number) => {
      const s = sessionRef.current
      if (!s) return
      const previewEnd = s.totalMs
      const audioMs = audioPlayerRef.current?.currentMs() ?? null
      let next: number
      if (audioMs !== null) {
        next = Math.min(previewEnd, audioMs)
      } else {
        if (lastTsRef.current === 0) lastTsRef.current = ts
        const dt = ts - lastTsRef.current
        lastTsRef.current = ts
        next = Math.min(previewEnd, cursorRef.current + dt)
      }
      cursorRef.current = next
      paint(next)
      if (next >= previewEnd) {
        setPlaying(false)
        audioPlayerRef.current?.pause()
        lastTsRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [paint],
  )

  const startPlayback = useCallback(
    async (from: number) => {
      const s = sessionRef.current
      if (!s) return
      const start = Math.max(0, Math.min(from, s.totalMs))
      // 首次要等离线渲染好几秒：必须在点击的同步栈里先解锁 AudioContext
      if (withAudioRef.current) {
        try {
          audioPlayerRef.current?.unlock()
        } catch {
          // 不支持/被策略拦 ⇒ 静音播放
        }
      }
      setPreparingAudio(true)
      let audioStarted = false
      try {
        if (withAudioRef.current) {
          const buffer = await prepareAudio()
          if (buffer) audioStarted = (await audioPlayerRef.current?.play(start)) ?? false
        }
      } catch (e) {
        setError(
          `${dynamicVideoCopy.previewAudioFailed}：${e instanceof Error ? e.message : String(e)}`,
        )
      }
      if (!audioStarted) audioPlayerRef.current?.stop()
      if (start >= s.totalMs) {
        setPlaying(false)
        setPreparingAudio(false)
        return
      }
      setPlaying(true)
      setPreparingAudio(false)
      lastTsRef.current = 0
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(tick)
    },
    [prepareAudio, tick],
  )

  const toggle = () => {
    const s = sessionRef.current
    if (!s || preparingAudio) return
    if (playing) {
      audioPlayerRef.current?.pause()
      setPlaying(false)
      cancelAnimationFrame(rafRef.current)
      lastTsRef.current = 0
      return
    }
    if (cursorRef.current >= s.totalMs) cursorRef.current = 0
    void startPlayback(cursorRef.current)
  }

  const exportVideo = async () => {
    const s = sessionRef.current
    if (!videoExportEnabled || !s || encoding) return
    setPlaying(false)
    audioPlayerRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    setEncoding(true)
    setProgress(0)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const res = await exportDynamicVideo({
        code,
        pageConfig,
        aspect: aspect as DynamicPresetId,
        mode,
        range,
        cardStyle: effectiveCardStyle,
        // 逐次导出都重新按会话渲音轨：分段/遍次变了，事件序列就不同（缓存只能按会话建）
        ...(withAudio ? { makeAudio: renderAudioFor } : {}),
        onProgress: (p, ph) => {
          setProgress(p)
          setPhase(ph)
        },
        signal: ac.signal,
      })
      const url = URL.createObjectURL(res.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `动态谱-${aspect}.mp4`
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

  const close = () => {
    if (encoding) abortRef.current?.abort()
    audioPlayerRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    setPlaying(false)
    setDynamicCamera({ on: false })
  }

  if (!on || !rect || !dynamicVideoEnabled) return null

  const spec = ASPECTS.find((a) => a.id === aspect) ?? ASPECTS[0]
  const maxH = Math.min(rect.height * 0.66, rect.height - 150)
  const maxW = rect.width * 0.9
  let h = Math.max(120, maxH)
  let w = h * spec.ratio
  if (w > maxW) {
    w = maxW
    h = w / spec.ratio
  }
  const left = rect.left + (rect.width - w) / 2
  const top = rect.top + Math.max(6, (rect.height - h) * 0.3)
  const boxH = Math.max(h, 120)
  const controlsW = Math.min(rect.width - 24, Math.max(w, 560))
  const controlsLeft = rect.left + (rect.width - controlsW) / 2
  const controlsTop = top + boxH + 10
  return (
    <div
      className="dyn-frame-layer"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div
        className="dyn-frame-box"
        style={{ left: left - rect.left, top: top - rect.top, width: w, height: boxH }}
      >
        <canvas ref={canvasRef} />
        {status !== 'ready' && (
          <div className="dyn-frame-mask">
            {status === 'busy' ? dynamicVideoCopy.preparing : error || dynamicVideoCopy.empty}
          </div>
        )}
      </div>

      <div
        className="dyn-frame-controls"
        style={{ left: controlsLeft - rect.left, top: controlsTop - rect.top, width: controlsW }}
      >
        <div className="dyn-frame-controls-row">
          <button
            type="button"
            className="btn dyn-frame-play"
            onClick={toggle}
            disabled={status !== 'ready' || preparingAudio}
          >
            {preparingAudio
              ? dynamicVideoCopy.preparingAudio
              : playing
                ? dynamicVideoCopy.pause
                : dynamicVideoCopy.play}
          </button>
          <input
            ref={seekRef}
            type="range"
            min={0}
            max={1000}
            step={10}
            disabled={status !== 'ready'}
            onChange={(e) => {
              const t = Number(e.target.value)
              cursorRef.current = t
              paint(t)
              if (playing) {
                audioPlayerRef.current?.pause()
                void startPlayback(t)
              }
            }}
          />
          <span ref={metaRef} className="dyn-frame-meta" />
          <button type="button" className="btn dyn-frame-close" onClick={close} title="关闭相机位">
            ✕
          </button>
        </div>

        <div className="dyn-frame-controls-row">
          <span className="dyn-frame-label">{dynamicVideoCopy.cardStyle}</span>
          <select
            className="dyn-frame-select"
            value={cardStyle}
            disabled={encoding || preparingAudio}
            aria-label={dynamicVideoCopy.cardStyle}
            onChange={(e) => setDynamicCardStyle(e.target.value as DynamicCardStyleId)}
          >
            {CARD_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {customCardStyle && (
              <option value="custom">{dynamicVideoCopy.cardCustomName}</option>
            )}
          </select>
          <button
            type="button"
            className="btn dyn-frame-card-edit"
            disabled={encoding || preparingAudio}
            onClick={() => openModal('cardStyle')}
          >
            {dynamicVideoCopy.cardCustom}
          </button>
          <span className="dyn-frame-meta">{effectiveCardStyle.description}</span>
        </div>

        <div className="dyn-frame-controls-row">
          <span className="dyn-frame-label">{dynamicVideoCopy.presetLabel}</span>
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`btn dyn-frame-ratio${a.id === aspect ? ' is-on' : ''}`}
              disabled={encoding || preparingAudio}
              onClick={() => setDynamicCamera({ aspect: a.id })}
            >
              {a.label}
            </button>
          ))}
          <span className="dyn-frame-label">时长</span>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`btn dyn-frame-ratio${m.id === mode ? ' is-on' : ''}`}
              disabled={encoding || preparingAudio}
              onClick={() => setDynamicCamera({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
          <label className="dock-field dyn-frame-audio">
            <input
              type="checkbox"
              checked={withAudio}
              disabled={encoding || preparingAudio}
              onChange={(e) => {
                const next = e.target.checked
                withAudioRef.current = next
                setWithAudio(next)
                if (!next) {
                  audioPlayerRef.current?.pause()
                } else if (playing) {
                  audioPlayerRef.current?.pause()
                  setPlaying(false)
                  cancelAnimationFrame(rafRef.current)
                  void startPlayback(cursorRef.current)
                }
              }}
            />
            <span>带声音</span>
          </label>
          {range ? (
            <>
              <span className="dyn-frame-label">{dynamicVideoCopy.rangeSegment}</span>
              <button
                type="button"
                className="btn"
                disabled={encoding || preparingAudio}
                onClick={() => setDynamicCamera({ range: null })}
              >
                {dynamicVideoCopy.rangeAll}
              </button>
            </>
          ) : (
            <span className="dyn-frame-label">{dynamicVideoCopy.rangeAll}</span>
          )}
          <button
            type="button"
            className="btn dyn-frame-generate"
            onClick={encoding ? () => abortRef.current?.abort() : exportVideo}
            disabled={!videoExportEnabled || status !== 'ready'}
          >
            {encoding
              ? `取消（${Math.round(progress * 100)}%）`
              : dynamicVideoCopy.exportMp4}
          </button>
          {!videoExportEnabled && (
            <span className="dyn-frame-meta dyn-frame-desktop-only">
              {dynamicVideoCopy.desktopOnly}
            </span>
          )}
          {preparingAudio && <span className="dyn-frame-meta">{dynamicVideoCopy.preparingAudio}</span>}
          {phase && <span className="dyn-frame-meta">{phase}</span>}
        </div>
        {error && <div className="dyn-frame-error">✗ {error}</div>}
      </div>
    </div>
  )
}
