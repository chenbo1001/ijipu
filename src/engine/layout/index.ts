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
  LyricChar,
  LyricLine,
  MusicToken,
  NoteToken,
  PageConfig,
  ParseResult,
  PlacedLyric,
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

/** 大调音阶级数 → 半音偏移（1→根音, 2→大二度, ... 7→大七度） */
const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

/** 音级 + 八度 + 变音 → MIDI → 音名（null = 无音高） */
export function pitchToName(
  pitch: NoteToken['pitch'],
  octaveShift: number,
  accidental: NoteToken['accidental'],
  keySemitone: number,
): string | null {
  const accSemis = accidental === '#' ? 1 : accidental === '$' ? -1 : 0
  const degree = DEGREE_SEMITONES[pitch - 1]
  const midi = BASE_MIDI + keySemitone + degree + octaveShift * 12 + accSemis
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
  barlineWidth: number
  titleAreaH: number
}

function metrics(config: PageConfig): LayoutMetrics {
  const noteSize = 18
  return {
    noteSize,
    noteGap: noteSize * 0.22,
    barlineWidth: noteSize * 0.32,
    titleAreaH: config.margin_top + config.body_margin_top + config.biaoti_size * 1.6 + 30,
  }
}

/** 行距配置（支持按页覆盖：config.heights['a'+page] = [quci, cici, ciqu, shengbu]） */
interface Spacing {
  quci: number // 曲下间距
  cici: number // 词下间距
  ciqu: number // 曲上间距
}

function spacingFor(config: PageConfig, page: number): Spacing {
  const h = config.heights?.['a' + page]
  return {
    quci: h?.[0] ?? config.height_quci,
    cici: h?.[1] ?? config.height_cici,
    ciqu: h?.[2] ?? config.height_ciqu,
  }
}

/** 计算一行曲（含歌词行数）占用的总高度 */
function lineHeightOf(config: PageConfig, m: LayoutMetrics, sp: Spacing, lyricRows: number): number {
  return m.noteSize * 1.7 + sp.quci + lyricRows * (config.geci_size + 8 + sp.cici) + sp.ciqu
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
    slotStart: number,
    lyricMaps: Map<number, LyricChar>[],
    geciSize: number,
    sp: Spacing,
  ) => {
    const page = pages[pageIdx]
    const yBottom = r1(yTop + m.noteSize * 1.7)
    let x = config.margin_left
    let slotIndex = slotStart
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
        // 歌词对齐：行底 + 曲下间距 + 行偏移（词下间距）
        lyricMaps.forEach((map, row) => {
          const ch = map.get(slotIndex)
          if (!ch) return
          const lyric: PlacedLyric = {
            id,
            char: ch,
            x: r1(x + w / 2 - geciSize / 2),
            y: r1(yTop + m.noteSize * 1.7 + sp.quci + row * (geciSize + 8 + sp.cici)),
          }
          page.lyrics.push(lyric)
        })
        slotIndex++
        noteCounter++
        x = r1(x + w + m.noteGap)
      }
      // decoration / slur 等 M1a 不占位（后续迭代）
    }
  }

  /** 处理一个曲词组：可能拆成多个视觉行；歌词按槽位对齐 */
  const placeGroup = (groupIndex: number, voice: number, tokens: MusicToken[], lyrics: LyricLine[]) => {
    const widths = tokens.map((t) => tokenWidth(t, m) + m.noteGap)

    // 槽位 = note/rest/rhythm 在 tokens 中的序号
    const slots: number[] = []
    tokens.forEach((t, i) => {
      if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') slots.push(i)
    })

    // 歌词 → 槽位映射（每行词独立）：标点不占槽位（不绘制）；@ 消耗槽位
    const geciSize = config.geci_size
    const lyricMaps: Map<number, LyricChar>[] = lyrics.map((line) => {
      const map = new Map<number, LyricChar>()
      let slot = 0
      for (const ch of line.chars) {
        if (ch.punctuation) continue
        if (ch.skip) {
          slot++
          continue
        }
        map.set(slot, ch)
        slot++
      }
      return map
    })

    let segStart = 0
    let x = config.margin_left
    for (let i = 0; i < widths.length; i++) {
      if (i > segStart && x + widths[i] > rightLimit) {
        // 段起始全局槽位序号 = 该段开始前已放置的槽位数
        const slotStart = slots.filter((s) => s < segStart).length
        const sp = spacingFor(config, pageIndex)
        placeSegment(groupIndex, voice, tokens, segStart, i, pageIndex, y, slotStart, lyricMaps, geciSize, sp)
        // 换行 / 换页
        y += lineHeightOf(config, m, sp, lyrics.length)
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
    const slotStart = slots.filter((s) => s < segStart).length
    const spEnd = spacingFor(config, pageIndex)
    placeSegment(groupIndex, voice, tokens, segStart, tokens.length, pageIndex, y, slotStart, lyricMaps, geciSize, spEnd)
    y += lineHeightOf(config, m, spEnd, lyrics.length)
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
    placeGroup(groupIndex, group.music.voice, group.music.tokens, group.lyrics)
  }

  const configKey = JSON.stringify(config)
  return { pages, config, configKey }
}
