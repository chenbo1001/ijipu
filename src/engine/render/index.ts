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
import {
  DOT_R,
  DOT_R_DOT,
  DIGIT_HEIGHT_RATIO,
  LAYER_GAP,
  INNER_GAP,
  COMMENT_FONT_RATIO,
  NOTE_COMMENT_FONT_RATIO,
  DESC_RATIO,
  VOLTA_BAR_GAP,
  VOLTA_RAISE,
  VOLTA_COMMENT_FONT_RATIO,
  TUPLET_NUM_RATIO,
  noteScaleOf,
  beamY,
  lowDotY,
  octaveDotY,
  octaveTopY,
} from '../layout/spacing'
import { tempoLabel } from '../parser/parser'

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

/**
 * 13px 元数据字形宽（Microsoft YaHei GDI 实测，px）——用于调式/节拍 = 号对齐（adj42）。
 * 其余 ASCII 按 7.62、CJK 按 13 兜底估算。
 */
const META_GLYPH_W: Record<string, number> = {
  ' ': 3.85,
  '=': 9.64,
  '♩': 7.0,
  '0': 7.62, '1': 7.62, '2': 7.62, '3': 7.62, '4': 7.62,
  '5': 7.62, '6': 7.62, '7': 7.62, '8': 7.62, '9': 7.62,
  'A': 9.15, 'B': 8.16, 'C': 8.7, 'D': 9.9, 'E': 7.15,
  'F': 6.91, 'G': 9.67, '#': 8.3, '$': 7.62,
}

/** 估算 13px 元数据文本宽（px） */
function metaTextW(s: string): number {
  let w = 0
  for (const ch of s) {
    w += META_GLYPH_W[ch] ?? (ch.charCodeAt(0) > 127 ? 13 : 7.62)
  }
  return w
}

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

  // ---- 调式 + 拍号（左下锚，同排）：调号文本 + 拍号分数（数字上下正对，中间横线） ----
  // adj42：调式行 = 号两侧加空格（如 "1 = C"），与下方节拍行的 = 号垂直对齐
  const mFont = config.miaoshu_font
  const mSize = config.miaoshu_size
  const keyLabel = page.meta.key ? `1 = ${xmlEsc(page.meta.key)}` : ''
  if (keyLabel) {
    const pos = posOf('keyline', { x: 0, y: -44 })
    parts.push(
      `<text data-meta="keyline" x="${pos.x}" y="${pos.y}" font-size="${mSize}" font-family="${mFont}" fill="#1b1b1b">${keyLabel}</text>`,
    )
  }
  if (page.meta.meter) {
    const pos = posOf('keyline', { x: 0, y: -44 })
    // 估算 "1 = C" 文本宽（13px 字体 ASCII ≈7px/字符，随字号缩放）后留 10px 间距
    const meterX = pos.x + (keyLabel ? keyLabel.length * 7 * (mSize / 13) + 10 : 0)
    parts.push(renderMeterMeta(page.meta.meter, meterX, pos.y, mFont, mSize))
  }
  // ---- 节拍（左下锚，keyline 下方；数字 ♩=N + 文字，多条 J 时并排） ----
  // adj42：= 号后加空格（"♩= 80"），并与调式行 = 号垂直对齐：
  // 调式行 "=" 位于 x + w("1 ")，节拍行 "=" 位于 x' + w("♩")，令 x' = x + w("1 ") - w("♩")
  // 仅当节拍行含 "♩=" 前缀时对齐；纯文字节拍（无 = 号）保持与调式行左缘对齐
  const tempoNum = page.meta.tempoNum
  const tempoText = page.meta.tempoText
  const legacyTempo = page.meta.tempo
  const hasTempoEq = Boolean(tempoNum) || (legacyTempo !== null && Number.isFinite(Number(legacyTempo)) && legacyTempo.trim() !== '')
  const tempoEqShift = keyLabel && hasTempoEq ? (metaTextW('1 ') - metaTextW('♩')) * (mSize / 13) : 0
  if (tempoNum || tempoText) {
    // adj：与调式行间距加大（偏移 -20 → -12），防止拍号分母与节拍行重叠
    const pos = posOf('tempo', { x: tempoEqShift, y: -12 })
    parts.push(
      `<text data-meta="tempo" x="${pos.x}" y="${pos.y}" font-size="${mSize}" font-family="${mFont}" fill="#1b1b1b">${xmlEsc(tempoLabel(tempoNum ?? undefined, tempoText ?? undefined))}</text>`,
    )
  } else if (page.meta.tempo) {
    // 兼容旧数据（无 tempoNum/tempoText 字段）：数字或原文
    const n = Number(page.meta.tempo)
    const tempoText =
      Number.isFinite(n) && page.meta.tempo.trim() !== ''
        ? `♩= ${n}`
        : xmlEsc(page.meta.tempo.replace(/\s*\n\s*/g, '　'))
    const pos = posOf('tempo', { x: tempoEqShift, y: -12 })
    parts.push(
      `<text data-meta="tempo" x="${pos.x}" y="${pos.y}" font-size="${mSize}" font-family="${mFont}" fill="#1b1b1b">${tempoText}</text>`,
    )
  }

  // ---- 主标题（上居中锚；默认偏移 30.6 = 字号×0.85，文字顶不越过顶部虚线，adj32） ----
  if (page.meta.titles[0]) {
    const pos = posOf('title', { x: 0, y: 30.6 })
    parts.push(
      `<text data-meta="title" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.biaoti_size}" font-family="${config.biaoti_font}" font-weight="bold" fill="#1b1b1b">${xmlEsc(page.meta.titles[0])}</text>`,
    )
  }
  // ---- 副标题（上居中锚，主标题下） ----
  let subIdx = 0
  let subOffY = 30.6 + config.biaoti_size * 1.1
  for (const t of page.meta.titles.slice(1)) {
    const pos = posOf(`subtitle_${subIdx}`, { x: 0, y: subOffY })
    parts.push(
      `<text data-meta="subtitle_${subIdx}" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${config.fubiaoti_size}" font-family="${config.fubiaoti_font}" fill="#1b1b1b">${xmlEsc(t)}</text>`,
    )
    subOffY += config.fubiaoti_size * 1.3
    subIdx++
  }

  // ---- 乐器（adj83：Y 行，多行，一行一种乐器；显示在副标题下面，上居中锚） ----
  // 默认偏移：主标题(30.6) + 主标题高 + 各副标题高之后；字体用描述头字号（随 miaoshu）
  let instOffY = subOffY
  for (let i = 0; i < page.meta.instruments.length; i++) {
    const pos = posOf(`instrument_${i}`, { x: 0, y: instOffY })
    parts.push(
      `<text data-meta="instrument_${i}" x="${pos.x}" y="${pos.y}" text-anchor="middle" font-size="${mSize}" font-family="${mFont}" fill="#555">${xmlEsc(page.meta.instruments[i])}</text>`,
    )
    instOffY += mSize * 1.4
  }

  // ---- 作者（右下锚，从底部往上） ----
  for (let i = 0; i < page.meta.authors.length; i++) {
    const pos = posOf(`author_${i}`, { x: 0, y: -16 - (page.meta.authors.length - 1 - i) * 18 })
    parts.push(
      `<text data-meta="author_${i}" x="${pos.x}" y="${pos.y}" text-anchor="end" font-size="${Math.max(9, mSize - 1)}" font-family="${mFont}" fill="#1b1b1b">${xmlEsc(page.meta.authors[i])}</text>`,
    )
  }

  return parts.join('\n')
}

