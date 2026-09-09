/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, formatJps, formatLine, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig, metaAreaH, extractJpsConfig, mergeJpsConfig, writeJpsConfig, splitNoteDur, digitSlotW, dotBodyW, augBodyW, slideBodyW, bracketBodyW, noteBodyW, nonDurGap, accidentalBodyW } from '@ijipu/engine/index.ts'
import { splitTempo } from '@ijipu/engine/parser/parser.ts'
import { parseKey } from '@ijipu/engine/layout/index.ts'
import { buildPlaySequence, inferBpm, matchInstrument, resolveInstrument, eventsToMidi, pitchToMidiNote, pcmToWav, SAMPLER_LIBRARIES, getSamplerLibrary, classifyNetwork } from '@ijipu/engine/playback/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '@ijipu/engine/cursorMap.ts'
import { computeRowTops, computeRowGuides, dragDelta, clamp, GUIDE_LIMITS_EX } from '@ijipu/engine/layout/guides.ts'
import { DOT_R, DOT_R_DOT, H_GAP, INNER_GAP, BEAM_H, LAYER_GAP, VOLTA_BAR_GAP, VOLTA_RAISE, NOTE_COMMENT_FONT_RATIO, noteScaleOf, lowDotY, octaveDotY, beamBottomY, octaveTopY, digitBottomY, BARLINE_DOT_R, BARLINE_DOT_OFF, GRACE_SIZE_RATIO, GRACE_BEAM_GAP, GRACE_LINE_W, GRACE_SLOT_RATIO, GRACE_SLOT_RATIO_MULTI } from '@ijipu/engine/layout/spacing.ts'
import { clampMetaPos } from '@ijipu/engine/layout/metaAnchors.ts'
import { computeBeamsForTest } from '@ijipu/engine/render/index.ts'
import { insertLineHeader, lineColOf, isLineHeaderKey } from '../src/editor/shortcuts.ts'
import { highlightCode } from '../src/editor/highlight.ts'
import { highlightCodeWrapped } from '../src/editor/highlight.ts'
import { HEADER_HINTS, filterHeaderHints, BARLINE_MODIFIER_HINTS, NOTE_MODIFIER_HINTS, isBarlineModifierContext, filterModifierHints } from '../src/editor/completions.ts'
import {
  createHistoryState,
  recordEdit,
  undoHistory,
  redoHistory,
  DEFAULT_HISTORY_LIMIT,
  HISTORY_MERGE_MS,
  type HistoryState,
} from '../src/editor/history.ts'

// adj213：布局断言常量——从 defaultPageConfig 派生，避免硬编码边距/右边界/
// 描述头区域高等魔数（默认值调整时断言自动适配）
const ML = defaultPageConfig.margin_left
const MR = defaultPageConfig.margin_right
const MT = defaultPageConfig.margin_top
const PAGE_W = 595.28 // A4 宽（defaultPageConfig.page 默认 A4）
const RIGHT_EDGE = PAGE_W - MR // 右内容边界
const META_H = MT + defaultPageConfig.descAreaH + defaultPageConfig.body_margin_top // 描述头区域高（metaAreaH）
// adj289：引擎默认现为空间优先；既有布局/坐标断言按「时值优先」基准，故用 DUR_CFG 显式化
const DUR_CFG = { ...defaultPageConfig, noteSpaceLayout: 'duration' as const }
// adj215：随音符字号缩放的几何常量（18 号基准 → 按实际 note_size 缩放）
const NS_S = noteScaleOf(defaultPageConfig.note_size) // 字号缩放因子
const BAR_TOP = 18.4 * NS_S // 小节线上端相对音符基线偏移（18 号时 18.4）
const BAR_H = 22.9 * NS_S // 小节线高度（18 号时 22.9）
const DIGIT_W = defaultPageConfig.note_size * 0.62 // 数字槽宽
const halfDig = DIGIT_W / 2 // 数字槽半宽（随字号）
const R1 = (v: number) => Math.round(v * 10) / 10 // 与布局 r1 一致的四舍五入
// adj215：随音符字号缩放的渲染度量（18 号基准 × s）
const DOT_R_S = R1(DOT_R * NS_S) // 八度点半径
const DOT_RD_S = R1(DOT_R_DOT * NS_S) // 附点半径
const BEAM_H_S = R1(BEAM_H * NS_S) // 减时线高
const GRACE_FS = defaultPageConfig.note_size * GRACE_SIZE_RATIO // 倚音字号（0.5×主音符，渲染不取整）
const DIGIT_TOP = defaultPageConfig.note_size * 0.8 // 数字字高（0.8em）
const GRACE_SLOT_W = defaultPageConfig.note_size * GRACE_SLOT_RATIO // 倚音数字槽宽
const GRACE_SLOT_W_MULTI = defaultPageConfig.note_size * GRACE_SLOT_RATIO_MULTI // 多音符倚音间距

const root = process.cwd()

let failed = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${detail ?? ''}`)
  }
}

// ---- 1. 解析示例谱（小星星） ----
console.log('[1] parse samples/xiaoxingxing.jps')
const code = readFileSync(join(root, 'samples', 'xiaoxingxing.jps'), 'utf8')
const result = parseJps(code)
check('无错误', result.errors.length === 0, JSON.stringify(result.errors))
check('主标题=小星星', result.header.titles[0] === '小星星')
check('副标题存在', result.header.titles.length === 2)
check('调式=C', result.header.key === 'C')
check('拍号=4/4', result.header.meter === '4/4')
check('节拍=96', result.header.tempo === '96')
check('3 个曲词分组', result.groups.length === 3, `got ${result.groups.length}`)
const g0 = result.groups[0]
const g0Notes = g0.music.tokens.filter((t) => t.kind === 'note').length
check('第 1 组曲行含 14 个音符（4 小节）', g0Notes === 14, `got ${g0Notes}`)
const g0Bars = g0.music.tokens.filter((t) => t.kind === 'barline').length
check('第 1 组曲行含 4 条小节线', g0Bars === 4, `got ${g0Bars}`)
check('第 1 组有 1 行歌词', g0.lyrics.length === 1)
// adj35：中文标点不占音符位，挂在前面字的 trailing（渲染紧跟其后）
const lyricText = g0.lyrics[0].chars.map((c) => c.text + (c.trailing ?? '')).join('')
check('歌词正确（含紧跟的标点）', lyricText === '一闪一闪亮晶晶，满天都是小星星。', lyricText)
check('标点挂在前字 trailing（不占位）', g0.lyrics[0].chars.some((c) => c.trailing?.includes('，')), JSON.stringify(g0.lyrics[0].chars.map((c) => c.trailing)))

// ---- 2. tokenizer 细节（两只老虎：反复记号） ----
console.log('[2] tokenize liangzhilaohu.jps (repeats)')
const code2 = readFileSync(join(root, 'samples', 'liangzhilaohu.jps'), 'utf8')
const r2 = parseJps(code2)
check('无错误', r2.errors.length === 0, JSON.stringify(r2.errors))
const t0 = r2.groups[0].music.tokens
const barTypes = t0.filter((t) => t.kind === 'barline').map((t) => (t.kind === 'barline' ? t.type : ''))
check('含 |: 反复开始', barTypes.includes('|:'), barTypes.join(','))
check('含 :| 反复结束', barTypes.includes(':|'), barTypes.join(','))
check('含单小节线 |', barTypes.includes('|'), barTypes.join(','))

// ---- 3. 复杂音符解析 ----
console.log('[3] tokenize complex notes')
const rc = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1\'- 2,,$ 3// 4. 5.. 0 8 9 |\n')
const tokens = rc.groups[0].music.tokens
check('9 个音符类 token', tokens.length === 9, `got ${tokens.length}`)
const n1 = tokens[0]
if (n1.kind === 'note') {
  check('1 高音+增时线 (1\'-)', n1.octaveShift === 1 && n1.augmentCount === 1)
}
const n2 = tokens[1]
if (n2.kind === 'note') {
  check('2 双低音+降 (2,,$)', n2.octaveShift === -2 && n2.accidental === '$')
}
const n3 = tokens[2]
if (n3.kind === 'note') {
  check('3 双减时线 (3//)', n3.diminishCount === 2)
}
const n4 = tokens[3]
if (n4.kind === 'note') {
  check('4 单附点 (4.)', n4.dots === 1)
}
const n5 = tokens[4]
if (n5.kind === 'note') {
  check('5 双附点 (5..)', n5.dots === 2)
}
check('0 可见休止符', tokens[5].kind === 'rest' && !(tokens[5].kind === 'rest' && tokens[5].hidden))
check('8 隐藏休止符', tokens[6].kind === 'rest' && (tokens[6] as { hidden: boolean }).hidden === true)
check('9 节奏音符', tokens[7].kind === 'rhythm')

// ---- 4. 时值计算 ----
console.log('[4] durations')
check('四分音符 = 1 拍', tokenDuration({ augmentCount: 0, diminishCount: 0, dots: 0 }) === 1)
check('二分音符(1-) = 2 拍', tokenDuration({ augmentCount: 1, diminishCount: 0, dots: 0 }) === 2)
check('全音符(1---) = 4 拍', tokenDuration({ augmentCount: 3, diminishCount: 0, dots: 0 }) === 4)
check('八分音符(1/) = 0.5 拍', tokenDuration({ augmentCount: 0, diminishCount: 1, dots: 0 }) === 0.5)
check('十六分音符(1//) = 0.25 拍', tokenDuration({ augmentCount: 0, diminishCount: 2, dots: 0 }) === 0.25)
check('附点八分(1/.) = 0.75 拍', Math.abs(tokenDuration({ augmentCount: 0, diminishCount: 1, dots: 1 }) - 0.75) < 1e-9)

// ---- 5. 格式化 ----
console.log('[5] formatJps')
const fmt = formatJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ:1 2 3 4|\nC: 词')
check('Q 行格式化后带空格', fmt.includes('Q: 1 2 3 4 |'), JSON.stringify(fmt.split('\n').find((l) => l.startsWith('Q'))))
check('描述头行不变', fmt.includes('B: t'))
// adj110：formatLine 单行格式化（编辑器光标离开行时按行格式化，其余行原样）
check('formatLine 格式化单行 Q 行', formatLine('Q: 1 2 3|4') === 'Q: 1 2 3 | 4', formatLine('Q: 1 2 3|4'))
check('formatLine 不改非 Q 行（歌词原样）', formatLine('C: 一 二 三') === 'C: 一 二 三', '')
check('formatLine 保留行首命令头格式', formatLine('Q2: 1 2|3') === 'Q2: 1 2 | 3', formatLine('Q2: 1 2|3'))
// adj165：& 修饰符自动分隔（修饰符与后续音符之间补空格；(y 连音组不受影响）
check('adj165 &修饰符后音符补空格（1&yc2）', formatLine('Q: 1&yc2') === 'Q: 1&yc 2', formatLine('Q: 1&yc2'))
check('adj165 &修饰符以 y 结尾也分隔（1&sby2）', formatLine('Q: 1&sby2') === 'Q: 1&sby 2', formatLine('Q: 1&sby2'))
check('adj165 &修饰符后跟括号补空格（1&tr(2)）', formatLine('Q: 1&tr(2)') === 'Q: 1&tr (2)', formatLine('Q: 1&tr(2)'))
check('adj165 (y 连音组不误分隔（(y1 2）', formatLine('Q: (y1 2 3)') === 'Q: (y1 2 3)', formatLine('Q: (y1 2 3)'))
check('adj165 独立 &zkh 后音符补空格（&zkh6）', formatLine('Q: &zkh6') === 'Q: &zkh 6', formatLine('Q: &zkh6'))

// adj293：描述头属性与内容之间保留且只保留一个空格
check('adj293 Y:钢琴（无空格）→ Y: 钢琴', formatLine('Y:钢琴') === 'Y: 钢琴', formatLine('Y:钢琴'))
check('adj293 Y:  钢琴（多空格）→ Y: 钢琴', formatLine('Y:  钢琴') === 'Y: 钢琴', formatLine('Y:  钢琴'))
check('adj293 Y: 钢琴（单空格）→ 不变', formatLine('Y: 钢琴') === 'Y: 钢琴', formatLine('Y: 钢琴'))
check('adj293 J:  欢快 热烈（值内空格保留）→ J: 欢快 热烈', formatLine('J:  欢快 热烈') === 'J: 欢快 热烈', formatLine('J:  欢快 热烈'))
check('adj293 描述头按 V/B/Z/D/P/J/Y/S 才规范化（Q/C 行由 Q 行逻辑处理）', formatLine('C: 一 二') === 'C: 一 二', formatLine('C: 一 二'))
check('adj293 formatJps 描述头与内容之间值规范化', formatJps('Y:  钢琴\nQ:  1  2|\n').split('\n').slice(0, 2).join('|') === 'Y: 钢琴|Q: 1 2 |', formatJps('Y:  钢琴\nQ:  1  2|\n').split('\n').slice(0, 2).join('|'))

// ---- 6. 错误处理 ----
console.log('[6] error handling')
const re = parseJps('V: 1.0\nB: t\nC: 歌词先行\nQ: 1 2\n')
check('C 行先于 Q 行报错', re.errors.some((e) => e.message.includes('缺少对应')))
// adj301：@@ 为合法乐器指令（切回默认乐器），不再是孤立的 @ 报错
const ru = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 @@\n')
check('@@ 解析为乐器指令（切回默认，不报错）', ru.errors.length === 0 && ru.groups[0].music.tokens.some((t) => t.kind === 'instrument' && t.name === null), JSON.stringify(ru.errors))

// ---- 7. 排版（M1a） ----
console.log('[7] layout (M1a)')
const lay = layoutScore(r2, DUR_CFG)
check('1 页', lay.pages.length === 1, `got ${lay.pages.length}`)
const notes = lay.pages[0].notes
check('两只老虎音符数 = 32', notes.length === 32, `got ${notes.length}`)
const bars = lay.pages[0].barlines
check('两只老虎小节线数 = 9', bars.length === 9, `got ${bars.length}`)
check('小节线含 |: 与 :|', bars.some((b) => b.type === '|:') && bars.some((b) => b.type === ':|'))
check('note 有 audioPitch', notes[0].audioPitch !== null, String(notes[0].audioPitch))
check('note 时值>0', notes[0].duration > 0)

// ---- 8. 渲染（M1a） ----
console.log('[8] render (M1a)')
const svgs = renderScoreToSvg(lay)
check('产出 1 个 SVG 页面', svgs.length === 1)
const svg = svgs[0]
check('SVG 含标题', svg.includes('两只老虎'))
check('SVG 含调号', svg.includes('1 = C'))
check('SVG 含拍号', svg.includes('4/4'))
check('SVG 含节拍', svg.includes('♩= 120'))
check('SVG 含 data-notepos 契约', svg.includes('data-notepos="0_1_0_0"'))
const noteposCount = (svg.match(/data-notepos=/g) ?? []).length
check('音符 text 数量正确', noteposCount === 32, `got ${noteposCount}`)

// 复杂音符行渲染
const rc2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1\'- 2,,$ 3// 4. | 0 8 9 ||\n')
const lay2 = layoutScore(rc2, DUR_CFG)
const svg2 = renderScoreToSvg(lay2)[0]
const cnt2 = (svg2.match(/data-notepos=/g) ?? []).length
check('复杂行 6 个可见音符（8 隐藏休止不画）', cnt2 === 6, `got ${cnt2}`)
check('隐藏休止符不可播放', lay2.pages[0].notes.find((n) => n.token.kind === 'rest')?.playable === false)
check('SVG 含增时线 "-" 字符', svg2.includes('>-<'))
// 小节线 rect 高 = yBottom-yTop（随字号缩放）；断言只要存在小节线竖线即可（数量验证）
const barRects = (svg2.match(new RegExp(`width="(?:0\\.9|1\\.4)" height="16\\.[0-9]"`, 'g')) ?? []).length
check('小节线竖线 3 条（单线 1 + 双线 2：细+粗）', barRects === 3, `got ${barRects}`)

// ---- 9. 分页（M1b） ----
console.log('[9] pagination (M1b)')
const multi = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n[fenye]\nQ: 2 3 4 5 |\n')
const layM = layoutScore(multi, DUR_CFG)
check('分页后 2 页', layM.pages.length === 2, `got ${layM.pages.length}`)
check('第 1 页 8 音符', layM.pages[0].notes.length === 8, `got ${layM.pages[0].notes.length}`)
check('第 2 页 4 音符', layM.pages[1].notes.length === 4, `got ${layM.pages[1].notes.length}`)
check('第 2 页音符 page=1', layM.pages[1].notes[0].id.page === 1)
const svgM = renderScoreToSvg(layM)
check('渲染出 2 个 SVG 页面', svgM.length === 2)

// ---- 10. 自动换行（M1b） ----
console.log('[10] line wrap (M1b)')
const wide = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 2 3 4 5 6 7 1 2 3 4 5 6 7 1 2 3 4 5 6 7 1 2 3 4 5 6 7 1 2 3 4 5 6 7\n',
)
const layW = layoutScore(wide, DUR_CFG)
const rows = new Set(layW.pages[0].notes.map((n) => n.y))
check('超宽行自动断成多行', rows.size >= 2, `rows=${rows.size}`)
// 音符段终点 = 数字中心 + 半段宽（x + 6 + width/2）
const segEnd = (n: { x: number; width: number }) => n.x + 6 + n.width / 2
const maxX = Math.max(...layW.pages[0].notes.map(segEnd))
check('音符不超出右边距', maxX <= RIGHT_EDGE, `maxX=${maxX}`)
check('同页多行 y 递增', [...rows].sort((a, b) => a - b).every((v, i, arr) => i === 0 || v > arr[i - 1]))

// ---- 11. 歌词对齐（M1c） ----
console.log('[11] lyric alignment (M1c)')
const layL = layoutScore(r2, DUR_CFG) // 两只老虎
const lyrics0 = layL.pages[0].lyrics
check('两只老虎全部歌词字 = 32（两行曲 14+18）', lyrics0.length === 32, `got ${lyrics0.length}`)
const first = lyrics0[0]
check('歌词 cipos 与音符 notepos 同 id', first.id.page === 0 && first.id.index === 0)
check('歌词顺序：首字"两"', lyrics0[0].char.text === '两')
check('第一行曲歌词末字"快"', lyrics0[13].char.text === '快')
check('第二行曲歌词首字"一"', lyrics0[14].char.text === '一')
const svgL = renderScoreToSvg(layL)[0]
check('SVG 含 data-cipos 契约', svgL.includes('data-cipos="0_1_0_0"'))
check('SVG 歌词文字正确', svgL.includes('两') && svgL.includes('只') && svgL.includes('老') && svgL.includes('虎'))
const xiaoxing = parseJps(readFileSync(join(root, 'samples', 'xiaoxingxing.jps'), 'utf8'))
const layX = layoutScore(xiaoxing, DUR_CFG)
check('小星星共 42 个歌词字', layX.pages[0].lyrics.length === 42, `got ${layX.pages[0].lyrics.length}`)
check('小星星歌词首字=一', layX.pages[0].lyrics[0].char.text === '一')

// ---- 12. 行首命令快捷键（M2） ----
console.log('[12] line-header shortcuts (M2)')
const s1 = insertLineHeader('V: 1.0\n', 0, 'Q')
check('文首插入 Q:', s1?.text === 'Q: V: 1.0\n' && s1.pos === 3, JSON.stringify(s1))
const s2 = insertLineHeader('B: t\n', 5, 'C')
check('行首插入 C:', s2?.text === 'B: t\nC: ' && s2.pos === 8, JSON.stringify(s2))
const s3 = insertLineHeader('B: t', 2, 'Q')
check('行中不拦截（返回 null）', s3 === null)
const s4 = insertLineHeader('Q: 1 2\nC: 词', 7, 'C')
check('第 2 行行首插入 C（前一字符为换行）', s4?.text === 'Q: 1 2\nC: C: 词' && s4.pos === 10, JSON.stringify(s4))
check('isLineHeaderKey', isLineHeaderKey('Q') && isLineHeaderKey('H') && !isLineHeaderKey('X'))
const lc = lineColOf('V: 1.0\nB: t\n', 9)
check('lineColOf 第2行第2列', lc.line === 2 && lc.col === 2, JSON.stringify(lc))

// ---- 13. 错误行高亮（M2） ----
console.log('[13] error-line highlight (M2)')
const errCode = 'V: 1.0\nB: t\nQ: 1 2 @@\n'
const hl = highlightCode(errCode, new Set([3]))
check('错误行含 hl-error-line 标记', hl.includes('hl-error-line') && hl.split('hl-error-line').length >= 2)
const hlClean = highlightCode(errCode)
check('无错误行时不加标记', !hlClean.includes('hl-error-line'))
// adj186：Y/S 描述头与其它行头同色高亮（hl-line-header）
const hlYS = highlightCode('V: 1.0\nB: t\nY: 笛子\nS: 说明\nQ: 1 2 3 4 |\n')
check('adj186 Y: 行头高亮为 hl-line-header（青色）', hlYS.includes('<span class="hl-line-header">Y:') || hlYS.includes('hl-line-header">Y:'), '')
check('adj186 S: 行头高亮为 hl-line-header（青色）', hlYS.includes('<span class="hl-line-header">S:') || hlYS.includes('hl-line-header">S:'), '')
check('adj186 V:/B: 行头同样高亮', hlYS.includes('hl-line-header">V:') && hlYS.includes('hl-line-header">B:'), '')
// adj186：描述头提示列表覆盖全部描述头；adj192：加入 Q:/C: 及多声部/带声部名变体
check('adj192 描述头提示含 V/B/Z/D/P/J/Y/S/Q/C 及声部变体', HEADER_HINTS.length >= 16 && ['V:', 'B:', 'Z:', 'D:', 'P:', 'J:', 'Y:', 'S:', 'Q:', 'C:', 'Q1:', 'Q2:', 'C1:', 'C2:'].every((k) => HEADER_HINTS.some((h) => h.code === k)), JSON.stringify(HEADER_HINTS.map((h) => h.code)))
check('adj192 带声部名模板含 cursorAt（光标停引号内）', HEADER_HINTS.some((h) => h.code === 'Q1"声部名":' && h.cursorAt === 4) && HEADER_HINTS.some((h) => h.code === 'Q2"声部名":' && h.cursorAt === 4), JSON.stringify(HEADER_HINTS.filter((h) => h.cursorAt !== undefined)))
// adj202：行首输入描述头前缀实时过滤（不区分大小写；空前缀 = 全部）
{
  const fq = filterHeaderHints('q')
  check('adj202 q → Q:/Q1:/Q2: 等 5 项', fq.length === 5 && ['Q:', 'Q1:', 'Q2:'].every((k) => fq.some((h) => h.code === k)), fq.map((h) => h.code).join(','))
  const fQ = filterHeaderHints('Q')
  check('adj202 大写 Q 与 q 过滤一致', fQ.map((h) => h.code).join() === fq.map((h) => h.code).join(), '')
  const fv = filterHeaderHints('v')
  check('adj202 v → V:（1 项）', fv.length === 1 && fv[0].code === 'V:', fv.map((h) => h.code).join(','))
  const fq1 = filterHeaderHints('q1')
  check('adj202 q1 → Q1:/Q1"声部名":（2 项）', fq1.length === 2 && fq1.some((h) => h.code === 'Q1"声部名":'), fq1.map((h) => h.code).join(','))
  check('adj202 无匹配前缀 → 空数组', filterHeaderHints('xyz').length === 0)
  check('adj202 空前缀 → 全部', filterHeaderHints('').length === HEADER_HINTS.length)
}
// adj203：& 修饰符提示按上下文区分——小节线后提示小节线修饰符（含 &hs/&ty）
{
  check('adj203 小节线后 & 前缀非空 → 小节线修饰符池', isBarlineModifierContext('Q: 1 2 3 4 | &h') && isBarlineModifierContext('Q: 1 2 3 4 :| &'), '')
  check('adj203 音符后 & → 音符修饰符池', !isBarlineModifierContext('Q: 1 2 3 4 5 &') && !isBarlineModifierContext('Q: 1 2 3 4 5 &t'), '')
  const fh = filterModifierHints('h', true)
  check('adj203 | &h → hs（花 S，1 项）', fh.length === 1 && fh[0].code === 'hs', fh.map((h) => h.code).join(','))
  const ft = filterModifierHints('t', true)
  check('adj203 | &t → ty（大跳跃，1 项）', ft.length === 1 && ft[0].code === 'ty', ft.map((h) => h.code).join(','))
  const fAll = filterModifierHints('', true)
  check('adj203 小节线后空前缀 → 全部小节线修饰符（fine/dc/ds/ty/hs）', fAll.length === BARLINE_MODIFIER_HINTS.length && fAll.some((h) => h.code === 'hs') && fAll.some((h) => h.code === 'ty') && fAll.some((h) => h.code === 'fine'), fAll.map((h) => h.code).join(','))
  const fn = filterModifierHints('', false)
  check('adj203 音符后空前缀 → 音符修饰符池（含 tr/cy，不含 hs）', fn.some((h) => h.code === 'tr') && !fn.some((h) => h.code === 'hs'), '')
  // 力度修饰符：曲部输入 &（空前缀 / 已输字母）时应能弹出并过滤出力度编码
  const DYN_CODES = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sf', 'fp', 'sfp', 'rit']
  check('力度编码全部在音符修饰符池', DYN_CODES.every((c) => NOTE_MODIFIER_HINTS.some((h) => h.code === c)), NOTE_MODIFIER_HINTS.map((h) => h.code).join(','))
  check('曲部输入 & 空前缀 → 弹列表含力度 pp/mp/rit', fn.some((h) => h.code === 'pp') && fn.some((h) => h.code === 'mp') && fn.some((h) => h.code === 'rit'), '')
  const ffilt = filterModifierHints('f', false)
  check('输入 &f 前缀 → 过滤出 f/ff/fff（力度）', ['f', 'ff', 'fff'].every((c) => ffilt.some((h) => h.code === c)), ffilt.map((h) => h.code).join(','))
  // adj334：吐音/打音/叠音修饰符在音符修饰符池
  check('adj334 音符修饰符池含 tu/ku/da/die', ['tu', 'ku', 'da', 'die'].every((c) => NOTE_MODIFIER_HINTS.some((h) => h.code === c)), NOTE_MODIFIER_HINTS.map((h) => h.code).join(','))
}
// adj165：当前行背景 + 当前音符区块背景（光标行/列；Q: 为 3 字符，rest 从 col=3 起）
// adj171：当前行整行背景由 EditorPane 铺满层渲染，highlightCode 不再输出 hl-current-line
const hlCur = highlightCode('V: 1.0\nB: t\nQ: 1 2 3 4 |\n', undefined, { line: 3, col: 3 })
check('adj171 highlightCode 不再含 hl-current-line（整行背景移入组件铺满层）', !hlCur.includes('hl-current-line'), '')
check('adj165 光标所在音符区块带 hl-current-block', hlCur.includes('hl-current-block'), '')
check('adj165 当前行无错误时不叠加 hl-error-line', !hlCur.includes('hl-error-line'), '')
const hlCur2 = highlightCode('V: 1.0\nB: t\nQ: 1 2 3 4 |\n', undefined, { line: 3, col: 11 })
check('adj165 光标在小节线区块高亮（| 段）', hlCur2.includes('hl-current-block'), '')
// adj204：光标在块后紧邻（空白处紧贴块末 / 行尾）也应高亮该块——
// 继续输入的 & 修饰符针对该块（格式化后块间以单空格分隔，可区分块间隔）
const hlCur3 = highlightCode('V: 1.0\nB: t\nQ: 1 2 3 4 |\n', undefined, { line: 3, col: 10 })
check('adj204 光标在块后紧邻空格 → 高亮前一块（4）', hlCur3.includes('hl-current-block') && hlCur3.includes('hl-note">4<'), '')
const hlCur4 = highlightCode('V: 1.0\nB: t\nQ: 1 2 3 4 |\n', undefined, { line: 3, col: 12 })
check('adj204 光标在行尾紧邻 → 高亮最后一块（|）', hlCur4.includes('hl-current-block') && hlCur4.includes('hl-barline">|<'), '')
const hlCur5 = highlightCode('V: 1.0\nB: t\nQ: 1 2 3  4 |\n', undefined, { line: 3, col: 9 })
check('adj204 光标在块后远隔空白（col-1 为空格）→ 不高亮', !hlCur5.includes('hl-current-block'), '')
// adj243：高亮层按折行点分行，错误/告警块以单线外框包裹（col 相对该行内容）
{
  const src243 = 'V: 1.0\nB: t\nQ: 1 2 3 4 |\n'
  // content = "1 2 3 4 |"，col 8 = '|'（小节线块）；col 2 = '2'（音符块）
  const hlErr243 = highlightCodeWrapped(src243, undefined, null, [], new Map([[3, { err: [8], warn: [] }]]))
  check('adj243 错误块（小节线）包 hl-err-block', hlErr243.includes('hl-err-block') && hlErr243.includes('hl-barline'), '')
  const hlWarn243 = highlightCodeWrapped(src243, undefined, null, [], new Map([[3, { err: [], warn: [2] }]]))
  check('adj243 告警块（音符）包 hl-warn-block', hlWarn243.includes('hl-warn-block') && hlWarn243.includes('hl-note'), '')
  const hlNone243 = highlightCodeWrapped(src243, undefined, null, [])
  check('adj243 无错误/告警时不加外框', !hlNone243.includes('hl-err-block') && !hlNone243.includes('hl-warn-block'), '')
  // col 8 同时为错误块时优先红框（不叠加橙框）
  const hlBoth243 = highlightCodeWrapped(src243, undefined, null, [], new Map([[3, { err: [8], warn: [8] }]]))
  check('adj243 同块错误优先红框', hlBoth243.includes('hl-err-block') && !hlBoth243.includes('hl-warn-block'), '')
}
// adj246：空 rest 的 Q:/C: 行也要渲染行头（否则显示层成空行）
{
  const h246 = highlightCodeWrapped('V: 1.0\nQ:\nC:\n', undefined, null, [])
  check('adj246 空 Q: 行渲染行头', h246.includes('hl-line-header">Q:</span'), '')
  check('adj246 空 C: 行渲染行头', h246.includes('hl-line-header">C:</span'), '')
  check('adj246 空行不误加行头', !h246.includes('hl-line-header">1<'), '')
}
// adj208：有语法错误时仍渲染可解析部分（预览不闪动）——
// layout/render 对错误输入安全，错误行在解析阶段已跳过
{
  const src208 = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\nQ: 1 "2 3 4 | 5 6 7 1 |\nQ: 2 3 4 5 | 6 7 1 2 |\n'
  const r208 = parseJps(src208)
  const errLv208 = r208.errors.filter((e) => e.severity === 'error')
  const lay208 = layoutScore(r208, DUR_CFG)
  const svg208 = renderScoreToSvg(lay208)[0] ?? ''
  check('adj208 引号未闭合行（error 级）不阻断渲染（其余行正常出谱）', lay208.pages.length >= 1 && svg208.length > 500 && lay208.pages[0].notes.length >= 16, `pages=${lay208.pages.length} svgLen=${svg208.length} notes=${lay208.pages[0]?.notes.length ?? 0} errLv=${errLv208.length}`)
  const r208b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nC: 词\n')
  const lay208b = layoutScore(r208b, DUR_CFG)
  const svg208b = renderScoreToSvg(lay208b)[0] ?? ''
  check('adj208 歌词缺曲行（error 级）仍渲染（描述头页）', lay208b.pages.length >= 1 && svg208b.length > 100, `pages=${lay208b.pages.length} svgLen=${svg208b.length}`)
  const r208c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |"abc 5 6 7 1 |\n')
  const lay208c = layoutScore(r208c, DUR_CFG)
  const svg208c = renderScoreToSvg(lay208c)[0] ?? ''
  check('adj208 小节线后引号未闭合（error 级）仍渲染（吞掉引号后内容）', lay208c.pages.length >= 1 && svg208c.length > 100 && lay208c.pages[0].notes.length === 4, `svgLen=${svg208c.length} notes=${lay208c.pages[0]?.notes.length ?? 0}`)
}

// ---- 14. 光标映射（M3） ----
console.log('[14] cursor mapping (M3)')
// 行起点：'V: 1.0\n'=7, 'B: t\n'=5(→12), 'D: C\n'=5(→17), 'P: 4/4\n'=7(→24)，Q 行从 24 开始
const linkCode = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 词\n'
const id1 = codePosToNoteId(linkCode, 29) // '2' 后
check('光标在数字 2 后 → 0_1_0_1', id1 === '0_1_0_1', String(id1))
const id2 = codePosToNoteId(linkCode, 26) // 'Q: ' 后
check('光标在行头后 → 0_1_0_0', id2 === '0_1_0_0', String(id2))
const pos1 = noteIdToCodePos(linkCode, '0_1_0_2')
check('id 0_1_0_2 → 位置 31（数字 3）', pos1 === 31, String(pos1))
const round = codePosToNoteId(linkCode, pos1!)
check('round-trip 一致', round === '0_1_0_2', String(round))
// adj228：光标在行尾/最后音符之后 → 取最后一个音符（此前返回 null，预览无高亮）
check('adj228 行尾光标 → 最后音符', codePosToNoteId(linkCode, 35) === '0_1_0_3', String(codePosToNoteId(linkCode, 35)))
check('非 Q 行（歌词行）不联动', codePosToNoteId(linkCode, 44) === null, String(codePosToNoteId(linkCode, 44)))
// 分页场景：'V: 1.0\n'=7, 'B: t\n'=5(→12), 'Q: 1 2 |\n'=9(→21), '[fenye]\n'=8(→29)，Q2 行从 29 开始
const linkCode2 = 'V: 1.0\nB: t\nQ: 1 2 |\n[fenye]\nQ: 3 4 |\n'
const idPage1 = codePosToNoteId(linkCode2, 32) // Q2 行 '3' 后
check('分页后第 2 页音符 id page=1、index=2（全局计数）', idPage1 === '1_1_1_2', String(idPage1))
const posPage1 = noteIdToCodePos(linkCode2, '1_1_1_2')
check('第 2 页音符反向定位在 Q2 行', posPage1 === 32, String(posPage1))
// adj226：多声部块 id.group 用真实组索引（此前误用块内声部序号 vi——
// 前面有单声部行时组序号错位，预览↔编辑器光标联动全偏）
{
  const linkCode3 = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\nQ1: 2 3 4 5 |\nQ2: 6 7 1 2 |\n'
  const r226 = parseJps(linkCode3)
  const lay226 = layoutScore(r226, DUR_CFG)
  const ids226 = lay226.pages[0].notes.map((n) => `${n.id.voice}_${n.id.group}_${n.id.index}`)
  check(
    'adj226 多声部块 group 用真实组索引',
    ids226.join(',') ===
      '1_0_0,1_0_1,1_0_2,1_0_3,1_0_4,1_0_5,1_0_6,1_0_7,1_1_8,1_1_9,1_1_10,1_1_11,2_2_12,2_2_13,2_2_14,2_2_15',
    ids226.join(','),
  )
  check('adj226 codePosToNoteId 多声部 Q1 行 → 0_1_1_9', codePosToNoteId(linkCode3, 53) === '0_1_1_9', String(codePosToNoteId(linkCode3, 53)))
  check('adj226 noteIdToCodePos 多声部 Q2 行定位', noteIdToCodePos(linkCode3, '0_2_2_13') === 67, String(noteIdToCodePos(linkCode3, '0_2_2_13')))
}

// ---- 15. 播放序列（M4） ----
console.log('[15] play sequence (M4)')
const mkSeq = (q: string, bpm = 120) => {
  const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
  const lay = layoutScore(r, DUR_CFG)
  return buildPlaySequence(r, lay, bpm)
}
const pitchSeq = (seq: ReturnType<typeof buildPlaySequence>) =>
  seq.events.map((e) => e.placed.audioPitch).join(',')

// 基础时值：4 音符 @120bpm = 4×500ms
const ps0 = mkSeq('1 2 3 4 |')
check('无反复 4 事件', ps0.events.length === 4, `got ${ps0.events.length}`)
check('事件时值 500ms', ps0.events[0].durationMs === 500, String(ps0.events[0].durationMs))
check('atMs 递增', ps0.events[3].atMs === 1500, String(ps0.events[3].atMs))
check('总时长 2000ms', ps0.totalMs === 2000, String(ps0.totalMs))

// 反复 |: :|
const ps1 = mkSeq('|: 1 2 :| 3 4 |')
check('反复展开 6 事件（1,2,1,2,3,4）', pitchSeq(ps1) === 'C4,D4,C4,D4,E4,F4', pitchSeq(ps1))
// adj282：反复回跳后 atMs 单调平移（此前第二遍 atMs 与第一遍重叠 → 音频重叠/高亮错乱）
check('反复展开 atMs 单调不重叠', ps1.events.every((e, k) => k === 0 || e.atMs >= ps1.events[k - 1].atMs + ps1.events[k - 1].durationMs - 0.5), ps1.events.map((e) => Math.round(e.atMs)).join(','))
check('反复播放总时长 = 展开 2 遍', ps1.totalMs === 4000, String(ps1.totalMs))

// 跳房子（第二遍跳过 [ ] 段；adj23：跳房子 [ 须在小节线后，音符后的 [ 是倚音）
const ps2 = mkSeq('|: 1 2 | [ 3 4 ] 5 6 :|')
check('跳房子展开 10 事件', pitchSeq(ps2) === 'C4,D4,E4,F4,G4,A4,C4,D4,G4,A4', pitchSeq(ps2))
// adj282：跳房子跳过段后同一块第二遍 atMs 继续单调推进
check('跳房子展开 atMs 单调不重叠', ps2.events.every((e, k) => k === 0 || e.atMs >= ps2.events[k - 1].atMs + ps2.events[k - 1].durationMs - 0.5), ps2.events.map((e) => Math.round(e.atMs)).join(','))
check('跳房子播放总时长 = 2 遍', ps2.totalMs === 6000, String(ps2.totalMs))

// 终止线 || 停止
const ps3 = mkSeq('1 2 | 3 4 || 5 6 |')
check('终止线后停止（4 事件）', ps3.events.length === 4, `got ${ps3.events.length}`)

// 隐藏休止符占时不发声
const ps4 = mkSeq('1 8 3 |')
check('隐藏休止符事件仍占位（3 事件）', ps4.events.length === 3, `got ${ps4.events.length}`)
check('隐藏休止符 audioPitch=null', ps4.events[1].placed.audioPitch === null, String(ps4.events[1].placed.audioPitch))

// adj285：多曲行（多块）播放——totalMs = 各块累加、第二行 atMs 从第一行结束开始
//（此前 passEndMs 漏加 groupStartMs，totalMs 只算到第一块 → 播放到后续行中途被截断）
const rMulti = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nQ: 5 6 7 1 |\n')
const psMulti = buildPlaySequence(rMulti, layoutScore(rMulti, DUR_CFG), 120)
check('多曲行播放 8 事件', psMulti.events.length === 8, `got ${psMulti.events.length}`)
check('多曲行第二行 atMs = 第一行结束后（2000ms）', psMulti.events[4].atMs === 2000, String(psMulti.events[4].atMs))
check('多曲行播放总时长 = 各块累加（4000ms）', psMulti.totalMs === 4000, String(psMulti.totalMs))
// adj300：连音合并——播放拍段覆盖完整时值（(1 - - - | 1) - 0 0：1 合并 6 拍、色块拍段含被合并音符）
const rAdj = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 - - - | 1) - 0 0 |\n')
const seqAdj = buildPlaySequence(rAdj, layoutScore(rAdj, DUR_CFG), 120)
const evAdjC = seqAdj.events.filter((e) => e.placed.audioPitch === 'C4')
check('连音合并 1 单个事件且 6 拍（120bpm=3000ms）', evAdjC.length === 1 && Math.abs(evAdjC[0].durationMs - 3000) < 1, `${evAdjC.length}:${evAdjC[0]?.durationMs}`)
check('连音合并事件 playheadSegs 总拍数 = 6（覆盖被合并音符）', (evAdjC[0]?.playheadSegs ?? []).reduce((a, s) => a + s.beats, 0) === 6, String((evAdjC[0]?.playheadSegs ?? []).reduce((a, s) => a + s.beats, 0)))
const evAdjR = seqAdj.events.filter((e) => e.placed.token.kind === 'rest')
check('休止 0 0 单独事件（2 个）', evAdjR.length === 2, String(evAdjR.length))
// adj301：乐器指定——Y 默认乐器 / @乐器名 切换 / @@ 回默认
check('resolveInstrument：长笛→flute、小提琴→默认钢琴', resolveInstrument('长笛') === 'flute' && resolveInstrument('小提琴') === 'piano' && resolveInstrument('弦乐') === 'strings', `longdi=${resolveInstrument('长笛')} violin=${resolveInstrument('小提琴')}`)
const rInst = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 长笛\nQ: 1 2 @弦乐 3 4 @@ 5 6 |\n')
const instToks = rInst.groups[0].music.tokens.filter((t) => t.kind === 'instrument')
check('乐器切换 token 解析（@弦乐 / @@）', instToks.length === 2 && instToks[0].kind === 'instrument' && instToks[0].name === '弦乐' && instToks[1]?.name === null, JSON.stringify(instToks))
const seqInst = buildPlaySequence(rInst, layoutScore(rInst, DUR_CFG), 120)
check('Y 默认乐器 = 长笛（1 2 = flute）', seqInst.events[0]?.instrument === 'flute' && seqInst.events[1]?.instrument === 'flute', `${seqInst.events[0]?.instrument},${seqInst.events[1]?.instrument}`)
check('@弦乐 切换到弦乐（3 4 = strings）', seqInst.events[2]?.instrument === 'strings' && seqInst.events[3]?.instrument === 'strings', `${seqInst.events[2]?.instrument},${seqInst.events[3]?.instrument}`)
check('@@ 切回默认长笛（5 6 = flute）', seqInst.events[4]?.instrument === 'flute' && seqInst.events[5]?.instrument === 'flute', `${seqInst.events[4]?.instrument},${seqInst.events[5]?.instrument}`)
// adj302：多声部按 Y 行顺序对应乐器；声部比 Y 多时用默认
const rYv = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴\nY: 弦乐\nQ1: 1 2 3 4 |\nQ2: 5 6 5 3 |\n')
const seqYv = buildPlaySequence(rYv, layoutScore(rYv, DUR_CFG), 120)
const vY1 = seqYv.events.filter((e) => e.placed.id.voice === 1)[0]
const vY2 = seqYv.events.filter((e) => e.placed.id.voice === 2)[0]
check('多声部 Q1→Y[0] 钢琴、Q2→Y[1] 弦乐', vY1?.instrument === 'piano' && vY2?.instrument === 'strings', `${vY1?.instrument},${vY2?.instrument}`)
const rYv3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴\nY: 弦乐\nQ1: 1 2 3 4 |\nQ2: 5 6 5 3 |\nQ3: 1 3 5 1 |\n')
const seqYv3 = buildPlaySequence(rYv3, layoutScore(rYv3, DUR_CFG), 120)
const vY3 = seqYv3.events.filter((e) => e.placed.id.voice === 3)[0]
check('多声部 Q3（无对应 Y）用默认钢琴', vY3?.instrument === 'piano', String(vY3?.instrument))
const rYone = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴 弦乐\nQ: 1 2 3 4 |\n')
check('Y 行多乐器只取第一个（一个 Y 行一种）', rYone.header.instruments.length === 1 && rYone.header.instruments[0] === '钢琴', JSON.stringify(rYone.header.instruments))
// adj351：多声部声部乐器独立延续——第一组各声部 @ 乐器，第二组同声部延续（不再回归为最后一个声部音色）
const rMv = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: @大钢琴@ 1/ 2/ 2/ 3// (5// 5) - |\nQ2: @打击风琴@ 1/ 2/ 2/ 3// (5// 5) - |\nQ3: @大提琴@ 0 0 0 5/ 6/ | 5// 6// (5. 5) - |\nQ1: 6. 1'// (3// 3) - |\nQ2: 4. 5/ 3 - |\nQ3: 4 - 3 - |\n`)
const seqMv = buildPlaySequence(rMv, layoutScore(rMv, DUR_CFG), 120)
const q1Mv = seqMv.events.filter((e) => e.placed.id.voice === 1)
const q2Mv = seqMv.events.filter((e) => e.placed.id.voice === 2)
const q3Mv = seqMv.events.filter((e) => e.placed.id.voice === 3)
const gMv1 = q1Mv[0]?.placed.id.group
const mvFirst = { q1: q1Mv[0]?.instrument, q2: q2Mv[0]?.instrument, q3: q3Mv[0]?.instrument }
const mvNext = { q1: q1Mv.find((e) => e.placed.id.group !== gMv1)?.instrument, q2: q2Mv.find((e) => e.placed.id.group !== gMv1)?.instrument, q3: q3Mv.find((e) => e.placed.id.group !== gMv1)?.instrument }
check('adj351 多声部第一组音色：Q1=大钢琴 Q2=打击风琴 Q3=大提琴', mvFirst.q1 === '大钢琴' && mvFirst.q2 === '打击风琴' && mvFirst.q3 === '大提琴', `${mvFirst.q1},${mvFirst.q2},${mvFirst.q3}`)
check('adj351 多声部第二组延续同声部：Q1=大钢琴 Q2=打击风琴 Q3=大提琴', mvNext.q1 === '大钢琴' && mvNext.q2 === '打击风琴' && mvNext.q3 === '大提琴', `${mvNext.q1},${mvNext.q2},${mvNext.q3}`)
// adj303：显示乐器名——@乐器名 / @@ 后第一个音符正上方标注
const rIns = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 弦乐\nQ: 1 2 @钢琴 3 4 @@ 5 6 |\n')
const layIns = layoutScore(rIns, { ...DUR_CFG, showInstrument: true })
const noteIns3 = layIns.pages[0].notes.find((n) => n.audioPitch === 'E4')
const noteIns5 = layIns.pages[0].notes.find((n) => n.audioPitch === 'G4')
check('adj303 @钢琴 后音符标注"钢琴"', noteIns3?.instrumentLabel === '钢琴', String(noteIns3?.instrumentLabel))
check('adj303 @@ 后音符标注默认"弦乐"（Y 指定）', noteIns5?.instrumentLabel === '弦乐', String(noteIns5?.instrumentLabel))
const svgIns = renderScoreToSvg(layIns)[0]
check('adj303 showInstrument 开启渲染乐器名文本', svgIns.includes('>钢琴<') && svgIns.includes('>弦乐<'), '')
const svgInsOff = renderScoreToSvg(layoutScore(rIns, DUR_CFG))[0]
check('adj303 默认不显示乐器名', !svgInsOff.includes('>钢琴<'), '')
// adj354：@@ 无 Y 时显示默认音色名（用调用方传入 defaultInstrumentRef = 第一启用音色），不固定为钢琴
const rInsNoY = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 @钢琴 3 4 @@ 5 6 |\n')
const layInsNoY = layoutScore(rInsNoY, { ...DUR_CFG, showInstrument: true }, '八音盒')
{
  const n5 = layInsNoY.pages[0].notes.find((n) => n.audioPitch === 'G4')
  check('adj354 @@ 无 Y 时标注第一启用音色（八音盒）', n5?.instrumentLabel === '八音盒', String(n5?.instrumentLabel))
}
const layInsNoYNoRef = layoutScore(rInsNoY, { ...DUR_CFG, showInstrument: true })
{
  const n5 = layInsNoYNoRef.pages[0].notes.find((n) => n.audioPitch === 'G4')
  check('adj354 @@ 无 Y 且无传入默认时回退第一音色库第一音色（钢琴）', n5?.instrumentLabel === '钢琴', String(n5?.instrumentLabel))
}

