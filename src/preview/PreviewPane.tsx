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
import { tempoLabel } from '@ijipu/engine/parser/parser'
import { layoutScore, renderScoreToSvg, noteIdToCodePos, buildIndexToPage } from '@ijipu/engine'
import type { ScorePage } from '@ijipu/engine'
import { computeRowTops, computeRowGuides, dragDelta, clamp, metaAreaH, GUIDE_LIMITS, GUIDE_LIMITS_EX } from '@ijipu/engine/layout/guides'
import { clampMetaPos, metaAnchorOf, metaAnchorPt } from '@ijipu/engine/layout/metaAnchors'
import { brand } from '../brand/tokens'

/** adj199：用 canvas.measureText 实测指定字体/字号下文本宽度（按字体实际宽度摆放角标，消除中英文宽度差异） */
function measureFont(text: string, fontSize: number, fontFamily: string): number | undefined {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return undefined
    ctx.font = `${fontSize}px ${fontFamily}`
    return ctx.measureText(text).width
  } catch {
    return undefined
  }
}

/** 预览 SVG 基准显示宽度（与渲染容器一致）；实际显示宽度 = PREVIEW_W × zoom（adj51） */
const PREVIEW_W = 760

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
  const modal = useUiStore((s) => s.modal)
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)
  const bumpPlaybackTick = useUiStore((s) => s.bumpPlaybackTick)

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
    const lay = layoutScore(parseResult, pageConfig)
    // adj199：按字体实际宽度摆放角标——实测 "1 = " 与 ♯ 宽传入渲染，消除中英文字体 ♯ 宽度差异
    const cfg = lay.config
    const w1eq = measureFont('1 = ', cfg.miaoshu_size, cfg.miaoshu_font)
    const wAcc = measureFont('♯', cfg.miaoshu_size * (3 / 4), cfg.miaoshu_font)
    return { layout: lay, pagesHtml: renderScoreToSvg(lay, { w1eq, wAcc }), summary: sum }
  }, [parseResult, pageConfig])

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
    root.querySelectorAll('.note-active').forEach((el) => el.classList.remove('note-active'))
    if (!activeNoteIds || activeNoteIds.length === 0) return
    for (const id of activeNoteIds) {
      const el = root.querySelector(
        `[data-notepos="${CSS.escape(id)}"], [data-cipos="${CSS.escape(id)}"]`,
      )
      if (el) el.classList.add('note-active')
    }
  }, [activeNoteIds, pagesHtml])

  // 高亮当前音符（M3）
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.querySelectorAll('.note-active').forEach((el) => el.classList.remove('note-active'))
    if (!activeNoteId) return
    const el = root.querySelector(
      `[data-notepos="${CSS.escape(activeNoteId)}"], [data-cipos="${CSS.escape(activeNoteId)}"]`,
    )
    if (el) {
      el.classList.add('note-active')
      // adj237/238：居中滚动但以页面区域为界——scrollIntoView 会把音符滚到视口中心，
      // 页面较小时视口中心落在页面外的预览空白上；改为手动滚动（垂直+水平）：
      //  - 页面 ≥ 视口：音符居中，滚动范围钳在页面内（页面始终铺满视口，不露空白）
      //  - 页面 < 视口：不为了居中而滚出页面——垂直页面顶对齐视口顶、
      //    水平页面居中排布不滚动（align-items:center）
      const scroller = root.parentElement // 滚动容器（.preview-pane）
      if (scroller) {
        const scRect = scroller.getBoundingClientRect()
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

  // 点击谱面音符/歌词 → 编辑器光标跳转（M3）
  // adj284：试听对话框打开时（遮罩已穿透），单击音符 → 从该音符开始/重播（跳转到该处演奏）
  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-notepos], [data-cipos]')
    if (!target) return
    const id = target.getAttribute('data-notepos') ?? target.getAttribute('data-cipos')
    if (!id) return
    setActiveNoteId(id)
    const pos = noteIdToCodePos(code, id)
    if (pos !== null) jumpCursor(pos)
    if (modal === 'playback') {
      setPlaybackStart(id)
      bumpPlaybackTick()
    }
  }

  // adj88：双击谱面音符 → 定位试听起点并打开试听对话框（从该音符开始播放）
  // adj158：播放中双击 → 递增 playbackTick 让对话框从该音符重新播放（快速跳跃）
  // adj166：仅在试听对话框**已打开**时，双击音符才跳到该处开始播放；
  // 未打开试听时双击不弹窗（避免误触，改用菜单/快捷键打开试听）
  // adj284：试听对话框打开时单击已触发跳转播放，双击不再重复触发
  const onDoubleClick = (e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-notepos]')
    if (!target) return
    const id = target.getAttribute('data-notepos')
    if (!id) return
    setActiveNoteId(id)
    if (modal !== 'playback') return
  }

  // ---- 描述头元素拖拽（adj9） ----
  const metaDragRef = useRef<{
    key: string
    startX: number
    startY: number
    baseX: number
    baseY: number
  } | null>(null)

  const onMetaMouseDown = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-meta]')
    if (!el) return
    e.preventDefault()
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
      const baseY = layout.pages[0].height - cfg.margin_bottom - 24 + (lineIdx + subIdx) * (cfg.notes_size ?? cfg.miaoshu_size) * 1.4
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
    metaDragRef.current = { key, startX: e.clientX, startY: e.clientY, baseX: bx, baseY: by }
    const onMove = (ev: MouseEvent) => {
      const d = metaDragRef.current
      if (!d) return
      const next = { ...(pageConfigRef.current.metaPos ?? {}) }
      // 相对锚点保存（adj16），钳制在区域内
      const pos = clampMetaPos(
        d.key,
        d.baseX + (ev.clientX - d.startX) / scale,
        d.baseY + (ev.clientY - d.startY) / scale,
        pageW,
        pageConfigRef.current,
      )
      next[d.key] = {
        x: Math.round(pos.x * 10) / 10,
        y: Math.round(pos.y * 10) / 10,
      }
      setPageConfig({ ...pageConfigRef.current, metaPos: next })
    }
    const onUp = () => {
      metaDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // adj83：拖拽结束把 metaPos 持久化到源码 # jps-config（每首谱用自己的设置）
      if (pageConfigRef.current.metaPos) {
        setPageConfig(pageConfigRef.current, true)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ---- 辅助虚线拖拽（adj7/adj10） ----
  const [drag, setDrag] = useState<{
    spec: { key: string; dir: 'v' | 'h'; invert?: boolean }
    startX: number
    startY: number
    startVal: number
  } | null>(null)

  const startDrag = (
    spec: { key: string; dir: 'v' | 'h'; invert?: boolean },
    e: React.MouseEvent,
    startVal: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ spec, startX: e.clientX, startY: e.clientY, startVal })
  }

  useEffect(() => {
    if (!drag || !layout) return
    // adj51：拖拽换算缩放需含预览 zoom
    const scale = (PREVIEW_W / layout.pages[0].width) * (previewZoom / 100)
    const limitsOf = (key: string): [number, number] =>
      (GUIDE_LIMITS as Record<string, [number, number]>)[key] ??
      (GUIDE_LIMITS_EX as Record<string, [number, number]>)[key] ??
      [0, 400]
    const onMove = (ev: MouseEvent) => {
      const delta = dragDelta(drag.spec, drag.startX, drag.startY, ev.clientX, ev.clientY, scale)
      const [min, max] = limitsOf(drag.spec.key)
      const next = { ...pageConfigRef.current, [drag.spec.key]: clamp(drag.startVal + delta, min, max) }
      setPageConfig(next)
    }
    const onUp = () => {
      setDrag(null)
      // adj83：拖拽结束把调整后的设置持久化到源码 # jps-config
      setPageConfig(pageConfigRef.current, true)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
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
      <div className="pages" ref={containerRef} onClick={onClick} onDoubleClick={onDoubleClick} onMouseDown={onMetaMouseDown}>
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
                  width: PREVIEW_W * (previewZoom / 100),
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
                      onMouseDown={(e) => startDrag({ key: 'margin_top', dir: 'v' }, e, pageConfig.margin_top)}
                      title="上边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-h"
                      style={{ top: pctY(page.height - pageConfig.margin_bottom), left: 0, right: 0, cursor: 'ns-resize', pointerEvents: 'auto' }}
                      onMouseDown={(e) => startDrag({ key: 'margin_bottom', dir: 'v', invert: true }, e, pageConfig.margin_bottom)}
                      title="下边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-v"
                      style={{ left: pct(pageConfig.margin_left), top: 0, bottom: 0, cursor: 'ew-resize', pointerEvents: 'auto' }}
                      onMouseDown={(e) => startDrag({ key: 'margin_left', dir: 'h' }, e, pageConfig.margin_left)}
                      title="左边距（拖动调整）"
                    />
                    <div
                      className="guide-line guide-v"
                      style={{ left: pct(page.width - pageConfig.margin_right), top: 0, bottom: 0, cursor: 'ew-resize', pointerEvents: 'auto' }}
                      onMouseDown={(e) => startDrag({ key: 'margin_right', dir: 'h', invert: true }, e, pageConfig.margin_right)}
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
                      onMouseDown={(e) => startDrag({ key: 'descAreaH', dir: 'v' }, e, pageConfig.descAreaH)}
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
                            上一行无歌词（底部是曲部）→ 曲部与曲部间距 height_ciqu */}
                        <div
                          className="guide-line guide-h guide-row"
                          style={{
                            top: pctY(rg.yCenter),
                            left: pct(pageConfig.margin_left),
                            right: pct(pageConfig.margin_right),
                            cursor: 'ns-resize',
                            pointerEvents: 'auto',
                          }}
                          onMouseDown={(e) => {
                            const prevHasLyric = ri > 0 ? (rowGuidesOfPage[ri - 1]?.lyricRows.length ?? 0) > 0 : false
                            const key =
                              ri === 0
                                ? 'body_margin_top'
                                : rg.voiceIdx > 0
                                  ? 'height_shengbu'
                                  : prevHasLyric
                                    ? 'height_ciqu_lyric'
                                    : 'height_ciqu'
                            startDrag(
                              { key, dir: 'v' },
                              e,
                              ri === 0
                                ? pageConfig.body_margin_top
                                : rg.voiceIdx > 0
                                  ? pageConfig.height_shengbu
                                  : prevHasLyric
                                    ? pageConfig.height_ciqu_lyric
                                    : pageConfig.height_ciqu,
                            )
                          }}
                          title={
                            ri === 0
                              ? '曲部上间距（与描述头间距，拖动调整）'
                              : rg.voiceIdx > 0
                                ? '声部行间距（拖动调整）'
                                : (rowGuidesOfPage[ri - 1]?.lyricRows.length ?? 0) > 0
                                  ? '曲部与上一行词部间距（拖动调整）'
                                  : '曲部与曲部间距（拖动调整）'
                          }
                        />
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
                            onMouseDown={(e) =>
                              startDrag(
                                { key: k === 0 ? 'height_quci' : 'height_cici', dir: 'v' },
                                e,
                                k === 0 ? pageConfig.height_quci : pageConfig.height_cici,
                              )
                            }
                            title={
                              k === 0
                                ? '歌词行 1（与曲部间距，拖动调整）'
                                : `歌词行 ${k + 1} 间距（与上一行歌词，拖动调整）`
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
 * adj282：计算播放进度跟随色块位置——同页内按曲行（group）定位，每 group 独立色块。
 * adj299：按「拍段」定位（每段 ≤1 拍）；用 group（而非 voice）定位——多声部 Q1 与单声部行
 * 可共用 voice 号（如 Q1 与 Q 均 voice=1），必须用 group 区分；色块高度 = 该曲行
 * （音符基线推：行顶 基线-1.1×音符高、行底 基线+0.6×音符高，各加延伸 0.5×音符高）。
 * 返回 null = 未播放/不在本页/已播完。
 */
function playheadPosOf(
  track: { atMs: number; durationMs: number; pageIndex: number; x: number; y: number; width: number; voice: number; group: number }[],
  currentMs: number,
  page: ScorePage,
  noteSize: number,
  group: number,
): { x: number; yTop: number; yBottom: number; width: number; voice: number } | null {
  if (track.length === 0 || currentMs <= 0) return null
  // 该曲行的段（atMs 单调）
  const segs = track.filter((t) => t.group === group)
  if (segs.length === 0) return null
  // 二分：最后一个 atMs <= currentMs 的段
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].atMs <= currentMs) lo = mid + 1
    else hi = mid
  }
  const i = lo - 1
  if (i < 0 || i >= segs.length) return null
  const a = segs[i]
  // adj313：色块只在该拍段「正在发声」期间显示。旧逻辑仅在「本曲行最后一段」
  // 结束时才隐藏（i === 最后段），遇到反复/跳房子跳跃产生的段间空隙（当前段已结束、
  // 下一段还未开始）时，会把旧行色块冻结驻留在原处——用户观感即「色块已走到新行，
  // 上一行色块还残留在行末」。改为：只要当前段已结束（该处已无声）就隐藏，
  // 各曲行按各自发声时间出现/消失，旧行不再残留。
  if (currentMs >= a.atMs + a.durationMs) return null
  if (a.pageIndex !== page.index) return null
  // 停驻当前段 x（段间由 CSS transition 平滑过渡）
  const x = a.x
  // 高度 = 该曲行（音符基线推，天然区分各声部行/单声部行，不依赖 voiceBlock）
  const ext = noteSize * 0.5
  const yTop = a.y - noteSize * 1.1 - ext
  const yBottom = a.y - noteSize * 1.1 + noteSize * 1.7 + ext
  return { x, yTop, yBottom, width: a.width, voice: a.voice }
}

