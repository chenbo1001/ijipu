/**
 * ui/MenuBar.tsx — 顶部菜单栏（品牌 + 下拉菜单）
 */
import { useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { brand } from '../brand/tokens'
import { THEMES } from '../brand/themes'
import { formatJps } from '../engine'

export function MenuBar() {
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const setViewType = useDocStore((s) => s.setViewType)
  const newDoc = useDocStore((s) => s.newDoc)
  const openModal = useUiStore((s) => s.openModal)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const [open, setOpen] = useState<string | null>(null)

  const toggle = (key: string) => setOpen(open === key ? null : key)

  const runFormat = () => {
    const formatted = formatJps(code)
    if (formatted !== code) setCode(formatted)
    setOpen(null)
  }

  const download = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName || '未命名'}.jps`
    a.click()
    URL.revokeObjectURL(url)
    setOpen(null)
  }

  return (
    <div className="menubar">
      <div className="menubar-brand">
        <span className="logo-mark">谱</span>
        <span>
          <span className="brand-zh">码上简谱</span>{' '}
          <span className="brand-en">JianpuScript</span>
        </span>
      </div>

      <MenuItem label="文件(F)" open={open} name="file" toggle={toggle}>
        <div className="menu-entry" onClick={() => { newDoc(); setOpen(null) }}>
          新建乐谱 <span className="kbd">Ctrl+N</span>
        </div>
        <div className="menu-entry" onClick={() => { openModal('samples'); setOpen(null) }}>
          打开示例谱 <span className="kbd">Ctrl+O</span>
        </div>
        <div className="menu-entry" onClick={download}>
          保存为 .jps <span className="kbd">Ctrl+S</span>
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
        {THEMES.map((t) => (
          <div
            key={t.id}
            className="menu-entry"
            style={{ alignItems: 'center' }}
            onClick={() => { setTheme(t.id); setOpen(null) }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                borderRadius: 4,
                background: t.bg,
                border: `1px solid ${t.accent}`,
                flexShrink: 0,
              }}
              title={`${t.name} · ${t.accent}`}
            />
            <span>{t.name}</span>
            <span style={{ color: t.accent, fontSize: 11, marginLeft: 2 }}>
              {t.desc}
            </span>
            {theme === t.id && <span className="kbd">●</span>}
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

      <div className="menubar-filename">
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
        <span>{fileName}.jps</span>
      </div>
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
