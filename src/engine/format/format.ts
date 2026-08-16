/**
 * engine/format/format.ts — 自动格式化（.jps 排版）
 *
 * 规则翻译自原「番茄简谱」编辑器 formatJP 逻辑：
 *  - 仅格式化 Q 行（曲行）；其余行原样保留；
 *  - 引号内（歌词引用/注释）与跳房子 [] 内不做空格处理；
 *  - 数字前补空格（除非前一位已是 Q/C/空格/(/y）；
 *  - "(" 前补空格；"|" 前补空格；":" 在 "|" 前补空格；"{" "}" 前补空格。
 */
export function formatJps(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  return lines.map(formatLine).join('\n') + '\n'
}

export function formatLine(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return raw
  if (!/^Q(\d*)(?:"[^"]*")?\s*:/.test(trimmed)) return raw

  const out: string[] = []
  let inQuote = false
  let inVolta = false
  let lastNote = ''
  let last = ''

  for (let x = 0; x < trimmed.length; x++) {
    const note = trimmed[x]
    const upNote = trimmed[x - 1]
    const nextNote = trimmed[x + 1]

    if (note === '"') {
      inQuote = !inQuote
      out.push(note)
      continue
    }
    if (inQuote) {
      out.push(note)
      continue
    }
    if (lastNote.indexOf('|') === -1) {
      if (note === '[') {
        inVolta = true
      } else if (note === ']') {
        inVolta = false
      }
      if (inVolta) {
        out.push(note)
        continue
      }
    }
    // 普通区空白压缩为单空格（adj23：块间恰好一个空格；引号/跳房子内原样）
    if (note === ' ') {
      if (out[out.length - 1] !== ' ') out.push(' ')
      continue
    }
    if ('0123456789-'.includes(note) && upNote !== 'Q' && upNote !== 'C' && upNote !== ' ' && upNote !== '(' && upNote !== 'y') {
      out.push(' ' + note)
    } else if (note === '(' && upNote !== '(') {
      out.push(' ' + note)
    } else if (note === '|' && upNote !== '|' && upNote !== ':') {
      out.push(' ' + note)
    } else if (note === ':' && nextNote === '|') {
      out.push(' ' + note)
    } else if (note === '{' || note === '}') {
      out.push(' ' + note)
    } else {
      out.push(note)
    }
    if ('0123456789-|'.includes(note)) lastNote = note
    last = note
  }
  void last
  return out.join('')
}
