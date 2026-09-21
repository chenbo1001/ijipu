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
 *  · 告警：默认 **5 行**高（adj555：4 → 5）；设置：默认与告警同高（先这样，后续可调）；
 *  · 试听 / 导出：默认**最小高度**；
 *  · 工作区：窄屏按"列表 5 项 + 面板头"算（adj554），宽屏直接给满；
 *  · 拖拽调整 → 只影响**当次**（切走再切回该面板仍是你的高度）；
 *  · **重新打开**（关闭后再次通过入口打开）→ 清掉所有当次调整、回到各自默认。
 * 高度用**内联 px** 落到 `.tool-dock`，并同步一个 CSS 变量 `--dock-cols-h` 给设置面板的三栏当
 * `max-height` —— 这样"各栏独立滚动"是**算出来的确定值**，不依赖 flex 链的隐式收窄
 * （此前依赖 flex 链，在部分情况下栏不会收窄 → 内容溢出被 overflow:hidden 裁掉、无法操作）。
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useUiStore, type DockPanelKey } from '../store/uiStore'
import { useDocStore } from '../store/docStore'
import { dockCopy } from '../brand/copy'
import { ToolIcon } from './ToolIcon'
import type { ToolIconName } from './toolIcons'
import { beginDrag } from './dragGesture'
// adj528：告警面板的高度常量与算式（单一来源 + 纯函数，smoke 有断言）
import * as PROBS from './dock/problemsHeight'
// adj528：告警条数（用于"条数 × 单行实测"算出内容自然高）——纯函数，留在主包
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
// adj540：工作区（移动端的"文件管理器"：选文件夹当工作区 + 子目录 + 打开/新建/重命名/移动/删除）
const WorkspacePanel = lazy(() => import('./dock/WorkspacePanel').then((m) => ({ default: m.WorkspacePanel })))
// adj562：「粘贴源码导入」迁入底栏（页签排在工作区之后）——原弹窗入口下线，与 adj492「关于」同套路
const ImportPanel = lazy(() => import('../dialogs/PasteImportDialog').then((m) => ({ default: () => <m.PasteImportDialog inline /> })))

/** 七个面板（顺序即标签栏顺序）；adj540：工作区**排第一**（手机端文件操作主入口，用户要求）；
 *  adj562：导入**紧跟在它后面**（用户要求"就在工作区后面加一个「导入」页签"） */
const PANELS: readonly { key: DockPanelKey; render: ComponentType }[] = [
  { key: 'workspace', render: WorkspacePanel },
  { key: 'import', render: ImportPanel },
  { key: 'problems', render: ProblemPanel },
  { key: 'tryout', render: TryoutPanel },
  { key: 'export', render: ExportPanel },
  { key: 'settings', render: SettingsPanel },
  { key: 'about', render: AboutPanel },
]

/**
 * dock 高度 = 外壳（抓手 + 页签栏）+ 内容区（上下内边距 + 内容本身）。
 * 这些值要和 `index.css` 里的实际样式对齐：
 *  · 抓手 `.tool-dock-resize` = 5px（**桌面**；粗指针设备上 CSS 把 `--jp-resize-h` 加到 14px）；
 *  · 页签栏（adj509：参照顶栏按钮样式 + 固定高度）= 38px（`.tool-dock-tabs` 高度固定，内含
 *    上下 padding 2×2 + 下边框 1 + 内置页签 28px）；
 *  · 内容区 `.tool-dock-pane` 上下内边距 = 8 + 10 = 18px。
 *
 * ⚠ adj521：下面这几个常量只是**首帧兜底**——真正参与计算的外壳高度是**运行时实测**的
 * `chromeH`（见组件内的测量 effect）。原因：抓手高度由 CSS 变量 `--jp-resize-h` 决定，而它在
 * `@media (pointer: coarse)`（手机/平板）下是 **14px** 而不是 5px ⇒ 写死的 `CHROME_H=43`
 * 在手机上比真实外壳（14+38=52）**矮 9px**，最小档会把页签栏压掉一截（用户报"底栏最小化时
 * 下压、显示的最小高度小于页签栏高度"）。实测后这类"常量与 CSS 悄悄不一致"的坑从根上消失。
 */
const RESIZE_H = 5
const TABS_H = 38
const CHROME_H = RESIZE_H + TABS_H
/**
 * 告警面板的各项高度常量与算式**统一来自 `ui/dock/problemsHeight.ts`**（adj528）——
 * 那里是"单一来源 + 纯函数"，并被 `scripts/smoke.mts` 直接断言；
 * 本文件只做"读 DOM 数值 → 调用"的薄接线。
 */
const PANE_PAD_H = PROBS.PANE_PAD_H
const ROW_H = PROBS.ROW_H
const PROBLEMS_HEAD_H = PROBS.PROBLEMS_HEAD_H
/**
 * adj468/478：设置面板在**窄屏**下按钮行折到内容下方（横向一行，实测 ≈31px）。
 * 用于它的**建议高度**（`settingsDefaultH`）。
 */
const FOOT_H = 38
/** 设置面板窄屏布局的**行间距**（与 CSS `grid-template-rows: … auto` 的 row-gap 对齐） */
const GRID_GAP_V = 6
/**
 * adj554（v0.28.2，用户要求）：工作区窄屏建议高度 = 列表**5 项** + 面板头 + 结构间隙；
 *  宽屏仍走 `maxH()`（adj540 "宽屏一次看全"口径不变）。
 *  这些是**结构常数**——`.ws-row` / `.ws-head` 的具体像素由运行时实测（见下面 `workspaceRowH` /
 *  `workspaceHeadH`），常量仅保留 5 项 + 盒子自身 padding/border/gap。
 *  列出来的目的是：哪几个像素是"盒子自身的"、哪几个是"列表行数 × 单行高"，一眼能分清，
 *  改的时候不至于把测量与硬编码混在一起调。
 */
/** `.ws-list` 上下内边距（4 + 4 = 8） */
const WS_LIST_PAD_V = 8
/** `.ws-list` 上下边框（1 + 1 = 2） */
const WS_LIST_BORDER_V = 2
/** `.ws-panel` `gap`（面板头与列表之间的间距） */
const WS_PANEL_GAP = 8
/** 窄屏下"建议档"要显示多少项（用户口径：与告警 adj555 保持一致的"5"） */
const WORKSPACE_VISIBLE_ROWS = 5
/** adj554：`.ws-row` 高度实测未到位时的兜底（`padding: 9px 8px; font-size: 13px` 实测 ≈ 36） */
const WORKSPACE_ROW_H_FALLBACK = 36
/** adj554：`.ws-head` 高度实测未到位时的兜底（28px 按钮 + 面包屑 → 取大者） */
const WORKSPACE_HEAD_H_FALLBACK = 28
/**
 * adj562（用户要求"把粘贴源码导入加到工作区后面"）：导入面板的**默认内容高度**。
 *
 * 为什么给固定值而**不进 AUTO_FIT**：这个面板做成"填满 dock"（`.pane-import { flex: 1 1 auto }`），
 * 让粘贴框随 dock 拉高而变高（长源码不用在小框里滚）。而 `flex: 1 1 auto` 的 pane 一旦被拉伸，
 * `pane.scrollHeight` 就退化成"当前 dock 有多高"（`scrollHeight === max(内容高, clientHeight)`），
 * AUTO_FIT 会读到**被充气**的"内容自然高"——正是 E-2026-226 / E-2026-263 记过两次的测量污染。
 * 所以这里与设置面板同一处置：**不进 AUTO_FIT，用固定默认高度**（说明 + 粘贴框 + 按钮 ≈ 300）。
 */
