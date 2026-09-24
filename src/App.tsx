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
import { startWorkspaceIndexWarmup } from './store/workspaceIndexWarm'
// adj610：Ctrl+D / Ctrl+H 的"有告警先看告警"判据与「展开底栏」按钮同一份（`ui/problems.ts`）
import { summarizeProblems } from './ui/problems'
// adj614：Ctrl+M 的视图循环顺序（与顶栏「视图」下拉同一份，见 `ui/viewCycle.ts`）
import { nextViewType } from './ui/viewCycle'
// adj614：Ctrl+T 的深浅模式循环（与顶栏「深浅模式」按钮同一份）
import { nextThemeMode } from './brand/themes'
// adj621：应用标题统一来源（浏览器页签 + 桌面窗口标题共用 `APP_TITLE_FULL`）
import { APP_TITLE_FULL } from './brand/version'
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

  /**
   * adj599（用户要求）：**启动后在后台空闲时段预热历史工作区的索引**。
   * 用户口径："打开网站后就在后台异步进行，对历史工作区的目录进行索引缓存，先当前工作区，
   * 再其它工作区，这样在用户点击工作区时，基本就已索引完成；当然对于新工作区，就只能立即索引缓存。"
   * 细节（空闲调度、当前优先、只扫已授权且索引过期的、写操作作废在跑的扫描、不弹提示）都在
   * `startWorkspaceIndexWarmup()` 里；这里只负责"启动一次"（幂等）。
   */
  useEffect(() => {
    startWorkspaceIndexWarmup()
  }, [])

  /**
   * adj615（用户要求）：注册**打印钩子**（`beforeprint` / `afterprint`，幂等，只装一次）。
   *
   * 为什么要它：`Ctrl+P` 在浏览器里会被内核收去**弹自己的打印对话框**（页面收不到 keydown ⇒
   * 应用里的打印处理跑不到）；但那种情况仍会触发 `beforeprint` ⇒ 在这里补上"打印用页面 + 隐藏应用界面"，
   * 打出来的才是谱面而不是整个应用界面（见 `export/print.ts`）。
   */
  useEffect(() => {
    useDocStore.getState().installPrintSupport()
  }, [])

  /**
   * adj621（用户要求）：**统一应用标题**——浏览器页签、PWA 页签、Tauri 桌面窗口标题都用
   * 「爱记谱 iJipu - v0.36.0 (2026-09-23 @4ed877a3)」形式，方便在 OS 任务栏 / Alt+Tab /
   * Chrome 页签一眼看出当前应用版本。
   *
   * 三处都来自 `brand/version.ts` 的 `APP_TITLE_FULL` 单一来源：
   *   ① `document.title`：浏览器页签 + PWA 页签（同一份 window.title，无副作用）；
   *   ② `core.invoke('plugin:window|set_title', { label, value })`：桌面 OS 窗口标题栏 / 任务栏
   *      —— 用裸 IPC 而非 `getCurrentWindow().setTitle()` JS API，因为后者在 React mount 时
   *      可能撞上 `window.__TAURI__` 注入时机（adj621 实测：mount 那一刻 `__TAURI__.window`
   *      子树可能还没 ready，JS API 包装的 setTitle 静默失败、document.title 改对了但 OS 窗口标题
   *      没动；用户实测看到的 OS 任务栏一直是 `tauri.conf.json` 里的硬编码「爱记谱 iJipu」）。
   *      用 `core.invoke` 走短路径更稳：capability 已声明 `core:window:allow-set-title`，
   *      IPC 参数 `{ label: 'main', value: APP_TITLE_FULL }`（v2 命令签名是 `value` 不是 `title`）。
   *   ③ 初始 `index.html` <title> 仍是 `爱记谱 iJipu`（无版本），挂载前那一瞬的占位——
   *      几十毫秒内就被本 effect 覆盖；用户能看到的最终标题就是这里 set 的完整形式。
   *
   * 设置 OS 窗口标题放在 `requestAnimationFrame` 之后跑，确保 WebView 的 `withGlobalTauri`
   * 注入窗口标题 IPC 通道就绪（adj621 实测：mount 那一刻直接调会被静默吞掉，延一帧就好）。
   *
   * 失败（非 Tauri 环境 / 权限缺失）静默忽略——浏览器里没这个 IPC。
   */
  useEffect(() => {
    document.title = APP_TITLE_FULL
    const raf = requestAnimationFrame(() => {
      const g = (window as unknown as {
        __TAURI__?: {
          core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> }
        }
      }).__TAURI__
      const invoke = g?.core?.invoke
      if (typeof invoke === 'function') {
        void invoke('plugin:window|set_title', { label: 'main', value: APP_TITLE_FULL }).catch(() => {
          /* setTitle 失败不影响页面功能 —— document.title 已生效，至少页签/任务栏 tooltip
             用的是页面 title（多数浏览器/Win 任务栏 hover 都看这个） */
        })
      }
    })
    return () => cancelAnimationFrame(raf)
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
        // adj70：撤销 Ctrl+Z（重做原为 Ctrl+Y；adj619b 起挪到 Ctrl+Shift+Z）
        e.preventDefault()
        e.stopPropagation()
        st.undo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj619b：`Ctrl+Y` 让给「导出」之后，**重做改用跨平台惯例 `Ctrl+Shift+Z`**
         * （`Ctrl+Z` 撤销那条带 `!e.shiftKey`，两条互不抢键；速查表与菜单提示同步改了）。
         */
        st.redo()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj619b（用户要求）：**`Ctrl+Y` = 导出开关**（用户口径"导出的快捷键改为 Ctrl+Y"）。
         * ⚠ 这个键原来是"重做" ⇒ 重做已挪到 `Ctrl+Shift+Z`（见上一条分支与速查表），
         * 一个键不能既重做又开导出。
         */
        ui.requestDockPanel('export')
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void st.saveFile()
      } else if ((e.ctrlKey || e.altKey) && !e.shiftKey && e.key.toLowerCase() === 'n') {
        /**
         * adj628：**新建**同时接受 `Ctrl+N` 与 `Alt+N`。
         *
         * 为什么两条都要：`Ctrl+N` 是**浏览器自己占的快捷键**（开新窗口）——网页版页面收不到它，
         * 于是"看着像新建、其实新窗口恢复了上次的草稿与文件绑定"，在新窗口里编辑保存会**覆盖原文件**
         * （用户报的正是这个：Ctrl+N 后状态栏还是上一个文件名；真机复现见 E-2026-310）。
         * 网页版因此改用页面能拦下的 `Alt+N`（菜单/速查显示的也是它，见 `brand/shortcuts.ts`）；
         * 桌面壳（wry 关掉了 WebView2 的浏览器快捷键）照旧 `Ctrl+N`，两条都收，省得用户换机时按错。
         */
        e.preventDefault()
        e.stopPropagation()
        st.newDoc()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        e.stopPropagation()
        // adj563：原为 `openModal('playback')`，但试听早在 adj462 迁进底栏 dock
        // ⇒ `modal === 'playback'` 没有渲染分支、**Ctrl+Q 是死的**（菜单上还印着 Ctrl+Q）。
        // 与菜单项 `entryTryout` 同口径：开关「试听」底栏。
        // adj619（用户要求）：底栏入口快捷键走 `requestDockPanel`——**最小化时先展开到建议高度**
        //（"是否最小化"只有 ToolDock 自己知道，故只发请求，见 uiStore 里那条说明）。
        ui.requestDockPanel('tryout')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj619b（用户要求）：**`Ctrl+O` 改回「打开文件」**——用户口径"对于 Ctrl+O 还是保持
         * 对应打开对话框吧"。于是 adj615 那次"改挂导出"整体回退：菜单里「打开」的 `Ctrl+O`
         * 角标也回来了，导出改用 `Ctrl+Y`（见上面的分支）。
         */
        void st.openFile()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj615（用户要求）：**Ctrl+P = 打印**（打开打印对话框，打印当前谱面）。
         * 与菜单「打印(&D)…」共用 `printScore()`：现算布局与 SVG、有语法错误就提示不打。
         *
         * ⚠ 平台差异（实测见 E-2026-301）：**浏览器**把 `Ctrl+P` 留给了自己的打印对话框
         * （页面收不到 keydown）——不过那条路同样会走 `beforeprint`，打印内容一样正确
         * （`installPrintSupport()` 在那里补页面）；桌面壳里本 handler 正常生效。
         */
        st.printScore()
      } else if (e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj614（用户要求）：**Ctrl+T = 深浅模式循环**（`auto → light → dark → auto`）。
         * 循环表在 `brand/themes.ts` 的 `nextThemeMode()`，与顶栏「深浅模式」按钮**同一份**
         * （按钮的提示文案"点击切到哪一档"说的就是它的结果）。
         *
         * ⚠ **平台限制（实测）**：浏览器把 `Ctrl+T` 留给了"新标签页"，`preventDefault` 拦不住
         * ⇒ 网页版这一条按不动（`Ctrl+L` / `Ctrl+K` / `Ctrl+M` 浏览器里都能拦下）；
         * 桌面壳（WebView2 没有标签页 UI）**四条都可用**——含 Ctrl+T 在内已用真机 CDP 验过，见 E-2026-300。
         */
        ui.setThemeMode(nextThemeMode(ui.themeMode))
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        e.stopPropagation()
        // adj614（用户要求）：Ctrl+L = 折行开关（与顶栏「折行」按钮同一个 store 字段）
        ui.setAutoWrap(!ui.autoWrap)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        // adj614（用户要求）：Ctrl+K = 输入条开关（与顶栏「输入条」按钮同一个 store 字段）
        ui.setShowScriptPad(!ui.showScriptPad)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj614（用户要求）：**Ctrl+M = 视图循环**（编码 → 拆分 → 左右拆分 → 预览 → 编码）。
         * 顺序与"下一个是谁"收敛在 `ui/viewCycle.ts`，与顶栏「视图」下拉**同一份**
         * （窄屏跳过「左右拆分」、`splitHE`/`splitH` 按 `splitHDir` 选方向，两处口径一致）。
         */
        st.setViewType(nextViewType(st.viewType, { narrow: ui.isNarrow, splitHDir: ui.splitHDir }))
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj616（用户要求）：**Ctrl+E = 排版开关**（排版辅助虚线；与顶栏「排版」按钮、
         * 菜单「排版」同一件事）——直接翻 `uiStore.showGuides` 这一个字段（顶栏那个按钮也是
         * 这么做的），不另建一份状态。
         */
        ui.setShowGuides(!ui.showGuides)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        e.stopPropagation()
        // adj616（用户要求）：Ctrl+B = 工作区开关（与菜单「工作区」、底栏「工作区」页签同一条入口）
        ui.requestDockPanel('workspace')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        e.stopPropagation()
        // adj616（用户要求）：Ctrl+I = 导入开关（与菜单「粘贴源码导入」、底栏「导入」页签同一条入口）
        ui.requestDockPanel('import')
      } else if (e.ctrlKey && (e.code === 'Backquote' || e.key === '`' || e.key === '~')) {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj618（用户要求）：**`Ctrl+`` = 告警开关**——与底栏「告警」页签、状态栏里那条告警文本按钮
         * 共用同一条入口。按 Shift 的那一档（`Ctrl+~`）**同样走告警**（同一个物理键，不给它留死键）。
         *
         * 用 `e.code === 'Backquote'`（物理键）而不是只看 `e.key`：这个键在中文/其它布局下
         * 产出的字符各不相同，认物理键才不会"换个输入法就按不动"。
         *
         * （原先 `Ctrl+~` 兼作"快捷键速查"，adj619c 起速查改成 `Alt+F1`，见下一条分支。）
         */
        ui.requestDockPanel('problems')
      } else if (e.altKey && e.key === 'F1') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj619c（用户要求）：**`Alt+F1` = 快捷键速查**（用户口径"快捷键速查改为 Alt+F1"）。
         * 与菜单「快捷键速查(&K)…」共用同一个 `openModal('shortcuts')`。
         */
        ui.openModal('shortcuts')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj610（用户要求）：**Ctrl+D = 底栏展开 / 收起**。
         *
         * 展开走 `ui.expandDock()`（**唯一实现**，含 adj591「有告警先切到告警页签」的口径），
         * 收起就是 `closeDock()`——与左下角「展开底栏」按钮 / 页签栏「收起底栏」按钮**完全同路**，
         * 不会出现"按快捷键打开看到的页签与点按钮不一样"。
         *
         * ⚠ 与 Ctrl+N/Ctrl+T 不同：Ctrl+D（书签）与 Ctrl+H（历史）**在浏览器里可以被
         * `preventDefault()` 拦下**，所以网页版里这两条也能用（Ctrl+N 在 Chrome 里拦不住）。
         */
        if (ui.dockOpen) ui.closeDock()
        else ui.expandDock(summarizeProblems(st.parseResult.errors).total > 0)
      } else if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        e.stopPropagation()
        /**
         * adj610（用户要求）：**Ctrl+H = 按一下底栏高度档位按钮**（建议 → 最大 → 建议 → 最小 → …）。
         *
         * 档位状态在 `ToolDock` 内部，所以这里只发一次性请求（`requestDockSizeStep`），
         * 由它执行自己的 `cycleDockHeight()`——与点按钮走的是同一条代码。
         * 底栏**没展开时那个按钮不存在** ⇒ 先按「展开底栏」同一条路展开（建议高度），
         * 让这个键不会"按了没反应"。
         */
        if (ui.dockOpen) ui.requestDockSizeStep()
        else ui.expandDock(summarizeProblems(st.parseResult.errors).total > 0)
      } else if (e.key === 'Tab' && !ui.modal && !(e.target as HTMLElement | null)?.closest?.('.editor-main')) {
        // 编辑器内 Tab 留给自动补全/默认行为（completion 时补全），其余区域切换视图
        e.preventDefault()
        e.stopPropagation()
        st.setViewType(st.viewType === 'preview' ? 'split' : 'preview')
      } else if (e.key === 'Escape' && ui.modal) {
        /**
         * adj612：关对话框时**标记"这个 ESC 我用掉了"**——底栏那侧的全局 ESC（最小化底栏）挂在
         * **window 冒泡**阶段，而本 handler 是**捕获**阶段（先跑）：此刻 `ui.modal` 已被置空，
         * 底栏那边再读 state 就看不到"刚才有对话框"，`preventDefault` 是唯一可靠的交接方式。
         */
        e.preventDefault()
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
