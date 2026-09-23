/**
 * dialogs/ShortcutsDialog.tsx — 快捷键速查
 *
 * adj419：① 行首命令按**小写**书写（编辑器实际按小写字母触发，大小写都认；
 *          原速查写成大写容易让人以为要按 Shift）；② 补上描述头 `y`（默认乐器）、
 *          `s`（说明文字）与 `v`（版本）；③ 去掉解析器并不认识的 `h`。
 */
import { Modal } from '../ui/Modal'

const SHORTCUTS: [string, string][] = [
  ['Ctrl+N', '新建'],
  ['Ctrl+O', '打开文件'],
  ['Ctrl+S', '保存'],
  ['Ctrl+Z', '撤销'],
  ['Ctrl+Y', '重做'],
  ['Ctrl+Q', '试听播放'],
  ['Tab', '编码 / 预览 切换'],
  ['1 / 2 / 3', '视图：编码 / 拆分 / 预览'],
  ['q / c', '行首插入曲行 Q: / 词行 C:'],
  ['b / z', '行首插入标题 B: / 作者 Z:'],
  ['d / p / j', '行首插入调式 D: / 拍号 P: / 节拍 J:'],
  ['y / s', '行首插入默认乐器 Y: / 说明文字 S:'],
  ['v', '行首插入版本 V:'],
  // adj608/adj612/adj613（用户要求）：ESC = 最小化底栏（底栏开着就生效；更内层的输入/菜单/对话框优先，
  // 焦点在底栏的输入框里时：第一次退出输入框、第二次才最小化）
  ['Esc', '最小化底栏（输入框里先退出输入）'],
  // adj610（用户要求）：底栏展开/收起 + 高度档位各配一个快捷键
  ['Ctrl+D', '展开 / 收起底栏'],
  ['Ctrl+H', '底栏高度档位（建议 → 最大 → 建议 → 最小）'],
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
        {/* adj419：说明行首命令的触发条件与大小写（避免"按了没反应"的困惑） */}
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 4 }}>
          行首命令：光标在**行首**（行首或换行后）按上述字母即插入命令头，字母大小写均可；
          插入的永远是标准大写命令头（如按 q 得到 `Q: `）。
        </div>
      </div>
    </Modal>
  )
}
