/**
 * ui/TopBar.tsx — 顶部栏（adj281：合并原 MenuBar + Toolbar）
 *
 * 布局（从左到右）：
 *   Logo（图标+标题） / 汉堡菜单 ☰ / 视图切换图标组（编码/拆分/预览） /
 *   <弹性间距> / 功能按钮组（排版辅助、试听、导出、设置）/ 缩放比率组（`-` `%` `+`）
 *
 * - 除了缩放比率组外，其它按钮均为「图标 + 标题」（宽屏）；窄屏全部仅图标
 * - 窄屏下：功能按钮组 + 缩放组隐藏到右侧「⋮ 更多」下拉中，避免按钮溢出顶栏
 *   导致整页左右滚动；汉堡下拉与「更多」下拉均支持上下滚动 + 点击外部关闭
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDocStore, type ViewType } from '../store/docStore'
import { useUiStore, PREVIEW_ZOOM_RANGE, PREVIEW_ZOOM_STEP, PREVIEW_ZOOM_LIMITS } from '../store/uiStore'
import { clampEditorFontSize, EDITOR_FONT_OPTIONS, EDITOR_FONT_SIZE_RANGE } from '@ijipu/engine'
import { pasteImportCopy, numCopy } from '../brand/copy'
import { ToolIcon } from './ToolIcon'
// adj526：可"按住上下拖"的数值显示（预览比率 / 编辑器字号）
import { ScrubValue } from './ScrubValue'
// adj529：双击比率值 → 按预览区宽度反算适配比例（纯算式，不新增状态）
import { fitZoomFor } from '../preview/zoomFit'

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

/** adj408：视图图标改用 `public/icons/*.png`（`ToolIcon` 统一上色）——
 *  编码=编码、左右拆分=左右、上下拆分=上下、预览=预览。
 *  adj458：两个拆分方向改为**各自的专属图标**（此前共用「收起」并手动 `rotate(90)`——
 *  形状与实际拆分方向对不上，且旋转会把 1px 级线稿糊掉）；「编码」「预览」也各自换成对应图标
 *  （此前借用「文件」「查看」）。 */
const VIEWS: { key: ViewType; label: string; icon: React.ReactNode }[] = [
  { key: 'code', label: '编码', icon: <ToolIcon name="code" /> },
  { key: 'split', label: '拆分(上下)', icon: <ToolIcon name="splitV" /> },
  { key: 'splitH', label: '左右拆分', icon: <ToolIcon name="splitH" /> },
  { key: 'preview', label: '预览', icon: <ToolIcon name="view" /> },
]

/** adj315：归一化视图 key——splitHE 视为「左右拆分」(splitH) 条目 */
const normViewKey = (k: ViewType): string => (k === 'splitHE' ? 'splitH' : k)

/** 查当前视图在 VIEWS 中的条目（splitHE 归入 splitH 条目，保证顶栏图标/标签正确显示） */
const viewItem = (k: ViewType) => VIEWS.find((v) => v.key === normViewKey(k))

