/**
 * dialogs/PageConfigDialog.tsx — 页面设置（谱面：纸张/边距/布局/间距/连音线 + 字体 + 全局）
 *
 * adj282：各分组改为标签页（tab）形式切换，节省纵向空间、便于放入更多设置。
 * adj315：新增「全局」标签页（应用级 uiStore；不写入谱面 # jps-config）。
 *         页面级设置改为「即刻预览 + 保存持久化 + X 恢复」：调整时临时应用到 store
 *         （setPageConfig(next,false) 预览非持久化），保存才写入 .jps，关闭未保存则恢复快照。
 * adj418：①「页面 / 音符布局 / 间距 / 连音线」四个标签页**合并为「谱面」**一个（分小节标题）；
 *         ②标签页**等分对话框宽度**、面板内容铺满页签宽度（不留右侧空白、不横向溢出）；
 *         ③底部三个按钮**固定在对话框底部**（只有中间的页签内容区滚动），永远不用滚动去找。
 *
 * 标签页顺序：全局 → 主题 → 音色库 → 谱面 → 字体。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { clampEditorFontSize, defaultPageConfig, EDITOR_FONT_OPTIONS, EDITOR_FONT_SIZE_RANGE, nonDefaultConfigKeys, SCORE_FONT_OPTIONS, SEGMENT_ROW_GAP_DEFAULT } from '@ijipu/engine'
import { THEMES, type ThemeMode } from '../brand/themes'
import { uiCopy, numCopy } from '../brand/copy'
import { SoundBankPanel } from './SoundBankPanel'
import type { PageConfig } from '@ijipu/engine'
// adj426：主题按钮用 ToolIcon（与顶栏三状态按钮共用图标：自动主题/浅色主题/深色主题）
import { ToolIcon } from '../ui/ToolIcon'
// adj526：数值"按住上下拖"+`−`/`+` 步进（手机端没有原生上下小按钮，靠这两条路径改数）
import { useNumberScrub, useHoldRepeat } from '../ui/numberScrubGesture'
// adj526：谱面数值字段的 [min,max] 单一来源（逐项引用引擎 GUIDE_LIMITS / GUIDE_LIMITS_EX）
import { PAGE_NUM_RANGES as RANGE, coarseFor } from '../ui/numFieldRanges'

type TabId = 'global' | 'theme' | 'soundbank' | 'score' | 'font'

/**
 * adj603（用户要求）：设置**拆成两个底栏页签**——
 *   · 「全局」= 版面 / 主题 / 音色库（本机偏好，改完即时生效、**不写谱面**）
 *   · 「谱面」= 布局 / 字体（这份谱长什么样，**随谱保存**进 `# jps-config`）
 * 所以子页签按 `section` 分组，同一个组件渲染两次（两个 dock 页签各一份，子页签状态各自独立）。
 */
export type SettingsSection = 'global' | 'score'

// adj463：页签带图标 —— dock 里页签**竖向排在左侧**，窄屏时只留图标（文字用容器查询隐藏）
// adj603：子页签改名——原「全局」→ **版面**（避免与父页签「全局」同名）、原「谱面」→ **布局**
const ALL_TABS: { id: TabId; label: string; icon: string; section: SettingsSection }[] = [
  { id: 'global', label: '版面', icon: '⚙', section: 'global' },
  // adj383：主题组从顶栏菜单移入设置，紧跟在「版面」之后
  { id: 'theme', label: '主题', icon: '◐', section: 'global' },
  // adj384：音色库从顶栏按钮移入设置，紧跟「主题」之后
  { id: 'soundbank', label: '音色库', icon: '♪', section: 'global' },
  // adj418：原「页面 / 音符布局 / 间距 / 连音线」四个标签合并为「布局」（都是"这份谱长什么样"）
  { id: 'score', label: '布局', icon: '▤', section: 'score' },
  { id: 'font', label: '字体', icon: 'Aa', section: 'score' },
]

/** adj482：内容是「字段行」的子页签——dock 里套 `.pcfg-fields` 网格，按当页最长标签对齐；
 *  主题（主题色块列表）与音色库（自带面板）不套该层，保持各自布局 */
const FIELDS_TABS: TabId[] = ['global', 'score', 'font']

/** adj482：字段网格的三个常量——标签与控件之间的间隙（与 CSS 的 row `gap` 一致）、
 *  一格至少给控件留的宽度、格与格之间的列间距（与 CSS 的 `column-gap` 一致，用于算跨格数） */
const ROW_GAP = 8
const CTL_MIN_W = 140
const COL_GAP = 18

/**
 * adj605（用户要求）：**谱面级字段的登记表**——「布局」「字体」两个子页签各自有哪些 `PageConfig` 字段。
 * 用途：① 判断当前子页签里有没有"非默认项"，决定底部图例是否出现；② smoke 用它核对
 * "登记表里的每个字段都真的有一行在用它"（`isNonDefault('键')`），防止加了字段忘了登记。
 * 只列 `PageConfig` 字段——「版面/主题/音色库」是本机偏好（uiStore），不参与这套标记。
 */