/**
 * 拍号 → SVG 分数：数字上下正对，中间一条横线（传统拍号记法）。
 * 几何（adj 调整）：横线 = 调式文字垂直中心（基线 - 0.35×字号）；
 * 分子底部与分母顶部距横线各 2px（分子底≈基线+0.05em，分母顶≈基线-0.85em）。
 * 支持多个拍号（空格分隔，如 "4/4 (2/4)"）：首个为主拍号（mSize），
 * 括号内为辅助拍号（mSize-3，两侧带括号）；无法解析的片段按文本原样渲染。
 * 字体/字号跟随描述头设置（adj45：miaoshu_font/miaoshu_size）。
 */
function renderMeterMeta(meter: string, x: number, baseline: number, mFont: string, mSize: number): string {
  const parts = meter.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let gx = 0
  const auxSize = Math.max(8, mSize - 3)
  for (const part of parts) {
    const m = /^\(?(\d+)\s*\/\s*(\d+)\)?$/.exec(part)
    if (!m) {
      out.push(
        `<text x="${x + gx}" y="${baseline}" font-size="${mSize}" font-family="${mFont}" fill="#1b1b1b">${xmlEsc(part)}</text>`,
      )
      gx += part.length * 7 + 8
      continue
    }
    const aux = part.startsWith('(')
    const size = aux ? auxSize : mSize
    const num = m[1]
    const den = m[2]
    const cx = x + gx
    // 分数半宽：按数字位数估算，两侧略留白
    const halfW = Math.max(num.length, den.length) * size * 0.32 + 1.5
    // 横线 = 调式文字垂直中心；分子/分母距线各 2px
    const lineY = baseline - size * 0.35
    const numY = lineY - 2 - size * 0.05
    const denY = lineY + 2 + size * 0.85
    const frac =
      `<text x="${cx}" y="${numY.toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${mFont}" fill="#1b1b1b">${num}</text>` +
      `<line x1="${(cx - halfW).toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${(cx + halfW).toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="#1b1b1b" stroke-width="1.1"/>` +
      `<text x="${cx}" y="${denY.toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${mFont}" fill="#1b1b1b">${den}</text>`
    if (aux) {
      out.push(
        `<text x="${(cx - halfW - 5).toFixed(1)}" y="${(baseline + 2).toFixed(1)}" font-size="${auxSize}" font-family="${mFont}" fill="#1b1b1b">(</text>` +
          frac +
          `<text x="${(cx + halfW + 5).toFixed(1)}" y="${(baseline + 2).toFixed(1)}" font-size="${auxSize}" font-family="${mFont}" fill="#1b1b1b">)</text>`,
      )
      gx += halfW * 2 + 16
    } else {
      out.push(frac)
      gx += halfW * 2 + 10
    }
  }
  return `<g data-meta="meter" data-meter="${xmlEsc(meter)}">${out.join('')}</g>`
}

// ============================================================
// 音符绘制
// ============================================================

