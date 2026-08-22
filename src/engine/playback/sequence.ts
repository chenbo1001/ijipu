/**
 * engine/playback/sequence.ts — 播放序列构建（纯函数，可单测）
 *
 * 输入：解析结果 + 排版结果 + 拍速（BPM）
 * 输出：按实际播放顺序展开的事件序列（含反复记号展开）：
 *  - `|:` / `:|`：段内反复（两遍）
 *  - `:|:`：包围式反复（段起点/终点）
 *  - `[ ]` 跳房子：第一遍经过 [ 段，第二遍跳过
 *  - `||` / `||/`：终止线，播放到此结束
 */
import type { BarlineType, ParseResult, PlacedBarline, PlacedToken, ScoreLayout } from '../types'
import { tokenDuration } from '../duration'
import { parseKey, pitchToName } from '../layout/index'

/**
 * 解析音符 id（"page_voice_group_index"）为全局音符序号定位起点。
 * 返回 { index }（全局音符索引，按 byIndex 映射）；无法解析返回 null。
 */
function parseStartNoteIdx(id: string): { index: number } | null {
  const parts = id.split('_')
  const index = Number(parts[parts.length - 1])
  return Number.isFinite(index) ? { index } : null
}

export interface PlayEvent {
  placed: PlacedToken
  /** 距开始的延迟（ms） */
  atMs: number
  /** 时值（ms） */
  durationMs: number
  /** 音高覆盖（倚音等装饰音，MIDI 音名；缺省用 placed.audioPitch，adj23） */
  pitch?: string | null
}

export interface PlaySequence {
  events: PlayEvent[]
  totalMs: number
  bpm: number
}

/** 从描述头 J 推断拍速（30~240），无效或缺失默认 90；数字部分优先（多条 J 时） */
export function inferBpm(result: ParseResult): number {
  const t = result.header.tempoNum ?? result.header.tempo
  if (t) {
    const n = Number(t)
    if (Number.isFinite(n) && n > 0) {
      return Math.min(240, Math.max(30, Math.round(n)))
    }
  }
  return 90
}

interface SeqItem {
  kind: 'note' | 'bar'
  note?: PlacedToken
  /** 音符全局索引（slur 区间用；bar 项无） */
  noteIdx?: number
  bar?: { type: BarlineType; voltaStart?: PlacedBarline['voltaStart']; voltaEnd?: boolean }
}

