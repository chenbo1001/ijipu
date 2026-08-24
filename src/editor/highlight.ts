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

/**
 * adj243：行内错误/告警块标记——col 相对该行内容（tokenizer 的 content，去掉行头），
 * 由 parser 直接给出；渲染时按空格块定位，命中块加红/橙单线外框。
 */
export type BlockMarks = { err: number[]; warn: number[] }

/**
 * adj227：按「实际层（textarea）折行点」分视觉行的高亮版本。
 *
 * 背景：高亮层用 pre-wrap 自动折行时，span（inline 盒）边界会产生额外的
 * 软换行机会（CSS Text 3），折行点与 textarea 不同（实测 1175px 宽下
 * 高亮层 139 字符 vs textarea 142 字符），折行行文本错位；word-break/
 * display:contents 等 CSS 均无法消除。
 *
 * 方案：折行位置以实际层为准——EditorPane 用克隆 textarea 测量每个源码行的
 * 真实折行点（wrapPoints），本函数按折行点把每行切成「视觉行」，
 * 每视觉行输出独立 <div class="hl-line">（CSS white-space: pre，不自动折行），
 * 显示层与 textarea 逐行逐字符对齐。
 *
 * @param wrapPoints 每源码行的折行点字符偏移数组（相对该行；无折行 = 空数组）
 * @param markByLine adj243：行号 → { err, warn } 的 col 数组（col 相对该行内容），
 *  命中块以 hl-err-block/hl-warn-block 单线外框包裹
 */
export function highlightCodeWrapped(
  code: string,
  errLines: ReadonlySet<number> | undefined,
  cursor: { line: number; col: number } | null,
  wrapPoints: number[][],
  markByLine?: ReadonlyMap<number, BlockMarks>,
): string {
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  const parts: string[] = []

  /** 按折行点把 [0, len) 切成视觉行段 */
  const segsOf = (len: number, pts: number[]) => {
    const segs: { start: number; end: number }[] = []
    let prev = 0
    for (const p of pts) {
      segs.push({ start: prev, end: Math.min(p, len) })
      prev = Math.min(p, len)
    }
    segs.push({ start: prev, end: len })
    return segs
  }

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln]
    const lineNo = ln + 1
    const pts = wrapPoints[ln] ?? []
    const wrap = (html: string) => {
      if (errLines && errLines.has(lineNo)) return `<span class="hl-error-line">${html}</span>`
      return html
    }
    const trimmed = raw.trim()
    if (trimmed === '') {
      parts.push(wrap('<div class="hl-line"></div>'))
      continue
    }
    if (trimmed.startsWith('#')) {
      parts.push(wrap(`<div class="hl-line">${span('hl-comment', raw)}</div>`))
      continue
    }
    if (trimmed === '[fenye]') {
      parts.push(wrap(`<div class="hl-line">${span('hl-pagebreak', raw)}</div>`))
      continue
    }
    const m = /^([A-Z])(\d*)(?:"[^"]*")?\s*:/.exec(trimmed)
    if (m && HEADER_KEYS.includes(m[1])) {
      const headLen = m[0].length
      const head = trimmed.slice(0, headLen)
      const rest = trimmed.slice(headLen)
      const segs = segsOf(raw.length, pts)
      // 光标所在空格段（相对 rest；adj165/204）
      let curSeg: [number, number] | null = null
      if (cursor && cursor.line === lineNo) {
        const lead = raw.length - trimmed.length
        const restCol = cursor.col - lead - headLen
        curSeg = segmentAt(rest, restCol)
      }
      // 每段输出独立 .hl-line div（textContent 与 textarea 对应视觉行一致）
      const renderSeg = (s: { start: number; end: number }): string => {
        // 段内 rest 范围
        const rs = Math.max(0, s.start - headLen)
        const re = Math.max(0, s.end - headLen)
        // adj246：段仅含行头（rest 为空，如只剩 "Q:" / "C:" 的行）也要输出行头，
        // 否则显示层变成空行
        if (re <= rs) return s.start < headLen ? span('hl-line-header', head) : ''
        let inner: string
        if (m[1] === 'Q') {
          // adj243：错误/告警块的 rest 坐标（col 相对该行内容，需补前导空白偏移 restLead）
          const marks = markByLine?.get(lineNo)
          const restLead = rest.length - rest.trimStart().length
          const errCols = marks ? marks.err.map((c) => c + restLead) : []
          const warnCols = marks ? marks.warn.map((c) => c + restLead) : []
          // 逐块渲染（保留块间空格，textContent 与 textarea 逐字符对齐）
          let out = ''
          let i = rs
          while (i < re) {
            const ch = rest[i]
            if (ch === ' ' || ch === '\t') {
              let j = i
              while (j < re && (rest[j] === ' ' || rest[j] === '\t')) j++
              out += esc(rest.slice(i, j))
              i = j
              continue
            }
            const bs = i
            while (i < re && rest[i] !== ' ' && rest[i] !== '\t') i++
            const be = i
            let blk = highlightMusicContent(rest.slice(bs, be))
            // 错误块优先于告警块（红 > 橙）
            if (errCols.some((c) => c >= bs && c < be)) blk = `<span class="hl-err-block">${blk}</span>`
            else if (warnCols.some((c) => c >= bs && c < be)) blk = `<span class="hl-warn-block">${blk}</span>`
            if (curSeg && bs === curSeg[0]) blk = `<span class="hl-current-block">${blk}</span>`
            out += blk
          }
          inner = out
        } else if (m[1] === 'C') {
          inner = span('hl-lyric', rest.slice(rs, re))
        } else {
          inner = esc(rest.slice(rs, re))
        }
        return s.start < headLen ? span('hl-line-header', head) + inner : inner
      }
      const segHtml = segs
        .map((s) => `<div class="hl-line">${renderSeg(s)}</div>`)
        .join('')
      parts.push(wrap(segHtml))
      continue
    }
    // 普通行（含长歌词/注释外文本）：按折行点切段，每段一个 .hl-line
    const segs = segsOf(raw.length, pts)
    const segHtml = segs.map((s) => `<div class="hl-line">${esc(raw.slice(s.start, s.end))}</div>`).join('')
    parts.push(wrap(segHtml))
  }
  // adj227：div 块级已自动分行，不能 join('\n')——父级 white-space: pre-wrap
  // 会把 div 之间的 \n 文本节点渲染成 24px 空行（行距翻倍）
  return parts.join('')
}