function renderNote(note: PlacedToken, config: PageConfig): string {
  const t = note.token
  const size = config.note_size
  const digitW = size * 0.62 // 数字槽宽（随字号）
  const x = note.x
  const y = note.y
  const parts: string[] = []
  const nid = noteposId(note.id)
  const font = noteFont(config.shuzi_font)
  // adj69：修饰符缩放因子（18 号字 = 1；字号调大后八度点/附点/增时线/倚音等同比率放大）
  const s = noteScaleOf(size)

  // 隐藏休止符 8：不绘制（占位）
  if (t.kind === 'rest' && t.hidden) return ''

  // 变音符号（数字左侧上方，随字号）
  if (t.kind === 'note' && t.accidental) {
    const sym = t.accidental === '#' ? '#' : t.accidental === '$' ? 'b' : '♮'
    parts.push(
      `<text x="${x - 7 * s}" y="${y - 10 * s}" font-size="${r1n(12 * s)}" font-family="${font}" fill="#1b1b1b">${sym}</text>`,
    )
  }

  // 高低音点（adj60 层级化：高音点层贴数字顶、低音点层贴数字底/减时线层底，层内间距 INNER_GAP×s）
  const oct = t.kind === 'note' ? t.octaveShift : 0
  if (oct !== 0) {
    const n = Math.abs(oct)
    // 数字槽宽中心：高音点左移 1px×s（adj19）；低音点不偏移（adj22：原左移 1 再右移 1）
    const dotCx = x + digitW / 2 - (oct > 0 ? s : 0)
    const dc = t.diminishCount
    for (let i = 0; i < n; i++) {
      const cy = oct > 0 ? octaveDotY(y, i, size) : lowDotY(y, i, dc, size)
      parts.push(`<circle cx="${dotCx}" cy="${r1n(cy)}" r="${r1n(DOT_R * s)}" fill="#1b1b1b"/>`)
    }
  }

  // 数字主体（含 notepos 契约；虚音符 (1) 两侧加小括号，adj23；字号随字号）
  const glyph = t.kind === 'rest' ? '0' : t.kind === 'rhythm' ? 'X' : String(t.pitch)
  if (t.kind === 'note' && t.ghost) {
    parts.push(
      `<text x="${x - 5 * s}" y="${y}" font-size="${r1n(13 * s)}" font-family="${font}" fill="#1b1b1b">(</text>`,
      `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
      `<text x="${x + digitW + s}" y="${y}" font-size="${r1n(13 * s)}" font-family="${font}" fill="#1b1b1b">)</text>`,
    )
  } else {
    parts.push(
      `<text x="${x}" y="${y}" data-notepos="${nid}" font-size="${size}" font-family="${font}" font-weight="bold" fill="#1b1b1b">${glyph}</text>`,
    )
  }

  // 倚音（adj23/65/97/98/99/100/101）：前倚音 [65] 排于主音符左上角、后倚音 [h65] 排于右上角
  // 规范（用户 2026-08-22 + adj100/101 调整）：
  //  ① 倚音字号 = 主音符 × 0.4（adj101 由 0.3 调大），**不加粗**（与主音符粗体区分）；
  //  ② 倚音减时线 = 实际时值 +1 条（2[3] → 1 条、2[3/] → 2 条），线**更细**（0.6）、
  //     间距固定 1.2px（adj100 由 1.8px 减小）；
  //  ③ 第一条减时线与主音符文本上端对齐（= mainTop，adj100）；数字底距首条线 2px，
  //     adj101 数字整体下移 1.5px（数字底距线 0.5px）；
  //  ④ 低八度点紧贴该音符最后一条减时线下方，间距规则同主音符
  //     （线底 + LAYER_GAP×s + DOT_R×s = 圆心，层内点距 INNER_GAP×s，adj101）；
  //  ⑤ 无论几个倚音，只有**一条弧线**：起点 = 组中心正下方（减时线下方），
  //     控制点 = 起点正下方 → 前倚音**先向下再弯向右**、后倚音**先向下再弯向左**
  //     （二次贝塞尔抛物线，adj101 由 1/4 圆弧改——圆弧无法从正下先竖直向下弯向侧边）
  if (t.kind === 'note' && t.gracenotes && t.gracenotes.notes.length > 0) {
    const gn = t.gracenotes
    const gSize = Math.max(6, size * 0.4) // ①倚音字号 = 主音符 × 0.4（下限 6px 防过小）
    const gW = gSize * 0.62 // 每个倚音数字占宽（同数字槽宽比例）
    const gs = gSize / 18 // 倚音缩放因子（高低音点/间距随倚音字号缩放）
    const mainTop = y - size * DIGIT_HEIGHT_RATIO // 主音符文本上端（adj100 = 第一条减时线位置）
    // ③ 数字底 = 首条减时线上方 2px → 基线 = mainTop - 2 - 字号/9；adj101 下移 1.5px
    const gBaseY = mainTop - 0.5 - gSize / 9
    // 数字水平排列：前倚音从主音符左上角向左依次排；后倚音从主音符右上角向右依次排
    const gxs: number[] = []
    for (let gi = 0; gi < gn.notes.length; gi++) {
      gxs.push(gn.after ? x + digitW + 1 * s + gi * gW : x - 1 * s - (gn.notes.length - gi) * gW)
    }
    const gy = gBaseY // 同基线（水平排列）
    // 组范围（数字区）：组首 x、组尾 x
    const gx1 = Math.min(...gxs)
    const gx2 = Math.max(...gxs) + gW
    // ② 减时线参数：首条 = mainTop（与主音符文本上端对齐），间距固定 1.2px
    const maxDim = Math.max(0, ...gn.notes.map((g) => g.diminishCount + 1))
    const beamGap = 1.2
    const beamTop = mainTop
    for (let gi = 0; gi < gn.notes.length; gi++) {
      const g = gn.notes[gi]
      const gx = gxs[gi]
      // 小高低音点（规则同主音符，以倚音字号为参照）
      if (g.octaveShift !== 0) {
        const cx = gx + gW / 2
        const n = Math.abs(g.octaveShift)
        for (let d = 0; d < n; d++) {
          const cy =
            g.octaveShift > 0
              ? octaveDotY(gy, d, gSize)
              : // ④ 低八度点：该音符最后一条减时线底（线中心 + 半线高 0.3）+ LAYER_GAP×s + DOT_R×s
                beamTop + g.diminishCount * beamGap + 0.3 + (LAYER_GAP + DOT_R) * gs + d * (DOT_R * 2 + INNER_GAP) * gs
          parts.push(`<circle cx="${r1n(cx)}" cy="${r1n(cy)}" r="${r1n(DOT_R * gs)}" fill="#1b1b1b"/>`)
        }
      }
      // 变音
      if (g.accidental) {
        const sym = g.accidental === '#' ? '#' : g.accidental === '$' ? 'b' : '♮'
        parts.push(
          `<text x="${gx - 3.5 * s}" y="${gy - 6 * s}" font-size="${r1n(8 * s)}" font-family="${font}" fill="#1b1b1b">${sym}</text>`,
        )
      }
      // ①数字：不加粗（与主音符粗体区分）
      parts.push(
        `<text x="${gx}" y="${gy}" font-size="${gSize}" font-family="${font}" fill="#1b1b1b">${g.pitch}</text>`,
      )
    }
    // ②减时线（跨组平行横线）：实际时值 +1 条；线更细 0.6、间距固定 1.2px
    for (let d = 0; d < maxDim; d++) {
      const ly = beamTop + d * beamGap
      parts.push(
        `<line x1="${r1n(gx1)}" y1="${r1n(ly)}" x2="${r1n(gx2)}" y2="${r1n(ly)}" stroke="#1b1b1b" stroke-width="0.6"/>`,
      )
    }
    // ⑤ 一条弧线（二次贝塞尔 = 抛物线）：起点 = 组中心正下方（最后一条减时线下方 2px），
    //    控制点 = 起点正下方（起点切线竖直向下）→ 先向下再弯向主音符；终点比起点低 arcDrop
    const gcx = (gx1 + gx2) / 2 // 倚音组中心 x
    const arcStartY = beamTop + (maxDim - 1) * beamGap + 2 // 弧线起点（减时线下方）
    const arcDrop = 3 * s // 终点比起点低（垂度）
    const arcW = 0.6 // 弧线宽 = 减时线宽
    if (gn.after) {
      // 后倚音（组在右）：终点 = 主音符右缘下方 → 先向下再弯向左
      parts.push(
        `<path d="M ${r1n(gcx)} ${r1n(arcStartY)} Q ${r1n(gcx)} ${r1n(arcStartY + arcDrop)} ${r1n(x + digitW)} ${r1n(arcStartY + arcDrop)}" fill="none" stroke="#1b1b1b" stroke-width="${arcW}"/>`,
      )
    } else {
      // 前倚音（组在左）：终点 = 主音符数字左缘（= x）下方 → 先向下再弯向右
      parts.push(
        `<path d="M ${r1n(gcx)} ${r1n(arcStartY)} Q ${r1n(gcx)} ${r1n(arcStartY + arcDrop)} ${r1n(x)} ${r1n(arcStartY + arcDrop)}" fill="none" stroke="#1b1b1b" stroke-width="${arcW}"/>`,
      )
    }
  }

  // 附点（adj71）：附点是音符的修饰符——增加前面音符一半时值（1. 总宽 1.5 拍、1/. 0.75 拍，
  // tokenDuration 已按 ×1.5/×1.75 计算，占位宽度随之增半）；
  // 附点小圆点紧接在修饰音符（数字）后面，半径 DOT_R_DOT（随字号缩放）
  let dotRight = 0 // 附点右端（adj58：供 &ykh 右括号定位）
  if (t.dots > 0) {
    const rDot = DOT_R_DOT * s
    for (let i = 0; i < t.dots; i++) {
      // 第 i 个附点：紧贴数字右缘（第 2 个起紧贴前一个）
      const cx = x + digitW + rDot + i * rDot * 2
      // 垂直居中于数字（数字视觉中心 ≈ 基线-0.4×字号）
      parts.push(`<circle cx="${r1n(cx)}" cy="${r1n(y - size * 0.4)}" r="${r1n(rDot)}" fill="#1b1b1b"/>`)
      dotRight = Math.max(dotRight, cx + rDot)
    }
  }

  // 增时线（"-" 各占一拍的位置，每根在所在拍段占位宽度内居中；
  // adj35：第 i 条增时线在第 i+1 拍段；adj73：垂直居中于音符数字（数字中心 = 基线-0.4×字号））
  const augY = y - size * 0.4
  let augRight = 0 // 增时线右端（adj58：供 &ykh 右括号定位）
  if (t.augmentCount > 0) {
    const seg0 = note.segments?.[0]
    const pb0 = seg0 ? seg0.perBeat : note.duration > 0 ? note.width / note.duration : digitW
    const segStart0 = seg0 ? seg0.x : x + 6 - Math.min(note.duration, 1) * (pb0 / 2)
    for (let i = 0; i < t.augmentCount; i++) {
      const seg = note.segments?.[i + 1]
      const beatStart = seg ? seg.x : segStart0 + (1 + i) * pb0
      const pb = seg ? seg.perBeat : pb0
      const lx = r1n(beatStart + (pb - digitW) / 2)
      // adj73："-" 字符随音符字号；dominant-baseline=central 使字符垂直居中于数字中心；
      // text-anchor=middle 使字符在占位宽（digitW）内居中；adj76：加粗与数字一致
      parts.push(
        `<text x="${r1n(lx + digitW / 2)}" y="${augY}" text-anchor="middle" dominant-baseline="central" font-weight="bold" font-size="${size}" font-family="${font}" fill="#1b1b1b">-</text>`,
      )
      augRight = Math.max(augRight, lx + digitW)
    }
  }

  // 装饰符号（& 编码，M7d）：tr 颤音带波浪线，其余画上方小文本；
  // adj58：&zkh 在音符前画 (、&ykh 在音符块（数字/增时线/附点）之后画 )
  // adj60：上方装饰层从「高八度点层顶（无高八度则数字顶）」往上，按书写顺序逐层排（层间距 LAYER_GAP×s）
  // adj84：休止符/节奏符也支持括号（0&zkh 左括号、0-&ykh 右括号）
  if (t.symbols.length > 0) {
    // 音符块右端（含增时线/附点右端，供 &ykh 定位）
    const blockRight = Math.max(x + digitW, dotRight, augRight)
    // 当前已占用的上方层顶（高八度点层顶优先；无高八度点则为数字顶）
    let aboveTop = oct > 0 ? octaveTopY(y, Math.abs(oct), size) : y - size * DIGIT_HEIGHT_RATIO
    const SYM_FS = Math.round(10 * s) // 装饰符号字号（随字号）
    for (const sym of t.symbols) {
      if (sym === 'zkh') {
        // 左括号：音符数字左侧；
        // adj80：括号字符宽约 0.5em（同字号下），左移 半字宽+1px 保证与数字间距 ≥1px
        // adj81：加粗 + 垂直居中于数字（dominant-baseline=central @ 数字中心 基线-0.4×字号）；
        // adj82：字体字号与音符一致（size、font、加粗同数字）
        parts.push(
          `<text x="${r1n(x - 10 * s)}" y="${r1n(y - size * 0.4)}" dominant-baseline="central" font-weight="bold" font-size="${size}" font-family="${font}" fill="#1b1b1b">(</text>`,
        )
      } else if (sym === 'ykh') {
        // 右括号：音符块之后（数字/增时线/附点右端 + 1px×s）
        // adj81：加粗 + 垂直居中于数字；adj82：字体字号与音符一致
        parts.push(
          `<text x="${r1n(blockRight + s)}" y="${r1n(y - size * 0.4)}" dominant-baseline="central" font-weight="bold" font-size="${size}" font-family="${font}" fill="#1b1b1b">)</text>`,
        )
      } else {
        // 上方符号：文字底 = aboveTop - LAYER_GAP×s；基线 = 底 - descender
        const symY = aboveTop - LAYER_GAP * s - SYM_FS * DESC_RATIO
        if (sym === 'tr') {
          parts.push(
            `<text x="${x}" y="${r1n(symY)}" font-size="${SYM_FS}" font-style="italic" font-family="${FONT_CN}" fill="#1b1b1b">tr</text>`,
          )
          parts.push(wavePath(x + 16 * s, symY - 6 * s, x + 34 * s))
        } else {
          parts.push(
            `<text x="${x}" y="${r1n(symY)}" font-size="${SYM_FS}" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(sym)}</text>`,
          )
        }
        // 更新层顶：文字顶 = 基线 - ascent（0.8×字号）
        aboveTop = symY - SYM_FS * DIGIT_HEIGHT_RATIO
      }
    }
  }

  // 减时线由 computeBeams 按拍分组绘制（M3：同一拍内相连）
  // 音符备注（引号注释，adj62）—— 字号 = 音符字体高度的一半（0.5×note_size）；
  // 置于上方最高层之上（高八度点/装饰符号之后），数字中心居中
  if (t.comment) {
    const cfs = Math.max(7, Math.round(size * NOTE_COMMENT_FONT_RATIO))
    // 注释层顶：装饰符号处理后的层顶（无符号则高八度点层顶/数字顶）
    let aboveTop = y - size * DIGIT_HEIGHT_RATIO
    if (oct > 0) aboveTop = octaveTopY(y, Math.abs(oct), size)
    if (t.symbols.length > 0) {
      const SYM_FS = Math.round(10 * s)
      const nTop = t.symbols.filter((s) => s !== 'zkh' && s !== 'ykh').length
      aboveTop -= nTop * (SYM_FS * (DIGIT_HEIGHT_RATIO + DESC_RATIO) + LAYER_GAP * s)
    }
    const base = aboveTop - LAYER_GAP * s - cfs * DESC_RATIO // 注释文字底距上层元素顶 LAYER_GAP×s
    parts.push(
      `<text x="${r1n(x + digitW / 2)}" y="${r1n(base)}" text-anchor="middle" font-size="${cfs}" font-family="${FONT_CN}" fill="#555">${xmlEsc(t.comment)}</text>`,
    )
  }

  return parts.join('\n')
}

// ============================================================
// 小节线绘制
// ============================================================

function renderBarline(bar: PlacedBarline, noteSize = 18): string {
  // 纯跳房子起点（] 后连续 [ 或行首）：只承载跳房子线，不画小节线竖线（adj26）
  if (bar.voltaOnly) return ''
  const { x, yTop, yBottom } = bar
  const parts: string[] = []
  const h = (yBottom - yTop).toFixed(1)
  const draw = (off: number, w: number) =>
    `<rect x="${x + off}" y="${yTop}" width="${w}" height="${h}" fill="#1b1b1b"/>`
  // adj69：小节线高度/反复点随曲部字号缩放（线宽与占位保持，避免布局占位连锁变化）
  const s = noteScaleOf(noteSize)
  // 反复点（r=1.5×s，adj58 调小），off 为相对中心 x 的偏移；垂直对称于小节线中心 ±4×s
  const dots = (off: number) => {
    const midY = (yTop + yBottom) / 2
    return (
      `<circle cx="${x + off}" cy="${(midY - 4 * s).toFixed(1)}" r="${r1n(1.5 * s)}" fill="#1b1b1b"/>` +
      `<circle cx="${x + off}" cy="${(midY + 4 * s).toFixed(1)}" r="${r1n(1.5 * s)}" fill="#1b1b1b"/>`
    )
  }

  switch (bar.type) {
    case '|':
      parts.push(draw(-0.55, 1.1))
      break
    case '||':
      // 双小节线：左细线右粗线（细 1.1、粗 1.8），间距 1px（adj55）
      parts.push(draw(-1.95, 1.1), draw(0.15, 1.8))
      break
    case '||/':
      // 双小节线（双细线）：间距 1px（adj55）
      parts.push(draw(-1.6, 1.1), draw(0.5, 1.1))
      break
    case '||:':
      // 双细线 + 右 :（线距 1px、线点距 1.5px，adj55/58）
      parts.push(draw(-1.6, 1.1), draw(0.5, 1.1), dots(4.6))
      break
    case '|:':
      // 左反复线：左粗线、中细线、右 :，线距 1px、线点距 1.5px（adj55/58）
      parts.push(draw(-4.5, 1.8), draw(-1.7, 1.1), dots(2.4))
      break
    case ':|':
      // 右反复线：左 :、中细线、右粗线，点线距 1.5px、线距 1px（adj55/58）
      parts.push(dots(-2.4), draw(0.6, 1.1), draw(2.7, 1.8))
      break
    case ':|:':
      // 两边反复线：: 细线 粗线 细线 :，线距 1px、线点距 1.5px（adj55/58）
      parts.push(dots(-4.5), draw(-1.5, 1.1), draw(0.6, 1.8), draw(2.4, 1.1), dots(7.5))
      break
    case '|/':
    case '|*':
      // 隐藏小节线：不绘制
      break
  }

  // 小节线备注；adj67：|"P:2/4" 临时节拍 → 小节线右侧画分数（上下数字+横线，整体高度与小节线等高，随字号 adj69）
  // adj86：|"p:2/4" 与 |"P:2/4" 等效（大小写不敏感）
  if (bar.comment) {
    const pm = /^p:\s*(\d+)\s*\/\s*(\d+)$/i.exec(bar.comment)
    if (pm) {
      const size = Math.round(10 * s) // 分数字号：总高 ≈ 小节线高，随字号
      const halfW = Math.max(pm[1].length, pm[2].length) * size * 0.32 + 1.5 * s
      const midY = (yTop + yBottom) / 2
      const lineY = midY - s // 横线略上移，使分数整体居中于小节线
      const numY = lineY - 2 * s - size * 0.05
      const denY = lineY + 2 * s + size * 0.85
      // 分数中心：左缘 = 小节线右缘 + 2px×s（adj68：左右留空），即 fx = 右缘 + 2s + halfW
      const fx = x + ({ '|': 0.55, '||': 1.95, '||/': 1.6, '|:': 4.2, ':|': 4.2, ':|:': 8.1, '||:': 3.85, '|*': 0.55, '|/': 0.55 }[bar.type] ?? 0.55) + 2 * s + halfW
      parts.push(
        `<text x="${fx.toFixed(1)}" y="${numY.toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${FONT_CN}" fill="#1b1b1b">${pm[1]}</text>` +
          `<line x1="${(fx - halfW).toFixed(1)}" y1="${lineY.toFixed(1)}" x2="${(fx + halfW).toFixed(1)}" y2="${lineY.toFixed(1)}" stroke="#1b1b1b" stroke-width="1"/>` +
          `<text x="${fx.toFixed(1)}" y="${denY.toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${FONT_CN}" fill="#1b1b1b">${pm[2]}</text>`,
      )
    } else {
      parts.push(
        `<text x="${x}" y="${yBottom + 13}" text-anchor="middle" font-size="10" font-family="${FONT_CN}" fill="#333">${xmlEsc(bar.comment)}</text>`,
      )
    }
  }

  return parts.join('\n')
}

// ============================================================
// 歌词绘制
// ============================================================

function renderLyric(lyric: PlacedLyric, config: PageConfig): string {
  const size = config.geci_size
  const cid = noteposId(lyric.id)
  // adj71：歌词字宽 > 对应音符占位宽 **且** 相邻歌词间距 < 字宽（任一侧密集会重叠）时，
  // 横向缩窄歌词字：缩窄到 min(槽宽, 相邻间距−1)（预留 ≥1px 间距避免文字粘黏；下限 0.5）；
  // 缩放以歌词中心为基准——左缘平移 size×(1-sx)/2，使中心仍对中音符槽中心
  const gap = lyric.gapL ?? Infinity
  const need = !!lyric.slotW && lyric.slotW < size && gap < size
  const sx = need ? Math.max(Math.min(lyric.slotW!, gap - 1) / size, 0.5) : 1
  const parts = [
    // 字以 x 为左边缘，中心 = x + 字号/2（对中音符槽中心，adj40）；横向缩放时中心保持对齐
    sx < 1
      ? `<text x="0" y="${lyric.y}" transform="translate(${r1n(lyric.x + (size * (1 - sx)) / 2)},0) scale(${sx.toFixed(3)},1)" data-cipos="${cid}" font-size="${size}" font-family="${config.geci_font}" fill="#101010">${xmlEsc(lyric.char.text)}</text>`
      : `<text x="${lyric.x}" y="${lyric.y}" data-cipos="${cid}" font-size="${size}" font-family="${config.geci_font}" fill="#101010">${xmlEsc(lyric.char.text)}</text>`,
  ]
  // 引号注释（adj58）：双引号文本显示在「注释后面的歌词」前面，不占歌词对齐位（灰色小字）
  if (lyric.char.note) {
    const noteSize = Math.max(9, Math.round(size * COMMENT_FONT_RATIO))
    // 宽度估算：汉字按 1 字宽、拉丁/数字按 0.55 字宽
    const w = [...lyric.char.note].reduce(
      (acc, ch) => acc + (/\p{Script=Han}/u.test(ch) ? noteSize : noteSize * 0.55),
      0,
    )
    parts.unshift(
      `<text x="${r1n(lyric.x - w - 3)}" y="${lyric.y}" font-size="${noteSize}" font-family="${config.geci_font}" fill="#999">${xmlEsc(lyric.char.note)}</text>`,
    )
  }
  // 中文标点不占音符位，紧跟本字之后独立渲染（adj35/40）——
  // 分开渲染避免标点并入后整个文本视觉中心偏移、与音符失中
  if (lyric.char.trailing) {
    parts.push(
      `<text x="${r1n(lyric.x + size + 1)}" y="${lyric.y}" font-size="${size}" font-family="${config.geci_font}" fill="#101010">${xmlEsc(lyric.char.trailing)}</text>`,
    )
  }
  return parts.join('\n')
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
function renderVoltaLine(start: PlacedBarline, end: PlacedBarline | null, noteSize = 18): string {
  const plus = start.voltaStart?.plus ?? 0
  // adj60：跳房子线基于小节线定位（距小节线上端 VOLTA_BAR_GAP，+ 修饰每级 VOLTA_RAISE）
  const y = start.yTop - VOLTA_BAR_GAP - plus * VOLTA_RAISE
  // 起止偏移（adj50）：起点 = 小节线正中右移 2px、终点 = 小节线正中左移 2px
  const x1 = start.x + 2
  const x2 = end ? end.x - 2 : start.x + 60
  const openEnd = !end || !!end.voltaEndSlash // 开口结束：无终点折线（adj26）
  const parts: string[] = []
  // 起点竖线（[ 处：从线高向下到小节线上端上方 2px，adj29；adj59 线宽 1；adj76：下沿下延 2px）
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x1}" y2="${start.yTop - 2}" stroke="#1b1b1b" stroke-width="1"/>`,
  )
  // 水平线（adj59 线宽 1）
  parts.push(
    `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1b1b1b" stroke-width="1"/>`,
  )
  // 终点折线（] 处：向下到小节线上端上方 2px，adj29；开口结束不画；adj59 线宽 1；adj76：下沿下延 2px）
  if (end && !openEnd) {
    parts.push(
      `<line x1="${x2}" y1="${y}" x2="${x2}" y2="${end.yTop - 2}" stroke="#1b1b1b" stroke-width="1"/>`,
    )
  }
  // 番号（[ 后引号注释优先；小节线引号备注兼容）显示在跳房子线下方（adj27/28）；
  // adj71：字号 = 音符高度的 0.5（VOLTA_COMMENT_FONT_RATIO），随音符字号
  // adj77：注释相对起点竖线 左上移 2px（x=x1+2、y=线+8）
  const label = start.voltaStart?.comment ?? start.comment
  if (label) {
    const lfs = Math.max(8, Math.round(noteSize * VOLTA_COMMENT_FONT_RATIO))
    parts.push(
      `<text x="${x1 + 2}" y="${y + 8}" font-size="${lfs}" font-family="${FONT_CN}" fill="#1b1b1b">${xmlEsc(label)}</text>`,
    )
  }
  return parts.join('\n')
}

