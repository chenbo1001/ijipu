/**
 * engine/parser/tokenizer.ts — Q 行（曲行）token 化
 *
 * 将一行音符文本（如 "1 2 3. 4/ |: [ 5 6 ] :|"）解析为 MusicToken[]。
 * 语法依据 .jps V1.0 手册：音符/休止符/节奏符、高低音点、变音、时值线、
 * 附点、装饰符号（& 编码）、渐强渐弱（< > !）、连音线（()）、
 * 小节线与反复记号（| || |: :| :|: |/ |*）、跳房子（[] [/ [+）。
 */
import type { BarlineType, MusicToken, SourcePos } from '../types'
import { err } from './errors'
import type { ParseError } from '../types'

/**
 * 解析一行曲谱内容（不含 "Q..:" 行头）。
 * @param content 行内容
 * @param pos 行位置（用于错误定位）
 */
export function tokenizeMusicLine(
  content: string,
  pos: SourcePos,
): { tokens: MusicToken[]; errors: ParseError[] } {
  const tokens: MusicToken[] = []
  const errors: ParseError[] = []
  let i = 0
  const n = content.length
  const rawAt = (start: number, end: number) => content.slice(start, end)

  // 收集一个 token 的公共后缀：变音/减时线/增时线/附点/高低音点/装饰/注释
  const collectSuffix = (
    start: number,
    base: { accidental: '#' | '$' | '=' | null; augmentCount: number; diminishCount: number; dots: number; octaveShift: number; symbols: string[]; comment?: string },
  ): number => {
    let j = start
    while (j < n) {
      const c = content[j]
      if (c === '#') {
        base.accidental = '#'; j++
      } else if (c === '$') {
        base.accidental = '$'; j++
      } else if (c === '=') {
        base.accidental = '='; j++
      } else if (c === '-') {
        base.augmentCount++; j++
      } else if (c === '/') {
        base.diminishCount++; j++
      } else if (c === '.') {
        base.dots++; j++
      } else if (c === "'") {
        base.octaveShift++; j++
      } else if (c === ',') {
        base.octaveShift--; j++
      } else if (c === '&') {
        // & 装饰编码：连续字母数字
        let k = j + 1
        while (k < n && /[a-zA-Z0-9]/.test(content[k])) k++
        if (k > j + 1) {
          base.symbols.push(content.slice(j + 1, k))
          j = k
        } else {
          break // 孤立 &，停止收集
        }
      } else if (c === '"') {
        // 注释：直到下一个引号
        const close = content.indexOf('"', j + 1)
        if (close === -1) {
          base.comment = content.slice(j + 1)
          errors.push(err('引号注释未闭合', { line: pos.line, col: pos.col + j }))
          j = n
        } else {
          base.comment = content.slice(j + 1, close)
          j = close + 1
        }
        break // 注释后不再收集
      } else {
        break
      }
    }
    return j
  }

  while (i < n) {
    const c = content[i]

    // 空白跳过
    if (c === ' ' || c === '\t') {
      i++
      continue
    }

    // 连音线
    if (c === '(') {
      tokens.push({ kind: 'slur', dir: 'open', pos: i, raw: '(' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ kind: 'slur', dir: 'close', pos: i, raw: ')' })
      i++
      continue
    }

    // 渐强渐弱
    if (c === '<' || c === '>') {
      let j = i + 1
      let plus = 0
      while (content[j] === '+') {
        plus++
        j++
      }
      const code = content.slice(i, j)
      tokens.push({
        kind: 'decoration',
        code,
        dynamics: c === '<' ? 'crescendo' : 'decrescendo',
        pos: i,
        raw: code,
      })
      i = j
      continue
    }
    if (c === '!') {
      tokens.push({ kind: 'decoration', code: '!', dynamics: 'end', pos: i, raw: '!' })
      i++
      continue
    }

    // & 装饰编码（行内独立出现）
    if (c === '&') {
      let k = i + 1
      while (k < n && /[a-zA-Z0-9]/.test(content[k])) k++
      if (k > i + 1) {
        const code = content.slice(i + 1, k)
        tokens.push({ kind: 'decoration', code, pos: i, raw: content.slice(i, k) })
        i = k
      } else {
        errors.push(err(`孤立的 "&" 符号`, { line: pos.line, col: pos.col + i }))
        i++
      }
      continue
    }

    // 小节线（含反复记号与隐藏线）
    if (c === '|' || (c === ':' && content[i + 1] === '|')) {
      let j = i
      let type: string = ''
      if (content[j] === ':' && content[j + 1] === '|') {
        type = ':|'
        j += 2
        if (content[j] === ':') {
          type = ':|:'
          j++
        }
      } else {
        // 从 '|' 开始
        let bars = 0
        while (content[j] === '|') {
          bars++
          j++
        }
        if (content[j] === ':') {
          type = bars === 2 ? '||:' : '|:'
          j++
        } else if (content[j] === '/') {
          type = bars === 2 ? '||/' : '|/'
          j++
        } else if (content[j] === '*') {
          type = '|*'
          j++
        } else {
          type = bars === 2 ? '||' : '|'
        }
      }
      const t: Extract<MusicToken, { kind: 'barline' }> = {
        kind: 'barline',
        type: type as BarlineType,
        pos: i,
        raw: rawAt(i, j),
      }
      // 跳过小节线后的空格，再处理备注（引号）与跳房子标记
      while (content[j] === ' ' || content[j] === '\t') j++
      // 小节线备注（引号，如跳房子番号 "1."）——先于跳房子标记处理
      if (content[j] === '"') {
        const close = content.indexOf('"', j + 1)
        if (close === -1) {
          t.comment = content.slice(j + 1)
          errors.push(err('引号注释未闭合', { line: pos.line, col: pos.col + j }))
          j = n
        } else {
          t.comment = content.slice(j + 1, close)
          j = close + 1
        }
      }
      // 跳房子标记紧跟小节线
      if (content[j] === '[') {
        let k = j + 1
        let slash = false
        let plus = 0
        if (content[k] === '/') {
          slash = true
          k++
        }
        while (content[k] === '+') {
          plus++
          k++
        }
        t.voltaStart = { open: true, slash, plus }
        t.raw = rawAt(i, k)
        j = k
      } else if (content[j] === ']') {
        t.voltaEnd = true
        t.raw = rawAt(i, j + 1)
        j++
      }
      tokens.push(t)
      i = j
      continue
    }

    // 跳房子标记（独立出现，例如行首用 |/ 之后；或小节线引号备注后带空格）
    if (c === '[') {
      let k = i + 1
      let slash = false
      let plus = 0
      if (content[k] === '/') {
        slash = true
        k++
      }
      while (content[k] === '+') {
        plus++
        k++
      }
      const last = tokens[tokens.length - 1]
      if (last && last.kind === 'barline' && !last.voltaStart) {
        // 继承前一小节线（含番号备注），合并跳房子起点
        last.voltaStart = { open: true, slash, plus }
        last.raw += rawAt(i, k)
      } else {
        tokens.push({
          kind: 'barline',
          type: '|',
          voltaStart: { open: true, slash, plus },
          pos: i,
          raw: rawAt(i, k),
        })
      }
      i = k
      continue
    }
    if (c === ']') {
      tokens.push({ kind: 'barline', type: '|', voltaEnd: true, pos: i, raw: ']' })
      i++
      continue
    }

    // 音符 / 休止符 / 节奏音符
    if (c >= '1' && c <= '7') {
      const start = i
      const base = {
        accidental: null as '#' | '$' | '=' | null,
        augmentCount: 0,
        diminishCount: 0,
        dots: 0,
        octaveShift: 0,
        symbols: [] as string[],
      }
      const end = collectSuffix(i + 1, base)
      const token: NoteToken_ = {
        kind: 'note',
        pitch: c.charCodeAt(0) - 48 as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        ...base,
        pos: i,
        raw: rawAt(start, end),
      }
      tokens.push(token)
      i = end
      continue
    }
    if (c === '0' || c === '8') {
      const start = i
      const base = { accidental: null, augmentCount: 0, diminishCount: 0, dots: 0, octaveShift: 0, symbols: [] as string[] }
      const end = collectSuffix(i + 1, base)
      tokens.push({
        kind: 'rest',
        hidden: c === '8',
        augmentCount: base.augmentCount,
        diminishCount: base.diminishCount,
        dots: base.dots,
        pos: i,
        raw: rawAt(start, end),
      })
      i = end
      continue
    }
    if (c === '9') {
      const start = i
      const base = { accidental: null, augmentCount: 0, diminishCount: 0, dots: 0, octaveShift: 0, symbols: [] as string[] }
      const end = collectSuffix(i + 1, base)
      tokens.push({
        kind: 'rhythm',
        augmentCount: base.augmentCount,
        diminishCount: base.diminishCount,
        dots: base.dots,
        pos: i,
        raw: rawAt(start, end),
      })
      i = end
      continue
    }

    // 独立的增时线 "-"：原站自动格式化会把 "5-" 拆成 "5 -"，
    // 因此独立出现的 "-" 必须归入前一个音符/休止符/节奏符的增时线
    if (c === '-') {
      const last = tokens[tokens.length - 1]
      if (last && (last.kind === 'note' || last.kind === 'rest' || last.kind === 'rhythm')) {
        last.augmentCount++
        last.raw += '-'
        i++
        continue
      }
    }

    // 未知字符：保留原文作为装饰 token，并给出警告
    errors.push(err(`无法识别的符号 "${c}"`, { line: pos.line, col: pos.col + i }, 'warning'))
    tokens.push({ kind: 'decoration', code: c, pos: i, raw: c })
    i++
  }

  return { tokens, errors }
}

// 局部类型别名（避免在分支中手写冗长 Extract）
type NoteToken_ = Extract<MusicToken, { kind: 'note' }>
