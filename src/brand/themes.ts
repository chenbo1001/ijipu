/**
 * brand/themes.ts — 中国色主题定义
 * 黛蓝为品牌默认（深空蓝 + 霓虹青）；其余为中国传统色变体。
 * bg/accent 用于菜单中的配色预览（与 CSS 变量一致）。
 */
export interface Theme {
  id: string
  name: string
  desc: string
  /** 菜单预览：背景色（面板色） */
  bg: string
  /** 菜单预览：强调色（accent） */
  accent: string
}

export const THEMES: Theme[] = [
  { id: 'dianlan', name: '黛蓝', desc: '深空蓝 · 品牌默认', bg: '#161d3a', accent: '#00f0ff' },
  { id: 'zhuqing', name: '竹青', desc: '竹影青翠', bg: '#152117', accent: '#8fbf6f' },
  { id: 'zhusha', name: '朱砂', desc: '朱红热烈', bg: '#211312', accent: '#e8573f' },
  { id: 'qiuxiang', name: '秋香', desc: '秋色流金', bg: '#221d0e', accent: '#c9a227' },
  { id: 'ouhe', name: '藕荷', desc: '藕花淡紫', bg: '#201830', accent: '#b08fd8' },
  { id: 'xiangse', name: '缃色', desc: '缃缥浅黄', bg: '#221e0a', accent: '#e3c13d' },
  { id: 'xuanmo', name: '玄墨', desc: '水墨沉静', bg: '#1a1a1a', accent: '#c9c9c9' },
]

export const DEFAULT_THEME = 'dianlan'