export function buildPlaySequence(
  result: ParseResult,
  layout: ScoreLayout,
  bpm: number,
  startNoteId?: string | null,
): PlaySequence {
  // 0. adj88：起始音符定位——双击谱面音符试听时，从该音符（含之后）开始播放；
  //    事件延迟统一减去起点音符的 atMs，使起点音符立即播放
  const startIdxByPage = startNoteId ? parseStartNoteIdx(startNoteId) : null
  // 1. 按全局音符序号索引 PlacedToken
  const byIndex = new Map<number, PlacedToken>()
  for (const page of layout.pages) {
    for (const n of page.notes) byIndex.set(n.id.index, n)
  }

  // 2. 重建交错序列（音符 + 小节线），保持源码顺序
  //    adj88：同时记录连音线 (…) 覆盖的音符区间（open slur → 当前音符起点，close → 终点），
  //    供「相同音高连奏合并时值」使用（如 (2 - | 2/) 的 2 连奏 2.5 拍）
  const seq: SeqItem[] = []
  let noteIdx = 0
  const slurStarts: number[] = []
  const slurRanges: [number, number][] = []
  for (const line of result.lines) {
    if (line.kind !== 'music') continue
    const group = result.groups.find((g) => g.music === line)
    if (!group) continue
    for (const token of group.music.tokens) {
      if (token.kind === 'slur') {
        if (token.dir === 'open') slurStarts.push(noteIdx)
        else {
          const s = slurStarts.pop()
          if (s !== undefined && noteIdx - 1 > s) slurRanges.push([s, noteIdx - 1])
        }
        continue
      }
      if (token.kind === 'barline') {
        seq.push({
          kind: 'bar',
          bar: { type: token.type, voltaStart: token.voltaStart, voltaEnd: token.voltaEnd },
        })
      } else if (token.kind === 'note' || token.kind === 'rest' || token.kind === 'rhythm') {
        const placed = byIndex.get(noteIdx)
        if (placed) seq.push({ kind: 'note', note: placed, noteIdx })
        noteIdx++
      }
    }
  }
  // 音符 → 所在 slur 区间（一个音符可属多层；用于判断相邻音符是否在同一连音线内）
  const slurOf = new Map<number, Set<number>>()
  slurRanges.forEach(([s, e], ri) => {
    for (let k = s; k <= e; k++) {
      const set = slurOf.get(k)
      if (set) set.add(ri)
      else slurOf.set(k, new Set([ri]))
    }
  })

  // 3. 跳房子配对：voltaStart 的 seq 索引 → 对应 voltaEnd 之后的位置
  const voltaAfter = new Map<number, number>()
  const pendingStarts: number[] = []
  seq.forEach((item, si) => {
    if (item.kind !== 'bar') return
    if (item.bar?.voltaStart) pendingStarts.push(si)
    if (item.bar?.voltaEnd && pendingStarts.length > 0) {
      const start = pendingStarts.pop()!
      voltaAfter.set(start, si + 1)
    }
  })

  // 4. 展开反复（支持两层：反复内嵌跳房子）
  const events: PlayEvent[] = []
  let at = 0
  let pass = 1
  let repeatStart = -1
  let i = 0
  let guard = 0
  const maxIter = seq.length * 6 // 死循环保护
  const keySemitone = parseKey(result.header.key)
  // adj88：连音线内相同音高连续音符连奏合并——上一个已发事件的音符索引与音高；
  // 当前音符若与上一个音高相同、同属某连音线且中间无音符（索引相邻），则时值并入前一事件
  let lastEventNoteIdx = -1
  let lastEventPitch: string | null | undefined = undefined
  while (i < seq.length && guard++ < maxIter) {
    const item = seq[i]
    if (item.kind === 'note' && item.note) {
      const token = item.note.token
      const durationMs = (tokenDuration(token) * 60000) / bpm
      const pitch = item.note.audioPitch
      const curNoteIdx = item.noteIdx ?? -1
      // adj89：合并判定——与前一已发事件音高相同、索引相邻（中间无音符）、
      // 且**两者同属同一条连音线**（严格 slur 内连奏）：
      // (2 - | 2/) 的 2 连 2.5 拍；(2 3/ 2/ | 2) 第 3、4 个 2 连奏；
      // (2 3 | 2) 中间隔 3 不合并；**连音线外的同音符不并入**
      // （(2 - | 2) 2 → 播 3 拍再播 1 拍，不连成 4 拍）
      const prevRanges = lastEventNoteIdx >= 0 ? slurOf.get(lastEventNoteIdx) : undefined
      const curRanges = slurOf.get(curNoteIdx)
      const shareSlur =
        prevRanges !== undefined &&
        curRanges !== undefined &&
        [...prevRanges].some((r) => curRanges.has(r))
      if (
        lastEventNoteIdx >= 0 &&
        curNoteIdx === lastEventNoteIdx + 1 &&
        shareSlur &&
        pitch !== null &&
        pitch === lastEventPitch
      ) {
        const prev = events[events.length - 1]
        prev.durationMs += durationMs
        lastEventNoteIdx = curNoteIdx
        i++
        continue
      }
      // 倚音（adj23）：前倚音提前于主音符、后倚音紧跟主音符，时值 1/8 拍，音高用倚音音符本身
      const gn = token.kind === 'note' ? token.gracenotes : undefined
      const graceMs = (0.125 * 60000) / bpm
      const gracePitches =
        gn && gn.notes.length > 0
          ? gn.notes.map((g) => pitchToName(g.pitch, g.octaveShift, g.accidental, keySemitone))
          : []
      if (gn && !gn.after && gracePitches.length > 0) {
        for (let gi = 0; gi < gn.notes.length; gi++) {
          events.push({
            placed: item.note,
            atMs: Math.max(0, at - (gn.notes.length - gi) * graceMs),
            durationMs: graceMs,
            pitch: gracePitches[gi],
          })
        }
      }
      events.push({ placed: item.note, atMs: at, durationMs })
      at += durationMs
      if (gn && gn.after && gracePitches.length > 0) {
        for (let gi = 0; gi < gn.notes.length; gi++) {
          events.push({
            placed: item.note,
            atMs: at + gi * graceMs,
            durationMs: graceMs,
            pitch: gracePitches[gi],
          })
        }
      }
      lastEventNoteIdx = curNoteIdx
      lastEventPitch = pitch
      i++
      continue
    }
    const bar = item.bar!
    // 跳房子：第二遍跳过 [ 段
    if (bar.voltaStart && pass === 2) {
      i = voltaAfter.get(i) ?? i + 1
      continue
    }
    switch (bar.type) {
      case '|:':
      case '||:':
        repeatStart = i + 1
        i++
        break
      case ':|':
      case ':|:':
        if (pass === 1 && repeatStart >= 0) {
          i = repeatStart
          pass = 2
        } else {
          if (bar.type === ':|:') repeatStart = i + 1 // 新段落起点
          i++
        }
        break
      case '||':
      case '||/':
        i = seq.length // 终止线：结束
        break
      default:
        i++
    }
  }

  // adj88：从指定音符开始——丢弃起点之前的音符事件，其后 atMs 统一减去起点 atMs
  if (startIdxByPage !== null) {
    const from = events.findIndex((e) => e.placed.id.index >= startIdxByPage.index)
    if (from > 0) {
      const base = events[from].atMs
      const sliced = events.slice(from).map((e) => ({ ...e, atMs: Math.max(0, e.atMs - base) }))
      return { events: sliced, totalMs: at - base, bpm }
    }
    if (from === 0) return { events, totalMs: at, bpm }
    // 起点音符不在事件中（隐藏休止符等）→ 从第一个可播放事件开始
    return { events, totalMs: at, bpm }
  }

  return { events, totalMs: at, bpm }
}
