/**
 * preview/PreviewPane.tsx — 乐谱预览区（真实渲染 + 光标联动 + 排版辅助虚线）
 *
 * 渲染管线：parseResult → layoutScore → renderScoreToSvg → 多页 SVG。
 * 联动（M3）：activeNoteId 高亮对应音符并滚动；点击音符/歌词跳转编辑器光标。
 * 辅助虚线（adj7）：页面四边距 + 每行行距虚线，按住拖拽直接调整页面设置。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
// adj529：预览页基准宽（与顶栏"双击比率按宽度适配"的反算算式同源）
import { PREVIEW_BASE_W, isFullyVisibleIn } from './zoomFit'
import { openExternalUrl } from './openUrl'
import { beginDrag } from '../ui/dragGesture'
// adj723：音符点击（单击 / Ctrl+单击）的动作判定（纯模块，便于 smoke 断言）
import { noteClickAction, noteClickKind } from './noteClickAction'
import { tempoLabel } from '@ijipu/engine/parser/parser'
// adj758（清单 B1）：色块的**分组/定位/配色**都来自引擎 —— 应用与 Obsidian 插件共用一份实现
import {
  layoutScore,
  renderScoreToSvg,
  noteIdToCodePos,
  buildIndexToPage,
  SEGMENT_ROW_GAP_DEFAULT,
  notesRowBaseline,
  trackKeysOf,
  playheadPosIn,
  instrumentColorMap,
  playheadBaseOf,
} from '@ijipu/engine'
import type { ScorePage, PageConfig } from '@ijipu/engine'
import { computeRowTops, computeRowGuides, dragDelta, clamp, metaAreaH, GUIDE_LIMITS, GUIDE_LIMITS_EX } from '@ijipu/engine/layout/guides'
import { clampMetaPos, metaAnchorOf, metaAnchorPt } from '@ijipu/engine/layout/metaAnchors'
import { firstEnabledInstrumentRef } from '../playback/spessaSynthBackend'
import { measureFontMeta } from './fontMeta'
import { brand, ui as uiColors } from '../brand/tokens'

/**
 * adj380：播放高亮元素「加/去」高亮——**除 class 外直接写 fill 属性**。
 * 只靠 CSS 类（`.note-active { fill: var(--jp-danger) !important }`）在部署版里有失效风险
 * （样式表/主题变量未就绪、PWA 缓存与 bundle 版本不一致时，类加了也不变色——表现就是
 * "数字变红而增时线不变红"这类局部不变色）。直接写属性后，高亮与 CSS 层叠解耦；
 * 原始 fill 值暂存在 data-hl-fill，去掉高亮时精确还原（歌词等元素的 fill 与音符不同）。
 * 颜色取自品牌 tokens 的 ui.danger（与 CSS 的 --jp-danger 同值）。
 */
function applyNoteHighlight(el: Element, on: boolean): void {
  if (on) {
    if (!el.hasAttribute('data-hl-fill')) el.setAttribute('data-hl-fill', el.getAttribute('fill') ?? '')
    el.classList.add('note-active')
    el.setAttribute('fill', uiColors.danger)
    return
  }
  el.classList.remove('note-active')
  const orig = el.getAttribute('data-hl-fill')
  if (orig === null) return
  if (orig === '') el.removeAttribute('fill')
  else el.setAttribute('fill', orig)
  el.removeAttribute('data-hl-fill')
}

/**
 * 预览 SVG 基准显示宽度（与渲染容器一致）；实际显示宽度 = 基准宽 × zoom%（adj51）。
 * adj529：基准宽搬到 `preview/zoomFit.ts`（与"按宽度适配"的反算算式同处一地，单一来源）。
 */
const PREVIEW_W = PREVIEW_BASE_W