// bpm 推断
check('J:96 → 96', inferBpm(parseJps('V: 1.0\nB: t\nJ: 96\n')) === 96)
check('无 J → 60（adj308 默认试听速度）', inferBpm(parseJps('V: 1.0\nB: t\n')) === 60)
check('J 文字 → 60（adj308 默认试听速度）', inferBpm(parseJps('V: 1.0\nB: t\nJ: 欢快的\n')) === 60)

// adj283：乐器/声部名 → 合成预设路由
check('乐器匹配：缺省/未知声部名 → 钢琴', matchInstrument(undefined) === 'piano' && matchInstrument('男声') === 'piano')
check('乐器匹配：小提琴 → 弦乐', matchInstrument('小提琴') === 'strings')
check('乐器匹配：长笛声部 → 长笛', matchInstrument('长笛声部') === 'flute')
check('乐器匹配：小号 → 铜管', matchInstrument('小号') === 'brass')
check('乐器匹配：英文 Music Box → 八音盒', matchInstrument('Music Box') === 'musicbox')

// adj289：MIDI 导出——复用播放序列（format 1：元数据轨 + 每声部音符轨）
console.log('[15b] MIDI export (adj289)')
check('pitchToMidiNote：C4=60 A4=69 F#5=78', pitchToMidiNote('C4') === 60 && pitchToMidiNote('A4') === 69 && pitchToMidiNote('F#5') === 78, `C4=${pitchToMidiNote('C4')} A4=${pitchToMidiNote('A4')} F#5=${pitchToMidiNote('F#5')}`)
const midiB = eventsToMidi(ps0.events, { bpm: 120, title: '测试' })
check('MIDI 文件头 MThd', String.fromCharCode(...midiB.slice(0, 4)) === 'MThd', String.fromCharCode(...midiB.slice(0, 4)))
check('MIDI format=1、2 轨、division=480', midiB[8] === 0 && midiB[9] === 1 && ((midiB[10] << 8) | midiB[11]) === 2 && ((midiB[12] << 8) | midiB[13]) === 480, [...midiB.slice(8, 14)].join(','))
// 简易 MIDI 轨道解析（跳过 14 字节头，按 MTrk 分轨）
const midiTracks: number[][] = []
{
  let p = 14
  while (p + 8 <= midiB.length) {
    const len = (midiB[p + 4] << 24) | (midiB[p + 5] << 16) | (midiB[p + 6] << 8) | midiB[p + 7]
    if (len === 0 || p + 8 + len > midiB.length) break
    midiTracks.push([...midiB.slice(p + 8, p + 8 + len)])
    p += 8 + len
  }
}
// 轨道事件解析（跳过 VLQ delta，返回 {status, data}）
const evList = (track: number[]): { status: number; data: number[] }[] => {
  const out: { status: number; data: number[] }[] = []
  let p = 0
  while (p < track.length) {
    let shift = 0
    while (true) {
      const b = track[p]
      p++
      shift += 7
      if ((b & 0x80) === 0 || shift >= 28) break
      if (p >= track.length) break
    }
    if (p >= track.length) break
    const st = track[p]
    if (st === 0xff) {
      const len = track[p + 2]
      out.push({ status: 0xff, data: track.slice(p + 3, p + 3 + len) })
      p += 3 + len
    } else if ((st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0) {
      out.push({ status: st, data: [track[p + 1]] })
      p += 2
    } else {
      out.push({ status: st, data: [track[p + 1], track[p + 2]] })
      p += 3
    }
  }
  return out
}
const ev0 = evList(midiTracks[0] ?? [])
const ev1 = evList(midiTracks[1] ?? [])
const noteOn1 = ev1.filter((e) => (e.status & 0xf0) === 0x90)
check('MIDI 音符轨 4 个 Note On', noteOn1.length === 4, String(noteOn1.length))
check('MIDI 首音 C4 → 60', noteOn1[0]?.data[0] === 60, String(noteOn1[0]?.data[0]))
check('MIDI 音符轨首事件 Program Change 钢琴(0)', (ev1[0]?.status ?? -1) === 0xc0 && ev1[0]?.data[0] === 0, JSON.stringify(ev1[0]))
check('MIDI 元数据轨含速度事件（120bpm）', ev0.some((e) => e.status === 0xff && e.data.length === 3 && ((e.data[0] << 16) | (e.data[1] << 8) | e.data[2]) === Math.round(60000000 / 120)), '')

// adj290：WAV（PCM16）编码——音频导出（离线渲染 → WAV/MP3）共用
const wavB = pcmToWav(
  [new Float32Array([0, 0.5, -0.5]), new Float32Array([0, -0.5, 0.5])],
  44100,
)
check('WAV 头 RIFF/WAVE', String.fromCharCode(...wavB.slice(0, 4)) === 'RIFF' && String.fromCharCode(...wavB.slice(8, 12)) === 'WAVE', String.fromCharCode(...wavB.slice(0, 4)))
check('WAV 双声道 PCM16 采样率 44100', wavB[22] === 2 && (wavB[24] | (wavB[25] << 8) | (wavB[26] << 16) | (wavB[27] << 24)) === 44100 && wavB[34] === 16, [wavB[22], wavB[24], wavB[34]].join(','))
check('WAV data 大小 = 3 帧×2 声道×2 字节 = 12', (wavB[40] | (wavB[41] << 8) | (wavB[42] << 16) | (wavB[43] << 24)) === 12, String(wavB[40]))
// 帧内交错采样：frame1 = (0.5, -0.5) → int16 0x4000 / 0xC000（小端）
check('WAV 采样值：0.5 → 0x4000、-0.5 → 0xC000（小端交错）', wavB[48] === 0x00 && wavB[49] === 0x40 && wavB[50] === 0x00 && wavB[51] === 0xc0, [wavB[48], wavB[49], wavB[50], wavB[51]].join(','))

// ---- 16. 页面设置（M5） ----
console.log('[16] page config (M5)')
// 横版纸张
const cfgH = { ...DUR_CFG, page: 'A4_horizontal' as const }
const layH = layoutScore(r2, cfgH)
check('横版 A4 尺寸 841.89×595.28', layH.pages[0].width === 841.89 && layH.pages[0].height === 595.28, `${layH.pages[0].width}×${layH.pages[0].height}`)

// 行距配置（adj79 拆分：有歌词行行尾用曲部与上一行词部间距，无歌词行用曲部与曲部间距）
// r2（两只老虎）有歌词 → 第二行行高受 height_ciqu_lyric 影响
const y1 = layoutScore(r2, DUR_CFG).pages[0].notes[14].y
const y2 = layoutScore(r2, { ...DUR_CFG, height_ciqu_lyric: 200 }).pages[0].notes[14].y
check('曲部与上一行词部间距增大 → 第二行更靠下（有歌词）', y2 - y1 > 50, `diff=${y2 - y1}`)
// 无歌词行：行尾间距走 height_ciqu（曲部与曲部间距）；4 行谱保证换行（首行 24 音符）
const noLyric = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const rowY = (lay: ReturnType<typeof layoutScore>) =>
  [...new Set(lay.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
const yN1 = rowY(layoutScore(noLyric, DUR_CFG))[1]
const yN2 = rowY(layoutScore(noLyric, { ...DUR_CFG, height_ciqu: 200 }))[1]
check('曲部与曲部间距增大 → 第二行更靠下（无歌词）', yN2 - yN1 > 50, `diff=${yN2 - yN1}`)

// 音符字体（adj105：由字形 a/b/c 改为字体名，直接用于 SVG font-family）
const svgA = renderScoreToSvg(layoutScore(r2, { ...DUR_CFG, shuzi_font: 'Georgia' }))[0]
const svgB = renderScoreToSvg(layoutScore(r2, { ...DUR_CFG, shuzi_font: 'Microsoft YaHei' }))[0]
const svgC = renderScoreToSvg(layoutScore(r2, { ...DUR_CFG, shuzi_font: 'KaiTi' }))[0]
check('音符字体 = 设置的字体名（Georgia）', svgA.includes('font-family="Georgia"'))
check('音符字体 = 设置的字体名（微软雅黑，默认）', svgB.includes('Microsoft YaHei') && !svgB.includes('Georgia'))
check('音符字体 = 设置的字体名（KaiTi）', svgC.includes('KaiTi'))

// 按页覆盖行距 heights['a1'] → 第 2 页 ciqu=150
const cfgPages = { ...DUR_CFG, heights: { a1: [13, 10, 150, 0] } }
const multiP = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 |\n[fenye]\nQ: 5 6 7 1 | 5 6 7 1 |\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layP = layoutScore(multiP, cfgPages)
check('heights 分页 2 页', layP.pages.length === 2)
const rowsOverride = [...new Set(layP.pages[1].notes.map((n) => n.y))].sort((a, b) => a - b)
const layPDef = layoutScore(multiP, DUR_CFG)
const rowsDefault = [...new Set(layPDef.pages[1].notes.map((n) => n.y))].sort((a, b) => a - b)
const gapOverride = rowsOverride[1] - rowsOverride[0]
const gapDefault = rowsDefault[1] - rowsDefault[0]
check('按页覆盖行距生效（第 2 页 ciqu 150 > 40）', gapOverride - gapDefault > 50, `gap=${gapDefault}→${gapOverride}`)

// ---- 16b. 乐器 Y / 说明 S（adj83） ----
console.log('[16b] instruments Y / notes S (adj83)')
const ysSrc = 'V: 1.0\nB: 测试曲\nZ: 作者\nD: C\nP: 4/4\nY: 笛子\nY: 二胡\nS: 这是一段说明\nS: 第二行说明\nQ: 1 2 3 4 |\n'
const rYs = parseJps(ysSrc)
check('Y/S 无解析错误', rYs.errors.length === 0, JSON.stringify(rYs.errors))
check('Y 多行乐器解析', rYs.header.instruments.length === 2 && rYs.header.instruments[0] === '笛子' && rYs.header.instruments[1] === '二胡', JSON.stringify(rYs.header.instruments))
check('S 多行说明解析', rYs.header.notes.length === 2 && rYs.header.notes[0] === '这是一段说明' && rYs.header.notes[1] === '第二行说明', JSON.stringify(rYs.header.notes))
const layYs = layoutScore(rYs, DUR_CFG)
const svgYs = renderScoreToSvg(layYs)[0]
check('乐器渲染在副标题下（data-meta=instrument_i）', svgYs.includes('data-meta="instrument_0"') && svgYs.includes('data-meta="instrument_1"'), '')
check('adj151 说明渲染在谱尾左对齐（data-meta=notes_i）', svgYs.includes('data-meta="notes_0"') && svgYs.includes('data-meta="notes_1"') && svgYs.includes('这是一段说明') && svgYs.includes('第二行说明'), '')
// 说明文字位置：最后一页下边距线上方、左边距（左对齐，adj151）
const ysNotesEl = /data-meta="notes_0" data-notes-line="0" data-notes-sub="0" x="([\d.]+)" y="([\d.]+)"/.exec(svgYs)
check('adj151 说明默认在下边距线上方且左对齐（x=左边距）', ysNotesEl !== null && Number(ysNotesEl[2]) < layoutScore(rYs, DUR_CFG).pages[0].height - defaultPageConfig.margin_bottom && Math.abs(Number(ysNotesEl[1]) - defaultPageConfig.margin_left) < 0.5, `x=${ysNotesEl?.[1]} y=${ysNotesEl?.[2]}`)
// adj153：说明内容不超边距——超宽自动换行、x 钳制在左右边距内（右缘不超右边距）
const longNotesSrc = 'V: 1.0\nB: 测试\nD: C\nP: 4/4\nS: ' + '超长说明文字'.repeat(12) + '\nQ: 1 |\n'
const rLn = parseJps(longNotesSrc)
const layLn = layoutScore(rLn, DUR_CFG)
const svgLn = renderScoreToSvg(layLn)[0]
const lnSubs = [...svgLn.matchAll(/data-meta="notes_0" data-notes-line="0" data-notes-sub="(\d+)" x="([\d.]+)"[^>]*>([^<]*)</g)]
check('adj153 超宽 S 行自动换行为多个子行', lnSubs.length > 1, `子行数=${lnSubs.length}`)
const pageW0 = layLn.pages[0].width
const rightEdge = pageW0 - defaultPageConfig.margin_right
const within = lnSubs.every((m) => {
  const x = Number(m[2])
  const text = m[3]
  // 估算宽（中文按 notes_size/字符，拉丁按 0.62×notes_size）
  const w = [...text].reduce((s, ch) => s + (ch.charCodeAt(0) > 127 ? defaultPageConfig.notes_size : defaultPageConfig.notes_size * 0.62), 0)
  return x >= defaultPageConfig.margin_left - 0.01 && x + w <= rightEdge + 0.01
})
check('adj153 每个子行左缘不超左边距、右缘不超右边距', within, lnSubs.map((m) => `${m[2]}+${m[3].length}字`).join('|'))
// 拖拽偏移很大时 x 仍被钳制（不超右边距）
const svgLn2 = renderScoreToSvg(layoutScore(rLn, { ...DUR_CFG, metaPos: { notes_0: { x: 900, y: 0 } } }))[0]
const ln2 = /data-meta="notes_0" data-notes-line="0" data-notes-sub="0" x="([\d.]+)"/.exec(svgLn2)
check('adj153 大偏移下 x 钳制（右缘不超右边距）', ln2 !== null && Number(ln2[1]) <= rightEdge, `x=${ln2?.[1]} rightEdge=${rightEdge}`)

// ---- 16d. S 说明 \n 换行 + 独立字体字号（adj154） ----
console.log('[16d] notes \\n wrap & independent font (adj154)')
const nlSrc = 'V: 1.0\nB: 测试\nD: C\nP: 4/4\nS: 第一段\\n第二段\nQ: 1 |\n'
const rNl = parseJps(nlSrc)
check('adj154 S 行 \\n 拆成 2 行说明', rNl.header.notes.length === 2 && rNl.header.notes[0] === '第一段' && rNl.header.notes[1] === '第二段', JSON.stringify(rNl.header.notes))
const svgNl = renderScoreToSvg(layoutScore(rNl, DUR_CFG))[0]
check('adj154 \\n 拆行渲染为两个 text（notes_0/notes_1）', svgNl.includes('data-meta="notes_0"') && svgNl.includes('data-meta="notes_1"') && svgNl.includes('第一段') && svgNl.includes('第二段'), '')
const svgNl2 = renderScoreToSvg(layoutScore(rNl, { ...DUR_CFG, notes_font: 'KaiTi', notes_size: 16 }))[0]
const nl2 = /data-meta="notes_0" data-notes-line="0" data-notes-sub="0" x="([\d.]+)" y="([\d.]+)"[^>]*>第一段/.exec(svgNl2)
check('adj154 S 独立字体字号生效（KaiTi/16）', nl2 !== null && svgNl2.includes('font-family="KaiTi"') && svgNl2.includes('font-size="16"'), '')
const nl2b = /data-meta="notes_1" data-notes-line="1" data-notes-sub="0" x="([\d.]+)" y="([\d.]+)"/.exec(svgNl2)
check('adj154 \\n 第二行按独立字号下移（y 差 = 16×1.4）', nl2 !== null && nl2b !== null && Math.abs(Number(nl2b[2]) - Number(nl2[2]) - 16 * 1.4) < 0.2, `y0=${nl2?.[2]} y1=${nl2b?.[2]}`)
// 独立字号下不超右边距（16px 中文 16/字符）
const nl3 = [...svgNl2.matchAll(/data-meta="notes_\d+" data-notes-line="\d+" data-notes-sub="0" x="([\d.]+)"[^>]*>([^<]*)</g)]
const nlWithin = nl3.every((m) => {
  const x = Number(m[1])
  const w = [...m[2]].reduce((s, ch) => s + (ch.charCodeAt(0) > 127 ? 13 : 7.62), 0) * (16 / 13)
  return x >= defaultPageConfig.margin_left - 0.01 && x + w <= rightEdge + 0.01
})
check('adj154 独立字号下说明仍不超边距', nlWithin, nl3.map((m) => m[1]).join('|'))

// ---- 16c. 谱面级设置 # jps-config（adj83） ----
console.log('[16c] per-score settings # jps-config (adj83)')
const codeW = writeJpsConfig(ysSrc, { ...DUR_CFG, margin_top: 123, metaPos: { notes: { x: 10, y: -30 } } })
check('writeJpsConfig 追加 # jps-config 行', codeW.includes('# jps-config:'), codeW.split('\n').slice(-2).join('|'))
// adj200：追加前默认补 3 个空行（把设置行与正文隔开，避免误改误删）
{
  const cfgIdx = codeW.split('\n').findIndex((l) => l.startsWith('# jps-config:'))
  const beforeCfg = codeW.split('\n').slice(Math.max(0, cfgIdx - 3), cfgIdx)
  check('adj200 追加 # jps-config 前默认 3 空行', beforeCfg.length === 3 && beforeCfg.every((l) => l === ''), beforeCfg.map((l) => JSON.stringify(l)).join('|'))
}
const exCfg = extractJpsConfig(codeW)
check('extractJpsConfig 回读 margin_top=123', exCfg !== null && exCfg.margin_top === 123, JSON.stringify(exCfg))
check('extractJpsConfig 回读 metaPos.notes', exCfg !== null && exCfg.metaPos?.notes?.x === 10 && exCfg.metaPos?.notes?.y === -30, JSON.stringify(exCfg?.metaPos))
const mgCfg = mergeJpsConfig(codeW, null)
check('mergeJpsConfig 谱面设置优先（margin_top=123）', mgCfg.margin_top === 123 && mgCfg.note_size === defaultPageConfig.note_size, `mt=${mgCfg.margin_top}`)
check('无 # 设置时回退默认（margin_top=默认）', mergeJpsConfig(ysSrc, null).margin_top === defaultPageConfig.margin_top, `mt=${mergeJpsConfig(ysSrc, null).margin_top}`)
const codeW2 = writeJpsConfig(codeW, { ...DUR_CFG, margin_top: 200 })
check('writeJpsConfig 原位更新已有行（margin_top=200，不重复追加）', codeW2.split('\n').filter((l) => l.startsWith('# jps-config:')).length === 1 && extractJpsConfig(codeW2)?.margin_top === 200, '')
// adj221：编辑器字体/字号随谱保存——PageConfig 可选字段不在 defaultPageConfig 对象上，
// 白名单必须显式涵盖，否则写回后读回被过滤丢失
{
  const codeW3 = writeJpsConfig(ysSrc, { ...DUR_CFG, editorFont: 'Courier New', editorFontSize: 18 })
  const ex3 = extractJpsConfig(codeW3)
  check('adj221 extractJpsConfig 回读 editorFont', ex3 !== null && ex3.editorFont === 'Courier New', JSON.stringify(ex3))
  check('adj221 extractJpsConfig 回读 editorFontSize', ex3 !== null && ex3.editorFontSize === 18, JSON.stringify(ex3))
  const mg3 = mergeJpsConfig(codeW3, null)
  check('adj221 mergeJpsConfig 谱面 editorFont/Size 优先', mg3.editorFont === 'Courier New' && mg3.editorFontSize === 18, `font=${mg3.editorFont} fs=${mg3.editorFontSize}`)
  check('adj221 无谱面设置时缺省（editorFont 未定义）', mergeJpsConfig(ysSrc, null).editorFont === undefined, `font=${mergeJpsConfig(ysSrc, null).editorFont}`)
}
// 损坏 JSON 忽略（回退默认）
const badCfg = mergeJpsConfig('V: 1.0\n# jps-config:{bad json\nQ: 1 2 3 4 |\n', null)
check('损坏 # jps-config 静默回退默认', badCfg.margin_top === defaultPageConfig.margin_top, `mt=${badCfg.margin_top}`)

// ---- 17. 多声部（M7a） ----
console.log('[17] voice blocks (M7a)')
const vc = parseJps('V: 1.0\nB: 多声部测试\nD: C\nP: 4/4\nQ1: 1 2 3 4 |\nC1: 男 声 歌 词\nQ2: 5 6 5 3 |\nC2: 女 声 歌 词\n')
const layV = layoutScore(vc, DUR_CFG)
check('多声部 1 页', layV.pages.length === 1, `got ${layV.pages.length}`)
const vb = layV.pages[0].voiceBlocks
check('1 个声部块', vb.length === 1, `got ${vb.length}`)
check('块含 2 声部', vb[0]?.voices.length === 2)
const v1Notes = layV.pages[0].notes.filter((n) => n.id.voice === 1)
const v2Notes = layV.pages[0].notes.filter((n) => n.id.voice === 2)
check('两个声部各 4 音符', v1Notes.length === 4 && v2Notes.length === 4, `${v1Notes.length}/${v2Notes.length}`)
check('声部纵向堆叠（y 不同）', Math.abs(v1Notes[0].y - v2Notes[0].y) > 10, `dy=${Math.abs(v1Notes[0].y - v2Notes[0].y)}`)
check('块小节线跨声部', layV.pages[0].barlines.length >= 1)
const svgV = renderScoreToSvg(layV)[0]
check('SVG 含大括号 path', svgV.includes('fill="none" stroke="#1b1b1b"'))
check('adj273 无名称不显示声部标签', !svgV.includes('声部1') && !svgV.includes('声部2'))
// 命名声部
const vc2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1"男声": 1 2 3 4 |\nQ2"女声": 5 6 5 3 |\n')
const layV2 = layoutScore(vc2, DUR_CFG)
const vb2 = layV2.pages[0].voiceBlocks[0]
check('命名声部解析', vb2?.voices[0]?.name === '男声' && vb2?.voices[1]?.name === '女声')
const svgV2 = renderScoreToSvg(layV2)[0]
check('SVG 含声部名称文本', svgV2.includes('男声') && svgV2.includes('女声'))
// 多声部+单声部混合
const vc3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nQ1: 5 6 5 3 |\nQ2: 3 4 5 1 |\nQ: 5 3 1 - |\n')
const layV3 = layoutScore(vc3, DUR_CFG)
check('混合排版 1 个块 + 单声部组', layV3.pages[0].voiceBlocks.length === 1)
check('混合：总音符 15（末行 1- 为 1 音符+增时线）', layV3.pages[0].notes.length === 15, `got ${layV3.pages[0].notes.length}`)
// adj282：多声部播放——Q1/Q2 同拍 atMs 相等（同步保持）+ 展开事件 atMs 单调
const seqV = buildPlaySequence(vc, layV, 120)
const seqV1 = seqV.events.filter((e) => e.placed.id.voice === 1)
const seqV2 = seqV.events.filter((e) => e.placed.id.voice === 2)
check('多声部同拍 atMs 相等（Q1/Q2 同步）', seqV1.length === seqV2.length && seqV1.every((e, k) => Math.abs(e.atMs - seqV2[k].atMs) < 1), seqV1.map((e) => Math.round(e.atMs)).join(',') + ' / ' + seqV2.map((e) => Math.round(e.atMs)).join(','))
// 各声部内部 atMs 单调（跨声部同拍 atMs 相同是同步预期，整体非单调）
const monoV = (list: typeof seqV1) => list.every((e, k) => k === 0 || e.atMs >= list[k - 1].atMs - 0.5)
check('多声部各声部内 atMs 单调', monoV(seqV1) && monoV(seqV2), seqV.events.map((e) => `${e.placed.id.voice}:${Math.round(e.atMs)}`).join(','))
// adj289：多声部 MIDI 分轨——元数据 + Q1 + Q2 共 3 轨
const midiV = eventsToMidi(seqV.events, { bpm: 120 })
{
  let p = 14
  let trackCount = 0
  while (p + 8 <= midiV.length) {
    const len = (midiV[p + 4] << 24) | (midiV[p + 5] << 16) | (midiV[p + 6] << 8) | midiV[p + 7]
    if (len === 0 || p + 8 + len > midiV.length) break
    trackCount++
    p += 8 + len
  }
  check('多声部 MIDI 3 轨（元数据 + Q1 + Q2）', trackCount === 3, String(trackCount))
}

// ---- 18. 跳房子（M7b） ----
console.log('[18] volta rendering (M7b)')
const volta = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |[ 3 4 ] 5 6 |\n')
const layVo = layoutScore(volta, DUR_CFG)
const voBars = layVo.pages[0].barlines
check('跳房子起终点解析', voBars.some((b) => b.voltaStart?.open) && voBars.some((b) => b.voltaEnd))
const svgVo = renderScoreToSvg(layVo)[0]
// 跳房子线在 y = yTop-16 高度（adj50；adj150 线宽 0.8）
const voY = voBars.find((b) => b.voltaStart)!.yTop - VOLTA_BAR_GAP
const voltaLines = (svgVo.match(new RegExp(`y1="${voY}"[^>]*stroke-width="0.8"`, 'g')) ?? []).length
check('SVG 含跳房子线（起竖+横+终竖 ≥3）', voltaLines >= 3, `got ${voltaLines}`)
// 番号（小节线引号备注）与 [ 合并显示
const volta2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"1." [ 3 4 ] 5 6 |\n')
const layVo2 = layoutScore(volta2, DUR_CFG)
const v2Bars = layVo2.pages[0].barlines.filter((b) => b.voltaStart)
check('番号与起点合并', v2Bars.length === 1 && v2Bars[0].comment === '1.')
const svgVo2 = renderScoreToSvg(layVo2)[0]
check('SVG 番号显示在线上方', svgVo2.includes('>1.<'))
// 未封闭 [/ 向右延伸
const volta3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |[ 3 4 5 6 |\n')
const layVo3 = layoutScore(volta3, DUR_CFG)
const svgVo3 = renderScoreToSvg(layVo3)[0]
const vo3Start = layVo3.pages[0].barlines.find((b) => b.voltaStart)
const vo3Y = vo3Start ? vo3Start.yTop - VOLTA_BAR_GAP : NaN
const openLines = (svgVo3.match(new RegExp(`y1="${vo3Y}"[^>]*stroke-width="0.8"`, 'g')) ?? []).length
check('未封闭 [/ 只画起点+横线（2 条）', openLines === 2, `got ${openLines}`)

// ---- 19. 连音线（M7c） ----
console.log('[19] slurs (M7c)')
const slur = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) 4 |\n')
const laySl = layoutScore(slur, DUR_CFG)
check('1 条连音线', laySl.pages[0].slurs.length === 1, `got ${laySl.pages[0].slurs.length}`)
const sl0 = laySl.pages[0].slurs[0]
check('连音线范围覆盖 2、3（x2 > x1）', sl0 !== undefined && sl0.x2 > sl0.x1, `${sl0?.x1}→${sl0?.x2}`)
const svgSl = renderScoreToSvg(laySl)[0]
check('SVG 含圆弧贝塞尔', svgSl.includes('<path d="M ') && svgSl.includes(' Q '))
// 嵌套
const slur2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 ( 3 4 ) 5 ) 6 |\n')
const laySl2 = layoutScore(slur2, DUR_CFG)
check('嵌套 2 条连音线', laySl2.pages[0].slurs.length === 2, `got ${laySl2.pages[0].slurs.length}`)
const depths = laySl2.pages[0].slurs.map((s) => s.depth).sort((a, b) => a - b)
check('嵌套深度 0 和 1', depths[0] === 0 && depths[1] === 1, JSON.stringify(depths))
// adj55：先进后出（LIFO 栈式）配对：最近打开的先闭合（标准括号嵌套）；
// slurs[0] = 内层（depth1，更低）、slurs[1] = 外层（depth0，更高）
check('深度 1 的线更低（内层小连音符包在外层大连音符下面）', laySl2.pages[0].slurs[0].y > laySl2.pages[0].slurs[1].y, `${laySl2.pages[0].slurs[0].y} vs ${laySl2.pages[0].slurs[1].y}`)
// adj44/95：嵌套抬升 2px（外层线比内层线高 2px）
check('嵌套抬升 2px（外层 y = 内层 y - 2，adj95）', Math.abs(laySl2.pages[0].slurs[0].y - laySl2.pages[0].slurs[1].y - 2) < 0.5, `${laySl2.pages[0].slurs[0].y} vs ${laySl2.pages[0].slurs[1].y}`)
// adj106：嵌套时外层连音线一律平顶（内层 2 单位仍圆弧）
check('adj106 嵌套外层连音线平顶、内层圆弧', laySl2.pages[0].slurs[0].style === 'arc' && laySl2.pages[0].slurs[1].style === 'flat', `${laySl2.pages[0].slurs[0].style}/${laySl2.pages[0].slurs[1].style}`)
// 平顶样式（adj89：两端大弧度弧线过渡到平顶线）
const laySl3 = layoutScore(slur, { ...DUR_CFG, lianyinxian_type: 2 })
const svgSl3 = renderScoreToSvg(laySl3)[0]
check('平顶样式：1/4 圆弧（A）+ 平顶横线', svgSl3.includes('<path d="M') && svgSl3.includes(' A ') && svgSl3.includes(' L '), '')
const s3Flat = laySl3.pages[0].slurs[0]
// 平顶线 y-5（SVG 数值可能省略 .0 尾零，用正则容错）
const flatLineY = (s3Flat.y - 5).toFixed(1).replace('.0', '')
check('平顶样式：两端 1/4 圆弧过渡到平顶线 y-5', svgSl3.includes(`M ${s3Flat.x1} ${s3Flat.y} A`) && svgSl3.includes(` L `) && new RegExp(` ${flatLineY}(?:\\.0)? `).test(svgSl3), svgSl3.slice(0, 250))
// adj54：自动样式按「音符单位数」判断（增时线/附点折算进长度，>4 单位平顶）
const slAuto = (q: string) => layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), DUR_CFG).pages[0].slurs[0]?.style
check('自动样式：4 个普通音符 = 4 单位 → 圆弧（边界不回归）', slAuto('( 1 2 3 4 ) 5 |') === 'arc', `got ${slAuto('( 1 2 3 4 ) 5 |')}`)
check('自动样式：5 个普通音符 = 5 单位 → 平顶（边界不回归）', slAuto('( 1 2 3 4 5 ) 6 |') === 'flat', `got ${slAuto('( 1 2 3 4 5 ) 6 |')}`)
check('自动样式：增时线折算（1- 2 3 4 = 5 单位）→ 平顶', slAuto('( 1- 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1- 2 3 4 ) 5 |')}`)
check('自动样式：附点折算（1. 2 3 4 = 4.5 单位）→ 平顶', slAuto('( 1. 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1. 2 3 4 ) 5 |')}`)
check('自动样式：附点折算边界（1. 2 3 = 3.5 单位）→ 圆弧', slAuto('( 1. 2 3 ) 4 |') === 'arc', `got ${slAuto('( 1. 2 3 ) 4 |')}`)
check('自动样式：增时线+附点（1-. 2 3 4 = 6 单位）→ 平顶', slAuto('( 1-. 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1-. 2 3 4 ) 5 |')}`)
// adj56：同起点嵌套 —— ((3 2/) 4)：内层与外层都从 3 开始（内层 3→2、外层 3→4）
const slAdj56 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ((3 2/) 4) |\n')
const layAdj56 = layoutScore(slAdj56, DUR_CFG)
const sl56 = layAdj56.pages[0].slurs
check('同起点嵌套：2 条连音线（内层 3→2、外层 3→4）', sl56.length === 2, `got ${sl56.length}`)
check('同起点：两条线 x1 相同（都从 3 开始）', sl56.length === 2 && Math.abs(sl56[0].x1 - sl56[1].x1) < 0.5, `${sl56[0]?.x1} vs ${sl56[1]?.x1}`)
check('同起点：内层（depth1）更低、外层（depth0）更高', sl56.length === 2 && sl56[0].depth === 1 && sl56[1].depth === 0 && sl56[0].y > sl56[1].y, JSON.stringify(sl56.map((s) => ({ d: s.depth, y: s.y }))))
check('同起点：内层 x2 < 外层 x2（3→2 短、3→4 长）', sl56.length === 2 && sl56[0].x2 < sl56[1].x2, `${sl56[0]?.x2} vs ${sl56[1]?.x2}`)
// adj106：同起点嵌套外层同样平顶（不按单位数回退圆弧）
check('adj106 同起点嵌套外层平顶', sl56.length === 2 && sl56[1].style === 'flat', JSON.stringify(sl56.map((s) => s.style)))

// ---- 20. 装饰符号（M7d） ----
console.log('[20] decorations (M7d)')
const deco = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&tr 2&mp 3 < 4 5 ! 6 |\n')
const dt0 = deco.groups[0].music.tokens[0]
check('&tr 解析到音符符号', dt0.kind === 'note' && dt0.symbols.includes('tr'))
const dt1 = deco.groups[0].music.tokens[1]
check('&mp 解析到音符符号', dt1.kind === 'note' && dt1.symbols.includes('mp'))
const layDe = layoutScore(deco, DUR_CFG)
check('渐强渐弱 1 条', layDe.pages[0].dynamics.length === 1, `got ${layDe.pages[0].dynamics.length}`)
check('渐强类型 crescendo', layDe.pages[0].dynamics[0]?.type === 'crescendo')
const svgDe = renderScoreToSvg(layDe)[0]
check('SVG 含 tr 颤音', svgDe.includes('>tr<'))
check('SVG 含 mp 力度（花体文字 mp）', svgDe.includes('>mp<'), '')
check('SVG 含渐强 hairpin（开口尖括号，非梯形）', /<path d="M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+ M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+" fill="none" stroke="#1b1b1b" stroke-width="0.8"/.test(svgDe), '')
// adj：力度记号用花体（斜体加粗居中）；不用 Bravura 等非系统字体，保证跨平台可见
check('力度记号花体渲染（斜体加粗 + Segoe Script + mp）', /<text[^>]*font-style="italic"[^>]*font-weight="bold"[^>]*font-family="[^"]*Segoe Script[^"]*"[^>]*>mp<\/text>/.test(svgDe), '')
{
  const rRit = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&rit 2 |\n')
  const svgRit = renderScoreToSvg(layoutScore(rRit, DUR_CFG))[0]
  check('rit 用花体文字（font-family 含 Segoe Script）', /<text[^>]*font-family="[^"]*Segoe Script[^"]*"[^>]*>rit<\/text>/.test(svgRit), '')
}
// adj334：音符上方单字修饰符——吐音/打音/叠音在音符正上方居中显示一个粗体字形
{
  const rAb = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&tu 2&ku 3&da 4&die |\n')
  const svgAb = renderScoreToSvg(layoutScore(rAb, DUR_CFG))[0]
  check('吐音 &tu → 音符上方粗体 T（居中）', /<text[^>]*text-anchor="middle"[^>]*font-weight="bold"[^>]*>T<\/text>/.test(svgAb), '')
  check('吐音 &ku → 音符上方粗体 K（居中）', /<text[^>]*text-anchor="middle"[^>]*font-weight="bold"[^>]*>K<\/text>/.test(svgAb), '')
  check('打音 &da → 音符上方粗体 扌（居中）', /<text[^>]*text-anchor="middle"[^>]*font-weight="bold"[^>]*>扌<\/text>/.test(svgAb), '')
  check('叠音 &die → 音符上方粗体 又（居中，横向缩 0.75）', /<text[^>]*transform="[^"]*scale\(0\.75,1\)"[^>]*font-weight="bold"[^>]*>又<\/text>/.test(svgAb), '')
  // 归属验证：&tu 应居中于**它前面**的数字 1 上方（T 的 x 落在数字 1 的槽内偏右中部），
  // 证明修饰符修饰的是前方音符，而非独立/错位。
  const n1X = Number(svgAb.match(/<text x="([\d.]+)" y="[^"]+" data-notepos="[^"]+"[^>]*>1<\/text>/)?.[1] ?? 'NaN')
  const tX = Number(svgAb.match(/<text x="([\d.]+)" y="[^"]+" text-anchor="middle"[^>]*font-weight="bold"[^>]*>T<\/text>/)?.[1] ?? 'NaN')
  check('&tu 归属前方音符（T 居中于数字 1 上方）', !Number.isNaN(n1X) && !Number.isNaN(tX) && tX > n1X && tX - n1X < 12, `n1X=${n1X} tX=${tX}`)
}
// adj：渐强渐弱起点/终点取「< > ! 所跟音符」的数字槽中心（不再是小节末音符）
{
  const dyn0 = layDe.pages[0].dynamics[0]
  const n3 = layDe.pages[0].notes[2] // 音符 3（< 所跟）
  const n5 = layDe.pages[0].notes[4] // 音符 5（! 所跟）
  check('渐强起点 = < 所跟音符数字槽中心', dyn0 !== undefined && Math.abs(dyn0.x1 - (n3.x + halfDig)) < 1, `x1=${dyn0?.x1} expect=${n3.x + halfDig}`)
  check('渐强终点 = ! 所跟音符数字槽中心', dyn0 !== undefined && Math.abs(dyn0.x2 - (n5.x + halfDig)) < 1, `x2=${dyn0?.x2} expect=${n5.x + halfDig}`)
}
// adj：<+ / >++ 抬升级数 → plus 字段 + 渲染整体上移（类似跳房子）
{
  const mkDyn = (q: string) => layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), DUR_CFG).pages[0].dynamics[0]
  const dynNo = mkDyn('1 < 2 3 !')
  const dynPlus = mkDyn('1 <+ 2 3 !')
  const dynDual = mkDyn('1 >++ 2 3 !')
  check('渐强渐弱无 + 时 plus 缺省 0', (dynNo?.plus ?? 0) === 0, `plus=${dynNo?.plus}`)
  check('渐强渐弱 <+ 解析 plus=1（抬升 1 级）', dynPlus?.plus === 1, `plus=${dynPlus?.plus}`)
  check('渐强渐弱 >++ 解析 plus=2（抬升 2 级）', dynDual?.plus === 2, `plus=${dynDual?.plus}`)
  const hairpinY = (q: string): number => {
    const svg = renderScoreToSvg(layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), DUR_CFG))[0]
    const m = new RegExp('<path d="M [\\d.-]+ ([\\d.-]+) L [\\d.-]+ ([\\d.-]+) M [\\d.-]+ ([\\d.-]+) L [\\d.-]+ ([\\d.-]+)" fill="none" stroke="#1b1b1b" stroke-width="0.8"').exec(svg)
    return m ? Number(m[1]) : NaN // 首个 M 的 y = hairpin 中心 midY（= d.y - plus×VOLTA_RAISE）
  }
  check('渲染：<+ hairpin 上移 2px（VOLTA_RAISE）', Math.abs(hairpinY('1 < 2 3 !') - hairpinY('1 <+ 2 3 !') - 2) < 0.6, `${hairpinY('1 < 2 3 !')} vs ${hairpinY('1 <+ 2 3 !')}`)
}
// adj294：&zkh/&ykh 独立为 bracket token，不再依附音符（解析/占位/渲染独立）
const zkh = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&zkh 2-&ykh 3.&ykh 4 |\n')
const zkhTok = zkh.groups[0].music.tokens
const zkhBk = zkhTok.filter((t) => t.kind === 'bracket')
check('adj294 &zkh/&ykh 解析为独立 bracket token（open/close/close）', zkh.errors.length === 0 && zkhBk.length === 3 && zkhBk[0].kind === 'bracket' && (zkhBk[0] as any).dir === 'open' && (zkhBk[1] as any).dir === 'close' && (zkhBk[2] as any).dir === 'close', JSON.stringify(zkhBk))
// 独立 bracket 不再写入音符 symbols（音符 symbols 只含真实修饰符）
const zkhNote0 = zkhTok.find((t) => t.kind === 'note' && t.pitch === 1)
check('adj294 bracket 不入音符 symbols', !!zkhNote0 && !(zkhNote0.symbols as string[]).includes('zkh') && !(zkhNote0.symbols as string[]).includes('ykh'), JSON.stringify((zkhNote0 as any)?.symbols))
// 渲染：独立括号文本 ( / ) 出现在 SVG（font-size=note_size，垂直居中于数字）
const svgZkh = renderScoreToSvg(layoutScore(zkh, DUR_CFG))[0]
check('adj294 &zkh 渲染左括号 (', svgZkh.includes('>(<'), svgZkh.slice(0, 200))
check('adj294 &ykh 渲染右括号 )', svgZkh.includes('>)<'), '')
// adj294：独立 &zkh/&ykh 写法（括号前后带空格）也是独立 bracket token，符号形状 = 括号窄槽（不挂在音符上）
const zkhSpace = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: &zkh 6 - - -&ykh |\n')
const zkhSpaceBk = zkhSpace.groups[0].music.tokens.filter((t) => t.kind === 'bracket')
check('adj294 独立 &zkh 前置 + 独立 &ykh 后置（带空格）为 bracket token', zkhSpace.errors.length === 0 && zkhSpaceBk.length === 2 && (zkhSpaceBk[0] as any).dir === 'open' && (zkhSpaceBk[1] as any).dir === 'close', JSON.stringify(zkhSpaceBk))
// adj109：& 修饰符扩展（yc/bc/zy/dy/hx/shy/xhy/sby/xby/sby+/xby+/cy/cy+）解析 + 渲染
const r109 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&yc 2&bc 3&zy 4&dy 5&hx 6&shy 7&xhy 1&sby 2&xby 3&sby+ 4&xby+ 5&cy 6&cy+ | 1 2 3 4 |\n')
const n109 = r109.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('adj109 修饰符解析（yc bc zy dy hx shy xhy）', r109.errors.length === 0 && JSON.stringify(n109.slice(0, 7).map((t) => t.symbols[0])) === JSON.stringify(['yc', 'bc', 'zy', 'dy', 'hx', 'shy', 'xhy']), JSON.stringify(n109.slice(0, 7).map((t) => t.symbols)))
check('adj109 修饰符解析（sby xby sby+ xby+ cy cy+，含 + 后缀）', JSON.stringify(n109.slice(7, 13).map((t) => t.symbols[0])) === JSON.stringify(['sby', 'xby', 'sby+', 'xby+', 'cy', 'cy+']), JSON.stringify(n109.slice(7, 13).map((t) => t.symbols)))
const svg109 = renderScoreToSvg(layoutScore(r109, DUR_CFG))[0]
check('adj109 yc 渲染点 + 半圆弧（circle + Q）', svg109.includes('<circle ') && / Q /.test(svg109), '')
// adj112：zy 线形 >、dy 仍实心倒三角；adj119：滑音箭头改线形 >（实心三角仅 dy 1 个）
check('adj119 实心三角仅 dy（1 个）', (svg109.match(/Z" fill="#1b1b1b"/g) ?? []).length === 1, '')
// adj114/115：波音锯齿 = 斜上细线(stroke 1) + 斜下粗线(stroke 1.8)，共 4 个波音
// sby/xby 各 2 条下降段、sby+/xby+ 各 3 条 → stroke 1.8 共 10 条；xby 竖线细线
check('adj115 波音锯齿斜下粗线（stroke 1.8 ≥ 10 条）', (svg109.match(/stroke-width="1.8"/g) ?? []).length >= 10, '')
// adj116：下波音竖线为细线 stroke 0.8（xby/xby+ 各 1 条）
check('adj116 下波音竖线为细线（stroke 0.8 ≥ 2 条）', (svg109.match(/stroke-width="0.8"/g) ?? []).length >= 2, '')
// adj180：&hx 呼吸记号不加粗（stroke 0.8）、横向宽度 80%（半宽 2.8×s）
const hxPath180 = /M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)" fill="none" stroke="#1b1b1b" stroke-width="0.8"/.exec(svg109)
check('adj180 hx 线宽 0.8（不加粗）', hxPath180 !== null, '')
check('adj180 hx 半宽 = 2.8×s（80% 宽度）', hxPath180 !== null && Math.abs(Math.abs(Number(hxPath180[5]) - Number(hxPath180[3])) - 2.8 * NS_S) < 0.3, JSON.stringify(hxPath180?.slice(1)))
// adj126：小节线修饰符（&fine/&dc/&ds/&ty/&hs）解析 + 渲染 + 播放跳转
const r126 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |&fine 5 6 7 1 |&dc 2 3 4 5 |&ds 6 7 1 2 |&hs 3 4 5 6 |&ty 7 1 2 3 |&ty 4 5 6 7 |\n')
const bars126 = r126.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('adj126 小节线修饰符解析（fine/dc/ds/hs/ty/ty + 行尾无）', r126.errors.length === 0 && JSON.stringify(bars126.map((b) => b.kind === 'barline' ? b.marks : undefined)) === JSON.stringify([['fine'], ['dc'], ['ds'], ['hs'], ['ty'], ['ty'], undefined]), JSON.stringify(bars126.map((b) => b.kind === 'barline' ? b.marks : undefined)))
// adj206：同一小节线叠加多个修饰符（如 |&ty&ds）全部解析
const r206 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |&ty&ds 5 6 7 1 |&fine&hs 2 3 4 5 |\n')
const bars206 = r206.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('adj206 小节线叠加修饰符解析（|&ty&ds → [ty,ds]、|&fine&hs → [fine,hs]）', r206.errors.length === 0 && JSON.stringify(bars206.slice(0, 2).map((b) => b.kind === 'barline' ? b.marks : undefined)) === JSON.stringify([['ty', 'ds'], ['fine', 'hs']]), JSON.stringify(bars206.map((b) => b.kind === 'barline' ? b.marks : undefined)))
const lay126 = layoutScore(r126, DUR_CFG)
const placed126 = lay126.pages[0].barlines
check('adj126 布局透传修饰符', placed126.length >= 6 && placed126.some((b) => b.marks?.includes('fine')) && placed126.some((b) => b.marks?.includes('ty')) && placed126.some((b) => b.marks?.includes('hs')), JSON.stringify(placed126.map((b) => b.marks)))
const svg126 = renderScoreToSvg(lay126)[0]
check('adj126 渲染 Fine/D.C./D.S. 文本', svg126.includes('>Fine<') && svg126.includes('>D.C.<') && svg126.includes('>D.S.<'), '')
// 小节线修饰符与临时节拍引号可任意顺序：|"p:2/4"&hs 与 |&hs"p:2/4" 等效（引号注释不再被 & 前置吞掉）
{
  const qOrdA = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |"p:2/4"&hs 5 6 7 8 |\n')
  const qOrdB = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |&hs"p:2/4" 5 6 7 8 |\n')
  const barA = qOrdA.groups[0].music.tokens.find((t) => t.kind === 'barline')
  const barB = qOrdB.groups[0].music.tokens.find((t) => t.kind === 'barline')
  check('任意顺序：|"p:2/4"&hs 解析出 hs + p:2/4', barA?.kind === 'barline' && barA.marks?.includes('hs') && barA.comment === 'p:2/4', JSON.stringify({ m: barA?.kind === 'barline' ? barA.marks : undefined, c: barA?.kind === 'barline' ? barA.comment : undefined }))
  check('任意顺序：|&hs"p:2/4" 解析出 hs + p:2/4', barB?.kind === 'barline' && barB.marks?.includes('hs') && barB.comment === 'p:2/4', JSON.stringify({ m: barB?.kind === 'barline' ? barB.marks : undefined, c: barB?.kind === 'barline' ? barB.comment : undefined }))
  check('任意顺序：两行均无解析错误', qOrdA.errors.length === 0 && qOrdB.errors.length === 0, JSON.stringify([...qOrdA.errors, ...qOrdB.errors].slice(0, 2)))
  const svgOrdA = renderScoreToSvg(layoutScore(qOrdA, DUR_CFG))[0]
  const svgOrdB = renderScoreToSvg(layoutScore(qOrdB, DUR_CFG))[0]
  check('任意顺序：两种顺序均渲染花S 𝄋', svgOrdA.includes('𝄋') && svgOrdB.includes('𝄋'), '')
}
check('adj130 渲染大跳跃记号（Unicode U+1D10C 𝄌）', svg126.includes('𝄌'), '')
check('adj129 渲染花 S 记号（Unicode U+1D10B 𝄋）', svg126.includes('𝄋'), '')
// adj：&ds/&dc/&fine 一律粗体 + 斜体，位置下移 0.1 音符高度（1.8×s）
const svg207 = renderScoreToSvg(layoutScore(r206, DUR_CFG))[0]
check('adj207 叠加渲染：&ty&ds 同时显示 ⊕ 与 D.S.，&fine&hs 同时显示 Fine 与 花S', (svg207.match(/𝄌/g) ?? []).length >= 1 && svg207.includes('>D.S.<') && svg207.includes('>Fine<') && svg207.includes('𝄋'), '')
check('adj207 D.S. 加粗 + 斜体', /font-weight="bold"[^>]*font-style="italic"[^>]*>D\.S\.</.test(svg207), '')
check('adj207 D.C. 加粗 + 斜体（用 svg126 含 &dc）', /font-weight="bold"[^>]*font-style="italic"[^>]*>D\.C\.</.test(svg126), '')
check('adj207 Fine 加粗 + 斜体', /font-weight="bold"[^>]*font-style="italic"[^>]*>Fine</.test(svg207), '')
check('反复标记花体渲染（D.S./Fine 含 Segoe Script）', /<text[^>]*font-family="[^"]*Segoe Script[^"]*"[^>]*>D\.S\.</.test(svg126) && /<text[^>]*font-family="[^"]*Segoe Script[^"]*"[^>]*>Fine</.test(svg126), '')
{
  const lay207 = layoutScore(r206, DUR_CFG)
  const dsBar = lay207.pages[0].barlines.find((b) => b.marks?.includes('ds'))
  const mD = /<text x="[^"]+" y="([^"]+)" text-anchor="middle"[^>]*>D\.S\.</.exec(svg207)
  check('adj207 D.S. 位置下移 0.1 音符高度（y = yBottom + 8s + 1.8s）', dsBar !== undefined && mD !== null && Math.abs(Number(mD[1]) - (dsBar.yBottom + 8 * NS_S + 1.8 * NS_S)) < 0.5, `y=${mD?.[1]} expect=${dsBar ? (dsBar.yBottom + 8 * NS_S + 1.8 * NS_S).toFixed(1) : '?'}`)
}
// adj210：&ds/&dc/&fine 字号 = 主音符 0.5（fs = max(8, round(9×s))）
const markFs = Math.max(8, Math.round(9 * NS_S))
check('adj210 D.S. 字号 = 主音符 0.5', new RegExp(`<text x="[^"]+" y="[^"]+" text-anchor="middle" font-size="${markFs}"[^>]*>D\\.S\\.<`).test(svg207), `fs=${markFs}`)
check('adj210 Fine 字号 = 主音符 0.5', new RegExp(`<text x="[^"]+" y="[^"]+" text-anchor="middle" font-size="${markFs}"[^>]*>Fine<`).test(svg207), `fs=${markFs}`)
// adj182：大跳跃记号高度 120%（fs = 19.2×s）；两记号下端与小节线上端（yTop）齐平
const ty182 = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" font-size="([\d.]+)"[^>]*>𝄌<\/text>/.exec(svg126)
const hs182 = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" font-size="([\d.]+)"[^>]*>𝄋<\/text>/.exec(svg126)
check('adj182 大跳跃字号 = 19.2×s（120%）', ty182 !== null && Number(ty182[3]) === Math.max(14, Math.round(16 * 1.2 * NS_S)), `fs=${ty182?.[3]}`)
// y = yTop - 0.15×fs → 记号下端（y + 0.15×fs）≈ yTop；adj183 再下移 60%、adj184 再上移 10% → y = yTop + 0.35×fs
const tyBar182 = placed126.find((b) => b.marks?.includes('ty'))
const hsBar182 = placed126.find((b) => b.marks?.includes('hs'))
check('adj184 大跳跃记号 y = yTop + 0.35×fs（下移60%再上移10%）', ty182 !== null && tyBar182 !== undefined && Math.abs(Number(ty182[2]) - (tyBar182.yTop + 0.35 * Number(ty182[3]))) < 1, `y=${ty182?.[2]} fs=${ty182?.[3]} yTop=${tyBar182?.yTop}`)
check('adj182 花S 记号下端与 yTop 齐平（y = yTop - 0.15×fs）', hs182 !== null && hsBar182 !== undefined && Math.abs(Number(hs182[2]) + 0.15 * Number(hs182[3]) - hsBar182.yTop) < 1, `y=${hs182?.[2]} fs=${hs182?.[3]} yTop=${hsBar182?.yTop}`)
// 播放跳转：fine 截断 / ds 跳 hs / ty 跳下一 ty / dc 从头反复
const mk126 = (q: string) => buildPlaySequence(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), DUR_CFG), 120)
const pits126 = (seq: ReturnType<typeof mk126>) => seq.events.filter((e) => e.placed.audioPitch).map((e) => e.placed.audioPitch)
check('adj126 播放：&fine 曲终截断（只播前 4 音）', pits126(mk126('1 2 3 4 |&fine 5 6 7 1 |')).join(',') === 'C4,D4,E4,F4', pits126(mk126('1 2 3 4 |&fine 5 6 7 1 |')).join(','))
check('adj126 播放：&ds 跳到 &hs 位置（5 6 7 1 跳过）', pits126(mk126('1 2 3 4 |&ds 5 6 7 1 |&hs 2 3 4 5 |')).join(',') === 'C4,D4,E4,F4,D4,E4,F4,G4', pits126(mk126('1 2 3 4 |&ds 5 6 7 1 |&hs 2 3 4 5 |')).join(','))
check('adj126 播放：&ty 跳到下一 &ty（中间跳过）', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |')).join(',') === 'C4,D4,E4,F4,D4,E4,F4,G4', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |')).join(','))
check('adj126 播放：&dc 从头反复（首 4 音重复出现）', (() => { const p = pits126(mk126('1 2 3 4 |&dc 5 6 7 1 |')); return p.length > 4 && p[0] === p[4] && p[1] === p[5] && p[2] === p[6] && p[3] === p[7] })(), pits126(mk126('1 2 3 4 |&dc 5 6 7 1 |')).join(','))
// adj132：连音线位于音符上方修饰符（波音/颤音等）之上——带修饰符时 slur y 上移（随字号）
const slSym132 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1&sby 2&cy) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
const slPlain132 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
check('adj132 连音线在修饰符之上（y 上移明显）', slSym132 < slPlain132 - 5 * NS_S, `sym=${slSym132} plain=${slPlain132}`)
// adj135：取消倚音自动避让（连音线不再因倚音抬高）；改用 (+ 手动抬升（每 + 2px）
const slGrace134 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1[3] 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
check('adj135 倚音不抬高连音线（与无倚音相同）', Math.abs(slGrace134 - slPlain132) < 0.5, `grace=${slGrace134} plain=${slPlain132}`)
const slPlus135 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (+ 1 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
const slPlus135b = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (++ 1 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
check('adj135 (+ 抬升 2px、(++ 抬升 4px', Math.abs(slPlus135 - (slPlain132 - 2)) < 0.5 && Math.abs(slPlus135b - (slPlain132 - 4)) < 0.5, `p1=${slPlus135} p2=${slPlus135b} plain=${slPlain132}`)
// adj136：(- 下降连音线（每 - 2px）、(-- 下降 4px
const slMinus136 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (- 1 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
const slMinus136b = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (-- 1 2) 3 |\n'), DUR_CFG).pages[0].slurs[0].y
check('adj136 (- 下降 2px、(-- 下降 4px', Math.abs(slMinus136 - (slPlain132 + 2)) < 0.5 && Math.abs(slMinus136b - (slPlain132 + 4)) < 0.5, `m1=${slMinus136} m2=${slMinus136b} plain=${slPlain132}`)
const r134v = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 | [3 (4 5) 6 | 7 1 2 3] 4 |\n')
const lay134v = layoutScore(r134v, DUR_CFG)
const s134v = lay134v.pages[0].slurs[0]
const v134v = lay134v.pages[0].barlines.find((b) => b.voltaStart)
check('adj134 连音线在跳房子线下方', s134v !== undefined && v134v !== undefined && s134v.y >= v134v.yTop - 8 + 2 - 0.5, `slur=${s134v?.y} volta=${v134v ? v134v.yTop - 8 : '?'}`)
// adj137：连音线 (1 (2) 3) 被退化内层 (2) 打断为两段（1→2、2→3）
const r137a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 (2) 3) 4 |\n')
const s137a = layoutScore(r137a, DUR_CFG).pages[0].slurs
check('adj137 (1 (2) 3) 拆两段连音线（1→2、2→3）', s137a.length === 2 && s137a[0].x2 < s137a[1].x1 + 0.5, `slurs=${s137a.map((s) => `${s.x1}→${s.x2}`).join(' | ')}`)
// adj137：两段跳房子 |["1" ... |]["2" ... |] 各渲染一段（从小节线到小节线）
const r137b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |["1" 1 2 3 4 |]["2" 5 6 7 1 |] 2 3 4 5 |\n')
const lay137b = layoutScore(r137b, DUR_CFG)
const b137b = lay137b.pages[0].barlines
const sStart1 = b137b.find((b) => b.voltaStart && b.voltaStart.comment === '1')
const sEnd1 = b137b.find((b) => b.voltaEnd)
const sStart2 = b137b.filter((b) => b.voltaStart).find((b) => b.voltaStart?.comment === '2')
check('adj139 两段跳房子共用小节线：线2 同时 voltaEnd+voltaStart', b137b.filter((b) => b.voltaStart || b.voltaEnd).length === 3 && !!sStart1 && !!sStart2 && !!b137b.find((b) => b.voltaEnd && b.voltaStart), JSON.stringify(b137b.map((b) => ({ t: b.type, s: !!b.voltaStart, e: !!b.voltaEnd, c: b.voltaStart?.comment }))))
const svg137b = renderScoreToSvg(lay137b)[0]
const voltas137b = [...svg137b.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1b1b1b" stroke-width="0.8"/g)].filter((m) => Number(m[3]) - Number(m[1]) > 20).map((m) => `${m[1]}→${m[3]}`)
check('adj137 两段跳房子渲染 2 条线', voltas137b.length === 2, voltas137b.join(' '))
check('adj109 滑音渲染弧线（Q）+ 箭头（fill 三角）', svg109.includes(' Q '), '')
check('adj112 tr 文本加粗', /font-weight="bold"[^>]*>tr</.test(svg109), '')
// adj294：括号独立渲染——加粗 + 垂直居中于数字中心（dominant-baseline=central @ 基线-0.4×字号）、字号=note_size
const svgZkhSp = renderScoreToSvg(layoutScore(zkhSpace, DUR_CFG))[0]
const zkhLPar = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" dominant-baseline="central" font-weight="bold" font-size="([\d.]+)"[^>]*>\(<\/text>/.exec(svgZkhSp)
const zkhRPar = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle" dominant-baseline="central" font-weight="bold" font-size="([\d.]+)"[^>]*>\)<\/text>/.exec(svgZkhSp)
const zkhNoteY = layoutScore(zkhSpace, DUR_CFG).pages[0].notes[0].y
check('adj294 括号加粗 + 垂直居中于数字（y = 基线-0.4×字号）', zkhLPar !== null && zkhRPar !== null && Math.abs(Number(zkhLPar[2]) - (zkhNoteY - defaultPageConfig.note_size * 0.4)) < 0.5 && Math.abs(Number(zkhRPar[2]) - (zkhNoteY - defaultPageConfig.note_size * 0.4)) < 0.5, `l=${zkhLPar?.[2]} r=${zkhRPar?.[2]} noteY=${zkhNoteY}`)
check('adj294 括号字号与音符一致（note_size）', zkhLPar !== null && zkhRPar !== null && Math.abs(Number(zkhLPar[3]) - defaultPageConfig.note_size) < 0.5 && Math.abs(Number(zkhRPar[3]) - defaultPageConfig.note_size) < 0.5, `lfs=${zkhLPar?.[3]} rfs=${zkhRPar?.[3]}`)
// adj294：&zkh 在音符左侧（open x < 音符数字左缘）、&ykh 在音符块（含增时线）之后（close x > 首音符右端）
check('adj294 左括号在音符左侧（open x < 数字 x）', zkhLPar !== null && Number(zkhLPar[1]) < layoutScore(zkhSpace, DUR_CFG).pages[0].notes[0].x, `lpar=${zkhLPar?.[1]} digit=${layoutScore(zkhSpace, DUR_CFG).pages[0].notes[0].x}`)
{
  const bkCfg = layoutScore(zkhSpace, DUR_CFG).pages[0]
  const firstNote = bkCfg.notes[0]
  const closeBk = bkCfg.brackets.find((b) => b.dir === 'close')
  check('adj294 右括号在音符块（含增时线）之后', !!closeBk && closeBk.x > (firstNote.rightX ?? firstNote.x + firstNote.width), `rpar=${closeBk?.x} firstRight=${firstNote.rightX ?? firstNote.x + firstNote.width}`)
}
// adj84：休止符也支持括号（0/&zkh 左括号、0-&ykh 右括号、&zkh 0/ 前置）——均为独立 bracket token
const zkhRest = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0/&zkh 0-&ykh &zkh 0/ 2 3 4 |\n')
const restBk = zkhRest.groups[0].music.tokens.filter((t) => t.kind === 'bracket')
check('adj294 休止符括号为独立 bracket token', zkhRest.errors.length === 0 && restBk.length === 3 && (restBk[0] as any).dir === 'open' && (restBk[1] as any).dir === 'close' && (restBk[2] as any).dir === 'open', JSON.stringify(restBk))
const svgRestPar = renderScoreToSvg(layoutScore(zkhRest, DUR_CFG))[0]
check('adj294 休止符左括号渲染', (svgRestPar.match(/\(<\/text>/g) ?? []).length >= 2, '')
check('adj294 休止符右括号渲染', (svgRestPar.match(/\)<\/text>/g) ?? []).length >= 1, '')
// 歌词引号注释（adj58）：双引号文本为注释，不占歌词位，渲染在注释后歌词前面
const lr58 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 二"副歌"三 四\n')
const lr58c = lr58.groups[0].lyrics[0].chars
check('引号注释挂到注释后第一个歌词字', lr58.errors.length === 0 && lr58c.find((c) => c.text === '三')?.note === '副歌', JSON.stringify(lr58c.map((c) => ({ t: c.text, note: c.note }))))
const svgLr58 = renderScoreToSvg(layoutScore(lr58, DUR_CFG))[0]
check('歌词注释渲染在字前（灰色小字）', svgLr58.includes('>副歌<'), '')
// adj150：连音线线宽 0.8
const svgSl58 = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) 4 |\n'), DUR_CFG))[0]
check('连音线线宽 0.8（adj150）', svgSl58.includes('stroke-width="0.8"') && !svgSl58.includes('fill="none" stroke="#1b1b1b" stroke-width="1.1"'), '')
// adj67：|"P:2/4" 临时节拍 → 小节线右侧画分数（分子/横线/分母，与小节线等高）
const r67 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"P:2/4" 3 4 |\n')
const b67 = layoutScore(r67, DUR_CFG).pages[0].barlines.find((b) => b.comment?.startsWith('P:'))
check('|"P:2/4" 解析为小节线备注', r67.errors.length === 0 && b67?.comment === 'P:2/4', JSON.stringify(r67.errors))
const svg67 = renderScoreToSvg(layoutScore(r67, DUR_CFG))[0]
const meterFracFs = Math.round(10 * NS_S) // 分数字号（随字号）
check('临时节拍渲染分数（分子 2 / 分母 4 居中）', new RegExp(`<text x="[\\d.]+" y="[\\d.]+" text-anchor="middle" font-size="${meterFracFs}"[^>]*>2<`).test(svg67) && new RegExp(`<text x="[\\d.]+" y="[\\d.]+" text-anchor="middle" font-size="${meterFracFs}"[^>]*>4<`).test(svg67), '')
check('临时节拍分数横线在分子/分母之间', /<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="\1" stroke="#1b1b1b" stroke-width="1"\/>/.test(svg67), '')
// adj86：大小写不敏感 —— 临时节拍 p:/P:、后倚音 h/H、平均连音组 y/Y
const r86p = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"p:3/8" 3 4 |\n')
const b86p = layoutScore(r86p, DUR_CFG).pages[0].barlines.find((b) => b.comment?.toLowerCase().startsWith('p:'))
check('|"p:3/8" 与 |"P:3/8" 等效（小写也渲染分数）', b86p !== undefined && renderScoreToSvg(layoutScore(r86p, DUR_CFG))[0].includes('>3<') && renderScoreToSvg(layoutScore(r86p, DUR_CFG))[0].includes('>8<'), '')
const r86h = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1[H3] 2[h3] 3 |\n')
const g86h = r86h.groups[0].music.tokens.filter((t) => t.kind === 'note' && t.gracenotes)
check('后倚音 1[H3] 与 1[h3] 等效（均 after）', g86h.length === 2 && g86h.every((t) => t.gracenotes?.after === true), JSON.stringify(g86h.map((t) => t.gracenotes)))
const r86y = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (Y1 2 3) 4 | (y5 6 7) 1 |\n')
const g86y = r86y.groups[0].music.tokens.filter((t) => t.kind === 'note')
// (Y1 2 3)：小节 4 拍 - 组外 4 的 1 拍 = 组 3 拍均分 3 音 = 每音 1 拍（tupletDur 覆盖原始时值）
check('平均连音组 (Y…) 与 (y…) 等效（tupletDur 均分覆盖）', r86y.errors.length === 0 && g86y[0].tupletDur !== undefined && g86y[0].tupletDur === g86y[4].tupletDur && Math.abs((g86y[0].tupletDur ?? 0) - 1) < 1e-6, JSON.stringify(g86y.map((t) => t.tupletDur)))
// adj86：临时节拍占位——分数右侧留 ≥2px，不压下一小节音符（小节间距含分数宽）
const lay86p = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"P:2/4" 3 4 |\n'), DUR_CFG)
const b86x = lay86p.pages[0].barlines.find((b) => b.comment?.startsWith('P:'))
const n86n = lay86p.pages[0].notes.find((n) => n.x > (b86x?.x ?? 0))
check('临时节拍占位：分数后音符间距 ≥2px（音符 x ≥ 线右缘 + 分数半宽 + 2）', b86x !== undefined && n86n !== undefined && n86n.x >= b86x.x + 0.55 + 2 + 2, `noteX=${n86n?.x} barX=${b86x?.x}`)
// adj88：连音线内相同音高连续音符连奏合并时值
const r88a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (2 - | 2/) 3 |\n')
const ev88a = buildPlaySequence(r88a, layoutScore(r88a, DUR_CFG), 60).events
const d88 = ev88a.filter((e) => e.placed.audioPitch === 'D4')
check('(2 - | 2/) 连奏：2 一次共 2.5 拍', ev88a.length === 2 && d88.length === 1 && Math.abs(d88[0].durationMs - 2500) < 50, ev88a.map((e) => `${e.placed.audioPitch}:${e.durationMs}`).join(' '))
// adj157：连音合并时全局时钟 at 同步推进——后续音符从连音结束时开始，不与连音重叠
const ev88aNext = ev88a[1]
check(
  'adj157 连音合并后 at 推进（后续音符从连音结束 2500ms 开始，不重叠）',
  ev88a.length === 2 &&
    ev88aNext.placed.audioPitch === 'E4' &&
    Math.abs(ev88aNext.atMs - 2500) < 1 &&
    ev88aNext.atMs >= ev88a[0].atMs + ev88a[0].durationMs - 0.5,
  ev88a.map((e) => `${e.placed.audioPitch}:at=${Math.round(e.atMs)} dur=${Math.round(e.durationMs)}`).join(' '),
)
// adj157：连续两处连音合并 + 中间不同音高——时值累计且不重叠（1 两处连奏 2.5 拍、2 独立、3 独立）
const r88d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 - | 1/ 2 3) 4 |\n')
const ev88d = buildPlaySequence(r88d, layoutScore(r88d, DUR_CFG), 60).events
const d88d = ev88d.filter((e) => e.placed.audioPitch === 'C4')
const noOverlap88d = ev88d.every(
  (e, k) => k === 0 || e.atMs >= ev88d[k - 1].atMs + ev88d[k - 1].durationMs - 0.5,
)
check(
  'adj157 多音符连音组时值累计且事件不重叠（C4 共 2.5 拍）',
  d88d.length === 1 &&
    Math.abs(d88d[0].durationMs - 2500) < 50 &&
    noOverlap88d &&
    Math.abs(ev88d[ev88d.length - 1].atMs + ev88d[ev88d.length - 1].durationMs - 5500) < 50,
  ev88d.map((e) => `${e.placed.audioPitch}:at=${Math.round(e.atMs)} dur=${Math.round(e.durationMs)}`).join(' '),
)
const r88b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (2 3 | 2) 5 |\n')
const ev88b = buildPlaySequence(r88b, layoutScore(r88b, DUR_CFG), 60).events
const d88b = ev88b.filter((e) => e.placed.audioPitch === 'D4')
check('(2 3 | 2) 中间隔 3 不合并：3 个 D4 各 1 拍', d88b.length === 2 && d88b.every((e) => Math.abs(e.durationMs - 1000) < 50), ev88b.map((e) => `${e.placed.audioPitch}:${e.durationMs}`).join(' '))
// adj88：从指定音符开始播放（双击音符定位试听起点）
const r88s = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const lay88s = layoutScore(r88s, DUR_CFG)
const n88s = lay88s.pages[0].notes[3]
const id88s = `${n88s.id.page}_${n88s.id.voice}_${n88s.id.group}_${n88s.id.index}`
const seq88s = buildPlaySequence(r88s, lay88s, 60, id88s)
check('从指定音符开始播放（起点 atMs=0，丢弃之前音符）', seq88s.events.length === 5 && seq88s.events[0].atMs === 0 && seq88s.events[0].placed.id.index === 3, seq88s.events.map((e) => `${e.placed.id.index}:${Math.round(e.atMs)}`).join(' '))
// adj59：音符引号注释显示在音符正上方（有高八度点在圆点上方）；_ 代替空格
const nc59 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1"渐强" 2\'"渐强_稍快" 3 |\n')
const nc59n = nc59.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('音符注释解析 + _ 替换空格', nc59.errors.length === 0 && nc59n[0].comment === '渐强' && nc59n[1].comment === '渐强 稍快', JSON.stringify(nc59n.map((t) => t.comment)))
// adj：音符块「修饰符/注释」也可任意顺序——1&tr"注释" 与 1"注释"&tr 都收集 tr + 注释
{
  const qOrdNote = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&tr"注释" 2"注释"&tr |\n')
  const nOrdN = qOrdNote.groups[0].music.tokens.filter((t) => t.kind === 'note')
  check('音符修饰符/注释任意顺序：1&tr"注释" 收集 tr + 注释', nOrdN[0]?.symbols.includes('tr') && nOrdN[0]?.comment === '注释', JSON.stringify({ s: nOrdN[0]?.symbols, c: nOrdN[0]?.comment }))
  check('音符修饰符/注释任意顺序：2"注释"&tr 收集 tr + 注释', nOrdN[1]?.symbols.includes('tr') && nOrdN[1]?.comment === '注释', JSON.stringify({ s: nOrdN[1]?.symbols, c: nOrdN[1]?.comment }))
}
const layNc59 = layoutScore(nc59, DUR_CFG)
const svgNc59 = renderScoreToSvg(layNc59)[0]
const nNc0 = layNc59.pages[0].notes[0]
const nNc1 = layNc59.pages[0].notes[1]
const ncfs = Math.max(7, Math.round(defaultPageConfig.note_size * NOTE_COMMENT_FONT_RATIO))
const mNc0 = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" text-anchor="middle" font-size="${ncfs}"[^>]*>渐强<`).exec(svgNc59)
const mNc1 = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" text-anchor="middle" font-size="${ncfs}"[^>]*>渐强 稍快<`).exec(svgNc59)
// 注释在数字顶上方（y < 数字顶 = 基线-0.8em）；有高八度时在点顶上方（octaveTopY）
check('无高八度注释在数字顶上方', mNc0 !== null && Number(mNc0[1]) < nNc0.y - defaultPageConfig.note_size * 0.8, `y=${mNc0?.[1]}`)
check('有高八度注释在圆点上方', mNc1 !== null && Number(mNc1[1]) < octaveTopY(nNc1.y, 1, defaultPageConfig.note_size), `y=${mNc1?.[1]} top=${octaveTopY(nNc1.y, 1, defaultPageConfig.note_size)}`)
// adj209：休止符/节奏符注释（0"转调"、9"…"）此前 collectSuffix 解析但未挂到 token → 不显示
const rc209 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0"转1=bE调" 1 2 3 |\n')
const rc209t = rc209.groups[0].music.tokens.filter((t) => t.kind === 'rest')
check('adj209 休止符注释解析（0"转1=bE调" → comment）', rc209.errors.length === 0 && rc209t[0].comment === '转1=bE调', JSON.stringify(rc209t.map((t) => t.comment)))
const svgRc209 = renderScoreToSvg(layoutScore(rc209, DUR_CFG))[0]
check('adj209 休止符注释渲染在 0 上方', svgRc209.includes('>转1=bE调<'), '')
const rc209b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 9"节奏" 1 2 3 |\n')
const rc209r = rc209b.groups[0].music.tokens.filter((t) => t.kind === 'rhythm')
check('adj209 节奏符注释解析（9"节奏" → comment）', rc209b.errors.length === 0 && rc209r[0].comment === '节奏', JSON.stringify(rc209r.map((t) => t.comment)))
const svgRc209b = renderScoreToSvg(layoutScore(rc209b, DUR_CFG))[0]
check('adj209 节奏符注释渲染在 X 上方', svgRc209b.includes('>节奏<'), '')
// 歌词注释 _ 替换空格（adj59）
const lr59 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 二"副歌_部分"三 四\n')
const lr59c = lr59.groups[0].lyrics[0].chars
check('歌词注释 _ 替换空格', lr59.errors.length === 0 && lr59c.find((c) => c.text === '三')?.note === '副歌 部分', JSON.stringify(lr59c.map((c) => ({ t: c.text, note: c.note }))))
// adj60：修饰符层级规则 —— 层内间距 INNER_GAP=1.5、层级间距 LAYER_GAP=2、下方先减时线后低八度点
const lr60a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1,, 2 |\n')
const svg60a = renderScoreToSvg(layoutScore(lr60a, DUR_CFG))[0]
const dots60a = [...svg60a.matchAll(new RegExp(`<circle cx="[\\d.]+" cy="([\\d.]+)" r="${DOT_R_S}"`, 'g'))].map((m) => +m[1]).sort((a, b) => a - b)
check('双低八度点层内空白 INNER_GAP（中心距 2r+INNER_GAP，动态）', dots60a.length === 2 && Math.abs(dots60a[1] - dots60a[0] - (DOT_R * 2 + INNER_GAP) * NS_S) < 0.3, JSON.stringify(dots60a))
const lr60b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3// 4 |\n')
const svg60b = renderScoreToSvg(layoutScore(lr60b, DUR_CFG))[0]
const beams60b = [...svg60b.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="0.8"/g)].map((m) => +m[1]).sort((a, b) => a - b)
check('双减时线层内空白 INNER_GAP（中心距 BEAM_H+INNER_GAP，动态）', beams60b.length === 2 && Math.abs(beams60b[1] - beams60b[0] - (BEAM_H + INNER_GAP) * NS_S) < 0.3, JSON.stringify(beams60b))
const lr60c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3//, 2 |\n')
const n60c = layoutScore(lr60c, DUR_CFG).pages[0].notes[0]
const svg60c = renderScoreToSvg(layoutScore(lr60c, DUR_CFG))[0]
const dot60c = new RegExp(`<circle cx="[\\d.]+" cy="([\\d.]+)" r="${DOT_R_S}"`).exec(svg60c)
check('双减时线+低音点：低八度点在减时线层下方（点顶距层底 LAYER_GAP，动态）', dot60c !== null && Math.abs(Number(dot60c[1]) - lowDotY(n60c.y, 0, 2, defaultPageConfig.note_size)) < 0.5, `cy=${dot60c?.[1]} expect=${lowDotY(n60c.y, 0, 2, defaultPageConfig.note_size)}`)
// adj69：修饰符随曲部字号缩放（36 号字 scale=2：八度点/附点/增时线/小节线同比率放大）
const s69 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1\' 2. 3// 4 |\n')
const lay69 = layoutScore(s69, { ...DUR_CFG, note_size: 36 })
const svg69 = renderScoreToSvg(lay69)[0]
check('note_size=36：八度点 r = DOT_R×2（1.5×2 = 3，r1n 去尾零）', new RegExp(`<circle cx="[\\d.]+" cy="[\\d.]+" r="${DOT_R * 2}"`).test(svg69), '')
check('note_size=36：附点 r = DOT_R_DOT×2 = 4', new RegExp(`<circle cx="[\\d.]+" cy="[\\d.]+" r="${DOT_R_DOT * 2}"`).test(svg69), '')
const bar69 = lay69.pages[0].barlines[0]
const n69 = lay69.pages[0].notes[0]
check('note_size=36：小节线高度随字号（上端偏移 36.8、高 45.8）', Math.abs(n69.y - bar69.yTop - 36.8) < 0.5 && Math.abs(bar69.yBottom - bar69.yTop - 45.8) < 0.5, `off=${(n69.y - bar69.yTop).toFixed(1)} h=${(bar69.yBottom - bar69.yTop).toFixed(1)}`)
// 渐弱 + 行尾未闭合
const deco2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 > 3 4\n')
const layDe2 = layoutScore(deco2, DUR_CFG)
check('行尾未闭合渐弱仍生成', layDe2.pages[0].dynamics.length === 1 && layDe2.pages[0].dynamics[0].type === 'decrescendo')

