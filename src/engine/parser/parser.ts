/**
 * engine/parser/parser.ts — .jps 源码行级解析器
 *
 * 将 .jps 文本解析为 ParseResult（描述头 + 行 AST + 曲词分组 + 错误列表）。
 * 语法依据手册：V/B/Z/D/P/J 描述头、Q/C 主体行（Q 后可带声部编号与名称）、
 * "[fenye]" 分页行、"#" 注释行。
 */
import type {
  Header,
  HeaderLine,
  LyricChar,
  LyricLine,
  MusicGroup,
  MusicLine,
  ParseError,
  ParseResult,
  SourceLine,
} from '../types'
import { tokenizeMusicLine } from './tokenizer'
import { errAt } from './errors'

const HEADER_KEYS = new Set(['V', 'B', 'Z', 'D', 'P', 'J'])

/** 解析一个 C 行（歌词）：每个汉字/音节对应一个音符；@ 跳过；~ 连字；标点自动跳过 */
function parseLyricContent(content: string, line: number): { chars: LyricChar[]; errors: ParseError[] } {
  const chars: LyricChar[] = []
  const errors: ParseError[] = []
  let i = 0
  const n = content.length
  let pending: LyricChar | null = null // 正在累积的音节

  const flush = () => {
    if (pending) {
      if (pending.text.length > 0) chars.push(pending)
      pending = null
    }
  }

  const isPunct = (c: string) => '，。、；：？！…—·〈〉《》“”‘’（）【】!,.?;:()[]-—~'.includes(c)

  while (i < n) {
    const c = content[i]
    if (c === ' ' || c === '\t') {
      flush()
      i++
      continue
    }
    if (c === '@') {
      flush()
      chars.push({ text: '', skip: true, punctuation: false, pos: i, raw: '@' })
      i++
      continue
    }
    if (c === '~') {
      // 连字：与下一个非空白字符合并
      let k = i + 1
      while (k < n && (content[k] === ' ' || content[k] === '\t')) k++
      if (k < n) {
        if (pending) {
          pending.text += content[k]
        } else {
          chars.push({ text: content[k], skip: false, punctuation: false, pos: i, raw: '~' + content[k] })
        }
        i = k + 1
      } else {
        errors.push(errAt('连字符号 "~" 后缺少文字', line, i, 'warning'))
        i++
      }
      continue
    }
    if (isPunct(c)) {
      flush()
      // 标点：自动识别，不占音符位（skip）
      chars.push({ text: c, skip: true, punctuation: true, pos: i, raw: c })
      i++
      continue
    }
    // 普通字符（汉字/字母/数字）：累积为音节
    if (!pending) {
      pending = { text: '', skip: false, punctuation: false, pos: i, raw: '' }
    }
    pending.text += c
    pending.raw += c
    i++
  }
  flush()
  return { chars, errors }
}

/** 解析整份 .jps 源码 */
export function parseJps(source: string): ParseResult {
  const lines: SourceLine[] = []
  const errors: ParseError[] = []
  const groups: MusicGroup[] = []

  const header: Header = { titles: [], authors: [] }
  let lastMusicIndex = -1 // 最近一个 Q 行在 lines 中的索引

  const srcLines = source.replace(/\r\n/g, '\n').split('\n')

  for (let idx = 0; idx < srcLines.length; idx++) {
    const raw = srcLines[idx]
    const lineNo = idx + 1
    const pos = { line: lineNo, col: 0 }
    const trimmed = raw.trim()

    // 空行
    if (trimmed === '') {
      lines.push({ kind: 'empty', pos, raw })
      continue
    }

    // 分页行
    if (trimmed === '[fenye]') {
      lines.push({ kind: 'pagebreak', pos, raw })
      continue
    }

    // 注释行（# 在行首）
    if (trimmed.startsWith('#')) {
      lines.push({ kind: 'comment', pos, raw })
      continue
    }

    // 描述头行：V/B/Z/D/P/J
    const headerMatch = /^([A-Z])\s*:\s*(.*)$/.exec(trimmed)
    if (headerMatch && HEADER_KEYS.has(headerMatch[1])) {
      const key = headerMatch[1]
      const value = headerMatch[2]
      const hl: HeaderLine = { kind: 'header', key, value, pos, raw }
      lines.push(hl)
      switch (key) {
        case 'V':
          header.version = value
          break
        case 'B':
          header.titles.push(value)
          break
        case 'Z':
          header.authors.push(value)
          break
        case 'D':
          header.key = value
          break
        case 'P':
          header.meter = value
          break
        case 'J':
          header.tempo = value
          break
      }
      continue
    }

    // 曲行：Q[声部号]["声部名"]:
    const musicMatch = /^Q(\d*)(?:"([^"]*)")?\s*:\s*(.*)$/.exec(trimmed)
    if (musicMatch) {
      const voice = musicMatch[1] === '' ? 1 : Number(musicMatch[1])
      const voiceName = musicMatch[2] || undefined
      const { tokens, errors: tokErrors } = tokenizeMusicLine(musicMatch[3] ?? '', pos)
      errors.push(...tokErrors)
      const ml: MusicLine = {
        kind: 'music',
        voice,
        voiceName,
        tokens,
        pos,
        raw,
      }
      lines.push(ml)
      groups.push({ music: ml, lyrics: [], startIndex: lines.length - 1 })
      lastMusicIndex = lines.length - 1
      continue
    }

    // 词行：C[声部号]:
    const lyricMatch = /^C(\d*)\s*:\s*(.*)$/.exec(trimmed)
    if (lyricMatch) {
      const voice = lyricMatch[1] === '' ? 1 : Number(lyricMatch[1])
      const { chars, errors: lyrErrors } = parseLyricContent(lyricMatch[2] ?? '', lineNo)
      errors.push(...lyrErrors)
      const ll: LyricLine = { kind: 'lyric', voice, chars, pos, raw }
      lines.push(ll)
      // 依附于最近一个同声部 Q 行
      if (lastMusicIndex >= 0) {
        const target = [...groups].reverse().find((g) => g.music.voice === voice)
        if (target) target.lyrics.push(ll)
        else {
          const g = groups[groups.length - 1]
          if (g) g.lyrics.push(ll)
        }
      } else {
        errors.push(errAt('歌词行缺少对应的曲行（C 行必须跟在 Q 行之后）', lineNo, 0))
      }
      continue
    }

    // 其他：未识别行
    lines.push({ kind: 'unknown', pos, raw })
    errors.push(errAt(`无法识别的行 "${trimmed.slice(0, 20)}${trimmed.length > 20 ? '…' : ''}"`, lineNo, 0, 'warning'))
  }

  return { header, lines, groups, errors }
}