/** 渲染页内全部跳房子线（配对 [ ]；未闭合 [ 向右延伸） */
function renderVoltas(barlines: PlacedBarline[], noteSize = 18): string {
  const parts: string[] = []
  let open: PlacedBarline | null = null
  for (const bar of barlines) {
    if (bar.voltaStart && !open) {
      open = bar
    } else if (bar.voltaEnd && open) {
      parts.push(renderVoltaLine(open, bar, noteSize))
      open = null
    }
  }
  if (open) parts.push(renderVoltaLine(open, null, noteSize))
  return parts.join('\n')
}

// ============================================================
// 连音线绘制（M7c）
// ============================================================

function renderSlur(s: PlacedSlur, noteSize = 18): string {
  const { x1, x2, y } = s
  // 平均连音组标注（adj43）：仅 (y...) 组在弧线/横线正中画数字（不透明背景）；
  // 普通连音线 (…) 不标注。数字向下偏移 2px 使其居于线正中。
  // adj89：数字字号 = 音符字号 × TUPLET_NUM_RATIO（默认 0.2，可调常量）
  const label = (cx: number, cy: number): string => {
    if (!s.tupletCount || s.tupletCount < 2) return ''
    const size = Math.max(7, Math.round(noteSize * TUPLET_NUM_RATIO))
    const text = String(s.tupletCount)
    const w = Math.max(14, text.length * 7 + 3)
    const dy = 2 // 数字下移 2px → 位于线正中
    return (
      `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - size + 1 + dy).toFixed(1)}" width="${w.toFixed(1)}" height="${size}" rx="2" fill="#ffffff"/>` +
      `<text x="${cx.toFixed(1)}" y="${(cy + dy).toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${FONT_CN}" fill="#1b1b1b">${text}</text>`
    )
  }
  if (s.style === 'flat') {
    // 平顶（adj89）：横线在上（y-leg），两端从音符处**圆弧过渡**到平顶线
    // （adj94：两端是明显的弧线而非直坡面——从音符竖直上弯，用三次贝塞尔
    //   控制点让曲线外凸（弧线感），到横线处水平切入；非此前近直线的缓坡）
    // adj96：嵌套内层（depth>0）连音线高度少 1px（横线更贴音符，层次更分明）
    const leg = 7 - (s.depth > 0 ? 1 : 0)
    const barY = y - leg
    // 弧线水平跨度：取音符间距的一半内合理值，短连音线自动收窄
    const halfL = Math.min(16, Math.abs(x2 - x1) / 2 - 1)
    // 弧线控制点：c1 竖直偏右（从音符向上弯的起点）、c2 横线左侧（水平进入）
    // 竖直分量 leg×0.9、水平分量 halfL×0.45 → 曲线外凸明显，呈圆弧而非坡面
    const c1x = x1 + halfL * 0.45
    const c1y = y - leg * 0.9
    const c2x = x1 + halfL - 3
    if (s.half === 'l') {
      // 左半部：从音符（x1,y）弧线升到平顶线，横线右伸（右侧开口）
      return (
        `<path d="M ${x1} ${y} ` +
        `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${barY} ${(x1 + halfL).toFixed(1)} ${barY} ` +
        `L ${x2} ${barY}" ` +
        `fill="none" stroke="#1b1b1b" stroke-width="1"/>`
      )
    }
    if (s.half === 'r') {
      // 右半部：横线从左伸来，右端弧线降到音符（左侧开口）
      return (
        `<path d="M ${x1} ${barY} ` +
        `L ${(x2 - halfL).toFixed(1)} ${barY} ` +
        `C ${(x2 - halfL + 3).toFixed(1)} ${barY} ${(x2 - halfL * 0.45).toFixed(1)} ${c1y.toFixed(1)} ${x2} ${y}" ` +
        `fill="none" stroke="#1b1b1b" stroke-width="1"/>`
      )
    }
    // 完整：两端弧线升到平顶线 + 中间横线；正中标连音组数字
    const midX = (x1 + x2) / 2
    return (
      `<path d="M ${x1} ${y} ` +
      `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${barY} ${(x1 + halfL).toFixed(1)} ${barY} ` +
      `L ${(x2 - halfL).toFixed(1)} ${barY} ` +
      `C ${(x2 - halfL + 3).toFixed(1)} ${barY} ${(x2 - halfL * 0.45).toFixed(1)} ${c1y.toFixed(1)} ${x2} ${y}" ` +
      `fill="none" stroke="#1b1b1b" stroke-width="1"/>` +
      label(midX, barY)
    )
  }
  // 圆弧（adj96：嵌套内层 depth>0 高度少 1px，弧线更贴音符）
  const topY = y - (s.depth > 0 ? 3.5 : 4.5) // 弧线最高点（与完整弧线顶点同高）
  if (s.half === 'l') {
    // 左半部：从最低处（x1,y）竖直向上出发，行末为最高点（x2, topY），右侧开口
    return (
      `<path d="M ${x1} ${y} C ${x1} ${(y - 9).toFixed(1)} ${x2} ${topY.toFixed(1)} ${x2} ${topY.toFixed(1)}" ` +
      `fill="none" stroke="#1b1b1b" stroke-width="1"/>`
    )
  }
  if (s.half === 'r') {
    // 右半部：行首为最高点（x1, topY）水平出发，到最低处（x2,y）竖直向下，左侧开口
    return (
      `<path d="M ${x1} ${topY.toFixed(1)} C ${x1} ${topY.toFixed(1)} ${x2} ${(y - 9).toFixed(1)} ${x2} ${y}" ` +
      `fill="none" stroke="#1b1b1b" stroke-width="1"/>`
    )
  }
  // 完整：二次贝塞尔（两端低、中间高）；正中（顶点）标连音组数字
  const midX = (x1 + x2) / 2
  const midY = y - 9
  return (
    `<path d="M ${x1} ${y} Q ${midX} ${midY} ${x2} ${y}" fill="none" stroke="#1b1b1b" stroke-width="1"/>` +
    label(midX, topY)
  )
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
function computeBeams(notes: PlacedToken[], noteSize = 18): Beam[] {
  const beams: Beam[] = []
  const digitW = noteSize * 0.62
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
          x2: r1n(list[j].x + digitW - 1),
          // adj60/69：减时线层贴数字底（LAYER_GAP×s），层内线距 INNER_GAP×s，随字号
          y: r1n(beamY(list[i].y, level, noteSize)),
        })
        i = j + 1
      }
    }
  }
  return beams
}

