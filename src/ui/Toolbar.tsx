/**
 * ui/Toolbar.tsx — 工具栏（视图切换 + 常用操作 + 排版辅助开关）
 */
import { useDocStore, type ViewType } from '../store/docStore'
import { useUiStore } from '../store/uiStore'

const VIEWS: { key: ViewType; label: string }[] = [
  { key: 'code', label: '编码' },
  { key: 'split', label: '拆分' },
  { key: 'preview', label: '预览' },
]

export function Toolbar() {
  const viewType = useDocStore((s) => s.viewType)
  const setViewType = useDocStore((s) => s.setViewType)
  const openModal = useUiStore((s) => s.openModal)
  const showGuides = useUiStore((s) => s.showGuides)
  const setShowGuides = useUiStore((s) => s.setShowGuides)

  return (
    <div className="toolbar">
      <div className="view-switch">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={viewType === v.key ? 'active' : ''}
            onClick={() => setViewType(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="toolbar-spacer" />
      <button
        className={showGuides ? 'tool-btn active-guide' : 'tool-btn'}
        onClick={() => setShowGuides(!showGuides)}
        title="排版辅助虚线：拖动边距/行距虚线直接调整间距"
      >
        ┈ 排版辅助
      </button>
      <button className="tool-btn primary" onClick={() => openModal('playback')}>
        ▶ 试听
      </button>
      <button className="tool-btn" onClick={() => openModal('pageConfig')}>
        页面设置
      </button>
      <button className="tool-btn" onClick={() => openModal('export')}>
        导出
      </button>
    </div>
  )
}