/** adj299：多声部各声部色块颜色（半透明；voice 1 保持红色——延续 adj285 单声部红块） */
const PLAYHEAD_COLORS = [
  'rgba(255, 93, 108,', // 红（声部 1）
  'rgba(87, 170, 255,', // 蓝（声部 2）
  'rgba(63, 122, 46,', // 绿（声部 3）
  'rgba(255, 200, 87,', // 橙（声部 4）
  'rgba(138, 95, 184,', // 紫（声部 5）
]

/**
 * adj282：跟随色块渲染层——仅订阅 currentMs/playheadTrack，避免 PreviewPane 主组件
 * 随播放逐帧重渲染（SVG 层不重建，仅本轻量色块刷新）。
 * adj299：每曲行（group）独立一个色块（按各自拍段滑动、按 voice 配色、各自行高）。
 */
function PlayheadLayer({ page, noteSize }: { page: ScorePage; noteSize: number }) {
  const currentMs = useDocStore((s) => s.currentMs)
  const track = useDocStore((s) => s.playheadTrack)
  if (track.length === 0 || currentMs <= 0) return null
  // 该页涉及的曲行（group 去重排序）
  const groups = [
    ...new Set(track.filter((t) => t.pageIndex === page.index).map((t) => t.group)),
  ].sort((a, b) => a - b)
  const pct = (v: number) => `${((v / page.width) * 100).toFixed(3)}%`
  const pctY = (v: number) => `${((v / page.height) * 100).toFixed(3)}%`
  return (
    <>
      {groups.map((group) => {
        const pos = playheadPosOf(track, currentMs, page, noteSize, group)
        if (!pos) return null
        const base = PLAYHEAD_COLORS[(pos.voice - 1) % PLAYHEAD_COLORS.length]
        return (
          <div
            key={group}
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
