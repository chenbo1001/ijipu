/**
 * ui/MenuBar.tsx — 顶部菜单栏（品牌 + 下拉菜单）
 * adj185：支持 Alt+字母 打开对应菜单（Alt+F 文件 / Alt+E 编辑 / Alt+V 视图 /
 * Alt+P 播放 / Alt+T 主题 / Alt+H 帮助），Esc 关闭菜单。
 * adj240：菜单标题/项使用「(&X)」热键符（Windows 风格）——& 后字母渲染下划线，
 * 菜单打开后按对应字母直接执行菜单项。
 */
import { useEffect, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { brand } from '../brand/tokens'
import { THEMES, type ThemeMode } from '../brand/themes'
import { formatJps } from '../engine'

/** Alt+字母 → 菜单名（adj185） */
const ALT_MENU_KEYS: Record<string, string> = {
  f: 'file',
  e: 'edit',
  v: 'view',
  p: 'play',
  t: 'theme',
  h: 'help',
}

/** adj240：渲染热键标签——「文件(&F)」→ 「文件(<u>F</u>)」（& 后字母下划线，& 不显示）
 *  adj241：整体包 <span>（单个 flex item）——菜单项是 flex 布局（space-between），
 *  不包裹时「新建(」「N」「)」会被当成独立 flex item 拉开间距 */
function Hotkey({ text }: { text: string }) {
  const m = /\(&([A-Za-z0-9])\)/.exec(text)
  if (!m) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, m.index)}(<u>{m[1]}</u>){text.slice(m.index + m[0].length)}
    </span>
  )
}

