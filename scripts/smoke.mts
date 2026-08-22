/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, formatJps, formatLine, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig, metaAreaH, extractJpsConfig, mergeJpsConfig, writeJpsConfig } from '../src/engine/index.ts'
import { splitTempo } from '../src/engine/parser/parser.ts'
import { buildPlaySequence, inferBpm } from '../src/engine/playback/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '../src/engine/cursorMap.ts'
import { computeRowTops, computeRowGuides, dragDelta, clamp, GUIDE_LIMITS_EX } from '../src/engine/layout/guides.ts'
import { DOT_R, DOT_R_DOT, H_GAP, INNER_GAP, BEAM_H, LAYER_GAP, VOLTA_BAR_GAP, NOTE_COMMENT_FONT_RATIO, noteScaleOf, lowDotY } from '../src/engine/layout/spacing.ts'
import { clampMetaPos } from '../src/engine/layout/metaAnchors.ts'
import { computeBeamsForTest } from '../src/engine/render/index.ts'
import { insertLineHeader, lineColOf, isLineHeaderKey } from '../src/editor/shortcuts.ts'
import { highlightCode } from '../src/editor/highlight.ts'
import {
  createHistoryState,
  recordEdit,
  undoHistory,
  redoHistory,
  DEFAULT_HISTORY_LIMIT,
  HISTORY_MERGE_MS,
  type HistoryState,
} from '../src/editor/history.ts'

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

// ---- 6. 错误处理 ----
console.log('[6] error handling')
const re = parseJps('V: 1.0\nB: t\nC: 歌词先行\nQ: 1 2\n')
check('C 行先于 Q 行报错', re.errors.some((e) => e.message.includes('缺少对应')))
const ru = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 @@\n')
check('孤立 @ 报错', ru.errors.some((e) => e.severity === 'warning'))

// ---- 7. 排版（M1a） ----
console.log('[7] layout (M1a)')
const lay = layoutScore(r2, defaultPageConfig)
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
const lay2 = layoutScore(rc2, defaultPageConfig)
const svg2 = renderScoreToSvg(lay2)[0]
const cnt2 = (svg2.match(/data-notepos=/g) ?? []).length
check('复杂行 6 个可见音符（8 隐藏休止不画）', cnt2 === 6, `got ${cnt2}`)
check('隐藏休止符不可播放', lay2.pages[0].notes.find((n) => n.token.kind === 'rest')?.playable === false)
check('SVG 含增时线 "-" 字符', svg2.includes('>-<'))
const barRects = (svg2.match(/width="(?:0\.9|1\.4)" height="22\.9"/g) ?? []).length
check('小节线竖线 3 条（单线 1 + 双线 2：细+粗）', barRects === 3, `got ${barRects}`)

// ---- 9. 分页（M1b） ----
console.log('[9] pagination (M1b)')
const multi = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n[fenye]\nQ: 2 3 4 5 |\n')
const layM = layoutScore(multi, defaultPageConfig)
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
const layW = layoutScore(wide, defaultPageConfig)
const rows = new Set(layW.pages[0].notes.map((n) => n.y))
check('超宽行自动断成多行', rows.size >= 2, `rows=${rows.size}`)
// 音符段终点 = 数字中心 + 半段宽（x + 6 + width/2）
const segEnd = (n: { x: number; width: number }) => n.x + 6 + n.width / 2
const maxX = Math.max(...layW.pages[0].notes.map(segEnd))
check('音符不超出右边距', maxX <= 595.28 - 80, `maxX=${maxX}`)
check('同页多行 y 递增', [...rows].sort((a, b) => a - b).every((v, i, arr) => i === 0 || v > arr[i - 1]))

// ---- 11. 歌词对齐（M1c） ----
console.log('[11] lyric alignment (M1c)')
const layL = layoutScore(r2, defaultPageConfig) // 两只老虎
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
const layX = layoutScore(xiaoxing, defaultPageConfig)
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
check('非 Q 行（歌词行）不联动', codePosToNoteId(linkCode, 44) === null, String(codePosToNoteId(linkCode, 44)))
// 分页场景：'V: 1.0\n'=7, 'B: t\n'=5(→12), 'Q: 1 2 |\n'=9(→21), '[fenye]\n'=8(→29)，Q2 行从 29 开始
const linkCode2 = 'V: 1.0\nB: t\nQ: 1 2 |\n[fenye]\nQ: 3 4 |\n'
const idPage1 = codePosToNoteId(linkCode2, 32) // Q2 行 '3' 后
check('分页后第 2 页音符 id page=1、index=2（全局计数）', idPage1 === '1_1_1_2', String(idPage1))
const posPage1 = noteIdToCodePos(linkCode2, '1_1_1_2')
check('第 2 页音符反向定位在 Q2 行', posPage1 === 32, String(posPage1))

// ---- 15. 播放序列（M4） ----
console.log('[15] play sequence (M4)')
const mkSeq = (q: string, bpm = 120) => {
  const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
  const lay = layoutScore(r, defaultPageConfig)
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

// 跳房子（第二遍跳过 [ ] 段；adj23：跳房子 [ 须在小节线后，音符后的 [ 是倚音）
const ps2 = mkSeq('|: 1 2 | [ 3 4 ] 5 6 :|')
check('跳房子展开 10 事件', pitchSeq(ps2) === 'C4,D4,E4,F4,G4,A4,C4,D4,G4,A4', pitchSeq(ps2))

// 终止线 || 停止
const ps3 = mkSeq('1 2 | 3 4 || 5 6 |')
check('终止线后停止（4 事件）', ps3.events.length === 4, `got ${ps3.events.length}`)

// 隐藏休止符占时不发声
const ps4 = mkSeq('1 8 3 |')
check('隐藏休止符事件仍占位（3 事件）', ps4.events.length === 3, `got ${ps4.events.length}`)
check('隐藏休止符 audioPitch=null', ps4.events[1].placed.audioPitch === null, String(ps4.events[1].placed.audioPitch))

// bpm 推断
check('J:96 → 96', inferBpm(parseJps('V: 1.0\nB: t\nJ: 96\n')) === 96)
check('无 J → 90', inferBpm(parseJps('V: 1.0\nB: t\n')) === 90)
check('J 文字 → 90', inferBpm(parseJps('V: 1.0\nB: t\nJ: 欢快的\n')) === 90)

// ---- 16. 页面设置（M5） ----
console.log('[16] page config (M5)')
// 横版纸张
const cfgH = { ...defaultPageConfig, page: 'A4_horizontal' as const }
const layH = layoutScore(r2, cfgH)
check('横版 A4 尺寸 841.89×595.28', layH.pages[0].width === 841.89 && layH.pages[0].height === 595.28, `${layH.pages[0].width}×${layH.pages[0].height}`)

// 行距配置（adj79 拆分：有歌词行行尾用曲部与上一行词部间距，无歌词行用曲部与曲部间距）
// r2（两只老虎）有歌词 → 第二行行高受 height_ciqu_lyric 影响
const y1 = layoutScore(r2, defaultPageConfig).pages[0].notes[14].y
const y2 = layoutScore(r2, { ...defaultPageConfig, height_ciqu_lyric: 200 }).pages[0].notes[14].y
check('曲部与上一行词部间距增大 → 第二行更靠下（有歌词）', y2 - y1 > 50, `diff=${y2 - y1}`)
// 无歌词行：行尾间距走 height_ciqu（曲部与曲部间距）；4 行谱保证换行（首行 24 音符）
const noLyric = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const rowY = (lay: ReturnType<typeof layoutScore>) =>
  [...new Set(lay.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
const yN1 = rowY(layoutScore(noLyric, defaultPageConfig))[1]
const yN2 = rowY(layoutScore(noLyric, { ...defaultPageConfig, height_ciqu: 200 }))[1]
check('曲部与曲部间距增大 → 第二行更靠下（无歌词）', yN2 - yN1 > 50, `diff=${yN2 - yN1}`)

// 音符字体（adj105：由字形 a/b/c 改为字体名，直接用于 SVG font-family）
const svgA = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'Georgia' }))[0]
const svgB = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'Microsoft YaHei' }))[0]
const svgC = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'KaiTi' }))[0]
check('音符字体 = 设置的字体名（Georgia）', svgA.includes('font-family="Georgia"'))
check('音符字体 = 设置的字体名（微软雅黑，默认）', svgB.includes('Microsoft YaHei') && !svgB.includes('Georgia'))
check('音符字体 = 设置的字体名（KaiTi）', svgC.includes('KaiTi'))

// 按页覆盖行距 heights['a1'] → 第 2 页 ciqu=150
const cfgPages = { ...defaultPageConfig, heights: { a1: [13, 10, 150, 0] } }
const multiP = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 |\n[fenye]\nQ: 5 6 7 1 | 5 6 7 1 |\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layP = layoutScore(multiP, cfgPages)
check('heights 分页 2 页', layP.pages.length === 2)
const rowsOverride = [...new Set(layP.pages[1].notes.map((n) => n.y))].sort((a, b) => a - b)
const layPDef = layoutScore(multiP, defaultPageConfig)
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
const layYs = layoutScore(rYs, defaultPageConfig)
const svgYs = renderScoreToSvg(layYs)[0]
check('乐器渲染在副标题下（data-meta=instrument_i）', svgYs.includes('data-meta="instrument_0"') && svgYs.includes('data-meta="instrument_1"'), '')
check('说明渲染在谱尾（data-meta=notes）', svgYs.includes('data-meta="notes"') && svgYs.includes('这是一段说明') && svgYs.includes('第二行说明'), '')
// 说明文字位置：最后一页下边距线上方（y < height - margin_bottom）
const ysNotesEl = /data-meta="notes" data-notes-line="0" x="([\d.]+)" y="([\d.]+)"/.exec(svgYs)
check('说明默认在下边距线上方', ysNotesEl !== null && Number(ysNotesEl[2]) < layoutScore(rYs, defaultPageConfig).pages[0].height - defaultPageConfig.margin_bottom, `y=${ysNotesEl?.[2]}`)

// ---- 16c. 谱面级设置 # jps-config（adj83） ----
console.log('[16c] per-score settings # jps-config (adj83)')
const codeW = writeJpsConfig(ysSrc, { ...defaultPageConfig, margin_top: 123, metaPos: { notes: { x: 10, y: -30 } } })
check('writeJpsConfig 追加 # jps-config 行', codeW.includes('# jps-config:'), codeW.split('\n').slice(-2).join('|'))
const exCfg = extractJpsConfig(codeW)
check('extractJpsConfig 回读 margin_top=123', exCfg !== null && exCfg.margin_top === 123, JSON.stringify(exCfg))
check('extractJpsConfig 回读 metaPos.notes', exCfg !== null && exCfg.metaPos?.notes?.x === 10 && exCfg.metaPos?.notes?.y === -30, JSON.stringify(exCfg?.metaPos))
const mgCfg = mergeJpsConfig(codeW, null)
check('mergeJpsConfig 谱面设置优先（margin_top=123）', mgCfg.margin_top === 123 && mgCfg.note_size === 18, `mt=${mgCfg.margin_top}`)
check('无 # 设置时回退默认（margin_top=80）', mergeJpsConfig(ysSrc, null).margin_top === 80, `mt=${mergeJpsConfig(ysSrc, null).margin_top}`)
const codeW2 = writeJpsConfig(codeW, { ...defaultPageConfig, margin_top: 200 })
check('writeJpsConfig 原位更新已有行（margin_top=200，不重复追加）', codeW2.split('\n').filter((l) => l.startsWith('# jps-config:')).length === 1 && extractJpsConfig(codeW2)?.margin_top === 200, '')
// 损坏 JSON 忽略（回退默认）
const badCfg = mergeJpsConfig('V: 1.0\n# jps-config:{bad json\nQ: 1 2 3 4 |\n', null)
check('损坏 # jps-config 静默回退默认', badCfg.margin_top === 80, `mt=${badCfg.margin_top}`)

// ---- 17. 多声部（M7a） ----
console.log('[17] voice blocks (M7a)')
const vc = parseJps('V: 1.0\nB: 多声部测试\nD: C\nP: 4/4\nQ1: 1 2 3 4 |\nC1: 男 声 歌 词\nQ2: 5 6 5 3 |\nC2: 女 声 歌 词\n')
const layV = layoutScore(vc, defaultPageConfig)
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
check('SVG 含声部标签', svgV.includes('声部1') && svgV.includes('声部2'))
// 命名声部
const vc2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1"男声": 1 2 3 4 |\nQ2"女声": 5 6 5 3 |\n')
const layV2 = layoutScore(vc2, defaultPageConfig)
const vb2 = layV2.pages[0].voiceBlocks[0]
check('命名声部解析', vb2?.voices[0]?.name === '男声' && vb2?.voices[1]?.name === '女声')
const svgV2 = renderScoreToSvg(layV2)[0]
check('SVG 含声部名称文本', svgV2.includes('男声') && svgV2.includes('女声'))
// 多声部+单声部混合
const vc3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nQ1: 5 6 5 3 |\nQ2: 3 4 5 1 |\nQ: 5 3 1 - |\n')
const layV3 = layoutScore(vc3, defaultPageConfig)
check('混合排版 1 个块 + 单声部组', layV3.pages[0].voiceBlocks.length === 1)
check('混合：总音符 15（末行 1- 为 1 音符+增时线）', layV3.pages[0].notes.length === 15, `got ${layV3.pages[0].notes.length}`)

