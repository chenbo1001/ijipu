/**
 * ui/TopBar.tsx — 顶部栏（adj281：合并原 MenuBar + Toolbar）
 *
 * 布局（从左到右，adj530 重排）：
 *   Logo（图标+标题） / 汉堡菜单 ☰ / ┌ 功能按钮组（靠左）┐ / ┌ 编辑设置组（靠右）┐ / 支持 / 更多 ⋮
 *   功能按钮组：视图 · 排版 · 试听 · 导出 · 主题 · 设置 · 预览比率缩放
 *   编辑设置组：折行 · 输入条 · 字体 · 字号
 *
 * - 除了缩放比率组、字号组外，其它按钮均为「图标 + 标题」（宽屏）；窄屏全部仅图标
 * - 窗口继续变窄时，按**可见优先级**（TOOL_PRIORITY，末位 = 字号最先）逐个把按钮收进右侧
 *   「⋮ 更多」下拉，避免按钮溢出顶栏导致整页左右滚动；汉堡下拉与「更多」下拉均支持上下滚动 +
 *   点击外部关闭
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDocStore, type ViewType } from '../store/docStore'
import { useUiStore, PREVIEW_ZOOM_RANGE, PREVIEW_ZOOM_STEP, PREVIEW_ZOOM_LIMITS } from '../store/uiStore'
import { clampEditorFontSize, EDITOR_FONT_OPTIONS, EDITOR_FONT_SIZE_RANGE } from '@ijipu/engine'
import { pasteImportCopy, numCopy } from '../brand/copy'
import { ToolIcon } from './ToolIcon'
// adj526：可"按住上下拖"的数值显示（预览比率 / 编辑器字号）
import { ScrubValue } from './ScrubValue'
// adj529：双击比率值 → 按预览区宽度反算适配比例（纯算式，不新增状态）
import { fitZoomFor } from '../preview/zoomFit'
// adj530：顶栏「放不下就收进更多」的折叠判定（纯算式，便于 smoke 直接断言）
import { foldKeys } from './topbarFold'

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

/** adj530：顶栏可折叠按钮的键——与「更多」下拉、折叠优先级、测量用的 `data-tool-key` 一一对应 */
type ToolKey =
  | 'view'
  | 'guides'
  | 'playback'
  | 'export'
  | 'themeMode'
  | 'pageConfig'
  | 'zoom'
  | 'autoWrap'
  | 'scriptPad'
  | 'font'
  | 'fontSize'
  | 'donate'

/** adj530：按钮定义——只描述"这个按钮是什么"（文案/渲染分支/选中态/动作） */
interface ToolDef {
  key: ToolKey
  label: string
  kind: 'btn' | 'view' | 'theme' | 'zoom' | 'font' | 'fontSize'
  active?: boolean
  onPick?: () => void
}

/**
 * adj530（用户要求）：顶栏按钮的**可见优先级**——数组靠前 = 越晚被收进「更多」。
 *
 * 用户口径：「保证下列按钮可见优先级按…来排：视图、支持、排版、试听、导出、主题、设置、
 * 预览比率、折行、输入条、字体、字号」——即窗口变窄时**从本数组末位（字号）开始**逐个折叠，
 * 与一直以来的模式一致（原先的贪心也是从右端先少显示，最右侧的编辑设置组先走）。
 *
 * 本数组**只描述"谁先消失"**，不决定显示顺序——显示顺序见 FN_ORDER / EDIT_ORDER。
 * 想调整"谁先消失"就改这一行（用户给的顺序就是本数组顺序）。
 */
const TOOL_PRIORITY: readonly ToolKey[] = [
  'view',
  'donate',
  'guides',
  'playback',
  'export',
  'themeMode',
  'pageConfig',
  'zoom',
  'autoWrap',
  'scriptPad',
  'font',
  'fontSize',
]

/** adj530（用户要求）：功能按钮组（左侧）内的显示顺序——视图、排版、试听、导出、主题、设置、预览比率缩放 */
const FN_ORDER: readonly ToolKey[] = ['view', 'guides', 'playback', 'export', 'themeMode', 'pageConfig', 'zoom']

