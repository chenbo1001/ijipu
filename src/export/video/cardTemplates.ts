/**
 * 动态谱视频的片头/片尾卡片模板（adj1073）。
 *
 * 为什么单独抽出来：用户要求把卡片风格提炼成模板，后面做“卡片风格”设置，
 * 再后面允许用户自定义。这里只放**可序列化的数据**，渲染器（renderer.ts）只消费，
 * 不再把颜色/水印/字体写死在绘制函数里。
 *
 * 三层关系：
 *  - `CardStyle`：一个完整的卡片样式（背景、光晕、水印、文字色、字体、动效、印章…）；
 *  - `CARD_TEMPLATES`：预设模板（深空蓝 / 纸面 / 水墨 / 极简），每个模板就是一份 CardStyle；
 *  - `custom`：以后设置界面产出的另一份 CardStyle，与预设走同一个渲染入口。
 *
 * 所有模板的片尾都必须展示品牌（中文名 + 英文名 + 标语 + 网址），这是用户明确要求；
 * `CardStyle` 不提供“隐藏品牌”的开关。
 */

export type CardTitleFont = 'score' | 'serif' | 'sans'

/** 预设模板的稳定 id；以后 `custom` 由用户样式自己带 id */
export type CardTemplateId = 'brand' | 'paper' | 'ink' | 'minimal'

/** 卡片背景/文字/装饰的完整样式；可 JSON 序列化，供以后的“自定义”保存 */
export interface CardStyle {
  /** 稳定 id；预设用固定值，自定义用 `custom` */
  id: string
  /** 设置里显示的名字 */
  name: string
  /** 设置里显示的一句话说明 */
  description: string
  /** 背景三段渐变（上/中/下） */
  bg: [string, string, string]
  /** 两团径向光晕（颜色含 alpha） */
  glow: [string, string]
  /** 五线谱细线 */
  staff: { color: string; alpha: number }
  /** 大号水印：片头/片尾各一个字符，空串表示不画 */
  watermark: { intro: string; end: string; color: string; alpha: number; scale: number }
  /** 细点粒子 / 斜向扫光 */
  particles: boolean
  sweep: boolean
  /** 暗角强度（0~0.8）与暗角色（`r,g,b`） */
  vignette: number
  vignetteColor: string
  /** 四角取景括号 */
  bracket: { color: string; alpha: number }
  /** 标题：冷白/墨色渐变、辉光、字体来源（谱面标题字体 / 衬线 / 无衬线） */
  title: { from: string; to: string; glow: string; font: CardTitleFont }
  subtitle: string
  author: string
  info: string
  brand: string
  url: string
  accent: string
  /** 是否播放淡入/展开等动效（自定义模板可关） */
  motion: boolean
  /** 角落印章（纸面/水墨用）；null 不画 */
  seal: { text: string; color: string } | null
  /** 以后“换背景图片”的入口：data URL/文件 URL；null/缺省不画 */
  backgroundImage?: string | null
}

export const CARD_SANS = '"Microsoft YaHei", "PingFang SC", sans-serif'
export const CARD_SERIF = '"Songti SC", "SimSun", "Noto Serif CJK SC", serif'

