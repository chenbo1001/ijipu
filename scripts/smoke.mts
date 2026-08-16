/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, formatJps, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig } from '../src/engine/index.ts'
import { buildPlaySequence, inferBpm } from '../src/engine/playback/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '../src/engine/cursorMap.ts'
import { computeRowTops, dragDelta, clamp } from '../src/engine/layout/guides.ts'
import { computeBeamsForTest } from '../src/engine/render/index.ts'
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
check('SVG 含增时线 rect', svg2.includes('height="2.6"'))
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

// 跳房子（第二遍跳过 [ ] 段）
const ps2 = mkSeq('|: 1 2 [ 3 4 ] 5 6 :|')
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

// 行距配置：ciqu 增大 → 第二行更靠下
const y1 = layoutScore(r2, defaultPageConfig).pages[0].notes[14].y
const y2 = layoutScore(r2, { ...defaultPageConfig, height_ciqu: 200 }).pages[0].notes[14].y
check('曲上间距增大 → 第二行更靠下', y2 - y1 > 50, `diff=${y2 - y1}`)

// 字形三套
const svgA = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'a' }))[0]
const svgB = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'b' }))[0]
const svgC = renderScoreToSvg(layoutScore(r2, { ...defaultPageConfig, shuzi_font: 'c' }))[0]
check('字形 a = 衬线', svgA.includes('Georgia'))
check('字形 b = 黑体（默认）', svgB.includes('Microsoft YaHei') && !svgB.includes('Georgia'))
check('字形 c = 楷体', svgC.includes('KaiTi'))

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
const voltaLines = (svgVo.match(/stroke-width="1.4"/g) ?? []).length
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
const openLines = (svgVo3.match(/stroke-width="1.4"/g) ?? []).length
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
check('深度 1 的线更高（y 更小）', laySl2.pages[0].slurs[0].y < laySl2.pages[0].slurs[1].y, `${laySl2.pages[0].slurs[0].y} vs ${laySl2.pages[0].slurs[1].y}`)
// 平顶样式
const laySl3 = layoutScore(slur, { ...defaultPageConfig, lianyinxian_type: 2 })
const svgSl3 = renderScoreToSvg(laySl3)[0]
check('平顶样式无贝塞尔', !svgSl3.includes('<path d="M'))

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
check('最后一行均分（单行谱无上一行 → 铺满均分）', Math.abs(notesW2[4].x + 6 - (80 + 217.5 + 6 + 0.5 * 51.375)) < 0.5, `x=${notesW2[4].x} center=${notesW2[4].x + 6}`)
// 两端对齐 + 小节均分：8 小节 → 行 1（6 小节）铺满均分，行 2（最后 2 小节）自然宽不撑满
const rj2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const layJ = layoutScore(rj2, defaultPageConfig)
const rowsJ = [...new Set(layJ.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('8 小节断成 2 行', rowsJ.length === 2, `rows=${rowsJ.length}`)
const row1Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[0])
const maxRight1 = Math.max(...row1Notes.map(segEnd))
check('行 1 两端对齐（末音符段终点贴近右边界）', maxRight1 > 515.28 - 10, `right=${maxRight1}`)
// 行 1 小节均分：第 2 小节首音符（行 1 第 5 个音符）中心 = 段起点 + 半拍宽
const row1Sorted = row1Notes.sort((a, b) => a.x - b.x)
check('行 1 小节均分（第 2 小节首音符中心）', Math.abs(row1Sorted[4].x + 6 - (80 + 435 / 6 + 6 + 7.5625)) < 0.5, `x=${row1Sorted[4].x} center=${row1Sorted[4].x + 6}`)
const row2Notes = layJ.pages[0].notes.filter((n) => n.y === rowsJ[1])
const maxRight2 = Math.max(...row2Notes.map(segEnd))
check('最后一行不撑满（段终点留空）', maxRight2 < 515.28 - 10, `right=${maxRight2}`)

// ---- 23. 细节修复（adj2） ----
console.log('[23] adj2 fixes')
// 小节线位置：单行谱（最后一行自然宽 barW=70），线画在小节右边界
const rbar = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layBar = layoutScore(rbar, defaultPageConfig)
const bars23 = layBar.pages[0].barlines
check('小节线 2 条', bars23.length === 2, `got ${bars23.length}`)
// 单行谱最后一行均分：barW = 435/2 = 217.5
check('线 1 在小节 1 右边界', Math.abs(bars23[0].x - (80 + 217.5)) < 1, `x=${bars23[0].x}`)
check('线 2 在小节 2 右边界', Math.abs(bars23[1].x - (80 + 435)) < 1, `x=${bars23[1].x}`)
// 行首空 seg（|:）不占宽：音符 1 中心贴左边距+BAR_PAD+半拍，|: 画在行首
const rr23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 | 5 6 7 1 |\n')
const layRr = layoutScore(rr23, defaultPageConfig)
const noteRr = layRr.pages[0].notes[0]
// 均分 barW=217.5，perBeat=51.375；音符 1 中心 = 86 + 25.6875
check('行首 |: 不占宽（音符 1 中心贴左边距+BAR_PAD+半拍）', Math.abs(noteRr.x + 6 - (86 + 25.6875)) < 0.5, `center=${noteRr.x + 6}`)
check('|: 线画在行首', Math.abs(layRr.pages[0].barlines[0].x - 80) < 1, `x=${layRr.pages[0].barlines[0].x}`)
// 歌词中心对齐音符数字（增时线音符 1- 的歌词在数字下方）
const rly23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\nC: 一 二 三 四\n')
const layLy = layoutScore(rly23, defaultPageConfig)
const n23 = layLy.pages[0].notes[0]
const l23 = layLy.pages[0].lyrics[0]
check('歌词中心对齐音符数字', Math.abs(l23.x + defaultPageConfig.geci_size / 2 - (n23.x + 6)) < 1, `lyric=${l23.x} note=${n23.x}`)
// 增时线渲染为水平横线（y 高于基线，非下划线）
const svg23 = renderScoreToSvg(layLy)[0]
check('增时线存在（height=2.6）', (svg23.match(/height="2.6"/g) ?? []).length >= 1)
const noteY23 = n23.y
const augRectY = /<rect x="[^"]+" y="([\d.]+)" width="[\d.]+" height="2.6"/.exec(svg23)
check('增时线在数字中部（y = 基线-8）', augRectY !== null && Math.abs(Number(augRectY[1]) - (noteY23 - 8)) < 0.5, `rectY=${augRectY?.[1]} noteY=${noteY23}`)

