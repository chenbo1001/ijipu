/**
 * engine/layout/index.ts — 排版引擎
 *
 * M1a：单行横向排布、音高映射、坐标精度。
 * M1b：行内自动换行、[fenye] 手动分页、多行纵向排布。
 * M1c：歌词逐字对齐。
 * M5：行距配置化（曲上/曲下/词下）、按页覆盖 heights。
 * M7a：多声部块（Q1/Q2 纵向堆叠、按小节对齐、声部括弧信息）。
 *
 * TODO(M7c)：连音线定位信息
 */
import { PAPER_SIZE } from '../types'
import { tokenDuration } from '../duration'
import type {
  BarlineType,
  LayoutId,
  LyricChar,
  LyricLine,
  MusicGroup,
  MusicToken,
  NoteToken,
  PageConfig,
  ParseResult,
  PlacedLyric,
  PlacedToken,
  ScoreLayout,
  ScorePage,
  ScorePageMeta,
  VoiceBlock,
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
// 排版单元：单声部组 / 多声部块
// ============================================================

interface UnitGroup {
  groupIndex: number
  group: MusicGroup
}

interface Unit {
  groups: UnitGroup[]
  multi: boolean
}

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
      lyrics: [],
      barlines: [],
      voiceBlocks: [],
      slurs: [],
      dynamics: [],
      meta,
    }
    pages.push(page)
    return page
  }
  startPage()

  let pageIndex = 0
  let y = m.titleAreaH // 当前行顶 y

  /** 将 tokens 段排布到指定页/行（x 从 xStart 起；歌词按槽位对齐） */
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
    xStart: number,
  ) => {
    const page = pages[pageIdx]
    const yBottom = r1(yTop + m.noteSize * 1.7)
    let x = xStart
    let slotIndex = slotStart
    let openDyn: { type: 'crescendo' | 'decrescendo'; x: number } | null = null
    const finishDyn = (endX: number) => {
      if (openDyn) {
        page.dynamics.push({ x1: r1(openDyn.x), x2: r1(endX), y: r1(yTop - 26), type: openDyn.type })
        openDyn = null
      }
    }
    for (let i = start; i < end; i++) {
      const token = tokens[i]
      const id: LayoutId = { page: pageIdx, voice, group: groupIndex, index: noteCounter }
      if (token.kind === 'decoration') {
        // 渐强渐弱：< > 起点、! 结束
        if (token.dynamics === 'crescendo' || token.dynamics === 'decrescendo') {
          openDyn = { type: token.dynamics, x }
        } else if (token.dynamics === 'end') {
          finishDyn(x)
        }
        continue
      }
      if (token.kind === 'barline') {
        // 单声部行内小节线（多声部块的小节线由块级统一处理）
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
      // slur 等 M1a 不占位（后续迭代）
    }
    finishDyn(x) // 段尾关闭未闭合的渐强渐弱
  }

  /** 构造单声部组的歌词槽位映射 */
  const buildLyricMaps = (lyrics: LyricLine[], geciSize: number) => {
    void geciSize
    return lyrics.map((line) => {
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
  }

  /** 处理一个单声部组：可能拆成多个视觉行 */
  const placeGroup = (groupIndex: number, voice: number, tokens: MusicToken[], lyrics: LyricLine[]) => {
    const widths = tokens.map((t) => tokenWidth(t, m) + m.noteGap)
    const slots: number[] = []
    tokens.forEach((t, i) => {
      if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') slots.push(i)
    })
    const geciSize = config.geci_size
    const lyricMaps = buildLyricMaps(lyrics, geciSize)

    let segStart = 0
    let x = config.margin_left
    for (let i = 0; i < widths.length; i++) {
      if (i > segStart && x + widths[i] > rightLimit) {
        const slotStart = slots.filter((s) => s < segStart).length
        const sp = spacingFor(config, pageIndex)
        placeSegment(groupIndex, voice, tokens, segStart, i, pageIndex, y, slotStart, lyricMaps, geciSize, sp, config.margin_left)
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
    placeSegment(groupIndex, voice, tokens, segStart, tokens.length, pageIndex, y, slotStart, lyricMaps, geciSize, spEnd, config.margin_left)
    y += lineHeightOf(config, m, spEnd, lyrics.length)
    if (y + m.noteSize * 1.7 > bottomLimit) {
      pageIndex = pages.length
      startPage()
      y = m.titleAreaH
    }
  }

  /** 多声部块：各声部按小节对齐纵向堆叠 */
  const placeVoiceBlock = (unit: Unit) => {
    const geciSize = config.geci_size
    const sp = spacingFor(config, pageIndex)

    // 各声部按小节切分（barline 由块级统一处理）
    const splitByBar = (tokens: MusicToken[]) => {
      const segs: MusicToken[][] = []
      const bars: (Extract<MusicToken, { kind: 'barline' }> | null)[] = []
      let cur: MusicToken[] = []
      for (const t of tokens) {
        if (t.kind === 'barline') {
          segs.push(cur)
          cur = []
          bars.push(t)
        } else {
          cur.push(t)
        }
      }
      if (cur.length) segs.push(cur)
      bars.push(null)
      return { segs, bars }
    }

    const parts = unit.groups.map(({ group }) => {
      const { segs, bars } = splitByBar(group.music.tokens)
      return {
        voice: group.music.voice,
        name: group.music.voiceName,
        segs,
        bars,
        lyricMaps: buildLyricMaps(group.lyrics, geciSize),
        lyricRows: group.lyrics.length,
      }
    })

    const numBars = Math.max(...parts.map((p) => p.segs.length))

    // 小节宽度 = max(各声部该小节内容宽)
    const barWidths: number[] = []
    for (let b = 0; b < numBars; b++) {
      let w = 0
      for (const p of parts) {
        const seg = p.segs[b] ?? []
        const sw = seg.reduce((a, t) => a + tokenWidth(t, m) + m.noteGap, 0)
        w = Math.max(w, sw)
      }
      barWidths.push(w)
    }
    // 块内每声部行高（含歌词）
    const voiceHeights = parts.map((p) => lineHeightOf(config, m, sp, p.lyricRows))
    const blockH = voiceHeights.reduce((a, b) => a + b, 0)

    // 块超宽/超高 → 换行/换页
    if (y + blockH > bottomLimit) {
      pageIndex = pages.length
      startPage()
      y = m.titleAreaH
    }

    const blockY = y
    let voiceY = blockY
    const blockVoices: VoiceBlock['voices'] = []

    for (let vi = 0; vi < parts.length; vi++) {
      const p = parts[vi]
      blockVoices.push({ voice: p.voice, name: p.name })
      let x = config.margin_left
      let slotCounter = 0
      for (let b = 0; b < numBars; b++) {
        const seg = p.segs[b] ?? []
        placeSegment(
          vi, // groupIndex：块内声部序号（id.group 语义）
          p.voice,
          seg,
          0,
          seg.length,
          pageIndex,
          voiceY,
          slotCounter,
          p.lyricMaps,
          geciSize,
          sp,
          x,
        )
        slotCounter += seg.length
        x += barWidths[b]
      }
      voiceY += voiceHeights[vi]
    }

    // 块级小节线：跨所有声部（取第一个含 barline 的声部类型）
    const barTypes: (BarlineType | null)[] = []
    for (let b = 0; b < numBars; b++) {
      let bt: BarlineType | null = null
      for (const p of parts) {
        const bar = p.bars[b]
        if (bar) {
          bt = bar.type
          break
        }
      }
      barTypes.push(bt)
    }
    let xBar = config.margin_left
    for (let b = 0; b < numBars; b++) {
      const bt = barTypes[b]
      if (bt) {
        const id: LayoutId = { page: pageIndex, voice: 0, group: 0, index: barCounter }
        pages[pageIndex].barlines.push({
          id,
          type: bt,
          x: r1(xBar + m.barlineWidth / 2),
          yTop: blockY,
          yBottom: blockY + blockH,
          width: m.barlineWidth,
        })
        barCounter++
      }
      xBar += barWidths[b]
    }

    // 声部括弧信息
    const vb: VoiceBlock = {
      x: r1(config.margin_left - 12),
      yTop: blockY,
      yBottom: blockY + blockH,
      voices: blockVoices,
    }
    pages[pageIndex].voiceBlocks.push(vb)

    y = blockY + blockH
  }

  // ---- 构建排版单元序列（含分页标记） ----
  const events: ({ kind: 'unit'; unit: Unit } | { kind: 'pagebreak' })[] = []
  let cur: UnitGroup[] = []
  let curVoices = new Set<number>()
  const flush = () => {
    if (cur.length > 0) {
      events.push({ kind: 'unit', unit: { groups: cur, multi: curVoices.size > 1 } })
      cur = []
      curVoices = new Set()
    }
  }
  for (const line of result.lines) {
    if (line.kind === 'pagebreak') {
      flush()
      events.push({ kind: 'pagebreak' })
      continue
    }
    if (line.kind !== 'music') continue
    const groupIndex = result.groups.findIndex((g) => g.music === line)
    if (groupIndex === -1) continue
    const group = result.groups[groupIndex]
    const v = group.music.voice
    if (cur.length > 0 && curVoices.has(v)) flush()
    cur.push({ groupIndex, group })
    curVoices.add(v)
  }
  flush()

  // ---- 按事件序列排版 ----
  for (const ev of events) {
    if (ev.kind === 'pagebreak') {
      pageIndex = pages.length
      startPage()
      y = m.titleAreaH
      continue
    }
    const { unit } = ev
    if (unit.multi) {
      placeVoiceBlock(unit)
    } else {
      for (const { groupIndex, group } of unit.groups) {
        placeGroup(groupIndex, group.music.voice, group.music.tokens, group.lyrics)
      }
    }
  }

  // ---- 连音线后处理（M7c）----
  const notesByIndex = new Map<number, PlacedToken>()
  for (const p of pages) for (const n of p.notes) notesByIndex.set(n.id.index, n)

  const slurPairs: { start: number; end: number; depth: number }[] = []
  const sStack: { start: number; depth: number }[] = []
  let gNote = 0
  let lastNote = -1
  for (const line of result.lines) {
    if (line.kind !== 'music') continue
    const group = result.groups.find((g) => g.music === line)
    if (!group) continue
    for (const t of group.music.tokens) {
      if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
        if (sStack.length > 0 && sStack[sStack.length - 1].start === -1) {
          sStack[sStack.length - 1].start = gNote
        }
        lastNote = gNote
        gNote++
      } else if (t.kind === 'slur') {
        if (t.dir === 'open') {
          sStack.push({ start: -1, depth: sStack.length })
        } else {
          const s = sStack.pop()
          if (s && s.start !== -1 && lastNote >= s.start) {
            slurPairs.push({ start: s.start, end: lastNote, depth: s.depth })
          }
        }
      }
    }
  }

  const slurStyle = config.lianyinxian_type === 2 ? ('flat' as const) : ('arc' as const)
  for (const sp of slurPairs) {
    const a = notesByIndex.get(sp.start)
    const b = notesByIndex.get(sp.end)
    if (!a || !b) continue
    if (a.id.page !== b.id.page || Math.abs(a.y - b.y) > 0.1) continue // 跨行/跨页连音线跳过（第一版）
    pages[a.id.page].slurs.push({
      x1: r1(a.x),
      x2: r1(b.x + b.width),
      y: r1(a.y - 22 - sp.depth * 7),
      depth: sp.depth,
      style: slurStyle,
    })
  }

  const configKey = JSON.stringify(config)
  return { pages, config, configKey }
}
