/**
 * ui/dock/ExportPanel.tsx — 底部 dock 的「导出」面板（adj462）
 *
 * ## 为什么不是复用 ExportDialog
 * 原对话框是**为固定宽度弹窗**写的：一列全宽按钮**竖向堆叠**，在底栏里会把 dock 顶得老高。
 * 底栏要的是**流式内容**——随 dock 宽度自动重排、把高度压到最小。所以这里重写布局：
 *  · 动作按钮走 `.dock-actions`（`auto-fit` 等宽网格）→ **dock 越宽，一行装下的格式越多**，
 *    dock 宽度够时 8 个格式 + 源文件挤在 1~2 行，高度从"8 行"降到"1~2 行"；
 *  · 清晰度等选项走 `.dock-field`（标签+控件成组），随宽度自动换行；
 *  · 窄屏（<420px）自动退回「标签在上、控件在下」的一列。
 *
 * ## 行为与原来一致
 * 七个导出目标（SVG/PNG/JPG/PDF/MIDI/WAV/MP3）+ .jps 源文件、图片清晰度 2x/4x/6x、
 * 语法错误拦截、忙态禁用、错误提示——都与原 ExportDialog 相同（逻辑原样搬来）。
 * 导出进行中把任务名写进 `uiStore.exportJob`：**切走/关掉 dock，状态栏仍有动态指示**。
 */
import { useMemo, useRef, useState } from 'react'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { exportCopy } from '../../brand/copy'
import { layoutScore, renderScoreToSvg, buildPlaySequence, inferBpm, eventsToMidi } from '@ijipu/engine'
import { renderToAudioBuffer, audioBufferToWav, audioBufferToMp3 } from '../../export/audio'
import { exportSvg, exportPng, exportJpg, exportPdf } from '../../export/export'
import { createHqCache, resolveHqBank } from '../../playback/spessaCache'
import { getHqLibrary, firstEnabledInstrumentRef } from '../../playback/spessaSynthBackend'

type ExportKey = 'svg' | 'png' | 'jpg' | 'pdf' | 'pdfImg' | 'midi' | 'wav' | 'mp3' | 'jps'

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

/** 导出任务名（状态栏动态指示显示用） */
const JOB_LABEL: Record<ExportKey, string> = {
  svg: 'SVG 矢量图',
  png: 'PNG 图片',
  jpg: 'JPG 图片',
  pdf: 'PDF（打印为 PDF）',
  pdfImg: 'PDF 图片（位图）',
  midi: 'MIDI 音频',
  wav: 'WAV 音频',
  mp3: 'MP3 音频',
  jps: 'iJipu 源文件',
}

