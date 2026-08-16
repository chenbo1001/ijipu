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
import { layoutScore, renderScoreToSvg, noteIdToCodePos } from '../engine'
import { computeRowTops, dragDelta, clamp, GUIDE_LIMITS } from '../engine/layout/guides'
import type { GuideDragSpec } from '../engine/layout/guides'
import { brand } from '../brand/tokens'

/** 预览 SVG 显示宽度（与渲染容器一致） */
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
      tempo: parseResult.header.tempo,
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

  const rowTops = useMemo(() => (layout ? computeRowTops(layout) : []), [layout])

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

  // ---- 辅助虚线拖拽（adj7） ----
  const [drag, setDrag] = useState<{
    spec: GuideDragSpec
    startX: number
    startY: number
    startVal: number
  } | null>(null)

  const startDrag = (spec: GuideDragSpec, e: React.MouseEvent, startVal: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ spec, startX: e.clientX, startY: e.clientY, startVal })
  }

  useEffect(() => {
    if (!drag || !layout) return
    const scale = PREVIEW_W / layout.pages[0].width
    const onMove = (ev: MouseEvent) => {
      const delta = dragDelta(drag.spec, drag.startX, drag.startY, ev.clientX, ev.clientY, scale)
      const [min, max] = GUIDE_LIMITS[drag.spec.key]
      const next = { ...pageConfigRef.current, [drag.spec.key]: clamp(drag.startVal + delta, min, max) }
      setPageConfig(next)
    }
    const onUp = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, layout, setPageConfig])

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
      <div className="pages" ref={containerRef} onClick={onClick}>
        {pagesHtml.map((svg, i) => {
          const page = layout.pages[i]
          const pct = (v: number) => `${((v / page.width) * 100).toFixed(2)}%`
          const pctY = (v: number) => `${((v / page.height) * 100).toFixed(2)}%`
          const rowTopsOfPage = rowTops[i] ?? []
          return (
            <div key={i} className="score-page" style={{ maxWidth: '100%', position: 'relative' }}>
              <div style={{ width: PREVIEW_W, position: 'relative' }}>
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
                      onMouseDown={(e) => startDrag({ key: 'margin_bottom', dir: 'v' }, e, pageConfig.margin_bottom)}
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
                    {/* 行距线（每行顶部，拖动调整曲上间距） */}
                    {rowTopsOfPage.map((yt, ri) => (
                      <div
                        key={ri}
                        className="guide-line guide-h guide-row"
                        style={{ top: pctY(yt), left: pct(pageConfig.margin_left), right: pct(pageConfig.margin_right), cursor: 'ns-resize', pointerEvents: 'auto' }}
                        onMouseDown={(e) => startDrag({ key: 'height_ciqu', dir: 'v' }, e, pageConfig.height_ciqu)}
                        title="行距（曲上间距，拖动调整）"
                      />
                    ))}
                  </div>
                )}
              </div>
              {pagesHtml.length > 1 && (
                <div
                  style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: 'var(--jp-text-muted)',
                    padding: '6px 0 2px',
                  }}
                >
                  第 {i + 1} / {pagesHtml.length} 页
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
