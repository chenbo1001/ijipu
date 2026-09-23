/**
 * brand/themes.ts — 中国色主题定义
 * 黛蓝为品牌默认（深空蓝 + 霓虹青）；其余为中国传统色变体。
 * bg/accent 用于菜单中的配色预览（与 CSS 变量一致）。
 * 每个主题均有深色/浅色两套（adj48：自动跟随系统深浅色）。
 */
export interface Theme {
  id: string
  name: string
  desc: string
  /** 菜单预览：深色背景色（面板色） */
  bg: string
  /** 菜单预览：深色强调色（accent） */
  accent: string
  /** 菜单预览：浅色背景色（面板色） */
  bgLight: string
  /** 菜单预览：浅色强调色（accent） */
  accentLight: string
}

export const THEMES: Theme[] = [
  { id: 'dianlan', name: '黛蓝', desc: '深空蓝 · 品牌默认', bg: '#161d3a', accent: '#00f0ff', bgLight: '#ffffff', accentLight: '#0891a6' },
  { id: 'zhuqing', name: '竹青', desc: '竹影青翠', bg: '#152117', accent: '#8fbf6f', bgLight: '#ffffff', accentLight: '#3f7a2e' },
  { id: 'zhusha', name: '朱砂', desc: '朱红热烈', bg: '#211312', accent: '#e8573f', bgLight: '#ffffff', accentLight: '#c23b28' },
  { id: 'qiuxiang', name: '秋香', desc: '秋色流金', bg: '#221d0e', accent: '#c9a227', bgLight: '#fffdf4', accentLight: '#9c7a16' },
  { id: 'ouhe', name: '藕荷', desc: '藕花淡紫', bg: '#201830', accent: '#b08fd8', bgLight: '#fbf7ff', accentLight: '#8a5fb8' },
  { id: 'xiangse', name: '缃色', desc: '缃缥浅黄', bg: '#221e0a', accent: '#e3c13d', bgLight: '#fffef6', accentLight: '#a8871e' },
  { id: 'xuanmo', name: '玄墨', desc: '水墨沉静', bg: '#1a1a1a', accent: '#c9c9c9', bgLight: '#f7f7f7', accentLight: '#666666' },
]

export const DEFAULT_THEME = 'dianlan'

/** 深浅色模式：auto = 跟随系统 prefers-color-scheme */
export type ThemeMode = 'auto' | 'light' | 'dark'

export const DEFAULT_THEME_MODE: ThemeMode = 'auto'

/**
 * adj614（用户要求 Ctrl+T 切主题模式）：深浅模式的**循环顺序**——`auto → light → dark → auto`。
 *
 * 为什么放在这里：这个顺序有两个消费方（顶栏「深浅模式」按钮与 `Ctrl+T`），
 * **同一份顺序只能有一处定义**（两份清单必然漂移，E-2026-076 同类教训）。
 * 顶栏按钮的提示文案里写着"点击切到哪一档"，说的就是这个函数的结果。
 */
export const THEME_MODE_CYCLE: readonly ThemeMode[] = ['auto', 'light', 'dark']

/** 下一个深浅模式（`Ctrl+T` / 顶栏按钮共用） */
export function nextThemeMode(m: ThemeMode): ThemeMode {
  const at = THEME_MODE_CYCLE.indexOf(m)
  return THEME_MODE_CYCLE[(at + 1) % THEME_MODE_CYCLE.length]
}
