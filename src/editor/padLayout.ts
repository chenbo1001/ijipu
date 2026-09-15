/**
 * editor/padLayout.ts — 嵌入式简谱输入工具条的数据表（adj314，adj323 一级设计）
 *
 * 纯 TS、零 React/DOM 依赖，可与引擎语法（engine/parser/tokenizer.ts）对照校验。
 *
 * 结构（用户方案，adj323）：
 *  - PAD_GROUPS 为**一级主键组**：工具条只显示主键（icon + 中文标签），一行、宽度自适应、横向滑动；
 *    点某主键 → 由编辑器在其按钮位置弹出该组二级键浮层（见 EditorPane 的 PadMenuPopover）。
 *  - keepOpen 组（音符/时值）浮层保持展开（连续插多个），其余组点一项后自动关闭。
 *  - 组内按键按使用频度降序排列；不常用的符号合并进低频组，减少主键数量。
 *  - insert 为插入到光标的原文；cursorOffset 可选（默认 insert.length，即光标停在末尾），
 *    用于带模板的插入（如带声部名的描述头让光标落在引号内）。
 *  - **装饰组（DECOR_KEYS）与自动补全的 & 修饰候选（completions.ts 的 NOTE/BARLINE_MODIFIER_HINTS）
 *    同源于 MODIFIER_SYMBOLS**（adj322），避免两处各维护一份符号/文案导致漂移。
 *
 * 约定：
 *  - 音符/时值/变音等后缀紧跟光标插入（**不带自动空格**）——JPS 中升/降号、高音点、
 *    减时线等必须紧贴音符，自动补空格会把 `1#` 拆成 `1 #` 造成语法错误；
 *    块间空格由用户用物理键盘空格或输入法给出（空格在手机默认键盘上，无需工具条解决）。
 *  - 描述头（Q:/C: 等）插入带尾随空格（`Q: `），光标停在空格后即可直接输入内容。
 */

import { MODIFIER_SYMBOLS } from './completions'

/** 一个可插入的二级键 */
export interface PadKey {
  /** 按键显示文本（窄屏字体尽量小，容纳更多键） */
  label: string
  /** 插入到光标的文本 */
  insert: string
  /** 插入后光标相对 insert 起点的偏移（默认 insert.length，即末尾） */
  cursorOffset?: number
  /** 语义说明（悬停提示 / 宽屏辅助标签） */
  hint?: string
}

/** 一个主键组（点主键展开其二级键） */
export interface PadGroup {
  /** 主键 id（唯一，供活动态切换） */
  id: string
  /** 主键显示图标 / 短字符 */
  icon: string
  /** 主键中文标签（悬停、宽屏、语义） */
  label: string
  /** 二级键列表（按频度降序） */
  keys: PadKey[]
  /** adj314：点二级键后是否**保持**二级态（连续输入不返回主键）——音符/时值组为 true */
  keepOpen?: boolean
}

/** 时值后缀（紧跟音符，不带空格） */
const DURATION_KEYS: PadKey[] = [
  { label: '–', insert: '-', hint: '增时线（+1 拍）' },
  { label: '/', insert: '/', hint: '减时线（1/2^n）' },
  { label: '.', insert: '.', hint: '附点（×1.5）' },
  { label: "'", insert: "'", hint: '高音点' },
  { label: ',', insert: ',', hint: '低音点' },
]

/** 小节线与反复记号 */
const BARLINE_KEYS: PadKey[] = [
  { label: '|', insert: '|', hint: '单小节线' },
  { label: '||', insert: '||', hint: '双小节线' },
  { label: '|:', insert: '|:', hint: '反复开始' },
  { label: ':|', insert: ':|', hint: '反复结束' },
  { label: ':|:', insert: ':|:', hint: '反复包围' },
  { label: '|*', insert: '|*', hint: '隐藏线 2' },
  { label: '|/', insert: '|/', hint: '隐藏线 1' },
]

