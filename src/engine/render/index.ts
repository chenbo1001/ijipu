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
import type { PageConfig, PlacedBarline, PlacedDynamic, PlacedLyric, PlacedSlur, PlacedToken, ScoreLayout, ScorePage, VoiceBlock } from '../types'
import { metaAreaH } from '../layout/guides'

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

const FONT_NOTE_SERIF = "Georgia, 'Times New Roman', 'SimSun', serif"
const FONT_NOTE_SANS = "'Microsoft YaHei', 'SimHei', 'Segoe UI', sans-serif"
const FONT_NOTE_KAITI = "'KaiTi', '楷体', 'STKaiti', serif"
const FONT_CN = "'Microsoft YaHei', 'SimHei', sans-serif"

/** 音符字形（a=衬线/宋体，b=黑体（默认），c=楷体） */
function noteFont(style: import('../types').PageConfig['shuzi_font']): string {
  switch (style) {
    case 'a':
      return FONT_NOTE_SERIF
    case 'c':
      return FONT_NOTE_KAITI
    default:
      return FONT_NOTE_SANS
  }
}

// ============================================================
// 页面骨架与元数据（描述头）
// ============================================================

/**
 * 描述头默认布局：
 *  - 主标题：居中靠上；副标题紧接其下
 *  - 作者：描述区右下（从底部往上）
 *  - 调式+拍号：左下同排；节拍在其下；其它各一行
 *  - metaPos 可覆盖任意元素位置（key: title/subtitle_i/author_i/keyline/tempo）
 */
function renderMeta(page: ScorePage, config: PageConfig): string {
  const parts: string[] = []
  const { width } = page
  const mTop = config.margin_top
  const areaH = metaAreaH(config)
  const posOf = (key: string, defX: number, defY: number) => {
    const p = config.metaPos?.[key]
    return p ? { x: p.x, y: p.y } : { x: defX, y: defY }
  }

  // ---- 调式 + 拍号（左下，同排） ----
  const keyText = [page.meta.key ? `1=${xmlEsc(page.meta.key)}` : '', page.meta.meter ? xmlEsc(page.meta.meter) : '']
    .filter(Boolean)
    .join('　')
  if (keyText) {
    const pos = posOf('keyline', config.margin_left, areaH - 44)
    parts.push(
      `<text data-meta="keyline" x="${pos.x}" y="${pos.y}" font-size="13" font-family="${FONT_CN}" fill="#1b1b1b">${keyText}</text>`,
    )
  }
  // ---- 节拍（左下，keyline 下方；多行合并为一行） ----
  if (page.meta.tempo) {
    const n = Number(page.meta.tempo)
    const tempoText =
      Number.isFinite(n) && page.meta.tempo.trim() !== ''
        ? `♩=${n}`
        : xmlEsc(page.meta.tempo.replace(/\s*\n\s*/g, '　'))
    const pos = posOf('tempo', config.margin_left, areaH - 20)
    parts.push(
      `<text data-meta="tempo" x="${pos.x}" y="${pos.y}" font-size="13" font-family="${FONT_CN}" fill="#1b1b1b">${tempoText}</text>`,
    )
  }

  // ---- 主标题（居中靠上） ----
  if (page.meta.titles[0]) {
    const pos = posOf('title', width / 2, mTop + 26)
    parts.push(
      `<text data-meta="title" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.biaoti_size}" font-family="${FONT_CN}" font-weight="bold" fill="#1b1b1b">${xmlEsc(page.meta.titles[0])}</text>`,
    )
  }
  // ---- 副标题（主标题下） ----
  let subIdx = 0
  let subY = mTop + 26 + config.biaoti_size * 1.1
  for (const t of page.meta.titles.slice(1)) {
    const pos = posOf(`subtitle_${subIdx}`, width / 2, subY)
    parts.push(
      `<text data-meta="subtitle_${subIdx}" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.fubiaoti_size}" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(t)}</text>`,
    )
    subY += config.fubiaoti_size * 1.3
    subIdx++
  }

  // ---- 作者（右下，从底部往上） ----
  const authorBottom = areaH - 16
  for (let i = 0; i < page.meta.authors.length; i++) {
    const a = page.meta.authors[i]
    const defY = authorBottom - (page.meta.authors.length - 1 - i) * 18
    const pos = posOf(`author_${i}`, width - config.margin_right, defY)
    parts.push(
      `<text data-meta="author_${i}" x="${pos.x}" y="${pos.y}" text-anchor="end" font-size="12" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(a)}</text>`,
    )
  }

  return parts.join('\n')
}

