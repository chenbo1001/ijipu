/**
 * dialogs/ShortcutsDialog.tsx — 快捷键速查
 */
import { Modal } from '../ui/Modal'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N', '新建乐谱'],
  ['Ctrl+O', '打开示例谱'],
  ['Ctrl+S', '保存为 .jps'],
  ['Ctrl+Q', '试听播放'],
  ['Tab', '编码 / 预览 切换'],
  ['1 / 2 / 3', '视图：编码 / 拆分 / 预览'],
  ['Q / C', '行首插入曲行 / 词行'],
  ['B / Z / D / P / J', '行首插入描述头（标题/作者/调式/拍号/节拍）'],
  ['Ctrl+~', '本快捷键速查'],
]

export function ShortcutsDialog() {
  return (
    <Modal title="快捷键速查">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {SHORTCUTS.map(([k, desc]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span
              style={{
                fontFamily: 'var(--jp-font-mono)',
                color: 'var(--jp-accent)',
                background: 'var(--jp-bg-app)',
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 12,
              }}
            >
              {k}
            </span>
            <span style={{ color: 'var(--jp-text-secondary)' }}>{desc}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