export function PreviewPane() {
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setPageConfig = useDocStore((s) => s.setPageConfig)
  const code = useDocStore((s) => s.code)
  const activeNoteId = useDocStore((s) => s.activeNoteId)
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const setNoteIndexToPage = useDocStore((s) => s.setNoteIndexToPage)
  // adj258：批量高亮播放中同时演奏的音符（多声部同步）
  const activeNoteIds = useDocStore((s) => s.activeNoteIds)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const showGuides = useUiStore((s) => s.showGuides)
  const previewZoom = useUiStore((s) => s.previewZoom)
  /**
   * adj723g：`dockOpen` / `dockPanel` 的订阅**已删除**——原先只服务于 `isPlaybackOpen`
   * （"试听开着时单击音符就重播"），而用户要求单击**只定位光标** ⇒ 该判据没有使用者了。
   * 少两个 store 订阅也顺带少两次无谓重渲染。
   */
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)
  const bumpPlaybackTick = useUiStore((s) => s.bumpPlaybackTick)
  // adj723d：`Ctrl+单击音符` 要**打开并聚焦试听**（`requestDockPanel` 在 ToolDock 里落地为
  // "打开并聚焦"；不能是"开关"，否则试听已开着时会被收起来）
  const requestDockPanel = useUiStore((s) => s.requestDockPanel)
  // adj354：@@ 显示默认音色名——无 Y 时用试听音色列表第一个启用音色（与播放端一致）
  const playbackHqEnabled = useUiStore((s) => s.playbackHqEnabled)
  const defaultInstrumentRef = useMemo(() => firstEnabledInstrumentRef(playbackHqEnabled), [playbackHqEnabled])

  const containerRef = useRef<HTMLDivElement>(null)
  const pageConfigRef = useRef(pageConfig)
  pageConfigRef.current = pageConfig

  const { layout, pagesHtml, summary } = useMemo(() => {
    const musicLines = parseResult.groups.length
    const notes = parseResult.groups.reduce((n, g) => n + g.music.tokens.length, 0)
    const sum = {
      title: parseResult.header.titles[0] ?? '未命名',
      authors: parseResult.header.authors.join('；'),
      key: parseResult.header.key,
      meter: parseResult.header.meter,
      // 多条 J（数字+文字）时显示合并标签 ♩=80 欢快地（与乐谱一致）
      tempo:
        parseResult.header.tempoNum || parseResult.header.tempoText
          ? tempoLabel(parseResult.header.tempoNum, parseResult.header.tempoText)
          : parseResult.header.tempo,
      musicLines,
      notes,
      errors: parseResult.errors.length,
    }
    // adj208：不因语法错误清空预览——layout/render 对错误输入安全（错误行已在
    // 解析阶段跳过：引号未闭合吞剩余内容、歌词缺曲行不挂载、未知符号降级为装饰），
    // 始终渲染可解析部分，避免预览在正常显示与错误提示之间闪动
    // adj199/adj629v/adj638/adj647：宿主实测的字体度量（布局侧 + 渲染侧一次量好，预览/导出/打印同一份）
    //  · 渲染侧：`1 = ` / ♯ 占宽 / ♯ 墨迹右缘（内联排版 + 右侧留白补偿 ⇒ 墨迹净距 0.2px，adj638）
    //            与 `1 ` / `♩` 宽（D 行与 J 行的 = 对齐，adj629v）
    //  · 布局侧：变音角标 #/b/♮ 的墨迹宽与左偏（adj647）——**必须在 layoutScore 之前**测好
    const cfg = pageConfig
    const fm = measureFontMeta(cfg)
    const lay = layoutScore(parseResult, pageConfig, defaultInstrumentRef, fm.layout)
    // adj199/adj629v/adj638/adj647：宿主实测的字体度量（渲染侧）——见 preview/fontMeta.ts
    return {
      layout: lay,
      pagesHtml: renderScoreToSvg(lay, fm.render),
      summary: sum,
    }
  }, [parseResult, pageConfig, defaultInstrumentRef])

  // adj291：布局后把「音符 index → 物理页」映射回填 store，供编辑器光标联动对齐音符 id.page（自动分页一致）
  useEffect(() => {
    if (layout) setNoteIndexToPage(buildIndexToPage(layout))
  }, [layout, setNoteIndexToPage])

  const rowTops = useMemo(() => (layout ? computeRowTops(layout, pageConfig.note_size) : []), [layout, pageConfig.note_size])
  const rowGuides = useMemo(
    () =>
      layout
        ? computeRowGuides(
            layout,
            { quci: pageConfig.height_quci, geci: pageConfig.geci_size },
            pageConfig.note_size,
          )
        : [],
    [layout, pageConfig.height_quci, pageConfig.geci_size, pageConfig.note_size],
  )


  // adj258：批量高亮播放中同时演奏的音符（多声部同步演奏——同一组多声部同 atMs 音符同时高亮）
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.querySelectorAll('.note-active').forEach((el) => applyNoteHighlight(el, false))
    if (!activeNoteIds || activeNoteIds.length === 0) return
    for (const id of activeNoteIds) {
      // adj374：一个音符可能有多个视觉元素共用同一 data-notepos（数字 + 各条增时线），需全部高亮
      const els = root.querySelectorAll(
        `[data-notepos="${CSS.escape(id)}"], [data-cipos="${CSS.escape(id)}"]`,
      )
      els.forEach((el) => applyNoteHighlight(el, true))
    }
  }, [activeNoteIds, pagesHtml])

  // 高亮当前音符（M3）
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.querySelectorAll('.note-active').forEach((el) => applyNoteHighlight(el, false))
    if (!activeNoteId) return
    const els = root.querySelectorAll(
      `[data-notepos="${CSS.escape(activeNoteId)}"], [data-cipos="${CSS.escape(activeNoteId)}"]`,
    )
    els.forEach((el) => applyNoteHighlight(el, true))
    const el = els[0]
    if (el) {
      // adj237/238：居中滚动但以页面区域为界——scrollIntoView 会把音符滚到视口中心，
      // 页面较小时视口中心落在页面外的预览空白上；改为手动滚动（垂直+水平）：
      //  - 页面 ≥ 视口：音符居中，滚动范围钳在页面内（页面始终铺满视口，不露空白）
      //  - 页面 < 视口：不为了居中而滚出页面——垂直页面顶对齐视口顶、
      //    水平页面居中排布不滚动（align-items:center）
      const scroller = root.parentElement // 滚动容器（.preview-pane）
      if (scroller) {
        const scRect = scroller.getBoundingClientRect()
        /**
         * adj723y（用户报「双击音符从当前音符播放又失效了」）：**音符已完整可见时不要滚动**。
         *
         * 原因：单击音符会触发本 effect 的"居中滚动"，把音符挪走（实测 `scrollLeft/Top`
         * `0 → 24`，音符屏幕坐标随之偏 24px）。而**双击的两次点击落在同一位置**是浏览器的
         * 判定条件，第二次点击因音符已移走而落到 `.preview-zoom-scale`（空处）
         * ⇒ **浏览器不派发 `dblclick`**（实测 `e.target = DIV.preview-zoom-scale`、
         * 音符祖先查不到即 `null`）⇒ 用户观感"双击播放失效"。
         *
         * 修法：**已完整可见 ⇒ 原地不动**（这才是"把目标音符带进视野"的本意；
         * 只有真的看不到时才需要滚）。既保住居中能力的初衷，又让双击的第二击仍落在音符上。
         */
        const elRect0 = el.getBoundingClientRect()
        if (isFullyVisibleIn(elRect0, scRect)) return
        // 垂直
        const viewH = scroller.clientHeight
        const noteY = el.getBoundingClientRect().top - scRect.top + scroller.scrollTop
        let targetY = noteY - viewH / 2
        // 水平（adj238：预览放大后页面宽于视口，点击两侧音符需水平滚动居中）
        const viewW = scroller.clientWidth
        const noteX = el.getBoundingClientRect().left - scRect.left + scroller.scrollLeft
        let targetX = noteX - viewW / 2
        const pageEl = el.closest('.score-page')
        if (pageEl) {
          // 水平边界用 preview-zoom-scale（实际放大内容区）——score-page 的
          // maxWidth:100% 会被视口裁剪，音符实际 x 位于 zoom-scale 内
          const boundsEl = pageEl.querySelector('.preview-zoom-scale') ?? pageEl
          const pageTop = pageEl.getBoundingClientRect().top - scRect.top + scroller.scrollTop
          const pageH = pageEl.getBoundingClientRect().height
          const bLeft = boundsEl.getBoundingClientRect().left - scRect.left + scroller.scrollLeft
          const bW = boundsEl.getBoundingClientRect().width
          if (pageH >= viewH) {
            targetY = Math.max(pageTop, Math.min(targetY, pageTop + pageH - viewH))
          } else {
            targetY = pageTop
          }
          if (bW >= viewW) {
            targetX = Math.max(bLeft, Math.min(targetX, bLeft + bW - viewW))
          } else {
            targetX = 0 // 内容窄于视口（居中排布），无需横向滚动
          }
        }
        const maxScrollY = scroller.scrollHeight - viewH
        scroller.scrollTop = Math.max(0, Math.min(targetY, maxScrollY))
        const maxScrollX = scroller.scrollWidth - viewW
        scroller.scrollLeft = Math.max(0, Math.min(targetX, maxScrollX))
      } else {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  }, [activeNoteId, pagesHtml])

  /**
   * adj723g（用户要求）：**"试听是否开着"不再参与预览区点击的判定**。
   *
   * 历史：`adj490` 引入 `isPlaybackOpen = dockOpen && dockPanel === 'tryout'`，
   * 用途是"试听开着时**单击**音符就从该处重播"；用户现在要求
   * 「点击**只保留**定位编辑器到该音符位置，播放只在**双击**时发生」⇒ 该判据已无使用者，删除。
   * （`adj490` 的另一半价值——"底栏试听页签也要算可达"——由双击/`Ctrl+单击` 的 `tryoutFromNote`
   *   全盘接管：它根本不再需要"是否已开"这个前提。）
   */

  /**
   * adj723e（用户要求）：**从这里试听**——抽成一个动作，供 `Ctrl+单击` 与（新增的）**双击**共用。
   *
   * 语义（与 `noteClickAction` 的 `ctrl-tryout` 一致）：
   *  · 把该音符设为试听起点；
   *  · **打开并聚焦**试听页签（`requestDockPanel` 在 `ToolDock` 里是"打开并聚焦"，
   *    已开着则**保持**，不会把底栏收起来）；
   *  · 递增 `playbackTick` 让 `PlaybackDialog` 从该音符播放
   *    （底栏**原本没开**时由对话框挂载后的"待播起点"逻辑接手，见 `adj723e`）。
   */
  const tryoutFromNote = (id: string) => {
    setActiveNoteId(id)
    setPlaybackStart(id)
    requestDockPanel('tryout')
    bumpPlaybackTick()
  }

  // 点击谱面音符/歌词 → 编辑器光标跳转（M3）
  // adj284：试听可达时单击音符 → 从该音符开始/重播（跳转到该处演奏）
  // adj652：点**谱面文本里的链接**（引擎把 URL 包成了 `a.jp-link`，如 S: 谱尾说明里的官网）
  //   → 用系统浏览器打开，不走"音符跳转"那条路。
  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as Element).closest('a.jp-link')
    if (link) {
      e.preventDefault()
      e.stopPropagation()
      void openExternalUrl(link.getAttribute('data-href') ?? link.getAttribute('href') ?? '')
      return
    }
    const target = (e.target as Element).closest('[data-notepos], [data-cipos]')
    if (!target) return
    const id = target.getAttribute('data-notepos') ?? target.getAttribute('data-cipos')
    if (!id) return
    /**
     * adj723（用户要求）：**`Ctrl + 鼠标左键` 点音符 ⇒ 立即打开试听对话框，并从该音符开始播放**。
     *
     * 与另外两条路的区别（判定收敛在纯模块 `noteClickAction.ts`，便于 smoke 断言）：
     *  · **单击**（`adj284`）= 光标跳转；试听**已经可达时**顺带从该音重播；
     *  · **双击**（`adj723e` 起）= **与 `Ctrl+单击` 完全相同**（用户要求）；
     *  · **`Ctrl+单击`（`adj723`）= 显式"从这里试听"**：不管试听是否开着都打开并从此处播放
     *    （**不跳光标**——用户按的是"听"不是"改"）。
     */
    const action = noteClickAction(noteClickKind(e))
    if (action.openTryout) {
      e.preventDefault()
      tryoutFromNote(id)
      return
    }
    setActiveNoteId(id)
    // adj634（用户要求）：光标落在**音符块末尾**（与后一块之间的空格之前），而不是块首——
    // 修饰符（& 编码、注释、倚音括号）都跟在主音符后面，落在块末就可以直接接着写。
    /**
     * adj723g（用户要求）：「试听对话框打开的情况下，**取消**"点击音符从该音符播放"的操作，
     * 只在**双击**时播放；点击**只保留**定位编辑器到该音符位置的操作」。
     *
     * 故这里**不再**有 `if (isPlaybackOpen) { setPlaybackStart(id); bumpPlaybackTick() }` 那段——
     * 单击一律只干两件事：把该音符设为高亮 + 光标跳到源码里该音符处。
     * 想"从这里听"请用**双击**或 **`Ctrl+单击`**（两者都走 `tryoutFromNote`）。
     */
    const pos = noteIdToCodePos(code, id, 'end')
    if (pos !== null && action.jumpCursor) jumpCursor(pos)
  }

  /**
   * adj723e（用户要求）：「**双击音符执行与 Ctrl+点击音符同样的操作**」——
   * 即"打开试听（有则保持）+ 从该音符播放 + 焦点落到播放按钮"。
   *
   * 与旧口径（`adj88`/`adj166`）的差别：旧口径**只在试听已经可达时**才动作，
   * 未打开试听时双击**不弹窗**（当年是为防误触）。现在用户明确要求双击等同于 `Ctrl+单击`，
   * 故去掉"必须已可达"这条前置。
   *
   * 注：一次双击必然先触发两轮 `click`（`noteClickAction` 的 `single` 分支：光标跳转），
   * 然后才是本回调——起点/`playbackTick` 因此会被置两次，但 `PlaybackDialog` 里的
   * **代次守卫**（`adj723d`）保证只有最后一次落地，不会同时跑两个播放进程。
   */
  const onDoubleClick = (e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-notepos]')
    if (!target) return
    const id = target.getAttribute('data-notepos')
    if (!id) return
    e.preventDefault()
    tryoutFromNote(id)
  }

  // ---- 描述头元素拖拽（adj9） ----
  const metaDragRef = useRef<{
    key: string
    startX: number
    startY: number
    baseX: number
    baseY: number
    /** adj454：按下时的生效配置快照——松手写回谱面时以它为基线，只固化本次拖拽的改动 */
    baseCfg: PageConfig
  } | null>(null)

  const onMetaPointerDown = (e: React.PointerEvent) => {
    const el = (e.target as Element).closest('[data-meta]')
    if (!el) return
    e.stopPropagation()
    const key = el.getAttribute('data-meta')!
    if (!layout) return
    // adj51：拖拽换算缩放需含预览 zoom（实际显示宽 = PREVIEW_W × zoom）
    const scale = (PREVIEW_W / layout.pages[0].width) * (previewZoom / 100)
    const cfg = pageConfigRef.current
    const pageW = layout.pages[0].width
    const base = cfg.metaPos?.[key]
    // 基准 = 相对各自锚点的偏移（adj16）；无 metaPos 时由元素绝对坐标减去锚点得出
    // notes_i（说明文字，谱尾，adj151 左对齐）：基准 = 左边距 + 默认 y（下边距线上方 24px 起逐行）
    let bx: number
    let by: number
    if (key.startsWith('notes')) {
      const lineIdx = Number(el.getAttribute('data-notes-line') ?? '0')
      // adj153：换行后的子行（data-notes-sub）基准 y 也要计入，避免把子行偏移混进 metaPos
      const subIdx = Number(el.getAttribute('data-notes-sub') ?? '0')
      /**
       * adj630b：说明的默认 y 改为**自下而上**（末行贴下边距线、往上逐行）⇒ 基准 y 由
       * 引擎的 `notesRowBaseline()` 给出（渲染端同一函数）。行序号/总行数由渲染端写在
       * `data-notes-row` / `data-notes-total` 上（跨 `S:` 段与换行子行连续编号）——
       * **不能**再用 `lineIdx + subIdx` 推（多段时它不是整块行号）。
       */
      const row = Number(el.getAttribute('data-notes-row') ?? String(lineIdx + subIdx))
      const totalRows = Number(el.getAttribute('data-notes-total') ?? '1')
      const baseY = notesRowBaseline({
        pageH: layout.pages[0].height,
        marginBottom: cfg.margin_bottom,
        nSize: cfg.notes_size ?? cfg.miaoshu_size,
        row,
        totalRows,
      })
      if (key === 'notes') {
        // 旧 metaPos["notes"]（adj83 语义）：基准 = 页面居中（兼容旧配置拖拽）
        const baseX = pageW / 2
        bx = base ? base.x : Number(el.getAttribute('x')) - baseX
        by = base ? base.y : Number(el.getAttribute('y')) - baseY
      } else {
        // 新 metaPos["notes_i"]（adj151）：基准 = 左边距（左对齐）
        const baseX = cfg.margin_left
        bx = base ? base.x : Number(el.getAttribute('x')) - baseX
        by = base ? base.y : Number(el.getAttribute('y')) - baseY
      }
    } else {
      const anchor = metaAnchorPt(metaAnchorOf(key), pageW, cfg)
      bx = base ? base.x : Number(el.getAttribute('x')) - anchor.x
      by = base ? base.y : Number(el.getAttribute('y')) - anchor.y
    }
    metaDragRef.current = { key, startX: e.clientX, startY: e.clientY, baseX: bx, baseY: by, baseCfg: { ...cfg } }
    // adj487：描述头拖拽改用 Pointer Events（此前只监听 mousemove/mouseup，手机上拖不动）
    beginDrag(e, {
      onMove: (dx, dy) => {
        const d = metaDragRef.current
        if (!d) return
        const next = { ...(pageConfigRef.current.metaPos ?? {}) }
        // 相对锚点保存（adj16），钳制在区域内
        const pos = clampMetaPos(
          d.key,
          d.baseX + dx / scale,
          d.baseY + dy / scale,
          pageW,
          pageConfigRef.current,
        )
        next[d.key] = {
          // adj413：描述头位置同样按整数 px 存（原为 0.1px 精度，与"px 一律整数"不符）
          x: Math.round(pos.x),
          y: Math.round(pos.y),
        }
        setPageConfig({ ...pageConfigRef.current, metaPos: next })
      },
      onEnd: () => {
        // adj454：先取出按下时的基线快照（下面会清空 ref），写回时只固化本次拖拽改动的字段
        const baseCfg = metaDragRef.current?.baseCfg
        metaDragRef.current = null
        // adj83：拖拽结束把 metaPos 持久化到源码 # jps-config（每首谱用自己的设置）
        if (pageConfigRef.current.metaPos) {
          setPageConfig(pageConfigRef.current, true, baseCfg)
        }
      },
    })
  }

  // ---- 辅助虚线拖拽（adj7/adj10） ----
  const [drag, setDrag] = useState<{
    spec: { key: string; dir: 'v' | 'h'; invert?: boolean }
    startX: number
    startY: number
    startVal: number
    /** adj454：按下时的生效配置快照——松手写回谱面时以它为基线，只固化本次拖拽的改动 */
    baseCfg: PageConfig
  } | null>(null)

  const startDrag = (
    spec: { key: string; dir: 'v' | 'h'; invert?: boolean },
    e: React.PointerEvent, // adj487：Pointer Events（鼠标 / 触屏 / 触控笔同一套）
    startVal: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ spec, startX: e.clientX, startY: e.clientY, startVal, baseCfg: { ...pageConfigRef.current } })
  }

  useEffect(() => {
    if (!drag || !layout) return
    // adj51：拖拽换算缩放需含预览 zoom
    const scale = (PREVIEW_W / layout.pages[0].width) * (previewZoom / 100)
    const limitsOf = (key: string): [number, number] =>
      (GUIDE_LIMITS as Record<string, [number, number]>)[key] ??
      (GUIDE_LIMITS_EX as Record<string, [number, number]>)[key] ??
      [0, 400]
    const onMove = (ev: PointerEvent) => {
      const delta = dragDelta(drag.spec, drag.startX, drag.startY, ev.clientX, ev.clientY, scale)
      const [min, max] = limitsOf(drag.spec.key)
      // adj413：位移是浮点（鼠标位移 ÷ 预览缩放），取整后再写入——px 一律整数（与设置界面一致）
      const val = Math.round(clamp(drag.startVal + delta, min, max))
      // adj432：段层间距写在 `PageConfig.segmentRowGap.{bz,dsb}` 子对象里（不是顶层字段）
      // adj629：加 `tp`（替谱段与所属歌词行的间距）——三者同为子对象里的键
      if (drag.spec.key.startsWith('segmentRowGap_')) {
        const which = drag.spec.key.slice('segmentRowGap_'.length) as 'bz' | 'dsb' | 'tp'
        const cur = pageConfigRef.current.segmentRowGap ?? {}
        setPageConfig({ ...pageConfigRef.current, segmentRowGap: { ...cur, [which]: val } })
        return
      }
      const next = { ...pageConfigRef.current, [drag.spec.key]: val }
      setPageConfig(next)
    }
    const onUp = () => {
      setDrag(null)
      // adj83：拖拽结束把调整后的设置持久化到源码 # jps-config
      // adj454：以按下时的快照为基线（drag.baseCfg）——只固化本次拖拽改动的字段
      setPageConfig(pageConfigRef.current, true, drag.baseCfg)
    }
    // adj487：改 Pointer Events（触屏可拖）；pointercancel 处理"来电话 / 手势打断"
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [drag, layout, setPageConfig, previewZoom])

  if (!layout || pagesHtml.length === 0) {
    return (
      <div className="preview-pane">
        <div className="preview-placeholder">
          <div className="ph-icon">🎼</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--jp-text-primary)' }}>
            {summary.title}
          </div>
          {summary.authors && (
            <div style={{ color: 'var(--jp-text-secondary)' }}>{summary.authors}</div>
          )}
          <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>
            调式 {summary.key ?? '—'} · 拍号 {summary.meter ?? '—'} · 节拍 {summary.tempo ?? '—'}
          </div>
          <div
            style={{
              marginTop: 8,
              padding: '10px 18px',
              border: '1px solid var(--jp-border)',
              borderRadius: 8,
              background: 'var(--jp-bg-panel)',
              color: 'var(--jp-text-secondary)',
              fontSize: 13,
              lineHeight: 1.9,
            }}
          >
            {/* adj208：预览不再提示语法错误（避免正常预览与错误提示闪动）——
                错误行已在解析阶段跳过，预览始终渲染可解析部分 */}
            <>解析完成：{summary.musicLines} 个曲行 · {summary.notes} 个乐符 · {summary.errors} 个问题</>
          </div>
          <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 10 }}>
            {brand.taglineMain}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-pane">
      <div className="pages" ref={containerRef} onClick={onClick} onDoubleClick={onDoubleClick} onPointerDown={onMetaPointerDown}>
        {pagesHtml.map((svg, i) => {
          const page = layout.pages[i]
          const pct = (v: number) => `${((v / page.width) * 100).toFixed(2)}%`
          const pctY = (v: number) => `${((v / page.height) * 100).toFixed(2)}%`
          const rowTopsOfPage = rowTops[i] ?? []
          const rowGuidesOfPage = rowGuides[i] ?? []
          void rowTopsOfPage
          return (
            // adj286：去掉 maxWidth:100%——放大后该限制把 score-page 白底裁到视口宽，
            // 页面右侧区域露出容器深色背景（变黑）；宽度跟随 preview-zoom-scale 内容
            <div key={i} className="score-page" style={{ position: 'relative' }}>
              <div
                className="preview-zoom-scale"
                style={{
                  /**
                   * adj529（用户报"预览区越窄，按页宽算出的比率差异越大／缩得更小"）：
                   * **这里不能再把 width 乘一次 zoom**。CSS `zoom` 会把**本元素自己声明的 width 也乘一遍**
                   * （见 MDN `zoom` 的示例：`width:25px` + `zoom:200%` ⇒ 实际 50px），
                   * 所以"`width: 760×z` + `zoom: z`"的实际渲染宽是 **760×z²（平方关系）**：
                   *   · 可用宽 952px → z=125% → 实际 1187px（偏宽）；
                   *   · 可用宽 552px → z=73%  → 实际 **405px**，只有容器的 73% ⇒ 越窄越"缩得更小"；
                   * 而拖拽换算 `scale = (PREVIEW_W / page.width) × z%`（见下方两处）用的正是**线性**模型
                   * ⇒ 作者本意就是线性，`width` 上那次乘法是多余的。
                   * 现在只声明 `width: PREVIEW_BASE_W`（基准宽），由 `zoom` 负责缩放：
                   * 实际显示宽 = `760 × z%`（线性），"按宽度适配"的反算（`preview/zoomFit.ts`）因此精确。
                   * `zoom` 必须保留：虚线线宽、播放头等**用 px 定位的子元素**要靠它一起缩放
                   * （它们的位置已经是百分比，只有粗细/偏移是 px）。
                   */
                  width: PREVIEW_W,
                  position: 'relative',
                  zoom: previewZoom / 100,
                }}
              >
                {/* adj226：SVG 层提到虚线层之上且默认不拦截命中——音符/歌词/描述头
                    （data-notepos/cipos/meta）各自 pointer-events: all 可点，
                    虚线的拖拽在音符外区域仍可用；此前 SVG 在虚线之下，
                    音符数字中心与行虚线重叠处点击被虚线拦截（拖拽而非联动）
                    adj244：SVG 自带页面白底 rect 会盖住虚线层，预览层将其透明化，
                    白底由 .score-page 提供——音符仍可点，虚线透过透明 SVG 可见 */}
                <div
                  className="preview-svg"
                  dangerouslySetInnerHTML={{ __html: svg }}
                  style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}
                />
                {/* adj282：播放进度跟随色块（接近透明，随播放时钟滑动；未播放时自身不渲染） */}
                <PlayheadLayer page={page} noteSize={pageConfig.note_size} />
                {/* adj723b：**只读自检**（见 `PlayheadDiag` 说明；不参与渲染） */}
                <PlayheadDiag pageIndex={page.index} noteSize={pageConfig.note_size} />
                {showGuides && (
                  <div
                    className="guide-layer"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      pointerEvents: 'none',
                      // adj226：isolation 封住内部 guide-line 的 z-index（否则 z-index:5
                      // 的虚线会越过 z-index:1 的 SVG 层拦截音符点击）
                      isolation: 'isolate',
                    }}
                  >
                    {/* 四边距 */}
                    <div
                      className="guide-line guide-h"
                      style={{ top: pctY(pageConfig.margin_top), left: 0, right: 0, cursor: 'ns-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => startDrag({ key: 'margin_top', dir: 'v' }, e, pageConfig.margin_top)}
                      title="上边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-h"
                      style={{ top: pctY(page.height - pageConfig.margin_bottom), left: 0, right: 0, cursor: 'ns-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => startDrag({ key: 'margin_bottom', dir: 'v', invert: true }, e, pageConfig.margin_bottom)}
                      title="下边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-v"
                      style={{ left: pct(pageConfig.margin_left), top: 0, bottom: 0, cursor: 'ew-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => startDrag({ key: 'margin_left', dir: 'h' }, e, pageConfig.margin_left)}
                      title="左边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-v"
                      style={{ left: pct(page.width - pageConfig.margin_right), top: 0, bottom: 0, cursor: 'ew-resize', pointerEvents: 'auto' }}
                      onPointerDown={(e) => startDrag({ key: 'margin_right', dir: 'h', invert: true }, e, pageConfig.margin_right)}
                      title="右边距（拖动调整）"
                    />
                    {/* 描述头区域下端线（adj30：调整描述头内容区高度，与第一行曲部上端线区分） */}
                    <div
                      className="guide-line guide-h guide-desc"
                      style={{
                        top: pctY(metaAreaH(pageConfig) - pageConfig.body_margin_top),
                        left: pct(pageConfig.margin_left),
                        right: pct(pageConfig.margin_right),
                        cursor: 'ns-resize',
                        pointerEvents: 'auto',
                      }}
                      onPointerDown={(e) => startDrag({ key: 'descAreaH', dir: 'v' }, e, pageConfig.descAreaH)}
                      title="描述头高度（拖动调整）"
                    />
                    {/* adj304：描述头区域水平中线——浅灰竖向虚线（纯标注，居中参考，不可拖拽） */}
                    <div
                      className="guide-line guide-v guide-desc-mid"
                      style={{
                        left: pct((pageConfig.margin_left + (page.width - pageConfig.margin_right)) / 2),
                        top: pctY(pageConfig.margin_top),
                        bottom: pctY(page.height - (metaAreaH(pageConfig) - pageConfig.body_margin_top)),
                      }}
                      title="描述头区域中线（标注）"
                    />
                    {/* 行结构虚线：曲部行虚线（数字中心）/ 曲词间距 / 词曲间距 / 词部行虚线 */}
                    {rowGuidesOfPage.map((rg, ri) => (
                      <div key={ri} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                        {/* 曲部行虚线（adj72：数字中心为基准；多声部块内第 2+ 声部拖 height_shengbu 独立调声部间距）
                            adj79：行尾间距拆分——上一行有歌词（底部是词部）→ 曲部与上一行词部间距 height_ciqu_lyric；
                            上一行无歌词（底部是曲部）→ 曲部与曲部间距 height_ciqu
                            adj432：临时叠加段（{bz}/{dsb}）的段层行**换色 + 拖 segmentRowGap**——
                            段层是叠加层，拖它调的是"段层与主旋律的间距"，不是谱面行距（混用会破坏排版） */}
                        {(() => {
                          const isSeg = rg.segType !== undefined
                          const isUpper = rg.segLayer === 'upper'
                          // 段层：拖 segmentRowGap.{bz,dsb,tp}；bz 只有上层，dsb 有上下层（拖离中线 = 增大间距）
                          // adj629：tp（替谱段）画在所属歌词行上方，拖它调"与那条歌词行的间距"
                          const key = isSeg
                            ? rg.segType === 'bz'
                              ? 'segmentRowGap_bz'
                              : rg.segType === 'tp'
                                ? 'segmentRowGap_tp'
                                : 'segmentRowGap_dsb'
                            : ri === 0
                              ? 'body_margin_top'
                              : rg.voiceIdx > 0
                                ? 'height_shengbu'
                                : (rowGuidesOfPage[ri - 1]?.lyricRows.length ?? 0) > 0
                                  ? 'height_ciqu_lyric'
                                  : 'height_ciqu'
                          // 段层上层往上拖 = 增大间距（invert）；dsb 下层往下拖 = 增大间距（不 invert）
                          // adj629e：替谱层挂在其下方歌词行之上，`tp` 越大层越高 ⇒ 往上拖增大（同 isUpper）
                          const invert = isSeg && isUpper
                          const startVal = isSeg
                            ? rg.segType === 'bz'
                              ? (pageConfig.segmentRowGap?.bz ?? SEGMENT_ROW_GAP_DEFAULT.bz)
                              : rg.segType === 'tp'
                                ? (pageConfig.segmentRowGap?.tp ?? SEGMENT_ROW_GAP_DEFAULT.tp)
                                : (pageConfig.segmentRowGap?.dsb ?? SEGMENT_ROW_GAP_DEFAULT.dsb)
                            : ri === 0
                              ? pageConfig.body_margin_top
                              : rg.voiceIdx > 0
                                ? pageConfig.height_shengbu
                                : (rowGuidesOfPage[ri - 1]?.lyricRows.length ?? 0) > 0
                                  ? pageConfig.height_ciqu_lyric
                                  : pageConfig.height_ciqu
                          return (
                            <div
                              className={`guide-line guide-h guide-row${isSeg ? ' guide-seg' : ''}`}
                              style={{
                                top: pctY(rg.yCenter),
                                left: pct(pageConfig.margin_left),
                                right: pct(pageConfig.margin_right),
                                cursor: 'ns-resize',
                                pointerEvents: 'auto',
                              }}
                              onPointerDown={(e) => startDrag({ key, dir: 'v', invert }, e, startVal)}
                              title={
                                isSeg
                                  ? rg.segType === 'tp'
                                    ? '替谱段（第 k 段歌词 = 第 k 遍）与所属歌词行的间距（拖动调整）'
                                    : `${rg.segType === 'bz' ? '临时伴奏' : '临时多声部'}${isUpper ? '上层' : '下层'}间距（拖动调整）`
                                  : ri === 0
                                    ? '曲部上间距（与描述头间距，拖动调整）'
                                    : rg.voiceIdx > 0
                                      ? '声部行间距（拖动调整）'
                                      : (rowGuidesOfPage[ri - 1]?.lyricRows.length ?? 0) > 0
                                        ? '曲部与上一行词部间距（拖动调整）'
                                        : '曲部与曲部间距（拖动调整）'
                              }
                            />
                          )
                        })()}
                        {/* 词部行虚线（adj72/73：每行歌词一条，歌词行区域中心；第 1 行拖曲词距、后续行拖歌词行距；quci/cici 独立线已移除） */}
                        {rg.lyricRows.map((lr, k) => (
                          <div
                            key={`lc${k}`}
                            className="guide-line guide-h guide-lyric-row"
                            style={{
                              top: pctY(lr.center),
                              left: pct(pageConfig.margin_left),
                              right: pct(pageConfig.margin_right),
                              cursor: 'ns-resize',
                              pointerEvents: 'auto',
                            }}
                            onPointerDown={(e) =>
                              startDrag(
                                // adj629g：按键**歌词行序号**选目标：第 1 行 = 歌词区↔曲部（quci），
                                // 第 2 行及以后 = 歌词行之间（cici）。不能按"在本行里的序号"判——
                                // 替谱层插进来后，第 2 行歌词会被归到替谱那一行、序号又变 0（用户报）。
                                { key: (lr.line ?? k) === 0 ? 'height_quci' : 'height_cici', dir: 'v' },
                                e,
                                (lr.line ?? k) === 0 ? pageConfig.height_quci : pageConfig.height_cici,
                              )
                            }
                            title={
                              (lr.line ?? k) === 0
                                ? '歌词行 1（与曲部间距，拖动调整）'
                                : `歌词行 ${(lr.line ?? k) + 1} 间距（与上一行歌词，拖动调整）`
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/**
 * adj427：把播放轨道按「**页 + 曲行 + 声部 + 音色**」分组，供每组建一个色块。
 *
 * 为什么必须按这个键分组：重叠区（bz 伴奏 / dsb 第二声部）与主旋律在**同一曲行（group）**内
 * **同时发声**——旧实现「每个 group 只取一个当前段」，于是重叠区**只画出一个色块**。
 * （既有 Q1/Q2 多声部之所以能显示多块，是因为它们是**不同的 group**。）
 * 按 (页, 曲行, 声部, 音色) 分组后，重叠区上下两层各有自己的色块、同步移动，
 * 与多声部的表现一致。
 *
 * 结果按 track 引用缓存（track 每次开播才换新对象），避免逐帧重建分组。
 */



/**
 * adj723b：色块链路的**只读自检**。
 *
 * 背景：用户报「播放时 `{dsb}` 那两行没有任何色块」，但引擎侧审计（`_r1` 临时脚本，用其原谱逐字）
 * 显示"**可发声事件 0 个缺色块、全曲 69 个采样点 0 次无块**"——即问题只在"引擎 → 屏幕"这一段，
 * 而远程无法看到用户浏览器里的真实状态。这里把**链路上每一步的实况**挂到 `window.__ijipuPlayhead()`，
 * 用户在控制台一句话就能取回：数据到了吗 / 定位算出来了吗 / DOM 里画出来了吗 / 画在哪。
 *
 * 为什么不在 `PlayheadLayer` 里做：那一层在"未播放"时会 `return null`（不渲染），
 * 挂不上任何东西；本组件**恒渲染**（`null` 输出），因此任何时刻都能被调用。
 *
 * 生产构建同样保留（只读、无副作用、仅一个函数引用），因为下次再出这类"只有用户环境复现"
 * 的问题时它是唯一能取证的手段；体积代价是一个闭包。
 */
function PlayheadDiag({ pageIndex, noteSize }: { pageIndex: number; noteSize: number }) {
  const currentMs = useDocStore((s) => s.currentMs)
  const track = useDocStore((s) => s.playheadTrack)
  useEffect(() => {
    const dump = (): string => {
      const groups = trackKeysOf(track)
      const mine = [...groups].filter(([k]) => k.startsWith(`${pageIndex}|`))
      const lines: string[] = [
        `track=${track.length} 段  currentMs=${currentMs.toFixed(1)}`,
        `本页组数=${mine.length}（全部 ${groups.size}）  noteSize=${noteSize}`,
      ]
      for (const [k, segs] of mine) {
        const pos = playheadPosIn(segs, currentMs, pageIndex, noteSize)
        lines.push(
          `  ${k}  段=${segs.length}  ${pos ? `★可见 x=${pos.x.toFixed(1)} y=[${pos.yTop.toFixed(1)}, ${pos.yBottom.toFixed(1)}] w=${pos.width.toFixed(1)}` : '（当前不可见）'}`,
        )
      }
      const dom = document.querySelectorAll('.playhead-marker')
      lines.push(`DOM 里 .playhead-marker = ${dom.length} 个`)
      dom.forEach((el, i) => {
        const st = (el as HTMLElement).style
        lines.push(
          `  #${i} left=${st.left} top=${st.top} w=${st.width} h=${st.height} bg=${st.background} box=${st.boxShadow}`,
        )
      })
      lines.push(`轨道前 3 项：${track.slice(0, 3).map((t) => `${t.group}/${t.instrument ?? ''}/${t.playVoice ?? ''}@${t.atMs.toFixed(0)}ms yTopMin=${t.yTopMin ?? '-'}`).join(' | ')}`)
      return lines.join('\n')
    }
    ;(window as unknown as { __ijipuPlayhead?: () => string }).__ijipuPlayhead = dump
  }, [track, currentMs, pageIndex, noteSize])
  return null
}

/**
 * adj282：跟随色块渲染层——仅订阅 currentMs/playheadTrack，避免 PreviewPane 主组件
 * 随播放逐帧重渲染（SVG 层不重建，仅本轻量色块刷新）。
 * adj299：每曲行（group）独立一个色块（按各自拍段滑动、按 voice 配色、各自行高）。
 */
function PlayheadLayer({ page, noteSize }: { page: ScorePage; noteSize: number }) {
  const currentMs = useDocStore((s) => s.currentMs)
  const track = useDocStore((s) => s.playheadTrack)
  if (track.length === 0 || currentMs <= 0) return null
  // adj427：按「本页 + 曲行 + 声部 + 音色」**逐组**定位——重叠区（bz 伴奏 / dsb 第二声部）
  // 与主旋律**同曲行同时发声**，故各有自己的色块、同步移动（与多声部同理）；
  // 旧实现「每个 group 只取一个当前段」在重叠区只画得出一块。
  const items = [...trackKeysOf(track)].filter(([k]) => k.startsWith(`${page.index}|`))
  const colorMap = instrumentColorMap(track)
  const pct = (v: number) => `${((v / page.width) * 100).toFixed(3)}%`
  const pctY = (v: number) => `${((v / page.height) * 100).toFixed(3)}%`
  return (
    <>
      {items.map(([key, segs]) => {
        const pos = playheadPosIn(segs, currentMs, page.index, noteSize)
        if (!pos) return null
        // adj427：按**音色**取色（不同音色不同颜色；同一音色恒定同色）
        const base = playheadBaseOf(pos, colorMap)
        return (
          <div
            key={key}
            className="playhead-marker"
            style={{
              left: pct(pos.x),
              top: pctY(pos.yTop),
              width: pct(pos.width),
              height: pctY(pos.yBottom - pos.yTop),
              background: `${base} 0.32)`,
              boxShadow: `inset 0 0 0 1px ${base} 0.5)`,
            }}
          />
        )
      })}
    </>
  )
}
