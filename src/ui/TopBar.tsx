/**
 * ui/TopBar.tsx — 顶部栏（adj281：合并原 MenuBar + Toolbar）
 *
 * 布局（从左到右）：
 *   Logo（图标+标题） / 汉堡菜单 ☰ / 视图切换图标组（编码/拆分/预览） /
 *   <弹性间距> / 功能按钮组（排版辅助、试听、设置、导出）/ 缩放比率组（`-` `%` `+`）
 *
 * - 除了缩放比率组外，其它按钮均为「图标 + 标题」（宽屏）；窄屏全部仅图标
 * - 窄屏下：功能按钮组 + 缩放组隐藏到右侧「⋮ 更多」下拉中，避免按钮溢出顶栏
 *   导致整页左右滚动；汉堡下拉与「更多」下拉均支持上下滚动 + 点击外部关闭
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDocStore, type ViewType } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { formatJps, EDITOR_FONT_OPTIONS } from '@ijipu/engine'

/** Alt+字母 → 菜单分组（adj185）
 *  adj383：主题组已移入「页面设置」对话框的「主题」标签，Alt+T 菜单分组随之取消 */
const ALT_MENU_KEYS: Record<string, string> = {
  f: 'file',
  e: 'edit',
  v: 'view',
  p: 'play',
  h: 'help',
}

/** adj240：渲染热键标签——「文件(&F)」→ 「文件(<u>F</u>)」 */
function Hotkey({ text }: { text: string }) {
  const m = /\(&([A-Za-z0-9])\)/.exec(text)
  if (!m) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, m.index)}(<u>{m[1]}</u>){text.slice(m.index + m[0].length)}
    </span>
  )
}

/** adj281：菜单项数据驱动 */
interface MenuEntry {
  label: string
  kbd?: string
  hotkey?: string
  onPick: () => void
  disabled?: boolean
}

function MenuPanel({
  entries,
  onClose,
}: {
  entries: (MenuEntry | 'sep')[]
  onClose: () => void
}) {
  return (
    <>
      {entries.map((e, i) => {
        if (e === 'sep') return <div key={`sep-${i}`} className="menu-sep" />
        const disabled = !!e.disabled
        return (
          <div
            key={`${e.hotkey ?? 'x'}-${i}`}
            className={`menu-entry${disabled ? ' disabled' : ''}`}
            data-hotkey={e.hotkey}
            onClick={() => {
              if (disabled) return
              e.onPick()
              onClose()
            }}
          >
            <Hotkey text={e.label} />
            {e.kbd && <span className="kbd">{e.kbd}</span>}
          </div>
        )
      })}
    </>
  )
}

const VIEWS: { key: ViewType; label: string; icon: React.ReactNode }[] = [
  {
    key: 'code',
    label: '编码',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M 4.5 2.5 L 1.5 7 L 4.5 11.5" />
        <path d="M 9.5 2.5 L 12.5 7 L 9.5 11.5" />
        <path d="M 8 3 L 6 11" />
      </svg>
    ),
  },
  {
    key: 'split',
    label: '拆分(上下)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="1.5" y="1.5" width="11" height="4.5" rx="0.5" />
        <rect x="1.5" y="8" width="11" height="4.5" rx="0.5" />
        <path d="M 2 6.8 H 12" strokeDasharray="1.2 1.2" />
      </svg>
    ),
  },
  {
    key: 'splitH',
    label: '左右拆分',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="1.5" y="1.5" width="4.5" height="11" rx="0.5" />
        <rect x="8" y="1.5" width="4.5" height="11" rx="0.5" />
        <path d="M 6.8 2 V 12" strokeDasharray="1.2 1.2" />
      </svg>
    ),
  },
  {
    key: 'preview',
    label: '预览',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <path d="M 1.5 7 C 3.5 3.5, 10.5 3.5, 12.5 7 C 10.5 10.5, 3.5 10.5, 1.5 7 Z" />
        <circle cx="7" cy="7" r="2" />
      </svg>
    ),
  },
]

