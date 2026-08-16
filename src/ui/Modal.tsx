/**
 * ui/Modal.tsx — 通用模态框
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useUiStore } from '../store/uiStore'

export function Modal({ title, children }: { title: string; children: ReactNode }) {
  const closeModal = useUiStore((s) => s.closeModal)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeModal])

  return (
    <div className="modal-mask" onClick={closeModal}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
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