// ============================================================
// 音符绘制
// ============================================================

function renderNote(note: PlacedToken, config: PageConfig): string {
  const t = note.token
  const size = 18
  const x = note.x
  const y = note.y
  const center = x + note.width / 2
  const parts: string[] = []
  const nid = noteposId(note.id)
  const font = noteFont(config.shuzi_font)

  // 隐藏休止符 8：不绘制（占位）
  if (t.kind === 'rest' && t.hidden) return ''

  // 变音符号（数字左侧上方）
  if (t.kind === 'note' && t.accidental) {
    const sym = t.accidental === '#' ? '#' : t.accidental === '$' ? 'b' : '♮'
    parts.push(
      `<text x="${x - 7}" y="${y - 10}" font-size="12" font-family="${font}" fill="#1b1b1b">${sym}</text>`,
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
    `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
  )

  // 附点
  for (let i = 0; i < t.dots; i++) {
    parts.push(
      `<circle cx="${x + size * 0.62 + size * 0.32 * i + 3}" cy="${y - 4}" r="2.1" fill="#1b1b1b"/>`,
    )
  }

  // 增时线（"-" 各占一拍的位置，但字符本身不拉伸：固定标准宽，居中于所在拍段）
  const augY = y - 8
  if (t.augmentCount > 0) {
    const dur = note.duration
    const perBeat = dur > 0 ? note.width / dur : NOTE_DIGIT_W
    // 数字中心 = 第 1 拍段中点 → 时值段起点
    const segStart = x + 6 - Math.min(dur, 1) * (perBeat / 2)
    for (let i = 0; i < t.augmentCount; i++) {
      const beatStart = segStart + (1 + i) * perBeat
      const lx = r1n(beatStart + (perBeat - NOTE_DIGIT_W) / 2)
      parts.push(
        `<rect x="${lx}" y="${augY}" width="${NOTE_DIGIT_W}" height="2.6" rx="1.3" fill="#1b1b1b"/>`,
      )
    }
  }

  // 装饰符号（& 编码，M7d）：tr 颤音带波浪线，其余画上方小文本
  if (t.kind === 'note' && t.symbols.length > 0) {
    let symY = y - 24
    for (const sym of t.symbols) {
      if (sym === 'tr') {
        parts.push(
          `<text x="${x}" y="${symY}" font-size="10" font-style="italic" font-family="${FONT_CN}" fill="#1b1b1b">tr</text>`,
        )
        parts.push(wavePath(x + 16, symY - 6, x + 34))
      } else {
        parts.push(
          `<text x="${x}" y="${symY}" font-size="10" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(sym)}</text>`,
        )
      }
      symY -= 9
    }
  }

  // 减时线由 computeBeams 按拍分组绘制（M3：同一拍内相连）
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
// 多声部括弧与名称（M7a）
// ============================================================

/** 生成垂直大括号 path（两端弧 + 中部凸起） */
function bracePath(x: number, yTop: number, yBottom: number): string {
  const mid = (yTop + yBottom) / 2
  const r = Math.min(10, (yBottom - yTop) / 5)
  const inner = Math.min(r * 0.9, r)
  return [
    `M ${x} ${yTop}`,
    `Q ${x - r} ${yTop + r} ${x} ${yTop + r * 1.8}`,
    `L ${x} ${mid - inner}`,
    `Q ${x - inner * 0.7} ${mid} ${x} ${mid + inner}`,
    `L ${x} ${yBottom - r * 1.8}`,
    `Q ${x - r} ${yBottom - r} ${x} ${yBottom}`,
  ].join(' ')
}

function renderVoiceBlocks(page: ScorePage, vb: VoiceBlock): string {
  const parts: string[] = []
  // 大括号
  parts.push(
    `<path d="${bracePath(vb.x, vb.yTop, vb.yBottom)}" fill="none" stroke="#1b1b1b" stroke-width="1.5"/>`,
  )
  // 声部名称（括弧左侧，对应各行中部；无名称显示声部号）
  const h = vb.yBottom - vb.yTop
  const n = vb.voices.length
  for (let i = 0; i < n; i++) {
    const v = vb.voices[i]
    const cy = vb.yTop + (h * (i + 0.5)) / n
    const label = v.name ?? `声部${v.voice}`
    parts.push(
      `<text x="${vb.x - 10}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="12" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(label)}</text>`,
    )
  }
  void page
  return parts.join('\n')
}

