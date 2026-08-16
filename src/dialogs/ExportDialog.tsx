/**
 * dialogs/ExportDialog.tsx — 导出（SVG / PNG / JPG / PDF / .jps 源文件）
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { layoutScore, renderScoreToSvg } from '../engine'
import { exportSvg, exportPng, exportJpg, exportPdf } from '../export/export'

export function ExportDialog() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const baseName = fileName || '未命名'
  const hasError = parseResult.errors.some((e) => e.severity === 'error')

  const getPages = (): string[] => {
    if (hasError) throw new Error('存在语法错误，无法导出。请先修正脚本。')
    const layout = layoutScore(parseResult, pageConfig)
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

  const run = async (key: 'svg' | 'png' | 'jpg' | 'pdf', fn: () => void | Promise<void>) => {
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
      label: 'PNG 高清图片（2x，逐页）',
      ext: '.png',
      run: () => run('png', async () => exportPng(getPages(), baseName, 2)),
    },
    {
      key: 'jpg' as const,
      label: 'JPG 图片（白底，逐页）',
      ext: '.jpg',
      run: () => run('jpg', async () => exportJpg(getPages(), baseName, 2)),
    },
    {
      key: 'pdf' as const,
      label: 'PDF 文档（A4 打印）',
      ext: '.pdf',
      run: () => run('pdf', () => exportPdf(getPages(), baseName)),
    },
  ]

  return (
    <Modal title="导出">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          <span>JianpuScript 源文件</span>
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
