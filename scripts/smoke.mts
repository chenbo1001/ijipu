/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, formatJps, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig } from '../src/engine/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '../src/engine/cursorMap.ts'
import { insertLineHeader, lineColOf, isLineHeaderKey } from '../src/editor/shortcuts.ts'
import { highlightCode } from '../src/editor/highlight.ts'

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
const lyricText = g0.lyrics[0].chars.map((c) => c.text).join('')
check('歌词正确', lyricText === '一闪一闪亮晶晶，满天都是小星星。', lyricText)

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
check('SVG 含调号', svg.includes('1=C'))
check('SVG 含拍号', svg.includes('4/4'))
check('SVG 含节拍', svg.includes('♩=120'))
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
check('SVG 含增时线 rect', svg2.includes('width="7.56"'))
const barRects = (svg2.match(/width="1.5"/g) ?? []).length
check('小节线竖线 3 条（单线 1 + 双线 2）', barRects === 3, `got ${barRects}`)

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
const maxX = Math.max(...layW.pages[0].notes.map((n) => n.x + n.width))
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

console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