// ============================================================
// 跳房子渲染（M7b）
// ============================================================

/** 画一条跳房子线（起点 [ 至终点 ]；未封闭时向右延伸） */
function renderVoltaLine(start: PlacedBarline, end: PlacedBarline | null): string {
  const plus = start.voltaStart?.plus ?? 0
  const y = start.yTop - 16 - plus * 4
  const x1 = start.x
  const x2 = end ? end.x : start.x + 60
  const parts: string[] = []
  // 起点竖线（[ 处：从线高向下到行顶上方）
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x1}" y2="${start.yTop + 4}" stroke="#1b1b1b" stroke-width="1.4"/>`,
  )
  // 水平线
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1b1b1b" stroke-width="1.4"/>`,
  )
  // 终点折线（] 处：向下到行顶）
  if (end) {
    parts.push(
      `<line x1="${x2}" y1="${y}" x2="${x2}" y2="${end.yTop + 4}" stroke="#1b1b1b" stroke-width="1.4"/>`,
    )
  }
  // 番号（小节线引号备注）显示在线起点上方
  if (start.comment) {
    parts.push(
      `<text x="${x1 + 4}" y="${y - 5}" font-size="10" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(start.comment)}</text>`,
    )
  }
  return parts.join('\n')
}

/** 渲染页内全部跳房子线（配对 [ ]；未闭合 [ 向右延伸） */
function renderVoltas(barlines: PlacedBarline[]): string {
  const parts: string[] = []
  let open: PlacedBarline | null = null
  for (const bar of barlines) {
    if (bar.voltaStart && !open) {
      open = bar
    } else if (bar.voltaEnd && open) {
      parts.push(renderVoltaLine(open, bar))
      open = null
    }
  }
  if (open) parts.push(renderVoltaLine(open, null))
  return parts.join('\n')
}

// ============================================================
// 连音线绘制（M7c）
// ============================================================

function renderSlur(s: PlacedSlur): string {
  if (s.style === 'flat') {
    // 平顶：横线 + 两端小竖线
    return (
      `<line x1="${s.x1}" y1="${s.y}" x2="${s.x2}" y2="${s.y}" stroke="#1b1b1b" stroke-width="1.3"/>` +
      `<line x1="${s.x1}" y1="${s.y}" x2="${s.x1}" y2="${s.y - 5}" stroke="#1b1b1b" stroke-width="1.3"/>` +
      `<line x1="${s.x2}" y1="${s.y}" x2="${s.x2}" y2="${s.y - 5}" stroke="#1b1b1b" stroke-width="1.3"/>`
    )
  }
  // 圆弧：二次贝塞尔
  const midX = (s.x1 + s.x2) / 2
  const midY = s.y - 9
  return `<path d="M ${s.x1} ${s.y} Q ${midX} ${midY} ${s.x2} ${s.y}" fill="none" stroke="#1b1b1b" stroke-width="1.3"/>`
}

// ============================================================
// 渐强渐弱与波浪线（M7d）
// ============================================================

/** 颤音波浪线（连续小弧） */
function wavePath(x1: number, y: number, x2: number): string {
  const seg = 4
  let d = `M ${x1} ${y}`
  for (let x = x1; x < x2; x += seg) {
    d += ` q ${seg / 2} -2.5, ${seg} 0`
  }
  return `<path d="${d}" fill="none" stroke="#1b1b1b" stroke-width="1"/>`
}

