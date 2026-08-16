/**
 * engine/render/index.ts — SVG 渲染
 *
 * M1a 阶段：单页 SVG 生成。
 *  - 页面骨架：A4/A5 白纸 + 边距；
 *  - 元数据：标题居中、副标题、作者居右、调号/拍号/节拍（左上）；
 *  - 音符：数字（衬线粗体）+ 高低音点/变音/附点/增时线/减时线/休止符/节奏符；
 *  - 小节线：| || |: :| :|:（含隐藏线 |/ |* 不绘制）；
 *  - 光标联动契约：音符 <text data-notepos="page_voice_group_index">。
 *
 * TODO(M1b)：多页分页输出
 * TODO(M1c)：歌词 <text data-cipos>
 * TODO(M7)：跳房子/连音线/装饰符号/多声部
 */
import type { PageConfig, PlacedBarline, PlacedLyric, PlacedToken, ScoreLayout, ScorePage } from '../types'

// ============================================================
// 工具
// ============================================================

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 由 LayoutId 生成稳定 notepos 标识 */
function noteposId(p: { page: number; voice: number; group: number; index: number }): string {
  return `${p.page}_${p.voice}_${p.group}_${p.index}`
}

// ============================================================
// 字体常量
// ============================================================

const FONT_NOTE = "Georgia, 'Times New Roman', 'SimSun', serif"
const FONT_CN = "'Microsoft YaHei', 'SimHei', sans-serif"

// ============================================================
// 页面骨架与元数据
// ============================================================

function renderMeta(page: ScorePage, config: PageConfig): string {
  const parts: string[] = []
  const { width } = page
  const mTop = config.margin_top

  // 调号 / 拍号 / 节拍（左上角）
  const metaLine: string[] = []
  if (page.meta.key) metaLine.push(`1=${xmlEsc(page.meta.key)}`)
  if (page.meta.meter) metaLine.push(xmlEsc(page.meta.meter))
  if (page.meta.tempo) {
    const n = Number(page.meta.tempo)
    metaLine.push(
      Number.isFinite(n) && page.meta.tempo.trim() !== '' ? `♩=${n}` : xmlEsc(page.meta.tempo),
    )
  }
  if (metaLine.length > 0) {
    parts.push(
      `<text x="${config.margin_left}" y="${mTop + 20}" font-size="13" font-family="${FONT_CN}" fill="#1b1b1b">${metaLine.join('　')}</text>`,
    )
  }

  // 主标题（居中）
  if (page.meta.titles[0]) {
    parts.push(
      `<text x="${width / 2}" y="${mTop + 26}" text-anchor="middle" font-size="${config.biaoti_size}" font-family="${FONT_CN}" font-weight="bold" fill="#1b1b1b">${xmlEsc(page.meta.titles[0])}</text>`,
    )
  }
  // 副标题
  let subY = mTop + 26 + config.biaoti_size * 1.1
  for (const t of page.meta.titles.slice(1)) {
    parts.push(
      `<text x="${width / 2}" y="${subY}" text-anchor="middle" font-size="${config.fubiaoti_size}" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(t)}</text>`,
    )
    subY += config.fubiaoti_size * 1.3
  }

  // 作者（居右，从上到下）
  let authorY = mTop + 20
  for (const a of page.meta.authors) {
    parts.push(
      `<text x="${width - config.margin_right}" y="${authorY}" text-anchor="end" font-size="12" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(a)}</text>`,
    )
    authorY += 18
  }

  return parts.join('\n')
}

// ============================================================
// 音符绘制
// ============================================================