const TAB_CONFIG_KEYS: Partial<Record<TabId, readonly string[]>> = {
  score: [
    'page',
    'margin_top',
    'margin_bottom',
    'margin_left',
    'margin_right',
    'descAreaH',
    'body_margin_top',
    'height_ciqu',
    'height_quci',
    'height_cici',
    'height_ciqu_lyric',
    'height_shengbu',
    'segmentRowGap',
    'noteSpaceLayout',
    'lianyinxian_type',
    'align_min_bars',
  ],
  font: [
    'miaoshu_font',
    'miaoshu_size',
    'biaoti_font',
    'biaoti_size',
    'fubiaoti_font',
    'fubiaoti_size',
    'shuzi_font',
    'note_size',
    'showInstrument',
    'geci_font',
    'geci_size',
    'lyricShrink',
    'notes_font',
    'notes_size',
  ],
}

export function PageConfigDialog({
  inline = false,
  section = 'global',
}: { inline?: boolean; section?: SettingsSection } = {}) {
  /** 本实例负责的子页签（按 section 过滤；两个 dock 页签各渲染一份，互不干扰） */
  const TABS = ALL_TABS.filter((t) => t.section === section)
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setPageConfig = useDocStore((s) => s.setPageConfig)
  // adj462：设置面板已移入底部 dock——保存/固化后收起 dock（原为关闭弹窗）
  const closeDock = useUiStore((s) => s.closeDock)
  // adj315：全局标签页是应用级偏好（uiStore，全局生效），不写入谱面 pageConfig
  const splitHDir = useUiStore((s) => s.splitHDir)
  const setSplitHDir = useUiStore((s) => s.setSplitHDir)
  const showScriptPad = useUiStore((s) => s.showScriptPad)
  const setShowScriptPad = useUiStore((s) => s.setShowScriptPad)
  const autoWrap = useUiStore((s) => s.autoWrap)
  const setAutoWrap = useUiStore((s) => s.setAutoWrap)
  const showGuides = useUiStore((s) => s.showGuides)
  const setShowGuides = useUiStore((s) => s.setShowGuides)
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize)
  const editorFont = useUiStore((s) => s.editorFont)
  const setEditorFont = useUiStore((s) => s.setEditorFont)
  // adj383：主题（中国色主题 + 深浅模式）——从顶栏菜单移入设置「主题」标签（本机界面偏好，不随谱保存）
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const themeMode = useUiStore((s) => s.themeMode)
  const setThemeMode = useUiStore((s) => s.setThemeMode)
  // adj-font：字体覆盖（L1 用户个性；跨机缺字体时用我的字体，不改谱面文件）
  const fontOverride = useUiStore((s) => s.fontOverride)
  const setFontOverride = useUiStore((s) => s.setFontOverride)

  const [draft, setDraft] = useState<PageConfig>({ ...pageConfig })
  // adj603：默认子页签取本 section 的第一个（全局 → 版面、谱面 → 布局）
  const [tab, setTab] = useState<TabId>(() => ALL_TABS.find((t) => t.section === section)?.id ?? 'global')
  // adj315：页面设置"即刻预览 + 保存持久化 + X 恢复"——
  // 打开时快照原值，调整时临时应用（预览非持久化），保存才写 .jps；关闭未保存则恢复快照。
  const snapRef = useRef<PageConfig>({ ...pageConfig })
  const committedRef = useRef(false)
  /**
   * adj600（用户反馈）：本面板**常驻挂载**在底栏 dock 里，`draft`/`snapRef` 原先只在挂载那一刻取种子
   * ⇒ **打开另一份谱（或手改源码里的 `# jps-config`）后，面板还停在上一份谱/默认值上**：
   *   · 面板显示的不是这份谱的设置（用户："谱面的设置没有更新覆盖设置里的默认值"）；
   *   · 用户一动任何字段，`setPageConfig({...draft, ...patch}, false)` 就把那套**错值**当主体应用，
   *     预览立刻被打回默认观感；保存时基线（`snapRef`）也是错的 ⇒ 谱面设置被打乱。
   *
   * 判据：`pageConfig` 变了、而且**不是本面板自己刚写进去的那一份**（`lastAppliedRef`）⇒ 说明
   * 变化来自外部（打开文件 / 源码改设置 / 预览里拖辅助虚线并已固化）⇒ 重新取种子。
   * 用引用比较 + JSON 兜底：本面板自己写的值就是同一个对象，不会被误判成"外部变化"而清掉用户正在改的内容。
   */
  const lastAppliedRef = useRef<PageConfig>({ ...pageConfig })
  useEffect(() => {
    const same =
      pageConfig === lastAppliedRef.current || JSON.stringify(pageConfig) === JSON.stringify(lastAppliedRef.current)
    if (same) return
    setDraft({ ...pageConfig })
    snapRef.current = { ...pageConfig }
    lastAppliedRef.current = { ...pageConfig }
    committedRef.current = false
  }, [pageConfig])
  // adj482：字段区容器（dock 里按「当页最长标签」对齐，见下面的测量 effect）
  const fieldsRef = useRef<HTMLDivElement | null>(null)

  /**
   * adj605（用户要求）：**"这一项与代码默认值不同"**的红色 `*` 标记。
   *
   * 判据来自引擎 `nonDefaultConfigKeys`——与 `writeJpsConfig` 的**差量写出**是同一份口径，
   * 于是"标签后带 `*`"严格等价于"点「保存设置」后会写进这份谱的 `# jps-config`"，
   * 不会出现"标了却没写"或"写了却没标"。
   *
   * 比较的是**面板正在显示的值**（`draft`）而不是"存盘那一刻的源码"：
   *   ① 打开一份谱时，亮着的正是这份谱自己写过的项；
   *   ② 用户改一项 → `*` 立刻出现（保存后它就会进谱面），等于改动预览；
   *   ③ 改回默认值 → `*` 消失（"回到默认"这件事一眼可见）。
   */
  const nonDefaultKeys = useMemo(() => new Set(nonDefaultConfigKeys(draft)), [draft])
  const isNonDefault = (key: string) => nonDefaultKeys.has(key)
  /** 当前子页签里"非默认"的项数——>0 才在面板末尾给出图例（没标记时不占地方） */
  const tabNonDefaultCount = (TAB_CONFIG_KEYS[tab] ?? []).filter((k) => nonDefaultKeys.has(k)).length

  /**
   * adj482：测量「当页最长标签宽」与**每个字段的自然宽**，据此在 dock 里排出**等宽字段网格**：
   *   · `--pcfg-label-w` = 当页最长标签 ⇒ 每格的标签列一样宽、控件左缘对齐；
   *   · `--pcfg-field-w` = 一格的基本宽（= 标签列 + 控件区最小宽 `CTL_MIN_W`）⇒ 各格等宽、跨格成列；
   *   · 每行 `--pcfg-span` = 该字段自然宽需要跨几格 ⇒ 宽字段（如「边距」四个数值框、带长说明的勾选项）
   *     跨 2 格，既**不折行**、也不把整页格子撑宽（配合 `grid-auto-flow` 的默认行优先放置）。
   *
   * 手法：把字段区**离屏克隆**一份探针（`.pcfg-measure-probe`：每行 `width: max-content` + 不换行），
   * 读自然宽后立即丢弃——不碰真实 DOM、不依赖"测量态"覆盖规则，也不会闪。
   * （先试过"给真实面板临时加 class 摊开字段"：控件容器是 `flex: 1`，`max-content` 会算成几千 px 的假值；
   *   也试过直接读容器宽度：说明文字那类长块会把容器撑大 → 都不可靠。）
   */
  const measureFields = () => {
    const el = fieldsRef.current
    if (!el || !el.closest('.tool-dock')) return
    const liveRows = Array.from(el.querySelectorAll<HTMLElement>('.pcfg-row'))
    const probe = el.cloneNode(true) as HTMLElement
    probe.className = 'pcfg-measure-probe'
    probe.removeAttribute('style') // 丢掉上一轮写进去的 CSS 变量，避免影响本轮测量
    el.parentElement?.appendChild(probe)
    const probeRows = Array.from(probe.querySelectorAll<HTMLElement>('.pcfg-row'))
    let labelW = 0
    for (const row of probeRows) {
      labelW = Math.max(labelW, Math.ceil(row.querySelector<HTMLElement>('.pcfg-row-label')?.offsetWidth ?? 0))
    }
    const rowWs = probeRows.map((r) => Math.ceil(r.offsetWidth))
    probe.remove()
    if (labelW === 0 || rowWs.length === 0) return
    const cellW = labelW + ROW_GAP + CTL_MIN_W
    /**
     * adj483：跨格数必须**钳到当前实际列数**——`grid-column: span N` 在"显式列数 < N"时会**新建隐式列**
     * （`grid-auto-columns: auto`），于是标题的 `grid-column: 1 / -1` 只跨显式列、其余元素被塞进隐式列
     * ⇒ 窄 dock（单列）下"标题与字段挤在同一行"（用户报）。列数按容器宽推出来，故宽度变化要重测。
     */
    const cols = Math.max(1, Math.floor((el.clientWidth + COL_GAP) / (cellW + COL_GAP)))
    el.style.setProperty('--pcfg-label-w', `${labelW}px`)
    el.style.setProperty('--pcfg-field-w', `${cellW}px`)
    liveRows.forEach((row, i) => {
      const need = rowWs[i] ?? 0
      const span = Math.min(cols, Math.max(1, Math.ceil((need + COL_GAP) / (cellW + COL_GAP))))
      row.style.setProperty('--pcfg-span', String(span))
    })
  }

  useLayoutEffect(measureFields, [tab])
  useEffect(() => {
    const el = fieldsRef.current
    if (!el || !el.closest('.tool-dock')) return
    // 字段增删（条件行：如「字体覆盖」开启后的"覆盖为"）或控件文本变化（选项变长变短）→ 重算；
    // rAF 合并连续变化（测量用离屏探针，不会反过来触发本观察者）
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => measureFields())
    }
    const mo = new MutationObserver(schedule)
    mo.observe(el, { childList: true, subtree: true, characterData: true })
    // adj483：容器宽度变化（dock 拖宽/窗口 resize）→ 列数变了，跨格数要跟着重算
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      mo.disconnect()
      ro.disconnect()
    }
  }, [tab])

  const updateDraft = (patch: Partial<PageConfig>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    // adj600：记下"这份值是本面板写进 store 的" ⇒ 上面的重新取种子 effect 不会把用户正在改的内容清掉
    lastAppliedRef.current = next
    setPageConfig(next, false) // 预览（临时应用，不持久化）；保存才持久化
  }

  // adj315：取消（X/遮罩/Esc）未保存 → 恢复快照到 store（预览层），丢弃 draft
  const onCancelReset = () => {
    if (!committedRef.current) {
      lastAppliedRef.current = snapRef.current
      setPageConfig(snapRef.current, false)
    }
  }

  /** 当前标签页面板内容（各组原字段，去掉 fieldset 边框——标签已表达分组边界） */
  const renderPanel = () => {
    switch (tab) {
      case 'global':
        // adj315：应用级全局设置（uiStore，全局生效；不写入谱面 # jps-config）
        return (
          <>
            <Row label="左右排列">
              <select
                value={splitHDir}
                onChange={(e) => setSplitHDir(e.target.value as 'previewLeft' | 'editorLeft')}
              >
                <option value="previewLeft">左预览 / 右编辑</option>
                <option value="editorLeft">左编辑 / 右预览</option>
              </select>
            </Row>
            <Row label="输入条">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={showScriptPad} onChange={(e) => setShowScriptPad(e.target.checked)} />
                <span style={{ fontSize: 12 }}>显示简谱输入工具条（移动端默认开）</span>
              </label>
            </Row>
            <Row label="折行">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={autoWrap} onChange={(e) => setAutoWrap(e.target.checked)} />
                <span style={{ fontSize: 12 }}>编辑器自动折行（长行软折行）</span>
              </label>
            </Row>
            <Row label="排版">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                <span style={{ fontSize: 12 }}>预览排版辅助虚线</span>
              </label>
            </Row>
            <Row label="编辑器字号">
              {/* adj526：范围取引擎的 EDITOR_FONT_SIZE_RANGE（与 clampEditorFontSize 同源），
                  这样"按住拖 / 步进钮"知道边界，不会拖出可输入范围 */}
              <NumInput
                label=""
                range={EDITOR_FONT_SIZE_RANGE}
                value={editorFontSize}
                onChange={(v) => setEditorFontSize(clampEditorFontSize(Number.isFinite(v) ? v : 14))}
              />
            </Row>
            <Row label="编辑器字体">
              <select value={editorFont} onChange={(e) => setEditorFont(e.target.value)}>
                {EDITOR_FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
            {/* adj-font：L1 用户个性——跨机缺字体时的兜底：用我的字体覆盖谱面六项字体（默认关，不改写谱面） */}
            <Row label="字体覆盖">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={fontOverride.enabled}
                  onChange={(e) => setFontOverride({ ...fontOverride, enabled: e.target.checked })}
                />
                <span style={{ fontSize: 12 }}>用我的字体覆盖谱面字体（跨机缺字体时勾选）</span>
              </label>
            </Row>
            {fontOverride.enabled && (
              <Row label="覆盖为">
                <FontSelect value={fontOverride.font} onChange={(v) => setFontOverride({ ...fontOverride, font: v })} />
              </Row>
            )}
            <div className="pcfg-note">
              以上为**本机偏好**（L1），不随谱保存；谱面字体在「字体」标签里设置（随谱走）。
              {fontOverride.enabled && '　⚠ 字体覆盖已开启："你看到的字体"与别人不同（它不随谱走）——分享谱面时建议关掉。'}
            </div>
          </>
        )
      case 'theme':
        // adj383：主题组（原顶栏菜单「主题」）——深浅模式 + 中国色主题；本机界面偏好，即时生效、不随谱保存
        return (
          <>
            {/* adj581（用户要求）：底栏内容标题统一成"行标题"样式（与设置→谱面里「纸张与边距」一致） */}
            <div className="pcfg-group-title">深浅模式</div>
            <div className="theme-mode-row" style={{ padding: 0 }}>
              {/* adj426：设置面板三个按钮改用 ToolIcon（自动主题/浅色主题/深色主题），
                  与顶栏新加的深浅模式三状态按钮视觉一致；点击直接选中该档（不走循环） */}
              {(
                [
                  { key: 'auto' as ThemeMode, label: '跟随系统', icon: 'themeAuto' as const },
                  { key: 'light' as ThemeMode, label: '浅色', icon: 'themeLight' as const },
                  { key: 'dark' as ThemeMode, label: '深色', icon: 'themeDark' as const },
                ]
              ).map((m) => (
                <button
                  key={m.key}
                  className={`theme-mode-btn${themeMode === m.key ? ' active' : ''}`}
                  onClick={() => setThemeMode(m.key)}
                  title={m.label}
                  aria-label={m.label}
                >
                  {/* adj484：图标用 14（对话框按钮口径，见 ToolIcon 注释）——与 12px 文本同高更像一对；
                      垂直居中与两侧留白由 CSS 的 `.theme-mode-btn`（inline-flex + padding）保证 */}
                  <ToolIcon name={m.icon} size={14} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div className="ijipu-form-hint">
              {themeMode === 'auto'
                ? '自动跟随系统深浅色设置'
                : themeMode === 'light'
                  ? '固定使用浅色配色'
                  : '固定使用深色配色'}
            </div>

            {/* adj581（用户要求）：同上——统一成行标题样式 */}
            <div className="pcfg-group-title">主题配色</div>
            {/* adj509：取消原来的「竖向列表 + 单选」布局，改为**流式复选框**——
                 · 与全局页签里的复选框（输入条/折行/排版等）保持一致的手感；
                 · 流式 = flex-wrap 自动换行，窄 dock 下也不会把整页撑高；
                 · 但主题在 store 仍是**单选**（`setTheme(id)`），所以行为不变。 */}
            <div className="theme-list">
              {THEMES.map((t) => (
                <label key={t.id} className="theme-entry" title={t.desc}>
                  <input
                    type="radio"
                    name="ijipu-theme"
                    checked={theme === t.id}
                    onChange={() => setTheme(t.id)}
                  />
                  <span
                    className="theme-swatch"
                    style={{
                      background: themeMode === 'light' ? t.bgLight : t.bg,
                      borderColor: themeMode === 'light' ? t.accentLight : t.accent,
                    }}
                  />
                  <span className="theme-name">{t.name}</span>
                  <span className="theme-desc" style={{ color: themeMode === 'light' ? t.accentLight : t.accent }}>
                    {t.desc}
                  </span>
                </label>
              ))}
            </div>
            <div className="ijipu-form-hint" style={{ marginTop: 8 }}>
              主题属本机界面偏好，不随谱保存。
            </div>
          </>
        )
      case 'soundbank':
        // adj384：音色库管理（原顶栏「音色库」按钮 + 独立对话框）——本机偏好，不随谱保存
        return (
          <>
            <SoundBankPanel />
            <div className="ijipu-form-hint">
              音源库/试听音色属本机偏好（L1），不随谱保存；试听对话框只列这里勾选的音色。
            </div>
          </>
        )
      case 'score':
        // adj418：合并原「页面 / 音符布局 / 间距 / 连音线」四个标签——都是"这份谱长什么样"，
        // 分组用小节标题体现；间距类设置两列排布（省纵向空间，且铺满页签宽度）。
        return (
          <>
            <div className="pcfg-group-title">纸张与边距</div>
            <Row label="纸张" mark={isNonDefault('page')}>
              <select
                value={draft.page}
                onChange={(e) => updateDraft({ page: e.target.value as PageConfig['page'] })}
              >
                <option value="A4">A4</option>
                <option value="A5">A5</option>
                <option value="A4_horizontal">横版 A4</option>
                <option value="A5_horizontal">横版 A5</option>
              </select>
            </Row>
            <Row
              label="边距(px)"
              mark={
                isNonDefault('margin_top') ||
                isNonDefault('margin_bottom') ||
                isNonDefault('margin_left') ||
                isNonDefault('margin_right')
              }
            >
              <NumInput label="上" range={RANGE.margin_top} value={draft.margin_top} onChange={(v) => updateDraft({ margin_top: v })} />
              <NumInput label="下" range={RANGE.margin_bottom} value={draft.margin_bottom} onChange={(v) => updateDraft({ margin_bottom: v })} />
              <NumInput label="左" range={RANGE.margin_left} value={draft.margin_left} onChange={(v) => updateDraft({ margin_left: v })} />
              <NumInput label="右" range={RANGE.margin_right} value={draft.margin_right} onChange={(v) => updateDraft({ margin_right: v })} />
            </Row>

            <div className="pcfg-group-title">间距(px)</div>
            {/* adj105：间距项两列排列，节省纵向空间；adj418：铺满页签宽度（不再右侧留白） */}
            <div className="pcfg-grid2">
              <Row label="描述头高" mark={isNonDefault('descAreaH')}>
                <NumInput label="" range={RANGE.descAreaH} value={draft.descAreaH} onChange={(v) => updateDraft({ descAreaH: v })} />
              </Row>
              <Row label="首行至描述头间距" mark={isNonDefault('body_margin_top')}>
                <NumInput label="" range={RANGE.body_margin_top} value={draft.body_margin_top} onChange={(v) => updateDraft({ body_margin_top: v })} />
              </Row>
              <Row label="曲部与曲部间距" mark={isNonDefault('height_ciqu')}>
                <NumInput label="" range={RANGE.height_ciqu} value={draft.height_ciqu} onChange={(v) => updateDraft({ height_ciqu: v })} />
              </Row>
              <Row label="曲部与词部间距" mark={isNonDefault('height_quci')}>
                <NumInput label="" range={RANGE.height_quci} value={draft.height_quci} onChange={(v) => updateDraft({ height_quci: v })} />
              </Row>
              <Row label="词部与词部间距" mark={isNonDefault('height_cici')}>
                <NumInput label="" range={RANGE.height_cici} value={draft.height_cici} onChange={(v) => updateDraft({ height_cici: v })} />
              </Row>
              <Row label="曲部与上词部间距" mark={isNonDefault('height_ciqu_lyric')}>
                <NumInput label="" range={RANGE.height_ciqu_lyric} value={draft.height_ciqu_lyric} onChange={(v) => updateDraft({ height_ciqu_lyric: v })} />
              </Row>
              {/* adj479：多声部块内声部行之间的额外间距——此前只挂在预览虚线拖拽上，
                  设置里没有输入框，用户报「同一组的多个声部之间间距无法调整」。 */}
              <Row label={uiCopy.shengbuGapLabel} mark={isNonDefault('height_shengbu')}>
                <NumInput label="" range={RANGE.height_shengbu} value={draft.height_shengbu} onChange={(v) => updateDraft({ height_shengbu: v })} />
              </Row>
            </div>

            {/* adj428：临时叠加段（{bz … } / {dsb … }）上下两行纵向间距——谱面级设置，
                跟随 .jps 走（与「间距」同一类，挨着放在它后面）。显示缺省回退 SEGMENT_ROW_GAP_DEFAULT。 */}
            <div className="pcfg-group-title">{uiCopy.segmentRowGapGroup}</div>
            <div className="pcfg-grid2">
              <Row label={uiCopy.segmentRowGapBzLabel} mark={isNonDefault('segmentRowGap')}>
                <NumInput
                  label=""
                  range={RANGE.segmentRowGap_bz}
                  value={draft.segmentRowGap?.bz ?? SEGMENT_ROW_GAP_DEFAULT.bz}
                  onChange={(v) => updateDraft({ segmentRowGap: { ...draft.segmentRowGap, bz: clampGap(v) } })}
                />
              </Row>
              <Row label={uiCopy.segmentRowGapDsbLabel} mark={isNonDefault('segmentRowGap')}>
                <NumInput
                  label=""
                  range={RANGE.segmentRowGap_dsb}
                  value={draft.segmentRowGap?.dsb ?? SEGMENT_ROW_GAP_DEFAULT.dsb}
                  onChange={(v) => updateDraft({ segmentRowGap: { ...draft.segmentRowGap, dsb: clampGap(v) } })}
                />
              </Row>
            </div>
            <div className="pcfg-note">
              {uiCopy.segmentRowGapHint}
            </div>

            {/* adj419：音符布局组挪到「间距」下面（用户要求：先看纸张/边距，再调间距，最后是排布方式） */}
            <div className="pcfg-group-title">音符布局</div>
            <Row label="布局模式" mark={isNonDefault('noteSpaceLayout')}>
              <select
                value={draft.noteSpaceLayout}
                onChange={(e) => updateDraft({ noteSpaceLayout: e.target.value as PageConfig['noteSpaceLayout'] })}
              >
                {/* adj289：空间优先设为默认并置于首位；时值优先保留可选 */}
                <option value="space">空间优先</option>
                <option value="duration">时值优先</option>
              </select>
            </Row>
            <Row label="连音线样式" mark={isNonDefault('lianyinxian_type')}>
              <select
                value={draft.lianyinxian_type}
                onChange={(e) => updateDraft({ lianyinxian_type: Number(e.target.value) as 0 | 1 | 2 })}
              >
                <option value={0}>自动</option>
                <option value={1}>圆弧</option>
                <option value={2}>平顶</option>
              </select>
            </Row>
            {/* adj297/adj602：两端对齐最小小节数——行小节数 < 该值自然对齐（行尾留白）、≥ 该值撑满两端对齐。
                adj602（用户要求）：从「间距」组挪到**音符布局**组——它决定的是"行内怎么排"，
                与间距无关（放在间距里会被当成"调间隙"去找）。 */}
            <Row label="两端对齐最小小节数" mark={isNonDefault('align_min_bars')}>
              <NumInput label="" value={draft.align_min_bars} onChange={(v) => updateDraft({ align_min_bars: v })} />
            </Row>
            {tabNonDefaultCount > 0 && (
              <div className="pcfg-note pcfg-def-legend">
                <span className="pcfg-def-mark on" aria-hidden="true">*</span>
                与默认值不同——点「保存设置」后会写进这份谱的设置（# jps-config）。
              </div>
            )}
          </>
        )
      case 'font':
        return (
          <>
            <Row label="描述头" mark={isNonDefault('miaoshu_font') || isNonDefault('miaoshu_size')}>
              <FontSelect value={draft.miaoshu_font} onChange={(v) => updateDraft({ miaoshu_font: v })} />
              <NumInput label="字号" value={draft.miaoshu_size} onChange={(v) => updateDraft({ miaoshu_size: v })} />
            </Row>
            <Row label="标题" mark={isNonDefault('biaoti_font') || isNonDefault('biaoti_size')}>
              <FontSelect value={draft.biaoti_font} onChange={(v) => updateDraft({ biaoti_font: v })} />
              <NumInput label="字号" value={draft.biaoti_size} onChange={(v) => updateDraft({ biaoti_size: v })} />
            </Row>
            <Row label="副标题" mark={isNonDefault('fubiaoti_font') || isNonDefault('fubiaoti_size')}>
              <FontSelect value={draft.fubiaoti_font} onChange={(v) => updateDraft({ fubiaoti_font: v })} />
              <NumInput label="字号" value={draft.fubiaoti_size} onChange={(v) => updateDraft({ fubiaoti_size: v })} />
            </Row>
            <Row label="音符" mark={isNonDefault('shuzi_font') || isNonDefault('note_size')}>
              <FontSelect value={draft.shuzi_font} onChange={(v) => updateDraft({ shuzi_font: v })} />
              <NumInput label="字号" value={draft.note_size} onChange={(v) => updateDraft({ note_size: v })} />
            </Row>
            {/* adj303：显示乐器名——@乐器名 / @@ 切换后的下一个音符正上方标注乐器名（默认不显示）
                adj606：取消勾选写 `undefined`（= 未设置）而不是 `false`——可选字段的"关"就是"没写"，
                这样红 `*` 会熄灭、保存时也不会往谱面里留一条冗余的 `false` */}
            <Row label="乐器显示" mark={isNonDefault('showInstrument')}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.showInstrument === true}
                  onChange={(e) => updateDraft({ showInstrument: e.target.checked ? true : undefined })}
                />
                显示乐器名（@切换处音符上方标注）
              </label>
            </Row>
            <Row label="歌词" mark={isNonDefault('geci_font') || isNonDefault('geci_size')}>
              <FontSelect value={draft.geci_font} onChange={(v) => updateDraft({ geci_font: v })} />
              <NumInput label="字号" value={draft.geci_size} onChange={(v) => updateDraft({ geci_size: v })} />
            </Row>
            {/* adj292：歌词宽度不足时压缩字宽（默认不压缩允许重叠，选中才压缩）
                adj606：同「乐器显示」——取消勾选写 `undefined`（可选字段的"关"= 没写） */}
            <Row label="歌词压缩" mark={isNonDefault('lyricShrink')}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.lyricShrink === true}
                  onChange={(e) => updateDraft({ lyricShrink: e.target.checked ? true : undefined })}
                />
                宽度不足时压缩文字宽度
              </label>
            </Row>
            {/* adj154：说明（S 行）字体独立于描述头 */}
            <Row label="说明" mark={isNonDefault('notes_font') || isNonDefault('notes_size')}>
              <FontSelect value={draft.notes_font ?? draft.miaoshu_font} onChange={(v) => updateDraft({ notes_font: v })} />
              <NumInput label="字号" value={draft.notes_size ?? draft.miaoshu_size} onChange={(v) => updateDraft({ notes_size: v })} />
            </Row>
            {tabNonDefaultCount > 0 && (
              <div className="pcfg-note pcfg-def-legend">
                <span className="pcfg-def-mark on" aria-hidden="true">*</span>
                与默认值不同——点「保存设置」后会写进这份谱的设置（# jps-config）。
              </div>
            )}
          </>
        )
    }
  }

  return (
    // adj418：fill —— 对话框内容撑满高度（页签与面板放中间滚动区，底部按钮固定可见）；
    // width 用 min(700px, 100%) 固定成"桌面满宽上限 / 窄屏铺满"——此前没给宽度，
    // 弹窗宽度由内容撑开，切页签时**弹窗宽度会跟着跳**（各页签内容宽度不同），页签与面板也就对不齐。
    // adj422：标题与菜单统一为「设置」（里面包含 全局/主题/音色库/谱面/字体 五个标签）
    <Modal
      // adj603：弹窗模式按 section 给标题（dock 内联时由底栏页签表达，不显示标题）
      title={section === 'score' ? '谱面设置' : '全局设置'}
      fill
      width="min(700px, 100%)"
      onClose={onCancelReset}
      inline={inline}
    >
      <div className="pcfg-root">
        {/* 中间滚动区：页签 + 面板（只有这里滚动，底部按钮永远可见） */}
        <div className="pcfg-scroll">
          <div className="jp-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`jp-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
                title={t.label}
              >
                {/* adj463：图标常驻；文字在窄 dock 下由容器查询隐藏（只留图标） */}
                <span className="jp-tab-icon" aria-hidden="true">{t.icon}</span>
                <span className="jp-tab-label">{t.label}</span>
              </button>
            ))}
          </div>
          {/* adj463：内容区包一层容器；adj482：字段类页签再包一层 `.pcfg-fields`——
              dock 里它是**等宽字段网格**（按当页最长标签对齐，见 measureFields），
              主题/音色库这类自带排版的内容不套该层，保持各自布局。 */}
          <div className="pcfg-panel">
            {FIELDS_TABS.includes(tab) ? (
              // adj605：`data-nondefault` 把"当前被算作非默认的字段"暴露到 DOM——
              // 真机验证/回归脚本据此判断标记是否**随值变化同步**（不必反推视觉效果）
              <div className="pcfg-fields" ref={fieldsRef} data-nondefault={[...nonDefaultKeys].join(',')}>{renderPanel()}</div>
            ) : renderPanel()}
          </div>
        </div>

        {/* adj603：底部「恢复默认 / 保存设置」**只属于「谱面」这一半**——
            它们读写的是 `# jps-config`（谱面级）；而「全局」（版面/主题/音色库）是本机偏好，
            改一下就即时生效，不需要（也不该有）"保存"这一步。
            ⚠️ 这段**必须是 JSX 注释**（花括号包起来的块注释）：写成裸的块注释会被当成文本节点渲染，
            成为 `.pcfg-root` 网格里的匿名项 → 它的 max-content 宽把 `minmax(0,1fr)` 的内容列挤成 0 宽，
            表现为"只看得见子页签和按钮、子页签内容全不见了"（见 E-2026-293）。 */}
        {section === 'score' && (
          <div className="modal-foot pcfg-foot">
          <button
            className="btn"
            onClick={() => {
              updateDraft({ ...defaultPageConfig })
            }}
          >
            恢复默认
          </button>
          <button
            className="btn primary"
            title="把这次改动写进这份谱的 # jps-config（只写与默认不同的项）——谱面因此自包含，复制给别人显示一致"
            onClick={() => {
              // adj83：保存设置时持久化到源码 # jps-config 注释（每首谱用自己的设置）
              // adj-font（D1）：默认**差量写入**（只写与默认不同的字段；全部为默认时删除设置行）
              // adj454：传入打开时的快照 snapRef 作为基线——只固化**用户本次真正改动**的字段
              // adj480：本机页面设置缓存层已取消 ⇒ 生效配置 = 代码默认 ← 谱面，
              //   于是"保存"就等于"把这份谱补成自包含"，不再需要单独的「固化到谱面」动作。
              committedRef.current = true
              // adj600：保存的基线随之推进（本面板自己写的这份不算"外部变化"，不必重新取种子）
              lastAppliedRef.current = draft
              setPageConfig(draft, true, snapRef.current)
              closeDock()
            }}
          >
            保存设置
          </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * 谱面字体候选（adj-font：改由引擎 `SCORE_FONT_OPTIONS` 统一提供——每项都是**含通用族的完整栈**，
 * 避免旧版"裸字体名"换机器掉到浏览器默认字体；跨机可用/适合简谱/保证有 fallback 三原则）。
 */
const FONT_OPTIONS: { label: string; value: string }[] = SCORE_FONT_OPTIONS

// adj428：临时段间距范围——bz 段至少要大于一行音符高（≈ 13 + 减时线 + 间距 ≈ 18），
// 上限取 80（再大就跟上一行曲部挤到一起，反而比"上间距"还大，破坏排版层级）。
const SEGMENT_ROW_GAP_MIN = 10
const SEGMENT_ROW_GAP_MAX = 80
const clampGap = (v: number): number => Math.max(SEGMENT_ROW_GAP_MIN, Math.min(SEGMENT_ROW_GAP_MAX, Math.round(v)))

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = value && !FONT_OPTIONS.some((o) => o.value === value) ? [{ label: value, value }, ...FONT_OPTIONS] : FONT_OPTIONS
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: 160 }}
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * 一行设置：标签 + 控件。
 *
 * adj605（用户要求）：`mark` 表达**"这一项与代码默认值不同"**——
 *   · `true`  → 标签后一个**红色 `*`**（`title` 说明含义）；
 *   · `false` → **空占位**（宽度固定）：标记出现/消失都不会改变标签列宽，
 *               否则字段网格会随 `*` 的亮灭左右横跳（`--pcfg-label-w` 是"当页最长标签"）；
 *   · `undefined`（不给）→ 该页不参与标记（「版面/主题/音色库」是本机偏好，没有"谱面默认值"一说），
 *               连占位都不渲染，不给这些页白添宽度。
 */