const r1n = (v: number) => Math.round(v * 10) / 10

/** 供冒烟测试：计算减时线横线组 */
export function computeBeamsForTest(notes: PlacedToken[], noteSize = 18): Beam[] {
  return computeBeams(notes, noteSize)
}

function renderBeams(beams: Beam[]): string {
  return beams
    .map(
      (b) =>
        `<rect x="${b.x1}" y="${b.y}" width="${Math.max(1, b.x2 - b.x1)}" height="1.1" fill="#1b1b1b"/>`,
    )
    .join('\n')
}

// ============================================================
// 页面组装
// ============================================================

/**
 * 页号（adj42）：多页时渲染在页面内、下边距线与页面边沿之间垂直居中
 *  - x = 页面水平中心（text-anchor middle）
 *  - y = 下边距线（height - margin_bottom）与页面底边沿（height）的中点
 *  - 仅多页（pageCount > 1）时输出，与预览页脚行为一致；单页不画
 */
function renderPageNum(page: ScorePage, config: PageConfig, pageCount: number): string {
  if (pageCount <= 1) return ''
  const size = 11
  const bandTop = page.height - config.margin_bottom
  const centerY = (bandTop + page.height) / 2
  const baseline = centerY + size * 0.35
  const label = `第 ${page.index + 1} / ${pageCount} 页`
  return (
    `<text data-pagenum="1" x="${(page.width / 2).toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle" font-size="${size}" font-family="${FONT_CN}" fill="#8a8a8a">${xmlEsc(label)}</text>`
  )
}