function renderNote(note: PlacedToken): string {
  const t = note.token
  const size = 18
  const x = note.x
  const y = note.y
  const center = x + note.width / 2
  const parts: string[] = []
  const nid = noteposId(note.id)

  // 隐藏休止符 8：不绘制（占位）
  if (t.kind === 'rest' && t.hidden) return ''

  // 变音符号（数字左侧上方）
  if (t.kind === 'note' && t.accidental) {
    const sym = t.accidental === '#' ? '#' : t.accidental === '$' ? 'b' : '♮'
    parts.push(
      `<text x="${x - 7}" y="${y - 10}" font-size="12" font-family="${FONT_NOTE}" fill="#1b1b1b">${sym}</text>`,
    )
  }

  // 高低音点
  const oct = t.kind === 'note' ? t.octaveShift : 0
  if (oct !== 0) {
    const dir = oct > 0 ? -1 : 1
    const n = Math.abs(oct)
    for (let i = 0; i < n; i++) {
      const cy = y + dir * (8 + i * 7)
      parts.push(`<circle cx="${center}" cy="${cy}" r="2.4" fill="#1b1b1b"/>`)
    }
  }

  // 数字主体（含 notepos 契约）
  const glyph = t.kind === 'rest' ? '0' : t.kind === 'rhythm' ? 'X' : String(t.pitch)
  parts.push(
    `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${FONT_NOTE}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
  )

  // 附点
  for (let i = 0; i < t.dots; i++) {
    parts.push(
      `<circle cx="${x + size * 0.62 + size * 0.32 * i + 3}" cy="${y - 4}" r="2.1" fill="#1b1b1b"/>`,
    )
  }

  // 增时线（数字右侧，每条一条短线）
  const augY = y - 2
  for (let i = 0; i < t.augmentCount; i++) {
    const lx = x + size * 0.62 + size * 0.5 * i + 2
    parts.push(
      `<rect x="${lx}" y="${augY}" width="${size * 0.42}" height="2.6" rx="1.3" fill="#1b1b1b"/>`,
    )
  }

  // 减时线（数字下方，n 条）
  for (let i = 0; i < t.diminishCount; i++) {
    const ly = y + 6 + i * 4
    parts.push(`<rect x="${x + 1}" y="${ly}" width="${size * 0.58}" height="2" fill="#1b1b1b"/>`)
  }

  // 音符备注（引号注释）—— 小型文本置于音符下方
  if (t.comment) {
    parts.push(
      `<text x="${x}" y="${y + 18}" font-size="9" font-family="${FONT_CN}" fill="#555">${xmlEsc(t.comment)}</text>`,
    )
  }

  return parts.join('\n')
}

// ============================================================
// 小节线绘制
// ============================================================

function renderBarline(bar: PlacedBarline): string {
  const { x, yTop, yBottom } = bar
  const parts: string[] = []
  const draw = (off: number, w: number) =>
    `<rect x="${x + off}" y="${yTop}" width="${w}" height="${yBottom - yTop}" fill="#1b1b1b"/>`

  const dots = (side: 'l' | 'r') => {
    const dx = side === 'l' ? -6 : 6
    return (
      `<circle cx="${x + dx}" cy="${yTop + 9}" r="1.8" fill="#1b1b1b"/>` +
      `<circle cx="${x + dx}" cy="${yTop + 17}" r="1.8" fill="#1b1b1b"/>`
    )
  }

  switch (bar.type) {
    case '|':
      parts.push(draw(-0.75, 1.5))
      break
    case '||':
    case '||/':
    case '||:':
      parts.push(draw(-4, 1.5), draw(2.5, 1.5))
      break
    case '|:':
    case ':|':
    case ':|:':
      parts.push(draw(-4, 1.5), draw(2.5, 1.5))
      if (bar.type === '|:' || bar.type === ':|:') parts.push(dots('r'))
      if (bar.type === ':|' || bar.type === ':|:') parts.push(dots('l'))
      break
    case '|/':
    case '|*':
      // 隐藏小节线：不绘制
      break
  }

  // 小节线备注
  if (bar.comment) {
    parts.push(
      `<text x="${x}" y="${yBottom + 13}" text-anchor="middle" font-size="10" font-family="${FONT_CN}" fill="#333">${xmlEsc(bar.comment)}</text>`,
    )
  }

  return parts.join('\n')
}

// ============================================================
// 歌词绘制
// ============================================================

function renderLyric(lyric: PlacedLyric, config: PageConfig): string {
  const size = config.geci_size
  const cid = noteposId(lyric.id)
  return (
    `<text x="${lyric.x}" y="${lyric.y}" data-cipos="${cid}" font-size="${size}" font-family="${FONT_CN}" fill="#101010">${xmlEsc(lyric.char.text)}</text>`
  )
}

// ============================================================
// 页面组装
// ============================================================

function renderPage(page: ScorePage, config: PageConfig): string {
  const { width, height } = page
  const body: string[] = []

  body.push(renderMeta(page, config))
  for (const n of page.notes) body.push(renderNote(n))
  for (const b of page.barlines) body.push(renderBarline(b))
  for (const l of page.lyrics) body.push(renderLyric(l, config))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>` +
    body.join('\n') +
    `</svg>`
  )
}

/** 将排版结果渲染为 SVG 页面数组 */
export function renderScoreToSvg(layout: ScoreLayout): string[] {
  return layout.pages.map((p) => renderPage(p, layout.config))
}
