/**
 * ui/Modal.tsx — 通用模态框（按住标题栏可拖动）
 * props：maskDim 背景遮罩透明度（0~1，默认 0.6；试听对话框用 0 保持看谱）；
 *        closeOnMaskClick 点击遮罩是否关闭（默认 true；试听对话框 false）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useUiStore } from '../store/uiStore'

export function Modal({
  title,
  children,
  maskDim = 0.6,
  closeOnMaskClick = true,
}: {
  title: string
  children: ReactNode
  /** 背景遮罩透明度（0 = 不遮罩，试听时保持看谱） */
  maskDim?: number
  /** 点击遮罩区域是否关闭（false = 仅 ✕ 或 Esc 关闭） */
  closeOnMaskClick?: boolean
}) {
  const closeModal = useUiStore((s) => s.closeModal)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal])

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

  const modalStyle = pos
    ? { position: 'fixed' as const, left: pos.x, top: pos.y, margin: 0 }
    : undefined

  return (
    <div
      className="modal-mask"
      style={{ background: `rgba(6, 10, 22, ${maskDim})` }}
      onClick={closeOnMaskClick ? closeModal : undefined}
    >
      <div
        ref={modalRef}
        className={dragging ? 'modal dragging' : 'modal'}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head" onMouseDown={onHeadMouseDown}>
          <span>{title}</span>
          <button className="modal-close" onClick={closeModal}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