// ---- 18. 跳房子（M7b） ----
console.log('[18] volta rendering (M7b)')
const volta = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |[ 3 4 ] 5 6 |\n')
const layVo = layoutScore(volta, defaultPageConfig)
const voBars = layVo.pages[0].barlines
check('跳房子起终点解析', voBars.some((b) => b.voltaStart?.open) && voBars.some((b) => b.voltaEnd))
const svgVo = renderScoreToSvg(layVo)[0]
// 跳房子线在 y = yTop-16 高度（adj50；adj59 线宽 1）
const voY = voBars.find((b) => b.voltaStart)!.yTop - VOLTA_BAR_GAP
const voltaLines = (svgVo.match(new RegExp(`y1="${voY}"[^>]*stroke-width="1"`, 'g')) ?? []).length
check('SVG 含跳房子线（起竖+横+终竖 ≥3）', voltaLines >= 3, `got ${voltaLines}`)
// 番号（小节线引号备注）与 [ 合并显示
const volta2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"1." [ 3 4 ] 5 6 |\n')
const layVo2 = layoutScore(volta2, defaultPageConfig)
const v2Bars = layVo2.pages[0].barlines.filter((b) => b.voltaStart)
check('番号与起点合并', v2Bars.length === 1 && v2Bars[0].comment === '1.')
const svgVo2 = renderScoreToSvg(layVo2)[0]
check('SVG 番号显示在线上方', svgVo2.includes('>1.<'))
// 未封闭 [/ 向右延伸
const volta3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |[ 3 4 5 6 |\n')
const layVo3 = layoutScore(volta3, defaultPageConfig)
const svgVo3 = renderScoreToSvg(layVo3)[0]
const vo3Start = layVo3.pages[0].barlines.find((b) => b.voltaStart)
const vo3Y = vo3Start ? vo3Start.yTop - VOLTA_BAR_GAP : NaN
const openLines = (svgVo3.match(new RegExp(`y1="${vo3Y}"[^>]*stroke-width="1"`, 'g')) ?? []).length
check('未封闭 [/ 只画起点+横线（2 条）', openLines === 2, `got ${openLines}`)

// ---- 19. 连音线（M7c） ----
console.log('[19] slurs (M7c)')
const slur = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) 4 |\n')
const laySl = layoutScore(slur, defaultPageConfig)
check('1 条连音线', laySl.pages[0].slurs.length === 1, `got ${laySl.pages[0].slurs.length}`)
const sl0 = laySl.pages[0].slurs[0]
check('连音线范围覆盖 2、3（x2 > x1）', sl0 !== undefined && sl0.x2 > sl0.x1, `${sl0?.x1}→${sl0?.x2}`)
const svgSl = renderScoreToSvg(laySl)[0]
check('SVG 含圆弧贝塞尔', svgSl.includes('<path d="M ') && svgSl.includes(' Q '))
// 嵌套
const slur2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 ( 3 4 ) 5 ) 6 |\n')
const laySl2 = layoutScore(slur2, defaultPageConfig)
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
const laySl3 = layoutScore(slur, { ...defaultPageConfig, lianyinxian_type: 2 })
const svgSl3 = renderScoreToSvg(laySl3)[0]
check('平顶样式：贝塞尔路径（C 弧线 + 平顶横线）', svgSl3.includes('<path d="M') && svgSl3.includes(' C ') && svgSl3.includes(' L '), '')
const s3Flat = laySl3.pages[0].slurs[0]
check('平顶样式：两端弧线过渡到平顶线 y-7', svgSl3.includes(`M ${s3Flat.x1} ${s3Flat.y} C`) && svgSl3.includes(` ${(s3Flat.y - 7).toFixed(1)} C `) && svgSl3.includes(' C ') && svgSl3.includes(`"`), svgSl3.slice(0, 250))
// adj54：自动样式按「音符单位数」判断（增时线/附点折算进长度，>4 单位平顶）
const slAuto = (q: string) => layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), defaultPageConfig).pages[0].slurs[0]?.style
check('自动样式：4 个普通音符 = 4 单位 → 圆弧（边界不回归）', slAuto('( 1 2 3 4 ) 5 |') === 'arc', `got ${slAuto('( 1 2 3 4 ) 5 |')}`)
check('自动样式：5 个普通音符 = 5 单位 → 平顶（边界不回归）', slAuto('( 1 2 3 4 5 ) 6 |') === 'flat', `got ${slAuto('( 1 2 3 4 5 ) 6 |')}`)
check('自动样式：增时线折算（1- 2 3 4 = 5 单位）→ 平顶', slAuto('( 1- 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1- 2 3 4 ) 5 |')}`)
check('自动样式：附点折算（1. 2 3 4 = 4.5 单位）→ 平顶', slAuto('( 1. 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1. 2 3 4 ) 5 |')}`)
check('自动样式：附点折算边界（1. 2 3 = 3.5 单位）→ 圆弧', slAuto('( 1. 2 3 ) 4 |') === 'arc', `got ${slAuto('( 1. 2 3 ) 4 |')}`)
check('自动样式：增时线+附点（1-. 2 3 4 = 6 单位）→ 平顶', slAuto('( 1-. 2 3 4 ) 5 |') === 'flat', `got ${slAuto('( 1-. 2 3 4 ) 5 |')}`)
// adj56：同起点嵌套 —— ((3 2/) 4)：内层与外层都从 3 开始（内层 3→2、外层 3→4）
const slAdj56 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ((3 2/) 4) |\n')
const layAdj56 = layoutScore(slAdj56, defaultPageConfig)
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
const layDe = layoutScore(deco, defaultPageConfig)
check('渐强渐弱 1 条', layDe.pages[0].dynamics.length === 1, `got ${layDe.pages[0].dynamics.length}`)
check('渐强类型 crescendo', layDe.pages[0].dynamics[0]?.type === 'crescendo')
const svgDe = renderScoreToSvg(layDe)[0]
check('SVG 含 tr 颤音', svgDe.includes('>tr<'))
check('SVG 含 mp 力度', svgDe.includes('>mp<'))
check('SVG 含渐强楔形', svgDe.includes('Z" fill="none"'))
// adj58：&zkh 音符前加 (、&ykh 音符块（含增时线/附点）后加 )
const zkh = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&zkh 2-&ykh 3.&ykh 4 |\n')
const zkhNotes = zkh.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('&zkh/&ykh 解析到音符符号', zkh.errors.length === 0 && zkhNotes[0].symbols.includes('zkh') && zkhNotes[1].symbols.includes('ykh') && zkhNotes[2].symbols.includes('ykh'), JSON.stringify(zkhNotes.map((t) => t.symbols)))
const svgZkh = renderScoreToSvg(layoutScore(zkh, defaultPageConfig))[0]
check('&zkh 渲染左括号 (', svgZkh.includes('>(<'), svgZkh.slice(0, 200))
check('&ykh 渲染右括号 )', svgZkh.includes('>)<'), '')
// adj80：独立 zkh/ykh 写法（括号前后带空格）也归入音符：&zkh 6 - - -&ykh
const zkhSpace = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: &zkh 6 - - -&ykh |\n')
const zkhSpaceNote = zkhSpace.groups[0].music.tokens.find((t) => t.kind === 'note')
check('独立 &zkh 前置 + 独立 &ykh 后置（带空格）归入音符', zkhSpace.errors.length === 0 && !!zkhSpaceNote && zkhSpaceNote.symbols.includes('zkh') && zkhSpaceNote.symbols.includes('ykh'), JSON.stringify(zkhSpaceNote?.symbols))
// adj109：& 修饰符扩展（yc/bc/zy/dy/hx/shy/xhy/sby/xby/sby+/xby+/cy/cy+）解析 + 渲染
const r109 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&yc 2&bc 3&zy 4&dy 5&hx 6&shy 7&xhy 1&sby 2&xby 3&sby+ 4&xby+ 5&cy 6&cy+ | 1 2 3 4 |\n')
const n109 = r109.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('adj109 修饰符解析（yc bc zy dy hx shy xhy）', r109.errors.length === 0 && JSON.stringify(n109.slice(0, 7).map((t) => t.symbols[0])) === JSON.stringify(['yc', 'bc', 'zy', 'dy', 'hx', 'shy', 'xhy']), JSON.stringify(n109.slice(0, 7).map((t) => t.symbols)))
check('adj109 修饰符解析（sby xby sby+ xby+ cy cy+，含 + 后缀）', JSON.stringify(n109.slice(7, 13).map((t) => t.symbols[0])) === JSON.stringify(['sby', 'xby', 'sby+', 'xby+', 'cy', 'cy+']), JSON.stringify(n109.slice(7, 13).map((t) => t.symbols)))
const svg109 = renderScoreToSvg(layoutScore(r109, defaultPageConfig))[0]
check('adj109 yc 渲染点 + 半圆弧（circle + Q）', svg109.includes('<circle ') && / Q /.test(svg109), '')
// adj112：zy 为线形 >（非实心）、dy 仍实心倒三角 → 实心三角 = dy 1 + 滑音箭头 2 = 3
check('adj112 zy 线形 >、dy 实心（实心三角共 3）', (svg109.match(/Z" fill="#1b1b1b"/g) ?? []).length === 3, '')
// adj114/115：波音锯齿 = 斜上细线(stroke 1) + 斜下粗线(stroke 1.8)，共 4 个波音
// sby/xby 各 2 条下降段、sby+/xby+ 各 3 条 → stroke 1.8 共 10 条；xby 竖线细线
check('adj115 波音锯齿斜下粗线（stroke 1.8 ≥ 10 条）', (svg109.match(/stroke-width="1.8"/g) ?? []).length >= 10, '')
// adj116：下波音竖线为细线 stroke 0.8（xby/xby+ 各 1 条）
check('adj116 下波音竖线为细线（stroke 0.8 ≥ 2 条）', (svg109.match(/stroke-width="0.8"/g) ?? []).length >= 2, '')
check('adj109 滑音渲染弧线（Q）+ 箭头（fill 三角）', svg109.includes(' Q '), '')
check('adj112 tr 文本加粗', /font-weight="bold"[^>]*>tr</.test(svg109), '')
// adj81：括号加粗 + 垂直居中于数字中心（dominant-baseline=central @ 基线-0.4×字号）
// adj82：括号字号与音符一致（font-size=note_size，同字体）
const svgZkhSp = renderScoreToSvg(layoutScore(zkhSpace, defaultPageConfig))[0]
const zkhLPar = /<text x="([\d.]+)" y="([\d.]+)" dominant-baseline="central" font-weight="bold" font-size="([\d.]+)"[^>]*>\(<\/text>/.exec(svgZkhSp)
const zkhRPar = /<text x="([\d.]+)" y="([\d.]+)" dominant-baseline="central" font-weight="bold" font-size="([\d.]+)"[^>]*>\)<\/text>/.exec(svgZkhSp)
const zkhNoteY = layoutScore(zkhSpace, defaultPageConfig).pages[0].notes[0].y
check('括号加粗 + 垂直居中于数字（y = 基线-0.4×字号）', zkhLPar !== null && zkhRPar !== null && Math.abs(Number(zkhLPar[2]) - (zkhNoteY - defaultPageConfig.note_size * 0.4)) < 0.5 && Math.abs(Number(zkhRPar[2]) - (zkhNoteY - defaultPageConfig.note_size * 0.4)) < 0.5, `l=${zkhLPar?.[2]} r=${zkhRPar?.[2]} noteY=${zkhNoteY}`)
check('括号字号与音符一致（18）', zkhLPar !== null && zkhRPar !== null && Math.abs(Number(zkhLPar[3]) - defaultPageConfig.note_size) < 0.5 && Math.abs(Number(zkhRPar[3]) - defaultPageConfig.note_size) < 0.5, `lfs=${zkhLPar?.[3]} rfs=${zkhRPar?.[3]}`)
// adj80：右括号在最后一个增时线后面（增时线 x < 右括号 x）
const zkhAugXs = [...svgZkhSp.matchAll(/<text x="([\d.]+)"[^>]*>-<\/text>/g)].map((m) => Number(m[1]))
const zkhRParX = zkhRPar ? Number(zkhRPar[1]) : 0
check('右括号在最后一个增时线后面', zkhAugXs.length === 3 && zkhRParX > Math.max(...zkhAugXs), `rpar=${zkhRParX} aug=${zkhAugXs.join(',')}`)
// adj80：左括号与数字至少 1px 间距（左括号 x + 半字宽 ≤ 数字左缘 - 1）
const zkhDigitX = layoutScore(zkhSpace, defaultPageConfig).pages[0].notes[0].x
const zkhLParX = zkhLPar ? Number(zkhLPar[1]) : 0
check('左括号与数字间距 ≥1px（括号右缘 ≤ 数字左缘-1）', zkhLPar !== null && zkhLParX + defaultPageConfig.note_size * 0.5 <= zkhDigitX - 1, `lpar=${zkhLParX} digit=${zkhDigitX}`)
// adj84：休止符也支持括号（0/&zkh 左括号、0-&ykh 右括号、&zkh 0/ 前置）
const zkhRest = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0/&zkh 0-&ykh &zkh 0/ 2 3 4 |\n')
const restSyms = zkhRest.groups[0].music.tokens.filter((t) => t.kind === 'rest').map((t) => t.symbols.join(','))
check('休止符 &zkh/&ykh 解析到 symbols', zkhRest.errors.length === 0 && restSyms[0] === 'zkh' && restSyms[1] === 'ykh' && restSyms[2] === 'zkh', JSON.stringify(restSyms))
const svgRestPar = renderScoreToSvg(layoutScore(zkhRest, defaultPageConfig))[0]
check('休止符左括号渲染', (svgRestPar.match(/\(<\/text>/g) ?? []).length >= 2, '')
check('休止符右括号渲染', (svgRestPar.match(/\)<\/text>/g) ?? []).length >= 1, '')
// 歌词引号注释（adj58）：双引号文本为注释，不占歌词位，渲染在注释后歌词前面
const lr58 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 二"副歌"三 四\n')
const lr58c = lr58.groups[0].lyrics[0].chars
check('引号注释挂到注释后第一个歌词字', lr58.errors.length === 0 && lr58c.find((c) => c.text === '三')?.note === '副歌', JSON.stringify(lr58c.map((c) => ({ t: c.text, note: c.note }))))
const svgLr58 = renderScoreToSvg(layoutScore(lr58, defaultPageConfig))[0]
check('歌词注释渲染在字前（灰色小字）', svgLr58.includes('>副歌<'), '')
// adj58：连音线线宽 1
const svgSl58 = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) 4 |\n'), defaultPageConfig))[0]
check('连音线线宽 1（adj58）', svgSl58.includes('stroke-width="1"') && !svgSl58.includes('fill="none" stroke="#1b1b1b" stroke-width="1.1"'), '')
// adj67：|"P:2/4" 临时节拍 → 小节线右侧画分数（分子/横线/分母，与小节线等高）
const r67 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"P:2/4" 3 4 |\n')
const b67 = layoutScore(r67, defaultPageConfig).pages[0].barlines.find((b) => b.comment?.startsWith('P:'))
check('|"P:2/4" 解析为小节线备注', r67.errors.length === 0 && b67?.comment === 'P:2/4', JSON.stringify(r67.errors))
const svg67 = renderScoreToSvg(layoutScore(r67, defaultPageConfig))[0]
check('临时节拍渲染分数（分子 2 / 分母 4，font-size 10 居中）', /<text x="[\d.]+" y="[\d.]+" text-anchor="middle" font-size="10"[^>]*>2<\/text>/.test(svg67) && /<text x="[\d.]+" y="[\d.]+" text-anchor="middle" font-size="10"[^>]*>4<\/text>/.test(svg67), '')
check('临时节拍分数横线在分子/分母之间', /<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="\1" stroke="#1b1b1b" stroke-width="1"\/>/.test(svg67), '')
// adj86：大小写不敏感 —— 临时节拍 p:/P:、后倚音 h/H、平均连音组 y/Y
const r86p = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"p:3/8" 3 4 |\n')
const b86p = layoutScore(r86p, defaultPageConfig).pages[0].barlines.find((b) => b.comment?.toLowerCase().startsWith('p:'))
check('|"p:3/8" 与 |"P:3/8" 等效（小写也渲染分数）', b86p !== undefined && renderScoreToSvg(layoutScore(r86p, defaultPageConfig))[0].includes('>3<') && renderScoreToSvg(layoutScore(r86p, defaultPageConfig))[0].includes('>8<'), '')
const r86h = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1[H3] 2[h3] 3 |\n')
const g86h = r86h.groups[0].music.tokens.filter((t) => t.kind === 'note' && t.gracenotes)
check('后倚音 1[H3] 与 1[h3] 等效（均 after）', g86h.length === 2 && g86h.every((t) => t.gracenotes?.after === true), JSON.stringify(g86h.map((t) => t.gracenotes)))
const r86y = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (Y1 2 3) 4 | (y5 6 7) 1 |\n')
const g86y = r86y.groups[0].music.tokens.filter((t) => t.kind === 'note')
// (Y1 2 3)：小节 4 拍 - 组外 4 的 1 拍 = 组 3 拍均分 3 音 = 每音 1 拍（tupletDur 覆盖原始时值）
check('平均连音组 (Y…) 与 (y…) 等效（tupletDur 均分覆盖）', r86y.errors.length === 0 && g86y[0].tupletDur !== undefined && g86y[0].tupletDur === g86y[4].tupletDur && Math.abs((g86y[0].tupletDur ?? 0) - 1) < 1e-6, JSON.stringify(g86y.map((t) => t.tupletDur)))
// adj86：临时节拍占位——分数右侧留 ≥2px，不压下一小节音符（小节间距含分数宽）
const lay86p = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"P:2/4" 3 4 |\n'), defaultPageConfig)
const b86x = lay86p.pages[0].barlines.find((b) => b.comment?.startsWith('P:'))
const n86n = lay86p.pages[0].notes.find((n) => n.x > (b86x?.x ?? 0))
check('临时节拍占位：分数后音符间距 ≥2px（音符 x ≥ 线右缘 + 分数半宽 + 2）', b86x !== undefined && n86n !== undefined && n86n.x >= b86x.x + 0.55 + 2 + 2, `noteX=${n86n?.x} barX=${b86x?.x}`)
// adj88：连音线内相同音高连续音符连奏合并时值
const r88a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (2 - | 2/) 3 |\n')
const ev88a = buildPlaySequence(r88a, layoutScore(r88a, defaultPageConfig), 60).events
const d88 = ev88a.filter((e) => e.placed.audioPitch === 'D4')
check('(2 - | 2/) 连奏：2 一次共 2.5 拍', ev88a.length === 2 && d88.length === 1 && Math.abs(d88[0].durationMs - 2500) < 50, ev88a.map((e) => `${e.placed.audioPitch}:${e.durationMs}`).join(' '))
const r88b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (2 3 | 2) 5 |\n')
const ev88b = buildPlaySequence(r88b, layoutScore(r88b, defaultPageConfig), 60).events
const d88b = ev88b.filter((e) => e.placed.audioPitch === 'D4')
check('(2 3 | 2) 中间隔 3 不合并：3 个 D4 各 1 拍', d88b.length === 2 && d88b.every((e) => Math.abs(e.durationMs - 1000) < 50), ev88b.map((e) => `${e.placed.audioPitch}:${e.durationMs}`).join(' '))
// adj88：从指定音符开始播放（双击音符定位试听起点）
const r88s = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const lay88s = layoutScore(r88s, defaultPageConfig)
const n88s = lay88s.pages[0].notes[3]
const id88s = `${n88s.id.page}_${n88s.id.voice}_${n88s.id.group}_${n88s.id.index}`
const seq88s = buildPlaySequence(r88s, lay88s, 60, id88s)
check('从指定音符开始播放（起点 atMs=0，丢弃之前音符）', seq88s.events.length === 5 && seq88s.events[0].atMs === 0 && seq88s.events[0].placed.id.index === 3, seq88s.events.map((e) => `${e.placed.id.index}:${Math.round(e.atMs)}`).join(' '))
// adj59：音符引号注释显示在音符正上方（有高八度点在圆点上方）；_ 代替空格
const nc59 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1"渐强" 2\'"渐强_稍快" 3 |\n')
const nc59n = nc59.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('音符注释解析 + _ 替换空格', nc59.errors.length === 0 && nc59n[0].comment === '渐强' && nc59n[1].comment === '渐强 稍快', JSON.stringify(nc59n.map((t) => t.comment)))
const layNc59 = layoutScore(nc59, defaultPageConfig)
const svgNc59 = renderScoreToSvg(layNc59)[0]
const nNc0 = layNc59.pages[0].notes[0]
const nNc1 = layNc59.pages[0].notes[1]
const ncfs = Math.max(7, Math.round(defaultPageConfig.note_size * NOTE_COMMENT_FONT_RATIO))
const mNc0 = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" text-anchor="middle" font-size="${ncfs}"[^>]*>渐强<`).exec(svgNc59)
const mNc1 = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" text-anchor="middle" font-size="${ncfs}"[^>]*>渐强 稍快<`).exec(svgNc59)
check('无高八度注释在数字顶上方（y < 基线-16.4）', mNc0 !== null && Number(mNc0[1]) < nNc0.y - 16.4, `y=${mNc0?.[1]}`)
check('有高八度注释在圆点上方（y < 点顶-基线 19.9）', mNc1 !== null && Number(mNc1[1]) < nNc1.y - 19.9, `y=${mNc1?.[1]}`)
// 歌词注释 _ 替换空格（adj59）
const lr59 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 二"副歌_部分"三 四\n')
const lr59c = lr59.groups[0].lyrics[0].chars
check('歌词注释 _ 替换空格', lr59.errors.length === 0 && lr59c.find((c) => c.text === '三')?.note === '副歌 部分', JSON.stringify(lr59c.map((c) => ({ t: c.text, note: c.note }))))
// adj60：修饰符层级规则 —— 层内间距 INNER_GAP=1.5、层级间距 LAYER_GAP=2、下方先减时线后低八度点
const lr60a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1,, 2 |\n')
const svg60a = renderScoreToSvg(layoutScore(lr60a, defaultPageConfig))[0]
const dots60a = [...svg60a.matchAll(new RegExp(`<circle cx="[\\d.]+" cy="([\\d.]+)" r="${DOT_R}"`, 'g'))].map((m) => +m[1]).sort((a, b) => a - b)
check('双低八度点层内空白 INNER_GAP（中心距 2r+INNER_GAP，动态）', dots60a.length === 2 && Math.abs(dots60a[1] - dots60a[0] - (DOT_R * 2 + INNER_GAP)) < 0.3, JSON.stringify(dots60a))
const lr60b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3// 4 |\n')
const svg60b = renderScoreToSvg(layoutScore(lr60b, defaultPageConfig))[0]
const beams60b = [...svg60b.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="0.8"/g)].map((m) => +m[1]).sort((a, b) => a - b)
check('双减时线层内空白 INNER_GAP（中心距 BEAM_H+INNER_GAP，动态）', beams60b.length === 2 && Math.abs(beams60b[1] - beams60b[0] - (BEAM_H + INNER_GAP)) < 0.3, JSON.stringify(beams60b))
const lr60c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3//, 2 |\n')
const n60c = layoutScore(lr60c, defaultPageConfig).pages[0].notes[0]
const svg60c = renderScoreToSvg(layoutScore(lr60c, defaultPageConfig))[0]
const dot60c = new RegExp(`<circle cx="[\\d.]+" cy="([\\d.]+)" r="${DOT_R}"`).exec(svg60c)
check('双减时线+低音点：低八度点在减时线层下方（点顶距层底 LAYER_GAP，动态）', dot60c !== null && Math.abs(Number(dot60c[1]) - lowDotY(n60c.y, 0, 2, defaultPageConfig.note_size)) < 0.5, `cy=${dot60c?.[1]} expect=${lowDotY(n60c.y, 0, 2, defaultPageConfig.note_size)}`)
// adj69：修饰符随曲部字号缩放（36 号字 scale=2：八度点/附点/增时线/小节线同比率放大）
const s69 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1\' 2. 3// 4 |\n')
const lay69 = layoutScore(s69, { ...defaultPageConfig, note_size: 36 })
const svg69 = renderScoreToSvg(lay69)[0]
check('note_size=36：八度点 r = DOT_R×2（1.5×2 = 3，r1n 去尾零）', new RegExp(`<circle cx="[\\d.]+" cy="[\\d.]+" r="${DOT_R * 2}"`).test(svg69), '')
check('note_size=36：附点 r = DOT_R_DOT×2 = 4', new RegExp(`<circle cx="[\\d.]+" cy="[\\d.]+" r="${DOT_R_DOT * 2}"`).test(svg69), '')
const bar69 = lay69.pages[0].barlines[0]
const n69 = lay69.pages[0].notes[0]
check('note_size=36：小节线高度随字号（上端偏移 36.8、高 45.8）', Math.abs(n69.y - bar69.yTop - 36.8) < 0.5 && Math.abs(bar69.yBottom - bar69.yTop - 45.8) < 0.5, `off=${(n69.y - bar69.yTop).toFixed(1)} h=${(bar69.yBottom - bar69.yTop).toFixed(1)}`)
// 渐弱 + 行尾未闭合
const deco2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 > 3 4\n')
const layDe2 = layoutScore(deco2, defaultPageConfig)
check('行尾未闭合渐弱仍生成', layDe2.pages[0].dynamics.length === 1 && layDe2.pages[0].dynamics[0].type === 'decrescendo')

