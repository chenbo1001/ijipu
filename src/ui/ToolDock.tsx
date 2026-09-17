/**
 * ui/ToolDock.tsx — 底部 dock（adj462，adj465 起加"按面板的默认高度"）
 *
 * 把原先散在**对话框**里的四块内容集中到编辑区底部的一条 dock 里，**同一时间只显示一块**：
 *   告警 / 试听 / 导出 / 设置   —— 互斥切换，避免同时铺开占掉编辑区。
 *
 * ## 入口即开关（用户规格）
 * 入口保持原位：**告警**在状态栏的告警文本、**试听/导出/设置**在顶栏按钮。
 * 点入口 = 开关：dock 关 → 展开并切到该面板；已开且是该面板 → 收起 dock；已开但不是 → 只切面板。
 * 标题栏右侧另有 **× 显式关闭**（只关不切，与入口开关区分）。
 *
 * ## 状态保留（用户规格）
 * 面板**首次被激活才挂载**（避免试听面板一进编辑器就自动下载音源之类的副作用），
 * 之后**一直保持挂载**、切换只用 CSS 隐藏（`hidden` 属性）。于是面板内部的 React 状态
 * （播放进度、导出选项、设置页签…）**天然跨切换保留**，不必把它们逐个提升到 store。
 *
 * ## 高度（adj465，用户规格）
 * 每个面板有**自己的默认高度**，并且**用户当次的拖拽调整按面板各自记住**：
 *  · 告警：默认 **4 行**高；设置：默认与告警同高（先这样，后续可调）；
 *  · 试听 / 导出：默认**最小高度**；
 *  · 拖拽调整 → 只影响**当次**（切走再切回该面板仍是你的高度）；
 *  · **重新打开**（关闭后再次通过入口打开）→ 清掉所有当次调整、回到各自默认。
 * 高度用**内联 px** 落到 `.tool-dock`，并同步一个 CSS 变量 `--dock-cols-h` 给设置面板的三栏当
 * `max-height` —— 这样"各栏独立滚动"是**算出来的确定值**，不依赖 flex 链的隐式收窄
 * （此前依赖 flex 链，在部分情况下栏不会收窄 → 内容溢出被 overflow:hidden 裁掉、无法操作）。
 */
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useUiStore, type DockPanelKey } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { dockCopy } from '../brand/copy'
import { ToolIcon } from './ToolIcon'
import type { ToolIconName } from './toolIcons'
import { summarizeProblems } from './problems'
import { ProblemPanel } from './dock/ProblemPanel'
// adj462：导出面板是**为底栏重写的流式布局**（原 ExportDialog 是竖向堆叠的弹窗布局，宽度变化不重排）
import { ExportPanel } from './dock/ExportPanel'

// adj462：试听/设置两块暂仍复用对话框内容（以 Modal 的 inline 模式渲染）。
// TODO(adj462 续)：这两块也要按 ExportPanel 的方式重写成**流式布局**（随 dock 宽度重排、压低高度）。
const TryoutPanel = lazy(() => import('../dialogs/PlaybackDialog').then((m) => ({ default: () => <m.PlaybackDialog inline /> })))
const SettingsPanel = lazy(() => import('../dialogs/PageConfigDialog').then((m) => ({ default: () => <m.PageConfigDialog inline /> })))

/** 四个面板（顺序即标签栏顺序）；告警为专用面板（原 ui/ProblemsBar 拆来） */
const PANELS: readonly { key: DockPanelKey; render: ComponentType }[] = [
  { key: 'problems', render: ProblemPanel },
  { key: 'tryout', render: TryoutPanel },
  { key: 'export', render: ExportPanel },
  { key: 'settings', render: SettingsPanel },
]

/**
 * dock 高度 = 外壳（抓手 + 标题栏）+ 内容区（上下内边距 + 内容本身）。
 * 这些值要和 `index.css` 里的实际样式对齐：
 *  · 抓手 `.tool-dock-resize` = 5px；
 *  · 标题栏 = 页签固定高 30 + 上下 padding 2×2 + 下边框 1 = 35px（adj466 后页签改为固定 30px）；
 *  · 内容区 `.tool-dock-pane` 上下内边距 = 8 + 10 = 18px。
 */
