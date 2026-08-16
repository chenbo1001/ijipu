/**
 * preview/PreviewPane.tsx — 乐谱预览区（真实渲染）
 *
 * 渲染管线：parseResult → layoutScore → renderScoreToSvg → 多页 SVG。
 * 页面按 A4/A5 比例缩放展示；解析错误时回退为占位摘要。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'
import { layoutScore, renderScoreToSvg } from '../engine'
import { brand } from '../brand/tokens'

export function PreviewPane() {
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)

  const { pagesHtml, errorCount, summary } = useMemo(() => {
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
      return { pagesHtml: [], errorCount: errors.length, summary: sum }
    }
    const layout = layoutScore(parseResult, pageConfig)
    return { pagesHtml: renderScoreToSvg(layout), errorCount: 0, summary: sum }
  }, [parseResult, pageConfig])

  if (pagesHtml.length === 0) {
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
      <div className="pages">
        {pagesHtml.map((svg, i) => (
          <div key={i} className="score-page" style={{ maxWidth: '100%' }}>
            {/* 引擎生成的 SVG（文本已 XML 转义），缩放展示 */}
            <div
              style={{ width: 760 }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
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
        ))}
      </div>
    </div>
  )
}
