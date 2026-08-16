/**
 * engine/layout/index.ts — 排版引擎
 *
 * M1a 阶段：单行横向排布。
 *  - 每个曲行一行，从左到右累积 x 坐标；
 *  - 输出 PlacedToken / PlacedBarline（含稳定 id：page_voice_group_index）；
 *  - 音高映射（audioPitch）：调式 D 描述头决定 1 的绝对音高（C4 基准）。
 *
 * TODO(M1b)：行内自动换行 + [fenye] 多页 + 多行纵向排布
 * TODO(M1c)：歌词逐字对齐（PlacedLyric）
 * TODO(M7)：多声部堆叠、装饰符号定位
 */
import {
  PAPER_SIZE,
} from '../types'
import { tokenDuration } from '../duration'
import type {
  LayoutId,
  MusicToken,
  NoteToken,
  PageConfig,
  ParseResult,
  PlacedBarline,
  PlacedToken,
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
  const d = t as Extract<MusicToken, { augmentCount: number; dots: number; accidental?: unknown }>
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

// ============================================================
// 主排版函数
// ============================================================

/** 四舍五入到 0.1（消除浮点噪声） */
const r1 = (v: number) => Math.round(v * 10) / 10

export function layoutScore(result: ParseResult, config: PageConfig): ScoreLayout {
  const paper = PAPER_SIZE[config.page]
  const m = metrics(config)
  const keySemitone = parseKey(result.header.key)

  const meta: ScorePageMeta = {
    titles: result.header.titles,
    authors: result.header.authors,
    key: result.header.key ?? null,
    meter: result.header.meter ?? null,
    tempo: result.header.tempo ?? null,
  }

  const notes: PlacedToken[] = []
  const barlines: PlacedBarline[] = []

  // ---- 元数据区 ----
  const titleAreaBottom = m.titleAreaH
  let y = titleAreaBottom // 第一行曲行顶 y

  // ---- 逐组排布（M1a：每组曲行占一行，不换行） ----
  let noteCounter = 0
  let barCounter = 0
  result.groups.forEach((group, groupIndex) => {
    const voice = group.music.voice
    let x = config.margin_left
    const yTop = y
    const yBottom = yTop + m.noteSize * 1.7 // 行底（数字基线下方，容纳减时线）

    // 行内 token 排布（先测量总宽，暂不换行）
    for (const token of group.music.tokens) {
      const id: LayoutId = { page: 0, voice, group: groupIndex, index: noteCounter }
      if (token.kind === 'barline') {
        barlines.push({
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
        notes.push({
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

    y += m.lineHeight
  })

  const page: ScorePage = {
    index: 0,
    width: paper.width,
    height: paper.height,
    notes,
    lyrics: [], // M1c
    barlines,
    meta,
  }

  const configKey = JSON.stringify(config)
  return { pages: [page], config, configKey }
}
