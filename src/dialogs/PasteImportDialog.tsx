/**
 * dialogs/PasteImportDialog.tsx — 「粘贴源码导入」（adj406）
 *
 * 为什么要有这个入口：手机端打开 .jps 依赖系统文件选择器，而各家文件管理器/网盘
 * 对自定义扩展名态度不一致——有的按 MIME 隐藏 .jps，有的只能看到本机已下载的文件；
 * 已安装的 PWA 外壳还可能让选择器静默失败。粘贴是最可靠的兜底：微信/网盘里复制的文本、
 * 笔记里的 ```jps 代码块都能直接用。
 *
 * 只做"读入文本并替换当前文档"，**不写磁盘**（保存仍走「文件 → 导出」，文案里已说明）。
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { pasteImportCopy } from '../brand/copy'

export function PasteImportDialog() {
  const [text, setText] = useState('')
  const importSource = useDocStore((s) => s.importSource)
  const closeModal = useUiStore((s) => s.closeModal)
  const showNotice = useUiStore((s) => s.showNotice)

  /** 从剪贴板读文本（需安全上下文 + 用户手势；失败给可操作提示，不静默） */
  const fromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip.trim()) {
        showNotice(pasteImportCopy.clipboardEmpty, 'warn')
        return
      }
      setText(clip)
    } catch {
      showNotice(pasteImportCopy.clipboardFailed, 'warn')
    }
  }

  const doImport = () => {
    if (!importSource(text)) {
      showNotice(pasteImportCopy.empty, 'warn')
      return
    }
    showNotice(pasteImportCopy.ok(text.replace(/\s/g, '').length), 'ok')
    closeModal()
  }

  return (
    <Modal title={pasteImportCopy.title} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, lineHeight: 1.6 }}>{pasteImportCopy.desc}</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={pasteImportCopy.placeholder}
          spellCheck={false}
          style={{
            minHeight: 200,
            fontFamily: 'var(--jp-font-mono)',
            fontSize: 13,
            lineHeight: 1.6,
            padding: '8px 10px',
            borderRadius: 6,
            color: 'var(--jp-text-primary)',
            background: 'var(--jp-bg-app)',
            border: '1px solid var(--jp-border)',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn" onClick={() => void fromClipboard()}>
            {pasteImportCopy.fromClipboard}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={closeModal}>
              {pasteImportCopy.cancelBtn}
            </button>
            <button type="button" className="btn primary" onClick={doImport}>
              {pasteImportCopy.importBtn}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
