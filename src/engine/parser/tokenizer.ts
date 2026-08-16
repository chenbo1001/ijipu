/**
 * engine/parser/tokenizer.ts — Q 行（曲行）token 化
 *
 * 将一行音符文本（如 "1 2 3. 4/ |: [ 5 6 ] :|"）解析为 MusicToken[]。
 * 语法依据 .jps V1.0 手册：音符/休止符/节奏符、高低音点、变音（后置 # $ =）、
 * 时值线、附点、装饰符号（& 编码）、渐强渐弱（< > !）、连音线（( ... ) 带空格）、
 * 小节线与反复记号（| || |: :| :|: |/ |*）、跳房子（[] [/ [+）、
 * 虚音符（(1) 括号紧贴数字，adj23）、倚音（1[65] 前 / 1[h65] 后，adj23）。
 * 块间空格规则（adj23）：音符块与音符块、音符块与小节线块之间恰好一个空格。
 */
import type { BarlineType, GracenoteNote, MusicToken, SourcePos } from '../types'
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

  // ---- 块间空格校验（adj23）：音符块与音符块、音符块与小节线块之间恰好一个空格 ----
  let lastBlockEnd = -1 // 上一个音符块/小节线块的结束字符偏移
  let lastBlockCounts = false // 上一个块是否参与校验
  const checkBlockGap = (blockStart: number) => {
    if (!lastBlockCounts) return
    const between = content.slice(lastBlockEnd, blockStart)
    if (between === '') {
      errors.push(
        err('音符块与小节线块之间缺少空格（应恰好一个空格）', {
          line: pos.line,
          col: pos.col + blockStart,
        }, 'warning'),
      )
    } else if (/^ +$/.test(between) && between.length > 1) {
      errors.push(
        err('音符块与小节线块之间应只有一个空格', {
          line: pos.line,
          col: pos.col + blockStart,
        }, 'warning'),
      )
    }
  }
  const registerBlock = (start: number, end: number) => {
    checkBlockGap(start)
    lastBlockEnd = end
    lastBlockCounts = true
  }

  /** 解析 [ 后的跳房子修饰（adj26）：+ 抬高（可多个）、/ 不封闭、引号注释（番号） */
  const parseVoltaMods = (start: number): { k: number; slash: boolean; plus: number; comment?: string } => {
    let k = start
    let slash = false
    let plus = 0
    let comment: string | undefined
    while (k < n) {
      const ch = content[k]
      if (ch === '/') {
        slash = true
        k++
      } else if (ch === '+') {
        plus++
        k++
      } else if (ch === '"') {
        const close = content.indexOf('"', k + 1)
        if (close === -1) {
          comment = content.slice(k + 1)
          errors.push(err('引号注释未闭合', { line: pos.line, col: pos.col + k }))
          k = n
        } else {
          comment = content.slice(k + 1, close)
          k = close + 1
        }
      } else {
        break
      }
    }
    return { k, slash, plus, comment }
  }

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

    // 虚音符 (1)：括号紧贴单个音符（块内无空格），是音符块的一部分（adj23）；
    // 若括号与音符不紧贴（如 ( 1 2 3 )）则回退为连音线
    if (c === '(' && content[i + 1] >= '1' && content[i + 1] <= '7') {
      const gStart = i
      const base = {
        accidental: null as '#' | '$' | '=' | null,
        augmentCount: 0,
        diminishCount: 0,
        dots: 0,
        octaveShift: 0,
        symbols: [] as string[],
        comment: undefined as string | undefined,
      }
      const j = collectSuffix(i + 2, base)
      if (j < n && content[j] === ')') {
        const token: NoteToken_ = {
          kind: 'note',
          pitch: content[i + 1].charCodeAt(0) - 48 as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          ...base,
          ghost: true,
          pos: i,
          raw: rawAt(gStart, j + 1),
        }
        tokens.push(token)
        registerBlock(gStart, j + 1)
        i = j + 1
        continue
      }
      // 不匹配：回退连音线
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
      // 跳过小节线后的空格，再处理备注（引号）与跳房子标记；
      // 若无附加内容则回退到空格前（空格留给下一个块做单空格校验，adj23）
      const barEnd = j
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
      // 跳房子标记紧跟小节线（adj26：修饰 = + 抬高 / 不封闭 / 引号注释）
      if (content[j] === '[') {
        const mod = parseVoltaMods(j + 1)
        t.voltaStart = { open: true, slash: mod.slash, plus: mod.plus, comment: mod.comment }
        t.raw = rawAt(i, mod.k)
        j = mod.k
      } else if (content[j] === ']') {
        // |] 跳房子结束；|]/ 开口结束（adj26）
        t.voltaEnd = true
        let k = j + 1
        if (content[k] === '/') {
          t.voltaEndSlash = true
          k++
        }
        t.raw = rawAt(i, k)
        j = k
      } else if (t.comment === undefined) {
        j = barEnd // 无备注/跳房子：回退到空格前（空格留给下一个块）
      }
      tokens.push(t)
      registerBlock(i, j)
      i = j
      continue
    }

    // 倚音（adj23）：音符后面的 [65] 前倚音 / [h65] 后倚音，是音符块的一部分；
    // 括号内音符可含高低音点 ' ,、变音 # $ =、减时线 /。
    // 与跳房子区分（adj23）：小节线后的 [ 是跳房子；音符后的 [ 是倚音
    if (c === '[') {
      const last = tokens[tokens.length - 1]
      if (last && last.kind === 'note') {
        let k = i + 1
        let after = false
        if (content[k] === 'h') {
          after = true
          k++
        }
        const notes: GracenoteNote[] = []
        let closed = false
        while (k < n) {
          const ch = content[k]
          if (ch === ']') {
            closed = true
            k++
            break
          }
          if (ch === ' ' || ch === '\t') {
            k++
            continue
          }
          if (ch >= '1' && ch <= '7') {
            const gn: GracenoteNote = {
              pitch: ch.charCodeAt(0) - 48 as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              octaveShift: 0,
              accidental: null,
              diminishCount: 0,
            }
            k++
            while (k < n) {
              const sc = content[k]
              if (sc === "'") {
                gn.octaveShift++
                k++
              } else if (sc === ',') {
                gn.octaveShift--
                k++
              } else if (sc === '#') {
                gn.accidental = '#'
                k++
              } else if (sc === '$') {
                gn.accidental = '$'
                k++
              } else if (sc === '=') {
                gn.accidental = '='
                k++
              } else if (sc === '/') {
                gn.diminishCount++
                k++
              } else {
                break
              }
            }
            notes.push(gn)
          } else {
            errors.push(
              err('倚音内不支持的符号', { line: pos.line, col: pos.col + k }, 'warning'),
            )
            k++
          }
        }
        if (!closed) {
          errors.push(
            err('倚音括号 "]" 未闭合', { line: pos.line, col: pos.col + i }, 'warning'),
          )
        }
        last.gracenotes = { after, notes }
        last.raw += rawAt(i, k)
        lastBlockEnd = k // 音符块结束延展到倚音括号后
        i = k
        continue
      }
    }

    // 跳房子标记（独立出现，例如行首用 |/ 之后；或小节线引号备注后带空格；或 ] 后连续 [）
    if (c === '[') {
      const mod = parseVoltaMods(i + 1)
      const last = tokens[tokens.length - 1]
      if (last && last.kind === 'barline' && !last.voltaStart && !last.voltaEnd) {
        // 继承前一小节线（含番号备注），合并跳房子起点
        last.voltaStart = { open: true, slash: mod.slash, plus: mod.plus, comment: mod.comment }
        last.raw += rawAt(i, mod.k)
        lastBlockEnd = mod.k // 小节线块结束延展
      } else {
        if (!last || last.kind !== 'barline') {
          errors.push(
            err('跳房子 "[" 应写在小节线后（行首请用 |/ 或小节线，adj26）', {
              line: pos.line,
              col: pos.col + i,
            }, 'warning'),
          )
        }
        // ] 后连续 [ 或行首：纯跳房子起点（voltaOnly，不画小节线竖线）；
        // 属于跳房子延续（] [ 无空格），不参与块间空格校验
        tokens.push({
          kind: 'barline',
          type: '|',
          voltaStart: { open: true, slash: mod.slash, plus: mod.plus, comment: mod.comment },
          voltaOnly: true,
          pos: i,
          raw: rawAt(i, mod.k),
        })
        lastBlockEnd = mod.k
        lastBlockCounts = true
      }
      i = mod.k
      continue
    }
    if (c === ']') {
      // 跳房子结束；]/ 开口结束（adj26）
      let k = i + 1
      let slash = false
      if (content[k] === '/') {
        slash = true
        k++
      }
      tokens.push({
        kind: 'barline',
        type: '|',
        voltaEnd: true,
        voltaEndSlash: slash,
        pos: i,
        raw: rawAt(i, k),
      })
      registerBlock(i, k)
      i = k
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
      registerBlock(start, end)
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
      registerBlock(start, end)
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
      registerBlock(start, end)
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
        lastBlockEnd = i + 1 // 音符块结束延展
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
