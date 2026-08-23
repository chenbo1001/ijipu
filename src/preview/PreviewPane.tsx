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
import { tempoLabel } from '../engine/parser/parser'
import { layoutScore, renderScoreToSvg, noteIdToCodePos } from '../engine'
import { computeRowTops, computeRowGuides, dragDelta, clamp, metaAreaH, GUIDE_LIMITS, GUIDE_LIMITS_EX } from '../engine/layout/guides'
import { clampMetaPos, metaAnchorOf, metaAnchorPt } from '../engine/layout/metaAnchors'
import { brand } from '../brand/tokens'

/** 预览 SVG 基准显示宽度（与渲染容器一致）；实际显示宽度 = PREVIEW_W × zoom（adj51） */
const PREVIEW_W = 760

export function PreviewPane() {
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setPageConfig = useDocStore((s) => s.setPageConfig)
  const code = useDocStore((s) => s.code)
  const activeNoteId = useDocStore((s) => s.activeNoteId)
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const showGuides = useUiStore((s) => s.showGuides)
  const previewZoom = useUiStore((s) => s.previewZoom)
  const openModal = useUiStore((s) => s.openModal)
  const setPlaybackStart = useUiStore((s) => s.setPlaybackStart)

  const containerRef = useRef<HTMLDivElement>(null)
  const pageConfigRef = useRef(pageConfig)
  pageConfigRef.current = pageConfig

  const { layout, pagesHtml, errorCount, summary } = useMemo(() => {
    const errors = parseResult.errors.filter((e) => e.severity === 'error')
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
    if (errors.length > 0) {
      return { layout: null, pagesHtml: [] as string[], errorCount: errors.length, summary: sum }
    }
    const lay = layoutScore(parseResult, pageConfig)
    return { layout: lay, pagesHtml: renderScoreToSvg(lay), errorCount: 0, summary: sum }
  }, [parseResult, pageConfig])

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
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeNoteId, pagesHtml])

  // 点击谱面音符/歌词 → 编辑器光标跳转（M3）
  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-notepos], [data-cipos]')
    if (!target) return
    const id = target.getAttribute('data-notepos') ?? target.getAttribute('data-cipos')
    if (!id) return
    setActiveNoteId(id)
    const pos = noteIdToCodePos(code, id)
    if (pos !== null) jumpCursor(pos)
  }

  // adj88：双击谱面音符 → 定位试听起点并打开试听对话框（从该音符开始播放）
  const onDoubleClick = (e: React.MouseEvent) => {
    const target = (e.target as Element).closest('[data-notepos]')
    if (!target) return
    const id = target.getAttribute('data-notepos')
    if (!id) return
    setActiveNoteId(id)
    setPlaybackStart(id)
    openModal('playback')
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
      const baseY = layout.pages[0].height - cfg.margin_bottom - 24 + lineIdx * cfg.miaoshu_size * 1.4
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
            {errorCount > 0 ? (
              <>⚠ 存在 {errorCount} 个语法错误，请先修正脚本</>
            ) : (
              <>解析完成：{summary.musicLines} 个曲行 · {summary.notes} 个乐符 · {summary.errors} 个问题</>
            )}
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
            <div key={i} className="score-page" style={{ maxWidth: '100%', position: 'relative' }}>
              <div
                className="preview-zoom-scale"
                style={{
                  width: PREVIEW_W * (previewZoom / 100),
                  position: 'relative',
                  zoom: previewZoom / 100,
                }}
              >
                <div dangerouslySetInnerHTML={{ __html: svg }} />
                {showGuides && (
                  <div
                    className="guide-layer"
                    style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
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
