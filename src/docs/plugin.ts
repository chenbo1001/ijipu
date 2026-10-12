/**
 * docs/plugin.ts — `/plugin/`（插件手册）入口（adj905x，用户要求）
 *
 * 与 `/manual/`、`/syntax/` **同一套骨架与渲染器**；只 import 插件手册那一份 md
 * （`docs/PLUGIN-GUIDE.md`）——三份文档各自 import 各自的 md，避免互相白下几十 KB。
 *
 * ⚠ 这一份**只在官网有**：应用内帮助仍只放「操作手册 + 脚本语法说明」两份
 * ⇒ 加这一页**不会让应用包变大**。
 * 插件仓库自己的文档（`obsidian-ijipu/docs/`）是**实现口径**的来源，本页是面向使用者的版本；
 * 两者若冲突，以插件仓库为准（本页开头已写明这一点）。
 */
import pluginMd from '../../docs/PLUGIN-GUIDE.md?raw'
import { renderDoc } from './render'

renderDoc({
  kind: 'plugin',
  title: '插件手册',
  md: pluginMd,
})
