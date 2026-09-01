/**
 * App.tsx — iJipu（爱记谱）应用外壳
 * 布局（adj281）：
 *   TopBar（合并原菜单栏 + 工具栏）/ 主区域（编码·拆分·预览）/
 *   EditorFootBar（合并原脚本编辑器顶栏 + 状态栏）+ 模态框
 */
import { useEffect, useRef } from 'react'
import { TopBar } from './ui/TopBar'
import { EditorFootBar } from './ui/EditorFootBar'
import { Toast } from './ui/Toast'
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
import { DocDialog } from './dialogs/DocDialog'
import { DonateDialog } from './dialogs/DonateDialog'

function App() {
  const viewType = useDocStore((s) => s.viewType)
  const modal = useUiStore((s) => s.modal)
  const theme = useUiStore((s) => s.theme)
  const themeMode = useUiStore((s) => s.themeMode)
  const systemLight = useUiStore((s) => s.systemLight)
  const setSystemLight = useUiStore((s) => s.setSystemLight)
  const splitPct = useUiStore((s) => s.splitPct)
  const setSplitPct = useUiStore((s) => s.setSplitPct)
  // adj315：左右拆分排列方向（全局设置——预览/编辑在 splitH 时的左右方位）
  const splitHDir = useUiStore((s) => s.splitHDir)
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

  // 拆分视图：拖动分隔条调整窗格占比（adj46 上下；adj315 左右）。
  // dir='v' 上下（分隔条在上/下窗格间，按高度占比）；dir='h' 左右（按宽度占比）。
  // 上下/左右共用同一 splitPct（"第一个窗格"占比）。
  const startSplitDrag = (dir: 'v' | 'h') => (e: React.MouseEvent) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return
    const rect = main.getBoundingClientRect()
    const start = dir === 'v' ? e.clientY : e.clientX
    const startPct = splitPct
    const size = dir === 'v' ? rect.height : rect.width
    if (size <= 0) return
    const onMove = (ev: MouseEvent) => {
      const d = (dir === 'v' ? ev.clientY : ev.clientX) - start
      setSplitPct(startPct + (d / size) * 100)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 左右拆分布局（adj315）：方位由全局设置 splitHDir 决定
  // （previewLeft=左预览右编辑 / editorLeft=左编辑右预览）。
  // 改 splitHDir 后立即生效（renderSplitH 响应式读 uiStore）。
  const isSplitHView = viewType === 'splitH' || viewType === 'splitHE'
  const previewOnLeft = splitHDir !== 'editorLeft'
  const renderSplitH = () => (
    <>
      <div className="split-pane split-pane-h" style={{ flex: `0 0 ${splitPct}%` }}>
        {previewOnLeft ? <PreviewPane /> : <EditorPane />}
      </div>
      <div className="split-divider split-divider-h" onMouseDown={startSplitDrag('h')} title="拖动调整左右窗格宽度" />
      <div className="split-pane split-pane-h">
        {previewOnLeft ? <EditorPane /> : <PreviewPane />}
      </div>
    </>
  )

  return (
    <div className="app" data-theme={theme} data-mode={effectiveMode}>
      <TopBar />
      <div className={`app-main${isSplitHView ? ' app-main-h' : ''}`} ref={mainRef}>
        {viewType === 'code' && <EditorPane />}
        {viewType === 'preview' && <PreviewPane />}
        {viewType === 'split' && (
          <>
            <div className="split-pane" style={{ flex: `0 0 ${splitPct}%` }}>
              <PreviewPane />
            </div>
            <div className="split-divider" onMouseDown={startSplitDrag('v')} title="拖动调整上下窗格高度" />
            <div className="split-pane">
              <EditorPane />
            </div>
          </>
        )}
        {(viewType === 'splitH' || viewType === 'splitHE') && renderSplitH()}
      </div>
      <EditorFootBar />
      <Toast />

      {modal === 'about' && <AboutDialog />}
      {modal === 'samples' && <SamplesDialog />}
      {modal === 'pageConfig' && <PageConfigDialog />}
      {modal === 'playback' && <PlaybackDialog />}
      {modal === 'export' && <ExportDialog />}
      {modal === 'shortcuts' && <ShortcutsDialog />}
      {modal === 'manual' && <DocDialog kind="manual" />}
      {modal === 'syntax' && <DocDialog kind="syntax" />}
      {modal === 'donate' && <DonateDialog />}
    </div>
  )
}

export default App
