/**
 * engine/layout/index.ts — 排版引擎
 *
 * M1a：单行横向排布、音高映射、坐标精度。
 * M1b：行内自动换行（按页面可用宽度断行）、[fenye] 手动分页、多行纵向排布。
 *
 * TODO(M1c)：歌词逐字对齐（PlacedLyric）
 * TODO(M7)：多声部堆叠、装饰符号定位
 */
import { PAPER_SIZE } from '../types'
import { tokenDuration } from '../duration'
import type {
  LayoutId,
  MusicToken,
  NoteToken,
  PageConfig,
  ParseResult,
  ScoreLayout,
  ScorePage,
  ScorePageMeta,
} from '../types'

// ============================================================
// 音高映射：简谱音级 → 音名（如 C4 / F#5）
// ============================================================

const KEY_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 解析调式字符串（如 "C"、"#F"、"$B"）→ 根音半音偏移（C=0） */
export function parseKey(key: string | undefined): number {
  if (!key) return 0
  const m = /^([#$]?)([A-G])$/.exec(key.trim())
  if (!m) return 0
  const semis = KEY_SEMITONE[m[2]]
  return semis + (m[1] === '#' ? 1 : m[1] === '$' ? -1 : 0)
}

/** 中音 1 的 MIDI 编号（简谱中音 1 = C4 = MIDI 60） */
const BASE_MIDI = 60

/** 音级 + 八度 + 变音 → MIDI → 音名（null = 无音高） */
export function pitchToName(
  pitch: NoteToken['pitch'],
  octaveShift: number,
  accidental: NoteToken['accidental'],
  keySemitone: number,
): string | null {
  const accSemis = accidental === '#' ? 1 : accidental === '$' ? -1 : 0
  const midi = BASE_MIDI + keySemitone + (pitch - 1) + octaveShift * 12 + accSemis
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

// ============================================================
// 布局参数（由页面配置派生）
// ============================================================

interface LayoutMetrics {
  noteSize: number
  noteGap: number
  lineHeight: number
  barlineWidth: number
  titleAreaH: number
}

function metrics(config: PageConfig): LayoutMetrics {
  const noteSize = 18
  return {
    noteSize,
    noteGap: noteSize * 0.22,
    lineHeight: noteSize * 2.6,
    barlineWidth: noteSize * 0.32,
    titleAreaH: config.margin_top + config.body_margin_top + config.biaoti_size * 1.6 + 30,
  }
}

/** 音符元素宽度（不含间距） */
function tokenWidth(t: MusicToken, m: LayoutMetrics): number {
  const size = m.noteSize
  if (t.kind === 'barline') return m.barlineWidth
  const d = t as Extract<MusicToken, { augmentCount: number; dots: number }>
  let w = size * 0.62 // 数字
  w += d.dots * size * 0.32 // 附点
  w += d.augmentCount * size * 0.5 // 增时线
  if (t.kind === 'note' && t.accidental) w += size * 0.42 // 变音符号
  if (t.kind === 'note' && t.symbols.length > 0) w += size * 0.6 // 装饰（粗略占位）
  return w
}

/** 判断 token 是否产生可播放音符（注：隐藏休止符 8 不可发声） */
function toPlayable(t: MusicToken): t is NoteToken {
  return t.kind === 'note'
}

/** 四舍五入到 0.1（消除浮点噪声） */
const r1 = (v: number) => Math.round(v * 10) / 10

// ============================================================
// 主排版函数
// ============================================================

export function layoutScore(result: ParseResult, config: PageConfig): ScoreLayout {
  const paper = PAPER_SIZE[config.page]
  const m = metrics(config)
  const keySemitone = parseKey(result.header.key)
  const rightLimit = paper.width - config.margin_right
  const bottomLimit = paper.height - config.margin_bottom

  const meta: ScorePageMeta = {
    titles: result.header.titles,
    authors: result.header.authors,
    key: result.header.key ?? null,
    meter: result.header.meter ?? null,
    tempo: result.header.tempo ?? null,
  }

  const pages: ScorePage[] = []
  let noteCounter = 0
  let barCounter = 0

  const startPage = () => {
    const page: ScorePage = {
      index: pages.length,
      width: paper.width,
      height: paper.height,
      notes: [],
      lyrics: [], // M1c
      barlines: [],
      meta,
    }
    pages.push(page)
    return page
  }
  startPage()

  let pageIndex = 0
  let y = m.titleAreaH // 当前行顶 y

  /** 将组内 [start, end) 的 tokens 排布到指定页/行的段 */
  const placeSegment = (
    groupIndex: number,
    voice: number,
    tokens: MusicToken[],
    start: number,
    end: number,
    pageIdx: number,
    yTop: number,
  ) => {
    const page = pages[pageIdx]
    const yBottom = r1(yTop + m.noteSize * 1.7)
    let x = config.margin_left
    for (let i = start; i < end; i++) {
      const token = tokens[i]
      const id: LayoutId = { page: pageIdx, voice, group: groupIndex, index: noteCounter }
      if (token.kind === 'barline') {
        page.barlines.push({
          id,
          type: token.type,
          voltaStart: token.voltaStart,
          voltaEnd: token.voltaEnd,
          comment: token.comment,
          x: r1(x + m.barlineWidth / 2),
          yTop,
          yBottom,
          width: m.barlineWidth,
        })
        barCounter++
        x = r1(x + m.barlineWidth + m.noteGap)
        continue
      }
      if (token.kind === 'note' || token.kind === 'rest' || token.kind === 'rhythm') {
        const w = tokenWidth(token, m)
        page.notes.push({
          id,
          token,
          x: r1(x),
          y: r1(yTop + m.noteSize * 1.1), // 数字基线
          width: r1(w),
          duration: tokenDuration(token),
          audioPitch: toPlayable(token)
            ? pitchToName(token.pitch, token.octaveShift, token.accidental, keySemitone)
            : null,
          playable: toPlayable(token),
        })
        noteCounter++
        x = r1(x + w + m.noteGap)
      }
      // decoration / slur 等 M1a 不占位（后续迭代）
    }
  }

  /** 处理一个曲词组：可能拆成多个视觉行 */
  const placeGroup = (groupIndex: number, voice: number, tokens: MusicToken[]) => {
    const widths = tokens.map((t) => tokenWidth(t, m) + m.noteGap)
    let segStart = 0
    let x = config.margin_left
    for (let i = 0; i < widths.length; i++) {
      if (i > segStart && x + widths[i] > rightLimit) {
        placeSegment(groupIndex, voice, tokens, segStart, i, pageIndex, y)
        // 换行 / 换页
        y += m.lineHeight
        if (y + m.noteSize * 1.7 > bottomLimit) {
          pageIndex = pages.length
          startPage()
          y = m.titleAreaH
        }
        segStart = i
        x = config.margin_left
      }
      x += widths[i]
    }
    placeSegment(groupIndex, voice, tokens, segStart, tokens.length, pageIndex, y)
    y += m.lineHeight
    if (y + m.noteSize * 1.7 > bottomLimit) {
      pageIndex = pages.length
      startPage()
      y = m.titleAreaH
    }
  }

  // 按源行顺序遍历：music 行排布，pagebreak 行强制分页
  for (const line of result.lines) {
    if (line.kind === 'pagebreak') {
      pageIndex = pages.length
      startPage()
      y = m.titleAreaH
      continue
    }
    if (line.kind !== 'music') continue
    const groupIndex = result.groups.findIndex((g) => g.music === line)
    if (groupIndex === -1) continue
    const group = result.groups[groupIndex]
    placeGroup(groupIndex, group.music.voice, group.music.tokens)
  }

  const configKey = JSON.stringify(config)
  return { pages, config, configKey }
}