/** 括号 / 连音线 / 倚音。
 *  adj314：连音线支持 + 抬升（tokenizer adj135，+ 数量抬升）——用独立 + 键，可连按多个 +。
 *  adj420：**输出骨架、光标停在括号内**——倚音键只插 `[]`/`[h]` 并把光标放在 `]` 前（用户接着输
 *  倚音数字即可），不再插 `1[65]` 这种"带示例数字"的整串（示例数字会被误当成真音符）；
 *  用法示例改写进 hint（提示里可以这样写，但插进去的是骨架）。
 *  adj420：移除 `(1)` 虚音符键（弱奏装饰，属低频写法，需要时在源码里手写）。 */
const BRACE_KEYS: PadKey[] = [
  { label: '(', insert: '(', hint: '连音线起（可接 + 抬升）' },
  { label: '+', insert: '+', hint: '抬升（连音线后连加，+ 数量抬升）' },
  { label: ')', insert: ')', hint: '连音线止' },
  // adj395：等时值连音组（平均连音）——组内音符平分「该组占用的时值」（= 小节剩余拍数），
  // 占宽同样按时值分摊、减时线连成一条并在弧线上标注音符数
  { label: '(y', insert: '(y', hint: '等时值连音组（组内音符平分该组时值：小节剩余拍数 ÷ 音符数；减时线连成一条）' },
  // adj396：倚音占用主音符时值——实际时值 = 括号内减时线条数再减一半（`2[3/]` = 1/4 拍）；
  // 后倚音可写在增时线/附点之后（`3 -[h5/]`），谱面上画在增时线/附点之后、末拍才奏
  { label: '[]', insert: '[]', cursorOffset: 1, hint: '前倚音（先奏）：写在主音符后，如 1[65]；占主音符开头的时值，2[3/] = 1/4 拍倚音' },
  { label: '[h]', insert: '[h]', cursorOffset: 2, hint: '后倚音（末奏）：写在主音符后，如 1[h65]；也可写在 - / . 之后（3 -[h5/]）' },
]

/** & 装饰编码（颤音/跳音/波音/滑音/括号标记/力度/渐慢/小节修饰）——含中文语义说明。
 *  adj322：与 completions.ts 的 NOTE_MODIFIER_HINTS/BARLINE_MODIFIER_HINTS **两处同源**，
 *  统一由 MODIFIER_SYMBOLS 派生，避免符号/文案双份维护导致漂移。 */
const DECOR_KEYS: PadKey[] = MODIFIER_SYMBOLS.map(({ symbol, label }) => ({
  label: `&${symbol}`,
  insert: `&${symbol}`,
  hint: label,
}))

/** 跳房子 / 行内引号备注 */
const VOLTA_KEYS: PadKey[] = [
  { label: '[', insert: '[', hint: '跳房子开始' },
  { label: '+', insert: '+', hint: '抬高横线（可多个）' },
  { label: ']', insert: ']', hint: '跳房子结束' },
  { label: '"1."', insert: '"1."', hint: '番号：第一遍' },
  { label: '"2."', insert: '"2."', hint: '番号：第二遍' },
  // adj368：最后一个跳房子可用文字标签——「结束句」= 该段最后一遍才奏（不必强写番号）
  { label: '"结束句"', insert: '"结束句"', hint: '标签：末遍房子（结束句）' },
  { label: '/', insert: '/', hint: '右侧不封闭' },
  { label: '"', insert: '"', hint: '行内引号备注' },
  { label: '""', insert: '""', hint: '空引号对' },
]

/** 强弱记号 + 变音（低频合并）。
 *  adj314：渐强/渐弱支持 + 逐级抬升（tokenizer 每 + 抬 2px）——用独立 + 键，可连按多个 +
 *  adj394：语法明确——渐强/渐弱**只有 `+` 抬升，没有 `-` 降低**（`-` 始终是增时线，写在其后会
 *  计入前一个音符的时值），提示文案里写清楚，避免用户以为 `<-` 是"降低一级" */
