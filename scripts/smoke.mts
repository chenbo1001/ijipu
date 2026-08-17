/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, formatJps, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig, metaAreaH } from '../src/engine/index.ts'
import { buildPlaySequence, inferBpm } from '../src/engine/playback/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '../src/engine/cursorMap.ts'
import { computeRowTops, computeRowGuides, dragDelta, clamp, GUIDE_LIMITS_EX } from '../src/engine/layout/guides.ts'
import { clampMetaPos } from '../src/engine/layout/metaAnchors.ts'
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
// 行总拍数 = 9（1- 2拍 + 3×1 + 4×1）；pads=12+9.5，perBeat = (435.28-21.5)/9 = 45.98
check('每拍宽按行总拍数平均（小节 2 首音符中心）', Math.abs(notesW2[4].x + 6 - (80 + 5 * 45.98 + 9.5 + 6 + 0.5 * 45.98)) < 0.5, `x=${notesW2[4].x} center=${notesW2[4].x + 6}`)
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
check('行 1 小节宽按拍数（第 2 小节首音符中心）', Math.abs(row1Sorted[4].x + 6 - (80 + 4 * 15.12 + 6 + 0.5 * 15.12)) < 0.5, `x=${row1Sorted[4].x} center=${row1Sorted[4].x + 6}`)
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
check('线 1 在小节 1 内容右端+4.75', Math.abs(bars23[0].x - (80 + 6 + 4 * 51.72 + 4.75)) < 1, `x=${bars23[0].x}`)
check('线 2 在小节 2 内容右端+4.75', Math.abs(bars23[1].x - (80 + 6 + 8 * 51.72 + 9.5 + 4.75)) < 1, `x=${bars23[1].x}`)
// 行首空 seg（|:）不占宽：行总拍 7，pads=12+9.5（barCount=2），perBeat = 413.78/7 = 59.11
const rr23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 | 5 6 7 1 |\n')
const layRr = layoutScore(rr23, defaultPageConfig)
const noteRr = layRr.pages[0].notes[0]
check('行首 |: 不占宽（音符 1 中心贴左边距+BAR_PAD+半拍）', Math.abs(noteRr.x + 6 - (86 + 29.55)) < 0.5, `center=${noteRr.x + 6}`)
check('|: 线画在行首', Math.abs(layRr.pages[0].barlines[0].x - 80) < 1, `x=${layRr.pages[0].barlines[0].x}`)
// 歌词中心对齐音符数字（增时线音符 1- 的歌词在数字下方）
const rly23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- 2 3 4 |\nC: 一 二 三 四\n')
const layLy = layoutScore(rly23, defaultPageConfig)
const n23 = layLy.pages[0].notes[0]
const l23 = layLy.pages[0].lyrics[0]
check('歌词中心对齐音符数字', Math.abs(l23.x + defaultPageConfig.geci_size / 2 - (n23.x + 5.58)) < 1, `lyric=${l23.x} note=${n23.x}`)
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
// barlines.yTop = 音符基线 - 17（adj34：高于音符字体上端 4px）
const rowTop = (noteY: number) => noteY - 17
const row1Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[0])) < 0.5)
const row2Bars = barsJ25.filter((b) => Math.abs(b.yTop - rowTop(rowsJ[1])) < 0.5)
check('行 1 7 条小节线', row1Bars.length === 7, `got ${row1Bars.length}`)
check('行 2 1 条小节线', row2Bars.length === 1, `got ${row2Bars.length}`)
// pads=12+9.5×6=69：行 1 perBeat = 366.28/28 = 13.08；线 = 内容右端 + 空间/2（adj38）
check('行 1 小节宽按拍数（线 1 = 80+6+4×13.08+4.75）', Math.abs(row1Bars[0].x - (80 + 6 + 4 * 13.08 + 4.75)) < 0.5, `x=${row1Bars[0].x}`)
check('行 2 每行独立 perBeat（线 1 = 80+6+4×105.82+4.75）', Math.abs(row2Bars[0].x - (80 + 6 + 4 * 105.82 + 4.75)) < 0.5, `x=${row2Bars[0].x} expect=${80 + 6 + 4 * 105.82 + 4.75}`)

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