function Row({ label, mark, children }: { label: string; mark?: boolean; children: React.ReactNode }) {
  return (
    // adj418：标签列给足宽度且不换行（「两端对齐最小小节数」这类长标签不再折成两行）。
    // adj482：布局**全部交给 CSS**（`.pcfg-row` / `.pcfg-row-label` / `.pcfg-row-ctl` 已从内联搬到
    // index.css）——内联样式会压过 dock 里的覆盖规则，导致"按当页最长标签对齐"的规则无法生效。
    <div className="pcfg-row">
      <span className="pcfg-row-label">
        {label}
        {mark !== undefined && (
          <span
            className={`pcfg-def-mark${mark ? ' on' : ''}`}
            aria-hidden="true"
            title={mark ? '与默认值不同：保存后会写进这份谱的设置（# jps-config）' : undefined}
          >
            {mark ? '*' : ''}
          </span>
        )}
      </span>
      <div className="pcfg-row-ctl">{children}</div>
    </div>
  )
}

/**
 * 数值输入框（adj526 重写）——三类操作并存，桌面/手机都顺手：
 *  1. **键盘输入**（点一下即可）：编辑期间用**本地草稿文本**，**不再"输入即钳制"**。
 *     这是手机端"数字改不动"的直接原因——受控值 + 每次按键立即钳制，想输 `50` 打到 `5` 就被钳成 `10`；
 *     现在改为**失焦 / 回车才提交并钳制**，中途可以自由打完整数字；
 *  2. **`−`/`+` 步进**：点一下一步，**按住连续**（长按 420ms 后每 90ms 一步）——手机上可见
 *     （桌面靠原生 spinner，故用 `(pointer: coarse)` 只在触屏显示，见 CSS）；
 *  3. **按住上下拖**（`useNumberScrub`）：上拖增大、下拖减小，横向位移转粗调（×10）；
 *     触屏需先长按 250ms（给"滚面板"留出通道），鼠标按住即拖。
 * `range` 来自 `PAGE_NUM_RANGES`（谱面字段 = 引擎 `GUIDE_LIMITS` 的同一份范围）；不给就是"不限范围"，
 * 拖动只做相对增量（保住设置里可填极值的能力）。
 */
