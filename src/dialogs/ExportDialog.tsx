/**
 * dialogs/ExportDialog.tsx — 导出（SVG / PNG / JPG / PDF / .jps 源文件）
 */
import { useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { layoutScore, renderScoreToSvg, buildPlaySequence, inferBpm, eventsToMidi } from '@ijipu/engine'
import { renderToAudioBuffer, audioBufferToWav, audioBufferToMp3 } from '../export/audio'
import { exportSvg, exportPng, exportJpg, exportPdf } from '../export/export'
import { createHqCache } from '../playback/spessaCache'
import { getHqLibrary, loadHqBank, firstEnabledInstrumentRef } from '../playback/spessaSynthBackend'

/** 下载字节（Blob + 临时 <a>） */
function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function ExportDialog() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  // adj354：@@ 恢复默认音色——无 Y 时用试听音色列表第一个启用音色（MIDI/音频导出与试听一致）
  const playbackHqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const defaultInstrumentRef = useMemo(() => firstEnabledInstrumentRef(playbackHqEnabled), [playbackHqEnabled])

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // adj294：图片清晰度（PNG/JPG 共用倍率，2x 标准 / 4x 高清 / 6x 超清）
  const [imgScale, setImgScale] = useState<number>(2)
  // adj345：导出用 SpessaSynth 高保真音源（IndexedDB 缓存，仅首次使用时下载并缓存）
  const hqCacheRef = useRef(createHqCache())

  // adj352：导出基名剥掉残留的 .jps/.md/.txt（手机端系统常把 .jps 识别为 .md/.txt，导致 xxx.md.jpg）
  const baseName = (fileName || '未命名').replace(/\.(jps|md|txt)$/i, '')
  const hasError = parseResult.errors.some((e) => e.severity === 'error')

  /** 取高保真音源 ArrayBuffer（缓存优先；未缓存则下载并写回缓存，后续直接读缓存） */
  const ensureHqBank = async (): Promise<ArrayBuffer> => {
    const lib = getHqLibrary()
    let bank = await hqCacheRef.current.load(lib.id)
    if (!bank) {
      bank = await loadHqBank(lib)
      await hqCacheRef.current.save(lib.id, bank)
    }
    return bank
  }

  const getPages = (): string[] => {
    if (hasError) throw new Error('存在语法错误，无法导出。请先修正脚本。')
    const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
    return renderScoreToSvg(layout)
  }

  const downloadJps = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}.jps`
    a.click()
    URL.revokeObjectURL(url)
  }

  const run = async (key: 'svg' | 'png' | 'jpg' | 'pdf' | 'midi' | 'wav' | 'mp3', fn: () => void | Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const items = [
    {
      key: 'svg' as const,
      label: 'SVG 矢量图（逐页）',
      ext: '.svg',
      run: () => run('svg', () => {
        const pages = getPages()
        pages.forEach((s, i) => exportSvg(s, pages.length > 1 ? `${baseName}-${i + 1}.svg` : `${baseName}.svg`))
      }),
    },
    {
      key: 'png' as const,
      label: 'PNG 高清图片（逐页）',
      ext: '.png',
      run: () => run('png', async () => exportPng(getPages(), baseName, imgScale)),
    },
    {
      key: 'jpg' as const,
      label: 'JPG 图片（白底，逐页）',
      ext: '.jpg',
      run: () => run('jpg', async () => exportJpg(getPages(), baseName, imgScale)),
    },
    {
      key: 'pdf' as const,
      label: 'PDF 文档（A4 打印）',
      ext: '.pdf',
      run: () => run('pdf', () => exportPdf(getPages(), baseName)),
    },
    {
      // adj289：MIDI 导出——复用播放序列（含反复展开），多声部每声部一条音轨
      key: 'midi' as const,
      label: 'MIDI 音频（多声部分轨，试听/DAW 用）',
      ext: '.mid',
      run: () => run('midi', () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        const midi = eventsToMidi(seq.events, { bpm, title: parseResult.header.titles[0] ?? baseName })
        downloadBytes(midi, `${baseName}.mid`, 'audio/midi')
      }),
    },
    {
      // adj345：WAV/MP3 音频导出——SpessaSynth 高保真离线渲染（与试听一致），任何播放器免音色库直接播放
      key: 'wav' as const,
      label: 'WAV 音频（高保真渲染，免音色库）',
      ext: '.wav',
      run: () => run('wav', async () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        const bank = await ensureHqBank()
        const buf = await renderToAudioBuffer(seq.events, bank, { bpm, title: parseResult.header.titles[0] ?? baseName })
        downloadBytes(audioBufferToWav(buf), `${baseName}.wav`, 'audio/wav')
      }),
    },
    {
      key: 'mp3' as const,
      label: 'MP3 音频（高保真渲染，体积小）',
      ext: '.mp3',
      run: () => run('mp3', async () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        const bank = await ensureHqBank()
        const buf = await renderToAudioBuffer(seq.events, bank, { bpm, title: parseResult.header.titles[0] ?? baseName })
        downloadBytes(audioBufferToMp3(buf), `${baseName}.mp3`, 'audio/mpeg')
      }),
    },
  ]

  return (
    <Modal title="导出">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* adj294：图片清晰度（PNG/JPG 导出倍率） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--jp-text-secondary)' }}>图片清晰度</span>
          <select
            value={imgScale}
            onChange={(e) => setImgScale(Number(e.target.value))}
            style={{ background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
          >
            <option value={2}>2x 标准</option>
            <option value={4}>4x 高清</option>
            <option value={6}>6x 超清</option>
          </select>
          <span style={{ color: 'var(--jp-text-muted)' }}>适用于 PNG / JPG</span>
        </div>
        {items.map((it) => (
          <button
            key={it.key}
            className="btn"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              textAlign: 'left',
            }}
            onClick={it.run}
            disabled={busy !== null}
          >
            <span>{busy === it.key ? '导出中…' : it.label}</span>
            <span style={{ fontFamily: 'var(--jp-font-mono)', color: 'var(--jp-accent)' }}>
              {it.ext}
            </span>
          </button>
        ))}
        <button
          className="btn"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left' }}
          onClick={downloadJps}
        >
          <span>iJipu 源文件</span>
          <span style={{ fontFamily: 'var(--jp-font-mono)', color: 'var(--jp-accent)' }}>.jps</span>
        </button>
        {hasError && (
          <div style={{ color: 'var(--jp-danger)', fontSize: 12 }}>
            ⚠ 当前脚本存在语法错误，图片/PDF 导出需先修正。
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--jp-danger)', fontSize: 12 }}>✗ {error}</div>
        )}
      </div>
    </Modal>
  )
}
