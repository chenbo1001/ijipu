/**
 * dialogs/SamplesDialog.tsx — 打开示例（文件 → 打开示例…）
 *
 * adj423：列表来自 `public/samples/*.jps`（`src/samples/index.ts` 构建期 glob 自动发现）——
 * 该目录里加/改 .jps 文件即出现在这里，无需登记。与「打开」一样是**选择列表**，点一条即载入编辑器。
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
    <Modal title="打开示例" width="min(560px, 100%)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SAMPLES.length === 0 && (
          <div style={{ color: 'var(--jp-text-muted)', fontSize: 13 }}>还没有内置示例谱。</div>
        )}
        {SAMPLES.map((s) => (
          <div
            key={s.id}
            onClick={() => open(s.id)}
            title="点击载入这份示例（会替换当前编辑内容）"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              border: '1px solid var(--jp-border)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--jp-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--jp-border)')}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
              {s.description && (
                <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>{s.description}</div>
              )}
            </div>
            <div style={{ color: 'var(--jp-text-muted)', fontFamily: 'var(--jp-font-mono)', fontSize: 12, flexShrink: 0 }}>
              {s.code.length} 字符
            </div>
          </div>
        ))}
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 4 }}>
          示例谱随应用一起提供，打开后可直接改、也可另存为自己的谱（`Ctrl+Shift+S`）。
        </div>
      </div>
    </Modal>
  )
}