const RESIZE_H = 5
const TABS_H = 35
const CHROME_H = RESIZE_H + TABS_H
const PANE_PAD_H = 18
/** 告警单行高度（行内边距 + 12px 文字，实测约 22px；hint 展开时才更高） */
const ROW_H = 22
/** 内容区最小可用内容高度（试听/导出的"最小高度"） */
const MIN_CONTENT_H = 34
/**
 * adj468/478：设置面板在**窄屏**下按钮行折到内容下方（横向一行，实测 ≈31px）。
 * 既用于它的拖拽下限（否则内容行会跟按钮行抢高度、按钮被挤出视界），
 * 也用于它的默认高度。
 */
const FOOT_H = 38
/** 设置面板窄屏布局的**行间距**（与 CSS `grid-template-rows: … auto` 的 row-gap 对齐） */
const GRID_GAP_V = 6
/** 拖拽下限：普通面板 = 最小内容高度；设置 = 再留出下方按钮行 */
const MIN_H = CHROME_H + PANE_PAD_H + MIN_CONTENT_H
const MIN_H_SETTINGS = CHROME_H + PANE_PAD_H + FOOT_H + MIN_CONTENT_H
const minFor = (key: DockPanelKey) => (key === 'settings' ? MIN_H_SETTINGS : MIN_H)
/** 高度上限（与 CSS 的 max-height 同口径） */
const maxH = () => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5), 420)

/** 告警面板默认显示几行（adj465：4 行 → adj467：5 行；用户可当次拖拽调整） */
const PROBLEMS_ROWS = 5
/**
 * adj478：设置面板的内容区固定留 **5 行**内容的高度，且**与告警高度解绑**（不再共用
 * PROBLEMS_ROWS 那一份计算）。窄屏时按钮行折到内容下方，还要再加上 `FOOT_H` 与行间距。
 */
const SETTINGS_ROWS = 5
/** 与 CSS 里设置面板的窄屏断点（`@container (max-width: 720px)`）保持一致 */
const DOCK_NARROW_W = 720

/**
 * adj478：设置面板的默认高度 —— **窄屏/宽屏同一条规则：内容区一律留 `SETTINGS_ROWS` 行**。
 *
 * 与告警高度**完全解绑**（不再共用告警那份行数/行高）：
 *  · 告警的一行是纯文字行（`ROW_H`）；设置的一行是「标签 + 输入框」的字段行，实测 `rowPitch ≈ 29px`；
 *  · 所以设置的高度按自己的行高单独算，`rowPitch` 由运行时实测（见 ToolDock 内的测量）。
 *
 * 两档只差**结构性**的一段：窄屏按钮行折到内容下方（行间距 + 按钮行高），宽屏按钮在右侧第三列、不占内容高度。
 * 于是：宽屏 = 外壳 58 + 内容 5 行；窄屏 = 同上 + 44（按钮行与行间距）。**两边内容区都是 5 行**。
 */
const settingsDefaultH = (rowPitch: number, narrow: boolean): number =>
  CHROME_H + PANE_PAD_H + rowPitch * SETTINGS_ROWS + (narrow ? GRID_GAP_V + FOOT_H : 0)

/**
 * 各面板默认高度。
 * · 告警：固定 PROBLEMS_ROWS 行；
 * · 设置：见 `settingsDefaultH`（内容区 5 行，与告警解绑）；
 * · 试听/导出：最小高度（实际由 AUTO_FIT 实测覆盖为"能显示全内容的最小高度"）。
 */
const defaultH = (key: DockPanelKey, narrow: boolean, rowPitch: number): number => {
  if (key === 'problems') return CHROME_H + PANE_PAD_H + ROW_H * PROBLEMS_ROWS
  if (key === 'settings') return settingsDefaultH(rowPitch, narrow)
  return MIN_H
}

