/**
 * brand/themes.ts — 中国色主题定义
 * 黛蓝为品牌默认（深空蓝 + 霓虹青）；其余为中国传统色变体。
 */
export interface Theme {
  id: string
  name: string
  desc: string
}

export const THEMES: Theme[] = [
  { id: 'dianlan', name: '黛蓝', desc: '深空蓝 · 品牌默认' },
  { id: 'zhuqing', name: '竹青', desc: '竹影青翠' },
  { id: 'zhusha', name: '朱砂', desc: '朱红热烈' },
  { id: 'qiuxiang', name: '秋香', desc: '秋色流金' },
  { id: 'ouhe', name: '藕荷', desc: '藕花淡紫' },
  { id: 'xiangse', name: '缃色', desc: '缃缥浅黄' },
  { id: 'xuanmo', name: '玄墨', desc: '水墨沉静' },
]

export const DEFAULT_THEME = 'dianlan'
