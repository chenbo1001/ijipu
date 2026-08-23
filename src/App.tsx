/**
 * App.tsx — JianpuScript（码上简谱）应用外壳
 * 布局：菜单栏 / 工具栏 / 主区域（按视图：编码·拆分·预览）/ 状态栏 + 模态框
 */
import { useEffect, useRef } from 'react'
import { MenuBar } from './ui/MenuBar'
import { Toolbar } from './ui/Toolbar'
import { StatusBar } from './ui/StatusBar'
import { EditorPane } from './editor/EditorPane'
import { PreviewPane } from './preview/PreviewPane'
import { useDocStore } from './store/docStore'
import { useUiStore } from './store/uiStore'
import { AboutDialog } from './dialogs/AboutDialog'
import { SamplesDialog } from './dialogs/SamplesDialog'
import { PageConfigDialog } from './dialogs/PageConfigDialog'
import { PlaybackDialog } from './dialogs/PlaybackDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'

function App() {
  const viewType = useDocStore((s) => s.viewType)
  const modal = useUiStore((s) => s.modal)
  const theme = useUiStore((s) => s.theme)
  const themeMode = useUiStore((s) => s.themeMode)
  const systemLight = useUiStore((s) => s.systemLight)
  const setSystemLight = useUiStore((s) => s.setSystemLight)
  const splitPct = useUiStore((s) => s.splitPct)
  const setSplitPct = useUiStore((s) => s.setSplitPct)
  const mainRef = useRef<HTMLDivElement>(null)

  // adj48：跟随系统浅深色——监听 prefers-color-scheme 变化
  useEffect(() => {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const onChange = () => setSystemLight(mq.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      return
    }
  }, [setSystemLight])

  // 实际浅深色：auto 模式下跟随系统偏好
  const effectiveMode = themeMode === 'auto' ? (systemLight ? 'light' : 'dark') : themeMode

  // 全局快捷键（adj185：capture 阶段监听——bubble 阶段可能被子元素 stopPropagation 拦截，
  // 导致 Ctrl+S/Ctrl+N 等在编辑器聚焦时失效；capture 最优先且处理即阻断，保证始终响应）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useDocStore.getState()
      const ui = useUiStore.getState()
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        // adj70：撤销 Ctrl+Z（重做统一为 Ctrl+Y）
        e.preventDefault()
        e.stopPropagation()
        st.undo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        e.stopPropagation()
        st.redo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void st.saveFile()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        e.stopPropagation()
        st.newDoc()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        e.stopPropagation()
        void st.openFile()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        e.stopPropagation()
        ui.openModal('playback')
      } else if (e.key === 'Tab' && !ui.modal && !(e.target as HTMLElement | null)?.closest?.('.editor-main')) {
        // 编辑器内 Tab 留给自动补全/默认行为（completion 时补全），其余区域切换视图
        e.preventDefault()
        e.stopPropagation()
        st.setViewType(st.viewType === 'preview' ? 'split' : 'preview')
      } else if (e.key === 'Escape' && ui.modal) {
        ui.closeModal()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 拆分视图：拖动分隔条调整上下两个窗格高度（adj46）
  const startSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return
    const startY = e.clientY
    const startPct = splitPct
    const rect = main.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY
      setSplitPct(startPct + (dy / rect.height) * 100)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="app" data-theme={theme} data-mode={effectiveMode}>
      <MenuBar />
      <Toolbar />
      <div className="app-main" ref={mainRef}>
        {viewType === 'code' && <EditorPane />}
        {viewType === 'preview' && <PreviewPane />}
        {viewType === 'split' && (
          <>
            <div className="split-pane" style={{ flex: `0 0 ${splitPct}%` }}>
              <PreviewPane />
            </div>
            <div className="split-divider" onMouseDown={startSplitDrag} title="拖动调整上下窗格高度" />
            <div className="split-pane">
              <EditorPane />
            </div>
          </>
        )}
      </div>
      <StatusBar />

      {modal === 'about' && <AboutDialog />}
      {modal === 'samples' && <SamplesDialog />}
      {modal === 'pageConfig' && <PageConfigDialog />}
      {modal === 'playback' && <PlaybackDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
    </div>
  )
}

export default App
