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
import { beginDrag } from './dragGesture'
// adj513：告警数（用于"无告警时不走 MIN_H 下限"）——纯函数，留在主包
import { summarizeProblems } from './problems'

/**
 * adj497（用户要求"各页签做成懒加载、首次打开才加载，以加快启动"）：**五个面板全部走 `React.lazy`**。
 *
 * 此前只有试听/设置/关于是 lazy，**告警与导出是静态 import** ⇒ 它们的代码（以及导出侧那串重依赖：
 * `export/export` 的 PDF 链、`export/audio` 的 WAV/MP3 编码、`playback/spessaCache` 等）
 * 会**在启动时就进主包并被加载**，白白拖慢首屏。
 *
 * 懒加载只在**首次渲染到该面板**时触发（`PANELS.filter(p => everActive.includes(p.key))` 保证
 * 只有"被打开过"的面板才渲染）⇒ 没点开过的页签，其 chunk 永远不会被下载。
 * `Suspense` 的 fallback（`.dock-empty`「加载中…」）只会在首次打开的那一瞬出现。
 */
const TryoutPanel = lazy(() => import('../dialogs/PlaybackDialog').then((m) => ({ default: () => <m.PlaybackDialog inline /> })))
const SettingsPanel = lazy(() => import('../dialogs/PageConfigDialog').then((m) => ({ default: () => <m.PageConfigDialog inline /> })))
// adj492：「关于」从弹窗迁入 dock（与原「试听/导出/设置」同一套路）
const AboutPanel = lazy(() => import('../dialogs/AboutDialog').then((m) => ({ default: () => <m.AboutDialog inline /> })))
// adj497：告警 / 导出改为懒加载（原为静态 import）
const ProblemPanel = lazy(() => import('./dock/ProblemPanel').then((m) => ({ default: m.ProblemPanel })))
const ExportPanel = lazy(() => import('./dock/ExportPanel').then((m) => ({ default: m.ExportPanel })))

/** 五个面板（顺序即标签栏顺序）；告警为专用面板（原 ui/ProblemsBar 拆来） */
const PANELS: readonly { key: DockPanelKey; render: ComponentType }[] = [
  { key: 'problems', render: ProblemPanel },
  { key: 'tryout', render: TryoutPanel },
  { key: 'export', render: ExportPanel },
  { key: 'settings', render: SettingsPanel },
  { key: 'about', render: AboutPanel },
]

/**
 * dock 高度 = 外壳（抓手 + 页签栏）+ 内容区（上下内边距 + 内容本身）。
 * 这些值要和 `index.css` 里的实际样式对齐：
 *  · 抓手 `.tool-dock-resize` = 5px；
 *  · 页签栏（adj509：参照顶栏按钮样式 + 固定高度）= 38px（`.tool-dock-tabs` 高度固定，内含
 *    上下 padding 2×2 + 下边框 1 + 内置页签 28px）；
 *  · 内容区 `.tool-dock-pane` 上下内边距 = 8 + 10 = 18px。
 */
const RESIZE_H = 5
const TABS_H = 38
const CHROME_H = RESIZE_H + TABS_H
const PANE_PAD_H = 18
/** 告警单行高度（行内边距 + 12px 文字，实测约 22px；hint 展开时才更高） */
const ROW_H = 22
/**
 * adj510：告警面板的"面板头"高度（`problems-head` = 标题/折叠按钮/语法速查按钮那一行）。
 * 计为 28px（padding 4×2 + 文字 14px ≈ 22 + 行间距 ≈ 28，实测）。用于"告警 dock 兜底高度 =
 * 头 + 最多 2 行告警"的计算。
 */
const PROBLEMS_HEAD_H = 28
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
/**
 * adj509：调整上限——宽屏下让"设置左栏页签"能**至少显示 3 个**（之前的鼠标滚动一档=3 项，
 * 但宽屏只能看到 2 个 ⇒ 第 3 个"音色库"一直显示不到）。把上限从 420 提到 460，让宽屏的
 * `dock-height` 默认值相应抬升。
 */
const maxH = () => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.55), 460)

