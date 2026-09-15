/**
 * editor/ScriptToolbar.tsx — 嵌入式简谱输入工具条（adj314，adj323 改一级设计）
 *
 * 用户方案（adj323，评审通过）：
 *  - **一级工具栏**：一行、宽度自适应、横向滑动（.pad-scroll），只显示各主键组 + ⌨。
 *  - 点某**主键组 → 从其上方弹出下拉浮层**（padMenu，adj323b：统一底部对齐工具条顶边、
 *    水平居中于工具条，不再跟随按钮左右飘），浮层内列出该组全部二级键，
 *    每项显示「插入内容 + 中文说明」，点项即插入。
 *  - 音符/时值等 keepOpen 组：浮层**保持展开**（连续插入多个符号），移到浮层外点击时关闭；
 *    其余组：点一个二级键插入后浮层**自动关闭**。
 *  - 键盘导航（↑↓ 选择 / Enter 插入 / Esc 关闭）复用 autocomplete 同一套（在 EditorPane.onKeyDown 处理）。
 *  - 常驻主键「⌨」显示/隐藏系统软键盘：普通符号键通过 mousedown.preventDefault 保住 textarea 焦点。
 *
 * 本组件纯 UI：插入逻辑经 props 的 onInsert 交由 EditorPane 统一处理。
 */
import { useRef, type RefObject } from 'react'
import { useUiStore } from '../store/uiStore'
import { PAD_GROUPS, PAD_KB_KEY, type PadGroup } from './padLayout'
import { GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'

export function ScriptToolbar({
  padAreaRef,
  onGroupMenuOpen,
  onToggleKb,
  kbActive,
  activeGroupId,
}: {
  /** 工具条容器 ref——父级用它读取工具条 rect（adj323b 底部统一对齐） */
  padAreaRef: RefObject<HTMLDivElement | null>
  /** 点主键组：上报该组 + 按钮位置（视口 rect）——父级用它水平跟随按钮，adj323c */
  onGroupMenuOpen: (group: PadGroup, rect: DOMRect) => void
  /** 点击「⌨」：显示/隐藏系统软键盘（EditorPane 负责 focus/blur） */
  onToggleKb: () => void
  /** 系统软键盘当前是否显示（用于「⌨」高亮） */
  kbActive: boolean
  /** adj407：当前已展开菜单的组 id——主键按钮按"开关"语义，展开时高亮（再点即收起） */
  activeGroupId: string | null
}) {
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  // adj333：动态「乐器」——把收藏的采样音色（GM 音色）加入乐器组，插入 @名
  const hqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const hqVoiceKeys = hqEnabled
    .map((program) => GM_VOICE_OPTIONS.find((v) => v.program === program))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => {
      const name = v.label.replace(/^\d+\s*/, '') // 去编号前缀，只用音色名
      // adj339：用 @...@ 包裹（安全，防止 () 等被格式化拆分；缺省显示名=乐器名）
      return { label: name, insert: `@${name}@`, hint: `切换采样乐器：${name}` }
    })

  const openGroup = (g: PadGroup, rect: DOMRect) => {
    // inst 组动态附加收藏采样音色（纯名 @乐器）
    const ext = g.id === 'inst' && hqVoiceKeys.length > 0 ? { ...g, keys: [...g.keys, ...hqVoiceKeys] } : g
    onGroupMenuOpen(ext, rect)
  }

  return (
    <div className="script-pad" role="toolbar" aria-label="简谱输入工具条" ref={padAreaRef}>
      <div className="pad-scroll">
        {PAD_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            ref={(el) => {
              btnRefs.current[g.id] = el
            }}
            className={`pad-key pad-master${activeGroupId === g.id ? ' active' : ''}`}
            title={activeGroupId === g.id ? `${g.label}（再点收起）` : g.label}
            aria-label={g.label}
            aria-expanded={activeGroupId === g.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const el = btnRefs.current[g.id]
              if (el) openGroup(g, el.getBoundingClientRect())
            }}
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
      </div>
    </div>
  )
}
