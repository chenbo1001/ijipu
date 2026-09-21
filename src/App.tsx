/**
 * App.tsx — iJipu（爱记谱）应用外壳
 * 布局（adj281）：
 *   TopBar（合并原菜单栏 + 工具栏）/ 主区域（编码·拆分·预览）/
 *   ToolDock（adj462：底部 dock，告警/试听/导出/设置互斥切换）/
 *   EditorFootBar（合并原脚本编辑器顶栏 + 状态栏）+ 模态框
 */
import { Suspense, lazy, useEffect, useRef } from 'react'
import { TopBar } from './ui/TopBar'
import { EditorFootBar } from './ui/EditorFootBar'
import { ToolDock } from './ui/ToolDock'
import { beginDrag } from './ui/dragGesture'
import { Toast } from './ui/Toast'
import { UpdatePrompt } from './ui/UpdatePrompt'
import { EditorPane } from './editor/EditorPane'
import { PreviewPane } from './preview/PreviewPane'
import { useDocStore } from './store/docStore'
import { useUiStore } from './store/uiStore'
// adj538：桌面壳「外部打开」（双击 .jps）——拉取待打开队列 + 监听后续打开请求
import { drainExternalFiles, hasShell, onExternalOpen } from './store/externalOpen'
// adj350：对话框懒加载（React.lazy）——首屏不加载它们，显著减小主包、加快首屏显示
// adj492：「关于」已迁入底栏 dock（见 ui/ToolDock），此处不再需要弹窗版懒加载
const SamplesDialog = lazy(() => import('./dialogs/SamplesDialog').then((m) => ({ default: m.SamplesDialog })))
// adj462：试听/导出/设置的对话框内容已移到底部 dock（ToolDock 里的 registry 懒加载它们），
// 不再从 App 作为模态渲染
const ShortcutsDialog = lazy(() => import('./dialogs/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })))
const DocDialog = lazy(() => import('./dialogs/DocDialog').then((m) => ({ default: m.DocDialog })))
const DonateDialog = lazy(() => import('./dialogs/DonateDialog').then((m) => ({ default: m.DonateDialog })))
// adj562：「粘贴源码导入」已迁入底栏（ToolDock 的「导入」页签）⇒ 不再从 App 作为模态渲染
// adj509：试听音色选择对话框（从音色库面板的「指定音色」按钮触发）
const VoicePickerDialog = lazy(() => import('./dialogs/VoicePickerDialog').then((m) => ({ default: m.VoicePickerDialog })))

function App() {
  const viewType = useDocStore((s) => s.viewType)
  const modal = useUiStore((s) => s.modal)
  const theme = useUiStore((s) => s.theme)
  const themeMode = useUiStore((s) => s.themeMode)
  const systemLight = useUiStore((s) => s.systemLight)
  const setSystemLight = useUiStore((s) => s.setSystemLight)
  const splitPct = useUiStore((s) => s.splitPct)
  const setSplitPct = useUiStore((s) => s.setSplitPct)
  // adj322：宽/窄屏实时同步
  const isNarrow = useUiStore((s) => s.isNarrow)
  const setIsNarrow = useUiStore((s) => s.setIsNarrow)
  // adj315：左右拆分排列方向（全局设置——预览/编辑在 splitH 时的左右方位）
  const splitHDir = useUiStore((s) => s.splitHDir)
  const mainRef = useRef<HTMLDivElement>(null)

  /**
   * adj538：桌面壳「外部打开」（双击 `.jps` / 文件关联）接线。
   * 两条路都指向 Rust 侧同一个**取走即清空**的队列，因此既不会漏也不会重复打开：
   *   ① 冷启动：双击时应用还没起，事件可能早于我此刻注册监听 ⇒ mount 时**主动拉取一次**；
   *   ② 热启动：应用已在运行，单实例插件把路径入队并 emit `ijipu://open-files` ⇒ 监听后拉取。
   * 纯浏览器里 `hasShell()` 恒为 false，这段整体空转（不影响网页版行为）。
   */
  useEffect(() => {
    if (!hasShell()) return
    const load = () => {
      void drainExternalFiles().then((files) => {
        if (files.length > 0) useDocStore.getState().openExternalFiles(files)
      })
    }
    load() // ① 冷启动：处理启动参数带来的文件
    return onExternalOpen(load) // ② 热启动：后续再有双击就再拉一次
  }, [])

  // adj48：跟随系统深浅色——监听 prefers-color-scheme 变化
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

  // adj322：宽/窄屏实时同步——matchMedia 'change' 回调驱动 uiStore.isNarrow
  useEffect(() => {
    try {
      const mq = window.matchMedia('(max-width: 1024px)')
      // 初始值可能与已加载的 draft 视图不同 → 用 mq 当前值纠正一次
      setIsNarrow(mq.matches)
      const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      /* matchMedia 不支持时,detectNarrow 已用 innerWidth 兜底 */
    }
  }, [setIsNarrow])

  // adj322：宽窄屏 → 拆分模式自动切换。
  // 设计：仅依赖 isNarrow（视口跨阈值时触发）。
  // 每次跑通过 store.getState() 取最新值,避免把 viewType/splitHDir 放进 deps
  // —— 这样用户主动改 viewType 时本 effect 不会重入拉回。
  // 首次加载兼容：组件挂载时 effect 首跑,按当前视口纠正持久化的 viewType。
  // 校正规则：
  //   - 仅作用于拆分类视图（split / splitH / splitHE）;
  //   - 窄屏 → 上下 'split'；宽屏 → 左右（按 splitHDir 选 splitH/splitHE）;
  //   - splitH ↔ splitHE 之间不自动切换（保留用户设置的左右方位）。
  useEffect(() => {
    const v = useDocStore.getState().viewType
    if (v !== 'split' && v !== 'splitH' && v !== 'splitHE') return
    const dir = useUiStore.getState().splitHDir
    if (isNarrow && v !== 'split') {
      useDocStore.getState().setViewType('split')
    } else if (!isNarrow && v === 'split') {
      useDocStore.getState().setViewType(dir === 'editorLeft' ? 'splitHE' : 'splitH')
    }
  }, [isNarrow])

  // 实际深浅色：auto 模式下跟随系统偏好
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
        // adj563：原为 `openModal('playback')`，但试听早在 adj462 迁进底栏 dock
        // ⇒ `modal === 'playback'` 没有渲染分支、**Ctrl+Q 是死的**（菜单上还印着 Ctrl+Q）。
        // 与菜单项 `entryTryout` 同口径：开关「试听」底栏。
        ui.toggleDock('tryout')
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
  // adj487：改用 Pointer Events（见 ui/dragGesture）——此前只监听 mousemove/mouseup，手机上拖不动。
  const startSplitDrag = (dir: 'v' | 'h') => (e: React.PointerEvent) => {
    const main = mainRef.current
    if (!main) return
    const rect = main.getBoundingClientRect()
    const size = dir === 'v' ? rect.height : rect.width
    if (size <= 0) return
    const startPct = splitPct
    beginDrag(e, {
      onMove: (dx, dy) => setSplitPct(startPct + ((dir === 'v' ? dy : dx) / size) * 100),
    })
  }

  // 左右拆分布局（adj315）：方位由全局设置 splitHDir 决定
  // （previewLeft=左预览右编辑 / editorLeft=左编辑右预览）。
  // 改 splitHDir 后立即生效（renderSplitH 响应式读 uiStore）。
  const isSplitHView = viewType === 'splitH' || viewType === 'splitHE'
  const previewOnLeft = splitHDir !== 'editorLeft'

  /**
   * adj552（用户要求）：**宽屏左右拆分时，底栏 dock 是"编辑区的底栏"**——只占编辑那一侧，
   * 布局成为「左：预览（通高） | 右：上编辑 / 下底栏」。
   *
   * ⚠️ **窄屏模式不变**（用户明确要求）：上下拆分 / 纯编辑 / 纯预览这三种视图里，
   * 底栏仍在**窗口底部**（原行为，整幅宽度），不受本次改动影响。
   * （窄屏走的是 `split`；`splitH/splitHE` 只在宽屏成立。）
   *
   * ⚠️ 必须**包一层列容器** `.editor-col`：`.split-pane-h` 是 `flex-direction: row`
   * （左右两栏就靠它），直接把编辑区和底栏并列进去会变成**横向**排、底栏被挤成 0 宽（实测 x=1280,w=0）。
   *
   * 为什么必须放进列里（而不是给整幅底栏加左右偏移）：预览那一列要**通高到底**——
   * 若底栏仍是整幅宽度、只把右侧让出来，预览列下方会留一块空白，两列高度关系就断了。
   */
  const editorWithDock = (
    <div className="editor-col">
      <EditorPane />
      <ToolDock />
    </div>
  )
  const renderSplitH = () => (
    <>
      <div className="split-pane split-pane-h" style={{ flex: `0 0 ${splitPct}%` }}>
        {previewOnLeft ? <PreviewPane /> : editorWithDock}
      </div>
      <div className="split-divider split-divider-h" onPointerDown={startSplitDrag('h')} title="拖动调整左右窗格宽度" />
      <div className="split-pane split-pane-h">
        {previewOnLeft ? editorWithDock : <PreviewPane />}
      </div>
    </>
  )

  /**
   * adj483：主题/浅色模式的 `data-theme` / `data-mode` 同步到 **`<html>`** 上。
   *
   * 为什么必须挂到 html：主题变量（`styles/theme.css` 的 `[data-theme]`/`[data-mode='light']`）是
   * **按属性选择器**生效的，而 `index.css` 里 `body { color: var(--jp-text-primary) }` 是在 `body`
   * 处**求值**的——属性此前挂在 `.app`（body 的子元素）上，于是 body 只能拿到 `:root` 的**深色**默认值，
   * 所有"没有显式设色"的文本（如音色库的库名 span）在**浅色主题**下继承到深色主题的浅字 ⇒ 白底浅字看不清
   * （用户报「通用音源（GeneralUser GS）在浅色主题下与背景过近」）。
   * 挂到 `html` 后，`:root` 与主题属性落在同一元素上、变量从根上就是对的（浅色块在后，同特异性后者胜）。
   * `.app` 上的属性保留：个别样式/嵌入方可能仍按 `.app[data-mode]` 取用。
   */
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('data-theme', theme)
    el.setAttribute('data-mode', effectiveMode)
  }, [theme, effectiveMode])

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
            <div className="split-divider" onPointerDown={startSplitDrag('v')} title="拖动调整上下窗格高度" />
            <div className="split-pane">
              <EditorPane />
            </div>
          </>
        )}
        {/* adj552：**只有**宽屏左右拆分把底栏放进编辑列（见 editorWithDock） */}
        {(viewType === 'splitH' || viewType === 'splitHE') && renderSplitH()}
      </div>
      {/* adj462/adj552：底部 dock（告警/试听/导出/设置 共用一个 dock，同一时间只显示一块）。
          **窄屏及非左右拆分的视图保持原样**：底栏仍在窗口底部、整幅宽度。 */}
      {!isSplitHView && <ToolDock />}
      <EditorFootBar />
      <Toast />
      {/* adj379：检测到 SW 新版本时的「点击刷新」提示 */}
      <UpdatePrompt />

      {modal === 'samples' && <Suspense fallback={null}><SamplesDialog /></Suspense>}
      {modal === 'shortcuts' && <Suspense fallback={null}><ShortcutsDialog /></Suspense>}
      {modal === 'manual' && <Suspense fallback={null}><DocDialog kind="manual" /></Suspense>}
      {modal === 'syntax' && <Suspense fallback={null}><DocDialog kind="syntax" /></Suspense>}
      {modal === 'donate' && <Suspense fallback={null}><DonateDialog /></Suspense>}
      {/* adj562：「粘贴源码导入」已迁入底栏「导入」页签（原 adj406 的弹窗入口下线） */}
      {/* adj509：试听音色选择对话框（音色库「指定音色」按钮触发） */}
      {modal === 'voicePicker' && <Suspense fallback={null}><VoicePickerDialog /></Suspense>}
    </div>
  )
}

export default App