export function MenuBar() {
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const setViewType = useDocStore((s) => s.setViewType)
  const newDoc = useDocStore((s) => s.newDoc)
  const openFile = useDocStore((s) => s.openFile)
  const saveFile = useDocStore((s) => s.saveFile)
  const saveFileAs = useDocStore((s) => s.saveFileAs)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  const canUndo = useDocStore((s) => s.undoStack.length > 0)
  const canRedo = useDocStore((s) => s.redoStack.length > 0)
  const openModal = useUiStore((s) => s.openModal)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const themeMode = useUiStore((s) => s.themeMode)
  const setThemeMode = useUiStore((s) => s.setThemeMode)
  const [open, setOpen] = useState<string | null>(null)

  const toggle = (key: string) => setOpen(open === key ? null : key)

  // adj185：Alt+字母 打开对应菜单；Esc 关闭菜单
  // adj240：菜单打开时按字母执行对应菜单项（data-hotkey）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const name = ALT_MENU_KEYS[e.key.toLowerCase()]
        if (name) {
          e.preventDefault()
          e.stopPropagation()
          setOpen((cur) => (cur === name ? null : name))
          return
        }
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(null)
        return
      }
      // 菜单打开时：按字母执行对应热键菜单项
      // adj241：Alt 按住时也执行（用户「Alt+F 再按 O」的 Alt 不松开场景——
      // 原 !e.altKey 条件导致 Alt 按住时按 O 落入 textarea 输入）；
      // Alt+菜单切换字母（ALT_MENU_KEYS）已由上方分支处理并 return
      if (open && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[a-z0-9]$/i.test(e.key)) {
        const dropdown = document.querySelector('.menu-item.open .menu-dropdown')
        const target = dropdown?.querySelector<HTMLElement>(`[data-hotkey="${e.key.toLowerCase()}"]`)
        if (target) {
          e.preventDefault()
          e.stopPropagation()
          target.click()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const runFormat = () => {
    const formatted = formatJps(code)
    if (formatted !== code) setCode(formatted)
    setOpen(null)
  }

  const runOpen = async () => {
    await openFile()
    setOpen(null)
  }
  const runSave = async () => {
    await saveFile()
    setOpen(null)
  }
  const runSaveAs = async () => {
    await saveFileAs()
    setOpen(null)
  }

  return (
    <div className="menubar">
      <div className="menubar-brand">
        {/* adj159：品牌图标改用 Jianpu.png（与 favicon/PWA 图标同源） */}
        <img className="logo-mark" src="/Jianpu.png" alt="JianpuScript" draggable={false} />
        <span>
          <span className="brand-zh">码上简谱</span>{' '}
          <span className="brand-en">JianpuScript</span>
        </span>
      </div>

      <MenuItem label="文件(&F)" open={open} name="file" toggle={toggle}>
        <div className="menu-entry" data-hotkey="n" onClick={() => { newDoc(); setOpen(null) }}>
          <Hotkey text="新建(&N)" /> <span className="kbd">Ctrl+N</span>
        </div>
        <div className="menu-entry" data-hotkey="o" onClick={runOpen}>
          <Hotkey text="打开(&O)…" /> <span className="kbd">Ctrl+O</span>
        </div>
        <div className="menu-entry" data-hotkey="s" onClick={runSave}>
          <Hotkey text="保存(&S)" /> <span className="kbd">Ctrl+S</span>
        </div>
        <div className="menu-entry" data-hotkey="a" onClick={runSaveAs}>
          <Hotkey text="另存为(&A)…" />
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" data-hotkey="e" onClick={() => { openModal('samples'); setOpen(null) }}>
          <Hotkey text="打开示例谱(&E)" />
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" data-hotkey="f" onClick={runFormat}>
          <Hotkey text="格式化脚本(&F)" />
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" data-hotkey="g" onClick={() => { openModal('pageConfig'); setOpen(null) }}>
          <Hotkey text="页面设置(&G)" />
        </div>
        <div className="menu-entry" data-hotkey="x" onClick={() => { openModal('export'); setOpen(null) }}>
          <Hotkey text="导出(&X)…" />
        </div>
      </MenuItem>

      <MenuItem label="编辑(&E)" open={open} name="edit" toggle={toggle}>
        <div
          className={`menu-entry${canUndo ? '' : ' disabled'}`}
          data-hotkey="u"
          onClick={() => {
            if (canUndo) {
              undo()
              setOpen(null)
            }
          }}
        >
          <Hotkey text="撤销(&U)" /> <span className="kbd">Ctrl+Z</span>
        </div>
        <div
          className={`menu-entry${canRedo ? '' : ' disabled'}`}
          data-hotkey="r"
          onClick={() => {
            if (canRedo) {
              redo()
              setOpen(null)
            }
          }}
        >
          <Hotkey text="重做(&R)" /> <span className="kbd">Ctrl+Y</span>
        </div>
      </MenuItem>

      <MenuItem label="视图(&V)" open={open} name="view" toggle={toggle}>
        <div className="menu-entry" data-hotkey="c" onClick={() => { setViewType('code'); setOpen(null) }}>
          <Hotkey text="编码(&C)" /> <span className="kbd">1</span>
        </div>
        <div className="menu-entry" data-hotkey="s" onClick={() => { setViewType('split'); setOpen(null) }}>
          <Hotkey text="拆分(&S)" /> <span className="kbd">2</span>
        </div>
        <div className="menu-entry" data-hotkey="p" onClick={() => { setViewType('preview'); setOpen(null) }}>
          <Hotkey text="预览(&P)" /> <span className="kbd">Tab</span>
        </div>
      </MenuItem>

      <MenuItem label="播放(&P)" open={open} name="play" toggle={toggle}>
        <div className="menu-entry" data-hotkey="p" onClick={() => { openModal('playback'); setOpen(null) }}>
          <Hotkey text="试听播放(&P)" /> <span className="kbd">Ctrl+Q</span>
        </div>
      </MenuItem>

      <MenuItem label="主题(&T)" open={open} name="theme" toggle={toggle}>
        {/* adj48：浅深色模式（auto 跟随系统 prefers-color-scheme） */}
        <div className="theme-mode-row">
          {(
            [
              { key: 'auto', label: '跟随系统(&A)', hk: 'a' },
              { key: 'light', label: '浅色(&L)', hk: 'l' },
              { key: 'dark', label: '深色(&D)', hk: 'd' },
            ] as { key: ThemeMode; label: string; hk: string }[]
          ).map((m) => (
            <button
              key={m.key}
              data-hotkey={m.hk}
              className={`theme-mode-btn${themeMode === m.key ? ' active' : ''}`}
              onClick={() => { setThemeMode(m.key); setOpen(null) }}
            >
              <Hotkey text={m.label} />
            </button>
          ))}
        </div>
        <div className="theme-mode-tip">
          {themeMode === 'auto' ? '自动跟随系统浅深色设置' : themeMode === 'light' ? '固定使用浅色配色' : '固定使用深色配色'}
        </div>
        {THEMES.map((t) => (
          <div
            key={t.id}
            className="menu-entry theme-entry"
            onClick={() => { setTheme(t.id); setOpen(null) }}
          >
            {theme === t.id ? (
              <span
                className="theme-swatch"
                style={{
                  background: themeMode === 'light' ? t.accentLight : t.accent,
                  borderColor: themeMode === 'light' ? t.accentLight : t.accent,
                }}
              >
                ✓
              </span>
            ) : (
              <span
                className="theme-swatch"
                style={{
                  background: themeMode === 'light' ? t.bgLight : t.bg,
                  borderColor: themeMode === 'light' ? t.accentLight : t.accent,
                }}
              />
            )}
            <span className="theme-name">{t.name}</span>
            <span
              className="theme-desc"
              style={{ color: themeMode === 'light' ? t.accentLight : t.accent }}
            >
              {t.desc}
            </span>
          </div>
        ))}
      </MenuItem>

      <MenuItem label="帮助(&H)" open={open} name="help" toggle={toggle}>
        <div className="menu-entry" data-hotkey="k" onClick={() => { openModal('shortcuts'); setOpen(null) }}>
          <Hotkey text="快捷键速查(&K)" /> <span className="kbd">Ctrl+~</span>
        </div>
        <div className="menu-entry" data-hotkey="a" onClick={() => { openModal('about'); setOpen(null) }}>
          <Hotkey text="关于(&A)" /> {brand.name}
        </div>
      </MenuItem>
    </div>
  )
}

function MenuItem(props: {
  label: string
  name: string
  open: string | null
  toggle: (key: string) => void
  children: React.ReactNode
}) {
  const isOpen = props.open === props.name
  return (
    <div className={`menu-item${isOpen ? ' open' : ''}`} onClick={() => props.toggle(props.name)}>
      <Hotkey text={props.label} />
      {isOpen && <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>{props.children}</div>}
    </div>
  )
}
