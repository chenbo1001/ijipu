/**
 * brand/siteVars.ts — 官网页面（首页 + 文档页）的品牌色注入（adj876）
 *
 * 官网这两类页面都**不加载应用的主题系统**（`styles/theme.css` 那套 `--jp-*` 变量由应用的
 * JS 在根元素上按用户选的深浅模式设置），但它们要用同一套品牌色。
 * 与其在首页和文档页各写一份色值（迟早对不上），不如在这里统一注入 `--site-*` 变量，
 * CSS 只消费变量：**色值仍然只有 `brand/tokens.ts` 一处定义**。
 *
 * 前缀用 `--site-`（而不是 `--jp-`）：与应用运行时的主题变量区分开，
 * 免得以后有人在官网样式里误以为有 `--jp-*` 可用。
 */
import { palette, ui } from './tokens'

/** 官网页面的 CSS 变量表（键是变量名，值是品牌 token） */
const SITE_VARS: Record<string, string> = {
  /* 底色与面板 */
  '--site-bg': ui.bgApp,
  '--site-panel': ui.bgPanel,
  '--site-panel-hover': ui.bgPanelHover,
  '--site-border': ui.border,
  /* 文字 */
  '--site-text': ui.textPrimary,
  '--site-text-2': ui.textSecondary,
  '--site-muted': ui.textMuted,
  /* 强调 */
  '--site-accent': ui.accent,
  '--site-primary': palette.deepSpaceBlue,
}

/** 把品牌色写到 `<html>` 的行内样式上（两个官网页面在入口处各调一次） */
export function injectSiteColors(): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(SITE_VARS)) {
    root.style.setProperty(name, value)
  }
}
