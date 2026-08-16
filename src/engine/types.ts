/**
 * engine/types.ts — JianpuScript 简谱引擎核心类型
 *
 * 语法依据：原「番茄简谱」脚本说明手册（doc.lezhi99.com/zhipu）完整逆向，
 * 兼容 .jps 标记语言 V1.0。
 *
 * 本文件只包含纯类型定义，无任何运行时逻辑，是 parser / layout / render /
 * playback 各模块的共同契约。引擎保持零 React 依赖，可独立单测。
 */

// ============================================================
// 源码位置
// ============================================================

/** 源码位置：line 为 1-based 行号，col 为 0-based 行内字符偏移 */
export interface SourcePos {
  line: number
  col: number
}

// ============================================================
// 描述头（Header）
// ============================================================

/**
 * 描述头字段。语法（大写字母，可多次出现）：
 *  V: 版本号（必须）    B: 标题（首个为主标题，后续为副标题）
 *  Z: 作者（可多次）    D: 调式（字母 + #/$ 升降）
 *  P: 拍号（4/4，可多个，辅助拍号加括号）   J: 节拍（数字=每分钟拍数，或文字）
 */
export interface Header {
  version?: string
  /** 标题列表：第一项为主标题，其余为副标题 */
  titles: string[]
  /** 作者列表（居右显示，从上到下） */
  authors: string[]
  /** 调式：如 "C"、"#D"、"$E"（$ 表示降） */
  key?: string
  /** 拍号字符串：如 "4/4"、"6/8"、"4/4 (2/4)" */
  meter?: string
  /** 节拍：数字或文字（或两者并存，如 "90"、"欢快地"） */
  tempo?: string
}

// ============================================================
// 行（Line）—— 解析后的源码行 AST
// ============================================================

/** 所有行的公共基 */
export interface LineBase {
  /** 行在源文件中的位置 */
  pos: SourcePos
  /** 原始行文本（不含换行符） */
  raw: string
}

/** 描述头行：如 "B: 排排坐" */
export interface HeaderLine extends LineBase {
  kind: 'header'
  /** 字段字母：V | B | Z | D | P | J */
  key: string
  /** 字段值（去除 "key:" 前缀与首尾空白） */
  value: string
}

/** 曲行（Q 开头）：一行音符 */
export interface MusicLine extends LineBase {
  kind: 'music'
  /** 声部编号（Q 后数字，缺省为 1；0 表示无编号） */
  voice: number
  /** 声部名称（如 Q1"女声"），可选 */
  voiceName?: string
  /** 音符 token 序列 */
  tokens: MusicToken[]
}

/** 词行（C 开头）：一行歌词，依附于上一个 Q 行 */
export interface LyricLine extends LineBase {
  kind: 'lyric'
  /** 声部编号（C 后数字） */
  voice: number
  /** 歌词字符序列（每个元素对应一个音符） */
  chars: LyricChar[]
}

/** 分页行：单独一行 "[fenye]" */
export interface PageBreakLine extends LineBase {
  kind: 'pagebreak'
}

/** 注释行（# 开头，仅在行首为 # 时是注释） */
export interface CommentLine extends LineBase {
  kind: 'comment'
}

/** 空行 */
export interface EmptyLine extends LineBase {
  kind: 'empty'
}

/** 未识别的行 */
export interface UnknownLine extends LineBase {
  kind: 'unknown'
}

/** 所有行类型的联合 */
export type SourceLine =
  | HeaderLine
  | MusicLine
  | LyricLine
  | PageBreakLine
  | CommentLine
  | EmptyLine
  | UnknownLine

// ============================================================
// 音乐 token（MusicToken）
// ============================================================

/**
 * 音符。语法：数字 [高低音点] [升降号] [减时线] [增时线] [附点] [装饰符号] ["注释"]
 * 例：1' 高音、1, 低音、1# 升、1$ 降、1= 还原、1/ 八分音符、1-- 全音符、1. 附点、1&tr 颤音
 */
export interface NoteToken {
  kind: 'note'
  /** 音级 1-7 */
  pitch: 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** 八度偏移：正数=高音点个数（'），负数=低音点个数（,），0=中音 */
  octaveShift: number
  /** 变音记号：# 升、$ 降、= 还原、null 无 */
  accidental: '#' | '$' | '=' | null
  /** 增时线数量（- 的个数，每条 +1 拍） */
  augmentCount: number
  /** 减时线数量（/ 的个数，n 条 = 1/2^n 拍） */
  diminishCount: number
  /** 附点数量（. 的个数，1 个 ×1.5，2 个 ×1.75） */
  dots: number
  /** 装饰符号编码列表（& 开头，如 tr、mp；< > 渐强渐弱另见 DecorationToken） */
  symbols: string[]
  /** 音符注释（音符后引号内容），如 1"渐强" */
  comment?: string
  /** 该 token 在行内的起始字符偏移 */
  pos: number
  /** 原始文本 */
  raw: string
}