// ---- 29. 小节间距（adj8/adj15） ----
console.log('[29] bar gap (adj8/adj15)')
// bar_gap=10：pads=12+10=22；perBeat = (435.28-22)/8 = 51.66；小节 1 宽 4×51.66
const gapCfg = { ...defaultPageConfig, bar_gap: 10 }
const layGap = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n'), gapCfg)
const notesGap = layGap.pages[0].notes
// 小节 2 起点 = 80 + 206.64 + 10 = 296.64；首音符中心 = 296.64+6+25.83
check('小节间距生效（小节 2 首音符位置）', Math.abs(notesGap[4].x + 6 - (80 + 206.64 + 10 + 6 + 25.83)) < 0.5, `center=${notesGap[4].x + 6}`)
const barsGap = layGap.pages[0].barlines
check('小节线在内容右端+间距内居中（+6+gap/2，adj36）', Math.abs(barsGap[0].x - (80 + 6 + 206.64 + 5)) < 0.5, `x=${barsGap[0].x}`)

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
check('节拍在 keyline 下', tTempo !== null && Math.abs(tTempo.x - 80) < 0.5 && Math.abs(tTempo.y - 147.6) < 0.5, JSON.stringify(tTempo))
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
const octDot = /<circle cx="([\d.]+)" cy="([\d.]+)" r="2.4"/.exec(renderScoreToSvg(layO34)[0])
check('高音点 x = 数字中心左移 1（adj19）', octDot !== null && Math.abs(Number(octDot[1]) - (nO34.x + 4.58)) < 0.5, `cx=${octDot?.[1]} expect=${nO34.x + 4.58}`)
check('高音点 y = 数字基线上 20（距音符 4px，adj21）', octDot !== null && Math.abs(Number(octDot[2]) - (nO34.y - 20)) < 0.5, `cy=${octDot?.[2]} expect=${nO34.y - 20}`)
// 附点：位置 = 时值结束 + 半值中点，垂直居中
const dot34 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const layD34 = layoutScore(dot34, defaultPageConfig)
const nD34 = layD34.pages[0].notes[0]
const perBeatD34 = nD34.width / nD34.duration
const segStartD34 = nD34.x + 6 - perBeatD34 / 2
// 附点基于基础时值（1. 的 baseDur=1）：中心 = 段起点 + 1.25×baseDur×perBeat
const expectDotX = segStartD34 + 1.25 * perBeatD34
const dotR = /<circle cx="([\d.]+)" cy="([\d.]+)" r="2.4"/.exec(renderScoreToSvg(layD34)[0])
check('附点水平位置（时值结束+半值中点）', dotR !== null && Math.abs(Number(dotR[1]) - expectDotX) < 0.5, `cx=${dotR?.[1]} expect=${expectDotX}`)
check('附点垂直居中（y = 基线-8）', dotR !== null && Math.abs(Number(dotR[2]) - (nD34.y - 8)) < 0.5, `cy=${dotR?.[2]}`)
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
// 低音点 + 减时线：3/, 点顶 = 横线底(基线+8) + 4 → cy = 基线+14.4（adj21）
const d35c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3/, 2 |\n')
const lay35c = layoutScore(d35c, defaultPageConfig)
const n35c = lay35c.pages[0].notes[0]
const dot35c = /<circle cx="([\d.]+)" cy="([\d.]+)" r="2.4"/.exec(renderScoreToSvg(lay35c)[0])
check('低八度点距减时横线 4px、x=数字中心（adj22）', dot35c !== null && Math.abs(Number(dot35c[2]) - (n35c.y + 14.4)) < 0.5 && Math.abs(Number(dot35c[1]) - (n35c.x + 5.58)) < 0.5, `cy=${dot35c?.[2]} cx=${dot35c?.[1]}`)
// 低音点无减时线：3, 点顶 = 数字底(基线+2) + 4 → cy = 基线+8.4
const d35d = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3, 2 |\n')
const lay35d = layoutScore(d35d, defaultPageConfig)
const n35d = lay35d.pages[0].notes[0]
const dot35d = /<circle cx="([\d.]+)" cy="([\d.]+)" r="2.4"/.exec(renderScoreToSvg(lay35d)[0])
check('低八度点距数字底部 4px、x=数字中心（adj22）', dot35d !== null && Math.abs(Number(dot35d[2]) - (n35d.y + 8.4)) < 0.5 && Math.abs(Number(dot35d[1]) - (n35d.x + 5.58)) < 0.5, `cy=${dot35d?.[2]} cx=${dot35d?.[1]}`)

