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
import { DynamicAudioPlayer } from '../export/video/audioPlayer'
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
  /** adj1044：从试听「标记段」进来时只要这一段（null = 整曲） */
  const range = useUiStore((s) => s.dynamicVideoRange)
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
  /** 预览声音正在离线渲染（首次要下音色库/渲染，按钮先禁用） */
  const [preparingAudio, setPreparingAudio] = useState(false)
  /** 超过 3 分钟时：是否导整首（默认不勾 ⇒ 两边都截到 3 分钟） */
  const [fullLength, setFullLength] = useState(false)
  const cacheRef = useRef<ReturnType<typeof createHqCache> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** 预览声音：与画面共用同一份事件序列；以 AudioContext 为母钟 */
  const audioPlayerRef = useRef<DynamicAudioPlayer | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioLoadRef = useRef<Promise<AudioBuffer | null> | null>(null)
  /** 音轨对应的事件身份：换画布不重渲染；重新载入/换标记段才作废 */
  const audioKeyRef = useRef('')
  /** 闭包里读"当前是否带声音"（避免 setState 异步导致刚勾上就播放读旧值） */
  const withAudioRef = useRef(withAudio)

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

  /**
   * 预览/导出共用的一份音轨：离线渲染整曲（含片头静音），只渲染一次。
   *
   * adj1063：预览原来完全没有声音（只跑 rAF）；现在按需渲染 AudioBuffer，
   * 播放时用 `DynamicAudioPlayer` 以 AudioContext 为时钟，音画同轴。
   * 会话在渲染期间被重建（换画布/重新载入）时丢弃旧结果，避免"声音配错画面"。
   */
  const prepareAudio = useCallback(async (): Promise<AudioBuffer | null> => {
    if (audioBufferRef.current) return audioBufferRef.current
    if (audioLoadRef.current) return audioLoadRef.current
    const s = sessionRef.current
    if (!s) return null
    const job = (async () => {
      const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
      const cache = (cacheRef.current ??= createHqCache())
      const { bank } = await resolveHqBank(lib, cache, hostBankUrl(lib.id))
      const buffer = await renderToAudioBuffer(s.events, bank, { bpm: s.bpm })
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
  }, [])

  // 打开 / 换画布 / 点重新载入 ⇒ 重建一次会话
  useEffect(() => {
    let cancelled = false
    cancelAnimationFrame(rafRef.current)
    // 重建会话时先停声；只有"事件序列真的换了"才把缓存音轨作废（换画布不重渲染）
    audioPlayerRef.current?.stop()
    const audioKey = `${reloadTick}|${range?.startId ?? ''}|${range?.endId ?? ''}`
    if (audioKeyRef.current !== audioKey) {
      audioBufferRef.current = null
      audioLoadRef.current = null
      audioKeyRef.current = audioKey
    }
    setPlaying(false)
    setStatus('busy')
    setError('')
    cursorRef.current = 0
    lastTsRef.current = 0
    sessionRef.current = null
    createDynamicSession(useDocStore.getState().code, preset, useDocStore.getState().pageConfig, undefined, {
      range,
    })
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
  }, [preset, reloadTick, paint, range])

  // 卸载时收掉动画帧
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // 预览声音播放器：AudioContext 在第一次播放时才创建（用户点击手势）
  useEffect(() => {
    const player = new DynamicAudioPlayer()
    audioPlayerRef.current = player
    return () => {
      player.destroy()
      audioPlayerRef.current = null
    }
  }, [])

  // 勾选框 → ref（播放时读最新值）
  useEffect(() => {
    withAudioRef.current = withAudio
  }, [withAudio])

  const tick = useCallback(
    (ts: number) => {
      const s = sessionRef.current
      if (!s) return
      /**
       * 有声音 ⇒ 以 AudioContext 的时间为准（音频/画面不会各走各的）；
       * 没声音（渲染失败/超过音轨/未勾选）⇒ 退回原来的墙钟推进。
       */
      const audioMs = audioPlayerRef.current?.currentMs() ?? null
      let next: number
      if (audioMs !== null) {
        next = Math.min(s.totalMs, audioMs)
      } else {
        if (lastTsRef.current === 0) lastTsRef.current = ts
        const dt = ts - lastTsRef.current
        lastTsRef.current = ts
        next = Math.min(s.totalMs, cursorRef.current + dt)
      }
      cursorRef.current = next
      paint(next)
      if (next >= s.totalMs) {
        setPlaying(false)
        audioPlayerRef.current?.pause()
        lastTsRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [paint],
  )

  /**
   * 从 `from` 开始放：先把声音准备好（首次渲染可能几秒），再让音频与画面同时起步。
   * 音轨失败时只在状态栏提示，画面继续静音播放（不让"没声音"把预览卡死）。
   */
  const startPlayback = useCallback(
    async (from: number) => {
      const s = sessionRef.current
      if (!s) return
      // 必须在用户点击的同步栈里解锁 AudioContext（首次要等离线渲染好几秒）
      if (withAudioRef.current) {
        try {
          audioPlayerRef.current?.unlock()
        } catch {
          // 环境不支持/被策略拦：走无声播放，下面 play() 会返回 false
        }
      }
      setPreparingAudio(true)
      let audioStarted = false
      try {
        if (withAudioRef.current) {
          const buffer = await prepareAudio()
          if (buffer) audioStarted = (await audioPlayerRef.current?.play(from)) ?? false
        }
      } catch (e) {
        setError(
          `${dynamicVideoCopy.previewAudioFailed}：${e instanceof Error ? e.message : String(e)}`,
        )
      }
      if (!audioStarted) audioPlayerRef.current?.stop()
      if (from >= s.totalMs) {
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

  /**
   * 导出 MP4：逐帧编码（WebCodecs 硬件编码 + mp4-muxer 封装）。
   * 上限 3 分钟——与方案一致，超出只导前 3 分钟（界面有提示）。
   */
  const exportVideo = async () => {
    const s = sessionRef.current
    if (!s || encoding) return
    setPlaying(false)
    audioPlayerRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    setEncoding(true)
    setProgress(0)
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // 音轨：与画面同一份事件序列、同一个 bpm（离线渲染 ⇒ 长度确定，不随机器快慢）
      // adj1063：与预览共用 `prepareAudio()`，只渲染一次；片头静音由 audio.ts 保证不被跳过
      let audio: AudioBuffer | null = null
      if (withAudio) {
        setPhase('正在渲染音轨…')
        try {
          audio = await prepareAudio()
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

  const toggle = () => {
    const s = sessionRef.current
    if (!s) return
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
          <button
            type="button"
            className="btn"
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
                // 拖动时声音跟着跳：先停旧源，再从新位置起播
                audioPlayerRef.current?.pause()
                void startPlayback(t)
              }
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
              disabled={encoding || preparingAudio}
              onChange={(e) => {
                const on = e.target.checked
                withAudioRef.current = on
                setWithAudio(on)
                if (!on) {
                  audioPlayerRef.current?.pause()
                } else if (playing) {
                  // 播放中打开声音：先停画面，等音频准备好再从当前帧一起起步（避免回跳）
                  audioPlayerRef.current?.pause()
                  setPlaying(false)
                  cancelAnimationFrame(rafRef.current)
                  void startPlayback(cursorRef.current)
                }
              }}
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
            {preparingAudio
              ? dynamicVideoCopy.preparingAudio
              : encoding
                ? phase
                : range
                  ? '标记段导出（一遍，跳过片头）'
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
