/**
 * `src/export/bgChoice.ts` — 导出底色的纯函数（adj1002）
 *
 * 用户 2026-10-19 口径：
 *  · 底色**默认透明**；「纸色」取**当前档位**的纸色；
 *  · **导出永远按浅色**（深色主题只在预览用滤镜，不进导出）；
 *  · PNG 支持透明；**JPG / PDF 没有透明通道** ⇒ 选透明时落白（面板上就地说明）。
 *
 * 抽成纯函数的原因：能在 `npm run smoke` 里直接断言（不必起浏览器），
 * 面板组件只负责取值与传参。
 */
import type { PreviewSoften } from '../store/uiStore'

export type ExportBgChoice = 'none' | 'white' | 'paper'
export type ExportFmt = 'png' | 'jpg' | 'pdf'

/** 当前纸色档位对应的浅色纸色（与 `styles/theme.css` 的 `--jp-score-paper` 同一套值） */
export function paperColorOf(soften: PreviewSoften): string {
  if (soften === 'mid') return '#f7efdd'
  if (soften === 'light') return '#fdfbf5'
  return '#ffffff'
}

/**
 * 导出时的实际底色：`null` = **不填色**（仅 PNG 可用），字符串 = 铺满该色。
 *
 * @param choice 用户选择（透明 / 白 / 纸色）
 * @param soften 纸色档位（只在 choice='paper' 时用到）
 * @param fmt    导出格式（JPG/PDF 无透明通道 ⇒ 透明档落白）
 */
export function exportBgColor(choice: ExportBgChoice, soften: PreviewSoften, fmt: ExportFmt): string | null {
  if (choice === 'white') return '#ffffff'
  if (choice === 'paper') return paperColorOf(soften)
  // choice === 'none'：PNG 真透明；JPG/PDF 落白（格式限制）
  return fmt === 'png' ? null : '#ffffff'
}