const IMPORT_DEFAULT_CONTENT_H = 300
/**
 * adj520：dock 的**绝对最小高度** = 外壳高度（抓手 + 页签栏）——「最小高度」档位与拖拽/键盘的
 * 下限都用它：最小化后**仍能看到并点击页签 / 关闭 / 档位按钮**，随时可点回建议档、或向上拖回来。
 *
 * 为什么不再是 `MIN_H`(=95) / `MIN_H_SETTINGS`(=133)（adj468-adj516 的"留出可交互内容"兜底）：
 *   它们是**拖拽下限**，会让"最小高度"这一档**根本到不了**——用户点"最小"时高度被钳回 95/133，
 *   看起来就是"只有两段在切换"（用户报的就是这个）。adj513/516 又给告警面板开了"无告警时可低于
 *   MIN_H"的口子，导致同一份下限**按面板/告警数给出 0 / 95 / 133 三种结果**，语义已经混乱。
 *   现在统一成一个物理下限（外壳高度），既让三段都真正可达，也顺带让"始终允许调整高度"成立。
 *
 * adj521：**没有对应的常量**——下限一律取组件内**实测的 `chromeH`**（原因见其状态说明：
 * 手机上抓手是 14px 而非 5px）。`CHROME_H` 只作为"尚未测量"时的首帧兜底。
 *
 * adj509：调整上限——宽屏下让"设置左栏页签"能**至少显示 3 个**（之前的鼠标滚动一档=3 项，
 * 但宽屏只能看到 2 个 ⇒ 第 3 个"音色库"一直显示不到）。把上限从 420 提到 460，让宽屏的
 * `dock-height` 默认值相应抬升。
 */
const maxH = () => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.55), 460)

/** adj520：三段高度的三个档位名 */
type SizePreset = 'max' | 'suggested' | 'min'

/**
 * adj520：档位按钮的**4 相位循环表**（用户规格，见 `ToolDock` 内 `cycleDockHeight` 的说明）。
 * 高度序列：`建议 → 最大 → 建议 → 最小 → 建议 → 最大 → …`
 * `icon` 是该相位下按钮要显示的图标（`上.png` / `下.png`，见 `toolIcons.ts` 的 `up` / `down`），
 * 语义 = "点一下会往哪走"：向上（变高）显示上箭头、向下（变矮）显示下箭头。
 */
const SIZE_PHASES: readonly { cur: SizePreset; next: SizePreset; icon: 'up' | 'down' }[] = [
  { cur: 'suggested', next: 'max', icon: 'up' },
  { cur: 'max', next: 'suggested', icon: 'down' },
  { cur: 'suggested', next: 'min', icon: 'down' },
  { cur: 'min', next: 'suggested', icon: 'up' },
]

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
 * 于是：宽屏 = 外壳 + 内容 6 行；窄屏 = 同上 + 44（按钮行与行间距）。**两边内容区都是 6 行**。
 *
 * adj521：外壳高度改为**传入**（实测值 `chromeH`），不再用写死的 `CHROME_H`（手机上抓手是 14px 而非 5px）。
 */
const settingsDefaultH = (rowPitch: number, narrow: boolean, chromeH: number): number =>
  chromeH + PANE_PAD_H + rowPitch * SETTINGS_ROWS + (narrow ? GRID_GAP_V + FOOT_H : 0)

/**
 * adj554（v0.28.2，用户要求）：工作区窄屏建议高度 = "**刚好装下列表 5 项 + 面板头**"。
 *
 * 此前（adj540）沿用 `settingsDefaultH + 44px` 的近似——能装下右侧那列操作按钮，却把列表压成
 * "看不到几条"。改为按面板真实结构算：chrome + pane padding + 面板头 + 8px gap + 5 × 行高
 * + list 自身 padding/border；行高/面板头都用实测值（见下面的 `workspaceRowH` / `workspaceHeadH`），
 * 实测不到位则用 `*_FALLBACK`。宽屏仍走 `maxH()`（adj540 口径不变），所以这个函数只在窄屏被调。
 */
const workspaceDefaultH = (rowH: number, headH: number, chromeH: number): number =>
  chromeH
    + PANE_PAD_H
    + headH
    + WS_PANEL_GAP
    + (rowH * WORKSPACE_VISIBLE_ROWS + WS_LIST_PAD_V + WS_LIST_BORDER_V)

/**
 * 各面板**兜底**默认高度（实测 AUTO_FIT 前的占位；AUTO_FIT 项在 `measured` 到位后会被覆盖）。
 * · 告警/试听/导出/关于：实测"能显示全内容的最小高度"（AUTO_FIT）；
 * · 设置：见 `settingsDefaultH`（内容区 `SETTINGS_ROWS` 行）。
 *
 * adj510：告警的兜底改为「**最多 `PROBLEMS_MAX_VISIBLE_ROWS` 条**可见」的高度
 * （= 外壳 + `PANE_PAD_H` + `ROW_H × PROBLEMS_MAX_VISIBLE_ROWS` + problems-head），
 * ——用户要求"打开告警页签时底栏 dock 最高只显示两个告警的高度"（adj524：4 行 ⇒ adj555：5 行）。
 * 多于 `PROBLEMS_MAX_VISIBLE_ROWS` 条时面板内部滚动查看（`problems-list` 的 `overflow-y: auto`）。
 * adj521：外壳高度改为**传入**（实测 `chromeH`），理由同 `settingsDefaultH`。
 */