/** 休止符：0 可见，8 隐藏（占空间不显示） */
export interface RestToken {
  kind: 'rest'
  /** false=可见休止符 0；true=隐藏休止符 8 */
  hidden: boolean
  /** 时值标记（同 NoteToken 的 - / .） */
  augmentCount: number
  diminishCount: number
  dots: number
  comment?: string
  pos: number
  raw: string
}

/** 节奏音符 X（数字 9 表示），谱面显示为 X */
export interface RhythmToken {
  kind: 'rhythm'
  augmentCount: number
  diminishCount: number
  dots: number
  comment?: string
  pos: number
  raw: string
}

/**
 * 小节线。语法：
 *  |   单小节线      ||   双小节线（终止）
 *  |:  反复开始      :|   反复结束      :|: 反复包围
 *  |/  隐藏小节线1（不显示不占空间，用于行首跳房子等）
 *  |*  隐藏小节线2（不显示但占空间，用于单声部变多声部）
 *  ||/ 双线+隐藏
 *  [] 跳房子起点（可加 / 不封闭、+ 调高度）  ] 跳房子终点
 *  小节线后引号内容为小节线备注
 */
export type BarlineType =
  | '|'
  | '||'
  | '|:'
  | ':|'
  | ':|:'
  | '|/'
  | '|*'
  | '||/'
  | '||:'

export interface BarlineToken {
  kind: 'barline'
  type: BarlineType
  /** 跳房子起点标记 */
  voltaStart?: {
    /** 是否有 "[" 起点 */
    open: boolean
    /** [/ 表示右侧不封闭 */
    slash?: boolean
    /** + 号数量，调整跳房子线高度 */
    plus?: number
  }
  /** 是否为跳房子终点 "]" */
  voltaEnd?: boolean
  /** 小节线备注（引号内容） */
  comment?: string
  pos: number
  raw: string
}

/** 装饰记号：& 开头编码（如 &tr 颤音、&mp 力度）及渐强渐弱 < > ! */
export interface DecorationToken {
  kind: 'decoration'
  /** 编码：如 "tr"、"mp"；或 "<"、">"、">+"、"!" */
  code: string
  /** 渐强渐弱起止：crescendo | decrescendo | end（!） */
  dynamics?: 'crescendo' | 'decrescendo' | 'end'
  pos: number
  raw: string
}

/** 连音线开始/结束：( 与 ) */
export interface SlurToken {
  kind: 'slur'
  /** open=( 开始；close=) 结束 */
  dir: 'open' | 'close'
  pos: number
  raw: string
}

/** 音乐 token 联合 */
export type MusicToken =
  | NoteToken
  | RestToken
  | RhythmToken
  | BarlineToken
  | DecorationToken
  | SlurToken

// ============================================================
// 歌词（LyricChar）
// ============================================================

/**
 * 歌词字符。每个元素对应曲行中的一个音符：
 *  汉字一字一符；标点自动识别；@ 跳过当前音符；~ 将前后两字连为一个音节
 */
export interface LyricChar {
  /** 音节文本（可能为多个字，~ 连接） */
  text: string
  /** true=此位置跳过（@ 标记），不画字 */
  skip: boolean
  /** 是否为标点（自动识别，排版时适当缩小间距） */
  punctuation: boolean
  /** 行内字符偏移 */
  pos: number
  raw: string
}

// ============================================================
// 解析结果
// ============================================================

export interface ParseError {
  /** 错误行号（1-based），0 表示全局错误 */
  line: number
  col: number
  message: string
  severity: 'error' | 'warning'
}

/** 曲行 + 其附属歌词行（词依附于上一个曲行；一行曲可对多行词） */
export interface MusicGroup {
  music: MusicLine
  lyrics: LyricLine[]
  /** 该组在 lines 中的起始索引 */
  startIndex: number
}

export interface ParseResult {
  header: Header
  /** 全部源码行（含空行/注释，保持顺序与行号一致） */
  lines: SourceLine[]
  /** 曲词分组（按出现的顺序） */
  groups: MusicGroup[]
  errors: ParseError[]
}

// ============================================================
// 谱面模型（layout 输出，render 输入）
// ============================================================

/** 谱面元素的稳定 ID：page_声部_组_序号（与光标联动对应） */
export interface LayoutId {
  page: number
  voice: number
  group: number
  index: number
}

/** 一个已定位的音符元素（含可点击/光标信息） */
export interface PlacedToken {
  id: LayoutId
  token: NoteToken | RestToken | RhythmToken
  /** 相对页面左上角的坐标 */
  x: number
  y: number
  /** 占宽 */
  width: number
  /** 时值（拍数，用于播放） */
  duration: number
  /** 小节内拍位置（累积拍，从 0 起，用于减时线分组） */
  beatPos: number
  /** 小节索引（行内唯一，用于减时线分组） */
  barIndex: number
  /** 试听音高：音级+八度+变音计算出的简谱音名（如 C5） */
  audioPitch: string | null
  /** 是否可点击（休止符/隐藏符不可发声） */
  playable: boolean
}

