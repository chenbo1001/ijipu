/**
 * dialogs/ExportDialog.tsx — 导出（引擎迭代中；.jps 源文件已可用）
 */
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'

export function ExportDialog() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const closeModal = useUiStore((s) => s.closeModal)

  const download = (ext: string, mime: string) => {
    const blob = new Blob([code], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName || '未命名'}${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const items = [
    { ext: '.jps', label: 'JianpuScript 源文件', mime: 'text/plain;charset=utf-8', ready: true },
    { ext: '.svg', label: 'SVG 矢量图（渲染引擎开发中）', mime: 'image/svg+xml', ready: false },
    { ext: '.pdf', label: 'PDF 文档（渲染引擎开发中）', mime: 'application/pdf', ready: false },
    { ext: '.jpg', label: 'JPG 图片（渲染引擎开发中）', mime: 'image/jpeg', ready: false },
  ]

  return (
    <Modal title="导出">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <button
            key={it.ext}
            className="btn"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left' }}
            onClick={() => {
              if (it.ready) {
                download(it.ext, it.mime)
                closeModal()
              }
            }}
          >
            <span>{it.label}</span>
            <span style={{ fontFamily: 'var(--jp-font-mono)', color: it.ready ? 'var(--jp-accent)' : 'var(--jp-text-muted)' }}>
              {it.ext}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