// ---- 36. 音符块语法：后置变音 / 虚音符 / 倚音 / 单空格（adj23） ----
console.log('[36] note block syntax (adj23)')
// 变音后置
const r36a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1# 2$ 3= 4 |\n')
const tk36a = r36a.groups[0].music.tokens
check('变音后置 1# 2$ 3=', r36a.errors.length === 0 && tk36a[0].kind === 'note' && tk36a[0].accidental === '#' && tk36a[1].kind === 'note' && tk36a[1].accidental === '$' && tk36a[2].kind === 'note' && tk36a[2].accidental === '=', JSON.stringify(r36a.errors))
// 虚音符 (3)
const r36b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 (3) 5 |\n')
const tk36b = r36b.groups[0].music.tokens
check('虚音符 (3) ghost=true 且 raw 含括号', r36b.errors.length === 0 && tk36b[1].kind === 'note' && tk36b[1].ghost === true && tk36b[1].raw === '(3)', JSON.stringify(r36b.errors))
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
// 单空格校验：双空格警告、紧贴警告、单空格无警告
const r36e = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1  2 | 3 4 |\n')
check('双空格 → 警告', r36e.errors.some((e) => e.severity === 'warning' && e.message.includes('一个空格')))
const r36f = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2| 3 4 |\n')
check('音符紧贴小节线 → 警告', r36f.errors.some((e) => e.severity === 'warning' && e.message.includes('缺少空格')))
const r36g = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 | 3 4 |\n')
check('单空格 → 无警告', r36g.errors.length === 0, JSON.stringify(r36g.errors))
// 连音线 ( 2 3 ) 与虚音符 (4) 区分（括号内空格与否）
const r36h = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 ) (4) 5 |\n')
check('连音线与虚音符区分', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') === 'note,slur,note,note,slur,note,note,barline', r36h.groups[0].music.tokens.map((t) => t.kind).join(',') + ' | ' + JSON.stringify(r36h.errors))
// 渲染：虚音符括号 + 倚音小字
const svg36b = renderScoreToSvg(layoutScore(r36b, defaultPageConfig))[0]
check('虚音符渲染括号', svg36b.includes('>(</text>') && svg36b.includes(')</text>'))
const svg36c = renderScoreToSvg(layoutScore(r36c, defaultPageConfig))[0]
check('倚音渲染小数字（font-size 10）', svg36c.includes('font-size="10"'))
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
const perBeat37 = 105.82
check('多声部小节线在小节内容右端+4.75（adj38）', bars37.length === 1 && Math.abs(bars37[0].x - (80 + 6 + 4 * perBeat37 + 4.75)) < 1, `x=${bars37[0]?.x} expect=${80 + 6 + 4 * perBeat37 + 4.75}`)
// 单声部 gap 居中已在 [29] 断言
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
// 无歌词：行高 = 曲高(30.6) + 曲上间距(40) = 70.6（歌词部空间为 0）
const r40a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const lay40a = layoutScore(r40a, defaultPageConfig)
const ys40a = [...new Set(lay40a.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('无歌词行高 = 曲高 + 曲上间距（70.6）', ys40a.length >= 2 && Math.abs(ys40a[1] - ys40a[0] - 70.6) < 0.5, `dy=${ys40a[1] - ys40a[0]}`)
// 有歌词对照：行高 = 30.6 + 13 + (18+8+10) + 40 = 119.6
const r40b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\nQ: 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\nC: 一 二 三 四 五 六 七 八 九 十 十 一 十 二 十 三 十 四\n')
const lay40b = layoutScore(r40b, defaultPageConfig)
const ys40b = [...new Set(lay40b.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
check('有歌词行高不变（119.6）', ys40b.length >= 2 && Math.abs(ys40b[1] - ys40b[0] - 119.6) < 0.5, `dy=${ys40b[1] - ys40b[0]}`)

// ---- 41. 小节线高度与反复点（adj34） ----
console.log('[41] barline height & dots (adj34)')
const r41 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 4 :|\n')
const lay41 = layoutScore(r41, defaultPageConfig)
const b41 = lay41.pages[0].barlines[0]
const n41 = lay41.pages[0].notes[0]
check('小节线上端 = 音符基线-17（高于字体上端 4px）', Math.abs(b41.yTop - (n41.y - 17)) < 0.5, `yTop=${b41.yTop}`)
check('小节线下端 = 音符基线+6（低于字体下端 4px）', Math.abs(b41.yBottom - (n41.y + 6)) < 0.5, `yBottom=${b41.yBottom}`)
check('小节线高 23', Math.abs(b41.yBottom - b41.yTop - 23) < 0.5)
// 反复点贴近线（|: 行首点在线右侧 dx+1）
const svg41 = renderScoreToSvg(lay41)[0]
const dot41 = /<circle cx="([\d.]+)" cy="[\d.]+" r="1.8"/.exec(svg41)
check('反复点紧贴线（cx = 线 x + 1）', dot41 !== null && Math.abs(Number(dot41[1]) - (b41.x + 1)) < 0.5, `cx=${dot41?.[1]} x=${b41.x}`)

// ---- 42. 拍级挤占（adj35） ----
console.log('[42] beat-level spacing (adj35)')
// 16 分音符拍 need=48.64 > 行均分 32.6 → 该拍固定 48.64（挤占），其余拍平均分享 31.2
const r42 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1// 2// 3// 4// | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |\n')
const lay42 = layoutScore(r42, defaultPageConfig)
const n42 = [...lay42.pages[0].notes].sort((a, b) => a.x - b.x)
check('16 分音符间距 = 12.16（数字 11.16 + 最小间距 1px）', Math.abs(n42[1].x - n42[0].x - 12.16) < 0.5, `gap=${n42[1].x - n42[0].x}`)
// 拍 1 起点 = 86(BAR 内)+48.64+空间9.5；数字中心 = + 28.85/2（pads=12+9.5×3）
check('超拍挤占后正常拍平均（第 5 音符中心）', Math.abs(n42[4].x + 6 - (80 + 48.64 + 9.5 + 6 + 14.42)) < 0.5, `center=${n42[4].x + 6}`)
// 行不溢出
check('拍级行不溢出页面', Math.max(...n42.map((nn) => nn.x + 11.16)) <= 515.28, `right=${Math.max(...n42.map((nn) => nn.x + 11.16))}`)
// 13 拍整行不拆（断行按逐拍 need，而非统一 maxPbm）
const ys42 = [...new Set(lay42.pages[0].notes.map((nn) => nn.y))]
check('密集拍所在行不拆（13 拍一行）', ys42.length === 1, `rows=${ys42.length}`)

// ---- 43. 附点占位 / 连音线端点 / 小节线不重叠（adj36） ----
console.log('[43] dot width / slur ends / barline gap (adj36)')
// ① 附点段不被所在拍（超拍）放大：1. 附点段宽 = 0.5 × 前音符宽
const r43a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2// 3// 4// 5// 6// 7// 1// | 1 2 3 4 5 6 7 1 | 1 2 3 4 5 6 7 1 |\n')
const n43a = [...layoutScore(r43a, defaultPageConfig).pages[0].notes].sort((a, b) => a.x - b.x)[0]
const sg43a = n43a.segments ?? []
const dotW = (sg43a[1]?.beats ?? 0) * (sg43a[1]?.perBeat ?? 0)
const baseW = (sg43a[0]?.beats ?? 0) * (sg43a[0]?.perBeat ?? 0)
check('附点段宽 = 0.5×前音符宽', sg43a.length >= 2 && Math.abs(dotW - 0.5 * baseW) < 0.05, `dot=${dotW} base=${baseW}`)
// ② 连音线端点 = 音符正上方偏右/左 1px，弧线在高八度点上方
const r43b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 ( 2 3 4 ) 5 |\n')
const lay43b = layoutScore(r43b, defaultPageConfig)
const s43b = lay43b.pages[0].slurs[0]
const n43b = lay43b.pages[0].notes
check('slur 起点 = 开始音符中心+1', s43b !== undefined && Math.abs(s43b.x1 - (n43b[1].x + 6.58)) < 0.5, `x1=${s43b?.x1}`)
check('slur 终点 = 结束音符中心-1', Math.abs(s43b.x2 - (n43b[3].x + 4.58)) < 0.5, `x2=${s43b.x2}`)
check('slur 高度在高八度点上方', s43b.y < n43b[1].y - 22.4, `y=${s43b.y} dotTop=${n43b[1].y - 22.4}`)
// ③ 小节线 = 小节内容右端，不与音符重叠
const r43c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const lay43c = layoutScore(r43c, defaultPageConfig)
const b43c = lay43c.pages[0].barlines[0]
const n43c = lay43c.pages[0].notes
const segEnd43 = (n43c[3].segments?.[0]?.x ?? 0) + (n43c[3].segments?.[0]?.beats ?? 0) * (n43c[3].segments?.[0]?.perBeat ?? 0)
check('小节线中心 = 内容右端 + 空间/2（adj38）', Math.abs(b43c.x - (segEnd43 + 4.75)) < 0.5, `line=${b43c.x} end=${segEnd43}`)
check('小节线与末音符数字至少 4px 间距', b43c.x - 0.75 - (n43c[3].x + 11.16) >= 4, `lineL=${b43c.x - 0.75} noteR=${n43c[3].x + 11.16}`)
// 右侧：下小节首音符数字左缘 - 线右缘 ≥ 4（adj38）
check('小节线右侧距下小节首音符 ≥ 4px', n43c[4].x - (b43c.x + 0.75) >= 4, `gap=${(n43c[4].x - (b43c.x + 0.75)).toFixed(1)}`)

// ---- 45. 附点显示在占位宽度正中（adj39） ----
console.log('[45] dot centered in its slot (adj39)')
const dotCxOf = (svg: string, k: number) => {
  const m = [...svg.matchAll(/<circle cx="([\d.]+)" cy="[\d.]+" r="2.4"/g)][k]
  return m ? Number(m[1]) : NaN
}
// 1.：附点段 = 段 1 [x, x+beats×perBeat]，附点 cx = 段中点
const r45a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1. 2 3 4 |\n')
const lay45a = layoutScore(r45a, defaultPageConfig)
const n45a = lay45a.pages[0].notes[0]
const s45a = n45a.segments ?? []
const mid45a = s45a[1].x + (s45a[1].beats * s45a[1].perBeat) / 2
check('1. 附点 = 附点段正中', Math.abs(dotCxOf(renderScoreToSvg(lay45a)[0], 0) - mid45a) < 0.5, `cx=${dotCxOf(renderScoreToSvg(lay45a)[0], 0)} mid=${mid45a}`)
// 双附点 1..：附点 1 在 [1,1.5] 拍占位正中、附点 2 在 [1.5,1.75] 拍占位正中
const r45b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1.. 2 3 4 |\n')
const lay45b = layoutScore(r45b, defaultPageConfig)
const svg45b = renderScoreToSvg(lay45b)[0]
const pb45b = (lay45b.pages[0].notes[0].segments?.[0]?.perBeat ?? 0)
const dot1 = dotCxOf(svg45b, 0)
const dot2 = dotCxOf(svg45b, 1)
check('双附点：附点1 在 1.25 拍、附点2 在 1.625 拍', Math.abs(dot1 - (86 + 1.25 * pb45b)) < 0.5 && Math.abs(dot2 - (86 + 1.625 * pb45b)) < 0.5, `d1=${dot1} d2=${dot2} pb=${pb45b}`)

// ---- 46. 歌词对齐：@ 占位 / 标点紧跟（adj40） ----
console.log('[46] lyric @ and punct (adj40)')
// @ 占位：该处留空，其后歌词后移到下一个音符
const r46a = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一 @ 二 三\n')
const lay46a = layoutScore(r46a, defaultPageConfig)
const l46a = lay46a.pages[0].lyrics
check('@ 占位：3 个字渲染（一、二、三）', l46a.length === 3, `got ${l46a.length}`)
// 行 4 拍：perBeat = (435.28-12)/4 = 105.82；二（对 3）与一（对 1）差 2 拍
check('@ 后歌词后移（二 对音符 3）', Math.abs(l46a[1].x - l46a[0].x - 2 * 105.82) < 1, `dx=${l46a[1].x - l46a[0].x}`)
// 标点不占音符位，紧跟前面的字渲染
const r46b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nC: 一，二。三\n')
const l46b = layoutScore(r46b, defaultPageConfig).pages[0].lyrics
check('标点不占音符位置（3 个歌词字）', l46b.length === 3 && l46b[1].char.text === '二' && l46b[1].char.trailing === '。', `got ${l46b.length}`)
const svg46b = renderScoreToSvg(layoutScore(r46b, defaultPageConfig))[0]
check('标点渲染在本字之后（一，/ 二。）', svg46b.includes('一，') && svg46b.includes('二。'), '')

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

console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
process.exit(failed === 0 ? 0 : 1)