function renderDynamic(d: PlacedDynamic): string {
  const midY = d.y
  if (d.type === 'crescendo') {
    // 渐强：左窄右宽楔形
    return `<path d="M ${d.x1} ${midY - 2} L ${d.x2} ${midY - 8} L ${d.x2} ${midY + 8} L ${d.x1} ${midY + 2} Z" fill="none" stroke="#1b1b1b" stroke-width="1.2"/>`
  }
  // 渐弱：右窄左宽楔形
  return `<path d="M ${d.x2} ${midY - 2} L ${d.x1} ${midY - 8} L ${d.x1} ${midY + 8} L ${d.x2} ${midY + 2} Z" fill="none" stroke="#1b1b1b" stroke-width="1.2"/>`
}

// ============================================================
// 减时线分组（adj3：同一拍内相连）
// ============================================================

/** 数字近似宽（18px 字号的 0.62 倍） */
const NOTE_DIGIT_W = 11.16

interface Beam {
  x1: number
  x2: number
  y: number
}

/**
 * 计算减时线横线组：
 * 第 n 条横线连接「同一拍内（floor(beatPos) 相同）连续且减时线数 ≥ n」的音符。
 * 例：1/2/ → 1 条（整拍连）；1/2/3/4/ → 拍 1 连、拍 2 连（中间断开）；
 *     1//2//3//4// → 2 条（各整拍连）；1//2//3/ → 第 1 条全连、第 2 条连 1//2//
 */
function computeBeams(notes: PlacedToken[]): Beam[] {
  const beams: Beam[] = []
  const groups = new Map<string, PlacedToken[]>()
  for (const n of notes) {
    const key = `${n.y}|${n.barIndex}`
    const arr = groups.get(key) ?? []
    arr.push(n)
    groups.set(key, arr)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.beatPos - b.beatPos)
    const maxLevel = Math.max(0, ...list.map((n) => n.token.diminishCount))
    for (let level = 1; level <= maxLevel; level++) {
      let i = 0
      while (i < list.length) {
        if (list[i].token.diminishCount < level) {
          i++
          continue
        }
        const beat = Math.floor(list[i].beatPos)
        let j = i
        while (
          j + 1 < list.length &&
          Math.floor(list[j + 1].beatPos) === beat &&
          list[j + 1].token.diminishCount >= level
        ) {
          j++
        }
        beams.push({
          x1: r1n(list[i].x + 1),
          x2: r1n(list[j].x + NOTE_DIGIT_W - 1),
          y: r1n(list[i].y + 6 + (level - 1) * 4),
        })
        i = j + 1
      }
    }
  }
  return beams
}

const r1n = (v: number) => Math.round(v * 10) / 10

/** 供冒烟测试：计算减时线横线组 */
export function computeBeamsForTest(notes: PlacedToken[]): Beam[] {
  return computeBeams(notes)
}

function renderBeams(beams: Beam[]): string {
  return beams
    .map(
      (b) =>
        `<rect x="${b.x1}" y="${b.y}" width="${Math.max(1, b.x2 - b.x1)}" height="2" fill="#1b1b1b"/>`,
    )
    .join('\n')
}

// ============================================================
// 页面组装
// ============================================================

function renderPage(page: ScorePage, config: PageConfig): string {
  const { width, height } = page
  const body: string[] = []

  body.push(renderMeta(page, config))
  body.push(renderVoltas(page.barlines)) // 跳房子线画在最底层
  for (const s of page.slurs) body.push(renderSlur(s))
  for (const d of page.dynamics) body.push(renderDynamic(d))
  body.push(renderBeams(computeBeams(page.notes)))
  for (const n of page.notes) body.push(renderNote(n, config))
  for (const b of page.barlines) body.push(renderBarline(b))
  for (const l of page.lyrics) body.push(renderLyric(l, config))
  for (const vb of page.voiceBlocks) body.push(renderVoiceBlocks(page, vb))

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
