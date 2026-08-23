/**
 * editor/highlight.ts — .jps 语法高亮（输出 HTML span 字符串）
 *
 * 着色语义：
 *  - 行头命令（Q/C/B/Z/D/P/J/V/Y/S 及声部编号）→ line-header（霓虹青）
 *  - 音符数字/增时线 → note（橙）；小节线/反复记号 → barline（灰蓝）
 *  - 歌词 → lyric（绿）；注释 → comment（暗蓝斜体）；[fenye] → pagebreak（粉）
 *  - & 装饰编码 → decoration（青淡）
 */

// adj186：Y/S 描述头与其它行头同色（与 parser HEADER_KEYS 一致：V/B/Z/D/P/J/Y/S）
const HEADER_KEYS = 'QCBZD PJVYS'.replace(/\s/g, '')

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${esc(text)}</span>`
}

/** 高亮 Q 行内容 */
function highlightMusicContent(content: string): string {
  let out = ''
  let i = 0
  let buf = ''
  const flush = (cls: string | null) => {
    if (buf === '') return
    out += cls ? span(cls, buf) : esc(buf)
    buf = ''
  }
  let lastCls: string | null = null
  const push = (cls: string | null, c: string) => {
    if (cls !== lastCls) {
      flush(lastCls)
      lastCls = cls
    }
    buf += c
  }

  let inQuote = false
  while (i < content.length) {
    const c = content[i]
    if (c === '"') {
      inQuote = !inQuote
      push('hl-lyric', c)
      i++
      continue
    }
    if (inQuote) {
      push('hl-lyric', c)
      i++
      continue
    }
    if ('0123456789'.includes(c) || c === '-') {
      push('hl-note', c)
    } else if (c === '|' || c === ':' || c === '[' || c === ']') {
      push('hl-barline', c)
    } else if (c === '&') {
      // 装饰编码：& 后连续字母数字
      let j = i + 1
      while (j < content.length && /[a-zA-Z0-9]/.test(content[j])) j++
      const code = content.slice(i, j)
      push('hl-decoration', code)
      i = j
      continue
    } else if (c === '<' || c === '>' || c === '!') {
      push('hl-decoration', c)
    } else if (c === '(' || c === ')' || c === '{' || c === '}') {
      push('hl-barline', c)
    } else {
      push(null, c)
    }
    i++
  }
  flush(lastCls)
  return out
}

/** 高亮 C 行内容 */
function highlightLyricContent(content: string): string {
  return span('hl-lyric', content)
}

/** 整份代码高亮为 HTML；errLines 中的行号（1-based）整行红底标记；
 *  cursor（1-based 行、0-based 列，adj165）：光标所在空格段（音符块/小节线块）
 *  叠加区块背景（当前行整行背景由 EditorPane 独立铺满层渲染，adj171） */
export function highlightCode(
  code: string,
  errLines?: ReadonlySet<number>,
  cursor?: { line: number; col: number } | null,
): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  const parts: string[] = []
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln]
    const lineNo = ln + 1
    const wrap = (html: string) => {
      if (errLines && errLines.has(lineNo)) return `<span class="hl-error-line">${html}</span>`
      return html
    }
    const trimmed = raw.trim()
    if (trimmed === '') {
      parts.push(wrap(''))
      continue
    }
    if (trimmed.startsWith('#')) {
      parts.push(wrap(span('hl-comment', raw)))
      continue
    }
    if (trimmed === '[fenye]') {
      parts.push(wrap(span('hl-pagebreak', raw)))
      continue
    }
    // 行头命令：^[A-Z][0-9]*("...")?:
    const m = /^([A-Z])(\d*)(?:"[^"]*")?\s*:/.exec(trimmed)
    if (m && HEADER_KEYS.includes(m[1])) {
      const headLen = m[0].length
      const head = trimmed.slice(0, headLen)
      const rest = trimmed.slice(headLen)
      const headHtml = span('hl-line-header', head)
      if (m[1] === 'Q') {
        // adj165：当前行光标段（空格分隔的音符块/小节线块）叠加区块背景
        if (cursor && cursor.line === lineNo) {
          const lead = raw.length - trimmed.length // raw 前导空格
          const restCol = cursor.col - lead - headLen // 光标在 rest 内的列
          const seg = segmentAt(rest, restCol)
          if (seg) {
            const [s, e] = seg
            const before = highlightMusicContent(rest.slice(0, s))
            const curSeg = highlightMusicContent(rest.slice(s, e))
            const after = highlightMusicContent(rest.slice(e))
            parts.push(wrap(headHtml + before + `<span class="hl-current-block">${curSeg}</span>` + after))
            continue
          }
        }
        parts.push(wrap(headHtml + highlightMusicContent(rest)))
      } else if (m[1] === 'C') {
        parts.push(wrap(headHtml + highlightLyricContent(rest)))
      } else {
        parts.push(wrap(headHtml + esc(rest)))
      }
      continue
    }
    parts.push(wrap(esc(raw)))
  }
  return parts.join('\n')
}

/** 找列 col（0-based）所在空格分隔段 [start, end)（col 越界/在空白处返回 null） */
function segmentAt(text: string, col: number): [number, number] | null {
  if (col < 0 || col >= text.length) return null
  if (text[col] === ' ' || text[col] === '\t') return null
  let s = col
  let e = col
  while (s > 0 && text[s - 1] !== ' ' && text[s - 1] !== '\t') s--
  while (e < text.length && text[e] !== ' ' && text[e] !== '\t') e++
  return [s, e]
}