// ---- 21. 示例谱库（M9） ----
console.log('[21] sample scores (M9)')
const loadSample = (n: string) => parseJps(readFileSync(join(root, 'samples', `${n}.jps`), 'utf8'))
// 二声部
const rEr = loadSample('ershenbu')
check('二声部 无解析错误', rEr.errors.length === 0, JSON.stringify(rEr.errors.slice(0, 2)))
const layEr = layoutScore(rEr, DUR_CFG)
check('二声部 1 个声部块', layEr.pages[0].voiceBlocks.length === 1, `got ${layEr.pages[0].voiceBlocks.length}`)
check('声部块命名 高声部/低声部', layEr.pages[0].voiceBlocks[0]?.voices[0]?.name === '高声部' && layEr.pages[0].voiceBlocks[0]?.voices[1]?.name === '低声部')
check('二声部渲染无异常', renderScoreToSvg(layEr)[0].includes('高声部'))
// 反复与跳房子
const rFf = loadSample('fanfu-tiaofangzi')
check('跳房子演示 无解析错误', rFf.errors.length === 0, JSON.stringify(rFf.errors.slice(0, 2)))
const layFf = layoutScore(rFf, DUR_CFG)
const seqFf = buildPlaySequence(rFf, layFf, 120)
check('跳房子播放序列 16 音符', seqFf.events.length === 16, `got ${seqFf.events.length}`)
check('序列首音 1=F4（F 调）', seqFf.events[0].placed.audioPitch === 'F4', String(seqFf.events[0].placed.audioPitch))
check('第一遍含 [ 段尾 5=C5', seqFf.events[5].placed.audioPitch === 'C5', String(seqFf.events[5].placed.audioPitch))
check('第二遍跳回 1=F4', seqFf.events[6].placed.audioPitch === 'F4', String(seqFf.events[6].placed.audioPitch))
check('第二遍跳过 [ 段（第 10 音为 5=C5）', seqFf.events[9].placed.audioPitch === 'C5', String(seqFf.events[9].placed.audioPitch))
check('跳房子渲染含番号', renderScoreToSvg(layFf)[0].includes('1.'))
// 连音线与装饰
const rLx = loadSample('lianyinxian-zhuangshi')
check('连音线演示 无解析错误', rLx.errors.length === 0, JSON.stringify(rLx.errors.slice(0, 2)))
const layLx = layoutScore(rLx, DUR_CFG)
check('连音线 1 条', layLx.pages[0].slurs.length === 1, `got ${layLx.pages[0].slurs.length}`)
check('渐强 1 条', layLx.pages[0].dynamics.length === 1, `got ${layLx.pages[0].dynamics.length}`)
// 语法全覆盖
const rYf = loadSample('yufa-quangai')
check('语法全覆盖 无解析错误', rYf.errors.length === 0, JSON.stringify(rYf.errors.slice(0, 2)))
const gy = rYf.groups[0].music.tokens
check('高音点 1\'', gy[0].kind === 'note' && gy[0].octaveShift === 1)
check('低音点 7,', gy[1].kind === 'note' && gy[1].octaveShift === -1)
check('隐藏休止 8', gy[3].kind === 'rest' && (gy[3] as { hidden: boolean }).hidden)
check('双附点 2..', gy[7].kind === 'note' && gy[7].dots === 2)
check('双减时线 3//', gy[8].kind === 'note' && gy[8].diminishCount === 2)
check('升号 1#', gy[11].kind === 'note' && gy[11].accidental === '#')
check('降号 2$', gy[12].kind === 'note' && gy[12].accidental === '$')
check('还原 3=', gy[13].kind === 'note' && gy[13].accidental === '=')
check('全音符 1---', gy[18].kind === 'note' && gy[18].augmentCount === 3)
const layYf = layoutScore(rYf, DUR_CFG)
check('语法谱歌词 16 字对 16 槽位', layYf.pages[0].lyrics.length === 16, `got ${layYf.pages[0].lyrics.length}`)

