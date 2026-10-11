/**
 * help/markdown.ts — 帮助文档的 Markdown → HTML 渲染器（纯函数、零依赖）
 *
 * ## 为什么要有这个模块（adj876）
 *
 * 它原先写在 `dialogs/DocDialog.tsx` 里、**且没有导出**。于是官网的文档页
 * （`/manual/`、`/syntax/`）想显示同样的内容时只有两条路：再写一份渲染器，或者改架构。
 * 再写一份 ⇒ 两份迟早漂移（"网页上有的、应用里没有"）。
 *
 * 抽到这里之后，**应用内帮助与官网文档页消费同一个函数、同一份 `.md`**：
 *   · 应用内「帮助 → 操作手册 / 脚本语法说明」→ `dialogs/DocDialog.tsx`
 *   · 官网 `/manual/` `/syntax/`              → `docs/main.ts`
 * 另一层原因：oxlint 的 `react/only-export-components` 不允许组件文件导出非组件函数。
 *
 * 支持：标题 `#` / 多级列表 / 代码块围栏 / **表格** / **引用块** / 行内 `` `code` ``、**粗体**、*斜体*、[链接](url)。
 *
 * adj876 新增：标题补稳定 `id`（文档页左侧目录的锚点要用）+ 导出 `extractToc()`。
 * ⚠ **标题的 id 与目录的链接必须由同一套函数产出**（`createHeadingIds()` + `isHeading()`）——
 *   两边各自算一遍 slug，迟早会对不上，表现就是"目录点不动"。
 */

/** 目录条目（文档页左侧栏用它渲染） */
export interface TocItem {
  /** 标题层级：1–6 */
  level: number
  /** 标题纯文本（已去掉前导 `#`） */
  text: string
  /** 与正文 `<hN id>` 完全一致的锚点 */
  id: string
}

/** 是否是一行标题——渲染与建目录**必须**用同一个判据（`#` 后要有空格） */
export function isHeading(line: string): boolean {
  return /^#{1,6} /.test(line)
}