// ---- 21. 示例谱库（M9） ----
console.log('[21] sample scores (M9)')
const loadSample = (n: string) => parseJps(readFileSync(join(root, 'samples', `${n}.jps`), 'utf8'))
// 二声部
const rEr = loadSample('ershenbu')
check('二声部 无解析错误', rEr.errors.length === 0, JSON.stringify(rEr.errors.slice(0, 2)))
const layEr = layoutScore(rEr, defaultPageConfig)
check('二声部 1 个声部块', layEr.pages[0].voiceBlocks.length === 1, `got ${layEr.pages[0].voiceBlocks.length}`)
check('声部块命名 高声部/低声部', layEr.pages[0].voiceBlocks[0]?.voices[0]?.name === '高声部' && layEr.pages[0].voiceBlocks[0]?.voices[1]?.name === '低声部')
check('二声部渲染无异常', renderScoreToSvg(layEr)[0].includes('高声部'))
// 反复与跳房子
const rFf = loadSample('fanfu-tiaofangzi')
check('跳房子演示 无解析错误', rFf.errors.length === 0, JSON.stringify(rFf.errors.slice(0, 2)))
const layFf = layoutScore(rFf, defaultPageConfig)
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
const layLx = layoutScore(rLx, defaultPageConfig)
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
const layYf = layoutScore(rYf, defaultPageConfig)
check('语法谱歌词 16 字对 16 槽位', layYf.pages[0].lyrics.length === 16, `got ${layYf.pages[0].lyrics.length}`)

// ---- 22. 排版细节（adj1：时值等宽/小节均分/两端对齐） ----
console.log('[22] layout detail (adj1)')
// 时值等宽：1- 2 3 4 | 5 6 7 1 |（1- 占 2 拍；单行谱 = 最后一行，自然宽）
const rw = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 | 5 6 7 1 |\n')
const layW2 = layoutScore(rw, defaultPageConfig)
const notesW2 = layW2.pages[0].notes
check('时值等宽：1- 宽 = 2 × 1 拍宽', Math.abs(notesW2[0].width - notesW2[1].width * 2) < 0.5, `${notesW2[0].width} vs ${notesW2[1].width}`)
check('1 拍音符宽一致', Math.abs(notesW2[1].width - notesW2[2].width) < 0.1)
// 行总拍数 = 9（1- 2拍 + 3×1 + 4×1）；pads=12+9.5，perBeat = (435.28-21.5)/9 = 45.98
check('每拍宽按行总拍数平均（小节 2 首音符中心）', Math.abs(notesW2[4].x + 6 - (80 + 5 * 42.42 + 9.5 + 6 + 20 + 0.5 * 42.42)) < 0.5, `x=${notesW2[4].x} center=${notesW2[4].x + 6}`)
// 两端对齐 + 小节均分：8 小节 → 行 1（6 小节）铺满均分，行 2（最后 2 小节）自然宽不撑满
const rj2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const layJ = layoutScore(rj2, defaultPageConfig)
const rowsJ = [...new Set(layJ.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('8 小节断成 2 行', rowsJ.length === 2, `rows=${rowsJ.length}`)
const row1Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[0])
const maxRight1 = Math.max(...row1Notes.map(segEnd))
check('行 1 两端对齐（末音符段终点贴近右边界）', maxRight1 > 515.28 - 10, `right=${maxRight1}`)
// 行 1 按拍数：7 小节 28 拍，perBeat = (435.28-12)/28 = 15.12；小节 1 宽 = 4×15.12
const row1Sorted = row1Notes.sort((a, b) => a.x - b.x)
check('行 1 小节宽按拍数（第 2 小节首音符中心）', Math.abs(row1Sorted[4].x + 6 - (80 + 4 * 11.824 + 9.5 + 6 + 16 + 0.5 * 11.824)) < 0.5, `x=${row1Sorted[4].x} center=${row1Sorted[4].x + 6}`)
const row2Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[1])
const maxRight2 = Math.max(...row2Notes.map(segEnd))
check('最后一行也按行总拍数铺满（贴右边界）', maxRight2 > 515.28 - 10, `right=${maxRight2}`)

// ---- 23. 细节修复（adj2） ----
console.log('[23] adj2 fixes')
// 小节线位置：单行谱（最后一行自然宽 barW=70），线画在小节右边界
const rbar = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layBar = layoutScore(rbar, defaultPageConfig)
const bars23 = layBar.pages[0].barlines
check('小节线 2 条', bars23.length === 2, `got ${bars23.length}`)
// 单行谱 8 拍：pads=12+9.5，perBeat = (435.28-21.5)/8 = 51.72；线在内容右端+空间/2（adj38）
check('线 1 在小节 1 内容右端+4.75', Math.abs(bars23[0].x - (80 + 6 + 4 * 48.22 + 4.75 + 16)) < 1, `x=${bars23[0].x}`)
// 行尾小节线：clamp 到页面内容区右缘（595.28-80-0.75 = 514.53），不溢出边距
check('线 2 在行尾（clamp 到右内容边界 514.5，不溢出边距）', Math.abs(bars23[1].x - 514.53) < 1, `x=${bars23[1].x}`)
// 行首空 seg（|:）不占宽：行总拍 7，pads=12+9.1（barGaps）+12.4（leadPad），noteGap=24
const rr23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 | 5 6 7 1 |\n')
const layRr = layoutScore(rr23, defaultPageConfig)
const noteRr = layRr.pages[0].notes[0]
// 行首 |: 占位（预留线宽 8.4 + 右侧 4px）：leadPad=12.4，perBeat=(435.28-35.6-24)/7=53.67
const leadPadRr = 8.4 + 4
const perBeatRr = (435.28 - (12 + 9.1 + leadPadRr + 24)) / 7
check('行首 |: 占位（音符 1 中心 = 左边距+线宽+4+BAR_PAD+半拍）', Math.abs(noteRr.x + 6 - (80 + leadPadRr + 6 + 0.5 * perBeatRr)) < 0.6, `center=${noteRr.x + 6} expect=${80 + leadPadRr + 6 + 0.5 * perBeatRr}`)
check('|: 行首：粗线左缘贴左边距（x = 80+4.2）', Math.abs(layRr.pages[0].barlines[0].x - 84.2) < 1, `x=${layRr.pages[0].barlines[0].x}`)
// 歌词中心对齐音符数字（增时线音符 1- 的歌词在数字下方）
const rly23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\nC: 一 二 三 四\n')
const layLy = layoutScore(rly23, defaultPageConfig)
const n23 = layLy.pages[0].notes[0]
const l23 = layLy.pages[0].lyrics[0]
check('歌词中心对齐音符数字', Math.abs(l23.x + defaultPageConfig.geci_size / 2 - (n23.x + 5.58)) < 1, `lyric=${l23.x} note=${n23.x}`)
// 增时线渲染为 "-" 字符（adj73：随音符字号，比扁矩形协调）
const svg23 = renderScoreToSvg(layLy)[0]
check('增时线存在（"-" 字符）', svg23.includes('>-<'))
const noteY23 = n23.y
const augTextY = /<text x="[\d.]+" y="([\d.]+)" text-anchor="middle"[^>]*>-<\/text>/.exec(svg23)
check('增时线垂直居中于数字（y = 基线-0.4×字号）', augTextY !== null && Math.abs(Number(augTextY[1]) - (noteY23 - defaultPageConfig.note_size * 0.4)) < 0.5, `textY=${augTextY?.[1]} noteY=${noteY23}`)