/** 一个定位后的歌词字符 */
export interface PlacedLyric {
  id: LayoutId
  char: LyricChar
  x: number
  y: number
}

/** 一个定位后的小节线（含反复记号/跳房子信息） */
export interface PlacedBarline {
  id: LayoutId
  type: BarlineType
  /** 跳房子起点/终点标记 */
  voltaStart?: { open: boolean; slash?: boolean; plus?: number }
  voltaEnd?: boolean
  /** 小节线备注 */
  comment?: string
  /** 小节线中心 x */
  x: number
  /** 行顶 y */
  yTop: number
  /** 行底 y */
  yBottom: number
  /** 小节线占宽 */
  width: number
}

/** 多声部块（Q1/Q2 纵向堆叠，小节对齐），供渲染声部括弧与名称 */
export interface VoiceBlock {
  /** 括弧 x（块左侧） */
  x: number
  /** 块顶 y（第一声部行顶） */
  yTop: number
  /** 块底 y（最末声部行底） */
  yBottom: number
  /** 各声部信息（按堆叠顺序） */
  voices: { voice: number; name?: string }[]
}

/** 连音线（() 匹配的音符对，同行内绘制） */
export interface PlacedSlur {
  /** 起点（第一个音符左边缘） */
  x1: number
  /** 终点（最后一个音符右边缘） */
  x2: number
  /** 线的 y（音符上方） */
  y: number
  /** 嵌套深度（错开高度） */
  depth: number
  /** 样式：arc 圆弧 / flat 平顶 */
  style: 'arc' | 'flat'
}

/** 渐强渐弱记号（< > 起点至 ! 结束） */
export interface PlacedDynamic {
  x1: number
  x2: number
  /** 记号的 y（行上方） */
  y: number
  type: 'crescendo' | 'decrescendo'
}

/** 单个乐谱页 */
export interface ScorePage {
  index: number
  width: number
  height: number
  notes: PlacedToken[]
  lyrics: PlacedLyric[]
  barlines: PlacedBarline[]
  voiceBlocks: VoiceBlock[]
  slurs: PlacedSlur[]
  dynamics: PlacedDynamic[]
  /** 页面级元数据（标题/作者/调号拍号等文本元素） */
  meta: ScorePageMeta
}

export interface ScorePageMeta {
  titles: string[]
  authors: string[]
  key: string | null
  meter: string | null
  tempo: string | null
}

/** 排版结果：多页谱面 */
export interface ScoreLayout {
  pages: ScorePage[]
  /** 页面配置快照（用于缓存失效判断，render 需要） */
  config: PageConfig
  configKey: string
}

// ============================================================
// 页面配置（PageConfig，与 localStorage/服务端持久化一致）
// ============================================================

export interface PageConfig {
  /** 纸张：A4 | A5 | A4_horizontal | A5_horizontal */
  page: 'A4' | 'A5' | 'A4_horizontal' | 'A5_horizontal'
  margin_top: number
  margin_bottom: number
  margin_left: number
  margin_right: number
  /** 正文上间距（标题与正文之间） */
  body_margin_top: number
  /** 标题字体与字号 */
  biaoti_font: string
  biaoti_size: number
  fubiaoti_size: number
  /** 歌词字体与字号 */
  geci_font: string
  geci_size: number
  /** 音符字形样式：a | b | c */
  shuzi_font: 'a' | 'b' | 'c'
  /** 行间距：曲下间距/词下间距/曲上间距/声部间距 */
  height_quci: number
  height_cici: number
  height_ciqu: number
  height_shengbu: number
  /** 小节间距（列间距，px；小节线之间的空隙） */
  bar_gap: number
  /** 连音线样式：0 自动 | 1 圆弧 | 2 平顶 */
  lianyinxian_type: 0 | 1 | 2
  /** 按页覆盖的行距（key: 页码） */
  heights?: Record<string, [number, number, number, number]>
}

export const defaultPageConfig: PageConfig = {
  page: 'A4',
  margin_top: 80,
  margin_bottom: 80,
  margin_left: 80,
  margin_right: 80,
  body_margin_top: 40,
  biaoti_font: 'Microsoft YaHei',
  biaoti_size: 36,
  fubiaoti_size: 20,
  geci_font: 'Microsoft YaHei',
  geci_size: 18,
  shuzi_font: 'b',
  height_quci: 13,
  height_cici: 10,
  height_ciqu: 40,
  height_shengbu: 0,
  bar_gap: 0,
  lianyinxian_type: 0,
}

/** 纸张尺寸（mm → 渲染用 pt，1pt = 25.4/72 mm） */
export const PAPER_SIZE: Record<PageConfig['page'], { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  A4_horizontal: { width: 841.89, height: 595.28 },
  A5_horizontal: { width: 595.28, height: 419.53 },
}
