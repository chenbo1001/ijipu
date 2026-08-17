/**
 * engine/layout/index.ts — 排版引擎
 *
 * 排版原则（细节调整批次 adj1）：
 *  - 时值等宽：音符水平宽度与其拍数成正比（1// 与 1/ 与 1 宽 = 拍数 × 每拍宽）
 *  - 小节均分：一行内所有小节水平等宽（行宽 / 小节数）
 *  - 两端对齐：非最后一行铺满整行；整份谱的最后一行按自然宽左对齐
 *  - 小节内音符按时值（拍数）排布，perBeat = (小节宽 - 边距) / 小节拍数
 *
 * M7a：多声部块（Q1/Q2 纵向堆叠、块内小节等宽、声部括弧信息）。
 */
import { PAPER_SIZE } from '../types'
import { tokenDuration } from '../duration'
import type {
  LayoutId,
  LyricChar,
  LyricLine,
  MusicGroup,
  MusicToken,
  NoteToken,
  PageConfig,
  ParseResult,
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
// 拍号 / 时值等宽参数
// ============================================================

/** 每拍自然宽（px，最后一行/断行预估用） */
const BPW_NATURAL = 14
/**
 * 音符最小占宽（px，adj35）：数字槽宽 11.16 + 最小间距 1px = 12.16。
 * 保证任意相邻音符数字之间至少 1px 空隙。
 */
const MIN_NOTE_W = 12.16
/** 数字槽半宽（与 render 的 NOTE_DIGIT_W/2 一致，歌词/高低音点对齐基准，adj24） */
const HALF_DIGIT_W = 5.58
/** 小节内左右留白（px） */
const BAR_PAD = 6
/**
 * 小节线最小占位空间（px，adj38）：线宽 1.5 + 两侧与音符各 4px = 9.5。
 * 小节线空间 = max(bar_gap, 9.5)，保证小节线与两侧音符至少 4px 间距。
 */
const MIN_BARLINE_SPACE = 9.5
const barlineSpace = (gap: number) => Math.max(gap, MIN_BARLINE_SPACE)

/** 小节所需最小每拍宽：保证拍内任意相邻音符间距 ≥ 最小字符宽（adj13 按拍内最小时值；adj35 间距 1px） */
function segPerBeatMin(seg: BarSeg): number {
  const minDurByBeat = new Map<number, number>()
  let beat = 0
  for (const t of seg.notes) {
    if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
      const dur = tokenDuration(t)
      const b = Math.floor(beat)
      minDurByBeat.set(b, Math.min(minDurByBeat.get(b) ?? Infinity, dur))
      beat += dur
    }
  }
  let minDur = Infinity
  for (const d of minDurByBeat.values()) minDur = Math.min(minDur, d)
  if (!Number.isFinite(minDur)) return BPW_NATURAL
  // 每拍宽 ≥ MIN_NOTE_W / 最小时值：相邻音符间距 = dur×perBeat ≥ MIN_NOTE_W
  return Math.max(BPW_NATURAL, MIN_NOTE_W / minDur)
}

/** 小节自然宽（adj35）：逐拍累加每拍 need（密集拍多占、正常拍 14），断行与拍级挤占一致 */
function segNeedW(seg: BarSeg): number {
  const minDurByBeat = new Map<number, number>()
  let beat = 0
  for (const t of seg.notes) {
    if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
      const dur = tokenDuration(t)
      const b = Math.floor(beat)
      minDurByBeat.set(b, Math.min(minDurByBeat.get(b) ?? Infinity, dur))
      beat += dur
    }
  }
  let w = 0
  for (const d of minDurByBeat.values()) {
    w += d > 0 ? Math.max(BPW_NATURAL, MIN_NOTE_W / d) : BPW_NATURAL
  }
  return w
}

/**
 * 拍级每拍宽分配（adj35 音符间距原则）：
 *  ① 平均分布：正常拍 perBeat = 剩余宽 / 正常拍总时值；
 *  ② 最小间距 1px：每拍 need = max(自然宽 14, 12.16 / 拍内最小时值)；
 *  ③ 超拍挤占：拍宽不足以按最小间距容纳时，该拍固定为 need（宽 = 拍时值 × need），
 *     其余正常拍平均分享剩余宽度（迭代收敛）。
 * 返回每拍 perBeat；总宽 = Σ 拍时值 × perBeat ≈ avail（极端兜底等比压缩不溢出）。
 */