// ---- 22. 排版细节（adj1：时值等宽/小节均分/两端对齐） ----
console.log('[22] layout detail (adj1)')
// 时值等宽：1- 2 3 4 | 5 6 7 1 |（1- 占 2 拍；单行谱 = 最后一行，自然宽）
const rw = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 | 5 6 7 1 |\n')
const layW2 = layoutScore(rw, DUR_CFG)
const notesW2 = layW2.pages[0].notes
check('时值等宽：1- 宽 = 2 × 1 拍宽', Math.abs(notesW2[0].width - notesW2[1].width * 2) < 0.5, `${notesW2[0].width} vs ${notesW2[1].width}`)
check('1 拍音符宽一致', Math.abs(notesW2[1].width - notesW2[2].width) < 0.1)
// adj253：单行 2 小节（≤3）自然宽——avgW=max/2、小于 avgW 的拍以 avgW 显示（实测中心 152.1）
check('adj198 自然宽（小节 2 首音符中心）', Math.abs(notesW2[4].x + 6 - 152.1) < 0.5, `x=${notesW2[4].x} center=${notesW2[4].x + 6}`)
// 两端对齐 + 小节均分：8 小节 → 行 1（7 小节）铺满均分，行 2（最后 1 小节 ≤3）自然宽不撑满
const rj2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const layJ = layoutScore(rj2, DUR_CFG)
const rowsJ = [...new Set(layJ.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('8 小节断成 2 行', rowsJ.length === 2, `rows=${rowsJ.length}`)
const row1Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[0])
const maxRight1 = Math.max(...row1Notes.map(segEnd))
check('行 1 两端对齐（末音符段终点贴近右边界）', maxRight1 > RIGHT_EDGE - 10, `right=${maxRight1}`)
// 行 1 按拍数撑满：小节宽 = 拍数 × 每拍宽，第 2 小节首音符在行 1 首音符后一小节宽处
const row1Sorted = row1Notes.sort((a, b) => a.x - b.x)
check('行 1 小节宽按拍数（第 2 小节首音符 > 行 1 首音符 + 4 拍宽）', row1Sorted[4].x + 6 > row1Sorted[0].x + 6 + 4 * 11.824, `x=${row1Sorted[4].x} center=${row1Sorted[4].x + 6}`)
const row2Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[1])
const maxRight2 = Math.max(...row2Notes.map(segEnd))
// adj199：行 2 前面有曲部（行 1）→ 每拍宽与行 1 一致，右缘 106.7（对齐而非自然宽）
check('adj199 最后一行前面有曲部 → 按小节线对齐（右缘 106.7）', Math.abs(maxRight2 - 106.7) < 1, `right=${maxRight2}`)
// adj199：行 2（未撑满）前面有曲部（行 1）→ 每小节宽与行 1 对齐（小节线 x 沿用参考行）
const row1BarsAdj = layJ.pages[0].barlines.filter((b) => Math.abs(b.yTop - row1Notes[0].y + BAR_TOP) < 0.5)
check('adj199 行 1 小节线位置（参考行）', row1BarsAdj.length >= 6 && Math.abs(row1BarsAdj[0].x - 115.2) < 1, `x=${row1BarsAdj[0]?.x}`)
const row2BarsAdj = layJ.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (rowsJ[1] - BAR_TOP)) < 0.5)
  .sort((a, b) => a.x - b.x)
check('adj199 行 2 小节线与行 1 对齐（纵向小节线一致）', row2BarsAdj.length >= 1 && Math.abs(row2BarsAdj[0].x - row1BarsAdj[0].x) < 1, `row2=${row2BarsAdj[0]?.x} row1=${row1BarsAdj[0]?.x}`)
// adj205：>3 小节一律撑满两端对齐（含最后一行）——单行 5 小节谱也两端对齐
const rj5 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const lay5 = layoutScore(rj5, DUR_CFG)
const row5Notes = lay5.pages[0].notes
const maxRight5 = Math.max(...row5Notes.map(segEnd))
check('adj205 单行 5 小节两端对齐（末音符段终点贴近右边界）', maxRight5 > RIGHT_EDGE - 10, `right=${maxRight5}`)
// 对比：单行 3 小节（≤3）仍自然宽不撑满
const rj3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const lay3 = layoutScore(rj3, DUR_CFG)
const maxRight3 = Math.max(...lay3.pages[0].notes.map(segEnd))
check('adj205 单行 3 小节（≤3）仍自然宽不撑满', maxRight3 < RIGHT_EDGE - 100, `right=${maxRight3}`)
// adj297：两端对齐最小小节数可配置（默认 4，行小节数 < 该值自然对齐、≥ 撑满）
const rj4 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const maxRight4 = Math.max(...layoutScore(rj4, DUR_CFG).pages[0].notes.map(segEnd))
check('adj297 默认 4 小节两端对齐（≥4）', maxRight4 > RIGHT_EDGE - 10, `right=${maxRight4}`)
// align_min_bars=6：5 小节（<6）也自然宽不撑满
const maxRight5n = Math.max(
  ...layoutScore(rj5, { ...DUR_CFG, align_min_bars: 6 }).pages[0].notes.map(segEnd),
)
check('adj297 配置 6：5 小节自然宽不撑满', maxRight5n < RIGHT_EDGE - 100, `right=${maxRight5n}`)
// align_min_bars=2：2 小节（≥2）也两端对齐
const rj2b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 |\n')
const maxRight2s = Math.max(
  ...layoutScore(rj2b, { ...DUR_CFG, align_min_bars: 2 }).pages[0].notes.map(segEnd),
)
check('adj297 配置 2：2 小节两端对齐（≥2）', maxRight2s > RIGHT_EDGE - 10, `right=${maxRight2s}`)
// adj211：曲部最后一行以 ||（终止线）结束且 ≤3 小节时按自然宽排布
// ——终止线行音乐已结束，不参与前面行的小节线对齐（refPerBeat）
{
  // 8 小节 + ||：断成 2 行，最后一行 3 小节 + ||（≤3）→ 自然宽（195.1），
  // 而非按前面行对齐（对照同谱 | 结尾为 180.4）
  const r211 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 5 6 7 1 ||\n')
  const lay211 = layoutScore(r211, DUR_CFG)
  const rows211 = [...new Set(lay211.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
  const lastRow211 = lay211.pages[0].notes.filter((n) => n.y === rows211[rows211.length - 1])
  const lastRight211 = Math.max(...lastRow211.map(segEnd))
  check('adj211 最后一行 || 终止（3 小节）→ 自然宽 195.1', Math.abs(lastRight211 - 195.1) < 1, `right=${lastRight211}`)
  // 对照：同谱 | 结尾，最后一行 3 小节仍按前面行对齐（180.4）
  const r211b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 5 6 7 1 |\n')
  const lay211b = layoutScore(r211b, DUR_CFG)
  const rows211b = [...new Set(lay211b.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
  const lastRow211b = lay211b.pages[0].notes.filter((n) => n.y === rows211b[rows211b.length - 1])
  const lastRight211b = Math.max(...lastRow211b.map(segEnd))
  check('adj211 对照：| 结尾最后一行仍按前面行对齐（180.4）', Math.abs(lastRight211b - 180.4) < 1, `right=${lastRight211b}`)
}

// ---- 23. 细节修复（adj2） ----
console.log('[23] adj2 fixes')
// 小节线位置：单行谱（最后一行自然宽 barW=70），线画在小节右边界
const rbar = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layBar = layoutScore(rbar, DUR_CFG)
const bars23 = layBar.pages[0].barlines
check('小节线 2 条', bars23.length === 2, `got ${bars23.length}`)
// adj198：单行 2 小节自然宽——线 1 在小节 1 右端（实测 122.6）
check('adj198 线 1 在小节 1 内容右端（自然宽）', Math.abs(bars23[0].x - 122.6) < 1, `x=${bars23[0].x}`)
// 行尾小节线：自然宽下不到右边界（实测 203.7，不铺满）
check('adj198 线 2 在自然宽行尾（203.7，不铺满）', Math.abs(bars23[1].x - 203.7) < 1, `x=${bars23[1].x}`)
// 行首空 seg（|:）不占宽
const rr23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 | 5 6 7 1 |\n')
const layRr = layoutScore(rr23, DUR_CFG)
const noteRr = layRr.pages[0].notes[0]
// adj198：行首 |: 自然宽（首音符 x+6 = 实测 65.4；首线 44.2 贴左边距）
check('adj198 行首 |: 占位（首音符中心 = 实测 65.4）', Math.abs(noteRr.x + 6 - 65.4) < 0.6, `center=${noteRr.x + 6}`)
check('|: 行首：粗线左缘贴左边距（x = 40+4.2）', Math.abs(layRr.pages[0].barlines[0].x - (ML + 4.2)) < 1, `x=${layRr.pages[0].barlines[0].x}`)
// 歌词中心对齐音符数字（增时线音符 1- 的歌词在数字下方）
const rly23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\nC: 一 二 三 四\n')
const layLy = layoutScore(rly23, DUR_CFG)
const n23 = layLy.pages[0].notes[0]
const l23 = layLy.pages[0].lyrics[0]
check('歌词中心对齐音符数字', Math.abs(l23.x + defaultPageConfig.geci_size / 2 - (n23.x + halfDig)) < 1.5, `lyric=${l23.x} note=${n23.x}`)
// 增时线渲染为 "-" 字符（adj73：随音符字号，比扁矩形协调）
const svg23 = renderScoreToSvg(layLy)[0]
check('增时线存在（"-" 字符）', svg23.includes('>-<'))
const noteY23 = n23.y
const augTextY = /<text x="[\d.]+" y="([\d.]+)" text-anchor="middle"[^>]*>-<\/text>/.exec(svg23)
check('增时线垂直居中于数字（y = 基线-0.4×字号）', augTextY !== null && Math.abs(Number(augTextY[1]) - (noteY23 - defaultPageConfig.note_size * 0.4)) < 0.5, `textY=${augTextY?.[1]} noteY=${noteY23}`)

// ---- 24. 对齐精细（adj3：音符段内居中 + 减时线按拍分组） ----
console.log('[24] adj3 alignment')
// 音符段内居中：单行谱（≤3 小节）自然宽每拍 14，1 拍音符中心 = 拍段中点
const rc24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n')
const layC24 = layoutScore(rc24, DUR_CFG)
const n24 = layC24.pages[0].notes[0]
check('adj198 1 拍音符居中于拍段（自然宽 53）', Math.abs(n24.x + 6 - 53) < 0.5, `center=${n24.x + 6}`)
// 1/ 2/ 各居中于半拍段（自然宽 perBeat 14）
const rh24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ |\n')
const nH24 = layoutScore(rh24, DUR_CFG).pages[0].notes
check('adj198 1/ 居中于第 1 半拍段', Math.abs(nH24[0].x + 6 - (ML + 11)) < 0.5, `center=${nH24[0].x + 6}`)
check('adj198 2/ 居中于第 2 半拍段', Math.abs(nH24[1].x + 6 - (ML + 21.1)) < 0.5, `center=${nH24[1].x + 6}`)
check('八分音符不重叠（间隔 ≥ 数字槽宽）', nH24[1].x - nH24[0].x >= DIGIT_W * 0.8, `gap=${nH24[1].x - nH24[0].x}`)
// 减时线按拍分组
const beamsOf24 = (q: string) => {
  const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
  return computeBeamsForTest(layoutScore(r, DUR_CFG).pages[0].notes)
}
const b1_24 = beamsOf24('1/ 2/ |')
check('1/2/ 同拍 1 条横线', b1_24.length === 1, `got ${b1_24.length}`)
const b2_24 = beamsOf24('1/ 2/ 3/ 4/ |')
check('1/2/3/4/ 两拍 2 条横线', b2_24.length === 2, `got ${b2_24.length}`)
const b2s_24 = [...b2_24].sort((a, b) => a.x1 - b.x1)
check('拍间断开（2/ 与 3/ 之间横线断开）', b2s_24[1].x1 > b2s_24[0].x2, `${b2s_24[0].x1}-${b2s_24[0].x2} | ${b2s_24[1].x1}-${b2s_24[1].x2}`)
const b3_24 = beamsOf24('1// 2// 3// 4// |')
check('1//2//3//4// 同拍 2 条横线（各整拍连）', b3_24.length === 2, `got ${b3_24.length}`)
const b4_24 = beamsOf24('1// 2// 3/ |')
check('1//2//3/ 2 条横线（第1全连、第2连1//2//）', b4_24.length === 2, `got ${b4_24.length}`)

// ---- 25. 每行独立每拍宽（adj15/adj24 断行按实际拍数） ----
console.log('[25] per-row perBeat (adj15/adj24)')
// 8 小节：边距 40 内容区变宽 → 行 1 = 7 小节（28 拍），行 2 = 1 小节（4 拍）
const barsJ25 = layJ.pages[0].barlines
// barlines.yTop = 音符基线 - 18.4×s（数字上沿-14.4 再上延 4px，adj50）
const rowTop = (noteY: number) => noteY - BAR_TOP
const row1Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[0])) < 0.5)
const row2Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[1])) < 0.5)
check('行 1 7 条小节线', row1Bars.length === 7, `got ${row1Bars.length}`)
check('行 2 1 条小节线', row2Bars.length === 1, `got ${row2Bars.length}`)
// adj199：行 2（1 小节 ≤3）前面有曲部（行 1）→ 按小节线对齐，线 1 = 行 1 线 1 = 115.2
check('adj199 行 2 按前面曲部行对齐（线 1 = 115.2）', Math.abs(row2Bars[0].x - 115.2) < 0.5, `x=${row2Bars[0].x}`)

// ---- 26. 超拍小节容错（adj5） ----
console.log('[26] over-beat bars (adj5)')
// 第 2 小节 6 拍 > 4/4：音符不重叠、不溢出（此前会挤在左侧）
const ov26 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 2- |\n')
const layOv = layoutScore(ov26, DUR_CFG)
const notesOv = [...layOv.pages[0].notes].sort((a, b) => a.x - b.x)
let minGap = Infinity
for (let i = 1; i < notesOv.length; i++) minGap = Math.min(minGap, notesOv[i].x - notesOv[i - 1].x)
check('超拍小节音符不重叠（最小间距 ≥ 数字槽宽）', minGap >= DIGIT_W, `minGap=${minGap}`)
const lastOv = notesOv[notesOv.length - 1]
// 段终点 = x + 6 - perBeat/2 + dur×perBeat（数字居中于第 1 拍，perBeat = width/dur）
const perBeatOv = lastOv.width / lastOv.duration
const segEndOv = lastOv.x + 6 - perBeatOv / 2 + lastOv.duration * perBeatOv
check('末音符段终点不溢出', segEndOv <= RIGHT_EDGE + 1, `end=${segEndOv}`)

// ---- 27. 增时线占一拍（adj6） ----
console.log('[27] augment line = 1 beat (adj6)')
// 1- 2 3 4 | 单行均分：数字 1 居中于第 1 拍，增时线占第 2 拍
const au27 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\n')
const layAu = layoutScore(au27, DUR_CFG)
const nAu = layAu.pages[0].notes[0]
const perBeatAu = nAu.width / nAu.duration
check('数字居中于第 1 拍（非整段）', Math.abs(nAu.x + 6 - (ML + 6 + perBeatAu / 2)) < 0.5, `center=${nAu.x + 6}`)
const svgAu = renderScoreToSvg(layAu)[0]
const segStartAu = nAu.x + 6 - perBeatAu / 2
// adj75：段间有拍间距（NOTE_GAP=4，layout/index.ts 常量，未导出故硬编码）
const beatStartAu = segStartAu + perBeatAu + 4
const expectLX = beatStartAu + (perBeatAu - DIGIT_W) / 2 // 占位 DIGIT_W 居中于第 2 拍段
const augTexts = [...svgAu.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="middle"[^>]*font-size="([\d.]+)"[^>]*>-<\/text>/g)]
check('增时线 1 条', augTexts.length === 1, `got ${augTexts.length}`)
const rAu = augTexts[0]
// 增时线应在第 2 拍段（数字槽右缘之后 + 拍间距），x > 数字右缘
check('增时线居中于第 2 拍段', rAu !== undefined && Number(rAu[1]) > nAu.x + DIGIT_W + NS_S * 4, `x=${rAu?.[1]}`)
check('增时线字号 = 音符字号（18，随字号缩放）', rAu !== undefined && Math.abs(Number(rAu[2]) - defaultPageConfig.note_size) < 0.5, `fs=${rAu?.[2]}`)

// ---- 28. 排版辅助虚线（adj7） ----
console.log('[28] layout guides (adj7)')
// 行顶推导：小星星 3 行 → 3 个行顶
const rowTops28 = computeRowTops(layX)
check('小星星 3 行顶', rowTops28[0].length === 3, `got ${rowTops28[0].length}`)
// 行顶 = 音符 y - 19.8
check('行顶 = 音符基线 - 19.8', Math.abs(rowTops28[0][0] - (layX.pages[0].notes[0].y - 19.8)) < 0.5)
// 拖拽增量：50px @ scale 760/595.28 → 39.16pt
const d28 = dragDelta({ key: 'margin_top', dir: 'v' }, 0, 100, 0, 150, 760 / 595.28)
check('垂直拖拽 50px → ~39.2pt', Math.abs(d28 - 39.16) < 0.5, `d=${d28}`)
// 右线反向：向右拖 = 右边距减小
const d28r = dragDelta({ key: 'margin_right', dir: 'h', invert: true }, 0, 0, 50, 0, 1)
check('右边距反向拖拽', Math.abs(d28r - -50) < 0.5, `d=${d28r}`)
check('clamp 钳制', clamp(500, 20, 300) === 300 && clamp(5, 20, 300) === 20)

// ---- 29. 小节间距（adj8/adj15） ----
console.log('[29] bar gap (adj8/adj15)')
// bar_gap=10：单行 2 小节（≤3）自然宽
const gapCfg = { ...DUR_CFG, bar_gap: 10 }
const layGap = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n'), gapCfg)
const notesGap = layGap.pages[0].notes
// adj198：自然宽（gap 体现在小节线后空间）——小节 2 首音符中心 = 实测 135
check('adj198 小节间距生效（小节 2 首音符 = 135）', Math.abs(notesGap[4].x + 6 - 135) < 0.5, `center=${notesGap[4].x + 6}`)
const barsGap = layGap.pages[0].barlines
check('adj198 小节线在内容右端（自然宽 123）', Math.abs(barsGap[0].x - 123) < 0.5, `x=${barsGap[0].x}`)

// ---- 30. 描述头布局与拖拽（adj9） ----
console.log('[30] meta layout (adj9)')
// 描述头区域高 = 上边距 + 内容区高 + 正文上间距（默认 40+80+20 = 140，META_H）
const metaSvg = renderScoreToSvg(layEr)[0]
const getMeta = (key: string) => {
  const m = new RegExp(`data-meta="${key}" x="([\\d.]+)" y="([\\d.]+)"`).exec(metaSvg)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}
const tTitle = getMeta('title')
// 标题居中：x = 页宽/2，y = 上边距 + 30.6（字号安全边距，adj32）
check('标题居中靠上（文字顶不越顶部虚线，adj32）', tTitle !== null && Math.abs(tTitle.x - 595.28 / 2) < 0.5 && Math.abs(tTitle.y - (MT + 30.6)) < 0.5, JSON.stringify(tTitle))
const tAuthor = getMeta('author_0')
// 作者右下：x = 右内容边界（右对齐），y = 描述头区域下沿 - 16（右下角往上）
check('作者右下（右对齐，描述头区域右下角往上）', tAuthor !== null && Math.abs(tAuthor.x - RIGHT_EDGE) < 0.5 && Math.abs(tAuthor.y - (MT + defaultPageConfig.descAreaH - 16)) < 0.5, JSON.stringify(tAuthor))
const tKey = getMeta('keyline')
// adj176：调号/拍号/节拍整体右移 6px（为字母左侧升降号角标留空间）
// keyline x = 左边距 + 6，y = 描述头区域下沿 - 44（左下角往上 44）
check('调式+拍号左下（描述头区域左下角，右移 6px）', tKey !== null && Math.abs(tKey.x - (ML + 6)) < 0.5 && Math.abs(tKey.y - (MT + defaultPageConfig.descAreaH - 44)) < 0.5, JSON.stringify(tKey))
const tTempo = getMeta('tempo')
// adj42：节拍行 = 号与调式行对齐 → x = 左边距 + (w("1 ") - w("♩")) + 6；y = keyline 下 32
check('节拍在 keyline 下（D↔J 间距加大，-20→-12；= 号与调式行对齐；右移 6px）', tTempo !== null && Math.abs(tTempo.x - (ML + 10.47)) < 0.5 && Math.abs(tTempo.y - (MT + defaultPageConfig.descAreaH - 44 + 32)) < 0.5, JSON.stringify(tTempo))
// metaPos 覆盖（相对锚点偏移，adj16）：title 锚=上中点(297.64,MT)，绝对 = 297.64+100, MT+50
const layErM = layoutScore(rEr, { ...DUR_CFG, metaPos: { title: { x: 100, y: 50 } } })
const svgErM = renderScoreToSvg(layErM)[0]
const m2 = /data-meta="title" x="([\d.]+)" y="([\d.]+)"/.exec(svgErM)
check('metaPos 覆盖标题位置（锚点+偏移）', m2 !== null && Math.abs(Number(m2[1]) - (595.28 / 2 + 100)) < 0.5 && Math.abs(Number(m2[2]) - (MT + 50)) < 0.5, m2?.[0])

// ---- 31. 行结构虚线（adj10） ----
console.log('[31] row guides (adj10)')
// 小星星：3 行曲 + 每行歌词 → 每行有 lyricTop/lyricBottom
const rgs31 = computeRowGuides(layX, { quci: defaultPageConfig.height_quci, geci: defaultPageConfig.geci_size })
check('3 行结构', rgs31[0].length === 3, `got ${rgs31[0].length}`)
const rg0 = rgs31[0][0]
check('行 0 有歌词位置', rg0.lyricTop !== null && rg0.lyricBottom !== null)
check('曲底 = 行顶 + 30.6', Math.abs(rg0.yBottom - (rg0.yTop + 30.6)) < 0.5)
// 曲词线位置 = (曲底 + 歌词顶)/2
const quciLine = (rg0.yBottom + (rg0.lyricTop ?? 0)) / 2
check('曲词线在曲底与歌词之间', quciLine > rg0.yBottom && quciLine < (rg0.lyricTop ?? 0), `line=${quciLine}`)
// 词底线 = 歌词 + geci
check('词底 = 歌词基线 + 歌词字号', Math.abs((rg0.lyricBottom ?? 0) - ((rg0.lyricTop ?? 0) + defaultPageConfig.geci_size)) < 0.5)
// 无歌词行：lyricTop null（连音线谱第 2 小节无歌词？用纯曲谱验证）
const rgsNo = computeRowGuides(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n'), DUR_CFG), { quci: 13, geci: 18 })
check('无歌词行 lyricTop=null', rgsNo[0][0].lyricTop === null)

// ---- 32. 描述头位置钳制（adj16/adj31 锚点语义，区域高=descAreaH） ----
console.log('[32] meta clamp (adj16/adj31)')
// 区域：宽 = 页宽-左右边距，高 = descAreaH
const cfgClamp = defaultPageConfig
const areaW = 595.28 - ML - MR
const areaH = cfgClamp.descAreaH
// 标题锚定上边中点：偏移范围 x∈[-w/2, w/2]，y∈[0, h]
const c1 = clampMetaPos('title', 9999, 9999, 595.28, cfgClamp)
check('标题超右下被钳制', Math.abs(c1.x - areaW / 2) < 0.5 && Math.abs(c1.y - areaH) < 0.5, JSON.stringify(c1))
const c2 = clampMetaPos('title', -100, -100, 595.28, cfgClamp)
// 字号安全边距 = biaoti_size × 0.85（随默认标题字号 20 → 17）
const titleSafeY = defaultPageConfig.biaoti_size * 0.85
check('标题左上越界 y 钳到字号安全边距、x 在范围内不变', Math.abs(c2.x + 100) < 0.5 && Math.abs(c2.y - titleSafeY) < 0.5, JSON.stringify(c2))
// 调式拍号锚定左下角：偏移 x∈[0, w-40]，y∈[-h, 0]
const c3 = clampMetaPos('keyline', 9000, 100, 595.28, cfgClamp)
check('keyline 右侧留 40', Math.abs(c3.x - (areaW - 40)) < 0.5 && c3.y === 0, JSON.stringify(c3))
// 作者锚定右下角：偏移 x∈[-w, 0]，y∈[-h, 0]
const c4 = clampMetaPos('author_0', 100, 100, 595.28, cfgClamp)
check('作者超右上被钳制到右下角', c4.x === 0 && c4.y === 0, JSON.stringify(c4))
const c5 = clampMetaPos('author_0', -100, -50, 595.28, cfgClamp)
check('作者区域内偏移不变', c5.x === -100 && c5.y === -50, JSON.stringify(c5))
const c6 = clampMetaPos('tempo', -100, -200, 595.28, cfgClamp)
check('节拍超左上被钳制', c6.x === 0 && Math.abs(c6.y + areaH) < 0.5, JSON.stringify(c6))

// ---- 33. 描述头锚点跟随区域（adj16） ----
console.log('[33] meta follow anchors (adj16)')
const posOf33 = (
  cfg: typeof defaultPageConfig,
  metaPos: Record<string, { x: number; y: number }>,
  key: string,
) => {
  const svg33 = renderScoreToSvg(layoutScore(rEr, { ...cfg, metaPos }))[0]
  const m33 = new RegExp(`data-meta="${key}" x="([\\d.]+)" y="([\\d.]+)"`).exec(svg33)
  return m33 ? { x: Number(m33[1]), y: Number(m33[2]) } : null
}
// 标题：锚 = 区域上边中点 (ML + w/2, MT) + 偏移 (10, 20)
const metaRel = { title: { x: 10, y: 20 } }
const pA = posOf33(defaultPageConfig, metaRel, 'title')
check('默认边距下 = 上中点 + 偏移', pA !== null && Math.abs(pA.x - (ML + (595.28 - ML - MR) / 2 + 10)) < 0.5 && Math.abs(pA.y - (MT + 20)) < 0.5, JSON.stringify(pA))
const pB = posOf33({ ...DUR_CFG, margin_top: 120 }, metaRel, 'title')
check('margin_top 改变 → 标题跟随上移', pB !== null && Math.abs(pB.y - (120 + 20)) < 0.5, JSON.stringify(pB))
const pC = posOf33({ ...DUR_CFG, body_margin_top: 80 }, metaRel, 'title')
check('区域变高 → 标题位置不变（只跟边距锚）', pC !== null && Math.abs(pC.y - (MT + 20)) < 0.5, JSON.stringify(pC))
const pD = posOf33({ ...DUR_CFG, margin_left: 120 }, metaRel, 'title')
check('margin_left 改变 → 标题跟随水平中心', pD !== null && Math.abs(pD.x - (120 + (595.28 - 120 - MR) / 2 + 10)) < 0.5, JSON.stringify(pD))
// 左下锚：调式/拍号；右下锚：作者
const metaRel2 = { keyline: { x: 0, y: -44 }, author_0: { x: 0, y: -16 } }
const kA = posOf33(defaultPageConfig, metaRel2, 'keyline')
// keyline 锚 = 描述头区域左下角 (ML, MT + descAreaH)，偏移 (0, -44)
check('keyline 默认 = 左下角 - 44（descAreaH 区域）', kA !== null && Math.abs(kA.x - ML) < 0.5 && Math.abs(kA.y - (MT + defaultPageConfig.descAreaH - 44)) < 0.5, JSON.stringify(kA))
const kB = posOf33({ ...DUR_CFG, descAreaH: 120 }, metaRel2, 'keyline')
check('descAreaH 变高 → keyline 跟随左下角下移', kB !== null && Math.abs(kB.x - ML) < 0.5 && Math.abs(kB.y - (MT + 120 - 44)) < 0.5, JSON.stringify(kB))
const kC = posOf33({ ...DUR_CFG, body_margin_top: 80 }, metaRel2, 'keyline')
check('body_margin_top 变 → keyline 不移动（锚定描述头区域）', kC !== null && Math.abs(kC.y - (MT + defaultPageConfig.descAreaH - 44)) < 0.5, JSON.stringify(kC))
const aA = posOf33(defaultPageConfig, metaRel2, 'author_0')
// 作者锚 = 描述头区域右下角 (RIGHT_EDGE, MT + descAreaH)，偏移 (0, -16)
check('作者默认 = 右下角 - 16（descAreaH 区域）', aA !== null && Math.abs(aA.x - RIGHT_EDGE) < 0.5 && Math.abs(aA.y - (MT + defaultPageConfig.descAreaH - 16)) < 0.5, JSON.stringify(aA))
const aB = posOf33({ ...DUR_CFG, margin_right: 120 }, metaRel2, 'author_0')
check('右边距改变 → 作者跟随右下角左移', aB !== null && Math.abs(aB.x - (595.28 - 120)) < 0.5 && Math.abs(aB.y - (MT + defaultPageConfig.descAreaH - 16)) < 0.5, JSON.stringify(aB))

// ---- 34. 音符渲染细节（adj13） ----
console.log('[34] note render detail (adj13)')
// 高低音点对齐数字中心
const oct34 = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1' 2 3 4 |\n")
const layO34 = layoutScore(oct34, DUR_CFG)
const nO34 = layO34.pages[0].notes[0]
const octDot = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R_S}"`).exec(renderScoreToSvg(layO34)[0])
// 高音点 x = 数字中心左移 s（adj19）
check('高音点 x = 数字中心左移 1（adj19）', octDot !== null && Math.abs(Number(octDot[1]) - (nO34.x + halfDig - NS_S)) < 0.5, `cx=${octDot?.[1]} expect=${nO34.x + halfDig - NS_S}`)
// 高音点 y = octaveDotY（随字号缩放，点底距数字顶 LAYER_GAP×s）
check('高音点 y = octaveDotY（点底距数字顶 LAYER_GAP，adj60）', octDot !== null && Math.abs(Number(octDot[2]) - octaveDotY(nO34.y, 0, defaultPageConfig.note_size)) < 0.5, `cy=${octDot?.[2]} expect=${octaveDotY(nO34.y, 0, defaultPageConfig.note_size)}`)
// 附点（adj288）：主音符与附点在 1.5 倍时值宽内平均分布（三等分）——圆心 = 主段右端；
// 垂直居中于数字
const dot34 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const layD34 = layoutScore(dot34, DUR_CFG)
const nD34 = layD34.pages[0].notes[0]
const seg34 = nD34.segments?.[0]
const expectDotX = seg34
  ? seg34.x + tokenDuration({ diminishCount: nD34.token.diminishCount, augmentCount: nD34.token.augmentCount, dots: 0 }) * seg34.perBeat
  : nD34.x + DIGIT_W + DOT_RD_S
