/**
 * docs/manual.ts — `/manual/`（操作手册）入口（adj876）
 *
 * 只 import 手册那一份 md：`/syntax/` 的语法说明由 `syntax.ts` 各自 import，
 * 两个页面**不会**互相带上对方的正文（否则文档页要白下 79KB）。
 */
import manualMd from '../../docs/USER-GUIDE.md?raw'
import { renderDoc } from './render'

renderDoc({
  kind: 'manual',
  title: '操作手册',
  md: manualMd,
})