/** 标题行的层级（1–6）；非标题返回 0 */
export function headingLevel(line: string): number {
  return isHeading(line) ? Math.min(6, (line.match(/^#+/) as RegExpMatchArray)[0].length) : 0
}

/** 标题行的纯文本（去掉前导 `#` 与空白） */
export function headingText(line: string): string {
  return line.replace(/^#+\s*/, '')
}

/**
 * 标题文本 → 锚点 id。
 * 规则：只保留中文/字母/数字，其余字符当分隔符，连续分隔符合并成一个 `-`，去掉首尾 `-`。
 * 于是 `## 2.12b 替谱段 {tp … }（同一小节两遍不同奏法）` ⇒ `2-12b-替谱段-tp-同一小节两遍不同奏法`。
 * 全是符号的标题会得到空串，由调用方兜底成 `h`。
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 标题 id 分配器：按**出现顺序**发 id，重名的自动加 `-2`、`-3`。
 * 返回一个闭包而不是直接处理文本——因为渲染器是逐行流式处理，而建目录是另一遍扫描，
 * 两边各持一个分配器、按同样的顺序调用，id 才会完全一致。
 */
export function createHeadingIds(): (text: string) => string {
  const used = new Map<string, number>()
  return (text: string): string => {
    const base = slugifyHeading(text) || 'h'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen + 1}`
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 行内 Markdown：`code`、**bold**、*italic*、[text](url)。普通文本 HTML 转义，语法片段包裹标签。 */
export function inlineMd(raw: string): string {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out += esc(raw.slice(last, m.index))
    const tok = m[0]
    if (tok[0] === '`') {
      out += `<code>${esc(tok.slice(1, -1))}</code>`
    } else if (tok.startsWith('**')) {
      out += `<strong>${inlineMd(tok.slice(2, -2))}</strong>`
    } else if (tok[0] === '[') {
      const inner = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const label = inner ? inlineMd(inner[1]) : tok
      const href = inner ? inner[2].replace(/"/g, '&quot;') : '#'
      out += `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
    } else {
      out += `<em>${inlineMd(tok.slice(1, -1))}</em>`
    }
    last = re.lastIndex
  }
  out += esc(raw.slice(last))
  return out
}

/**
 * 扫描 Markdown，产出目录（供文档页左侧栏使用）。
 * 与 `mdToHtml` 共用 `isHeading` / `headingLevel` / `headingText` / `createHeadingIds`，
 * 所以产出的 `id` 与正文标题上的 `id` 逐个相同——这是"目录点得动"的前提。
 *
 * ⚠ **必须跳过代码块**：`.jps` 的注释行就长成 `# 注释行…`，
 *   而语法说明里到处是这种代码块（`docs/SYNTAX.md` §2.1 就有）。
 *   不跳过的话，目录里会混进一堆"注释行"，而正文里它们根本不是标题
 *   ⇒ 目录多出点不动的条目。`mdToHtml` 里代码块内一律 `esc()` 输出，不会产出标题，
 *   两边的"标题集合"因此必须用同一个围栏判断（同款 `trimStart().startsWith(fence)`）。
 */
export function extractToc(md: string): TocItem[] {
  const nextId = createHeadingIds()
  const items: TocItem[] = []
  const fence = String.fromCharCode(96).repeat(3) // ``` 代码块围栏
  let inCode = false
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trimStart().startsWith(fence)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    if (!isHeading(line)) continue
    const text = headingText(line)
    items.push({ level: headingLevel(line), text, id: nextId(text) })
  }
  return items
}

/** 极简 Markdown→HTML：标题 #、多级列表 -/数字、代码块 围栏、**表格**、**引用块**、普通段落 */
export function mdToHtml(md: string): string {
  const out: string[] = []
  let inCode = false
  const fence = String.fromCharCode(96).repeat(3) // ``` 代码块围栏（避免字面反引号）
  // 列表栈：每层 {tag 容器标签, liOpen 当前 <li> 是否未闭合（可容纳子列表）}
  const listStack: { tag: 'ul' | 'ol'; liOpen: boolean }[] = []
  // adj422：表格状态（连续的 | 行合成为一个 <table>；紧随表头的 |---| 分隔行标记为 thead）
  const table: { rows: string[][]; headRows: number } = { rows: [], headRows: 0 }
  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s)
  const isTableSep = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s)
  // adj876：标题 id（与 extractToc 同源，见文件头说明）
  const nextHeadingId = createHeadingIds()
  /**
   * adj423：单元格切分——**只在未转义的 `|` 处切**（`\|` 是转义后的竖线，用于语法表里写 `|`、`||`、`:|:`）。
   * 此前用 `split('|')` 直接切，导致「小节线与反复」这类表格被切碎（E-2026-153）。
   *
   * adj772（**Obsidian 社区审核 Error**）：这里原来用**后行断言（lookbehind）**切分 ——
   * 该语法在 **iOS 16.4 之前不支持**，而本应用会被打包进 Obsidian 插件（嵌入版）供手机端使用
   * ⇒ 审核直接判 Error（`Lookbehinds are not supported on iOS versions before 16.4.`）。
   * 改为**手写扫描**（不用任何 lookbehind，语义与原来逐字等价：紧跟反斜杠的 `|` 不切）。
   * ⚠ 注释里也**不复述**那个正则 —— 审核是按**源码文本**扫描的（`webappAssets.ts` 就是这样被点到的）。
   */
  const cellsOf = (s: string) => {
    const body = s.trim().replace(/^\|/, '').replace(/\|$/, '')
    const parts: string[] = []
    let cur = ''
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if (ch === '|' && body[i - 1] !== '\\') {
        parts.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    parts.push(cur)
    return parts.map((c) => c.trim().replace(/\\\|/g, '|'))
  }

  const closeAllLists = () => {
    while (listStack.length) {
      const top = listStack.pop()!
      if (top.liOpen) out.push('</li>')
      out.push(`</${top.tag}>`)
    }
  }

  /** adj422：把缓存的表格行输出成真正的 HTML 表格（前 headRows 行进 <thead>） */
  const flushTable = () => {
    if (table.rows.length === 0) return
    const head = table.rows.slice(0, table.headRows)
    const body = table.rows.slice(table.headRows)
    out.push('<table class="doc-md-table">')
    if (head.length) {
      out.push('<thead>')
      for (const r of head) out.push(`<tr>${r.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr>`)
      out.push('</thead>')
    }
    if (body.length) {
      out.push('<tbody>')
      for (const r of body) out.push(`<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
      out.push('</tbody>')
    }
    out.push('</table>')
    table.rows = []
    table.headRows = 0
  }

  // adj422：引用块——连续的 `> ` 行合成一个 <blockquote>（每行一个 <p>）
  let inQuote = false
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>')
      inQuote = false
    }
  }

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trimStart().startsWith(fence)) {
      flushTable()
      closeQuote()
      if (inCode) {
        out.push('</pre>')
        inCode = false
      } else {
        closeAllLists()
        out.push('<pre>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      out.push(esc(line))
      continue
    }
    const t = line.trimEnd()
    // adj422：引用块（`> 文字`）——帮助文档开头常用来写"怎么读这份文档"
    if (/^>\s?/.test(t)) {
      closeAllLists()
      flushTable()
      if (!inQuote) {
        out.push('<blockquote>')
        inQuote = true
      }
      out.push(`<p>${inlineMd(t.replace(/^>\s?/, ''))}</p>`)
      continue
    }
    closeQuote()
    // adj422：表格——| 行连续排布，第二行是 |---| 分隔行时视为表头
    if (isTableRow(t)) {
      closeAllLists()
      if (isTableSep(t)) {
        table.headRows = table.rows.length
      } else {
        table.rows.push(cellsOf(t))
      }
      continue
    }
    flushTable()
    if (isHeading(t)) {
      closeAllLists()
      const level = headingLevel(t)
      const text = headingText(t)
      // adj876：带 id 的标题——文档页的目录锚点靠它；对应用内对话框来说多一个 id 无害
      out.push(`<h${level} id="${nextHeadingId(text)}">${inlineMd(text)}</h${level}>`)
    } else if (/^\s*[-*]\s+/.test(t) || /^\s*\d+\.\s+/.test(t)) {
      const indent = (t.match(/^\s*/)![0]).length
      const ordered = /^\s*\d+\.\s+/.test(t)
      const depth = Math.floor(indent / 2) // 2 空格一级
      const item = t.replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
      // 关掉比当前更深的层
      while (listStack.length - 1 > depth) {
        const top = listStack.pop()!
        if (top.liOpen) out.push('</li>')
        out.push(`</${top.tag}>`)
      }
      if (listStack.length - 1 < depth) {
        // 进入更深层：父级 <li> 需保持未闭合，以容纳子列表
        if (listStack.length === 0) {
          if (out.length && out[out.length - 1] !== '') out.push('')
        } else {
          const parent = listStack[listStack.length - 1]
          if (!parent.liOpen) {
            out.push('<li>')
            parent.liOpen = true
          }
        }
        while (listStack.length - 1 < depth) {
          const tag = ordered ? 'ol' : 'ul'
          listStack.push({ tag, liOpen: false })
          out.push(`<${tag}>`)
        }
      } else if (listStack.length > 0) {
        // 同级：闭合上一项并另起一项
        const top = listStack[listStack.length - 1]
        if (top.liOpen) {
          out.push('</li>')
          top.liOpen = false
        }
      }
      const level = listStack[listStack.length - 1]
      out.push(`<li>${inlineMd(item)}`)
      level.liOpen = true
    } else if (t === '') {
      closeAllLists()
      out.push('')
    } else {
      closeAllLists()
      out.push(`<p>${inlineMd(t)}</p>`)
    }
  }
  closeAllLists()
  flushTable()
  closeQuote()
  if (inCode) out.push('</pre>')
  return out.join('\n')
}