const defaultH = (
  key: DockPanelKey,
  narrow: boolean,
  rowPitch: number,
  chromeH: number,
  // adj554：工作区面板的"实测行高 + 面板头高"——由 `forPanel` 把组件内的 useState 传进来；
  // 不能直接读模块外作用域（`defaultH` 是模块级函数、不是组件）。
  workspaceRowH: number,
  workspaceHeadH: number,
): number => {
  // adj510：告警**兜底** = `PROBLEMS_MAX_VISIBLE_ROWS` 行告警 + 面板头（problems-head ≈ 28px）；
  // AUTO_FIT 实测接管后会按"内容自然高" 调整，但始终 cap 在同一行数（`measured` 已在 `forPanel`
  // 里钳制过；详见 `capProblemsContentHeight`）。
  if (key === 'problems') return chromeH + PANE_PAD_H + PROBLEMS_HEAD_H + ROW_H * PROBLEMS_MAX_VISIBLE_ROWS
  // adj509：设置面板**默认高度**直接拉到上限（用户要求"调大 dock 高度让左栏页签至少显示 3 个"，
  // 宽屏下默认 dock 高度 ~235px 才能装下 6 行内容区，但左栏 jp-tab 36px×6=216px 只能装下 6 个；
  // 取 maxH 作为默认 = "第一次打开就让用户看到全部 5 个页签 + 还能看几行内容"，避免「打开设置 →
  // 还得先拖大才能看到音色库」。narrow 时仍走 settingsDefaultH（避免矮屏默认过高撑爆视口）。
  if (key === 'settings') return narrow ? settingsDefaultH(rowPitch, narrow, chromeH) : maxH()
  // adj554：工作区面板——窄屏按 `workspaceDefaultH(workspaceRowH, workspaceHeadH, chromeH)` 算出
  // "列表 5 项 + 面板头"的高度（用户要求）；宽屏仍走 maxH()（adj540 口径）。
  // 内容是**动态列表**（进出子目录、增删改后行数都在变），走 AUTO_FIT 会让高度每次导航都跳，
  // 故用固定默认 + 列表自身滚动。
  if (key === 'workspace')
    return narrow
      ? workspaceDefaultH(workspaceRowH, workspaceHeadH, chromeH)
      : maxH()
  // adj562：导入面板——固定默认高度（粘贴框做成"填满 dock"，故**不进 AUTO_FIT**，理由见常量注释）
  if (key === 'import') return chromeH + PANE_PAD_H + IMPORT_DEFAULT_CONTENT_H
  // adj494：关于/试听/导出走 AUTO_FIT（实测内容高）；这里的值是**首次测量前的兜底**
  return chromeH
}

/**
 * 夹紧到 [**外壳最小高度**, 上限]。
 *
 * adj520：下限统一为**外壳高度**（抓手 + 页签栏），**不再按面板/告警数给不同的下限**
 * （adj468/adj513/adj516 曾给出 0 / 95 / 133 三种结果，把"能到多小"变成了面板相关的隐式规则，
 *  直接后果是"最小高度"档永远到不了、以及"只有两段在切换"）。物理下限之外由内容区的
 * `overflow-y: auto` 兜底——高度不够就滚动，不需要用"抬高下限"来保护内容。
 *
 * adj521：下限不再取写死的 `MIN_DOCK_H`，而是**由调用方传入实测的 `chromeH`**——粗指针设备
 * （手机）上 CSS 把抓手 `--jp-resize-h` 从 5px 加到 14px，写死的 43px 会比真实外壳（52px）矮，
 * 最小档因此把页签栏压掉一截（用户报"下压、显示的最小高度小于页签栏高度"）。
 * 上限同时兜一道 `Math.max(maxH(), chromeH)`：视口极矮时 `maxH()` 可能比外壳还小，
 * 不兜会出现"下限 > 上限"的反向钳制（三档排序与档位判定都会失真）。
 */
const clampH = (v: number, chromeH: number) => {
  const hi = Math.max(maxH(), chromeH)
  return Math.min(Math.max(Math.round(v), chromeH), hi)
}

/**
 * 底栏面板页签（adj486：图标改用**顶栏同一套矢量图标**；adj492：新增「关于」；adj562：新增「导入」）。
 *
 * 由来（用户报）：这几个页签此前用的是 **Unicode 字符**（`⚠ ▶ ⬇ ⚙`）当图标——与顶栏按钮那套
 * "用户设计的线稿图标"不是一路货：字形粗细/留白/基线各不相同，与面板里的其它图标摆在一起显得杂，
 * 而同一个"试听/导出/设置"在顶栏是设计图标、在底栏却是个字符。现统一为 `ToolIcon`（同一套 PNG + mask 上色）。
 *
 * adj565（用户要求）：**最后一个字符兜底也没了**——告警用 `public/icons/告警.png`、关于用
 * `public/icons/关于.png`。至此 7 个页签**全部**是设计图标，于是把 `glyph` 字段与
 * `t.icon ? <ToolIcon/> : t.glyph` 那个分支一并删掉（类型上 `icon` 变为**必填**），
 * 从结构上杜绝"再借某个字符当图标"（与 adj458 删掉 `rotate` 复用同一思路）。
 */
const TABS: { key: DockPanelKey; label: string; icon: ToolIconName }[] = [
  // adj540：工作区排第一（手机端文件操作主入口，用户要求）；图标用 `public/icons/工作区.png`
  { key: 'workspace', label: dockCopy.tabWorkspace, icon: 'workspace' },
  // adj562：导入紧跟工作区（用户要求）；adj564：图标用设计图 `public/icons/导入.png`
  { key: 'import', label: dockCopy.tabImport, icon: 'import' },
  // adj565：告警图标由 `⚠` 字符换成设计图 `public/icons/告警.png`
  { key: 'problems', label: dockCopy.tabProblems, icon: 'problems' },
  { key: 'tryout', label: dockCopy.tabTryout, icon: 'play' },
  { key: 'export', label: dockCopy.tabExport, icon: 'export' },
  { key: 'settings', label: dockCopy.tabSettings, icon: 'settings' },
  // adj565：关于图标由 `ⓘ` 字符换成设计图 `public/icons/关于.png`
  { key: 'about', label: dockCopy.tabAbout, icon: 'about' },
]

/**
 * adj469：**内容较少的面板默认高度 = "能显示全内容的最小高度"**。
 * 这几块的内容高度随 dock 宽度重排而变（导出按钮是 auto-fit 网格、关于是「品牌 + 正文」两栏），
 * 常量定不准，所以实测：取 `pane.scrollHeight` 作为"内容自然高"。
 *
 * ⚠ adj523：这里原写的是"`pane.scrollHeight` 不受当前可视高度影响，恒为内容自然高度"——**这句是错的**，
 * 也正是"建议高度随切过来的方向而变"的根因：`scrollHeight === max(内容高, clientHeight)`，
 * 而当时 `.tool-dock-pane` 是 `flex: 1 1 auto`（被拉伸到 dock 高度）⇒ **内容比可用高度小时候，
 * 读数就等于"当前 dock 有多高"**。于是从"最大"切"建议"时量到的是 417px（拉伸后的可用高度）、
 * 从"最小"切过来量到的才是真实内容高（用户报：从最大切不正好、从最小切正好）。
 * 现由 CSS 保证 pane **按内容取高**（`.tool-dock-pane { flex: 0 0 auto }`，设置/告警两条例外
 * 各自覆盖回 `1 1 auto` 且不依赖这个读数），`scrollHeight` 才真正恒等于内容自然高。
 * 告警**也**用它（adj510：与试听/导出/关于同一套机制 ——
 * "能装下内容的最小高度"），但**内容本身高度被 cap**（见 `PROBLEMS_MAX_VISIBLE_ROWS`）：
 * 告警自然内容 > `PROBLEMS_MAX_VISIBLE_ROWS` 行时，列表内部可滚动，dock 自身只装这么多行的可见高度。
 * 设置不走 AUTO_FIT（规格是固定 `SETTINGS_ROWS` 行）。
 * adj494：加入 `about` —— 用户要求"打开关于时应以能够显示全内容为宜"。
 * adj510：告警（`problems`）加入 AUTO_FIT，与试听/导出/关于统一按"内容自然高"定 dock 高度。
 * （内容再长也受 `maxH()` 上限约束，超长时仍可滚动。）
 */