function NumInput(props: {
  label?: string
  value: number
  onChange: (v: number) => void
  /** [min,max]；缺省 = 不限范围（拖动只做相对增量，输入也不钳制） */
  range?: readonly [number, number]
  /** 步长（默认 1） */
  step?: number
}) {
  const { label = '', value, onChange, range, step = 1 } = props
  const min = range?.[0]
  const max = range?.[1]
  const clampV = (v: number): number => {
    let n = Math.round(v)
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    return n
  }
  /** 编辑中的文本；非 null = 正在输入（此时**不**钳制、也不回写） */
  const [draft, setDraft] = useState<string | null>(null)
  /** 把草稿提交到配置（失焦 / 回车）：空串视为"放弃编辑"，不把 0 写进去 */
  const commit = () => {
    if (draft === null) return
    const raw = draft.trim()
    if (raw !== '') {
      const n = Number(raw)
      if (Number.isFinite(n)) onChange(clampV(n))
    }
    setDraft(null)
  }
  const scrub = useNumberScrub(value, onChange, { step, min, max, coarse: coarseFor(range) })
  const dec = useHoldRepeat(() => onChange(clampV(value - step)))
  const inc = useHoldRepeat(() => onChange(clampV(value + step)))
  return (
    <span className="num-input">
      {label && <span className="num-input-label">{label}</span>}
      <button type="button" className="num-step" title={numCopy.decrease} aria-label={numCopy.decrease} {...dec}>
        −
      </button>
      <input
        className={`num-field${scrub.scrubbing ? ' is-scrubbing' : ''}`}
        type="number"
        // 手机弹数字键盘（并给出"完成"键）；桌面仍是普通数字框（保留原生上下小按钮）
        inputMode="numeric"
        enterKeyHint="done"
        step={step}
        min={min}
        max={max}
        value={draft ?? String(value)}
        title={numCopy.scrubHint}
        onFocus={() => setDraft(String(value))}
        // 只改本地草稿：**这是"手机能正常输入"的关键**（不即时钳制）
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        onPointerDown={scrub.onPointerDown}
        onClickCapture={scrub.onClickCapture}
      />
      <button type="button" className="num-step" title={numCopy.increase} aria-label={numCopy.increase} {...inc}>
        +
      </button>
    </span>
  )
}