const dotR = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_RD_S}"`).exec(renderScoreToSvg(layD34)[0])
check('附点圆心 = 主时值结束处（1.5 倍时值宽 2/3 处，adj291）', dotR !== null && Math.abs(Number(dotR[1]) - expectDotX) < 0.5, `cx=${dotR?.[1]} expect=${expectDotX}`)
check('附点垂直居中（y = 基线-0.4×字号）', dotR !== null && Math.abs(Number(dotR[2]) - (nD34.y - defaultPageConfig.note_size * 0.4)) < 0.5, `cy=${dotR?.[2]}`)
// 混合时值（八分+十六分）不重叠：2 小节行 perBeat 受限
const mix34 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3// 4// | 1/ 2/ 3// 4// |\n')
const layM34 = layoutScore(mix34, DUR_CFG)
const nM34 = [...layM34.pages[0].notes].sort((a, b) => a.x - b.x)
let minGap34 = Infinity
for (let i = 1; i < nM34.length; i++) minGap34 = Math.min(minGap34, nM34[i].x - nM34[i - 1].x)
check('混合时值（八分+十六分）不重叠', minGap34 >= DIGIT_W * 0.75, `minGap=${minGap34}`)

// ---- 35. 附点占宽 / 低音点避让（adj15） ----
console.log('[35] adj15 detail')
// adj198：自然宽下附点占宽——1. 宽 27.2、1/. 宽 39.5（每拍 14 + 附点/减时细分）
const d35a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 |\n')
const lay35a = layoutScore(d35a, DUR_CFG)
const n35a = lay35a.pages[0].notes
check('adj198 1. 占宽 > 普通音符（附点增宽）', n35a[0].width > n35a[1].width, `${n35a[0].width} vs ${n35a[1].width}`)
const d35b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/. 2 |\n')
const lay35b = layoutScore(d35b, DUR_CFG)
const n35b = lay35b.pages[0].notes
check('adj198 1/. 占宽 > 1.（减时线+附点更宽）', n35b[0].width > n35b[1].width, `${n35b[0].width} vs ${n35b[1].width}`)
// 低音点 + 减时线：点顶距减时线层底 LAYER_GAP×s（lowDotY 公式）
const d35c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3/, 2 |\n')
const lay35c = layoutScore(d35c, DUR_CFG)
const n35c = lay35c.pages[0].notes[0]
const dot35c = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R_S}"`).exec(renderScoreToSvg(lay35c)[0])
check('低八度点距减时横线 LAYER_GAP、x=数字中心（adj60）', dot35c !== null && Math.abs(Number(dot35c[2]) - lowDotY(n35c.y, 0, 1, defaultPageConfig.note_size)) < 0.5 && Math.abs(Number(dot35c[1]) - (n35c.x + halfDig)) < 0.5, `cy=${dot35c?.[2]} cx=${dot35c?.[1]}`)
// 低音点无减时线：点顶距数字底 LAYER_GAP×s（lowDotY 公式）
const d35d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3, 2 |\n')
const lay35d = layoutScore(d35d, DUR_CFG)
const n35d = lay35d.pages[0].notes[0]
const dot35d = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R_S}"`).exec(renderScoreToSvg(lay35d)[0])
check('低八度点距数字底部 LAYER_GAP、x=数字中心（adj60）', dot35d !== null && Math.abs(Number(dot35d[2]) - lowDotY(n35d.y, 0, 0, defaultPageConfig.note_size)) < 0.5 && Math.abs(Number(dot35d[1]) - (n35d.x + halfDig)) < 0.5, `cy=${dot35d?.[2]} cx=${dot35d?.[1]}`)

