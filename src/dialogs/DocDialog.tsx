/**
 * dialogs/DocDialog.tsx — 帮助文档（操作手册 / 脚本语法）
 *
 * 从 docs/*.md 以 ?raw 导入，经简易 Markdown 渲染为 HTML 展示（标题/列表/代码块/段落）。
 * 零第三方依赖；长文档在对话框内滚动查看。
 * adj353：补全行内 Markdown（`code`、**粗体**、*斜体*、[链接](url)）与多级列表（缩进子项），
 *          修复原文把 `` ` ``、`**`、缩进 `-` 等 MD 标记直接透出的问题。
 */
import { Modal } from '../ui/Modal'
import manualMd from '../../docs/USER-GUIDE.md?raw'
import syntaxMd from '../../docs/SYNTAX.md?raw'

const docs: Record<'manual' | 'syntax', { title: string; md: string }> = {
  manual: { title: '操作手册', md: manualMd },
  syntax: { title: '脚本语法', md: syntaxMd },
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

/** 极简 Markdown→HTML：标题 #、多级列表 -/数字、代码块 围栏、表格 等宽段落、普通段落 */
function mdToHtml(md: string): string {
  const out: string[] = []
  let inCode = false
  const fence = String.fromCharCode(96).repeat(3) // ``` 代码块围栏（避免字面反引号）
  // 列表栈：每层 {tag 容器标签, liOpen 当前 <li> 是否未闭合（可容纳子列表）}
  const listStack: { tag: 'ul' | 'ol'; liOpen: boolean }[] = []

  const closeAllLists = () => {
    while (listStack.length) {
      const top = listStack.pop()!
      if (top.liOpen) out.push('</li>')
      out.push(`</${top.tag}>`)
    }
  }

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trimStart().startsWith(fence)) {
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
    } else if (/^\|/.test(t)) {
      // 表格行：保留为等宽文本（不解析为 HTML 表格）
      closeAllLists()
      out.push(`<p class="doc-table">${esc(t)}</p>`)
    } else {
      closeAllLists()
      out.push(`<p>${inlineMd(t)}</p>`)
    }
  }
  closeAllLists()
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
