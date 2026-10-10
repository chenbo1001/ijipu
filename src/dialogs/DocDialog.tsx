/**
 * dialogs/DocDialog.tsx — 帮助文档（操作手册 / 脚本语法说明）
 *
 * 从 docs/*.md 以 ?raw 导入，经简易 Markdown 渲染为 HTML 展示（标题/列表/代码块/表格/引用/段落）。
 * 零第三方依赖；长文档在对话框内滚动查看。
 * adj353：补全行内 Markdown（`code`、**粗体**、*斜体*、[链接](url)）与多级列表（缩进子项），
 *          修复原文把 `` ` ``、`**`、缩进 `-` 等 MD 标记直接透出的问题。
 * adj422：支持 **Markdown 表格**（`| a | b |` + 分隔行 → 真正的 `<table>`）与**引用块**（`> `）——
 *          语法说明要以表格当参考书查（此前表格被降级成等宽文本，读起来吃力）。
 */
import { Modal } from '../ui/Modal'
import manualMd from '../../docs/USER-GUIDE.md?raw'
import syntaxMd from '../../docs/SYNTAX.md?raw'

const docs: Record<'manual' | 'syntax', { title: string; md: string }> = {
  manual: { title: '操作手册', md: manualMd },
  // adj422：与「脚本规则说明」合并后统一叫「脚本语法说明」
  syntax: { title: '脚本语法说明', md: syntaxMd },
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 行内 Markdown：`code`、**bold**、*italic*、[text](url)。普通文本 HTML 转义，语法片段包裹标签。 */
const inlineMd = (raw: string): string => {
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

/** 极简 Markdown→HTML：标题 #、多级列表 -/数字、代码块 围栏、**表格**、**引用块**、普通段落 */
function mdToHtml(md: string): string {
  const out: string[] = []
  let inCode = false
  const fence = String.fromCharCode(96).repeat(3) // ``` 代码块围栏（避免字面反引号）
  // 列表栈：每层 {tag 容器标签, liOpen 当前 <li> 是否未闭合（可容纳子列表）}
  const listStack: { tag: 'ul' | 'ol'; liOpen: boolean }[] = []
  // adj422：表格状态（连续的 | 行合成为一个 <table>；紧随表头的 |---| 分隔行标记为 thead）
  const table: { rows: string[][]; headRows: number } = { rows: [], headRows: 0 }
  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s)
  const isTableSep = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s)
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
    if (/^#{1,6} /.test(t)) {
      closeAllLists()
      const level = Math.min(6, (t.match(/^#+/)![0]).length)
      out.push(`<h${level}>${inlineMd(t.replace(/^#+\s*/, ''))}</h${level}>`)
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

export function DocDialog({ kind }: { kind: 'manual' | 'syntax' }) {
  const doc = docs[kind]
  return (
    <Modal title={doc.title} maskDim={0.45} compact={false}>
      <div className="doc-content" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.md) }} />
    </Modal>
  )
}