export function ExportPanel() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  // adj354：@@ 恢复默认音色——无 Y 时用试听音色列表第一个启用音色（MIDI/音频导出与试听一致）
  const playbackHqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const setExportJob = useUiStore((s) => s.setExportJob)
  // adj626：PDF 走打印（与 Ctrl+P / 菜单「打印」同一条路：同一份页面 + 同一个默认文件名）
  const printScore = useDocStore((s) => s.printScore)
  const defaultInstrumentRef = useMemo(() => firstEnabledInstrumentRef(playbackHqEnabled), [playbackHqEnabled])

  const [busy, setBusy] = useState<ExportKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  // adj294：图片清晰度（PNG/JPG 共用倍率，2x 标准 / 4x 高清 / 6x 超清）；adj412：PDF 同档
  const [imgScale, setImgScale] = useState<number>(2)
  const hqCacheRef = useRef(createHqCache())

  // adj352：导出基名剥掉残留的 .jps/.md/.txt（手机端常把 .jps 识别为 .md/.txt → xxx.md.jpg）
  const baseName = (fileName || '未命名').replace(/\.(jps|md|txt)$/i, '')
  const hasError = parseResult.errors.some((e) => e.severity === 'error')

  /** 取高保真音源 ArrayBuffer（adj416：缓存 → 桌面安装目录内置 SF2 → 联网下载并写回缓存） */
  const ensureHqBank = async (): Promise<ArrayBuffer> => {
    const lib = getHqLibrary()
    const { bank } = await resolveHqBank(lib, hqCacheRef.current)
    return bank
  }

  const getPages = (): string[] => {
    if (hasError) throw new Error(exportCopy.blockedByError)
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

  const run = async (key: ExportKey, fn: () => void | Promise<void>) => {
    setBusy(key)
    setError(null)
    // 发布任务名 → 状态栏动态指示（切走/关掉 dock 也看得到）
    setExportJob(JOB_LABEL[key])
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setExportJob(null)
    }
  }

  /** 8 个导出目标：一键一项，按钮等宽自适应（宽时一行多个） */
  const items: { key: ExportKey; label: string; ext: string; run: () => void }[] = [
    {
      key: 'svg',
      label: exportCopy.svgLabel,
      ext: '.svg',
      run: () => run('svg', () => {
        const pages = getPages()
        pages.forEach((s, i) => exportSvg(s, pages.length > 1 ? `${baseName}-${i + 1}.svg` : `${baseName}.svg`))
      }),
    },
    { key: 'png', label: exportCopy.pngLabel, ext: '.png', run: () => run('png', async () => exportPng(getPages(), baseName, imgScale)) },
    { key: 'jpg', label: exportCopy.jpgLabel, ext: '.jpg', run: () => run('jpg', async () => exportJpg(getPages(), baseName, imgScale)) },
    {
      // adj626（用户要求）：PDF 改走**系统打印 → 另存为 PDF**——矢量输出、放大不糊；
      // 打印走**当前窗口**（`window.print()`），不开新窗口 ⇒ 不存在"浏览器拦截新窗口"的问题。
      // 与 `Ctrl+P` / 菜单「打印」共用 `printScore()`（同一份页面、同一个默认文件名 = 第一个 Z:）。
      key: 'pdf',
      label: exportCopy.pdfLabel,
      ext: '.pdf',
      run: () => run('pdf', () => printScore()),
    },
    {
      // 位图 PDF 保留为二级入口（不经对话框一键出文件；清晰度跟随上方档位）
      key: 'pdfImg',
      label: exportCopy.pdfImageLabel,
      ext: '.pdf',
      run: () => run('pdfImg', () => exportPdf(getPages(), baseName, imgScale)),
    },
    {
      // adj289：MIDI——复用播放序列（含反复展开），多声部每声部一条音轨
      key: 'midi',
      label: exportCopy.midiLabel,
      ext: '.mid',
      run: () => run('midi', () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        downloadBytes(eventsToMidi(seq.events, { bpm, title: parseResult.header.titles[0] ?? baseName }), `${baseName}.mid`, 'audio/midi')
      }),
    },
    {
      // adj345：WAV/MP3——SpessaSynth 高保真离线渲染（与试听一致），免音色库直接播放
      key: 'wav',
      label: exportCopy.wavLabel,
      ext: '.wav',
      run: () => run('wav', async () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        const buf = await renderToAudioBuffer(seq.events, await ensureHqBank(), { bpm, title: parseResult.header.titles[0] ?? baseName })
        downloadBytes(audioBufferToWav(buf), `${baseName}.wav`, 'audio/wav')
      }),
    },
    {
      key: 'mp3',
      label: exportCopy.mp3Label,
      ext: '.mp3',
      run: () => run('mp3', async () => {
        const layout = layoutScore(parseResult, pageConfig, defaultInstrumentRef)
        const bpm = inferBpm(parseResult)
        const seq = buildPlaySequence(parseResult, layout, bpm, undefined, defaultInstrumentRef)
        const buf = await renderToAudioBuffer(seq.events, await ensureHqBank(), { bpm, title: parseResult.header.titles[0] ?? baseName })
        downloadBytes(audioBufferToMp3(buf), `${baseName}.mp3`, 'audio/mpeg')
      }),
    },
    { key: 'jps', label: exportCopy.jpsLabel, ext: '.jps', run: downloadJps },
  ]

  return (
    <div className="dock-panel export-panel">
      {/* adj466：**选项与动作分成两行**（此前按"信息左/操作右"挤在一行，导出这里读起来更别扭）。
          第一行 = 图片清晰度 + 说明；第二行 = 导出动作（auto-fit 等宽网格，dock 越宽一行放下越多）。
          面板默认高度由 ToolDock 实测"能显示全"的高度给出。 */}
      <div className="dock-fields export-options">
        <label className="dock-field">
          <span className="dock-field-label">{exportCopy.scaleLabel}</span>
          <select className="dock-select" value={imgScale} onChange={(e) => setImgScale(Number(e.target.value))}>
            <option value={2}>2x 标准</option>
            <option value={4}>4x 高清</option>
            <option value={6}>6x 超清</option>
          </select>
        </label>
        <span className="dock-muted">{exportCopy.scaleHint}</span>
      </div>
      <div className="dock-actions export-actions">
        {items.map((it) => (
          <button key={it.key} type="button" className="btn" onClick={it.run} disabled={busy !== null} title={it.label}>
            <span className="export-btn-text">{busy === it.key ? exportCopy.busy : it.label}</span>
            <span className="export-btn-ext">{it.ext}</span>
          </button>
        ))}
      </div>
      {/* adj626：说明 PDF 两条路的差别（默认那条走系统打印对话框，故必须讲清怎么选） */}
      <div className="dock-muted">{exportCopy.pdfPrintHint}</div>
      {hasError && <div className="dock-error">⚠ {exportCopy.errorHint}</div>}
      {error && <div className="dock-error">✗ {error}</div>}
    </div>
  )
}