// ---- 36. 音符块语法：后置变音 / 虚音符 / 倚音 / 单空格（adj23） ----
console.log('[36] note block syntax (adj23)')
// 变音后置
const r36a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1# 2$ 3= 4 |\n')
const tk36a = r36a.groups[0].music.tokens
check('变音后置 1# 2$ 3=', r36a.errors.length === 0 && tk36a[0].kind === 'note' && tk36a[0].accidental === '#' && tk36a[1].kind === 'note' && tk36a[1].accidental === '$' && tk36a[2].kind === 'note' && tk36a[2].accidental === '=', JSON.stringify(r36a.errors))
// 连音线修饰单音符 (3)：`(` 修饰其后音符 → 开括号 + 音符 + 闭括号
const r36b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 (3) 5 |\n')
const tk36b = r36b.groups[0].music.tokens
check('(3) = 连音线开 + 音符3 + 连音线闭', r36b.errors.length === 0 && tk36b.map((t) => t.kind).join(',') === 'note,slur,note,slur,note,barline', tk36b.map((t) => t.kind).join(',') + ' | ' + JSON.stringify(r36b.errors))
check('单音符连音线 (3) 不渲染（退化跳过）', layoutScore(r36b, DUR_CFG).pages[0].slurs.length === 0)
// 倚音 1[65] 前 / 2[h56] 后
const r36c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1[65] 2[h56] 3 |\n')
const tk36c = r36c.groups[0].music.tokens
const gn1 = tk36c[0].kind === 'note' ? tk36c[0].gracenotes : undefined
const gn2 = tk36c[1].kind === 'note' ? tk36c[1].gracenotes : undefined
check('前倚音 1[65]', r36c.errors.length === 0 && !!gn1 && gn1.after === false && gn1.notes.length === 2 && gn1.notes[0].pitch === 6 && gn1.notes[1].pitch === 5, JSON.stringify(gn1))
check('后倚音 2[h56]', !!gn2 && gn2.after === true && gn2.notes.length === 2 && gn2.notes[0].pitch === 5 && gn2.notes[1].pitch === 6, JSON.stringify(gn2))
// 倚音内高低音/变音/减时
const r36d = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1[6'5,2/3#] 4 |\n")
const gn3 = r36d.groups[0].music.tokens[0].kind === 'note' ? r36d.groups[0].music.tokens[0].gracenotes : undefined
check('倚音内高低音/变音/减时', !!gn3 && gn3.notes[0].octaveShift === 1 && gn3.notes[1].octaveShift === -1 && gn3.notes[2].diminishCount === 1 && gn3.notes[3].accidental === '#', JSON.stringify(gn3))
// 空格提示：双空格警告、紧贴合法（空格仅格式化）、单空格无警告
const r36e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1  2 | 3 4 |\n')
check('双空格 → 警告', r36e.errors.some((e) => e.severity === 'warning' && e.message.includes('一个空格')))
const r36f = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2| 3 4 |\n')
check('音符紧贴小节线 → 合法（空格可选，无警告）', r36f.errors.length === 0, JSON.stringify(r36f.errors))
const r36g = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 | 3 4 |\n')
check('单空格 → 无警告', r36g.errors.length === 0, JSON.stringify(r36g.errors))
// adj220：& 编码只收字母（+ 可选 +）——&dy5/ 中 5 是下一音符起点，
// 3&dy5/&dy5/&dy5/&dy3/&dy6&dy 应拆为 6 个音符各带 &dy
const r220 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&dy5/&dy5/&dy5/&dy3/&dy6&dy |\n')
const tk220 = r220.groups[0].music.tokens
const notes220 = tk220.filter((t) => t.kind === 'note')
check('adj220 & 紧贴分块：6 个音符各带 &dy（不粘连）', r220.errors.length === 0 && notes220.length === 6 && notes220.every((n) => n.kind === 'note' && n.symbols.join(',') === 'dy'), notes220.map((n) => (n.kind === 'note' ? `音${n.pitch}${n.diminishCount ? '/'.repeat(n.diminishCount) : ''}[${n.symbols.join(',')}]` : '')).join(' '))
check('adj220 时值正确（3 与 6 整拍、5/ 3/ 半拍）', tokenDuration(notes220[0] as { tupletDur?: number }) === 1 && tokenDuration(notes220[1] as { tupletDur?: number }) === 0.5 && tokenDuration(notes220[5] as { tupletDur?: number }) === 1, notes220.map((n) => String(tokenDuration(n))).join(','))
// 独立 & 装饰同理：&dy5/ 独立出现也拆块（&dy 成为 decoration，5/ 是独立音符）
const r220b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 &dy5/ 6 |\n')
const notes220b = r220b.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('adj220 独立 & 编码不吞数字（&dy5/ → 音符 5/ 独立）', r220b.errors.length === 0 && notes220b.length === 3 && notes220b[1].kind === 'note' && notes220b[1].pitch === 5 && notes220b[1].diminishCount === 1, notes220b.map((n) => (n.kind === 'note' ? `音${n.pitch}${n.diminishCount ? '/'.repeat(n.diminishCount) : ''}` : '')).join(' '))
// 括号一律连音线（空格与否均可）：( 2 3 ) 与 (4) 都是连音线
const r36h = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) (4) 5 |\n')
check('( 2 3 ) 与 (4) 均解析为连音线', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') === 'note,slur,note,note,slur,slur,note,slur,note,barline', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') + ' | ' + JSON.stringify(r36h.errors))
// 渲染：倚音小字（adj105：字号 = 主音符 × 0.5 = 9，由 0.4 调大；加粗与主音符一致）
const svg36c = renderScoreToSvg(layoutScore(r36c, DUR_CFG))[0]
check('倚音渲染小数字（font-size = 0.5×主音符）', svg36c.includes(`font-size="${GRACE_FS}"`), '')
// adj97：倚音减时线为跨组平行横线（line 元素）而非斜线（path M...L...斜向）
check('倚音减时线为横线（line 元素）', svg36c.includes('<line ') && svg36c.includes('stroke="#1b1b1b"'), '')
// adj101：倚音与主音符之间是一条抛物线弧线（SVG Q 二次贝塞尔，控制点在起点正下），粗细同减时线 0.6
check('倚音连接弧线为抛物线（Q 命令）', svg36c.includes(' Q ') && svg36c.includes(`stroke-width="${GRACE_LINE_W * NS_S}"`), '')
// adj105：倚音数字加粗（与主音符粗体一致）
check('倚音数字加粗', new RegExp(`<text x="[^"]+" y="[^"]+" font-size="${GRACE_FS}"[^>]*font-weight="bold"`).test(svg36c), '')
// adj98：倚音减时线 = 实际时值 +1 条——主音符 1[65]（倚音无 /）→ 倚音有 1 条横线；
// 2[3/]（倚音 /）→ 2 条（减时线数 = diminishCount + 1）
const r98g = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 2[3] 3[4/] 4 |\n')
const svg98g = renderScoreToSvg(layoutScore(r98g, DUR_CFG))[0]
// 减时线横线数量（倚音区）：2[3] → 1 条、3[4/] → 2 条，共 3 条小横线（y 在倚音基线下方）
const gLines98 = [...svg98g.matchAll(/<line /g)].length
check('倚音减时线 +1（2[3]→1 条、3[4/]→2 条，共 3 条横线）', gLines98 >= 3, `lines=${gLines98}`)
// adj100：首条减时线 y = 主音符文本上端（主音符基线 y - 18×0.8 = y - 14.4）；同组线间距固定 1.2px
const lay100 = layoutScore(r98g, DUR_CFG)
const n100 = [...lay100.pages[0].notes].sort((a, b) => a.x - b.x)
// 按 x1 分组（2[3] 与 3[4/] 是两组音符，各自首条线都在自己的 mainTop，不能混算间距）
const gLineGroups100 = new Map<number, number[]>()
for (const m of svg98g.matchAll(new RegExp(`<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="[^"]+" stroke="#1b1b1b" stroke-width="${GRACE_LINE_W * NS_S}"`, 'g'))) {
  const x1 = Number(m[1])
  const arr = gLineGroups100.get(x1) ?? []
  arr.push(Number(m[2]))
  gLineGroups100.set(x1, arr)
}
const gLineYs100 = [...gLineGroups100.values()].map((g) => g.sort((a, b) => a - b))
const firstLineY100 = Math.min(...gLineYs100.flat())
const maxGroup100 = gLineYs100.reduce((a, b) => (b.length > a.length ? b : a), [])
check('adj100 首条减时线 y = 主音符文本上端（基线 - 0.8em）', gLineYs100.length >= 2 && Math.abs(firstLineY100 - (n100[0].y - DIGIT_TOP)) < 0.5, `first=${firstLineY100} mainTop=${(n100[0].y - DIGIT_TOP).toFixed(1)}`)
check('adj100 减时线间距 1.2×s', maxGroup100.length >= 2 && Math.abs(maxGroup100[1] - maxGroup100[0] - GRACE_BEAM_GAP * NS_S) < 0.05, `ys=${maxGroup100.join(',')}`)
// adj100：倚音数字上移，基线在首条减时线上方（不压线）
const gTextY100 = Number(svg98g.match(new RegExp(`<text x="[^"]+" y="([^"]+)" font-size="${GRACE_FS}"`))?.[1] ?? 'NaN')
check('adj100 倚音数字上移（基线 < 首条减时线 - 1）', !Number.isNaN(gTextY100) && gTextY100 < gLineYs100[0] - 1, `gy=${gTextY100} line0=${gLineYs100[0]}`)
// adj101：弧线为二次贝塞尔 Q——控制点在起点正下方（先向下），前倚音终点向右、后倚音终点向左，终点比起点低
const arcs100 = [...svg36c.matchAll(/<path d="M ([-\d.]+) ([-\d.]+) Q ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/g)].map((m) => ({ sx: Number(m[1]), sy: Number(m[2]), cx: Number(m[3]), cy: Number(m[4]), ex: Number(m[5]), ey: Number(m[6]) }))
const arcFront = arcs100.find((a) => a.ex > a.sx)
const arcBack = arcs100.find((a) => a.ex < a.sx)
check('adj101 前倚音弧线先向下再弯向右（控制点 x=起点 x、终点 x>起点 x 且 y>起点 y）', !!arcFront && Math.abs(arcFront.cx - arcFront.sx) < 0.05 && arcFront.ex > arcFront.sx && arcFront.ey > arcFront.sy, JSON.stringify(arcFront))
check('adj101 后倚音弧线先向下再弯向左（控制点 x=起点 x、终点 x<起点 x 且 y>起点 y）', !!arcBack && Math.abs(arcBack.cx - arcBack.sx) < 0.05 && arcBack.ex < arcBack.sx && arcBack.ey > arcBack.sy, JSON.stringify(arcBack))
// adj101：倚音低八度点紧贴该音符最后一条减时线下方（线底 + (LAYER_GAP+DOT_R)×倚音缩放因子 = 圆心）
const svg36d = renderScoreToSvg(layoutScore(r36d, DUR_CFG))[0]
const yMain36d = Number(svg36d.match(new RegExp(`<text x="[^"]+" y="([^"]+)" data-notepos="[^"]+" font-size="${defaultPageConfig.note_size}"[^>]*font-weight="bold"[^>]*>1<`))?.[1] ?? 'NaN')
const lowCy36d = Math.max(...[...svg36d.matchAll(/<circle cx="[^"]+" cy="([^"]+)" r="[^"]+" fill="#1b1b1b"/g)].map((m) => Number(m[1])))
// 5, 无减时（dc=1 → 线 1 条）：圆心 = mainTop + 半线高 + (LAYER_GAP+DOT_R)×gs；gs = 倚音缩放因子
const gs = GRACE_FS / defaultPageConfig.note_size // 倚音缩放因子
check('adj101 低八度点在最后一条减时线下方（线底+LAYER_GAP×s）', !Number.isNaN(yMain36d) && Math.abs(lowCy36d - (yMain36d - DIGIT_TOP + (GRACE_LINE_W * NS_S) / 2 + (LAYER_GAP + DOT_R) * gs)) < 0.6, `lowCy=${lowCy36d} expect=${(yMain36d - DIGIT_TOP + (GRACE_LINE_W * NS_S) / 2 + (LAYER_GAP + DOT_R) * gs).toFixed(2)}`)
// adj102：弧线起点——无低八度点 → 最后一条减时线底（直接连接）；有低八度点 → 最低点底 + LAYER_GAP×s
const yMain36c = Number(svg36c.match(new RegExp(`<text x="[^"]+" y="([^"]+)" data-notepos="[^"]+" font-size="${defaultPageConfig.note_size}"[^>]*font-weight="bold"[^>]*>1<`))?.[1] ?? 'NaN')
const arcStarts36c = [...svg36c.matchAll(/<path d="M [-\d.]+ ([-\d.]+) Q/g)].map((m) => Number(m[1]))
check('adj102 无低八度点：弧线起点 = 最后一条减时线底（与线连接）', arcStarts36c.length === 2 && arcStarts36c.every((sy) => Math.abs(sy - (yMain36c - DIGIT_TOP + (GRACE_LINE_W * NS_S) / 2)) < 0.5), `sy=${arcStarts36c.join(',')} lineBottom=${(yMain36c - DIGIT_TOP + (GRACE_LINE_W * NS_S) / 2).toFixed(1)}`)
const arcSy36d = Number(svg36d.match(/<path d="M [-\d.]+ ([-\d.]+) Q/)?.[1] ?? 'NaN')
check('adj102 有低八度点：弧线起点 = 低八度点底 + LAYER_GAP×s', !Number.isNaN(arcSy36d) && Math.abs(arcSy36d - (lowCy36d + (DOT_R + LAYER_GAP) * gs)) < 0.6, `arcSy=${arcSy36d} expect=${(lowCy36d + (DOT_R + LAYER_GAP) * gs).toFixed(2)}`)
// adj103：多音符（≥2）倚音数字间距缩小为 0.5×字号（×GRACE_SLOT_RATIO_MULTI）；1[65] 与 2[h56] 两组
const gx36c = [...svg36c.matchAll(new RegExp(`<text x="([^"]+)" y="[^"]+" font-size="${GRACE_FS}"`, 'g'))].map((m) => Number(m[1])).sort((a, b) => a - b)
const gSize36 = Math.max(6 * NS_S, defaultPageConfig.note_size * GRACE_SIZE_RATIO) // 倚音字号（同渲染）
const gGap36 = gSize36 * GRACE_SLOT_RATIO_MULTI // 多音符间距
check('adj103 多音符倚音数字间距 = 0.5×字号', gx36c.length === 4 && Math.abs(gx36c[1] - gx36c[0] - gGap36) < 0.15 && Math.abs(gx36c[3] - gx36c[2] - gGap36) < 0.15, `xs=${gx36c.join(',')}`)
// adj106：倚音组右端与主音符固定留 1px×s（多音符组尾不侵入主音符区）——前倚音 1[65] 最右数字 5 右缘 = 主音符 1 左缘 - 1
const yMainX1 = Number(svg36c.match(new RegExp(`<text x="([^"]+)" y="[^"]+" data-notepos="[^"]+" font-size="${defaultPageConfig.note_size}"[^>]*font-weight="bold"[^>]*>1<`))?.[1] ?? 'NaN')
const gW36 = gSize36 * GRACE_SLOT_RATIO // 倚音数字槽宽
check('adj106 前倚音组右端与主音符留 1px（不重叠）', !Number.isNaN(yMainX1) && Math.abs(gx36c[1] + gW36 - (yMainX1 - NS_S)) < 0.3, `gRight=${(gx36c[1] + gW36).toFixed(1)} main=${yMainX1}`)
// adj98：倚音占位计入音符宽度——带倚音的音符 perBeat ≥ 无倚音音符
const lay98 = layoutScore(r98g, DUR_CFG)
const n98 = [...lay98.pages[0].notes].sort((a, b) => a.x - b.x)
const w98g = (n: { segments?: { x: number; beats: number; perBeat: number }[] }) => {
  const segs = n.segments ?? []
  return segs.reduce((a, s) => a + s.beats * s.perBeat, 0)
}
check('倚音占位计入音符宽度（带倚音音符更宽）', w98g(n98[0]) >= w98g(n98[2]), `g=${w98g(n98[0]).toFixed(1)} plain=${w98g(n98[2]).toFixed(1)}`)
// 播放：倚音事件（音高覆盖）
const seq36 = buildPlaySequence(r36c, layoutScore(r36c, DUR_CFG), 120)
const gPitches = seq36.events.filter((e) => e.pitch).map((e) => e.pitch)
check('倚音播放事件 7 个（2+1 前 + 2+1+1 主/后）', seq36.events.length === 7, `got ${seq36.events.length}`)
check('倚音音高 = 倚音音符本身（A4,G4,G4,A4）', gPitches.join(',') === 'A4,G4,G4,A4', gPitches.join(','))

// ---- 37. 小节线居中 + 单空格（adj25） ----
console.log('[37] barline centering (adj25)')
// 多声部块小节线在小节右边界（此前错误画在小节中央）
// layV（[17]）：Q1/Q2 各 1 小节 4 拍，blockBeats=4，perBeat=(435.28-12)/4=105.82
const bars37 = layV.pages[0].barlines
// 多声部块小节线在小节右边界（此前错误画在小节中央）；块级行尾线 clamp 到右内容边界
check('多声部小节线在小节内容右端（adj38+adj250）', bars37.length === 2 && bars37.every((b) => b.x > 100), `len=${bars37.length} xs=${bars37.map((b) => b.x.toFixed(1))}`)// layV 1 小节(≤3)自然宽不撑满，线贴小节内容右端（≈118）；>3 小节才两端对齐行尾（adj250）
// formatter 单空格：音符块与小节线块之间恰好一个空格
const fmt37 = formatJps('V: 1.0\nB: t\nQ: 1 2|3 4\n')
check('formatter 小节线前补单空格', fmt37.includes('2 | 3'), fmt37.replace(/\n/g, '⏎'))
const fmt37b = formatJps('V: 1.0\nB: t\nQ: 1  2  |  3 4\n')
check('formatter 多空格压缩为单空格', fmt37b.includes('1 2 | 3 4') && !fmt37b.includes('  '), fmt37b.replace(/\n/g, '⏎'))
// 编辑区高亮：小节线字符带 hl-barline 类
const hl37 = highlightCode('V: 1.0\nB: t\nQ: 1 2 | 3 4\n')
check('编辑器小节线高亮 class', hl37.includes('class="hl-barline"'), '')

// ---- 38. 跳房子语法（adj26） ----
console.log('[38] volta syntax (adj26)')
// 1. 基本：|["1." 4 4 5 |]["2." 5 4 3 |] 两头封闭 + 连续跳房子
const r38a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |["1." 4 4 5 |]["2." 5 4 3 |] 7 |\n')
const bars38a = r38a.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('跳房子 4 个小节线块（adj139：] 后 [ 与 ] 共用一根线）', r38a.errors.length === 0 && bars38a.length === 4, JSON.stringify(r38a.errors))
const vs1 = bars38a[0].kind === 'barline' ? bars38a[0].voltaStart : undefined
const ve1 = bars38a[1].kind === 'barline' ? bars38a[1] : undefined
const vs2 = bars38a[1].kind === 'barline' ? bars38a[1].voltaStart : undefined
check('跳房子 1 注释 "1."', !!vs1 && vs1.comment === '1.', JSON.stringify(vs1))
check('跳房子 1 以 |] 结束', !!ve1 && ve1.voltaEnd === true && ve1.voltaEndSlash !== true)
check('adj139 连续跳房子 2 与 ] 共用线（voltaEnd+voltaStart）', !!vs2 && vs2.comment === '2.' && bars38a[1].kind === 'barline' && bars38a[1].voltaEnd === true && bars38a[1].voltaStart !== undefined, JSON.stringify(vs2))
// 2. 修饰：+ 抬高、|]/ 开口结束
const r38b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[+"1." 4 4 5 |]/ 7 |\n')
const b38b = r38b.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('[+ 抬高 + 注释', b38b.length === 3 && b38b[0].kind === 'barline' && b38b[0].voltaStart?.plus === 1 && b38b[0].voltaStart?.comment === '1.', JSON.stringify(b38b[0]))
check('|]/ 开口结束', b38b[1].kind === 'barline' && b38b[1].voltaEnd === true && b38b[1].voltaEndSlash === true, JSON.stringify(b38b[1]))
// adj356：[- 修饰降低跳房子线（与 + 相反）
const r38e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |[- 3 4 ] 5 6 |\n')
const b38e = r38e.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('[- 降低修饰解析（minus=1）', b38e.length >= 2 && b38e[0].kind === 'barline' && b38e[0].voltaStart?.minus === 1 && b38e[0].voltaStart?.plus === 0, JSON.stringify(b38e[0]))
// 渲染：[- 线更低（y 更大）、[- 两个更低、[+ 更高
{
  const vyOf = (src: string) => {
    const lay = layoutScore(parseJps(src), DUR_CFG)
    const b = lay.pages[0].barlines.find((bb) => bb.voltaStart)
    return b ? b.yTop - VOLTA_BAR_GAP - (b.voltaStart?.plus ?? 0) * VOLTA_RAISE + (b.voltaStart?.minus ?? 0) * VOLTA_RAISE : NaN
  }
  const vDef = vyOf('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[ 3 4 ] 5 |\n')
  const vMinus = vyOf('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[- 3 4 ] 5 |\n')
  const vMinus2 = vyOf('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[-- 3 4 ] 5 |\n')
  const vPlus = vyOf('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[+ 3 4 ] 5 |\n')
  check('[- 降低跳房子线（y 更大，方向与 + 相反）', vMinus > vDef + 1 && vMinus2 > vDef + 2 && vPlus < vDef - 1, `def=${vDef.toFixed(2)} minus=${vMinus.toFixed(2)} minus2=${vMinus2.toFixed(2)} plus=${vPlus.toFixed(2)}`)
}
// 3. 行首跳房子用 |/ [
const r38c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |/ [ 5 6 ] 1 2 |\n')
const b38c = r38c.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('|/ [ 行首跳房子并入隐藏小节线', r38c.errors.length === 0 && b38c[0].kind === 'barline' && b38c[0].voltaStart?.open === true && b38c[0].type === '|/', JSON.stringify(b38c[0]))
// 行首直接 [ → 警告
const r38d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: [ 5 6 ] 1 2 |\n')
check('行首 [ 无小节线 → 警告', r38d.errors.some((e) => e.message.includes('小节线后')))
// 渲染：番号显示在线起点上方
const lay38 = layoutScore(r38a, DUR_CFG)
const svg38 = renderScoreToSvg(lay38)[0]
check('跳房子番号 "1." "2." 渲染', svg38.includes('>1.<') && svg38.includes('>2.<'))
// 播放：反复中跳房子段第二遍跳过（注意 8 是隐藏休止符，用 7 1 收尾）
const r38p = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 |["1." 3 4 |]["2." 5 6 |] 7 1 :|\n')
const seq38 = buildPlaySequence(r38p, layoutScore(r38p, DUR_CFG), 120)
check('跳房子播放 12 事件（pass1 全 8 + pass2 1,2,7,1）', seq38.events.length === 12 && pitchSeq(seq38) === 'C4,D4,E4,F4,G4,A4,B4,C4,C4,D4,B4,C4', `${seq38.events.length}:${pitchSeq(seq38)}`)
// adj295：跳房子与反复修饰符共存（|]/&hs、|&hs]/ 顺序解析而非互斥——
// 此前 else-if 二选一：前者吞 &hs、后者把残留 ] 解析成第二条独立小节线）
const r95a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |["1." 3 4 |]/&hs 5 6 |&ds]/ 7 1 |\n')
const b95a = r95a.groups[0].music.tokens.filter((t) => t.kind === 'barline')
const bar95a = b95a[1]
const bar95b = b95a[2]
check('adj295 |]/&hs：voltaEnd+slash 与 &hs 共存', r95a.errors.length === 0 && bar95a.kind === 'barline' && bar95a.voltaEnd === true && bar95a.voltaEndSlash === true && bar95a.marks?.includes('hs') === true, JSON.stringify(bar95a))
check('adj295 |&ds]/：&ds 与 voltaEnd 共存（不再两条线）', bar95b.kind === 'barline' && bar95b.marks?.includes('ds') === true && bar95b.voltaEnd === true && bar95b.voltaEndSlash === true, JSON.stringify(bar95b))
check('adj295 小节线数量正确（4 条）', b95a.length === 4, String(b95a.length))
const svg95 = renderScoreToSvg(layoutScore(r95a, DUR_CFG))[0]
check('adj295 渲染含花 S 记号 𝄋', svg95.includes('𝄋'), '')
check('adj295 渲染含 D.S. 文本', svg95.includes('D.S.'), '')
// &ty 同样：|&ty]/ 与 voltaEnd 共存
const r95c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |["1." 3 4 |&ty]/ 5 6 |\n')
const b95c = r95c.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('adj295 |&ty]/：&ty 与 voltaEnd 共存', b95c[1]?.kind === 'barline' && b95c[1].marks?.includes('ty') === true && b95c[1].voltaEnd === true && b95c[1].voltaEndSlash === true, JSON.stringify(b95c[1]))

// ---- 39. 描述头下端线（adj30） ----
console.log('[39] desc area guide (adj30)')
// 描述头区域下沿 = 上边距 + 内容区高 + 曲部上间距（= META_H）
check('metaAreaH 默认 = 上边距+区域高+上间距', Math.abs(metaAreaH(defaultPageConfig) - META_H) < 0.5, String(metaAreaH(defaultPageConfig)))
// descAreaH 增大 → 描述头区域变高（曲部第一行下移）
const lay39a = layoutScore(rEr, { ...DUR_CFG, descAreaH: 140 })
const firstY39a = Math.min(...lay39a.pages[0].notes.map((n) => n.y))
check('descAreaH 增大 → 曲部第一行下移', Math.abs(firstY39a - (MT + 140 + defaultPageConfig.body_margin_top + 19.8 * NS_S)) < 0.5, `y=${firstY39a}`)
// 描述头元素（作者，右下锚）跟随描述头区域（descAreaH），不出区域
const svg39 = renderScoreToSvg(lay39a)[0]
const m39 = /data-meta="author_0" x="[\d.]+" y="([\d.]+)"/.exec(svg39)
check('作者跟随描述头区域下移（在 descAreaH 内）', m39 !== null && Math.abs(Number(m39[1]) - (MT + 140 - 16)) < 0.5, `y=${m39?.[1]}`)
// body_margin_top 最小 4px（描述头下端线最小间距）
const exLimits = GUIDE_LIMITS_EX as Record<string, [number, number]>
check('body_margin_top 最小 4px', exLimits['body_margin_top'][0] === 4)
check('descAreaH 范围下限 40', exLimits['descAreaH'][0] === 40)

// ---- 40. 无歌词行行高（adj33） ----
console.log('[40] no-lyric row height (adj33)')
// 无歌词：行高 = 曲高(note_size×1.7) + 曲上间距(20)（歌词部空间为 0；adj78 曲上间距 40→20）
const rowMusicH = defaultPageConfig.note_size * 1.7 // 曲高（随音符字号）
const r40a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const lay40a = layoutScore(r40a, DUR_CFG)
const ys40a = [...new Set(lay40a.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('无歌词行高 = 曲高 + 曲上间距', ys40a.length >= 2 && Math.abs(ys40a[1] - ys40a[0] - (rowMusicH + defaultPageConfig.height_ciqu)) < 0.5, `dy=${ys40a[1] - ys40a[0]}`)
// 有歌词对照：行高 = 曲高 + 词曲间距 + (歌词字号+4+10) + 曲上词距（adj73 词曲最小间距 8→4；adj92 曲上间距 20→12）
const r40b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\n')
const lay40b = layoutScore(r40b, DUR_CFG)
const ys40b = [...new Set(lay40b.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
const rowLyricH = rowMusicH + defaultPageConfig.height_quci + (defaultPageConfig.geci_size + 4 + 10) + defaultPageConfig.height_ciqu_lyric
check('有歌词行高 = 曲高+词曲间距+词高+曲上词距', ys40b.length >= 2 && Math.abs(ys40b[1] - ys40b[0] - rowLyricH) < 0.5, `dy=${ys40b[1] - ys40b[0]} expect=${rowLyricH}`)

// ---- 41. 小节线高度与反复点（adj34） ----
console.log('[41] barline height & dots (adj34)')
const r41 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 4 :|\n')
const lay41 = layoutScore(r41, DUR_CFG)
const b41 = lay41.pages[0].barlines[0]
const n41 = lay41.pages[0].notes[0]
check('小节线上端 = 音符基线-18.4×s（数字上沿-14.4 再上延 4px）', Math.abs(b41.yTop - (n41.y - BAR_TOP)) < 0.5, `yTop=${b41.yTop}`)
check('小节线下端 = 音符基线+4.5×s（数字下沿+0.5 再下延 4px）', Math.abs(b41.yBottom - (n41.y + 4.5 * NS_S)) < 0.5, `yBottom=${b41.yBottom}`)
check('小节线高 22.9×s（数字 14.9 + 上下各延伸 4px）', Math.abs(b41.yBottom - b41.yTop - BAR_H) < 0.5)
// 反复点：|: 为左粗线、中细线、右 :（点中心 = 线 x + 1.6，点线距 1.2px，adj104 点径 2.4、r=1.2；随字号缩放 ×s）
const svg41 = renderScoreToSvg(lay41)[0]
const dot41R = R1(BARLINE_DOT_R * NS_S) // 反复点半径随字号
const dot41 = new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${dot41R}"`).exec(svg41)
check('反复点（|: 右侧 :，cx = 线 x + 1.6）', dot41 !== null && Math.abs(Number(dot41[1]) - (b41.x + 1.6)) < 0.5, `cx=${dot41?.[1]} x=${b41.x}`)

// ---- 42. 拍级挤占（adj35） ----
console.log('[42] beat-level spacing (adj35)')
// 16 分音符拍 need=minNoteW/0.25 > 行均分 → 该拍固定（挤占），其余拍平均分享（H_GAP 动态）
const r42 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1// 2// 3// 4// | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const lay42 = layoutScore(r42, DUR_CFG)
const n42 = [...lay42.pages[0].notes].sort((a, b) => a.x - b.x)
const minNoteW42 = defaultPageConfig.note_size * 0.62 + H_GAP
check('16 分音符间距 ≥ minNoteW（数字槽 + H_GAP，adj253 用户规则下更宽不重叠）', n42[1].x - n42[0].x >= minNoteW42, `gap=${n42[1].x - n42[0].x}`)
// 拍 1 起点 = 左边距(BAR 内)+need+空间9.5；第 5 音符在密集拍段之后、正常拍间距 ≥ minNoteW
check('超拍挤占后第 5 音符在密集拍段右侧', n42[4].x + 6 > ML + minNoteW42 / 0.25 + 9.5 + 6, `center=${n42[4].x + 6}`)
check('超拍挤占后正常拍间距 ≥ minNoteW（不重叠）', n42[5].x - n42[4].x >= minNoteW42, `gap=${(n42[5].x - n42[4].x).toFixed(1)}`)
// 行不溢出
check('拍级行不溢出页面', Math.max(...n42.map((nn) => nn.x + 11.16)) <= RIGHT_EDGE, `right=${Math.max(...n42.map((nn) => nn.x + 11.16))}`)
// 13 拍整行不拆（断行按逐拍 need，而非统一 maxPbm）
const ys42 = [...new Set(lay42.pages[0].notes.map((nn) => nn.y))]
check('密集拍所在行不拆（13 拍一行）', ys42.length === 1, `rows=${ys42.length}`)

// ---- 43. 附点占位 / 连音线端点 / 小节线不重叠（adj36） ----
console.log('[43] dot width / slur ends / barline gap (adj36)')
// ① 附点段用所在拍 perBeat（adj85：原用起始拍导致附点跨密集拍时段宽与拍宽不一致、行尾留白）
const r43a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2// 3// 4// 5// 6// 7// 1// | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const n43a = [...layoutScore(r43a, DUR_CFG).pages[0].notes].sort((a, b) => a.x - b.x)[0]
const sg43a = n43a.segments ?? []
const dotW = (sg43a[1]?.beats ?? 0) * (sg43a[1]?.perBeat ?? 0)
const baseW = (sg43a[0]?.beats ?? 0) * (sg43a[0]?.perBeat ?? 0)
check('附点段宽 = 所在拍 0.5 拍宽（与 2// 同拍同 perBeat）', sg43a.length >= 2 && dotW === 0.5 * (sg43a[1]?.perBeat ?? 0), `dot=${dotW} pb=${sg43a[1]?.perBeat}`)
// 附点音符总宽 = 基础拍 1 + 所在拍 0.5（行尾不因附点留白）
check('附点音符占位 = 1 基础拍 + 0.5 所在拍宽', sg43a.length >= 2 && Math.abs(baseW + dotW - ((sg43a[0]?.perBeat ?? 0) + 0.5 * (sg43a[1]?.perBeat ?? 0))) < 0.05, `w=${baseW + dotW}`)
// adj85：附点跨密集拍时段宽与拍宽自洽，行内容撑满（两端对齐，末段右贴右边界）
const r43j = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 - - 0 | 2 2/ 6,/ 2 - | 3 (2/ 3// 2//) 1 - | 7,/ 7,/ 7,/ 1/ 2. (1// 2//) | 3 - - 0 |\nQ: 3/ 1\' 7/ (6. 5/) | (5/ 6/) (7/ 6/) 6 - | 5/ 5/ 5/ 3/ (2/ 3/) (5/ 2/) | 3 - - 0 | 6,/ 3 1/ 2 - |\n')
const lay43j = layoutScore(r43j, DUR_CFG)
const rows43j = [...new Set(lay43j.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
const segEnd43j = (n: { x: number; segments?: { x: number; beats: number; perBeat: number }[] }) => {
  const segs = n.segments ?? []
  const ls = segs[segs.length - 1]
  return ls ? ls.x + ls.beats * ls.perBeat : n.x + 6
}
const rowEnds43j = rows43j.map((ry) => {
  const ns = lay43j.pages[0].notes.filter((n) => n.y === ry)
  return Math.max(...ns.map(segEnd43j))
})
check('两行曲部末段右都贴右边界（差 ≤ 8）', rows43j.length === 2 && rowEnds43j.every((r) => 515.28 - r <= 8), `ends=${rowEnds43j.map((r) => r.toFixed(1)).join(',')}`)
// ② 连音线端点 = 音符正上方偏右/左 1px（数字槽中心 ± s，随字号），弧线在高八度点上方
const r43b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 4 ) 5 |\n')
const lay43b = layoutScore(r43b, DUR_CFG)
const s43b = lay43b.pages[0].slurs[0]
const n43b = lay43b.pages[0].notes
const slurEndOff = NS_S // 连音线端点偏音符中心 ±1px×s（adj108）
check('slur 起点 = 开始音符中心+1', s43b !== undefined && Math.abs(s43b.x1 - (n43b[1].x + halfDig + slurEndOff)) < 0.5, `x1=${s43b?.x1}`)
check('slur 终点 = 结束音符中心-1', Math.abs(s43b.x2 - (n43b[3].x + halfDig - slurEndOff)) < 0.5, `x2=${s43b.x2}`)
// adj60：数字上沿 = 基线-0.8em；无高八度 → 线底距数字上沿 LAYER_GAP×s → y（线宽 1×s 中心）
const slurBaseY = (ny: number) => ny - defaultPageConfig.note_size * 0.8 - LAYER_GAP * NS_S
check('slur 下沿距音符上沿 2px（adj60）', Math.abs(s43b.y - slurBaseY(n43b[1].y)) < 0.5, `y=${s43b.y} expect=${slurBaseY(n43b[1].y)}`)
// 开始音符有高八度：线底距最高高音点顶 2px（octaveTopY 随字号）
const r43d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2\' 3 ) 4 |\n')
const lay43d = layoutScore(r43d, DUR_CFG)
const s43d = lay43d.pages[0].slurs[0]
const n43d = lay43d.pages[0].notes[1]
check('slur 下沿距高音点 2px（adj60）', Math.abs(s43d.y - (octaveTopY(n43d.y, 1, defaultPageConfig.note_size) - LAYER_GAP * NS_S)) < 0.5, `y=${s43d.y} expect=${octaveTopY(n43d.y, 1, defaultPageConfig.note_size) - LAYER_GAP * NS_S}`)
// ③ 小节线 = 小节内容右端，不与音符重叠
const r43c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const lay43c = layoutScore(r43c, DUR_CFG)
const b43c = lay43c.pages[0].barlines[0]
const n43c = lay43c.pages[0].notes
const segEnd43 = (n43c[3].segments?.[0]?.x ?? 0) + (n43c[3].segments?.[0]?.beats ?? 0) * (n43c[3].segments?.[0]?.perBeat ?? 0)
check('小节线中心 = 内容右端 + 空间/2（adj38）', Math.abs(b43c.x - (segEnd43 + 4.75 + 4)) < 0.5, `line=${b43c.x} end=${segEnd43}`)
check('小节线与末音符数字至少 4px 间距（adj41）', b43c.x - 0.75 - (n43c[3].x + 11.16) >= 4, `lineL=${b43c.x - 0.75} noteR=${n43c[3].x + 11.16}`)
// 右侧：下小节首音符数字左缘 - 线右缘 ≥ 4（adj38）
check('小节线右侧距下小节首音符 ≥ 4px（adj41）', n43c[4].x - (b43c.x + 0.75) >= 4, `gap=${(n43c[4].x - (b43c.x + 0.75)).toFixed(1)}`)

// ---- 45. 附点显示在占位宽度正中（adj39） ----
console.log('[45] dot centered in its slot (adj39)')
const dotCxOf = (svg: string, k: number) => {
  const m = [...svg.matchAll(new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${DOT_RD_S}"`, 'g'))][k]
  return m ? Number(m[1]) : NaN
}
// 1.：附点圆心 = 主段右端（1.5 倍时值宽 2/3 处，adj288），时值占位宽仍增半（0.5×前音符宽，见 [43]）
const r45a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const lay45a = layoutScore(r45a, DUR_CFG)
const n45a = lay45a.pages[0].notes[0]
const seg45a = n45a.segments?.[0]
const dot45aExpect = seg45a
  ? seg45a.x + tokenDuration({ diminishCount: n45a.token.diminishCount, augmentCount: n45a.token.augmentCount, dots: 0 }) * seg45a.perBeat
  : n45a.x + DIGIT_W + DOT_RD_S
check('1. 附点圆心 = 主时值结束处（adj291）', Math.abs(dotCxOf(renderScoreToSvg(lay45a)[0], 0) - dot45aExpect) < 0.5, `cx=${dotCxOf(renderScoreToSvg(lay45a)[0], 0)} expect=${dot45aExpect}`)
// 双附点 1..：附点1 圆心 = 主时值结束处，附点2 紧贴附点1（间距 2×r）
const r45b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1.. 2 3 4 |\n')
const lay45b = layoutScore(r45b, DUR_CFG)
const svg45b = renderScoreToSvg(lay45b)[0]
const n45b = lay45b.pages[0].notes[0]
const seg45b = n45b.segments?.[0]
const dot45b0 = seg45b
  ? seg45b.x + tokenDuration({ diminishCount: n45b.token.diminishCount, augmentCount: n45b.token.augmentCount, dots: 0 }) * seg45b.perBeat
  : n45b.x + DIGIT_W + DOT_RD_S
const dot1 = dotCxOf(svg45b, 0)
const dot2 = dotCxOf(svg45b, 1)
check('双附点：附点1 圆心 = 主时值结束处、附点2 紧贴附点1（间距 2×r）', Math.abs(dot1 - dot45b0) < 0.5 && Math.abs(dot2 - (dot45b0 + DOT_RD_S * 2)) < 0.5, `d1=${dot1} d2=${dot2}`)
// adj291：总时值 < 1 拍的小附点音符（2/. 0.75 拍单段）——附点圆心在主时值结束处，不压下一音符 3//
const rDotX = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 2/. 3// |\n')
const layDX = layoutScore(rDotX, DUR_CFG)
const nDX0 = layDX.pages[0].notes[0]
const nDX1 = layDX.pages[0].notes[1]
const segDX = nDX0.segments?.[0]
const dotDXExpect = segDX
  ? segDX.x + tokenDuration({ diminishCount: nDX0.token.diminishCount, augmentCount: nDX0.token.augmentCount, dots: 0 }) * segDX.perBeat
  : 0
const dotDX = new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${DOT_RD_S}"`).exec(renderScoreToSvg(layDX)[0])
check('2/. 附点圆心 = 主时值结束处且圆点不压 3//', dotDX !== null && Math.abs(Number(dotDX[1]) - dotDXExpect) < 0.5 && Number(dotDX[1]) + DOT_RD_S < nDX1.x, `cx=${dotDX?.[1]} expect=${dotDXExpect} nextX=${nDX1.x}`)

// ---- 46. 歌词对齐：@ 占位 / 标点紧跟（adj40） ----
console.log('[46] lyric @ and punct (adj40)')
// @ 占位：该处留空，其后歌词后移到下一个音符
const r46a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 @ 二 三\n')
const lay46a = layoutScore(r46a, DUR_CFG)
const l46a = lay46a.pages[0].lyrics
check('@ 占位：3 个字渲染（一、二、三）', l46a.length === 3, `got ${l46a.length}`)
// adj198：自然宽每拍 14 + 拍间距——二（对 3）与一（对 1）差 2 拍（2×14 + 拍间距×2 = 36）
check('adj198 @ 后歌词后移（二 对音符 3，dx=36）', Math.abs(l46a[1].x - l46a[0].x - 36) < 1, `dx=${l46a[1].x - l46a[0].x}`)
// 标点不占音符位，紧跟前面的字渲染
const r46b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一，二。三\n')
const l46b = layoutScore(r46b, DUR_CFG).pages[0].lyrics
check('标点不占音符位置（3 个歌词字）', l46b.length === 3 && l46b[1].char.text === '二' && l46b[1].char.trailing === '。', `got ${l46b.length}`)
const svg46b = renderScoreToSvg(layoutScore(r46b, DUR_CFG))[0]
check('标点独立渲染在本字之后（一 与 ，相邻，adj40）', svg46b.includes('>一<') && svg46b.includes('>，<') && svg46b.includes('>二<') && svg46b.includes('>。<'), '')
// adj292：歌词宽度不足时压缩字宽开关——默认不压缩（允许重叠），选中才横向缩窄
const r92 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ | 1/ 2/ 3/ 4/ |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四 十 五 十 六 十 七 十 八 十 九 二 十 二 十 一 二 十 二\n',
)
const svg92a = renderScoreToSvg(layoutScore(r92, DUR_CFG))[0]
const svg92b = renderScoreToSvg(layoutScore(r92, { ...DUR_CFG, lyricShrink: true, geci_size: 16 }))[0]
check('adj292 默认不压缩歌词（无横向 scale）', !svg92a.includes('scale('), '')
check('adj292 开启压缩后歌词横向缩窄（出现 scale）', svg92b.includes('scale('), '')

// ---- 44. 独立增时线归入最近音符（adj37） ----
console.log('[44] dangling augment (adj37)')
// "1) -" 的 "-" 归入前面音符 1（跳过连音线括号），不跨小节线
const r44a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | ( 1 - | 1 ) - |\n')
const tk44a = r44a.groups[0].music.tokens
const n44a = tk44a.find((t) => t.kind === 'note' && t.pitch === 1 && t.pos > 3)
check('1) - 的 - 归入音符（augmentCount=1，无错误）', r44a.errors.length === 0 && n44a?.kind === 'note' && n44a.augmentCount === 1, JSON.stringify(r44a.errors) + ' aug=' + (n44a?.kind === 'note' ? n44a.augmentCount : '?'))
// 两种写法预览一致：跨小节连音线中增时线位置不同但时值相同
const r44b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | ( 1 - | 1 - ) |\n')
const durs44a = r44a.groups[0].music.tokens.filter((t) => t.kind === 'note').map((t) => tokenDuration(t))
const durs44b = r44b.groups[0].music.tokens.filter((t) => t.kind === 'note').map((t) => tokenDuration(t))
check('两种写法音符时值一致（1- = 2 拍）', durs44a.join(',') === '2,2' && durs44b.join(',') === '2,2', `${durs44a} vs ${durs44b}`)

// ---- 47. 撤销/重做历史（editor/history.ts） ----
console.log('[47] undo/redo history (editor/history.ts)')
// 合并策略：时间窗内连续输入 → 并入上一步
{
  const h0 = createHistoryState()
  const r1 = recordEdit(h0, { code: '', selStart: 0, selEnd: 0 }, 1000)
  check('首步入栈（不合并）', !r1.merged && r1.next.undoStack.length === 1)
  const r2 = recordEdit(r1.next, { code: 'A', selStart: 1, selEnd: 1 }, 1100)
  check('窗口内连续输入合并为一步', r2.merged && r2.next.undoStack.length === 1)
  const r3 = recordEdit(r2.next, { code: 'AB', selStart: 2, selEnd: 2 }, 1100 + HISTORY_MERGE_MS + 1)
  check('超出时间窗新开一步', !r3.merged && r3.next.undoStack.length === 2)
}
// 撤销 / 重做 / 新编辑清空 redo / 空栈
{
  const h0 = createHistoryState()
  let hs: HistoryState = h0
  hs = recordEdit(hs, { code: '', selStart: 0, selEnd: 0 }, 1000).next
  hs = recordEdit(hs, { code: 'A', selStart: 1, selEnd: 1 }, 1000 + HISTORY_MERGE_MS + 1).next
  const u1 = undoHistory(hs, { code: 'AB', selStart: 2, selEnd: 2 })
  check('undo 恢复到上一步', u1.restored?.code === 'A' && u1.restored?.selStart === 1)
  check('undo 后当前状态进入 redo 栈', u1.next.redoStack.length === 1 && u1.next.redoStack[0].code === 'AB')
  check('undo 后 undo 栈 -1', u1.next.undoStack.length === 1)
  const r1 = redoHistory(u1.next, { code: 'A', selStart: 1, selEnd: 1 })
  check('redo 恢复到下一步', r1.restored?.code === 'AB' && r1.restored?.selStart === 2)
  check('redo 后状态回到 undo 栈', r1.next.undoStack.length === 2 && r1.next.redoStack.length === 0)
  const rn = recordEdit(u1.next, { code: 'AX', selStart: 2, selEnd: 2 }, 99999)
  check('新编辑清空 redo 栈', rn.next.redoStack.length === 0)
  check('空栈 undo 无操作', undoHistory(createHistoryState(), { code: 'A', selStart: 0, selEnd: 0 }).restored === null)
  check('空栈 redo 无操作', redoHistory(createHistoryState(), { code: 'A', selStart: 0, selEnd: 0 }).restored === null)
}
// 历史上限（默认 50）
{
  let hs = createHistoryState()
  for (let i = 0; i < 60; i++) {
    hs = recordEdit(hs, { code: `v${i}`, selStart: 0, selEnd: 0 }, 1000 + i * (HISTORY_MERGE_MS + 1)).next
  }
  check('60 次编辑只保留最近 50 步', hs.undoStack.length === DEFAULT_HISTORY_LIMIT, `got ${hs.undoStack.length}`)
  check('最旧条目被丢弃（最早保留 v10）', hs.undoStack[0].code === 'v10', hs.undoStack[0]?.code)
  check('栈顶为最新状态 v59', hs.undoStack[hs.undoStack.length - 1].code === 'v59')
}

// ---- 48. J 多条数字+文字 / 拍号分数渲染 ----
console.log('[48] tempo multi-J & meter fraction')
// splitTempo 拆解
check('splitTempo 纯数字', splitTempo('80').num === '80' && splitTempo('80').text === undefined)
check('splitTempo 纯文字', splitTempo('欢快地').text === '欢快地' && splitTempo('欢快地').num === undefined)
const spMix = splitTempo('90 欢快地')
check('splitTempo 数字+文字（空格分隔）', spMix.num === '90' && spMix.text === '欢快地', JSON.stringify(spMix))
check('splitTempo 无空格区间保持文字（120-140）', splitTempo('120-140').text === '120-140' && splitTempo('120-140').num === undefined)
// 多条 J：数字 + 文字并存
const rJ = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 80\nJ: 欢快地\nQ: 1 2 3 4 |\n')
check('多条 J：数字/文字分存', rJ.header.tempoNum === '80' && rJ.header.tempoText === '欢快地', `num=${rJ.header.tempoNum} text=${rJ.header.tempoText}`)
check('多条 J：原始 tempo 保持最后一条', rJ.header.tempo === '欢快地')
check('多条 J：inferBpm 取数字', inferBpm(rJ) === 80)
const svgJ = renderScoreToSvg(layoutScore(rJ, DUR_CFG))[0]
const tempoElJ = /data-meta="tempo"[^>]*>([^<]*)</.exec(svgJ)
check('渲染为 ♩= 80 欢快地', tempoElJ !== null && tempoElJ[1] === '♩= 80 欢快地', tempoElJ?.[1])
// 纯数字 J：照原方式 ♩=N
const rJ2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1 2 3 4 |\n')
const svgJ2 = renderScoreToSvg(layoutScore(rJ2, DUR_CFG))[0]
const tempoElJ2 = /data-meta="tempo"[^>]*>([^<]*)</.exec(svgJ2)
check('纯数字 J 渲染 ♩= 96（无文字后缀）', tempoElJ2 !== null && tempoElJ2[1] === '♩= 96', tempoElJ2?.[1])
// 拍号分数：数字上下正对、中间横线
const svgM48 = svgJ2 // P: 4/4
const meterG = /<g data-meta="meter" data-meter="([^"]*)">([\s\S]*?)<\/g>/.exec(svgM48)
check('拍号分数组存在（data-meter 保留原文）', meterG !== null && meterG[1] === '4/4', meterG?.[0])
check('拍号分数：分子在上、分母在下、中间横线', meterG !== null && />4<[\s\S]*?<line[\s\S]*?>4</.test(meterG[2]), meterG?.[2])
check('调号文本独立为 1 = C（keyline 元素）', svgM48.includes('data-meta="keyline"') && svgM48.includes('1 = C'))
// adj174：调号升降号——前置（#F/$B）与后置（F#/B$）两种写法等价，预览时 ♯/♭ 作角标画在字母左上角
const rK174a = parseJps('V: 1.0\nB: t\nD: #F\nP: 4/4\nQ: 1 2 3 4 |\n')
const rK174b = parseJps('V: 1.0\nB: t\nD: F#\nP: 4/4\nQ: 1 2 3 4 |\n')
check('adj174 升降号前置/后置半音偏移一致（#F = F#）', parseKey(rK174a.header.key) === parseKey(rK174b.header.key) && parseKey(rK174b.header.key) === 6, `${parseKey(rK174a.header.key)} vs ${parseKey(rK174b.header.key)}`)
const svgK174a = renderScoreToSvg(layoutScore(rK174a, DUR_CFG))[0]
const svgK174b = renderScoreToSvg(layoutScore(rK174b, DUR_CFG))[0]
check('adj174 前置 #F 渲染为 1 = F + ♯ 角标', svgK174a.includes('1 = F') && svgK174a.includes('♯'), '')
check('adj174 后置 F# 渲染为 1 = F + ♯ 角标（等价）', svgK174b.includes('1 = F') && svgK174b.includes('♯'), '')
const rK174c = parseJps('V: 1.0\nB: t\nD: B$\nP: 4/4\nQ: 1 2 3 4 |\n')
const svgK174c = renderScoreToSvg(layoutScore(rK174c, DUR_CFG))[0]
check('adj174 降号 $ 渲染 ♭ 角标且字母为 B', svgK174c.includes('1 = B') && svgK174c.includes('♭') && !svgK174c.includes('$B'), '')
// adj175：b 作为降号与 $ 等价；bE 与 Eb 等价；升降号在字母左侧、中线以上、字号为调号一半
const rK175a = parseJps('V: 1.0\nB: t\nD: bE\nP: 4/4\nQ: 1 2 3 4 |\n')
const rK175b = parseJps('V: 1.0\nB: t\nD: Eb\nP: 4/4\nQ: 1 2 3 4 |\n')
const rK175c = parseJps('V: 1.0\nB: t\nD: $E\nP: 4/4\nQ: 1 2 3 4 |\n')
check('adj175 bE / Eb / $E 半音偏移一致（降 E）', parseKey(rK175a.header.key) === parseKey(rK175b.header.key) && parseKey(rK175b.header.key) === parseKey(rK175c.header.key) && parseKey(rK175b.header.key) === 3, `${parseKey(rK175a.header.key)},${parseKey(rK175b.header.key)},${parseKey(rK175c.header.key)}`)
const svgK175 = renderScoreToSvg(layoutScore(rK175a, DUR_CFG))[0]
check('adj175 bE 渲染为 1 = E + ♭ 角标', svgK175.includes('1 = E') && svgK175.includes('♭'), '')
// 角标位置：在字母左侧（x < 字母左缘）、y 更高、字号 = 调号一半（13/2 = 6.5）
const k175Acc = /<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>♭<\/text>/.exec(svgK175)
const k175Letter = /data-meta="keyline" x="([\d.]+)" y="([\d.]+)"/.exec(svgK175)
const k175PrefixW = (7.62 + 3.85 + 9.64 + 3.85) * (defaultPageConfig.miaoshu_size / 13)
const k175LetterLeft = Number(k175Letter?.[1] ?? NaN) + k175PrefixW
check('adj189 ♭ 角标在字母左侧、更高、字号 = 0.6×13 = 7.8', k175Acc !== null && k175Letter !== null && Number(k175Acc[1]) < k175LetterLeft && Number(k175Acc[2]) < Number(k175Letter[2]) && Math.abs(Number(k175Acc[3]) - 7.8) < 0.1, JSON.stringify([k175Acc?.[1], k175Acc?.[2], k175Acc?.[3], k175LetterLeft]))
// adj179：角标下移一个升降符高度——y = 字母基线 - 0.4×字号（原 0.9×字号）
check('adj179 角标 y = 基线 - 0.4×字号（下移一个升降符高度）', k175Acc !== null && k175Letter !== null && Math.abs(Number(k175Acc[2]) - (Number(k175Letter[2]) - 0.4 * defaultPageConfig.miaoshu_size)) < 0.5, JSON.stringify([k175Acc?.[2], k175Letter?.[2]]))
// adj178：孤立 &（输入中未完成）为 warning 而非 error——预览不阻断
const r178 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 &\n')
check('adj178 孤立 & 降为 warning（不阻断预览）', r178.errors.some((e) => e.message.includes('&') && e.severity === 'warning') && !r178.errors.some((e) => e.severity === 'error'), JSON.stringify(r178.errors))
// adj190：有升降号时调号文本额外右移（0.7×13 + 1×scale = 10.1px），升降号与字母间距 4×scale
const k181Letter = /data-meta="keyline" x="([\d.]+)" y="([\d.]+)"/.exec(svgK175) // bE 谱
const k181Acc = /<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>♭<\/text>/.exec(svgK175)
const k181Plain = /data-meta="keyline" x="([\d.]+)"/.exec(svgM48) // 无升降号 D: C
check('adj190 有升降号时 keyline 右移 10.1px（相对无升降号）', k181Letter !== null && k181Plain !== null && Math.abs(Number(k181Letter[1]) - (Number(k181Plain[1]) + 0.7 * defaultPageConfig.miaoshu_size + 1)) < 0.5, `acc=${k181Letter?.[1]} plain=${k181Plain?.[1]}`)
const k181Scale = defaultPageConfig.miaoshu_size / 13
// "1 = " 含尾随空格：1=7.62 空格=3.85 =9.64 空格=3.85 → 24.96
const k181PrefixW = (7.62 + 3.85 + 9.64 + 3.85) * k181Scale
const k181LetterLeft = Number(k181Letter?.[1] ?? NaN) + k181PrefixW
check('adj191 升降号与字母间距 = 5×scale（随字号缩放）', k181Acc !== null && Math.abs(Number(k181Acc[1]) - (k181LetterLeft - 5 * k181Scale)) < 0.5, JSON.stringify([k181Acc?.[1], k181LetterLeft - 5 * k181Scale]))
// 角标位置在字母左上方（adj175：x 在字母左侧、y < 字母基线、字号为调号一半）
const k174Acc = /<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>♯<\/text>/.exec(svgK174a)
const k174Letter = /data-meta="keyline" x="([\d.]+)" y="([\d.]+)"/.exec(svgK174a)
// 13px 基准 "1 = " 估算宽：1=7.62 空格=3.85 =9.64 尾随空格=3.85 → 24.96
const k174PrefixW = (7.62 + 3.85 + 9.64 + 3.85) * (defaultPageConfig.miaoshu_size / 13)
const k174LetterLeft = Number(k174Letter?.[1] ?? NaN) + k174PrefixW // 字母 F 左缘
check('adj189 ♯ 角标在字母左侧、更高、字号 = 0.6×13 = 7.8', k174Acc !== null && k174Letter !== null && Number(k174Acc[1]) < k174LetterLeft && Number(k174Acc[2]) < Number(k174Letter[2]) && Math.abs(Number(k174Acc[3]) - 7.8) < 0.1, JSON.stringify([k174Acc?.[1], k174Acc?.[2], k174Acc?.[3], k174LetterLeft]))
// 辅助拍号（括号内小一号）
const rM2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4 (2/4)\nJ: 96\nQ: 1 2 3 4 |\n')
const svgM48b = renderScoreToSvg(layoutScore(rM2, DUR_CFG))[0]
const meterG2 = /<g data-meta="meter" data-meter="([^"]*)">([\s\S]*?)<\/g>/.exec(svgM48b)
check('辅助拍号带括号渲染', meterG2 !== null && meterG2[1] === '4/4 (2/4)' && meterG2[2].includes('(') && meterG2[2].includes(')'), meterG2?.[2])
// 无调号：拍号分数仍渲染在左缘
const svgM48c = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nP: 3/4\nJ: 96\nQ: 1 2 3 |\n'), DUR_CFG))[0]
check('无调号时拍号分数仍渲染', svgM48c.includes('data-meta="meter"'))

// ---- 49. 拍号分数几何 / 无空格歌词对齐 ----
console.log('[49] meter geometry & no-space lyric alignment')
// 拍号分数：横线 = 调式文字垂直中心（基线 - 0.35×13），分子/分母距线各 2px
const r49 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1 2 3 4 |\n')
const svg49 = renderScoreToSvg(layoutScore(r49, DUR_CFG))[0]
const keyY49 = Number(/data-meta="keyline"[^>]*y="([\d.]+)"/.exec(svg49)?.[1] ?? NaN)
const m49 = /<g data-meta="meter"[^>]*>([\s\S]*?)<\/g>/.exec(svg49)?.[1] ?? ''
const txt49 = [...m49.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(\d+)<\/text>/g)].map((x) => ({ x: +x[1], y: +x[2], d: x[3] }))
const lineY49 = Number(/<line[^>]*y1="([\d.]+)"/.exec(m49)?.[1] ?? NaN)
check('拍号分数：横线与调式文字垂直居中', Number.isFinite(lineY49) && Math.abs(lineY49 - (keyY49 - 13 * 0.35)) < 0.5, `line=${lineY49} key=${keyY49}`)
check('拍号分数：分子在线上、分母在线下', txt49.length === 2 && txt49[0].y < lineY49 && txt49[1].y > lineY49, JSON.stringify(txt49))
check('拍号分数：分子底部距线 2px', txt49.length === 2 && Math.abs(txt49[0].y + 13 * 0.05 + 2 - lineY49) < 0.5, `numY=${txt49[0]?.y} line=${lineY49}`)
check('拍号分数：分母顶部距线 2px', txt49.length === 2 && Math.abs(txt49[1].y - 13 * 0.85 - lineY49 - 2) < 0.5, `denY=${txt49[1]?.y} line=${lineY49}`)
// 节拍行下移：D 行与 J 行间距加大（默认偏移 -20 → -12）
const tempoY49 = Number(/data-meta="tempo"[^>]*y="([\d.]+)"/.exec(svg49)?.[1] ?? NaN)
check('D↔J 基线间距 32px（-44 → -12）', Math.abs(tempoY49 - keyY49 - 32) < 0.5, `tempo=${tempoY49} key=${keyY49}`)
// adj45：描述头字体/字号可配置（miaoshu_font/miaoshu_size 作用于调式/拍号/节拍/作者）
const r45 = parseJps('V: 1.0\nB: t\nZ: 词曲作者\nD: C\nP: 4/4\nJ: 96\nQ: 1 2 3 4 |\n')
const svg45 = renderScoreToSvg(layoutScore(r45, { ...DUR_CFG, miaoshu_font: 'SimSun', miaoshu_size: 15 }))[0]
check('描述头字号生效（keyline font-size=15）', svg45.includes('data-meta="keyline"') && svg45.includes('font-size="15" font-family="SimSun"'))
check('描述头字号生效（tempo font-size=15）', svg45.includes('data-meta="tempo"') && svg45.includes('font-size="15" font-family="SimSun"'))
check('描述头字号生效（作者 font-size=14）', svg45.includes('data-meta="author_0"') && svg45.includes('font-size="14" font-family="SimSun"'))
const m45 = /<g data-meta="meter"[^>]*>([\s\S]*?)<\/g>/.exec(svg45)?.[1] ?? ''
check('拍号分数字号随描述头（15px）', m45.includes('font-size="15" font-family="SimSun"'), m45.slice(0, 120))
// 无空格歌词：每汉字独立音节，逐字对中音符、不重叠
const rLy49 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6, (3/ 2/) 3 6 | 3 (1/ 3/) 2 - | 2 6, 1. 2/ | 3 (3/ 5/) 3 - |\nC: 门前@老树长新@芽，院里枯木又开@花\n')
const chars49 = rLy49.groups[0]?.lyrics[0]?.chars ?? []
check('无空格歌词：18 字符（含 3 个 @ 占位 + 14 字）', rLy49.errors.length === 0 && chars49.length === 17, `chars=${chars49.length} errors=${rLy49.errors.length}`)
const layLy49 = layoutScore(rLy49, DUR_CFG)
const ly49 = layLy49.pages[0].lyrics
const notes49 = layLy49.pages[0].notes
check('无空格歌词：14 字各占一个音符位（@ 不占）', ly49.length === 14, `got ${ly49.length}`)
let alignOk49 = true
let alignDetail49 = ''
for (const ly of ly49) {
  const lx = ly.x + defaultPageConfig.geci_size / 2
  const n = notes49[ly.id.index]
  if (!n || Math.abs(lx - (n.x + halfDig)) > 1) {
    alignOk49 = false
    alignDetail49 = `id=${ly.id.index} lx=${lx} nx=${n?.x}`
    break
  }
}
check('无空格歌词：逐字中心对中音符', alignOk49, alignDetail49)
const xs49 = ly49.map((l) => l.x).sort((a, b) => a - b)
let gapOk49 = true
for (let i = 1; i < xs49.length; i++) {
  if (xs49[i] - xs49[i - 1] < defaultPageConfig.geci_size * 0.5) gapOk49 = false
}
check('无空格歌词：字与字不重叠', gapOk49, xs49.join(','))

// ---- 50. 分页描述头 / 跨行连音符 ----
console.log('[50] page meta & cross-row slurs')
// ① 仅第一页显示描述头
const r50 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\n' +
    Array.from({ length: 14 }, () => 'Q: 1 2 3 4 | 5 6 7 1 |').join('\n') +
    '\n',
)
const lay50 = layoutScore(r50, { ...DUR_CFG, margin_bottom: 300 })
check('长谱分 2 页', lay50.pages.length >= 2, `got ${lay50.pages.length}`)
const svg50 = renderScoreToSvg(lay50)
check('第 1 页显示描述头', svg50[0].includes('data-meta="title"') && svg50[0].includes('data-meta="tempo"'))
check('第 2 页不显示描述头', !svg50[1].includes('data-meta="title"') && !svg50[1].includes('data-meta="keyline"') && !svg50[1].includes('data-meta="meter"') && !svg50[1].includes('data-meta="tempo"'))
check('第 2 页仍有音符内容', svg50[1].includes('data-notepos'))
// ③ 页号渲染进 SVG（导出可见，adj42）：每页含 "第 X / N 页"，位于下边距线与页面边沿之间垂直居中
const pn50 = lay50.pages.length
check('页号写入 SVG（导出含页号）', svg50[0].includes(`第 1 / ${pn50} 页`) && svg50[1].includes(`第 2 / ${pn50} 页`), `pages=${pn50}`)
const pnY50 = Number(/data-pagenum="1"[^>]*y="([\d.]+)"/.exec(svg50[0])?.[1] ?? NaN)
const pnC50 = lay50.pages[0].height - 300 / 2 + 11 * 0.35 // 下边距线(高-300)与页边沿(高)中点 + 基线半高
check('页号垂直居中于下边距与页边沿之间', Number.isFinite(pnY50) && Math.abs(pnY50 - pnC50) < 0.6, `y=${pnY50} expect=${pnC50}`)
const pnX50 = Number(/data-pagenum="1"[^>]*x="([\d.]+)"/.exec(svg50[0])?.[1] ?? NaN)
check('页号水平居中', Number.isFinite(pnX50) && Math.abs(pnX50 - lay50.pages[0].width / 2) < 0.5, `x=${pnX50}`)
check('单页谱不画页号', !renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'), DUR_CFG))[0].includes('data-pagenum'))
// ② 跨行连音符：上一行左半部（开始→行末）+ 下一行右半部（行首→结束）
const r50b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 ( 3 4 | 5 6 1 2 |\nQ: 3 4 ) 5 6 | 7 1 2 3 |\n')
const lay50b = layoutScore(r50b, DUR_CFG)
const notes50b = lay50b.pages[0].notes
check('跨行连音符：左右两半共 2 条', lay50b.pages[0].slurs.length === 2, `got ${lay50b.pages[0].slurs.length}`)
const slL = lay50b.pages[0].slurs[0]
const slR = lay50b.pages[0].slurs[1]
check('左半：起点 = 开始音符中心+1', Math.abs(slL.x1 - (notes50b[2].x + halfDig + NS_S)) < 0.5, `x1=${slL.x1}`)
// 需求：左半终点延伸到行末小节线
const rowA50b = lay50b.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (notes50b[0].y - BAR_TOP)) < 1)
  .sort((a, b) => a.x - b.x)
const rowAEndBarX = rowA50b[rowA50b.length - 1]?.x ?? 0
// adj198：行自然宽（2 小节 ≤3）不撑满——左半终点 = 行末小节线（243.7），不延伸到页面右边距
check('adj198 左半：终点 = 行末小节线（自然宽）', Math.abs(slL.x2 - rowAEndBarX) < 1, `x2=${slL.x2} bar=${rowAEndBarX}`)
check('右半：起点 = 行首边距处', Math.abs(slR.x1 - ML) < 0.5, `x1=${slR.x1}`)
check('右半：终点 = 结束音符中心-1', Math.abs(slR.x2 - (notes50b[9].x + halfDig - NS_S)) < 0.5, `x2=${slR.x2}`)
check('左右两半在不同行（y 不同）', Math.abs(slL.y - slR.y) > 1, `${slL.y} vs ${slR.y}`)
// ④ 误输入：有 ( 无 ) → 不渲染
const r50c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 ( 3 4 |\nQ: 5 6 7 1 |\n')
check('误输入 ( 无结束：不渲染连音符', layoutScore(r50c, DUR_CFG).pages[0].slurs.length === 0)
// ⑤ 结束在相隔两行之后（非下一行）→ 视为误输入，不渲染
const r50d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 |\nQ: 4 5 6 |\nQ: 7 ) 8 9 |\n')
check('相隔两行的括号视为误输入：不渲染', layoutScore(r50d, DUR_CFG).pages[0].slurs.length === 0)
// ⑥ 同一 Q 行断成两可视行时同样适用（( 首行、) 次行）
const r50e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 | 2 3 ( 4 5 | 6 7 1 2 | 3 4 5 6 | 7 1 2 3 | 4 5 6 7 | 1 2 ) 3 4 | 5 6 7 1 | 2 3 4 5 |\n')
const lay50e = layoutScore(r50e, DUR_CFG)
const rows50e = new Set(lay50e.pages.flatMap((p) => p.notes.map((n) => n.y))).size
check('断行跨行：按相邻行渲染两半', lay50e.pages.flatMap((p) => p.slurs).length === 2, `got ${lay50e.pages.flatMap((p) => p.slurs).length} rows=${rows50e}`)

// ---- 51. 连音符 LIFO + 连接点跨行配对（adj55/adj321） ----
console.log('[51] slur LIFO + junction pairing (adj55/adj321)')
// 用户示例（带空格）：1 ( 2 3 ( 4 ) | / 1 ) 2 3 4
// adj321 连接点规则：内层 (4) 为单音符连接点 → 终止外层 open1(2→4) + 从 4 起新连音(4→行2 1 跨行两半)
// → 共 3 条：idx1→idx3（行1 2→4）+ idx3→行2 idx4（4→1，跨行两半）
const r51 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ( 4 ) |\nQ: 1 ) 2 3 4\n')
const lay51 = layoutScore(r51, DUR_CFG)
check('LIFO+连接点：2→4 一条 + 4→行2（跨行两半）共 3 条', lay51.pages[0].slurs.length === 3, `got ${lay51.pages[0].slurs.length}`)
const n51 = lay51.pages[0].notes
const s51 = lay51.pages[0].slurs
const rowEnd51 = lay51.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (n51[0].y - BAR_TOP)) < 1)
  .sort((a, b) => a.x - b.x)
// slur0 = 外层 open1 被连接点(4)终止：2(→ 4 (idx1→idx3)
check('adj321 连接点终止外层于 4（idx1→idx3）', Math.abs(s51[0].x1 - (n51[1].x + halfDig + NS_S)) < 0.5 && Math.abs(s51[0].x2 - (n51[3].x + halfDig - NS_S)) < 0.5, `x1=${s51[0].x1} x2=${s51[0].x2}`)
// slur1+slur2 = 从 4 起新连音跨行两半：行1 半到行末小节线 + 行2 半从边距到行2 1
check('adj321 新连音行1 半（4→行末小节线）', Math.abs(s51[1].x1 - (n51[3].x + halfDig + NS_S)) < 0.5 && Math.abs(s51[1].x2 - (rowEnd51[rowEnd51.length - 1]?.x ?? 0)) < 1, `x1=${s51[1].x1} x2=${s51[1].x2} bar=${rowEnd51[rowEnd51.length - 1]?.x}`)
check('adj321 新连音行2 半（边距 → 行2 1）', Math.abs(s51[2].x1 - ML) < 0.5 && Math.abs(s51[2].x2 - (n51[4].x + halfDig - NS_S)) < 0.5, `x1=${s51[2].x1} x2=${s51[2].x2}`)
check('连接点终止外层与新连音分隔（y 不同跨行）', Math.abs(s51[0].y - s51[2].y) > 1, `${s51[0].y} vs ${s51[2].y}`)
check('连接点深度均 0（外层终止 + 新连音顶层）', s51.every((s) => s.depth === 0), JSON.stringify(s51.map((s) => s.depth)))
// 无空格紧凑写法与带空格等价
const r51b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1(23(4)|\nQ: 1)234\n')
const lay51b = layoutScore(r51b, DUR_CFG)
check('无空格紧凑写法：与带空格同（3 条）', r51b.errors.length === 0 && lay51b.pages[0].slurs.length === 3, `errors=${r51b.errors.length} slurs=${lay51b.pages[0].slurs.length}`)

// ---- 52. 小节线类型渲染 ----
console.log('[52] barline styles')
const mk52 = (q: string) =>
  layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), DUR_CFG)
const svg52 = (lay: ReturnType<typeof mk52>) => renderScoreToSvg(lay)[0]
const barlineRects = (svg: string, cx: number, r: number) =>
  [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="(0\.9|1\.4)" height="16\.[0-9]"/g)]
    .map((m) => ({ x: +m[1], w: m[2] }))
    .filter((o) => Math.abs(o.x - cx) < r)
const barlineDots = (svg: string, cx: number, r: number) =>
  [...svg.matchAll(new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${R1(BARLINE_DOT_R * NS_S)}"`, 'g'))]
    .map((m) => +m[1])
    .filter((c) => Math.abs(c - cx) < r)
// ① || 双小节线：左细线右粗线（细 0.9、粗 1.4，adj104），间距 1.2px（线左缘不动、宽缩）
const lay52a = mk52('1 2 3 4 || 5 6 7 1 |')
const b52a = lay52a.pages[0].barlines.find((b) => b.type === '||')
const rr52a = b52a ? barlineRects(svg52(lay52a), b52a.x, 6) : []
check('|| 左细右粗（细 0.9、粗 1.4）', rr52a.length === 2 && rr52a[0].w === '0.9' && rr52a[1].w === '1.4', JSON.stringify(rr52a))
check('|| 线间距 1.2px（adj104）', rr52a.length === 2 && Math.abs(rr52a[1].x - (rr52a[0].x + 0.9) - 1.2) < 0.5, JSON.stringify(rr52a))
// ② ||/ 双细线，间距 1.2px（adj55/104）
const lay52b = mk52('1 2 3 4 ||/ 5 6 7 1 |')
const b52b = lay52b.pages[0].barlines.find((b) => b.type === '||/')
const rr52b = b52b ? barlineRects(svg52(lay52b), b52b.x, 5) : []
check('||/ 双细线（2 条 0.9）', rr52b.length === 2 && rr52b[0].w === '0.9' && rr52b[1].w === '0.9', JSON.stringify(rr52b))
check('||/ 线间距 1.2px（adj104）', rr52b.length === 2 && Math.abs(rr52b[1].x - (rr52b[0].x + 0.9) - 1.2) < 0.5, JSON.stringify(rr52b))
// ③ |: 左粗线、中细线、右 :，线距 1.4px、点线距 1.2px（adj55/104）
const lay52c = mk52('1 2 3 4 |: 5 6 7 1 |')
const b52c = lay52c.pages[0].barlines.find((b) => b.type === '|:')
const rr52c = b52c ? barlineRects(svg52(lay52c), b52c.x, 8) : []
const dd52c = b52c ? barlineDots(svg52(lay52c), b52c.x, 8) : []
check('|: 粗线在左、细线在右', rr52c.length === 2 && rr52c[0].w === '1.4' && rr52c[1].w === '0.9', JSON.stringify(rr52c))
const dotGap52c = Math.min(...dd52c) - 1.2 - (rr52c[1].x + 0.9) // 点左缘 - 细线右缘
check('|: 点在细线右侧（间距 1.2px，adj104）', dd52c.length === 2 && Math.abs(dotGap52c - 1.2) < 0.5, `gap=${dotGap52c} dots=${dd52c} thin=${rr52c[1]?.x}`)
// ④ :| 左 :、中细线、右粗线，间距 2px
const lay52d = mk52('1 2 3 4 :| 5 6 7 1 |')
const b52d = lay52d.pages[0].barlines.find((b) => b.type === ':|')
const rr52d = b52d ? barlineRects(svg52(lay52d), b52d.x, 8) : []
const dd52d = b52d ? barlineDots(svg52(lay52d), b52d.x, 8) : []
check(':| 细线在左、粗线在右', rr52d.length === 2 && rr52d[0].w === '0.9' && rr52d[1].w === '1.4', JSON.stringify(rr52d))
check(':| 点在细线左侧', dd52d.length === 2 && Math.max(...dd52d) < rr52d[0].x, `dots=${dd52d}`)
// ⑤ :|: 两边反复：: 细线 粗线 细线 :
const lay52e = mk52('1 2 3 4 :|: 5 6 7 1 |')
const b52e = lay52e.pages[0].barlines.find((b) => b.type === ':|:')
const rr52e = b52e ? barlineRects(svg52(lay52e), b52e.x, 10) : []
const dd52e = b52e ? barlineDots(svg52(lay52e), b52e.x, 10) : []
check(':|: 细-粗-细 3 线', rr52e.length === 3 && rr52e[0].w === '0.9' && rr52e[1].w === '1.4' && rr52e[2].w === '0.9', JSON.stringify(rr52e))
check(':|: 左右各 2 点', dd52e.length === 4 && Math.min(...dd52e) < rr52e[0].x && Math.max(...dd52e) > rr52e[2].x + 0.9, `dots=${dd52e}`)
// ⑥ |/ 不显示、不占位；|* 不显示、占位
const lay52f = mk52('1 2 3 4 |/ 5 6 7 1 |')
const lay52g = mk52('1 2 3 4 |* 5 6 7 1 |')
const lay52h = mk52('1 2 3 4 | 5 6 7 1 |')
const rectCount52 = (s: string) => (s.match(/width="(?:0\.9|1\.4)" height="16\.[0-9]"/g) ?? []).length
check('|/ 不渲染线（rect 数比 | 版本少 1）', rectCount52(svg52(lay52f)) === rectCount52(svg52(lay52h)) - 1, `${rectCount52(svg52(lay52f))} vs ${rectCount52(svg52(lay52h))}`)
const gap52f = lay52f.pages[0].notes[4].x - (lay52f.pages[0].notes[3].x + 11.16)
const gap52h = lay52h.pages[0].notes[4].x - (lay52h.pages[0].notes[3].x + 11.16)
check('|/ 不占位（小节间音符间隙比 | 小约 9.5px）', Math.abs(gap52h - gap52f - 9.5) < 2, `|/=${gap52f.toFixed(1)} |=${gap52h.toFixed(1)}`)
check('|* 占位（与 | 布局一致）', Math.abs(lay52g.pages[0].notes[4].x - lay52h.pages[0].notes[4].x) < 0.5, `${lay52g.pages[0].notes[4].x} vs ${lay52h.pages[0].notes[4].x}`)
check('|* 不渲染线（rect 数比 | 版本少 1）', rectCount52(svg52(lay52g)) === rectCount52(svg52(lay52h)) - 1, `${rectCount52(svg52(lay52g))} vs ${rectCount52(svg52(lay52h))}`)

// ---- 53. 连音符：紧贴括号 + 跨行 + 连接点（adj321） ----
console.log('[53] slur tight parens & cross-row & junction (adj321)')
// Q: 1 (2 3 (4) |  /  Q: 1) 2 3 4 |
// adj321 连接点：内层 (4) 为单音符连接点 → 外层 open1 终止于 4（2→4）+ 从 4 起新连音（4→行2 1 跨行两半）
const r53 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 (2 3 (4) |\nQ: 1) 2 3 4 |\n')
const lay53 = layoutScore(r53, DUR_CFG)
check('无解析错误（空格可选、紧贴括号合法）', r53.errors.length === 0, JSON.stringify(r53.errors))
const n53 = lay53.pages[0].notes
const s53 = lay53.pages[0].slurs
check('连接点：2→4（一条）+ 4→行2（跨行两半）共 3 条', s53.length === 3, `got ${s53.length}`)
const rowEnd53 = lay53.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (n53[0].y - BAR_TOP)) < 1)
  .sort((a, b) => a.x - b.x)
// 跨行两半（4→行2 1）：左半 4→行末小节线、右半 行首→行2 1
const s53l = s53.find((s) => s.half === 'l')
const s53r = s53.find((s) => s.half === 'r')
check('adj199 跨行左半（4→行末小节线）', s53l !== undefined && Math.abs(s53l.x1 - (n53[3].x + halfDig + NS_S)) < 0.5 && Math.abs(s53l.x2 - (rowEnd53[rowEnd53.length - 1]?.x ?? 0)) < 1, `x1=${s53l?.x1} x2=${s53l?.x2} bar=${rowEnd53[rowEnd53.length - 1]?.x}`)
check('adj321 跨行右半（边距 → 行2 1）', s53r !== undefined && Math.abs(s53r.x1 - ML) < 0.5 && Math.abs(s53r.x2 - (n53[4].x + halfDig - NS_S)) < 0.5, `x1=${s53r?.x1} x2=${s53r?.x2}`)
check('跨行两半 y 不同（跨行）', s53l !== undefined && s53r !== undefined && Math.abs(s53l.y - s53r.y) > 1, `${s53l?.y} vs ${s53r?.y}`)
// adj140：跨行连音线统一平顶
check('adj140 跨行连音符平顶', s53l?.style === 'flat' && s53r?.style === 'flat', `${s53l?.style}/${s53r?.style}`)
const svg53 = renderScoreToSvg(lay53)[0]
const hlY = s53l!.y
const hrY = s53r!.y
// 平顶半部：左半从音符弧线升到平顶线、横线延伸到行末小节线；右半从行首横线到音符
// adj147/148：跨行平顶——两侧各 1/4 圆弧，左半右侧开口、右半左侧开口，线高 5
check('平顶左半：1/4 圆弧 + 横线平直到行末（右侧开口）', svg53.includes(`M ${s53l!.x1} ${hlY} A`) && new RegExp(`L ${s53l!.x2} ${(hlY - 5).toFixed(1).replace('.0', '')}(?:\.0)?"`).test(svg53), '')
check('平顶右半：横线从行首平直伸出（左侧开口）+ 1/4 圆弧', svg53.includes(`M ${s53r!.x1} ${(hrY - 5).toFixed(1)}`) && svg53.includes(` A `) && svg53.includes(`${s53r!.x2} ${hrY}"`), '')
// 用户强制平顶（lianyinxian_type=2）：跨行仍平顶（adj108 尊重设置）
const lay53f = layoutScore(r53, { ...DUR_CFG, lianyinxian_type: 2 })
const svg53f = renderScoreToSvg(lay53f)[0]
const s53fL = lay53f.pages[0].slurs.find((s) => s.half === 'l')
const s53fR = lay53f.pages[0].slurs.find((s) => s.half === 'r')
check('平顶左半：横线平直到行末（右侧开口，线高 5）', s53fL !== undefined && new RegExp(`L ${s53fL.x2} ${(s53fL.y - 5).toFixed(1).replace('.0', '')}(?:\.0)?"`).test(svg53f), '')
check('平顶右半：横线从行首伸出（左侧开口，线高 5）', s53fR !== undefined && svg53f.includes(`M ${s53fR.x1} ${(s53fR.y - 5).toFixed(1)}`), '')

// ---- 54. 非整拍小节/密集行不溢出边距 ----
console.log('[54] fractional-bar & dense-row no overflow')
const r54 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1) 6,. 0/ 6,/ ((6/ 5/) | 5/)) 5. 0/~ 2/ 2 1/ | 2/ 3 (3/ 3) - | 3./ (3// 3/) 2/ 7, - |\n',
)
const lay54 = layoutScore(r54, DUR_CFG)
check('密集行无 error 级解析错误', r54.errors.filter((e) => e.severity === 'error').length === 0, JSON.stringify(r54.errors.filter((e) => e.severity === 'error')))
const n54 = lay54.pages[0].notes
const maxNoteR54 = Math.max(...n54.map((n) => n.x + n.width))
check('非整拍小节行：音符不溢出右边距', maxNoteR54 <= RIGHT_EDGE, `right=${maxNoteR54}`)
const maxBarR54 = Math.max(...lay54.pages[0].barlines.map((b) => b.x + ({ '|': 0.55, '||': 1.95, '||/': 1.6, '|:': 4.2, ':|': 4.2, ':|:': 8.1, '||:': 3.85, '|*': 0.55 }[b.type] ?? 0.55)))
check('小节线不溢出右边距（右缘 = 中心+半宽 ≤ 右内容边界）', maxBarR54 <= RIGHT_EDGE, `right=${maxBarR54}`)
// 混合时值（16 分音符）不重叠
const r54b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3// 4// | 1/ 2/ 3// 4// |\n')
const n54b = [...layoutScore(r54b, DUR_CFG).pages[0].notes].sort((a, b) => a.x - b.x)
let minGap54 = Infinity
for (let i = 1; i < n54b.length; i++) minGap54 = Math.min(minGap54, n54b[i].x - n54b[i - 1].x)
check('跨拍/拍中起始音符不重叠（最小间距 ≥ 数字槽宽）', minGap54 >= DIGIT_W, `minGap=${minGap54}`)
// 行首 |* 占位、|/ 不占位（需求）
const r54c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |* 1 2 3 4 |\n')
const n54c = layoutScore(r54c, DUR_CFG).pages[0].notes[0]
check('行首 |* 占位（音符右移）', n54c.x > ML + 12, `x=${n54c.x}`)

