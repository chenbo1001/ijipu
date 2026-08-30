/**
 * editor/ScriptToolbar.tsx — 嵌入式简谱输入工具条（adj314）
 *
 * 用户方案 v2（评审通过）：
 *  - 主键/二级键共用同一工具条，只一行、宽度自适应、横向滑动（.pad-scroll）。
 *  - 默认显示主键组；点主键切到该组二级键（最左固定「← 返回」），
 *    点二级键插入后自动回主键（setActiveGroup(null)）。
 *  - 组内按键按频度排序；不常用符号合并进低频组。
 *  - 常驻主键「⌨」用于显示/隐藏系统软键盘：普通符号键通过 mousedown.preventDdefault
 *    保住 textarea 焦点，只有「⌨」主动 blur/focus。
 *
 * 本组件纯 UI：插入逻辑经 props 的 onInsert 交由 EditorPane 统一处理
 * （读 textarea → 拼接 → setCode → 光标定位），与既有 applyCompletion 一致。
 */
import { useRef, useState } from 'react'
import { PAD_GROUPS, PAD_KB_KEY } from './padLayout'

export function ScriptToolbar({
  onInsert,
  onToggleKb,
  kbActive,
}: {
  /** 插入文本到光标处（cursorOffset 可选：带模板插入时光标停靠位置） */
  onInsert: (text: string, cursorOffset?: number) => void
  /** 点击「⌨」：显示/隐藏系统软键盘（EditorPane 负责 focus/blur） */
  onToggleKb: () => void
  /** 系统软键盘当前是否显示（用于「⌨」高亮） */
  kbActive: boolean
}) {
  // null = 主键态；非 null = 当前展开的主键组 id
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const active = activeGroup
  const scrollRef = useRef<HTMLDivElement>(null)

  // 点二级键：插入后按组决定是否回主键。音符/时值（keepOpen）保持二级态以连续输入，
  // 其余组返回主键态（insert 后回到主键组视图）
  const pick = (text: string, cursorOffset?: number) => {
    onInsert(text, cursorOffset)
    const g = PAD_GROUPS.find((x) => x.id === active)
    if (!g?.keepOpen) setActiveGroup(null)
  }

  return (
    <div className="script-pad" role="toolbar" aria-label="简谱输入工具条">
      {/* 二级态最左固定返回键 */}
      {active !== null && (
        <button
          type="button"
          className="pad-key pad-back"
          title="返回"
          aria-label="返回主键盘"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setActiveGroup(null)}
        >
          ←
        </button>
      )}
      <div className="pad-scroll" ref={scrollRef}>
        {active === null ? (
          /* —— 主键态：所有主键组 + 软键盘开关 —— */
          <>
            {PAD_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                className="pad-key pad-master"
                title={g.label}
                aria-label={g.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveGroup(g.id)}
              >
                <span className="pad-key-icon">{g.icon}</span>
                <span className="pad-key-sub">{g.label}</span>
              </button>
            ))}
            <div className="pad-sep" aria-hidden="true" />
            <button
              type="button"
              className={`pad-key pad-master${kbActive ? ' active' : ''}`}
              title={PAD_KB_KEY.hint}
              aria-label={PAD_KB_KEY.hint}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleKb}
            >
              <span className="pad-key-icon">{PAD_KB_KEY.label}</span>
            </button>
          </>
        ) : (
          /* —— 二级态：当前主键组的二级键 —— */
          <div className="pad-group-keys">
            {(PAD_GROUPS.find((g) => g.id === active)?.keys ?? []).map((k) => (
              <button
                key={k.insert + k.label}
                type="button"
                className="pad-key pad-item"
                title={k.hint ?? k.label}
                aria-label={k.hint ?? k.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(k.insert, k.cursorOffset)}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