/**
 * adj478：设置面板的内容区固定留 **5 行**内容的高度，且**与告警高度解绑**（不再共用
 * 告警那份行数/行高）。窄屏时按钮行折到内容下方，还要再加上 `FOOT_H` 与行间距。
 * adj492：**5 行 → 6 行**（用户要求"打开设置时高度为显示内容 6 行"）。
 * adj510：告警不再使用固定行数（详见 `PROBLEMS_MAX_VISIBLE_ROWS`）。
 */
const SETTINGS_ROWS = 6
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
 * 各面板**兜底**默认高度（实测 AUTO_FIT 前的占位；AUTO_FIT 项在 `measured` 到位后会被覆盖）。
 * · 告警/试听/导出/关于：实测"能显示全内容的最小高度"（AUTO_FIT）；
 * · 设置：见 `settingsDefaultH`（内容区 `SETTINGS_ROWS` 行）。
 *
 * adj510：告警的兜底改为「**最多 2 条**可见」的高度（= `CHROME_H + PANE_PAD_H + 2×ROW_H + problems-head`），
 * ——用户要求"打开告警页签时底栏 dock 最高只显示两个告警的高度"。多于 2 条时面板内部
 * 滚动查看（`problems-list` 的 `overflow-y: auto`）。
 */
const defaultH = (key: DockPanelKey, narrow: boolean, rowPitch: number): number => {
  // adj510：告警**兜底** = 2 行告警 + 面板头（problems-head ≈ 28px）；AUTO_FIT 实测接管后会按
  // "内容自然高" 调整，但始终 cap 在 `PROBLEMS_MAX_VISIBLE_ROWS` 行（`measured` 已在 `forPanel`
  // 里钳制过；详见 `capProblemsContentHeight`）。
  if (key === 'problems') return CHROME_H + PANE_PAD_H + PROBLEMS_HEAD_H + ROW_H * PROBLEMS_MAX_VISIBLE_ROWS
  // adj509：设置面板**默认高度**直接拉到上限（用户要求"调大 dock 高度让左栏页签至少显示 3 个"，
  // 宽屏下默认 dock 高度 ~235px 才能装下 6 行内容区，但左栏 jp-tab 36px×6=216px 只能装下 6 个；
  // 取 maxH 作为默认 = "第一次打开就让用户看到全部 5 个页签 + 还能看几行内容"，避免「打开设置 →
  // 还得先拖大才能看到音色库」。narrow 时仍走 settingsDefaultH（避免矮屏默认过高撑爆视口）。
  if (key === 'settings') return narrow ? settingsDefaultH(rowPitch, narrow) : maxH()
  // adj494：关于/试听/导出走 AUTO_FIT（实测内容高）；这里的值是**首次测量前的兜底**
  return MIN_H
}

/**
 * 夹紧到 [该面板的拖拽下限, 上限]（adj468：设置的下限更高，保证下方按钮行始终放得下）。
 * adj513：告警面板在**无告警**时不再套用 `MIN_H` 下限——`.dock-empty` 只是一行"语法检查通过"**
 * 文字，dock 应按内容自然高收缩（用户报告"无告警却显示 ≥ 4 行高度"是 MIN_H=95 钳到 95px 造成的）。
 * adj516：扩到"**少于 2 条告警**都按最小高度"——1 条告警时仅头 + 1 行 ≈ 80px，无需硬撑 95px；
 * ≥ 2 条时再回到头 + 2 行 = 133px（≥ 2 条时面板内滚动）。其它面板保留 `MIN_H`。
 */
const clampH = (v: number, key: DockPanelKey, noProblems = false) => {
  const lower = key === 'problems' && noProblems ? 0 : minFor(key)
  return Math.min(Math.max(Math.round(v), lower), maxH())
}

/**
 * 底栏五个面板页签（adj486：图标改用**顶栏同一套矢量图标**；adj492：新增「关于」）。
 *
 * 由来（用户报）：这几个页签此前用的是 **Unicode 字符**（`⚠ ▶ ⬇ ⚙`）当图标——与顶栏按钮那套
 * "用户设计的线稿图标"不是一路货：字形粗细/留白/基线各不相同，与面板里的其它图标摆在一起显得杂，
 * 而同一个"试听/导出/设置"在顶栏是设计图标、在底栏却是个字符。现统一为 `ToolIcon`（同一套 PNG + mask 上色）。
 * 告警与关于暂无对应的设计图标，暂留字符（`⚠` / `ⓘ`，等用户补图后替换）。
 */
