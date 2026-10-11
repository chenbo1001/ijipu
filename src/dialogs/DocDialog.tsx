/**
 * dialogs/DocDialog.tsx — 帮助文档（操作手册 / 脚本语法说明）
 *
 * 从 docs/*.md 以 ?raw 导入，经 `help/markdown.ts` 的自建 Markdown 渲染器转 HTML 展示。
 * 零第三方依赖；长文档在对话框内滚动查看。
 *
 * adj353：补全行内 Markdown（`code`、**粗体**、*斜体*、[链接](url)）与多级列表（缩进子项）。
 * adj422：支持 **Markdown 表格** 与**引用块**（语法说明要以表格当参考书查）。
 * adj876：渲染器与文档页合并 —— `mdToHtml`/`inlineMd`/`esc` 抽到 `src/help/markdown.ts`，
 *          本文件只保留"读哪几份文档 + 用哪个标题展示"。这样官网 `/manual/`、`/syntax/`
 *          与应用内看到的内容由**同一份 .md + 同一个渲染器**产出，不会两边漂移。
 */
import { Modal } from '../ui/Modal'
import { mdToHtml } from '../help/markdown'
import manualMd from '../../docs/USER-GUIDE.md?raw'
import syntaxMd from '../../docs/SYNTAX.md?raw'

const docs: Record<'manual' | 'syntax', { title: string; md: string }> = {
  manual: { title: '操作手册', md: manualMd },
  // adj422：与「脚本规则说明」合并后统一叫「脚本语法说明」
  syntax: { title: '脚本语法说明', md: syntaxMd },
}

export function DocDialog({ kind }: { kind: 'manual' | 'syntax' }) {
  const doc = docs[kind]
  return (
    <Modal title={doc.title} maskDim={0.45} compact={false}>
      <div className="doc-content" dangerouslySetInnerHTML={{ __html: mdToHtml(doc.md) }} />
    </Modal>
  )
}