const AUTO_FIT: readonly DockPanelKey[] = ['problems', 'tryout', 'export', 'about']

/**
 * 告警面板在**建议档**下最多显示几行（超出部分由列表自身滚动查看）。
 *
 * adj510：定为 **2 行** —— 当时底栏高度只能靠拖拽调整，"默认就给很高"会挤占编辑区，
 * 所以取一个保守值，让用户需要时自己拖高。
 * adj524（用户要求）：**2 → 4 行** —— 底栏有了高度档位按钮（adj519/adj520）之后，
 * "默认给多一点"不再是负担：嫌高按一下就能切到最小（只留页签栏），想要更高按一下切到最大。
 * adj555（v0.28.2，用户要求）：**4 → 5 行** —— 与工作区窄屏"列表 5 项"保持一致；
 * 建议档可以承担"一次看全 5 条告警"的职责，减少"还得先拖大才看得见"的次数。
 * （0/1/2 条告警仍按内容自然高收缩，不受本上限影响；只有超过本行数才滚动。）
 * adj528：常量搬到 `ui/dock/problemsHeight.ts`（与算式同处一地，smoke 直接断言）。
 */
const PROBLEMS_MAX_VISIBLE_ROWS = PROBS.PROBLEMS_MAX_VISIBLE_ROWS

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
   * adj520：档位按钮的**循环相位**（0..3，见模块级 `SIZE_PHASES`）。
   * 声明在这里（而非使用处附近）是因为下面几个 effect 也要重置它。
   */
  const [sizePhase, setSizePhase] = useState(0)
  /**
   * adj521：**实测的外壳高度**（抓手 `.tool-dock-resize` + 页签栏 `.tool-dock-tabs`）。
   *
   * 为什么必须实测：抓手高度来自 CSS 变量 `--jp-resize-h`，桌面是 5px、而 `@media (pointer: coarse)`
   * （手机/平板）下是 **14px** ⇒ 写死的 `CHROME_H=43` 在手机上比真实外壳（14+38=**52**）矮 9px。
   * 后果：最小档把 dock 设成 43px 时，容器比"抓手+页签栏"的需要还矮，页签栏被 `overflow: hidden`
   * 裁掉一截（用户报"手机端底栏最小化时下压、显示的最小高度小于页签栏高度"）。
   * 同一处偏差还会污染所有按 `CHROME_H` 算出来的高度（告警 cap、设置 6 行、建议档……），
   * 所以统一改为"量出来再用"。首帧未量到之前用常量兜底。
   */
  const [chromeH, setChromeH] = useState(CHROME_H)
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
   * adj521：实测外壳高度（抓手 + 页签栏）——见 `chromeH` 状态的说明。
   * 观察这两个元素自身的尺寸：`--jp-resize-h` 随 `(pointer: coarse)` 变化（5px ↔ 14px）时
   * ResizeObserver 会触发重测；窗口 resize / 旋转屏 / 缩放也一并覆盖（外加 `resize` 监听兜底）。
   * 这两个元素都是 `flex: 0 0 auto`（不随 dock 高度收缩），所以"量它们"不会与"设置 dock 高度"
   * 形成互相触发；量到之后只在变化超过 0.5px 时才 setState，进一步避免抖动。
   */
  useLayoutEffect(() => {
    if (!dockOpen) return
    const root = dockRef.current
    if (!root) return
    const resizeEl = root.querySelector<HTMLElement>('.tool-dock-resize')
    const tabsEl = root.querySelector<HTMLElement>('.tool-dock-tabs')
    const measure = () => {
      const h =
        (resizeEl?.getBoundingClientRect().height ?? RESIZE_H) + (tabsEl?.getBoundingClientRect().height ?? TABS_H)
      if (h <= 0) return
      setChromeH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (resizeEl) ro.observe(resizeEl)
    if (tabsEl) ro.observe(tabsEl)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [dockOpen])
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
  /**
   * adj554：工作区面板的**列表行高**（实测 `.ws-list .ws-row`）——用于算"窄屏显示 5 项"的高度。
   * `.ws-row` 在窄屏时是图标 + 文件名一行文字（搜索结果可能两行兜底），行高在不同视口下会随
   * 字号/dpi 变化，所以必须实测；空目录没有行可量，未测到前用 `WORKSPACE_ROW_H_FALLBACK` 兜底。
   */
  const [workspaceRowH, setWorkspaceRowH] = useState(WORKSPACE_ROW_H_FALLBACK)
  /**
   * adj554：工作区面板**顶部行**（切换工作区按钮 + 路径面包屑）的实测高度——
   * 也是"5 项"高度里的固定开销之一；未测到前用 `WORKSPACE_HEAD_H_FALLBACK` 兜底。
   */
  const [workspaceHeadH, setWorkspaceHeadH] = useState(WORKSPACE_HEAD_H_FALLBACK)
  useEffect(() => {
    if (!dockOpen || dockPanel !== 'workspace') return
    const pane = bodyRef.current?.querySelector<HTMLElement>('.pane-workspace')
    if (!pane) return
    const head = pane.querySelector<HTMLElement>('.ws-head')
    const row = pane.querySelector<HTMLElement>('.ws-list .ws-row')
    if (head) {
      const h = head.getBoundingClientRect().height
      if (h > 0 && Math.abs(h - workspaceHeadH) > 0.5) setWorkspaceHeadH(h)
    }
    if (row) {
      const h = row.getBoundingClientRect().height
      if (h > 0 && Math.abs(h - workspaceRowH) > 0.5) setWorkspaceRowH(h)
    }
  }, [dockOpen, dockPanel, everActive.length, workspaceHeadH, workspaceRowH, narrow])

  /**
   * adj556（用户要求"页签始终显示图标，靠左右滚动查看视界外的页签"）：
   * `.tool-dock-tabstrip` 的**横向溢出状态**——左右两端是否还能再滚。
   * 两个箭头按钮（`.tool-dock-tab-arrow`）只在"该方向还有内容"时才渲染，滚到尽头就消失。
   * 与输入条 adj553 的 `padOverflow` 同思路，但去掉了移动端触摸滑动的部分（移动端本就可触摸滑动；
   * 这里补的是**桌面端**鼠标路径——滚轮转横向 + 箭头翻页）。
   */
  const tabstripRef = useRef<HTMLDivElement | null>(null)
  /**
   * adj567：`overflowing` = **页面是否真的溢出**（与滚动位置无关），用来决定"要不要预留两个箭头槽位"。
   * 见下面 JSX：一旦溢出，两个箭头按钮就**始终占位**、只切换 `visibility`
   * ⇒ tabstrip 的宽度在滚动过程中**恒定**。
   *
   * 为什么必须这样：箭头是 tabstrip 的**兄弟节点**（adj557：左右两侧不随页签滚动），
   * 所以"箭头出现/消失"会**改变 tabstrip 的可用宽**（每个 21px，两个都出现就是 42px）。
   * 于是"把当前页签滚进视界"这类**按当前宽度算出目标位置**的操作会被自己触发的变化推翻：
   * 对齐后箭头才出现 → 可滚区变窄 → 刚对齐的页签又被挤出 21~42px。
   * 预留槽位把这个反馈彻底切掉（本轮真机测试就是这样抓到的：顶栏点「设置」后差 21px）。
   */
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false, overflowing: false })
  const syncTabOverflow = useCallback(() => {
    const el = tabstripRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // 与 adj553 同款容差：1px 之内视作"贴边"，避免 sub-pixel 抖动。
    // adj561：**只在真的变化时才 setState**——箭头出现/消失会改变 tabstrip 的可用宽，
    // 进而再触发一次 RO 回调；若无条件 `setState({...})` 每次都换新对象引用，会多一轮渲染
    // （虽不会死循环，但没必要），用"同值返回 prev"直接短路。
    const left = el.scrollLeft > 1
    const right = max > 1 && el.scrollLeft < max - 1
    const overflowing = max > 1
    setTabOverflow((prev) =>
      prev.left === left && prev.right === right && prev.overflowing === overflowing ? prev : { left, right, overflowing },
    )
  }, [])
  /**
   * adj561（用户报"手机端页签过多/滚动时**没有适时显示** `<` `>` 按钮，PC 端却有"）：
   * **依赖必须含 `dockOpen`**——底栏关着时组件走 `if (!dockOpen) return null`，
   * `.tool-dock-tabstrip` 根本没进 DOM，而本 effect 原先只依赖稳定的 `syncTabOverflow`
   * ⇒ 首次（也是唯一一次）运行发生在底栏关闭时，`tabstripRef.current === null` 直接 early
   * return，**之后永不重跑** ⇒ 箭头状态、scroll 监听、滚轮转横向**全都没装上**。
   * PC 端之所以"看起来正常"，是因为中途切过视图/分屏时 `ToolDock` 被重挂载、而那时底栏恰好开着。
   *
   * adj561 第二处：**同时观察每个页签子元素**——`ResizeObserver` 只盯"被观察元素自身的盒尺寸"，
   * 页签内容变宽（字体加载完成、文案变化）时 tabstrip 的**盒宽不变**、`scrollWidth` 却变了，
   * 只观察容器就收不到回调（手机上首次打开时 webfont 还没就绪，正是这种情况）。
   * 另外补一次 `fonts.ready` 与首帧后的 rAF，兜住"测量时字体/布局尚未稳定"。
   */
  useLayoutEffect(() => {
    if (!dockOpen) return // 底栏关着 ⇒ tabstrip 未渲染，无 DOM 可测（见上）
    const el = tabstripRef.current
    if (!el) return
    const sync = () => syncTabOverflow()
    sync()
    // 首帧之后（含字体子集加载、容器查询命中后的重排）再补测一次
    const raf = requestAnimationFrame(sync)
    // adj556：滚轮转横向——只在容器**确实溢出**时接管；触摸板横向滚动（`deltaX` 已占主导）
    // 与 Shift+滚轮（浏览器原生已支持横向）原样放行，不劫持正常滚动（adj553 同款三条）。
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    /** 观察容器 + 全部页签：容器盒宽变（拖宽/旋转屏）与内容宽变（页签变宽）都要重算溢出 */
    const observeAll = () => {
      ro.disconnect()
      ro.observe(el)
      for (const child of Array.from(el.children)) ro.observe(child)
    }
    observeAll()
    // 页签增删（当前 TABS 静态，将来若变）⇒ 重新登记观察对象并立刻重算
    const mo = new MutationObserver(() => {
      observeAll()
      sync()
    })
    mo.observe(el, { childList: true })
    // 字体就绪后页签宽度会变（首次打开时 webfont 往往还没加载完）——这是手机上最常踩的一次
    void document.fonts?.ready.then(sync).catch(() => {})
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      ro.disconnect()
      mo.disconnect()
    }
  }, [syncTabOverflow, dockOpen])
  /** adj556：箭头翻页——按"一屏的 80%"翻；滚到尽头自动禁用（箭头消失） */
  const pageTabsBy = (dir: -1 | 1) => {
    const el = tabstripRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(80, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  /**
   * adj567（用户反馈）：**当前面板的页签必须可见**。
   *
   * ⚠ 第一版把这段逻辑写在页签自己的 `onClick` 里 —— **只覆盖"用户用手点页签"这一条路**，
   * 而用户报的场景恰恰是"**页签在视界外**（所以根本点不到它），我是从顶栏按钮 / 菜单 /
   * 状态栏把面板打开的"：那条路不经过任何页签的 `onClick` ⇒ 修复等于没做（用户实测确认）。
   * 所以对齐函数由**两处**调用：① `dockPanel` / `dockOpen` 变化的 effect（覆盖顶栏/菜单/状态栏/快捷键）；
   * ② 页签自身的 `onClick`（覆盖"点的是**已激活**的那个页签"——此时 `dockPanel` 没变，effect 不会跑）。
   *
   * 实现要点：
   *  · **绝对** `scrollTo`（不是 `scrollBy`）：重复调用幂等；相对位移会叠加成双倍。
   *  · 用 `behavior: 'auto'`（立即到位）而不是 `'smooth'`：下面那次"延迟补正"如果撞上平滑动画，
   *    会因为"动画还没走完就算目标"而算错；立即到位则每遍都是确定性的。
   *  · 溢出时箭头**始终占位**（见 `tabOverflow.overflowing` 的说明）⇒ 宽度恒定、一遍就准；
   *    那个 60ms 的补正只是兜底（布局/字体就绪、dock 高度变化带动重排等），且**幂等**。
   *  · 只做**一次**延迟补正，不做循环——避免和用户手动滚动打架。
   */
  const alignActiveTab = useCallback(() => {
    const strip = tabstripRef.current
    if (!strip) return
    const pass = () => {
      const btn = strip.querySelector<HTMLElement>(`[data-key="${dockPanel}"]`)
      if (!btn) return
      const br = btn.getBoundingClientRect()
      const sr = strip.getBoundingClientRect()
      // 已在视界内（1px 容差）⇒ 就地不动，符合"就近"语义
      const delta = br.left < sr.left - 1 ? br.left - sr.left : br.right > sr.right + 1 ? br.right - sr.right : 0
      if (delta === 0) return
      strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'auto' })
    }
    pass()
    window.setTimeout(pass, 60)
  }, [dockPanel])

  useEffect(() => {
    if (!dockOpen) return
    alignActiveTab()
  }, [dockOpen, dockPanel, alignActiveTab])

  useEffect(() => {
    if (!dockOpen) return
    setEverActive((prev) => (prev.includes(dockPanel) ? prev : [...prev, dockPanel]))
  }, [dockOpen, dockPanel])

  // adj465：只在**重新打开**（关 → 开）时清掉当次调整；切换面板不清（切回该面板仍是你的高度）
  useEffect(() => {
    if (dockOpen && !wasOpenRef.current) {
      setHeights({})
      setMeasured({})
      // adj520：重新打开 = 各面板回到默认高度 ⇒ 档位循环也回到起点（相位 0 = 建议，图标上箭头）
      setSizePhase(0)
    }
    wasOpenRef.current = dockOpen
  }, [dockOpen])

  // adj520：切换面板时档位循环回到起点（相位 0）——各面板高度互相独立，
  // 上一个面板循环走到哪一格不该带到下一个面板（否则新面板的"当前档"与图标指示会对不上）。
  useEffect(() => {
    setSizePhase(0)
  }, [dockPanel])

  // adj510：告警**始终**走 AUTO_FIT（与试听/导出/关于同源）——实测 pane.scrollHeight，
  // 并在 `capProblemsContentHeight` 里把"内容自然高"钳到「头 + `PROBLEMS_MAX_VISIBLE_ROWS` 行告警」的高度上限。
  // 因此：0 条 = 一行占位；1 条 = 头 + 1 行；≥ 2 条 = 头 + 2 行（面板内可滚动）。
  // adj520：不再需要订阅"告警条数"——下限统一为 `MIN_DOCK_H` 后，"少于 2 条告警要按内容自然高收缩"
  // 由 AUTO_FIT 的自然结果直接给出（73px / 64px 都 ≥ 43px 的下限，不会被钳），无需特判。
  /** 当前面板是否要按"能显示全内容的最小高度"定高（AUTO_FIT 机制） */
  const fitAllNow = AUTO_FIT.includes(dockPanel)
  /**
   * adj528：**告警条数**（渲染出的行数）。
   * "告警面板的内容自然高"现在由它（数据）× 单行实测算出，而不再读 `pane.scrollHeight`
   * —— 那条 pane 为了列表能滚必须填满 dock，读总量会被"可用高度"充气，
   * 于是"从最大切建议"会得到一个虚高的建议高度（用户连报两次，见 `ui/dock/problemsHeight.ts`）。
   */
  const errors = useDocStore((s) => s.parseResult.errors)
  const problemCount = useMemo(() => summarizeProblems(errors).total, [errors])

  /**
   * adj518（用户报"底栏 dock 应始终允许通过高度调整线调整 dock 的高度；目前除了设置页签
   * 是可以调整高度的外，其它几个页签都不能调整"）：
   *   1. 上面 `baseH` 改为 `heights[dockPanel] ?? forPanel(dockPanel)`，去掉 AUTO_FIT
   *      的"完全忽略用户拖拽值"分支（这是用户拖拽不生效的根因）。
   *   2. 本 effect 由"切换面板 / 重新打开时清掉 AUTO_FIT 面板的拖拽值"改为**只在 dock
   *      重新打开时清掉所有当次调整**（沿用 `wasOpenRef` 的"关 → 开"判定 ——见下方的
   *      `useEffect`，adj465 设计），**切换面板不再清掉用户拖拽的高度**。
   *   ⇒ 用户拖到任意高度后会**保留**到面板切换/重新打开 dock；
   *   重新打开 dock = 清掉所有当次调整 → 各面板回到各自的"内容自然高"默认。
   *   设置面板本来就不在此列（按 `SETTINGS_ROWS` 固定行），保持原行为。
   */
  // 注：原 adj474 的"切换面板也清掉"分支已删除——保留会导致用户拖拽的值在切走再切回时
  // 被无意义地清掉，与"始终允许调整"的诉求冲突。

  // adj469/510：实测当前面板的内容高度（告警/试听/导出/关于均走 AUTO_FIT）。
  // 宽度变化会重排 → resize 复测；内容是懒加载的，chunk 到位后才真正出现 → MutationObserver 复测。
  useLayoutEffect(() => {
    if (!dockOpen || !fitAllNow) return
    const pane = bodyRef.current?.querySelector<HTMLElement>(`.pane-${dockPanel}`)
    if (!pane) return
    /**
     * adj522/adj528：取"内容自然高"（与当前 dock 多高**无关**）。
     *
     * 非告警面板：pane 已按内容取高（`.tool-dock-pane { flex: 0 0 auto }`，adj523）
     * ⇒ `pane.scrollHeight` 恒等于内容自然高。
     *
     * 告警面板**不能这么量**：它那条 pane 必须"填满 dock"（列表要受限高度才能滚），
     * 于是 dock 高时 `pane.scrollHeight` 会退化成"可用高度"（充气）。**adj528 起彻底不读总量**，
     * 改为「**条数（数据）× 单行实测**」——见 `ui/dock/problemsHeight.ts`：
     * 行数来自 store（不来自布局），单行高实测 `.problem-line`（**不含**展开的「正确写法」，
     * 那是它的兄弟节点），面板头/占位块也都是内容尺寸的弹性项。
     * 这样"从最大切建议"与"从最小切建议"必然算出同一个高度（用户连报两次的正是这一点）。
     */
    const measureNatural = (): number => {
      if (dockPanel !== 'problems') return pane.scrollHeight
      const head = pane.querySelector<HTMLElement>('.problems-head')
      const list = pane.querySelector<HTMLElement>('.problems-list')
      const empty = pane.querySelector<HTMLElement>('.dock-empty')
      const line = list?.querySelector<HTMLElement>('.problem-line')
      return PROBS.problemsContentHeight({
        problemCount,
        headH: head?.getBoundingClientRect().height ?? 0,
        rowH: line?.getBoundingClientRect().height ?? 0,
        emptyH: empty?.getBoundingClientRect().height ?? 0,
        // 面板"收起"（`open === false`）时只剩面板头、不渲染列表
        collapsed: !!head && !list,
      })
    }
    const measure = () => {
      const nat = measureNatural()
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
  }, [dockOpen, dockPanel, everActive.length, fitAllNow, problemCount])

  /**
   * adj528：cap 算式搬到 `ui/dock/problemsHeight.ts`（与"内容自然高"同一处、smoke 可断言）。
   * 说明：`problemsContentHeight()` 已经按 `PROBLEMS_MAX_VISIBLE_ROWS` 收口，
   * 所以 cap 对它是**幂等**的；留着它是为了兜住"实测值异常偏大"的输入。
   */
  const forPanel = (key: DockPanelKey): number => {
    // 实测值已含内容区上下内边距，所以这里只加外壳（adj521：外壳用实测值）
    if (AUTO_FIT.includes(key) && measured[key]) {
      const measuredContent = key === 'problems' ? PROBS.capProblemsContentHeight(measured[key]!) : measured[key]!
      return chromeH + measuredContent
    }
    // adj554：工作区的"5 项"算式需要实测的 `.ws-row` / `.ws-head` 高度，从模块外传入
    return defaultH(key, narrow, settingsRowPitch, chromeH, workspaceRowH, workspaceHeadH)
  }
  // adj518：baseH **始终优先用用户拖拽后的高度** `heights[dockPanel]`（仅当未设置才回退到
  // `forPanel`）。此前 bug：`fitKeys=true` 时 `baseH` 永远用 `forPanel(dockPanel)`，**完全忽略**
  // `heights[dockPanel]` ⇒ 告警/试听/导出/关于的手工拖拽不会生效，用户侧的表现是"除设置页签
  // 外其它几个页签都不能调整高度"。修法：把"是否 AUTO_FIT"的判断从 baseH 来源里去掉——
  // AUTO_FIT 仍负责"初始默认值 = 实测内容自然高"，但**一旦用户拖了**就以用户值为准。
  const baseH = heights[dockPanel] ?? forPanel(dockPanel)
  const dockH = clampH(baseH, chromeH)

  // ---- adj520：三段高度的单按钮循环 ------------------------------------------------
  /**
   * 「建议高度」——"刚好装下当前面板内容"的高度。
   *
   * ⚠ 设置面板是**特例**：`forPanel('settings')` 在宽屏下返回 `maxH()`（adj509：为了让左栏 5 个页签
   * 一次看全，把"打开时的默认高度"直接拉到了上限）。若建议档也用它，就会出现 `建议 === 最大`，
   * 三段里有两段重合 ⇒ 用户看到的仍是"两段切换"。所以这里改用 `settingsDefaultH`（内容区 6 行，
   * 即 adj492 的口径，宽屏 ≈235px，左栏仍能露出 4~5 个页签 ≥ adj509 要求的 3 个），
   * 保证 **最小 < 建议 < 最大** 三档严格单调。
   *
   * 末尾再夹一道 `(min+8, max−8)`：极矮视口下（`maxH()` 会随视口缩到很小）"内容自然高"可能贴到
   * 上限或下限，与相邻档重合 ⇒ 又变成"只有两段"。夹一下就能把"三档两两不同"变成**结构性保证**，
   * 而不是靠数值凑巧。夹到偏小时内容不会丢——内容区本来就有 `overflow-y: auto`。
   */
  const suggestedH = (): number => {
    const raw = dockPanel === 'settings' ? settingsDefaultH(settingsRowPitch, narrow, chromeH) : forPanel(dockPanel)
    const lo = chromeH + 8
    const hi = Math.max(lo, maxH() - 8)
    return Math.min(Math.max(raw, lo), hi)
  }

  /**
   * 三档目标高度（**语义严格单调**：min < suggested < max）：
   * · max       = `maxH()`（与抓手拖拽上限一致）
   * · suggested = `suggestedH()` = "刚好装下当前面板内容"的高度
   * · min       = `chromeH`（实测外壳 = 抓手 + 页签栏），内容区收起到 0
   */
  const dockHeightFor = (size: SizePreset): number =>
    size === 'max' ? maxH() : size === 'min' ? chromeH : suggestedH()

  /**
   * **4 相位**循环表（用户规格）——每点一次按钮**走一步**：
   * ```
   *   相位 0：当前=建议 → 点击后=最大，图标 上.png（向上＝变高）
   *   相位 1：当前=最大 → 点击后=建议，图标 下.png（向下＝变矮）
   *   相位 2：当前=建议 → 点击后=最小，图标 下.png
   *   相位 3：当前=最小 → 点击后=建议，图标 上.png
   * ```
   * ⇒ 高度序列 `建议 → 最大 → 建议 → 最小 → 建议 → 最大 …`，图标始终指示"点一下会往哪走"。
   *
   * ⚠ 为什么必须是 4 相位、而不是"记住当前档位就够"：序列里**"建议"出现了两次**，
   * 但两次的下一步方向相反（先→最大、后→最小）。只按"当前高度是哪一档"推下一步是**推不出来的**
   * ——之前那版就是栽在这里：`lastSizeRef` 的两分支（suggested↔max）永远解不出 `min`，
   * 于是"只有两段在切换"（用户报）。相位计数器把这段历史显式记下来，问题自然消失。
   */
  const sizeStep = SIZE_PHASES[sizePhase] ?? SIZE_PHASES[0]

  const cycleDockHeight = () => {
    // 先按"当前相位声明的下一步"落高度，再把相位推进一格（4 步一循环）
    setHeights((prev) => ({ ...prev, [dockPanel]: clampH(dockHeightFor(sizeStep.next), chromeH) }))
    setSizePhase((p) => (p + 1) % SIZE_PHASES.length)
  }

  /**
   * 当前 dock 高度处于哪一档（±2px 容差）；用户手动拖到的中间值记为 `custom`。
   * 只有几次比较、极廉价，**不用 `useMemo`** —— 它的依赖里有 `dockHeightFor`（每次渲染新建的函数），
   * 用 memo 反而要么漏依赖、要么每帧重算，是纯粹的负担（lint 也会报 exhaustive-deps）。
   */
  const heightPresetActive: SizePreset | 'custom' =
    Math.abs(dockH - chromeH) <= 2
      ? 'min'
      : Math.abs(dockH - maxH()) <= 2
        ? 'max'
        : Math.abs(dockH - suggestedH()) <= 2
          ? 'suggested'
          : 'custom'

  /**
   * 手动调整（拖拽 / 键盘 bump）落到 **min / max** 后，把相位拨到"下一步回建议"的那一格
   * （min → 相位 3、max → 相位 1），使下一次点击的方向符合直觉。
   *
   * 刻意**不用 effect 监听高度**去做同步：那会让"点击按钮"与"高度变化"互相触发
   * （点击设了相位 → 高度变了 → effect 又按高度把相位改回去 ⇒ 循环卡死在同一档）。
   * 只在**用户明确的手动路径**里拨相位，按钮点击就绝不会被覆盖。
   * 落到 `suggested` 时刻意**不拨**——它对应相位 0 / 2 两格，拨哪一个都是猜。
   */
  const syncPhaseFromManualHeight = (h: number) => {
    if (Math.abs(h - chromeH) <= 2) setSizePhase(3)
    else if (Math.abs(h - maxH()) <= 2) setSizePhase(1)
  }

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
        const next = clampH(d.h - dy, chromeH)
        setHeights((prev) => ({ ...prev, [panel]: next }))
        syncPhaseFromManualHeight(next)
      },
      onEnd: () => {
        dragRef.current = null
        document.body.style.userSelect = ''
      },
    })
  }
  const bump = (delta: number) => {
    const next = clampH(dockH + delta, chromeH)
    setHeights((prev) => ({ ...prev, [dockPanel]: next }))
    syncPhaseFromManualHeight(next)
  }

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
      {/* 顶部抓手（拖拽调整高度；键盘 ↑/↓ /PageUp/PageDown）
         * adj518：抓手**总是可拖**。
         * adj520/adj521：`aria-valuemin` 取 `chromeH`（**实测**外壳高度）——与 `clampH` 共用**同一个取值**，
         * 不再出现"ARIA 报 95、实际能拖到 43"或"手机上 ARIA 报 43、实际外壳 52"这类两处各写一份的漂移。 */}
      <div
        className="tool-dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={dockCopy.resizeTitle}
        aria-valuenow={dockH}
        aria-valuemin={chromeH}
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
      {/* 标题栏：**左端**常驻的档位/收起按钮 + 可横向滑动的面板页签 + **右端**常驻的关闭按钮
       *
       * adj525（用户要求"档位按钮和关闭按钮固定在右侧，如顶栏的主题/支持；其它页签超出视界可左右滑动"）：
       * 结构拆成「**可滚的页签区** + **三个常驻按钮**」——页签多了只在页签区内滚动，
       * 三个按钮永远可见、永远点得到。
       * 与顶栏 adj453 的修法同源：**"必须始终可见"的元素不要放进会溢出的滚动容器**，
       * 否则它们会被内容顶出可视区（此前正是如此：页签一溢出，两个按钮就被推到右边看不见，
       * 得先滑到最后才能点）。`role="tablist"` 随之移到页签区（它才是"页签的容器"）。
       * adj531（用户要求"把高度调整按钮移到最左边，手机上左边操作更顺手，也避免误按关闭按钮"）：
       * 档位按钮从 ✕ 左侧移到**页签区左边**，顺序成为「收起 → 档位 → 页签 → ✕」（DOM 顺序与视觉一致，
       * Tab 序也随之，不做 `order` 反转以免视觉与读屏/焦点序不一致）。于是：
       *   · 手机单手拇指在左半屏就能切高度；
       *   · ✕ 独自留在最右端、与档位按钮之间隔着**整条页签区**，够不到也就按不到。
       * adj541：多加一个「收起底栏」按钮（更靠左），让"收起"与"调高度"两件事在手机上都能单手点。
       * 三个按钮**仍在可滚页签区之外**（adj525 的口径完全不变），页签溢出只推动页签区内部滚动。
       * adj557（用户要求"左 / 右两侧不随页签滚动"）：这条**结构性保证**——常驻按钮在 DOM 上
       * 就是 `.tool-dock-tabstrip` 的兄弟节点、不是子节点 ⇒ 物理上不可能被页签溢出顶走。 */}
      <div className="tool-dock-tabs">
        {/* adj541（用户要求）：**收起底栏**按钮，位置在高度档位按钮**左边**。
            点它 = 收起底栏，并在编辑区左下角浮出「展开底栏」按钮（见 EditorPane 的 `.dock-fab`）。
            与档位/✕ 一样常驻（在可滚页签区之外），页签再多也不影响。 */}
        <button
          type="button"
          className="tool-dock-collapse"
          onClick={closeDock}
          title={dockCopy.collapseTitle}
          aria-label={dockCopy.collapseTitle}
        >
          <ToolIcon name="dockCollapse" size={16} />
        </button>
        {/* adj520：底栏高度档位切换按钮（单按钮，4 相位循环）——
            循环表见模块级 `SIZE_PHASES`；高度序列
            `建议 → 最大 → 建议 → 最小 → 建议 → …`，
            图标（`上.png` / `下.png`）指示"点一下会往哪走"：
            相位 0（建议→最大）上、1（最大→建议）下、2（建议→最小）下、3（最小→建议）上。
            adj525：移出页签区 ⇒ 常驻（不被溢出的页签顶走）；adj531：常驻在**最左端**。 */}
        <button
          type="button"
          className="tool-dock-size-btn"
          onClick={cycleDockHeight}
          title={dockCopy.sizeTitle(dockCopy.sizeName[sizeStep.cur], dockCopy.sizeName[sizeStep.next])}
          aria-label={dockCopy.sizeTitle(dockCopy.sizeName[sizeStep.cur], dockCopy.sizeName[sizeStep.next])}
          data-size={sizeStep.cur}
          data-current={heightPresetActive}
        >
          <ToolIcon name={sizeStep.icon} size={14} />
        </button>
        {/* adj556（用户要求"页签始终显示图标"）：图标不再窄屏隐藏，靠这条可滚页签区
            + 滚轮转横向 + 左右翻页箭头兜住视界外的页签。三个固定按钮（档位 / ✕）放在
            tabstrip 之外 ⇒ 永远不被页签溢出顶走（adj557：用户要求"左右两侧不随页签滚动"）。
            adj567：**一旦溢出，两个箭头就始终占位、只切 `visibility`**——见 `tabOverflow.overflowing`
            的说明（箭头一增一减会改变 tabstrip 可用宽，把"刚对齐好的页签"又挤出去）。 */}
        {tabOverflow.overflowing && (
          <button
            type="button"
            className="tool-dock-tab-arrow"
            // 占位但不可见/不可点（`visibility` 保留布局，`disabled` + `tabIndex=-1` 保持可访问性正确）
            style={{ visibility: tabOverflow.left ? 'visible' : 'hidden' }}
            disabled={!tabOverflow.left}
            tabIndex={tabOverflow.left ? 0 : -1}
            aria-hidden={!tabOverflow.left}
            title={dockCopy.tabsLeftTitle}
            aria-label={dockCopy.tabsLeftTitle}
            onClick={() => pageTabsBy(-1)}
          >
            {/* adj564（用户要求）：滚动指示改用设计图标 `public/icons/左.png`（原来用 `‹` 字符） */}
            <ToolIcon name="left" size={14} />
          </button>
        )}
        <div className="tool-dock-tabstrip" role="tablist" ref={tabstripRef}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={dockPanel === t.key}
              className={`tool-dock-tab${dockPanel === t.key ? ' is-active' : ''}`}
              // adj567：`data-key` 供"把当前面板的页签滚进视界"按 key 找 DOM
              data-key={t.key}
              onClick={() => {
                setDockPanel(t.key)
                // adj567：点**已激活**的那个页签时 `dockPanel` 不变 ⇒ 上面那个 effect 不会跑，
                // 于是"我把页签栏手动滚开、再点回当前页签"就永远回不来 ⇒ 这里也补一次对齐。
                alignActiveTab()
              }}
              title={t.label}
            >
              <span className="tool-dock-tab-icon" aria-hidden="true">
                {/* adj486：设计图标（顶栏同一套）。
                    adj514：**与顶栏按钮图标同尺寸**（`ToolIcon` 默认 size=16，与顶栏一致）——
                    此前 `size={14}` 比顶栏小 2px，视觉"虚"（用户报）。
                    adj556：图标**窄屏也不再隐藏**——与 `.tool-dock-tab-label` 同显。
                    adj565：7 个页签全部有设计图标 ⇒ 删掉字符兜底分支（`icon` 现在是必填）。 */}
                <ToolIcon name={t.icon} />
              </span>
              <span className="tool-dock-tab-label">{t.label}</span>
            </button>
          ))}
        </div>
        {tabOverflow.overflowing && (
          <button
            type="button"
            className="tool-dock-tab-arrow"
            style={{ visibility: tabOverflow.right ? 'visible' : 'hidden' }}
            disabled={!tabOverflow.right}
            tabIndex={tabOverflow.right ? 0 : -1}
            aria-hidden={!tabOverflow.right}
            title={dockCopy.tabsRightTitle}
            aria-label={dockCopy.tabsRightTitle}
            onClick={() => pageTabsBy(1)}
          >
            {/* adj564：同左箭头，改用 `public/icons/右.png` */}
            <ToolIcon name="right" size={14} />
          </button>
        )}
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