const TABS: { key: DockPanelKey; label: string; icon?: ToolIconName; glyph?: string }[] = [
  { key: 'problems', label: dockCopy.tabProblems, glyph: '⚠' },
  { key: 'tryout', label: dockCopy.tabTryout, icon: 'play' },
  { key: 'export', label: dockCopy.tabExport, icon: 'export' },
  { key: 'settings', label: dockCopy.tabSettings, icon: 'settings' },
  { key: 'about', label: dockCopy.tabAbout, glyph: 'ⓘ' },
]

/**
 * adj469：**内容较少的面板默认高度 = "能显示全内容的最小高度"**。
 * 这几块的内容高度随 dock 宽度重排而变（导出按钮是 auto-fit 网格、关于是「品牌 + 正文」两栏），
 * 常量定不准，所以实测：`pane.scrollHeight` 不受当前可视高度影响，恒为内容自然高度。
 * 告警**也**用它（adj510：与试听/导出/关于同一套机制 ——
 * "能装下内容的最小高度"），但**内容本身高度被 cap**（见 `PROBLEMS_MAX_VISIBLE_ROWS`）：
 * 告警自然内容 > 2 行时，pane 内部可滚动，dock 自身只装 2 行的可见高度。
 * 设置不走 AUTO_FIT（规格是固定 `SETTINGS_ROWS` 行）。
 * adj494：加入 `about` —— 用户要求"打开关于时应以能够显示全内容为宜"。
 * adj510：告警（`problems`）加入 AUTO_FIT，与试听/导出/关于统一按"内容自然高"定 dock 高度。
 * （内容再长也受 `maxH()` 上限约束，超长时仍可滚动。）
 */
const AUTO_FIT: readonly DockPanelKey[] = ['problems', 'tryout', 'export', 'about']

/**
 * adj510：告警面板**最多显示 2 条**的高度 —— 告警通常用作「一眼看到脚本有什么问题」，
 * 多于 2 条的额外信息在面板内**自行滚动**查看（避免 dock 过高挤压编辑区）。
 * 设为 2 后：1 条告警 = "能装下的最小高度"；≥ 2 条 = 固定 2 行 + 面板内滚动。
 */
