/**
 * editor/highlight.ts — .jps 语法高亮（输出 HTML span 字符串）
 *
 * 着色语义：
 *  - 行头命令（Q/C/B/Z/D/P/J 及声部编号）→ line-header（霓虹青）
 *  - 音符数字/增时线 → note（橙）；小节线/反复记号 → barline（灰蓝）
 *  - 歌词 → lyric（绿）；注释 → comment（暗蓝斜体）；[fenye] → pagebreak（粉）
 *  - & 装饰编码 → decoration（青淡）
 */

const HEADER_KEYS = 'QCBZD PJV'.replace(/\s/g, '')

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

/** 整份代码高亮为 HTML */
export function highlightCode(code: string): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  const parts: string[] = []
  for (const raw of lines) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      parts.push('')
      continue
    }
    if (trimmed.startsWith('#')) {
      parts.push(span('hl-comment', raw))
      continue
    }
    if (trimmed === '[fenye]') {
      parts.push(span('hl-pagebreak', raw))
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
        parts.push(headHtml + highlightMusicContent(rest))
      } else if (m[1] === 'C') {
        parts.push(headHtml + highlightLyricContent(rest))
      } else {
        parts.push(headHtml + esc(rest))
      }
      continue
    }
    parts.push(esc(raw))
  }
  return parts.join('\n')
}