// ---- 24. 对齐精细（adj3：音符段内居中 + 减时线按拍分组） ----
console.log('[24] adj3 alignment')
// 音符段内居中：单行谱最后一行均分（barW=435, perBeat=105.75），1 拍音符中心 = 拍段中点
const rc24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n')
const layC24 = layoutScore(rc24, defaultPageConfig)
const n24 = layC24.pages[0].notes[0]
check('1 拍音符居中于拍段', Math.abs(n24.x + 6 - (86 + 0.5 * 102.82)) < 0.5, `center=${n24.x + 6}`)
// 1/ 2/ 各居中于半拍段（行总拍 1，perBeat = 423.28）
const rh24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ |\n')
const nH24 = layoutScore(rh24, defaultPageConfig).pages[0].notes
check('1/ 居中于第 1 半拍段', Math.abs(nH24[0].x + 6 - (86 + 0.25 * 423.28)) < 0.5, `center=${nH24[0].x + 6}`)
check('2/ 居中于第 2 半拍段', Math.abs(nH24[1].x + 6 - (86 + 0.75 * 423.28)) < 0.5, `center=${nH24[1].x + 6}`)
check('八分音符不重叠（间隔 ≥ 数字宽）', nH24[1].x - nH24[0].x >= 11.1, `gap=${nH24[1].x - nH24[0].x}`)
// 减时线按拍分组
const beamsOf24 = (q: string) => {
  const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
  return computeBeamsForTest(layoutScore(r, defaultPageConfig).pages[0].notes)
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
// 8 小节：行 1 = 7 小节（28 拍，perBeat=(435.28-12)/28=15.12），行 2 = 1 小节（4 拍，perBeat=105.82）
const barsJ25 = layJ.pages[0].barlines
// barlines.yTop = 音符基线 - 18.4（数字上沿-14.4 再上延 4px，adj50）
const rowTop = (noteY: number) => noteY - 18.4
const row1Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[0])) < 0.5)
const row2Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[1])) < 0.5)
check('行 1 6 条小节线', row1Bars.length === 6, `got ${row1Bars.length}`)
check('行 2 2 条小节线', row2Bars.length === 2, `got ${row2Bars.length}`)
// pads=12+9.5×6=69：行 1 perBeat = 366.28/28 = 13.08；线 = 内容右端 + 空间/2（adj38）
check('行 1 小节宽按拍数（线 1 = 80+6+4×13.08+4.75）', Math.abs(row1Bars[0].x - (80 + 6 + 4 * 11.824 + 4.75 + 16)) < 0.5, `x=${row1Bars[0].x}`)
check('行 2 每行独立 perBeat（线 1 = 80+6+4×26.36+4.75+32）', Math.abs(row2Bars[0].x - (80 + 6 + 4 * 48.22 + 4.75 + 16)) < 0.5, `x=${row2Bars[0].x} expect=${80 + 6 + 4 * 26.36 + 4.75 + 32}`)

// ---- 26. 超拍小节容错（adj5） ----
console.log('[26] over-beat bars (adj5)')
// 第 2 小节 6 拍 > 4/4：音符不重叠、不溢出（此前会挤在左侧）
const ov26 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 2- |\n')
const layOv = layoutScore(ov26, defaultPageConfig)
const notesOv = [...layOv.pages[0].notes].sort((a, b) => a.x - b.x)
let minGap = Infinity
for (let i = 1; i < notesOv.length; i++) minGap = Math.min(minGap, notesOv[i].x - notesOv[i - 1].x)
check('超拍小节音符不重叠（最小间距 ≥ 11）', minGap >= 11, `minGap=${minGap}`)
const lastOv = notesOv[notesOv.length - 1]
// 段终点 = x + 6 - perBeat/2 + dur×perBeat（数字居中于第 1 拍，perBeat = width/dur）
const perBeatOv = lastOv.width / lastOv.duration
const segEndOv = lastOv.x + 6 - perBeatOv / 2 + lastOv.duration * perBeatOv
check('末音符段终点不溢出', segEndOv <= 515.28 + 1, `end=${segEndOv}`)

// ---- 27. 增时线占一拍（adj6） ----
console.log('[27] augment line = 1 beat (adj6)')
// 1- 2 3 4 | 单行均分：数字 1 居中于第 1 拍，增时线占第 2 拍
const au27 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\n')
const layAu = layoutScore(au27, defaultPageConfig)
const nAu = layAu.pages[0].notes[0]
const perBeatAu = nAu.width / nAu.duration
check('数字居中于第 1 拍（非整段）', Math.abs(nAu.x + 6 - (86 + perBeatAu / 2)) < 0.5, `center=${nAu.x + 6}`)
const svgAu = renderScoreToSvg(layAu)[0]
const segStartAu = nAu.x + 6 - perBeatAu / 2
// adj75：段间有拍间距（NOTE_GAP=4，layout/index.ts 常量，未导出故硬编码）
const beatStartAu = segStartAu + perBeatAu + 4
const expectLX = beatStartAu + (perBeatAu - 11.16) / 2 // 占位 11.16 居中于第 2 拍段
const augTexts = [...svgAu.matchAll(/<text x="([\d.]+)" y="[\d.]+" text-anchor="middle"[^>]*font-size="([\d.]+)"[^>]*>-<\/text>/g)]
check('增时线 1 条', augTexts.length === 1, `got ${augTexts.length}`)
const rAu = augTexts[0]
check('增时线居中于第 2 拍段', rAu !== undefined && Math.abs(Number(rAu[1]) - (expectLX + 5.58)) < 0.5, `x=${rAu?.[1]} expect=${expectLX + 5.58}`)
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
// bar_gap=10：pads=12+10=22；perBeat = (435.28-22)/8 = 51.66；小节 1 宽 4×51.66
const gapCfg = { ...defaultPageConfig, bar_gap: 10 }
const layGap = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n'), gapCfg)
const notesGap = layGap.pages[0].notes
// 小节 2 起点 = 80 + 206.64 + 10 = 296.64；首音符中心 = 296.64+6+25.83
check('小节间距生效（小节 2 首音符位置）', Math.abs(notesGap[4].x + 6 - (80 + 4 * 48.16 + 10 + 6 + 16 + 0.5 * 48.16)) < 0.5, `center=${notesGap[4].x + 6}`)
const barsGap = layGap.pages[0].barlines
check('小节线在内容右端+间距内居中（+6+gap/2+拍间距，adj38）', Math.abs(barsGap[0].x - (80 + 6 + 4 * 48.16 + 5 + 16)) < 0.5, `x=${barsGap[0].x}`)

// ---- 30. 描述头布局与拖拽（adj9） ----
console.log('[30] meta layout (adj9)')
// areaH = 80+40+36×1.6+30 = 207.6
const metaSvg = renderScoreToSvg(layEr)[0]
const getMeta = (key: string) => {
  const m = new RegExp(`data-meta="${key}" x="([\\d.]+)" y="([\\d.]+)"`).exec(metaSvg)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}
const tTitle = getMeta('title')
check('标题居中靠上（文字顶不越顶部虚线，adj32）', tTitle !== null && Math.abs(tTitle.x - 595.28 / 2) < 0.5 && Math.abs(tTitle.y - 110.6) < 0.5, JSON.stringify(tTitle))
const tAuthor = getMeta('author_0')
check('作者右下（右对齐，描述头区域右下角往上）', tAuthor !== null && Math.abs(tAuthor.x - 515.28) < 0.5 && Math.abs(tAuthor.y - 151.6) < 0.5, JSON.stringify(tAuthor))
const tKey = getMeta('keyline')
check('调式+拍号左下（描述头区域左下角）', tKey !== null && Math.abs(tKey.x - 80) < 0.5 && Math.abs(tKey.y - 123.6) < 0.5, JSON.stringify(tKey))
const tTempo = getMeta('tempo')
// adj42：节拍行 = 号与调式行对齐 → x = 80 + (w("1 ") - w("♩")) = 80 + 11.47 - 7.0 = 84.47
check('节拍在 keyline 下（D↔J 间距加大，-20→-12；= 号与调式行对齐）', tTempo !== null && Math.abs(tTempo.x - 84.47) < 0.5 && Math.abs(tTempo.y - 155.6) < 0.5, JSON.stringify(tTempo))
// metaPos 覆盖（相对锚点偏移，adj16）：title 锚=上中点(297.64,80)，绝对 = 297.64+100, 80+50
const layErM = layoutScore(rEr, { ...defaultPageConfig, metaPos: { title: { x: 100, y: 50 } } })
const svgErM = renderScoreToSvg(layErM)[0]
const m2 = /data-meta="title" x="([\d.]+)" y="([\d.]+)"/.exec(svgErM)
check('metaPos 覆盖标题位置（锚点+偏移）', m2 !== null && Math.abs(Number(m2[1]) - 397.64) < 0.5 && Math.abs(Number(m2[2]) - 130) < 0.5, m2?.[0])

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
const rgsNo = computeRowGuides(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n'), defaultPageConfig), { quci: 13, geci: 18 })
check('无歌词行 lyricTop=null', rgsNo[0][0].lyricTop === null)

// ---- 32. 描述头位置钳制（adj16/adj31 锚点语义，区域高=descAreaH=87.6） ----
console.log('[32] meta clamp (adj16/adj31)')
// 区域：宽 = 595.28-160 = 435.28，高 = descAreaH = 87.6
const cfgClamp = defaultPageConfig
// 标题锚定上边中点：偏移范围 x∈[-w/2, w/2]，y∈[0, h]
const c1 = clampMetaPos('title', 9999, 9999, 595.28, cfgClamp)
check('标题超右下被钳制', Math.abs(c1.x - 217.64) < 0.5 && Math.abs(c1.y - 87.6) < 0.5, JSON.stringify(c1))
const c2 = clampMetaPos('title', -100, -100, 595.28, cfgClamp)
check('标题左上越界 y 钳到字号安全边距（30.6）、x 在范围内不变', Math.abs(c2.x + 100) < 0.5 && Math.abs(c2.y - 30.6) < 0.5, JSON.stringify(c2))
// 调式拍号锚定左下角：偏移 x∈[0, w-40]，y∈[-h, 0]
const c3 = clampMetaPos('keyline', 9000, 100, 595.28, cfgClamp)
check('keyline 右侧留 40', Math.abs(c3.x - (435.28 - 40)) < 0.5 && c3.y === 0, JSON.stringify(c3))
// 作者锚定右下角：偏移 x∈[-w, 0]，y∈[-h, 0]
const c4 = clampMetaPos('author_0', 100, 100, 595.28, cfgClamp)
check('作者超右上被钳制到右下角', c4.x === 0 && c4.y === 0, JSON.stringify(c4))
const c5 = clampMetaPos('author_0', -100, -50, 595.28, cfgClamp)
check('作者区域内偏移不变', c5.x === -100 && c5.y === -50, JSON.stringify(c5))
const c6 = clampMetaPos('tempo', -100, -200, 595.28, cfgClamp)
check('节拍超左上被钳制', c6.x === 0 && Math.abs(c6.y + 87.6) < 0.5, JSON.stringify(c6))

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
// 标题：锚 = 区域上边中点 (margin_left + w/2, margin_top) + 偏移 (10, 20)
const metaRel = { title: { x: 10, y: 20 } }
const pA = posOf33(defaultPageConfig, metaRel, 'title')
check('默认边距下 = 上中点 + 偏移', pA !== null && Math.abs(pA.x - 307.64) < 0.5 && Math.abs(pA.y - 100) < 0.5, JSON.stringify(pA))
const pB = posOf33({ ...defaultPageConfig, margin_top: 120 }, metaRel, 'title')
check('margin_top 改变 → 标题跟随上移', pB !== null && Math.abs(pB.y - (120 + 20)) < 0.5, JSON.stringify(pB))
const pC = posOf33({ ...defaultPageConfig, body_margin_top: 80 }, metaRel, 'title')
check('区域变高 → 标题位置不变（只跟边距锚）', pC !== null && Math.abs(pC.y - 100) < 0.5, JSON.stringify(pC))
const pD = posOf33({ ...defaultPageConfig, margin_left: 120 }, metaRel, 'title')
check('margin_left 改变 → 标题跟随水平中心', pD !== null && Math.abs(pD.x - 327.64) < 0.5, JSON.stringify(pD))
// 左下锚：调式/拍号；右下锚：作者
const metaRel2 = { keyline: { x: 0, y: -44 }, author_0: { x: 0, y: -16 } }
const kA = posOf33(defaultPageConfig, metaRel2, 'keyline')
check('keyline 默认 = 左下角 - 44（descAreaH 区域）', kA !== null && Math.abs(kA.x - 80) < 0.5 && Math.abs(kA.y - 123.6) < 0.5, JSON.stringify(kA))
const kB = posOf33({ ...defaultPageConfig, descAreaH: 120 }, metaRel2, 'keyline')
check('descAreaH 变高 → keyline 跟随左下角下移', kB !== null && Math.abs(kB.x - 80) < 0.5 && Math.abs(kB.y - 156) < 0.5, JSON.stringify(kB))
const kC = posOf33({ ...defaultPageConfig, body_margin_top: 80 }, metaRel2, 'keyline')
check('body_margin_top 变 → keyline 不移动（锚定描述头区域）', kC !== null && Math.abs(kC.y - 123.6) < 0.5, JSON.stringify(kC))
const aA = posOf33(defaultPageConfig, metaRel2, 'author_0')
check('作者默认 = 右下角 - 16（descAreaH 区域）', aA !== null && Math.abs(aA.x - 515.28) < 0.5 && Math.abs(aA.y - 151.6) < 0.5, JSON.stringify(aA))
const aB = posOf33({ ...defaultPageConfig, margin_right: 120 }, metaRel2, 'author_0')
check('右边距改变 → 作者跟随右下角左移', aB !== null && Math.abs(aB.x - 475.28) < 0.5 && Math.abs(aB.y - 151.6) < 0.5, JSON.stringify(aB))

// ---- 34. 音符渲染细节（adj13） ----
console.log('[34] note render detail (adj13)')
// 高低音点对齐数字中心
const oct34 = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1' 2 3 4 |\n")
const layO34 = layoutScore(oct34, defaultPageConfig)
const nO34 = layO34.pages[0].notes[0]
const octDot = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R}"`).exec(renderScoreToSvg(layO34)[0])
check('高音点 x = 数字中心左移 1（adj19）', octDot !== null && Math.abs(Number(octDot[1]) - (nO34.x + 4.58)) < 0.5, `cx=${octDot?.[1]} expect=${nO34.x + 4.58}`)
check('高音点 y = 数字基线上 17.9（点底距数字顶 2px，adj60）', octDot !== null && Math.abs(Number(octDot[2]) - (nO34.y - 17.9)) < 0.5, `cy=${octDot?.[2]} expect=${nO34.y - 17.9}`)
// 附点（adj71）：紧接修饰音符（数字）后面，中心 = 数字右缘 + 半径；垂直居中于数字
const dot34 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const layD34 = layoutScore(dot34, defaultPageConfig)
const nD34 = layD34.pages[0].notes[0]
const expectDotX = nD34.x + defaultPageConfig.note_size * 0.62 + DOT_R_DOT
const dotR = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R_DOT}"`).exec(renderScoreToSvg(layD34)[0])
check('附点紧接音符后（cx = 数字右缘 + 半径，adj71）', dotR !== null && Math.abs(Number(dotR[1]) - expectDotX) < 0.5, `cx=${dotR?.[1]} expect=${expectDotX}`)
check('附点垂直居中（y = 基线-0.4×字号）', dotR !== null && Math.abs(Number(dotR[2]) - (nD34.y - defaultPageConfig.note_size * 0.4)) < 0.5, `cy=${dotR?.[2]}`)
// 混合时值（八分+十六分）不重叠：2 小节行 perBeat 受限
const mix34 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3// 4// | 1/ 2/ 3// 4// |\n')
const layM34 = layoutScore(mix34, defaultPageConfig)
const nM34 = [...layM34.pages[0].notes].sort((a, b) => a.x - b.x)
let minGap34 = Infinity
for (let i = 1; i < nM34.length; i++) minGap34 = Math.min(minGap34, nM34[i].x - nM34[i - 1].x)
check('混合时值（八分+十六分）不重叠', minGap34 >= 11.1, `minGap=${minGap34}`)

