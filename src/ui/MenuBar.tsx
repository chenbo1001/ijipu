/**
 * ui/MenuBar.tsx — 顶部菜单栏（品牌 + 下拉菜单）
 */
import { useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { brand } from '../brand/tokens'
import { THEMES, type ThemeMode } from '../brand/themes'
import { formatJps } from '../engine'

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

      <MenuItem label="文件(F)" open={open} name="file" toggle={toggle}>
        <div className="menu-entry" onClick={() => { newDoc(); setOpen(null) }}>
          新建 <span className="kbd">Ctrl+N</span>
        </div>
        <div className="menu-entry" onClick={runOpen}>
          打开… <span className="kbd">Ctrl+O</span>
        </div>
        <div className="menu-entry" onClick={runSave}>
          保存 <span className="kbd">Ctrl+S</span>
        </div>
        <div className="menu-entry" onClick={runSaveAs}>
          另存为…
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" onClick={() => { openModal('samples'); setOpen(null) }}>
          打开示例谱
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" onClick={runFormat}>
          格式化脚本
        </div>
        <div className="menu-sep" />
        <div className="menu-entry" onClick={() => { openModal('pageConfig'); setOpen(null) }}>
          页面设置
        </div>
        <div className="menu-entry" onClick={() => { openModal('export'); setOpen(null) }}>
          导出…
        </div>
      </MenuItem>

      <MenuItem label="编辑(E)" open={open} name="edit" toggle={toggle}>
        <div
          className={`menu-entry${canUndo ? '' : ' disabled'}`}
          onClick={() => {
            if (canUndo) {
              undo()
              setOpen(null)
            }
          }}
        >
          撤销 <span className="kbd">Ctrl+Z</span>
        </div>
        <div
          className={`menu-entry${canRedo ? '' : ' disabled'}`}
          onClick={() => {
            if (canRedo) {
              redo()
              setOpen(null)
            }
          }}
        >
          重做 <span className="kbd">Ctrl+Y</span>
        </div>
      </MenuItem>

      <MenuItem label="视图(V)" open={open} name="view" toggle={toggle}>
        <div className="menu-entry" onClick={() => { setViewType('code'); setOpen(null) }}>
          编码 <span className="kbd">1</span>
        </div>
        <div className="menu-entry" onClick={() => { setViewType('split'); setOpen(null) }}>
          拆分 <span className="kbd">2</span>
        </div>
        <div className="menu-entry" onClick={() => { setViewType('preview'); setOpen(null) }}>
          预览 <span className="kbd">Tab</span>
        </div>
      </MenuItem>

      <MenuItem label="播放(P)" open={open} name="play" toggle={toggle}>
        <div className="menu-entry" onClick={() => { openModal('playback'); setOpen(null) }}>
          试听播放 <span className="kbd">Ctrl+Q</span>
        </div>
      </MenuItem>

      <MenuItem label="主题(T)" open={open} name="theme" toggle={toggle}>
        {/* adj48：浅深色模式（auto 跟随系统 prefers-color-scheme） */}
        <div className="theme-mode-row">
          {(
            [
              { key: 'auto', label: '跟随系统' },
              { key: 'light', label: '浅色' },
              { key: 'dark', label: '深色' },
            ] as { key: ThemeMode; label: string }[]
          ).map((m) => (
            <button
              key={m.key}
              className={`theme-mode-btn${themeMode === m.key ? ' active' : ''}`}
              onClick={() => { setThemeMode(m.key); setOpen(null) }}
            >
              {m.label}
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

      <MenuItem label="帮助(H)" open={open} name="help" toggle={toggle}>
        <div className="menu-entry" onClick={() => { openModal('shortcuts'); setOpen(null) }}>
          快捷键速查 <span className="kbd">Ctrl+~</span>
        </div>
        <div className="menu-entry" onClick={() => { openModal('about'); setOpen(null) }}>
          关于 {brand.name}
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
      {props.label}
      {isOpen && <div className="menu-dropdown" onClick={(e) => e.stopPropagation()}>{props.children}</div>}
    </div>
  )
}