export function TopBar() {
  // ---- 文档 store ----
  // adj423：不再订阅 code/setCode——原来它们只服务于已取消的「格式化脚本」菜单项
  // （格式化现在是自动的：光标离开 Q 行时由 EditorPane 调 formatLine）
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
  // adj422：撤销/重做不再挂在菜单上（菜单「编辑」子菜单已移除），因此这里不再订阅 undo/redo —
  // 两个功能仍由编辑器里的 Ctrl+Z / Ctrl+Y 触发（EditorPane 直接调 store），行为未变。
  // ---- UI store ----
  const openModal = useUiStore((s) => s.openModal)
  // adj462：底部 dock（试听/导出/设置 = dock 入口开关；dockOpen/dockPanel 用于按钮高亮）
  const toggleDock = useUiStore((s) => s.toggleDock)
  const dockOpen = useUiStore((s) => s.dockOpen)
  const dockPanel = useUiStore((s) => s.dockPanel)
  const showGuides = useUiStore((s) => s.showGuides)
  const setShowGuides = useUiStore((s) => s.setShowGuides)
  const previewZoom = useUiStore((s) => s.previewZoom)
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom)

  /**
   * adj529（用户要求）：**双击顶栏的预览比率值 → 按预览区宽度适配的比例显示**。
   *
   * 实现刻意**不新增任何状态/设置**：双击时**现量**预览滚动容器（`.preview-pane`）的
   * `clientWidth`，按 `preview/zoomFit.ts` 的反算算出比例，直接写进**已有的** `previewZoom`
   * （与点 `−`/`+`、拖动比率完全同一条路：照常钳制、照常持久化）。
   * 于是它是一次"跳到适配值"的动作，而不是一个会长期跟随的"适配模式"——
   * 之后窗口再变宽变窄，比例保持不动（想再适配就再双击一次）。
   * 用 `clientWidth` 是因为它已排除纵向滚动条，"撑满"不会自己把页面挤出横向滚动条。
   * 范围用**绝对范围** `PREVIEW_ZOOM_LIMITS`（[30,400]）：窄预览区（手机分屏 ~340px）要贴合就得 <50%，
   * 很宽的预览区又要 >200%；手动 `−`/`+`/拖动仍守 `PREVIEW_ZOOM_RANGE`（[50,200]）。
   */
  const applyFitZoom = () => {
    const pane = document.querySelector<HTMLElement>('.preview-pane')
    const z = fitZoomFor(pane?.clientWidth ?? 0, PREVIEW_ZOOM_LIMITS)
    if (z > 0) setPreviewZoom(z)
  }
  /** 手动步进（`−`/`+`）：守**手动范围**（当前值可能因适配落在范围外，先按当前值加减再夹回来） */
  const zoomBy = (delta: number) =>
    setPreviewZoom(Math.min(PREVIEW_ZOOM_RANGE[1], Math.max(PREVIEW_ZOOM_RANGE[0], previewZoom + delta)))
  // adj426：顶栏新增「浅深模式」三状态按钮（在支持作者之前），与设置里的浅深模式联动
  const themeMode = useUiStore((s) => s.themeMode)
  const setThemeMode = useUiStore((s) => s.setThemeMode)
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
    // adj462：试听/导出/设置三个按钮改为**底部 dock 的入口（开关）**——不再打开对话框：
    //   dock 关 → 展开并切到该面板；已开且正是该面板 → 收起 dock；已开但不是该面板 → 只切面板。
    //   面板本体的状态（播放进度/导出选项/设置页签）由 dock 保持挂载而保留。
    { key: 'playback', label: '试听', group: 'topbar' as const, kind: 'btn' as const, active: dockOpen && dockPanel === 'tryout', onPick: () => toggleDock('tryout') },
    // adj415：功能组内「导出」与「设置」位置对调（导出在前、设置在后）。
    // 本数组顺序即顶栏显示顺序，同时决定「更多」下拉里的排列与折叠测量的顺序——改这一处即可。
    { key: 'export', label: '导出', group: 'topbar' as const, kind: 'btn' as const, active: dockOpen && dockPanel === 'export', onPick: () => toggleDock('export') },
    { key: 'pageConfig', label: '设置', group: 'topbar' as const, kind: 'btn' as const, active: dockOpen && dockPanel === 'settings', onPick: () => toggleDock('settings') },
    { key: 'zoom', label: '缩放', group: 'topbar' as const, kind: 'zoom' as const, show: showZoom },
    // —— 设置组（从状态栏移来） ——
    { key: 'autoWrap', label: '折行', group: 'footer' as const, kind: 'btn' as const, active: autoWrap, onPick: () => setAutoWrap(!autoWrap) },
    { key: 'scriptPad', label: '输入条', group: 'footer' as const, kind: 'btn' as const, active: showScriptPad, onPick: () => setShowScriptPad(!showScriptPad) },
    // adj407：编辑器字体选择框在窄屏模式下不显示（顶栏与「更多」里都不出现；
    // 设置项本身仍在「页面设置 → 全局 → 编辑器字体」，不会被弄丢）
    { key: 'font', label: '字体', group: 'footer' as const, kind: 'font' as const, show: !isNarrow },
    { key: 'fontSize', label: '字号', group: 'footer' as const, kind: 'fontSize' as const, show: true },
    // adj407：统一按 show 过滤（此前只对 kind==='zoom' 生效）——俯仰视图/窄屏的隐藏项
    // 必须在**测量容器**里也一并去掉，否则隐藏项仍占宽度预算、把本可显示的按钮挤进「更多」
  ].filter((t) => !('show' in t) || t.show)
  // 字体 split-button 状态（从状态栏移来，下拉从顶栏向下展开）
  const [fontOpen, setFontOpen] = useState(false)
  const fontRef = useRef<HTMLSpanElement>(null)
  // adj385：各下拉的 ref——用于"按实测位置动态限高"，保证下拉底部始终落在视口内
  const hamburgerDdRef = useRef<HTMLDivElement>(null)
  const viewDdRef = useRef<HTMLDivElement>(null)
  const fontDdRef = useRef<HTMLDivElement>(null)
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

  // adj407：字体选择框在窄屏模式下不显示——已在窄屏时被隐藏的话，把打开中的下拉一并收起，
  // 否则会出现"按钮没了、下拉还浮在顶栏下方"的孤儿浮层
  useEffect(() => {
    if (isNarrow) setFontOpen(false)
  }, [isNarrow])

  /**
   * adj386：字体下拉改 `position: fixed` + 按按钮实测位置定位。
   * 原因：字体按钮在 `.topbar-toolbar` 内，而该容器 `overflow: hidden`（用于裁掉横向溢出的按钮），
   * 向下弹出的下拉被它裁掉——DOM 与几何都正常，但**根本没画出来**（命中测试落到下方编辑器 textarea），
   * 表现就是"顶栏字体下拉打不开"。fixed 定位脱离祖先裁切，视觉效果仍是贴按钮右缘向下弹出。
   *
   * adj388：锚点改为**点击事件里的那个按钮**（`e.currentTarget`）而不是靠 ref 反查——避免顶栏重排
   * （visCount 变化/旋转/缩放）后 ref 指向的按钮与用户点的不是同一个导致跑偏；并做**视口双向钳制**
   * （横向夹在 [8, clientWidth - 宽 - 8]，纵向不越过视口底），在 resize/滚动时实时重算。
   */
  const [fontDdPos, setFontDdPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const fontBtnRef = useRef<HTMLElement | null>(null)

  const placeFontDropdown = useCallback((btn: HTMLElement | null): void => {
    if (!btn || !btn.isConnected) return
    const r = btn.getBoundingClientRect()
    // clientWidth/Height 不含滚动条（用 innerWidth 会在有滚动条时把下拉往左推约 15px）
    const cw = document.documentElement.clientWidth
    const ch = document.documentElement.clientHeight
    const margin = 8
    const width = Math.max(120, Math.min(160, cw - margin * 2))
    // 贴按钮右缘，但夹在视口内
    const left = Math.min(Math.max(margin, r.right - width), Math.max(margin, cw - width - margin))
    const top = Math.min(r.bottom + 6, Math.max(margin, ch - 60))
    setFontDdPos({ top: Math.round(top), left: Math.round(left), width: Math.round(width) })
  }, [])
  const [visCount, setVisCount] = useState(toolBtns.length)
  const btnsRef = useRef<HTMLDivElement>(null) // .topbar-buttons（功能组可见区）
  const settingsRef = useRef<HTMLDivElement>(null) // .topbar-settings（设置组可见区）
  const toolbarRef = useRef<HTMLDivElement>(null) // .topbar-toolbar（工具条）
  const measureRef = useRef<HTMLDivElement>(null) // 隐藏测量容器（渲染全部按钮量宽）
  const moreMeasureRef = useRef<HTMLButtonElement>(null) // 「更多」按钮的隐形副本（实测槽位宽）
  const overflowBtnRef = useRef<HTMLDivElement>(null) // 「更多」按钮容器
  const overflowDropdownRef = useRef<HTMLDivElement>(null) // 「更多」下拉容器
  const donateRef = useRef<HTMLButtonElement>(null) // 「支持作者」独立按钮（宽度计入测量预算）
  const themeModeRef = useRef<HTMLButtonElement>(null) // 浅深三状态按钮（宽度计入测量预算，adj453）
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

  // adj385：下拉动态限高——此前 CSS 用硬编码「视口高 - 56px」估算下拉顶位置，PAD/手机横屏等矮视口
  // （再叠加浏览器工具栏吃高度）下菜单底部会超出视口：末几项被裁、触屏又没有可见滚动条 → "菜单项选不了"。
  // 现在按**实测 top** 现算 max-height（= 视口高 - top - 12 安全距），并在旋转/缩放时重算；
  // 多列布局（矮视口双列）靠列数容纳内容，跳过限高以免内容被挤到看不见的下一列。
  const clampDropdowns = useCallback(() => {
    for (const el of [hamburgerDdRef.current, viewDdRef.current, overflowDropdownRef.current, fontDdRef.current]) {
      if (!el) continue
      el.style.maxHeight = ''
      const cols = Number.parseInt(getComputedStyle(el).columnCount, 10)
      if (!Number.isFinite(cols) || cols <= 1) {
        const top = el.getBoundingClientRect().top
        const avail = Math.floor(window.innerHeight - top - 12)
        el.style.maxHeight = `${Math.max(160, avail)}px`
      }
      el.style.overflowY = 'auto'
    }
  }, [])

  useLayoutEffect(() => {
    clampDropdowns()
  }, [clampDropdowns, menuOpen, viewOpen, overflowOpen, fontOpen, isNarrow])

  useEffect(() => {
    if (!menuOpen && !viewOpen && !overflowOpen && !fontOpen) return
    const onResize = (): void => clampDropdowns()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [clampDropdowns, menuOpen, viewOpen, overflowOpen, fontOpen])

  // adj388：下拉打开期间随窗口尺寸/滚动重算位置（顶栏重排、旋转、缩放后仍贴着用户点的那个按钮）
  useLayoutEffect(() => {
    if (!fontOpen) return
    placeFontDropdown(fontBtnRef.current)
  }, [fontOpen, placeFontDropdown, visCount, isNarrow, previewZoom])

  useEffect(() => {
    if (!fontOpen) return
    const onMove = (): void => placeFontDropdown(fontBtnRef.current)
    window.addEventListener('resize', onMove)
    window.addEventListener('orientationchange', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('orientationchange', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [fontOpen, placeFontDropdown])

  // 图标：(key) => JSX，与 renderBtn 共用
  // adj408：顶栏按钮图标全部改用 `public/icons/*.png`（`ToolIcon` 走 CSS mask 统一上色，颜色随主题/激活态）
  const iconOf = (key: string): React.ReactNode => {
    switch (key) {
      case 'guides':
        return <ToolIcon name="layout" />
      case 'playback':
        return <ToolIcon name="play" />
      case 'donate':
        return <ToolIcon name="heart" />
      case 'pageConfig':
        return <ToolIcon name="settings" />
      case 'export':
        return <ToolIcon name="export" />
      case 'autoWrap':
        return <ToolIcon name="wrap" />
      case 'font':
        return <ToolIcon name="font" />
      case 'scriptPad':
        return <ToolIcon name="keyboard" />
      // adj426：浅深模式三状态按钮——按当前 mode 选不同图标（与品牌 copy 里的浅深色描述一致）
      case 'themeAuto':
        return <ToolIcon name="themeAuto" />
      case 'themeLight':
        return <ToolIcon name="themeLight" />
      case 'themeDark':
        return <ToolIcon name="themeDark" />
      default:
        return null
    }
  }

  // 顶栏按钮渲染（用于可见区 / 隐藏测量容器）
  const renderBtn = (t: (typeof toolBtns)[number], measuring = false) => {
    if (t.kind === 'zoom') {
      return (
        <div className="topbar-zoom" key={t.key}>
          <button className="topbar-btn icon-btn" title="缩小预览" onClick={() => zoomBy(-PREVIEW_ZOOM_STEP)}>
            −
          </button>
          {/* adj526：比率值本身也能"按住上下拖"调节（手机上进不了输入框时尤其有用）
              adj529：**双击**它 = 按预览区宽度适配（跳到"页面宽度撑满预览区"的比例） */}
          <ScrubValue
            className="topbar-zoom-val"
            value={previewZoom}
            onChange={setPreviewZoom}
            onDoubleClick={applyFitZoom}
            step={PREVIEW_ZOOM_STEP}
            min={PREVIEW_ZOOM_RANGE[0]}
            max={PREVIEW_ZOOM_RANGE[1]}
            text={`${previewZoom}%`}
            title={numCopy.zoomScrubHint}
          />
          <button className="topbar-btn icon-btn" title="放大预览" onClick={() => zoomBy(PREVIEW_ZOOM_STEP)}>
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
              const v = Math.max(EDITOR_FONT_SIZE_RANGE[0], effectiveFontSize - 1)
              setEditorFontSize(v)
            }}
          >
            A−
          </button>
          {/* adj526：字号值本身也能"按住上下拖"调节 */}
          <ScrubValue
            className="topbar-zoom-val"
            value={effectiveFontSize}
            onChange={(v) => setEditorFontSize(clampEditorFontSize(v))}
            step={1}
            min={EDITOR_FONT_SIZE_RANGE[0]}
            max={EDITOR_FONT_SIZE_RANGE[1]}
            text={`${effectiveFontSize}px`}
            title={numCopy.fontSizeScrubHint}
          />
          <button
            className="topbar-btn icon-btn"
            title="增大字号"
            onClick={() => {
              const v = Math.min(EDITOR_FONT_SIZE_RANGE[1], effectiveFontSize + 1)
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
      // adj386：`measuring`（隐藏测量容器里的那份）不挂 ref、也不渲染下拉——否则同一个 ref 会被
      // 后渲染的测量实例覆盖，导致下拉按"测量容器里那个按钮"的坐标定位（跑偏到 x≈447）。
      return (
        <span className="editor-font-split" ref={measuring ? undefined : fontRef} key={t.key}>
          <button
            className="topbar-btn"
            onClick={(e) => {
              // adj388：以**点击的这个按钮**为锚点（避免 ref 反查到别的实例导致弹出位置不对）
              fontBtnRef.current = e.currentTarget
              const next = !fontOpen
              setFontOpen(next)
              if (next) placeFontDropdown(e.currentTarget)
            }}
            title="编辑器字体"
            aria-label="编辑器字体"
            aria-expanded={fontOpen}
          >
            {iconOf('font')}
            <span className="tool-label">{t.label}</span>
            {/* adj408：下拉指示箭头改用 public/icons/下.png（与其余按钮图标同一套上色） */}
            <span className="arrow">
              <ToolIcon name="down" size={9} />
            </span>
          </button>
          {!measuring && fontOpen && (
            <div
              className="editor-font-split-dropdown"
              role="listbox"
              ref={fontDdRef}
              style={
                fontDdPos
                  ? {
                      position: 'fixed',
                      top: fontDdPos.top,
                      left: fontDdPos.left,
                      width: fontDdPos.width,
                      right: 'auto',
                      bottom: 'auto',
                    }
                  : undefined
              }
            >
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
            <button className="menu-entry-btn" onClick={() => zoomBy(-PREVIEW_ZOOM_STEP)} title="缩小预览" aria-label="缩小预览">−</button>
            {/* adj529（用户报"缩进更多菜单后双击比率无效"）：这里原先是个**纯文本 span**，
                所以顶栏工具条折叠进「更多」后，"按住拖 / 双击适配"两条路径都丢了。
                改用与工具条**同一个组件** `ScrubValue`（拖动 + 双击 + 方向键一致），
                样式用 `.menu-scrub-val` 保持下拉里的等宽小字号。 */}
            <ScrubValue
              className="menu-scrub-val"
              value={previewZoom}
              onChange={setPreviewZoom}
              onDoubleClick={applyFitZoom}
              step={PREVIEW_ZOOM_STEP}
              min={PREVIEW_ZOOM_RANGE[0]}
              max={PREVIEW_ZOOM_RANGE[1]}
              text={`${previewZoom}%`}
              title={numCopy.zoomScrubHint}
            />
            <button className="menu-entry-btn" onClick={() => zoomBy(PREVIEW_ZOOM_STEP)} title="放大预览" aria-label="放大预览">+</button>
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
      /**
       * adj453：**右侧常驻项全部先扣预算**——浅深三状态 / 支持作者 / 更多 三个按钮必须完整落在
       * 顶栏右侧。用户报障「手机上三点只露一半、部分机型完全看不到」的根因有二：
       *   ① 老代码只扣了「支持作者」的宽度，**漏了浅深三状态按钮**（约 36px）；
       *   ② 顶栏 flex 间距只扣了 1 个 `gap`，实际有 6~7 个（每个 4~6px）。
       * 两者叠加使预算比真实可用宽度多出 ~40px → 工具条按虚高预算多留按钮 → 顶栏总额超出视口，
       * 而工具条 `flex-shrink:0` 会把最后一个子项「更多」直接顶出视口右缘（被裁一半或整颗不见）。
       * 现在：常驻项宽度**含外边距**实测 + 间距按**实际在流子项数**算 + 2px 安全余量。
       */
      const outerW = (el: Element | null): number => {
        if (!el) return 0
        const s = getComputedStyle(el)
        return (
          el.getBoundingClientRect().width + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0)
        )
      }
      const fix = (sel: string) => outerW(topbar.querySelector(sel))
      /**
       * 「更多」按钮槽位**恒定预留**，且取**实测宽**（测量容器里放了它的隐形副本，见 JSX）——
       * 与可见的「更多」当前是否存在无关，因此 visCount 不会随它有无而变，杜绝
       * "按钮消失→预算变大→按钮又出现"的抖动；也不用估值，窄屏不会白扣几个像素。
       */
      const ovReserve = moreMeasureRef.current ? outerW(moreMeasureRef.current) : 30
      const fixedW =
        fix('.topbar-brand') + fix('.topbar-hamburger') + fix('.topbar-views') +
        outerW(themeModeRef.current) + outerW(donateRef.current)
      // 顶栏在流内的子项：Logo / 汉堡 / 视图 / 弹性间距 / 工具条 / 浅深 / 支持 [/ 更多]
      // 间距数 = 子项数 − 1，按**含「更多」的最坏情况**算（「更多」未渲染时补 +1）
      const flowKids = Array.from(topbar.children).filter((el) => getComputedStyle(el).position !== 'absolute')
      const gapCount = Math.max(0, flowKids.length - 1 + (overflowBtnRef.current ? 0 : 1))
      const SAFE = 2 // 安全余量：抵消亚像素取整（getBoundingClientRect 小数累加）带来的溢出
      const avail = topbar.clientWidth - pad - gap * gapCount - fixedW - ovReserve - SAFE
      // 测量每个按钮宽——**按 key 取**（不依赖测量容器里的 DOM 顺序，与 toolBtns 一一对应）。
      // 注意量的是包裹 span 的**第一个元素子节点**：包裹层是 `display:contents`（为了与实际
      // 工具条布局一致）本身不产生盒子，getBoundingClientRect 恒为 0，直接量它会得到全 0 宽度。
      const widthByKey = new Map<string, number>()
      mes.querySelectorAll<HTMLElement>('[data-tool-key]').forEach((el) => {
        const box = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
        widthByKey.set(el.dataset.toolKey ?? '', box.getBoundingClientRect().width)
      })
      const widths = toolBtns.map((t) => widthByKey.get(t.key) ?? 0)
      /**
       * adj414：两个组的「盒子开销」（左右 padding + 左右 border）与**组内按钮间距**
       * 改为**从实际容器上读**，不再写死 `4 + … * 2`。
       * 起因：本次取消了功能组/设置组的组框（background/border/radius/padding 全去掉），
       * 若仍按写死的「padding 4 + gap 2」计算，宽度预算会比实际多算 → 本可显示的按钮被提前
       * 挤进「更多」（正是 E-2026-143 同一类"CSS 改了、宽度预算没跟上"的坑）。
       * 读活值后 CSS 怎么调都自动同步。
       */
      const boxOf = (sel: string): { overhead: number; gap: number } => {
        const el = topbar.querySelector<HTMLElement>(sel)
        if (!el) return { overhead: 0, gap: 2 }
        const b = getComputedStyle(el)
        const overhead =
          (parseFloat(b.paddingLeft) || 0) +
          (parseFloat(b.paddingRight) || 0) +
          (parseFloat(b.borderLeftWidth) || 0) +
          (parseFloat(b.borderRightWidth) || 0)
        return { overhead, gap: parseFloat(b.gap) || 0 }
      }
      const box1 = boxOf('.topbar-buttons')
      const box2 = boxOf('.topbar-settings')
      // 贪心：按 toolBtns 顺序累计，按 group 分两组
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
        // 组宽 = 盒子开销（padding+border）+ 按钮宽和 + 按钮间 gap×(n−1)（adj414：均为实测值）
        const group1 = newN1 > 0 ? box1.overhead + newW1 + (newN1 - 1) * box1.gap : 0
        const group2 = newN2 > 0 ? box2.overhead + newW2 + (newN2 - 1) * box2.gap : 0
        // 总宽：两组合框 + 工具条内两组间 gap 4
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

  // adj423：「格式化脚本」菜单项已取消（用户要求）——脚本格式化现在是**自动**的：
  // 光标离开某条 Q 行时 EditorPane 会调 formatLine 整理该行，不需要手动触发。
  const runOpen = async () => {
    await openFile()
  }
  const runSave = async () => {
    await saveFile()
  }
  const runSaveAs = async () => {
    await saveFileAs()
  }

  // adj424：菜单分组重排——「试听播放」「导出」从各自的播放/设置组挪到「文件」分组底部，
  // 与文件操作连成一组；「设置」单独成组（与顶栏按钮布局对齐）。原「播放」分组随之取消（仅试听一项）。
  // 顺序：新建/打开/打开示例/粘贴/保存/另存为 → 试听播放 → 导出；打开示例前的分隔线取消、与「打开」相邻。
  const fileEntries: (MenuEntry | 'sep')[] = [
    { label: '新建(&N)', kbd: 'Ctrl+N', hotkey: 'n', onPick: newDoc },
    { label: '打开(&O)…', kbd: 'Ctrl+O', hotkey: 'o', onPick: runOpen },
    // adj423：新增「打开示例」——列出 public/samples 下的示例谱（该目录靠构建期 glob 自动发现，
    // 往里加 .jps 文件即出现在列表里，无需改代码）；adj424：去掉其前的分隔线、与「打开」紧邻
    { label: '打开示例(&E)…', hotkey: 'e', onPick: () => openModal('samples') },
    // adj406：粘贴源码导入——手机端系统文件选择器看不到 .jps 时的兜底入口
    { label: pasteImportCopy.menuLabel, hotkey: 'v', onPick: () => openModal('pasteImport') },
    { label: '保存(&S)', kbd: 'Ctrl+S', hotkey: 's', onPick: runSave },
    { label: '另存为(&A)…', hotkey: 'a', onPick: runSaveAs },
    // adj424：从原「播放」分组挪到「文件」分组末尾（按用户要求的「试听-导出-设置」顺序）
    // adj462：菜单项与顶栏按钮同源——都切到底部 dock 的对应面板（不再弹对话框）
    { label: '试听播放(&P)', kbd: 'Ctrl+Q', hotkey: 'p', onPick: () => toggleDock('tryout') },
    // adj415/424：「导出」与「设置」原本在「文件」末位相连，adj424 拆开——导出留在文件组、设置单成一组
    { label: '导出(&X)…', hotkey: 'x', onPick: () => toggleDock('export') },
  ]
  // adj424：新建「设置」分组（仅一项）——与文件组用分隔线隔开，与顶栏按钮「设置」一一对应
  const settingsEntries: (MenuEntry | 'sep')[] = [
    // adj422：菜单项由「页面设置」改为「设置」（与对话框标题、顶栏按钮一致）
    { label: '设置(&G)…', hotkey: 'g', onPick: () => toggleDock('settings') },
  ]
  // adj422：原「编辑」子菜单（撤销/重做）已从菜单移除——用户要求菜单精简；
  // **功能保留**：撤销/重做仍走 Ctrl+Z / Ctrl+Y（见下方全局快捷键），store 与历史栈未改。
  const viewEntries: (MenuEntry | 'sep')[] = [
    { label: '编码(&C)', kbd: '1', hotkey: 'c', onPick: () => setViewType('code') },
    // adj322：按宽窄屏选上下(split) 还是左右(splitH/splitHE)
    { label: '拆分(&S)', kbd: '2', hotkey: 's', onPick: () => setViewType(isNarrow ? 'split' : (splitHDir === 'editorLeft' ? 'splitHE' : 'splitH')) },
    { label: '预览(&P)', kbd: 'Tab', hotkey: 'p', onPick: () => setViewType('preview') },
  ]
  // adj424：原「播放」分组取消——「试听播放」已挪到「文件」分组末尾（与导出相邻），
  // 音色库管理入口移入「设置 → 音色库」标签（adj384），菜单里没有第二项可单列，故整组移除。
  const helpEntries: (MenuEntry | 'sep')[] = [
    { label: '快捷键速查(&K)', kbd: 'Ctrl+~', hotkey: 'k', onPick: () => openModal('shortcuts') },
    { label: '操作手册(&M)', hotkey: 'm', onPick: () => openModal('manual') },
    // adj422：原「脚本语法」与「脚本规则说明」（独立 HTML 页）合并为一份「脚本语法说明」——
    // 两个入口内容重叠、容易互相漂移；现在统一读 docs/SYNTAX.md（列表页已删除）
    { label: '脚本语法说明(&S)', hotkey: 's', onPick: () => openModal('syntax') },
    // adj492：「关于」从弹窗迁入底栏 dock（与原「试听/导出/设置」同一套路：入口保持原位、改为开关）
    { label: '关于(&A)', hotkey: 'a', onPick: () => toggleDock('about') },
  ]

  return (
    <div className="topbar" ref={topbarRef}>
      {/* Logo */}
      <div className="topbar-brand">
        <img className="logo-mark" src="/icons/Jianpu.png" alt="爱记谱 iJipu" draggable={false} />
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
          <ToolIcon name="menu" />
          <span className="tool-label">菜单</span>
        </button>
        {menuOpen && (
          <div
            className="menu-dropdown topbar-hamburger-dropdown"
            ref={hamburgerDdRef}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="menu-group-title">文件</div>
            <MenuPanel entries={fileEntries} onClose={closeMenu} />
            {/* adj422：取消「编辑」子菜单及其下的撤销/重做菜单项（用户要求）——
                两个**功能**保留：Ctrl+Z / Ctrl+Y 快捷键照旧，历史栈与 store 不动 */}
            <div className="menu-sep" />
            {/* adj424：「设置」单列一组（与文件组隔开），与顶栏「设置」按钮一一对应 */}
            <div className="menu-group-title">设置</div>
            <MenuPanel entries={settingsEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            <div className="menu-group-title">视图</div>
            <MenuPanel entries={viewEntries} onClose={closeMenu} />
            <div className="menu-sep" />
            {/* adj424：原「播放」分组取消——试听已挪到「文件」分组末尾 */}
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
          {/* adj408：下拉指示箭头改用 public/icons/下.png（与其余按钮图标同一套上色） */}
          <span className="arrow">
            <ToolIcon name="down" size={9} />
          </span>
        </button>
        {viewOpen && (
          <div
            className="menu-dropdown topbar-view-dropdown"
            ref={viewDdRef}
            onClick={(e) => e.stopPropagation()}
          >
            {/* adj385：窄屏下拆分固定为上下，不再列出「左右拆分」（对窄屏没有意义） */}
            {VIEWS.filter((v) => !(isNarrow && v.key === 'splitH')).map((v) => {
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

      {/* 工具条：**只**容纳可折叠的功能组 + 设置组（放不下的按钮收进右侧「更多」下拉）。
          adj453：常驻的浅深三状态 /「支持作者」已移出本容器——本容器带 `overflow:hidden`
          （用于裁掉超出 visCount 的按钮），常驻按钮放在里面会被裁掉或被挤出视口。 */}
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
      </div>

      {/* adj453：顶栏右侧三个**常驻**按钮（浅深三状态 → 支持作者 → 更多）——
          直接挂在 `.topbar` 下（不再放进带 `overflow:hidden` 的 `.topbar-toolbar`），
          并统一 `flex-shrink:0`：无论工具条怎么压缩、屏幕多窄，它们都完整固定在顶栏右侧。 */}
      {/* adj426：浅深模式三状态按钮（位于「支持」之前，独立于工具条常驻）——
             点一次循环到下一档：auto → light → dark → auto；图标与文字随当前档位切换。
             与「设置 → 主题 → 浅深模式」三个按钮共用 store（uiStore.setThemeMode），状态实时同步。 */}
      <button
        ref={themeModeRef}
        type="button"
        className="topbar-btn topbar-theme-mode"
        onClick={() => {
          const next: Record<typeof themeMode, typeof themeMode> = {
            auto: 'light',
            light: 'dark',
            dark: 'auto',
          }
          setThemeMode(next[themeMode])
        }}
        title={
          themeMode === 'auto'
            ? '浅深模式：随系统（点击切到浅色）'
            : themeMode === 'light'
              ? '浅深模式：浅色（点击切到深色）'
              : '浅深模式：深色（点击切到随系统）'
        }
        aria-label={
          themeMode === 'auto'
            ? '浅深模式 当前为随系统，点击切到浅色'
            : themeMode === 'light'
              ? '浅深模式 当前为浅色，点击切到深色'
              : '浅深模式 当前为深色，点击切到随系统'
        }
      >
        {iconOf(themeMode === 'auto' ? 'themeAuto' : themeMode === 'light' ? 'themeLight' : 'themeDark')}
        <span className="tool-label">
          {themeMode === 'auto' ? '自动' : themeMode === 'light' ? '浅色' : '深色'}
        </span>
      </button>
      {/* 支持作者：常驻顶栏右侧（不参与功能组/设置组折叠，始终可见） */}
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

      {/* 「更多」按钮：公共更多按钮，常驻顶栏最右、按需出现（有按钮被折叠时显示） */}
      {visCount < toolBtns.length && (
        <div className={`topbar-overflow${overflowOpen ? ' open' : ''}`} ref={overflowBtnRef}>
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
            {/* adj408：三点「更多」图标改用 public/icons/更多.png（与其余按钮图标同一套上色） */}
            <ToolIcon name="more" />
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

      {/* 隐藏测量容器：**按与真实工具条相同的组结构**渲染全部按钮，仅用于测量宽度
          （不参与布局/交互）。adj453：此前是平铺一行裸 span，量出来的宽度用的是
          「基类」`.topbar-btn`（padding 5/10 + 有边框），比组内真实按钮（padding 4/9 + 无边框）
          每个宽 4px——窄屏上会白白少显示一个本可放下的按钮；改成组结构后量到即所见。 */}
      <div
        className="topbar-measure"
        ref={measureRef}
        aria-hidden="true"
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: -1 }}
      >
        <div className="topbar-buttons">
          {toolBtns.filter((t) => t.group === 'topbar').map((t) => (
            <span data-tool-key={t.key} key={t.key} style={{ display: 'contents' }}>
              {renderBtn(t, true)}
            </span>
          ))}
        </div>
        <div className="topbar-settings">
          {toolBtns.filter((t) => t.group === 'footer').map((t) => (
            <span data-tool-key={t.key} key={t.key} style={{ display: 'contents' }}>
              {renderBtn(t, true)}
            </span>
          ))}
        </div>
        {/* 「更多」按钮的隐形副本——见 ovReserve 注释（恒定按实测宽预留它的槽位） */}
        <button type="button" className="topbar-overflow-btn" ref={moreMeasureRef} tabIndex={-1} aria-hidden="true">
          <ToolIcon name="more" />
        </button>
      </div>
    </div>
  )
}