function renderPage(page: ScorePage, config: PageConfig, pageCount: number): string {
  const { width, height } = page
  const body: string[] = []

  // 描述头（标题/作者/调号/拍号/节拍）仅第一页显示，后续页面不重复
  if (page.index === 0) body.push(renderMeta(page, config))
  body.push(renderVoltas(page.barlines, config.note_size)) // 跳房子线画在最底层
  for (const s of page.slurs) body.push(renderSlur(s, config.note_size))
  for (const d of page.dynamics) body.push(renderDynamic(d))
  body.push(renderBeams(computeBeams(page.notes, config.note_size)))
  for (const n of page.notes) body.push(renderNote(n, config))
  for (const b of page.barlines) body.push(renderBarline(b, config.note_size))
  for (const l of page.lyrics) body.push(renderLyric(l, config))
  for (const vb of page.voiceBlocks) body.push(renderVoiceBlocks(page, vb))
  body.push(renderPageNum(page, config, pageCount))

  // 说明文字（adj83：S 行，多行；渲染在简谱主体最末尾——最后一页正文下方、下边距线上方，
  // 用描述头字体字号；可拖拽调整位置 metaPos["notes"]，多行从上到下排）
  if (page.index === pageCount - 1 && page.meta.notes.length > 0) {
    const nFont = config.miaoshu_font
    const nSize = config.miaoshu_size
    const p = config.metaPos?.['notes']
    // 默认位置：页面水平居中、下边距线上方 24px 起；metaPos 为相对默认的偏移
    const baseX = width / 2
    const baseY = height - config.margin_bottom - 24
    let ny = p ? baseY + p.y : baseY
    for (let i = 0; i < page.meta.notes.length; i++) {
      const line = page.meta.notes[i]
      const pos = p ? { x: baseX + p.x, y: ny } : { x: baseX, y: ny }
      body.push(
        `<text data-meta="notes" data-notes-line="${i}" x="${r1n(pos.x)}" y="${r1n(pos.y)}" text-anchor="middle" font-size="${nSize}" font-family="${nFont}" fill="#555">${xmlEsc(line)}</text>`,
      )
      ny += nSize * 1.4
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>` +
    body.join('\n') +
    `</svg>`
  )
}

/** 将排版结果渲染为 SVG 页面数组 */
export function renderScoreToSvg(layout: ScoreLayout): string[] {
  return layout.pages.map((p) => renderPage(p, layout.config, layout.pages.length))
}