export const CARD_TEMPLATES: CardStyle[] = [
  {
    id: 'brand',
    name: '深空蓝',
    description: '品牌深空蓝 + 霓虹青，五线谱/粒子/扫光',
    bg: ['#0f1526', '#1e2a5e', '#0a1024'],
    glow: ['rgba(0,240,255,0.16)', 'rgba(90,120,255,0.12)'],
    staff: { color: '#ffffff', alpha: 0.05 },
    watermark: { intro: '♪', end: 'i', color: '#ffffff', alpha: 0.03, scale: 0.52 },
    particles: true,
    sweep: true,
    vignette: 0.55,
    vignetteColor: '2,6,16',
    bracket: { color: '#00f0ff', alpha: 0.3 },
    title: { from: '#ffffff', to: '#d6fbff', glow: 'rgba(0,240,255,0.32)', font: 'score' },
    subtitle: '#00f0ff',
    author: 'rgba(255,255,255,0.86)',
    info: 'rgba(255,255,255,0.68)',
    brand: 'rgba(255,255,255,0.52)',
    url: 'rgba(255,255,255,0.72)',
    accent: '#00f0ff',
    motion: true,
    seal: null,
    backgroundImage: null,
  },
  {
    id: 'paper',
    name: '纸面',
    description: '暖白纸色 + 墨字 + 朱砂线，跟谱面同色系',
    bg: ['#fbf7ee', '#f3ead7', '#e8dbc2'],
    glow: ['rgba(255,255,255,0.55)', 'rgba(180,140,80,0.14)'],
    staff: { color: '#8a7a5f', alpha: 0.06 },
    watermark: { intro: '♪', end: 'i', color: '#6b5a3e', alpha: 0.05, scale: 0.5 },
    particles: false,
    sweep: false,
    vignette: 0.18,
    vignetteColor: '58,42,24',
    bracket: { color: '#b23a2b', alpha: 0.28 },
    title: { from: '#241f19', to: '#4a3a28', glow: 'rgba(255,250,235,0.9)', font: 'serif' },
    subtitle: '#b23a2b',
    author: '#4a4238',
    info: '#6b5f4e',
    brand: '#8a7d68',
    url: '#6b5f4e',
    accent: '#b23a2b',
    motion: true,
    seal: { text: '谱', color: '#b23a2b' },
    backgroundImage: null,
  },
  {
    id: 'ink',
    name: '水墨',
    description: '墨黑 + 米色字 + 朱砂印，东方感',
    bg: ['#0a0a0a', '#171411', '#050505'],
    glow: ['rgba(190,160,110,0.08)', 'rgba(180,60,40,0.08)'],
    staff: { color: '#d8c8a8', alpha: 0.04 },
    watermark: { intro: '♪', end: 'i', color: '#f0e4c8', alpha: 0.04, scale: 0.55 },
    particles: false,
    sweep: false,
    vignette: 0.6,
    vignetteColor: '0,0,0',
    bracket: { color: '#b23a2b', alpha: 0.25 },
    title: { from: '#f5ecd8', to: '#d9c9a8', glow: 'rgba(180,60,40,0.25)', font: 'serif' },
    subtitle: '#c0392b',
    author: '#d9c9a8',
    info: '#a8997c',
    brand: '#8a7a5f',
    url: '#a8997c',
    accent: '#c0392b',
    motion: true,
    seal: { text: '谱', color: '#b23a2b' },
    backgroundImage: null,
  },
  {
    id: 'minimal',
    name: '极简',
    description: '纯深底 + 一条强调线，无装饰',
    bg: ['#0d1117', '#111823', '#0a0e14'],
    glow: ['rgba(0,240,255,0.06)', 'rgba(0,0,0,0)'],
    staff: { color: '#ffffff', alpha: 0.02 },
    watermark: { intro: '', end: '', color: '#ffffff', alpha: 0, scale: 0.5 },
    particles: false,
    sweep: false,
    vignette: 0.4,
    vignetteColor: '2,6,16',
    bracket: { color: '#00f0ff', alpha: 0.2 },
    title: { from: '#ffffff', to: '#ffffff', glow: 'rgba(0,0,0,0)', font: 'sans' },
    subtitle: '#8ffbff',
    author: '#c7d4f0',
    info: '#8fa3cc',
    brand: '#5a6a99',
    url: 'rgba(255,255,255,0.6)',
    accent: '#00f0ff',
    motion: true,
    seal: null,
    backgroundImage: null,
  },
]

export const DEFAULT_CARD_STYLE = CARD_TEMPLATES[0]

const BY_ID = new Map(CARD_TEMPLATES.map((t) => [t.id, t]))

/** 按 id 取预设；未知 id 回退默认模板，避免旧缓存把预览打空 */
export function cardStyleById(id: string | null | undefined): CardStyle {
  return (id && BY_ID.get(id)) || DEFAULT_CARD_STYLE
}

/** 未来“自定义”：把用户编辑出来的一份样式接进来；这里先做合法性兜底 */
export function normalizeCardStyle(style: Partial<CardStyle> | null | undefined): CardStyle {
  if (!style) return DEFAULT_CARD_STYLE
  return {
    ...DEFAULT_CARD_STYLE,
    ...style,
    id: style.id || 'custom',
    name: style.name || '自定义',
    description: style.description || '用户自定义卡片',
  }
}
