/**
 * dialogs/PasteImportDialog.tsx — 「粘贴源码导入」（adj406）
 *
 * 为什么要有这个入口：手机端打开 .jps 依赖系统文件选择器，而各家文件管理器/网盘
 * 对自定义扩展名态度不一致——有的按 MIME 隐藏 .jps，有的只能看到本机已下载的文件；
 * 已安装的 PWA 外壳还可能让选择器静默失败。粘贴是最可靠的兜底：微信/网盘里复制的文本、
 * 笔记里的 ```jps 代码块都能直接用。
 *
 * 只做"读入文本并替换当前文档"，**不写磁盘**（保存仍走「文件 → 导出」，文案里已说明）。
 *
 * adj562（用户要求"把粘贴源码导入对话框也加到底栏，就在工作区后面加一个「导入」页签"）：
 * 本组件新增 `inline` 模式（与 adj492 的「关于」同一套路）——dock 里只交出内容
 * （不带遮罩/标题栏/✕），并且**输入框吃掉剩余高度**：dock 拉高时粘贴框跟着变高，
 * 长源码不用在小框里来回滚。弹窗模式（`inline=false`）行为与外观完全不变。
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { pasteImportCopy } from '../brand/copy'

export function PasteImportDialog({ inline = false }: { inline?: boolean } = {}) {
  const [text, setText] = useState('')
  const importSource = useDocStore((s) => s.importSource)
  const closeModal = useUiStore((s) => s.closeModal)
  const closeDock = useUiStore((s) => s.closeDock)
  const showNotice = useUiStore((s) => s.showNotice)

  /**
   * adj562：两种容器的"收场"不同——弹窗用 `closeModal()`（卸掉遮罩），
   * dock 里用 `closeDock()`（收起底栏）。导入成功后都回到编辑区，用户马上能看到新谱。
   */
  const dismiss = () => {
    if (inline) closeDock()
    else closeModal()
  }

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
    dismiss()
  }

  return (
    <Modal title={pasteImportCopy.title} width={560} inline={inline}>
      {/* adj562：dock 里套 `.import-body`（flex 列 + 吃满高度，见 index.css 的 `.pane-import`）；
          弹窗里保持原来的内联样式（一次性 200px 高的粘贴框，可纵向拖拽改高）。 */}
      <div
        className={inline ? 'import-body' : undefined}
        style={inline ? undefined : { display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, lineHeight: 1.6 }}>{pasteImportCopy.desc}</div>
        <textarea
          className={inline ? 'import-text' : undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={pasteImportCopy.placeholder}
          spellCheck={false}
          style={{
            // dock 模式由 `.import-text` 接管高度（flex:1 + min-height），弹窗模式保持 200px
            ...(inline ? null : { minHeight: 200 }),
            fontFamily: 'var(--jp-font-mono)',
            fontSize: 13,
            lineHeight: 1.6,
            padding: '8px 10px',
            borderRadius: 6,
            color: 'var(--jp-text-primary)',
            background: 'var(--jp-bg-app)',
            border: '1px solid var(--jp-border)',
            resize: (inline ? 'none' : 'vertical') as 'none' | 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn" onClick={() => void fromClipboard()}>
            {pasteImportCopy.fromClipboard}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={dismiss}>
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
