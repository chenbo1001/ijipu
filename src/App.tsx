/**
 * App.tsx — JianpuScript（码上简谱）应用外壳
 * 布局：菜单栏 / 工具栏 / 主区域（按视图：编码·拆分·预览）/ 状态栏 + 模态框
 */
import { useEffect } from 'react'
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

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useDocStore.getState()
      const ui = useUiStore.getState()
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        downloadJps(st.code, st.fileName)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        st.newDoc()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        ui.openModal('samples')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        ui.openModal('playback')
      } else if (e.key === 'Tab' && !ui.modal) {
        e.preventDefault()
        st.setViewType(st.viewType === 'preview' ? 'split' : 'preview')
      } else if (e.key === 'Escape' && ui.modal) {
        ui.closeModal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app" data-theme={theme}>
      <MenuBar />
      <Toolbar />
      <div className="app-main">
        {viewType === 'code' && <EditorPane />}
        {viewType === 'preview' && <PreviewPane />}
        {viewType === 'split' && (
          <>
            <PreviewPane />
            <EditorPane />
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

function downloadJps(code: string, name: string) {
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || '未命名'}.jps`
  a.click()
  URL.revokeObjectURL(url)
}

export default App