/** adj530（用户要求）：编辑设置组（右侧）内的显示顺序——折行、输入条、字体、字号 */
const EDIT_ORDER: readonly ToolKey[] = ['autoWrap', 'scriptPad', 'font', 'fontSize']

/** adj530：「更多」下拉里条目的排列顺序 = 两个组的显示顺序，最后接独立成组的「支持」 */
const OVERFLOW_ORDER: readonly ToolKey[] = [...FN_ORDER, ...EDIT_ORDER, 'donate']

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

  // ---- adj530：功能按钮溢出（顶栏尽量显示，放不下的按可见优先级进「更多」下拉） ----
  // 缩放组仅预览/拆分视图显示
  const showZoom = viewType !== 'code'
  /**
   * adj530（用户要求）：按钮定义**按 key 查表**。
   * 此前是一个顺序数组 + 按序号切片（"前 N 个显示"）——隐含"折叠就是从后往前连续截断"；
   * 现在折叠改为按可见优先级挑**任意**按钮，因此必须能按键取到定义。三件事彻底解耦：
   *   · 显示顺序 → FN_ORDER / EDIT_ORDER（组内）
   *   · 折叠先后 → TOOL_PRIORITY
   *   · 本表       → 只描述"这个按钮是什么"（文案 / 渲染分支 / 选中态 / 动作）
   */
  const toolDefs: Record<ToolKey, ToolDef> = {
    // —— 功能组（左侧，靠左对齐） ——
    // adj530：视图下拉按钮由"顶栏独立常驻"并入功能组首位（用户要求：视图 -> 靠左的组内第一个）
    view: { key: 'view', label: '视图', kind: 'view' },
    guides: {
      key: 'guides',
      label: '排版',
      kind: 'btn',
      active: showGuides,
      onPick: () => setShowGuides(!showGuides),
    },
    // adj384：音色库按钮已移除（移入「设置 → 音色库」标签）
    // adj462：试听/导出/设置三个按钮改为**底部 dock 的入口（开关）**——不再打开对话框：
    //   dock 关 → 展开并切到该面板；已开且正是该面板 → 收起 dock；已开但不是该面板 → 只切面板。
    //   面板本体的状态（播放进度/导出选项/设置页签）由 dock 保持挂载而保留。
    playback: {
      key: 'playback',
      label: '试听',
      kind: 'btn',
      active: dockOpen && dockPanel === 'tryout',
      onPick: () => toggleDock('tryout'),
    },
    // adj415：功能组内「导出」与「设置」位置对调（导出在前、设置在后）——显示顺序见 FN_ORDER
    export: {
      key: 'export',
      label: '导出',
      kind: 'btn',
      active: dockOpen && dockPanel === 'export',
      onPick: () => toggleDock('export'),
    },
    // adj426：浅深模式三状态按钮（adj530 由顶栏独立常驻并入功能组）——
    // 图标与文字随当前档位切换，与「设置 → 主题 → 浅深模式」共用 store
    themeMode: { key: 'themeMode', label: '主题', kind: 'theme' },
    pageConfig: {
      key: 'pageConfig',
      label: '设置',
      kind: 'btn',
      active: dockOpen && dockPanel === 'settings',
      onPick: () => toggleDock('settings'),
    },
    zoom: { key: 'zoom', label: '缩放', kind: 'zoom' },
    // —— 编辑设置组（右侧，靠右对齐） ——
    autoWrap: {
      key: 'autoWrap',
      label: '折行',
      kind: 'btn',
      active: autoWrap,
      onPick: () => setAutoWrap(!autoWrap),
    },
    scriptPad: {
      key: 'scriptPad',
      label: '输入条',
      kind: 'btn',
      active: showScriptPad,
      onPick: () => setShowScriptPad(!showScriptPad),
    },
    font: { key: 'font', label: '字体', kind: 'font' },
    fontSize: { key: 'fontSize', label: '字号', kind: 'fontSize' },
    // —— 独立成组（不套组框、也不在两组里，但同样参与可见优先级折叠） ——
    donate: { key: 'donate', label: '支持', kind: 'btn', onPick: () => openModal('donate') },
  }
  /**
   * adj530：某按钮当前是否**适用**（沿用原 `show` 口径，与折叠无关）：
   *   · 比率组只在预览/拆分视图有意义（编码视图没有预览区）
   *   · adj407：字体按钮窄屏不显示（顶栏与「更多」里都不出现；
   *     设置项本身仍在「设置 → 全局 → 编辑器字体」，不会被弄丢）
   * 不适用的按钮**不进入折叠计算**——否则隐藏项仍占宽度预算，把本可显示的按钮挤进「更多」。
   */
  const isApplicable = useCallback(
    (k: ToolKey): boolean => (k === 'zoom' ? showZoom : k === 'font' ? !isNarrow : true),
    [showZoom, isNarrow],
  )
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
   * 原因：字体按钮在 `.topbar-toolbar` 内，而该容器对横向溢出做裁剪（用于裁掉横向溢出的按钮），
   * 向下弹出的下拉被它裁掉——DOM 与几何都正常，但**根本没画出来**（命中测试落到下方编辑器 textarea），
   * 表现就是"顶栏字体下拉打不开"。fixed 定位脱离祖先裁切，视觉效果仍是贴按钮右缘向下弹出。
   * （adj530：该容器已改为 `overflow-x: clip` + `overflow-y: visible`，纵向不再裁；字体下拉的
   *  fixed 定位照旧保留——已验证可用，不做无谓改动。视图下拉则用容器上的 `.open` 放开裁剪。）
   *
   * adj388：锚点改为**点击事件里的那个按钮**（`e.currentTarget`）而不是靠 ref 反查——避免顶栏重排
   * （按钮折叠结果变化/旋转/缩放）后 ref 指向的按钮与用户点的不是同一个导致跑偏；并做**视口双向钳制**
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
  // adj530：被折叠进「更多」的按钮键（按**可见优先级从低到高**依次折叠，见下方测量算法）
  const [hiddenKeys, setHiddenKeys] = useState<readonly ToolKey[]>([])
  /** adj530：顶栏上真正显示的按钮键（适用 且 未被折叠） */
  const shownKeys = new Set<ToolKey>(TOOL_PRIORITY.filter((k) => isApplicable(k) && !hiddenKeys.includes(k)))
  /** adj530：「更多」下拉里的按钮键——按**显示顺序**排（功能组 → 编辑设置组 → 支持），与折叠先后无关 */
  const hiddenList = OVERFLOW_ORDER.filter((k) => isApplicable(k) && hiddenKeys.includes(k))
  const btnsRef = useRef<HTMLDivElement>(null) // .topbar-buttons（功能组可见区）
  const settingsRef = useRef<HTMLDivElement>(null) // .topbar-settings（设置组可见区）
  const toolbarRef = useRef<HTMLDivElement>(null) // .topbar-toolbar（工具条）
  const measureRef = useRef<HTMLDivElement>(null) // 隐藏测量容器（渲染全部按钮量宽）
  const moreMeasureRef = useRef<HTMLButtonElement>(null) // 「更多」按钮的隐形副本（实测槽位宽）
  const donateMeasureRef = useRef<HTMLButtonElement>(null) // 「支持」按钮的隐形副本（实测槽位宽，含外边距）
  const overflowDropdownRef = useRef<HTMLDivElement>(null) // 「更多」下拉容器
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
  }, [fontOpen, placeFontDropdown, hiddenKeys, isNarrow, previewZoom])

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

  /**
   * adj530：视图选项条目——**视图下拉**与**「更多」里被折叠的「视图」**共用同一份渲染
   * （视图按钮本身也能被折叠，折叠后仍要能切视图，行为与下拉一致）。
   * 点击后两个浮层都收起（二者互斥，同时关不会互相干扰）。
   */
  const renderViewEntries = () =>
    // adj385：窄屏下拆分固定为上下，不再列出「左右拆分」（对窄屏没有意义）
    VIEWS.filter((v) => !(isNarrow && v.key === 'splitH')).map((v) => {
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
            closeOverflow()
          }}
        >
          {v.icon}
          <span>{v.label}</span>
          {isActive && <span style={{ marginLeft: 'auto', color: 'var(--jp-accent)' }}>✓</span>}
        </div>
      )
    })

  // 顶栏按钮渲染（用于可见区 / 隐藏测量容器）
  const renderBtn = (t: ToolDef, measuring = false) => {
    if (t.kind === 'view') {
      /**
       * adj530：视图下拉按钮——此前是顶栏左侧的独立常驻项，现并入功能组（组内第一位，靠左）。
       * 下拉仍锚在 `.topbar-views`（`position: relative`）上，展开/选中行为完全不变。
       * `measuring`（隐藏测量容器里的那份）不挂 ref、也不渲染下拉——与字体按钮同样的理由（adj386）：
       * 否则同一个 ref 会被后渲染的测量实例覆盖，下拉会按"测量容器里那个按钮"的坐标定位。
       */
      return (
        <div className={`topbar-views${viewOpen ? ' open' : ''}`} ref={measuring ? undefined : viewRef} key={t.key}>
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
          {!measuring && viewOpen && (
            <div
              className="menu-dropdown topbar-view-dropdown"
              ref={viewDdRef}
              onClick={(e) => e.stopPropagation()}
            >
              {renderViewEntries()}
            </div>
          )}
        </div>
      )
    }
    if (t.kind === 'theme') {
      // adj426/adj530：浅深模式三状态按钮（在功能组内「导出」与「设置」之间）——
      // 点一次循环到下一档：auto → light → dark → auto；图标与文字随当前档位切换。
      // 与「设置 → 主题 → 浅深模式」三个按钮共用 store（uiStore.setThemeMode），状态实时同步。
      return (
        <button
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
      )
    }
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
  const renderOverflowItem = (t: ToolDef) => {
    if (t.kind === 'view') {
      // adj530：「视图」被折叠后，在下拉里给出与视图下拉**同一份**选项（当前项打 ✓）
      return (
        <>
          <div className="menu-sep" key={`${t.key}-sep`} />
          <div className="menu-group-title" key={`${t.key}-title`}>视图</div>
          {renderViewEntries()}
        </>
      )
    }
    if (t.kind === 'theme') {
      // adj530：「主题（浅深三状态）」被折叠后，三个档位各自成条（当前档位打 ✓）——
      // 与顶栏那个"点一次循环一档"的按钮等价，但少点两次；仍写同一个 store action。
      const modes: { key: typeof themeMode; label: string }[] = [
        { key: 'auto', label: '随系统' },
        { key: 'light', label: '浅色' },
        { key: 'dark', label: '深色' },
      ]
      return (
        <>
          <div className="menu-sep" key={`${t.key}-sep`} />
          <div className="menu-group-title" key={`${t.key}-title`}>浅深模式</div>
          {modes.map((m) => (
            <div
              key={m.key}
              className="menu-entry"
              onClick={() => {
                setThemeMode(m.key)
                closeOverflow()
              }}
            >
              {iconOf(m.key === 'auto' ? 'themeAuto' : m.key === 'light' ? 'themeLight' : 'themeDark')}
              <span>{m.label}</span>
              {themeMode === m.key && <span style={{ marginLeft: 'auto', color: 'var(--jp-accent)' }}>✓</span>}
            </div>
          ))}
        </>
      )
    }
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
          t.onPick?.()
          closeOverflow()
        }}
      >
        {iconOf(t.key)}
        <span>{t.label}</span>
        {t.active && <span style={{ marginLeft: 'auto', color: 'var(--jp-text-muted)', fontSize: 11 }}>开</span>}
      </div>
    )
  }

  // adj530：测量可用宽度 → 按**可见优先级**从低到高逐个把按钮收进「更多」
  // （useLayoutEffect 在绘制前执行，避免闪烁溢出）
  useLayoutEffect(() => {
    const measure = () => {
      const topbar = topbarRef.current
      const mes = measureRef.current
      if (!topbar || !mes) return
      const cs = getComputedStyle(topbar)
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const gap = parseFloat(cs.gap) || 4
      /**
       * adj453：**常驻槽位全部先扣预算**——「支持」与「更多」两个按钮必须完整落在顶栏右侧。
       * 用户当年报障「手机上三点只露一半、部分机型完全看不到」的根因有二：
       *   ① 老代码只扣了「支持作者」的宽度，**漏了浅深三状态按钮**（约 36px）；
       *   ② 顶栏 flex 间距只扣了 1 个 `gap`，实际有 5~6 个（每个 6px）。
       * 两者叠加使预算比真实可用宽度多出 ~40px → 工具条按虚高预算多留按钮 → 顶栏总额超出视口，
       * 而最后一个子项「更多」直接被顶出视口右缘（被裁一半或整颗不见）。
       * 现在：槽位宽度**含外边距实测**（测量容器里各放了一份隐形副本）+ 间距按**实际在流子项数**算
       * + 2px 安全余量。adj530：两者都取实测值（而非"当前是否显示"）——否则会抖动：
       * "按钮消失→预算变大→按钮又出现"。
       */
      const outerW = (el: Element | null): number => {
        if (!el) return 0
        const s = getComputedStyle(el)
        return (
          el.getBoundingClientRect().width + (parseFloat(s.marginLeft) || 0) + (parseFloat(s.marginRight) || 0)
        )
      }
      const donateSlot = outerW(donateMeasureRef.current)
      const moreSlot = moreMeasureRef.current ? outerW(moreMeasureRef.current) : 30
      // 顶栏左侧固定项：Logo + 汉堡（adj530：视图/主题已并入功能组，不再是常驻项）
      const fixedW = outerW(topbar.querySelector('.topbar-brand')) + outerW(topbar.querySelector('.topbar-hamburger'))
      const SAFE = 2 // 安全余量：抵消亚像素取整（getBoundingClientRect 小数累加）带来的溢出
      // 测量每个按钮宽——**按 key 取**（不依赖测量容器里的 DOM 顺序，与 toolDefs 一一对应）。
      // 注意量的是包裹 span 的**第一个元素子节点**：包裹层是 `display:contents`（为了与实际
      // 工具条布局一致）本身不产生盒子，getBoundingClientRect 恒为 0，直接量它会得到全 0 宽度。
      const widthByKey = new Map<string, number>()
      mes.querySelectorAll<HTMLElement>('[data-tool-key]').forEach((el) => {
        const box = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el
        widthByKey.set(el.dataset.toolKey ?? '', box.getBoundingClientRect().width)
      })
      /**
       * adj414：两个组的「盒子开销」（左右 padding + 左右 border）与**组内按钮间距**
       * 改为**从实际容器上读**，不再写死 `4 + … * 2`。
       * 起因：曾经取消过功能组/设置组的组框（background/border/padding 全去掉），
       * 若仍按写死的「padding 4 + gap 2」计算，宽度预算会比实际多算 → 本可显示的按钮被提前
       * 挤进「更多」（正是 E-2026-143 同一类"CSS 改了、宽度预算没跟上"的坑）。
       * 读活值后 CSS 怎么调都自动同步。工具条自身的开销/间距同理（当前为 0，读了防以后加）。
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
      const tbox = boxOf('.topbar-toolbar')
      /**
       * adj530：折叠判定交给纯算式 `ui/topbarFold.ts`（可被 smoke 直接断言）——
       * 本处只负责"量"（每个按钮多宽、各盒子开销、可用宽）与"读活值"，
       * "谁先被折叠"的规则全在那个模块里，两份逻辑不会漂移。
       */
      setHiddenKeys((prev) => {
        const hidden = foldKeys({
          priority: TOOL_PRIORITY.filter(isApplicable),
          widthByKey,
          fnKeys: FN_ORDER.filter(isApplicable),
          editKeys: EDIT_ORDER.filter(isApplicable),
          fnBox: box1,
          editBox: box2,
          toolbar: tbox,
          fixedW,
          donateW: donateSlot,
          moreW: moreSlot,
          pad,
          gap,
          totalW: topbar.clientWidth,
          safe: SAFE,
        })
        // 只在结果真的变化时写 state：ResizeObserver 每次回调都 setState 会白白多一轮重渲染
        return prev.length === hidden.length && prev.every((k, i) => k === hidden[i]) ? prev : hidden
      })
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
  }, [isApplicable])

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

      {/* 工具条（adj530）：**功能按钮组靠左 + 编辑设置组靠右**，放不下的按钮按可见优先级
          收进右侧「更多」下拉。
          · 视图下拉按钮与浅深三状态按钮**已并入功能组**（见 renderBtn），不再是顶栏独立项；
          · 原本的「弹性间距」占位 div 取消——"左组靠左、右组靠右"改由本容器（`flex: 1 1 auto`）
            加右组 `margin-left: auto` 实现（两层弹性叠加容易互相打架）；
          · adj453：常驻的「支持 / 更多」仍在本容器**之外**——本容器对横向溢出做裁剪
            （用于裁掉工具条自身的意外溢出），常驻按钮放在里面会被裁掉或被挤出视口。 */}
      <div className="topbar-toolbar" ref={toolbarRef}>
        <div className="topbar-buttons" ref={btnsRef}>
          {FN_ORDER.filter((k) => shownKeys.has(k)).map((k) => (
            <span data-tool-key={k} key={k} style={{ display: 'contents' }}>
              {renderBtn(toolDefs[k])}
            </span>
          ))}
        </div>
        <div className="topbar-settings" ref={settingsRef}>
          {EDIT_ORDER.filter((k) => shownKeys.has(k)).map((k) => (
            <span data-tool-key={k} key={k} style={{ display: 'contents' }}>
              {renderBtn(toolDefs[k])}
            </span>
          ))}
        </div>
      </div>

      {/* adj530：顶栏右侧两个**独立成组**的按钮（支持作者 → 更多）——
          直接挂在 `.topbar` 下（不再放进会对横向溢出做裁剪的 `.topbar-toolbar`），
          并统一 `flex-shrink:0`：无论工具条怎么压缩、屏幕多窄，它们都完整固定在顶栏右侧。
          · 「支持」在可见优先级里排第 2（仅次于视图），正常宽度下不会被折叠；真到了极窄屏
            也会连同其余按钮一起进「更多」（`shownKeys` 判定），而不是被裁掉。
          · adj426：浅深三状态按钮已并入功能组（见 renderBtn 的 kind === 'theme'）。 */}
      {shownKeys.has('donate') && (
        <button
          type="button"
          className="topbar-btn topbar-donate"
          onClick={() => openModal('donate')}
          title="支持作者"
          aria-label="支持作者"
        >
          {iconOf('donate')}
          <span className="tool-label">支持</span>
        </button>
      )}

      {/* 「更多」按钮：常驻顶栏最右、按需出现（**有按钮被折叠时**才显示，行为与之前一致） */}
      {hiddenList.length > 0 && (
        <div className={`topbar-overflow${overflowOpen ? ' open' : ''}`}>
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
              {hiddenList.map((k) => (
                <Fragment key={k}>{renderOverflowItem(toolDefs[k])}</Fragment>
              ))}
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
          {FN_ORDER.filter(isApplicable).map((k) => (
            <span data-tool-key={k} key={k} style={{ display: 'contents' }}>
              {renderBtn(toolDefs[k], true)}
            </span>
          ))}
        </div>
        <div className="topbar-settings">
          {EDIT_ORDER.filter(isApplicable).map((k) => (
            <span data-tool-key={k} key={k} style={{ display: 'contents' }}>
              {renderBtn(toolDefs[k], true)}
            </span>
          ))}
        </div>
        {/* 两个独立成组按钮的隐形副本——见 `donateSlot` / `moreSlot` 注释
            （恒定按实测宽预留槽位；「支持」的副本必须在两组框**之外**，才能量到它的真实
            样式宽度：进了组框会套用组内按钮的 padding/无边框规则，量出来偏窄） */}
        <button
          type="button"
          className="topbar-btn topbar-donate"
          ref={donateMeasureRef}
          data-tool-key="donate"
          tabIndex={-1}
          aria-hidden="true"
        >
          {iconOf('donate')}
          <span className="tool-label">支持</span>
        </button>
        <button type="button" className="topbar-overflow-btn" ref={moreMeasureRef} tabIndex={-1} aria-hidden="true">
          <ToolIcon name="more" />
        </button>
      </div>
    </div>
  )
}