// ---- 55. 多连音线（(1 2 3) 三连音 / (y...) 平均连音组） ----
console.log('[55] tuplets')
// (y1 2 3) 4：4/4 小节，组外 1 拍 → 组总 = 4-1 = 3，均分 1 拍/音符
const r55 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y1 2 3) 4 |\n')
const tk55 = r55.groups[0].music.tokens.filter((t) => t.kind === 'note' || t.kind === 'rest')
check('平均三连音：组内各音符时值均分 1 拍', r55.errors.length === 0 && tk55[0].tupletDur === 1 && tk55[1].tupletDur === 1 && tk55[2].tupletDur === 1 && tk55[3].tupletDur === undefined, JSON.stringify(tk55.map((t) => t.tupletDur)))
// (y1 2 3 4) 5：组外 1 拍 → 组总 3，均分 0.75
const r55b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y1 2 3 4) 5 |\n')
const tk55b = r55b.groups[0].music.tokens.filter((t) => t.kind === 'note' || t.kind === 'rest')
check('平均四连音：均分 0.75 拍', tk55b[0].tupletDur === 0.75 && tk55b[3].tupletDur === 0.75 && tk55b[4].tupletDur === undefined, JSON.stringify(tk55b.map((t) => t.tupletDur)))
// (1 2 3) 非平均：时值不覆盖
const r55c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2 3) 4 |\n')
const tk55c = r55c.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('非平均三连音：按各自时值（无覆盖）', tk55c[0].tupletDur === undefined && tk55c[1].tupletDur === undefined && tk55c[2].tupletDur === undefined, JSON.stringify(tk55c.map((t) => t.tupletDur)))
// 渲染：弧线正中数字 + 不透明背景
const lay55 = layoutScore(r55b, DUR_CFG)
const svg55 = renderScoreToSvg(lay55)[0]
const s55 = lay55.pages[0].slurs.find((s) => s.tupletCount === 4)
check('平均组 tupletCount=4', s55 !== undefined)
const label55 = svg55.includes(`>4</text>`) && svg55.includes('rx="2"')
check('渲染：数字 4 + 不透明背景 rect', label55)
// adj43：普通连音线 (…) 不标注数字——(1 2 3) 无 tupletCount、SVG 无数字标签
const lay55c = layoutScore(r55c, DUR_CFG)
const s55c = lay55c.pages[0].slurs
check('普通连音线 (…) 无 tupletCount', s55c.length === 1 && s55c[0].tupletCount === undefined, JSON.stringify(s55c.map((s) => s.tupletCount)))
check('普通连音线 (…) SVG 不渲染数字', !renderScoreToSvg(lay55c)[0].includes('rx="2"'))
// adj89：数字字号 = 音符字号 × TUPLET_NUM_RATIO（0.2×18=3.6 → 下限 7）；基线 = 弧线顶点 + 2
const labelEl55 = /rx="2"[^>]*\/><text x="([\d.]+)" y="([\d.]+)"[^>]*>4<\/text>/.exec(svg55)
const labelY55 = labelEl55 ? Number(labelEl55[2]) : NaN
check('数字字号随音符（0.2×18 → 7）', svg55.includes('font-size="7"'), '')
check('数字下移 2px（基线 = 线顶点 + 2）', Number.isFinite(labelY55) && Math.abs(labelY55 - (s55!.y - 4.5 + 2)) < 0.5, `labelY=${labelY55} slur.y=${s55?.y}`)
// adj222：不透明背景只包裹文字字形——单数字 4 宽 = 1×7×0.62+2 ≈ 6.34px
// （原 max(14, n×7+3) 固定 14px 白底，远大于字形约 4px，大片白块遮线）
const rectW55 = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="7" rx="2"/.exec(svg55)
check('adj222 数字背景仅包裹字形（宽≈6.3，非固定 14）', rectW55 !== null && Math.abs(Number(rectW55[3]) - 6.34) < 0.2, rectW55 ? `w=${rectW55[3]}` : 'no rect')
// 平均组占宽：4 个 0.75 拍音符 vs 3 个 1 拍音符——同一小节宽一致
const lay55a = layoutScore(r55, DUR_CFG)
const n55a = [...lay55a.pages[0].notes].sort((a, b) => a.x - b.x)
const n55b = [...lay55.pages[0].notes].sort((a, b) => a.x - b.x)
// adj198：自然宽下平均组内中间音符等宽、首尾对称（0.75 拍跨段占位不同）
check('adj198 平均组音符等宽（中间等宽 + 首尾对称）', Math.abs(n55a[1].width - n55a[0].width) < 0.5 && Math.abs(n55b[1].width - n55b[2].width) < 0.5 && Math.abs(n55b[0].width - n55b[3].width) < 0.5, `a=${n55a[0].width},${n55a[1].width} b=${n55b[0].width},${n55b[1].width},${n55b[2].width},${n55b[3].width}`)
// adj44：跨拍平均连音组音符等距（用户示例 0/ 7/ 7/ 1'/ (y2' 7 6)）
const r55d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0/ 7/ 7/ 1\'/ (y2\' 7 6) |\n')
const lay55d = layoutScore(r55d, DUR_CFG)
const n55d = [...lay55d.pages[0].notes].filter((n) => n.token.kind === 'note' && (n.token as { tupletDur?: number }).tupletDur !== undefined).sort((a, b) => a.x - b.x)
const gapD1 = n55d[1].x - n55d[0].x
const gapD2 = n55d[2].x - n55d[1].x
check('跨拍平均组音符等距（相邻间距一致）', n55d.length === 3 && Math.abs(gapD1 - gapD2) < 0.6, `gaps=${gapD1.toFixed(2)},${gapD2.toFixed(2)}`)
// adj44：中间音符带高八度 → 连音线整体上移避开（线 y = 基线-26，而不是只查端点）
const r55e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2\' 3 4) 5 |\n')
const lay55e = layoutScore(r55e, DUR_CFG)
const s55e = lay55e.pages[0].slurs[0]
const n55eMid = lay55e.pages[0].notes.find((n) => n.token.kind === 'note' && (n.token as { pitch?: number }).pitch === 2)
check('连音线避让中间音符高音点（y = octaveTopY-LAYER_GAP×s，adj60）', s55e !== undefined && n55eMid !== undefined && Math.abs(s55e.y - (octaveTopY(n55eMid.y, 1, defaultPageConfig.note_size) - LAYER_GAP * NS_S)) < 0.5, `slurY=${s55e?.y} midY=${n55eMid?.y}`)
// adj49：独立连音符不被同排其他嵌套抬高（间距保持 2px 基准）
const r55f = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2) (3 (4 5) 6) 7 |\n')
const lay55f = layoutScore(r55f, DUR_CFG)
const s55f = lay55f.pages[0].slurs
const n55fFirst = lay55f.pages[0].notes[0]
check('独立连音符不因同排嵌套抬高（y = 数字上沿-LAYER_GAP×s，adj60）', s55f.length >= 2 && Math.abs(s55f[0].y - (n55fFirst.y - defaultPageConfig.note_size * 0.8 - LAYER_GAP * NS_S)) < 0.5, `y=${s55f[0]?.y} expect=${n55fFirst.y - defaultPageConfig.note_size * 0.8 - LAYER_GAP * NS_S}`)
// adj217：平均连音组占位宽度按时值比例（两 tuplet 组 + 0.25 密集拍）——
// 此前 tupletDur 浮点累加（1/3×3=0.9999…）导致拍切分误判、组被压缩/拉伸
{
  const r217 = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y6/ 1'/ 1'/) 1'/. 6// 1' - | (y6/ 1'/ 1'/) 7./ 6// 7 - | 6// 6// 5// 6// 5/ 6/ 3 - | 5// 5// 3// 5// 5/ 3/ 2 - |\n")
  const lay217 = layoutScore(r217, DUR_CFG)
  const pn217 = lay217.pages[0].notes
  check('adj217 解析：两组 tupletDur 均分 1 拍（0.333）', r217.errors.length === 0 && Math.abs((pn217[0].token as { tupletDur?: number }).tupletDur! - 1 / 3) < 1e-6 && Math.abs((pn217[6].token as { tupletDur?: number }).tupletDur! - 1 / 3) < 1e-6, '')
  // 第 1 小节：三音均分 1 拍等宽、组外 0.75/0.25 按时值比例
  const g217 = pn217.slice(0, 6)
  const wTup = g217[0].width
  check('adj217 占位：tuplet 三音等宽（各 1/3 拍）', Math.abs(g217[1].width - wTup) < 0.5 && Math.abs(g217[2].width - wTup) < 0.5, `${g217.map((n) => n.width.toFixed(1)).join(',')}`)
  check('adj217 占位：组外附点 0.75 拍宽 = 3×三音宽、0.25 拍宽 = 1×三音宽', Math.abs(g217[3].width - wTup * 3) < 1 && Math.abs(g217[4].width - wTup) < 1, `${g217[3].width.toFixed(1)} vs ${(wTup * 3).toFixed(1)}`)
  const bars217 = lay217.pages[0].barlines
  check('adj217 四小节小节线均匀分布（不塌缩）', bars217.length === 4 && Math.abs(bars217[1].x - bars217[0].x - (bars217[3].x - bars217[2].x)) < 15, bars217.map((b) => b.x.toFixed(1)).join(','))
}
// adj218：&zkh 在 tuplet 组内首音符后——浮点拍边界（4.9999…）近整数归整，
// 组外音符不再倒序/重叠（此前 7- 落在 6// 左侧）
{
  const r218 = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y6/&zkh 1'/ 1'/) 1'/. 6// 1' - | (y6/ 1'/ 1'/) 7./ 6// 7 - | 6// 6// 5// 6// 5/ 6/ 3 - | 5// 5// 3// 5// 5/ 3/ 2 - |\n")
  const lay218 = layoutScore(r218, DUR_CFG)
  const pn218 = lay218.pages[0].notes
  const tok218 = r218.groups[0].music.tokens
  const bk218 = tok218.filter((t) => t.kind === 'bracket')
  check('adj218 解析：&zkh 为独立 bracket token、tupletDur=1/3', r218.errors.length === 0 && bk218.length === 1 && (bk218[0] as any).dir === 'open' && Math.abs((pn218[0].token as { tupletDur?: number }).tupletDur! - 1 / 3) < 1e-6, '')
  // 各音符 x 严格递增（不重叠不倒序）
  let ascOk218 = true
  for (let i = 1; i < pn218.length; i++) {
    if (pn218[i].x < pn218[i - 1].x - 0.5) {
      ascOk218 = false
      break
    }
  }
  check('adj218 占位：全部音符 x 递增（不重叠不倒序）', ascOk218, pn218.map((n) => n.x.toFixed(0)).join(','))
  // 第 2 小节：7./ 0.75 拍宽 = 3×tuplet 音宽、7- 2 拍在 6// 右侧
  const wTup218 = pn218[6].width
  check('adj218 第 2 小节：7./ 宽 = 3×三音宽、7- 在 6// 右侧', Math.abs(pn218[9].width - wTup218 * 3) < 1 && pn218[11].x > pn218[10].x, `${pn218[9].width.toFixed(1)} vs ${(wTup218 * 3).toFixed(1)}`)
}
// adj219：减时线按拍分组——beatPos 浮点尾（0.9999…）近整数归整，
// tuplet 组三音一条、7./+6// 一条、4×16 分音符一条（不跨拍粘连）
{
  const lay219 = layoutScore(parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y6/ 1'/ 1'/) 7./ 6// 7 - | 6// 6// 5// 6// 5/ 6/ 3 - |\n"), DUR_CFG)
  const pn219 = lay219.pages[0].notes
  // bar 0：tuplet 三音 beatPos 0/0.333/0.667 同拍、7./ 1.0 与 6// 1.75 同拍（浮点归整后 1）
  const b0 = pn219.filter((n) => n.barIndex === 0)
  const beatP0 = b0.map((n) => n.beatPos)
  check('adj219 bar0 beatPos：三音同拍 0、7./ 归整到拍 1 与 6// 同拍', Math.abs(beatP0[0] - 0) < 1e-3 && Math.abs(beatP0[2] - 2 / 3) < 1e-3 && Math.abs(beatP0[3] - 1) < 1e-3 && Math.abs(beatP0[4] - 1.75) < 1e-3, beatP0.map((v) => v.toFixed(3)).join(','))
  const beams219 = computeBeamsForTest(pn219, defaultPageConfig.note_size)
  // bar0 level1：2 条（三音一条 + 7./6// 一条）；bar1 level1：2 条（4×16 分一条 + 5/6/ 一条）
  const lvl1 = beams219.filter((b) => Math.abs(b.y - (157.2)) < 1).sort((a, b) => a.x1 - b.x1)
  check('adj219 减时线分组：bar0 2 条、bar1 2 条（不跨拍粘连）', lvl1.length === 4 && Math.abs(lvl1[1].x1 - lvl1[0].x2) > 5 && Math.abs(lvl1[3].x1 - lvl1[2].x2) > 5, lvl1.map((b) => `${b.x1}-${b.x2}`).join(' | '))
}

// ---- 56. 跨行跳房子起点（adj47）：断行在 [ 起点小节线后 → 起点线移到下一行行首 ----
console.log('[56] cross-row volta start')
const r56 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3/ 2// 3//) 5 (3/ 2// 3//) 1 | (2./ 3//) (2/ 1/) 6, - | 5,/ (5,// 6,//) (5/ 3/) (2. 3/) |[+"1." (2/ 0// 3//) (5,/ 6,/) 1[6,/] - :|]\n',
)
const lay56 = layoutScore(r56, DUR_CFG)
// 内容区宽 515.28（边距 40）> 该行自然宽 → 一行放下（原边距 80 时才断 2 行）
const rows56 = [...new Set(lay56.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('内容区变宽后单行放下（rows=1，不再断行）', rows56.length === 1, `rows=${rows56.length}`)
const segEnd56 = (n: PlacedToken) => {
  const s = n.segments?.[n.segments.length - 1]
  return s ? s.x + s.beats * s.perBeat : n.x + n.width
}
for (const y of rows56) {
  const notes = lay56.pages[0].notes.filter((n) => n.y === y)
  check('每行音符不溢出右边距', Math.max(...notes.map(segEnd56)) <= RIGHT_EDGE, `y=${y} right=${Math.max(...notes.map(segEnd56)).toFixed(1)}`)
}
// 跳房子起点 [ 移到下一行行首（不留在行尾溢出、不跨行反向）；内容区变宽不断行时起点线留在行内
const vStart56 = lay56.pages[0].barlines.find((b) => b.voltaStart)
const vEnd56 = lay56.pages[0].barlines.find((b) => b.voltaEnd)
check('跳房子起点线不溢出右边距', vStart56 !== undefined && vStart56.x < RIGHT_EDGE - 20, `x=${vStart56?.x}`)
check('跳房子起点与终点在同一行（y 相同）', vStart56 !== undefined && vEnd56 !== undefined && Math.abs(vStart56.yTop - vEnd56.yTop) < 1, `${vStart56?.yTop} vs ${vEnd56?.yTop}`)
check('跳房子番号在起点线右侧（不溢出右边距）', vStart56 !== undefined && vStart56.x + 8 < RIGHT_EDGE, `x=${vStart56?.x}`)
check('跳房子线正向（终点 x > 起点 x，不再反向跨行）', vStart56 !== undefined && vEnd56 !== undefined && vEnd56.x > vStart56.x, `${vStart56?.x} → ${vEnd56?.x}`)
// adj107：跳房子允许跨行——[ 在行内、] 在下一行时拆两半（左半到行末小节线、右半从行首小节线）
const r107 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ | 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ | 3/ 4/ 5/ 6/ 7/ 1/ 2/ 3/ |[+"1." 4/ 5/ 6/ 7/ 1/ 2/ 3/ 4/ 5/ | 6/ 7/ 1/ 2/ 3/ 4/ 5/ 6/ 7/ | 1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ | 3/ 4/ 5/ 6/ 7/ 1/ 2/ 3/ 4/ |] 5/ 6/ 7/ 1/ |\n',
)
const lay107 = layoutScore(r107, DUR_CFG)
const vStart107 = lay107.pages[0].barlines.find((b) => b.voltaStart)
const vEnd107 = lay107.pages[0].barlines.find((b) => b.voltaEnd)
check('adj107 跨行跳房子：起点与终点在不同行', vStart107 !== undefined && vEnd107 !== undefined && Math.abs(vStart107.yTop - vEnd107.yTop) > 1, `${vStart107?.yTop} vs ${vEnd107?.yTop}`)
const svg107 = renderScoreToSvg(lay107)[0]
const voltaLines107 = [...svg107.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1b1b1b" stroke-width="0.8"/g)]
  .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]) }))
  .filter((l) => l.x2 - l.x1 > 20)
check('adj107 跨行跳房子拆两半（2 条线、y 不同）', voltaLines107.length === 2 && Math.abs(voltaLines107[0].y1 - voltaLines107[1].y1) > 1, JSON.stringify(voltaLines107))
const sortedVolta107 = [...voltaLines107].sort((a, b) => a.y1 - b.y1)
const leftHalf107 = sortedVolta107[0]
const rightHalf107 = sortedVolta107[1]
// adj162：跨行跳房子左半延伸到页面右边距（与跨行连音线一致），而非行末小节线
const rightEdge107 = lay107.pages[0].width - defaultPageConfig.margin_right
check('adj162 左半：起点线+2 → 页面右边距', leftHalf107 !== undefined && Math.abs(leftHalf107.x1 - (vStart107.x + 2)) < 0.5 && Math.abs(leftHalf107.x2 - rightEdge107) < 0.5, JSON.stringify(leftHalf107))
// adj164：右半从下一行「行首小节线」开始（与渲染 rowStartBarX 一致）——取该行最小 x 小节线；
// 该行无小节线则从边距+2
const endRowBars107 = lay107.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - vEnd107.yTop) < 1.5)
  .sort((a, b) => a.x - b.x)
const expectStartB107 = endRowBars107.length > 0 ? endRowBars107[0].x : ML + 2
check('adj164 右半：从下一行行首小节线/边距连到终点线-2', rightHalf107 !== undefined && Math.abs(rightHalf107.x1 - expectStartB107) < 1 && Math.abs(rightHalf107.x2 - (vEnd107.x - 2)) < 1, JSON.stringify({ right: rightHalf107, expect: expectStartB107, ve: vEnd107?.x }))
// adj164：下一行行首有小节线时，右半从其开始（与连音线 rowStartBarX 一致）；
// 该场景终点行行首音符 x=86 而小节线最小 154（行首无小节线）→ 右半应从边距+2 开始
const r164b = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 | 2 3 4 5 | 6 7 1 2 | 3 4 5 6 | 7 1 2 3 | 4 5 6 7 | 1 2 3 4 | 5 6 7 1 | 2 3 4 5 |[ 6 7 1 2 | 3 4 5 6 | 7 1 2 3 | 4 5 6 7 | 1 2 3 4 | 5 6 7 1 | 2 3 4 5 |] 6 7 1 2 |\n',
)
const lay164b = layoutScore(r164b, DUR_CFG)
const vStart164b = lay164b.pages[0].barlines.find((b) => b.voltaStart)
const vEnd164b = lay164b.pages[0].barlines.find((b) => b.voltaEnd)
const svg164b = renderScoreToSvg(lay164b)[0]
const lines164b = [...svg164b.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1b1b1b" stroke-width="0.8"/g)]
  .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]) }))
  .filter((l) => l.x2 - l.x1 > 20)
  .sort((a, b) => a.y1 - b.y1)
const rightHalf164b = lines164b[1]
const endRowBars164b = lay164b.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - vEnd164b.yTop) < 1.5)
  .sort((a, b) => a.x - b.x)
const expectStart164b = endRowBars164b.length > 0 ? endRowBars164b[0].x : ML + 2
check(
  'adj164 右半从行首小节线开始；无小节线时从边距+2',
  rightHalf164b !== undefined &&
    vStart164b !== undefined &&
    vEnd164b !== undefined &&
    Math.abs(rightHalf164b.x1 - expectStart164b) < 1 &&
    Math.abs(rightHalf164b.x2 - (vEnd164b.x - 2)) < 1,
  JSON.stringify({ right: rightHalf164b, expect: expectStart164b, ve: vEnd164b?.x }),
)