// ---- 24. 对齐精细（adj3：音符段内居中 + 减时线按拍分组） ----
console.log('[24] adj3 alignment')
// 音符段内居中：单行谱最后一行均分（barW=435, perBeat=105.75），1 拍音符中心 = 拍段中点
const rc24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n')
const layC24 = layoutScore(rc24, defaultPageConfig)
const n24 = layC24.pages[0].notes[0]
check('1 拍音符居中于拍段', Math.abs(n24.x + 6 - (86 + 52.875)) < 0.5, `center=${n24.x + 6}`)
// 1/ 2/ 各居中于半拍段（均分 perBeat=105.75）
const rh24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ |\n')
const nH24 = layoutScore(rh24, defaultPageConfig).pages[0].notes
check('1/ 居中于第 1 半拍段', Math.abs(nH24[0].x + 6 - (86 + 0.25 * 105.75)) < 0.5, `center=${nH24[0].x + 6}`)
check('2/ 居中于第 2 半拍段', Math.abs(nH24[1].x + 6 - (86 + 0.75 * 105.75)) < 0.5, `center=${nH24[1].x + 6}`)
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

// ---- 25. 最后一行对齐（adj4） ----
console.log('[25] adj4 last-row align')
// 8 小节：行 1 = 6 小节（均分 72.5），行 2 = 2 小节 → 行 2 按行 1 网格对齐
const barsJ25 = layJ.pages[0].barlines
// barlines.yTop 是行顶，音符 y = 行顶 + 18×1.1
const rowTop = (noteY: number) => noteY - 18 * 1.1
const row1Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[0])) < 0.5)
const row2Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[1])) < 0.5)
check('行 1 6 条小节线', row1Bars.length === 6, `got ${row1Bars.length}`)
check('行 2 2 条小节线', row2Bars.length === 2, `got ${row2Bars.length}`)
check('行 2 小节线对齐行 1 网格', Math.abs(row2Bars[0].x - row1Bars[0].x) < 0.5 && Math.abs(row2Bars[1].x - row1Bars[1].x) < 0.5, `row2=${row2Bars[0].x},${row2Bars[1].x} row1=${row1Bars[0].x},${row1Bars[1].x}`)

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
const beatStartAu = segStartAu + perBeatAu
const expectLX = beatStartAu + (perBeatAu - 11.16) / 2 // 固定宽 11.16 居中于第 2 拍段
const rectsAu = [...svgAu.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="2.6"/g)]
check('增时线 1 条', rectsAu.length === 1, `got ${rectsAu.length}`)
const rAu = rectsAu[0]
check('增时线居中于第 2 拍段', rAu !== undefined && Math.abs(Number(rAu[1]) - expectLX) < 0.5, `x=${rAu?.[1]} expect=${expectLX}`)
check('增时线宽 = 字符占宽（11.16，不拉伸）', rAu !== undefined && Math.abs(Number(rAu[2]) - 11.16) < 0.5, `w=${rAu?.[2]}`)

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

console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
