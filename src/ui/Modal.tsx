/**
 * ui/Modal.tsx — 通用模态框（按住标题栏可拖动）
 * props：maskDim 背景遮罩透明度（0~1，默认 0.6；试听对话框用 0 保持看谱）；
 *        closeOnMaskClick 点击遮罩是否关闭（默认 true；试听对话框 false）；
 *        dock 初始停靠位置（'bottom-right' = 窗口右下角，adj158：播放时让开预览区；
 *        用户拖动后以拖动位置为准）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useUiStore } from '../store/uiStore'

export function Modal({
  title,
  children,
  maskDim = 0.6,
  closeOnMaskClick = true,
  dock,
  compact,
  onClose,
}: {
  title: string
  children: ReactNode
  /** 背景遮罩透明度（0 = 不遮罩，试听时保持看谱） */
  maskDim?: number
  /** 点击遮罩区域是否关闭（false = 仅 ✕ 或 Esc 关闭） */
  closeOnMaskClick?: boolean
  /** 初始停靠位置（adj158：'bottom-right' = 窗口右下角；'bottom-left' = 左下角；
   *  adj326：试听对话框按编辑区方位选角，打开即停靠；拖动后以用户位置为准） */
  dock?: 'bottom-left' | 'bottom-right'
  /** 紧凑模式（缩小边距与最小宽，adj158：试听对话框用） */
  compact?: boolean
  /** adj315：关闭（Esc/✕/遮罩）前回调——用于"取消不保存"时恢复设置快照 */
  onClose?: () => void
}) {
  const closeModal = useUiStore((s) => s.closeModal)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  // adj315：统一关闭动作——先 onClose（取消时恢复快照），再关闭
  const doClose = () => {
    onClose?.()
    closeModal()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') doClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal, onClose])

  // 按住标题栏拖动
  const onHeadMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return // 关闭按钮不触发拖动
    const el = modalRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setPos({ x: ev.clientX - dragRef.current.dx, y: ev.clientY - dragRef.current.dy })
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // adj158：dock 停靠样式（未拖动时生效）；拖动后回退到用户位置
  const dockStyle =
    pos === null && (dock === 'bottom-left' || dock === 'bottom-right')
      ? { position: 'fixed' as const, bottom: 16, margin: 0, ...(dock === 'bottom-left' ? { left: 16 } : { right: 16 }) }
      : undefined
  const modalStyle = {
    // adj284：遮罩透明（maskDim=0）时遮罩 pointer-events:none 事件穿透，
    // .modal 需显式 auto 覆盖继承——试听时预览窗格可滚动/点击，对话框本体仍可交互
    pointerEvents: 'auto' as const,
    ...(pos ? { position: 'fixed' as const, left: pos.x, top: pos.y, margin: 0 } : dockStyle),
  }

  return (
    <div
      className="modal-mask"
      style={{
        background: `rgba(6, 10, 22, ${maskDim})`,
        // adj284：试听对话框（maskDim=0）遮罩事件穿透——预览窗格滚动/点击音符/拖拽不受阻
        pointerEvents: maskDim > 0 ? 'auto' : 'none',
      }}
      onClick={closeOnMaskClick ? doClose : undefined}
    >
      <div
        ref={modalRef}
        className={`modal${dragging ? ' dragging' : ''}${compact ? ' compact' : ''}`}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head" onMouseDown={onHeadMouseDown}>
          <span>{title}</span>
          <button className="modal-close" onClick={doClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
