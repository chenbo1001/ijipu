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

export interface PlayEvent {
  placed: PlacedToken
  /** 距开始的延迟（ms） */
  atMs: number
  /** 时值（ms） */
  durationMs: number
}

export interface PlaySequence {
  events: PlayEvent[]
  totalMs: number
  bpm: number
}

/** 从描述头 J 推断拍速（30~240），无效或缺失默认 90 */
export function inferBpm(result: ParseResult): number {
  const t = result.header.tempo
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
  bar?: { type: BarlineType; voltaStart?: PlacedBarline['voltaStart']; voltaEnd?: boolean }
}

export function buildPlaySequence(result: ParseResult, layout: ScoreLayout, bpm: number): PlaySequence {
  // 1. 按全局音符序号索引 PlacedToken
  const byIndex = new Map<number, PlacedToken>()
  for (const page of layout.pages) {
    for (const n of page.notes) byIndex.set(n.id.index, n)
  }

  // 2. 重建交错序列（音符 + 小节线），保持源码顺序
  const seq: SeqItem[] = []
  let noteIdx = 0
  for (const line of result.lines) {
    if (line.kind !== 'music') continue
    const group = result.groups.find((g) => g.music === line)
    if (!group) continue
    for (const token of group.music.tokens) {
      if (token.kind === 'barline') {
        seq.push({
          kind: 'bar',
          bar: { type: token.type, voltaStart: token.voltaStart, voltaEnd: token.voltaEnd },
        })
      } else if (token.kind === 'note' || token.kind === 'rest' || token.kind === 'rhythm') {
        const placed = byIndex.get(noteIdx)
        if (placed) seq.push({ kind: 'note', note: placed })
        noteIdx++
      }
    }
  }

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
  while (i < seq.length && guard++ < maxIter) {
    const item = seq[i]
    if (item.kind === 'note' && item.note) {
      const durationMs = (tokenDuration(item.note.token) * 60000) / bpm
      events.push({ placed: item.note, atMs: at, durationMs })
      at += durationMs
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

  return { events, totalMs: at, bpm }
}
