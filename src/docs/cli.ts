/**
 * docs/cli.ts — `/cli/`（命令行手册）入口（adj948，用户要求）
 *
 * 与 `/manual/`、`/syntax/`、`/plugin/` **同一套骨架与渲染器**；只 import 命令行手册那一份 md
 * （`docs/CLI-手册.md`）——四份文档各自 import 各自的 md，避免互相白下几十 KB。
 *
 * ⚠ **单一真源**：这一页渲染的就是随桌面版一同发布的《CLI 使用手册》原文
 * （`docs/CLI-手册.md`；构建/打包时同一份文件进安装目录）⇒ 网页上看的内容与命令行里的一致，
 * 不会出现"网上说的和手上装的对不上"。手册若要改，只改那一份 md ✓。
 *
 * ⚠ 与 `plugin.ts` 同类：这一份**只在官网有**，不进应用内帮助 ⇒ 加这一页**不会让应用包变大**。
 */
import cliMd from '../../docs/CLI-手册.md?raw'
import { renderDoc } from './render'

renderDoc({
  kind: 'cli',
  title: '命令行手册',
  md: cliMd,
})
