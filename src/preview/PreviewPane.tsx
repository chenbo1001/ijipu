/**
 * preview/PreviewPane.tsx — 乐谱预览区
 *
 * 渲染管线：parseResult → layoutScore → renderScoreToSvg（实现迭代中）。
 * 当前展示解析摘要与占位，验证解析管线已贯通。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'
import { brand } from '../brand/tokens'

export function PreviewPane() {
  const parseResult = useDocStore((s) => s.parseResult)

  const summary = useMemo(() => {
    const musicLines = parseResult.groups.length
    const lyricChars = parseResult.groups.reduce(
      (n, g) => n + g.lyrics.reduce((m, l) => m + l.chars.filter((c) => !c.skip).length, 0),
      0,
    )
    const notes = parseResult.groups.reduce((n, g) => n + g.music.tokens.length, 0)
    return {
      title: parseResult.header.titles[0] ?? '未命名',
      authors: parseResult.header.authors.join('；'),
      key: parseResult.header.key,
      meter: parseResult.header.meter,
      tempo: parseResult.header.tempo,
      musicLines,
      lyricChars,
      notes,
      errors: parseResult.errors.length,
    }
  }, [parseResult])

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
          解析完成：{summary.musicLines} 个曲行 · {summary.notes} 个乐符 ·{' '}
          {summary.lyricChars} 个歌词字 · {summary.errors} 个问题
        </div>
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 10 }}>
          乐谱渲染引擎开发中 —— {brand.taglineMain}
        </div>
      </div>
    </div>
  )
}