function allocatePerBeats(beats: { dur: number; minDur: number }[], avail: number): number[] {
  const n = beats.length
  if (n === 0) return []
  const need = beats.map((b) =>
    b.minDur > 0 ? Math.max(BPW_NATURAL, MIN_NOTE_W / b.minDur) : BPW_NATURAL,
  )
  const fixed = new Array<boolean>(n).fill(false)
  let pb = avail / Math.max(1e-6, beats.reduce((a, b) => a + b.dur, 0))
  for (let iter = 0; iter <= n; iter++) {
    let fixedW = 0
    let normalDur = 0
    for (let p = 0; p < n; p++) {
      if (fixed[p]) fixedW += beats[p].dur * need[p]
      else normalDur += beats[p].dur
    }
    const pbNew = (avail - fixedW) / Math.max(1e-6, normalDur)
    let changed = false
    for (let p = 0; p < n; p++) {
      if (!fixed[p] && need[p] > pbNew) {
        fixed[p] = true
        changed = true
      }
    }
    pb = pbNew
    if (!changed) break
  }
  const total = beats.reduce((a, bb, p) => a + bb.dur * (fixed[p] ? need[p] : pb), 0)
  if (total > avail && total > 0) {
    const scale = avail / total
    return beats.map((_bb, p) => (fixed[p] ? need[p] * scale : pb * scale))
  }
  return beats.map((_bb, p) => (fixed[p] ? need[p] : pb))
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
    titleAreaH: config.margin_top + config.descAreaH + config.body_margin_top,
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

/** 计算一行曲（含歌词行数）占用的总高度；
 *  无歌词时歌词部空间（曲下间距 quci + 歌词行高）为 0（adj33），减少两曲部间空白 */
function lineHeightOf(config: PageConfig, m: LayoutMetrics, sp: Spacing, lyricRows: number): number {
  return (
    m.noteSize * 1.7 +
    sp.ciqu +
    (lyricRows > 0 ? sp.quci + lyricRows * (config.geci_size + 8 + sp.cici) : 0)
  )
}

/** 判断 token 是否产生可播放音符（注：隐藏休止符 8 不可发声） */
function toPlayable(t: MusicToken): t is NoteToken {
  return t.kind === 'note'
}

/** 四舍五入到 0.1（消除浮点噪声） */
const r1 = (v: number) => Math.round(v * 10) / 10

/** 按小节切分（每小节音符 + 小节后的 barline；行首 barline 在 segs[0].bar） */
interface BarSeg {
  notes: MusicToken[]
  bar: (Extract<MusicToken, { kind: 'barline' }>) | null
}

function splitBars(tokens: MusicToken[]): BarSeg[] {
  const segs: BarSeg[] = []
  let cur: MusicToken[] = []
  for (const t of tokens) {
    if (t.kind === 'barline') {
      segs.push({ notes: cur, bar: t })
      cur = []
    } else {
      cur.push(t)
    }
  }
  if (cur.length > 0) segs.push({ notes: cur, bar: null })
  return segs
}

/** 小节实际拍数（音符时值总和） */
function segBeats(seg: BarSeg): number {
  return seg.notes.reduce(
    (a, t) => a + (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm' ? tokenDuration(t) : 0),
    0,
  )
}

/** 排版行：完整小节行（均分撑满）或小节碎片行（超长小节按拍数拆分） */
type LayoutRow =
  | { kind: 'bars'; start: number; end: number }
  | { kind: 'frag'; segIdx: number; noteStart: number; noteEnd: number }

/** 断行：正常小节按逐拍 need 自然宽断行（adj35：密集拍多占、正常拍 14，与拍级挤占一致）；
 *  超长小节（拍数超行上限）拆为碎片行。 */
function breakRows(segs: BarSeg[], availW: number): LayoutRow[] {
  const rows: LayoutRow[] = []
  let start = 0
  let w = 0 // 当前行逐拍 need 宽累积
  for (let i = 0; i < segs.length; i++) {
    const sb = segBeats(segs[i])
    if (sb > Math.floor((availW - BAR_PAD * 2) / segPerBeatMin(segs[i]))) {
      // 超长小节：flush 当前行，再按音符拍数拆碎片行（拆片上限按密度感知）
      if (i > start) rows.push({ kind: 'bars', start, end: i })
      const maxBeats = Math.max(1, Math.floor((availW - BAR_PAD * 2) / segPerBeatMin(segs[i])))
      let acc = 0
      let noteStart = 0
      const notes = segs[i].notes
      for (let j = 0; j < notes.length; j++) {
        const t = notes[j]
        const dur =
          t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm' ? tokenDuration(t) : 0
        if (acc + dur > maxBeats && j > noteStart) {
          rows.push({ kind: 'frag', segIdx: i, noteStart, noteEnd: j })
          noteStart = j
          acc = 0
        }
        acc += dur
      }
      rows.push({ kind: 'frag', segIdx: i, noteStart, noteEnd: notes.length })
      start = i + 1
      w = 0
    } else {
      const nw = segNeedW(segs[i])
      if (i > start && w + nw > availW) {
        rows.push({ kind: 'bars', start, end: i })
        start = i
        w = nw
      } else {
        w += nw
      }
    }
  }
  if (start < segs.length) rows.push({ kind: 'bars', start, end: segs.length })
  return rows
}

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
  const availW = paper.width - config.margin_left - config.margin_right
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

  /** 歌词 → 槽位映射（每行词独立）：标点不占槽位；@ 消耗槽位 */
  const buildLyricMaps = (lyrics: LyricLine[]): Map<number, LyricChar>[] =>
    lyrics.map((line) => {
      const map = new Map<number, LyricChar>()
      let slot = 0
      let lastSlot = -1 // 最近放置的字（标点挂其后，adj40）
      for (const ch of line.chars) {
        if (ch.punctuation) {
          // 标点不占音符位，紧跟前面的字（跨 @ 占位也跟前面的字）
          if (lastSlot >= 0) {
            const cur = map.get(lastSlot)
            map.set(lastSlot, cur ? { ...cur, trailing: (cur.trailing ?? '') + ch.text } : { ...ch, skip: false, trailing: ch.text })
          }
          continue
        }
        if (ch.skip) {
          slot++
          continue
        }
        map.set(slot, { ...ch }) // 保留解析期挂载的 trailing（adj35：标点紧跟本字渲染）
        lastSlot = slot
        slot++
      }
      return map
    })

  /**
   * 放置一个音符并处理歌词对齐。
   * segStartX = 该音符时值段起点；数字居中于第 1 拍段（增时线占后续每拍）。
   * 返回推进后的拍数。
   */
  const placeNoteAt = (
    t: Extract<MusicToken, { kind: 'note' | 'rest' | 'rhythm' }>,
    segments: { x: number; perBeat: number; beats: number }[],
    yTop: number,
    pageIdx: number,
    groupIndex: number,
    voice: number,
    slotIndex: number,
    lyricMaps: Map<number, LyricChar>[],
    geciSize: number,
    sp: Spacing,
    beatPos: number,
    barIndex: number,
  ) => {
    const dur = tokenDuration(t)
    const first = segments[0] ?? { x: 0, perBeat: BPW_NATURAL, beats: dur }
    const w = Math.max(4, segments.reduce((a, s) => a + s.beats * s.perBeat, 0))
    // 数字中心 = 第 1 拍段中点（增时线"-"各占一拍，从第 2 拍起）
    const nx = first.x + first.beats * (first.perBeat / 2) - 6
    const id: LayoutId = { page: pageIdx, voice, group: groupIndex, index: noteCounter }
    pages[pageIdx].notes.push({
      id,
      token: t,
      x: r1(nx),
      y: r1(yTop + m.noteSize * 1.1),
      width: r1(w),
      duration: dur,
      beatPos,
      barIndex,
      segments,
      audioPitch: toPlayable(t)
        ? pitchToName(t.pitch, t.octaveShift, t.accidental, keySemitone)
        : null,
      playable: toPlayable(t),
    })
    lyricMaps.forEach((map, row) => {
      const ch = map.get(slotIndex)
      if (!ch) return
      // 歌词中心对齐音符数字（数字槽宽中心 = nx + NOTE_DIGIT_W/2，adj24）
      pages[pageIdx].lyrics.push({
        id,
        char: ch,
        x: r1(nx + HALF_DIGIT_W - geciSize / 2),
        y: r1(yTop + m.noteSize * 1.7 + sp.quci + row * (geciSize + 8 + sp.cici)),
      })
    })
    noteCounter++
    return dur
  }

  /** 排布一个曲行（bars：每拍宽按行总拍数平均、小节宽=拍数×每拍宽；frag：超长小节按拍数铺满） */
  const placeMusicRow = (
    segs: BarSeg[],
    row: LayoutRow,
    groupIndex: number,
    voice: number,
    yTop: number,
    lyricMaps: Map<number, LyricChar>[],
    geciSize: number,
    sp: Spacing,
    slotStart: number,
  ) => {
    const page = pages[pageIndex]
    // 小节线高度（adj34）：上端高于音符字体上端 4px，下端低于音符字体下端 4px
    // 音符基线 = yTop + 字号×1.1；数字视觉上端 ≈ 基线-13、下端 ≈ 基线+2
    const barNoteY = yTop + m.noteSize * 1.1
    const yTopBar = r1(barNoteY - 17)
    const yBottomBar = r1(barNoteY + 6)
    let x = config.margin_left
    let slotIndex = slotStart
    let openDyn: { type: 'crescendo' | 'decrescendo'; x: number } | null = null
    const finishDyn = (endX: number) => {
      if (openDyn) {
        page.dynamics.push({ x1: r1(openDyn.x), x2: r1(endX), y: r1(yTop - 26), type: openDyn.type })
        openDyn = null
      }
    }

    if (row.kind === 'frag') {
      // 超长小节碎片行：拍级每拍宽（adj35）
      const seg = segs[row.segIdx]
      const slice = { notes: seg.notes.slice(row.noteStart, row.noteEnd), bar: null }
      const beatsInfo: { dur: number; minDur: number }[] = []
      let fgBeat = 0
      for (const t of slice.notes) {
        if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
          const dur = tokenDuration(t)
          let pos = fgBeat
          let rem = dur
          while (rem > 1e-9) {
            const p = Math.floor(pos)
            while (beatsInfo.length <= p) beatsInfo.push({ dur: 0, minDur: Infinity })
            const piece = Math.min(rem, Math.floor(pos) + 1 - pos)
            beatsInfo[p].dur += piece
            beatsInfo[p].minDur = Math.min(beatsInfo[p].minDur, piece)
            pos += piece
            rem -= piece
          }
          fgBeat += dur
        }
      }
      const perBeats = allocatePerBeats(beatsInfo, availW - BAR_PAD * 2)
      // 段列表（adj36：附点段用基础拍每拍宽）
      const fragSegs: { p: number; piece: number; perBeat: number; note: Extract<MusicToken, { kind: 'note' | 'rest' | 'rhythm' }>; notePos: number }[] = []
      let fgB = 0
      for (const t of slice.notes) {
        if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
          const dur = tokenDuration(t)
          const baseDur = (1 + t.augmentCount) / Math.pow(2, t.diminishCount)
          const notePos = fgB
          let pos = fgB
          let rem = dur
          while (rem > 1e-9) {
            const p = Math.floor(pos)
            const piece = Math.min(rem, Math.floor(pos) + 1 - pos)
            const isDot = pos - notePos >= baseDur - 1e-9
            fragSegs.push({
              p,
              piece,
              perBeat: isDot ? perBeats[Math.max(0, Math.floor(notePos))] : perBeats[p],
              note: t,
              notePos,
            })
            pos += piece
            rem -= piece
          }
          fgB += dur
        }
      }
      const beatW: number[] = new Array(beatsInfo.length).fill(0)
      for (const fs of fragSegs) beatW[fs.p] += fs.piece * fs.perBeat
      const beatStart: number[] = []
      let fAcc = 0
      for (let p = 0; p < beatsInfo.length; p++) {
        beatStart.push(fAcc)
        fAcc += beatW[p]
      }
      // 渲染（逐音符聚合段，段起点逐段累计拍内偏移）
      let curP = -1
      let offInBeat = 0
      let fIdx = 0
      while (fIdx < fragSegs.length) {
        const rs = fragSegs[fIdx]
        const segments: { x: number; perBeat: number; beats: number }[] = []
        while (fIdx < fragSegs.length && fragSegs[fIdx].notePos === rs.notePos) {
          const s = fragSegs[fIdx]
          if (s.p !== curP) {
            curP = s.p
            offInBeat = 0
          }
          segments.push({ x: x + BAR_PAD + beatStart[s.p] + offInBeat, perBeat: s.perBeat, beats: s.piece })
          offInBeat += s.piece * s.perBeat
          fIdx++
        }
        placeNoteAt(rs.note, segments, yTop, pageIndex, groupIndex, voice, slotIndex, lyricMaps, geciSize, sp, rs.notePos, 0)
        slotIndex++
      }
      finishDyn(x + BAR_PAD + (beatStart[beatsInfo.length - 1] ?? 0) + (beatW[beatsInfo.length - 1] ?? 0))
      return
    }

    // bars 行（adj35 拍级每拍宽）：
    //  ① 正常拍平均分布（剩余宽 / 正常拍总时值）
    //  ② 拍内音符最小间距 1px（need = max(14, 12.16/拍内最小时值)）
    //  ③ 超拍挤占其它正常拍空间，正常拍再平均调整
    const leadingEmpty = row.start < row.end && segs[row.start].notes.length === 0 ? 1 : 0
    const barCount = Math.max(1, row.end - row.start - leadingEmpty)
    const pads = BAR_PAD * 2 + barlineSpace(config.bar_gap) * Math.max(0, barCount - 1)

    // 行内拍序列（跨小节连续拍；行首空 seg 不占拍）
    const beatsInfo: { dur: number; minDur: number }[] = []
    let gBeat = 0
    for (let b = row.start; b < row.end; b++) {
      const seg = segs[b]
      const isEmptyLead = leadingEmpty === 1 && b === row.start
      if (isEmptyLead) continue
      for (const t of seg.notes) {
        if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
          const dur = tokenDuration(t)
          let pos = gBeat
          let rem = dur
          while (rem > 1e-9) {
            const p = Math.floor(pos)
            while (beatsInfo.length <= p) beatsInfo.push({ dur: 0, minDur: Infinity })
            const piece = Math.min(rem, Math.floor(pos) + 1 - pos)
            beatsInfo[p].dur += piece
            beatsInfo[p].minDur = Math.min(beatsInfo[p].minDur, piece)
            pos += piece
            rem -= piece
          }
          gBeat += dur
        }
      }
    }
    const perBeats = allocatePerBeats(beatsInfo, availW - pads)

    // 段列表（adj36）：附点段（dots 部分）每拍宽 = 音符基础时值拍的 perBeat，
    // 不被所在拍（超拍）放大 —— 附点只占前音符时值的 0.5
    interface RowSegInfo {
      p: number
      piece: number
      perBeat: number
      note: Extract<MusicToken, { kind: 'note' | 'rest' | 'rhythm' }>
      notePos: number
      barIdx: number
    }
    const rowSegs: RowSegInfo[] = []
    let gB = 0
    for (let b = row.start; b < row.end; b++) {
      const seg = segs[b]
      if (leadingEmpty === 1 && b === row.start) continue
      for (const t of seg.notes) {
        if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
          const dur = tokenDuration(t)
          const baseDur = (1 + t.augmentCount) / Math.pow(2, t.diminishCount)
          const notePos = gB
          let pos = gB
          let rem = dur
          while (rem > 1e-9) {
            const p = Math.floor(pos)
            const piece = Math.min(rem, Math.floor(pos) + 1 - pos)
            const isDot = pos - notePos >= baseDur - 1e-9
            rowSegs.push({
              p,
              piece,
              perBeat: isDot ? perBeats[Math.max(0, Math.floor(notePos))] : perBeats[p],
              note: t,
              notePos,
              barIdx: b,
            })
            pos += piece
            rem -= piece
          }
          gB += dur
        }
      }
    }

    // 每拍宽 = Σ 段宽（附点段用基础拍每拍宽）；拍起点
    const beatW: number[] = new Array(beatsInfo.length).fill(0)
    for (const rs of rowSegs) beatW[rs.p] += rs.piece * rs.perBeat
    const beatStart: number[] = []
    let bAcc = 0
    for (let p = 0; p < beatsInfo.length; p++) {
      beatStart.push(bAcc)
      bAcc += beatW[p]
    }

    x = config.margin_left
    let segBeat = 0 // 小节起点拍（行内，跳过行首空 seg）
    let segIdx = 0
    for (let b = row.start; b < row.end; b++) {
      const seg = segs[b]
      const isEmptyLead = leadingEmpty === 1 && b === row.start
      // 小节宽 = Σ 拍宽
      let segBarW = 0
      if (!isEmptyLead) {
        const sb = segBeats(seg)
        const p0 = Math.max(0, Math.floor(segBeat + 1e-9))
        const p1 = Math.min(beatsInfo.length - 1, Math.floor(segBeat + sb - 1e-9))
        for (let p = p0; p <= p1; p++) segBarW += beatW[p]
      }
      // 小节起点对应的行内相对 x（segBeat 可能非整数：尾拍小节）
      const segBeatFloor = Math.max(0, Math.floor(segBeat + 1e-9))
      const pbFloor = beatsInfo[segBeatFloor]?.dur > 0 ? beatW[segBeatFloor] / beatsInfo[segBeatFloor].dur : 0
      const barStartX = beatStart[segBeatFloor] + (segBeat - segBeatFloor) * pbFloor

      let slotIdx = 0 // 小节内音符数（decoration 位置近似用）
      let prevBeatAcc = 0
      // 渲染该小节音符（按音符聚合段，段起点逐段累计拍内偏移）
      let curP = -1
      let offInBeat = 0
      while (segIdx < rowSegs.length && rowSegs[segIdx].barIdx === b) {
        const rs = rowSegs[segIdx]
        const segments: { x: number; perBeat: number; beats: number }[] = []
        let first = true
        while (segIdx < rowSegs.length && rowSegs[segIdx].barIdx === b && rowSegs[segIdx].notePos === rs.notePos) {
          const s = rowSegs[segIdx]
          if (s.p !== curP) {
            curP = s.p
            offInBeat = 0
          }
          segments.push({
            x: x + BAR_PAD + (beatStart[s.p] - barStartX) + offInBeat,
            perBeat: s.perBeat,
            beats: s.piece,
          })
          offInBeat += s.piece * s.perBeat
          if (first) {
            prevBeatAcc = rs.notePos - segBeat
            first = false
          }
          segIdx++
        }
        placeNoteAt(rs.note, segments, yTop, pageIndex, groupIndex, voice, slotIndex, lyricMaps, geciSize, sp, rs.notePos - segBeat, b)
        slotIndex++
        slotIdx++
      }
      // 渐强/渐弱（位置近似：按小节内音符累积拍）
      for (const t of seg.notes) {
        if (t.kind !== 'decoration') continue
        const atBeat = prevBeatAcc
        const pD = Math.min(beatsInfo.length - 1, Math.max(0, Math.floor(segBeat + atBeat)))
        if (t.dynamics === 'crescendo' || t.dynamics === 'decrescendo') {
          const dynX = (beatStart[pD] - barStartX) + (segBeat + atBeat - pD) * (beatW[pD] / (beatsInfo[pD]?.dur || 1))
          openDyn = { type: t.dynamics, x: x + BAR_PAD + dynX }
        } else if (t.dynamics === 'end') {
          const pEnd = Math.min(beatsInfo.length - 1, Math.max(0, Math.floor(segBeat + atBeat)))
          finishDyn(x + BAR_PAD + (beatStart[pEnd] - barStartX) + (segBeat + atBeat - pEnd) * (beatW[pEnd] / (beatsInfo[pEnd]?.dur || 1)))
        }
      }
      // 小节线：画在小节内容右端（+BAR_PAD 不重叠音符，adj36），并在小节间距内居中（adj25）
      const bar = seg.bar
      if (bar) {
        const isRowStartEmpty = isEmptyLead
        if (!(isRowStartEmpty && bar.type === '|')) {
          const lineX =
            isEmptyLead ? x : x + BAR_PAD + segBarW + barlineSpace(config.bar_gap) / 2
          const bid: LayoutId = { page: pageIndex, voice, group: groupIndex, index: barCounter }
          page.barlines.push({
            id: bid,
            type: bar.type,
            voltaStart: bar.voltaStart,
            voltaEnd: bar.voltaEnd,
            voltaEndSlash: bar.voltaEndSlash,
            voltaOnly: bar.voltaOnly,
            comment: bar.comment,
            x: r1(lineX),
            yTop: yTopBar,
            yBottom: yBottomBar,
            width: m.barlineWidth,
          })
        }
        barCounter++
      }
      x += isEmptyLead ? 0 : segBarW + (b < row.end - 1 ? barlineSpace(config.bar_gap) : 0)
      segBeat += isEmptyLead ? 0 : segBeats(seg)
    }
    finishDyn(x) // 行尾关闭未闭合渐强
  }

  /** 处理一个单声部组 */
  const placeGroup = (groupIndex: number, voice: number, tokens: MusicToken[], lyrics: LyricLine[]) => {
    const segs = splitBars(tokens)
    const rows = breakRows(segs, availW)
    const geciSize = config.geci_size
    const lyricMaps = buildLyricMaps(lyrics)

    // 预计算每行起始槽位
    const rowSlots: number[] = []
    let acc = 0
    const isNoteLike = (t: MusicToken) => t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm'
    for (const row of rows) {
      rowSlots.push(acc)
      if (row.kind === 'bars') {
        for (let b = row.start; b < row.end; b++) {
          acc += segs[b].notes.filter(isNoteLike).length
        }
      } else {
        acc += segs[row.segIdx].notes.slice(row.noteStart, row.noteEnd).filter(isNoteLike).length
      }
    }

    rows.forEach((row, ri) => {
      const sp = spacingFor(config, pageIndex)
      placeMusicRow(segs, row, groupIndex, voice, y, lyricMaps, geciSize, sp, rowSlots[ri])
      y += lineHeightOf(config, m, sp, lyrics.length)
      if (y + m.noteSize * 1.7 > bottomLimit) {
        pageIndex = pages.length
        startPage()
        y = m.titleAreaH
      }
    })
  }

  /** 多声部块：各声部按小节对齐纵向堆叠（块内小节等宽 + 时值等宽） */
  const placeVoiceBlock = (unit: Unit) => {
    const geciSize = config.geci_size
    const sp = spacingFor(config, pageIndex)
    const parts = unit.groups.map(({ group }) => ({
      voice: group.music.voice,
      name: group.music.voiceName,
      segs: splitBars(group.music.tokens),
      lyricMaps: buildLyricMaps(group.lyrics),
      lyricRows: group.lyrics.length,
    }))
    const numBars = Math.max(...parts.map((p) => p.segs.length))
    // 块内每拍宽 = 块可用宽 / 块总拍数（每小节取各声部最大拍数，adj15）
    let blockBeats = 0
    const barBeats: number[] = []
    for (let b = 0; b < numBars; b++) {
      let m = 0
      for (const p of parts) {
        const s = p.segs[b]
        if (s) m = Math.max(m, segBeats(s))
      }
      barBeats.push(m)
      blockBeats += m
    }
    const perBeatMin = Math.max(0, ...parts.flatMap((p) => p.segs.map((s) => segPerBeatMin(s))))
    const pads = BAR_PAD * 2 + barlineSpace(config.bar_gap) * Math.max(0, numBars - 1)
    const p0 = Math.max(2, (availW - pads) / Math.max(1, blockBeats), perBeatMin)
    // 行宽兜底（adj24）：保证声部块在页面区域内
    const perBeat =
      blockBeats * p0 + pads > availW ? (availW - pads) / Math.max(1, blockBeats) : p0

    const voiceHeights = parts.map((p) => lineHeightOf(config, m, sp, p.lyricRows))
    const blockH = voiceHeights.reduce((a, b) => a + b, 0)

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
      let slotIndex = 0
      for (let b = 0; b < numBars; b++) {
        const seg = p.segs[b] ?? { notes: [], bar: null }
        let beatAcc = 0
        for (const t of seg.notes) {
          if (t.kind === 'note' || t.kind === 'rest' || t.kind === 'rhythm') {
            const dur = tokenDuration(t)
            // 多声部块统一每拍宽：单段
            const dur2 = placeNoteAt(t, [{ x: x + BAR_PAD + beatAcc * perBeat, perBeat, beats: dur }], voiceY, pageIndex, vi, p.voice, slotIndex, p.lyricMaps, geciSize, sp, beatAcc, b)
            beatAcc += dur2
            slotIndex++
          }
        }
        x += barBeats[b] * perBeat + (b < numBars - 1 ? barlineSpace(config.bar_gap) : 0)
      }
      voiceY += voiceHeights[vi]
    }

    // 块级小节线（跨声部；行首空小节普通 | 省略）
    let xBar = config.margin_left
    for (let b = 0; b < numBars; b++) {
      let bar: Extract<MusicToken, { kind: 'barline' }> | null = null
      let srcEmpty = false
      for (const p of parts) {
        const seg = p.segs[b]
        if (seg?.bar) {
          bar = seg.bar
          srcEmpty = seg.notes.length === 0
          break
        }
      }
      if (bar && !(b === 0 && srcEmpty && bar.type === '|')) {
        const bid: LayoutId = { page: pageIndex, voice: 0, group: 0, index: barCounter }
        pages[pageIndex].barlines.push({
          id: bid,
          type: bar.type,
          voltaStart: bar.voltaStart,
          voltaEnd: bar.voltaEnd,
          voltaEndSlash: bar.voltaEndSlash,
          voltaOnly: bar.voltaOnly,
          comment: bar.comment,
          // 小节线在小节内容右端（+BAR_PAD 不重叠音符，adj36），并在小节线空间内居中（adj38）
          x: r1(xBar + BAR_PAD + barBeats[b] * perBeat + barlineSpace(config.bar_gap) / 2),
          yTop: blockY,
          yBottom: blockY + blockH,
          width: m.barlineWidth,
        })
        barCounter++
      }
      xBar += barBeats[b] * perBeat + (b < numBars - 1 ? barlineSpace(config.bar_gap) : 0)
    }

    pages[pageIndex].voiceBlocks.push({
      x: r1(config.margin_left - 12),
      yTop: blockY,
      yBottom: blockY + blockH,
      voices: blockVoices,
    })

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
    // adj37：连音线下沿距音符上沿（基线-13）4px；开始/结束音符有高八度时，
    // 距最高高音点顶（基线-22-(hi-1)×7）4px
    const highOf = (n: PlacedToken) =>
      n.token.kind === 'note' && n.token.octaveShift > 0 ? n.token.octaveShift : 0
    const hi = Math.max(highOf(a), highOf(b))
    const slurY = hi > 0 ? a.y - 26 - (hi - 1) * 7 : a.y - 17
    pages[a.id.page].slurs.push({
      // adj36：起点=开始音符正上方偏右1px（数字中心+1）、终点=结束音符正上方偏左1px
      // adj37：无高八度 → 线（下沿）距音符上沿（基线-13）4px；有高八度 → 距最高高音点顶 4px
      x1: r1(a.x + 6.58),
      x2: r1(b.x + 4.58),
      y: r1(slurY - sp.depth * 7),
      depth: sp.depth,
      style: slurStyle,
    })
  }

  const configKey = JSON.stringify(config)
  return { pages, config, configKey }
}