// ---- 35. 附点占宽 / 低音点避让（adj15） ----
console.log('[35] adj15 detail')
// 附点占宽：1. = 1.5 拍、1/. = 0.75 拍（宽度 = 时值 × 每拍宽）
const d35a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 |\n')
const lay35a = layoutScore(d35a, defaultPageConfig)
const n35a = lay35a.pages[0].notes
const perBeat35a = n35a[1].width / n35a[1].duration
check('1. 占宽 = 1.5 拍', Math.abs(n35a[0].width - 1.5 * perBeat35a) < 0.5, `${n35a[0].width} vs ${1.5 * perBeat35a}`)
const d35b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/. 2 |\n')
const lay35b = layoutScore(d35b, defaultPageConfig)
const n35b = lay35b.pages[0].notes
const perBeat35b = n35b[1].width / n35b[1].duration
check('1/. 占宽 = 0.75 拍', Math.abs(n35b[0].width - 0.75 * perBeat35b) < 0.5, `${n35b[0].width} vs ${0.75 * perBeat35b}`)
// 低音点 + 减时线：3/, 线底 = 基线+5.5，点顶距线底 2px → cy = 基线+9.5（adj49）
const d35c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3/, 2 |\n')
const lay35c = layoutScore(d35c, defaultPageConfig)
const n35c = lay35c.pages[0].notes[0]
const dot35c = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R}"`).exec(renderScoreToSvg(lay35c)[0])
check('低八度点距减时横线 2px、x=数字中心（adj60）', dot35c !== null && Math.abs(Number(dot35c[2]) - (n35c.y + 8.6)) < 0.5 && Math.abs(Number(dot35c[1]) - (n35c.x + 5.58)) < 0.5, `cy=${dot35c?.[2]} cx=${dot35c?.[1]}`)
// 低音点无减时线：3, 点顶 = 数字底(基线+2) + 2 → cy = 基线+6（adj49）
const d35d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3, 2 |\n')
const lay35d = layoutScore(d35d, defaultPageConfig)
const n35d = lay35d.pages[0].notes[0]
const dot35d = new RegExp(`<circle cx="([\\d.]+)" cy="([\\d.]+)" r="${DOT_R}"`).exec(renderScoreToSvg(lay35d)[0])
check('低八度点距数字底部 2px、x=数字中心（adj60）', dot35d !== null && Math.abs(Number(dot35d[2]) - (n35d.y + 5.5)) < 0.5 && Math.abs(Number(dot35d[1]) - (n35d.x + 5.58)) < 0.5, `cy=${dot35d?.[2]} cx=${dot35d?.[1]}`)

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
check('单音符连音线 (3) 不渲染（退化跳过）', layoutScore(r36b, defaultPageConfig).pages[0].slurs.length === 0)
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
// 括号一律连音线（空格与否均可）：( 2 3 ) 与 (4) 都是连音线
const r36h = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) (4) 5 |\n')
check('( 2 3 ) 与 (4) 均解析为连音线', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') === 'note,slur,note,note,slur,slur,note,slur,note,barline', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') + ' | ' + JSON.stringify(r36h.errors))
// 渲染：倚音小字（adj105：字号 = 主音符 × 0.5 = 9，由 0.4 调大；加粗与主音符一致）
const svg36c = renderScoreToSvg(layoutScore(r36c, defaultPageConfig))[0]
check('倚音渲染小数字（font-size = 0.5×18 = 9）', svg36c.includes('font-size="9"'), '')
// adj97：倚音减时线为跨组平行横线（line 元素）而非斜线（path M...L...斜向）
check('倚音减时线为横线（line 元素）', svg36c.includes('<line ') && svg36c.includes('stroke="#1b1b1b"'), '')
// adj101：倚音与主音符之间是一条抛物线弧线（SVG Q 二次贝塞尔，控制点在起点正下），粗细同减时线 0.6
check('倚音连接弧线为抛物线（Q 命令）', svg36c.includes(' Q ') && svg36c.includes('stroke-width="0.6"'), '')
// adj105：倚音数字加粗（与主音符粗体一致）
check('倚音数字加粗', /<text x="[^"]+" y="[^"]+" font-size="9"[^>]*font-weight="bold"/.test(svg36c), '')
// adj98：倚音减时线 = 实际时值 +1 条——主音符 1[65]（倚音无 /）→ 倚音有 1 条横线；
// 2[3/]（倚音 /）→ 2 条（减时线数 = diminishCount + 1）
const r98g = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 2[3] 3[4/] 4 |\n')
const svg98g = renderScoreToSvg(layoutScore(r98g, defaultPageConfig))[0]
// 减时线横线数量（倚音区）：2[3] → 1 条、3[4/] → 2 条，共 3 条小横线（y 在倚音基线下方）
const gLines98 = [...svg98g.matchAll(/<line /g)].length
check('倚音减时线 +1（2[3]→1 条、3[4/]→2 条，共 3 条横线）', gLines98 >= 3, `lines=${gLines98}`)
// adj100：首条减时线 y = 主音符文本上端（主音符基线 y - 18×0.8 = y - 14.4）；同组线间距固定 1.2px
const lay100 = layoutScore(r98g, defaultPageConfig)
const n100 = [...lay100.pages[0].notes].sort((a, b) => a.x - b.x)
// 按 x1 分组（2[3] 与 3[4/] 是两组音符，各自首条线都在自己的 mainTop，不能混算间距）
const gLineGroups100 = new Map<number, number[]>()
for (const m of svg98g.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="[^"]+" stroke="#1b1b1b" stroke-width="0.6"/g)) {
  const x1 = Number(m[1])
  const arr = gLineGroups100.get(x1) ?? []
  arr.push(Number(m[2]))
  gLineGroups100.set(x1, arr)
}
const gLineYs100 = [...gLineGroups100.values()].map((g) => g.sort((a, b) => a - b))
const firstLineY100 = Math.min(...gLineYs100.flat())
const maxGroup100 = gLineYs100.reduce((a, b) => (b.length > a.length ? b : a), [])
check('adj100 首条减时线 y = 主音符文本上端（基线 - 14.4）', gLineYs100.length >= 2 && Math.abs(firstLineY100 - (n100[0].y - 14.4)) < 0.5, `first=${firstLineY100} mainTop=${(n100[0].y - 14.4).toFixed(1)}`)
check('adj100 减时线间距 1.2px', maxGroup100.length >= 2 && Math.abs(maxGroup100[1] - maxGroup100[0] - 1.2) < 0.05, `ys=${maxGroup100.join(',')}`)
// adj100：倚音数字上移，基线在首条减时线上方（不压线）
const gTextY100 = Number(svg98g.match(/<text x="[^"]+" y="([^"]+)" font-size="9"/)?.[1] ?? 'NaN')
check('adj100 倚音数字上移（基线 < 首条减时线 - 1）', !Number.isNaN(gTextY100) && gTextY100 < gLineYs100[0] - 1, `gy=${gTextY100} line0=${gLineYs100[0]}`)
// adj101：弧线为二次贝塞尔 Q——控制点在起点正下方（先向下），前倚音终点向右、后倚音终点向左，终点比起点低
const arcs100 = [...svg36c.matchAll(/<path d="M ([-\d.]+) ([-\d.]+) Q ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)" fill="none" stroke="#1b1b1b" stroke-width="0.6"/g)].map((m) => ({ sx: Number(m[1]), sy: Number(m[2]), cx: Number(m[3]), cy: Number(m[4]), ex: Number(m[5]), ey: Number(m[6]) }))
const arcFront = arcs100.find((a) => a.ex > a.sx)
const arcBack = arcs100.find((a) => a.ex < a.sx)
check('adj101 前倚音弧线先向下再弯向右（控制点 x=起点 x、终点 x>起点 x 且 y>起点 y）', !!arcFront && Math.abs(arcFront.cx - arcFront.sx) < 0.05 && arcFront.ex > arcFront.sx && arcFront.ey > arcFront.sy, JSON.stringify(arcFront))
check('adj101 后倚音弧线先向下再弯向左（控制点 x=起点 x、终点 x<起点 x 且 y>起点 y）', !!arcBack && Math.abs(arcBack.cx - arcBack.sx) < 0.05 && arcBack.ex < arcBack.sx && arcBack.ey > arcBack.sy, JSON.stringify(arcBack))
// adj101：倚音低八度点紧贴该音符最后一条减时线下方（线底 + (LAYER_GAP+DOT_R)×倚音缩放因子 = 圆心）
const svg36d = renderScoreToSvg(layoutScore(r36d, defaultPageConfig))[0]
const yMain36d = Number(svg36d.match(/<text x="[^"]+" y="([^"]+)" data-notepos="[^"]+" font-size="18"[^>]*font-weight="bold"[^>]*>1<\/text>/)?.[1] ?? 'NaN')
const lowCy36d = Math.max(...[...svg36d.matchAll(/<circle cx="[^"]+" cy="([^"]+)" r="[^"]+" fill="#1b1b1b"/g)].map((m) => Number(m[1])))
// 5, 无减时（dc=1 → 线 1 条）：圆心 = mainTop + 半线高0.3 + (2+1.5)×(9/18=0.5)；mainTop = 主音符基线 - 14.4
check('adj101 低八度点在最后一条减时线下方（线底+LAYER_GAP×s）', !Number.isNaN(yMain36d) && Math.abs(lowCy36d - (yMain36d - 14.4 + 0.3 + (2 + 1.5) * 0.5)) < 0.6, `lowCy=${lowCy36d} expect=${(yMain36d - 14.4 + 2.05).toFixed(2)}`)
// adj102：弧线起点——无低八度点 → 最后一条减时线底（直接连接）；有低八度点 → 最低点底 + LAYER_GAP×s
const yMain36c = Number(svg36c.match(/<text x="[^"]+" y="([^"]+)" data-notepos="[^"]+" font-size="18"[^>]*font-weight="bold"[^>]*>1<\/text>/)?.[1] ?? 'NaN')
const arcStarts36c = [...svg36c.matchAll(/<path d="M [-\d.]+ ([-\d.]+) Q/g)].map((m) => Number(m[1]))
check('adj102 无低八度点：弧线起点 = 最后一条减时线底（与线连接）', arcStarts36c.length === 2 && arcStarts36c.every((sy) => Math.abs(sy - (yMain36c - 14.4 + 0.3)) < 0.5), `sy=${arcStarts36c.join(',')} lineBottom=${(yMain36c - 14.4 + 0.3).toFixed(1)}`)
const arcSy36d = Number(svg36d.match(/<path d="M [-\d.]+ ([-\d.]+) Q/)?.[1] ?? 'NaN')
check('adj102 有低八度点：弧线起点 = 低八度点底 + LAYER_GAP×s', !Number.isNaN(arcSy36d) && Math.abs(arcSy36d - (lowCy36d + (1.5 + 2) * 0.5)) < 0.6, `arcSy=${arcSy36d} expect=${(lowCy36d + 1.75).toFixed(2)}`)
// adj103：多音符（≥2）倚音数字间距缩小为 0.5×字号（0.5×9 = 4.5@18）；1[65] 与 2[h56] 两组
const gx36c = [...svg36c.matchAll(/<text x="([^"]+)" y="[^"]+" font-size="9"/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
check('adj103 多音符倚音数字间距 = 0.5×字号（4.5）', gx36c.length === 4 && Math.abs(gx36c[1] - gx36c[0] - 4.5) < 0.15 && Math.abs(gx36c[3] - gx36c[2] - 4.5) < 0.15, `xs=${gx36c.join(',')}`)
// adj106：倚音组右端与主音符固定留 1px×s（多音符组尾不侵入主音符区）——前倚音 1[65] 最右数字 5 右缘 = 主音符 1 左缘 - 1
const yMainX1 = Number(svg36c.match(/<text x="([^"]+)" y="[^"]+" data-notepos="[^"]+" font-size="18"[^>]*font-weight="bold"[^>]*>1<\/text>/)?.[1] ?? 'NaN')
check('adj106 前倚音组右端与主音符留 1px（不重叠）', !Number.isNaN(yMainX1) && Math.abs(gx36c[1] + 9 * 0.62 - (yMainX1 - 1)) < 0.3, `gRight=${(gx36c[1] + 5.58).toFixed(1)} main=${yMainX1}`)
// adj98：倚音占位计入音符宽度——带倚音的音符 perBeat ≥ 无倚音音符
const lay98 = layoutScore(r98g, defaultPageConfig)
const n98 = [...lay98.pages[0].notes].sort((a, b) => a.x - b.x)
const w98g = (n: { segments?: { x: number; beats: number; perBeat: number }[] }) => {
  const segs = n.segments ?? []
  return segs.reduce((a, s) => a + s.beats * s.perBeat, 0)
}
check('倚音占位计入音符宽度（带倚音音符更宽）', w98g(n98[0]) >= w98g(n98[2]), `g=${w98g(n98[0]).toFixed(1)} plain=${w98g(n98[2]).toFixed(1)}`)
// 播放：倚音事件（音高覆盖）
const seq36 = buildPlaySequence(r36c, layoutScore(r36c, defaultPageConfig), 120)
const gPitches = seq36.events.filter((e) => e.pitch).map((e) => e.pitch)
check('倚音播放事件 7 个（2+1 前 + 2+1+1 主/后）', seq36.events.length === 7, `got ${seq36.events.length}`)
check('倚音音高 = 倚音音符本身（A4,G4,G4,A4）', gPitches.join(',') === 'A4,G4,G4,A4', gPitches.join(','))

// ---- 37. 小节线居中 + 单空格（adj25） ----
console.log('[37] barline centering (adj25)')
// 多声部块小节线在小节右边界（此前错误画在小节中央）
// layV（[17]）：Q1/Q2 各 1 小节 4 拍，blockBeats=4，perBeat=(435.28-12)/4=105.82
const bars37 = layV.pages[0].barlines
// 多声部块小节线在小节右边界（此前错误画在小节中央）；块级行尾线 clamp 到右内容边界
check('多声部小节线在小节内容右端+4.75（adj38）', bars37.length === 1 && Math.abs(bars37[0].x - 514.53) < 1, `x=${bars37[0]?.x} expect=514.53`)// 单声部 gap 居中已在 [29] 断言
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
check('跳房子 5 个小节线块（2 起点 + 2 终点 + 行尾）', r38a.errors.length === 0 && bars38a.length === 5, JSON.stringify(r38a.errors))
const vs1 = bars38a[0].kind === 'barline' ? bars38a[0].voltaStart : undefined
const ve1 = bars38a[1].kind === 'barline' ? bars38a[1] : undefined
const vs2 = bars38a[2].kind === 'barline' ? bars38a[2].voltaStart : undefined
check('跳房子 1 注释 "1."', !!vs1 && vs1.comment === '1.', JSON.stringify(vs1))
check('跳房子 1 以 |] 结束', !!ve1 && ve1.voltaEnd === true && ve1.voltaEndSlash !== true)
check('连续跳房子 2 注释 "2."（voltaOnly）', !!vs2 && vs2.comment === '2.' && bars38a[2].kind === 'barline' && bars38a[2].voltaOnly === true, JSON.stringify(vs2))
// 2. 修饰：+ 抬高、|]/ 开口结束
const r38b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 |[+"1." 4 4 5 |]/ 7 |\n')
const b38b = r38b.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('[+ 抬高 + 注释', b38b.length === 3 && b38b[0].kind === 'barline' && b38b[0].voltaStart?.plus === 1 && b38b[0].voltaStart?.comment === '1.', JSON.stringify(b38b[0]))
check('|]/ 开口结束', b38b[1].kind === 'barline' && b38b[1].voltaEnd === true && b38b[1].voltaEndSlash === true, JSON.stringify(b38b[1]))
// 3. 行首跳房子用 |/ [
const r38c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |/ [ 5 6 ] 1 2 |\n')
const b38c = r38c.groups[0].music.tokens.filter((t) => t.kind === 'barline')
check('|/ [ 行首跳房子并入隐藏小节线', r38c.errors.length === 0 && b38c[0].kind === 'barline' && b38c[0].voltaStart?.open === true && b38c[0].type === '|/', JSON.stringify(b38c[0]))
// 行首直接 [ → 警告
const r38d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: [ 5 6 ] 1 2 |\n')
check('行首 [ 无小节线 → 警告', r38d.errors.some((e) => e.message.includes('小节线后')))
// 渲染：番号显示在线起点上方
const lay38 = layoutScore(r38a, defaultPageConfig)
const svg38 = renderScoreToSvg(lay38)[0]
check('跳房子番号 "1." "2." 渲染', svg38.includes('>1.<') && svg38.includes('>2.<'))
// 播放：反复中跳房子段第二遍跳过（注意 8 是隐藏休止符，用 7 1 收尾）
const r38p = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 |["1." 3 4 |]["2." 5 6 |] 7 1 :|\n')
const seq38 = buildPlaySequence(r38p, layoutScore(r38p, defaultPageConfig), 120)
check('跳房子播放 12 事件（pass1 全 8 + pass2 1,2,7,1）', seq38.events.length === 12 && pitchSeq(seq38) === 'C4,D4,E4,F4,G4,A4,B4,C4,C4,D4,B4,C4', `${seq38.events.length}:${pitchSeq(seq38)}`)

// ---- 39. 描述头下端线（adj30） ----
console.log('[39] desc area guide (adj30)')
// 描述头区域下沿 = 上边距 + 内容区高 + 曲部上间距（默认 80+87.6+40 = 207.6）
check('metaAreaH 默认不变（207.6）', Math.abs(metaAreaH(defaultPageConfig) - 207.6) < 0.5, String(metaAreaH(defaultPageConfig)))
// descAreaH 增大 → 描述头区域变高（曲部第一行下移）
const lay39a = layoutScore(rEr, { ...defaultPageConfig, descAreaH: 140 })
const firstY39a = Math.min(...lay39a.pages[0].notes.map((n) => n.y))
check('descAreaH 增大 → 曲部第一行下移', Math.abs(firstY39a - (80 + 140 + 40 + 19.8)) < 0.5, `y=${firstY39a}`)
// 描述头元素（作者，右下锚）跟随描述头区域（descAreaH），不出区域
const svg39 = renderScoreToSvg(lay39a)[0]
const m39 = /data-meta="author_0" x="[\d.]+" y="([\d.]+)"/.exec(svg39)
check('作者跟随描述头区域下移（在 descAreaH 内）', m39 !== null && Math.abs(Number(m39[1]) - (80 + 140 - 16)) < 0.5, `y=${m39?.[1]}`)
// body_margin_top 最小 4px（描述头下端线最小间距）
const exLimits = GUIDE_LIMITS_EX as Record<string, [number, number]>
check('body_margin_top 最小 4px', exLimits['body_margin_top'][0] === 4)
check('descAreaH 范围下限 40', exLimits['descAreaH'][0] === 40)

// ---- 40. 无歌词行行高（adj33） ----
console.log('[40] no-lyric row height (adj33)')
// 无歌词：行高 = 曲高(30.6) + 曲上间距(20) = 50.6（歌词部空间为 0；adj78 曲上间距 40→20）
const r40a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const lay40a = layoutScore(r40a, defaultPageConfig)
const ys40a = [...new Set(lay40a.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('无歌词行高 = 曲高 + 曲上间距（50.6）', ys40a.length >= 2 && Math.abs(ys40a[1] - ys40a[0] - 50.6) < 0.5, `dy=${ys40a[1] - ys40a[0]}`)
// 有歌词对照：行高 = 30.6 + 13 + (18+4+10) + 12 = 87.6（adj73 词曲最小间距 8→4；adj92 曲上间距 20→12）
const r40b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\n')
const lay40b = layoutScore(r40b, defaultPageConfig)
const ys40b = [...new Set(lay40b.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('有歌词行高 = 87.6（曲上间距 12）', ys40b.length >= 2 && Math.abs(ys40b[1] - ys40b[0] - 87.6) < 0.5, `dy=${ys40b[1] - ys40b[0]}`)

// ---- 41. 小节线高度与反复点（adj34） ----
console.log('[41] barline height & dots (adj34)')
const r41 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 4 :|\n')
const lay41 = layoutScore(r41, defaultPageConfig)
const b41 = lay41.pages[0].barlines[0]
const n41 = lay41.pages[0].notes[0]
check('小节线上端 = 音符基线-18.4（数字上沿-14.4 再上延 4px）', Math.abs(b41.yTop - (n41.y - 18.4)) < 0.5, `yTop=${b41.yTop}`)
check('小节线下端 = 音符基线+4.5（数字下沿+0.5 再下延 4px）', Math.abs(b41.yBottom - (n41.y + 4.5)) < 0.5, `yBottom=${b41.yBottom}`)
check('小节线高 22.9（数字 14.9 + 上下各延伸 4px）', Math.abs(b41.yBottom - b41.yTop - 22.9) < 0.5)
// 反复点：|: 为左粗线、中细线、右 :（点中心 = 线 x + 1.6，点线距 1.2px，adj104 点径 2.4、r=1.2）
const svg41 = renderScoreToSvg(lay41)[0]
const dot41 = /<circle cx="([\d.]+)" cy="[\d.]+" r="1.2"/.exec(svg41)
check('反复点（|: 右侧 :，cx = 线 x + 1.6）', dot41 !== null && Math.abs(Number(dot41[1]) - (b41.x + 1.6)) < 0.5, `cx=${dot41?.[1]} x=${b41.x}`)

// ---- 42. 拍级挤占（adj35） ----
console.log('[42] beat-level spacing (adj35)')
// 16 分音符拍 need=minNoteW/0.25 > 行均分 → 该拍固定（挤占），其余拍平均分享（H_GAP 动态）
const r42 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1// 2// 3// 4// | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const lay42 = layoutScore(r42, defaultPageConfig)
const n42 = [...lay42.pages[0].notes].sort((a, b) => a.x - b.x)
const minNoteW42 = defaultPageConfig.note_size * 0.62 + H_GAP
check('16 分音符间距 = minNoteW（数字槽 + H_GAP）', Math.abs(n42[1].x - n42[0].x - minNoteW42) < 0.5, `gap=${n42[1].x - n42[0].x}`)
// 拍 1 起点 = 86(BAR 内)+need+空间9.5；第 5 音符在密集拍段之后、正常拍间距 ≥ minNoteW
check('超拍挤占后第 5 音符在密集拍段右侧', n42[4].x + 6 > 80 + minNoteW42 / 0.25 + 9.5 + 6, `center=${n42[4].x + 6}`)
check('超拍挤占后正常拍间距 ≥ minNoteW（不重叠）', n42[5].x - n42[4].x >= minNoteW42, `gap=${(n42[5].x - n42[4].x).toFixed(1)}`)
// 行不溢出
check('拍级行不溢出页面', Math.max(...n42.map((nn) => nn.x + 11.16)) <= 515.28, `right=${Math.max(...n42.map((nn) => nn.x + 11.16))}`)
// 13 拍整行不拆（断行按逐拍 need，而非统一 maxPbm）
const ys42 = [...new Set(lay42.pages[0].notes.map((nn) => nn.y))]
check('密集拍所在行不拆（13 拍一行）', ys42.length === 1, `rows=${ys42.length}`)

// ---- 43. 附点占位 / 连音线端点 / 小节线不重叠（adj36） ----
console.log('[43] dot width / slur ends / barline gap (adj36)')
// ① 附点段用所在拍 perBeat（adj85：原用起始拍导致附点跨密集拍时段宽与拍宽不一致、行尾留白）
const r43a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2// 3// 4// 5// 6// 7// 1// | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const n43a = [...layoutScore(r43a, defaultPageConfig).pages[0].notes].sort((a, b) => a.x - b.x)[0]
const sg43a = n43a.segments ?? []
const dotW = (sg43a[1]?.beats ?? 0) * (sg43a[1]?.perBeat ?? 0)
const baseW = (sg43a[0]?.beats ?? 0) * (sg43a[0]?.perBeat ?? 0)
check('附点段宽 = 所在拍 0.5 拍宽（与 2// 同拍同 perBeat）', sg43a.length >= 2 && dotW === 0.5 * (sg43a[1]?.perBeat ?? 0), `dot=${dotW} pb=${sg43a[1]?.perBeat}`)
// 附点音符总宽 = 基础拍 1 + 所在拍 0.5（行尾不因附点留白）
check('附点音符占位 = 1 基础拍 + 0.5 所在拍宽', sg43a.length >= 2 && Math.abs(baseW + dotW - ((sg43a[0]?.perBeat ?? 0) + 0.5 * (sg43a[1]?.perBeat ?? 0))) < 0.05, `w=${baseW + dotW}`)
// adj85：附点跨密集拍时段宽与拍宽自洽，行内容撑满（两端对齐，末段右贴右边界）
const r43j = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 - - 0 | 2 2/ 6,/ 2 - | 3 (2/ 3// 2//) 1 - | 7,/ 7,/ 7,/ 1/ 2. (1// 2//) | 3 - - 0 |\nQ: 3/ 1\' 7/ (6. 5/) | (5/ 6/) (7/ 6/) 6 - | 5/ 5/ 5/ 3/ (2/ 3/) (5/ 2/) | 3 - - 0 | 6,/ 3 1/ 2 - |\n')
const lay43j = layoutScore(r43j, defaultPageConfig)
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
// ② 连音线端点 = 音符正上方偏右/左 1px，弧线在高八度点上方
const r43b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 4 ) 5 |\n')
const lay43b = layoutScore(r43b, defaultPageConfig)
const s43b = lay43b.pages[0].slurs[0]
const n43b = lay43b.pages[0].notes
check('slur 起点 = 开始音符中心+1', s43b !== undefined && Math.abs(s43b.x1 - (n43b[1].x + 6.58)) < 0.5, `x1=${s43b?.x1}`)
check('slur 终点 = 结束音符中心-1', Math.abs(s43b.x2 - (n43b[3].x + 4.58)) < 0.5, `x2=${s43b.x2}`)
// adj60：雅黑数字字高 ≈0.8em → 数字上沿 ≈ 基线-14.4；无高八度 → 线底距数字上沿 LAYER_GAP=2 → y = 基线-16.9（线宽 1 中心）
check('slur 下沿距音符上沿 2px（adj60）', Math.abs(s43b.y - (n43b[1].y - 16.9)) < 0.5, `y=${s43b.y} expect=${n43b[1].y - 16.9}`)
// 开始音符有高八度：线底距最高高音点顶 2px → y = 基线-21.9（adj60）
const r43d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2\' 3 ) 4 |\n')
const s43d = layoutScore(r43d, defaultPageConfig).pages[0].slurs[0]
const n43d = layoutScore(r43d, defaultPageConfig).pages[0].notes[1]
check('slur 下沿距高音点 2px（adj60）', Math.abs(s43d.y - (n43d.y - 21.9)) < 0.5, `y=${s43d.y} expect=${n43d.y - 21.9}`)
// ③ 小节线 = 小节内容右端，不与音符重叠
const r43c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const lay43c = layoutScore(r43c, defaultPageConfig)
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
  const m = [...svg.matchAll(new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${DOT_R_DOT}"`, 'g'))][k]
  return m ? Number(m[1]) : NaN
}
// 1.：附点紧接音符后（cx = 数字右缘 + 半径），时值占位宽仍增半（0.5×前音符宽，见 [43]）
const r45a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const lay45a = layoutScore(r45a, defaultPageConfig)
const n45a = lay45a.pages[0].notes[0]
const dot45aExpect = n45a.x + defaultPageConfig.note_size * 0.62 + DOT_R_DOT
check('1. 附点紧接音符后（adj71）', Math.abs(dotCxOf(renderScoreToSvg(lay45a)[0], 0) - dot45aExpect) < 0.5, `cx=${dotCxOf(renderScoreToSvg(lay45a)[0], 0)} expect=${dot45aExpect}`)
// 双附点 1..：附点1 贴数字右缘，附点2 紧贴附点1（间距 2×r）
const r45b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1.. 2 3 4 |\n')
const lay45b = layoutScore(r45b, defaultPageConfig)
const svg45b = renderScoreToSvg(lay45b)[0]
const n45b = lay45b.pages[0].notes[0]
const dot45b0 = n45b.x + defaultPageConfig.note_size * 0.62 + DOT_R_DOT
const dot1 = dotCxOf(svg45b, 0)
const dot2 = dotCxOf(svg45b, 1)
check('双附点：附点1 贴数字右缘、附点2 紧贴附点1（间距 2×r）', Math.abs(dot1 - dot45b0) < 0.5 && Math.abs(dot2 - (dot45b0 + DOT_R_DOT * 2)) < 0.5, `d1=${dot1} d2=${dot2}`)

// ---- 46. 歌词对齐：@ 占位 / 标点紧跟（adj40） ----
console.log('[46] lyric @ and punct (adj40)')
// @ 占位：该处留空，其后歌词后移到下一个音符
const r46a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 @ 二 三\n')
const lay46a = layoutScore(r46a, defaultPageConfig)
const l46a = lay46a.pages[0].lyrics
check('@ 占位：3 个字渲染（一、二、三）', l46a.length === 3, `got ${l46a.length}`)
// 行 4 拍：perBeat = (435.28-12)/4 = 105.82；二（对 3）与一（对 1）差 2 拍
check('@ 后歌词后移（二 对音符 3）', Math.abs(l46a[1].x - l46a[0].x - (2 * 102.82 + 8)) < 1, `dx=${l46a[1].x - l46a[0].x}`)
// 标点不占音符位，紧跟前面的字渲染
const r46b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一，二。三\n')
const l46b = layoutScore(r46b, defaultPageConfig).pages[0].lyrics
check('标点不占音符位置（3 个歌词字）', l46b.length === 3 && l46b[1].char.text === '二' && l46b[1].char.trailing === '。', `got ${l46b.length}`)
const svg46b = renderScoreToSvg(layoutScore(r46b, defaultPageConfig))[0]
check('标点独立渲染在本字之后（一 与 ，相邻，adj40）', svg46b.includes('>一<') && svg46b.includes('>，<') && svg46b.includes('>二<') && svg46b.includes('>。<'), '')

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
const svgJ = renderScoreToSvg(layoutScore(rJ, defaultPageConfig))[0]
const tempoElJ = /data-meta="tempo"[^>]*>([^<]*)</.exec(svgJ)
check('渲染为 ♩= 80 欢快地', tempoElJ !== null && tempoElJ[1] === '♩= 80 欢快地', tempoElJ?.[1])
// 纯数字 J：照原方式 ♩=N
const rJ2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1 2 3 4 |\n')
const svgJ2 = renderScoreToSvg(layoutScore(rJ2, defaultPageConfig))[0]
const tempoElJ2 = /data-meta="tempo"[^>]*>([^<]*)</.exec(svgJ2)
check('纯数字 J 渲染 ♩= 96（无文字后缀）', tempoElJ2 !== null && tempoElJ2[1] === '♩= 96', tempoElJ2?.[1])
// 拍号分数：数字上下正对、中间横线
const svgM48 = svgJ2 // P: 4/4
const meterG = /<g data-meta="meter" data-meter="([^"]*)">([\s\S]*?)<\/g>/.exec(svgM48)
check('拍号分数组存在（data-meter 保留原文）', meterG !== null && meterG[1] === '4/4', meterG?.[0])
check('拍号分数：分子在上、分母在下、中间横线', meterG !== null && />4<[\s\S]*?<line[\s\S]*?>4</.test(meterG[2]), meterG?.[2])
check('调号文本独立为 1 = C（keyline 元素）', svgM48.includes('data-meta="keyline"') && svgM48.includes('1 = C'))
// 辅助拍号（括号内小一号）
const rM2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4 (2/4)\nJ: 96\nQ: 1 2 3 4 |\n')
const svgM48b = renderScoreToSvg(layoutScore(rM2, defaultPageConfig))[0]
const meterG2 = /<g data-meta="meter" data-meter="([^"]*)">([\s\S]*?)<\/g>/.exec(svgM48b)
check('辅助拍号带括号渲染', meterG2 !== null && meterG2[1] === '4/4 (2/4)' && meterG2[2].includes('(') && meterG2[2].includes(')'), meterG2?.[2])
// 无调号：拍号分数仍渲染在左缘
const svgM48c = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nP: 3/4\nJ: 96\nQ: 1 2 3 |\n'), defaultPageConfig))[0]
check('无调号时拍号分数仍渲染', svgM48c.includes('data-meta="meter"'))

// ---- 49. 拍号分数几何 / 无空格歌词对齐 ----
console.log('[49] meter geometry & no-space lyric alignment')
// 拍号分数：横线 = 调式文字垂直中心（基线 - 0.35×13），分子/分母距线各 2px
const r49 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1 2 3 4 |\n')
const svg49 = renderScoreToSvg(layoutScore(r49, defaultPageConfig))[0]
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
const svg45 = renderScoreToSvg(layoutScore(r45, { ...defaultPageConfig, miaoshu_font: 'SimSun', miaoshu_size: 15 }))[0]
check('描述头字号生效（keyline font-size=15）', svg45.includes('data-meta="keyline"') && svg45.includes('font-size="15" font-family="SimSun"'))
check('描述头字号生效（tempo font-size=15）', svg45.includes('data-meta="tempo"') && svg45.includes('font-size="15" font-family="SimSun"'))
check('描述头字号生效（作者 font-size=14）', svg45.includes('data-meta="author_0"') && svg45.includes('font-size="14" font-family="SimSun"'))
const m45 = /<g data-meta="meter"[^>]*>([\s\S]*?)<\/g>/.exec(svg45)?.[1] ?? ''
check('拍号分数字号随描述头（15px）', m45.includes('font-size="15" font-family="SimSun"'), m45.slice(0, 120))
// 无空格歌词：每汉字独立音节，逐字对中音符、不重叠
const rLy49 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6, (3/ 2/) 3 6 | 3 (1/ 3/) 2 - | 2 6, 1. 2/ | 3 (3/ 5/) 3 - |\nC: 门前@老树长新@芽，院里枯木又开@花\n')
const chars49 = rLy49.groups[0]?.lyrics[0]?.chars ?? []
check('无空格歌词：18 字符（含 3 个 @ 占位 + 14 字）', rLy49.errors.length === 0 && chars49.length === 17, `chars=${chars49.length} errors=${rLy49.errors.length}`)
const layLy49 = layoutScore(rLy49, defaultPageConfig)
const ly49 = layLy49.pages[0].lyrics
const notes49 = layLy49.pages[0].notes
check('无空格歌词：14 字各占一个音符位（@ 不占）', ly49.length === 14, `got ${ly49.length}`)
let alignOk49 = true
let alignDetail49 = ''
for (const ly of ly49) {
  const lx = ly.x + defaultPageConfig.geci_size / 2
  const n = notes49[ly.id.index]
  if (!n || Math.abs(lx - (n.x + 5.58)) > 1) {
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
const lay50 = layoutScore(r50, { ...defaultPageConfig, margin_bottom: 300 })
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
check('单页谱不画页号', !renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'), defaultPageConfig))[0].includes('data-pagenum'))
// ② 跨行连音符：上一行左半部（开始→行末）+ 下一行右半部（行首→结束）
const r50b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 ( 3 4 | 5 6 1 2 |\nQ: 3 4 ) 5 6 | 7 1 2 3 |\n')
const lay50b = layoutScore(r50b, defaultPageConfig)
const notes50b = lay50b.pages[0].notes
check('跨行连音符：左右两半共 2 条', lay50b.pages[0].slurs.length === 2, `got ${lay50b.pages[0].slurs.length}`)
const slL = lay50b.pages[0].slurs[0]
const slR = lay50b.pages[0].slurs[1]
check('左半：起点 = 开始音符中心+1', Math.abs(slL.x1 - (notes50b[2].x + 6.58)) < 0.5, `x1=${slL.x1}`)
// 需求：左半终点延伸到行末小节线
const rowA50b = lay50b.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (notes50b[0].y - 18.4)) < 1)
  .sort((a, b) => a.x - b.x)
const rowAEndBarX = rowA50b[rowA50b.length - 1]?.x ?? 0
check('左半：终点 = 行末小节线', Math.abs(slL.x2 - rowAEndBarX) < 1, `x2=${slL.x2} bar=${rowAEndBarX}`)
check('右半：起点 = 行首边距处', Math.abs(slR.x1 - 80) < 0.5, `x1=${slR.x1}`)
check('右半：终点 = 结束音符中心-1', Math.abs(slR.x2 - (notes50b[9].x + 4.58)) < 0.5, `x2=${slR.x2}`)
check('左右两半在不同行（y 不同）', Math.abs(slL.y - slR.y) > 1, `${slL.y} vs ${slR.y}`)
// ④ 误输入：有 ( 无 ) → 不渲染
const r50c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 ( 3 4 |\nQ: 5 6 7 1 |\n')
check('误输入 ( 无结束：不渲染连音符', layoutScore(r50c, defaultPageConfig).pages[0].slurs.length === 0)
// ⑤ 结束在相隔两行之后（非下一行）→ 视为误输入，不渲染
const r50d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 |\nQ: 4 5 6 |\nQ: 7 ) 8 9 |\n')
check('相隔两行的括号视为误输入：不渲染', layoutScore(r50d, defaultPageConfig).pages[0].slurs.length === 0)
// ⑥ 同一 Q 行断成两可视行时同样适用（( 首行、) 次行）
const r50e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 | 2 3 ( 4 5 | 6 7 1 2 | 3 4 5 6 | 7 1 2 3 | 4 5 6 7 | 1 2 ) 3 4 | 5 6 7 1 | 2 3 4 5 |\n')
const lay50e = layoutScore(r50e, defaultPageConfig)
const rows50e = new Set(lay50e.pages.flatMap((p) => p.notes.map((n) => n.y))).size
check('断行跨行：按相邻行渲染两半', lay50e.pages.flatMap((p) => p.slurs).length === 2, `got ${lay50e.pages.flatMap((p) => p.slurs).length} rows=${rows50e}`)

// ---- 51. 连音符先进后出（LIFO）跨行配对 ----
console.log('[51] slur LIFO pairing (adj55)')
// 用户示例（带空格）：1 ( 2 3 ( 4 ) | / 1 ) 2 3 4
// LIFO：内层 (4) 先闭合 → 起点=终点退化不渲染；外层 ( 跨行到第二行 ) → 一条跨行两半
const r51 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ( 4 ) |\nQ: 1 ) 2 3 4\n')
const lay51 = layoutScore(r51, defaultPageConfig)
check('LIFO：1 条跨行连音符渲染两半', lay51.pages[0].slurs.length === 2, `got ${lay51.pages[0].slurs.length}`)
const n51 = lay51.pages[0].notes
const s51 = lay51.pages[0].slurs
const rowEnd51 = lay51.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (n51[0].y - 18.4)) < 1)
  .sort((a, b) => a.x - b.x)
check('连音符左半：第一行 2 → 行末小节线', Math.abs(s51[0].x1 - (n51[1].x + 6.58)) < 0.5 && Math.abs(s51[0].x2 - (rowEnd51[rowEnd51.length - 1]?.x ?? 0)) < 1, `x1=${s51[0].x1} x2=${s51[0].x2} bar=${rowEnd51[rowEnd51.length - 1]?.x}`)
check('连音符右半：行首边距处 → 第二行 1', Math.abs(s51[1].x1 - 80) < 0.5 && Math.abs(s51[1].x2 - (n51[4].x + 4.58)) < 0.5, `x1=${s51[1].x1} x2=${s51[1].x2}`)
check('左右两半 y 不同（跨行）', Math.abs(s51[0].y - s51[1].y) > 1, `${s51[0].y} vs ${s51[1].y}`)
check('LIFO 深度均为 0（内层 (4) 退化丢弃）', s51[0].depth === 0 && s51[1].depth === 0, JSON.stringify(s51.map((s) => s.depth)))
// 无空格紧凑写法与带空格等价（空格仅格式化；(4) 也是连音线）
const r51b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1(23(4)|\nQ: 1)234\n')
const lay51b = layoutScore(r51b, defaultPageConfig)
check('无空格紧凑写法：与带空格同（跨行两半）', r51b.errors.length === 0 && lay51b.pages[0].slurs.length === 2, `errors=${r51b.errors.length} slurs=${lay51b.pages[0].slurs.length}`)

// ---- 52. 小节线类型渲染 ----
console.log('[52] barline styles')
const mk52 = (q: string) =>
  layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`), defaultPageConfig)
const svg52 = (lay: ReturnType<typeof mk52>) => renderScoreToSvg(lay)[0]
const barlineRects = (svg: string, cx: number, r: number) =>
  [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="(0\.9|1\.4)" height="22\.9"/g)]
    .map((m) => ({ x: +m[1], w: m[2] }))
    .filter((o) => Math.abs(o.x - cx) < r)
const barlineDots = (svg: string, cx: number, r: number) =>
  [...svg.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="1.2"/g)]
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
const rectCount52 = (s: string) => (s.match(/width="(?:0\.9|1\.4)" height="22\.9"/g) ?? []).length
check('|/ 不渲染线（rect 数比 | 版本少 1）', rectCount52(svg52(lay52f)) === rectCount52(svg52(lay52h)) - 1, `${rectCount52(svg52(lay52f))} vs ${rectCount52(svg52(lay52h))}`)
const gap52f = lay52f.pages[0].notes[4].x - (lay52f.pages[0].notes[3].x + 11.16)
const gap52h = lay52h.pages[0].notes[4].x - (lay52h.pages[0].notes[3].x + 11.16)
check('|/ 不占位（小节间音符间隙比 | 小约 9.5px）', Math.abs(gap52h - gap52f - 9.5) < 2, `|/=${gap52f.toFixed(1)} |=${gap52h.toFixed(1)}`)
check('|* 占位（与 | 布局一致）', Math.abs(lay52g.pages[0].notes[4].x - lay52h.pages[0].notes[4].x) < 0.5, `${lay52g.pages[0].notes[4].x} vs ${lay52h.pages[0].notes[4].x}`)
check('|* 不渲染线（rect 数比 | 版本少 1）', rectCount52(svg52(lay52g)) === rectCount52(svg52(lay52h)) - 1, `${rectCount52(svg52(lay52g))} vs ${rectCount52(svg52(lay52h))}`)

// ---- 53. 连音符：紧贴括号 + 跨行（用户示例，LIFO adj55） ----
console.log('[53] slur tight parens & cross-row (LIFO)')
// Q: 1 (2 3 (4) |  /  Q: 1) 2 3 4 |
// LIFO：内层 (4) 退化丢弃；外层 ( 跨行 → 一条跨行连音符（左半 2→行末、右半 行首→1）
const r53 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 (2 3 (4) |\nQ: 1) 2 3 4 |\n')
const lay53 = layoutScore(r53, defaultPageConfig)
check('无解析错误（空格可选、紧贴括号合法）', r53.errors.length === 0, JSON.stringify(r53.errors))
const n53 = lay53.pages[0].notes
const s53 = lay53.pages[0].slurs
check('LIFO：1 条跨行连音符 → 左半 + 右半', s53.length === 2, `got ${s53.length}`)
const rowEnd53 = lay53.pages[0].barlines
  .filter((b) => Math.abs(b.yTop - (n53[0].y - 18.4)) < 1)
  .sort((a, b) => a.x - b.x)
check('连音符左半：第一行 2 → 行末小节线', Math.abs(s53[0].x1 - (n53[1].x + 6.58)) < 0.5 && Math.abs(s53[0].x2 - (rowEnd53[rowEnd53.length - 1]?.x ?? 0)) < 1, `x1=${s53[0].x1} x2=${s53[0].x2} bar=${rowEnd53[rowEnd53.length - 1]?.x}`)
check('连音符右半：行首边距处 → 第二行 1', Math.abs(s53[1].x1 - 80) < 0.5 && Math.abs(s53[1].x2 - (n53[4].x + 4.58)) < 0.5, `x1=${s53[1].x1} x2=${s53[1].x2}`)
check('左右两半跨行（y 不同）', Math.abs(s53[0].y - s53[1].y) > 1, `${s53[0].y} vs ${s53[1].y}`)
// adj108：跨行连音线优先弧线（默认样式；原 adj89 强制平顶）
check('跨行连音符弧线（adj108）', s53[0].style === 'arc' && s53[1].style === 'arc', `${s53[0].style}/${s53[1].style}`)
const svg53 = renderScoreToSvg(lay53)[0]
const hlY = s53[0].y
const hrY = s53[1].y
// 弧线半部：左半从音符竖直上弯到行末最高点（右侧开口）；右半行首最高点弯到音符（左侧开口）
check('弧线左半：起点竖直上弯到行末最高点（右侧开口）', svg53.includes(`M ${s53[0].x1} ${hlY} C ${s53[0].x1} ${(hlY - 9).toFixed(1)} ${s53[0].x2} ${(hlY - 4.5).toFixed(1)}`), '')
check('弧线右半：行首最高点弯到终点（左侧开口）', svg53.includes(`M ${s53[1].x1} ${(hrY - 4.5).toFixed(1)} C ${s53[1].x1} ${(hrY - 4.5).toFixed(1)} ${s53[1].x2} ${(hrY - 9).toFixed(1)} ${s53[1].x2} ${hrY}`), '')
// 用户强制平顶（lianyinxian_type=2）：跨行仍平顶（adj108 尊重设置）
const lay53f = layoutScore(r53, { ...defaultPageConfig, lianyinxian_type: 2 })
const svg53f = renderScoreToSvg(lay53f)[0]
const s53fL = lay53f.pages[0].slurs.find((s) => s.half === 'l')
const s53fR = lay53f.pages[0].slurs.find((s) => s.half === 'r')
check('平顶左半：横线 + 弧线，右侧开口', s53fL !== undefined && svg53f.includes(`L ${s53fL.x2} ${(s53fL.y - 7).toFixed(1)}"`), '')
check('平顶右半：横线 + 弧线，左侧开口', s53fR !== undefined && svg53f.includes(`M ${s53fR.x1} ${(s53fR.y - 7).toFixed(1)}`), '')

// ---- 54. 非整拍小节/密集行不溢出边距 ----
console.log('[54] fractional-bar & dense-row no overflow')
const r54 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\nQ: 1) 6,. 0/ 6,/ ((6/ 5/) | 5/)) 5. 0/~ 2/ 2 1/ | 2/ 3 (3/ 3) - | 3./ (3// 3/) 2/ 7, - |\n',
)
const lay54 = layoutScore(r54, defaultPageConfig)
check('密集行无 error 级解析错误', r54.errors.filter((e) => e.severity === 'error').length === 0, JSON.stringify(r54.errors.filter((e) => e.severity === 'error')))
const n54 = lay54.pages[0].notes
const maxNoteR54 = Math.max(...n54.map((n) => n.x + n.width))
check('非整拍小节行：音符不溢出右边距', maxNoteR54 <= 515.28, `right=${maxNoteR54}`)
const maxBarR54 = Math.max(...lay54.pages[0].barlines.map((b) => b.x + ({ '|': 0.55, '||': 1.95, '||/': 1.6, '|:': 4.2, ':|': 4.2, ':|:': 8.1, '||:': 3.85, '|*': 0.55 }[b.type] ?? 0.55)))
check('小节线不溢出右边距（右缘 = 中心+半宽 ≤ 515.28）', maxBarR54 <= 515.28, `right=${maxBarR54}`)
// 混合时值（16 分音符）不重叠
const r54b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3// 4// | 1/ 2/ 3// 4// |\n')
const n54b = [...layoutScore(r54b, defaultPageConfig).pages[0].notes].sort((a, b) => a.x - b.x)
let minGap54 = Infinity
for (let i = 1; i < n54b.length; i++) minGap54 = Math.min(minGap54, n54b[i].x - n54b[i - 1].x)
check('跨拍/拍中起始音符不重叠（最小间距 ≥ 11）', minGap54 >= 11, `minGap=${minGap54}`)
// 行首 |* 占位、|/ 不占位（需求）
const r54c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |* 1 2 3 4 |\n')
const n54c = layoutScore(r54c, defaultPageConfig).pages[0].notes[0]
check('行首 |* 占位（音符右移）', n54c.x > 86 + 3, `x=${n54c.x}`)

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
const lay55 = layoutScore(r55b, defaultPageConfig)
const svg55 = renderScoreToSvg(lay55)[0]
const s55 = lay55.pages[0].slurs.find((s) => s.tupletCount === 4)
check('平均组 tupletCount=4', s55 !== undefined)
const label55 = svg55.includes(`>4</text>`) && svg55.includes('rx="2"')
check('渲染：数字 4 + 不透明背景 rect', label55)
// adj43：普通连音线 (…) 不标注数字——(1 2 3) 无 tupletCount、SVG 无数字标签
const lay55c = layoutScore(r55c, defaultPageConfig)
const s55c = lay55c.pages[0].slurs
check('普通连音线 (…) 无 tupletCount', s55c.length === 1 && s55c[0].tupletCount === undefined, JSON.stringify(s55c.map((s) => s.tupletCount)))
check('普通连音线 (…) SVG 不渲染数字', !renderScoreToSvg(lay55c)[0].includes('rx="2"'))
// adj89：数字字号 = 音符字号 × TUPLET_NUM_RATIO（0.2×18=3.6 → 下限 7）；基线 = 弧线顶点 + 2
const labelEl55 = /rx="2"[^>]*\/><text x="([\d.]+)" y="([\d.]+)"[^>]*>4<\/text>/.exec(svg55)
const labelY55 = labelEl55 ? Number(labelEl55[2]) : NaN
check('数字字号随音符（0.2×18 → 7）', svg55.includes('font-size="7"'), '')
check('数字下移 2px（基线 = 线顶点 + 2）', Number.isFinite(labelY55) && Math.abs(labelY55 - (s55!.y - 4.5 + 2)) < 0.5, `labelY=${labelY55} slur.y=${s55?.y}`)
// 平均组占宽：4 个 0.75 拍音符 vs 3 个 1 拍音符——同一小节宽一致
const lay55a = layoutScore(r55, defaultPageConfig)
const n55a = [...lay55a.pages[0].notes].sort((a, b) => a.x - b.x)
const n55b = [...lay55.pages[0].notes].sort((a, b) => a.x - b.x)
check('平均组音符等宽（等分时值）', Math.abs(n55a[1].width - n55a[0].width) < 0.5 && Math.abs(n55b[1].width - n55b[0].width) < 0.5, `a=${n55a[0].width},${n55a[1].width} b=${n55b[0].width},${n55b[1].width}`)
// adj44：跨拍平均连音组音符等距（用户示例 0/ 7/ 7/ 1'/ (y2' 7 6)）
const r55d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0/ 7/ 7/ 1\'/ (y2\' 7 6) |\n')
const lay55d = layoutScore(r55d, defaultPageConfig)
const n55d = [...lay55d.pages[0].notes].filter((n) => n.token.kind === 'note' && (n.token as { tupletDur?: number }).tupletDur !== undefined).sort((a, b) => a.x - b.x)
const gapD1 = n55d[1].x - n55d[0].x
const gapD2 = n55d[2].x - n55d[1].x
check('跨拍平均组音符等距（相邻间距一致）', n55d.length === 3 && Math.abs(gapD1 - gapD2) < 0.6, `gaps=${gapD1.toFixed(2)},${gapD2.toFixed(2)}`)
// adj44：中间音符带高八度 → 连音线整体上移避开（线 y = 基线-26，而不是只查端点）
const r55e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2\' 3 4) 5 |\n')
const lay55e = layoutScore(r55e, defaultPageConfig)
const s55e = lay55e.pages[0].slurs[0]
const n55eMid = lay55e.pages[0].notes.find((n) => n.token.kind === 'note' && (n.token as { pitch?: number }).pitch === 2)
check('连音线避让中间音符高音点（y = 基线-21.9，adj60）', s55e !== undefined && n55eMid !== undefined && Math.abs(s55e.y - (n55eMid.y - 21.9)) < 0.5, `slurY=${s55e?.y} midY=${n55eMid?.y}`)
// adj49：独立连音符不被同排其他嵌套抬高（间距保持 2px 基准）
const r55f = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (1 2) (3 (4 5) 6) 7 |\n')
const lay55f = layoutScore(r55f, defaultPageConfig)
const s55f = lay55f.pages[0].slurs
const n55fFirst = lay55f.pages[0].notes[0]
check('独立连音符不因同排嵌套抬高（y = 基线-16.9，adj60）', s55f.length >= 2 && Math.abs(s55f[0].y - (n55fFirst.y - 16.9)) < 0.5, `y=${s55f[0]?.y} expect=${n55fFirst.y - 16.9}`)

// ---- 56. 跨行跳房子起点（adj47）：断行在 [ 起点小节线后 → 起点线移到下一行行首 ----
console.log('[56] cross-row volta start')
const r56 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3/ 2// 3//) 5 (3/ 2// 3//) 1 | (2./ 3//) (2/ 1/) 6, - | 5,/ (5,// 6,//) (5/ 3/) (2. 3/) |[+"1." (2/ 0// 3//) (5,/ 6,/) 1[6,/] - :|]\n',
)
const lay56 = layoutScore(r56, defaultPageConfig)
// 该行自然宽 498 > 可用 435 → 正确断成 2 行
const rows56 = [...new Set(lay56.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('超宽行断成 2 行', rows56.length === 2, `rows=${rows56.length}`)
const segEnd56 = (n: PlacedToken) => {
  const s = n.segments?.[n.segments.length - 1]
  return s ? s.x + s.beats * s.perBeat : n.x + n.width
}
for (const y of rows56) {
  const notes = lay56.pages[0].notes.filter((n) => n.y === y)
  check('每行音符不溢出右边距', Math.max(...notes.map(segEnd56)) <= 515.28, `y=${y} right=${Math.max(...notes.map(segEnd56)).toFixed(1)}`)
}
// 跳房子起点 [ 移到下一行行首（不留在行尾溢出、不跨行反向）
const vStart56 = lay56.pages[0].barlines.find((b) => b.voltaStart)
const vEnd56 = lay56.pages[0].barlines.find((b) => b.voltaEnd)
check('跳房子起点线在行首（x < 100）', vStart56 !== undefined && vStart56.x < 100, `x=${vStart56?.x}`)
check('跳房子起点与终点在同一行（y 相同）', vStart56 !== undefined && vEnd56 !== undefined && Math.abs(vStart56.yTop - vEnd56.yTop) < 1, `${vStart56?.yTop} vs ${vEnd56?.yTop}`)
check('跳房子番号在起点线右侧（不溢出右边距）', vStart56 !== undefined && vStart56.x + 8 < 515.28, `x=${vStart56?.x}`)
check('跳房子线正向（终点 x > 起点 x，不再反向跨行）', vStart56 !== undefined && vEnd56 !== undefined && vEnd56.x > vStart56.x, `${vStart56?.x} → ${vEnd56?.x}`)
// adj107：跳房子允许跨行——[ 在行内、] 在下一行时拆两半（左半到行末小节线、右半从行首小节线）
const r107 = parseJps(
  'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3/ 2// 3//) 5 (3/ 2// 3//) 1 | (2./ 3//) (2/ 1/) 6, - |[+"1." (2/ 0// 3//) (5,/ 6,/) 1[6,/] - | 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ | 3/ 4/ 5/ 6/ 7/ 1/ |] 2/ 3/ 4/ | 1/ 2/ 3/ 4/ |\n',
)
const lay107 = layoutScore(r107, defaultPageConfig)
const vStart107 = lay107.pages[0].barlines.find((b) => b.voltaStart)
const vEnd107 = lay107.pages[0].barlines.find((b) => b.voltaEnd)
check('adj107 跨行跳房子：起点与终点在不同行', vStart107 !== undefined && vEnd107 !== undefined && Math.abs(vStart107.yTop - vEnd107.yTop) > 1, `${vStart107?.yTop} vs ${vEnd107?.yTop}`)
const svg107 = renderScoreToSvg(lay107)[0]
const voltaLines107 = [...svg107.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#1b1b1b" stroke-width="1"/g)]
  .map((m) => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]) }))
  .filter((l) => l.x2 - l.x1 > 20)
check('adj107 跨行跳房子拆两半（2 条线、y 不同）', voltaLines107.length === 2 && Math.abs(voltaLines107[0].y1 - voltaLines107[1].y1) > 1, JSON.stringify(voltaLines107))
const sortedVolta107 = [...voltaLines107].sort((a, b) => a.y1 - b.y1)
const leftHalf107 = sortedVolta107[0]
const rightHalf107 = sortedVolta107[1]
const row1Bars107 = lay107.pages[0].barlines.filter((b) => Math.abs(b.yTop - vStart107.yTop) < 1)
const row2Bars107 = lay107.pages[0].barlines.filter((b) => Math.abs(b.yTop - vEnd107.yTop) < 1)
const row1LastX107 = Math.max(...row1Bars107.map((b) => b.x))
const row2FirstX107 = Math.min(...row2Bars107.map((b) => b.x))
check('adj107 左半：起点线+2 → 行末小节线-2', leftHalf107 !== undefined && Math.abs(leftHalf107.x1 - (vStart107.x + 2)) < 0.5 && Math.abs(leftHalf107.x2 - (row1LastX107 - 2)) < 0.5, JSON.stringify(leftHalf107))
check('adj107 右半：行首小节线+2 → 终点线-2', rightHalf107 !== undefined && Math.abs(rightHalf107.x1 - (row2FirstX107 + 2)) < 0.5 && Math.abs(rightHalf107.x2 - (vEnd107.x - 2)) < 0.5, JSON.stringify(rightHalf107))

// ---- 57. 排版虚线行结构（adj72）：曲部行数字中心 / 多声部声部序号 / 词部行虚线 ----
console.log('[57] row guides (adj72)')
const rg72of = (src: string) => {
  const lay = layoutScore(parseJps(src), defaultPageConfig)
  return computeRowGuides(lay, { quci: defaultPageConfig.height_quci, geci: defaultPageConfig.geci_size }, defaultPageConfig.note_size)[0]
}
const rg72a = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n')
check('曲部行虚线数字中心（yCenter = 基线-0.4×字号）', Math.abs(rg72a[0].yCenter - (layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'), defaultPageConfig).pages[0].notes[0].y - defaultPageConfig.note_size * 0.4)) < 0.5, `yc=${rg72a[0].yCenter}`)
check('单声部 voiceIdx = 0', rg72a[0].voiceIdx === 0, `v=${rg72a[0].voiceIdx}`)
const rg72b = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 4 |\nQ2: 5 6 7 1 |\n')
check('多声部：块内第 2 声部 voiceIdx = 1', rg72b.some((r) => r.voiceIdx === 1), JSON.stringify(rg72b.map((r) => r.voiceIdx)))
const rg72c = rg72of('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八\nC: 九 十 十 一 十 二 十 三 十 四\n')
check('多行歌词：lyricRows 每行一条（2 条）', rg72c[0].lyricRows.length === 2, JSON.stringify(rg72c[0].lyricRows))
check('词部行虚线中心 = 基线-0.3×歌词字号', Math.abs(rg72c[0].lyricRows[0].center - (rg72c[0].lyricRows[0].y - defaultPageConfig.geci_size * 0.3)) < 0.5, JSON.stringify(rg72c[0].lyricRows[0]))

console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
// DEBUG ռλ