const DYNAMIC_KEYS: PadKey[] = [
  { label: '<', insert: '<', hint: '渐强起点（从该音符正中开始）；可接 + 抬升，每级 2px——不支持 - 降低（- 是增时线）' },
  { label: '+', insert: '+', hint: '逐级抬升（渐强/渐弱后连加，每级 2px）；渐强/渐弱没有 - 降低' },
  { label: '>', insert: '>', hint: '渐弱起点（从该音符正中开始）；可接 + 抬升，每级 2px——不支持 - 降低（- 是增时线）' },
  { label: '!', insert: '!', hint: '渐强/渐弱结束（写在音符后，或写在 - / . 之后 → 收在该元素右缘）' },
  { label: '#', insert: '#', hint: '升号' },
  { label: '$', insert: '$', hint: '降号' },
  { label: '=', insert: '=', hint: '还原号' },
]

/** 描述头（行首命令）——插入带尾随空格，光标停在空格后 */
const HEADER_KEYS: PadKey[] = [
  { label: 'Q:', insert: 'Q: ', hint: '曲行（声部 1）' },
  { label: 'C:', insert: 'C: ', hint: '歌词行' },
  { label: 'V:', insert: 'V: ', hint: '版本号' },
  { label: 'B:', insert: 'B: ', hint: '标题' },
  { label: 'Z:', insert: 'Z: ', hint: '作者' },
  { label: 'D:', insert: 'D: ', hint: '调式' },
  { label: 'P:', insert: 'P: ', hint: '拍号' },
  { label: 'J:', insert: 'J: ', hint: '节拍速度' },
  { label: 'Y:', insert: 'Y: ', hint: '乐器' },
  { label: 'S:', insert: 'S: ', hint: '说明文字' },
  { label: 'Q1:', insert: 'Q1: ', hint: '曲行·声部 1' },
  { label: 'Q2:', insert: 'Q2: ', hint: '曲行·声部 2' },
  { label: 'Q1"":', insert: 'Q1"":', cursorOffset: 3, hint: '曲行·声部 1 带名称' },
  { label: 'C1:', insert: 'C1: ', hint: '歌词行·声部 1' },
  { label: 'C2:', insert: 'C2: ', hint: '歌词行·声部 2' },
]

/** 乐器指令（adj348：删除旧合成 6 种菜单项——试听已固定 SpessaSynth 高保真；
 *  保留 @@ 切回默认；收藏的 GM 音色由 ScriptToolbar 动态附加到本组） */
const INSTRUMENT_KEYS: PadKey[] = [
  { label: '@@', insert: '@@', hint: '切回默认乐器' },
]

/** 主键组（adj314：描述头排首位——按操作习惯，写完描述头再录入音符曲词；
 *  adj324：移除「音符」组——数字 1-7/休止 0 用物理键盘输入更快，工具条只保留键盘难以产出的符号） */
export const PAD_GROUPS: PadGroup[] = [
  { id: 'header', icon: 'Q', label: '描述', keys: HEADER_KEYS },
  { id: 'dur', icon: '—', label: '时值', keys: DURATION_KEYS, keepOpen: true },
  { id: 'bar', icon: '|', label: '小节', keys: BARLINE_KEYS },
  { id: 'brace', icon: '([', label: '括倚', keys: BRACE_KEYS, keepOpen: true },
  { id: 'dec', icon: '&', label: '装饰', keys: DECOR_KEYS },
  { id: 'volta', icon: '[', label: '跳房子', keys: VOLTA_KEYS, keepOpen: true },
  { id: 'dyn', icon: '<#', label: '变音', keys: DYNAMIC_KEYS, keepOpen: true },
  { id: 'inst', icon: '@', label: '乐器', keys: INSTRUMENT_KEYS },
]

/** 未分组主键：软键盘显示/隐藏开关（常驻最右，不随二级态隐藏） */
export const PAD_KB_KEY: PadKey = { label: '⌨', insert: '', hint: '显示 / 隐藏系统软键盘' }
