/**
 * docs/syntax.ts — `/syntax/`（脚本语法说明）入口（adj876）
 *
 * ⚠ `docs/SYNTAX.md` 是 `.jps` 语法的**唯一对外口径**（见根 AGENTS 五·1）：
 *   网页版与应用内帮助读的是同一份文件，改语法时改这一份即可，两边同时生效。
 */
import syntaxMd from '../../docs/SYNTAX.md?raw'
import { renderDoc } from './render'

renderDoc({
  kind: 'syntax',
  title: '脚本语法说明',
  md: syntaxMd,
})
