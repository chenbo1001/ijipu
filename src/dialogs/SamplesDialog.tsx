/**
 * dialogs/SamplesDialog.tsx — 示例谱库
 */
import { SAMPLES } from '../samples'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'

export function SamplesDialog() {
  const loadSample = useDocStore((s) => s.loadSample)
  const closeModal = useUiStore((s) => s.closeModal)

  const open = (id: string) => {
    loadSample(id)
    closeModal()
  }

  return (
    <Modal title="打开示例谱">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SAMPLES.map((s) => (
          <div
            key={s.id}
            onClick={() => open(s.id)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              border: '1px solid var(--jp-border)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--jp-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--jp-border)')}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
              <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>{s.description}</div>
            </div>
            <div style={{ color: 'var(--jp-text-muted)', fontFamily: 'var(--jp-font-mono)', fontSize: 12 }}>
              {s.code.length} 字符
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