const PROBLEMS_MAX_VISIBLE_ROWS = 2

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

  // adj510：告警**始终**走 AUTO_FIT（与试听/导出/关于同源）——实测 pane.scrollHeight，
  // 并在 `capProblemsContentHeight` 里把"内容自然高"钳到「头 + 最多 2 行告警」的高度上限。
  // 因此：1 条告警 = 头 + 1 行；2 条 = 头 + 2 行；≥ 2 条 = 头 + 2 行（面板内可滚动）。
  // adj513/516：告警数（用于"无告警 / 少于 2 条时不走 MIN_H 下限"）：
  // · 0 条 = ".dock-empty" 一行文字 ≈ 30px；
  // · 1 条 = 头 + 1 行 ≈ 80px；
  // · ≥ 2 条 = 头 + 2 行 = 133px（≥ 2 条时面板内滚动）。
  const errors = useDocStore((s) => s.parseResult.errors)
  const problemCount = useMemo(() => summarizeProblems(errors).total, [errors])
  // adj516：扩展为「< 2 条告警都不走 MIN_H 下限」——1 条告警时也按内容自然高收缩。
  const noProblems = problemCount < 2
  /** 当前面板是否要按"能显示全内容的最小高度"定高（AUTO_FIT 机制） */
  const fitAllNow = AUTO_FIT.includes(dockPanel)

  /**
   * adj474：试听 / 导出是**内容固定的小面板**——每次**打开或切换过去**都把高度重置为
   * 「能显示全部内容的最小高度」（即丢掉该面板当次的手工调整），保证一定看得全。
   * adj510：告警与关于一并加入；告警的"丢手工调整"与 cap "最多 2 行可见" 双生效，
   * 关于 / 试听 / 导出则一律按实测内容高。
   * 在**停留在该面板期间**拖拽仍然立即生效（本 effect 只在 dockPanel 变化时跑）。
   * 设置不在此列：按固定 `SETTINGS_ROWS` 行，尊重当次调整。
   */
  useEffect(() => {
    if (!dockOpen || !AUTO_FIT.includes(dockPanel)) return
    setHeights((prev) => (prev[dockPanel] !== undefined ? { ...prev, [dockPanel]: undefined } : prev))
  }, [dockOpen, dockPanel])

  // adj469/510：实测当前面板的内容高度（告警/试听/导出/关于均走 AUTO_FIT）。
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

  /**
   * adj510：告警面板的"内容自然高"会被 **cap** —— 超过「头 + 最多 2 行告警」时，
   * 仍记为这个上限；超出部分由 `problems-list` 的 `overflow-y: auto` 在面板内滚动查看。
   * 其它 AUTO_FIT 面板（试听/导出/关于）直接返回 `h`，由内层 `overflow-y: auto` 兜底超长内容。
   */
  const capProblemsContentHeight = (h: number): number => {
    if (h <= 0) return h
    // 头 + 最多 2 行 = PANE_PAD_H + PROBLEMS_HEAD_H + 2 × ROW_H（实测；与 defaultH 兜底对齐）
    return Math.min(h, PANE_PAD_H + PROBLEMS_HEAD_H + ROW_H * PROBLEMS_MAX_VISIBLE_ROWS)
  }

  const forPanel = (key: DockPanelKey): number => {
    // 实测值（pane.scrollHeight）已含内容区上下内边距，所以这里只加外壳
    if (AUTO_FIT.includes(key) && measured[key]) {
      const measuredContent = key === 'problems' ? capProblemsContentHeight(measured[key]!) : measured[key]!
      return CHROME_H + measuredContent
    }
    return defaultH(key, narrow, settingsRowPitch)
  }
  // adj510：告警/试听/导出/关于一律以实测的「能显示全的最小高度」为准（当次手工调整已在上面被清掉）
  const fitKeys = AUTO_FIT.includes(dockPanel)
  const baseH = fitKeys ? forPanel(dockPanel) : (heights[dockPanel] ?? forPanel(dockPanel))
  // adj513：告警面板在**无告警**时不再套用 `MIN_H` 下限（详见 `clampH`）。
  const dockH = clampH(baseH, dockPanel, noProblems)

  // adj487：拖拽改用 Pointer Events（鼠标 + 触屏 + 触控笔）——此前只监听 mousemove/mouseup，
  // 手机上拖不动。位移与结束回调都在手势里处理，不再常驻 window 监听。
  const startDrag = (e: React.PointerEvent) => {
    const panel = dockPanel
    beginDrag(e, {
      onStart: () => {
        dragRef.current = { y: e.clientY, h: dockH }
        document.body.style.userSelect = 'none'
      },
      onMove: (_dx, dy) => {
        const d = dragRef.current
        if (!d) return
        // 手指/鼠标向上拖（dy < 0）→ dock 变高
        setHeights((prev) => ({ ...prev, [panel]: clampH(d.h - dy, panel, noProblems) }))
      },
      onEnd: () => {
        dragRef.current = null
        document.body.style.userSelect = ''
      },
    })
  }
  const bump = (delta: number) =>
    setHeights((prev) => ({ ...prev, [dockPanel]: clampH(dockH + delta, dockPanel, noProblems) }))

  // adj491：dock 关闭时**不渲染**。⚠ 这条守卫曾在 adj487（把拖拽从 mouse 改 Pointer Events）时
  // 被连带删除——后果是「点 ✕ 后 `dockOpen` 已置 false，但组件照样渲染」⇒ 关闭按钮看着"失灵"（用户报）。
  // 凡是"按状态决定渲染与否"的早退守卫，重构它前后的代码块时必须单独核对有没有被一起删掉。
  if (!dockOpen) return null

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
        onPointerDown={startDrag}
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
              {/* adj486：设计图标（顶栏同一套）优先；暂无对应图的（告警）用字符兜底。
                  adj514：**与顶栏按钮图标同尺寸**（`ToolIcon` 默认 size=16，与顶栏一致）——
                  此前 `size={14}` 比顶栏小 2px，视觉"虚"（用户报）。 */}
              {t.icon ? <ToolIcon name={t.icon} /> : t.glyph}
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
