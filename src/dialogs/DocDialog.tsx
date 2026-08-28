/**
 * dialogs/DocDialog.tsx — 帮助文档（操作手册 / 脚本语法）
 *
 * 从 docs/*.md 以 ?raw 导入，经简易 Markdown 渲染为 HTML 展示（标题/列表/代码块/段落）。
 * 零第三方依赖；长文档在对话框内滚动查看。
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

/** 极简 Markdown→HTML：标题 #、列表 - 点、代码块 围栏、普通段落；表格保留为等宽段落 */
function mdToHtml(md: string): string {
  const out: string[] = []
  let inList = false
  let inCode = false
  const fence = String.fromCharCode(96).repeat(3) // ``` 代码块围栏（避免字面反引号）
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trimStart().startsWith(fence)) {
      if (inCode) {
        out.push('</pre>')
        inCode = false
      } else {
        if (inList) {
          out.push('</ul>')
          inList = false
        }
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
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      const level = Math.min(6, (t.match(/^#+/)![0]).length)
      out.push(`<h${level}>${esc(t.replace(/^#+\s*/, ''))}</h${level}>`)
    } else if (/^[-*] /.test(t) || /^\d+\. /.test(t)) {
      if (!inList) {
        if (out.length && out[out.length - 1] !== '') out.push('')
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${esc(t.replace(/^[-*]\s*\d*\.?\s*/, ''))}</li>`)
    } else if (t === '') {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push('')
    } else if (/^\|/.test(t)) {
      // 表格行：保留为等宽文本（不解析为 HTML 表格）
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push(`<p class="doc-table">${esc(t)}</p>`)
    } else {
      if (inList) {
        out.push('</ul>')
        inList = false
      }
      out.push(`<p>${esc(t)}</p>`)
    }
  }
  if (inList) out.push('</ul>')
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
