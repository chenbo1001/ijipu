/**
 * ui/Toolbar.tsx — 工具栏（视图切换 + 预览缩放 + 排版辅助开关）
 * 撤销/重做已移除（编辑菜单与编辑器右键菜单已有，adj52）。
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
  // 预览缩放（adj52：并入顶部工具条，不浮动；adj53：移至最右端）
  const previewZoom = useUiStore((s) => s.previewZoom)
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom)
  const showZoom = viewType !== 'code'

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
        className={showGuides ? 'tool-btn icon-btn active-guide' : 'tool-btn icon-btn'}
        onClick={() => setShowGuides(!showGuides)}
        title="排版辅助虚线：拖动边距/行距虚线直接调整间距"
        aria-label="排版辅助虚线开关"
      >
        {/* 纵横线图标（adj46）：左上角一组纵横参考线 + 右下角一组，仅图标 */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          {/* 左上角：横线 + 竖线（L 形） */}
          <path d="M 1.5 1.5 H 6.5" />
          <path d="M 1.5 1.5 V 6.5" />
          {/* 左上角内侧虚线延伸 */}
          <path d="M 1.5 3.5 V 4.5" strokeDasharray="1.4 1.4" />
          <path d="M 3.5 1.5 H 4.5" strokeDasharray="1.4 1.4" />
          {/* 右下角：横线 + 竖线（L 形，对角） */}
          <path d="M 14.5 9.5 V 14.5" />
          <path d="M 9.5 14.5 H 14.5" />
          {/* 右下角内侧虚线延伸 */}
          <path d="M 12.5 14.5 H 11.5" strokeDasharray="1.4 1.4" />
          <path d="M 14.5 12.5 V 11.5" strokeDasharray="1.4 1.4" />
        </svg>
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
      {/* 预览缩放（adj52 并入顶部工具条；adj53 移至最右端，紧贴导出按钮之后） */}
      {showZoom && (
        <div className="toolbar-zoom">
          <button className="tool-btn icon-btn" title="缩小预览" onClick={() => setPreviewZoom(previewZoom - 10)}>
            −
          </button>
          <span className="toolbar-zoom-val">{previewZoom}%</span>
          <button className="tool-btn icon-btn" title="放大预览" onClick={() => setPreviewZoom(previewZoom + 10)}>
            +
          </button>
        </div>
      )}
    </div>
  )
}