/** 找列 col（0-based）所在空格分隔段 [start, end)（col 越界/在空白处返回 null）
 *  adj204：光标在块后**紧邻**空白处（紧贴块末，如 `4 |` 中 `4` 与 `|` 之间的空格）
 *  或行尾时，也返回左侧块——继续输入的 & 修饰符针对该块，应保持高亮。
 *  格式化后块间以单个空格分隔，故「col-1 非空白」即紧邻前块末。 */
function segmentAt(text: string, col: number): [number, number] | null {
  if (col < 0) return null
  if (col >= text.length) {
    // 行尾：紧邻左侧块末则返回该块
    if (col > 0 && text[col - 1] !== ' ' && text[col - 1] !== '\t') {
      let s = col - 1
      while (s > 0 && text[s - 1] !== ' ' && text[s - 1] !== '\t') s--
      return [s, col]
    }
    return null
  }
  if (text[col] === ' ' || text[col] === '\t') {
    // 空白处：仅当紧贴左侧块末（col-1 非空白）时返回左侧块，否则不高亮
    if (col > 0 && text[col - 1] !== ' ' && text[col - 1] !== '\t') {
      let s = col - 1
      while (s > 0 && text[s - 1] !== ' ' && text[s - 1] !== '\t') s--
      return [s, col]
    }
    return null
  }
  let s = col
  let e = col
  while (s > 0 && text[s - 1] !== ' ' && text[s - 1] !== '\t') s--
  while (e < text.length && text[e] !== ' ' && text[e] !== '\t') e++
  return [s, e]
}