/** 夹紧到 [该面板的拖拽下限, 上限]（adj468：设置的下限更高，保证下方按钮行始终放得下） */
const clampH = (v: number, key: DockPanelKey) => Math.min(Math.max(Math.round(v), minFor(key)), maxH())

/**
 * 底栏四个面板页签（adj486：图标改用**顶栏同一套矢量图标**）。
 *
 * 由来（用户报）：这四个页签此前用的是 **Unicode 字符**（`⚠ ▶ ⬇ ⚙`）当图标——与顶栏按钮那套
 * "用户设计的线稿图标"不是一路货：字形粗细/留白/基线各不相同，与面板里的其它图标摆在一起显得杂，
 * 而同一个"试听/导出/设置"在顶栏是设计图标、在底栏却是个字符。现统一为 `ToolIcon`（同一套 PNG + mask 上色）。
 * 告警暂无对应的设计图标，暂留 `⚠` 字符（等用户补图后替换）。
 */
const TABS: { key: DockPanelKey; label: string; icon?: ToolIconName; glyph?: string }[] = [
  { key: 'problems', label: dockCopy.tabProblems, glyph: '⚠' },
  { key: 'tryout', label: dockCopy.tabTryout, icon: 'play' },
  { key: 'export', label: dockCopy.tabExport, icon: 'export' },
  { key: 'settings', label: dockCopy.tabSettings, icon: 'settings' },
]

/**
 * adj469：**内容较少的面板（试听 / 导出）默认高度 = "能显示全内容的最小高度"**。
 * 这两块的内容高度随 dock 宽度重排而变（导出按钮是 auto-fit 网格），常量定不准，所以实测：
 * `pane.scrollHeight` 不受当前可视高度影响，恒为内容自然高度。
 * 告警不用它（规格是固定 5 行），设置也不用（规格是与告警同高）。
 */
const AUTO_FIT: readonly DockPanelKey[] = ['tryout', 'export']

/**
 * adj470：告警**少于这个数量**时，也按"能显示全部内容的最小高度"显示（不必预留 5 行的空档）；
 * 达到或超过这个数量才用固定行数（见 PROBLEMS_ROWS）。
 */
const SMALL_PROBLEMS = 4

