/**
 * editor/highlight.ts — .jps 语法高亮（输出 HTML span 字符串）
 *
 * 着色语义：
 *  - 行头命令（Q/C/B/Z/D/P/J/V/Y/S 及声部编号）→ line-header（霓虹青）
 *  - 音符数字/增时线 → note（橙）；小节线/反复记号 → barline（灰蓝）
 *  - 歌词 → lyric（绿）；注释 → comment（暗蓝）；[fenye] → pagebreak（粉）
 *  - & 装饰编码 → decoration（青淡）
 *  - adj629h：歌词行里的 `{tp … }` **替谱段** → 段内按**曲部颜色**着色（音符/小节线等），
 *    段头 `{tp` 与 `}` 用行头色标出（它本质是曲部内容，不该整段显示成歌词绿）
 */
/**
 * adj752（用户要求：「给手机端的源码使用**应用里的源码高亮方案**」）：
 * **着色规则抽到了引擎**（`engine/highlight/jpsHighlight.ts`），本文件现在只负责**渲染成 HTML**。
 * 为什么要抽走：Obsidian 的编辑器是 CodeMirror 6（只吃"按区间打标记"），吃不了 HTML 字符串；
 * 规则放在引擎里，应用渲染 `<span class="hl-*">`、插件渲染 CM6 decoration ⇒ **口径只有一处**，
 * 不会出现"应用一种颜色、插件另一种颜色"的漂移。
 * 下面这些函数保持原签名与原来的 `hl-*` 类名（应用 CSS 与冒烟断言都不受影响）。
 */
import { tokenizeJpsMusic, tokenizeJpsLyric, jpsHeaderOf, type JpsToken } from '@ijipu/engine'

// adj186/adj752：行头判定改用引擎的 jpsHeaderOf（规则与应用/插件共用的那一份）

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${esc(text)}</span>`
}

/** 分词类别 → 本文件的 `hl-*` 类名（与应用既有 CSS 对应） */
const CLS: Record<string, string> = {
  'line-header': 'hl-line-header',
  note: 'hl-note',
  barline: 'hl-barline',
  lyric: 'hl-lyric',
  comment: 'hl-comment',
  pagebreak: 'hl-pagebreak',
  decoration: 'hl-decoration',
  plain: '',
}

/** 把引擎给出的 token 渲染成 HTML（`plain` 不着色，只转义） */
function renderTokens(tokens: JpsToken[]): string {
  let out = ''
  for (const t of tokens) {
    const cls = CLS[t.cls] ?? ''
    out += cls === '' ? esc(t.text) : span(cls, t.text)
  }
  return out
}

/** 高亮 Q 行内容（adj752：规则来自引擎 `tokenizeJpsMusic`） */
function highlightMusicContent(content: string): string {
  return renderTokens(tokenizeJpsMusic(content))
}

/**
 * 高亮 C 行内容。
 *
 * adj629h（用户问）：歌词行里的 `{tp … }` 是**替谱段**——段内是曲部内容，按**曲部规则着色**
 * （音符 `hl-note`、小节线 `hl-barline` 等，与 Q 行同一套颜色）；歌词文字仍是 `hl-lyric`；
 * 段头 `{tp` 与收尾 `}` 用行头色标出来，一眼能看出"这里进了替谱段"。
 *
 * adj752：规则来自引擎 `tokenizeJpsLyric`；本函数只负责**按 [rs, re) 切片渲染**
 * （折行变体按视觉行切片调用）。
 */
function highlightLyricContent(content: string, rs = 0, re = content.length): string {
  let pos = 0
  let out = ''
  for (const t of tokenizeJpsLyric(content)) {
    const from = pos
    const to = pos + t.text.length
    pos = to
    const a = Math.max(from, rs)
    const b = Math.min(to, re)
    if (b <= a) continue
    const cls = CLS[t.cls] ?? ''
    const piece = t.text.slice(a - from, b - from)
    out += cls === '' ? esc(piece) : span(cls, piece)
  }
  return out
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
    if (m && jpsHeaderOf(trimmed) !== null) {
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
    // adj322：当前行整行背景——属于光标源码行的视觉行叠加 .hl-current-line
    //   （每视觉行一个 .hl-line；当前行所有视觉行都高亮，补齐 v0.5.1 移除的整行背景）
    /**
     * adj642（用户要求"高亮编辑区里已找到的内容"，做法照浏览器页内查找那套）：
     * 每个视觉行 div 带上 **`data-line` / `data-col`**（该段在本源码行内的起始列）。
     *
     * 为什么要标出来：查找高亮用 **CSS Custom Highlight API**（`CSS.highlights` + `::highlight()`，
     * 即浏览器页内查找自己的机制）在**本高亮层的文本节点**上建 `Range` —— 这一层就在 textarea 底下、
     * 逐字符对应源码。但折行后被切成多个 `.hl-line`（字符合集里没有换行符），
     * 若不做标记，把源码偏移换算到 DOM 位置就得靠"猜每段长度"；标上行列号后换算是一次直读：
     * `data-line` 找到行 → `data-col` 找到段 → 段内偏移 = `列 − data-col`，再在段内数文本节点即可。
     */
    const hlLine = (inner: string, col = 0) =>
      `<div class="${cursor && cursor.line === lineNo ? 'hl-line hl-current-line' : 'hl-line'}" data-line="${lineNo}" data-col="${col}">${inner}</div>`
    const trimmed = raw.trim()
    if (trimmed === '') {
      parts.push(wrap(hlLine('')))
      continue
    }
    if (trimmed.startsWith('#')) {
      // adj310：注释行同样按 wrapPoints 切分——原独立分支整行放一个 .hl-line，
      // white-space:pre 不折行；textarea 却 pre-wrap 自动折行，长注释两层不同步。
      // 与 Q 行一致，按实际折行点切成多个 .hl-line 每段用 hl-comment 着色。
      const segs = segsOf(raw.length, pts)
      const segHtml = segs
        .map((s) => hlLine(span('hl-comment', raw.slice(s.start, s.end)), s.start))
        .join('')
      parts.push(wrap(segHtml))
      continue
    }
    if (trimmed === '[fenye]') {
      parts.push(wrap(hlLine(span('hl-pagebreak', raw))))
      continue
    }
    const m = /^([A-Z])(\d*)(?:"[^"]*")?\s*:/.exec(trimmed)
    if (m && jpsHeaderOf(trimmed) !== null) {
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
          // adj629h：歌词行里的 `{tp … }` 段内按**曲部颜色**着色（此前整行一律歌词绿）
          inner = highlightLyricContent(rest, rs, re)
        } else {
          inner = esc(rest.slice(rs, re))
        }
        return s.start < headLen ? span('hl-line-header', head) + inner : inner
      }
      const segHtml = segs
        .map((s) => hlLine(renderSeg(s), s.start))
        .join('')
      parts.push(wrap(segHtml))
      continue
    }
    // 普通行（含长歌词/注释外文本）：按折行点切段，每段一个 .hl-line
    const segs = segsOf(raw.length, pts)
    const segHtml = segs.map((s) => hlLine(esc(raw.slice(s.start, s.end)), s.start)).join('')
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
