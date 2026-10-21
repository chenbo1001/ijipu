/**
 * docs/soundfonts.ts — `/soundfonts/`（音色库推荐）入口（adj1026）
 *
 * 用户口径（2026-10-21）：「音色库推荐不放首页，窄屏显示表格效果不佳」。
 * 于是从首页搬成独立页，正文用**分块**（每款一个小节）而不是表格 ⇒ 窄屏自然竖排。
 */
import soundfontsMd from '../../docs/SOUNDFONTS.md?raw'
import { renderDoc } from './render'

renderDoc({
  kind: 'soundfonts',
  title: '音色库推荐',
  md: soundfontsMd,
})