export function ToolDock() {
  const dockOpen = useUiStore((s) => s.dockOpen)
  const dockPanel = useUiStore((s) => s.dockPanel)
  const setDockPanel = useUiStore((s) => s.setDockPanel)
  const closeDock = useUiStore((s) => s.closeDock)
  // 首次激活即挂载；此后常挂载（切换仅用 hidden 隐藏）→ 面板内部状态天然保留
  const [everActive, setEverActive] = useState<readonly DockPanelKey[]>([])
  /** adj465：各面板"当次"被拖拽调整过的高度（未调整则用 DEFAULT_H） */
  const [heights, setHeights] = useState<Partial<Record<DockPanelKey, number>>>({})
  /**
   * adj469：试听 / 导出 的默认高度取「**能显示全内容的最小高度**」（见 AUTO_FIT 说明）。
   * 内容是懒加载的（React.lazy），首次打开时先渲染 Suspense 占位，chunk 到位后内容才真正出现，
   * 所以除了 resize 复测，还用 MutationObserver 盯住 pane 的子树变化再复测一次。
   */
  const [measured, setMeasured] = useState<Partial<Record<DockPanelKey, number>>>({})
  /**
   * adj478：判断"是否窄屏布局"。CSS 用的是**容器查询**（按 dock 自身宽度，断点 720px），
   * 但设置面板的默认高度需要在 JS 里算（窄屏要额外留出下方按钮行），所以这里量一下 dock 宽度，
   * 阈值与 CSS 的 `DOCK_NARROW_W` 保持同一个数。
   */
  const dockRef = useRef<HTMLElement | null>(null)
  const [dockW, setDockW] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ y: number; h: number } | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    const el = dockRef.current
    if (!el) return
    const measure = () => setDockW(el.getBoundingClientRect().width)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [dockOpen])
  const narrow = dockW > 0 && dockW <= DOCK_NARROW_W
  /**
   * adj478：设置面板**一行字段**的实际高度（含其行距）——用于算"内容区留 5 行"的高度。
   * 设置的一行是「标签 + 输入框」，比告警文字行高得多，所以必须实测；未测到前先用 ROW_H 兜底。
   */
  const [settingsRowPitch, setSettingsRowPitch] = useState(ROW_H)
  useEffect(() => {
    if (!dockOpen || dockPanel !== 'settings') return
    const pane = bodyRef.current?.querySelector<HTMLElement>('.pane-settings')
    const row = pane?.querySelector<HTMLElement>('.pcfg-row')
    if (!row) return
    // 行高 + 行下外边距 = 相邻两行的间距（外边距来自 Row 的内联样式，故用 computedStyle 取实际值）
    const mb = parseFloat(getComputedStyle(row).marginBottom || '0') || 0
    const pitch = row.getBoundingClientRect().height + mb
    if (pitch > 8 && Math.abs(pitch - settingsRowPitch) > 0.5) setSettingsRowPitch(pitch)
  }, [dockOpen, dockPanel, everActive.length, settingsRowPitch, narrow])

  useEffect(() => {
    if (!dockOpen) return
    setEverActive((prev) => (prev.includes(dockPanel) ? prev : [...prev, dockPanel]))
  }, [dockOpen, dockPanel])

  // adj465：只在**重新打开**（关 → 开）时清掉当次调整；切换面板不清（切回该面板仍是你的高度）
  useEffect(() => {
    if (dockOpen && !wasOpenRef.current) {
      setHeights({})
      setMeasured({})
    }
    wasOpenRef.current = dockOpen
  }, [dockOpen])

  // adj470：告警数量少于 SMALL_PROBLEMS 时也走"能显示全"（不再预留 5 行空档）
  const errors = useDocStore((s) => s.parseResult.errors)
  const problemCount = useMemo(() => summarizeProblems(errors).total, [errors])
  const problemsFitAll = problemCount < SMALL_PROBLEMS
  /** 当前面板是否要按"能显示全内容的最小高度"定高 */
  const fitAllNow = AUTO_FIT.includes(dockPanel) || (dockPanel === 'problems' && problemsFitAll)

  /**
   * adj474：试听 / 导出是**内容固定的小面板**——每次**打开或切换过去**都把高度重置为
   * 「能显示全部内容的最小高度」（即丢掉该面板当次的手工调整），保证一定看得全。
   * 在**停留在该面板期间**拖拽仍然立即生效（本 effect 只在 dockPanel 变化时跑）。
   * 告警/设置不在此列：它们按固定行数，且尊重当次调整。
   */
  useEffect(() => {
    if (!dockOpen || !AUTO_FIT.includes(dockPanel)) return
    setHeights((prev) => (prev[dockPanel] !== undefined ? { ...prev, [dockPanel]: undefined } : prev))
  }, [dockOpen, dockPanel])

  // adj469/470：实测当前面板的内容高度（试听/导出，以及"少于 4 条"的告警）。
  // 宽度变化会重排 → resize 复测；内容是懒加载的，chunk 到位后才真正出现 → MutationObserver 复测。
  useLayoutEffect(() => {
    if (!dockOpen || !fitAllNow) return
    const pane = bodyRef.current?.querySelector<HTMLElement>(`.pane-${dockPanel}`)
    if (!pane) return
    const measure = () => {
      const nat = pane.scrollHeight
      if (nat <= 0) return
      setMeasured((prev) => (Math.abs((prev[dockPanel] ?? 0) - nat) > 2 ? { ...prev, [dockPanel]: nat } : prev))
    }
    measure()
    const mo = new MutationObserver(measure)
    mo.observe(pane, { childList: true, subtree: true })
    const ro = new ResizeObserver(measure)
    ro.observe(pane)
    window.addEventListener('resize', measure)
    return () => {
      mo.disconnect()
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [dockOpen, dockPanel, everActive.length, fitAllNow])

  const forPanel = (key: DockPanelKey): number => {
    // 实测值（pane.scrollHeight）已含内容区上下内边距，所以这里只加外壳
    const wantsFit = AUTO_FIT.includes(key) || (key === 'problems' && problemsFitAll)
    if (wantsFit && measured[key]) return CHROME_H + measured[key]!
    return defaultH(key, narrow, settingsRowPitch)
  }
  // adj474：试听/导出 一律以实测的「能显示全的最小高度」为准（当次手工调整已在上面被清掉）
  const fitKeys = AUTO_FIT.includes(dockPanel) || (dockPanel === 'problems' && problemsFitAll)
  const baseH = fitKeys ? forPanel(dockPanel) : (heights[dockPanel] ?? forPanel(dockPanel))
  const dockH = clampH(baseH, dockPanel)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      e.preventDefault()
      const next = clampH(d.h + (d.y - e.clientY), dockPanel) // 向上拖 → 变高
      setHeights((prev) => ({ ...prev, [dockPanel]: next }))
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dockPanel])

  if (!dockOpen) return null

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { y: e.clientY, h: dockH }
    document.body.style.userSelect = 'none'
  }
  const bump = (delta: number) => setHeights((prev) => ({ ...prev, [dockPanel]: clampH(dockH + delta, dockPanel) }))

  return (
    <section
      ref={dockRef}
      className={`tool-dock${dockPanel === 'settings' ? ' dock-settings' : ''}`}
      // adj476：高度用内联 px 落到 `.tool-dock`。设置面板的"各栏独立滚动"改由 CSS grid 的
      // `minmax(0,1fr)` 行高保证（不再依赖 flex 链，也不再需要 --dock-cols-h 兜底）。
      style={{ height: `${dockH}px` }}
      aria-label="底部工具面板"
    >
      {/* 顶部抓手（拖拽调整高度；键盘 ↑/↓ /PageUp/PageDown） */}
      <div
        className="tool-dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={dockCopy.resizeTitle}
        aria-valuenow={dockH}
        aria-valuemin={minFor(dockPanel)}
        aria-valuemax={maxH()}
        tabIndex={0}
        title={dockCopy.resizeTitle}
        onMouseDown={startDrag}
        onKeyDown={(e) => {
          const big = e.key === 'PageUp' || e.key === 'PageDown'
          if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault()
            bump(big ? 32 : 8)
          } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
            e.preventDefault()
            bump(big ? -32 : -8)
          }
        }}
      />
      {/* 标题栏：四个面板 tab（点击切换）+ × 显式关闭 */}
      <div className="tool-dock-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={dockPanel === t.key}
            className={`tool-dock-tab${dockPanel === t.key ? ' is-active' : ''}`}
            onClick={() => setDockPanel(t.key)}
            title={t.label}
          >
            <span className="tool-dock-tab-icon" aria-hidden="true">
              {/* adj486：设计图标（顶栏同一套）优先；暂无对应图的（告警）用字符兜底 */}
              {t.icon ? <ToolIcon name={t.icon} size={14} /> : t.glyph}
            </span>
            <span className="tool-dock-tab-label">{t.label}</span>
          </button>
        ))}
        <button type="button" className="tool-dock-close" onClick={closeDock} title={dockCopy.closeTitle} aria-label={dockCopy.closeTitle}>
          ✕
        </button>
      </div>
      {/* 内容区：只渲染"已激活过"的面板；非当前面板用 hidden 隐藏（保住内部状态） */}
      <div className="tool-dock-body" ref={bodyRef}>
        {PANELS.filter((p) => everActive.includes(p.key)).map((p) => {
          const Pane = p.render
          return (
            <div key={p.key} className={`tool-dock-pane pane-${p.key}`} hidden={dockPanel !== p.key} role="tabpanel">
              {/* 懒加载面板（试听/导出/设置）首次打开时下载 chunk */}
              <Suspense fallback={<div className="dock-empty">加载中…</div>}>
                <Pane />
              </Suspense>
            </div>
          )
        })}
      </div>
    </section>
  )
}