// ---- 57. 排版虚线行结构（adj72）：曲部行数字中心 / 多声部声部序号 / 词部行虚线 ----
console.log('[57] row guides (adj72)')
const rg72of = (src: string) => {
  const lay = layoutScore(parseJps(src), DUR_CFG)
  return computeRowGuides(lay, { quci: defaultPageConfig.height_quci, geci: defaultPageConfig.geci_size }, defaultPageConfig.note_size)[0]
}
const rg72a = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n')
check('曲部行虚线数字中心（yCenter = 基线-0.4×字号）', Math.abs(rg72a[0].yCenter - (layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'), DUR_CFG).pages[0].notes[0].y - defaultPageConfig.note_size * 0.4)) < 0.5, `yc=${rg72a[0].yCenter}`)
check('单声部 voiceIdx = 0', rg72a[0].voiceIdx === 0, `v=${rg72a[0].voiceIdx}`)
const rg72b = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 4 |\nQ2: 5 6 7 1 |\n')
check('多声部：块内第 2 声部 voiceIdx = 1', rg72b.some((r) => r.voiceIdx === 1), JSON.stringify(rg72b.map((r) => r.voiceIdx)))
const rg72c = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八\nC: 九 十 十 一 十 二 十 三 十 四\n')
check('多行歌词：lyricRows 每行一条（2 条）', rg72c[0].lyricRows.length === 2, JSON.stringify(rg72c[0].lyricRows))
check('词部行虚线中心 = 基线-0.3×歌词字号', Math.abs(rg72c[0].lyricRows[0].center - (rg72c[0].lyricRows[0].y - defaultPageConfig.geci_size * 0.3)) < 0.5, JSON.stringify(rg72c[0].lyricRows[0]))

// adj307：多组多声部序列——第二组 Q1/Q2 第一拍与第一组结束同步（120bpm，每拍 500ms）
// 第一组 Q1: 1 2 | + Q2: 5 6 | = 同多声部块 bb=2 拍=1000ms；第二组起点=1000ms
const rMultiGrp = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 |\nQ2: 5 6 |\nQ1: 3 4 |\nQ2: 7 1 |\n')
const seqMultiGrp = buildPlaySequence(rMultiGrp, layoutScore(rMultiGrp, DUR_CFG), 120)
const ev1Multi = seqMultiGrp.events.filter((e) => e.placed.id.voice === 1).sort((a, b) => a.atMs - b.atMs)
const ev2Multi = seqMultiGrp.events.filter((e) => e.placed.id.voice === 2).sort((a, b) => a.atMs - b.atMs)
check('adj307 多组二声部 8 事件', seqMultiGrp.events.length === 8, String(seqMultiGrp.events.length))
check('adj307 v1/v2 第一组第一拍 atMs=0', ev1Multi[0]?.atMs === 0 && ev2Multi[0]?.atMs === 0, `v1=${ev1Multi[0]?.atMs} v2=${ev2Multi[0]?.atMs}`)
check('adj307 v1 第二组第一拍 atMs=1000（延续第一组不覆盖）', ev1Multi[2]?.atMs === 1000, String(ev1Multi[2]?.atMs))
check('adj307 v2 第二组第一拍 atMs=1000（与 v1 第二组第一拍同步）', ev2Multi[2]?.atMs === 1000 && ev1Multi[2].atMs === ev2Multi[2].atMs, `v1=${ev1Multi[2]?.atMs} v2=${ev2Multi[2]?.atMs}`)
check('adj307 多组二声部总拍 = 4 拍 = 2000ms', seqMultiGrp.totalMs === 2000, String(seqMultiGrp.totalMs))

// ---- 58. 空间优先布局 P1：时值拆分 + 本体宽度（adj283） ----
console.log('[58] space-first layout P1 (adj283)')
const _sp = (dc: number, aug: number, dots: number) => splitNoteDur({ diminishCount: dc, augmentCount: aug, dots: dots })
const _spOne = (dc: number, aug: number, dots: number) => {
  const s = _sp(dc, aug, dots)
  return s.noteDur * (1 + s.augCount) + s.dotDur
}
for (const [dc, aug, dots] of [[0, 0, 0], [0, 2, 0], [0, 0, 1], [0, 1, 1], [1, 0, 0], [0, 0, 2], [1, 1, 1], [2, 0, 0], [0, 3, 1]] as const) {
  check(
    `splitNoteDur(${dc}/${aug}/${dots}) 合计=tokenDuration`,
    Math.abs(_spOne(dc, aug, dots) - tokenDuration({ diminishCount: dc, augmentCount: aug, dots })) < 1e-6,
    `sum=${_spOne(dc, aug, dots)} tok=${tokenDuration({ diminishCount: dc, augmentCount: aug, dots })}`,
  )
}
check('splitNoteDur(0/2/0) noteDur=1 augCount=2', _sp(0, 2, 0).noteDur === 1 && _sp(0, 2, 0).augCount === 2)
check('splitNoteDur(0/0/1) dotDur=0.5', Math.abs(_sp(0, 0, 1).dotDur - 0.5) < 1e-6)
check('splitNoteDur(0/0/2) dotDur=0.75', Math.abs(_sp(0, 0, 2).dotDur - 0.75) < 1e-6)
check('splitNoteDur(1/0/0) noteDur=0.5', Math.abs(_sp(1, 0, 0).noteDur - 0.5) < 1e-6)
check('digitSlotW(13)=8.06', Math.abs(digitSlotW(13) - 8.06) < 1e-6, String(digitSlotW(13)))
check('augBodyW(13)=8.06', Math.abs(augBodyW(13) - 8.06) < 1e-6, String(augBodyW(13)))
check('dotBodyW(13)=2×2×13/18', Math.abs(dotBodyW(13) - 2 * 2 * (13 / 18)) < 1e-6, String(dotBodyW(13)))
check('slideBodyW(13)=8.06', Math.abs(slideBodyW(13) - 8.06) < 1e-6, String(slideBodyW(13)))
check('bracketBodyW()=5', bracketBodyW() === 5)
check('noteBodyW(13,3)=digitSlotW+3', Math.abs(noteBodyW(13, 3) - (digitSlotW(13) + 3)) < 1e-6, String(noteBodyW(13, 3)))
check('nonDurGap(13)=6.5', Math.abs(nonDurGap(13) - 6.5) < 1e-6, String(nonDurGap(13)))

// ---- 59. 空间优先布局 P2：元素级分配 + 附点/增时线独立段（adj284） ----
console.log('[59] space-first layout P2 (adj284)')
const spCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
const spSrc = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3-- 4 |\n'
const spNotes = layoutScore(parseJps(spSrc), spCfg).pages[0].notes
check('space 音符 segment 第 1 段 el=note', spNotes[0]?.segments?.[0]?.el === 'note', JSON.stringify(spNotes[0]?.segments))
const spDotNote = spNotes.find((n) => n.token.kind === 'note' && n.token.dots > 0)
const spAugNote = spNotes.find((n) => n.token.kind === 'note' && n.token.augmentCount > 0)
check('space 附点音符含 el=dot 段', spDotNote?.segments?.some((s) => s.el === 'dot') === true, JSON.stringify(spDotNote?.segments))
check('space 增时线音符含 2 个 el=aug 段', spAugNote?.segments?.filter((s) => s.el === 'aug').length === 2, JSON.stringify(spAugNote?.segments))
const spDotSeg = spDotNote?.segments?.find((s) => s.el === 'dot')
const spNoteSeg = spDotNote?.segments?.find((s) => s.el === 'note')
check(
  'space 附点在音符块右侧留空（三段留空）',
  !!spDotSeg && !!spNoteSeg && spDotSeg.x > spNoteSeg.x + digitSlotW(defaultPageConfig.note_size),
  JSON.stringify({ dot: spDotSeg, note: spNoteSeg }),
)
const spXs = spNotes.map((n) => n.segments?.[0]?.x).filter((x): x is number => typeof x === 'number')
check('space 音符块 x 单调递增（不重叠）', spXs.length >= 4 && spXs.every((x, i) => i === 0 || x > spXs[i - 1]), JSON.stringify(spXs))
const durXs = layoutScore(parseJps(spSrc), DUR_CFG).pages[0].notes.map((n) => n.segments?.[0]?.x ?? n.x)
check('space 与时值优先音符块位置不同', JSON.stringify(spXs) !== JSON.stringify(durXs), `sp=${JSON.stringify(spXs)} dur=${JSON.stringify(durXs)}`)
check('accidentalBodyW(13)=7.62', Math.abs(accidentalBodyW(13) - 7.62) < 1e-6, String(accidentalBodyW(13)))
// 数字左缘 = 音符块段左缘（无 -6 偏移）→ 音符块在段内居中，附点三段留空相等
check('space 附点音符数字左缘=音符块段左缘', Math.abs((spDotNote?.x ?? 0) - (spNoteSeg?.x ?? 0)) < 0.6, JSON.stringify({ nx: spDotNote?.x, segX: spNoteSeg?.x }))

// ---- 60. 空间优先：&zkh/&ykh 括号与前倚音占位（adj286） ----
console.log('[60] space-first brackets & grace (adj286)')
const brCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
const brSrc = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&zkh 2 1 | 4[5/] 3 2&ykh 1 |\n'
const brRes = parseJps(brSrc)
const brLay = layoutScore(brRes, brCfg)
const brNotes = brLay.pages[0].notes
check('space 含括号/倚音行不回退（segment 带 el=note）', brNotes[0]?.segments?.[0]?.el === 'note', JSON.stringify(brNotes[0]?.segments))
// adj294：&zkh/&ykh 独立为 bracket token——不再占音符 el 段，但空间优先音符块（el=note）仍放置
const brBks = brRes.groups[0].music.tokens.filter((t) => t.kind === 'bracket')
const brPlacedBks = brLay.pages[0].brackets
check('adj294 space &zkh/&ykh 独立 bracket token + 音符仍有 el 段', brBks.length === 2 && brPlacedBks.length === 2 && brNotes.some((n) => n.segments?.[0]?.el === 'note'), JSON.stringify({ bks: brBks, placed: brPlacedBks, seg: brNotes[0]?.segments }))
const brGn = brNotes.find((n) => n.token.kind === 'note' && ((n.token as any).gracenotes?.notes?.length ?? 0) > 0)
check('space 前倚音数字左缘>段左缘（右移 leftExt）', !!brGn && (brGn.x > (brGn.segments?.[0]?.x ?? 0)), JSON.stringify({ nx: brGn?.x, segX: brGn?.segments?.[0]?.x }))
const brXs = brNotes.map((n) => n.segments?.[0]?.x).filter((x): x is number => typeof x === 'number')
check('space 含括号行音符不重叠', brXs.every((x, i) => i === 0 || x > brXs[i - 1]), JSON.stringify(brXs))

// ---- 61. 时值优先也计入升降符本体宽（adj287） ----
console.log('[61] duration-first accent body width (adj287)')
const dPlain = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 5 6 |\n'), DUR_CFG).pages[0].notes
const dAcc = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 5# 6 |\n'), DUR_CFG).pages[0].notes
check('adj287 时值优先变音角标计入本体宽（后续音符右移）', dAcc[2]?.x > dPlain[2]?.x, `plain=${dPlain[2]?.x} acc=${dAcc[2]?.x}`)

// ---- 62. 多声部空间优先布局（adj314）：小节/拍级对齐 + 小节基准本体宽占比 + 超宽压缩 ----
console.log('[62] multi-voice space-first layout (adj314)')
const mspCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
const mspSrc = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 4 | 5 6 5 3 |\nQ2: 5 6 5 3 | 1 2 3 4 |\nC2: 女 声 歌 词\n'
const mspRes = parseJps(mspSrc)
const mspLay = layoutScore(mspRes, mspCfg)
check('多声部空间优先 无解析错误', mspRes.errors.length === 0 || mspRes.errors.every((e) => e.severity !== 'error'), JSON.stringify(mspRes.errors.slice(0, 2)))
check('多声部空间优先 1 个声部块', mspLay.pages[0].voiceBlocks.length === 1, `got ${mspLay.pages[0].voiceBlocks.length}`)
const mspQ1 = mspLay.pages[0].notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
const mspQ2 = mspLay.pages[0].notes.filter((n) => n.id.voice === 2).sort((a, b) => a.x - b.x)
check('多声部空间优先 两声部各 8 音符', mspQ1.length === 8 && mspQ2.length === 8, `${mspQ1.length}/${mspQ2.length}`)
// 拍对齐：同小节同拍（barIndex/beatPos 相同）的声部音符 x 一致（纵向对齐）
const alignedSameBeat = (aArr: typeof mspQ1, bArr: typeof mspQ2) =>
  aArr.every((n) => {
    const m = bArr.find((b) => b.barIndex === n.barIndex && Math.abs(b.beatPos - n.beatPos) < 1e-3)
    return m ? Math.abs(m.x - n.x) < 0.6 : true
  })
check('多声部空间优先 同拍各声部 x 对齐（纵向）', alignedSameBeat(mspQ1, mspQ2) && alignedSameBeat(mspQ2, mspQ1), JSON.stringify(mspQ1.slice(0, 3).map((n) => ({ b: n.barIndex, beat: n.beatPos, x: n.x }))))
// 与多声部时值优先不同（换了算法）
const msvLay = layoutScore(mspRes, DUR_CFG)
const msvQ1 = msvLay.pages[0].notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
check('多声部空间优先 与时值优先音符位置不同', JSON.stringify(mspQ1.map((n) => n.x)) !== JSON.stringify(msvQ1.map((n) => n.x)), `sp=${JSON.stringify(mspQ1.map((n) => n.x))} dur=${JSON.stringify(msvQ1.map((n) => n.x))}`)
// 小节线对齐：各声部 barlines 在该页同一 x（严格小节线对齐）
const mspBars = mspLay.pages[0].barlines
check('多声部空间优先 小节线存在', mspBars.length >= 2, `got ${mspBars.length}`)
// 溢出对比：空间优先的最右音符右端 ≤ 时值优先（不劣于现状；既有 placeNoteAt/beatStartX
// 固有偏移本就允许轻微溢出，时空值优先溢出 16px，空间优先此谱仅 ~2px）
const mspPaperW = mspLay.pages[0].width
const mspMaxR = Math.max(...mspLay.pages[0].notes.map((n) => n.x + n.width))
const msvLay2 = layoutScore(mspRes, DUR_CFG)
const msvMaxR = Math.max(...msvLay2.pages[0].notes.map((n) => n.x + n.width))
check('多声部空间优先 溢出不劣于时值优先', mspMaxR <= msvMaxR + 0.5, JSON.stringify({ space: Math.round(mspMaxR * 10) / 10, dur: Math.round(msvMaxR * 10) / 10 }))
// 不超左边界（内容区起点右侧，防负 x；右侧由既有 placeNoteAt 固有偏移容忍，不在本断言强限）
const mspMinX = Math.min(...mspLay.pages[0].notes.map((n) => n.x))
check('多声部空间优先 音符不越左边界', mspMinX >= mspCfg.margin_left - 1, `min=${mspMinX}`)

// ---- 63. 多声部空间优先：音符块本体在时值段内居中（adj314，含附点/变音） ----
console.log('[63] multi-voice space-first body-centering (adj314)')
const mbdCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
const mbdSrc = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1. 2# 3 | 4 5 6 |\nQ2: 1 2. 3# | 4 5 6 |\n'
const mbdRes = parseJps(mbdSrc)
const mbdLay = layoutScore(mbdRes, mbdCfg)
const mbdNotes = mbdLay.pages[0].notes
// 含变音的音符：note.x（数字左缘）应右移给变音角标/前倚音腾位（> 段起点）
const mbdSharp = mbdNotes.find((n) => n.token.kind === 'note' && n.token.accidental)
check('多声部空间优先 变音音符数字右移给角标腾位', !!mbdSharp && (mbdSharp.x > (mbdSharp.segments?.[0]?.x ?? 0)), JSON.stringify({ nx: mbdSharp?.x, segX: mbdSharp?.segments?.[0]?.x }))
// 音符块本体（数字）在时值段内：数字左缘 >= 段起点（不越段左边界，横向居中由 placeNoteAt 段定位保证）
const mbdAllInSeg = mbdNotes.every((n) => (n.x ?? 0) >= (n.segments?.[0]?.x ?? 0) - 1)
check('多声部空间优先 音符数字均在时值段内', mbdAllInSeg, JSON.stringify(mbdNotes.slice(0, 3).map((n) => ({ nx: n.x, segX: n.segments?.[0]?.x }))))
// 无越界（左边界 + 不劣于时值优先右溢出）
const mbdMaxR = Math.max(...mbdNotes.map((n) => n.x + n.width))
const mbdDur = layoutScore(mbdRes, DUR_CFG)
const mbdDurMaxR = Math.max(...mbdDur.pages[0].notes.map((n) => n.x + n.width))
check('多声部空间优先 变音/附点溢出 ≤ 时值优先', mbdMaxR <= mbdDurMaxR + 0.5, JSON.stringify({ space: Math.round(mbdMaxR * 10) / 10, dur: Math.round(mbdDurMaxR * 10) / 10 }))

// ---- 64. 多声部空间优先：中间小节线两侧空白对称（adj316，拉伸空白均分到小节头/各拍后） ----
console.log('[64] multi-voice space barline symmetry (adj316)')
{
  const mspUq = [...new Set(mspLay.pages[0].barlines.map((b) => b.x))].sort((a, b) => a - b)
  const v1n = mspLay.pages[0].notes.filter((n) => n.id.voice === 1)
  const symOk = mspUq.every((bx, bi) => {
    if (bi === 0 || bi === mspUq.length - 1) return true // 行首/行末单侧不判
    const l = v1n.filter((n) => n.barIndex === bi)
    const r = v1n.filter((n) => n.barIndex === bi + 1).sort((a, b) => a.x - b.x)[0]
    if (!l.length || !r) return true
    const lr = Math.max(...l.map((n) => n.x + n.width))
    return Math.abs((bx - lr) - (r.x - bx)) < 2
  })
  check('adj316 多声部中间小节线两侧空白对称（≤2px）', symOk, mspUq.map((x, i) => `${i}:${x.toFixed(1)}`).join(','))
}

// ---- 65. 多声部空间优先：行首贴左 + 多声部附点不贴数字（adj317） ----
console.log('[65] multi-voice space block left-align + dot gap (adj317)')
{
  const adj317Cfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
  const adj317Src =
    'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 6. 1\'// (3// 3) - | 0/ 1// 2// 3/ 2/ 3/ 7/ 7/. 1\'// | 1\' - 0 5/ 4/ | (3/ 2.) 0 0 | 0 0 3 5 |\nQ2: 4. 5/ 3 - | 0/ 1// 2// 3/ 2/ 3/ 2/ 2/. 3// | 4 - 0 4/ 4/ | (3/ 2.) 0 0 | 0 0 3 2 |\nQ3: 4 - 3 - | 0 3 5 7 | 1\' - 0 5/ 4/ | 3/ 2. 0 0 | 0 0 0 0 |\n'
  const adj317Lay = layoutScore(parseJps(adj317Src), adj317Cfg)
  // 行首音符贴内容左界（blockStartX + BAR_PAD）
  const blockPad = 14 // labelPad=0 + 14
  const blockStartX = adj317Cfg.margin_left + blockPad
  const firstX = Math.min(...adj317Lay.pages[0].notes.map((n) => n.x))
  const expectedLeft = blockStartX + 6 // BAR_PAD
  check('adj317 多声部行首贴内容左界', Math.abs(firstX - expectedLeft) < 0.1, `firstX=${firstX.toFixed(2)} expected=${expectedLeft}`)
  // 附点圆心在数字右缘之后（gap>0），不再紧贴
  const dotNote = adj317Lay.pages[0].notes.find((n) => n.token.kind === 'note' && n.token.dots > 0)
  const dotSeg = dotNote?.segments?.find((s) => s.el === 'dot')
  // adj319：note.width 已是显示占宽（含附点），附点圆心在数字本体右（> 本体宽 → 不紧贴数字），
  // 且落在显示占宽内。原 `dotSeg.x > note.x+note.width` 语义已变（width 含附点），改为测：
  // 附点圆心距音符起点 > 本体宽（约 8.06，有 gap），且 < 显示占宽（在音符内）。
  const dotGap = dotSeg && dotNote ? dotSeg.x - dotNote.x : -1
  const inNote = dotSeg && dotNote ? dotSeg.x < dotNote.x + dotNote.width : false
  check('adj317 多声部附点圆心有间隙（>本体宽）且落在显示占宽内', !!dotSeg && dotGap > 8 && inNote, `dotOff=${dotGap.toFixed(2)} dotX=${dotSeg?.x?.toFixed(2)} note.x=${dotNote?.x?.toFixed(2)} note.width=${dotNote?.width.toFixed(2)}`)
}

// ---- 66. 多声部空间优先：内容不溢出页右界（adj317b，avStretch 基于 baseBarSum 防溢出） ----
console.log('[66] multi-voice space no overflow (adj317b)')
{
  const adj317bCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
  const adj317bSrc =
    'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 2\'/ 1\'// (1\'// 1\'/) 5/ 3 0/. 3// | 2\'/ 1\'// (1\'// 1\'/) 7/ 1\' 0/ 1\'// 5// | 3\'/ 3\'/ 3\'/ 1\'// (5// 5) 0/. 3// | 4/ 5// (6// 6/) 1/ 2 - |\nQ2: 3/ 3// (3// 3/) 1// 2// 1 0/. 3// | 5/ 5// (5// 5/) 3/ 5 0/ 5// 3// | 4/ 4/ 4/ 4/ 3 0/. 1// | 2/ 3// (4// 4/) 1/ 2 - |\nQ3: 0 0 2\'/ 1\'// (1\'// 1\'/) 6/ | 3 0/. 3// 2\'/ 1\'// (1\'// 1\'/) 7/ | 1\' 3\' 3\' 1\' | 4 0 7/ 1\'/ 2\' |\n'
  const adj317bLay = layoutScore(parseJps(adj317bSrc), adj317bCfg)
  const overflowNotes = adj317bLay.pages.flatMap((page) =>
    page.notes.filter((n) => n.x + n.width > page.width - adj317bCfg.margin_right + 0.5),
  )
  check('adj317b 多声部内容不越页右界', overflowNotes.length === 0, overflowNotes.slice(0, 3).map((n) => `v${n.id.voice} right=${(n.x + n.width).toFixed(1)}`).join(','))
}

// ---- 67. 多声部空间优先末节线贴右钳制（adj317c，与单声部 atEnd 一致） ----
console.log('[67] multi-voice space end-bar to right clamp (adj317c)')
{
  const cfg317c = { ...DUR_CFG, noteSpaceLayout: 'space' as const, align_min_bars: 2 }
  const src317c =
    'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 3/ 5/ 5 3 | 1 - - - |\nQ2: 5/ 6/ 1 3 1 | 5 - - - |\nQ: 1 2 3 4 | 5 6 5 - |\n'
  const lay317c = layoutScore(parseJps(src317c), cfg317c)
  const page = lay317c.pages[0]
  const rightEdge = page.width - cfg317c.margin_right - 0.55
  // align_min_bars=2 → numBars=2 ≥ 2 → 多声部 + 单声部末线都撑满贴右
  const edgeBars = page.barlines.filter((b) => Math.abs(b.x - rightEdge) < 0.6)
  check('adj317c align_min_bars=2 多声部/单声部末节线均贴右钳制（≤0.6px 容差）', edgeBars.length >= 2, `edgeBars=${edgeBars.length} (${edgeBars.map((b) => `v${b.id.voice}x=${b.x.toFixed(2)}`).join(',')})`)
}

// ---- 68. 多声部自然宽（行小节数 < align_min_bars，adj318） ----
console.log('[68] multi-voice space natural width when bars < align_min_bars (adj318)')
{
  const cfg318 = { ...DUR_CFG, noteSpaceLayout: 'space' as const } // 默认 align_min_bars=4
  const src318 =
    'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 3/ 5/ 5 3 | 1 - - - |\nQ2: 5/ 6/ 1 3 1 | 5 - - - |\n'
  const lay318 = layoutScore(parseJps(src318), cfg318)
  const page = lay318.pages[0]
  const rightEdge = page.width - cfg318.margin_right - 0.55
  const lastVbBarX = Math.max(...page.voiceBlocks.flatMap((vb) => [] /* lines not on vb */))
  // 取多声部最右节线（voice 2 最后一条）
  const v2LastBar = page.barlines.filter((b) => b.id.voice === 2).reduce((mx, b) => Math.max(mx, b.x), 0)
  // 多声部末线应 < rightEdge（自然宽留白，不撑满）；单声部行无（仅 Q1/Q2）
  const naturalOk = v2LastBar < rightEdge - 1 // 至少留 1px 行尾留白
  check('adj318 多声部行小节数<align_min_bars 时末线不撑满（自然宽）', naturalOk, `v2LastBar=${v2LastBar.toFixed(2)} rightEdge=${rightEdge.toFixed(2)} gap=${(rightEdge - v2LastBar).toFixed(2)}`)
}

// ---- 68b. 单声部空间优先自然宽（行小节数 < align_min_bars，adj354） ----
console.log('[68b] single-voice space natural width when bars < align_min_bars (adj354)')
{
  const cfgSpaceNat = { ...DUR_CFG, noteSpaceLayout: 'space' as const } // 默认 align_min_bars=4
  const srcSpaceNat = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 5 - |\n' // 2 小节 < 4
  const laySpaceNat = layoutScore(parseJps(srcSpaceNat), cfgSpaceNat)
  const pageSpace = laySpaceNat.pages[0]
  const rightEdgeSpace = pageSpace.width - cfgSpaceNat.margin_right - 0.55
  const lastBarSpace = Math.max(...pageSpace.barlines.map((b) => b.x))
  // 单声部末节线应 < rightEdge（自然宽留白，不撑满）——修复前恒撑满贴右
  check('adj354 单声部空间优先 行小节数<align_min_bars 时末线不撑满（自然宽）', lastBarSpace < rightEdgeSpace - 1, `lastBar=${lastBarSpace.toFixed(2)} rightEdge=${rightEdgeSpace.toFixed(2)} gap=${(rightEdgeSpace - lastBarSpace).toFixed(2)}`)
  // 对照：align_min_bars=2 → 2 小节 ≥ 2 → 撑满贴右
  const cfgSpaceStretch = { ...DUR_CFG, noteSpaceLayout: 'space' as const, align_min_bars: 2 }
  const laySpaceStretch = layoutScore(parseJps(srcSpaceNat), cfgSpaceStretch)
  const lastBarStretch = Math.max(...laySpaceStretch.pages[0].barlines.map((b) => b.x))
  check('adj354 单声部空间优先 align_min_bars=2 时 2 小节撑满贴右', Math.abs(lastBarStretch - rightEdgeSpace) < 0.6, `lastBar=${lastBarStretch.toFixed(2)} rightEdge=${rightEdgeSpace.toFixed(2)}`)
}

// ---- 68c. @@ 恢复默认音色 = 第一音色（adj354） ----
console.log('[68c] @@ restore default instrument = first instrument (adj354)')
{
  // 有 Y：默认用第一个 Y（优先于传入默认）
  const rY = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 长笛\nQ: 1 2 @大钢琴 3 4 @@ 5 6 |\n')
  const seqY = buildPlaySequence(rY, layoutScore(rY, DUR_CFG), 120, undefined, '八音盒')
  check('adj354 有 Y 时 @@ 用第一个 Y（长笛）而非传入（八音盒）', seqY.events[4]?.instrument === '长笛' && seqY.events[5]?.instrument === '长笛', `${seqY.events[4]?.instrument},${seqY.events[5]?.instrument}`)
  // 无 Y：@@ 用调用方传入的第一音色（defaultInstrumentRef）
  const rNoY = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 @大钢琴 3 4 @@ 5 6 |\n')
  const seqNoY = buildPlaySequence(rNoY, layoutScore(rNoY, DUR_CFG), 120, undefined, '八音盒')
  check('adj354 无 Y 时 @@ 用传入第一音色（八音盒）', seqNoY.events[4]?.instrument === '八音盒' && seqNoY.events[5]?.instrument === '八音盒', `${seqNoY.events[4]?.instrument},${seqNoY.events[5]?.instrument}`)
  // 无 Y 且无传入默认：@@ 回退空串（播放端路由→第一音色库第一音色钢琴）
  const seqNoYNoRef = buildPlaySequence(rNoY, layoutScore(rNoY, DUR_CFG), 120)
  check('adj354 无 Y 且无传入默认时 @@ 回退空串', seqNoYNoRef.events[4]?.instrument === '', `${seqNoYNoRef.events[4]?.instrument}`)
}

// ---- 68d. 单声部空间优先自然宽——小节宽不小于上一行对应小节（adj355） ----
console.log('[68d] single-voice space natural row measure width >= previous row (adj355)')
{
  // 每小节 16 个十六分音符（自然本体宽 ~178px），3 小节：行1=2小节(≥align_min_bars=2，撑满)、行2=1小节(自然)
  const cfg68d = { ...DUR_CFG, noteSpaceLayout: 'space' as const, align_min_bars: 2 }
  const src68d =
    'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1//2//3//4//5//6//7//8//9//10//11//12//13//14//15//16// | 1//2//3//4//5//6//7//8//9//10//11//12//13//14//15//16// | 1//2//3//4//5//6//7//8//9//10//11//12//13//14//15//16// |\n'
  const lay68d = layoutScore(parseJps(src68d), cfg68d)
  const page68d = lay68d.pages[0]
  const notes68d = page68d.notes
  // 上一行（小节 1）内容宽 vs 自然行（小节 3）内容宽——自然行应被扩宽到不小于上一行对应小节
  const bar1Notes = notes68d.filter((n) => n.barIndex === 0)
  const bar2Notes = notes68d.filter((n) => n.barIndex === 2)
  const spanOf = (arr: { x: number; rightX?: number; width?: number }[]) =>
    arr.length > 1 ? Math.max(...arr.map((n) => (n.rightX ?? n.x + (n.width ?? 0)) )) - Math.min(...arr.map((n) => n.x)) : 0
  const spanBar1 = spanOf(bar1Notes)
  const spanBar2 = spanOf(bar2Notes)
  // 自然行小节内容宽应 ≥ 上一行对应小节内容宽（不窄于它）；且确实被扩宽（> 纯自然 16 分宽 ~178）
  check('adj355 natural 行小节宽 >= 上一行对应小节（扩宽）', bar2Notes.length > 0 && spanBar2 >= spanBar1 - 1 && spanBar2 > 180, `spanBar1=${spanBar1.toFixed(2)} spanBar2=${spanBar2.toFixed(2)} bar1n=${bar1Notes.length} bar2n=${bar2Notes.length}`)
}

// ---- 68e. 跨组：第 2 行自然宽对齐第 1 行对应小节（adj355） ----
console.log('[68e] two-line: row2 natural measures align to row1 (adj355)')
{
  const cfg68e = { ...DUR_CFG, noteSpaceLayout: 'space' as const, align_min_bars: 4 }
  const src68e = `V: 1.0
B: t
D: C
P: 4/4
Q: 6. 3'/ 2'&shy 3' | 2'. 1'/ 1' @大钢琴@ &zkh 1// 2// 3// 5// | 1'/. 1'// 1'/ (2'// 3'//) 3' 2'/ 1'/ | 7/. 7// 7/ 6/ 5 0// 3// 5// 6// |
Q: 1 2/ 3/ 5 6, | 1- 0 0 &ykh ||`
  const lay68e = layoutScore(parseJps(src68e), cfg68e)
  const notes68e = lay68e.pages[0].notes
  const spanOf68e = (gid: number, b: number) => {
    const ns = notes68e.filter((n) => n.id.group === gid && n.barIndex === b)
    if (ns.length < 2) return 0
    const xs = ns.map((n) => n.x)
    const xe = ns.map((n) => n.rightX ?? n.x + (n.width ?? 0))
    return Math.max(...xe) - Math.min(...xs)
  }
  const q1b0 = spanOf68e(0, 0)
  const q1b1 = spanOf68e(0, 1)
  const q2b0 = spanOf68e(1, 0)
  const q2b1 = spanOf68e(1, 1)
  check('adj355 跨组：Q2 第1小节宽接近 Q1 第1小节（不窄）', q2b0 >= q1b0 * 0.9, `q1b0=${q1b0.toFixed(1)} q2b0=${q2b0.toFixed(1)}`)
  check('adj355 跨组：Q2 第2小节宽接近 Q1 第2小节（不窄）', q2b1 >= q1b1 * 0.9, `q1b1=${q1b1.toFixed(1)} q2b1=${q2b1.toFixed(1)}`)
}

// ---- 69. 多声部 rightX 含附点+增时线（adj319，色块按段不消失 + 显示占宽） ----
console.log('[69] multi-voice note.rightX includes dot/aug display width (adj319)')
{
  const lay319 = layoutScore(
    parseJps('V: 1.0\nB: t\nD: C\nJ: 90\nP: 4/4\nQ3: 0 0 0 5/ 6/ | 5// 6// (5. 5) - | 6 - - - |\n'),
    { ...DUR_CFG, noteSpaceLayout: 'space' as const },
  )
  const notes = lay319.pages[0].notes.filter((n) => n.id.voice === 3)
  // (5. 5) 附点音符：rightX - x 应 >= 本体宽 + dotBodyW（约 8.06 + 2.89 = 10.95）
  const dotNote = notes.find((n) => n.token.kind === 'note' && n.token.dots > 0)
  const dotDisplay = dotNote ? (dotNote.rightX ?? 0) - dotNote.x : -1
  check('adj319 附点音符 rightX - x 含 dotBodyW（≥ 本体+dotBodyW）', !!dotNote && dotDisplay >= 10.5, `dotNote x=${dotNote?.x.toFixed(2)} rightX=${dotNote?.rightX?.toFixed(2)} display=${dotDisplay.toFixed(2)}`)
  // 增时线音符 `6 - - -`：第一根 - 后 rightX - x 应含 1×augBodyW
  const augNote = notes.find((n) => n.token.kind === 'note' && n.token.augmentCount > 0)
  const augDisplay = augNote ? (augNote.rightX ?? 0) - augNote.x : -1
  check('adj319 增时线音符 rightX - x 含 augBodyW（≥ 本体+augBodyW）', !!augNote && augDisplay >= 14, `augNote x=${augNote?.x.toFixed(2)} rightX=${augNote?.rightX?.toFixed(2)} display=${augDisplay.toFixed(2)} augCount=${augNote?.token.augmentCount}`)
  // （第 2 修复）附点音符 = 单段色块，width = 显示占宽（rightX − x，覆盖附点）→ 色块不消失
  const seq319 = buildPlaySequence(
    parseJps('V: 1.0\nB: t\nD: C\nJ: 90\nP: 4/4\nQ1: 5/. 3 |\nQ3: 0 0 0 5/ 6/ | 5// 6// (5. 5) - | 6 - - - |\n'),
    lay319,
    90,
  )
  const allSegs319 = seq319.events.flatMap((e) => e.playheadSegs ?? [])
  // 附点音符：单段，width = 显示占宽（≥ 本体+dotBodyW）
  const dotNote319 = seq319.events.find((e) => e.placed.token?.kind === 'note' && e.placed.token.dots > 0)
  const dotSeg319w = dotNote319?.playheadSegs?.[0]?.width ?? -1
  check('adj319 附点音符色块宽 = 显示占宽（覆盖附点）', dotSeg319w >= 10.5, `dotW=${dotSeg319w.toFixed(2)} (should ≈ rightX−x)`)
  // （第 3）双附点是一个时值元素：色块宽含两个附点圆
  const ddotLay = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nJ: 90\nP: 4/4\nQ1: 5.. 3 |\n'), { ...DUR_CFG, noteSpaceLayout: 'space' as const })
  const ddot = ddotLay.pages[0].notes.find((n) => n.token.kind === 'note' && (n.token as any).dots === 2)
  const ddotW = ddot ? (ddot.rightX ?? ddot.x) - ddot.x : -1
  check('adj320 双附点作为一个时值元素（色块宽含双附点）', !!ddot && ddotW > 12, `ddotW=${ddotW.toFixed(2)}`)
}
// ---- 70. 按时值元素分块：5--- 按拍分块、5. 音符+附点分块（adj320 恢复拍段分块） ----
console.log('[70] playhead seg blocks by time-value element (adj320)')
{
  const lay70 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nJ: 90\nP: 4/4\nQ1: 5--- 5. 3 |\n'), { ...DUR_CFG, noteSpaceLayout: 'space' as const })
  const seq70 = buildPlaySequence(parseJps('V: 1.0\nB: t\nD: C\nJ: 90\nP: 4/4\nQ1: 5--- 5. 3 |\n'), lay70, 90)
  // 5---（4 拍）→ 4 块
  const augEv = seq70.events.find((e) => e.placed.token?.kind === 'note' && (e.placed.token as any).augmentCount > 0)
  const augBlocks = augEv?.playheadSegs?.length ?? 0
  check('adj320 增时线音符 5--- 按时值分块（4 块）', augBlocks === 4, `blocks=${augBlocks}`)
  // 5.（附点）→ 1 块（附点并入主音符）
  const dotEv = seq70.events.find((e) => e.placed.token?.kind === 'note' && (e.placed.token as any).dots === 1)
  const dotBlocks = dotEv?.playheadSegs?.length ?? 0
  check('adj320 附点音符 5. 附点并入主音符（1 块）', dotBlocks === 1, `blocks=${dotBlocks}`)
}

// ---- 71. 连音线连接点规则（adj321）：(X) 单音符终止前一连音 + 起新连音 ----
console.log('[71] slur junction rule (adj321)')
{
  // (1 (2) 3) → 1→2 + 2→3（两条连续）；(1(2 3)) → 1→3外层 + 2→3内层；(1 (2 3) 4) → 1→4 + 2→3
  const j1 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ( 1 ( 2 ) 3 ) |\n'), DUR_CFG)
  check('adj321 (1 (2) 3) 连接点：1→2 + 2→3（2 条连续）', j1.pages[0].slurs.length === 2, `got ${j1.pages[0].slurs.length}`)
  const j2 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ( 1 ( 2 3 ) ) |\n'), DUR_CFG)
  check('adj321 (1(2 3)) 真嵌套：1→3外层 + 2→3内层（2 条）', j2.pages[0].slurs.length === 2, `got ${j2.pages[0].slurs.length}`)
  const j3 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ( 1 ( 2 3 ) 4 ) |\n'), DUR_CFG)
  check('adj321 (1 (2 3) 4) 真嵌套：1→4外层 + 2→3内层（2 条）', j3.pages[0].slurs.length === 2, `got ${j3.pages[0].slurs.length}`)
}
// ---- 72. 用户谱跨行连接点：上一行 6, → 下一行第一个 6,（连接点）+ 连接点 → 下一行第二个 6, ----
console.log('[72] user cross-line slur junction (adj321)')
{
  const lay72 = layoutScore(
    parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 2/ 1/ (7,/ 6,// 5,//) (6,- |\nQ: (6,)--- | 6)- 0 (3/ 6// 7//) |\n'),
    { ...DUR_CFG, noteSpaceLayout: 'space' as const },
  )
  const notes72 = lay72.pages[0].notes
  // 行1 idx5(6, aug1) ：x 在 362 附近；行2 idx6(6, aug3) 是连接点：x=66；行2 idx7(6 aug1)
  const idx5 = notes72.find((n) => n.id.index === 5)
  const idx6 = notes72.find((n) => n.id.index === 6)
  const idx7 = notes72.find((n) => n.id.index === 7)
  // 连接点产生的两条：idx5→idx6（跨行，终止于连接点） + idx6→idx7（连接点起新连音）
  // 用 slurs.x1 与对应音符 x 比对（跨行 idx5→idx6 两半 + idx6→idx7）
  const slurs72 = lay72.pages[0].slurs
  // idx6→idx7 同行连音：x1≈idx6.x+halfDig、x2≈idx7.x+halfDig
  const j67 = slurs72.find((s) => Math.abs(s.x1 - (idx6.x + halfDig + NS_S)) < 1 && Math.abs(s.x2 - (idx7.x + halfDig - NS_S)) < 1)
  check('adj321 用户谱：连接点 → 下一行第二个 6,（idx6→idx7）', !!j67, `x1=${j67?.x1?.toFixed(1)} x2=${j67?.x2?.toFixed(1)} (idx6.x=${idx6?.x?.toFixed(1)} idx7.x=${idx7?.x?.toFixed(1)})`)
}

// ---- 73. 深嵌套连接点（adj321b）：depth≥2 时不阻断连接点 ----
console.log('[73] deep-nested junction (adj321b)')
{
  // 大段谱：(4#// 3// | 2/ 1/ (7,/ 6,// 5,//) (6,- | 1 2 (6,)- | 6,)- ...，连接点 (6,) 在深嵌套内
  const lay73 = layoutScore(
    parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 - - 0/ (6,// 7,//) | (1/ 3/ 2/ 1/) (3. 1/) | 2 - - 0/ (4#// 3// | 2/ 1/ (7,/ 6,// 5,//) (6,- |\nQ: 1 2 (6,)- | 6,)- 0 (3/ 6// 7//) |\n'),
    { ...DUR_CFG, noteSpaceLayout: 'space' as const },
  )
  const notes73 = lay73.pages[0].notes
  // 行1 idx19(6, aug1) = (6,- 的 6,；行2 idx22(6, aug1) = (6,)- 的连接点；idx23(6, aug1) = 第二个 6,
  const n19 = notes73.find((n) => n.id.index === 19)
  const n22 = notes73.find((n) => n.id.index === 22)
  const n23 = notes73.find((n) => n.id.index === 23)
  const slurs73 = lay73.pages[0].slurs
  // 连接点两条：跨行 idx19→idx22（行2 右半到 idx22）+ 同行 idx22→idx23
  const j2223 = slurs73.find((s) => Math.abs(s.x1 - (n22.x + halfDig + NS_S)) < 1 && Math.abs(s.x2 - (n23.x + halfDig - NS_S)) < 1)
  const j1922r = slurs73.find((s) => s.half === 'r' && Math.abs(s.x2 - (n22.x + halfDig)) < 1.5)
  check('adj321b 深嵌套连接点：idx22→idx23（连接点起新连音）', !!j2223, `x1=${j2223?.x1?.toFixed(1)} x2=${j2223?.x2?.toFixed(1)} (n22=${n22?.x?.toFixed(1)} n23=${n23?.x?.toFixed(1)})`)
  check('adj321b 深嵌套连接点：跨行右半终止于 idx22（连接点）', !!j1922r, `x2=${j1922r?.x2?.toFixed(1)} (n22=${n22?.x?.toFixed(1)})`)
}

// ---- 74. 采样色库元数据 + 联网分类（adj323） ----
console.log('[74] sampler library metadata & network classify (adj323)')
{
  check('adj323 getSamplerLibrary 命中 id', getSamplerLibrary('violin').id === 'violin')
  check('adj323 getSamplerLibrary 未知 id 回退默认库', getSamplerLibrary('__nope__').id === SAMPLER_LIBRARIES[0].id)
  check('adj323 SAMPLER_LIBRARIES 首个为默认', SAMPLER_LIBRARIES[0].id === getSamplerLibrary().id)
  check('adj323 离线分类', classifyNetwork({ online: false }) === 'offline')
  check('adj323 WiFi 分类', classifyNetwork({ online: true, type: 'wifi' }) === 'wifi')
  check('adj323 以太网分类', classifyNetwork({ online: true, type: 'ethernet' }) === 'ethernet')
  check('adj323 慢网分类（3g）', classifyNetwork({ online: true, effectiveType: '3g' }) === 'slow')
  check('adj323 未知在线分类', classifyNetwork({ online: true }) === 'unknown')
}

// ---- 75. @...@ 乐器语法 + 旧写法告警（adj337/338） ----
console.log('[75] @...@ instrument syntax & legacy warning (adj337/338)')
{
  const f1 = formatLine('Q: @电吉他(清音)@ 1 |')
  check('adj337 @...@ 格式化原样（不拆括号）', f1.includes('@电吉他(清音)@') && !f1.includes('@电吉他 (清音)'), f1)
  const f2 = formatLine('Q: 1 @小提琴@ 2 |')
  check('adj337 @...@ 格式化原样（单乐器）', f2.includes('@小提琴@'), f2)
  const r1 = parseJps('V: 1.0\nB: t\nD: C\nQ: @小提琴 |') // 旧写法（无尾 @）
  check('adj338 旧写法 @小提琴 触发告警', r1.errors.some((e) => (e as { severity?: string }).severity === 'warning'), `errors=${r1.errors.length}`)
  const r2 = parseJps('V: 1.0\nB: t\nD: C\nQ: @小提琴@ |') // 新语法
  check('adj338 新语法 @小提琴@ 无告警', !r2.errors.some((e) => (e as { severity?: string }).severity === 'warning'), `errors=${r2.errors.length}`)
}

console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)