/** adj315：归一化视图 key——splitHE 视为「左右拆分」(splitH) 条目 */
const normViewKey = (k: ViewType): string => (k === 'splitHE' ? 'splitH' : k)

/** 查当前视图在 VIEWS 中的条目（splitHE 归入 splitH 条目，保证顶栏图标/标签正确显示） */
const viewItem = (k: ViewType) => VIEWS.find((v) => v.key === normViewKey(k))

export function TopBar() {
  // ---- 文档 store ----
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const viewType = useDocStore((s) => s.viewType)
  const setViewType = useDocStore((s) => s.setViewType)
  // adj315：左右拆分排列方向（点「左右拆分」时据此设为 splitH/splitHE）
  const splitHDir = useUiStore((s) => s.splitHDir)
  // adj322：宽/窄屏——按视口选 split(上下) 还是 splitH/splitHE(左右)
  const isNarrow = useUiStore((s) => s.isNarrow)
  const newDoc = useDocStore((s) => s.newDoc)
  const openFile = useDocStore((s) => s.openFile)
  const saveFile = useDocStore((s) => s.saveFile)
  const saveFileAs = useDocStore((s) => s.saveFileAs)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  const canUndo = useDocStore((s) => s.undoStack.length > 0)
  const canRedo = useDocStore((s) => s.redoStack.length > 0)
  // ---- UI store ----
  const openModal = useUiStore((s) => s.openModal)
  const showGuides = useUiStore((s) => s.showGuides)
  const setShowGuides = useUiStore((s) => s.setShowGuides)
  const previewZoom = useUiStore((s) => s.previewZoom)
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom)
  // adj383：主题（中国色主题 + 浅深模式）已移入「页面设置」对话框的「主题」标签，顶栏不再持有
  // adj281：折行 / 字体 / 字号（从状态栏设置组移到顶栏工具条）
  const autoWrap = useUiStore((s) => s.autoWrap)
  const setAutoWrap = useUiStore((s) => s.setAutoWrap)
  // adj314：脚本输入工具条开关（移动端/PAD 默认开、PC 默认关）
  const showScriptPad = useUiStore((s) => s.showScriptPad)
  const setShowScriptPad = useUiStore((s) => s.setShowScriptPad)
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize)
  const editorFont = useUiStore((s) => s.editorFont)
  const setEditorFont = useUiStore((s) => s.setEditorFont)
  // 编辑器字体/字号属 L1「用户个性」（本机偏好，**不随谱保存**）——adj-font：此前这里把改动
  // 同时写进 pageConfig（→ # jps-config），导致"把 .jps 发给别人、别人的编辑器字体被改"，现已移除。
  const effectiveFontSize = editorFontSize
  const effectiveFont = editorFont
  // ---- 下拉开关 ----
  const [menuOpen, setMenuOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  // adj314：视图切换改为下拉按钮（减少宽度占用）
  const [viewOpen, setViewOpen] = useState(false)
  const viewRef = useRef<HTMLDivElement>(null)
  // 顶栏根 ref：用于 click-outside 检测（汉堡 / 更多 / 视图下拉都收在 topbar 内，点击外部关闭）
  const topbarRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => setMenuOpen(false)
  const closeOverflow = () => setOverflowOpen(false)
  const closeView = () => setViewOpen(false)
  const closeAll = () => {
    setMenuOpen(false)
    setOverflowOpen(false)
    setViewOpen(false)
  }

  // ---- adj：功能按钮溢出（顶栏尽量显示，放不下的进「更多」下拉） ----
  // 可见按钮数（前 N 个放在顶栏工具条，其余收进「更多」）；缩放组仅预览/拆分视图显示
  const showZoom = viewType !== 'code'
  // 工具条按钮配置（顺序即顶栏工具条显示顺序；group: topbar=功能组 / footer=设置组）
  const toolBtns = [
    // —— 功能组（原顶栏功能按钮组） ——
    { key: 'guides', label: '排版', group: 'topbar' as const, kind: 'btn' as const, active: showGuides, onPick: () => setShowGuides(!showGuides) },
    // adj384：音色库按钮已移除（移入「设置 → 音色库」标签）
    { key: 'playback', label: '试听', group: 'topbar' as const, kind: 'btn' as const, onPick: () => openModal('playback') },
    { key: 'pageConfig', label: '设置', group: 'topbar' as const, kind: 'btn' as const, onPick: () => openModal('pageConfig') },
    { key: 'export', label: '导出', group: 'topbar' as const, kind: 'btn' as const, onPick: () => openModal('export') },
    { key: 'zoom', label: '缩放', group: 'topbar' as const, kind: 'zoom' as const, show: showZoom },
    // —— 设置组（从状态栏移来） ——
    { key: 'autoWrap', label: '折行', group: 'footer' as const, kind: 'btn' as const, active: autoWrap, onPick: () => setAutoWrap(!autoWrap) },
    { key: 'scriptPad', label: '输入条', group: 'footer' as const, kind: 'btn' as const, active: showScriptPad, onPick: () => setShowScriptPad(!showScriptPad) },
    { key: 'font', label: '字体', group: 'footer' as const, kind: 'font' as const },
    { key: 'fontSize', label: '字号', group: 'footer' as const, kind: 'fontSize' as const, show: true },
  ].filter((t) => (t.kind === 'zoom' ? t.show : true))
  // 字体 split-button 状态（从状态栏移来，下拉从顶栏向下展开）
  const [fontOpen, setFontOpen] = useState(false)
  const fontRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!fontOpen) return
    const onDown = (e: MouseEvent) => {
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) {
        setFontOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [fontOpen])
  const [visCount, setVisCount] = useState(toolBtns.length)
  const btnsRef = useRef<HTMLDivElement>(null) // .topbar-buttons（功能组可见区）
  const settingsRef = useRef<HTMLDivElement>(null) // .topbar-settings（设置组可见区）
  const toolbarRef = useRef<HTMLDivElement>(null) // .topbar-toolbar（工具条）
  const measureRef = useRef<HTMLDivElement>(null) // 隐藏测量容器（渲染全部按钮量宽）
  const overflowBtnRef = useRef<HTMLDivElement>(null) // 「更多」按钮容器
  const overflowDropdownRef = useRef<HTMLDivElement>(null) // 「更多」下拉容器
  const donateRef = useRef<HTMLButtonElement>(null) // 「支持作者」独立按钮（宽度计入测量预算）
  // adj：视口很窄时下拉可能向左溢出视口，用 translateX 把它拉回视口内
  const [overflowShiftX, setOverflowShiftX] = useState(0)
  useLayoutEffect(() => {
    if (!overflowOpen) {
      setOverflowShiftX(0)
      return
    }
    const el = overflowDropdownRef.current
    if (!el) return
    // 测量下拉位置，若左缘 < 0 则向右平移使其在视口内（视口足够时 shiftX = 0）
    const r = el.getBoundingClientRect()
    if (r.left < 0) {
      setOverflowShiftX(-r.left + 6) // 多移 6px 留左 padding
    } else {
      setOverflowShiftX(0)
    }
  }, [overflowOpen])

  // 图标：(key) => JSX，与 renderBtn 共用
  const iconOf = (key: string): React.ReactNode => {
    switch (key) {
      case 'guides':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <rect x="2.2" y="2.2" width="9.6" height="9.6" />
            <path d="M 7 3.6 V 10.4" />
            <path d="M 3.6 7 H 10.4" />
          </svg>
        )
      case 'playback':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <path d="M 3 2 L 12 7 L 3 12 Z" />
          </svg>
        )
      case 'donate':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <path d="M 7 12.6 L 2.4 8 A 2.85 2.85 0 1 1 6.3 4.04 L 7 4.75 L 7.7 4.04 A 2.85 2.85 0 1 1 11.6 8 Z" />
          </svg>
        )
      case 'pageConfig':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="7" cy="7" r="3.1" />
            <path d="M 7 1.5 V 3.2" />
            <path d="M 7 10.8 V 12.5" />
            <path d="M 1.5 7 H 3.2" />
            <path d="M 10.8 7 H 12.5" />
            <path d="M 3.1 3.1 L 4.3 4.3" />
            <path d="M 9.7 9.7 L 10.9 10.9" />
            <path d="M 10.9 3.1 L 9.7 4.3" />
            <path d="M 4.3 9.7 L 3.1 10.9" />
            <circle cx="7" cy="7" r="1.3" />
          </svg>
        )
      case 'export':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M 7 1.5 V 9.5" />
            <path d="M 3.5 6 L 7 9.5 L 10.5 6" />
            <path d="M 2.5 11.5 H 11.5" />
          </svg>
        )
      case 'autoWrap':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M 2 3 H 12" />
            <path d="M 2 7 H 9" />
            <path d="M 2 11 H 12" />
            <path d="M 7.5 5.5 L 9 7 L 7.5 8.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'font':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <text x="2" y="11.5" fontSize="11" fontWeight="700" fill="currentColor">A</text>
            <text x="9" y="11.5" fontSize="7.5" fontWeight="700" fill="currentColor">a</text>
          </svg>
        )
      case 'scriptPad':
        return (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <rect x="1.5" y="2.5" width="7" height="5.5" rx="1" />
            <path d="M 4.5 9 V 11.5" />
            <path d="M 8.5 9 V 11.5" />
            <path d="M 2 11.5 H 11" />
            <path d="M 9.8 4.2 V 6.6" />
            <path d="M 8.6 5.4 H 11" />
          </svg>
        )
      default:
        return null
    }
  }

  // 顶栏按钮渲染（用于可见区 / 隐藏测量容器）
  const renderBtn = (t: (typeof toolBtns)[number]) => {
    if (t.kind === 'zoom') {
      return (
        <div className="topbar-zoom" key={t.key}>
          <button className="topbar-btn icon-btn" title="缩小预览" onClick={() => setPreviewZoom(previewZoom - 10)}>
            −
          </button>
          <span className="topbar-zoom-val">{previewZoom}%</span>
          <button className="topbar-btn icon-btn" title="放大预览" onClick={() => setPreviewZoom(previewZoom + 10)}>
            +
          </button>
        </div>
      )
    }
    if (t.kind === 'fontSize') {
      // 字号组：A- / px / A+（从状态栏移来）
      return (
        <div className="topbar-zoom" key={t.key}>
          <button
            className="topbar-btn icon-btn"
            title="减小字号"
            onClick={() => {
              const v = Math.max(10, effectiveFontSize - 1)
              setEditorFontSize(v)
            }}
          >
            A−
          </button>
          <span className="topbar-zoom-val">{effectiveFontSize}px</span>
          <button
            className="topbar-btn icon-btn"
            title="增大字号"
            onClick={() => {
              const v = Math.min(26, effectiveFontSize + 1)
              setEditorFontSize(v)
            }}
          >
            A+
          </button>
        </div>
      )
    }
    if (t.kind === 'font') {
      // 字体 split-button（从状态栏移来，下拉从顶栏向下展开）
      return (
        <span className="editor-font-split" ref={fontRef} key={t.key}>
          <button
            className="topbar-btn"
            onClick={() => {
              setFontOpen((v) => !v)
            }}
            title="编辑器字体"
            aria-label="编辑器字体"
            aria-expanded={fontOpen}
          >
            {iconOf('font')}
            <span className="tool-label">{t.label}</span>
            <span className="arrow">▼</span>
          </button>
          {fontOpen && (
            <div className="editor-font-split-dropdown" role="listbox">
              {EDITOR_FONT_OPTIONS.map((o) => (
                <div
                  key={o.value}
                  className={`opt${effectiveFont === o.value ? ' active' : ''}`}
                  role="option"
                  aria-selected={effectiveFont === o.value}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setEditorFont(o.value)
                    setFontOpen(false)
                  }}
                >
                  <span className="opt-label" style={{ fontFamily: o.value }}>Aa</span>
                  {o.label}
                </div>
              ))}
            </div>
          )}
        </span>
      )
    }
    return (
      <button
        key={t.key}
        className={`topbar-btn${t.active ? ' active-guide' : ''}`}
        onClick={t.onPick}
        title={t.label}
        aria-label={t.label}
      >
        {iconOf(t.key)}
        <span className="tool-label">{t.label}</span>
      </button>
    )
  }

  // 「更多」下拉里的条目渲染（图标 + 标题，宽屏显示标题）
  const renderOverflowItem = (t: (typeof toolBtns)[number]) => {
    if (t.kind === 'zoom') {
      return (
        <>
          <div className="menu-sep" key={`${t.key}-sep`} />
          <div className="menu-group-title" key={`${t.key}-title`}>预览缩放</div>
          <div className="menu-entry" style={{ justifyContent: 'space-between' }}>
            <button className="menu-entry-btn" onClick={() => setPreviewZoom(previewZoom - 10)} title="缩小预览" aria-label="缩小预览">−</button>
            <span style={{ fontFamily: 'var(--jp-font-mono)', fontSize: 12 }}>{previewZoom}%</span>
            <button className="menu-entry-btn" onClick={() => setPreviewZoom(previewZoom + 10)} title="放大预览" aria-label="放大预览">+</button>
          </div>
        </>
      )
    }
    if (t.kind === 'fontSize') {
      return (
        <>
          <div className="menu-sep" key={`${t.key}-sep`} />
          <div className="menu-group-title" key={`${t.key}-title`}>字号</div>
          <div className="menu-entry" style={{ justifyContent: 'space-between' }}>
            <button
              className="menu-entry-btn"
              onClick={() => {
                const v = Math.max(10, effectiveFontSize - 1)
                setEditorFontSize(v)
                closeOverflow()
              }}
              title="减小字号"
              aria-label="减小字号"
            >
              A−
            </button>
            <span style={{ fontFamily: 'var(--jp-font-mono)', fontSize: 12 }}>{effectiveFontSize}px</span>
            <button
              className="menu-entry-btn"
              onClick={() => {
                const v = Math.min(26, effectiveFontSize + 1)
                setEditorFontSize(v)
                closeOverflow()
              }}
              title="增大字号"
              aria-label="增大字号"
            >
              A+
            </button>
          </div>
        </>
      )
    }
    if (t.kind === 'font') {
      // 字体项在更多下拉里：点击直接弹页面设置（含字体选择）
      return (
        <div
          key={t.key}
          className="menu-entry"
          onClick={() => {
            closeOverflow()
            openModal('pageConfig')
          }}
        >
          {iconOf('font')}
          <span>{t.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--jp-text-muted)', fontSize: 11 }}>{effectiveFont}</span>
        </div>
      )
    }
    return (
      <div
        key={t.key}
        className="menu-entry"
        onClick={() => {
          t.onPick()
          closeOverflow()
        }}
      >
        {iconOf(t.key)}
        <span>{t.label}</span>
        {t.active && <span style={{ marginLeft: 'auto', color: 'var(--jp-text-muted)', fontSize: 11 }}>开</span>}
      </div>
    )
  }

  // 测量可用宽度 → 贪心按组(顶栏/设置)分配 visCount（useLayoutEffect 在绘制前执行，避免闪烁溢出）
  useLayoutEffect(() => {
    const measure = () => {
      const topbar = topbarRef.current
      const mes = measureRef.current
      if (!topbar || !mes) return
      const cs = getComputedStyle(topbar)
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const gap = parseFloat(cs.gap) || 4
      // 「更多」按钮宽度（未渲染时用估值 36，避免首帧把全部挤出去）
      const ovW = overflowBtnRef.current?.getBoundingClientRect().width ?? 36
      const fix = (sel: string) => topbar.querySelector(sel)?.getBoundingClientRect().width ?? 0
      // adj：独立「支持作者」按钮不参与折叠、始终常驻最右——须把它的宽度（含 margin-left 6px）
      // 计入可用空间预算，否则窄屏（如 PAD 竖屏）下其余工具按钮会把它挤出视口导致横向滚动
      const donateW = donateRef.current?.getBoundingClientRect().width ?? 0
      const avail =
        topbar.clientWidth -
        pad -
        gap -
        ovW -
        fix('.topbar-brand') -
        fix('.topbar-hamburger') -
        fix('.topbar-views') -
        (donateW > 0 ? donateW + 6 : 0)
      // 测量每个按钮宽（测量容器按组分段渲染，与实际工具条布局一致）
      const btnEls = Array.from(mes.querySelectorAll<HTMLElement>('[data-tool-key]'))
      const widths = btnEls.map((el) => el.getBoundingClientRect().width)
      // 贪心：按 toolBtns 顺序累计，按 group 分两组；总宽公式见下
      let n1 = 0
      let n2 = 0
      let w1 = 0
      let w2 = 0
      for (let i = 0; i < toolBtns.length; i++) {
        const isT = toolBtns[i].group === 'topbar'
        const newN1 = n1 + (isT ? 1 : 0)
        const newN2 = n2 + (isT ? 0 : 1)
        const newW1 = w1 + (isT ? widths[i] : 0)
        const newW2 = w2 + (isT ? 0 : widths[i])
        // 组框 i 宽 = padding 2 + 按钮宽和 + 按钮间 gap×2 + padding 2 = 4 + sum + (n-1)*2
        const group1 = newN1 > 0 ? 4 + newW1 + (newN1 - 1) * 2 : 0
        const group2 = newN2 > 0 ? 4 + newW2 + (newN2 - 1) * 2 : 0
        // 总宽：两组合框 + 工具条内组框间 gap 4
        const total = group1 + (newN1 > 0 && newN2 > 0 ? 4 : 0) + group2
        if (total <= avail) {
          n1 = newN1
          n2 = newN2
          w1 = newW1
          w2 = newW2
        } else break
      }
      setVisCount(n1 + n2)
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    if (topbarRef.current) ro.observe(topbarRef.current)
    if (measureRef.current) ro.observe(measureRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showZoom])

  // adj281：点击外部关闭任意打开的下拉（汉堡 / 更多 / 视图）；同时支持 Esc 关闭
  useEffect(() => {
    if (!menuOpen && !overflowOpen && !viewOpen) return
    const onDown = (e: MouseEvent) => {
      const root = topbarRef.current
      if (!root) return
      if (!root.contains(e.target as Node)) {
        closeAll()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (menuOpen || overflowOpen || viewOpen)) {
        e.preventDefault()
        e.stopPropagation()
        closeAll()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [menuOpen, overflowOpen, viewOpen])

  // adj185：Alt+字母 打开菜单组；菜单打开时按字母执行 data-hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const name = ALT_MENU_KEYS[e.key.toLowerCase()]
        if (name) {
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen(true)
          setOverflowOpen(false)
          return
        }
      }
      if (menuOpen && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[a-z0-9]$/i.test(e.key)) {
        const active = document.querySelector('.topbar-hamburger.open .menu-dropdown')
        const target = active?.querySelector<HTMLElement>(`[data-hotkey="${e.key.toLowerCase()}"]`)
        if (target) {
          e.preventDefault()
          e.stopPropagation()
          target.click()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuOpen])

  const runFormat = () => {
    const formatted = formatJps(code)
    if (formatted !== code) setCode(formatted)
  }
  const runOpen = async () => {
    await openFile()
  }
  const runSave = async () => {
    await saveFile()
  }
  const runSaveAs = async () => {
    await saveFileAs()
  }

  const fileEntries: (MenuEntry | 'sep')[] = [
    { label: '新建(&N)', kbd: 'Ctrl+N', hotkey: 'n', onPick: newDoc },
    { label: '打开(&O)…', kbd: 'Ctrl+O', hotkey: 'o', onPick: runOpen },
    { label: '保存(&S)', kbd: 'Ctrl+S', hotkey: 's', onPick: runSave },
    { label: '另存为(&A)…', hotkey: 'a', onPick: runSaveAs },
    'sep',
    { label: '格式化脚本(&F)', hotkey: 'f', onPick: runFormat },
    'sep',
    { label: '页面设置(&G)', hotkey: 'g', onPick: () => openModal('pageConfig') },
    { label: '导出(&X)…', hotkey: 'x', onPick: () => openModal('export') },
  ]
  const editEntries: (MenuEntry | 'sep')[] = [
    { label: '撤销(&U)', kbd: 'Ctrl+Z', hotkey: 'u', onPick: undo, disabled: !canUndo },
    { label: '重做(&R)', kbd: 'Ctrl+Y', hotkey: 'r', onPick: redo, disabled: !canRedo },
  ]
  const viewEntries: (MenuEntry | 'sep')[] = [
    { label: '编码(&C)', kbd: '1', hotkey: 'c', onPick: () => setViewType('code') },
    // adj322：按宽窄屏选上下(split) 还是左右(splitH/splitHE)
    { label: '拆分(&S)', kbd: '2', hotkey: 's', onPick: () => setViewType(isNarrow ? 'split' : (splitHDir === 'editorLeft' ? 'splitHE' : 'splitH')) },
    { label: '预览(&P)', kbd: 'Tab', hotkey: 'p', onPick: () => setViewType('preview') },
  ]
  const playEntries: (MenuEntry | 'sep')[] = [
    { label: '试听播放(&P)', kbd: 'Ctrl+Q', hotkey: 'p', onPick: () => openModal('playback') },
    // adj384：音色库管理入口已移除（移入「设置 → 音色库」标签，与主题组同样不再出现在菜单/顶栏）
  ]
  const helpEntries: (MenuEntry | 'sep')[] = [
    { label: '快捷键速查(&K)', kbd: 'Ctrl+~', hotkey: 'k', onPick: () => openModal('shortcuts') },
    { label: '操作手册(&M)', hotkey: 'm', onPick: () => openModal('manual') },
    { label: '脚本语法(&S)', hotkey: 's', onPick: () => openModal('syntax') },
    { label: '脚本规则说明(&J)', onPick: () => window.open('/doc/jps-spec.html', '_blank') },
    { label: '关于(&A)', hotkey: 'a', onPick: () => openModal('about') },
  ]

  return (
    <div className="topbar" ref={topbarRef}>
      {/* Logo */}
      <div className="topbar-brand">
        <img className="logo-mark" src="/Jianpu.png" alt="爱记谱 iJipu" draggable={false} />
        <span className="topbar-brand-text">
          <span className="brand-zh">爱记谱</span>
          <span className="brand-en">iJipu</span>
        </span>
      </div>

      {/* 汉堡菜单（宽屏显示「菜单」标题，窄屏仅 ☰——同排版按钮的 tool-label 约定） */}
      <div className={`topbar-hamburger${menuOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="topbar-btn topbar-hamburger-btn"
          onClick={() => {
            setOverflowOpen(false)
            setViewOpen(false)
            setMenuOpen((v) => !v)
          }}
          title="菜单"
          aria-label="菜单"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M 2 4 H 16" />
            <path d="M 2 9 H 16" />
            <path d="M 2 14 H 16" />
          </svg>
          <span className="tool-label">菜单</span>
        </button>
        {menuOpen && (
          <div
            className="menu-dropdown topbar-hamburger-dropdown"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-group-title">文件</div>
            <MenuPanel entries={fileEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            <div className="menu-group-title">编辑</div>
            <MenuPanel entries={editEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            <div className="menu-group-title">视图</div>
            <MenuPanel entries={viewEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            <div className="menu-group-title">播放</div>
            <MenuPanel entries={playEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            <div className="menu-group-title">帮助</div>
            <MenuPanel entries={helpEntries} onClose={closeMenu} />
          </div>
        )}
      </div>

      {/* 视图切换（adj314：改为下拉按钮，减少宽度占用） */}
      <div className="topbar-views" ref={viewRef}>
        <button
          type="button"
          className={`topbar-btn topbar-view-btn${viewOpen ? ' active' : ''}`}
          onClick={() => {
            setMenuOpen(false)
            setOverflowOpen(false)
            setViewOpen((v) => !v)
          }}
          title="切换视图"
          aria-label="切换视图"
          aria-expanded={viewOpen}
        >
          {viewItem(viewType)?.icon}
          <span className="tool-label">{viewItem(viewType)?.label}</span>
          <span className="arrow">▾</span>
        </button>
        {viewOpen && (
          <div
            className="menu-dropdown topbar-view-dropdown"
            onClick={(e) => e.stopPropagation()}
          >
            {VIEWS.map((v) => {
              // adj315：splitH/splitHE 归入同一「左右拆分」条目；active 用归一化 key 判断
              const isActive = normViewKey(viewType) === v.key
              return (
                <div
                  key={v.key}
                  className={`menu-entry${isActive ? ' active' : ''}`}
                  onClick={() => {
                    // 点「左右拆分」按当前 splitHDir 决定方向（previewLeft→splitH / editorLeft→splitHE）
                    setViewType(v.key === 'splitH' ? (splitHDir === 'editorLeft' ? 'splitHE' : 'splitH') : v.key)
                    closeView()
                  }}
                >
                  {v.icon}
                  <span>{v.label}</span>
                  {isActive && <span style={{ marginLeft: 'auto', color: 'var(--jp-accent)' }}>✓</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="topbar-spacer" />

      {/* 工具条：功能组（顶栏）+ 设置组（从状态栏移来），按工具条长度可容纳数量动态布局；
         放不下的按钮收进「更多」下拉。「⋮ 更多」独立于工具条最右，按需出现。 */}
      <div className="topbar-toolbar" ref={toolbarRef}>
        <div className="topbar-buttons" ref={btnsRef}>
          {toolBtns.slice(0, visCount).filter((t) => t.group === 'topbar').map((t) => (
            <span data-tool-key={t.key} key={t.key} style={{ display: 'contents' }}>
              {renderBtn(t)}
            </span>
          ))}
        </div>
        <div className="topbar-settings" ref={settingsRef}>
          {toolBtns.slice(0, visCount).filter((t) => t.group === 'footer').map((t) => (
            <span data-tool-key={t.key} key={t.key} style={{ display: 'contents' }}>
              {renderBtn(t)}
            </span>
          ))}
        </div>
        {/* 支持作者：独立于工具条最右侧（不参与功能组/设置组折叠，始终可见） */}
        <button
          ref={donateRef}
          type="button"
          className="topbar-btn topbar-donate"
          onClick={() => openModal('donate')}
          title="支持作者"
          aria-label="支持作者"
        >
          {iconOf('donate')}
          <span className="tool-label">支持</span>
        </button>
      </div>

      {/* 「更多」按钮：公共更多按钮，独立于工具条最右，按需出现（空间不足时显示） */}
      {visCount < toolBtns.length && (
        <div className={`topbar-overflow${overflowOpen ? ' open' : ''}`} ref={overflowBtnRef} style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="topbar-overflow-btn"
            onClick={() => {
              setMenuOpen(false)
              setViewOpen(false)
              setOverflowOpen((v) => !v)
            }}
            title="更多工具"
            aria-label="更多工具"
            aria-expanded={overflowOpen}
          >
            {/* 三点垂直图标（更多） */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <circle cx="7" cy="3" r="1.4" />
              <circle cx="7" cy="7" r="1.4" />
              <circle cx="7" cy="11" r="1.4" />
            </svg>
          </button>
          {overflowOpen && (
            <div
              className="menu-dropdown topbar-overflow-dropdown"
              ref={overflowDropdownRef}
              onClick={(e) => e.stopPropagation()}
              style={overflowShiftX ? { transform: `translateX(${overflowShiftX}px)` } : undefined}
            >
              <div className="menu-group-title">更多工具</div>
              {toolBtns.slice(visCount).map(renderOverflowItem)}
            </div>
          )}
        </div>
      )}

      {/* 隐藏测量容器：渲染全部按钮（按组分两段），仅用于测量宽度（不参与布局/交互） */}
      <div
        className="topbar-measure"
        ref={measureRef}
        aria-hidden="true"
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: -1 }}
      >
        {toolBtns.map((t) => (
          <span data-tool-key={t.key} key={t.key} style={{ display: 'inline-block' }}>
            {renderBtn(t)}
          </span>
        ))}
      </div>
    </div>
  )
}