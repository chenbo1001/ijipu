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
import { metaAnchorOf, metaAnchorPt } from '../layout/metaAnchors'

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
 * 描述头默认布局（adj16 锚点语义）：
 *  - 主标题：上边中点（top-center）；副标题紧接其下
 *  - 作者：右下角（bottom-right，从底部往上）
 *  - 调式+拍号：左下角（bottom-left）；节拍在其下；其它各一行
 *  - metaPos 可覆盖任意元素位置（key: title/subtitle_i/author_i/keyline/tempo）
 *    值为相对各自锚点的偏移（adj16）：区域宽/高变化时元素跟随锚点。
 */
function renderMeta(page: ScorePage, config: PageConfig): string {
  const parts: string[] = []
  const { width } = page
  const posOf = (key: string, defOff: { x: number; y: number }) => {
    // 绝对 = 锚点 + 偏移；无 metaPos 用默认偏移（等价旧默认公式）
    const anchor = metaAnchorPt(metaAnchorOf(key), width, config)
    const p = config.metaPos?.[key]
    return p ? { x: anchor.x + p.x, y: anchor.y + p.y } : { x: anchor.x + defOff.x, y: anchor.y + defOff.y }
  }

  // ---- 调式 + 拍号（左下锚，同排） ----
  const keyText = [page.meta.key ? `1=${xmlEsc(page.meta.key)}` : '', page.meta.meter ? xmlEsc(page.meta.meter) : '']
    .filter(Boolean)
    .join('　')
  if (keyText) {
    const pos = posOf('keyline', { x: 0, y: -44 })
    parts.push(
      `<text data-meta="keyline" x="${pos.x}" y="${pos.y}" font-size="13" font-family="${FONT_CN}" fill="#1b1b1b">${keyText}</text>`,
    )
  }
  // ---- 节拍（左下锚，keyline 下方；多行合并为一行） ----
  if (page.meta.tempo) {
    const n = Number(page.meta.tempo)
    const tempoText =
      Number.isFinite(n) && page.meta.tempo.trim() !== ''
        ? `♩=${n}`
        : xmlEsc(page.meta.tempo.replace(/\s*\n\s*/g, '　'))
    const pos = posOf('tempo', { x: 0, y: -20 })
    parts.push(
      `<text data-meta="tempo" x="${pos.x}" y="${pos.y}" font-size="13" font-family="${FONT_CN}" fill="#1b1b1b">${tempoText}</text>`,
    )
  }

  // ---- 主标题（上居中锚） ----
  if (page.meta.titles[0]) {
    const pos = posOf('title', { x: 0, y: 26 })
    parts.push(
      `<text data-meta="title" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.biaoti_size}" font-family="${FONT_CN}" font-weight="bold" fill="#1b1b1b">${xmlEsc(page.meta.titles[0])}</text>`,
    )
  }
  // ---- 副标题（上居中锚，主标题下） ----
  let subIdx = 0
  let subOffY = 26 + config.biaoti_size * 1.1
  for (const t of page.meta.titles.slice(1)) {
    const pos = posOf(`subtitle_${subIdx}`, { x: 0, y: subOffY })
    parts.push(
      `<text data-meta="subtitle_${subIdx}" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.fubiaoti_size}" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(t)}</text>`,
    )
    subOffY += config.fubiaoti_size * 1.3
    subIdx++
  }

  // ---- 作者（右下锚，从底部往上） ----
  for (let i = 0; i < page.meta.authors.length; i++) {
    const pos = posOf(`author_${i}`, { x: 0, y: -16 - (page.meta.authors.length - 1 - i) * 18 })
    parts.push(
      `<text data-meta="author_${i}" x="${pos.x}" y="${pos.y}" text-anchor="end" font-size="12" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(page.meta.authors[i])}</text>`,
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

  // 高低音点（高音点在数字正上方 adj17/19；高音点距音符 4px、低音点距最近元素 4px：数字底部或最下方减时横线，adj21）
  const oct = t.kind === 'note' ? t.octaveShift : 0
  if (oct !== 0) {
    const n = Math.abs(oct)
    // 数字槽宽中心：高音点左移 1px（adj19）；低音点不偏移（adj22：原左移 1 再右移 1）
    const dotCx = x + NOTE_DIGIT_W / 2 - (oct > 0 ? 1 : 0)
    const dc = t.diminishCount
    // 低音点基座 cy：点顶距最近元素 4px —— 数字底部(基线+2) 或最下方减时横线底(基线+8+(dc-1)*4)
    const lowBase = oct < 0 ? y + (dc > 0 ? 8 + (dc - 1) * 4 : 2) + 4 + 2.4 : 0
    for (let i = 0; i < n; i++) {
      // 高音点在数字正上方（基线上 20：点下沿距数字顶约 4px）
      const cy = oct > 0 ? y - (20 + i * 7) : lowBase + i * 7
      parts.push(`<circle cx="${dotCx}" cy="${cy}" r="2.4" fill="#1b1b1b"/>`)
    }
  }

  // 数字主体（含 notepos 契约；虚音符 (1) 两侧加小括号，adj23）
  const glyph = t.kind === 'rest' ? '0' : t.kind === 'rhythm' ? 'X' : String(t.pitch)
  if (t.kind === 'note' && t.ghost) {
    parts.push(
      `<text x="${x - 5}" y="${y}" font-size="13" font-family="${font}" fill="#1b1b1b">(</text>`,
      `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
      `<text x="${x + NOTE_DIGIT_W + 1}" y="${y}" font-size="13" font-family="${font}" fill="#1b1b1b">)</text>`,
    )
  } else {
    parts.push(
      `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
    )
  }

  // 倚音（adj23）：前倚音 [65] 画在主音符左侧，后倚音 [h65] 画在右侧（小字号，不占拍）
  if (t.kind === 'note' && t.gracenotes && t.gracenotes.notes.length > 0) {
    const gn = t.gracenotes
    const gSize = 10
    const gW = 7 // 每个倚音音符占宽
    for (let gi = 0; gi < gn.notes.length; gi++) {
      const g = gn.notes[gi]
      const gx = gn.after
        ? x + NOTE_DIGIT_W + 3 + gi * gW
        : x - 3 - (gn.notes.length - gi) * gW
      // 小高低音点
      if (g.octaveShift !== 0) {
        const dir = g.octaveShift > 0 ? -1 : 1
        const cx = gx + gW / 2
        for (let d = 0; d < Math.abs(g.octaveShift); d++) {
          const cy = y + dir * (11 + d * 5)
          parts.push(`<circle cx="${r1n(cx)}" cy="${cy}" r="1.5" fill="#1b1b1b"/>`)
        }
      }
      // 变音
      if (g.accidental) {
        const sym = g.accidental === '#' ? '#' : g.accidental === '$' ? 'b' : '♮'
        parts.push(
          `<text x="${gx - 3.5}" y="${y - 6}" font-size="8" font-family="${font}" fill="#1b1b1b">${sym}</text>`,
        )
      }
      // 减时线
      for (let d = 0; d < g.diminishCount; d++) {
        parts.push(`<rect x="${gx + 0.5}" y="${y + 2 + d * 3}" width="6" height="1.5" fill="#1b1b1b"/>`)
      }
      // 数字
      parts.push(
        `<text x="${gx}" y="${y}" font-size="${gSize}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${g.pitch}</text>`,
      )
    }
  }

  // 附点（adj13/15：垂直居中于数字；附点占前音符**基础时值**的 1/2，
  // 即 1. 总宽 1.5 拍、1/. 总宽 0.75 拍；位置基于不含附点的基础时值）
  if (t.dots > 0) {
    const perBeat = note.duration > 0 ? note.width / note.duration : NOTE_DIGIT_W
    const baseDur = (1 + t.augmentCount) / Math.pow(2, t.diminishCount)
    // 数字中心 = 第 1 拍段中点 → 时值段起点
    const segStart = x + 6 - Math.min(note.duration, 1) * (perBeat / 2)
    let acc = baseDur * perBeat // 基础时值结束处
    for (let i = 0; i < t.dots; i++) {
      const half = (baseDur * perBeat) / Math.pow(2, i + 1)
      const cx = segStart + acc + half / 2
      parts.push(`<circle cx="${r1n(cx)}" cy="${y - 8}" r="2.4" fill="#1b1b1b"/>`)
      acc += half
    }
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
  // 纯跳房子起点（] 后连续 [ 或行首）：只承载跳房子线，不画小节线竖线（adj26）
  if (bar.voltaOnly) return ''
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

/** 画一条跳房子线（起点 [ 至终点 ]；未封闭或 |]/ 开口时终点不封闭） */
function renderVoltaLine(start: PlacedBarline, end: PlacedBarline | null): string {
  const plus = start.voltaStart?.plus ?? 0
  const y = start.yTop - 16 - plus * 4
  // 起止内缩 1px（adj27）：起点右缩、终点左缩，视觉上收进小节区域
  const x1 = start.x + 1
  const x2 = end ? end.x - 1 : start.x + 60
  const openEnd = !end || !!end.voltaEndSlash // 开口结束：无终点折线（adj26）
  const parts: string[] = []
  // 起点竖线（[ 处：从线高向下到小节线上端上方 4px，adj29）
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x1}" y2="${start.yTop - 4}" stroke="#1b1b1b" stroke-width="1.4"/>`,
  )
  // 水平线
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1b1b1b" stroke-width="1.4"/>`,
  )
  // 终点折线（] 处：向下到小节线上端上方 4px，adj29；开口结束不画）
  if (end && !openEnd) {
    parts.push(
      `<line x1="${x2}" y1="${y}" x2="${x2}" y2="${end.yTop - 4}" stroke="#1b1b1b" stroke-width="1.4"/>`,
    )
  }
  // 番号（[ 后引号注释优先；小节线引号备注兼容）显示在跳房子线下方（adj27/28）
  const label = start.voltaStart?.comment ?? start.comment
  if (label) {
    parts.push(
      `<text x="${x1 + 4}" y="${y + 10}" font-size="10" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(label)}</text>`,
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
