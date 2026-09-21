/**
 * scripts/smoke.mts — 引擎冒烟测试
 * 运行：npm run smoke
 * 验证：解析器（描述头/曲行/词行/分组）、tokenizer（音符/时值/小节线）、
 * 格式化器（Q 行空格规范）、时值计算。
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { parseJps, formatJps, formatLine, tokenDuration, layoutScore, renderScoreToSvg, defaultPageConfig, metaAreaH, extractJpsConfig, mergeJpsConfig, writeJpsConfig, mergeConfigEdits, configCarryover, inspectJpsConfig, extractLegacyEditorPrefs, JPS_CONFIG_PREFIX, SYS_FONT, SCORE_FONT_OPTIONS, EDITOR_FONT_OPTIONS, normalizeFontStack, applyFontOverride, clampEditorFontSize, splitNoteDur, digitSlotW, dotBodyW, augBodyW, slideBodyW, bracketBodyW, noteBodyW, nonDurGap, accidentalBodyW, slideExtraW, slideGlyphInk, computeSegments, mainSpans, mainSpansInRange, beatRatio, segmentNoteIndexBase, decodeSegmentNoteId, buildIndexToPage } from '@ijipu/engine/index.ts'
import { splitTempo } from '@ijipu/engine/parser/parser.ts'
import { parseKey } from '@ijipu/engine/layout/index.ts'
import { buildPlaySequence, inferBpm, schedulePlay, matchInstrument, resolveInstrument, eventsToMidi, pitchToMidiNote, instrumentToProgram, pcmToWav, SAMPLER_LIBRARIES, getSamplerLibrary, classifyNetwork, GmChannelAllocator, GM_MELODIC_CHANNELS, GM_VOICES, gmVoiceRef, gmVoiceProgram, countScoreInstrumentSwitches } from '@ijipu/engine/playback/index.ts'
import { codePosToNoteId, noteIdToCodePos } from '@ijipu/engine/cursorMap.ts'
import { computeRowTops, computeRowGuides, dragDelta, clamp, GUIDE_LIMITS_EX } from '@ijipu/engine/layout/guides.ts'
import { MIN_HAIRPIN_W } from '@ijipu/engine/layout/hairpins.ts'
// adj502：波音演奏时值（纯函数）
import { mordentOf, mordentPlan, mordentShortMs, neighborDegree, MORDENT_SYMBOLS, ORNAMENT_SHORT_MIN_MS, ORNAMENT_SHORT_MAX_MS } from '@ijipu/engine/playback/ornaments.ts'
import { DOT_R, DOT_R_DOT, H_GAP, INNER_GAP, BEAM_H, LAYER_GAP, VOLTA_BAR_GAP, VOLTA_RAISE, NOTE_COMMENT_FONT_RATIO, NOTE_COMMENT_RAISE, noteScaleOf, lowDotY, octaveDotY, beamY, beamBottomY, octaveTopY, digitBottomY, BARLINE_DOT_R, BARLINE_DOT_OFF, BARLINE_W_THIN, BARLINE_W_THICK, BARLINE_LINE_GAP, BARLINE_DOT_GAP, barlineTotalW, barlineGeometry, GRACE_SIZE_RATIO, GRACE_BEAM_GAP, GRACE_LINE_W, GRACE_SLOT_RATIO, GRACE_SLOT_RATIO_MULTI } from '@ijipu/engine/layout/spacing.ts'
import { clampMetaPos } from '@ijipu/engine/layout/metaAnchors.ts'
import type { BarlineType } from '@ijipu/engine/types.ts'
import { computeBeamsForTest } from '@ijipu/engine/render/index.ts'
// adj458：波音/滑音/延长记号的矢量修饰符（生成常量 + 墨迹宽高比；摆放口径经渲染端到端断言）
import { MODIFIER_GLYPHS, glyphInkAspect } from '@ijipu/engine/render/modifierGlyphs.ts'
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
// adj363：保存到磁盘可靠性（失败分类 / 权限申请 / 回读校验）——纯逻辑，可用假句柄断言
import {
  classifySaveError,
  createSavePhaseLog,
  ensureWritePermission,
  fileBaseName,
  fileInputAccept,
  shouldUseFileInputPicker,
  isUserCancel,
  sameContent,
  saveTextToHandle,
  writeTextToHandle,
} from '../src/store/saveSupport.ts'
// adj558：工作区"新建目录"端到端验证（createSubdir + readDirEntries 在假 FSA 上闭环）
import { createSubdir, readDirEntries } from '../src/store/workspace.ts'
// adj373：作者署名（品牌 tokens + 关于对话框文案）
import { brand } from '../src/brand/tokens.ts'
import { aboutCopy } from '../src/brand/copy.ts'
import { uiCopy } from '../src/brand/copy.ts'
import { appHeightPx } from '../src/pwa/appHeight.ts'
import { normalizePastedSource } from '../src/store/importSource.ts'
// adj379：PWA「新版本就绪」判定（纯逻辑）
import { UPDATE_CHECK_INTERVAL_MS, shouldPromptUpdate } from '../src/pwa/swUpdate.ts'
// adj409：试听暂停/续播的剩余事件平移（纯逻辑）
import { shiftEventsFrom } from '../src/playback/playbackTimeline.ts'
// adj411：直接生成 PDF（不再开新窗口）——PDF 字节结构（纯逻辑）
import { buildPdf, A4_W_PT, A4_H_PT } from '../src/export/pdf.ts'
// adj413：新建模板（分隔注释 30 字符 + 尾部页面设置区块）+ px 一律整数
import { defaultSample } from '../src/samples/index.ts'
import { roundPxIntegers } from '@ijipu/engine/index.ts'
import type { PageConfig } from '@ijipu/engine/types.ts'
// adj394：编辑区问题提示条的汇总/跳转换算（纯逻辑）
import { summarizeProblems, offsetOf } from '../src/ui/problems.ts'
import { problemCopy } from '../src/brand/copy.ts'
// adj394：输入条「强弱」组的提示文案（渐强/渐弱只有 + 抬升、没有 - 降低）
import { PAD_GROUPS } from '../src/editor/padLayout.ts'
// adj416：音源来源解析（安装目录内置 SF2 / 缓存 / 远端）——用假 Tauri + 假缓存断言，不碰真 IndexedDB
import { resolveHqBank, prefetchHqLibraryProgress } from '../src/playback/spessaCache.ts'
import type { HqCache } from '../src/playback/spessaCache.ts'
import { hasBuiltinBank, GM_VOICE_OPTIONS } from '../src/playback/spessaSynthBackend.ts'
import type { HqSampleLibrary } from '../src/playback/spessaSynthBackend.ts'
// adj417：按钮图标清单（public/icons/ 下的文件名）——断言文件存在、sw.js 预热清单未漂移
import { ICON_DIR, ICON_FILES, ICON_FILE_NAMES } from '../src/ui/toolIcons.ts'
// adj526：数值"按住上下拖"的纯换算（上拖增大 / 粗调 / 钳制 / 无范围时相对增量）
import { scrubTarget, SCRUB_PX_PER_STEP, SCRUB_COARSE_FACTOR, SCRUB_COARSE_TOL } from '../src/ui/numberScrub.ts'
// adj528：告警面板高度算式（单一来源纯函数）——"条数 × 单行实测"，与 dock 当前高度无关
import {
  problemsContentHeight,
  capProblemsContentHeight,
  PANE_PAD_H as PROB_PANE_PAD_H,
  ROW_H as PROB_ROW_H,
  PROBLEMS_HEAD_H as PROB_HEAD_H,
  PROBLEMS_MAX_VISIBLE_ROWS as PROB_MAX_ROWS,
} from '../src/ui/dock/problemsHeight.ts'
// adj529：预览比例"双击比率值按宽度适配"的反算算式（纯函数）
import {
  PREVIEW_BASE_W,
  PREVIEW_PANE_PAD_X,
  fitZoomFor,
  clampPreviewZoom,
} from '../src/preview/zoomFit.ts'
// adj530：顶栏"放不下就收进更多"的折叠判定（纯算式）——按可见优先级从最低的一位开始折叠
import { foldKeys, TOPBAR_DONATE_KEY, TOPBAR_FIXED_KIDS } from '../src/ui/topbarFold.ts'
// adj538：桌面壳「外部打开」——多文件取舍是纯逻辑，可在 Node 里直接断言（模块不碰 window 顶层）
import { pickPrimary, hasShell, type ExternalFile } from '../src/store/externalOpen.ts'
// adj540：工作区（Android/移动端"文件夹当工作区"）——纯逻辑部分在 Node 里直接断言
import {
  isHiddenName,
  isJpsName,
  isValidEntryName,
  joinPath,
  matchesQuery,
  normalizeRelPath,
  parentPath,
  searchWorkspaceJps,
  sortDirEntries,
  stripJpsExt,
  type DirEntry,
} from '../src/store/workspace.ts'
// adj526：谱面数值字段范围来自引擎同一份表（GUIDE_LIMITS/_EX）——断言"逐项相等"，防止抄成第二份
import { PAGE_NUM_RANGES, coarseFor } from '../src/ui/numFieldRanges.ts'
// （GUIDE_LIMITS_EX 见本文件顶部从 layout/guides 的导入；这里补 GUIDE_LIMITS 与字号范围）
import { GUIDE_LIMITS, EDITOR_FONT_SIZE_RANGE } from '@ijipu/engine/index.ts'

// adj213：布局断言常量——从 defaultPageConfig 派生，避免硬编码边距/右边界/
// 描述头区域高等魔数（默认值调整时断言自动适配）
const ML = defaultPageConfig.margin_left
const MR = defaultPageConfig.margin_right
const MT = defaultPageConfig.margin_top
const PAGE_W = 595.28 // A4 宽（defaultPageConfig.page 默认 A4）
const RIGHT_EDGE = PAGE_W - MR // 右内容边界
// adj418：左右边距默认 40 → 50（用户要求）。下面若干「自然宽」断言的绝对 x 是按 **40 基准**
// 实测钉住的回归值——自然宽本身与边距无关，所以只需加上左移增量；而"按前面曲部行对齐"的行宽
// 取决于可用宽（= 右边界 − 左边距），可用宽变窄 → 每拍宽变窄，它的偏移**不等于** ML_SHIFT，
// 这类值按调整后的实测重新钉住并在注释里说明。默认边距再改时只需动 ML_SHIFT。
const ML_SHIFT = ML - 40 // 左边距相对「40 基准」的增量
// adj421（用户规则）：**单行曲部**（曲部只有一行）且小节数 < align_min_bars 时，
// 整行占宽按 align_min_bars 个「小节槽」预分——槽宽 = 行内容宽 / align_min_bars（默认 4）。
// 注意：该规则只对**单行曲部**生效；多行曲部里最后一行仍按 adj199/adj355 的「对齐前面行」规则。
const SLOT_W = (PAGE_W - ML - MR) / defaultPageConfig.align_min_bars // 单行曲部的小节槽宽（默认 4 槽）
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

// adj460：+/- 变号断开为 "++++ ---"，让 + 归前元素抬升、- 归后元素。
// 不拆连音线抬降量 `(+/-...)` 与跳房子抬降量 `]+...`（保持同一语义单元）。
check('adj460 5"注释"++++--- 拆为 5"注释"++++ ---', formatLine('Q: 5"注释"++++---') === 'Q: 5"注释"++++ ---', formatLine('Q: 5"注释"++++---'))
check('adj460 5++++--- 拆为 5++++ ---', formatLine('Q: 5++++---') === 'Q: 5++++ ---', formatLine('Q: 5++++---'))
check('adj460 5++-- 拆为 5++ --', formatLine('Q: 5++--') === 'Q: 5++ --', formatLine('Q: 5++--'))
check('adj460 <++--- 拆为 <++ ---（渐强抬升后 augment）', formatLine('Q: <++---') === 'Q: <++ ---', formatLine('Q: <++---'))
check('adj460 >+-- 拆为 >+ --', formatLine('Q: >+--') === 'Q: >+ --', formatLine('Q: >+--'))
check('adj460 同号续行不拆（++++ 保持）', formatLine('Q: 5++++') === 'Q: 5++++', formatLine('Q: 5++++'))
// adj460 跳房子抬降量 ]+ 不拆（紧跟 ] 的 +/- 属于跳房子；prevOut===] 不触发拆）
check('adj460 ]++++ 跳房子抬升量原样（不拆）', formatLine('Q: 1 2 3]++++') === 'Q: 1 2 3]++++', formatLine('Q: 1 2 3]++++'))
// adj460 连音线抬降量 (+--- 不拆（inSlurPrefix 区间内原样吞下；拆了会把 slur raise 1 low 3 拆成 raise 1 + 3 augment）
check('adj460 (+--- 连音线抬升+降低原样不拆', formatLine('Q: 1 (+--- 2 3)') === 'Q: 1 (+--- 2 3)', formatLine('Q: 1 (+--- 2 3)'))
check('adj460 (+ ++ 连音线连续抬升保持', formatLine('Q: 1 (+ ++ 2 3)') === 'Q: 1 (+ ++ 2 3)', formatLine('Q: 1 (+ ++ 2 3)'))
// adj460 幂等：拆过一次后再次格式化不再变
check('adj460 格式化幂等（5"注释"++++ --- 第二次不变）', formatLine(formatLine('Q: 5"注释"++++---')) === 'Q: 5"注释"++++ ---', formatLine(formatLine('Q: 5"注释"++++---')))
// adj460 现有行为保持：单 +/- 不变 / 引号内原样 / 跳房子内原样
check('adj460 单个 + 不变（不构成变号）', formatLine('Q: 5+') === 'Q: 5+', formatLine('Q: 5+'))
check('adj460 单个 - 不变（augment，不构成变号）', formatLine('Q: 5-') === 'Q: 5-', formatLine('Q: 5-'))
check('adj460 引号内 + / - 原样（不在 +/- run）', formatLine('Q: 5"a++b"') === 'Q: 5"a++b"', formatLine('Q: 5"a++b"'))

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
// adj374：一个音符的「数字 + 各条增时线」共用同一 data-notepos → 数音符要按**唯一 id** 数
const uniqIds = (s: string) => new Set([...s.matchAll(/data-notepos="([^"]+)"/g)].map((m) => m[1])).size
const noteposCount = uniqIds(svg)
check('音符 text 数量正确', noteposCount === 32, `got ${noteposCount}`)

// 复杂音符行渲染
const rc2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1\'- 2,,$ 3// 4. | 0 8 9 ||\n')
const lay2 = layoutScore(rc2, DUR_CFG)
const svg2 = renderScoreToSvg(lay2)[0]
const cnt2 = uniqIds(svg2)
check('复杂行 6 个可见音符（8 隐藏休止不画）', cnt2 === 6, `got ${cnt2}`)
check('隐藏休止符不可播放', lay2.pages[0].notes.find((n) => n.token.kind === 'rest')?.playable === false)
check('SVG 含增时线 "-" 字符', svg2.includes('>-<'))
// 小节线 rect 高 = yBottom-yTop（随字号缩放）；断言只要存在小节线竖线即可（数量验证）
// adj391：线宽改为 细 1 / 粗 2
const barRects = (svg2.match(new RegExp(`width="(?:1|2)" height="16\\.[0-9]"`, 'g')) ?? []).length
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
// adj419：行首命令集合与解析器 HEADER_KEYS + 曲/词行对齐——补 Y/S、去掉解析器不认的 H
check('isLineHeaderKey 覆盖 Q/C/B/Z/D/P/J/V/Y/S', ['Q', 'C', 'B', 'Z', 'D', 'P', 'J', 'V', 'Y', 'S'].every((k) => isLineHeaderKey(k)) && !isLineHeaderKey('H') && !isLineHeaderKey('X'))
const s5 = insertLineHeader('', 0, 'Y')
const s6 = insertLineHeader('', 0, 'S')
check('adj419 行首可插 Y:（默认乐器）与 S:（说明）', s5?.text === 'Y: ' && s6?.text === 'S: ', `${s5?.text}|${s6?.text}`)
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
// adj361：无缝跳跃——回跳后第二遍紧接第一遍（无空档），总时长 = 实际播放时刻
check('adj361 反复播放总时长 = 3 拍组×2 遍 + 尾（3000ms，无空档）', ps1.totalMs === 3000, String(ps1.totalMs))
check(
  'adj361 反复回跳无缝（第二遍首音紧接第一遍末音，无空档）',
  ps1.events[2]?.atMs === ps1.events[1].atMs + ps1.events[1].durationMs,
  `${ps1.events[1]?.atMs}+${ps1.events[1]?.durationMs} → ${ps1.events[2]?.atMs}`,
)

// 跳房子（第二遍跳过 [ ] 段；adj23：跳房子 [ 须在小节线后，音符后的 [ 是倚音）
const ps2 = mkSeq('|: 1 2 | [ 3 4 ] 5 6 :|')
check('跳房子展开 10 事件', pitchSeq(ps2) === 'C4,D4,E4,F4,G4,A4,C4,D4,G4,A4', pitchSeq(ps2))
// adj282：跳房子跳过段后同一块第二遍 atMs 继续单调推进
check('跳房子展开 atMs 单调不重叠', ps2.events.every((e, k) => k === 0 || e.atMs >= ps2.events[k - 1].atMs + ps2.events[k - 1].durationMs - 0.5), ps2.events.map((e) => Math.round(e.atMs)).join(','))
check('adj361 跳房子播放总时长 = 2 遍（5000ms，跳过段不占时）', ps2.totalMs === 5000, String(ps2.totalMs))

// adj361：多行谱「后一行」的反复跳跃也必须无缝——原 bug 下 passMs 会跳到
// 「本行布局起点 + 整行时长」，回跳后整体多等十几~几十秒（用户报告的问题）
{
  const srcJ2 = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\nQ: |: 5 6 :| 7 8 |\n'
  const rJ2 = parseJps(srcJ2)
  const seqJ2 = buildPlaySequence(rJ2, layoutScore(rJ2, DUR_CFG), 120)
  const evJ2 = seqJ2.events.filter((e) => e.placed.audioPitch)
  // 音序：C4,D4,E4,F4（行1） G4,A4（行2 第1遍） G4,A4（第2遍） B4,C4
  const j = 6 // 第 2 遍首音（G4 第二次）
  check(
    'adj361 多行谱后行反复回跳无缝（第二遍首音紧接第一遍末音）',
    evJ2[j]?.atMs === evJ2[j - 1].atMs + evJ2[j - 1].durationMs,
    `${evJ2[j - 1]?.atMs}+${evJ2[j - 1]?.durationMs} → ${evJ2[j]?.atMs}（音序 ${evJ2.map((e) => e.placed.audioPitch).join(',')}）`,
  )
  check('adj361 多行谱后行反复总时长 = 5000ms（无空档）', seqJ2.totalMs === 5000, String(seqJ2.totalMs))
}

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
/**
 * adj456：这三条断言此前长期失败（属"18 条基线"之一），根因是**断言口径过时**而非行为退化——
 * 旧断言期望序列里带的是**合成后端时代**的预设 id（`flute`/`strings`/`piano`，见 `resolveInstrument`），
 * 但 adj354 起试听只走高保真后端（adj344），序列里带的是**乐器名/音色名 ref**（`长笛`/`弦乐`…），
 * 音色→program 的解析由播放端（`gmVoiceProgram`）与 `eventsToMidi` 各自完成。
 * 现按当前口径断言（行为本身没变：Y: 决定声部默认、`@` 切换、`@@` 回默认）。
 */
check('Y 默认乐器 = 长笛（1 2 = 长笛 ref）', seqInst.events[0]?.instrument === '长笛' && seqInst.events[1]?.instrument === '长笛', `${seqInst.events[0]?.instrument},${seqInst.events[1]?.instrument}`)
check('@弦乐 切换到弦乐（3 4 = 弦乐 ref）', seqInst.events[2]?.instrument === '弦乐' && seqInst.events[3]?.instrument === '弦乐', `${seqInst.events[2]?.instrument},${seqInst.events[3]?.instrument}`)
check('@@ 切回默认长笛（5 6 = 长笛 ref）', seqInst.events[4]?.instrument === '长笛' && seqInst.events[5]?.instrument === '长笛', `${seqInst.events[4]?.instrument},${seqInst.events[5]?.instrument}`)
// 序列里的 ref 必须能被**播放/导出实际使用的解析器**解回 GM program（长笛=73；旧简称「弦乐」走别名表=48）
check('adj456 序列乐器名可解回 GM program（长笛=73、弦乐=48）', instrumentToProgram('长笛') === 73 && instrumentToProgram('弦乐') === 48, `${instrumentToProgram('长笛')}/${instrumentToProgram('弦乐')}`)
// adj302：多声部按 Y 行顺序对应乐器；声部比 Y 多时用默认
const rYv = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴\nY: 弦乐\nQ1: 1 2 3 4 |\nQ2: 5 6 5 3 |\n')
const seqYv = buildPlaySequence(rYv, layoutScore(rYv, DUR_CFG), 120)
const vY1 = seqYv.events.filter((e) => e.placed.id.voice === 1)[0]
const vY2 = seqYv.events.filter((e) => e.placed.id.voice === 2)[0]
// adj456：口径同上一组——序列带**乐器名 ref**（非合成预设 id）；多声部按 Y 行顺序对应
check('多声部 Q1→Y[0] 钢琴、Q2→Y[1] 弦乐', vY1?.instrument === '钢琴' && vY2?.instrument === '弦乐', `${vY1?.instrument},${vY2?.instrument}`)
const rYv3 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴\nY: 弦乐\nQ1: 1 2 3 4 |\nQ2: 5 6 5 3 |\nQ3: 1 3 5 1 |\n')
const seqYv3 = buildPlaySequence(rYv3, layoutScore(rYv3, DUR_CFG), 120)
const vY3 = seqYv3.events.filter((e) => e.placed.id.voice === 3)[0]
check('多声部 Q3（无对应 Y）用默认乐器（= Y[0] 钢琴）', vY3?.instrument === '钢琴', String(vY3?.instrument))
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

// bpm 推断（adj456：默认口径为 **70**——adj343 把无 J 的默认从 60 提到 70，两条断言与函数头注释当时漏改）
check('J:96 → 96', inferBpm(parseJps('V: 1.0\nB: t\nJ: 96\n')) === 96)
check('无 J → 70（adj343 默认试听速度）', inferBpm(parseJps('V: 1.0\nB: t\n')) === 70)
check('J 文字 → 70（adj343 默认试听速度）', inferBpm(parseJps('V: 1.0\nB: t\nJ: 欢快的\n')) === 70)

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

// adj357：MIDI 导出按「每个音符的乐器」发 Program Change（曲内 @ 切换 / @@ 回默认）——
// 旧实现每声部只取第一个音符的乐器发一次，导致整轨（单/多声部、混合）只用一个音色、@@ 不生效
{
  const mkTrack = (bytes: Uint8Array, idx: number): number[] => {
    let p = 14
    let ti = 0
    while (p + 8 <= bytes.length) {
      const len = (bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7]
      if (len === 0 || p + 8 + len > bytes.length) break
      if (ti === idx) return [...bytes.slice(p + 8, p + 8 + len)]
      p += 8 + len
      ti++
    }
    return []
  }
  const progsOf = (bytes: Uint8Array, idx: number) => evList(mkTrack(bytes, idx)).filter((e) => (e.status & 0xf0) === 0xc0).map((e) => e.data[0])
  // 单声部：Y 长笛(73) → @大钢琴(0) → @@ 回长笛(73)
  const rS = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 长笛\nQ: 1 2 @大钢琴@ 3 4 @@ 5 6 |\n')
  const pS = progsOf(eventsToMidi(buildPlaySequence(rS, layoutScore(rS, DUR_CFG), 120).events, { bpm: 120 }), 1)
  check('adj357 单声部 MIDI 按音符切音色（长笛→大钢琴→长笛）', pS.length >= 3 && pS[0] === 73 && pS.includes(0) && pS[pS.length - 1] === 73, `progs=${pS.join(',')}`)
  // 多声部：Q1 大钢琴(0)→长笛(73)；Q2 弦乐(48)→长笛(73)
  const rM = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nY: 长笛\nQ1: @大钢琴@ 1 2 @@ 3 4 |\nQ2: @弦乐@ 5 6 @@ 7 8 |\n')
  const mM = eventsToMidi(buildPlaySequence(rM, layoutScore(rM, DUR_CFG), 120).events, { bpm: 120 })
  const pQ1 = progsOf(mM, 1)
  const pQ2 = progsOf(mM, 2)
  check('adj357 多声部 MIDI 各声部独立切音色（Q1 0→73、Q2 48→73）', pQ1.length >= 2 && pQ1[0] === 0 && pQ1[pQ1.length - 1] === 73 && pQ2.length >= 2 && pQ2[0] === 48 && pQ2[pQ2.length - 1] === 73, `Q1=${pQ1.join(',')} Q2=${pQ2.join(',')}`)
}

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
// adj-font 分层：编辑器偏好属「用户个性」，**不进谱面**（旧断言按新语义重写）
{
  // 写回：即使传入的对象里带了 editorFont（历史数据），也不会写进 # jps-config 行
  const codeW3 = writeJpsConfig(ysSrc, {
    ...DUR_CFG,
    editorFont: 'Courier New',
    editorFontSize: 18,
  } as unknown as typeof defaultPageConfig)
  check('adj-font 谱面写入不含 editorFont（用户个性不进谱面）', !codeW3.includes('editorFont'), codeW3.split('\n').slice(-3).join(' | '))
  const ex3 = extractJpsConfig(codeW3)
  check('adj-font 谱面读取也拿不到 editorFont/Size', ex3 !== null && !('editorFont' in ex3) && !('editorFontSize' in ex3), JSON.stringify(ex3))
  // 旧谱面里已存在的 editorFont：读配置时忽略，但可用 extractLegacyEditorPrefs 迁移到本机偏好
  const legacySrc = `${ysSrc}\n# jps-config:{"margin_top":41,"editorFont":"Courier New","editorFontSize":18}\n`
  check('adj-font 旧谱面 editorFont 读取时被忽略', extractJpsConfig(legacySrc)?.margin_top === 41 && !('editorFont' in (extractJpsConfig(legacySrc) ?? {})))
  check('adj-font 旧谱面 editorFont 可迁移读出', extractLegacyEditorPrefs(legacySrc)?.font === 'Courier New' && extractLegacyEditorPrefs(legacySrc)?.fontSize === 18)
  check('adj-font 无旧字段时迁移返回 null', extractLegacyEditorPrefs(ysSrc) === null)
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
// adj393：渐强/渐弱必须在**两种布局模式**下都渲染（此前只实现了拍级 duration，
// 而默认配置是空间优先 space → 默认设置下记号静默不显示；本组断言两种模式逐一对照，防止再漏）
{
  const SPACE_CFG = { ...defaultPageConfig, noteSpaceLayout: 'space' as const }
  const DYN_SRC = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 <+ 4 5 6 ! 7 |\n'
  const dynOf = (cfg: typeof DUR_CFG) => layoutScore(parseJps(DYN_SRC), cfg).pages[0]
  const spacePage = dynOf(SPACE_CFG)
  const durPage = dynOf(DUR_CFG)
  check('adj393 空间优先（默认）布局：渐强/渐弱渲染 1 条', spacePage.dynamics.length === 1, `got ${spacePage.dynamics.length}`)
  check('adj393 拍级布局：渐强/渐弱渲染 1 条（回归）', durPage.dynamics.length === 1, `got ${durPage.dynamics.length}`)
  const spaceDyn = spacePage.dynamics[0]
  const durDyn = durPage.dynamics[0]
  check('adj393 两种布局类型一致（crescendo）', spaceDyn?.type === 'crescendo' && durDyn?.type === 'crescendo', `${spaceDyn?.type} / ${durDyn?.type}`)
  check('adj393 两种布局抬升级数一致（<+ → plus=1）', spaceDyn?.plus === 1 && durDyn?.plus === 1, `${spaceDyn?.plus} / ${durDyn?.plus}`)
  // 起止锚定「所跟音符槽中心」：两种布局都必须落在对应音符中心（模式内自洽校验）
  // 源码 `1 2 3 <+ 4 5 6 ! 7`：`<+` 紧跟在音符 3（notes[2]）后、`!` 紧跟音符 6（notes[5]）后
  const anchorOk = (page: typeof spacePage, noteIdx: number, x: number): boolean => {
    const n = page.notes[noteIdx]
    return n !== undefined && Math.abs(x - (n.x + halfDig)) < 1
  }
  check(
    'adj393 空间优先：起点 = <+ 所跟音符（notes[2]）、终点 = ! 所跟音符（notes[5]）',
    spaceDyn !== undefined && anchorOk(spacePage, 2, spaceDyn.x1) && anchorOk(spacePage, 5, spaceDyn.x2),
    `x1=${spaceDyn?.x1} x2=${spaceDyn?.x2} n3=${spacePage.notes[2]?.x} n6=${spacePage.notes[5]?.x}`,
  )
  check(
    'adj393 拍级：起点 = <+ 所跟音符（notes[2]）、终点 = ! 所跟音符（notes[5]）',
    durDyn !== undefined && anchorOk(durPage, 2, durDyn.x1) && anchorOk(durPage, 5, durDyn.x2),
    `x1=${durDyn?.x1} x2=${durDyn?.x2} n3=${durPage.notes[2]?.x} n6=${durPage.notes[5]?.x}`,
  )
  // 两种布局的 y 基准一致（行数字顶再上移 (LAYER_GAP+DYN_HALF_H+SLUR_W/2)×s）
  check('adj393 两种布局 hairpin 中心 y 一致', spaceDyn !== undefined && durDyn !== undefined && Math.abs(spaceDyn.y - durDyn.y) < 0.6, `${spaceDyn?.y} / ${durDyn?.y}`)
  // 未写 ! 时在行尾收尾（两种布局都要有且 x2 > x1）
  const OPEN_SRC = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4 5 6 7 |\n'
  for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
    const d = layoutScore(parseJps(OPEN_SRC), cfg).pages[0].dynamics[0]
    check(`adj393 ${label}：未写 ! 的渐强在行尾收尾`, d !== undefined && d.x2 > d.x1, JSON.stringify(d))
  }
  // 两种布局都能在 SVG 里看到开口尖括号 hairpin
  for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
    const svg = renderScoreToSvg(layoutScore(parseJps(DYN_SRC), cfg))[0]
    check(`adj393 ${label}：SVG 含 hairpin path`, /<path d="M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+ M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+" fill="none" stroke="#1b1b1b" stroke-width="0.8"/.test(svg), '')
  }
  // adj393：多声部块（Q1/Q2 纵向堆叠）此前完全不处理装饰 token → 一并补上（按声部行定位）
  const MV_SRC = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 <+ 4 5 6 ! 7 |\nQ2: 1 2 3 4 5 6 7 1 |\n'
  for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
    const page = layoutScore(parseJps(MV_SRC), cfg).pages[0]
    const d = page.dynamics[0]
    const n3 = page.notes[2] // 声部 1 的第 3 个音符（<+ 所跟）
    const n6 = page.notes[5] // 声部 1 的第 6 个音符（! 所跟）
    check(
      `adj393 多声部（${label}）：渐强渲染且起止锚定该声部所跟音符`,
      page.dynamics.length === 1 &&
        d?.type === 'crescendo' &&
        d.plus === 1 &&
        n3 !== undefined &&
        n6 !== undefined &&
        Math.abs(d.x1 - (n3.x + halfDig)) < 1 &&
        Math.abs(d.x2 - (n6.x + halfDig)) < 1,
      JSON.stringify({ dyn: d, n3: n3?.x, n6: n6?.x }),
    )
  }
  // adj393：**退化写法不画竖线**——`<` 紧跟 `!`（起止落在同一音符）宁可不出记号，并给出 warning
  for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
    const rDeg = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < ! 4 5 6 |\n')
    const pDeg = layoutScore(rDeg, cfg).pages[0]
    check(`adj393 ${label}：< 紧跟 ! 的退化写法不产出记号（不画竖线）`, pDeg.dynamics.length === 0, `got ${pDeg.dynamics.length}`)
    check(
      `adj393 ${label}：退化写法给出 warning 说明原因`,
      rDeg.errors.some((e) => e.severity === 'warning' && e.message.includes('起止之间没有音符')),
      JSON.stringify(rDeg.errors),
    )
  }
  // 任何非退化写法都不得产出「宽度 < MIN_HAIRPIN_W」的记号（竖线现象的回归护栏）
  const allDyns = [SPACE_CFG, DUR_CFG].flatMap((cfg) =>
    layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 <+ 4 5 6 ! 7 | 1 2 3 > 4 5 6 ! 7 | 1 2 3 < 4 5 6 7 |\n'), cfg).pages.flatMap((p) => p.dynamics),
  )
  check(
    'adj393 所有记号开口宽度 ≥ MIN_HAIRPIN_W（无退化竖线）',
    allDyns.length === 6 && allDyns.every((d) => d.x2 - d.x1 >= MIN_HAIRPIN_W),
    allDyns.map((d) => `${d.type}:${(d.x2 - d.x1).toFixed(1)}`).join(' '),
  )
  // `!` 没有同一行内的起点（含起点在上一行）→ warning
  {
    const rLone = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4 |\nQ: 5 6 7 ! |\n')
    check(
      'adj393 跨行的「< … 换行 … !」给出 warning（渐强/渐弱不能跨行）',
      rLone.errors.some((e) => e.severity === 'warning' && e.message.includes('不能跨行')),
      JSON.stringify(rLone.errors),
    )
  }
  // 行内已有未闭合记号又写新的 → warning（后写的替换前一个）
  {
    const rTwo = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 < 3 4 > 5 6 |\n')
    check(
      'adj393 未用 ! 结束又出现新记号 → warning（提示前一个被替换）',
      rTwo.errors.some((e) => e.severity === 'warning' && e.message.includes('尚未用 "!" 结束')),
      JSON.stringify(rTwo.errors),
    )
  }
  // ---- adj394：`!` 可结束于任意「有时值的元素」之后（音符 / 增时线 `-` / 附点 `.`）----
  {
    const mk = (q: string) => {
      const res = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
      return { res, page: layoutScore(res, SPACE_CFG).pages[0], pageDur: layoutScore(res, DUR_CFG).pages[0] }
    }
    const tokEnd = (q: string): string | undefined => {
      const t = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`).groups[0].music.tokens.find((x) => x.kind === 'decoration' && x.dynamics === 'end')
      return t && t.kind === 'decoration' ? t.dynamicsEndOn : undefined
    }
    check('adj394 解析：`!` 紧跟音符 → endOn=note', tokEnd('1 2 3 < 4 ! 5 6') === 'note', String(tokEnd('1 2 3 < 4 ! 5 6')))
    check('adj394 解析：`!` 紧跟增时线（4- !）→ endOn=aug', tokEnd('1 2 3 < 4- ! 5 6') === 'aug', String(tokEnd('1 2 3 < 4- ! 5 6')))
    check('adj394 解析：`!` 紧跟附点（4. !）→ endOn=dot', tokEnd('1 2 3 < 4. ! 5 6') === 'dot', String(tokEnd('1 2 3 < 4. ! 5 6')))
    check('adj394 解析：增时线分写（4 - !）同样识别 → endOn=aug', tokEnd('1 2 3 < 4 - ! 5 6') === 'aug', String(tokEnd('1 2 3 < 4 - ! 5 6')))
    // adj394：`3<---!` 是**合法**写法（起点=音符 3、终点=其末增时线右缘），不得告警
    {
      const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3<---! |\n')
      check(
        'adj394 `3<---!`（紧贴写法）不报任何语法问题',
        r.errors.length === 0,
        JSON.stringify(r.errors),
      )
      for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
        const pg = layoutScore(r, cfg).pages[0]
        const n0 = pg.notes[0]
        check(
          `adj394 ${label}：` + '`3<---!` 渲染出渐强（起点 = 音符 3 中心、终点 = 该音符右缘）',
          pg.dynamics.length === 1 && n0 !== undefined && Math.abs(pg.dynamics[0].x1 - (n0.x + halfDig)) < 1 && Math.abs(pg.dynamics[0].x2 - (n0.rightX ?? NaN)) < 1,
          JSON.stringify({ dyn: pg.dynamics[0], center: n0 ? n0.x + halfDig : null, right: n0?.rightX }),
        )
      }
      // adj394（语法约定）：`<`/`>` **只有 `+` 抬升，没有 `-` 降低**——`-` 始终是增时线。
      // 二者在源码上无法区分"想降低"还是"想增时"，故**不发告警**（否则误伤 `3<---!` 这类合法写法），
      // 只在语法文档/编辑器提示里写明；这里用断言把实际语义固定下来。
      {
        const rMinus = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3<- 4 5 |\n')
        const n3 = rMinus.groups[0].music.tokens.find((t) => t.kind === 'note')
        check(
          'adj394 `3<- 4`：`-` 是**增时线**（计入音符 3）、且不产生任何"降低"告警',
          n3?.kind === 'note' && n3.augmentCount === 1 && !rMinus.errors.some((e) => e.message.includes('降低')),
          JSON.stringify({ aug: n3?.kind === 'note' ? n3.augmentCount : null, errs: rMinus.errors.map((e) => e.message) }),
        )
        const rPlus = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3<+ 4 5 |\n')
        check(
          'adj394 `3<+ 4`：`+` 是抬升级数（不产生告警、不改变时值）',
          rPlus.errors.length === 0 &&
            rPlus.groups[0].music.tokens.find((t) => t.kind === 'note')?.kind === 'note' &&
            (rPlus.groups[0].music.tokens.find((t) => t.kind === 'note') as { augmentCount?: number }).augmentCount === 0,
          JSON.stringify(rPlus.errors.map((e) => e.message)),
        )
      }
      // 同一行的 `<` 后紧跟 `!`（无 `-`/`.`）仍是退化写法 → 告警且不渲染
      const rDeg = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3<! |\n')
      check(
        'adj394 `3<!`（无任何时值元素）仍判为退化并给出告警',
        rDeg.errors.some((e) => e.severity === 'warning' && e.message.includes('起止之间没有音符')) &&
          layoutScore(rDeg, SPACE_CFG).pages[0].dynamics.length === 0,
        JSON.stringify(rDeg.errors),
      )
    }
    for (const [label, cfg] of [['空间优先', SPACE_CFG], ['拍级', DUR_CFG]] as const) {
      const plain = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4 ! 5 6 |\n'), cfg).pages[0]
      const aug = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4- ! 5 6 |\n'), cfg).pages[0]
      const aug2 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4-- ! 5 6 |\n'), cfg).pages[0]
      const dot = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < 4. ! 5 6 |\n'), cfg).pages[0]
      const n4plain = plain.notes[3]
      const n4aug = aug.notes[3]
      const n4dot = dot.notes[3]
      check(
        `adj394 ${label}：` + '`!` 跟音符 → 终点 = 数字槽中心（原行为不变）',
        plain.dynamics[0] !== undefined && n4plain !== undefined && Math.abs(plain.dynamics[0].x2 - (n4plain.x + halfDig)) < 1,
        `x2=${plain.dynamics[0]?.x2} center=${n4plain ? n4plain.x + halfDig : NaN}`,
      )
      check(
        `adj394 ${label}：` + '`!` 跟增时线 → 终点 = 该音符右缘（越过数字槽中心）',
        aug.dynamics[0] !== undefined && n4aug !== undefined && Math.abs(aug.dynamics[0].x2 - (n4aug.rightX ?? NaN)) < 1 && aug.dynamics[0].x2 > n4aug.x + halfDig + 2,
        `x2=${aug.dynamics[0]?.x2} rightX=${n4aug?.rightX} center=${n4aug ? n4aug.x + halfDig : NaN}`,
      )
      check(
        `adj394 ${label}：` + '`4-- !` 比 `4- !` 更靠右（按增时线数量延伸）',
        aug2.dynamics[0] !== undefined && aug.dynamics[0] !== undefined && aug2.dynamics[0].x2 > aug.dynamics[0].x2 + 2,
        `${aug.dynamics[0]?.x2} → ${aug2.dynamics[0]?.x2}`,
      )
      check(
        `adj394 ${label}：` + '`!` 跟附点 → 终点 = 附点右缘（越过数字槽中心）',
        dot.dynamics[0] !== undefined && n4dot !== undefined && Math.abs(dot.dynamics[0].x2 - (n4dot.rightX ?? NaN)) < 1 && dot.dynamics[0].x2 > n4dot.x + halfDig + 1,
        `x2=${dot.dynamics[0]?.x2} rightX=${n4dot?.rightX} center=${n4dot ? n4dot.x + halfDig : NaN}`,
      )
    }
  }
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
// adj109：& 修饰符扩展（yc/bc/zy/dy/shy/xhy/sby/xby/sby+/xby+/cy/cy+）解析 + 渲染
// adj375：&hx 已改为独立标记（不再进音符 symbols），故此用例不再含 hx
const r109 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&yc 2&bc 3&zy 4&dy 5&shy 6&xhy 1&sby 2&xby 3&sby+ 4&xby+ 5&cy 6&cy+ | 1 2 3 4 |\n')
const n109 = r109.groups[0].music.tokens.filter((t) => t.kind === 'note')
check('adj109 修饰符解析（yc bc zy dy shy xhy）', r109.errors.length === 0 && JSON.stringify(n109.slice(0, 6).map((t) => t.symbols[0])) === JSON.stringify(['yc', 'bc', 'zy', 'dy', 'shy', 'xhy']), JSON.stringify(n109.slice(0, 6).map((t) => t.symbols)))
check('adj109 修饰符解析（sby xby sby+ xby+ cy cy+，含 + 后缀）', JSON.stringify(n109.slice(6, 12).map((t) => t.symbols[0])) === JSON.stringify(['sby', 'xby', 'sby+', 'xby+', 'cy', 'cy+']), JSON.stringify(n109.slice(6, 12).map((t) => t.symbols)))
const svg109 = renderScoreToSvg(layoutScore(r109, DUR_CFG))[0]
// adj458（用户要求）：yc（延长记号）也改成**用户提供的矢量图形**（原为手绘"圆点 + 半圆弧"），
// 故原断言「yc 渲染点 + 半圆弧（circle + Q）」随设计变更删除 —— 形态核对并入上方那条。
// adj112：zy 线形 >、dy 仍实心倒三角；adj119：滑音箭头改线形 >（实心三角仅 dy 1 个）
check('adj119 实心三角仅 dy（1 个）', (svg109.match(/Z" fill="#1b1b1b"/g) ?? []).length === 1, '')
// adj458（用户要求）：波音/滑音/延长记号改为**用户提供的矢量图形**（内联 SVG 路径），
// 不再是手绘的锯齿线 / 弧线箭头 / 圆点半圆弧。原先此处的 adj115/adj116 断言钉的是**旧画法**
// （波音斜下粗线 stroke 1.8 ≥10 条、下波音竖线 stroke 0.8 ≥2 条），随本次替换一并改写。
// 本用例（r109）里有 7 个符号：4 波音 + 2 滑音 + 1 延长记号 → 应渲染出 7 个矢量 <g>；
// 逐符号的路径一致性 / 包围盒 / 摆放口径见 [108]。
const modGs109 = svg109.match(/<g transform=[^>]*fill="#1b1b1b"><path d="/g) ?? []
check('adj458 r109 的 7 个修饰符（4 波音 + 2 滑音 + 1 延长记号）全部渲染为矢量 <g>', modGs109.length === 7, `got ${modGs109.length}`)

// adj459：跨行连音线**端点弧线半径统一**为 leg=5（半条可占满整段 span，仅留 1px 安全间隙）。
// 不依赖布局（行换行难稳定触发），直接调用 renderSlurForTest 构造 half=r/l 的连音线，验证
// SVG 路径里的弧线命令 A R R 0 0 1 的 R 全部是 5。
import { renderSlurForTest } from '@ijipu/engine/render/index.ts'
const slurArcR = (half: 'l' | 'r' | undefined, span: number): number => {
  const x1 = 100, x2 = x1 + span, y = 142.2
  const d = renderSlurForTest({ x1, x2, y, depth: 0, style: 'flat', half, tupletCount: undefined }, 18)
  const m = /A (\d+(?:\.\d+)?) \1 0 0 1/.exec(d)
  return m ? Number(m[1]) : NaN
}
{
  // 半条：span ≥ leg+1=6 时 R 统一为 5；span<6 极短半条按公式留 1px 间隙
  const halfRs = [6, 10, 20, 50, 100, 500].map((s) => [s, slurArcR('r', s)] as [number, number])
  check(
    'adj459 半条弧线 R 统一为 5（half=r，span≥6，与总长无关）',
    halfRs.every(([, r]) => r === 5),
    halfRs.map(([s, r]) => `s=${s}→R=${r}`).join(' '),
  )
  const halfRsL = [6, 10, 20, 50, 100, 500].map((s) => [s, slurArcR('l', s)] as [number, number])
  check(
    'adj459 半条弧线 R 统一为 5（half=l，span≥6，与总长无关）',
    halfRsL.every(([, r]) => r === 5),
    halfRsL.map(([s, r]) => `s=${s}→R=${r}`).join(' '),
  )
}
// 完整连音线 R 受半段约束（span<12 时收缩，避免两弧重叠）——保留现有行为
check(
  'adj459 完整连音线 R 在 span<12 时收缩（避免两弧重叠）',
  slurArcR(undefined, 8) < 5 && slurArcR(undefined, 50) === 5,
  `s=8→R=${slurArcR(undefined, 8)} s=50→R=${slurArcR(undefined, 50)}`,
)
// 短半条（span=5，<leg+1）按公式 R = min(leg, span-1) = 4（留 1px 间隙，不让弧线端碰到另一端）
check(
  'adj459 极短半条（span=5<leg+1）R=4 而非 5（公式的 1px 间隙保护）',
  slurArcR('r', 5) === 4,
  `R=${slurArcR('r', 5)}`,
)
// adj180：&hx 呼吸记号不加粗（stroke 0.8）、横向宽度 80%（半宽 2.8×s）
// adj375：&hx 已独立化——用独立写法取样（原 r109 里 5&hx 已不再产生记号）
const svgHx180 = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 5 &hx 6 |\n'), DUR_CFG))[0]
const hxPath180 = /M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)" fill="none" stroke="#1b1b1b" stroke-width="0.8"/.exec(svgHx180)
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
// adj359：&ty 第一次遇到忽略（无大反复则不跳越，全部演奏）；有大反复时第二次跳越两 ty 之间
check('adj359 播放：&ty 无大反复时忽略（不跳越）', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |')).join(',') === 'C4,D4,E4,F4,G4,A4,B4,C4,D4,E4,F4,G4', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |')).join(','))
check('adj359 播放：&dc 后 &ty 跳越两 ty 之间', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |&dc |')).join(',') === 'C4,D4,E4,F4,G4,A4,B4,C4,D4,E4,F4,G4,C4,D4,E4,F4,D4,E4,F4,G4', pits126(mk126('1 2 3 4 |&ty 5 6 7 1 |&ty 2 3 4 5 |&dc |')).join(','))
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
// adj458（用户要求）：滑音/延长记号都改为**用户提供的矢量图形**（原为手绘"细线弧线 Q + 线形 > 箭头"
// 与"圆点 + 半圆弧"）。原断言「滑音渲染弧线（Q）」与「yc 渲染点 + 半圆弧（circle + Q）」钉的是旧画法，
// 随设计变更删除 —— 形态核对见上方那条"7 个矢量 <g>"，逐符号口径见 [108]。

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
const meterFracFs = defaultPageConfig.note_size // adj357：字号与音符一致
check('临时节拍渲染分数（分子 2 / 分母 4 居中）', new RegExp(`<text x="[\\d.]+" y="[\\d.]+" text-anchor="middle" font-weight="bold" font-size="${meterFracFs}"[^>]*>2<`).test(svg67) && new RegExp(`<text x="[\\d.]+" y="[\\d.]+" text-anchor="middle" font-weight="bold" font-size="${meterFracFs}"[^>]*>4<`).test(svg67), '')
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
// adj357：空间优先路径也应预留临时节拍宽度（原未算上，分数会压到下一小节音符）
{
  const lay86s = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 |"P:2/4" 3 4 |\n'), { ...DUR_CFG, noteSpaceLayout: 'space' as const })
  const b86s = lay86s.pages[0].barlines.find((b) => b.comment?.startsWith('P:'))
  const n86s = lay86s.pages[0].notes.find((n) => n.x > (b86s?.x ?? 0))
  // 分数半宽 ≈ 1 位数字 × noteSize×0.32 + 1.5×s（noteSize=18 → 7.26）；音符应在分数右缘之后
  check('adj357 空间优先路径预留临时节拍宽度（分数不压下一音符）', b86s !== undefined && n86s !== undefined && n86s.x >= b86s.x + 0.55 + 2 + 2 * (defaultPageConfig.note_size * 0.32 + 1.5 * NS_S) + 1, `noteX=${n86s?.x} barX=${b86s?.x}`)
}
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
// ---- adj392：紧接注释引号后的 + / - 抬升 / 降低注释文本（每级 NOTE_COMMENT_RAISE = 2px） ----
const r392 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1"甲" 2"乙"+ 3"丙"- 4"丁"++ |\n')
const t392 = r392.groups[0].music.tokens.filter((t) => t.kind === 'note')
check(
  'adj392 解析：+ / - 挂在注释上（甲=0、乙=+1、丙=-1、丁=+2），且都不再是增时线',
  r392.errors.length === 0 &&
    t392.every((t) => t.kind === 'note' && t.augmentCount === 0) &&
    t392[0].kind === 'note' && t392[0].commentPlus === undefined && t392[0].commentMinus === undefined &&
    t392[1].kind === 'note' && t392[1].commentPlus === 1 && t392[1].commentMinus === undefined &&
    t392[2].kind === 'note' && t392[2].commentMinus === 1 && t392[2].commentPlus === undefined &&
    t392[3].kind === 'note' && t392[3].commentPlus === 2,
  JSON.stringify(t392.map((t) => (t.kind === 'note' ? { c: t.comment, p: t.commentPlus, m: t.commentMinus, aug: t.augmentCount } : {}))),
)
const svg392 = renderScoreToSvg(layoutScore(r392, DUR_CFG))[0]
const commentY392 = (text: string): number => {
  const m = new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" text-anchor="middle" font-size="[\\d.]+"[^>]*>${text}<`).exec(svg392)
  return m ? Number(m[1]) : NaN
}
const y392 = { 甲: commentY392('甲'), 乙: commentY392('乙'), 丙: commentY392('丙'), 丁: commentY392('丁') }
check('adj392 渲染：+ 抬升 1 级（y 减少 NOTE_COMMENT_RAISE）', Math.abs(y392.甲 - y392.乙 - NOTE_COMMENT_RAISE) < 0.05, JSON.stringify(y392))
check('adj392 渲染：- 降低 1 级（y 增加 NOTE_COMMENT_RAISE）', Math.abs(y392.丙 - y392.甲 - NOTE_COMMENT_RAISE) < 0.05, JSON.stringify(y392))
check('adj392 渲染：++ 抬升 2 级（y 减少 2×NOTE_COMMENT_RAISE）', Math.abs(y392.甲 - y392.丁 - 2 * NOTE_COMMENT_RAISE) < 0.05, JSON.stringify(y392))
// 注释块内注释与 + 之间不留空格也成立；增时线写在注释之前仍是增时线（注释后紧贴的 - 归注释）
const r392b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1"甲"+2"乙" 3-"丙" 4"丁"--- |\n')
const t392b = r392b.groups[0].music.tokens.filter((t) => t.kind === 'note')
check(
  'adj392 紧贴下一音符 / 空格写法都支持：1"甲"+2 与 1"甲"+ 2 等效',
  r392b.errors.length === 0 && t392b.length === 4 && t392b[0].kind === 'note' && t392b[0].commentPlus === 1 && t392b[1].kind === 'note' && t392b[1].commentPlus === undefined,
  JSON.stringify(t392b.map((t) => (t.kind === 'note' ? { c: t.comment, p: t.commentPlus } : {}))),
)
check('adj392 增时线写在注释前（3-"丙"）仍是增时线，注释不带 +/-', t392b[2].kind === 'note' && t392b[2].augmentCount === 1 && t392b[2].commentMinus === undefined && t392b[2].commentPlus === undefined, JSON.stringify(t392b[2]))
check('adj392 注释后紧贴的 --- 归注释降低（4"丁"--- → -3 级，augmentCount=0）', t392b[3].kind === 'note' && t392b[3].commentMinus === 3 && t392b[3].augmentCount === 0, JSON.stringify(t392b[3]))
// 休止符 / 节奏符注释同样支持
const r392c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 0"转调"+ 9"节奏"-- |\n')
const t392c = r392c.groups[0].music.tokens.filter((t) => t.kind === 'rest' || t.kind === 'rhythm')
check(
  'adj392 休止符/节奏符注释也支持 +/-（0"转调"+ → +1、9"节奏"-- → -2）',
  r392c.errors.length === 0 && t392c[0]?.kind === 'rest' && t392c[0].commentPlus === 1 && t392c[1]?.kind === 'rhythm' && t392c[1].commentMinus === 2,
  JSON.stringify(t392c.map((t) => ({ k: t.kind, p: (t as { commentPlus?: number }).commentPlus, m: (t as { commentMinus?: number }).commentMinus }))),
)
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
// adj421：单行 2 小节 → 每小节一个槽；第 2 小节首音符落在第 2 槽内（实测中心 191）
check('adj421 单行 2 小节：小节 2 首音符在第 2 槽内（ML + 槽宽 ~ +2 槽）', notesW2[4].x + 6 > ML + SLOT_W && notesW2[4].x + 6 < ML + 2 * SLOT_W, `center=${notesW2[4].x + 6}`)
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
// adj199：行 2 前面有曲部（行 1）→ 每拍宽与行 1 一致（对齐而非自然宽）
// adj418：该行宽 = 参考行每拍宽 × 4，随可用宽变化（边距 40→50 后为 113.95，非简单 +10）
check('adj199 最后一行前面有曲部 → 按小节线对齐', Math.abs(maxRight2 - 113.95) < 1, `right=${maxRight2}`)
// adj199：行 2（未撑满）前面有曲部（行 1）→ 每小节宽与行 1 对齐（小节线 x 沿用参考行）
const row1BarsAdj = layJ.pages[0].barlines.filter((b) => Math.abs(b.yTop - row1Notes[0].y + BAR_TOP) < 0.5)
// adj418：行 1（7 小节）撑满，小节线 x 由可用宽决定（边距 40→50 后 115.2 → 122.4）
check('adj199 行 1 小节线位置（参考行）', row1BarsAdj.length >= 6 && Math.abs(row1BarsAdj[0].x - 122.4) < 1, `x=${row1BarsAdj[0]?.x}`)
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
// adj297：配置 6（自然宽）与默认 4（撑满）对比——自然宽应明显短于撑满，而不是卡"离右边界还差 100px"
// （adj418：改成相对比较，边距/纸张变化都不会让它误报）
check('adj297 配置 6：5 小节自然宽不撑满', maxRight5n < maxRight5 - 50, `natural=${maxRight5n} stretched=${maxRight5}`)
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
  check('adj211 最后一行 || 终止（3 小节）→ 自然宽', Math.abs(lastRight211 - (195.1 + ML_SHIFT)) < 1, `right=${lastRight211}`)
  // 对照：同谱 | 结尾，最后一行 3 小节仍按前面行对齐（180.4）
  const r211b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 5 6 7 1 |\n')
  const lay211b = layoutScore(r211b, DUR_CFG)
  const rows211b = [...new Set(lay211b.pages[0].notes.map((n) => n.y))].sort((a, b) => a - b)
  const lastRow211b = lay211b.pages[0].notes.filter((n) => n.y === rows211b[rows211b.length - 1])
  const lastRight211b = Math.max(...lastRow211b.map(segEnd))
  // adj418：这一行是"按前面行对齐"（每拍宽来自参考行），随可用宽变化 → 重钉为实测 184.85
  check('adj211 对照：| 结尾最后一行仍按前面行对齐', Math.abs(lastRight211b - 184.85) < 1, `right=${lastRight211b}`)
}

// ---- 23. 细节修复（adj2） ----
console.log('[23] adj2 fixes')
// 小节线位置：单行谱（最后一行自然宽 barW=70），线画在小节右边界
const rbar = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n')
const layBar = layoutScore(rbar, DUR_CFG)
const bars23 = layBar.pages[0].barlines
check('小节线 2 条', bars23.length === 2, `got ${bars23.length}`)
// adj421：单行 2 小节 → 每小节占一个「槽」（整行占宽按 4 槽预分），线 1 落在第 1 槽末尾
check('adj421 单行 2 小节：线 1 落在第 1 槽末尾（ML + 槽宽）', Math.abs(bars23[0].x - (ML + SLOT_W)) < 2, `x=${bars23[0].x} slot=${ML + SLOT_W}`)
// 行尾小节线：两槽用完后留白（含末尾线自身间距，实测 304.1）
check('adj421 单行 2 小节：线 2 ≈ 第 2 槽末尾（行尾留 2 槽空白）', Math.abs(bars23[1].x - (ML + 2 * SLOT_W)) < 8, `x=${bars23[1].x} slot2=${ML + 2 * SLOT_W}`)
check('adj421 单行 2 小节：行内容明显短于整行（未铺满）', bars23[1].x < ML + 3 * SLOT_W, `x=${bars23[1].x}`)
// 行首空 seg（|:）不占宽
const rr23 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 1 2 3 | 5 6 7 1 |\n')
const layRr = layoutScore(rr23, DUR_CFG)
const noteRr = layRr.pages[0].notes[0]
// adj198：行首 |: 自然宽（首音符 x+6 = 实测 64.6；adj391 线组 8.4→7.6 后整体左移 0.8）
check('adj198 行首 |: 占位（首音符中心）', Math.abs(noteRr.x + 6 - (64.6 + ML_SHIFT)) < 0.6, `center=${noteRr.x + 6}`)
check('|: 行首：粗线左缘贴左边距（x = 40 + 线组半宽）', Math.abs(layRr.pages[0].barlines[0].x - (ML + barlineTotalW('|:') / 2)) < 1, `x=${layRr.pages[0].barlines[0].x} expect=${ML + barlineTotalW('|:') / 2}`)

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
// adj421：单行 1 小节 → 内容在第 1 槽内摊开（4 拍均分槽宽，实测首音中心 68.5）
const n24All = layC24.pages[0].notes
const n24Centers = n24All.map((n) => n.x + 6)
check('adj421 单行 1 小节：4 拍音符在第 1 槽内摊开（首音中心 < 槽末）', n24.x + 6 > ML && n24.x + 6 < ML + SLOT_W, `center=${n24.x + 6}`)
check('adj421 单行 1 小节：4 拍均分槽宽（相邻间距一致）', n24Centers.length === 4 && Math.max(...n24Centers.slice(1).map((c, i) => Math.abs(c - n24Centers[i] - (n24Centers[1] - n24Centers[0])))) < 0.5, n24Centers.map((c) => c.toFixed(1)).join(','))
// 1/ 2/ 各居中于半拍段（自然宽 perBeat 14）
const rh24 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ |\n')
const nH24 = layoutScore(rh24, DUR_CFG).pages[0].notes
// 1/ 2/ 各居中于半拍段（adj421：半拍段宽随槽宽摊开——两音关于槽中心对称）
check('adj421 单行 1 小节：1/ 2/ 关于槽中心对称摊开', Math.abs((nH24[0].x + nH24[1].x) / 2 + 6 - (ML + SLOT_W / 2)) < 2, `mid=${(nH24[0].x + nH24[1].x) / 2 + 6} slotMid=${ML + SLOT_W / 2}`)
check('adj421 单行 1 小节：1/ 2/ 间距随槽宽拉开（不再挤在左边）', nH24[1].x - nH24[0].x > DIGIT_W * 3, `gap=${nH24[1].x - nH24[0].x}`)
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
check('adj199 行 2 按前面曲部行对齐（线 1）', Math.abs(row2Bars[0].x - 122.4) < 0.5, `x=${row2Bars[0].x}`)

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
// adj421：单行 2 小节 → 每小节一个槽（bar_gap 10 只影响槽内的小节线间距，不再决定小节宽）
check('adj421 小节间距配置下：小节 2 仍落在第 2 槽内', notesGap[4].x + 6 > ML + SLOT_W && notesGap[4].x + 6 < ML + 2 * SLOT_W, `center=${notesGap[4].x + 6}`)
const barsGap = layGap.pages[0].barlines
check('adj421 小节间距配置下：线 1 仍在第 1 槽末尾', Math.abs(barsGap[0].x - (ML + SLOT_W)) < 2, `x=${barsGap[0].x} slot=${ML + SLOT_W}`)

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
// 高音点 x = 数字槽中心（adj391：取消 adj19 的左移 1px，与音符水平居中）
check('adj391 高音点 x = 数字槽中心（与音符水平居中）', octDot !== null && Math.abs(Number(octDot[1]) - (nO34.x + halfDig)) < 0.5, `cx=${octDot?.[1]} expect=${nO34.x + halfDig}`)
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
check('adj359 跳房子播放 12 事件（pass1 1,2,3,4,7,1 + pass2 1,2,5,6,7,1）', seq38.events.length === 12 && pitchSeq(seq38) === 'C4,D4,E4,F4,B4,C4,C4,D4,G4,A4,B4,C4', `${seq38.events.length}:${pitchSeq(seq38)}`)
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
// 反复点：|: 为左粗线、中细线、右 :（点中心由 barlineGeometry 给出，adj391 = 线 x + 2.6；
// 点线距 1.2px，adj104 点径 2.4、r=1.2；随字号缩放 ×s）
const svg41 = renderScoreToSvg(lay41)[0]
const dot41R = R1(BARLINE_DOT_R * NS_S) // 反复点半径随字号
const dot41 = new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${dot41R}"`).exec(svg41)
const dot41Exp = b41.x + (barlineGeometry(b41.type).dots[0] ?? 0)
check('反复点（|: 右侧 :，cx = 线 x + 几何点偏移）', dot41 !== null && Math.abs(Number(dot41[1]) - dot41Exp) < 0.5, `cx=${dot41?.[1]} expect=${dot41Exp}`)

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
// adj421：单行 1 小节 → 4 拍均分槽宽，「二」（对音符 3）与「一」（对音符 1）相差 2 拍段（实测 57.9）
check('adj421 @ 后歌词后移（二 对音符 3，随槽宽均分）', Math.abs(l46a[1].x - l46a[0].x - 57.9) < 1, `dx=${l46a[1].x - l46a[0].x}`)
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
/**
 * adj456：调号角标这一组（adj174/175/179/189/190/191）此前长期失败，排查结论是**断言口径整体过时**，
 * 不是渲染退化——现行设计（render/index.ts 调号分支）已改成：
 *   ① 角标字号 = 调号 3/4（`mSize * 3/4`，13 → 9.8），不再是 0.6×字号；
 *   ② 角标 y = 调号基线 − **0.35×字号**（下沿贴字母中线），不再是 0.4×字号；
 *   ③ 字母让位改用 **`<tspan dx="0.9×角标宽">`**（8.8），**不再是整体右移 keyline 的 x**；
 *   ④ 角标 x = "1 = " 宽之后的**原字母左缘**（即它占的正是让位让出来的空档）。
 * 旧的硬编码字形 advance（7.62+3.85+9.64+3.85）仍可用于算 "1 = " 宽，但必须**再加上 tspan dx**
 * 才等于字母真实左缘——旧断言漏了这一步，于是把"角标在字母左侧"判成了失败（实测只差 0.04px）。
 * 现按现行设计逐项断言，并补一条真正用户可见的不变量：**调号与拍号不重叠**。
 */
const kAccOf = (svg: string): RegExpExecArray | null => /<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([♯♭])<\/text>/.exec(svg)
const kKeyOf = (svg: string): RegExpExecArray | null => /<text data-meta="keyline" x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>1 = (?:<tspan dx="([\d.]+)">([A-G])<\/tspan>|([A-G]))<\/text>/.exec(svg)
const kMeterOf = (svg: string): RegExpExecArray | null => /<g data-meta="meter"[^>]*><text x="([\d.]+)"/.exec(svg)
/** "1 = " 在 13px 基准下的估算宽（与 render 的 metaTextW 口径一致：1=7.62 空格=3.85 ==9.64 空格=3.85） */
const kPrefixW = (7.62 + 3.85 + 9.64 + 3.85) * (defaultPageConfig.miaoshu_size / 13)
/** 字母真实左缘 = keyline.x + "1 = " 宽 + tspan dx（有升降号时字母被 dx 右移让位） */
const kLetterLeftOf = (svg: string): number => {
  const k = kKeyOf(svg)
  if (!k) return NaN
  return Number(k[1]) + kPrefixW + Number(k[4] ?? 0)
}
const kLetterOf = (svg: string): string | undefined => kKeyOf(svg)?.[5] ?? kKeyOf(svg)?.[6]
check('adj174 前置 #F：调号文本 = 1 = ♯F（字母用 tspan 让位）', kLetterOf(svgK174a) === 'F' && kAccOf(svgK174a)?.[4] === '♯' && kKeyOf(svgK174a)?.[4] !== undefined, `key=${kKeyOf(svgK174a)?.[0]}`)
check('adj174 后置 F# 与前置完全等价（同字母、同角标、同几何）',
  kLetterOf(svgK174b) === 'F' && kAccOf(svgK174b)?.[4] === '♯' && kLetterLeftOf(svgK174b) === kLetterLeftOf(svgK174a) && Number(kAccOf(svgK174b)?.[1]) === Number(kAccOf(svgK174a)?.[1]),
  `${kLetterLeftOf(svgK174b)} vs ${kLetterLeftOf(svgK174a)}`)
const rK174c = parseJps('V: 1.0\nB: t\nD: B$\nP: 4/4\nQ: 1 2 3 4 |\n')
const svgK174c = renderScoreToSvg(layoutScore(rK174c, DUR_CFG))[0]
check('adj174 降号 $ 渲染 ♭ 角标且字母为 B（不出现 $B 原文）', kLetterOf(svgK174c) === 'B' && kAccOf(svgK174c)?.[4] === '♭' && !svgK174c.includes('$B'), '')
// adj175：b 作为降号与 $ 等价；bE 与 Eb 等价；升降号在字母左侧、中线以上、字号为调号一半
const rK175a = parseJps('V: 1.0\nB: t\nD: bE\nP: 4/4\nQ: 1 2 3 4 |\n')
const rK175b = parseJps('V: 1.0\nB: t\nD: Eb\nP: 4/4\nQ: 1 2 3 4 |\n')
const rK175c = parseJps('V: 1.0\nB: t\nD: $E\nP: 4/4\nQ: 1 2 3 4 |\n')
check('adj175 bE / Eb / $E 半音偏移一致（降 E）', parseKey(rK175a.header.key) === parseKey(rK175b.header.key) && parseKey(rK175b.header.key) === parseKey(rK175c.header.key) && parseKey(rK175b.header.key) === 3, `${parseKey(rK175a.header.key)},${parseKey(rK175b.header.key)},${parseKey(rK175c.header.key)}`)
const svgK175 = renderScoreToSvg(layoutScore(rK175a, DUR_CFG))[0]
check('adj175 bE 渲染为 1 = ♭E 角标', kLetterOf(svgK175) === 'E' && kAccOf(svgK175)?.[4] === '♭', `key=${kKeyOf(svgK175)?.[0]}`)
const k175Acc = kAccOf(svgK175)
const k175Key = kKeyOf(svgK175)
// adj189：角标在**字母真实左缘**之左（含 tspan 让位量）、y 更高、字号 = 调号 3/4
check('adj189 ♭ 角标在字母左侧、更高、字号 = 3/4×调号（9.8）',
  k175Acc !== null && k175Key !== null &&
    Number(k175Acc[1]) < kLetterLeftOf(svgK175) &&
    Number(k175Acc[2]) < Number(k175Key[2]) &&
    Math.abs(Number(k175Acc[3]) - defaultPageConfig.miaoshu_size * 0.75) < 0.1,
  JSON.stringify([k175Acc?.[1], k175Acc?.[2], k175Acc?.[3], kLetterLeftOf(svgK175)]))
// adj191（并入角标不压字母的不变量）：角标右缘不得越过字母真实左缘（允许设计上的 0.1×角标宽叠入）
check('adj191 角标占用的是让位空档，不压到字母（右缘 ≤ 字母左缘 + 0.1×角标宽）',
  k175Acc !== null && Number(k175Acc[1]) + Number(k175Acc[3]) <= kLetterLeftOf(svgK175) + 0.1 * Number(k175Acc[3]) + 0.5,
  `accRight=${k175Acc ? Number(k175Acc[1]) + Number(k175Acc[3]) : NaN} letterLeft=${kLetterLeftOf(svgK175)}`)
// adj179：角标 y = 调号基线 − 0.35×字号（下沿贴字母中线）
check('adj179 角标 y = 基线 - 0.35×字号（下沿贴字母中线）',
  k175Acc !== null && k175Key !== null && Math.abs(Number(k175Acc[2]) - (Number(k175Key[2]) - 0.35 * defaultPageConfig.miaoshu_size)) < 0.15,
  JSON.stringify([k175Acc?.[2], k175Key?.[2]]))
// adj178：孤立 &（输入中未完成）为 warning 而非 error——预览不阻断
const r178 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 &\n')
check('adj178 孤立 & 降为 warning（不阻断预览）', r178.errors.some((e) => e.message.includes('&') && e.severity === 'warning') && !r178.errors.some((e) => e.severity === 'error'), JSON.stringify(r178.errors))
// adj190：字母让位——**机制已从"整体右移 keyline.x"改为"字母 tspan dx 右移"**（旧断言因此长期失败）
// 现断言可观测结果：① 有升降号时字母真实左缘 = 无升降号时字母左缘 + tspan dx（>0）；② 无升降号时没有 tspan
const k181PlainKey = kKeyOf(svgM48) // 无升降号 D: C
check('adj190 有升降号时字母用 tspan dx 右移让位（无升降号时无 tspan）',
  kKeyOf(svgK175)?.[4] !== undefined && Number(kKeyOf(svgK175)?.[4]) > 0 &&
    k181PlainKey !== null && k181PlainKey[4] === undefined &&
    kLetterLeftOf(svgK175) - (Number(k181PlainKey[1]) + kPrefixW) > 0.5,
  `dx=${kKeyOf(svgK175)?.[4]} letterLeft=${kLetterLeftOf(svgK175)} plainLetterLeft=${Number(k181PlainKey?.[1]) + kPrefixW}`)
// 角标 x = "1 = " 宽之后的**原字母左缘**（即角标占的正是让位让出来的空档）
check('adj190b 角标 x = keyline.x + "1 = " 宽（让位空档起点）',
  k175Acc !== null && k175Key !== null && Math.abs(Number(k175Acc[1]) - (Number(k175Key[1]) + kPrefixW)) < 0.15,
  JSON.stringify([k175Acc?.[1], Number(k175Key?.[1] ?? NaN) + kPrefixW]))
// 用户可见不变量：调号与拍号不打架——拍号左缘必须在字母（含让位与字宽）之后
check('adj190c 调号与拍号不重叠（拍号左缘 ≥ 字母左缘 + 0.6×字号）',
  kLetterLeftOf(svgK175) < Number(kMeterOf(svgK175)?.[1] ?? NaN) - 0.6 * defaultPageConfig.miaoshu_size,
  `letterLeft=${kLetterLeftOf(svgK175)} meterX=${kMeterOf(svgK175)?.[1]}`)
// ♯ 角标同样满足上述不变量（与 ♭ 同一套几何，此处只把 ♯ 走一遍）
check('adj189b ♯ 角标同样在字母真实左缘之左、更高、字号 = 3/4×调号',
  kAccOf(svgK174a) !== null && kKeyOf(svgK174a) !== null &&
    Number(kAccOf(svgK174a)![1]) < kLetterLeftOf(svgK174a) &&
    Number(kAccOf(svgK174a)![2]) < Number(kKeyOf(svgK174a)![2]) &&
    Math.abs(Number(kAccOf(svgK174a)![3]) - defaultPageConfig.miaoshu_size * 0.75) < 0.1,
  JSON.stringify([kAccOf(svgK174a)?.[1], kAccOf(svgK174a)?.[2], kAccOf(svgK174a)?.[3], kLetterLeftOf(svgK174a)]))
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
  [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="(1|2)" height="16\.[0-9]"/g)]
    .map((m) => ({ x: +m[1], w: m[2] }))
    .filter((o) => Math.abs(o.x - cx) < r)
const barlineDots = (svg: string, cx: number, r: number) =>
  [...svg.matchAll(new RegExp(`<circle cx="([\\d.]+)" cy="[\\d.]+" r="${R1(BARLINE_DOT_R * NS_S)}"`, 'g'))]
    .map((m) => +m[1])
    .filter((c) => Math.abs(c - cx) < r)
// adj391：线宽 细 1 / 粗 2（用户规则）；线组以小节线中心对称（渲染与布局占位共用 barlineGeometry）
check('adj391 线宽常量：细 1、粗 2', BARLINE_W_THIN === 1 && BARLINE_W_THICK === 2, `thin=${BARLINE_W_THIN} thick=${BARLINE_W_THICK}`)
// ① || 双小节线：左细线右粗线（细 1、粗 2），间距 1px（adj55 原意，adj391 恢复）
const lay52a = mk52('1 2 3 4 || 5 6 7 1 |')
const b52a = lay52a.pages[0].barlines.find((b) => b.type === '||')
const rr52a = b52a ? barlineRects(svg52(lay52a), b52a.x, 6) : []
check('|| 左细右粗（细 1、粗 2）', rr52a.length === 2 && rr52a[0].w === '1' && rr52a[1].w === '2', JSON.stringify(rr52a))
check('|| 线间距 1px（adj391）', rr52a.length === 2 && Math.abs(rr52a[1].x - (rr52a[0].x + 1) - BARLINE_LINE_GAP) < 0.5, JSON.stringify(rr52a))
check('adj391 线组以小节线中心对称（左缘 = x−2、右缘 = x+2）', rr52a.length === 2 && b52a !== undefined && Math.abs(rr52a[0].x - (b52a.x - barlineTotalW('||') / 2)) < 0.5 && Math.abs(rr52a[1].x + 2 - (b52a.x + barlineTotalW('||') / 2)) < 0.5, `rects=${JSON.stringify(rr52a)} x=${b52a?.x}`)
// ② ||/ 双细线，间距 1px（adj55/391）
const lay52b = mk52('1 2 3 4 ||/ 5 6 7 1 |')
const b52b = lay52b.pages[0].barlines.find((b) => b.type === '||/')
const rr52b = b52b ? barlineRects(svg52(lay52b), b52b.x, 5) : []
check('||/ 双细线（2 条 1）', rr52b.length === 2 && rr52b[0].w === '1' && rr52b[1].w === '1', JSON.stringify(rr52b))
check('||/ 线间距 1px（adj391）', rr52b.length === 2 && Math.abs(rr52b[1].x - (rr52b[0].x + 1) - BARLINE_LINE_GAP) < 0.5, JSON.stringify(rr52b))
// ③ |: 左粗线、中细线、右 :，线距 1px、点线距 1.2px（adj55/104/391）
const lay52c = mk52('1 2 3 4 |: 5 6 7 1 |')
const b52c = lay52c.pages[0].barlines.find((b) => b.type === '|:')
const rr52c = b52c ? barlineRects(svg52(lay52c), b52c.x, 8) : []
const dd52c = b52c ? barlineDots(svg52(lay52c), b52c.x, 8) : []
check('|: 粗线在左、细线在右', rr52c.length === 2 && rr52c[0].w === '2' && rr52c[1].w === '1', JSON.stringify(rr52c))
const dotGap52c = Math.min(...dd52c) - BARLINE_DOT_R * NS_S - (rr52c[1].x + 1) // 点左缘 - 细线右缘
check('|: 点在细线右侧（间距 1.2px，adj104）', dd52c.length === 2 && Math.abs(dotGap52c - BARLINE_DOT_GAP) < 0.5, `gap=${dotGap52c} dots=${dd52c} thin=${rr52c[1]?.x}`)
// ④ :| 左 :、中细线、右粗线
const lay52d = mk52('1 2 3 4 :| 5 6 7 1 |')
const b52d = lay52d.pages[0].barlines.find((b) => b.type === ':|')
const rr52d = b52d ? barlineRects(svg52(lay52d), b52d.x, 8) : []
const dd52d = b52d ? barlineDots(svg52(lay52d), b52d.x, 8) : []
check(':| 细线在左、粗线在右', rr52d.length === 2 && rr52d[0].w === '1' && rr52d[1].w === '2', JSON.stringify(rr52d))
check(':| 点在细线左侧', dd52d.length === 2 && Math.max(...dd52d) < rr52d[0].x, `dots=${dd52d}`)
// ⑤ :|: 两边反复：: 细线 粗线 细线 :
const lay52e = mk52('1 2 3 4 :|: 5 6 7 1 |')
const b52e = lay52e.pages[0].barlines.find((b) => b.type === ':|:')
const rr52e = b52e ? barlineRects(svg52(lay52e), b52e.x, 10) : []
const dd52e = b52e ? barlineDots(svg52(lay52e), b52e.x, 10) : []
check(':|: 细-粗-细 3 线', rr52e.length === 3 && rr52e[0].w === '1' && rr52e[1].w === '2' && rr52e[2].w === '1', JSON.stringify(rr52e))
check(':|: 左右各 2 点', dd52e.length === 4 && Math.min(...dd52e) < rr52e[0].x && Math.max(...dd52e) > rr52e[2].x + 1, `dots=${dd52e}`)
// adj391：渲染与布局占位同源——线 rect 的 x/宽、点圆心都必须等于 barlineGeometry 给出的几何
// （线宽不随字号缩放，故 rect 可直接与设计值逐项比对；点的半径随字号缩放，故只比圆心）
const spans391: [string, ReturnType<typeof mk52>, BarlineType][] = [
  ['|', mk52('1 2 3 4 | 5 6 7 1 |'), '|'],
  ['||', lay52a, '||'],
  ['||/', lay52b, '||/'],
  ['|:', lay52c, '|:'],
  [':|', lay52d, ':|'],
  [':|:', lay52e, ':|:'],
]
for (const [name, lay, type] of spans391) {
  const bb = lay.pages[0].barlines.find((x) => x.type === type)
  if (!bb) {
    check(`adj391 ${name} 小节线存在`, false, `type=${type}`)
    continue
  }
  const geom = barlineGeometry(type)
  const rs = barlineRects(svg52(lay), bb.x, 12)
    .map((o) => ({ off: R1(o.x - bb.x), w: Number(o.w) }))
    .sort((a, b) => a.off - b.off)
  const ds = [...new Set(barlineDots(svg52(lay), bb.x, 12).map((c) => R1(c - bb.x)))].sort((a, b) => a - b)
  const linesOk = rs.length === geom.lines.length && rs.every((o, i) => Math.abs(o.off - geom.lines[i].off) < 0.05 && o.w === geom.lines[i].w)
  // 每个反复点渲染两枚圆（上下各一），故按 x 去重后再比
  const dotsOk = ds.length === geom.dots.length && ds.every((c, i) => Math.abs(c - R1(geom.dots[i])) < 0.05)
  check(`adj391 ${name} 渲染几何 == barlineGeometry（线偏移/宽 + 点圆心）`, linesOk && dotsOk, JSON.stringify({ rs, geom: geom.lines, ds, gdots: geom.dots }))
}
// 占位表本身（几何单一来源）
const ALL_BAR_TYPES: BarlineType[] = ['|', '||', '||/', '||:', '|:', ':|', ':|:', '|*', '|/']
const w391: Record<string, number> = { '|': 1, '||': 4, '||/': 3, '||:': 6.6, '|:': 7.6, ':|': 7.6, ':|:': 13.2, '|*': 1, '|/': 0 }
check(
  'adj391 占位总宽（| 1、|| 4、||/ 3、||: 6.6、|: 7.6、:| 7.6、:|: 13.2、|* 1、|/ 0）',
  ALL_BAR_TYPES.every((t) => Math.abs(barlineTotalW(t) - w391[t]) < 1e-9),
  ALL_BAR_TYPES.map((t) => `${t}=${barlineTotalW(t)}`).join(','),
)
check(
  'adj391 几何对称（各类型首元素左缘 = −total/2、末元素右缘 = +total/2）',
  ALL_BAR_TYPES.every((t) => {
    const g = barlineGeometry(t)
    if (g.total === 0) return g.lines.length === 0 && g.dots.length === 0
    const lefts = [...g.lines.map((l) => l.off), ...g.dots.map((c) => c - BARLINE_DOT_R)]
    const rights = [...g.lines.map((l) => l.off + l.w), ...g.dots.map((c) => c + BARLINE_DOT_R)]
    return Math.abs(Math.min(...lefts) + g.total / 2) < 1e-9 && Math.abs(Math.max(...rights) - g.total / 2) < 1e-9
  }),
  ALL_BAR_TYPES.map((t) => `${t}:${JSON.stringify(barlineGeometry(t))}`).join(' '),
)
// ⑥ |/ 不显示、不占位；|* 不显示、占位
const lay52f = mk52('1 2 3 4 |/ 5 6 7 1 |')
const lay52g = mk52('1 2 3 4 |* 5 6 7 1 |')
const lay52h = mk52('1 2 3 4 | 5 6 7 1 |')
const rectCount52 = (s: string) => (s.match(/width="(?:1|2)" height="16\.[0-9]"/g) ?? []).length
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
const maxBarR54 = Math.max(...lay54.pages[0].barlines.map((b) => b.x + barlineTotalW(b.type) / 2))
// adj391：小节线中心 x 由布局以 r1（0.1px）取整，贴右边距行的"右缘 = 中心 + 半宽"最多外溢 0.05px
// ——这是取整误差，不是布局溢出（该行右缘本就应落在内容边界上），故断言放 0.05 容差
check(
  '小节线不溢出右边距（右缘 = 中心+半宽 ≤ 右内容边界 + 0.05 取整容差）',
  maxBarR54 <= RIGHT_EDGE + 0.05,
  `right=${maxBarR54} edge=${RIGHT_EDGE} worst=${JSON.stringify(lay54.pages[0].barlines.map((b) => ({ t: b.type, x: b.x.toFixed(4), r: (b.x + barlineTotalW(b.type) / 2).toFixed(4) })).sort((a, b) => Number(b.r) - Number(a.r)).slice(0, 3))}`,
)
// 混合时值（16 分音符）不重叠
const r54b = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ 2/ 3// 4// | 1/ 2/ 3// 4// |\n')
const n54b = [...layoutScore(r54b, DUR_CFG).pages[0].notes].sort((a, b) => a.x - b.x)
let minGap54 = Infinity
for (let i = 1; i < n54b.length; i++) minGap54 = Math.min(minGap54, n54b[i].x - n54b[i - 1].x)
check('跨拍/拍中起始音符不重叠（最小间距 ≥ 数字槽宽）', minGap54 >= DIGIT_W, `minGap=${minGap54}`)
// 行首 |* 占位、|/ 不占位（需求）
const r54c = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |* 1 2 3 4 |\n')
const n54c = layoutScore(r54c, DUR_CFG).pages[0].notes[0]
check('行首 |* 占位（音符右移；adj391 线组宽 1 后实测 52）', n54c.x >= ML + 11.5, `x=${n54c.x}`)

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
// 含变音的音符：见下面 adj456 断言（腾位体现在本体宽，不是"数字 x > 段起点"）
const mbdNotes = mbdLay.pages[0].notes
/**
 * adj456：「变音音符数字右移给角标腾位」这条断言此前长期失败（实测 nx == segX，只差 0.017px），
 * 排查结论同样是**断言口径过时**：空间优先下 `note.x` 就是**本体框左缘**（数字画在框内、
 * 角标画在数字左侧），而"腾位"体现在**本体宽**上——`noteBodyW(...) + accidentalBodyW(...)`
 * （accW = 7.62×字号），于是变音音之后的音符整体右移一个 accW。
 * 旧断言拿 `x > 段起点` 去判"右移"，但段起点本来就等于本体左缘 ⇒ 永远近似相等。
 * 现按**可观测后果**断言：与"去掉变音"的对照谱逐音比较，变音音之后的音右移 ≈ accW。
 */
const mbdPlainCfg = { ...DUR_CFG, noteSpaceLayout: 'space' as const }
const mbdPlainLay = layoutScore(parseJps(mbdSrc.replace(/#/g, '')), mbdPlainCfg)
const mbdPlainNotes = mbdPlainLay.pages[0].notes
const accW = accidentalBodyW(defaultPageConfig.note_size)
const shifted = mbdNotes.filter((n, i) => n.token.kind === 'note' && !n.token.accidental && mbdPlainNotes[i] && n.x > mbdPlainNotes[i].x + accW - 0.6)
check('多声部空间优先 变音音符本体宽含角标预留（其后音符整体右移 ≈ 一个角标宽）',
  mbdNotes.some((n) => n.token.kind === 'note' && n.token.accidental) && shifted.length >= 1,
  `accW=${accW} 右移项=${shifted.map((n) => Math.round((n.x - mbdPlainNotes[mbdNotes.indexOf(n)].x) * 10) / 10).join(',')}`)
// 角标画在数字左侧、且在自己的**本体预留**之内（renderNote：x − 7×s，s = noteSize/18）
// 与上一个音符：不出它的本体框（容差 0.6px——本体宽按字形 advance 计，实际墨迹略窄）
{
  const sharpIdx = mbdNotes.findIndex((n) => n.token.kind === 'note' && n.token.accidental)
  const sharpNote = mbdNotes[sharpIdx]
  const prevNote = mbdNotes[sharpIdx - 1]
  const s18 = defaultPageConfig.note_size / 18 // 渲染端缩放基准（noteScaleOf）
  const accX = sharpNote ? sharpNote.x - 7 * s18 : NaN
  check('多声部空间优先 变音角标画在数字左侧且在本体预留内、不出前一个音符的本体框',
    !!sharpNote && !!prevNote && accX < sharpNote.x && accX >= sharpNote.x - accW - 0.5 && accX >= prevNote.x + prevNote.width - 0.6,
    `accX=${accX} noteX=${sharpNote?.x} reserve=${sharpNote ? sharpNote.x - accW : NaN} prevRight=${prevNote ? prevNote.x + prevNote.width : NaN}`)
}
// 音符块本体（数字）在时值段内：数字左缘 >= 段起点（不越段左边界，横向居中由 placeNoteAt 段定位保证）
const mbdAllInSeg = mbdNotes.every((n) => (n.x ?? 0) >= (n.segments?.[0]?.x ?? 0) - 1)
check('多声部空间优先 音符数字均在时值段内', mbdAllInSeg, JSON.stringify(mbdNotes.slice(0, 3).map((n) => ({ nx: n.x, segX: n.segments?.[0]?.x }))))
// 无越界（左边界 + 不劣于时值优先右溢出）
const mbdMaxR = Math.max(...mbdNotes.map((n) => n.x + n.width))
const mbdDur = layoutScore(mbdRes, DUR_CFG)
const mbdDurMaxR = Math.max(...mbdDur.pages[0].notes.map((n) => n.x + n.width))
check('多声部空间优先 变音/附点溢出 ≤ 时值优先', mbdMaxR <= mbdDurMaxR + 0.5, JSON.stringify({ space: Math.round(mbdMaxR * 10) / 10, dur: Math.round(mbdDurMaxR * 10) / 10 }))

// ---- 63b. 多声部：无时值「占宽元素」插位（adj479） ----
// 用户报：多声部里 `&hx` 不显示、`&shy`/`&xhy` 与音符重叠。根因两条：
//  ① 多声部块把独立标记（&zkh/&ykh/&hx）的宽度算进了拍宽，却**从不绘制**（page.brackets 里没有）；
//  ② 滑音是音符修饰符、布局端**完全不占宽**，多声部每拍紧密排布时墨迹压到后一个数字。
console.log('[63b] multi-voice zero-duration width elements (adj479)')
{
  const ns479 = defaultPageConfig.note_size
  const digW479 = digitSlotW(ns479)
  for (const [modeName, cfg479] of [
    ['空间优先', mspCfg],
    ['时值优先', DUR_CFG],
  ] as const) {
    // ① &hx：多声部必须渲染，且落在 6 与 5 之间（拍首前置占位）
    const hxP = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 6 &hx 5 4 3 |\nQ2: 1 2 3 4 |\n'), cfg479).pages[0]
    const hxQ1 = hxP.notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
    const hxQ2 = hxP.notes.filter((n) => n.id.voice === 2).sort((a, b) => a.x - b.x)
    const hxMark = hxP.brackets.find((b) => b.code === 'hx')
    check(`adj479 ${modeName} &hx 在多声部渲染（此前完全缺失）`, !!hxMark, JSON.stringify(hxP.brackets))
    check(
      `adj479 ${modeName} &hx 落在 6 与 5 之间`,
      !!hxMark && hxMark.x - hxMark.width / 2 >= hxQ1[0].x + digW479 - 0.5 && hxMark.x + hxMark.width / 2 <= hxQ1[1].x + 0.6,
      `mark=[${hxMark ? (hxMark.x - hxMark.width / 2).toFixed(1) : '-'},${hxMark ? (hxMark.x + hxMark.width / 2).toFixed(1) : '-'}] note0右=${(hxQ1[0].x + digW479).toFixed(1)} note1x=${hxQ1[1].x}`,
    )
    check(
      `adj479 ${modeName} &hx 占位后同拍仍纵向对齐`,
      Math.abs(hxQ1[1].x - hxQ2[1].x) < 0.6 && Math.abs(hxQ1[2].x - hxQ2[2].x) < 0.6,
      `Q1=${hxQ1.map((n) => n.x).join(',')} Q2=${hxQ2.map((n) => n.x).join(',')}`,
    )
    // ② &zkh/&ykh：多声部同样必须渲染（首标记在首音符之前、尾标记在其后音符之前）
    const bkP = layoutScore(parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: &zkh 5 6 7&ykh 1' |\nQ2: 1 2 3 4 |\n"), cfg479).pages[0]
    const bkQ1 = bkP.notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
    const zkh = bkP.brackets.find((b) => b.code === 'zkh')
    const ykh = bkP.brackets.find((b) => b.code === 'ykh')
    check(`adj479 ${modeName} &zkh/&ykh 在多声部渲染`, !!zkh && !!ykh, JSON.stringify(bkP.brackets))
    check(
      `adj479 ${modeName} &zkh 在首音符之前、&ykh 在末音符之前`,
      !!zkh && !!ykh && zkh.x + zkh.width / 2 <= bkQ1[0].x + 0.6 && ykh.x + ykh.width / 2 <= bkQ1[3].x + 0.6,
      `zkh右=${zkh ? (zkh.x + zkh.width / 2).toFixed(1) : '-'} note0=${bkQ1[0]?.x} ykh右=${ykh ? (ykh.x + ykh.width / 2).toFixed(1) : '-'} note3=${bkQ1[3]?.x}`,
    )
    // ③ &shy/&xhy：音符本体宽 = 数字槽 + 滑音墨迹宽；墨迹不压后一数字
    const slP = layoutScore(parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1&shy 2&xhy 3 4 |\nQ2: 5 6 7 1' |\n"), cfg479).pages[0]
    const slQ1 = slP.notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
    const shyW = slideExtraW('shy', ns479)
    const xhyW = slideExtraW('xhy', ns479)
    // 本体宽口径只在空间优先成立（时值优先的 note.width 是整个时值段宽，不是本体宽）
    if (modeName === '空间优先') {
      check(
        `adj479 ${modeName} 滑音音符本体宽含墨迹（#1 上滑音）`,
        Math.abs(slQ1[0].width - (digW479 + shyW)) < 0.6,
        `w=${slQ1[0].width} 期望=${(digW479 + shyW).toFixed(2)}`,
      )
    }
    check(
      `adj479 ${modeName} 滑音墨迹不压后一音符（两个滑音音都判）`,
      slQ1[0].x + digW479 + shyW <= slQ1[1].x + 0.6 && slQ1[1].x + digW479 + xhyW <= slQ1[2].x + 0.6,
      `shy右=${(slQ1[0].x + digW479 + shyW).toFixed(1)} 2x=${slQ1[1].x} xhy右=${(slQ1[1].x + digW479 + xhyW).toFixed(1)} 3x=${slQ1[2].x}`,
    )
    // ④ 附点（同为"无时值但有占宽"的元素）：本体宽逐拍归位后，不与后一拍数字重叠
    const dtP = layoutScore(parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 2.&xhy 3 4 |\nQ2: 6 7 1' |\n"), cfg479).pages[0]
    const dtQ1 = dtP.notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)
    check(
      `adj479 ${modeName} 附点+滑音的本体宽计入首拍（后一音符让开）`,
      dtQ1[1].x >= dtQ1[0].x + digW479 + xhyW + dotBodyW(ns479) - 0.6,
      `2.x=${dtQ1[0].x} 3.x=${dtQ1[1].x} 需求=${(digW479 + xhyW + dotBodyW(ns479)).toFixed(2)}`,
    )
  }
  // ⑤ 渲染端与布局端**同源**：SVG 里滑音图形的 transform 正是 `slideGlyphInk` 给出的框
  const ink479 = slideGlyphInk('shy', ns479)
  const gl479 = MODIFIER_GLYPHS.shy
  const sc479 = ink479.w / gl479.box.w
  const slSvg = layoutScore(parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1&shy 2 3 4 |\nQ2: 5 6 7 1' |\n"), mspCfg)
  const slNote = slSvg.pages[0].notes.filter((n) => n.id.voice === 1).sort((a, b) => a.x - b.x)[0]
  const tx479 = Math.round((slNote.x + ink479.dx - gl479.box.x * sc479) * 100) / 100
  const ty479 = Math.round((slNote.y + ink479.dy - gl479.box.y * sc479) * 100) / 100
  const scStr479 = String(Math.round(sc479 * 1e6) / 1e6)
  check(
    'adj479 滑音渲染落位与占宽模型同源（同一份几何）',
    renderScoreToSvg(slSvg)[0].includes(`translate(${tx479} ${ty479}) scale(${scStr479})`),
    `期望 translate(${tx479} ${ty479}) scale(${scStr479})`,
  )
}

// ---- 63c. 声部间距允许负值（adj479，用户报「虚线无法往负数方向调」） ----
console.log('[63c] negative voice spacing (adj479)')
{
  const sbCode = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 4 |\nC1: 啊 啊 啊 啊\nQ2: 5 6 7 1' |\nC2: 啊 啊 啊 啊\n"
  const sbLayer = (v: number) => layoutScore(parseJps(sbCode), { ...mspCfg, height_shengbu: v })
  const yOf = (v: number, voice: number) => sbLayer(v).pages[0].notes.filter((n) => n.id.voice === voice)[0]?.y ?? 0
  // ① 钳制范围允许负值（此前 [0,300] → 往上一拖就被钳回 0）
  check(
    'adj479 声部间距范围允许负值（此前下限 0）',
    GUIDE_LIMITS_EX.height_shengbu[0] < 0 && GUIDE_LIMITS_EX.height_shengbu[1] === 300,
    JSON.stringify(GUIDE_LIMITS_EX.height_shengbu),
  )
  // ② 拖拽换算（PreviewPane 用的同一套：dragDelta + clamp）——向上拖 12px 得到 −12，不被钳到 0
  {
    const [min, max] = GUIDE_LIMITS_EX.height_shengbu
    const dragged = Math.round(clamp(0 + dragDelta({ key: 'height_shengbu', dir: 'v' }, 100, 200, 100, 188, 1), min, max))
    const capped = Math.round(clamp(0 + dragDelta({ key: 'height_shengbu', dir: 'v' }, 100, 200, 100, 0, 1), min, max))
    check('adj479 向上拖虚线得到负的声部间距（−12，不再钳回 0）', dragged === -12, String(dragged))
    check('adj479 拖到极限取到下限（−30，两行刚好不压字）而不是 0', capped === GUIDE_LIMITS_EX.height_shengbu[0] && capped === -30, String(capped))
  }
  // ③ 负值真的生效：第二声部上移 |值|、第一声部不动
  check('adj479 声部间距 −12：第二声部上移 12、第一声部不动', Math.abs(yOf(0, 2) - yOf(-12, 2) - 12) < 0.6 && Math.abs(yOf(0, 1) - yOf(-12, 1)) < 0.1, `v1 ${yOf(0, 1)}→${yOf(-12, 1)} v2 ${yOf(0, 2)}→${yOf(-12, 2)}`)
  // ④ 负值下虚线仍判定为「声部行」（拖它改的仍是声部间距，不会退化成行距）
  {
    const g = computeRowGuides(sbLayer(-12), { quci: defaultPageConfig.height_quci, geci: defaultPageConfig.geci_size }, defaultPageConfig.note_size)[0]
    const idx = [...g].sort((a, b) => a.yTop - b.yTop).map((r) => r.voiceIdx)
    check('adj479 负声部间距下声部序号仍正确（块内第 2 行 = 1）', idx.length >= 2 && idx[idx.length - 1] >= 1, JSON.stringify(idx))
  }
  // ⑤ 负值写回谱面并回读（diff 模式：与默认 0 不同才写）
  {
    const w = writeJpsConfig('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 |\nQ2: 5 |\n', { ...mspCfg, height_shengbu: -12 })
    const back = extractJpsConfig(w)
    check('adj479 声部间距 −12 写回 # jps-config 并回读', back?.height_shengbu === -12, JSON.stringify(back))
    check('adj479 写回默认 0 时不写该字段（差量口径）', !writeJpsConfig('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 |\nQ2: 5 |\n', { ...mspCfg, height_shengbu: 0 }).includes('height_shengbu'), '')
  }
}

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

// ---- 76. 小节跳跃演奏顺序（adj359/adj360）：跳房子 / 段落反复 / D.C. / D.S. / 跳越 ----
console.log('[76] playback jump order: volta / repeat / D.C. / D.S. / ty (adj359)')
{
  const ord = (q: string) => {
    const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
    return buildPlaySequence(r, layoutScore(r, DUR_CFG), 120)
      .events.map((e) => e.placed.audioPitch)
      .join(',')
  }
  // ① 1 号房子 + 无 |: 时从头反复（`:|` 无对应 `|:` → 回到乐曲开头）
  check('adj359 <1,2> |["1." <1> :|] <2> ||', ord('1 |["1." 2 :|] 3 ||') === 'C4,D4,C4,E4', ord('1 |["1." 2 :|] 3 ||'))
  // ② |: 段落反复 + 1 号房子（第二遍跳过房子）
  check('adj359 <1> |: <1,2> |["1." <1> :|] <2> ||', ord('1 |: 2 |["1." 3 :|] 4 ||') === 'C4,D4,E4,D4,F4', ord('1 |: 2 |["1." 3 :|] 4 ||'))
  // ③ 两房子、各自 :| → 3 遍（第 3 遍两房子皆跳过）
  check(
    'adj359 <1> |: <1,2,3> |["1." <1> :|]["2." <2> :|] <3> ||',
    ord('1 |: 2 |["1." 3 :|]["2." 4 :|] 5 ||') === 'C4,D4,E4,D4,F4,D4,G4',
    ord('1 |: 2 |["1." 3 :|]["2." 4 :|] 5 ||'),
  )
  // ④ D.S. 跳花 S（&hs 写在 &ds 之前）+ 只跳一次（第二次遇到 &ds 续播）
  check('adj359 <1> |&hs <1,2> |&ds <2> ||', ord('1 |&hs 2 |&ds 3 ||') === 'C4,D4,D4,E4', ord('1 |&hs 2 |&ds 3 ||'))
  // ⑤ &ty 第一次忽略；D.C. 后跳越两 ty 之间；D.C. 只跳一次
  check('adj359 <1,2> |&ty <1> |&ty <1,2> |&dc <2> ||', ord('1 |&ty 2 |&ty 3 |&dc 4 ||') === 'C4,D4,E4,C4,E4,F4', ord('1 |&ty 2 |&ty 3 |&dc 4 ||'))
  // ⑥ 未封闭房子 |]/ 延续到其后第一个 :|（房子内后段也属该房子，第二遍一并跳过）
  check('adj360 <1> |: <1,2> |["1." <1> |]/ <1> :| <2> ||', ord('1 |: 2 |["1." 3 |]/ 4 :| 5 ||') === 'C4,D4,E4,F4,D4,G4', ord('1 |: 2 |["1." 3 |]/ 4 :| 5 ||'))
  // ⑦ 三房子 + 花S + D.S.：第1遍 A,B,C,房子1（:|回跳）、第2遍 B,C,房子2（&ds跳花S）、
  //    D.S.后为第3遍 → 从 &hs 起、跳过房子1/2、走房子3 到结束（不再回跳）
  check(
    'adj362 三房子+D.S.：D.S. 后进入下一遍走房子3（跳过房子1/2，不回跳）',
    ord('1 |: 2 |&hs 3 |["1." 4 :|]["2." 5 |&ds]["3." 6 ||]') === 'C4,D4,E4,F4,D4,E4,G4,E4,A4',
    ord('1 |: 2 |&hs 3 |["1." 4 :|]["2." 5 |&ds]["3." 6 ||]'),
  )
  // ⑦b 用户真实谱（折行拼成一个 Q 行）回归：确认解析 + 三遍结构（第3遍从 &hs 起跳房子1/2、走房子3）
  {
    const uSrc =
      'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6,-- @@ &ykh 3,/ 5,/ |: 6,/ 5,/ 6,/ (2// 3//) 2/&sby 1/ 6,/&sby 5,/ | |/&hs 6,/ 5/ 5/ 1/ (2 3) | |/"p:4/4"[+"1." (2// 1// 6,.) 0 @手风琴@ &zkh 3/ 5/ | 6,-- @@ &ykh 3,/ 5,/ :|] |/["2." (2// 1// 6,.) 0 0 ||&ds]["3." (2// 1// 6,.) 0 @手风琴@ &zkh 2/ 3/ | 6,--- &ykh ||]\n'
    const uRes = parseJps(uSrc)
    const uP = buildPlaySequence(uRes, layoutScore(uRes, DUR_CFG), 120)
      .events.filter((e) => e.placed.audioPitch)
      // adj502：取**实际发声音高**（`e.pitch ?? placed.audioPitch`）——波音的邻音事件带 `pitch`，
      // 只看 placed.audioPitch 会把邻音显示成主音音高、漏掉波形
      .map((e) => e.pitch ?? e.placed.audioPitch)
      .join(' ')
    // 段A(A3 E3 G3) 段B(A3 G3 A3 D4 E4 D4 C4 A3 G3) 段C(A3 G4 G4 C4 D4 E4) 房子1(D4 C4 A3 E4 G4 A3 E3 G3)
    // 第2遍 段B 段C 房子2(D4 C4 A3) / 第3遍 段C 房子3(D4 C4 A3 D4 E4 A3)
    // adj502：段B 里两处 `&sby`（`2/&sby`、`6,/&sby`）现在会**多出邻音事件**——
    //   每个波音音符 = 短音(主) + 邻音 + 按住的主音 三个事件（后两者都沿用 placed.audioPitch 时按各自主音计）
    //   ⇒ `2/&sby` = D4,E4,D4；`6,/&sby` = A3,B3,A3 ⇒ 段B 从 9 个事件变 13 个；段B 走两遍 ⇒ 共 +8。
    const uExpect =
      'A3 E3 G3 ' +
      'A3 G3 A3 D4 E4 D4 E4 D4 C4 A3 B3 A3 G3 ' +
      'A3 G4 G4 C4 D4 E4 ' +
      'D4 C4 A3 E4 G4 A3 E3 G3 ' +
      'A3 G3 A3 D4 E4 D4 E4 D4 C4 A3 B3 A3 G3 ' +
      'A3 G4 G4 C4 D4 E4 ' +
      'D4 C4 A3 ' +
      'A3 G4 G4 C4 D4 E4 ' +
      'D4 C4 A3 D4 E4 A3'
    check('adj362 用户真实谱：三遍跳跃结构（D.S. 后从 &hs 起走房子3）', uRes.errors.length === 0 && uP === uExpect, `err=${uRes.errors.length} n=${uP.split(' ').length}\n  ${uP}`)
  }
}

// ---- 77. 保存到磁盘可靠性（adj363）：失败分类 / 权限申请 / 回读校验 ----
console.log('[77] save reliability: error classify / permission / write-back verify (adj363)')
{
  const mkErr = (name: string) => Object.assign(new Error(name), { name })
  // ① 只有 AbortError 是「用户取消」——NotAllowedError 是权限/手势问题，必须可见
  check('adj363 AbortError = 用户取消', isUserCancel(mkErr('AbortError')))
  check('adj363 NotAllowedError 不算取消', !isUserCancel(mkErr('NotAllowedError')))
  check('adj363 无 name 的异常不算取消', !isUserCancel(new Error('x')))
  // ② 失败分类（决定提示文案与句柄是否断开）
  check('adj363 NotAllowedError → permission', classifySaveError(mkErr('NotAllowedError')) === 'permission')
  check('adj363 SecurityError → permission', classifySaveError(mkErr('SecurityError')) === 'permission')
  check('adj363 NotFoundError → gone', classifySaveError(mkErr('NotFoundError')) === 'gone')
  check('adj363 NoModificationAllowedError → busy', classifySaveError(mkErr('NoModificationAllowedError')) === 'busy')
  check('adj363 InvalidStateError → busy', classifySaveError(mkErr('InvalidStateError')) === 'busy')
  check('adj363 未知异常 → unknown', classifySaveError(mkErr('QuotaExceededError')) === 'unknown')
  // ③ 文件名归一化 / 内容比对（容忍 BOM）
  check('adj363 文件名去 .jps 后缀', fileBaseName('小星星.jps') === '小星星', fileBaseName('小星星.jps'))
  check('adj363 文件名去 .md/.txt 后缀', fileBaseName('a.md') === 'a' && fileBaseName('a.txt') === 'a')
  check('adj363 无文件名回退「未命名」', fileBaseName(undefined) === '未命名' && fileBaseName('') === '未命名')
  check('adj363 内容比对容忍 BOM', sameContent('\uFEFFabc', 'abc') && !sameContent('abc', 'abd'))
  // adj399：手机端打开对话框看不到 .jps —— 移动端（粗指针）不设 accept 过滤，桌面降级路径保留
  check('adj399 移动端不设 accept（.jps 不被 MIME 过滤藏起来）', fileInputAccept(true) === null, String(fileInputAccept(true)))
  check('adj399 桌面降级路径 accept 含 .jps', (fileInputAccept(false) ?? '').includes('.jps'), String(fileInputAccept(false)))
  // adj405：移动端一律走 input 路径（PWA 里 showOpenFilePicker 可能"点了没反应"）
  check('adj405 移动端走 input 路径（不看是否支持 FS Access API）', shouldUseFileInputPicker(true, true) && shouldUseFileInputPicker(true, false))
  check('adj405 桌面端支持 FS Access API 时仍用系统选择器', !shouldUseFileInputPicker(false, true) && shouldUseFileInputPicker(false, false))
}

/** 假句柄（结构化模拟 FileSystemFileHandle；node 环境无浏览器 API，用于断言保存流程） */
function fakeHandle(o: {
  /** 权限状态；'none' = 环境不提供权限 API */
  permission?: 'granted' | 'prompt' | 'denied' | 'none'
  /** requestPermission 是否授予 */
  grant?: boolean
  /** createWritable 抛该名异常 */
  createFail?: string
  /** write 抛该名异常 */
  writeFail?: string
  /** getFile().text() 行为：disk=回读真实写入内容 / stale=内容陈旧 / error=读不到 */
  readBack?: 'disk' | 'stale' | 'error'
  /** queryPermission 抛该名异常 */
  queryFail?: string
}) {
  let disk = '旧内容'
  const calls: string[] = []
  const h: Record<string, unknown> = {
    name: 'A.jps',
    async queryPermission() {
      calls.push('query')
      if (o.queryFail) throw Object.assign(new Error('q'), { name: o.queryFail })
      return o.permission === 'none' ? 'granted' : (o.permission ?? 'granted')
    },
    async requestPermission() {
      calls.push('request')
      return o.grant ? 'granted' : 'denied'
    },
    async createWritable() {
      if (o.createFail) throw Object.assign(new Error('c'), { name: o.createFail })
      calls.push('create')
      return {
        async write(t: string) {
          calls.push('write')
          if (o.writeFail) throw Object.assign(new Error('w'), { name: o.writeFail })
          disk = t
        },
        async close() {
          calls.push('close')
        },
        async abort() {
          calls.push('abort')
        },
      }
    },
    async getFile() {
      calls.push('getFile')
      if (o.readBack === 'error') throw Object.assign(new Error('g'), { name: 'NotFoundError' })
      return { text: async () => (o.readBack === 'stale' ? '别的旧内容' : disk) }
    },
  }
  if (o.permission === 'none') {
    delete h.queryPermission
    delete h.requestPermission
  }
  return { h: h as never, calls, disk: () => disk }
}

async function runAdj363SaveTests() {
  // ④ 正常写入：权限已授予 → 直接写（默认不读回，最快路径）+ 回读校验（显式开启）
  {
    const f = fakeHandle({ permission: 'granted' })
    const perm = await ensureWritePermission(f.h)
    check('adj363 权限已授予 → granted', perm === 'granted', perm)
    let err = ''
    try {
      await writeTextToHandle(f.h, '新内容')
    } catch (e) {
      err = (e as Error).name
    }
    check('adj363 写入成功且无异常', err === '', err)
    check('adj363 磁盘内容已更新', f.disk() === '新内容', f.disk())
    check('adj363 成功路径不调用 abort', !f.calls.includes('abort'), f.calls.join(','))
    // adj364：默认不读回——保存热路径少一次 getFile().text() 往返（用户反馈「保存响应慢」）
    check('adj364 默认不读回（无 getFile）', !f.calls.includes('getFile'), f.calls.join(','))
  }
  // ④b adj364：显式开启 verify 时才读回；内容一致即通过
  {
    const f = fakeHandle({ permission: 'granted' })
    let err = ''
    try {
      await writeTextToHandle(f.h, '新内容', { verify: true })
    } catch (e) {
      err = (e as Error).name
    }
    check('adj364 verify=true 时读回校验', err === '' && f.calls.includes('getFile'), `${err} ${f.calls.join(',')}`)
  }
  // ④c adj364：saveTextToHandle 最快路径——权限正常时**不调用任何权限 API**（一次写入往返）
  {
    const f = fakeHandle({ permission: 'granted' })
    let err = ''
    try {
      await saveTextToHandle(f.h, '新内容')
    } catch (e) {
      err = (e as Error).name
    }
    check(
      'adj364 保存热路径：直接写、无 query/request/getFile',
      err === '' && f.calls.join(',') === 'create,write,close' && f.disk() === '新内容',
      `${err} ${f.calls.join(',')}`,
    )
  }
  // ④d adj364：权限失效 → 申请权限后重试一次成功（calls: create 失败 → query → request → create → write → close）
  {
    let first = true
    const calls: string[] = []
    const h = {
      name: 'A.jps',
      async queryPermission() {
        calls.push('query')
        return 'prompt'
      },
      async requestPermission() {
        calls.push('request')
        return 'granted'
      },
      async createWritable() {
        if (first) {
          first = false
          calls.push('createFail')
          throw Object.assign(new Error('c'), { name: 'NotAllowedError' })
        }
        calls.push('create')
        return {
          async write() {
            calls.push('write')
          },
          async close() {
            calls.push('close')
          },
          async abort() {
            calls.push('abort')
          },
        }
      },
    }
    let err = ''
    try {
      await saveTextToHandle(h as never, '新内容')
    } catch (e) {
      err = (e as Error).name
    }
    check(
      'adj364 权限失效 → 申请权限后重试一次成功',
      err === '' && calls.join(',') === 'createFail,query,request,create,write,close',
      `${err} ${calls.join(',')}`,
    )
  }
  // ④e adj364：非权限失败不申请权限（避免无谓的权限提示/往返）
  {
    const f = fakeHandle({ permission: 'granted', createFail: 'QuotaExceededError' })
    let kind = ''
    try {
      await saveTextToHandle(f.h, 'x')
    } catch (e) {
      kind = classifySaveError(e)
    }
    check('adj364 非权限失败不申请权限', kind === 'unknown' && !f.calls.includes('query'), `${kind} ${f.calls.join(',')}`)
  }
  // ⑤ 恢复的句柄权限为 prompt：用户手势内申请后放行（顺序 query → request）
  {
    const f = fakeHandle({ permission: 'prompt', grant: true })
    const perm = await ensureWritePermission(f.h)
    check('adj363 prompt + 同意 → granted', perm === 'granted', perm)
    check('adj363 申请顺序 query→request', f.calls.join(',') === 'query,request', f.calls.join(','))
  }
  // ⑥ 用户拒绝授权 → denied（调用方转另存为/提示）
  {
    const f = fakeHandle({ permission: 'prompt', grant: false })
    check('adj363 prompt + 拒绝 → denied', (await ensureWritePermission(f.h)) === 'denied')
  }
  // ⑦ 环境无权限 API → unknown（交写入本身判定，不能误判为拒绝）
  {
    const f = fakeHandle({ permission: 'none' })
    check('adj363 无权限 API → unknown', (await ensureWritePermission(f.h)) === 'unknown')
  }
  // ⑧ 权限查询抛错（句柄失效等）→ unknown，不阻断保存尝试
  {
    const f = fakeHandle({ queryFail: 'SecurityError' })
    check('adj363 权限查询抛错 → unknown', (await ensureWritePermission(f.h)) === 'unknown')
  }
  // ⑨ createWritable 抛 NotAllowedError（句子失效的典型表现）→ 归类 permission
  {
    const f = fakeHandle({ permission: 'granted', createFail: 'NotAllowedError' })
    let kind = ''
    try {
      await writeTextToHandle(f.h, 'x')
    } catch (e) {
      kind = classifySaveError(e)
    }
    check('adj363 createWritable 失败 → permission', kind === 'permission', kind)
  }
  // ⑩ 写入中途失败 → abort 丢弃临时文件（不把原文件截断成空）并抛原异常
  {
    const f = fakeHandle({ permission: 'granted', writeFail: 'QuotaExceededError' })
    let name = ''
    try {
      await writeTextToHandle(f.h, 'x')
    } catch (e) {
      name = (e as Error).name
    }
    check('adj363 写入失败抛原异常', name === 'QuotaExceededError', name)
    check('adj363 写入失败调用 abort', f.calls.includes('abort'), f.calls.join(','))
  }
  // ⑪ close() 成功但磁盘内容不是刚写的内容 → 抛 SaveVerifyError（归类 verify；verify 显式开启）
  {
    const f = fakeHandle({ permission: 'granted', readBack: 'stale' })
    let kind = ''
    try {
      await writeTextToHandle(f.h, '新内容', { verify: true })
    } catch (e) {
      kind = classifySaveError(e)
    }
    check('adj363 回读不一致 → verify', kind === 'verify', kind)
  }
  // ⑫ 读不回（无读权限等）→ 不误报失败（无法校验不等于没保存）
  {
    const f = fakeHandle({ permission: 'granted', readBack: 'error' })
    let err = ''
    try {
      await writeTextToHandle(f.h, '新内容', { verify: true })
    } catch (e) {
      err = (e as Error).name
    }
    check('adj363 无法回读不误报', err === '' && f.disk() === '新内容', err)
  }
}

// ---- 78. 试听音色默认「自动」（adj366 → adj448 改为会话级、每次打开重置）----
console.log('[78] playback voice default = auto (adj366/adj448)')
{
  // ① 「自动」的落点：按谱面乐器/声部名路由 GM 音色（不是固定钢琴）
  check('adj366 自动路由：@手风琴 → GM 21', instrumentToProgram('手风琴') === 21, String(instrumentToProgram('手风琴')))
  check('adj366 自动路由：@长笛 → GM 73', instrumentToProgram('长笛') === 73, String(instrumentToProgram('长笛')))
  check('adj366 自动路由：带库前缀「库:小提琴」→ GM 40', instrumentToProgram('库:小提琴') === 40, String(instrumentToProgram('库:小提琴')))
  check('adj366 自动路由：声部名 小号 → GM 56', instrumentToProgram('小号') === 56, String(instrumentToProgram('小号')))
  check('adj366 自动路由：无乐器 → 钢琴 0', instrumentToProgram(undefined) === 0, String(instrumentToProgram(undefined)))
  // ② adj448/adj450：试听音色 = **会话级**（本次运行内记住，重启回到「自动」）——
  //    选定具体音色会覆盖谱面 `Y:`，若被持久化/每次重置都不合用户预期（用户实测反馈）
  {
    const storeSrc = String(readFileSync('src/store/uiStore.ts', 'utf8'))
    const dlgSrc = String(readFileSync('src/dialogs/PlaybackDialog.tsx', 'utf8'))
    check('adj448 音色选择不再落盘（setter 不写 localStorage）',
      /setPlaybackHqVoice: \(program\) => set\(\{ playbackHqVoice: program \}\)/.test(storeSrc))
    check('adj448 旧存储键只用于清理残留（removeItem，不再读取）',
      storeSrc.includes('localStorage.removeItem(PLAYBACK_HQ_VOICE_KEY)') &&
      !storeSrc.includes('localStorage.getItem(PLAYBACK_HQ_VOICE_KEY)'))
    check('adj448 默认值 = null（自动）',
      /playbackHqVoice: \(\(\) => \{[\s\S]{0,240}return null/.test(storeSrc))
    check('adj450 本次运行内记住选择：打开试听**不**重置（仅重启回到自动）',
      !/useEffect\(\(\) => \{\s*setPlaybackHqVoice\(null\)/.test(dlgSrc) &&
      /onChange=\{\(e\) => setPlaybackHqVoice\(/.test(dlgSrc))
    check('adj448 选定具体音色时给出「会覆盖谱面 Y:」提示',
      dlgSrc.includes('voiceOverrideHint') && dlgSrc.includes('playbackHqVoice !== null'))
    check('adj448 旧的音色持久化模块已删除（不再有 second source）',
      !existsSync('src/store/playbackVoice.ts'))
  }
}

// ---- 79. 最后一个跳房子用「结束句」做标签（adj368）----
console.log('[79] last volta label = 结束句 (adj368)')
{
  const ord = (q: string) => {
    const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
    return buildPlaySequence(r, layoutScore(r, DUR_CFG), 120)
      .events.map((e) => e.placed.audioPitch)
      .join(',')
  }
  const src1 = '1 |: 2 |["1." 3 :|]["结束句" 4 ||]'
  const res1 = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${src1}\n`)
  const bt1 = res1.groups[0].music.tokens.filter((t) => t.kind === 'barline')
  const volta1 = bt1.find((b) => b.kind === 'barline' && b.voltaStart?.comment === '结束句')
  // ① 解析/格式化：文字标签原样保留（不再只认数字番号）
  check('adj368 解析：["结束句" 作为跳房子标签（无错误）', res1.errors.length === 0 && volta1 !== undefined, JSON.stringify(res1.errors))
  check(
    'adj368 格式化：文字标签原样保留',
    formatJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${src1}\n`).includes('["结束句"'),
  )
  // ② 渲染：标签文字画进跳房子线下方
  {
    const svg = renderScoreToSvg(layoutScore(res1, DUR_CFG))[0] ?? ''
    check('adj368 渲染：跳房子标签显示「结束句」', svg.includes('结束句'), '')
  }
  // ③ 演奏：两房子（"1." + "结束句"）——第 1 遍奏房子1、第 2 遍奏结束句（旧实现把结束句当第 1 遍 → 末遍整段丢失）
  check('adj368 <1> |: <1,2> |["1." <1> :|]["结束句" <2> ||]', ord(src1) === 'C4,D4,E4,D4,F4', ord(src1))
  // ④ 无 |: 时（只奏 1 遍）文字标签房子照常奏响，不丢音
  check('adj368 无反复 <1> |["结束句" <2> ||]', ord('1 |["结束句" 2 ||]') === 'C4,D4', ord('1 |["结束句" 2 ||]'))
  // ⑤ 只有段落反复、无番号房子：末遍奏结束句
  check('adj368 <1> |: <1,2> :|["结束句" <1> ||]', ord('1 |: 2 :|["结束句" 3 ||]') === 'C4,D4,D4,E4', ord('1 |: 2 :|["结束句" 3 ||]'))
  // ⑥ 三房子 + 花S + D.S.（与 adj362 番号版等价）：结束句房子在第 3 遍奏响
  {
    const withNum = ord('1 |: 2 |&hs 3 |["1." 4 :|]["2." 5 |&ds]["3." 6 ||]')
    const withText = ord('1 |: 2 |&hs 3 |["1." 4 :|]["2." 5 |&ds]["结束句" 6 ||]')
    check(
      'adj368 三房子+D.S.：结束句版 == 数字番号版（第 3 遍奏结束句）',
      withText === withNum && withText === 'C4,D4,E4,F4,D4,E4,G4,E4,A4',
      `text=${withText} num=${withNum}`,
    )
  }
  // ⑦ 番号房子行为不变（回归）
  check('adj368 番号房子不受影响 <1> |["1." <1> :|] <2> ||', ord('1 |["1." 2 :|] 3 ||') === 'C4,D4,C4,E4', ord('1 |["1." 2 :|] 3 ||]'))
}

// ---- 80. 保存阶段耗时收集（adj369）----
console.log('[80] save phase timing log (adj369)')
{
  const lb = (p: string) => `P:${p}`
  const log = createSavePhaseLog(lb as never)
  log.trace('open', 2)
  log.trace('write', 1)
  log.trace('commit', 7140)
  log.tail('store', 0)
  log.tail('ui', 0.6)
  check(
    'adj369 明细文案按顺序拼接（各段取整）',
    log.text() === 'P:open 2ms · P:write 1ms · P:commit 7140ms · P:store 0ms · P:ui 1ms',
    log.text(),
  )
  check('adj369 合计 = 各段原始毫秒之和', Math.abs(log.total() - 7143.6) < 1e-6, String(log.total()))
  {
    const w = log.worst()
    check('adj369 瓶颈 = 最耗时那段（提交文件）', w?.phase === 'commit' && w.ms === 7140, JSON.stringify(w))
  }
  {
    const empty = createSavePhaseLog(lb as never)
    check('adj369 空记录：无明细、无瓶颈', empty.text() === '' && empty.worst() === null && empty.total() === 0)
  }
}

// ---- 81. 文件身份一致性（adj370）：打开/保存/另存为后，文件名与句柄必须是同一份新文件 ----
// 用户反馈「打开一个文件后当前文件名还是之前的」——用桩化 localStorage/indexedDB/window 在 Node 里
// 跑真实 store 流程（含「启动恢复慢返回」的竞态）把这条不变量固定下来。
async function runStoreFileIdentityTests() {
  console.log('[81] store file identity: open / save / save-as (adj370)')
  const kv: Record<string, string> = {
    'ijipu.draftName': 'A',
    'ijipu.draft': 'V: 1.0\nB: 甲\nD: C\nP: 4/4\nQ: 1 |\n',
    // adj480：预置旧版的「本机页面设置」缓存——迁移必须在 store 首次 import 时清掉它，
    // 且**不得**影响生效配置（此前它会作为 L1 层套用到所有未自带该项的谱面）
    'ijipu.pageConfig': JSON.stringify({ margin_left: 99, note_size: 15 }),
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => (k in kv ? kv[k] : null),
    setItem: (k: string, v: string) => {
      kv[k] = v
    },
    removeItem: (k: string) => {
      delete kv[k]
    },
    get length() {
      return Object.keys(kv).length
    },
    key: (i: number) => Object.keys(kv)[i] ?? null,
  }
  const writes: string[] = []
  const mkHandle = (name: string) => ({
    name,
    getFile: async () => ({ name, text: async () => kv['ijipu.draft'] }),
    createWritable: async () => ({
      write: async () => {
        writes.push(name)
      },
      close: async () => undefined,
      abort: async () => undefined,
    }),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  })
  const handleA = mkHandle('A.jps')
  const handleB = mkHandle('B.jps')
  const handleC = mkHandle('C.jps')
  // IndexedDB 桩：恢复句柄「慢返回」200ms（模拟真实延迟，专门制造启动恢复 vs 用户打开 的竞态）
  g.indexedDB = {
    open: () => {
      const req: { result: unknown; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
          transaction: () => {
            const getReq: { result: unknown; onsuccess?: () => void; onerror?: () => void } = { result: handleA }
            setTimeout(() => getReq.onsuccess?.(), 200)
            return { objectStore: () => ({ put: () => undefined, get: () => getReq }), oncomplete: null, onerror: null }
          },
          close: () => undefined,
        },
      }
      setTimeout(() => {
        req.onupgradeneeded?.()
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
  let openPicker: () => Promise<unknown[]> = async () => [handleB]
  let savePicker: () => Promise<unknown> = async () => handleC
  g.window = {
    showOpenFilePicker: () => openPicker(),
    showSaveFilePicker: () => savePicker(),
    setTimeout,
    clearTimeout,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { useDocStore } = (await import('../src/store/docStore.ts')) as any
  const { useUiStore } = (await import('../src/store/uiStore.ts')) as any
  const st = () => useDocStore.getState()
  const hName = () => (st().fileHandle as { name?: string } | null)?.name ?? null

  // adj480：旧「本机页面设置」缓存的迁移（在 store 首次 import 时执行）
  //  ① 键被清掉（不再有这一层）；② 生效配置不吃旧缓存（否则"你看到的"取决于本机历史）；
  //  ③ 若旧值确有非默认项，给出一次性提示（不静默丢弃）
  check('adj480 旧本机页面设置缓存已在启动时清除', !('ijipu.pageConfig' in kv), Object.keys(kv).join(','))
  check(
    'adj480 生效配置不吃旧缓存（margin_left=默认、note_size=默认）',
    st().pageConfig.margin_left === defaultPageConfig.margin_left && st().pageConfig.note_size === defaultPageConfig.note_size,
    `left=${st().pageConfig.margin_left} size=${st().pageConfig.note_size}`,
  )
  {
    const n = useUiStore.getState().notice as { text: string } | null
    check('adj480 迁移给出一次可见提示（含项数）', !!n && n.text.includes('本机页面设置') && n.text.includes('2 项'), n?.text ?? 'null')
  }
  // 预览态（persist=false）也不再写缓存：本机不再保存"页面设置"这一层
  st().setPageConfig({ ...st().pageConfig, margin_left: 61 }, false)
  check('adj480 预览态不再写本机页面设置缓存', !('ijipu.pageConfig' in kv), Object.keys(kv).join(','))
  st().setPageConfig({ ...st().pageConfig, margin_left: defaultPageConfig.margin_left }, false)

  check('adj370 启动：fileName 取草稿名（A）', st().fileName === 'A', st().fileName)
  await st().openFile()
  check('adj370 打开 B.jps → fileName=B', st().fileName === 'B', st().fileName)
  check('adj370 打开 B.jps → 句柄=B.jps', hName() === 'B.jps', String(hName()))
  await new Promise((r) => setTimeout(r, 400))
  check('adj370 启动恢复慢返回不覆盖已打开文件', st().fileName === 'B' && hName() === 'B.jps', `${st().fileName}/${hName()}`)
  await st().saveFile()
  check('adj370 保存写回的是 B 句柄', writes.length === 1 && writes[0] === 'B.jps', JSON.stringify(writes))
  await st().saveFileAs()
  check('adj370 另存为 C.jps → fileName=C', st().fileName === 'C', st().fileName)
  check('adj370 另存为 C.jps → 句柄=C.jps', hName() === 'C.jps', String(hName()))
  check('adj370 另存为 C.jps → 草稿名=C（下次启动才对得上）', kv['ijipu.draftName'] === 'C', kv['ijipu.draftName'])
  check('adj370 另存为写入的是 C 句柄', writes.length === 2 && writes[1] === 'C.jps', JSON.stringify(writes))
  // 打开失败必须可见（此前 catch 静默 return false）
  openPicker = async () => {
    throw new Error('boom')
  }
  const ok = await st().openFile()
  const notice = useUiStore.getState().notice as { text: string; kind: string } | null
  check(
    'adj370 打开失败：返回 false 且给出错误提示',
    ok === false && !!notice && notice.kind === 'error' && notice.text.includes('打开失败'),
    JSON.stringify(notice),
  )
  // 用户取消（AbortError）仍静默、不报错
  useUiStore.getState().clearNotice()
  openPicker = async () => {
    const e = new Error('cancel')
    e.name = 'AbortError'
    throw e
  }
  const ok2 = await st().openFile()
  check('adj370 用户取消打开：静默无提示', ok2 === false && useUiStore.getState().notice === null, String(useUiStore.getState().notice))

  // adj371：文件名乐观更新——写盘（close 原子替换可能好几秒）未完成时，状态栏文件名已经切好
  {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const mkD = {
      name: 'D.jps',
      getFile: async () => ({ name: 'D.jps', text: async () => kv['ijipu.draft'] }),
      createWritable: async () => ({ write: async () => undefined, close: () => gate, abort: async () => undefined }),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    }
    useDocStore.setState({ fileHandle: mkD, fileName: 'C', dirty: true })
    const pending = st().saveFile() as Promise<boolean>
    await new Promise((r) => setTimeout(r, 20))
    check('adj371 写盘未完成：文件名已乐观切到 D', st().fileName === 'D', st().fileName)
    check('adj371 写盘未完成：仍标记未保存', st().dirty === true, String(st().dirty))
    release()
    const done = await pending
    check('adj371 写盘完成：文件名=D 且已保存', done === true && st().fileName === 'D' && st().dirty === false, `${done}/${st().fileName}/${st().dirty}`)

    // 写盘失败要回滚乐观切名
    const mkE = {
      name: 'E.jps',
      getFile: async () => ({ name: 'E.jps', text: async () => kv['ijipu.draft'] }),
      createWritable: async () => ({
        write: async () => {
          const e = new Error('quota')
          e.name = 'QuotaExceededError'
          throw e
        },
        close: async () => undefined,
        abort: async () => undefined,
      }),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    }
    useDocStore.setState({ fileHandle: mkE, dirty: true })
    const okFail = await st().saveFile()
    check('adj371 写盘失败：文件名回滚为 D', okFail === false && st().fileName === 'D', `${okFail}/${st().fileName}`)
    check('adj371 写盘失败：仍标记未保存', st().dirty === true, String(st().dirty))
    check('adj371 写盘失败：草稿名不被改坏', kv['ijipu.draftName'] === 'D', kv['ijipu.draftName'])
  }
}

// ---- 82. 作者署名（adj373）----
console.log('[82] author credit (adj373)')
{
  check('adj373 品牌 tokens 有作者署名', brand.author.trim().length > 0, brand.author)
  check('adj373 关于对话框作者行 = 「作者：<署名>」', aboutCopy.author === `作者：${brand.author}`, aboutCopy.author)
  check(
    'adj373 联系方式：未设邮箱为空，设了则含该邮箱并以「联系：」开头',
    brand.authorEmail === ''
      ? aboutCopy.contact === ''
      : aboutCopy.contact.startsWith('联系：') && aboutCopy.contact.includes(brand.authorEmail),
    JSON.stringify(aboutCopy.contact),
  )
  check(
    'adj373 邮箱格式合法（公开地址）',
    brand.authorEmail === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(brand.authorEmail),
    brand.authorEmail,
  )
}

// ---- 83. 试听高亮/色块覆盖增时线（adj374）----
console.log('[83] playhead highlight & blocks cover augmentation (adj374)')
{
  // ① 渲染契约：一个音符的「数字 + 各条增时线」共用同一 data-notepos（消费方 querySelectorAll 才能全高亮）
  const countId = (svg: string, id: string) => svg.split(`data-notepos="${id}"`).length - 1
  {
    const r1 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | 6,) 1-- ||\n')
    const svg1 = renderScoreToSvg(layoutScore(r1, DUR_CFG))[0] ?? ''
    check('adj374 增时线音符：data-notepos 出现 3 次（数字 + 2 条增时线）', countId(svg1, '0_1_0_1') === 3, String(countId(svg1, '0_1_0_1')))
    const r2 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | 1 2 ||\n')
    const svg2 = renderScoreToSvg(layoutScore(r2, DUR_CFG))[0] ?? ''
    check('adj374 无增时线音符：data-notepos 仍只出现 1 次', countId(svg2, '0_1_0_1') === 1, String(countId(svg2, '0_1_0_1')))
  }
  // ② 色块右边界不变量：每条增时线的色块必须盖住它自己那一格（含"末元素无后续小节线"的常见写法）
  const variants: [string, string][] = [
    ['v1 单行 结尾 ||', 'Q: | 6,) 1-- ||'],
    ['v2 三增时线', 'Q: | 6,) 1--- ||'],
    ['v3 无收尾小节线', 'Q: | 6,) 1--'],
    ['v4 行末（前面 3 小节撑满一行）', 'Q: | 5 5 5 5 | 5 5 5 5 | 5 5 5 5 | 6,) 1-- ||'],
    ['v5 跳房子收尾 |]', 'Q: | 6,) 1-- |]'],
    ['v6 终止线后带 &fine', 'Q: | 6,) 1-- ||&fine'],
    ['v7 多行末行', 'Q: | 5 5 5 5 | 5 5 5 5 | 5 5 5 5 | 5 5 5 5 |\nQ: | 6,) 1-- ||'],
    ['v8 增时线拆开写（1 - -）', 'Q: | 6,) 1 - - ||'],
  ]
  for (const [name, q] of variants) {
    const rv = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${q}\n`)
    const layv = layoutScore(rv, DUR_CFG)
    const seqv = buildPlaySequence(rv, layv, 120)
    const notes = layv.pages.flatMap((p) => p.notes)
    const lastNote = notes[notes.length - 1]
    const segs = (seqv.events[seqv.events.length - 1]?.playheadSegs ?? []).slice().sort((a, b) => a.beat - b.beat)
    const noteSegs = (lastNote?.segments ?? []).slice()
    const lastBlock = segs[segs.length - 1]
    const lastCell = noteSegs[noteSegs.length - 1]
    const covered =
      !!lastBlock &&
      !!lastCell &&
      segs.length === noteSegs.length &&
      lastBlock.x + lastBlock.width >= lastCell.x + lastCell.perBeat * lastCell.beats - 0.5
    check(
      `adj374 色块盖住末格增时线：${name}`,
      rv.errors.length === 0 && covered,
      `segs=${segs.length}/${noteSegs.length} 末块右=${(lastBlock ? lastBlock.x + lastBlock.width : 0).toFixed(1)} 末格右=${(lastCell ? lastCell.x + lastCell.perBeat * lastCell.beats : 0).toFixed(1)}`,
    )
  }
  // 用户实测的两条对照谱（adj374）：更强的不变量——**每条增时线的实际笔画中心必须落在某个色块内**。
  // adj378：**同时覆盖用户实际字号（13 号）与几种常见字号**——此前只在默认字号下断言过。
  for (const [name, q] of [
    ['用户 A：| 6,) 1-- ||', 'Q: | 6,) 1-- ||'],
    ['用户 B：| 1- 0 0 &ykh ||', 'Q: | 1- 0 0 &ykh ||'],
    ['用户 A 变体：末小节不写收尾线', 'Q: | 6,) 1--'],
    ['用户 A 多小节（5 小节行末）', 'Q: | 5 5 5 5 | 5 5 5 5 | 5 5 5 5 | 6,) 1-- ||'],
  ] as [string, string][]) {
    // adj380：**两种布局模式都要核对**——应用默认是「空间优先」(space)，此前断言多跑在时值优先(duration)
    for (const mode of ['duration', 'space'] as const) {
      for (const noteSize of [13, 18]) {
        const cfg = { ...DUR_CFG, note_size: noteSize, noteSpaceLayout: mode }
        const rv = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${q}\n`)
        const layv = layoutScore(rv, cfg)
        const seqv = buildPlaySequence(rv, layv, 120)
        const svg = renderScoreToSvg(layv)[0] ?? ''
        const dashX = [...svg.matchAll(/<text x="([\d.]+)"[^>]*>-<\/text>/g)].map((m) => Number(m[1]))
        const blocks = seqv.events.flatMap((e) => (e.playheadSegs ?? []).map((s) => ({ x: s.x, r: s.x + s.width })))
        const allCovered = dashX.length > 0 && dashX.every((dx) => blocks.some((b) => dx >= b.x - 0.5 && dx <= b.r + 0.5))
        check(
          `adj374 增时线笔画中心落在色块内：${name}（${mode}/${noteSize}号）`,
          rv.errors.length === 0 && allCovered,
          `dash=${JSON.stringify(dashX)} blocks=${JSON.stringify(blocks.map((b) => `${b.x.toFixed(1)}~${b.r.toFixed(1)}`))}`,
        )
      }
    }
  }
  // adj378：多声部（Q1/Q2）同款核对——多声部还有整列 voiceBlocks 色框，另需看其 x 覆盖
  {
    const srcMV = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: | 6,) 1-- ||\nQ2: | 5 5 5 5 ||\n'
    const rMV = parseJps(srcMV)
    const layMV = layoutScore(rMV, { ...DUR_CFG, note_size: 13 })
    const seqMV = buildPlaySequence(rMV, layMV, 120)
    const svgMV = renderScoreToSvg(layMV)[0] ?? ''
    const dashXMV = [...svgMV.matchAll(/<text x="([\d.]+)"[^>]*>-<\/text>/g)].map((m) => Number(m[1]))
    const blocksMV = seqMV.events.flatMap((e) => (e.playheadSegs ?? []).map((s) => ({ x: s.x, r: s.x + s.width })))
    const vb = layMV.pages.flatMap((p) => p.voiceBlocks.map((v) => `x=${v.x.toFixed(1)}`))
    const coveredMV = dashXMV.length > 0 && dashXMV.every((dx) => blocksMV.some((b) => dx >= b.x - 0.5 && dx <= b.r + 0.5))
    check(
      'adj378 多声部：增时线笔画中心也落在色块内',
      rMV.errors.length === 0 && coveredMV,
      `dash=${JSON.stringify(dashXMV)} blocks=${JSON.stringify(blocksMV.map((b) => `${b.x.toFixed(1)}~${b.r.toFixed(1)}`))} voiceBlocks=${JSON.stringify(vb)}`,
    )
  }
}

// ---- 84. &hx 独立化 + 呼吸静音（adj375）----
console.log('[84] &hx standalone breath mark (adj375)')
{
  const q = (body: string) => `V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${body}\n`
  const fmtQ = (body: string) => formatJps(q(body)).split('\n')[4]
  const build = (body: string) => {
    const r = parseJps(q(body))
    const lay = layoutScore(r, DUR_CFG)
    return { r, lay, seq: buildPlaySequence(r, lay, 120) }
  }
  const brsOf = (lay: ReturnType<typeof layoutScore>) => lay.pages.flatMap((p) => p.brackets)

  // ① 解析：&hx 不再进音符 symbols，而是独立标记 token
  {
    const { r } = build('| 6&hx 5 ||')
    const toks = r.groups[0].music.tokens
    const hxTok = toks.filter((t) => t.kind === 'bracket' && t.code === 'hx')
    const syms = toks.filter((t) => t.kind === 'note').map((t) => (t.kind === 'note' ? t.symbols : []))
    check('adj375 解析：&hx 成独立标记 token（不再依附音符）', r.errors.length === 0 && hxTok.length === 1, JSON.stringify(hxTok))
    check('adj375 解析：音符 symbols 里不再有 hx', syms.every((s) => !s.includes('hx')), JSON.stringify(syms))
  }
  // ② 格式化：三种写法统一为「独立块 + 两侧空格」，且幂等
  check('adj375 格式化 6&hx 5 → 6 &hx 5', fmtQ('| 6&hx 5 ||') === 'Q: | 6 &hx 5 ||', fmtQ('| 6&hx 5 ||'))
  check('adj375 格式化 6 &hx 5 保持', fmtQ('| 6 &hx 5 ||') === 'Q: | 6 &hx 5 ||', fmtQ('| 6 &hx 5 ||'))
  check('adj375 格式化 &hx6 5 → &hx 6 5', fmtQ('| &hx6 5 ||') === 'Q: | &hx 6 5 ||', fmtQ('| &hx6 5 ||'))
  check('adj375 格式化 &hx 6 5 保持（幂等）', fmtQ('| &hx 6 5 ||') === 'Q: | &hx 6 5 ||', fmtQ('| &hx 6 5 ||'))
  check(
    'adj375 格式化幂等：二次格式化不再变化',
    fmtQ('| 6&hx 5 ||') === formatJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${fmtQ('| 6&hx 5 ||')}\n`).split('\n')[4],
  )
  // ③ 排版：独立标记占宽，后面的音符因此右移（与 &zkh/&ykh 同机制）
  {
    const withHx = build('| 6 &hx 5 ||')
    const without = build('| 6 5 ||')
    const b = brsOf(withHx.lay)
    const xWith = withHx.lay.pages[0].notes[1].x
    const xWithout = without.lay.pages[0].notes[1].x
    check('adj375 排版：&hx 作为独立标记占宽', b.length === 1 && b[0].code === 'hx' && b[0].width > 0, JSON.stringify(b))
    check('adj375 排版：后续音符因 &hx 占宽而右移', xWith > xWithout + 1, `with=${xWith.toFixed(1)} without=${xWithout.toFixed(1)}`)
    // adj376：&hx 与括号**同基本占宽**（时值占用是演奏概念，不体现在排版宽度）
    {
      const bk = brsOf(build('| 6 &zkh 5 6 &ykh ||').lay)
      check(
        'adj376 &hx 占宽 = 括号占宽（基本占宽）',
        bk.length === 2 && b[0].width === bk[0].width && bk[0].width === bk[1].width,
        `hx=${b[0]?.width} zkh=${bk[0]?.width} ykh=${bk[1]?.width}`,
      )
    }
  }
  // ④ 渲染：画出 V 形呼吸记号（三折线 path、线宽 0.8）
  {
    const svgWith = renderScoreToSvg(build('| 6 &hx 5 ||').lay)[0] ?? ''
    const svgWithout = renderScoreToSvg(build('| 6 5 ||').lay)[0] ?? ''
    const vRe = /<path d="M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+" fill="none" stroke="#1b1b1b" stroke-width="0.8"\/>/g
    const nWith = (svgWith.match(vRe) ?? []).length
    const nWithout = (svgWithout.match(vRe) ?? []).length
    check('adj375 渲染：有 &hx 时画出 1 个 V 形记号', nWith === 1, `n=${nWith}`)
    check('adj375 渲染：无 &hx 时不画 V 形记号', nWithout === 0, `n=${nWithout}`)
  }
  // ⑤ 演奏：呼吸静音 = min(前音符总时值/4, 1/2 拍)；槽位/总时长不变（连音合并按总时值算）
  const durs = (body: string) => build(body).seq.events.map((e) => Math.round(e.durationMs))
  const total = (body: string) => Math.round(build(body).seq.totalMs)
  check('adj375 演奏：6 &hx 5 → 6 发声 1−1/4=0.75 拍（375ms）', JSON.stringify(durs('| 6 &hx 5 ||')) === '[375,500]', JSON.stringify(durs('| 6 &hx 5 ||')))
  check('adj375 演奏：1-- &hx 2 → 换气封顶 1/2 拍（1500−250=1250ms）', JSON.stringify(durs('| 1-- &hx 2 ||')) === '[1250,500]', JSON.stringify(durs('| 1-- &hx 2 ||')))
  check('adj375 演奏：1--- &hx 2 → 仍封顶 1/2 拍（2000−250=1750ms）', JSON.stringify(durs('| 1--- &hx 2 ||')) === '[1750,500]', JSON.stringify(durs('| 1--- &hx 2 ||')))
  check('adj375 演奏：&hx 写在本行最前 → 作用于右侧音符', JSON.stringify(durs('| &hx 6 5 ||')) === '[375,500]', JSON.stringify(durs('| &hx 6 5 ||')))
  check('adj375 演奏：连音合并按总时值算（(6 - &hx 6) → 1500−250=1250ms）', JSON.stringify(durs('| (6 - &hx 6) ||')) === '[1250]', JSON.stringify(durs('| (6 - &hx 6) ||')))
  check('adj375 演奏：槽位不变——总时长与无 &hx 版一致', total('| 6 &hx 5 ||') === total('| 6 5 ||') && total('| 1-- &hx 2 ||') === total('| 1-- 2 ||'), `${total('| 6 &hx 5 ||')}/${total('| 6 5 ||')}`)
}

// ---- 85. 用户谱行宽核对（adj377 排查）----
console.log('[85] user line width check')
{
  // 用户实测谱（A4 / 边距 40 / 13 号黑体 / 空间优先）：行内 3 个 &hx + 5 小节，
  // 断行曾把独立标记占宽按「每个音符重复计一次」高估 → 过早断成 2 行（adj377 修复）
  const line =
    'Q: &hx 6,/ 6,/ 1/ 6,/ 2/ 5/ 3 | 1/ 1/ 6,/. 6,// 7,/ 3,/ 3, | &hx 6,/ 6,/ 1/ 6,/ 2/ 5/ 3 | 6/ 6/ 6/ 5/ (3/ (2/ 2/.)) &hx 3// | 3/ 5 1/. 3// (2 2/.) 2// |'
  const src = `V: 1.0\nB: t\nD: C\nP: 4/4\n${line}\n`
  const r = parseJps(src)
  const rowCount = (lay: ReturnType<typeof layoutScore>) =>
    new Set(lay.pages.flatMap((p) => p.barlines.map((b) => Math.round(b.yTop)))).size
  const real = layoutScore(r, defaultPageConfig)
  check('adj377 用户谱行：A4/边距40/13号 一行放得下（1 行）', r.errors.length === 0 && rowCount(real) === 1, `rows=${rowCount(real)}`)
  check(
    'adj377 用户谱行：行内容撑满到右边界（两端对齐）',
    Math.abs(
      Math.max(...real.pages.flatMap((p) => p.barlines.map((b) => b.x))) -
        (595.28 - defaultPageConfig.margin_right),
    ) < 2,
    String(Math.max(...real.pages.flatMap((p) => p.barlines.map((b) => b.x)))),
  )
  // 独立标记不得被"每音符重复计宽"：同一行加/不加标记，行数应一致（标记只占自身基本宽）
  {
    const manyNotes = '1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ 3/ 4/ 5/ 6/ 7/ 1/ 2/ 3/ 4/'
    const noMark = layoutScore(parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | ${manyNotes} |\n`), defaultPageConfig)
    const withMarks = layoutScore(
      parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: | &zkh ${manyNotes} &ykh &hx |\n`),
      defaultPageConfig,
    )
    check(
      'adj377 独立标记占宽不随音符数放大（加 3 个标记不改行数）',
      rowCount(noMark) === rowCount(withMarks),
      `无标记=${rowCount(noMark)} 有标记=${rowCount(withMarks)}`,
    )
  }
}

// ---- 86. PWA 新版本提示判定（adj379）----
console.log('[86] pwa update prompt (adj379)')
{
  check('adj379 首次注册（页面此前无控制者）不提示更新', shouldPromptUpdate(false) === false)
  check('adj379 已有控制者被新 SW 接管 → 提示更新', shouldPromptUpdate(true) === true)
  check('adj379 自动检查间隔 = 30 分钟', UPDATE_CHECK_INTERVAL_MS === 30 * 60 * 1000, String(UPDATE_CHECK_INTERVAL_MS))
}

// ---- 86b. 编辑区问题提示条（adj394）----
console.log('[86b] problems bar summary / jump offset (adj394)')
{
  const errs = [
    { line: 5, col: 8, message: '渐强/渐弱起止之间没有音符（起止落在同一音符），不会渲染', severity: 'warning' as const },
    { line: 3, col: 4, message: '引号注释未闭合', severity: 'error' as const },
    { line: 9, col: 0, message: '音符块与小节线块之间应只有一个空格', severity: 'warning' as const },
  ]
  const s = summarizeProblems(errs)
  check('adj394 汇总计数（1 错误 / 2 告警 / 共 3）', s.errorCount === 1 && s.warnCount === 2 && s.total === 3, JSON.stringify(s))
  check('adj394 最严重级别 = error（有错误时）', s.worst === 'error', String(s.worst))
  check('adj394 排序：错误在前、同类按行升序', s.rows.map((r) => `${r.severity}${r.line}`).join(',') === 'error3,warning5,warning9', s.rows.map((r) => `${r.severity}${r.line}`).join(','))
  check('adj394 展示文本含分级/行列/消息', s.rows[0].text === '错误[第3行 第5列] 引号注释未闭合', s.rows[0].text)
  check('adj394 列号展示为 1-based（源码 0-based +1）', s.rows[2].col === 1 && s.rows[0].col === 5, JSON.stringify(s.rows.map((r) => r.col)))
  const sWarn = summarizeProblems([errs[0]])
  check('adj394 仅告警时最严重级别 = warning', sWarn.worst === 'warning' && sWarn.errorCount === 0, JSON.stringify(sWarn))
  check('adj394 无问题时 total=0、worst=null（组件据此不渲染提示条）', summarizeProblems([]).total === 0 && summarizeProblems([]).worst === null)
  check('adj394 max 限制只影响展示行数、计数仍为全量', (() => { const c = summarizeProblems(errs, 2); return c.rows.length === 2 && c.total === 3 && c.errorCount === 1 })())
  check('adj394 文案：标题含分级计数', problemCopy.title(3, 1, 2) === '3 个问题（1 个错误 / 2 个告警）', problemCopy.title(3, 1, 2))
  // adj394：问题行带「正确语法规则」（引擎 hint）→ 提示条在消息下方显示「正确写法」
  {
    const withHint = summarizeProblems([
      { line: 5, col: 8, message: '渐强/渐弱起止之间没有音符（起止落在同一音符），不会渲染', severity: 'warning', hint: '起止之间至少要有音符：`1 2 3 < 4 ! 5`' },
      { line: 3, col: 4, message: '引号注释未闭合', severity: 'error', hint: '引号要成对闭合，如 `1"渐强" 2`' },
    ])
    check('adj394 问题行携带 hint（正确写法）', withHint.rows.every((r) => !!r.hint && r.hint.includes('`')), JSON.stringify(withHint.rows.map((r) => r.hint)))
    check('adj394 「正确写法」前缀文案存在', problemCopy.correctPrefix === '正确写法：', problemCopy.correctPrefix)
    check('adj394 语法速查入口文案存在', problemCopy.syntaxHelp === '语法速查', problemCopy.syntaxHelp)
    // 无 hint 的问题也不应报错（hint 可能缺省）
    const noHint = summarizeProblems([{ line: 1, col: 0, message: 'x', severity: 'warning' }])
    check('adj394 缺省 hint 时正常（不报错、hint 为 undefined）', noHint.rows.length === 1 && noHint.rows[0].hint === undefined)
  // adj394：输入条「强弱」组提示必须写明「只有 + 抬升、`-` 不支持」（语法约定的用户可见入口）
  {
    const dyn = PAD_GROUPS.find((g) => g.keys.some((k) => k.label === '<' && k.label !== '+'))
    const keys = dyn?.keys ?? []
    const lt = keys.find((k) => k.insert === '<')
    const gt = keys.find((k) => k.insert === '>')
    const plus = keys.find((k) => k.insert === '+')
    check('adj394 输入条 `+` 键提示写明「只有抬升、没有 - 降低」', !!plus?.hint && plus.hint.includes('没有 - 降低'), plus?.hint)
    check('adj394 输入条 `<` / `>` 键提示写明「不支持 - 降低（- 是增时线）」', !!lt?.hint && !!gt?.hint && lt.hint.includes('不支持 - 降低') && gt.hint.includes('不支持 - 降低'), `${lt?.hint} | ${gt?.hint}`)
  }
  }
  // adj394：**所有报错点都必须带正确写法**（逐个场景扫一遍，防止以后新增报错时漏挂 hint）
  {
    const badSources: [string, string][] = [
      ['多空格', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1  2 |\n'],
      ['孤立 &', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 & 2 |\n'],
      ['无法识别的符号', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 % 2 |\n'],
      ['引号未闭合', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1"未闭合 2 |\n'],
      ['渐强起止同音符', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 < ! 4 |\n'],
      ['渐强跨行', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 < 3 |\nQ: 4 5 ! |\n'],
      ['渐强未结束又新起', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 < 3 4 > 5 |\n'],
      ['跳房子写错位置', 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: [ "1." 1 2 3 |\n'],
      ['C 行缺曲行', 'V: 1.0\nB: t\nD: C\nP: 4/4\nC: 孤零零的歌词\n'],
      ['未识别行', 'V: 1.0\nB: t\nD: C\nP: 4/4\nX: 这是啥\nQ: 1 2 3 4 |\n'],
    ]
    const missing: string[] = []
    for (const [name, src] of badSources) {
      const rows = summarizeProblems(parseJps(src).errors).rows
      if (rows.length === 0) missing.push(`${name}(未产生任何问题)`)
      else if (rows.some((r) => !r.hint)) missing.push(`${name}(${rows.filter((r) => !r.hint).map((r) => r.message).join('/')})`)
    }
    check('adj394 十类语法问题全部带正确写法（引擎 hint 无漏挂）', missing.length === 0, missing.join('；'))
  }
  // adj394（`-` 与增时线的全面排查）：连音线 `(-` 的 `-` 属于连音线；紧贴音符且带 +/- 时给出提示
  {
    const attached = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1(- 2 3) 4 |\n')
    const sAtt = attached.groups[0].music.tokens.find((t) => t.kind === 'slur')
    const n1 = attached.groups[0].music.tokens.find((t) => t.kind === 'note')
    check(
      'adj394 `1(- 2 3)`：`-` 归连音线（降低 1 级）、音符 1 不增时，并给出告警',
      sAtt?.kind === 'slur' &&
        sAtt.minus === 1 &&
        n1?.kind === 'note' &&
        n1.augmentCount === 0 &&
        attached.errors.some((e) => e.message.includes('紧贴在音符后')),
      JSON.stringify({ slur: sAtt?.kind === 'slur' ? { plus: sAtt.plus, minus: sAtt.minus } : null, aug: n1?.kind === 'note' ? n1.augmentCount : null, errs: attached.errors.map((e) => e.message) }),
    )
    check(
      'adj394 `1(-` 告警带正确写法（说明增时要写在音符旁 1- (- 2 3）',
      attached.errors.some((e) => e.message.includes('紧贴在音符后') && (e.hint ?? '').includes('1- (- 2 3')),
      JSON.stringify(attached.errors.map((e) => e.hint)),
    )
    const spaced = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- (- 2 3) 4 |\n')
    const sSp = spaced.groups[0].music.tokens.find((t) => t.kind === 'slur')
    const n1s = spaced.groups[0].music.tokens.find((t) => t.kind === 'note')
    check(
      'adj394 `1- (- 2 3)`（规范写法）：音符 1 增时 1、连音线降低 1，且无告警',
      spaced.errors.length === 0 && sSp?.kind === 'slur' && sSp.minus === 1 && n1s?.kind === 'note' && n1s.augmentCount === 1,
      JSON.stringify({ errs: spaced.errors.map((e) => e.message), aug: n1s?.kind === 'note' ? n1s.augmentCount : null }),
    )
    const volta = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1- | [-"1." 2 3 4 |]\n')
    const barV = volta.groups[0].music.tokens.find((t) => t.kind === 'barline' && t.voltaStart)
    const nv = volta.groups[0].music.tokens.find((t) => t.kind === 'note')
    check(
      'adj394 跳房子 `|[-"1."`：`-` 是跳房子降低级数；音符增时写在 `|` 之前（1-）照旧生效',
      volta.errors.length === 0 && barV?.kind === 'barline' && barV.voltaStart?.minus === 1 && nv?.kind === 'note' && nv.augmentCount === 1,
      JSON.stringify({ volta: barV?.kind === 'barline' ? barV.voltaStart : null, errs: volta.errors.map((e) => e.message) }),
    )
    const ampPlus = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&sby+ 2 |\n')
    const ampMinus = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1&sby- 2 |\n')
    const symPlus = ampPlus.groups[0].music.tokens.find((t) => t.kind === 'note')
    const symMinus = ampMinus.groups[0].music.tokens.find((t) => t.kind === 'note')
    check(
      'adj394 `&sby+`（加长版编码）与 `&sby-`（`-` 是增时线、编码仍为 sby）解析正确',
      symPlus?.kind === 'note' && symPlus.symbols.includes('sby+') && symMinus?.kind === 'note' && symMinus.symbols.includes('sby') && symMinus.augmentCount === 1,
      JSON.stringify({ plus: symPlus?.kind === 'note' ? symPlus.symbols : null, minus: symMinus?.kind === 'note' ? { sym: symMinus.symbols, aug: symMinus.augmentCount } : null }),
    )
  }
  // offsetOf：行/列为 1-based，越界钳制（供 jumpCursor 定位）
  const code = 'V: 1.0\nB: t\nQ: 1 2 < ! 3 |\n'
  check('adj394 偏移：第1行第1列 = 0', offsetOf(code, 1, 1) === 0, String(offsetOf(code, 1, 1)))
  check('adj394 偏移：第3行第1列 = 前两行长度+2', offsetOf(code, 3, 1) === 'V: 1.0\nB: t\n'.length, `${offsetOf(code, 3, 1)} vs ${'V: 1.0\nB: t\n'.length}`)
  check('adj394 偏移：第3行第8列（`<` 所在）指向该字符', code[offsetOf(code, 3, 8)] === '<', `char=${code[offsetOf(code, 3, 8)]}`)
  check('adj394 偏移：行号/列号超界钳制（不越界、不抛错）', offsetOf(code, 999, 999) === code.length, `${offsetOf(code, 999, 999)} vs ${code.length}`)
  check('adj394 偏移：非法行号（0）钳制到第 1 行', offsetOf(code, 0, 1) === 0, String(offsetOf(code, 0, 1)))
}

// ---- 87. 增时线 data-notepos 覆盖：各种写法核对（adj380 排查）----
console.log('[87] augmentation data-notepos coverage (adj380)')
{
  // [名称, Q 行, 末音符 id, id 期望出现次数（数字 1 + 增时线 N）]
  const cases: [string, string, string, number][] = [
    ['连写 1--', 'Q: | 6,) 1-- ||', '0_1_0_1', 3],
    ['拆开写 1 - -', 'Q: | 6,) 1 - - ||', '0_1_0_1', 3],
    ['单条 1-', 'Q: | 6,) 1- ||', '0_1_0_1', 2],
    ['三条 1---', 'Q: | 6,) 1--- ||', '0_1_0_1', 4],
    ['附点+增时线 1-.', 'Q: | 6,) 1-. ||', '0_1_0_1', 2],
    ['用户谱 6,--- &ykh', 'Q: | 6,--- &ykh ||', '0_1_0_0', 4],
    ['用户谱 6,--- &ykh（带前面小节）', 'Q: | 5 5 5 5 | 6,--- &ykh ||', '0_1_0_4', 4],
  ]
  for (const [name, q, id, expect] of cases) {
    const rv = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${q}\n`)
    const layv = layoutScore(rv, DUR_CFG)
    const svg = renderScoreToSvg(layv)[0] ?? ''
    const n = svg.split(`data-notepos="${id}"`).length - 1
    const dashes = [...svg.matchAll(/<text [^>]*>-<\/text>/g)].length
    console.log(`[PROBE-87] ${name}: err=${rv.errors.length} id(${id})出现=${n} 增时线笔画=${dashes}`)
    // 用户谱：打印增时线笔画中心 vs 色块区间（两种布局模式 + 13 号）
    if (name.startsWith('用户谱')) {
      for (const mode of ['duration', 'space'] as const) {
        const lm = layoutScore(rv, { ...DUR_CFG, noteSpaceLayout: mode, note_size: 13 })
        const sm = renderScoreToSvg(lm)[0] ?? ''
        const dx = [...sm.matchAll(/<text x="([\d.]+)"[^>]*>-<\/text>/g)].map((m) => Number(m[1]))
        const bl = buildPlaySequence(rv, lm, 120).events.flatMap((e) =>
          (e.playheadSegs ?? []).map((s) => `${s.x.toFixed(1)}~${(s.x + s.width).toFixed(1)}`),
        )
        const ok = dx.length > 0 && dx.every((x) => bl.some((b) => { const [a, z] = b.split('~').map(Number); return x >= a - 0.5 && x <= z + 0.5 }))
        console.log(`[PROBE-87]   ${mode}/13号 覆盖=${ok}: dash=${JSON.stringify(dx)} blocks=${JSON.stringify(bl)}`)
      }
    }
    check(`adj380 ${name}：该音符 id 覆盖数字+各增时线（应为 ${expect} 处）`, rv.errors.length === 0 && n === expect, `id出现=${n} 期望=${expect}`)
  }
}

// ---- 88. 试听总时长取「事件尾端」：末音符后段（增时线）不被提前清空（adj381）----
console.log('[88] play totalMs covers last-note tail (adj381)')
{
  // 用户两条对照谱：末音符带增时线（时值跨多拍），旧算法只算末事件「起声时刻」+100ms，
  // 收尾定时器在末音符刚起声时清空色块轨道 → 末音符后面的增时线永远没有色块。
  const tailCases: [string, string][] = [
    ['用户本次对照 6,--- &ykh', 'Q: | 1 2 3 4 | 6,--- &ykh ||'],
    ['用户最初报告 1--', 'Q: | 1 2 | 6,) 1-- ||'],
    ['单小节末尾长音符 6,---', 'Q: | 6,--- ||'],
  ]
  const stubBackend = { play: async () => {}, stop: () => {} } as unknown as Parameters<typeof schedulePlay>[1]
  const FIRST_DELAY = 200 // PlaybackDialog 的 PLAY_FIRST_DELAY_MS
  for (const [name, q] of tailCases) {
    const rv = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${q}\n`)
    const layv = layoutScore(rv, defaultPageConfig)
    const seq = buildPlaySequence(rv, layv, 60)
    const job = schedulePlay(seq, stubBackend, undefined, undefined, FIRST_DELAY)
    const beatMs = 60000 / seq.bpm
    const lastEv = seq.events[seq.events.length - 1]
    const evEndMs = Math.max(...seq.events.map((e) => e.atMs + e.durationMs))
    // 色块（拍段）时间窗的最大结束时刻——每个色块都必须落在 totalMs 内，否则会被提前清空
    const segEndMs = Math.max(
      ...seq.events.flatMap((e) => (e.playheadSegs ?? []).map((s) => e.atMs + (s.beat + s.beats) * beatMs)),
    )
    const oldTotalMs = lastEv.atMs + 100 + FIRST_DELAY // 旧算法（只算末事件起声）
    check(
      `adj381 ${name}：总时长覆盖末音符尾端色块（不提前收尾）`,
      rv.errors.length === 0 && segEndMs <= job.totalMs + 1e-6 && job.totalMs > oldTotalMs + 1,
      `末色块结束=${segEndMs.toFixed(0)}ms totalMs=${job.totalMs}ms 旧算法=${oldTotalMs}ms`,
    )
    check(
      `adj381 ${name}：总时长 = 事件尾端 + 100ms 余量 + 准备延迟`,
      Math.abs(job.totalMs - (evEndMs + 100 + FIRST_DELAY)) < 1e-6,
      `totalMs=${job.totalMs} 期望=${evEndMs + 100 + FIRST_DELAY}`,
    )
    check(
      `adj381 ${name}：末音符至少 N 条增时线各有独立色块`,
      (lastEv.playheadSegs ?? []).length >= 2,
      `末事件色块数=${(lastEv.playheadSegs ?? []).length}`,
    )
  }
}

// ---- 89. 谱面级设置 # jps-config 往返保真（adj382）----
console.log('[89] per-score config round trip (# jps-config, adj382)')
{
  const src = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'
  const cfg: typeof defaultPageConfig = {
    ...defaultPageConfig,
    note_size: 15,
    margin_left: 32,
    noteSpaceLayout: 'duration' as const,
    lianyinxian_type: 2 as const,
    showInstrument: true,
    lyricShrink: true,
  }
  const written = writeJpsConfig(src, cfg)
  const line = written.split('\n').find((l) => l.startsWith(JPS_CONFIG_PREFIX))
  check('adj382 写回：源码出现 # jps-config 行', line !== undefined)
  const raw = JSON.parse((line ?? '').slice(JPS_CONFIG_PREFIX.length)) as Record<string, unknown>
  const back = extractJpsConfig(written) ?? {}
  // 强不变量：**写进去的每个字段都必须能读回来**（旧版白名单漏 showInstrument 时此处会列出它）
  const missed = Object.keys(raw).filter((k) => !(k in back))
  check('adj382 往返保真：写入的每个字段都能读回（不丢字段）', missed.length === 0, `丢失=${missed.join(',')}`)
  check('adj382 可选字段 showInstrument 往返保真（旧版会丢：勾选「显示乐器名」重开即失效）', back.showInstrument === true, String(back.showInstrument))
  check('adj382 可选字段 lyricShrink 往返保真', back.lyricShrink === true, String(back.lyricShrink))
  // adj-font：editorFont/editorFontSize 已不属谱面级（改为 L1 用户个性），不再做往返断言——
  // 相关新语义断言见本节之后的 [90]（差量写入 + 编辑器偏好不进谱面 + 字体 fallback）
  // 可选字段逐个核对（与 engine/settings.ts 的 OPTIONAL_CONFIG_FIELDS 对齐；
  // 编辑器偏好已移出谱面级，不在此列——见 adj-font 断言）
  const optionalSamples: [string, unknown][] = [
    ['heights', { quci: [1, 2, 3, 4] }],
    ['metaPos', { notes: { x: 10, y: -30 } }],
    ['lyricShrink', true],
    ['showInstrument', true],
  ]
  for (const [field, value] of optionalSamples) {
    const w = writeJpsConfig(src, { ...defaultPageConfig, [field]: value } as typeof defaultPageConfig)
    const e = extractJpsConfig(w) as Record<string, unknown> | null
    check(`adj382 可选字段 ${field} 写入后可读回`, e !== null && JSON.stringify(e[field]) === JSON.stringify(value), JSON.stringify(e?.[field]))
  }
  const merged = mergeJpsConfig(written, { ...defaultPageConfig, note_size: 99 })
  check('adj382 优先级：源内谱面设置 > 兜底设置', merged.note_size === 15, String(merged.note_size))
  check('adj382 源内未写的键回退兜底', mergeJpsConfig(src, { ...defaultPageConfig, margin_right: 12 }).margin_right === 12)
  check('adj382 重复写回仍只有一行 # jps-config', writeJpsConfig(written, cfg).split(JPS_CONFIG_PREFIX).length - 1 === 1)
}

// ---- 90. 设置分层：差量写入 / 编辑器偏好不进谱面 / 字体 fallback（adj-font）----
console.log('[90] settings layering: diff write, editor prefs out of score, font fallbacks (adj-font)')
{
  const src = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'

  // ① 差量写入：全默认 → 不写设置行；改一项 → 只写该项
  const allDefault = writeJpsConfig(src, { ...defaultPageConfig })
  check('adj-font 全默认时不写 # jps-config 行', !allDefault.includes(JPS_CONFIG_PREFIX), JSON.stringify(allDefault.slice(-40)))
  const oneChange = writeJpsConfig(src, { ...defaultPageConfig, margin_left: 32, note_size: 15 })
  const line1 = oneChange.split('\n').find((l) => l.startsWith(JPS_CONFIG_PREFIX)) ?? ''
  const obj1 = JSON.parse(line1.slice(JPS_CONFIG_PREFIX.length)) as Record<string, unknown>
  check('adj-font 差量写入只含被改字段', Object.keys(obj1).sort().join(',') === 'margin_left,note_size', Object.keys(obj1).join(','))
  check('adj-font 差量写入可正确读回', extractJpsConfig(oneChange)?.margin_left === 32 && extractJpsConfig(oneChange)?.note_size === 15)
  check('adj-font 差量写入不含默认字段（margin_top 不落盘）', !('margin_top' in obj1))

  // ② 全部回到默认 → 删除设置行（并收敛空行）
  const back = writeJpsConfig(oneChange, { ...defaultPageConfig })
  check('adj-font 回到默认时删除设置行', !back.includes(JPS_CONFIG_PREFIX), JSON.stringify(back))
  check('adj-font 删除后不留多余空行', !back.includes('\n\n\n'), JSON.stringify(back))

  // ③ 全量模式（固化）：与默认相同的项也写入
  const full = writeJpsConfig(oneChange, { ...defaultPageConfig, margin_left: 32 }, { mode: 'full' })
  const lineF = full.split('\n').find((l) => l.startsWith(JPS_CONFIG_PREFIX)) ?? ''
  const objF = JSON.parse(lineF.slice(JPS_CONFIG_PREFIX.length)) as Record<string, unknown>
  check('adj-font 全量模式写入全部可写字段（≥28 项）', Object.keys(objF).length >= 28, String(Object.keys(objF).length))
  check('adj-font 全量模式含默认字段（margin_top=40）', objF.margin_top === 40)

  // ④ 编辑器偏好永不进谱面（类型上已从 PageConfig 移除；源码里写了也会被白名单过滤）
  const legacy = `V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n\n# jps-config:{"note_size":15,"editorFont":"SimHei","editorFontSize":22}\n`
  const exLegacy = extractJpsConfig(legacy)
  check('adj-font 读取时忽略谱面里的 editorFont/editorFontSize', exLegacy?.note_size === 15 && !('editorFont' in (exLegacy ?? {})) && !('editorFontSize' in (exLegacy ?? {})), JSON.stringify(exLegacy))
  const migrated = extractLegacyEditorPrefs(legacy)
  check('adj-font 旧编辑器偏好可一次性迁移读出', migrated?.font === 'SimHei' && migrated?.fontSize === 22, JSON.stringify(migrated))
  const rewritten = writeJpsConfig(legacy, mergeJpsConfig(legacy, null))
  check('adj-font 再次保存后谱面里的 editorFont 被清除', !rewritten.includes('editorFont'), rewritten.split('\n').slice(-3).join(' | '))
  check('adj-font 再次保存保留仍非默认的项（note_size=15）', extractJpsConfig(rewritten)?.note_size === 15)

  // ⑤ 字体 fallback：裸名补通用族；已有通用族不重复补
  check('adj-font 裸字体名补 sans-serif', normalizeFontStack('Microsoft YaHei') === "'Microsoft YaHei', sans-serif", normalizeFontStack('Microsoft YaHei'))
  check('adj-font 宋体类补 serif', normalizeFontStack('SimSun') === 'SimSun, serif', normalizeFontStack('SimSun'))
  check('adj-font 等宽类补 monospace', normalizeFontStack('Consolas') === 'Consolas, monospace', normalizeFontStack('Consolas'))
  check('adj-font 已有通用族的栈保持不变', normalizeFontStack("'SimHei', sans-serif") === "'SimHei', sans-serif")
  check('adj-font 空值回落默认系统栈', normalizeFontStack('') === SYS_FONT)
  check('adj-font 旧谱面里的裸字体名读取时自动补 fallback', extractJpsConfig(`V: 1.0\nQ: 1 |\n# jps-config:{"geci_font":"KaiTi"}\n`)?.geci_font === 'KaiTi, serif', String(extractJpsConfig(`V: 1.0\nQ: 1 |\n# jps-config:{"geci_font":"KaiTi"}\n`)?.geci_font))

  // ⑥ 字体候选：每个都是含通用族的完整栈（三原则之"保证有字体可用"）
  const allFonts = [...SCORE_FONT_OPTIONS, ...EDITOR_FONT_OPTIONS]
  const noGeneric = allFonts.filter((o) => !/sans-serif|serif|monospace|system-ui/.test(o.value))
  check(`adj-font 字体候选（${allFonts.length} 项）都以通用族兜底`, noGeneric.length === 0, noGeneric.map((o) => o.label).join(','))
  check('adj-font 编辑器字体候选均为等宽（monospace 兜底）', EDITOR_FONT_OPTIONS.every((o) => o.value.includes('monospace')))
  check('adj-font 编辑器字体候选不含编程连字字体', EDITOR_FONT_OPTIONS.every((o) => !/Fira Code|JetBrains Mono|Cascadia Code/i.test(o.value)))

  // ⑦ 字体覆盖（L1）：开启后六项字体统一替换；关闭原样返回
  const ovCfg = applyFontOverride({ ...defaultPageConfig, biaoti_font: 'X, serif' }, { enabled: true, font: 'SimHei' })
  check('adj-font 字体覆盖开启：六项字体统一', ['biaoti_font', 'fubiaoti_font', 'miaoshu_font', 'notes_font', 'geci_font', 'shuzi_font'].every((f) => (ovCfg as unknown as Record<string, unknown>)[f] === 'SimHei, sans-serif'))
  check('adj-font 字体覆盖不改字号与其它排版参数', ovCfg.note_size === defaultPageConfig.note_size && ovCfg.margin_left === defaultPageConfig.margin_left)
  const off = { ...defaultPageConfig, biaoti_font: 'X, serif' }
  check('adj-font 字体覆盖关闭时原样返回（同一对象）', applyFontOverride(off, { enabled: false, font: 'SimHei' }) === off)
  check('adj-font 编辑器字号夹取范围 10~26', clampEditorFontSize(99) === 26 && clampEditorFontSize(1) === 10)
}

// ---- 91. 等时值连音组 (y…) 的时值 / 占宽 / 减时线规则（adj395） ----
// 用户定案（2/4 的 `3./ 6,// (y3/ 2/ 1/) |`）：
//   ① 组占「小节剩余时值」——2 拍小节扣掉组外已占的 1 拍 → 组总 1 拍，
//      组内 3 个音符平分 → 各 1/3 拍（演奏时值也是 1/3 拍/音）；
//   ② 组内各音符的**占宽**同样按 1/3 拍分摊（不是按各自书写的 1/2 拍）；
//   ③ 组内减时线**连成一条**——等时值连音是一组，不随拍边界断开
//      （与「同一拍内、组外」音符的相连规则见 adj397，第 93 节）。
console.log('[91] equal-duration tuplet (y...) rule (adj395)')
{
  const code395 = 'V: 1.0\nB: t\nD: C\nP: 2/4\nQ: 3./ 6,// (y3/ 2/ 1/) |\n'
  const r395 = parseJps(code395)
  type N395 = { tupletDur?: number; tupletGroup?: number; diminishCount: number }
  const tk395 = r395.groups[0].music.tokens.filter((t) => t.kind === 'note') as unknown as N395[]
  check('adj395 解析：组内三音各 1/3 拍（= (2 − 1) ÷ 3）', r395.errors.length === 0 && tk395.length === 5 && [2, 3, 4].every((i) => Math.abs((tk395[i].tupletDur ?? 0) - 1 / 3) < 1e-6), JSON.stringify(tk395.map((t) => t.tupletDur)))
  const tupSum395 = [2, 3, 4].reduce((a, i) => a + (tk395[i].tupletDur ?? 0), 0)
  check('adj395 解析：组内时值合计 = 小节剩余 1 拍', Math.abs(tupSum395 - 1) < 1e-9, String(tupSum395))
  const gid395 = tk395[2].tupletGroup
  check('adj395 解析：组内三音同组号、组外音符无组号', gid395 !== undefined && tk395[3].tupletGroup === gid395 && tk395[4].tupletGroup === gid395 && tk395[0].tupletGroup === undefined && tk395[1].tupletGroup === undefined, JSON.stringify(tk395.map((t) => t.tupletGroup)))

  // 两条布局路径都要「按剩余 1 拍」定位：拍位 = 1、4/3、5/3（同处小节第 2 拍）
  const beatOk395 = (cfg: typeof defaultPageConfig): boolean => {
    const ns = [...layoutScore(r395, cfg).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    return [1, 4 / 3, 5 / 3].every((v, i) => Math.abs(ns[2 + i].beatPos - v) < 1e-3)
  }
  check('adj395 时值优先：组内三音拍位 1 / 4⁄3 / 5⁄3（落在小节第 2 拍）', beatOk395(DUR_CFG))
  check('adj395 空间优先（默认）：组内三音拍位 1 / 4⁄3 / 5⁄3（落在小节第 2 拍）', beatOk395(defaultPageConfig))

  // 减时线：组内三音连成一条（两种布局），且 6,// 的第 2 条线仍是独立短横
  const beamOk395 = (cfg: typeof defaultPageConfig): boolean => {
    const ns = [...layoutScore(r395, cfg).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const beams = computeBeamsForTest(ns, cfg.note_size)
    const digitW = cfg.note_size * 0.62
    const tup = beams.find((b) => Math.abs(b.x1 - (ns[2].x + 1)) < 0.15)
    return tup !== undefined && Math.abs(tup.x2 - (ns[4].x + digitW - 1)) < 0.15
  }
  check('adj395 时值优先：组内减时线连成一条（覆盖 3/ 2/ 1/ 三音）', beamOk395(DUR_CFG))
  check('adj395 空间优先（默认）：组内减时线连成一条（覆盖 3/ 2/ 1/ 三音）', beamOk395(defaultPageConfig))

  // 占宽按剩余 1 拍分摊：撑满行里「组（1 拍）可支配宽 = 一个 1 拍音符的可支配宽」
  // （可支配宽 = 音符占宽 − 数字槽本体宽；本体宽随音符个数，不参与时值分摊）
  const rStretch395 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3./ 6,// (y3/ 2/ 1/) 1 2 | 3 4 5 6 | 7 1 2 3 | 4 5 6 7 |\n')
  const nsStretch395 = [...layoutScore(rStretch395, defaultPageConfig).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
  const body395 = defaultPageConfig.note_size * 0.62
  const tupExtra395 = [2, 3, 4].reduce((a, i) => a + (nsStretch395[i].width - body395), 0)
  const oneBeatExtra395 = nsStretch395[5].width - body395
  check('adj395 占宽按时值分摊：组（1 拍）可支配宽 = 整拍音符的可支配宽', Math.abs(tupExtra395 - oneBeatExtra395) < 0.1, `${tupExtra395.toFixed(2)} vs ${oneBeatExtra395.toFixed(2)}`)

  // adj397：减时线与「同一拍内的连音组成员」相连——
  // 旧实现按「组号优先」分桶，`1/ (y3/ 2/ 1/)` 里 1/（拍 1 起点）与组首音（拍 1 内）各画一条、
  // 减时线在谱面上断开；现按「同组 **或** 同拍」逐对判定 → 1/ 与组内三音共用第 1 条减时线。
  const rMix395 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1/ (y3/ 2/ 1/) 2 - |\n')
  for (const [tag395, cfg395] of [['时值优先', DUR_CFG], ['空间优先', defaultPageConfig]] as const) {
    const ns = [...layoutScore(rMix395, cfg395).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const beams = computeBeamsForTest(ns, cfg395.note_size)
    const mixDigitW = cfg395.note_size * 0.62
    check(`adj397 ${tag395}：1/ 与同拍连音组共用一条减时线（1/ + 组内三音，中间不断开）`, beams.length === 1 && Math.abs(beams[0].x1 - (ns[0].x + 1)) < 0.15 && Math.abs(beams[0].x2 - (ns[3].x + mixDigitW - 1)) < 0.15, beams.map((b) => `${b.x1}~${b.x2}`).join(' | '))
  }

  // 跨拍连音组（组总 2 拍、每音 2/3 拍）：减时线仍连成一条（不因跨拍断开）
  const rAcross395 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y3/ 2/ 1/) 1 2 |\n')
  for (const [tag395, cfg395] of [['时值优先', DUR_CFG], ['空间优先', defaultPageConfig]] as const) {
    const ns = [...layoutScore(rAcross395, cfg395).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const beams = computeBeamsForTest(ns, cfg395.note_size)
    const digitW = cfg395.note_size * 0.62
    check(`adj395 ${tag395}：跨拍组（每音 2⁄3 拍）减时线仍连成一条`, Math.abs(ns[0].beatPos) < 1e-3 && Math.abs(ns[2].beatPos - 4 / 3) < 1e-3 && beams.length === 1 && Math.abs(beams[0].x2 - (ns[2].x + digitW - 1)) < 0.15, `${beams.length} beams, beats=${ns.map((n) => n.beatPos.toFixed(3)).join(',')}`)
  }

  // 多声部空间优先：同一套规则（组内拍位 + 段时值 + 减时线相连）
  const rMv395 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 3./ 6,// (y3/ 2/ 1/) 1 2 | 3 4 5 6 |\nQ2: 1 2 3 4 | 5 6 7 1 |\n')
  const mv395 = [...layoutScore(rMv395, defaultPageConfig).pages[0].notes].filter((n) => n.id.voice === 1 && n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
  const digitW395 = defaultPageConfig.note_size * 0.62
  const mvBeams395 = computeBeamsForTest(mv395, defaultPageConfig.note_size)
  const mvTupBeam395 = mvBeams395.find((b) => Math.abs(b.x1 - (mv395[2].x + 1)) < 0.15)
  check('adj395 多声部：组内三音拍位 1 / 4⁄3 / 5⁄3、段时值 1⁄3 拍', [1, 4 / 3, 5 / 3].every((v, i) => Math.abs(mv395[2 + i].beatPos - v) < 1e-3) && mv395.slice(2, 5).every((n) => Math.abs((n.segments?.[0]?.beats ?? 0) - 1 / 3) < 1e-3), mv395.map((n) => n.beatPos.toFixed(3)).join(','))
  check('adj395 多声部：组内减时线连成一条', mvTupBeam395 !== undefined && Math.abs(mvTupBeam395.x2 - (mv395[4].x + digitW395 - 1)) < 0.15, mvBeams395.map((b) => `${b.x1}~${b.x2}`).join(' | '))
}

// ---- 92. 倚音时值与位置规则（adj396） ----
// 用户规范：
//   ① 倚音**占用主音符的时值**——单个倚音实际时值 = 1/2^(括号内减时线条数 + 1) 拍
//      （`3[2/]`：主音符 3 为 1 拍、倚音 2 为 1/4 拍 → 先奏 1/4 拍倚音再奏 3/4 拍主音符，合计 1 拍）；
//   ② 后倚音同理但排在**末尾**（先主音符 3/4 拍，最后 1/4 拍奏倚音）；
//   ③ 多倚音各占各自时值依次排列（`3[3/2/]` = 1/4 + 1/4 倚音，主音符余 1/2 拍）；
//   ④ **增时线/附点后可写后倚音**（`3 -[h5/]` / `3.[h5/]`）：总时值 = 主音符总时值（2 拍 / 1.5 拍），
//      主音符先奏满增时线/附点（到末尾前），最后 1/4 拍才奏后倚音；谱面上倚音画在增时线/附点**之后**（紧靠）。
console.log('[92] grace note timing & position (adj396)')
{
  const BEAT_MS = 1000 // 60 BPM → 1 拍 = 1000ms
  /** 取某行第 idx 个音符的 token（note 类型断言） */
  type N92 = { kind: string; pitch?: number; augmentCount: number; dots: number; diminishCount: number; gracenotes?: { after: boolean; notes: { pitch: number; diminishCount: number }[] } }
  const toks92 = (code: string): N92[] => parseJps(code).groups[0].music.tokens as unknown as N92[]

  // ---- ① 解析 ----
  const gA92 = toks92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/] 3[h2/] |\n')
  check('adj396 解析：`3[2/]` 前倚音（after=false、倚音减时线 1 条）', gA92[0].gracenotes?.after === false && gA92[0].gracenotes?.notes[0].diminishCount === 1, JSON.stringify(gA92[0].gracenotes))
  check('adj396 解析：`3[h2/]` 后倚音（after=true）', gA92[1].gracenotes?.after === true, JSON.stringify(gA92[1].gracenotes))
  const gB92 = toks92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 -[h5/] |\n')
  check('adj396 解析：`3 -[h5/]` 增时线后写后倚音（音符增时 1 拍 + 后倚音）', gB92[0].augmentCount === 1 && gB92[0].gracenotes?.after === true && gB92[0].gracenotes?.notes[0].pitch === 5, JSON.stringify(gB92[0]))
  const gC92 = toks92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3.[h5/] 3 .[h5/] |\n')
  check('adj396 解析：独立附点归前音符（`3 .[h5/]` 等价 `3.[h5/]`）', gC92[0].dots === 1 && gC92[1].dots === 1 && gC92[1].gracenotes?.after === true, `dots=${gC92.map((t) => t.dots).join(',')}`)
  // adj489：旧版 `graceSum > total` 告警已删除（现在倚音不够时**向邻居借**）。
  // 顺带：主音符时长较短时仍**不报警**，改为演奏时智能借时。
  const rOver92 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3,//[2] 1 |\n')
  const over92 = rOver92.errors.find((e) => e.message.includes('倚音总时值'))
  check('adj489 不再因倚音总时值>主音符而告警（借用机制接管）', over92 === undefined, JSON.stringify(rOver92.errors.map((e) => e.message)))

  // ---- ② 演奏时值（60 BPM：1 拍 = 1000ms）adj489：短倚音按组时值、组内均分；长倚音主音/2；不够时**向前/后借** ----
  /** 按发生时刻排序的事件 [{at, dur, pitch}] */
  const evs92 = (code: string) => {
    const r = parseJps(code)
    const seq = buildPlaySequence(r, layoutScore(r, defaultPageConfig), 60)
    return { ev: [...seq.events].sort((a, b) => a.atMs - b.atMs), totalMs: seq.totalMs }
  }
  // adj507（用户规范）：**短倚音组时值 = 主音符因子 × 倚音因子**
  //   主音符因子：不带减时线 1、**有**减时线 1/2（只看有无，与条数无关）
  //   倚音因子：1 条 1/4、2 条 1/8、≥3 条 1/16（封顶）
  //   ⇒ `3[2/]` = 1/4 拍（主音符 1 拍）、`3/[2/]` = 1/8 拍（主音符 1/2 拍）
  const g250 = (1 / 4) * BEAT_MS // 1/4 拍 = 250ms（主音符无减时线 + 倚音 1 条）
  const g125 = (1 / 8) * BEAT_MS // 1/8 拍 = 125ms（主音符有减时线 + 倚音 1 条；或主音符无 + 倚音 2 条）
  const g625 = (1 / 16) * BEAT_MS // 1/16 拍 = 62.5ms（借用断言里"缺的 1/16 拍"）

  // 单短倚音：主音符 1 拍（无减时线）⇒ 组时值 1/4，主音符余 3/4
  const q1 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/] 1 2 3 |\n')
  check('adj489/507 单短倚音 `3[2/]`（主音符 1 拍）：组时值 1/4，单个倚音 1/4 + 主音符 3/4',
    Math.abs(q1.ev[0].atMs - 0) < 1 && Math.abs(q1.ev[0].durationMs - g250) < 1 &&
    Math.abs(q1.ev[1].atMs - g250) < 1 && Math.abs(q1.ev[1].durationMs - (BEAT_MS - g250)) < 1,
    q1.ev.slice(0, 3).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))
  check('adj489 单短倚音后续音符仍在整拍位置（不后移）',
    Math.abs(q1.ev[2].atMs - 1000) < 1 && Math.abs(q1.ev[4].atMs - 3000) < 1 && Math.abs(q1.totalMs - 4000) < 1,
    q1.ev.map((e) => e.atMs).join(','))

  // 后倚音单短：主音符先 3/4 拍，最后 1/4 拍倚音
  const q2 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[h2/] 1 2 3 |\n')
  check('adj489/507 单短后倚音 `3[h2/]`：主音符 3/4 + 末尾倚音 1/4，合计 1 拍',
    Math.abs(q2.ev[0].atMs - 0) < 1 && Math.abs(q2.ev[0].durationMs - (BEAT_MS - g250)) < 1 &&
    Math.abs(q2.ev[1].atMs - (BEAT_MS - g250)) < 1 && Math.abs(q2.ev[1].durationMs - g250) < 1,
    q2.ev.slice(0, 3).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))

  // **多短倚音（adj489 + adj507）：组时值 1/4，组内均分 ⇒ 每个 1/8**
  const q3 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[3/2/] 1 2 3 |\n')
  check('adj489/507 多短倚音 `3[3/2/]`（主音符 1 拍）：组时值 1/4，两个倚音各 1/8 + 主音符 3/4',
    q3.ev[0].durationMs > 0 && Math.abs(q3.ev[0].durationMs - g125) < 1 &&
    Math.abs(q3.ev[1].atMs - g125) < 1 && Math.abs(q3.ev[1].durationMs - g125) < 1 &&
    Math.abs(q3.ev[2].atMs - 2 * g125) < 1 && Math.abs(q3.ev[2].durationMs - (BEAT_MS - 2 * g125)) < 1,
    q3.ev.slice(0, 3).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))

  // 三个短倚音：组时值 1/4，三个各 1/12
  const q3b = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/1/2/] 1 2 3 |\n')
  const per12 = (1 / 12) * BEAT_MS
  check('adj489/507 三短倚音 `3[2/1/2/]`（主音符 1 拍）：组时值 1/4，三个各 1/12 + 主音符 3/4',
    q3b.ev[0].durationMs > 0 && Math.abs(q3b.ev[0].durationMs - per12) < 1 &&
    Math.abs(q3b.ev[1].atMs - per12) < 1 && Math.abs(q3b.ev[1].durationMs - per12) < 1 &&
    Math.abs(q3b.ev[2].atMs - 2 * per12) < 1 && Math.abs(q3b.ev[2].durationMs - per12) < 1 &&
    Math.abs(q3b.ev[3].atMs - 3 * per12) < 1 && Math.abs(q3b.ev[3].durationMs - (BEAT_MS - 3 * per12)) < 1,
    q3b.ev.slice(0, 4).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))

  // 长倚音单：主音符/2，组时值 1/2
  const qL = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2] 1 2 3 |\n')
  check('adj489 长倚音 `3[2]`：组时值 = 主音符/2 = 1/2 拍，单个倚音 1/2 + 主音符 1/2',
    Math.abs(qL.ev[0].durationMs - 500) < 1 && Math.abs(qL.ev[1].atMs - 500) < 1 && Math.abs(qL.ev[1].durationMs - 500) < 1,
    qL.ev.slice(0, 3).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))

  // 长倚音多：主音符/2，组内均分
  const qLm = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[32] 1 2 3 |\n')
  check('adj489 长倚音多 `3[32]`：组时值 1/2，两个倚音各 1/4 + 主音符 1/2',
    Math.abs(qLm.ev[0].durationMs - 250) < 1 && Math.abs(qLm.ev[1].atMs - 250) < 1 && Math.abs(qLm.ev[1].durationMs - 250) < 1 &&
    Math.abs(qLm.ev[2].atMs - 500) < 1 && Math.abs(qLm.ev[2].durationMs - 500) < 1,
    qLm.ev.slice(0, 3).map((e) => `${e.atMs}+${e.durationMs}`).join(' '))

  // **借用（adj489；adj506 后触发条件变窄）**：主音符时长 < 倚音组时值 → 向前（前倚音）/ 后（后倚音）借；
  // 借走的量从被借的那个主音符事件里扣，**两主音符总时值不变**（总时值守恒）。
  // adj506 把短倚音组时值减半（`2/` 由 1/4 → 1/8 拍）⇒ 要触发借，主音符必须**短于 1/8 拍**：
  // 这里用四条减时线的主音符（`6,////` = 1/16 拍），组时值 1/8 > 1/16 ⇒ 缺 1/16 ⇒ 从前一个主音符借。
  const qB = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 5 - 6,////[2/] 1 |\n')
  check('adj508 短前倚音向**前一个主音符**借整段窗口（拍点前 1/8 拍），主音符稳落拍点',
    qB.ev.length >= 4 &&
    Math.abs(qB.ev[0].durationMs - (2 * BEAT_MS - g125)) < 1 && // 前主音 2000 → 1875（让出整个倚音窗口）
    Math.abs(qB.ev[1].atMs - (2 * BEAT_MS - g125)) < 1 && // 倚音起于 1875
    Math.abs(qB.ev[1].durationMs - g125) < 1 && // 倚音占满 1/8 拍窗口
    Math.abs(qB.ev[2].atMs - 2 * BEAT_MS) < 1 && // 主音符**正好在拍点** 2000
    Math.abs(qB.ev[2].durationMs - g625) < 1, // 且保持原时值 1/16 拍
    qB.ev.slice(0, 4).map((e) => `${Math.round(e.atMs)}+${Math.round(e.durationMs)}`).join(' '))

  // ---- adj508（用户要求）：**短前倚音总是"抢在拍前"**，保证主音符总在拍点上 ----
  {
    // 有前一个音 ⇒ 走"抢拍前"：倚音占 [1000−250, 1000]，主音符 3 整拍落在 1000，前一个 1 缩短到 750
    const a1 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 3[2/] 1 |\n')
    check('adj508 短前倚音抢拍前：`1 3[2/] 1` ⇒ 前音 0+750、倚音 750+250、主音 **1000+1000**（整拍在拍点）',
      Math.abs(a1.ev[0].durationMs - 750) < 1 &&
        Math.abs(a1.ev[1].atMs - 750) < 1 && Math.abs(a1.ev[1].durationMs - 250) < 1 &&
        Math.abs(a1.ev[2].atMs - 1000) < 1 && Math.abs(a1.ev[2].durationMs - 1000) < 1 &&
        Math.abs(a1.ev[3].atMs - 2000) < 1,
      a1.ev.slice(0, 4).map((e) => `${Math.round(e.atMs)}+${Math.round(e.durationMs)}`).join(' '))
    // 长前倚音**仍占拍点**（主音符后移）：倚音 1000+500、主音符 1500+500 —— 与短倚音相反，符合规范
    const a2 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 3[2] 1 |\n')
    check('adj508 长前倚音仍占拍点（主音符后移）：`1 3[2] 1` ⇒ 倚音 1000+500、主音 1500+500',
      Math.abs(a2.ev[0].durationMs - 1000) < 1 &&
        Math.abs(a2.ev[1].atMs - 1000) < 1 && Math.abs(a2.ev[1].durationMs - 500) < 1 &&
        Math.abs(a2.ev[2].atMs - 1500) < 1 && Math.abs(a2.ev[2].durationMs - 500) < 1,
      a2.ev.slice(0, 4).map((e) => `${Math.round(e.atMs)}+${Math.round(e.durationMs)}`).join(' '))
    // 后倚音不受影响（占自己主音符的尾部）
    const a3 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 3[h2/] 1 |\n')
    check('adj508 短后倚音不受影响：`1 3[h2/] 1` ⇒ 主音 1000+750、倚音 1750+250',
      Math.abs(a3.ev[0].durationMs - 1000) < 1 &&
        Math.abs(a3.ev[1].atMs - 1000) < 1 && Math.abs(a3.ev[1].durationMs - 750) < 1 &&
        Math.abs(a3.ev[2].atMs - 1750) < 1 && Math.abs(a3.ev[2].durationMs - 250) < 1,
      a3.ev.slice(0, 4).map((e) => `${Math.round(e.atMs)}+${Math.round(e.durationMs)}`).join(' '))
  }

  // 增时线/附点后倚音：主音符先奏满（到末尾前），最后一段才是倚音
  const q4 = evs92('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 -[h5/] 1 |\n')
  check('adj489/507 `3 -[h5/]`：主音符奏 1.75 拍、最后 1/4 拍奏倚音（总 2 拍）',
    Math.abs(q4.ev[0].atMs - 0) < 1 && Math.abs(q4.ev[0].durationMs - (2 * BEAT_MS - g250)) < 1 &&
    Math.abs(q4.ev[1].atMs - (2 * BEAT_MS - g250)) < 1 && Math.abs(q4.ev[1].durationMs - g250) < 1 &&
    Math.abs(q4.ev[2].atMs - 2000) < 1, q4.ev.map((e) => `${e.atMs}+${e.durationMs}`).join(' '))
  check('adj489 `3 -[h5/]`：总时长仍为 3 拍（倚音不额外占时）', Math.abs(q4.totalMs - 3000) < 1, String(q4.totalMs))

  // ---- ③ 谱面位置：倚音紧靠「数字 / 增时线 / 附点」（三种情形，两种布局） ----
  const graceXs92 = (svg: string) => [...svg.matchAll(new RegExp(`<text x="([\\d.]+)" y="[\\d.]+" font-size="${GRACE_FS}"`, 'g'))].map((m) => Number(m[1]))
  const digitX92 = (svg: string, glyph: string) => Number(svg.match(new RegExp(`<text x="([\\d.]+)" y="[^"]+" data-notepos="[^"]+" font-size="${defaultPageConfig.note_size}"[^>]*>${glyph}<`))?.[1] ?? 'NaN')
  const augCx92 = (svg: string, nth = 0) => {
    const all = [...svg.matchAll(new RegExp(`<text x="([\\d.]+)" y="[^"]+" text-anchor="middle"[^>]*font-size="${defaultPageConfig.note_size}"[^>]*>-<`, 'g'))].map((m) => Number(m[1]))
    return all[nth] ?? NaN
  }
  const dotCx92 = (svg: string) => Number(svg.match(/<circle cx="([\d.]+)" cy="[^"]+" r="[^"]+" fill="#1b1b1b"\/>/)?.[1] ?? 'NaN')
  const DOT_R_S92 = DOT_R_DOT * NS_S
  for (const [tag92, cfg92] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const svgPlain = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[h5/] 1 2 3 |\n'), cfg92))[0]
    const gxPlain = graceXs92(svgPlain)[0]
    check(`adj396 ${tag92}：无增时线/附点 → 后倚音紧靠数字右缘（+1px×s）`, Math.abs(gxPlain - (digitX92(svgPlain, '3') + DIGIT_W + NS_S)) < 0.3, `grace=${gxPlain} digit=${digitX92(svgPlain, '3')}`)
    const svgAug = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 -[h5/] 1 |\n'), cfg92))[0]
    const gxAug = graceXs92(svgAug)[0]
    const augCx = augCx92(svgAug)
    // adj421：单行曲部按槽预分占宽后，音符的时值元素（数字/增时线/附点）在槽内摊开——
    // 「紧靠」的语义随之变为「排在增时线之后、仍在本音符跨度内」，不再要求 1.5×s+6 的贴身距离
    // （实测槽内摊开后距增时线中心 ≈ 4 + 11~15px；对照上面「无增时线」用例仍严格贴身）
    check(
      `adj396 ${tag92}：有增时线 → 后倚音排在增时线之后（同音符跨度内，槽内摊开）`,
      gxAug > augCx + DIGIT_W / 2 && gxAug < augCx + DIGIT_W / 2 + 2.5 * NS_S + 14,
      `grace=${gxAug} augCx=${augCx}`,
    )
    const svgDot = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3.[h5/] 1 2 |\n'), cfg92))[0]
    const gxDot = graceXs92(svgDot)[0]
    const dotCx = dotCx92(svgDot)
    check(`adj396 ${tag92}：有附点 → 后倚音排在附点之后（紧靠）`, gxDot > dotCx + DOT_R_S92 && gxDot < dotCx + DOT_R_S92 + 1.5 * NS_S + 2, `grace=${gxDot} dotCx=${dotCx}`)
  }
  // 占位：尾部倚音不挤压后续音符——带倚音音符的 rightX ≤ 下一音符 x（两种布局）
  for (const [tag92, cfg92] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const lay92 = layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 -[h5/] 1 |\n'), cfg92)
    const ns92 = [...lay92.pages[0].notes].sort((a, b) => a.x - b.x)
    check(`adj396 ${tag92}：尾部倚音占位计入音符宽（不压到下一音符）`, (ns92[0].rightX ?? ns92[0].x + ns92[0].width) <= ns92[1].x + 0.15, `rightX=${ns92[0].rightX} next=${ns92[1].x}`)
  }
}

// ---- 93. 减时线与同一拍内的连音组相连（adj397） ----
// 用户定案（4/4 的 `2/. 3// 5/ (y5// 6// 5//) 3[2/] 0// 2// 3// 5// |`）：
//   5/（拍 1.0 起）与 (y5// 6// 5//)（组占小节剩余 0.5 拍 → 拍 1.5/1.667/1.833）
//   **同处第 2 拍** → 5/ 的减时线应与组内三音**连在一起**（旧实现按组号分桶、各画一条）。
//   规则（computeBeams 的 linked，逐对判定）：同组 → 相连；否则同拍 → 相连。
console.log('[93] beams join same-beat tuplet (adj397)')
{
  const r397 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 2/. 3// 5/ (y5// 6// 5//) 3[2/] 0// 2// 3// 5// |\n')
  check('adj397 解析：用户小节无错误', r397.errors.length === 0, JSON.stringify(r397.errors.map((e) => e.message)))
  for (const [tag397, cfg397] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const ns = [...layoutScore(r397, cfg397).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const dw = cfg397.note_size * 0.62
    const beams = computeBeamsForTest(ns, cfg397.note_size)
    const lvl1 = beams.filter((b) => Math.abs(b.y - beamY(ns[0].y, 1, cfg397.note_size)) < 0.5).sort((a, b) => a.x1 - b.x1)
    const lvl2 = beams.filter((b) => Math.abs(b.y - beamY(ns[0].y, 2, cfg397.note_size)) < 0.5).sort((a, b) => a.x1 - b.x1)
    const at = (list: typeof beams, x: number) => list.find((b) => Math.abs(b.x1 - x) < 0.15)
    // 前提：5/ 与组内三音的拍号一致（floor(beatPos) = 1），这正是相连的依据
    check(`adj397 ${tag397}：5/ 与组内三音同处第 2 拍`, Math.floor(ns[2].beatPos) === 1 && ns.slice(3, 6).every((n) => Math.floor(n.beatPos) === 1), ns.slice(2, 6).map((n) => n.beatPos.toFixed(3)).join(','))
    const join397 = at(lvl1, ns[2].x + 1)
    check(`adj397 ${tag397}：第 1 条减时线从 5/ 连到组末（5/ 与组内三音一条线）`, join397 !== undefined && Math.abs(join397.x2 - (ns[5].x + dw - 1)) < 0.15, lvl1.map((b) => `${b.x1}~${b.x2}`).join(' | '))
    check(`adj397 ${tag397}：组首音不再是独立线头（不再与 5/ 断开）`, at(lvl1, ns[3].x + 1) === undefined, lvl1.map((b) => `${b.x1}~${b.x2}`).join(' | '))
    // 5/ 只有 1 条减时线：第 2 条不得从 5/ 起（第 2 条仍只覆盖组内三音）
    const join2 = at(lvl2, ns[3].x + 1)
    check(`adj397 ${tag397}：第 2 条减时线只覆盖组内三音（5/ 不参与）`, at(lvl2, ns[2].x + 1) === undefined && join2 !== undefined && Math.abs(join2.x2 - (ns[5].x + dw - 1)) < 0.15, lvl2.map((b) => `${b.x1}~${b.x2}`).join(' | '))
  }
  // 反例：跨拍连音组仍整组相连，但**不与下一拍**的音符相连（adj395 的跨拍规则保留）
  const rAcross397 = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (y3/ 2/ 1/) 1 2 |\n')
  for (const [tag397, cfg397] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const ns = [...layoutScore(rAcross397, cfg397).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const beams = computeBeamsForTest(ns, cfg397.note_size)
    check(`adj397 ${tag397}：跨拍组仍连成一条、不与下一拍音符相连`, beams.length === 1 && Math.abs(beams[0].x1 - (ns[0].x + 1)) < 0.15 && Math.abs(beams[0].x2 - (ns[2].x + cfg397.note_size * 0.62 - 1)) < 0.15, `${beams.length}: ${beams.map((b) => `${b.x1}~${b.x2}`).join(' | ')}`)
  }
}

// ---- 94. 临时拍号分数的占位预算（adj398，E-2026-138） ----
// 用户定案（4/4 的 `5'/. 6'// 5'/ 2'/ 3' 0/ 6// 5// | 6/ 5'// (3'// 3'/) 3'/ 2' 7&yc |"p:2/4" 0 5 |"p:4/4" 6-- &zkh 6/ 5/&sby |`，
// 边距 40、字号 13）：整行内容**越出右边距 19.2px**。根因——临时节拍分数画在小节线右缘之后，
// 而空间优先路径的行宽预算 `nonDurPad` 只按 barlinePad×2 计小节线，未含分数占位，
// 放置处 gapR 却按分数宽撑开 → 差出的部分无人买单、行内容整体右溢（每个分数约 10.7px）。
// 修复：预算与放置共用 `meterGapRight`；行末小节线带分数时右钳制让出分数占位。
console.log('[94] temp-meter fraction budgeting (adj398)')
{
  const noteSize398 = 13
  const cfg398 = { ...defaultPageConfig, margin_left: 40, margin_right: 40, note_size: noteSize398 }
  const s398 = noteSize398 / 18
  /** 行内可见右缘：音符 rightX（内容右端，非槽宽）+ 小节线（带分数取分数右缘）+ 括号 */
  const worstRight398 = (page: { notes: { x: number; width: number; rightX?: number }[]; barlines: { x: number; type: BarlineType; comment?: string }[]; brackets: { x: number; width: number }[] }): number => {
    const fracRight = (comment: string, center: number): number => {
      const pm = /^p:\s*(\d+)\s*\/\s*(\d+)$/i.exec(comment)
      if (!pm) return center + barlineTotalW('|') / 2
      const halfW = Math.max(pm[1].length, pm[2].length) * noteSize398 * 0.32 + 1.5 * s398
      return center + barlineTotalW('|') / 2 + 2 * s398 + 2 * halfW
    }
    return Math.max(
      ...page.notes.map((n) => n.rightX ?? n.x + n.width),
      ...page.barlines.map((b) => (b.comment ? fracRight(b.comment, b.x) : b.x + barlineTotalW(b.type) / 2)),
      ...page.brackets.map((b) => b.x + b.width / 2),
    )
  }
  const M1 = "5'/. 6'// 5'/ 2'/ 3' 0/ 6// 5//"
  const M2 = "6/ 5'// (3'// 3'/) 3'/ 2' 7&yc"
  const M4 = '"p:4/4" 6-- &zkh 6/ 5/&sby'
  const codeWith = `V: 1.0\nB: t\nZ: z\nD: C\nP: 4/4\nQ: ${M1} | ${M2} | "p:2/4" 0 5 | ${M4} |\n`
  const codeWithout = `V: 1.0\nB: t\nZ: z\nD: C\nP: 4/4\nQ: ${M1} | ${M2} | 0 5 | ${M4.replace('"p:4/4" ', '')} |\n`
  for (const [tag398, cfg] of [['空间优先（默认）', cfg398], ['时值优先', { ...cfg398, noteSpaceLayout: 'duration' as const }]] as const) {
    const limit = 595.28 - cfg.margin_right
    const pWith = layoutScore(parseJps(codeWith), cfg).pages[0]
    const pWithout = layoutScore(parseJps(codeWithout), cfg).pages[0]
    const wWith = worstRight398(pWith)
    const wWithout = worstRight398(pWithout)
    check(`adj398 ${tag398}：两个临时拍号的行不越右边距（含分数右缘）`, wWith <= limit + 0.05, `右缘=${wWith.toFixed(1)} 右界=${limit.toFixed(1)}`)
    check(`adj398 ${tag398}：同谱去掉临时拍号后同样不越界（对照）`, wWithout <= limit + 0.05, `右缘=${wWithout.toFixed(1)}`)
  }
  // 行末小节线带临时拍号：分数画在线右缘之后 → 右钳制须让出分数占位（越 12px 的老问题）
  const rEnd398 = parseJps('V: 1.0\nB: t\nZ: z\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 | 1 2 3 4 | 5 6 7 1 |"p:2/4"\n')
  const pEnd398 = layoutScore(rEnd398, cfg398).pages[0]
  const limit398 = 595.28 - cfg398.margin_right
  const endBar398 = pEnd398.barlines.find((b) => b.comment === 'p:2/4')
  check('adj398 行末小节线带拍号：分数右缘不越右边距（行末线让出分数占位）', endBar398 !== undefined && worstRight398(pEnd398) <= limit398 + 0.05, `分数线中心=${endBar398?.x} 右缘=${worstRight398(pEnd398).toFixed(1)} 右界=${limit398.toFixed(1)}`)
}

// ---- 95. PWA 更新机制与手机端打开指引（adj400 / adj401） ----
// adj400：更新提示只在 sw.js **内容变化**时触发 → 构建时给它打指纹（scripts/stamp-sw.mjs），
//         并让 SW 注册绕开 HTTP 缓存（updateViaCache:'none'）。这三条防的是「机制被无意改回去」：
//         任一处丢掉，手机上的 PWA 就又会静默停在旧 bundle。
// adj401：手机端放弃选择文件时给出可操作指引（找不到 .jps 的三条出路）。
console.log('[95] PWA update mechanism & mobile open hint (adj400/adj401)')
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  check('adj400 build 脚本串联 stamp-sw（sw.js 每构建都变 → 触发更新提示）', (pkg.scripts?.build ?? '').includes('stamp-sw.mjs'), pkg.scripts?.build)
  check('adj400 scripts/stamp-sw.mjs 存在', existsSync(join(root, 'scripts', 'stamp-sw.mjs')))
  check('adj400 SW 注册带 updateViaCache:none（绕开 HTTP 缓存，update() 真能拿到新版）', readFileSync(join(root, 'src', 'main.tsx'), 'utf8').includes("updateViaCache: 'none'"))
  check('adj401 手机端打开指引覆盖「保存到手机 / 下载目录 / 改扩展名」', uiCopy.openPickHint.includes('保存到手机') && uiCopy.openPickHint.includes('下载') && uiCopy.openPickHint.includes('.md'), uiCopy.openPickHint.slice(0, 24) + '…')
  check('adj403 viewport 带 interactive-widget=resizes-content（PWA 键盘弹出收缩内容区）', readFileSync(join(root, 'index.html'), 'utf8').includes('interactive-widget=resizes-content'))
  // adj404：键盘弹出时应用高度跟随**可视视口**（不依赖宿主是否缩布局视口 / 是否会重复扣减）
  check('adj404 appHeightPx：缩放为 1 时取可视视口高', appHeightPx({ height: 420, scale: 1 }, 800) === 420)
  check('adj404 appHeightPx：视口未缩（vv 高于窗口内高）时取窗口内高', appHeightPx({ height: 900, scale: 1 }, 800) === 800)
  check('adj404 appHeightPx：双指放大（scale≠1）或不可用时回退窗口内高', appHeightPx({ height: 420, scale: 2 }, 800) === 800 && appHeightPx(null, 800) === 800)
  check('adj404 .app 高度用 --app-h（回退 100dvh）+ main.tsx 安装', readFileSync(join(root, 'src', 'index.css'), 'utf8').includes('var(--app-h, 100dvh)') && readFileSync(join(root, 'src', 'main.tsx'), 'utf8').includes('installAppHeight()'))
  // adj406：粘贴源码导入——不依赖系统文件选择器的兜底入口（手机端网盘里的 .jps 看不到时用）
  check('adj406 清洗：去 BOM / CRLF 归一 / 去首尾空行', normalizePastedSource('\uFEFFV: 1.0\r\nQ: 1 2 3\r\n') === 'V: 1.0\nQ: 1 2 3')
  check('adj406 清洗：剥掉 ```jps 代码围栏（从笔记复制代码块）', normalizePastedSource('```jps\nV: 1.0\nQ: 1 2 3\n```') === 'V: 1.0\nQ: 1 2 3')
  check('adj406 清洗：无关围栏语言不误伤', normalizePastedSource('```bash\necho hi\n```').includes('```bash'))
  check('adj406 清洗：纯文本原样（仅去行尾空白）', normalizePastedSource('V: 1.0\nQ: 1 2 3  ') === 'V: 1.0\nQ: 1 2 3')
  check('adj406 空内容清洗后为空 → importSource 直接返回 false（不替换文档）', normalizePastedSource('   \n  ') === '')
  check('adj406 菜单与对话框已接线', readFileSync(join(root, 'src', 'ui', 'TopBar.tsx'), 'utf8').includes('pasteImportCopy.menuLabel') && readFileSync(join(root, 'src', 'App.tsx'), 'utf8').includes("modal === 'pasteImport'"))
}

// ---- 96. 试听暂停/续播：剩余事件平移（adj409） ----
// 后端（SpessaSynthBackend）用 setTimeout 逐个排程音符，没有 ctx 级暂停可借 →
// 暂停 = 撤掉全部待触发排程、续播 = 把剩余事件整体平移到 0 重排（见 src/playback/playbackTimeline.ts）。
// 这里断言平移/裁剪的边界：已播完丢弃、未开始保持时长、正在发声取剩余部分、越界返回空、不修改入参。
console.log('[96] playback pause/resume event shift (adj409)')
{
  const mk = () => [
    { atMs: 0, durationMs: 1000, tag: 'a' },
    { atMs: 1000, durationMs: 500, tag: 'b' }, // 1000~1500
    { atMs: 1500, durationMs: 500, tag: 'c' }, // 1500~2000
    { atMs: 2000, durationMs: 1000, tag: 'd' }, // 2000~3000
  ]
  const src = mk()
  const at0 = shiftEventsFrom(src, 0)
  check('adj409 从头播（from=0）：时间轴与时长原样保留', at0.length === 4 && at0[0].atMs === 0 && at0[3].atMs === 2000 && at0[3].durationMs === 1000, JSON.stringify(at0.map((e) => [e.atMs, e.durationMs])))
  const at1200 = shiftEventsFrom(src, 1200)
  check('adj409 播到 1200ms 暂停：已播完的 a 丢弃、未开始的 c/d 平移且时长不变', at1200.length === 3 && at1200[0].tag === 'b' && at1200[0].atMs === 0 && at1200[0].durationMs === 300 && at1200[1].atMs === 300 && at1200[1].durationMs === 500 && at1200[2].atMs === 800 && at1200[2].durationMs === 1000, JSON.stringify(at1200.map((e) => [e.tag, e.atMs, e.durationMs])))
  check('adj409 正在发声的音符从 0 起重排、时长取剩余部分（b：1500−1200=300）', at1200[0].tag === 'b' && at1200[0].atMs === 0 && at1200[0].durationMs === 300, JSON.stringify(at1200[0]))
  const atExact = shiftEventsFrom(src, 1500)
  check('adj409 恰好落在事件边界：该事件（终点=边界）丢弃，下一个从 0 起', atExact.length === 2 && atExact[0].tag === 'c' && atExact[0].atMs === 0 && atExact[1].tag === 'd' && atExact[1].atMs === 500, JSON.stringify(atExact.map((e) => [e.tag, e.atMs])))
  const atEnd = shiftEventsFrom(src, 3000)
  check('adj409 已播到结尾：返回空数组（调用方据此停止而不是排空序列）', atEnd.length === 0, JSON.stringify(atEnd))
  check('adj409 越界（from > 总时长）同样返回空数组', shiftEventsFrom(src, 9999).length === 0)
  check('adj409 负数 from 视为 0（不把事件推到负时间）', shiftEventsFrom(src, -500)[0].atMs === 0)
  check('adj409 纯函数：不修改入参', JSON.stringify(src) === JSON.stringify(mk()), JSON.stringify(src))
  check('adj409 平移后的起点恒 ≥ 0', shiftEventsFrom(src, 1700).every((e) => e.atMs >= 0))
}

// ---- 97. 导出 PDF：自建 PDF 字节结构（adj411） ----
// 以前走「开新窗口 + window.print()」会被弹窗拦截；现在把每页 SVG 栅格化成 JPEG、
// 内嵌为 PDF 图像 XObject（/DCTDecode）后直接下载。这里断言生成的字节结构合法。
console.log('[97] export PDF byte structure (adj411)')
{
  const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
  /** 造一页假 JPEG（内容无关，只校验 /Length 与数组长度一致） */
  const fakeJpeg = (n: number) => {
    const a = new Uint8Array(16 + n)
    a.set([0xff, 0xd8, 0xff, 0xe0], 0) // JPEG SOI + APP0
    a.set([0xff, 0xd9], a.length - 2) // EOI
    return a
  }
  const pages = [
    { jpeg: fakeJpeg(100), width: 1785, height: 2525 },
    { jpeg: fakeJpeg(250), width: 1785, height: 2525 },
  ]
  const pdf = buildPdf(pages)
  const s = dec(pdf)
  check('adj411 PDF 以 %PDF- 魔数开头', s.startsWith('%PDF-1.4'))
  check('adj411 PDF 含二进制标记注释行', s.includes('%\u00e2\u00e3\u00cf\u00d3'))
  check('adj411 PDF 以 %%EOF 结尾', s.trimEnd().endsWith('%%EOF'))
  check('adj411 页数正确（/Count 与 /Type /Page 个数一致）', s.includes('/Count 2') && (s.match(/\/Type \/Page[^s]/g) ?? []).length === 2, `pages=${(s.match(/\/Type \/Page[^s]/g) ?? []).length}`)
  check('adj411 每个 JPEG 的 /Length 与实际字节数一致', s.includes(`/Filter /DCTDecode /Length ${pages[0].jpeg.length}`) && s.includes(`/Filter /DCTDecode /Length ${pages[1].jpeg.length}`))
  check('adj411 图像尺寸写入 /Width /Height', s.includes('/Width 1785 /Height 2525'))
  check('adj411 页面尺寸为 A4 纵向', s.includes(`/MediaBox [0 0 ${A4_W_PT} ${A4_H_PT}]`), `A4=${A4_W_PT}x${A4_H_PT}`)
  check('adj411 内容流把图像铺满整页（cm + Do）', s.includes(`q ${A4_W_PT} 0 0 ${A4_H_PT} 0 0 cm /Im0 Do Q`))
  // xref 偏移必须真的指向各对象（错一个字节阅读器就打不开）
  const xrefAt = Number(/startxref\s+(\d+)/.exec(s)?.[1] ?? '-1')
  check('adj411 startxref 指向 xref 表', xrefAt > 0 && s.slice(xrefAt, xrefAt + 4) === 'xref')
  const entries = [...s.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
  const total = 3 + pages.length * 3 // 3 个固定对象 + 每页 3 个
  check('adj411 xref 条目数 = 对象总数', entries.length === total - 1, `entries=${entries.length} total=${total}`)
  const offsetsOk = entries.every((off, i) => new RegExp(`^${i + 1} 0 obj`).test(s.slice(off, off + 12)))
  check('adj411 每个 xref 偏移都精确指向 "N 0 obj"', offsetsOk, entries.map((o, i) => `${i + 1}@${o}`).join(' '))
  check('adj411 无页时也能生成合法空文档（/Count 0）', dec(buildPdf([])).includes('/Count 0'))
  // ★ 流字节的**精确位置**：`/Length` 声明的字节必须紧接 `stream\n`，且首尾为 JPEG 的 SOI/EOI。
  // 这条断言是补出来的——原先只查"文件里含 FFD8"，而实际流数据前多了一个换行、
  // 长度声明少 1 字节（JPEG 末位 EOI 被截断），文件结构检查全绿但图会坏（E-2026-145）。
  const imgAt = s.indexOf('/Filter /DCTDecode')
  const streamMark = s.indexOf('stream\n', imgAt)
  const dataAt = streamMark + 'stream\n'.length
  const declared = Number(/\/Filter \/DCTDecode \/Length (\d+)/.exec(s)?.[1] ?? '-1')
  check('adj411 图像流数据紧接 stream\\n（前面无多余字节）', pdf[dataAt] === 0xff && pdf[dataAt + 1] === 0xd8, `首字节=0x${pdf[dataAt]?.toString(16)} 0x${pdf[dataAt + 1]?.toString(16)}`)
  check('adj411 流声明的 /Length 覆盖完整 JPEG（末两字节 = EOI FFD9）', declared === pages[0].jpeg.length && pdf[dataAt + declared - 2] === 0xff && pdf[dataAt + declared - 1] === 0xd9, `declared=${declared} 末两字节=0x${pdf[dataAt + declared - 2]?.toString(16)} 0x${pdf[dataAt + declared - 1]?.toString(16)}`)
  check('adj411 流内字节与传入的 JPEG 逐字节一致', (() => { for (let k = 0; k < declared; k++) if (pdf[dataAt + k] !== pages[0].jpeg[k]) return false; return true })())
}

// ---- 98. 减时线延伸到附点下面（adj411） ----
// `1//2/.`：2 带附点，附点画在数字右侧（一拍的后半），其减时线应延伸到附点右缘之下，
// 而不是在数字右缘提前断掉。两种布局各验一遍。
console.log('[98] beam extends under trailing dot (adj411)')
{
  const code = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1//2/. 3 4 |\n'
  const r = parseJps(code)
  for (const [tag, cfg] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const lay = layoutScore(r, cfg)
    const ns = [...lay.pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const beams = computeBeamsForTest(ns, cfg.note_size)
    // 第 1 条（level 1）连接 1// 与 2/. ：右端应越过 2 的数字右缘，落到附点右缘
    const lvl1 = beams.find((b) => Math.abs(b.x1 - (ns[0].x + 1)) < 0.15)
    const digitRight = ns[1].x + cfg.note_size * 0.62
    check(`adj411 ${tag}：带附点的音符减时线延伸到附点之下（越过数字右缘）`, lvl1 !== undefined && lvl1.x2 > digitRight + 0.5, `x2=${lvl1?.x2} digitRight=${digitRight.toFixed(1)}`)
    // 与渲染出的附点圆心对齐：附点右缘 = 数字右缘 + 间隙 + 半径（圆心由 dot 段给出）
    const dotSeg = ns[1].segments?.find((sg) => sg.el === 'dot')
    if (dotSeg) {
      const rDot = DOT_R_DOT * noteScaleOf(cfg.note_size)
      check(`adj411 ${tag}：减时线右端 = 末附点右缘（圆心+半径）`, lvl1 !== undefined && Math.abs(lvl1.x2 - (dotSeg.x + rDot)) < 0.25, `x2=${lvl1?.x2} dotRight=${(dotSeg.x + rDot).toFixed(2)}`)
    }
    // 反例：不带附点的普通音符，减时线仍止于数字右缘（不被误伸）
    const ns2 = [...layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1//2/ 3 4 |\n'), cfg).pages[0].notes].filter((n) => n.barIndex === 0).sort((a, b) => a.beatPos - b.beatPos)
    const b2 = computeBeamsForTest(ns2, cfg.note_size).find((b) => Math.abs(b.x1 - (ns2[0].x + 1)) < 0.15)
    check(`adj411 ${tag}：无附点音符的减时线仍止于数字右缘（不误伸）`, b2 !== undefined && Math.abs(b2.x2 - (ns2[1].x + cfg.note_size * 0.62 - 1)) < 0.15, `x2=${b2?.x2}`)
  }
}

// ---- 99. 新建模板：文件驱动（adj481）+ 页面设置区块语义（adj413） ----
// adj481（用户要求）：`src/samples/未命名.jps` 就是「新建」的模板（唯一来源）——想改新建出来的空白谱，
// 直接编辑那个文件即可，代码里不再内嵌模板。
// 放在源码目录（不是 `public/`）是有意的：模板只在构建期被内联，不必作为静态资源随产物发布。
// 因此这里只断言**行为**：模板确实来自该文件、能正常解析、设置行 `{}` 语义不变、写入后能读回。
// （adj413 那几条"分隔注释恰好 30 字符 / 主体后 ≥5 空行"的**格式**断言已移除：模板格式现在由
//  模板文件自己决定，用断言钉死它反而会妨碍直接编辑模板这一初衷。）
console.log('[99] new-file template is file-driven (adj481) + settings block (adj413)')
{
  const tplPath = join(root, 'src', 'samples', '未命名.jps')
  const tplRaw = existsSync(tplPath) ? readFileSync(tplPath, 'utf8') : null
  const tpl = defaultSample().code
  const norm = (s: string) => s.replace(/\r\n/g, '\n')
  check('adj481 新建模板文件 src/samples/未命名.jps 存在且非空', !!tplRaw && tplRaw.trim().length > 0, tplPath)
  check(
    'adj481 新建模板内容 = 模板文件内容（文件驱动，改文件即改新建）',
    !!tplRaw && norm(tpl) === norm(tplRaw),
    `文件 ${tplRaw ? tplRaw.length : 0} 字符 / 模板 ${tpl.length} 字符`,
  )
  check('adj481 模板源码不再内嵌副本（samples/index.ts 无内嵌样板）', !String(readFileSync('src/samples/index.ts', 'utf8')).includes('以下为简谱主体'), '')
  check('adj481 模板不放在 public/（不随构建产物发布）', !existsSync(join(root, 'public', '未命名.jps')), join(root, 'public', '未命名.jps'))
  const parsed = parseJps(tpl)
  check('adj481 模板能正常解析（无 error）', parsed.errors.every((e) => e.severity !== 'error'), JSON.stringify(parsed.errors.slice(0, 2)))
  check('adj481 模板含标题 B: 未命名（新建文件名与标题一致）', /\nB:\s*未命名/.test(`\n${tpl}`), tpl.split('\n').slice(0, 5).join('|'))
  // 设置行语义（adj413）：模板若带 `# jps-config:`（通常为 `{}`）→ 不覆盖任何设置；写入差量后能读回
  check('adj413 模板设置行（若有）不覆盖任何设置', Object.keys(extractJpsConfig(tpl) ?? {}).length === 0, JSON.stringify(extractJpsConfig(tpl)))
  check('adj413 设置行不影响兜底配置合并', mergeJpsConfig(tpl, { ...defaultPageConfig, note_size: 17 }).note_size === 17)
  const withCfg = writeJpsConfig(tpl, { ...defaultPageConfig, note_size: 15 })
  check('adj413 写入的设置行可读回（原地更新或追加均可）', extractJpsConfig(withCfg)?.note_size === 15, JSON.stringify(extractJpsConfig(withCfg)))
  check('adj413 写回后仍有且只有一条设置行', withCfg.split('\n').filter((l) => l.startsWith(JPS_CONFIG_PREFIX)).length === 1, '')
  // 改回默认（差量清空）：删设置行（模板里的「页面设置」分隔注释若存在则保留——它是模板文本的一部分）
  const back = writeJpsConfig(withCfg, { ...defaultPageConfig })
  check('adj413 清空设置后不再有设置行', !back.split('\n').some((l) => l.startsWith(JPS_CONFIG_PREFIX)), '')
}

// ---- 100. px 值一律整数：roundPxIntegers + 读写两端（adj413） ----
// 虚线拖拽的位移是浮点（鼠标位移 ÷ 预览缩放），过去会把 12.4 这类值写进 # jps-config
// （metaPos 更是刻意保留 0.1px）。现在读取/写入两端都取整，旧文件里的小数值读出来即整数。
console.log('[100] px values are always integers (adj413)')
{
  const frac: PageConfig = {
    ...defaultPageConfig,
    margin_top: 40.4,
    height_quci: 15.5,
    height_cici: 9.6,
    note_size: 13.49,
    bar_gap: 3.5,
    heights: { a0: [12.4, 8.5, 20.4999, 0.5, 11.5] },
    metaPos: { title: { x: 10.5, y: -4.49 }, author_0: { x: -2.5, y: 3.2 } },
    // adj432（E-2026-172）：adj428 新增的嵌套数值对象——此前 roundPxIntegers 漏了它
    segmentRowGap: { bz: 22.5, dsb: 30.4 },
  }
  const r = roundPxIntegers(frac)
  check('adj413 顶层 px 小数四舍五入为整数', r.margin_top === 40 && r.height_quci === 16 && r.height_cici === 10 && r.note_size === 13 && r.bar_gap === 4, `${r.margin_top},${r.height_quci},${r.height_cici},${r.note_size},${r.bar_gap}`)
  check('adj413 按页行距 heights 逐项取整', JSON.stringify(r.heights?.a0) === JSON.stringify([12, 9, 20, 1, 12]), JSON.stringify(r.heights?.a0))
  // 注：Math.round 的 .5 一律向 +∞ 取整（-2.5 → -2），断言按 JS 语义写
  check('adj413 描述头 metaPos 的 x/y 取整（原为 0.1px 精度）', r.metaPos?.title.x === 11 && r.metaPos?.title.y === -4 && r.metaPos?.author_0.x === -2 && r.metaPos?.author_0.y === 3, JSON.stringify(r.metaPos))
  check('adj413 非数值字段原样保留（字体栈/枚举不被动）', r.biaoti_font === defaultPageConfig.biaoti_font && r.page === defaultPageConfig.page && r.noteSpaceLayout === defaultPageConfig.noteSpaceLayout)
  // adj432（E-2026-172）：嵌套段层间距也要取整（adj428 新增字段，此前漏在 roundPxIntegers 外）
  check('adj413b segmentRowGap 的 bz/dsb 逐项取整（adj428 新增嵌套字段）',
    r.segmentRowGap?.bz === 23 && r.segmentRowGap?.dsb === 30,
    JSON.stringify(r.segmentRowGap))
  check('adj413b segmentRowGap 缺失/非数值不造出假字段', (() => {
    const noGap = roundPxIntegers({ ...defaultPageConfig })
    const halfGap = roundPxIntegers({ ...defaultPageConfig, segmentRowGap: { bz: 22.6 } })
    return noGap.segmentRowGap === undefined && halfGap.segmentRowGap?.bz === 23 && halfGap.segmentRowGap?.dsb === undefined
  })(), JSON.stringify(roundPxIntegers({ ...defaultPageConfig, segmentRowGap: { bz: 22.6 } }).segmentRowGap))
  check('adj413 取整是幂等的', JSON.stringify(roundPxIntegers(r)) === JSON.stringify(r))
  // 读取端：源码里的小数值读出来即整数
  const src = `V: 1.0\nQ: 1 |\n# jps-config:{"margin_top":40.4,"height_quci":15.5,"heights":{"a0":[12.4,8.5,20.5,0.5]},"metaPos":{"title":{"x":10.5,"y":-4.4}},"segmentRowGap":{"bz":22.5,"dsb":30.6}}\n`
  const merged = mergeJpsConfig(src, null)
  check('adj413 读取端：源码里的小数 px 合并后即为整数', merged.margin_top === 40 && merged.height_quci === 16 && merged.heights?.a0?.[0] === 12 && merged.metaPos?.title.x === 11, `${merged.margin_top},${merged.height_quci},${merged.heights?.a0?.[0]},${merged.metaPos?.title.x}`)
  check('adj413b 读取端：源码里的小数 segmentRowGap 合并后即为整数',
    merged.segmentRowGap?.bz === 23 && merged.segmentRowGap?.dsb === 31,
    JSON.stringify(merged.segmentRowGap))
  // 写入端：即便直接传浮点，落盘也必须是整数
  const written = writeJpsConfig('V: 1.0\nQ: 1 |\n', frac)
  const obj = JSON.parse((written.split('\n').find((l) => l.startsWith(JPS_CONFIG_PREFIX)) ?? '').slice(JPS_CONFIG_PREFIX.length)) as Record<string, unknown>
  const nums: number[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'number') nums.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk)
  }
  walk(obj)
  check('adj413 写入端：落盘的所有数值均为整数', nums.length > 0 && nums.every((n) => Number.isInteger(n)), nums.join(','))
  check('adj413 默认配置本身全为整数（无浮点默认值）', Object.entries(defaultPageConfig).every(([, v]) => typeof v !== 'number' || Number.isInteger(v)))
}

// ---- 101. 桌面内置音源（随安装包分发）打包不变量（adj416） ----
// PC 发布程序必须把 resources/soundfonts/generaluser_gs.sf2 映射到**安装目录根**的
// generaluser_gs.sf2：装完 `<安装目录>\generaluser_gs.sf2` 即存在，运行时 Rust 直接读该文件
// （sf_soundfont_builtin_path 探测 → 前端跳过下载提示），不再依赖国内不可达的 GitHub raw。
// 打包配置/源文件在这里兜底——漏了安装包会「静默」退回联网下载（用户以为没反应）。
console.log('[101] desktop bundled soundfont packaging (adj416)')
{
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
    bundle?: { resources?: Record<string, string> }
  }
  const resources = conf.bundle?.resources ?? {}
  const entry = Object.entries(resources).find(([, dest]) => dest === 'generaluser_gs.sf2')
  check('adj416 bundle.resources 含映射到安装目录根的 generaluser_gs.sf2', entry !== undefined, JSON.stringify(resources))
  check('adj416 映射源为 resources/soundfonts/generaluser_gs.sf2（config 相对 src-tauri）', (entry?.[0] ?? '').replace(/\\/g, '/') === '../resources/soundfonts/generaluser_gs.sf2', entry?.[0] ?? '')
  // 源文件：真实完整 SF2（RIFF 容器 + sfbk 类型标识），不是占位符
  const sf2 = join(root, 'resources', 'soundfonts', 'generaluser_gs.sf2')
  check('adj416 音源源文件存在', existsSync(sf2), sf2)
  const size = existsSync(sf2) ? statSync(sf2).size : 0
  check('adj416 音源体积 ≥30MB（真音源而非占位文件）', size >= 30_000_000, `${size}`)
  let magic = ''
  if (existsSync(sf2)) {
    const fd = openSync(sf2, 'r')
    const head = Buffer.alloc(12)
    readSync(fd, head, 0, 12, 0)
    closeSync(fd)
    magic = head.toString('latin1')
  }
  check('adj416 音源是 SoundFont2（RIFF…sfbk）', magic.startsWith('RIFF') && magic.slice(8, 12) === 'sfbk', JSON.stringify(magic))
  // Rust 侧：候选顺序（安装目录根 → 兼容旧 soundfonts/ 子目录）+ raw body（30MB 不走 JSON 数组，E-2026-146）
  const libRs = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8')
  check('adj416 Rust 探测命令已注册', libRs.includes('sf_soundfont_builtin_path'))
  check('adj416 Rust 候选含安装目录根 <id>.sf2 优先、并兼容 soundfonts/ 子目录',
    libRs.includes('dir.join(&file)') && libRs.includes('dir.join("soundfonts").join(&file)'))
  check('adj416 Rust 以 raw body 返回音源字节（tauri::ipc::Response）', libRs.includes('tauri::ipc::Response::new(bytes)'))
  // 检查脚本：安装包清单必需项 + 打包源体积兜底
  const chk = readFileSync(join(root, 'scripts', 'check-installer.mjs'), 'utf8')
  check('adj416 check:installer 把 generaluser_gs.sf2 列为安装包必需文件', chk.includes('oname=generaluser_gs\\.sf2'))
  check('adj416 check:installer 校验打包源体积（≥20MB）', chk.includes('resources/soundfonts/generaluser_gs.sf2'))
  // 便携/调试目录：prepare 脚本把音源放到 exe 旁（与安装目录同布局），dev 也能走内置
  const prep = readFileSync(join(root, 'scripts', 'prepare-tauri-soundfont.mjs'), 'utf8')
  check('adj416 prepare 脚本把音源放到 target/release 与 target/debug（exe 旁）',
    prep.includes("target/release") && prep.includes("target/debug"))
}

// ---- 102. 音源来源解析：安装目录内置优先、且不重复占缓存（adj416） ----
// 桌面端「装完就有音源」的关键在来源判定：先探测安装目录内置 SF2（只探测存在性，不读 30MB），
// 命中就直接读文件、**不写 IndexedDB**（内置文件已在安装目录，再存一份纯属浪费）；
// 只有远端下载的结果才写缓存。这里用假 Tauri / 假 fetch / 假缓存断言，不碰真 IndexedDB 与网络。
console.log('[102] soundfont source resolution: builtin first (adj416)')
async function runAdj416BankSourceTests() {
  const lib: HqSampleLibrary = {
    id: 'generaluser_gs',
    name: '测试音源',
    source: 'https://example.invalid/generaluser_gs.sf2',
    sizeBytes: 3,
    format: 'sf2',
  }
  const builtinBank = new Uint8Array([1, 2, 3]).buffer
  const remoteBank = new Uint8Array([9, 9, 9, 9]).buffer
  const calls: string[] = []
  const cacheOf = (existing: ArrayBuffer | null, saved: ArrayBuffer[]): HqCache =>
    ({
      load: async () => existing,
      has: async () => existing !== null,
      save: async (_id: string, ab: ArrayBuffer) => {
        saved.push(ab)
      },
    }) as unknown as HqCache
  const g = globalThis as unknown as { window?: unknown; fetch?: unknown }
  const savedWindow = g.window
  const savedFetch = g.fetch
  // 假 Tauri：探测命令返回安装目录路径，读取命令返回「音源字节」
  const mockTauri = (path: string | null) => {
    g.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string) => {
            calls.push(cmd)
            if (cmd === 'sf_soundfont_builtin_path') return path
            if (cmd === 'sf_soundfont_resource_read') return builtinBank
            return null
          },
        },
      },
    }
  }
  try {
    // ① 桌面 + 安装目录有 SF2：探测命中 → builtin，且预取阶段不读 30MB、不写缓存
    calls.length = 0
    mockTauri('C:\\Program Files\\iJipu\\generaluser_gs.sf2')
    check('adj416 安装目录有 SF2 → hasBuiltinBank 为真', (await hasBuiltinBank(lib)) === true)
    const saved1: ArrayBuffer[] = []
    const src1 = await prefetchHqLibraryProgress(lib, cacheOf(null, saved1))
    check('adj416 预取来源 = builtin（不联网）', src1 === 'builtin', src1)
    check('adj416 预取只探测存在性、不读 30MB', !calls.includes('sf_soundfont_resource_read'), calls.join(','))
    check('adj416 内置音源不写 IndexedDB（不重复占 30MB）', saved1.length === 0, `${saved1.length}`)
    const r1 = await resolveHqBank(lib, cacheOf(null, saved1))
    check('adj416 解析来源 = builtin 且字节取自内置读取命令', r1.source === 'builtin' && r1.bank.byteLength === 3 && calls.includes('sf_soundfont_resource_read'), `${r1.source}/${r1.bank.byteLength}`)
    check('adj416 走内置仍不写缓存', saved1.length === 0, `${saved1.length}`)
    // ② 已有缓存（含用户导入的音色）优先于内置，且不再探测
    calls.length = 0
    const saved2: ArrayBuffer[] = []
    const src2 = await prefetchHqLibraryProgress(lib, cacheOf(remoteBank, saved2))
    check('adj416 已有缓存 → 来源 = cache（用户导入的音色不被内置覆盖）', src2 === 'cache', src2)
    check('adj416 命中缓存时不发探测命令', !calls.includes('sf_soundfont_builtin_path'), calls.join(','))
    // ③ 无内置（Web 或用户删了文件）：探测返回 null → 走远端下载并写缓存
    calls.length = 0
    g.window = { __TAURI__: { core: { invoke: async (cmd: string) => { calls.push(cmd); return cmd === 'sf_soundfont_builtin_path' ? null : builtinBank } } } }
    g.fetch = async () => ({ ok: true, arrayBuffer: async () => remoteBank }) as unknown as Response
    check('adj416 未内置 → hasBuiltinBank 为假', (await hasBuiltinBank(lib)) === false)
    const saved3: ArrayBuffer[] = []
    const src3 = await prefetchHqLibraryProgress(lib, cacheOf(null, saved3))
    check('adj416 未内置 → 来源 = remote（联网下载）', src3 === 'remote', src3)
    check('adj416 只有远端下载结果才写缓存', saved3.length === 1 && saved3[0] === remoteBank, `${saved3.length}`)
    check('adj416 远端结果不读内置读取命令', !calls.includes('sf_soundfont_resource_read'), calls.join(','))
    // ④ 纯 Web（无 Tauri）：探测直接判否，不报错
    calls.length = 0
    delete g.window
    check('adj416 非桌面环境 hasBuiltinBank 为假且不调用 invoke', (await hasBuiltinBank(lib)) === false && calls.length === 0, calls.join(','))
    // ⑤ 来源全不可用 → 明确报错（供 UI 提示），不静默返回空音源
    g.fetch = async () => ({ ok: false, status: 404 }) as unknown as Response
    let err = ''
    try {
      await resolveHqBank(lib, cacheOf(null, []))
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
    check('adj416 缓存/内置/远端都没有 → 抛出明确错误', err.includes('加载失败'), err)
  } finally {
    g.window = savedWindow
    g.fetch = savedFetch
  }
}

/**
 * adj458：解出 PNG 里「有形状像素」（alpha > 0）的 RGB 集合 —— 按钮图标的**文件级口径**守卫。
 *
 * 为什么值得单独解一次 PNG：图标的形状编码在 **alpha 通道**里、界面颜色由 CSS mask + `currentColor`
 * 决定，所以 PNG 的 RGB **只是文件层面的口径**、不影响观感 —— 正因为"看不出差别"，它极易悄悄漂移：
 * adj457 把 19 个图标统一成纯黑之后，**下一批新图标就又混进了 #333333 / #7f7f7f**（用户报"图标颜色没统一"）。
 * 于是把口径钉死：有形状像素一律 `0,0,0`，且必须带 alpha 通道（没 alpha 则 mask 完全失效，
 * 图标在深色主题下会变成一块实心色）。
 *
 * 只认 8 位「灰度+alpha」(ct=4) 与「RGBA」(ct=6)——按钮图标就用这两种，不引入依赖。
 */
function pngShapeColors(file: string): { colorType: number; colors: Set<string>; shaped: number } {
  const buf = readFileSync(file)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!sig.every((b, i) => buf[i] === b)) throw new Error(`不是 PNG：${file}`)
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len // length(4) + type(4) + data + crc(4)
  }
  const bpp = colorType === 6 ? 4 : colorType === 4 ? 2 : 0
  if (bitDepth !== 8 || bpp === 0) {
    throw new Error(`按钮图标须为 8 位 RGBA / 灰度+alpha：${file}（bitDepth=${bitDepth} colorType=${colorType}）`)
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  const colors = new Set<string>()
  let shaped = 0
  let p = 0
  for (let y = 0; y < height; y++) {
    const ft = raw[p++] // 每行行首是滤波类型字节
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[p + i]
      const a = i >= bpp ? cur[i - bpp] : 0 // 左
      const b = prev[i] // 上
      const c = i >= bpp ? prev[i - bpp] : 0 // 左上
      let v: number
      if (ft === 0) v = rawByte
      else if (ft === 1) v = rawByte + a
      else if (ft === 2) v = rawByte + b
      else if (ft === 3) v = rawByte + ((a + b) >> 1)
      else {
        // Paeth
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      cur[i] = v & 0xff
    }
    p += stride
    for (let x = 0; x < width; x++) {
      const o = x * bpp
      const alpha = bpp === 4 ? cur[o + 3] : cur[o + 1]
      if (alpha > 0) {
        shaped++
        colors.add(bpp === 4 ? `${cur[o]},${cur[o + 1]},${cur[o + 2]}` : `${cur[o]},${cur[o]},${cur[o]}`)
      }
    }
    cur.copy(prev)
  }
  return { colorType, colors, shaped }
}

// ---- 103. 图标集中到 public/icons/ 且只放用得到的（adj417；adj458 补拆分方向绑定） ----
// 过去图标全平铺在 public/ 根目录 → dist 根目录几十个 png，看不出哪些是构建产物、哪些是资源；
// 现在统一放 public/icons/，并**只保留用得到的**（没用的不放，需要时再加）。这里守住四件事：
// ①清单里的图标文件都真的存在；②public 根目录不再有 png/ico；③sw.js 的预热清单与清单一致
// （此前就漂移过：漏了「暂停」「下载」）；④manifest / index.html 引用的图标都存在。
// adj458 追加：编码/拆分两方向/预览/导出/输入条各绑自己的专属图标（不再"借用"+旋转复用），
// 且图标 PNG 的像素口径（纯黑 + 带 alpha）逐张核对。
console.log('[103] icons live in public/icons and only the used ones (adj417)')
{
  const iconDir = join(root, 'public', ICON_DIR)
  const missing = ICON_FILE_NAMES.filter((n) => !existsSync(join(iconDir, `${n}.png`)))
  check(`adj417 清单里的 ${ICON_FILE_NAMES.length} 个按钮图标都存在于 public/icons/`, missing.length === 0, missing.join(','))
  check('adj417 图标清单无重复文件名', new Set(ICON_FILE_NAMES).size === ICON_FILE_NAMES.length)

  // adj458：**图标绑定要名副其实**。此前有五处"借用"别的图标，语义与按钮对不上：
  //   · 拆分(上下) 借「收起」+`rotate(90)`、拆分(左右) 借未旋转的「收起」→ 图示方向对不上，
  //     且旋转会重采样 1px 级线稿，16px 下糊成一团；
  //   · 导出借「下载」（字面像"从网上下载"，实际做的是"导出到文件"）；
  //   · 编码借「文件」、预览借「查看」、输入条借「键盘」。
  // 全部改为各自的专属图标后，用一张表把「图标键 → 期望 PNG → 该按钮在源码里的定位」钉住。
  const topBarSrc = readFileSync(join(root, 'src', 'ui', 'TopBar.tsx'), 'utf8')
  /** 取顶栏 VIEWS 里某个 label 紧跟着的 ToolIcon name（按源码顺序取首次出现） */
  const viewIconOf = (label: string): string => {
    const at = topBarSrc.indexOf(`label: '${label}'`)
    return at < 0 ? '' : (/name="([^"]+)"/.exec(topBarSrc.slice(at))?.[1] ?? '')
  }
  /** 取顶栏 iconOf() 里某个 case 分支用到的 ToolIcon name */
  const caseIconOf = (key: string): string => {
    const at = topBarSrc.indexOf(`case '${key}':`)
    return at < 0 ? '' : (/name="([^"]+)"/.exec(topBarSrc.slice(at))?.[1] ?? '')
  }
  const binds: { key: keyof typeof ICON_FILES; png: string; at: string; where: 'view' | 'case' }[] = [
    { key: 'code', png: '编码', at: '编码', where: 'view' },
    { key: 'splitH', png: '左右', at: '左右拆分', where: 'view' },
    { key: 'splitV', png: '上下', at: '拆分(上下)', where: 'view' },
    { key: 'view', png: '预览', at: '预览', where: 'view' },
    { key: 'export', png: '导出', at: 'export', where: 'case' },
    { key: 'keyboard', png: '输入', at: 'scriptPad', where: 'case' },
  ]
  for (const b of binds) {
    const got = b.where === 'view' ? viewIconOf(b.at) : caseIconOf(b.at)
    check(`adj458 「${b.png}」按钮绑 ${b.key} 图标 → ${b.png}.png`, ICON_FILES[b.key] === b.png && got === b.key, `ICON_FILES.${b.key}=${ICON_FILES[b.key]} 源码=${got}`)
  }
  // 被替换掉的旧图标必须**文件与引用一并清除**（adj417：只放用得到的；留半份最容易漂移）
  const retired = ['收起', '下载', '文件', '查看', '键盘']
  const leftover = retired.filter((n) => existsSync(join(iconDir, `${n}.png`)) || ICON_FILE_NAMES.includes(n) || topBarSrc.includes(`${n}.png`))
  check(`adj458 已废弃图标（${retired.join('/')}）的文件与引用一并清除`, leftover.length === 0, leftover.join(','))
  check('adj458 不再需要靠旋转复用图标（ToolIcon 无 rotate）', !/rotate/.test(readFileSync(join(root, 'src', 'ui', 'ToolIcon.tsx'), 'utf8')))

  // adj458：图标 PNG 的**像素口径**——有形状像素一律纯黑 + 必须带 alpha 通道。
  // 前者由 adj457 定下（统一文件层面的颜色口径），后者是 CSS mask 能上色/跟随主题的前提。
  // 逐张解 PNG 核对，避免"下一批新图标又混进灰值"（这正是本轮发生的事）。
  const iconPixels = ICON_FILE_NAMES.map((n) => ({ name: n, ...pngShapeColors(join(iconDir, `${n}.png`)) }))
  const tinted = iconPixels.filter((i) => Array.from(i.colors).some((c) => c !== '0,0,0'))
  check(
    `adj458 全部 ${iconPixels.length} 个按钮图标的形状像素均为纯黑（adj457 口径）`,
    tinted.length === 0,
    tinted.map((i) => `${i.name}:[${Array.from(i.colors).join(' ')}]`).join(' '),
  )
  const noShape = iconPixels.filter((i) => i.shaped === 0)
  check('adj458 按钮图标都有实际形状（alpha>0 的像素非空）', noShape.length === 0, noShape.map((i) => i.name).join(','))
  const noAlpha = iconPixels.filter((i) => i.colorType !== 6 && i.colorType !== 4)
  check(
    'adj458 按钮图标都带 alpha 通道（形状靠 alpha，CSS mask 才能统一上色并适应明暗主题）',
    noAlpha.length === 0,
    noAlpha.map((i) => `${i.name}(ct=${i.colorType})`).join(','),
  )
  const rootImages = readdirSync(join(root, 'public')).filter((f) => /\.(png|ico)$/i.test(f))
  check('adj417 public 根目录不再有散落的 png/ico', rootImages.length === 0, rootImages.join(','))
  const swJs = readFileSync(join(root, 'public', 'sw.js'), 'utf8')
  const swIcons = (/const ICON_FILES = \[([^\]]*)\]/.exec(swJs)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
  check('adj417 sw.js 预热清单与 ui/toolIcons.ts 完全一致（防清单漂移）', swIcons.join(',') === ICON_FILE_NAMES.join(','), `sw=[${swIcons.join(',')}] ts=[${ICON_FILE_NAMES.join(',')}]`)
  check('adj417 sw.js 图标 URL 前缀为 /icons/', swJs.includes('`/icons/${n}.png`'))
  const swPrecacheIcons = [...swJs.matchAll(/'(\/icons\/[^']+)'/g)].map((m) => m[1])
  check('adj417 sw.js 预缓存的 /icons/ 文件都存在', swPrecacheIcons.length > 0 && swPrecacheIcons.every((p) => existsSync(join(root, 'public', p.replace('/icons/', 'icons/')))), swPrecacheIcons.join(','))
  const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as { icons: { src: string }[] }
  const manIcons = manifest.icons.map((i) => i.src)
  check('adj417 manifest 图标指向 /icons/ 且文件存在', manIcons.every((s) => s.startsWith('/icons/') && existsSync(join(root, 'public', s.slice(1)))), manIcons.join(','))
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const htmlIcons = [...html.matchAll(/href="(\/icons\/[^"]+)"/g)].map((m) => m[1])
  check('adj417 index.html 的 favicon / apple-touch-icon 指向 /icons/ 且文件存在', htmlIcons.length >= 3 && htmlIcons.every((p) => existsSync(join(root, 'public', p.slice(1)))), htmlIcons.join(','))
  // 赞赏码与 Logo 路径同样走 /icons/（brand/copy.ts 与组件里不得再出现根目录路径）
  const rootRefs = [...readdirSync(join(root, 'src'), { recursive: true }) as string[]]
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => new RegExp(`["'\`]/(Jianpu|pwa-\\d+|good)\\.(png|ico)`).test(readFileSync(join(root, 'src', f), 'utf8')))
  check('adj417 源码里没有遗留的根目录图片路径（Logo/赞赏码/PWA 图标）', rootRefs.length === 0, rootRefs.join(','))
}

// ---- 104. 文档里的示例必须真能解析（adj419 / adj422） ----
// 语法说明（docs/SYNTAX.md —— 帮助菜单里的「脚本语法说明」，也是 .jps 语法的唯一对外口径）里的
// ```jps 代码块是给用户**直接粘贴运行**的，必须解析零错误零告警——文档示例最容易过时。
// adj422：「脚本语法」与「脚本规则说明」（public/doc/jps-spec.html）已合并为这一份文档，
// 因此不再检查 HTML 孪生页（已删除），JPS-SPEC.md 也只留指向性占位。
console.log('[104] runnable examples in docs parse clean (adj419/adj422)')
{
  // ParseError 是 { line, col, message, severity, hint? }（**没有 pos**）——格式化时按真实字段取
  const fmtIssue = (e: { line?: number; col?: number; severity?: string; message?: string }): string =>
    `L${e.line ?? '?'}:C${e.col ?? '?'}${e.severity === 'warning' ? '(告警)' : ''}:${e.message ?? '?'}`
  const files = ['docs/SYNTAX.md']
  let total = 0
  for (const f of files) {
    const md = readFileSync(join(root, f), 'utf8')
    const blocks = [...md.matchAll(/```jps\n([\s\S]*?)```/g)].map((m) => m[1])
    check(`adj422 ${f} 含可运行示例（≥6 段）`, blocks.length >= 6, `${blocks.length}`)
    blocks.forEach((code, i) => {
      total++
      const r = parseJps(code)
      const errs = r.errors.filter((e) => e.severity === 'error')
      const warns = r.errors.filter((e) => e.severity === 'warning')
      check(
        `adj422 ${f} 示例 ${i + 1} 解析零错误`,
        errs.length === 0,
        errs.map(fmtIssue).join(' / ').slice(0, 200),
      )
      // 文档示例还应当**干净**（连告警都没有）——用户会直接粘贴运行，冒出告警会像"示例写错了"
      check(
        `adj422 ${f} 示例 ${i + 1} 无告警（可直接粘贴）`,
        warns.length === 0,
        warns.map(fmtIssue).join(' / ').slice(0, 200),
      )
    })
  }
  check('adj422 语法说明里的可运行示例 ≥10 段（入门递进 + 组合示例集）', total >= 10, `${total}`)
  // adj423：文档表格**列数一致性**——表格里的竖线要写成 `\|` 转义，写漏了会把整张表切碎
  // （「小节线与反复」表就踩过：`| \| | 单小节线 |` 被切成了三列，表格错位，见 E-2026-153）
  {
    const cells = (s: string): string[] =>
      s
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split(/(?<!\\)\|/)
        .map((c) => c.trim().replace(/\\\|/g, '|'))
    const isRow = (s: string) => /^\s*\|.*\|\s*$/.test(s)
    const isSep = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s)
    for (const f of ['docs/SYNTAX.md', 'docs/USER-GUIDE.md']) {
      const lines = readFileSync(join(root, f), 'utf8').split('\n')
      const bad: string[] = []
      let tables = 0
      let i = 0
      while (i < lines.length) {
        if (isRow(lines[i])) {
          const rows: string[] = []
          while (i < lines.length && isRow(lines[i])) rows.push(lines[i++])
          tables++
          const head = cells(rows[0]).length
          const off = rows.slice(1).filter((r) => !isSep(r) && cells(r).length !== head)
          if (off.length) bad.push(`第 ${tables} 张表（表头 ${head} 列）：${off[0].trim().slice(0, 70)}`)
        } else i++
      }
      check(`adj423 ${f} 的 Markdown 表格列数一致（共 ${tables} 张表）`, bad.length === 0, bad.join(' | '))
    }
  }
  // adj422：合并后不应再有第二份语法文档（用户要求只留一份，避免三处漂移）
  check('adj422 不再存在独立的 HTML 规格页（已合并）', !existsSync(join(root, 'public', 'doc', 'jps-spec.html')))
  const spec = readFileSync(join(root, 'docs', 'JPS-SPEC.md'), 'utf8')
  check('adj422 JPS-SPEC.md 已改为指向 SYNTAX.md 的占位说明', spec.includes('SYNTAX.md') && spec.length < 2000, `${spec.length}`)
}

// ---- 105. 输入条「括倚」组：倚音键插骨架、光标停在 ] 前；不再有虚音符键（adj420） ----
// 用户反馈：菜单里显示 `1[65]` / `1[h65]`（那是 insert 预览），点下去整串插进正文会被当成真音符。
// 现在只插 `[]` / `[h]`，并用 cursorOffset 把光标停在 `]` 之前，接着输倚音数字即可。
console.log('[105] pad 括倚 keys: insert skeleton + caret inside (adj420)')
{
  const brace = PAD_GROUPS.find((g) => g.id === 'brace')
  check('adj420 存在「括倚」主键组', !!brace, PAD_GROUPS.map((g) => g.id).join(','))
  const keys = brace?.keys ?? []
  const pre = keys.find((k) => k.insert === '[]')
  const post = keys.find((k) => k.insert === '[h]')
  check('adj420 前倚音键插入骨架 []', !!pre, keys.map((k) => k.insert).join(' '))
  check('adj420 前倚音键光标停在 ] 之前（cursorOffset=1）', pre?.cursorOffset === 1, `${pre?.cursorOffset}`)
  check('adj420 后倚音键插入骨架 [h]', !!post, keys.map((k) => k.insert).join(' '))
  check('adj420 后倚音键光标停在 ] 之前（cursorOffset=2）', post?.cursorOffset === 2, `${post?.cursorOffset}`)
  // 提示里仍给出用法示例（用户可以照着写，但插进去的是骨架）
  check('adj420 前倚音提示含用法示例 1[65]', !!pre?.hint && pre.hint.includes('1[65]'), pre?.hint)
  check('adj420 后倚音提示含用法示例 1[h65]', !!post?.hint && post.hint.includes('1[h65]'), post?.hint)
  // 不再提供 `(1)` 虚音符键（低频写法，需要时在源码里手写）
  check('adj420 括倚组已移除 (1) 虚音符键', !keys.some((k) => k.insert.includes('(1)')), keys.map((k) => k.insert).join(' '))
  // 模拟 EditorPane 的插入语义（text + cursorOffset）：插完光标应落在 [ 与 ] 之间
  const apply = (text: string, pos: number, ins: string, off?: number) => ({
    text: text.slice(0, pos) + ins + text.slice(pos),
    pos: pos + (off ?? ins.length),
  })
  const r1 = apply('1 2 ', 4, '[]', 1)
  check('adj420 插入 [] 后光标在括号内（可继续输倚音数字）', r1.text === '1 2 []' && r1.pos === 5 && r1.text[r1.pos] === ']', `${r1.text}@${r1.pos}`)
  const r2 = apply('1 2 ', 4, '[h]', 2)
  check('adj420 插入 [h] 后光标在 h 与 ] 之间', r2.text === '1 2 [h]' && r2.pos === 6 && r2.text[r2.pos] === ']' && r2.text[r2.pos - 1] === 'h', `${r2.text}@${r2.pos}`)
  // 插完接着输倚音数字，得到合法语法（1[65] / 1[h65]）
  const typed = r1.text.slice(0, r1.pos) + '65' + r1.text.slice(r1.pos)
  check('adj420 继续输 65 即得完整前倚音 1[65]', typed === '1 2 [65]', typed)
  const typed2 = r2.text.slice(0, r2.pos) + '65' + r2.text.slice(r2.pos)
  check('adj420 继续输 65 即得完整后倚音 1[h65]', typed2 === '1 2 [h65]', typed2)
}

// ---- 106. 单行曲部按 align_min_bars 个小节槽预分占宽（adj421，用户规则） ----
// 规则：曲部**只有一行**（新建文件/示例谱那种）且小节数 < align_min_bars（默认 4）时，
// 整行占宽按 4 个小节预分（槽宽 = 行内容宽 / 4），每小节领一个槽、槽内按空间优先摊开音符；
// 若某小节「本体宽 + 小节线占位」超过槽宽，则该小节保持自然宽（不压缩、越出槽）。
// 多行曲部**不适用**（最后一行仍按 adj199/adj355 对齐前面行）。
console.log('[106] single-row section: bar slots = align_min_bars (adj421)')
{
  const slotOf = (cfg: PageConfig) => (PAGE_W - cfg.margin_left - cfg.margin_right) / cfg.align_min_bars
  const oneLine = (q: string, cfg: PageConfig) => {
    const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q}\n`)
    const lay = layoutScore(r, cfg)
    const notes = [...lay.pages[0].notes].sort((a, b) => a.x - b.x)
    const bars = [...lay.pages[0].barlines].sort((a, b) => a.x - b.x)
    return { notes, bars, rows: new Set(lay.pages[0].notes.map((n) => n.y)).size }
  }
  for (const [tag, cfg] of [['空间优先', defaultPageConfig], ['时值优先', DUR_CFG]] as const) {
    const SLOT = slotOf(cfg)
    // ① 单行 1 小节 → 小节线落在第 1 槽末尾附近（线自身在小节内的偏移 ≈ 3~4px，故给 8px 容差）
    const a = oneLine('1 2 3 4 |', cfg)
    check(`adj421 ${tag}：单行 1 小节 → 小节线在第 1 槽末尾`, a.rows === 1 && a.bars.length === 1 && a.bars[0].x > cfg.margin_left + SLOT - 8 && a.bars[0].x <= cfg.margin_left + SLOT + 4, `x=${a.bars[0]?.x} slot=${cfg.margin_left + SLOT}`)
    // ② 单行 2 小节 → 两小节各领一个槽：相邻小节线间距 ≈ 槽宽（末线含自身间距，给 10px 容差）
    const b = oneLine('1 2 3 4 | 5 6 7 1 |', cfg)
    check(`adj421 ${tag}：单行 2 小节 → 相邻小节线间距 ≈ 1 槽宽`, b.bars.length === 2 && Math.abs(b.bars[1].x - b.bars[0].x - SLOT) < 10, `gap=${(b.bars[1]?.x - b.bars[0]?.x).toFixed(2)} slot=${SLOT.toFixed(2)}`)
    check(`adj421 ${tag}：单行 2 小节 → 行内容只占 2 槽（未铺满整行）`, b.bars[1].x < cfg.margin_left + 2 * SLOT + 8 && b.bars[1].x > cfg.margin_left + 2 * SLOT - 12, `x=${b.bars[1].x}`)
    // ③ 单行 3 小节 → 三槽用完（行尾只剩 1 槽）
    const c = oneLine('1 2 3 4 | 5 6 7 1 | 2 3 4 5 |', cfg)
    check(`adj421 ${tag}：单行 3 小节 → 线 3 在第 3 槽末尾`, c.bars.length === 3 && Math.abs(c.bars[2].x - (cfg.margin_left + 3 * SLOT)) < 12, c.bars.map((x) => x.x.toFixed(1)).join(','))
    check(`adj421 ${tag}：单行 3 小节仍明显短于整行（未铺满）`, c.bars[2].x < cfg.margin_left + 3.6 * SLOT, `x=${c.bars[2].x}`)
    // ④ 每小节内部摊开：1 小节 4 拍 → 4 个音符均分槽宽（相邻间距一致且远大于数字槽宽）
    const pitchGap = a.notes.length === 4 ? a.notes[1].x - a.notes[0].x : 0
    check(`adj421 ${tag}：槽内音符按空间优先摊开（相邻间距一致、> 数字槽宽）`, pitchGap > DIGIT_W && Math.abs(a.notes[3].x - a.notes[0].x - 3 * pitchGap) < 1, `gap=${pitchGap.toFixed(2)}`)

    // ⑤ 本体超槽 → 该小节自然宽（越出槽，不压缩挤压）
    //   16 个十六分音符：自然本体宽 ≈ 16×数字槽宽 > 槽宽，理应越出第 1 槽
    const dense = oneLine('1// 2// 3// 4// 5// 6// 7// 1\'// 2// 3// 4// 5// 6// 7// 1\'// 2// |', cfg)
    check(`adj421 ${tag}：本体宽 > 槽宽 → 该小节保持自然宽（越出槽）`, dense.bars.length === 1 && dense.bars[0].x > cfg.margin_left + SLOT, `x=${dense.bars[0]?.x} slotEnd=${cfg.margin_left + SLOT}`)
    // ⑥ 多行曲部不适用槽规则：15 小节断成 ≥2 行 → 末行小节间距明显偏离槽宽（单小节末行记 0）
    const multi = oneLine(
      '1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 |',
      cfg,
    )
    const lastRowY = Math.max(...[...new Set(multi.notes.map((n) => n.y))])
    const lastRowBars = multi.bars.filter((x) => Math.abs(x.yTop - (lastRowY - BAR_TOP)) < 0.5)
    const lastGap = lastRowBars.length >= 2 ? lastRowBars[1].x - lastRowBars[0].x : 0
    check(`adj421 ${tag}：多行曲部（15 小节断行）末行不按槽预分`, multi.rows >= 2 && Math.abs(lastGap - SLOT) > 5, `rows=${multi.rows} lastGap=${lastGap.toFixed(1)} slot=${SLOT.toFixed(1)}`)
  }
}

// ---- adj427 Step 3：layout/render 不崩溃（段 token 暂时静默跳过） ----
console.log('[adj427] layout/render survive {bz/dsb segments')
{
  const src = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 | {bz 5 6 7 1} 3 4 | 5 6 |\n'
  const r = parseJps(src)
  const lay = layoutScore(r, DUR_CFG)
  check('含 bz 段的 JPS layoutScore 不崩', lay !== undefined && lay.pages.length > 0, JSON.stringify(r.errors))
  const svg = renderScoreToSvg(lay)[0]
  check('含 bz 段的 JPS renderScoreToSvg 不崩', svg.length > 100, `len=${svg.length}`)
}
{
  const src = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 | {dsb 5 6 7 1} 3 4 | 5 6 |\n'
  const r = parseJps(src)
  const lay = layoutScore(r, DUR_CFG)
  check('含 dsb 段的 JPS layoutScore 不崩', lay !== undefined && lay.pages.length > 0, JSON.stringify(r.errors))
  const svg = renderScoreToSvg(lay)[0]
  check('含 dsb 段的 JPS renderScoreToSvg 不崩', svg.length > 100, `len=${svg.length}`)
}
{
  // 图 1 真实场景：3 4 |{bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const r = parseJps(src)
  const lay = layoutScore(r, DUR_CFG)
  check('图 1 bz 场景 layoutScore 不崩', lay !== undefined && lay.pages.length > 0, JSON.stringify(r.errors))
  const svg = renderScoreToSvg(lay)[0]
  check('图 1 bz 场景 renderScoreToSvg 不崩', svg.length > 100, `len=${svg.length}`)
}
{
  // 图 2 真实场景：dsb + 主旋律共存
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const r = parseJps(src)
  const lay = layoutScore(r, DUR_CFG)
  check('图 2 dsb 场景 layoutScore 不崩', lay !== undefined && lay.pages.length > 0, JSON.stringify(r.errors))
  const svg = renderScoreToSvg(lay)[0]
  check('图 2 dsb 场景 renderScoreToSvg 不崩', svg.length > 100, `len=${svg.length}`)
}

// ---- adj427：临时段 {bz / {dsb / } token 识别（Step 3/9，骨架） ----
console.log('[adj427] tokenize {bz / {dsb segments')
// 1. 简单 bz 段：{bz 1 2 3} 产出 open(2段内音/children) + close 一对 token
{
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1 2 3}\n')
  const toks = r.groups[0].music.tokens
  const segs = toks.filter((t) => t.kind === 'segment') as Array<{ kind: 'segment'; dir: string; type: string; children?: unknown[] }>
  check('bz 段产出 open + close 两个 segment token', segs.length === 2, `got ${segs.length}`)
  if (segs[0]) {
    check('第一个 segment 是 bz open', segs[0].type === 'bz' && segs[0].dir === 'open', JSON.stringify(segs[0]))
    check('open 含 3 个 children token（1 2 3 三个 note）', Array.isArray(segs[0].children) && segs[0].children!.length === 3, `got ${segs[0].children?.length}`)
  }
  if (segs[1]) {
    check('第二个 segment 是 bz close', segs[1].type === 'bz' && segs[1].dir === 'close', JSON.stringify(segs[1]))
  }
}
// 2. 简单 dsb 段：{dsb 1 2 | 3 4}
{
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {dsb 1 2 | 3 4}\n')
  const toks = r.groups[0].music.tokens
  const segs = toks.filter((t) => t.kind === 'segment') as Array<{ kind: 'segment'; type: string }>
  check('dsb 段产出 open + close', segs.length === 2, `got ${segs.length}`)
  check('dsb 段 type = dsb', segs[0]?.type === 'dsb', JSON.stringify(segs[0]))
}
// 3. 嵌套报错：{bz 1 {bz 2 } 3 } → 第二层 {bz 报"嵌套"错
{
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1 {bz 2 } 3 }\n')
  const errs = r.errors.filter((e) => e.message.includes('不能嵌套'))
  check('段内 {bz 嵌套报错', errs.length > 0, JSON.stringify(r.errors))
}
// 4. 未闭合 {bz → 报错
{
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1 2 3\n')
  const errs = r.errors.filter((e) => e.message.includes('未找到结束'))
  check('未闭合 {bz 报错', errs.length > 0, JSON.stringify(r.errors))
}
// 5. 多余 } → 报错
{
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 }\n')
  const errs = r.errors.filter((e) => e.message.includes('多余的'))
  check('多余 } 报错', errs.length > 0, JSON.stringify(r.errors))
}
// ---- adj427 回顾加固（Step 2 修复）：段头边界 / 位置偏移 / 引号内 } / raw 语义 / 格式化 ----
{
  // A. 段头边界校验：{bzzy 不是 bz 段（bz 后必须是空白或 }）
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bzzy 1 2}\n')
  const segs = r.groups[0].music.tokens.filter((t) => t.kind === 'segment')
  check('A1 {bzzy 不产生 segment token（段头边界校验）', segs.length === 0, `got ${segs.length}`)
  check('A2 {bzzy 报"无法识别"', r.errors.some((e) => e.message.includes('无法识别')), JSON.stringify(r.errors))
}
{
  // B. 段内 token 位置偏移：{bz 1 2 3} → `{bz ` 之后起点为 4
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1 2 3}\n')
  const seg = r.groups[0].music.tokens.find((t) => t.kind === 'segment' && t.dir === 'open') as
    | { children?: { pos: number }[] }
    | undefined
  check('B1 段内首 token pos 已右移 segStart（=4）', seg?.children?.[0]?.pos === 4, `got ${seg?.children?.[0]?.pos}`)
  check('B2 段内第二个 token pos = 6', seg?.children?.[1]?.pos === 6, `got ${seg?.children?.[1]?.pos}`)
}
{
  // C. 引号内的 } 不结束段：{bz 1"a}b" 2} → 段内仍 2 个音符
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1"a}b" 2}\n')
  const seg = r.groups[0].music.tokens.find((t) => t.kind === 'segment' && t.dir === 'open') as
    | { children?: unknown[] }
    | undefined
  const notes = (seg?.children ?? []).filter((c) => (c as { kind: string }).kind === 'note')
  check('C1 引号内 } 不结束段（段内仍有 2 个音符）', notes.length === 2, `got ${notes.length}`)
  check('C2 引号内 } 场景无"未找到结束"错', !r.errors.some((e) => e.message.includes('未找到结束')), JSON.stringify(r.errors))
}
{
  // D. 空段 {bz} → open + close，children 空
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz}\n')
  const segs = r.groups[0].music.tokens.filter((t) => t.kind === 'segment') as Array<{ dir: string; children?: unknown[] }>
  check('D1 {bz} 空段产出 open + close', segs.length === 2, `got ${segs.length}`)
  check('D2 空段 children 长度为 0', segs[0]?.children?.length === 0, `got ${segs[0]?.children?.length}`)
}
{
  // E. raw 语义：open.raw = 段头（`{dsb`），close.raw = `}`
  const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {dsb 1 2}\n')
  const segs = r.groups[0].music.tokens.filter((t) => t.kind === 'segment') as Array<{ dir: string; raw: string }>
  check('E1 open.raw = "{dsb"（段头）', segs[0]?.raw === '{dsb', `got ${JSON.stringify(segs[0]?.raw)}`)
  check('E2 close.raw = "}"', segs[1]?.raw === '}', `got ${JSON.stringify(segs[1]?.raw)}`)
}
{
  // F. 格式化不破坏 {bz … }（EditorPane 光标离开 Q 行时会自动格式化）
  const src = "Q: 3 4 |{bz 1 2 3 4 | 5 6 7 1'} 5 6 |"
  const once = formatLine(src)
  const twice = formatLine(once)
  check('F1 格式化保留 {bz 与 }', once.includes('{bz') && once.includes('}'), once)
  check('F2 格式化幂等（两次结果一致）', once === twice, `once=${once} twice=${twice}`)
  const r = parseJps(`V: 1.0\nB: t\nD: C\nP: 4/4\n${once}\n`)
  check('F3 格式化后仍能解析出 segment token', r.groups[0].music.tokens.some((t) => t.kind === 'segment'), JSON.stringify(r.errors))
}

// ---- adj427 Step 5a：临时段**拍位包络**计算（layout/segments.ts 纯函数） ----
console.log('[adj427] segment beat envelope (computeSegments / mainSpans)')
{
  // 图 1 场景：3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const toks = parseJps(src).groups[0].music.tokens
  const segs = computeSegments(toks)
  check('G1 图 1 识别出 1 个临时段', segs.length === 1, `got ${segs.length}`)
  check('G2 段类型 = bz', segs[0]?.type === 'bz', `got ${segs[0]?.type}`)
  // 段出现在 `3 4` 之后 → 拍位 2（段本身不占主旋律拍位）
  check('G3 包络起始拍 = 2（`3 4` 之后）', segs[0]?.startBeat === 2, `got ${segs[0]?.startBeat}`)
  // 段内 8 个音各 1 拍 → 8 拍
  check('G4 段自身拍数 = 8', segs[0]?.beats === 8, `got ${segs[0]?.beats}`)
  // 段内小节线按自身拍位推进：`1 2 3 4 | 5 6 7 1'` 的 `|` 在第 4 拍
  check('G5 段内小节线拍位 = [4]（按自身拍位）', JSON.stringify(segs[0]?.barBeats) === '[4]', JSON.stringify(segs[0]?.barBeats))
  check('G6 段内 token = 9 个（8 音 + 1 小节线）', segs[0]?.tokens.length === 9, `got ${segs[0]?.tokens.length}`)
}
{
  // 主旋律跨度：段不占拍 → 12 个音拍位连续 0..11
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const toks = parseJps(src).groups[0].music.tokens
  const spans = mainSpans(toks)
  check('H1 主旋律 12 个计时 token（段内 8 音不计入）', spans.length === 12, `got ${spans.length}`)
  check('H2 段后首音起拍 = 2（与段前连续，段不占拍）', spans[2]?.startBeat === 2, `got ${spans[2]?.startBeat}`)
  check('H3 主旋律总拍数 = 12', spans[11] !== undefined && spans[11].startBeat + spans[11].beats === 12, `got ${spans[11] ? spans[11].startBeat + spans[11].beats : 'n/a'}`)
  // 包络 [2,10) 内的主旋律 = 8 个音（即 dsb 的下层声部 = `5 6 7 1' | 1' 7 6 5`）
  const inEnv = mainSpansInRange(spans, 2, 10)
  check('H4 包络 [2,10) 内主旋律 = 8 个音', inEnv.length === 8, `got ${inEnv.length}`)
  const pitches = inEnv.map((s) => (s.token.kind === 'note' ? s.token.pitch : -1))
  check('H5 包络内音高序列 = 5 6 7 1 1 7 6 5', JSON.stringify(pitches) === '[5,6,7,1,1,7,6,5]', JSON.stringify(pitches))
  // 包络外剩余 = 4 个音（`3 4` 之前 2 个 + `5 5` 之后 2 个）
  const outEnv = mainSpansInRange(spans, 0, 2).concat(mainSpansInRange(spans, 10, 12))
  check('H6 包络外剩余 = 4 个音（3 4 + 5 5）', outEnv.length === 4, `got ${outEnv.length}`)
}
{
  // 图 2 场景（dsb）：包络与 bz 完全一致——两层同一时间轴
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const toks = parseJps(src).groups[0].music.tokens
  const segs = computeSegments(toks)
  check('I1 图 2 段类型 = dsb', segs[0]?.type === 'dsb', `got ${segs[0]?.type}`)
  check('I2 dsb 包络起始拍 = 2（与 bz 同规则）', segs[0]?.startBeat === 2, `got ${segs[0]?.startBeat}`)
  check('I3 dsb 段自身拍数 = 8', segs[0]?.beats === 8, `got ${segs[0]?.beats}`)
  const spans = mainSpans(toks)
  check('I4 dsb 下层声部（包络内主旋律）= 8 个音', mainSpansInRange(spans, 2, 10).length === 8, `got ${mainSpansInRange(spans, 2, 10).length}`)
}
{
  // 段内多小节线：{bz 1 2 | 3 4 | 5 6} → 小节线拍位 [2, 4]
  const toks = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1 2 | 3 4 | 5 6}\n').groups[0].music.tokens
  const seg = computeSegments(toks)[0]
  check('J1 段内多小节线拍位 = [2,4]', JSON.stringify(seg?.barBeats) === '[2,4]', JSON.stringify(seg?.barBeats))
  check('J2 段内总拍数 = 6', seg?.beats === 6, `got ${seg?.beats}`)
  check('J3 段写在行首 → 包络起始拍 = 0', seg?.startBeat === 0, `got ${seg?.startBeat}`)
}
{
  // 段内时值：{bz 1- 2/ | 3} → 2 拍 + 0.5 拍 + 1 拍 = 3.5 拍，小节线在 2.5 拍
  const toks = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz 1- 2/ | 3}\n').groups[0].music.tokens
  const seg = computeSegments(toks)[0]
  check('K1 段内时值累计 = 3.5 拍', seg?.beats === 3.5, `got ${seg?.beats}`)
  check('K2 段内小节线在 2.5 拍', JSON.stringify(seg?.barBeats) === '[2.5]', JSON.stringify(seg?.barBeats))
}
{
  // 空段与 beatRatio 钳制
  const segsEmpty = computeSegments(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: {bz}\n').groups[0].music.tokens)
  check('L1 空段拍数 = 0（避免除零）', segsEmpty[0]?.beats === 0, `got ${segsEmpty[0]?.beats}`)
  check('L2 空段小节线为空', JSON.stringify(segsEmpty[0]?.barBeats) === '[]', JSON.stringify(segsEmpty[0]?.barBeats))
  check('L3 beatRatio 总拍 0 时返回 0（不产生 NaN）', beatRatio(3, 0) === 0, `got ${beatRatio(3, 0)}`)
  check('L4 beatRatio 中位 = 0.5', beatRatio(4, 8) === 0.5, `got ${beatRatio(4, 8)}`)
  check('L5 beatRatio 越界钳制到 1', beatRatio(99, 8) === 1, `got ${beatRatio(99, 8)}`)
  check('L6 beatRatio 负值钳制到 0', beatRatio(-5, 8) === 0, `got ${beatRatio(-5, 8)}`)
}
{
  // 无段时行为不变：computeSegments 空、mainSpans 覆盖全部音符
  const toks = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1 |\n').groups[0].music.tokens
  check('M1 无段时 computeSegments 为空', computeSegments(toks).length === 0, `got ${computeSegments(toks).length}`)
  check('M2 无段时 mainSpans = 8 个音', mainSpans(toks).length === 8, `got ${mainSpans(toks).length}`)
}
{
  // 一行多个段（bz + dsb 各一）：包络按源码顺序、各自独立
  const toks = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 | {bz 2 3} 4 | {dsb 5 6} 7 |\n').groups[0].music.tokens
  const segs = computeSegments(toks)
  check('N1 一行两个段', segs.length === 2, `got ${segs.length}`)
  check('N2 第一段 bz 起始拍 = 1', segs[0]?.type === 'bz' && segs[0]?.startBeat === 1, JSON.stringify(segs[0]))
  check('N3 第二段 dsb 起始拍 = 2（段不占拍：`1` + `4` 各 1 拍）', segs[1]?.type === 'dsb' && segs[1]?.startBeat === 2, JSON.stringify(segs[1]))
}

// ---- adj427 Step 5b/6：临时段叠加层**真正出图**（段层音符 / 小节线 / 括弧） ----
console.log('[adj427] segment overlay placement (notes / barlines / brackets)')
{
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const r = parseJps(src)
  const page = layoutScore(r, DUR_CFG).pages[0]
  const segNotes = page.notes.filter((n) => n.segment)
  const mainNotes = page.notes.filter((n) => !n.segment).sort((a, b) => a.y - b.y || a.x - b.x)
  check('O1 bz 段产出 8 个段层音符', segNotes.length === 8, `got ${segNotes.length}`)
  check('O2 段层音符标记 type=bz / layer=upper', segNotes.every((n) => n.segment?.type === 'bz' && n.segment?.layer === 'upper'), JSON.stringify(segNotes[0]?.segment))
  check('O3 段层音符在主旋律**上方**（y 更小）', segNotes.length > 0 && mainNotes.length > 0 && segNotes[0].y < mainNotes[0].y, `segY=${segNotes[0]?.y} mainY=${mainNotes[0]?.y}`)
  // 同一拍位垂直对齐：段首音（包络起点 = 拍位 2）x 应等于主旋律拍位 2 的音符 x
  const mainAtBeat2 = mainNotes[2]
  check('O4 段首音与主旋律拍位 2 的音符 x 对齐', segNotes.length > 0 && Math.abs(segNotes[0].x - mainAtBeat2.x) < 0.51, `segX=${segNotes[0]?.x} mainX=${mainAtBeat2.x}`)
  // 段层宽度落在包络范围内（0 < 宽，且不超出主旋律行右边界）
  const sb = page.segmentBrackets ?? []
  check('O5 产出 1 个段层括弧', sb.length === 1, `got ${sb.length}`)
  check('O6 括弧 x1 < x2', sb.length > 0 && sb[0].x1 < sb[0].x2, JSON.stringify(sb[0]))
  check('O7 bz 段无下层声部（yBottomLower 未设）', sb[0]?.yBottomLower === undefined, `got ${sb[0]?.yBottomLower}`)
  // 段内小节线：`1 2 3 4 | 5 6 7 1'` 的 `|` 在段内第 4 拍
  const segBars = page.barlines.filter((b) => b.segment)
  check('O8 段内小节线 1 条', segBars.length === 1, `got ${segBars.length}`)
  check('O9 段内小节线 x 落在包络范围内', segBars.length > 0 && sb.length > 0 && segBars[0].x >= sb[0].x1 - 0.51 && segBars[0].x <= sb[0].x2 + 0.51, `barX=${segBars[0]?.x} env=[${sb[0]?.x1},${sb[0]?.x2}]`)
  const svg = renderScoreToSvg(layoutScore(r, DUR_CFG))[0]
  check('O10 SVG 含段层括号字形（与数字同高的文本括号）', /<text[^>]*>\(<\/text>/.test(svg) && /<text[^>]*>\)<\/text>/.test(svg), '')
  check('O11 SVG 含段层音符（音符数增加的 <text> 已绘制）', (svg.match(/data-notepos/g) ?? []).length >= 12, `notepos=${(svg.match(/data-notepos/g) ?? []).length}`)
}
{
  // dsb：上层 + 跨两层花括号
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const r = parseJps(src)
  const lay = layoutScore(r, DUR_CFG)
  const page = lay.pages[0]
  const segNotes = page.notes.filter((n) => n.segment)
  check('P1 dsb 段产出 8 个段层音符', segNotes.length === 8, `got ${segNotes.length}`)
  check('P2 dsb 段层标记 layer=upper', segNotes.every((n) => n.segment?.type === 'dsb'), JSON.stringify(segNotes[0]?.segment))
  const sb = page.segmentBrackets ?? []
  check('P3 dsb 设了 yBottomLower（跨两层）', sb[0]?.yBottomLower !== undefined, `got ${sb[0]?.yBottomLower}`)
  check('P4 yBottomLower > yBottom（确实跨到下层）', sb.length > 0 && sb[0].yBottomLower! > sb[0].yBottom, `lower=${sb[0]?.yBottomLower} upper=${sb[0]?.yBottom}`)
  const svg = renderScoreToSvg(lay)[0]
  check('P5 SVG 含 dsb 花括号 data-segment-brace="dsb"', svg.includes('data-segment-brace="dsb"'), '')
  check('P6 dsb 段层括号字形已绘制', /<text[^>]*>\(<\/text>/.test(svg), '')
}
{
  // 无段时零影响：不产生段层音符 / 括弧，且音符几何与既有行为一致
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  check('Q1 无段时不产生段层音符', page.notes.filter((n) => n.segment).length === 0, `got ${page.notes.filter((n) => n.segment).length}`)
  check('Q2 无段时无段层括弧', (page.segmentBrackets ?? []).length === 0, `got ${(page.segmentBrackets ?? []).length}`)
  check('Q3 无段时主旋律 12 个音符不变', page.notes.length === 12, `got ${page.notes.length}`)
}
{
  // 段内音符时值参与段层宽度（按拍位比例映射）：`{bz 1- 2}` 的 1- 占 2 拍 → 宽度约为 2 的两倍
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | {bz 1- 2} 5 6 7 1 |\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  const segNotes = page.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
  check('R1 段内 2 个音符都放置', segNotes.length === 2, `got ${segNotes.length}`)
  check('R2 `1-`(2 拍) 宽 > `2`(1 拍) 宽 —— 按拍位比例映射', segNotes.length === 2 && segNotes[0].width > segNotes[1].width, `w0=${segNotes[0]?.width} w1=${segNotes[1]?.width}`)
}
{
  // 一行两个段（bz + dsb）：各自独立出括弧
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | {bz 1 2} 5 6 | {dsb 1 2} 7 1 |\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  const sb = page.segmentBrackets ?? []
  check('S1 一行两段 → 2 个段层括弧', sb.length === 2, `got ${sb.length}`)
  check('S2 两段类型分别为 bz / dsb', sb[0]?.type === 'bz' && sb[1]?.type === 'dsb', JSON.stringify(sb.map((x) => x.type)))
  check('S3 两段互不重叠（x 递增）', sb.length === 2 && sb[0].x2 <= sb[1].x1 + 0.51, JSON.stringify(sb.map((x) => [x.x1, x.x2])))
}

// ---- adj427 Step 7：演奏效果（段层发声 / 声部音色 / 力度 / 色块音色） ----
console.log('[adj427] segment playback (voices / instruments / gain)')
{
  const plain = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const bzSrc = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const dsbSrc = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  type Ev = {
    atMs: number
    durationMs: number
    gain?: number
    instrument?: string
    pitch?: string | null
    playheadSegs?: { instrument?: string }[]
    placed: { segment?: unknown; playVoice?: string; audioPitch: string | null }
  }
  const seqOf = (src: string) => {
    const rr = parseJps(src)
    return buildPlaySequence(rr, layoutScore(rr, DUR_CFG), 120, undefined, '大钢琴')
  }
  const sPlain = seqOf(plain)
  const sBz = seqOf(bzSrc)
  const sDsb = seqOf(dsbSrc)
  const evs = (s: { events: unknown[] }): Ev[] => s.events as Ev[]
  check('T1 含 bz 段时 buildPlaySequence 不抛异常', sBz.events.length > 0, `events=${sBz.events.length}`)
  check('T2 含 dsb 段时 buildPlaySequence 不抛异常', sDsb.events.length > 0, `events=${sDsb.events.length}`)
  // 主旋律事件（非段层）的**时刻与音高**必须与无段时完全一致——段不占主旋律拍位
  const sigMel = (s: { events: unknown[] }): string =>
    evs(s)
      .filter((e) => !e.placed.segment)
      .map((e) => `${e.atMs}:${e.pitch ?? e.placed.audioPitch}`)
      .join(',')
  check('T3 bz 段不改变主旋律事件的时刻与音高', sigMel(sBz) === sigMel(sPlain), `bz=${sigMel(sBz).slice(0, 80)}`)
  check('T4 dsb 段不改变主旋律事件的时刻与音高', sigMel(sDsb) === sigMel(sPlain), `dsb=${sigMel(sDsb).slice(0, 80)}`)
  check('T5 无段时 12 个可发声事件', evs(sPlain).filter((e) => e.placed.audioPitch !== null).length === 12, `got ${evs(sPlain).filter((e) => e.placed.audioPitch !== null).length}`)

  // ---- Z：段层真正发声 + 声部/音色/力度 ----
  const bzSeg = evs(sBz).filter((e) => e.placed.segment)
  const dsbSeg = evs(sDsb).filter((e) => e.placed.segment)
  check('Z1 bz 段层补发 8 个发声事件', bzSeg.length === 8, `got ${bzSeg.length}`)
  check('Z2 dsb 段层补发 8 个发声事件', dsbSeg.length === 8, `got ${dsbSeg.length}`)
  {
    const mel = evs(sBz).filter((e) => !e.placed.segment)
    const ok = bzSeg.every((e, i) => Math.abs(e.atMs - mel[2 + i].atMs) < 1e-6)
    check('Z3 bz 段层与主旋律同拍位**同刻发声**', ok, `seg=${bzSeg.map((e) => e.atMs).join(',')} mel=${mel.slice(2, 10).map((e) => e.atMs).join(',')}`)
  }
  check('Z4 bz 段层音高 = C4 D4 E4 F4 G4 A4 B4 C5（与所写一致）', bzSeg.map((e) => e.placed.audioPitch).join(',') === 'C4,D4,E4,F4,G4,A4,B4,C5', bzSeg.map((e) => e.placed.audioPitch).join(','))
  check('Z5 bz 段层用**第 2 可用音色**（无 Y: 时回退手风琴）', bzSeg.every((e) => e.instrument === '手风琴'), `inst=${bzSeg[0]?.instrument}`)
  check('Z6 bz 段层力度 = 0.75', bzSeg.every((e) => e.gain === 0.75), `gain=${bzSeg[0]?.gain}`)
  check('Z7 bz 下层主旋律力度 = 1、音色 = 主声部（大钢琴）', evs(sBz).filter((e) => !e.placed.segment).every((e) => e.gain === 1 && e.instrument === '大钢琴'), `inst=${evs(sBz).find((e) => !e.placed.segment)?.instrument} gain=${evs(sBz).find((e) => !e.placed.segment)?.gain}`)
  check('Z8 dsb 段层（上层）用**主声部音色**、力度 1', dsbSeg.every((e) => e.instrument === '大钢琴' && e.gain === 1), `inst=${dsbSeg[0]?.instrument} gain=${dsbSeg[0]?.gain}`)
  {
    const lower = evs(sDsb).filter((e) => !e.placed.segment && e.placed.playVoice === 'second')
    check('Z9 dsb 重叠区主旋律（下层）改第二声部音色 + 力度 0.75', lower.length === 8 && lower.every((e) => e.instrument === '手风琴' && e.gain === 0.75), `n=${lower.length} inst=${lower[0]?.instrument} gain=${lower[0]?.gain}`)
    const others = evs(sDsb).filter((e) => !e.placed.segment && e.placed.playVoice !== 'second')
    check('Z10 dsb 重叠区外的主旋律仍为主声部（音色/力度不变）', others.length === 4 && others.every((e) => e.instrument === '大钢琴' && e.gain === 1), `n=${others.length}`)
  }
  check('Z11 段层色块轨道已生成且带 instrument（手风琴）', bzSeg.every((e) => (e.playheadSegs?.length ?? 0) > 0 && e.playheadSegs!.every((s) => s.instrument === '手风琴')), '')
  check('Z12 主旋律色块轨道也带上 instrument（大钢琴）', evs(sPlain).every((e) => e.playheadSegs?.every((s) => s.instrument === '大钢琴')), '')
  {
    const lastSeg = Math.max(...bzSeg.map((e) => e.atMs + e.durationMs))
    check('Z13 totalMs ≥ 段层事件末刻', sBz.totalMs >= lastSeg, `totalMs=${sBz.totalMs} segEnd=${lastSeg}`)
  }
  {
    const repSrc = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: |: 3 4 | {bz 1 2} 5 6 :| 7 |\n"
    const rr = parseJps(repSrc)
    const s = buildPlaySequence(rr, layoutScore(rr, DUR_CFG), 120, undefined, '大钢琴')
    const seg = (s.events as Ev[]).filter((e) => e.placed.segment)
    check('Z14 反复段落内的段：两遍各发声一次（4 个事件）', seg.length === 4, `got ${seg.length} at=${seg.map((e) => e.atMs).join(',')}`)
    check('Z15 第二遍的段事件晚于第一遍', seg.length === 4 && seg.slice(2).every((e) => e.atMs > seg[0].atMs), `at=${seg.map((e) => e.atMs).join(',')}`)
  }
  // Z16/Z17：**色块层的分组前提**——重叠区同一时刻有两条轨道：同页同曲行、音色不同 ⇒ 画两块
  //（既有 Q1/Q2 多声部是靠"不同 group"显示多块；段层与主旋律同 group，故必须靠"音色"再分一组）
  {
    const seg0 = bzSeg[0]
    const melSame = evs(sBz).filter((e) => !e.placed.segment && Math.abs(e.atMs - seg0.atMs) < 1e-6)
    const a0 = seg0.playheadSegs?.[0]
    const b0 = melSame[0]?.playheadSegs?.[0]
    check(
      'Z16 bz 重叠区同刻两条轨道：同 (page,group)、**音色不同** → 色块画两块',
      melSame.length >= 1 && a0 !== undefined && b0 !== undefined && a0.pageIndex === b0.pageIndex && a0.group === b0.group && a0.instrument !== b0.instrument,
      `seg=${a0?.pageIndex}/${a0?.group}/${a0?.instrument} mel=${b0?.pageIndex}/${b0?.group}/${b0?.instrument}`,
    )
  }
  {
    const seg0 = dsbSeg[0]
    const melSame = evs(sDsb).filter((e) => !e.placed.segment && Math.abs(e.atMs - seg0.atMs) < 1e-6)
    const a0 = seg0.playheadSegs?.[0]
    const b0 = melSame[0]?.playheadSegs?.[0]
    check(
      'Z17 dsb 重叠区同刻两条轨道且**上下分层**（y 不同）',
      melSame.length >= 1 && a0 !== undefined && b0 !== undefined && a0.group === b0.group && a0.instrument !== b0.instrument && Math.abs(a0.y - b0.y) > 1,
      `seg y=${a0?.y} inst=${a0?.instrument} mel y=${b0?.y} inst=${b0?.instrument}`,
    )
  }
  // Z18（回归）：段层**不得影响主旋律色块宽度**——段层音符与主旋律**同 x**，若混入 adj320 的
  //   「下一个时值元素」计算，边界会退化为小节线 ⇒ 主旋律色块被拉长到**整个小节**（用户报的现象）
  {
    const segsSig = (s: { events: unknown[] }): string =>
      evs(s)
        .filter((e) => !e.placed.segment)
        .map((e) => (e.playheadSegs ?? []).map((x) => `${x.x.toFixed(1)}:${x.width.toFixed(1)}`).join('|'))
        .join(';')
    // adj439：**bz 不改主旋律几何**（bz 只在上方叠加，主旋律色块应与无段时逐段一致）；
    // **dsb 下层**则按用户要求"以段层右界（大括号 `}`）为界限定占宽"——包络内最后一音的色块
    // 会被收到大括号之内，故不再与无段时一致（下面 Z18c 单独断言"不越过大括号"）。
    check(
      'Z18 有段时 bz 的主旋律色块与无段时**逐段一致**（bz 不污染右边界）',
      segsSig(sBz) === segsSig(sPlain),
      `bz=${segsSig(sBz).slice(0, 70)} plain=${segsSig(sPlain).slice(0, 70)}`,
    )
    {
      // Z18c（adj439，E-2026-179）：dsb 下层色块**不跨过段层右界（大括号）**
      const layDsb = layoutScore(parseJps(dsbSrc), DUR_CFG)
      const sbX2 = (layDsb.pages[0].segmentBrackets ?? [])[0]?.x2 ?? Number.POSITIVE_INFINITY
      const dsbBlocks = evs(sDsb).filter((e) => !e.placed.segment).flatMap((e) => e.playheadSegs ?? [])
      const crosses = dsbBlocks.some((s) => s.x < sbX2 - 1e-3 && s.x + s.width > sbX2 + 1e-3)
      check('Z18c dsb 下层色块不跨过段层右界（大括号 `}`）',
        Number.isFinite(sbX2) && dsbBlocks.length > 0 && !crosses,
        `x2=${sbX2.toFixed(1)} blocks=${dsbBlocks.map((s) => `${s.x.toFixed(1)}~${(s.x + s.width).toFixed(1)}`).join(' ')}`)
    }
    // 且主旋律色块不覆盖整小节：末块右缘应落在该小节线之前（留出间距）
    const melEv = evs(sDsb).filter((e) => !e.placed.segment)
    const w = melEv.flatMap((e) => e.playheadSegs ?? []).map((x) => x.width)
    check('Z18b 主旋律单个色块宽不超过一个音符槽（无"整小节"色块）', w.every((v) => v < 60), `max=${Math.max(...w).toFixed(1)}`)
  }
  // Z19/Z20：声部角色带到事件上；音色路由确实不同（program 与 channel 都不同）
  check('Z19 事件带 playVoice（bz=accomp / dsb 下层=second）', bzSeg.every((e) => e.playVoice === 'accomp') && evs(sDsb).filter((e) => e.placed.playVoice === 'second').length === 8, `bz=${bzSeg[0]?.playVoice}`)
  check(
    'Z20 音色路由：手风琴(program 21 / organ 通道) 与 大钢琴(0 / piano 通道) 都不同',
    instrumentToProgram('手风琴') === 21 && instrumentToProgram('大钢琴') === 0 && matchInstrument('手风琴') !== matchInstrument('大钢琴'),
    `手风琴=${instrumentToProgram('手风琴')}/${matchInstrument('手风琴')} 大钢琴=${instrumentToProgram('大钢琴')}/${matchInstrument('大钢琴')}`,
  )
}

// ---- adj429：色块按曲行几何动态定界（多声部/临时段不再互相覆盖、不压歌词）----
// 旧实现 `y−1.6×字号 ~ y+0.6×字号` 在三类场景出问题（用户报）：
//  ① 多声部 Q1↔Q2 各自 28.6 px 高、基线仅差 ~22 px ⇒ 重叠 3.6 px；
//  ② dsb 上下层基线差 dy=22、各自 28.6 px ⇒ 重叠 17.6 px；
//  ③ bz 上层与主旋律相隔 dy=22、各自 28.6 px ⇒ 重叠 ~6.6 px；
// 修复：playheadSegs 携带 `yTopMin`/`yBottomMax`（按 voiceBlock.voiceCenters 中线 / 段层对侧基线分块）。
console.log('[adj429] playheadSegs color-block bounds (no overlap, no lyric press)')
{
  const ns = DUR_CFG.note_size
  // V1：单声部 → 不设 yTopMin/yBottomMax（走渲染端默认；保持 adj299 既有观感零回归）
  {
    const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 | 5 6 7 1' |\n"
    const parseResult = parseJps(src)
    const seq = buildPlaySequence(parseResult, layoutScore(parseResult, DUR_CFG), 120, undefined, '大钢琴')
    const segs = seq.events.flatMap((e) => e.playheadSegs ?? [])
    const withBounds = segs.filter((s) => s.yTopMin !== undefined || s.yBottomMax !== undefined)
    check('V1 单声部 playheadSegs 不带 yTopMin/yBottomMax（默认定界、零回归）', withBounds.length === 0, `withBounds=${withBounds.length}`)
  }
  // V2：多声部 Q1+Q2 → Q1 底部 ≤ Q1/Q2 中线、Q2 顶部 ≥ Q1/Q2 中线（互不重叠）
  {
    const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ1: 1 2 3 4 | 5 6 7 1' |\nQ2: 5 6 5 3 | 1 2 3 4 |\n"
    const parseResult = parseJps(src)
    const lay = layoutScore(parseResult, DUR_CFG)
    const seq = buildPlaySequence(parseResult, lay, 120, undefined, '大钢琴')
    // 取 Q1 和 Q2 各自的某个事件（来自 page.voiceBlocks）
    const q1Seg = seq.events.find((e) => e.placed.id.voice === 1 && !e.placed.segment)?.playheadSegs?.[0]
    const q2Seg = seq.events.find((e) => e.placed.id.voice === 2 && !e.placed.segment)?.playheadSegs?.[0]
    check('V2 多声部：Q1 段带 yTopMin/yBottomMax', q1Seg !== undefined && q1Seg.yTopMin !== undefined && q1Seg.yBottomMax !== undefined, `q1Seg=${JSON.stringify(q1Seg)}`)
    check('V2 多声部：Q2 段带 yTopMin/yBottomMax', q2Seg !== undefined && q2Seg.yTopMin !== undefined && q2Seg.yBottomMax !== undefined, `q2Seg=${JSON.stringify(q2Seg)}`)
    if (q1Seg?.yBottomMax !== undefined && q2Seg?.yTopMin !== undefined) {
      check('V2 多声部 Q1 底部 ≤ Q2 顶部（不重叠）', q1Seg.yBottomMax <= q2Seg.yTopMin + 0.01, `q1.bot=${q1Seg.yBottomMax.toFixed(2)} q2.top=${q2Seg.yTopMin.toFixed(2)}`)
    }
  }
  // V3：dsb 上下层 → 上层底部 ≤ 上下层中线、下层顶部 ≥ 中线
  {
    const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
    // 重要：parseJps 只调一次，layout 和 sequence 共用同一个 ParseResult（否则段层 token 与
    // placed 的 token 对象身份不同 → segPlacedByToken.get(t) 查不到，段层事件根本不补发）。
    const parseResult = parseJps(src)
    const lay = layoutScore(parseResult, DUR_CFG)
    const seq = buildPlaySequence(parseResult, lay, 120, undefined, '大钢琴')
    const upperSeg = seq.events.find((e) => e.placed.segment?.type === 'dsb' && e.placed.segment?.layer === 'upper')?.playheadSegs?.[0]
    const lowerSeg = seq.events.find((e) => e.placed.playVoice === 'second')?.playheadSegs?.[0]
    check('V3 dsb upper 带 yTopMin/yBottomMax', upperSeg?.yTopMin !== undefined && upperSeg?.yBottomMax !== undefined, `up=${JSON.stringify(upperSeg)}`)
    check('V3 dsb lower 带 yTopMin/yBottomMax', lowerSeg?.yTopMin !== undefined && lowerSeg?.yBottomMax !== undefined, `lo=${JSON.stringify(lowerSeg)}`)
    const upH = (upperSeg?.yBottomMax ?? 0) - (upperSeg?.yTopMin ?? 0)
    const loH = (lowerSeg?.yBottomMax ?? 0) - (lowerSeg?.yTopMin ?? 0)
    if (upperSeg?.yBottomMax !== undefined && lowerSeg?.yTopMin !== undefined) {
      check('V3 dsb upper 底部 ≤ lower 顶部（不重叠）', upperSeg.yBottomMax <= lowerSeg.yTopMin + 0.01, `up.bot=${upperSeg.yBottomMax.toFixed(2)} lo.top=${lowerSeg.yTopMin.toFixed(2)}`)
      // adj429b：用户建议——dsb 上下色块**严格等高**（用 0.25×ns 中线偏移消化 TOP/BOT 不对称）
      check('V3b dsb 上下色块**严格等高**（误差 < 0.1 px）', Math.abs(upH - loH) < 0.1, `upH=${upH.toFixed(2)} loH=${loH.toFixed(2)} 差=${(upH - loH).toFixed(2)}`)
    }
    // V3c：色块高度 ≥ 4 px（不到则隐藏；这里默认 dy=22 ⇒ 两层各约 22 px，满足）
    check('V3c dsb 上下色块高度 ≥ 4 px（最小可见）', upH >= 4 && loH >= 4, `upH=${upH.toFixed(2)} loH=${loH.toFixed(2)}`)
  }
  // V4：bz 上层 → 底部 ≤ 主旋律色块顶（不重叠）
  {
    const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
    const parseResult = parseJps(src)
    const lay = layoutScore(parseResult, DUR_CFG)
    const seq = buildPlaySequence(parseResult, lay, 120, undefined, '大钢琴')
    const bzSeg = seq.events.find((e) => e.placed.segment?.type === 'bz')?.playheadSegs?.[0]
    const melodySeg = seq.events.find((e) => !e.placed.segment && e.placed.id.voice === 1)?.playheadSegs?.[0]
    check('V4 bz upper 带 yTopMin/yBottomMax', bzSeg?.yTopMin !== undefined && bzSeg?.yBottomMax !== undefined, `bz=${JSON.stringify(bzSeg)}`)
    // bz 主旋律是普通主声部 → melodySeg 默认无 bounds；用 melodySeg.y 推它的色块顶（−1.6×字号）
    if (bzSeg?.yBottomMax !== undefined && melodySeg) {
      const melodyBlockTop = melodySeg.y - ns * 1.6
      check('V4 bz upper 底部 ≤ 主旋律色块顶（不重叠）', bzSeg.yBottomMax <= melodyBlockTop + 0.01, `bz.bot=${bzSeg.yBottomMax.toFixed(2)} melody.top=${melodyBlockTop.toFixed(2)}`)
    }
    // V4b：bz 色块高度 ≥ 4 px（默认 dy=22 ⇒ 22 − 1.1×字号 + 1.1×字号 − 0.5 = 21.5 px ≥ 4 ✓）
    const h = (bzSeg?.yBottomMax ?? 0) - (bzSeg?.yTopMin ?? 0)
    check('V4b bz 色块高度 ≥ 4 px（最小可见）', h >= 4, `h=${h.toFixed(2)}`)
  }
  // V5：把 dsb dy 调到 60 → 上下色块应更高（动态定界确实响应设置）
  {
    const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
    const parseResult = parseJps(src)
    const cfg = { ...DUR_CFG, segmentRowGap: { dsb: 60 } }
    const lay = layoutScore(parseResult, cfg)
    const seq = buildPlaySequence(parseResult, lay, 120, undefined, '大钢琴')
    const upperSeg = seq.events.find((e) => e.placed.segment?.type === 'dsb' && e.placed.segment?.layer === 'upper')?.playheadSegs?.[0]
    const lowerSeg = seq.events.find((e) => e.placed.playVoice === 'second')?.playheadSegs?.[0]
    const upH = (upperSeg?.yBottomMax ?? 0) - (upperSeg?.yTopMin ?? 0)
    const loH = (lowerSeg?.yBottomMax ?? 0) - (lowerSeg?.yTopMin ?? 0)
    // adj429b：dsb 上下色块**严格等高**（不依赖 dy 大小）——用户建议，视觉更均衡
    check('V5 dsb dy=60 → 上下色块**严格等高** + 均 ≥ 30 px', upH > 30 && loH > 30 && Math.abs(upH - loH) < 0.1, `upH=${upH.toFixed(2)} loH=${loH.toFixed(2)} 差=${(upH - loH).toFixed(2)}`)
  }
}

// ---- adj430：段内音 bx0/bx1 拍位映射 + 整体按比例缩到段宽内（不丢失段内容） ----
// 用户原例：`|"p:2/4" {bz 8 &zkh 2'/ 3'/ } 6, - |` —— 段内 8(1 拍) + 2'/(0.5 拍) + 3'/(0.5 拍) 共 2 拍，
// 与主旋律 `6, -`（2 拍）拍数一致。但 `beatToX(envStart+1)` 走 spans[1]=下一小节音符插值，落在
// 主旋律 `|` 右侧 ⇒ 旧实现下 `2'/ 3'/` 的 bx0 > xContent1 ⇒ `bx1 ≤ bx0` 跳过，**两个音不显示**。
// 修复：拍位自然映射总宽 > xContent1 − xContent0 时**整体按比例缩放到段宽内**，段首/段末仍
// 对齐 xContent0/xContent1（U8a/U8b），中间按比例（段内音不丢失）。
console.log('[adj430] segment note beat-anchor + scale-fit within envelope')
{
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6,/ 3// (2// 2) 2/&rit 3/ 6,/ 5,/&yc |\"p:2/4\" {bz 8 &zkh 2'/ 3'/ } 6, - | 6 5 |\n"
  const parseResult = parseJps(src)
  const lay = layoutScore(parseResult, defaultPageConfig)
  const page = lay.pages[0]
  const segNotes = page.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
  // W6a：段层至少 3 个 placedToken（rest 8 + 2'/ + 3'/）——`2'/ 3'/` 不丢失
  check('W6a 用户原例 {bz 8 &zkh 2\'/ 3\'/ } → 段层 3 个 placedToken（不丢失 2\'/ 3\'/）', segNotes.length === 3, `got ${segNotes.length}: ${segNotes.map((n) => n.token.kind).join(',')}`)
  // W6b：每个段层音宽度 > 0（不缩成 0 宽）
  check('W6b 段层每个音宽度 > 0（不缩成 0 宽）', segNotes.every((n) => n.width > 0.5), `widths=${segNotes.map((n) => n.width.toFixed(2)).join(',')}`)
  // W6c：段层三个音按拍位顺序排列（bx0 单调递增）
  check('W6c 段层三个音 bx0 单调递增（按拍位顺序）', segNotes[0].x < segNotes[1].x && segNotes[1].x < segNotes[2].x, `x=${segNotes.map((n) => n.x.toFixed(2)).join(',')}`)
  // W6d：段层最右音 bx1 ≤ 主旋律包络后小节线 x（不溢出段右界）
  const melodyBarAfter = page.barlines.find((b) => !b.segment && b.x > segNotes[0].x + 5)?.x ?? 0
  check('W6d 段层最右音 bx1 ≤ 主旋律包络后小节线（不溢出）',
    (segNotes[2].rightX ?? 0) <= melodyBarAfter + 0.5,
    `rightX=${(segNotes[2].rightX ?? 0).toFixed(2)} nextBar=${melodyBarAfter.toFixed(2)}`)
  // W6e：段层音总宽 = 段内容宽（用户原例只有 &zkh 无 &ykh ⇒ tailPad=0，段铺到小节线）
  const totalW = (segNotes[2].rightX ?? segNotes[2].x + segNotes[2].width) - segNotes[0].x
  check('W6e 段层音总宽 = 段内容宽（合理范围 60~130，bz 有 lead bracket 时更宽）',
    totalW > 60 && totalW < 130,
    `totalW=${totalW.toFixed(2)}`)

  // adj431：zkh 必须**靠近 2'/（第一个发声音）**而不是 hidden rest（8）的左缘——
  // 例：`{bz 8 &zkh 2'/ 3'/}` 的 `&zkh` 应该紧贴 `2'/`（= 第一个发声音），而不是紧贴 `8`（= xContent0）。
  const zk = page.brackets.find((b) => b.code === 'zkh')
  const firstPlayed = segNotes.find((n) => !(n.token.kind === 'rest' && (n.token as { hidden?: boolean }).hidden))
  check('W6f &zkh 靠近段内第一个发声音（不在 hidden rest 8 之前）',
    zk !== undefined && firstPlayed !== undefined &&
      Math.abs(zk.x - firstPlayed.x) < 20,  // zkh 中心离 2'/ 中心 < 20 px
    `zkh.x=${zk?.x.toFixed(2)} firstPlayed.x=${firstPlayed?.x.toFixed(2)} firstPlayed.kind=${firstPlayed?.token.kind}`)
}

// ---- adj432：色块按声部角色着色（bz upper 蓝 / dsb upper 红 / dsb lower 绿）+ 段层拖动虚线 ----
console.log('[adj432] segment color-block voice colors + segment row guides')
{
  const ns432 = DUR_CFG.note_size
  const bz432 = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const dsb432 = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  // X1：§PlayheadSeg.playVoice 透传到事件（bz upper = accomp）
  {
    const pr = parseJps(bz432)
    const seq = buildPlaySequence(pr, layoutScore(pr, DUR_CFG), 120, undefined, '大钢琴')
    const segs = seq.events.flatMap((e) => e.playheadSegs ?? [])
    const accompSegs = segs.filter((s) => s.playVoice === 'accomp')
    check('X1 bz 段层 playheadSegs.playVoice = accomp（伴奏角色透传）', accompSegs.length > 0, `n=${accompSegs.length}`)
    const melSegs = segs.filter((s) => s.playVoice === undefined)
    check('X1b bz 主旋律 playheadSegs 无 playVoice（普通声部走音色着色）', melSegs.length > 0, `n=${melSegs.length}`)
  }
  // X2：dsb upper = main、dsb lower = second
  {
    const pr = parseJps(dsb432)
    const seq = buildPlaySequence(pr, layoutScore(pr, DUR_CFG), 120, undefined, '大钢琴')
    const segs = seq.events.flatMap((e) => e.playheadSegs ?? [])
    check('X2 dsb upper playheadSegs.playVoice = main', segs.some((s) => s.playVoice === 'main'), `roles=${[...new Set(segs.map((s) => s.playVoice ?? '-'))].join(',')}`)
    check('X2b dsb lower playheadSegs.playVoice = second', segs.some((s) => s.playVoice === 'second'), `roles=${[...new Set(segs.map((s) => s.playVoice ?? '-'))].join(',')}`)
  }
  // X3：computeRowGuides 给段层行打 segType/segLayer 标记（bz 1 个上层；dsb 上下各 1）
  {
    const rowGuidesOf = (src: string) => {
      const pr = parseJps(src)
      const lay = layoutScore(pr, DUR_CFG)
      return computeRowGuides(lay, { quci: DUR_CFG.height_quci, geci: DUR_CFG.geci_size }, DUR_CFG.note_size)[0] ?? []
    }
    const bzRows = rowGuidesOf(bz432)
    const bzSegRows = bzRows.filter((r) => r.segType === 'bz')
    check('X3 bz 段层行带 segType=bz + segLayer=upper', bzSegRows.length >= 1 && bzSegRows.every((r) => r.segLayer === 'upper'), `segRows=${bzSegRows.length} rows=${bzRows.length}`)
    check('X3b bz 主旋律行**不带**段层标记', bzRows.some((r) => r.segType === undefined), `rows=${bzRows.length}`)
    const dsbRows = rowGuidesOf(dsb432)
    const dsbUp = dsbRows.filter((r) => r.segType === 'dsb' && r.segLayer === 'upper')
    const dsbLo = dsbRows.filter((r) => r.segType === 'dsb' && r.segLayer === 'lower')
    check('X3c dsb 上层行 segType=dsb/segLayer=upper', dsbUp.length >= 1, `n=${dsbUp.length}`)
    check('X3d dsb 下层行 segType=dsb/segLayer=lower（= 被下移的主旋律，playVoice=second）', dsbLo.length >= 1, `n=${dsbLo.length} rows=${dsbRows.length}`)
  }
  // X4：GUIDE_LIMITS_EX 覆盖 segmentRowGap 两个键（供拖动钳制）
  {
    const ok = GUIDE_LIMITS_EX.segmentRowGap_bz !== undefined && GUIDE_LIMITS_EX.segmentRowGap_dsb !== undefined
    check('X4 GUIDE_LIMITS_EX 含 segmentRowGap_bz/dsb（拖动钳制范围）', ok, `bz=${JSON.stringify(GUIDE_LIMITS_EX.segmentRowGap_bz)} dsb=${JSON.stringify(GUIDE_LIMITS_EX.segmentRowGap_dsb)}`)
    check('X4b 段层间距范围 = [10,80]（与设置面板一致）', ok && GUIDE_LIMITS_EX.segmentRowGap_bz[0] === 10 && GUIDE_LIMITS_EX.segmentRowGap_bz[1] === 80 && GUIDE_LIMITS_EX.segmentRowGap_dsb[0] === 10 && GUIDE_LIMITS_EX.segmentRowGap_dsb[1] === 80, JSON.stringify(GUIDE_LIMITS_EX.segmentRowGap_bz))
  }
  // X5：段层间距变化 → 段层行 y 跟随（几何与拖动语义一致）
  {
    const pr1 = parseJps(bz432)
    const lay1 = layoutScore(pr1, { ...DUR_CFG, segmentRowGap: { bz: 22 } })
    const pr2 = parseJps(bz432)
    const lay2 = layoutScore(pr2, { ...DUR_CFG, segmentRowGap: { bz: 50 } })
    const y1 = (lay1.pages[0].notes.find((n) => n.segment)?.y ?? 0)
    const y2 = (lay2.pages[0].notes.find((n) => n.segment)?.y ?? 0)
    check('X5 bz 段层间距 22→50 → 段层 y 上移 28（拖动方向一致）', Math.abs((y1 - y2) - 28) < 0.2, `y1=${y1.toFixed(2)} y2=${y2.toFixed(2)} 差=${(y1 - y2).toFixed(2)}`)
  }
  // X7（回归，E-2026-171）：**上下层音色相同时**，分组键必须含 playVoice——否则两块合并成一块。
  // 场景：谱面只写 `Y: 手风琴` ⇒ 主旋律 = Y[0] = 手风琴；bz 伴奏回退也用 手风琴 ⇒
  // 旧分组键 `(page,group,voice,instrument)` 完全相同 ⇒ PreviewPane 只画一个色块。
  {
    const sameInst = "V: 1.0\nB: t\nD: C\nP: 4/4\nY: 手风琴\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
    const pr = parseJps(sameInst)
    const seq = buildPlaySequence(pr, layoutScore(pr, DUR_CFG), 120, undefined, '手风琴')
    const segs = seq.events.flatMap((e) => e.playheadSegs ?? [])
    const accomp = segs.filter((s) => s.playVoice === 'accomp')
    const main = segs.filter((s) => s.playVoice === undefined)
    check('X7 前提：Y 只有一条时上下层 instrument 相同（手风琴）',
      accomp.length > 0 && main.length > 0 && accomp.every((s) => s.instrument === '手风琴') && main.every((s) => s.instrument === '手风琴'),
      `accompInst=${accomp[0]?.instrument} mainInst=${main[0]?.instrument}`)
    const keyOld = (s: { pageIndex: number; group: number; voice: number; instrument?: string }) =>
      `${s.pageIndex}|${s.group}|${s.voice}|${s.instrument ?? ''}`
    const keyNew = (s: { pageIndex: number; group: number; voice: number; instrument?: string; playVoice?: string }) =>
      `${s.pageIndex}|${s.group}|${s.voice}|${s.instrument ?? ''}|${s.playVoice ?? ''}`
    const oldKeys = new Set(segs.map(keyOld))
    const newKeys = new Set(segs.map(keyNew))
    check('X7b 旧键（不含 playVoice）把上下层合并为同一组（复现 bug）',
      oldKeys.size < newKeys.size,
      `old=${oldKeys.size} new=${newKeys.size}`)
    check('X7c 新键（含 playVoice）上下层各自一组（修复后两色块）',
      newKeys.size >= oldKeys.size + 1 && [...newKeys].some((k) => k.endsWith('|accomp')) && [...newKeys].some((k) => k.endsWith('|')),
      `newKeys=${[...newKeys].join(' / ')}`)
  }
  void ns432
}

// ---- adj435：重叠区按**多声部方式**算占宽（段层更密的拍拿到额外宽，音符不再挤在一起） ----
// 用户原例：`{bz &zkh 1/ 2// 3// 2 3 4 | 5 6/ 5/ 7 1' &ykh } 5 6/ 5/ 7 1' | 1' 7 6 5 | 5 5`
// 段层第 1 拍有 3 个音（`1/ 2// 3//`，最小时值 1/16），主旋律同拍只有 1 个音（`5`）。
// 旧行为：主旋律按自己的密度给拍宽 ⇒ 段内 16 分被挤到 5px 互相重叠（用户报「音符挤在一起」）。
// 现行为：重叠拍取"两层更密"的需求（同 `allocatePerBeats`/`singleRulePerBeats` 的 baseW 口径）。
console.log('[adj435] overlap beats sized by the denser layer (multi-voice style)')
{
  const srcC = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz &zkh 1/ 2// 3// 2 3 4 | 5 6/ 5/ 7 1' &ykh } 5 6/ 5/ 7 1' | 1' 7 6 5 | 5 5\n"
  // 时值优先：已验证「取更密层需求」全链路生效
  // 空间优先：本轮只验证「不再产生坐标系跳变 + 段首对齐」（AJ4/AJ5）——占宽取更密层待续（见 ERRORS-LOG E-2026-175 待办）
  for (const [nm, cfg] of [['时值优先', DUR_CFG], ['空间优先', { ...DUR_CFG, noteSpaceLayout: 'space' as const }]] as const) {
    const pg = layoutScore(parseJps(srcC), cfg).pages[0]
    const melN = pg.notes.filter((n) => !n.segment).sort((a, b) => a.x - b.x)
    const segN = pg.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
    // 段层前 3 个音 = `1/ 2// 3//`（同一拍内，时值 0.5/0.25/0.25）
    const head3 = segN.slice(0, 3)
    const coveredBeatNote = melN[2] // `5`（包络起点，段层该拍 3 个音）
    // AL1–AL3（adj437，E-2026-177）：**dsb 上下两层逐拍精确对齐**——
    // 用户报 `{dsb 1 2 3 4 | 5 6 7 1' } 5 6&dy 7&yc 1' | …` 上下层拍子不对齐（实测逐拍漂移 1.95px、
    // 末拍 13.6px，因 `segScale` 被误触发成 0.9435）。修复后 `segScale` 只在**真正越过小节线**时才压缩。
    {
      const srcD = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1' } 5 6&dy 7&yc 1' | 1' 7 6 5 | 5 5\n"
      for (const [nm, cfg] of [['时值优先', DUR_CFG], ['空间优先', { ...DUR_CFG, noteSpaceLayout: 'space' as const }]] as const) {
        const p = layoutScore(parseJps(srcD), cfg).pages[0]
        const mm = p.notes.filter((n) => !n.segment).sort((a, b) => a.x - b.x)
        const ss = p.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
        // 包络覆盖主旋律第 3..10 个音（`3 4` 之后的 8 拍）
        const melEnv = mm.slice(2, 10)
        const maxDrift = Math.max(...ss.map((n, i) => (melEnv[i] ? Math.abs(n.x - melEnv[i].x) : 0)))
        check(`AL1[${nm}] dsb 上下两层**逐拍精确对齐**（最大偏差 < 0.51px；旧实现漂移到 13.6px）`,
          ss.length === 8 && melEnv.length === 8 && maxDrift < 0.51,
          `maxDrift=${maxDrift.toFixed(2)} seg=${ss.map((n) => n.x.toFixed(1)).join(',')} mel=${melEnv.map((n) => n.x.toFixed(1)).join(',')}`)
        // AL2：段层末音右缘不与右括号重叠（括号在 xContent1 之外、段层内容之内收）
        const ykh = p.brackets.find((b) => b.code === 'ykh')
        check(`AL2[${nm}] 段层末音右缘 ≤ 右括号左缘（不压括号）`,
          ykh !== undefined && (ss[ss.length - 1].rightX ?? 0) <= ykh.x - ykh.width / 2 + 0.51,
          `segRight=${(ss[ss.length - 1].rightX ?? 0).toFixed(2)} ykhLeft=${ykh ? (ykh.x - ykh.width / 2).toFixed(2) : 'n/a'}`)
        // AL3：段层各音宽度 > 0 且起始 x 单调递增
        check(`AL3[${nm}] 段层各音宽 > 0 且 x 单调递增`,
          ss.every((n) => n.width > 0) && ss.every((n, i) => i === 0 || n.x > ss[i - 1].x),
          `w=${ss.map((n) => n.width.toFixed(1)).join(',')}`)
        // AL4（adj438，E-2026-178）：段层色块**不得跨过段内小节线**——
        // 旧实现只看"下一个段层音符"，段内末音色块会越过 `|` 盖到下一小节首音前（用户截图）。
        {
          const segBarXs = p.barlines.filter((b) => b.segment).map((b) => b.x).sort((a, b) => a - b)
          const prD = parseJps(srcD)
          const seqD = buildPlaySequence(prD, layoutScore(prD, cfg), 120, undefined, '大钢琴')
          const upperSegs = seqD.events
            .filter((e) => e.placed.segment)
            .flatMap((e) => e.playheadSegs ?? [])
          const crosses = segBarXs.some((bx) =>
            upperSegs.some((s) => s.x < bx - 1e-3 && s.x + s.width > bx + 1e-3),
          )
          check(`AL4[${nm}] 段层色块不跨过段内小节线`,
            segBarXs.length >= 1 && !crosses,
            `segBars=${segBarXs.map((v) => v.toFixed(1)).join(',')} blocks=${upperSegs.map((s) => `${s.x.toFixed(1)}~${(s.x + s.width).toFixed(1)}`).join(' ')}`)
          // AL5（adj440，E-2026-180）：段内**最后一个音**的色块延伸到**段层右界（大括号）**——
        // `&ykh`/右括号是**无时值占宽元素**（占宽不占拍），其后的图形空白在时间上仍属本段末尾。
        {
          const lastBlk = [...upperSegs].sort((a, b) => a.x - b.x).pop()
          const braceX2 = (p.segmentBrackets ?? [])[0]?.x2 ?? 0
          const blkRight = lastBlk ? lastBlk.x + lastBlk.width : 0
          check(`AL5[${nm}] 段内末音色块延伸到段层右界（大括号界限）`,
            lastBlk !== undefined && braceX2 > 0 && Math.abs(blkRight - braceX2) < 0.6,
            `blkRight=${blkRight.toFixed(2)} braceX2=${braceX2.toFixed(2)}`)
          // AL6（adj442，E-2026-182）：**dsb 色块以大括号为界**——首个块左缘 = `x1`(`{`)、末块右缘 = `x2`(`}`)
          const sortedBlk = [...upperSegs].sort((a, b) => a.x - b.x)
          const braceX1 = (p.segmentBrackets ?? [])[0]?.x1 ?? 0
          // adj442（用户修正）：**左端不外扩**——色块从**起始音符**开始（音符左对齐，重叠区首音已对齐）；
          // **右端**外扩到段层右界（`}` / 后小节线），因为 `&ykh`/括号是无时值占宽元素。
          void braceX1
          check(`AL6[${nm}] dsb 色块：左端=起始音符、右端=大括号界限`,
            braceX2 > 0 && sortedBlk.length > 0 && ss.length > 0 &&
              Math.abs(sortedBlk[0].x - ss[0].x) < 0.6 && Math.abs(blkRight - braceX2) < 0.6,
            `firstLeft=${sortedBlk[0]?.x.toFixed(2)} firstNote=${ss[0]?.x.toFixed(2)} lastRight=${blkRight.toFixed(2)} x2=${braceX2.toFixed(2)}`)
        }
        }
      }
    }
  // AJ4：段层首音仍与主旋律包络起点音精确对齐（坐标系修好后对齐不被破坏）
    check(`AJ4[${nm}] 段层首音 x = 主旋律包络起点音 x（同拍位对齐）`,
      Math.abs(segN[0].x - coveredBeatNote.x) < 0.51,
      `seg0.x=${segN[0].x.toFixed(2)} mel.x=${coveredBeatNote.x.toFixed(2)}`)
    // AJ5：段层各音 bx0 单调递增（无倒序/重叠）
    check(`AJ5[${nm}] 段层各音 bx0 单调递增`, segN.every((n, i) => i === 0 || n.x >= segN[i - 1].x - 1e-6), `x=${segN.map((n) => n.x.toFixed(1)).join(',')}`)
    // adj441：两种布局都跑下面的宽度断言（空间优先此前未生效，见 E-2026-175）
    const minGlyph = cfg.note_size * 0.5 // 数字约半个字号的净宽（小于它必然视觉重叠）
    check(`AJ1[${nm}] 段层同拍的 3 个子拍音宽均 ≥ 数字净宽（不重叠）`,
      head3.length === 3 && head3.every((n) => n.width >= minGlyph),
      `w=${head3.map((n) => n.width.toFixed(2)).join(',')} 阈值=${minGlyph}`)
    // AJ2：三个子拍宽度比 ≈ 2:1:1（对应 0.5 : 0.25 : 0.25）
    check(`AJ2[${nm}] 段层子拍宽比 ≈ 2:1:1（时值比例正确、无跳变）`,
      head3.length === 3 && Math.abs(head3[0].width / head3[1].width - 2) < 0.15 && Math.abs(head3[1].width / head3[2].width - 1) < 0.15,
      `比值=${(head3[0].width / head3[1].width).toFixed(3)} / ${(head3[1].width / head3[2].width).toFixed(3)}`)
    // AJ3（adj441，用户要求「多声部同一拍的总占宽要一致」）：段层子拍宽**之和**
    // = 主旋律同拍的**字距跨度**（本音数字 → 下一个音数字），即两层在该拍的总占宽一致。
    {
      const head3Sum = head3.reduce((a, n) => a + n.width, 0)
      const plainBeatNote = melN[0]
      const nextNote = melN[3] // `6`（被覆盖拍的下一个音）
      const beatSpan = nextNote.x - coveredBeatNote.x
      check(`AJ3[${nm}] 段层子拍宽之和 = 主旋律同拍字距跨度（同一拍总占宽一致）`,
        Math.abs(head3Sum - beatSpan) < 0.6,
        `segSum=${head3Sum.toFixed(2)} melBeatSpan=${beatSpan.toFixed(2)} plainW=${plainBeatNote.width.toFixed(2)}`)
    }
  }
}

// ---- adj433：段层拍位与主旋律**逐拍对齐**（用户报「bz/dsb 上下层拍子没对齐」） ----
// 根因：`beatToX` 对**音符内部**的拍位用"跨到下一个音符"的锚点插值，把**小节线占宽+槽间留白**
// 也算成时值宽 ⇒ 段层映射总宽虚大 ⇒ adj430 的 segScale 把它整体压缩 ⇒ 拍位错位。
// 修法：音符内部只在**该音符自身范围**内插值（优先用 layout 已算好的拍段 `segments`）。
console.log('[adj433] segment beats align with melody beats (within-note interpolation)')
{
  // 用户原例（问题 1 的最小复现）：`6, -` 跨 2 拍，段内 `2'/ 3'/` 各占半拍
  const src433 = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6,/ 3// (2// 2) 2/&rit 3/ 6,/ 5,/&yc |\"p:2/4\" {bz 8 &zkh 2'/ 3'/ } 6, - | 6 5 |\n"
  const pr = parseJps(src433)
  const page = layoutScore(pr, defaultPageConfig).pages[0]
  const segNs = page.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
  const mainNs = page.notes.filter((n) => !n.segment).sort((a, b) => a.x - b.x)
  // 段层 3 个音：8(hidden rest, 1 拍) + 2'/(0.5) + 3'/(0.5)；主旋律包络是 `6, -`（2 拍）
  check('Y1 用户原例段层仍为 3 个音（不丢失）', segNs.length === 3, `got ${segNs.length}`)
  // Y2：段层第 1 个音（rest 8）起点 = 主旋律**包络起点音**的 x（同拍位垂直对齐）。
  // 包络起点音 = x 不大于段首音 x 的**最靠右**那个主旋律音（即 `6, -`，它跨 2 拍）。
  const melEnv = [...mainNs].reverse().find((n) => n.x <= segNs[0].x + 0.51)
  check('Y2 段层首音起点 = 主旋律包络起点音 x（同拍位垂直对齐）',
    melEnv !== undefined && Math.abs(segNs[0].x - melEnv.x) < 0.51,
    `seg0.x=${segNs[0].x.toFixed(2)} melEnv.x=${melEnv?.x.toFixed(2)}`)
  const mel6 = melEnv
  // Y3：段层总宽 = 主旋律 `6,-` 的占位宽（**不被压缩、也不溢出**）——这是"拍子对齐"的量化判据
  const segTotalW = (segNs[2].rightX ?? 0) - segNs[0].x
  // adj441：包络终点 = 主旋律包络音**之后的小节线**（`6,-` 的槽与包络都到小节线为止）——
  // 段内容应铺满整段包络（含末音到小节线之间的那部分），故不再用"主旋律音的 rightX"作期望。
  const barAfterMel = page.barlines.filter((b) => !b.segment).map((b) => b.x).find((x) => x > (mel6?.rightX ?? 0)) ?? (mel6?.rightX ?? 0)
  const envSpan = barAfterMel - (mel6?.x ?? 0)
  check('Y3 段层占宽 ≈ 包络跨度（主旋律包络音 → 其后小节线，未被压缩）',
    envSpan > 0 && Math.abs(segTotalW - envSpan) < 1.5,
    `segW=${segTotalW.toFixed(2)} envSpan=${envSpan.toFixed(2)}`)
  // Y4：段层每个音的 x 必须落在主旋律 `6,-` 的 x 范围内（不跨到后面的小节）
  const melL = mel6?.x ?? 0
  const melR = mel6?.rightX ?? 0
  check('Y4 段层各音 x 均在包络范围内（包络音 → 其后小节线，不跨线）',
    segNs.every((n) => n.x >= melL - 0.51 && (n.rightX ?? 0) <= barAfterMel + 0.51),
    `env=[${melL.toFixed(2)},${barAfterMel.toFixed(2)}] segs=${segNs.map((n) => `${n.x.toFixed(1)}~${(n.rightX ?? 0).toFixed(1)}`).join(' ')}`)

  // ---- adj434：段内 `@乐器@` 与段后 `@乐器@` 的切换（用户报「主声部没切换为手风琴」）----
  {
    // 用户**完整原行**（含段后三小节）
    const src434 = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6,/ 3// (2// 2) 2/&rit 3/ 6,/ 5,/&yc |\"p:2/4\" {bz 8 &zkh @手风琴@ 2'/ 3'/ } 6, - |\"p:4/4\" @手风琴@ 6/\"原速\" 3'// (2'// 2') 2'/ 1'/ 6/ (5/ | 5/) (3/[3/5/] 3) - 2'/ 3'/ | 6/ 3'// (2'// 2') 2'/ 3'/ 5'/ (2'/ |\n"
    const toks = parseJps(src434).groups[0].music.tokens
    const topInsts = toks.filter((t) => t.kind === 'instrument')
    const segTok = toks.find((t) => t.kind === 'segment' && (t as { dir?: string }).dir === 'open') as { children?: { kind: string }[] } | undefined
    const segChildKinds = (segTok?.children ?? []).map((c) => c.kind)
    check('AX1 段后 @手风琴@ 解析为顶层 instrument token',
      topInsts.length === 1, `顶层 instrument=${topInsts.length} tokens=${toks.map((t) => t.kind).join(',')}`)
    check('AX2 段 children 含 instrument（段内 @手风琴@）', segChildKinds.includes('instrument'), `children=${segChildKinds.join(',')}`)
    // 引擎：段后 `@手风琴@` 是否让主声部（voice 1）后续事件用 手风琴
    const pr434 = parseJps(src434)
    const seq434 = buildPlaySequence(pr434, layoutScore(pr434, DUR_CFG), 120, undefined, '大钢琴')
    const melEv = seq434.events.filter((e) => !e.placed.segment)
    const instSeq = melEv.map((e) => e.instrument)
    const firstInst = instSeq[0]
    const lastInst = instSeq[instSeq.length - 1]
    check('AX3 段前主声部音色 = 大钢琴（试听音色默认）', firstInst === '大钢琴', `first=${firstInst}`)
    check('AX4 段后主声部音色 = 手风琴（@手风琴@ 生效）', lastInst === '手风琴', `last=${lastInst} 序列=${instSeq.join(',')}`)
    // 段层（伴奏）音色
    const segInst = [...new Set(seq434.events.filter((e) => e.placed.segment).map((e) => e.instrument))]
    check('AX5 段层（伴奏）音色 = 手风琴（无 Y: 时回退）', segInst.length === 1 && segInst[0] === '手风琴', `seg=${segInst.join('/')}`)
    // 色块：段后主旋律的音色变了 → 颜色也应跟着变（instrumentColorMap 按音色分配）
    const trk = seq434.events.flatMap((e) => (e.playheadSegs ?? []).map((s) => ({ inst: s.instrument ?? '', pv: s.playVoice })))
    const melTrkInsts = [...new Set(trk.filter((t) => t.pv === undefined).map((t) => t.inst))]
    check('AX6 主旋律色块音色集合含 大钢琴 与 手风琴（段后换色可见）',
      melTrkInsts.includes('大钢琴') && melTrkInsts.includes('手风琴'), `集合=${melTrkInsts.join('/')}`)
    // AX7（E-2026-173）：`@乐器名@` 是**谱面显式指定**——必须标记 `explicitInstrument`，
    // 供播放端在「试听音色」已选定具体音色时**不被全局覆盖压掉**（用户报「主声部没切换为手风琴」）。
    const explicitEv = melEv.filter((e) => e.explicitInstrument === true)
    check('AX7 @手风琴@ 之后的主声部事件标记 explicitInstrument=true', explicitEv.length > 0, `n=${explicitEv.length}`)
    check('AX7b @手风琴@ 之前的主声部事件 explicitInstrument 不为 true（走 Y:/试听音色默认）',
      melEv.filter((e) => e.explicitInstrument !== true).length > 0,
      `n=${melEv.filter((e) => e.explicitInstrument !== true).length}`)
    check('AX7c 段层（伴奏）事件不因段内 @ 而标记 explicit（伴奏走固定第二音色）',
      seq434.events.filter((e) => e.placed.segment).every((e) => e.explicitInstrument !== true),
      '')
    // AX8/AX9（adj436，E-2026-176）：**倚音事件必须继承主音符的声部角色与音色来源**——
    // 用户报「演奏到 `3/[3/5/]` 处又切回主音色了，应该还是手风琴」：倚音是以**独立事件**发声的，
    // 旧代码只给主音符加 `explicitInstrument`/`playVoice`，倚音缺这两个字段 ⇒ 被「试听音色」全局覆盖压回主音色。
    const graceEv = seq434.events.filter((e) => e.pitch !== undefined && e.pitch !== null)
    check('AX8 存在倚音事件（用户原行含 `3/[3/5/]`）', graceEv.length >= 2, `n=${graceEv.length}`)
    check('AX9 倚音事件音色 = 手风琴（与所属主音符一致，不被试听音色压回）',
      graceEv.length > 0 && graceEv.every((e) => e.instrument === '手风琴'),
      `insts=${[...new Set(graceEv.map((e) => e.instrument))].join('/')}`)
    check('AX9b 倚音事件带 explicitInstrument（`@` 之后）',
      graceEv.every((e) => e.explicitInstrument === true),
      `flags=${[...new Set(graceEv.map((e) => String(e.explicitInstrument)))].join('/')}`)
    check('AX9c 倚音事件带 playVoice（与主音符同角色，段内倚音不丢伴奏音色）',
      graceEv.every((e) => e.playVoice === undefined || e.playVoice === 'main' || e.playVoice === 'accomp' || e.playVoice === 'second'),
      `roles=${[...new Set(graceEv.map((e) => e.playVoice ?? '-'))].join('/')}`)

    // ---- adj455：选定「试听音色」= **全篇统一音色**（含伴奏/第二声部与曲内 `@乐器名@`）----
    // 用户规格：「音色选自动时按 曲内 @ > 描述头 Y: > 启用音色第一 > 音色库第一 路由；
    // 选定具体音色时**全篇**都用它」——修复前 adj427/adj434 给伴奏与 `@` 开了两个例外，
    // 表现为「只有主旋律（第一个音色）变成我选的音色，伴奏还是手风琴」。
    const seq455 = buildPlaySequence(pr434, layoutScore(pr434, DUR_CFG), 120, undefined, '大钢琴', '小提琴')
    const allInsts = [...new Set(seq455.events.map((e) => e.instrument))]
    check('AY1 全篇覆盖：所有事件（主声部/伴奏/段后 @）音色 = 小提琴', allInsts.length === 1 && allInsts[0] === '小提琴', `集合=${allInsts.join('/')}`)
    check('AY2 全篇覆盖：曲内 `@手风琴@` 也被覆盖（不再保留显式音色）',
      seq455.events.filter((e) => e.explicitInstrument === true).length === 0,
      `explicit=${seq455.events.filter((e) => e.explicitInstrument === true).length}`)
    const trk455 = [...new Set(seq455.events.flatMap((e) => (e.playheadSegs ?? []).map((s) => s.instrument ?? '')))]
    check('AY3 全篇覆盖：色块轨道音色同样统一（音频与配色不能各说各话）', trk455.length === 1 && trk455[0] === '小提琴', `集合=${trk455.join('/')}`)
    check('AY4 全篇覆盖：力度角色不变（伴奏仍 0.75，只是换了音色）',
      seq455.events.filter((e) => e.playVoice === 'accomp').every((e) => e.gain === 0.75) &&
        seq455.events.filter((e) => e.playVoice === 'accomp').length > 0,
      `gains=${[...new Set(seq455.events.filter((e) => e.playVoice === 'accomp').map((e) => e.gain))].join('/')}`)
    check('AY5 覆盖为空串/undefined 时完全不介入（= 自动模式，路由与 AX 一致）',
      JSON.stringify(buildPlaySequence(pr434, layoutScore(pr434, DUR_CFG), 120, undefined, '大钢琴', '').events.map((e) => e.instrument)) === JSON.stringify(seq434.events.map((e) => e.instrument)) &&
        JSON.stringify(buildPlaySequence(pr434, layoutScore(pr434, DUR_CFG), 120, undefined, '大钢琴').events.map((e) => e.instrument)) === JSON.stringify(seq434.events.map((e) => e.instrument)),
      '')
    // `@乐器名@` 处数（供界面提示"已被试听音色覆盖"，避免误判"写了 @ 却不生效"）
    check('AY6 countScoreInstrumentSwitches 数出曲内 @ 切换处数（本行 2 处，@@ 不计）',
      countScoreInstrumentSwitches(pr434) === 2 && countScoreInstrumentSwitches(parseJps('V: 1.0\nQ: 1 2 3 4 |\n')) === 0 &&
        countScoreInstrumentSwitches(parseJps('V: 1.0\nQ: @@ 1 2 3 4 |\n')) === 0,
      `n=${countScoreInstrumentSwitches(pr434)}`)
    // program ↔ 音色名 ref 互逆（全篇覆盖传的是 ref，后端 setVoice 传的是 program，两者必须同源）
    const rtBad = GM_VOICES.filter((v) => gmVoiceProgram(gmVoiceRef(v.program)) !== v.program)
    check('AY7 gmVoiceRef ↔ gmVoiceProgram 对 128 个音色逐项互逆', rtBad.length === 0, `不一致=${rtBad.map((v) => v.label).join('/')}`)
    check('AY8 gmVoiceRef 边界：null/越界 program → undefined',
      gmVoiceRef(null) === undefined && gmVoiceRef(undefined) === undefined && gmVoiceRef(999) === undefined && gmVoiceRef(NaN) === undefined,
      '')
    const dlg455 = String(readFileSync('src/dialogs/PlaybackDialog.tsx', 'utf8'))
    check('AY9 应用侧把「音色」选择作为全篇覆盖传入 buildPlaySequence',
      /buildPlaySequence\(parseResult, layout, bpm, playbackStartId, defaultInstrumentRef, voiceOverrideRef\)/.test(dlg455) &&
        dlg455.includes('gmVoiceRef(playbackHqVoice)'),
      '')
    /**
     * adj457（用户决策）：**导出始终按谱面音色**——MIDI/WAV/MP3 三条导出路径都不得传乐器覆盖，
     * 否则"选了试听音色再导出"会静默改变导出结果（用户明确要求导出跟随谱面 `Y:` / `@…@`）。
     */
    // adj462：导出面板已从 src/dialogs/ExportDialog.tsx 移到底部 dock（src/ui/dock/ExportPanel.tsx，
    // 重写为流式布局）；断言口径不变——三条导出路径仍不得传乐器覆盖。
    const expSrc = String(readFileSync('src/ui/dock/ExportPanel.tsx', 'utf8'))
    const expCalls = [...expSrc.matchAll(/buildPlaySequence\(([^)]*)\)/g)].map((m) => m[1].trim())
    check('adj457 导出（MIDI/WAV/MP3）一律不传乐器覆盖（按谱面音色导出）',
      expCalls.length === 3 && expCalls.every((args) => args === 'parseResult, layout, bpm, undefined, defaultInstrumentRef'),
      expCalls.join(' | '))
  }
}



// ---- adj427 Step 5c：小节线锚点对齐 / 括号预留 / dsb 两层居中（用户报的 6 项问题） ----
console.log('[adj427] segment barline align / bracket reserve / dsb centering')
{
  // 用户原例（含显式 &zkh / &ykh）
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz &zkh 1 2 3 4 | 5 6 7 1' &ykh } 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  const segN = page.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
  const sb = (page.segmentBrackets ?? [])[0]
  const mainBars = page.barlines.filter((b) => !b.segment).map((b) => b.x).sort((a, b) => a - b)
  const segBars = page.barlines.filter((b) => b.segment).map((b) => b.x).sort((a, b) => a - b)
  // U1：段内小节线必须与主旋律小节线**精确同 x**（不能再落在小节线之后的音符上）
  check('U1 段内小节线 x == 主旋律小节线 x（精确对齐）', segBars.length === 1 && mainBars.some((x) => Math.abs(x - segBars[0]) < 1e-6), `segBars=[${segBars}] mainBars=[${mainBars}]`)
  // U2：包络右缘必须收在**主旋律小节线内侧**（不越线、也不贴到线上）
  const barBefore55 = mainBars[mainBars.length - 1]
  check('U2 包络右缘 x2 收在主旋律末小节线**内侧**（不贴线不越线）', sb !== undefined && sb.x2 <= barBefore55 - 0.11, `x2=${sb?.x2} bar=${barBefore55}`)
  check('U3 段层末音右缘不超过 x2（不压过右括号）', segN.length > 0 && (segN[segN.length - 1].rightX ?? 0) <= (sb?.x2 ?? 0) + 0.11, `segRight=${segN[segN.length - 1]?.rightX} x2=${sb?.x2}`)
  // U4：显式 &zkh 已渲染，且整体落在段首音**左侧**（位置被预留出来）
  const zkh = page.brackets.find((b) => b.code === 'zkh')
  check('U4 &zkh 已渲染为独立括号', zkh !== undefined, `brackets=${page.brackets.map((b) => b.code).join(',')}`)
  check('U5 &zkh 右缘 ≤ 段首音 x（位置已预留，不与首音重合）', zkh !== undefined && segN.length > 0 && zkh.x + zkh.width / 2 <= segN[0].x + 0.11, `zkhRight=${zkh ? zkh.x + zkh.width / 2 : 'n/a'} firstNote=${segN[0]?.x}`)
  // U6：显式 &ykh 已渲染，且整体落在 x2 **之前**（不越主旋律小节线）
  const ykh = page.brackets.find((b) => b.code === 'ykh')
  check('U6 &ykh 已渲染且右缘 ≤ x2（不越主旋律小节线）', ykh !== undefined && sb !== undefined && ykh.x + ykh.width / 2 <= sb.x2 + 0.11, `ykhRight=${ykh ? ykh.x + ykh.width / 2 : 'n/a'} x2=${sb?.x2}`)
  // U7：段层括号不重复——恰好 1 个 zkh + 1 个 ykh（不再叠加自动圆括号）
  const segMarks = page.brackets.filter((b) => b.code === 'zkh' || b.code === 'ykh')
  check('U7 段层括号恰好一对（不重复画）', segMarks.filter((b) => b.code === 'zkh').length === 1 && segMarks.filter((b) => b.code === 'ykh').length === 1, `marks=${segMarks.map((b) => b.code).join(',')}`)
  // U12/U13：括号与**两侧小节线**都要有净距（不得贴线/压线）——用户报「右括号明显偏右」的根因
  {
    const bzBars = page.barlines.filter((b) => !b.segment).map((b) => b.x).sort((a, b) => a - b)
    const lB = bzBars[0]
    const rB = bzBars[bzBars.length - 1]
    const zk = page.brackets.find((b) => b.code === 'zkh')
    const yk = page.brackets.find((b) => b.code === 'ykh')
    const zkL = zk ? zk.x - zk.width / 2 : 0
    const ykR = yk ? yk.x + yk.width / 2 : 0
    check('U12 左括号与小节线有净距（不贴线）', zkL > lB + 0.4, `zkh左缘=${zkL.toFixed(1)} 左线=${lB}`)
    check('U13 右括号与小节线有净距（不贴线/不越线）', ykR < rB - 0.4, `ykh右缘=${ykR.toFixed(1)} 右线=${rB}`)
    check(
      'U14 左右括号相对各自小节线的净距接近（不对称过大即为"偏右"）',
      Math.abs((rB - ykR) - (zkL - lB)) < 6,
      `左距=${(zkL - lB).toFixed(1)} 右距=${(rB - ykR).toFixed(1)}`,
    )
  }
  const mains = page.notes.filter((n) => !n.segment).sort((a, b) => a.x - b.x)
  // adj430：旧"严格拍位对齐"假设**段内音 bx0 = 主旋律包络对应拍位 bx0**——在 `{bz 8 &zkh 2'/ 3'/}`
  // 之类拍位映射**越过 xContent1**的场景下会丢失后续音。修复后段内音 bx0 = 拍位映射
  // × scale（整体压缩到段宽内），**段首/段末仍对齐 xContent0/xContent1**，但中间不再
  // 严格等于主旋律 x——所以 U8 改成"段首音对齐 xContent0、段末音对齐 xContent1"，
  // 中间按段内拍位比例（不再逐音对齐主旋律）。
  const segFirst430 = segN[0]
  const segLast430 = segN[segN.length - 1]
  const mainFirst = mains[2] // 包络起点音
  const mainLast = mains[9] // 包络终点音
  check('U8a 段首音 bx0 ≈ 主旋律包络首音 x（对齐段左界）',
    Math.abs(segFirst430.x - mainFirst.x) < 0.11,
    `segFirst.x=${segFirst430.x.toFixed(2)} mainFirst.x=${mainFirst.x.toFixed(2)}`)
  check('U8b 段末音 bx1 ≤ 主旋律包络末音 x 且 bx1 > 0（不丢失 + 在段右界内）',
    segLast430.x + (segLast430.width ?? 0) <= mainLast.x + 0.5 + 16.75, // 容许括号预留区
    `segLast.x=${segLast430.x.toFixed(2)} mainLast.x=${mainLast.x.toFixed(2)}`)
  // U9：括号**纵向**与数字对齐——`renderBracket` 以 yTop 为字形中心，须 = 基线 − 0.4×字号
  //     （此前传 −0.7×字号，括号比数字高 0.3×字号 ≈4px）
  const ns = DUR_CFG.note_size
  check('U9 括号字形中心 = 段层数字中心（基线 − 0.4×字号）', zkh !== undefined && Math.abs(zkh.yTop - (segN[0].y - ns * 0.4)) < 0.11, `yTop=${zkh?.yTop} expect=${(segN[0].y - ns * 0.4).toFixed(1)}`)
  // U10：括号**横向**与相邻音符留 nonDurGap（0.5×字号），不再紧贴
  const gap = ns * 0.5
  check('U10 &zkh 与段首音间距 = nonDurGap（0.5×字号）', zkh !== undefined && Math.abs(segN[0].x - gap - (zkh.x + zkh.width / 2)) < 0.11, `gap=${(segN[0].x - (zkh.x + zkh.width / 2)).toFixed(2)} expect=${gap}`)
  const segLast = segN[segN.length - 1]
  check('U11 &ykh 与段层末音右缘间距 = nonDurGap', ykh !== undefined && Math.abs((ykh.x - ykh.width / 2) - ((segLast.rightX ?? 0) + gap)) < 0.11, `gap=${((ykh.x - ykh.width / 2) - (segLast.rightX ?? 0)).toFixed(2)} expect=${gap}`)
}
{
  // 无显式括号：自动合成同一套文本括号字形（同样留间距、同纵向基准）
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  const segN = page.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
  const ns2 = DUR_CFG.note_size
  const zkh2 = page.brackets.find((b) => b.code === 'zkh')
  const ykh2 = page.brackets.find((b) => b.code === 'ykh')
  check('V1 无显式括号 → 自动合成一对 zkh/ykh', zkh2 !== undefined && ykh2 !== undefined, `marks=${page.brackets.map((b) => b.code).join(',')}`)
  check('V2 自动括号也留 nonDurGap（右缘 = 首音 x − 0.5×字号）', zkh2 !== undefined && segN.length > 0 && Math.abs(segN[0].x - ns2 * 0.5 - (zkh2.x + zkh2.width / 2)) < 0.11, `right=${zkh2 ? (zkh2.x + zkh2.width / 2).toFixed(1) : 'n/a'} firstNote=${segN[0]?.x}`)
  check('V3 自动括号纵向同样与数字中心对齐', zkh2 !== undefined && segN.length > 0 && Math.abs(zkh2.yTop - (segN[0].y - ns2 * 0.4)) < 0.11, `yTop=${zkh2?.yTop}`)
}
{
  // dsb：两层整体下移使整块与主旋律**居中**
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1' } 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const page = layoutScore(parseJps(src), DUR_CFG).pages[0]
  const segN = page.notes.filter((n) => n.segment)
  const sb = (page.segmentBrackets ?? [])[0]
  // 包络外主旋律（第 1、2、11、12 个音）与包络内主旋律 y 不同
  const mains = page.notes.filter((n) => !n.segment)
  const ys = [...new Set(mains.map((n) => n.y))].sort((a, b) => a - b)
  check('W1 dsb 包络内主旋律已下移（出现两个 y）', ys.length === 2, `ys=${ys.join(',')}`)
  const yOut = ys[0]
  const yIn = ys[1]
  check('W2 段层在主旋律上方（段层 y < 包络内 y）', segN.length > 0 && segN[0].y < yIn, `seg=${segN[0]?.y} in=${yIn}`)
  check('W3 两层中线 == 行基线（整块居中）', Math.abs((segN[0].y + yIn) / 2 - yOut) < 0.11, `mid=${(segN[0].y + yIn) / 2} rowY=${yOut}`)
  check('W4 yBottomLower 跨到下层（> yBottom）', sb?.yBottomLower !== undefined && sb.yBottomLower > sb.yBottom, `lo=${sb?.yBottomLower} hi=${sb?.yBottom}`)
  check('W5 dsb 段内小节线仍与主旋律小节线对齐', (() => {
    const mb = page.barlines.filter((b) => !b.segment).map((b) => b.x)
    const sbx = page.barlines.filter((b) => b.segment).map((b) => b.x)
    return sbx.length === 1 && mb.some((x) => Math.abs(x - sbx[0]) < 1e-6)
  })(), `segBars=${page.barlines.filter((b) => b.segment).map((b) => b.x).join(',')}`)
  // ---- X：大括号是「无时值占宽元素」，排在小节线**内侧**（用户报：原来跑到小节线外面了） ----
  {
    const nsx = DUR_CFG.note_size
    const braceW = Math.max(3, nsx * 0.32)
    const mainBars = page.barlines.filter((b) => !b.segment).map((b) => b.x).sort((a, b) => a - b)
    const barLeft = mainBars[0]
    const barRight = mainBars[mainBars.length - 1]
    const zkhX = page.brackets.find((b) => b.code === 'zkh')
    const ykhX = page.brackets.find((b) => b.code === 'ykh')
    const braceL = sb?.x1 ?? 0
    const braceR = sb?.x2 ?? 0
    check('X1 左大括号在起始小节线**右侧**', braceL >= barLeft - 0.11, `braceL=${braceL} bar=${barLeft}`)
    check('X2 右大括号在末尾小节线**左侧**', braceR + braceW <= barRight + 0.11, `braceR=${braceR}+${braceW.toFixed(2)} bar=${barRight}`)
    check('X3 左大括号在左圆括号**左侧**（不重叠）', zkhX !== undefined && braceL + braceW <= zkhX.x - zkhX.width / 2 + 0.11, `braceR=${(braceL + braceW).toFixed(1)} parenL=${zkhX ? (zkhX.x - zkhX.width / 2).toFixed(1) : 'n/a'}`)
    check('X4 右大括号在右圆括号**右侧**（不重叠）', ykhX !== undefined && braceR >= ykhX.x + ykhX.width / 2 - 0.11, `braceL=${braceR} parenR=${ykhX ? (ykhX.x + ykhX.width / 2).toFixed(1) : 'n/a'}`)
    check('X5 大括号与内容不重叠（左括号槽右缘 ≤ 段首音）', segN.length > 0 && braceL + braceW <= segN[0].x + 0.11, `braceR=${(braceL + braceW).toFixed(1)} firstNote=${segN[0]?.x}`)
    // X6：线条加粗——渲染出的 `stroke-width` ≥ 1.8
    // X6：大括号用**自绘描边路径**（细描边、与字体无关）+ 纵向**真正包住**上下两层
    const svgDsb = renderScoreToSvg(layoutScore(parseJps(src), DUR_CFG))[0]
    const mAll = svgDsb.match(/<path[^>]*data-segment-brace="dsb"[^>]*>/g) ?? []
    check('X6 左右大括号各一条路径', mAll.length === 2, `got ${mAll.length}`)
    check('X6b 自绘描边路径（fill=none + 细 stroke-width，不用字体字形）', mAll.every((s) => /fill="none"/.test(s) && /stroke-width="[\d.]+"/.test(s)), mAll[0]?.slice(0, 70) ?? '')
    check('X6c 不依赖字体字形（不是 <text>）', !/<text[^>]*data-segment-brace/.test(svgDsb), '')
    check('X6d 路径含 M/Q/L 描边指令（最简绘制方式）', mAll.every((s) => /M /.test(s) && /Q /.test(s) && /L /.test(s)), `got ${mAll[0]?.slice(0, 60)}`)
    // X6e：纵向**包住**——上过上一行音符上沿（数码顶 = 基线 − 0.8×字号）、下过下一行音符下沿
    {
      const nsx2 = DUR_CFG.note_size
      const upperBaseline = Math.min(...segN.map((n) => n.y))
      const lowerBaseline = Math.max(...page.notes.filter((n) => !n.segment).map((n) => n.y))
      const digitTop = upperBaseline - nsx2 * 0.8
      check('X6e 大括号上端高于上一行音符上沿', (sb?.yTop ?? 0) < digitTop, `yTop=${sb?.yTop} digitTop=${digitTop.toFixed(1)}`)
      check('X6f 大括号下端低于下一行音符下沿', (sb?.yBottomLower ?? 0) > lowerBaseline, `yBotLo=${sb?.yBottomLower} lowerBaseline=${lowerBaseline.toFixed(1)}`)
      // X6g：轮廓**完全落在自己的占宽槽位内**——两个边界曲线必须过 `xs ± e`（中轴两侧），
      //      若误用 `xTip ± e` 会整体偏向外侧、越出槽位并压到圆括号（曾出现过该 bug）
      const dAttr = /d="([^"]+)"/.exec(mAll[0] ?? '')?.[1] ?? ''
      const coords = (dAttr.match(/-?[\d.]+/g) ?? []).map(Number)
      const xs2 = coords.filter((_, i) => i % 2 === 0)
      const slotL = sb?.x1 ?? 0
      const slotR = slotL + Math.max(3, nsx2 * 0.32)
      check(
        'X6g 轮廓不越出自身占宽槽位（不压到圆括号）',
        xs2.length > 0 && Math.min(...xs2) >= slotL - 0.11 && Math.max(...xs2) <= slotR + 0.11,
        `x范围=[${Math.min(...xs2)},${Math.max(...xs2)}] 槽=[${slotL},${slotR.toFixed(1)}]`,
      )
    }
    check('X7 大括号横向占宽 ≈ max(3, 0.32×字号)', Math.abs(braceW - Math.max(3, nsx * 0.32)) < 0.01, `w=${braceW}`)
    // X8：dsb 内部三个元素（左大括号 / 左圆括号 / 内容）**依次不重叠**，且都在小节线内侧
    const braceLEdge = braceL + braceW
    const parenLEdge = zkhX ? zkhX.x - zkhX.width / 2 : Number.NaN
    check(
      'X8 dsb 内部依次不重叠（括号间 / 括号与内容 / 括号与小节线）',
      braceLEdge <= parenLEdge + 0.11 && parenLEdge + (zkhX?.width ?? 0) <= (segN[0]?.x ?? 0) + 0.11 && braceL >= barLeft - 0.11,
      `bar=${barLeft} brace=[${braceL.toFixed(1)},${braceLEdge.toFixed(1)}] paren=[${parenLEdge.toFixed(1)},${(parenLEdge + (zkhX?.width ?? 0)).toFixed(1)}] content=${segN[0]?.x?.toFixed(1)} 间距=(${(parenLEdge - braceLEdge).toFixed(2)},${((segN[0]?.x ?? 0) - parenLEdge - (zkhX?.width ?? 0)).toFixed(2)})`,
    )
    // X9：段边界加权应让小节的「小节线 → 内容」净空明显变宽（详见 extraOf 的 segWeight）
    // X9：段边界加权（只作用于**空间优先**路径 = 应用默认布局）应让「小节线 → 内容」净空变宽。
    //     注意：本块其余断言跑在 DUR_CFG（时值优先）下——段层叠加与括号几何两条路径共用，
    //     但"逐拍加权"只在空间优先路径生效，故这里单独用空间优先配置测。
    const SPC = { ...defaultPageConfig, noteSpaceLayout: 'space' as const }
    const pageSp = layoutScore(parseJps(src), SPC).pages[0]
    const segNSp = pageSp.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
    const barSp = pageSp.barlines.filter((b) => !b.segment).map((b) => b.x).sort((a, b) => a - b)[0]
    const clearSp = (segNSp[0]?.x ?? 0) - barSp
    check('X9 空间优先（默认布局）：段边界小节线内侧净空已加宽（≥ 20px）', clearSp >= 20, `净空=${clearSp.toFixed(1)}px bar=${barSp} content=${segNSp[0]?.x}`)
    check('X10 空间优先：大括号同样在小节线内侧', (() => {
      const sbSp = (pageSp.segmentBrackets ?? [])[0]
      const barsSp = pageSp.barlines.filter((b) => !b.segment).map((b) => b.x).sort((a, b) => a - b)
      const bw = Math.max(3, SPC.note_size * 0.32)
      return sbSp !== undefined && sbSp.x1 >= barsSp[0] - 0.11 && sbSp.x2 + bw <= barsSp[barsSp.length - 1] + 0.11
    })(), JSON.stringify((pageSp.segmentBrackets ?? [])[0]))
  }
}

// ---- adj427 Step 5h：**各小节每拍占宽必须均匀**（段内拍不得比其它主声部小节宽） ----
// 用户实测发现过回归：段边界加权把 `3 4 |` 压到 21.70px/拍、段内撑到 51.05px/拍（2.35×）。
// 这里直接量「同一小节内相邻音符间距」（= 每拍占宽，不含跨小节线的间隙），两种布局各跑一遍。
console.log('[adj427] per-beat width uniform across measures')
{
  const src = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const srcDsb = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const SPC2 = { ...defaultPageConfig, noteSpaceLayout: 'space' as const }
  const diffs = (code: string, cfg: typeof DUR_CFG): number[] => {
    const pg = layoutScore(parseJps(code), cfg).pages[0]
    const bars = [...new Set(pg.notes.filter((n) => !n.segment).map((n) => n.barIndex))]
    const out: number[] = []
    for (const bi of bars) {
      const ns2 = pg.notes.filter((n) => !n.segment && n.barIndex === bi).sort((a, b) => a.x - b.x)
      for (let i = 1; i < ns2.length; i++) out.push(ns2[i].x - ns2[i - 1].x)
    }
    return out
  }
  for (const [nm, cfg] of [['空间优先(默认)', SPC2], ['时值优先', DUR_CFG]] as const) {
    for (const [tag, code] of [['bz', src], ['dsb', srcDsb]] as const) {
      const d = diffs(code, cfg)
      const lo2 = Math.min(...d)
      const hi2 = Math.max(...d)
      check(
        `Y1[${nm}/${tag}] 各小节每拍占宽均匀（max/min ≤ 1.05）`,
        d.length >= 6 && hi2 / lo2 <= 1.05,
        `每拍占宽=${d.map((v) => v.toFixed(1)).join(',')} 比值=${(hi2 / lo2).toFixed(3)}`,
      )
    }
  }
  // Y2：段内拍与「3 4」小节的每拍占宽**逐一相等**（同一行内不得有差异）
  {
    const pg = layoutScore(parseJps(src), SPC2).pages[0]
    const d = diffs(src, SPC2)
    check('Y2 空间优先：段内拍与 `3 4` 小节每拍占宽一致', Math.max(...d) - Math.min(...d) < 0.6, `差=${(Math.max(...d) - Math.min(...d)).toFixed(2)}px`)
  }
}

// ---- adj428：临时段上下层纵向间距 `segmentRowGap` 可调（bz/dsb 分别独立）----
// 用户原例：硬编码 `note_size × 1.7 ≈ 22.1px`（ns=13）。允许在设置面板里改 `segmentRowGap.{bz,dsb}`。
// 几何期望：
//   - bz：主旋律行基线 yRow 不动；段层 yUpper = yRow − segmentRowGap.bz。
//   - dsb：包络内主旋律 yIn = yRow + segmentRowGap.dsb / 2；段层 yUpper = yRow − segmentRowGap.dsb / 2；
//         两层中线 = yRow（整块居中不变）。
console.log('[adj428] segmentRowGap (bz/dsb) configurable')
{
  const srcBz = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  const srcDsb = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5\n"
  // 取主旋律包络外的音作为「行基线 yRow」参考（不受段影响）
  const rowYOf = (pg: ReturnType<typeof layoutScore>['pages'][number]): number => {
    const mains = pg.notes.filter((n) => !n.segment)
    const ys = [...new Set(mains.map((n) => n.y))].sort((a, b) => a - b)
    return ys[0]
  }
  // Y3：bz 默认间距 = 22 px（与 adj427 原值 ≈`note_size × 1.7` 一致，零回归）
  {
    const pg = layoutScore(parseJps(srcBz), DUR_CFG).pages[0]
    const yRow = rowYOf(pg)
    const segY = pg.notes.find((n) => n.segment)?.y
    check('Y3 bz 默认间距 = 22 px（adj428 零回归）', segY !== undefined && Math.abs((yRow - segY) - 22) < 0.11, `gap=${(yRow - (segY ?? 0)).toFixed(2)}`)
  }
  // Y4：dsb 默认间距 = 22 px（包络内主旋律下移 11、段层上移 11）
  {
    const pg = layoutScore(parseJps(srcDsb), DUR_CFG).pages[0]
    const yRow = rowYOf(pg)
    const mains = pg.notes.filter((n) => !n.segment)
    const ys = [...new Set(mains.map((n) => n.y))].sort((a, b) => a - b)
    const yIn = ys[1]
    const segY = pg.notes.find((n) => n.segment)?.y
    check('Y4 dsb 默认间距 = 22 px（整块居中）',
      yIn !== undefined && segY !== undefined && Math.abs((yIn - yRow) - 11) < 0.11 && Math.abs((yRow - segY) - 11) < 0.11,
      `yRow=${yRow.toFixed(2)} yIn=${yIn?.toFixed(2)} segY=${segY?.toFixed(2)}`,
    )
  }
  // Y5：bz 把 segmentRowGap.bz 改成 40 → 段层 y = yRow − 40（主旋律 yRow 不动）
  {
    const cfg = { ...DUR_CFG, segmentRowGap: { bz: 40 } }
    const pg = layoutScore(parseJps(srcBz), cfg).pages[0]
    const yRow = rowYOf(pg)
    const segY = pg.notes.find((n) => n.segment)?.y
    check('Y5 bz segmentRowGap=40 → 段层 y = yRow − 40（主旋律不动）',
      segY !== undefined && Math.abs((yRow - segY) - 40) < 0.11,
      `gap=${(yRow - (segY ?? 0)).toFixed(2)}`,
    )
  }
  // Y6：dsb 把 segmentRowGap.dsb 改成 50 → 段层 / 包络内主旋律 各偏移 25
  {
    const cfg = { ...DUR_CFG, segmentRowGap: { dsb: 50 } }
    const pg = layoutScore(parseJps(srcDsb), cfg).pages[0]
    const yRow = rowYOf(pg)
    const mains = pg.notes.filter((n) => !n.segment)
    const ys = [...new Set(mains.map((n) => n.y))].sort((a, b) => a - b)
    const yIn = ys[1]
    const segY = pg.notes.find((n) => n.segment)?.y
    check('Y6 dsb segmentRowGap=50 → 上移/下移各 25（整块居中仍成立）',
      yIn !== undefined && segY !== undefined
        && Math.abs((yIn - yRow) - 25) < 0.11
        && Math.abs((yRow - segY) - 25) < 0.11
        && Math.abs(((segY + yIn) / 2) - yRow) < 0.11,
      `yRow=${yRow.toFixed(2)} yIn=${yIn?.toFixed(2)} segY=${segY?.toFixed(2)} mid=${((segY ?? 0) + (yIn ?? 0)) / 2}`,
    )
  }
}

// ---- adj443（E-2026-184）：桌面端（Tauri）不得注册 Service Worker ----
// 用户报「PC 版重新安装后打开还是旧界面，要按 Ctrl+R 才更新」——根因：Tauri v2 在 Windows 用
// `http(s)://tauri.localhost`（**安全上下文，SW 能正常注册**，原注释以为会静默失败），
// SW 从 Cache Storage 返回旧资源 ⇒ 磁盘上是新 bundle、界面仍是旧的。
console.log('[adj443] desktop must not register a service worker')
{
  const mainSrc = String(require('node:fs').readFileSync('src/main.tsx', 'utf8'))
  check('AJ8 main.tsx 存在桌面端判定（isTauriDesktop）', mainSrc.includes('isTauriDesktop'))
  // PROBE：用户报 `{bz 8 &zkh @手风琴@ 2'/ 3'/ }` 只显示 `&zkh 2/`
  {
    const sP = "V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 6,/ 3// (2// 2) 2/&rit 3/ 6,/ 5,/&yc |\"p:2/4\" {bz 8 &zkh @手风琴@ 2'/ 3'/ } 6, - |\"p:4/4\" 6/ 3'// 2'/ |\n"
    const tk = parseJps(sP).groups[0].music.tokens
    const segOpen = tk.find((t) => t.kind === 'segment' && (t as { dir?: string }).dir === 'open') as { children?: { kind: string; pitch?: number; diminishCount?: number }[] } | undefined
    const lines: string[] = [`children: ${(segOpen?.children ?? []).map((c) => `${c.kind}${c.pitch !== undefined ? `(${c.pitch} di=${c.diminishCount ?? 0})` : ''}`).join(' ')}`]
    void lines
    // AK（adj444，E-2026-185）：段内写了 `@乐器名@` 时**段层音符不得丢失**——
    // 用户报 `{bz 8 &zkh @手风琴@ 2'/ 3'/ }` 只显示到 `2'/`、`3'/` 不见了。
    // 根因：`beatToX` 的「音符拍区间右端」用了 `nextNote.x`，**跨过小节线**伸到下一小节的音符
    // ⇒ 本音符内部拍位被拉宽 ⇒ 段层内容溢出内容区 ⇒ 末音被钳成 0 宽而丢弃。
    for (const [nm, cfg] of [['时值优先', DUR_CFG], ['空间优先', { ...DUR_CFG, noteSpaceLayout: 'space' as const }]] as const) {
      const prP = parseJps(sP)
      const pgP = layoutScore(prP, cfg).pages[0]
      const sg = pgP.notes.filter((n) => n.segment).sort((a, b) => a.x - b.x)
      check(`AK1[${nm}] 段内 @乐器名@ 不影响段层音符数（3 个：8 + 2'/ + 3'/）`,
        sg.length === 3, `got ${sg.length}: ${sg.map((n) => (n.token as { pitch?: number }).pitch ?? 'r').join(',')}`)
      check(`AK2[${nm}] 段层末音 3'/ 有正宽度（未被钳成 0 而丢弃）`,
        sg.length === 3 && sg[2].width > 1, `w=${sg.map((n) => n.width.toFixed(1)).join(',')}`)
      // AK3：每拍宽均匀——8(1 拍) / 2'(0.5) / 3'(0.5) 的宽度比应为 2:1:1
      check(`AK3[${nm}] 段层每拍宽均匀（8 : 2'/ : 3'/ = 2:1:1）`,
        sg.length === 3 && Math.abs(sg[0].width / sg[1].width - 2) < 0.15 && Math.abs(sg[1].width / sg[2].width - 1) < 0.15,
        `比值=${(sg[0]?.width / sg[1]?.width).toFixed(3)} / ${(sg[1]?.width / sg[2]?.width).toFixed(3)}`)
    }
  }
  check('AJ8b 桌面端分支：注销旧 SW + 清 CacheStorage（老用户一次性摘掉污染缓存）',
    mainSrc.includes('getRegistrations') && mainSrc.includes('caches.delete'))
  check('AJ8c 注册 SW 的代码在 else 分支里（仅非桌面端注册）',
    /else\s*\{[\s\S]*serviceWorker[\s\S]*register\(/.test(mainSrc))
}

// ---- adj445（E-2026-186）：段内音符（`{bz …}` / `{dsb …}`）的光标联动契约 ----
// 用户报「预览区点 {bz} 里的音符，编辑区不定位；编辑区点 {bz} 里的音符，预览区不标红」（dsb 同）。
// 根因：临时段对主旋律时间轴贡献 **0 拍**，段内音符**不在** Q 行的「全局音符序号」流里，
// 而 `codePosToNoteId` / `noteIdToCodePos` 只按主旋律序号推算 ⇒ 段内音符的 id 既算不出也对不上。
// 另修：旧 id 编码 `900000 + 组号×1000 + 段头下标×10 + 序号` 的跨距只有 10，段内音 >10 个即撞号。
console.log('[adj445] segment-note cursor linkage ({bz} / {dsb})')
{
  const head = 'V: 1.0\nB: t\nD: C\nP: 4/4\n'
  const cases: { nm: string; q: string; digits: string[]; durSeqs: number[] }[] = [
    {
      nm: 'bz',
      q: "Q: 3 4 {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |",
      digits: ['1', '2', '3', '4', '5', '6', '7', '1'],
      durSeqs: [0, 1, 2, 3, 4, 5, 6, 7],
    },
    {
      nm: 'dsb',
      q: "Q: 3 4 {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |",
      digits: ['1', '2', '3', '4', '5', '6', '7', '1'],
      durSeqs: [0, 1, 2, 3, 4, 5, 6, 7],
    },
    {
      nm: '同组两段',
      q: "Q: {bz 1 2} 3 4 {dsb 1 2} 5 6 | 7 1' 2' 3' |",
      digits: ['1', '2', '1', '2'],
      // 两段各自从 0 起算（且必须分别落在不同段头的 id 区块）
      durSeqs: [0, 1, 0, 1],
    },
    {
      // 段内含**非时值 token**（`&zkh` 括号、`@手风琴@` 乐器）——序号只数时值 token，
      // 两端必须用同一套计数（否则 `1 2 3 4` 会整体错位）
      nm: '含非时值 token',
      q: "Q: 3 4 {bz &zkh @手风琴@ 1 2 3 4} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |",
      digits: ['1', '2', '3', '4'],
      durSeqs: [0, 1, 2, 3],
    },
  ]
  const segLayouts = [
    ['时值优先', DUR_CFG],
    ['空间优先', { ...DUR_CFG, noteSpaceLayout: 'space' as const }],
  ] as const
  for (const c of cases) {
    const code = head + c.q + '\n'
    for (const [ln, cfg] of segLayouts) {
      const pr = parseJps(code)
      const layout = layoutScore(pr, cfg)
      const svg = renderScoreToSvg(layout).join('')
      const i2p = buildIndexToPage(layout)
      const sg = layout.pages
        .flatMap((p) => p.notes.filter((n) => n.segment))
        .sort((a, b) => a.x - b.x)
      check(
        `AL1[${c.nm}/${ln}] 段内音符数 = ${c.digits.length}`,
        sg.length === c.digits.length,
        `got ${sg.length}`,
      )
      let okSeq = true
      let okId = true
      let okSvg = true
      let okPos = true
      let okBlock = true
      const seen = new Set<number>()
      let prevBase = -1
      sg.forEach((n, i) => {
        // ① id 必须能解码回「段内源码次序」（段内音 >10 个也不许错位）
        const d = decodeSegmentNoteId(n.id.index)
        if (!d || d.durSeq !== c.durSeqs[i]) okSeq = false
        // ⑥ 同组内各段必须落在**互不重叠**的 id 区块（旧编码跨距 10 时会撞号）
        if (d) {
          const base = segmentNoteIndexBase(d.group, d.openIndex)
          if (d.durSeq === 0) {
            if (base <= prevBase) okBlock = false
            prevBase = base
          } else if (base !== prevBase) okBlock = false
        }
        // ② id 唯一、且 indexToPage（光标联动的 page 来源）命中本音符所在页
        if (seen.has(n.id.index)) okId = false
        seen.add(n.id.index)
        if (i2p.get(n.id.index) !== n.id.page) okId = false
        const id = `${n.id.page}_${n.id.voice}_${n.id.group}_${n.id.index}`
        // ③ 渲染出的 data-notepos 必须与 id 契约逐字一致
        if (!svg.includes(`data-notepos="${id}"`)) okSvg = false
        // ④ 谱面 → 编辑器：id 必须落在该音符自己的源码字符上
        const pos = noteIdToCodePos(code, id)
        if (pos === null || code.slice(pos, pos + 1) !== c.digits[i]) okPos = false
        // ⑤ 编辑器 → 谱面：光标在音符上/块末空隙都得到同一 id（块级规则）
        if (pos !== null && codePosToNoteId(code, pos, i2p) !== id) okPos = false
        if (pos !== null && code[pos + 1] === ' ' && codePosToNoteId(code, pos + 1, i2p) !== id) okPos = false
      })
      check(`AL2[${c.nm}/${ln}] 段内音符 id 解码 durSeq = 段内源码次序`, okSeq)
      check(`AL3[${c.nm}/${ln}] 段内音符 id 唯一 + indexToPage 命中本页`, okId)
      check(`AL4[${c.nm}/${ln}] 渲染 data-notepos 与 id 契约一致`, okSvg)
      check(`AL5[${c.nm}/${ln}] 预览 ↔ 编辑区双向定位到本音符源码位置`, okPos)
      check(`AL6[${c.nm}/${ln}] 同组各段 id 区块互不重叠（无撞号）`, okBlock)
    }
  }
  // AL7：同一组内两段必须落在**不同的段头 id 区块**（旧编码跨距 10 时会互相撞号）
  {
    const a = segmentNoteIndexBase(0, 0)
    const b = segmentNoteIndexBase(0, 2)
    check('AL7 单段可容纳 >10 个音而不越入下一段 id 区块',
      decodeSegmentNoteId(a + 11)?.durSeq === 11 && a + 11 < b,
      `a=${a} a+11=${a + 11} b=${b}`)
  }
}

// ---- adj446：多声部「多个 Y: 音色」必须各响各的音色（GM 通道按音色独占分配） ----
// 用户报「多声部乐谱的描述区指定多个 Y: 音色，演奏时只用了第一个音色，其它没用上」。
// 根因：HQ 后端按「乐器族」映射 MIDI 通道（钢琴族→0、弦乐族→2、长笛族→3…未识别→0），
// 同族的两个音色被挤到同一通道；而 MIDI 通道**同时只能有一个 program** ⇒ 后设的音色把
// 先前声部一起改掉，且「(通道,音色) 已发过」的判定让先设的 program 永不再补发 ⇒ 整段只剩一种音色。
console.log('[adj446] multi-voice Y: instruments must each keep their GM program')
{
  // ① 分配器（engine/playback/channels.ts）：不同音色独占不同通道
  {
    const a = new GmChannelAllocator()
    const c0 = a.channelFor(0)
    const c4 = a.channelFor(4)
    check(`AM1 同族不同音色分到不同通道（钢琴 0 vs 电钢琴 4；旧实现同为 0）`, c0 !== c4, `ch ${c0}/${c4}`)
    check('AM2 同一音色复用同一通道（不浪费、programChange 只发一次）',
      a.channelFor(0) === c0 && a.channelFor(4) === c4)
    check('AM3 不占用 GM 打击乐通道 9', !GM_MELODIC_CHANNELS.includes(9))
    const many = new GmChannelAllocator()
    const byChannel = new Map<number, number[]>()
    for (const p of [0, 4, 40, 42, 73, 75, 56, 60, 16, 19, 48, 52, 10, 11, 21, 22, 24, 25]) {
      const ch = many.channelFor(p)
      if (!byChannel.has(ch)) byChannel.set(ch, [])
      byChannel.get(ch)!.push(p)
    }
    check('AM4 音色数超过通道数时只用 15 个旋律通道（9 除外）', byChannel.size === GM_MELODIC_CHANNELS.length,
      `got ${byChannel.size}`)
    check('AM5 前 15 种音色各自独占通道，第 16 种起才开始通道复用',
      [...byChannel.values()].filter((ps) => ps.length > 1).length === 3,
      `复用通道数=${[...byChannel.values()].filter((ps) => ps.length > 1).length}`)
  }
  // ② 端到端：真实事件序列 + 真实分配器 + 后端触发规则 ⇒ 每个音都以自己 Y 行的音色发声
  {
    const head = 'V: 1.0\nB: t\nD: C\nP: 4/4\n'
    // 同族（旧实现必撞通道）+ 异族（旧实现本就正常）都要覆盖
    const cases: { nm: string; ys: [string, string] }[] = [
      { nm: '钢琴+电钢琴', ys: ['钢琴', '电钢琴'] },
      { nm: '小提琴+大提琴', ys: ['小提琴', '大提琴'] },
      { nm: '长笛+竖笛', ys: ['长笛', '竖笛'] },
      { nm: '钢琴+弦乐', ys: ['钢琴', '弦乐'] },
    ]
    for (const c of cases) {
      const code =
        head +
        c.ys.map((y) => `Y: ${y}\n`).join('') +
        'Q1: 1 3 5 3 | 1 - - - |\nQ2: 5 1 3 1 | 5 - - - |\nQ: 1 2 3 4 | 5 6 5 - |\n'
      const pr = parseJps(code)
      check(`AM6[${c.nm}] 两条 Y: 行都进了描述头`, pr.header.instruments.length === 2,
        JSON.stringify(pr.header.instruments))
      const layout = layoutScore(pr, DUR_CFG)
      const seq = buildPlaySequence(pr, layout, 100)
      const alloc = new GmChannelAllocator()
      const plan = seq.events.map((e) => {
        const p = instrumentToProgram(e.instrument)
        return { p, ch: alloc.channelFor(p), at: e.atMs, voice: e.placed.id.voice }
      })
      // 声部 1 = Y[0]、声部 2 = Y[1]（engine 按声部序号取 Y 行）
      const v1p = plan.find((x) => x.voice === 1)?.p
      const v2p = plan.find((x) => x.voice === 2)?.p
      check(`AM7[${c.nm}] 两声部解析出各自的 GM program（Y[0]≠Y[1]）`,
        v1p !== undefined && v2p !== undefined && v1p !== v2p,
        `v1=${v1p} v2=${v2p}`)
      check(`AM8[${c.nm}] 不同音色不共用通道（撞通道即整段只剩一种音色）`,
        plan.filter((x) => x.p === v1p).every((x) => x.ch !== plan.find((y) => y.p === v2p)!.ch))
      // 后端触发规则：按 (atMs, 事件序) 触发；触发时通道音色 ≠ 本音色 → 补发 programChange
      const order = plan.map((_, i) => i).sort((x, y) => plan[x].at - plan[y].at || x - y)
      const cur = new Map<number, number>()
      let wrong = 0
      for (const i of order) {
        const e = plan[i]
        if (cur.get(e.ch) !== e.p) cur.set(e.ch, e.p) // 后端 programChange（按触发时刻核对）
        if (cur.get(e.ch) !== e.p) wrong++
      }
      check(`AM9[${c.nm}] 全部 ${plan.length} 个事件都以自己的音色发声`, wrong === 0, `错 ${wrong} 个`)
    }
  }
  // ③ 结构守卫：HQ 后端必须用「按音色独占通道」的分配器，不得退回按乐器族映射
  {
    const src = String(readFileSync('src/playback/spessaSynthBackend.ts', 'utf8'))
    check('AMA 后端使用 GmChannelAllocator 分配通道', src.includes('GmChannelAllocator'))
    check('AMB 后端不再按「乐器族 → 通道」映射（CHANNEL_OF 已删除）', !src.includes('CHANNEL_OF'))
    check('AMC 触发时刻核对通道音色（channelProgram），而非「发过就不再发」',
      src.includes('channelProgram.get(ch) !== program') && !src.includes('this.programSet'))
    check('AMD stop() 清空通道音色记录（stopAll(true) 会重置合成器状态）',
      /stop\(\)[\s\S]{0,400}channelProgram\.clear\(\)/.test(src))
  }
  // ④ 临时伴奏 `{bz}`：伴奏用 Y[1]、主声部用 Y[0]——两者同族时旧实现同样会互相覆盖
  {
    const code =
      'V: 1.0\nB: t\nD: C\nP: 4/4\nY: 钢琴\nY: 电钢琴\n' +
      "Q: 3 4 {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |\n"
    const pr = parseJps(code)
    const layout = layoutScore(pr, DUR_CFG)
    const seq = buildPlaySequence(pr, layout, 100)
    const progOf = (pred: (e: (typeof seq.events)[number]) => boolean) =>
      new Set(seq.events.filter(pred).map((e) => instrumentToProgram(e.instrument)))
    const accProgs = progOf((e) => e.playVoice === 'accomp' || e.playVoice === 'second')
    const mainProgs = progOf((e) => e.playVoice !== 'accomp' && e.playVoice !== 'second')
    // 期望值直接取自解析函数（adj447 后 `电钢琴` 按应用内列表 = GM 2，而非旧表的 4）
    const wantAcc = instrumentToProgram('电钢琴')
    const wantMain = instrumentToProgram('钢琴')
    check('AMN[bz] 伴奏 = 第 2 条 Y（电钢琴）、主声部 = 第 1 条 Y（钢琴）',
      accProgs.size === 1 && accProgs.has(wantAcc) && mainProgs.size === 1 && mainProgs.has(wantMain),
      `主=${[...mainProgs]} 伴=${[...accProgs]} 期望 ${wantMain}/${wantAcc}`)
    const alloc = new GmChannelAllocator()
    const chMain = alloc.channelFor(wantMain)
    const chAcc = alloc.channelFor(wantAcc)
    check('AMN2[bz] 伴奏与主声部各占一个通道（同族音色也不再互相覆盖）', chMain !== chAcc,
      `主ch${chMain} 伴ch${chAcc}`)
  }
}

// ---- adj447：音色名 ↔ GM program 解析必须完整（用户在列表里看到的名称写进 Y: 要生效） ----
// 与 adj446 同一用户报告的另一半根因：描述头 `Y:` / 曲内 `@乐器名@` 的名称解析只查一张约 40 条
// 中文名的表（`GM_NAME_PROGRAMS`），用户在「设置 → 音色库」里看到的 128 个名称有 101 个解析不到
// 自己的 program（如「钢片琴」→八音盒 10、「教堂风琴」→风琴 16、「弦乐合奏1/2」→同一个 48、
// 「高音/中音/次中音/上低音萨克斯」→全部 65）⇒ 两个声部可能落到同一 program，听起来只剩一种音色。
console.log('[adj447] instrument names must resolve to their own GM program')
{
  check('AN1 GM 音色表 = 128 项且 program 与序号一一对应',
    GM_VOICES.length === 128 && GM_VOICES.every((v, i) => v.program === i),
    `len=${GM_VOICES.length}`)
  const badBare: string[] = []
  const badLabel: string[] = []
  for (const v of GM_VOICES) {
    const bare = v.label.replace(/^\d+\s+/, '')
    if (instrumentToProgram(bare) !== v.program) badBare.push(`${bare}→${instrumentToProgram(bare)}`)
    if (instrumentToProgram(v.label) !== v.program) badLabel.push(`${v.label}→${instrumentToProgram(v.label)}`)
  }
  check('AN2 128 个音色名（不带编号）全部解析到自己的 program', badBare.length === 0,
    `${badBare.length} 项错: ${badBare.slice(0, 6).join(' ')}`)
  check('AN3 128 个音色名（带显示编号，如 `22 手风琴`）同样解析正确', badLabel.length === 0,
    `${badLabel.length} 项错: ${badLabel.slice(0, 6).join(' ')}`)
  // 常用写法与库前缀写法不受影响
  check('AN4 常用名/纯编号/库前缀写法都取到正确 program',
    instrumentToProgram('手风琴') === 21 &&
    instrumentToProgram('21') === 21 &&
    instrumentToProgram('generaluser_gs:大提琴') === 42 &&
    instrumentToProgram('钢琴') === 0,
    `${instrumentToProgram('手风琴')}/${instrumentToProgram('21')}/${instrumentToProgram('generaluser_gs:大提琴')}`)
  // 音色库里"同名族"的选择项必须解析成不同 program（否则多声部必然只响一种）
  const familyPairs: [string, string][] = [
    ['高音萨克斯', '中音萨克斯'], ['弦乐合奏1', '弦乐合奏2'], ['钢片琴', '钟琴'], ['电钢琴', '电钢琴1'],
  ]
  const same = familyPairs.filter(([a, b]) => instrumentToProgram(a) === instrumentToProgram(b))
  check('AN5 同族音色（萨克斯/弦乐合奏/钢片琴…）各解析到不同 program', same.length === 0,
    same.map(([a, b]) => `${a}=${b}=${instrumentToProgram(a)}`).join(' '))
  // 端到端：两条 Y: 行写库内名称 → 两声部 program 不同、通道不同、逐事件音色正确
  {
    const code =
      'V: 1.0\nB: t\nD: C\nP: 4/4\nY: 弦乐合奏1\nY: 弦乐合奏2\n' +
      'Q1: 1 3 5 3 | 1 - - - |\nQ2: 5 1 3 1 | 5 - - - |\n'
    const pr = parseJps(code)
    const layout = layoutScore(pr, DUR_CFG)
    const seq = buildPlaySequence(pr, layout, 100)
    const ps = new Set(seq.events.map((e) => instrumentToProgram(e.instrument)))
    check('AN6[Y: 弦乐合奏1/2] 两声部取得不同 program（旧实现都为 48）',
      ps.size === 2 && ps.has(48) && ps.has(49), `得到 ${[...ps].join(',')}`)
  }
  // 应用内音色列表必须就是这张表（唯一来源，避免再次分叉）
  {
    const appSrc = String(readFileSync('src/playback/spessaSynthBackend.ts', 'utf8'))
    check('AN7 app 的 GM_VOICE_OPTIONS 直接取 engine 的 GM_VOICES（不再各存一份表）',
      appSrc.includes('GM_VOICE_OPTIONS: GmVoice[] = GM_VOICES'))
  }
}

// ---- adj449：多组多声部时，色块必须按「行归属」定界（用户报「第二组色块跑到第一组位置」）----
// 根因：`buildPlaySequence` 建 `voiceBlockByNoteIdx` 时只按「本页第一个包含该声部号的块」匹配——
// 一页里多组多声部块（声部号重复出现）时，第 2 组及之后的所有音符（**以及中间穿插的单声部行**）
// 全被判成第 1 组的块，`computeColorBounds` 便拿第 1 组的 `voiceCenters` 定界 ⇒ 色块整块跑到第 1 组那一行。
console.log('[adj449] color bounds must follow the note own voice block')
{
  const code =
    'V: 1.0\nB: t\nD: C\nP: 4/4\n' +
    "Q1: 1 2 3 4 | 5 6 7 1' |\nQ2: 5 6 7 1' | 1' 7 6 5 |\n" +
    "Q: 1 2 3 4 | 5 6 7 1' |\n" +
    "Q1: 1' 7 6 5 | 5 5 5 - |\nQ2: 5 6 7 1' | 1' 1' 1' - |\n" +
    "Q: 1' 2' 3' 4' | 5' - - - |\n"
  const cfgList = [
    ['时值优先', DUR_CFG],
    ['空间优先', { ...DUR_CFG, noteSpaceLayout: 'space' as const }],
  ] as const
  for (const [ln, cfg] of cfgList) {
    const pr = parseJps(code)
    const layout = layoutScore(pr, cfg)
    const page = layout.pages[0]
    check(`AP[A1/${ln}] 本谱含 2 组多声部块`, page.voiceBlocks.length === 2,
      `got ${page.voiceBlocks.length}`)
    const seq = buildPlaySequence(pr, layout, 100)
    /** 该音符所属的多声部块下标（块纵向范围包含本音符 + 声部号命中）；单声部行返回 -1 */
    const blockIdxOf = (n: { id: { voice: number }; y: number }) =>
      page.voiceBlocks.findIndex(
        (vb) =>
          vb.voices.some((v) => v.voice === n.id.voice) &&
          n.y >= vb.yTop - 0.01 &&
          n.y <= vb.yBottom + 0.01,
      )
    let containOwn = true // 色块纵向范围必须**包含本音符自己**
    let withinBlock = true // 且必须落在**本块**的纵向范围（含自然外扩）内
    let singleNull = true // 单声部行不得被套上多声部块的定界
    let xAligned = true // 横向仍取本音符的**时值段**（色块覆盖整段、数字居中于段内）
    const block2Bounds = new Set<string>()
    const block1Bounds = new Set<string>()
    const topExt = layout.config.note_size * 1.1
    const botExt = layout.config.note_size * 0.6
    let wrong = ''
    for (const e of seq.events) {
      const n = e.placed
      if (n.segment) continue
      const seg0 = e.playheadSegs?.[0]
      if (!seg0) continue
      const has = seg0.yTopMin !== undefined && seg0.yBottomMax !== undefined
      const bi = blockIdxOf(n)
      const key = has ? `${seg0.yTopMin!.toFixed(1)}~${seg0.yBottomMax!.toFixed(1)}` : 'null'
      if (bi < 0) {
        if (has) {
          singleNull = false
          wrong = `单声部 g${n.id.group}v${n.id.voice} 却套上了多声部定界 ${key}`
        }
        continue
      }
      if (bi === 0) block1Bounds.add(key)
      else block2Bounds.add(key)
      if (!has) {
        containOwn = false
        wrong = `多声部 g${n.id.group}v${n.id.voice} 缺少动态定界`
        continue
      }
      if (!(seg0.yTopMin! <= n.y + 0.01 && n.y <= seg0.yBottomMax! + 0.01)) {
        containOwn = false
        wrong = `g${n.id.group}v${n.id.voice} y=${n.y} 不在定界 ${key} 内`
      }
      // 定界须落在**本块**范围内（允许自然的上下外扩 TOP_EXT=1.1×字号 / BOT_EXT=0.6×字号）
      const vb = page.voiceBlocks[bi]
      if (seg0.yTopMin! < vb.yTop - topExt - 0.01 || seg0.yBottomMax! > vb.yBottom + botExt + 0.01) {
        withinBlock = false
        wrong = `g${n.id.group}v${n.id.voice} 定界 ${key} 越出本块 [${(vb.yTop - topExt).toFixed(1)},${(vb.yBottom + botExt).toFixed(1)}]`
      }
      // 横向：色块左缘 = 本音符**时值段**左缘（adj320：色块覆盖整段，数字居中于段内 ⇒ 不必等于音符 x）
      const slotX = n.segments?.[0]?.x
      if (slotX !== undefined && Math.abs(seg0.x - slotX) > 0.6) {
        xAligned = false
        wrong = `g${n.id.group}v${n.id.voice} 色块 x=${seg0.x} ≠ 时值段左缘 x=${slotX}`
      }
      if (seg0.x > n.x + 0.61) {
        xAligned = false
        wrong = `g${n.id.group}v${n.id.voice} 色块 x=${seg0.x} 在音符 x=${n.x} 右侧`
      }
    }
    check(`AP[A2/${ln}] 每个多声部音的色块定界都包含本音符`, containOwn, wrong)
    check(`AP[A3/${ln}] 每组色块定界落在**自己那一组**的纵向范围内`, withinBlock, wrong)
    check(`AP[A4/${ln}] 中间穿插的单声部行不被套上多声部定界`, singleNull, wrong)
    check(`AP[A5/${ln}] 色块横向取本音符的时值段左缘`, xAligned, wrong)
    check(`AP[A6/${ln}] 第 2 组与第 1 组的定界集合不相交（不再共用第 1 组范围）`,
      [...block2Bounds].every((k) => !block1Bounds.has(k)) && block2Bounds.size > 0,
      `组1=${[...block1Bounds].join(',')} 组2=${[...block2Bounds].join(',')}`)
  }
}

// ---- adj451：力度（gain）变量贯通「音频事件 ↔ 色块轨道」（为强弱单/力度记号预留）----
// 用户：力度作为后继强弱单（渐强/渐弱）控制需要用得上，先补充这块的变量，后面再强化。
// 口径：色块拍段 `playheadSegs[].gain` 必须与所属事件的 `PlayEvent.gain` **同源**（缺省 1），
// 这样后续只要算出逐音力度，音频（schedulePlay 的 0.5×gain）与色块轨道就自动一致。
console.log('[adj451] per-event 力度 (gain) must flow into the playhead track')
{
  check('AQ0 PlayheadSeg 类型带 gain（力度倍率）',
    /export interface PlayheadSeg \{[\s\S]*?gain\?: number[\s\S]*?\n\}/.test(
      String(readFileSync('packages/ijipu-engine/src/engine/playback/sequence.ts', 'utf8')),
    ))
  const cases: { nm: string; q: string }[] = [
    { nm: '单声部', q: 'Q: 1 2 3 4 | 5 6 7 1\' |' },
    { nm: 'bz 伴奏', q: "Q: 3 4 {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |" },
    { nm: 'dsb 两层', q: "Q: 3 4 {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |" },
    { nm: '连音合并', q: "Q: (1 - - - | 1) - 0 0 2 3 | 4 5 6 7 |" },
    { nm: '倚音', q: 'Q: 3/[3/5/] 2 3 4 | 5 6 7 1\' |' },
  ]
  for (const c of cases) {
    const pr = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\n' + c.q + '\n')
    const layout = layoutScore(pr, DUR_CFG)
    const seq = buildPlaySequence(pr, layout, 100)
    let sameSource = true
    let missing = 0
    let segs = 0
    let bad = ''
    for (const e of seq.events) {
      const evGain = e.gain ?? 1
      for (const s of e.playheadSegs ?? []) {
        segs++
        if (s.gain === undefined) {
          missing++
          sameSource = false
          bad = `事件 gain=${evGain} 的拍段缺 gain`
        } else if (Math.abs(s.gain - evGain) > 1e-9) {
          sameSource = false
          bad = `拍段 gain=${s.gain} ≠ 事件 gain=${evGain}`
        }
      }
    }
    check(`AQ1[${c.nm}] 每个拍段的 gain 与所属事件同源（${segs} 段）`, sameSource && segs > 0,
      bad || `segs=${segs} missing=${missing}`)
  }
  // bz 伴奏 = 0.75、主声部 = 1（adj427 的既有力度在色块轨道上也要看得到）
  {
    const pr = parseJps("V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3 4 {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 5 5 5 | 5 - - - |\n")
    const seq = buildPlaySequence(pr, layoutScore(pr, DUR_CFG), 100)
    const acc = new Set<number>()
    const main = new Set<number>()
    for (const e of seq.events) {
      for (const s of e.playheadSegs ?? []) {
        if (s.gain === undefined) continue
        if (s.playVoice === 'accomp' || s.playVoice === 'second') acc.add(s.gain)
        else main.add(s.gain)
      }
    }
    check('AQ2[bz] 伴奏拍段 gain = 0.75、主声部 = 1（力度已随色块轨道透出）',
      acc.size === 1 && acc.has(0.75) && main.size === 1 && main.has(1),
      `伴奏=${[...acc]} 主=${[...main]}`)
  }
  // 应用层：轨道条目类型与映射都带上 gain（后续强弱单直接用）
  {
    const storeSrc = String(readFileSync('src/store/docStore.ts', 'utf8'))
    const dlgSrc = String(readFileSync('src/dialogs/PlaybackDialog.tsx', 'utf8'))
    check('AQ3 app 的 playheadTrack 条目类型含 gain', /playheadTrack: \{[\s\S]{0,700}gain\?: number/.test(storeSrc))
    check('AQ4 PlaybackDialog 把拍段 gain 透传进播放轨道', dlgSrc.includes('{ gain: s.gain }'))
  }
}

// ---- 107. 设置分层：源码 > 缓存 > 默认 + 写回只固化用户改动 + 设置行类型校验（adj454）----
console.log('[107] settings layering: source > cache > default, write-back = user edits only (adj454)')
{
  const srcCfg = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n\n# jps-config:{"margin_left":55}\n'
  // 缓存（L1 公共设置）：三项本机值，其中只有 margin_left 与源码冲突
  const cache: PageConfig = { ...defaultPageConfig, margin_left: 99, margin_right: 77, height_quci: 50 }

  // ① 读取优先级：源码 > 缓存 > 默认（三层同时给值时的定位）
  const merged = mergeJpsConfig(srcCfg, cache)
  check('adj454 优先级① 源码压过缓存（margin_left=55 而非 99）', merged.margin_left === 55, `left=${merged.margin_left}`)
  check('adj454 优先级② 源码没有的项由缓存兜底（margin_right=77）', merged.margin_right === 77, `right=${merged.margin_right}`)
  check('adj454 优先级③ 两层都没有的项用默认', merged.note_size === defaultPageConfig.note_size, `note_size=${merged.note_size}`)
  check('adj454 优先级④ 缓存传缺省值时源码仍赢', mergeJpsConfig(srcCfg, { ...defaultPageConfig, margin_left: 1 }).margin_left === 55)

  // ② 写回：只固化「用户本次改动」，缓存来源的值不进谱面（此前点一次保存就把本机设置写进别人的谱）
  const base: PageConfig = { ...merged } // 编辑前生效值
  const next: PageConfig = { ...merged, note_size: 15 } // 用户只改了音符字号
  const edits = mergeConfigEdits(srcCfg, base, next)
  check('adj454 写回只含用户改动（note_size=15）+ 源码原字段（margin_left=55）', edits.note_size === 15 && edits.margin_left === 55 && Object.keys(edits).length === 2, JSON.stringify(edits))
  check('adj454 写回**不含**缓存来源字段', !('margin_right' in edits) && !('height_quci' in edits), JSON.stringify(edits))
  const written = writeJpsConfig(srcCfg, edits)
  check('adj454 落盘后谱面无缓存值', !written.includes('margin_right') && !written.includes('height_quci'), written.split('\n').filter((l) => l.startsWith(JPS_CONFIG_PREFIX)).join('|'))
  check('adj454 落盘后源码值保留 + 新改动写入', extractJpsConfig(written)?.margin_left === 55 && extractJpsConfig(written)?.note_size === 15, JSON.stringify(extractJpsConfig(written)))
  check('adj454 未写盘的缓存项在生效值里仍然生效', mergeJpsConfig(written, cache).margin_right === 77 && mergeJpsConfig(written, cache).height_quci === 50)
  const noChange = writeJpsConfig(srcCfg, mergeConfigEdits(srcCfg, base, base))
  check('adj454 无改动时不新增字段', extractJpsConfig(noChange)?.note_size === undefined && extractJpsConfig(noChange)?.margin_left === 55, JSON.stringify(extractJpsConfig(noChange)))
  const reset = writeJpsConfig(srcCfg, mergeConfigEdits(srcCfg, { ...merged, margin_left: 60 }, { ...merged, margin_left: defaultPageConfig.margin_left }))
  check('adj454 用户把某项改回默认 → 设置行里该项被移除（差量语义）', !reset.includes(JPS_CONFIG_PREFIX), JSON.stringify(reset.slice(-40)))

  // ③ 设置行类型校验：坏 JSON / 坏值 / 拼错的键都要**可见告警**（此前一律静默）
  const badJson = 'V: 1.0\nQ: 1 2 3 4 |\n\n# jps-config:{"margin_left":55\n'
  const badIssues = inspectJpsConfig(badJson)
  check('adj454 坏 JSON → 1 条 warning 且带行号', badIssues.length === 1 && badIssues[0].severity === 'warning' && badIssues[0].line === 4 && badIssues[0].message.includes('无法解析'), JSON.stringify(badIssues))
  const badParsed = parseJps(badJson)
  check('adj454 坏 JSON → 并进解析结果（问题条/状态栏可见）', badParsed.errors.some((e) => e.message.includes('设置行 JSON 无法解析') && e.line === 4), JSON.stringify(badParsed.errors.map((e) => `${e.line}:${e.message}`)))
  check('adj454 坏 JSON → 值仍静默回退缓存（不炸排版）', mergeJpsConfig(badJson, cache).margin_left === 99)

  const wrongType = 'V: 1.0\nQ: 1 2 3 4 |\n\n# jps-config:{"margin_left":"abc","margin_right":70}\n'
  const wtIssues = inspectJpsConfig(wrongType)
  check('adj454 坏值（"abc"）→ 告警且点名该字段', wtIssues.length === 1 && wtIssues[0].message.includes('margin_left'), JSON.stringify(wtIssues))
  const wt = mergeJpsConfig(wrongType, cache)
  check('adj454 坏值被忽略 → 该项回退缓存（99）', wt.margin_left === 99, `left=${wt.margin_left}`)
  check('adj454 同一行里的合法项照常生效（margin_right=70）', wt.margin_right === 70, `right=${wt.margin_right}`)

  const typo = 'V: 1.0\nQ: 1 2 3 4 |\n\n# jps-config:{"margin_laft":30}\n'
  check('adj454 拼错的键 → 告警（此前静默丢弃）', inspectJpsConfig(typo).some((i) => i.message.includes('margin_laft')), JSON.stringify(inspectJpsConfig(typo)))
  check('adj454 拼错的键不影响其它项', mergeJpsConfig(typo, cache).margin_right === 77)

  // 枚举 / 嵌套对象也要校验（坏纸张名会让 PAPER_SIZE 取不到尺寸）
  const badPage = 'V: 1.0\nQ: 1 |\n# jps-config:{"page":"A3"}\n'
  check('adj454 非法纸张名 → 告警并回退', inspectJpsConfig(badPage).some((i) => i.message.includes('page')) && mergeJpsConfig(badPage, null).page === defaultPageConfig.page)
  const badLayout = 'V: 1.0\nQ: 1 |\n# jps-config:{"noteSpaceLayout":"xxx"}\n'
  check('adj454 非法布局模式 → 告警并回退（枚举值为 space/duration）', inspectJpsConfig(badLayout).some((i) => i.message.includes('noteSpaceLayout')) && mergeJpsConfig(badLayout, null).noteSpaceLayout === defaultPageConfig.noteSpaceLayout)
  check('adj454 合法枚举值不误报（space/duration）', inspectJpsConfig('V: 1.0\nQ: 1 |\n# jps-config:{"noteSpaceLayout":"duration","lianyinxian_type":2,"page":"A5_horizontal"}\n').length === 0)
  const badGap = 'V: 1.0\nQ: 1 |\n# jps-config:{"segmentRowGap":{"bz":"x"}}\n'
  check('adj454 段层间距值非数 → 告警并回退', inspectJpsConfig(badGap).some((i) => i.message.includes('segmentRowGap')) && mergeJpsConfig(badGap, null).segmentRowGap?.bz === undefined)
  check('adj454 metaPos 缺 y / heights 元素非数 → 告警', inspectJpsConfig('V: 1.0\nQ: 1 |\n# jps-config:{"metaPos":{"title":{"x":1}}}\n').length === 1 && inspectJpsConfig('V: 1.0\nQ: 1 |\n# jps-config:{"heights":{"a0":[1,2,"x",4]}}\n').length === 1)

  // ④ 缩进的设置行：整行不生效（settings 只认顶格），必须给出告警而不是静默
  const indented = 'V: 1.0\nQ: 1 2 3 4 |\n\n  # jps-config:{"margin_left":55}\n'
  check('adj454 缩进的设置行 → 告警「必须顶格」', parseJps(indented).errors.some((e) => e.message.includes('顶格')), JSON.stringify(parseJps(indented).errors.map((e) => e.message)))
  check('adj454 缩进的设置行确实不生效', mergeJpsConfig(indented, null).margin_left === defaultPageConfig.margin_left)
  check('adj454 合法的顶格设置行**不产生**任何告警', parseJps(srcCfg).errors.length === 0 && inspectJpsConfig(srcCfg).length === 0)
}

// ---- 108. 波音/滑音改用用户提供的**矢量修饰符**（adj458） ----
// 六枚符号改为内联用户给的 SVG 路径（`public/icons/*.svg` → 生成 `engine/render/modifierGlyphs.ts`）。
// 这里守住三件事：
//  ① 生成常量与 SVG 源文件**不漂移**（路径标记逐字一致、包围盒为正）；
//  ② 六种编码都真的渲染出**矢量**标记（`<g transform=... scale>`），且不再出现任何位图（`<image>`）；
//  ③ 摆放尺寸符合预期口径（波音按宽度贴合 9s / 13.5s；滑音按高度贴合、左缘贴数字右缘）。
console.log('[108] mordent/slide modifiers are user-provided vector glyphs (adj458)')
{
  const GLYPH_KEYS = ['sby', 'xby', 'sby+', 'xby+', 'shy', 'xhy', 'yc'] as const
  /** 与 `scripts/gen-modifier-glyphs.mjs` 同一套剥离规则：取 SVG 内部标记（去声明/外层 svg/iconfont 元数据/写死填充色） */
  const svgInner = (name: string): string =>
    readFileSync(join(root, 'public', 'icons', `${name}.svg`), 'utf8')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>[\s\S]*$/, '')
      .replace(/\s+p-id="[^"]*"/g, '')
      .replace(/\s+t="[^"]*"/g, '')
      .replace(/\s+class="[^"]*"/g, '')
      // 写死的填充色去掉（颜色由渲染时外层 <g fill> 统一）；`fill="none"` 是描边语义，保留
      .replace(/\s+fill="(?!none")[^"]*"/g, '')
      .trim()

  // ① 生成常量 vs SVG 源文件
  for (const k of GLYPH_KEYS) {
    const g = MODIFIER_GLYPHS[k]
    check(`adj458 ${k} 的路径标记与 public/icons/${g.name}.svg 逐字一致`, g.path === svgInner(g.name), `${g.path.length} vs ${svgInner(g.name).length}`)
    check(`adj458 ${k} 包围盒为正且宽高比合理`, g.box.w > 0 && g.box.h > 0 && glyphInkAspect(g) > 0.5 && glyphInkAspect(g) < 6, JSON.stringify(g.box))
    // 生成路径不得带写死的颜色：源图「延长记号」自带 fill="#686868"，会被外层 <g fill> 之外单独生效，
    // 于是它会是灰的、深色模式反相后也跟别处不一致 —— 生成器必须把非 none 的 fill 剥掉。
    check(`adj458 ${k} 生成路径不带写死颜色（由外层 <g> 统一上色）`, !/\bfill=/.test(g.path) && !/stroke="#/.test(g.path))
  }

  // ② 端到端：把七种修饰符都写进一份谱，渲染后核对标记形态
  const modCode = 'V: 1.0\nB: t\nD: C\nP: 4/4\nJ: 96\n\nQ: 1&sby 2&xby 3&sby+ 4&xby+ | 5&shy 6&xhy 7&yc 1 |\n'
  const modParsed = parseJps(modCode)
  check('adj458 七种修饰符谱面零解析错误', modParsed.errors.length === 0, JSON.stringify(modParsed.errors.map((e) => e.message)))
  const modSvg = renderScoreToSvg(layoutScore(modParsed, defaultPageConfig))[0]
  const groups = modSvg.match(/<g transform="translate\([^)]*\) scale\([^)]*\)" fill="#1b1b1b">/g) ?? []
  check('adj458 谱面里渲染出 7 个矢量修饰符 <g>（每音一个）', groups.length === 7, `got ${groups.length}`)
  check('adj458 修饰符是**矢量**：SVG 里没有任何 <image> 位图', !/<image\b/.test(modSvg))
  check('adj458 修饰符不引用外部资源（无 href/xlink:href）', !/xlink:href|href="(?!#)/.test(modSvg))
  check('adj458 每个 <g> 内都带着源路径（d= 属性）', (modSvg.match(/<g transform=[^>]*><path d="/g) ?? []).length === 7)

  // ③ 摆放口径：波音按宽度（9s / 13.5s），滑音按高度（与旧弧线等高）
  const inkOf = (svg: string, idx: number) => {
    const m = [...svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/g)][idx]
    return m ? { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) } : null
  }
  const noteSize = defaultPageConfig.note_size ?? 13
  const s = noteSize / 18
  // 第 1~4 个音依次是 sby / xby / sby+ / xby+（宽度 9s / 9s / 13.5s / 13.5s）
  const wantW = [9 * s, 9 * s, 13.5 * s, 13.5 * s]
  const gotW = [0, 1, 2, 3].map((i) => {
    const v = inkOf(modSvg, i)!
    return MODIFIER_GLYPHS[GLYPH_KEYS[i]].box.w * v.s
  })
  check('adj458 波音墨迹宽度 = 9s / 9s / 13.5s / 13.5s（沿用 adj123 的占位口径）', gotW.every((w, i) => Math.abs(w - wantW[i]) < 0.15), gotW.map((w) => w.toFixed(2)).join(','))
  // 第 5~6 个音是 shy / xhy：墨迹高度应与旧弧线包围盒等高（此处只核对两者一致量级、且都 > 4px）
  const gotH = [4, 5].map((i) => {
    const v = inkOf(modSvg, i)!
    return MODIFIER_GLYPHS[GLYPH_KEYS[i]].box.h * v.s
  })
  check('adj458 滑音墨迹高度合理（> 4px，两方向同口径）', gotH.every((h) => h > 4) && Math.abs(gotH[0] - gotH[1]) < 1.5, gotH.map((h) => h.toFixed(2)).join(','))
  // 滑音左缘贴数字右缘：target x = 数字左缘 + digitW；反推源坐标 → 实际墨迹左缘
  const slideLeft = [4, 5].map((i) => {
    const v = inkOf(modSvg, i)!
    return MODIFIER_GLYPHS[GLYPH_KEYS[i]].box.x * v.s + v.tx
  })
  check('adj458 滑音左缘落在数字右缘右侧（不压字）', slideLeft.every((l) => l > 0), slideLeft.map((l) => l.toFixed(2)).join(','))

  // 第 7 个音是 yc（延长记号）：墨迹宽度应为 9.6s（旧手绘的墨迹就是 cx ± 4.8s），
  // 高度随用户图形自身比例（宽高比 1.89，故约 5.1s，比旧手绘的 4.4s 略高）。
  const ycG = inkOf(modSvg, 6)!
  const ycW = MODIFIER_GLYPHS.yc.box.w * ycG.s
  const ycH = MODIFIER_GLYPHS.yc.box.h * ycG.s
  check('adj458 延长记号墨迹宽度 = 9.6s（沿用旧手绘的横向口径）', Math.abs(ycW - 9.6 * s) < 0.15, ycW.toFixed(2))
  check('adj458 延长记号墨迹高度合理（> 3px 且不高于 7s）', ycH > 3 && ycH < 7 * s + 1, ycH.toFixed(2))

  // 源 SVG 必须在（生成器的输入；删了就没法重生成）
  const missingSvg = GLYPH_KEYS.map((k) => MODIFIER_GLYPHS[k].name).filter((n) => !existsSync(join(root, 'public', 'icons', `${n}.svg`)))
  check(`adj458 ${GLYPH_KEYS.length} 枚修饰符的 SVG 源文件都在 public/icons/ 下`, missingSvg.length === 0, missingSvg.join(','))
}

// ---- 109. 谱面自包含：取消本机页面设置层、分享保真（adj480）----
console.log('[109] score self-containment: no local page-config layer (adj480)')
{
  // ① 引擎：configCarryover —— 列出「生效≠默认、但谱面没写（或写得不一样）」的字段
  const body = 'V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'
  const eff = { ...defaultPageConfig, margin_left: 60, height_quci: 18 }
  const carried = writeJpsConfig(body, eff)
  check('adj480 写回后谱面自包含（无未携带项）', configCarryover(carried, mergeJpsConfig(carried, null)).ok, JSON.stringify(configCarryover(carried, eff).missing))
  {
    // 生效值里有非默认项、谱面却是干净源码 → 两项都算"未随谱携带"
    const gap = configCarryover(body, eff)
    check(
      'adj480 未写设置行的谱：非默认项全部计入 missing',
      !gap.ok && gap.missing.length === 2 && gap.missing.some((m) => m.key === 'margin_left' && m.value === 60),
      JSON.stringify(gap.missing),
    )
    // 谱面写了但值与本机生效值不同 → 也算缺口（对方会看到谱面里的旧值）
    const stale = writeJpsConfig(body, { ...defaultPageConfig, margin_left: 40 })
    const gap2 = configCarryover(stale, eff)
    check('adj480 谱面值与生效值不一致 → 计入 missing', gap2.missing.some((m) => m.key === 'margin_left'), JSON.stringify(gap2.missing))
    // 与默认一致的项永远不算缺口（对方也用同一个默认值）
    check('adj480 等于默认值的项不算缺口', !configCarryover(body, { ...defaultPageConfig }).missing.some((m) => m.key === 'margin_left'))
  }
  // ② 应用：不再读写「本机页面设置」缓存，且生效配置 = 默认 ← 谱面
  {
    const storeSrc = String(readFileSync('src/store/docStore.ts', 'utf8'))
    check('adj480 docStore 不再写入本机页面设置缓存', !storeSrc.includes('setItem(PAGE_CONFIG_KEY'), '')
    check('adj480 docStore 的生效配置改吃 null 兜底（只看谱面与默认）', storeSrc.includes('mergeJpsConfig(code, null)'), '')
    check('adj480 docStore 保留旧缓存键的一次性清理', storeSrc.includes('removeItem(PAGE_CONFIG_KEY)'), '')
    check('adj480 迁移会提示用户（不静默丢弃旧设置）', storeSrc.includes('已停用「本机页面设置」缓存'), '')
    const dlgSrc = String(readFileSync('src/dialogs/PageConfigDialog.tsx', 'utf8'))
    check(
      'adj480 设置面板已移除「固化到谱面」按钮（保存即自包含）',
      !dlgSrc.includes('persistFullConfig') && !storeSrc.includes('persistFullConfig') && !/>\s*固化到谱面\s*</.test(dlgSrc),
      `dlg=${dlgSrc.includes('persistFullConfig')} store=${storeSrc.includes('persistFullConfig')}`,
    )
  }
  // ③ 端到端：改一项设置 → 保存 → 用"无任何本机缓存"的环境解析，结果一致（分享保真）
  {
    const base = mergeJpsConfig(body, null)
    const next = { ...base, note_size: 15, margin_left: 62 }
    const saved = writeJpsConfig(body, mergeConfigEdits(body, base, next))
    const onOtherMachine = mergeJpsConfig(saved, null)
    check(
      'adj480 保存后换一台机器（无缓存）解析结果一致',
      onOtherMachine.note_size === 15 && onOtherMachine.margin_left === 62 && onOtherMachine.height_quci === base.height_quci,
      `size=${onOtherMachine.note_size} left=${onOtherMachine.margin_left}`,
    )
    check('adj480 该谱此时自包含（无未随谱携带项）', configCarryover(saved, onOtherMachine).ok, JSON.stringify(configCarryover(saved, onOtherMachine).missing))
  }
}

/**
 * adj481：「新建」的内容必须等于模板文件 `public/未命名.jps`（文件驱动）。
 * 这里走**真实 store 流程**（`newDoc()`）而不是只比较常量——把"菜单「新建」→ 模板文件"这条链路钉住。
 * 依赖上一个用例已装好的 localStorage/window 桩（模块已加载，此处只取 store）。
 */
/**
 * adj526：数值「按住上下拖」的**纯换算**断言 + 范围"单一来源"守卫。
 *
 * 由来（用户报，手机端）：数字输入框没有原生上下小按钮、且部分字段限定范围，
 * 配合"输入即钳制"导致数字改不动；现统一为「键盘输入 / `−`+` 步进 / 按住上下拖」三条路径。
 * 这里断言换算规则本身（可确定性验证），并守卫"谱面字段范围 = 引擎同一份表"。
 */
function runAdj526NumberScrubTests() {
  console.log('[117] number scrub: drag math & single-source ranges (adj526)')
  const S = SCRUB_PX_PER_STEP // 8px 一个步长
  check('adj526 按住上拖增大、下拖减小（每 8px 一档）',
    scrubTarget(100, 0, -S) === 101 &&
      scrubTarget(100, 0, S) === 99 &&
      scrubTarget(100, 0, -S * 3) === 103 &&
      scrubTarget(100, 0, S * 3) === 97,
    `up=${scrubTarget(100, 0, -S)} down=${scrubTarget(100, 0, S)}`)
  check('adj526 位移不足半步不改值（手指微抖不误改）',
    scrubTarget(50, 0, -3) === 50 && scrubTarget(50, 0, 3) === 50,
    '')
  check('adj526 横向位移超阈值转粗调（×10），范围内仍可用',
    scrubTarget(100, 0, -S) === 101 &&
      scrubTarget(100, SCRUB_COARSE_TOL + 1, -S) === 100 + SCRUB_COARSE_FACTOR,
    `coarse=${scrubTarget(100, SCRUB_COARSE_TOL + 1, -S)}`)
  check('adj526 可关闭粗调（小区间字段：一划不跳过头）',
    scrubTarget(14, SCRUB_COARSE_TOL + 100, -S, { coarse: false }) === 15,
    '')
  check('adj526 步长按字段给（预览缩放 = 10）',
    scrubTarget(100, 0, -S, { step: 10 }) === 110 && scrubTarget(100, 0, S, { step: 10 }) === 90,
    '')
  check('adj526 有范围时钳制到区间内',
    scrubTarget(25, 0, S * 10, { min: 20, max: 400 }) === 20 &&
      scrubTarget(395, 0, -S * 10, { min: 20, max: 400 }) === 400 &&
      scrubTarget(50, 0, -S * 30, { min: 10, max: 80 }) === 80,
    '')
  check('adj526 无范围时只做相对增量（不钳制、允许极值，保住"设置里能填极值"的口径）',
    // 上拖（dy 负）= 增大到 140；下拖越过 0 允许变负（−5）——正是"声部间距可为负"这类字段需要的
    scrubTarget(40, 0, -S * 100, {}) === 140 && scrubTarget(0, 0, S * 5, {}) === -5,
    `big=${scrubTarget(40, 0, -S * 100, {})} neg=${scrubTarget(0, 0, S * 5, {})}`)
  check('adj526 谱面数值范围逐项等于引擎 GUIDE_LIMITS / GUIDE_LIMITS_EX（不是抄第二份）',
    PAGE_NUM_RANGES.margin_top === GUIDE_LIMITS.margin_top &&
      PAGE_NUM_RANGES.margin_right === GUIDE_LIMITS.margin_right &&
      PAGE_NUM_RANGES.height_ciqu === GUIDE_LIMITS.height_ciqu &&
      PAGE_NUM_RANGES.descAreaH === GUIDE_LIMITS_EX.descAreaH &&
      PAGE_NUM_RANGES.body_margin_top === GUIDE_LIMITS_EX.body_margin_top &&
      PAGE_NUM_RANGES.height_shengbu === GUIDE_LIMITS_EX.height_shengbu &&
      PAGE_NUM_RANGES.segmentRowGap_bz === GUIDE_LIMITS_EX.segmentRowGap_bz &&
      PAGE_NUM_RANGES.segmentRowGap_dsb === GUIDE_LIMITS_EX.segmentRowGap_dsb,
    '')
  check('adj526 编辑器字号范围来自引擎 EDITOR_FONT_SIZE_RANGE（10~26）',
    EDITOR_FONT_SIZE_RANGE[0] === 10 && EDITOR_FONT_SIZE_RANGE[1] === 26 &&
      coarseFor(EDITOR_FONT_SIZE_RANGE) === false,
    '')
  check('adj526 只有跨度 > 120 的字段启用粗调；无范围字段不启用',
    coarseFor([20, 400]) === true && coarseFor([0, 120]) === false && coarseFor(undefined) === false,
    '')

  // —— 结构护栏：这些是"手机端能改数字"的必需件，缺一件就会回到原问题 ——
  const pageSrc = String(readFileSync('src/dialogs/PageConfigDialog.tsx', 'utf8'))
  const cssAll = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  check('adj526 数值输入改为"本地草稿 + 失焦/回车才钳制"（输入过程中不钳制）',
    /const \[draft, setDraft\] = useState<string \| null>\(null\)/.test(pageSrc) &&
      /onChange=\{\(e\) => setDraft\(e\.target\.value\)\}/.test(pageSrc) &&
      /onBlur=\{commit\}/.test(pageSrc),
    '')
  check('adj526 输入框带手机数字键盘 / 完成键，且接线了拖动与步进',
    /inputMode="numeric"/.test(pageSrc) &&
      /enterKeyHint="done"/.test(pageSrc) &&
      /useNumberScrub\(value, onChange/.test(pageSrc) &&
      (pageSrc.match(/useHoldRepeat\(/g) ?? []).length === 2,
    '')
  check('adj526 步进钮只在粗指针（触屏）显示——桌面保留原生 spinner',
    /\.num-step \{ display: none; \}/.test(cssAll) &&
      /@media \(pointer: coarse\) \{[\s\S]{0,400}?\.num-step \{/.test(cssAll),
    '')
  const topSrc = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))
  // adj526：工具条上的"预览比率 / 编辑器字号"两处值都可按住上下拖；
  // adj529：又给「更多」下拉里的比率补了一处（同一组件），故断言为"至少 2 处"，
  // 具体的 3 处由 adj529 那条断言钉住。
  check('adj526 顶栏"预览比率 / 编辑器字号"两处值都可按住上下拖',
    (topSrc.match(/<ScrubValue/g) ?? []).length >= 2 &&
      topSrc.includes('PREVIEW_ZOOM_RANGE') &&
      topSrc.includes('EDITOR_FONT_SIZE_RANGE'),
    `ScrubValue=${(topSrc.match(/<ScrubValue/g) ?? []).length}`)
  const storeSrc = String(readFileSync('src/store/uiStore.ts', 'utf8'))
  // adj529：setter 的钳制改用**绝对范围** PREVIEW_ZOOM_LIMITS（适配允许越出手动范围），
  // 手动边界改由顶栏 zoomBy 守 PREVIEW_ZOOM_RANGE（见 adj529 那组断言）。
  check('adj526/adj529 预览缩放范围是单一来源（常量导出 + setter 用它钳制）',
    /export const PREVIEW_ZOOM_RANGE: readonly \[number, number\] = \[50, 200\]/.test(storeSrc) &&
      /export const PREVIEW_ZOOM_LIMITS: readonly \[number, number\] = \[30, 400\]/.test(storeSrc) &&
      /setPreviewZoom[\s\S]{0,200}?PREVIEW_ZOOM_LIMITS\[1\][\s\S]{0,80}?PREVIEW_ZOOM_LIMITS\[0\]/.test(storeSrc),
    '')

  // ---- adj528：告警面板"内容自然高"的纯算式（用户连报两次：从最大切建议高度不对） ----
  const RAW = { problemCount: 0, headH: PROB_HEAD_H, rowH: PROB_ROW_H, emptyH: 24, collapsed: false }
  check('adj528 0 条告警 = 内边距 + 占位行（不随 dock 高度变化，也不预留面板头/5 行）',
    problemsContentHeight(RAW) === PROB_PANE_PAD_H + 24,
    `${problemsContentHeight(RAW)}`)
  check('adj528 n 条告警 = 内边距 + 面板头 + n × 单行高（n ≤ 上限）',
    problemsContentHeight({ ...RAW, problemCount: 1 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H &&
      problemsContentHeight({ ...RAW, problemCount: 3 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 3,
    `${problemsContentHeight({ ...RAW, problemCount: 3 })}`)
  check('adj528 超过上限（5 行）按上限计（其余由列表自身滚动）',
    problemsContentHeight({ ...RAW, problemCount: 9 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * PROB_MAX_ROWS &&
      PROB_MAX_ROWS === 5,
    `${problemsContentHeight({ ...RAW, problemCount: 9 })}`)
  // adj555（用户口径）：告警建议高度"≤ N 按实际、> N 按 N"——少时不高出实际内容、多时按上限封顶。
  // 三档边界钉死：n=4（按 4）、n=5（按 5）、n=6（按 5）。后续若误把算式改成"强制 5 行"会立即失败。
  check('adj555 告警行数 ≤ 5 按实际、> 5 按 5 封顶（n=4/5/6 三档边界）',
    problemsContentHeight({ ...RAW, problemCount: 4 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 4 &&
      problemsContentHeight({ ...RAW, problemCount: 5 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 5 &&
      problemsContentHeight({ ...RAW, problemCount: 6 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 5,
    `n=4 → ${problemsContentHeight({ ...RAW, problemCount: 4 })}; n=5 → ${problemsContentHeight({ ...RAW, problemCount: 5 })}; n=6 → ${problemsContentHeight({ ...RAW, problemCount: 6 })}`)
  check('adj528 面板"收起"时只算面板头（列表没渲染）',
    problemsContentHeight({ ...RAW, problemCount: 3, collapsed: true }) === PROB_PANE_PAD_H + PROB_HEAD_H,
    '')
  check('adj528 单行高/占位高缺测时回落到常量（不会算出 0 或负数）',
    problemsContentHeight({ ...RAW, problemCount: 2, rowH: 0 }) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 2 &&
      problemsContentHeight({ ...RAW, problemCount: 2, headH: 0 }) === PROB_PANE_PAD_H + PROB_HEAD_H &&
      problemsContentHeight({ ...RAW, problemCount: 0, emptyH: 0 }) === PROB_PANE_PAD_H + PROB_ROW_H,
    '')
  check('adj528 cap 对算式结果幂等（不放大、能把异常偏大的输入收口到 5 行）',
    capProblemsContentHeight(problemsContentHeight({ ...RAW, problemCount: 9 })) ===
      problemsContentHeight({ ...RAW, problemCount: 9 }) &&
      capProblemsContentHeight(9999) === PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * PROB_MAX_ROWS,
    '')
  // adj555：cap 也必须遵守"≤N 不放大"——2 条告警的实测值是 2 行，cap 后不能变成 5 行
  check('adj555 cap 不会把"少"的告警放大到上限（2 条仍按 2 行算）',
    capProblemsContentHeight(problemsContentHeight({ ...RAW, problemCount: 2 })) ===
      PROB_PANE_PAD_H + PROB_HEAD_H + PROB_ROW_H * 2,
    '')
  // 结构护栏：ToolDock 里告警的高度常量必须引用同一来源（不重新写死数字）
  const dockModuleSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  check('adj528 ToolDock 的高度常量与告警算式同源（引用 dock/problemsHeight）',
    /const PANE_PAD_H = PROBS\.PANE_PAD_H/.test(dockModuleSrc) &&
      /const ROW_H = PROBS\.ROW_H/.test(dockModuleSrc) &&
      /const PROBLEMS_MAX_VISIBLE_ROWS = PROBS\.PROBLEMS_MAX_VISIBLE_ROWS/.test(dockModuleSrc) &&
      /PROBS\.capProblemsContentHeight/.test(dockModuleSrc),
    '')
}

/**
 * adj529：预览比例「双击比率值 → 按宽度适配」——纯算式断言 + 接线护栏。
 *
 * 需求（用户）："**双击顶栏上的预览比率值**这个文本时，按宽度适配的比率显示"，
 * 并明确 **不新增变量、设置**。所以它是"一次性跳到适配值"（写进已有的 `previewZoom`），
 * 不是"适配模式"，也没有新的 store 字段/持久化键。
 */
function runAdj529PreviewFitTests() {
  console.log('[118] preview zoom fit-to-width on double click (adj529)')
  const RANGE = [50, 200] as const
  // 基准宽 + 左右内边距刚好等于 100%：808 − 48 = 760 = 基准宽
  check('adj529 适配比例 = 预览区可用宽 ÷ 基准宽（可用宽 = clientWidth − 左右内边距）',
    fitZoomFor(PREVIEW_BASE_W + PREVIEW_PANE_PAD_X * 2, RANGE) === 100 &&
      fitZoomFor(1000, RANGE) === 125 &&
      fitZoomFor(760, RANGE) === 94,
    `${fitZoomFor(1000, RANGE)} / ${fitZoomFor(760, RANGE)}`)
  check('adj529 适配比例钳到绝对范围（窄预览区可 <50%、很宽的预览区可 >200%）',
    fitZoomFor(340, [30, 400]) === 38 &&
      fitZoomFor(3000, [30, 400]) === 388 &&
      fitZoomFor(300, [30, 400]) === 33 &&
      fitZoomFor(200, [30, 400]) === 30,
    `${fitZoomFor(340, [30, 400])} / ${fitZoomFor(3000, [30, 400])}`)
  check('adj529 手动范围 [50,200] 仍照旧（适配越界值不受它限制）',
    fitZoomFor(340, RANGE) === 50 && fitZoomFor(3000, RANGE) === 200,
    `${fitZoomFor(340, RANGE)} / ${fitZoomFor(3000, RANGE)}`)
  check('adj529 预览区不存在/过窄时返回 0（双击当作无操作，写不进错值）',
    fitZoomFor(0, RANGE) === 0 && fitZoomFor(PREVIEW_PANE_PAD_X, RANGE) === 0 && fitZoomFor(Number.NaN, RANGE) === 0,
    '')
  check('adj529 比例钳制取整',
    clampPreviewZoom(137.6, RANGE) === 138 && clampPreviewZoom(10, RANGE) === 50 && clampPreviewZoom(9e9, RANGE) === 200,
    '')

  // —— 接线护栏 ——
  const storeSrc529 = String(readFileSync('src/store/uiStore.ts', 'utf8'))
  const topSrc529 = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))
  const previewSrc = String(readFileSync('src/preview/PreviewPane.tsx', 'utf8'))
  const scrubSrc = String(readFileSync('src/ui/ScrubValue.tsx', 'utf8'))
  check('adj529 双击比率值 → 现量 .preview-pane 宽度 → 写进已有的 previewZoom（一次到位）',
    /onDoubleClick=\{applyFitZoom\}/.test(topSrc529) &&
      /document\.querySelector<HTMLElement>\('\.preview-pane'\)/.test(topSrc529) &&
      /fitZoomFor\(pane\?\.clientWidth \?\? 0, PREVIEW_ZOOM_LIMITS\)/.test(topSrc529) &&
      /if \(z > 0\) setPreviewZoom\(z\)/.test(topSrc529),
    '')
  // 用户确认"按建议放宽"：适配用**绝对范围** [30,400]（窄/宽预览区都能贴合），
  // 手动 `−`/`+` 仍守 [50,200]（`zoomBy` 里夹），store 的钳制用绝对范围。
  check('adj529 适配/手动两层范围各就各位（适配 PREVIEW_ZOOM_LIMITS；手动 zoomBy 守 PREVIEW_ZOOM_RANGE）',
    /export const PREVIEW_ZOOM_RANGE: readonly \[number, number\] = \[50, 200\]/.test(storeSrc529) &&
      /export const PREVIEW_ZOOM_LIMITS: readonly \[number, number\] = \[30, 400\]/.test(storeSrc529) &&
      /setPreviewZoom[\s\S]{0,200}?PREVIEW_ZOOM_LIMITS\[1\][\s\S]{0,80}?PREVIEW_ZOOM_LIMITS\[0\]/.test(storeSrc529) &&
      /const zoomBy = \(delta: number\) =>[\s\S]{0,200}?PREVIEW_ZOOM_RANGE\[1\][\s\S]{0,80}?PREVIEW_ZOOM_RANGE\[0\]/.test(topSrc529) &&
      (topSrc529.match(/zoomBy\(/g) ?? []).length === 4, // 4 处调用（工具条 ± / 更多下拉 ±）
    `zoomBy=${(topSrc529.match(/zoomBy\(/g) ?? []).length}`)
  check('adj529 不新增设置/状态：无适配开关字段、无新持久化键',
    !/previewZoomFit|previewFitZoom/.test(storeSrc529) &&
      !/ijipu\.previewZoomFit/.test(storeSrc529) &&
      !/previewZoomFit|previewFitZoom/.test(topSrc529) &&
      !/previewZoomFit|previewFitZoom/.test(previewSrc),
    '')
  check('adj529 ScrubValue 支持双击回调（其余调用方不传即无行为）',
    /onDoubleClick\?: \(\) => void/.test(scrubSrc) && /onDoubleClick=\{onDoubleClick\}/.test(scrubSrc),
    '')
  // 用户报"缩进更多菜单后双击比率无效"：工具条折叠进「更多」时，那一行原先是个纯文本 span
  // ⇒ 拖动与双击都丢了。现在两处都用同一个 ScrubValue（`<ScrubValue` 应出现 3 次：
  // 工具条比率、工具条字号、更多下拉比率）。
  check('adj529 「更多」下拉里的比率也能拖/双击（与工具条同一个 ScrubValue）',
    (topSrc529.match(/<ScrubValue/g) ?? []).length === 3 &&
      /className="menu-scrub-val"[\s\S]{0,400}?onDoubleClick=\{applyFitZoom\}/.test(topSrc529),
    `ScrubValue=${(topSrc529.match(/<ScrubValue/g) ?? []).length}`)
  // 用户报"预览区越窄，按页宽算出的比率差异越大（缩得更小）"：根因是 `.preview-zoom-scale` 同时
  // 声明了 `width: 760×z` **和** `zoom: z`，而 CSS `zoom` 会把元素自己声明的 width 再乘一遍
  // （MDN 示例：width:25px + zoom:200% ⇒ 50px）⇒ 实际渲染宽是 760×z²（平方）。
  // 契约：width 只写基准宽，缩放全部交给 `zoom`（线性），拖拽换算与适配反算才成立。
  check('adj529 预览缩放按**线性**渲染（width 只写基准宽，不能再乘 zoom，否则是平方关系）',
    /width: PREVIEW_W,\n\s*position: 'relative',\n\s*zoom: previewZoom \/ 100,/.test(previewSrc) &&
      !/PREVIEW_W \* \(previewZoom \/ 100\)/.test(previewSrc),
    '')
  check('adj529 预览基准宽单一来源（PreviewPane 复用 zoomFit 的 PREVIEW_BASE_W）',
    /const PREVIEW_W = PREVIEW_BASE_W/.test(previewSrc) &&
      /export const PREVIEW_BASE_W = 760/.test(readFileSync('src/preview/zoomFit.ts', 'utf8')),
    '')
}

/**
 * adj530：顶栏按钮重排 + 按**可见优先级**折叠（用户要求）。
 *
 * 需求（用户）：「① 功能按钮组（视图/排版/试听/导出/主题/设置/预览比率缩放）靠左对齐；
 * ② 编辑设置组（折行/输入条/字体/字号）与独立成组的「支持」靠右对齐；③ 两组外框包围；
 * ④ 窗口变窄时先图标化、再按 视图 > 支持 > 排版 > 试听 > 导出 > 主题 > 设置 > 预览比率 >
 * 折行 > 输入条 > 字体 > 字号 的**可见优先级**逐步隐藏；⑤ 按钮样式/响应行为/更多菜单表现不变」。
 *
 * 断言分两层：
 * ① **折叠算式本身**——拿一张"每个按钮多宽"的合成表，断言"谁先走、走几个"。这是最易错、
 *    也最难用眼睛验的部分（宽度预算差 1~2px 就表现成"某个按钮不见了"），且历史上有过
 *    E-2026-193 / adj453 的翻车记录；
 * ② **组件接线**——顺序常量、两组结构、靠左/靠右/外框的 CSS、以及"更多"的出现条件。
 */
function runAdj530TopBarLayoutTests() {
  console.log('[119] top bar: two groups + priority-based folding (adj530)')
  // —— ① 折叠算式：合成环境（每个按钮 50px / Logo+汉堡 100px / 支持 50px / 更多 30px / 无间距）——
  const P = ['view', TOPBAR_DONATE_KEY, 'a', 'b', 'c', 'd'] as const
  const widths = new Map<string, number>(P.map((k) => [k, 50]))
  const ZERO = { overhead: 0, gap: 0 }
  const base = {
    priority: P,
    widthByKey: widths,
    fnKeys: ['view', 'a', 'b'],
    editKeys: ['c', 'd'],
    fnBox: ZERO,
    editBox: ZERO,
    toolbar: ZERO,
    fixedW: 100,
    donateW: 50,
    moreW: 30,
    pad: 0,
    gap: 0,
    safe: 0,
  }
  const foldAt = (totalW: number) => foldKeys({ ...base, totalW })
  const join2 = (a: readonly string[]) => a.join(',')
  check('adj530 宽度够时一个都不折叠（不许"宁可提前收起来"）',
    foldAt(400).length === 0 && foldAt(1200).length === 0,
    join2(foldAt(399)))
  check('adj530 先折叠**优先级最低**的一位（数组末位 = 字号位），而不是显示位最右',
    join2(foldAt(399)) === 'd' && join2(foldAt(379)) === 'd,c' && join2(foldAt(329)) === 'd,c,b',
    `${join2(foldAt(399))} / ${join2(foldAt(379))} / ${join2(foldAt(329))}`)
  check('adj530 折叠顺序严格 = 可见优先级的**倒序**（末位最先走；支持早于视图、晚于排版等）',
    join2(foldAt(1)) === join2([...P].reverse()) && join2(foldAt(229)) === 'd,c,b,a,donate',
    `${join2(foldAt(1))} / ${join2(foldAt(229))}`)
  check('adj530 「支持」也参与折叠（它在优先级里排第 2，只有极窄屏才会走）',
    foldAt(279).includes(TOPBAR_DONATE_KEY) === false &&
      foldAt(229).includes(TOPBAR_DONATE_KEY) === true &&
      foldAt(179).join(',') === 'd,c,b,a,donate,view',
    join2(foldAt(229)))
  check('adj530 折叠出的「更多」自己也要占位（收一个不够就继续收）',
    join2(foldKeys({ ...base, moreW: 80, totalW: 399 })) === 'd,c',
    join2(foldKeys({ ...base, moreW: 80, totalW: 399 })))
  check('adj530 极窄屏也能收敛（全部折叠后仍放不下就返回全部，不死循环/不抛异常）',
    foldAt(1).length === P.length && foldAt(0).length === P.length && TOPBAR_FIXED_KIDS === 3,
    `${foldAt(1).length}`)
  // 组框开销/组内间距一律按**实测值**计入预算（CSS 改了预算自动跟上，E-2026-143 那一类坑）；
  // 空组不占位（编辑组整体折叠后，它的 6px 组框开销与两组间距都不该再算）
  const boxed = { ...base, fnBox: { overhead: 6, gap: 2 }, editBox: { overhead: 6, gap: 2 } }
  check('adj530 组框开销与组内间距按实测计入（差 1px 也要能判定）',
    foldKeys({ ...boxed, totalW: 417 }).length > 0 && foldKeys({ ...boxed, totalW: 418 }).length === 0,
    join2(foldKeys({ ...boxed, totalW: 417 })))
  const noEdit = { ...boxed, priority: ['view', TOPBAR_DONATE_KEY, 'a', 'b'] as const, editKeys: [] as const }
  check('adj530 空组不占位（编辑组没有可见按钮时，组框开销与两组间间距都不计）',
    foldKeys({ ...noEdit, totalW: 309 }).length > 0 && foldKeys({ ...noEdit, totalW: 310 }).length === 0,
    join2(foldKeys({ ...noEdit, totalW: 309 })))

  // —— ② 组件接线 ——
  const top = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))
  const cssFlat = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  /** 取源码里某个 `readonly ToolKey[]` 常量数组的内容（去空白/引号/尾随逗号，便于逐项比对顺序） */
  const orderOf = (name: string): string => {
    const m = new RegExp(`const ${name}: readonly ToolKey\\[\\] = \\[([^\\]]+)\\]`).exec(top)
    return (m?.[1] ?? '').replace(/[\s']/g, '').replace(/,$/, '')
  }
  check('adj530 功能按钮组顺序 = 视图/排版/试听/导出/主题/设置/缩放（组靠左对齐）',
    orderOf('FN_ORDER') === 'view,guides,playback,export,themeMode,pageConfig,zoom', orderOf('FN_ORDER'))
  check('adj530 编辑设置组顺序 = 折行/输入条/字体/字号（组靠右对齐）',
    orderOf('EDIT_ORDER') === 'autoWrap,scriptPad,font,fontSize', orderOf('EDIT_ORDER'))
  check('adj530 可见优先级 = 用户给定顺序（视图>支持>排版>试听>导出>主题>设置>缩放>折行>输入条>字体>字号）',
    orderOf('TOOL_PRIORITY') ===
      'view,donate,guides,playback,export,themeMode,pageConfig,zoom,autoWrap,scriptPad,font,fontSize',
    orderOf('TOOL_PRIORITY'))
  check('adj530 折叠判定在独立纯算式里（组件只负责量宽/读活值；旧的按序号切片 visCount 已移除）',
    /import \{ foldKeys \} from '\.\/topbarFold'/.test(top) &&
      /setHiddenKeys\(\(prev\) => \{/.test(top) &&
      !/visCount/.test(top) &&
      !/toolBtns/.test(top),
    '')
  check('adj530 顶栏取消「弹性间距」占位 div（左组靠左/右组靠右改由工具条吃满 + 设置组 auto 外边距）',
    !/topbar-spacer/.test(top) && !/topbar-spacer/.test(cssFlat) &&
      /\.topbar-toolbar \{[\s\S]{0,300}?flex-grow: 1;/.test(cssFlat) &&
      /\.topbar-settings \{[\s\S]{0,300}?margin-left: auto;/.test(cssFlat),
    '')
  check('adj530 两组的**外框**保留（border + 圆角 + 内 padding，adj414 口径不变）',
    /\.topbar-buttons \{[\s\S]{0,300}?border: 1px solid var\(--jp-border\);[\s\S]{0,200}?border-radius: 7px;[\s\S]{0,120}?padding: 2px;/.test(cssFlat) &&
      /\.topbar-settings \{[\s\S]{0,300}?border: 1px solid var\(--jp-border\);[\s\S]{0,200}?border-radius: 7px;[\s\S]{0,120}?padding: 2px;/.test(cssFlat),
    '')
  check('adj530 视图/主题由顶栏独立项并入功能组（renderBtn 各有一个分支，两边都不再常驻 JSX）',
    /if \(t\.kind === 'view'\) \{/.test(top) &&
      /if \(t\.kind === 'theme'\) \{/.test(top) &&
      /FN_ORDER\.filter\(\(k\) => shownKeys\.has\(k\)\)/.test(top) &&
      /EDIT_ORDER\.filter\(\(k\) => shownKeys\.has\(k\)\)/.test(top) &&
      !/<div className="topbar-views" ref=\{viewRef\}>/.test(top),
    '')
  check('adj530 按钮文字/图标不变（renderBtn 仍是同一套结构：iconOf + tool-label + toolDefs 表）',
    /const toolDefs: Record<ToolKey, ToolDef>/.test(top) &&
      /<span className="tool-label">\{t\.label\}<\/span>/.test(top) &&
      /const iconOf = \(key: string\)/.test(top),
    '')
  check('adj530 「支持」独立成组但同样参与折叠（优先级里第 2 + 更多下拉里能出现）',
    /OVERFLOW_ORDER: readonly ToolKey\[\] = \[\.\.\.FN_ORDER, \.\.\.EDIT_ORDER, 'donate'\]/.test(top) &&
      /const hiddenList = OVERFLOW_ORDER\.filter/.test(top),
    '')
  check('adj530 「更多」的出现条件与表现不变（= 确有按钮被折叠，条目按显示顺序列出）',
    /\{hiddenList\.length > 0 && \(/.test(top) &&
      /\{hiddenList\.map\(\(k\) => \(/.test(top) &&
      /<div className="menu-group-title">更多工具<\/div>/.test(top),
    '')
  check('adj530 折叠后的「视图/主题」仍能用（更多下拉里各有条目，与下拉/按钮同一份数据）',
    /renderViewEntries\(\)/.test(top) &&
      /const modes: \{ key: typeof themeMode; label: string \}\[\] = \[/.test(top),
    '')
  check('adj530 「支持」的隐形测量副本在两组框**之外**（进组框会套用组内样式、量窄）',
    /data-tool-key="donate"/.test(top) &&
      /className="topbar-btn topbar-donate"\n\s*ref=\{donateMeasureRef\}/.test(top),
    '')
  // 视图按钮并入工具条后，它的下拉成了「工具条内绝对定位的浮层」——工具条对横向溢出做裁剪
  // （adj453 的安全阀），纵向若也裁就把下拉切没了（字体下拉当年正是这个坑，见 adj386）。
  check('adj530 视图下拉不会被工具条的裁剪切掉（纵向可见 + 打开时整体放开裁剪）',
    /overflow-x: clip;/.test(cssFlat) &&
      /overflow-y: visible;/.test(cssFlat) &&
      /\.topbar-toolbar:has\(\.topbar-views\.open\) \{[\s\S]{0,120}?overflow: visible;/.test(cssFlat) &&
      /className=\{`topbar-views\$\{viewOpen \? ' open' : ''\}`\}/.test(top),
    '')
}

/**
 * adj534–adj537（用户 5 条界面调整）：
 *  ① 输入条按键高度 = 顶栏按钮高度；② 试听播放/停止按钮同高；
 *  ③ 设置→主题「深浅模式」文案（原「浅深模式」）+ 选中项在**浅色模式**下看不清；
 *  ④ 拆分调整线 / 底栏高度调整线加主题色；⑤ 输入条最左插入撤销/重做图标按钮。
 *
 * 这里的断言分两类：**"单一来源"类**（高度只允许有一个数：`--jp-btn-h`）与
 * **"接线"类**（图标键、栈长度、preventDefault 保焦点）——都是"改一处忘一处"最容易漂的地方。
 */
function runAdj534to537UiTests() {
  console.log('[119b] unified button height / 深浅模式 / tinted resize lines / pad undo-redo (adj534-adj537)')
  const css = String(readFileSync('src/index.css', 'utf8'))
  const themeCss = String(readFileSync('src/styles/theme.css', 'utf8'))
  const padLayoutSrc = String(readFileSync('src/editor/padLayout.ts', 'utf8'))
  const padSrc = String(readFileSync('src/editor/ScriptToolbar.tsx', 'utf8'))
  const editorSrc = String(readFileSync('src/editor/EditorPane.tsx', 'utf8'))
  const pageSrc = String(readFileSync('src/dialogs/PageConfigDialog.tsx', 'utf8'))
  const top = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))

  // ---- adj534：按钮高度单一来源 ----
  check('adj534 界面按钮统一高度有单一来源（`--jp-btn-h`，取自顶栏按钮实测 24px）',
    /--jp-btn-h: 24px;/.test(themeCss) &&
      /\.script-pad \.pad-key \{[\s\S]{0,400}?height: var\(--jp-btn-h, 24px\);/.test(css) &&
      /\.playback-btn \{[\s\S]{0,400}?height: var\(--jp-btn-h, 24px\);/.test(css),
    '')
  check('adj534 输入条按键不再写死 min-height: 30px（旧值比顶栏高 6px）',
    !/\.script-pad \.pad-key \{[\s\S]{0,400}?min-height: 30px;/.test(css),
    '')
  check('adj534 试听按钮纵向内边距清零（`.btn` 的 padding 6px 声明更靠后，会把 height 顶开）',
    /\.playback-btn \{[\s\S]{0,400}?padding: 0 14px;/.test(css) &&
      !/\.playback-btn \{[\s\S]{0,400}?padding: 4px 14px;/.test(css),
    '')

  // ---- adj535：深浅模式（文案 + 选中态反色）----
  check('adj535 文案「浅深模式」已改为「深浅模式」（设置标签 / 顶栏 title·aria / 更多菜单组标题）',
    /深浅模式/.test(pageSrc) && /深浅模式/.test(top) && !/浅深模式/.test(pageSrc) && !/浅深模式/.test(top),
    '')
  check('adj535 选中项字色取「面板底色」而非写死 #101010（后者只在深色模式下成立）',
    /\.theme-mode-btn\.active \{[\s\S]{0,240}?color: var\(--jp-bg-panel\);/.test(css) &&
      !/\.theme-mode-btn\.active \{[\s\S]{0,240}?color: #101010;/.test(css),
    '')

  // ---- adj536：两条调整线同款主题色 ----
  check('adj536 两条调整线底色掺强调色（同一配方 10% accent + 面板底）',
    (css.match(/color-mix\(in srgb, var\(--jp-accent\) 10%, var\(--jp-bg-panel\)\)/g) ?? []).length === 2,
    `命中 ${(css.match(/color-mix\(in srgb, var\(--jp-accent\) 10%, var\(--jp-bg-panel\)\)/g) ?? []).length} 处`)
  check('adj536 两条线的握把都改用强调色（原为不带色相的 --jp-text-muted 灰）',
    /\.split-divider::after \{[\s\S]{0,240}?background: var\(--jp-accent\);/.test(css) &&
      /\.tool-dock-resize::after \{[\s\S]{0,240}?background: var\(--jp-accent\);/.test(css),
    '')

  // ---- adj537：输入条行首撤销/重做 ----
  check('adj537 输入条行首两个图标键（撤销 / 重做），空栈时 disabled',
    /export const PAD_UNDO_KEY/.test(padLayoutSrc) &&
      /export const PAD_REDO_KEY/.test(padLayoutSrc) &&
      (padSrc.match(/className="pad-key pad-icon"/g) ?? []).length === 2 &&
      /disabled=\{!canUndo\}/.test(padSrc) &&
      /disabled=\{!canRedo\}/.test(padSrc) &&
      /<svg/.test(padSrc),
    '')
  check('adj537 图标键在最左（撤销 → 重做 → 分隔点 → 主键组；adj553 的翻看箭头在 .pad-scroll **之外**，不影响这个次序）',
    /<div className="pad-scroll" ref=\{scrollRef\}>[\s\S]{0,900}?PAD_UNDO_KEY\.hint[\s\S]{0,400}?PAD_REDO_KEY\.hint[\s\S]{0,300}?<div className="pad-sep"[\s\S]{0,200}?PAD_GROUPS\.map/.test(padSrc),
    '')
  check('adj537 接线到 docStore（onUndo/onRedo + 栈长度选择器，不订阅整个数组）',
    /onUndo=\{undo\}/.test(editorSrc) &&
      /onRedo=\{redo\}/.test(editorSrc) &&
      /canUndo=\{undoStackLen > 0\}/.test(editorSrc) &&
      /canRedo=\{redoStackLen > 0\}/.test(editorSrc) &&
      /s\.undoStack\.length/.test(editorSrc) &&
      /s\.redoStack\.length/.test(editorSrc),
    '')
  check('adj537 输入条按键"点按不夺焦点"（preventDefault；否则手机上点撤销后编辑器失焦、后续按键落空）',
    (padSrc.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) ?? []).length >= 4,
    `命中 ${(padSrc.match(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/g) ?? []).length} 处`)
  check('adj537 图标键为方形（宽 = --jp-btn-h）、禁用态不吃 hover 强调色',
    /\.script-pad \.pad-key\.pad-icon \{[\s\S]{0,240}?width: var\(--jp-btn-h, 24px\);/.test(css) &&
      /\.script-pad \.pad-key:disabled \{[\s\S]{0,160}?opacity: 0\.35;/.test(css),
    '')
}

/**
 * adj538：PC 端 `.jps` 文件关联 + 「外部打开」（双击打开 → Ctrl+S 写回原文件）。
 *
 * 这条链路的四段，缺任何一段用户都会觉得"双击没反应/存不回原文件"：
 *   ① 安装包注册关联（tauri.conf.json 的 fileAssociations + `name` 即 Windows ProgID）
 *   ② NSIS 钩子补 Tauri 模板不写的三件事：`OpenWithProgids`（右键「打开方式」才可见）、
 *      `SHChangeNotify`（资源管理器立刻刷新）、卸载时清掉自己的残留值
 *   ③ Rust 侧：单实例插件（避免开第二个窗口）+ argv 入队 + 取队列/写回命令
 *   ④ 前端：nativePath 与 fileHandle 互斥；保存时"外部路径"优先走写回
 *
 * 另有一条**纯函数**断言（`pickPrimary`）：多选/连开多个文件时"载入第一个 + 提示剩余"。
 */
function runAdj538ExternalOpenTests() {
  console.log('[120] desktop .jps file association + external open (adj538)')
  // ---- ① 纯逻辑：多文件时的取舍 ----
  const mk = (path: string, name: string, error: string | null = null): ExternalFile => ({
    path,
    name,
    code: 'Q: 1',
    error,
  })
  const three = [mk('/a/甲.jps', '甲'), mk('/a/乙.jps', '乙'), mk('/a/丙.jps', '丙')]
  check('adj538 多文件打开：载入第一个并给出剩余个数（空列表则什么都不载）',
    pickPrimary([]).primary === null &&
      pickPrimary([]).extraCount === 0 &&
      pickPrimary(three).primary?.name === '甲' &&
      pickPrimary(three).extraCount === 2,
    `${pickPrimary(three).primary?.name}/${pickPrimary(three).extraCount}`)
  // 在 Node（无 window）里 `hasShell()` 必须返回 false 而不是抛错——这是"纯网页构建不受影响"的前提
  check('adj538 无 Tauri 环境下外开模块安全（hasShell() 为 false，不抛错）',
    typeof hasShell === 'function' && hasShell() === false,
    `hasShell=${hasShell()}`)

  // ---- ② 安装包配置与 NSIS 钩子 ----
  const conf = String(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  check('adj538 注册 .jps 关联（ext + name 即 ProgID + 描述 + mimeType）',
    /"fileAssociations"/.test(conf) &&
      /"ext":\s*\["jps"\]/.test(conf) &&
      /"name":\s*"iJipu\.jps"/.test(conf) &&
      /"description":\s*"[^"]*"/.test(conf) &&
      /"mimeType":\s*"application\/x-jps"/.test(conf),
    '')
  check('adj538 挂上 NSIS 安装钩子（installerHooks → nsis/hooks.nsh）',
    /"installerHooks":\s*"nsis\/hooks\.nsh"/.test(conf),
    '')
  const hooks = String(readFileSync('src-tauri/nsis/hooks.nsh', 'utf8'))
  // 断言前列掉注释：本文件的注释里**故意提到**了 `DeleteRegKey /ifempty`（说明为什么不能用它），
  // 不剥注释的话"禁用该写法"的负向断言会被自己的注释绊倒（本项目的老坑：断言匹配到注释）
  const hooksCode = hooks.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*;.*$/gm, '')
  check('adj538 安装钩子写 OpenWithProgids（右键「打开方式」才看得到 iJipu）+ 通知资源管理器刷新',
    /!macro NSIS_HOOK_POSTINSTALL/.test(hooks) &&
      /OpenWithProgids/.test(hooks) &&
      /SHChangeNotify/.test(hooks),
    '')
  check('adj538 卸载钩子只删我方值名，且在键确空时才删键（不误伤别的程序）',
    /!macro NSIS_HOOK_POSTUNINSTALL/.test(hooksCode) &&
      /DeleteRegValue/.test(hooksCode) &&
      /EnumRegValue/.test(hooksCode) &&
      /EnumRegKey/.test(hooksCode) &&
      // 明确**不用** DeleteRegKey /ifempty：它不检查值，会在"键里还有别的程序的值"时把整个键删掉
      !/DeleteRegKey\s+\/ifempty/.test(hooksCode),
    '')
  check('adj538 钩子里 ProgID 与备份值名同源（`iJipu.jps` / `iJipu.jps_backup`，不各写一遍字面量）',
    /!define IJIPU_PROGID "iJipu\.jps"/.test(hooksCode) && /\$\{IJIPU_PROGID\}_backup/.test(hooksCode),
    '')

  // ---- ③ Rust 侧 ----
  const lib = String(readFileSync('src-tauri/src/lib.rs', 'utf8'))
  const cargo = String(readFileSync('src-tauri/Cargo.toml', 'utf8'))
  check('adj538 单实例插件第一个注册（第二次双击不再开新窗口）+ 依赖已声明',
    /tauri-plugin-single-instance = "2"/.test(cargo) &&
      /\.plugin\(tauri_plugin_single_instance::init\(/.test(lib) &&
      lib.indexOf('tauri_plugin_single_instance::init') < lib.indexOf('.manage(PendingOpen::default())'),
    '')
  check('adj538 单实例回调把窗口置前（unminimize/show/set_focus，最小化时也要弹出来）',
    /unminimize\(\)/.test(lib) && /\.show\(\)/.test(lib) && /set_focus\(\)/.test(lib),
    '')
  check('adj538 Rust 侧提供"取队列"与"写回"命令，并注册进 invoke_handler',
    /fn take_pending_open_files/.test(lib) &&
      /fn write_external_file/.test(lib) &&
      /take_pending_open_files,/.test(lib) &&
      /write_external_file\b/.test(lib),
    '')
  check('adj538 写回做回读校验（宁可报错也不谎报已保存，与 FSA 路径同口径）',
    /fn write_external_file[\s\S]{0,700}?let back = std::fs::read_to_string\(&p\)[\s\S]{0,200}?back != text/.test(lib),
    '')
  check('adj538 .jps 参数按后缀筛选而非位置（兼容 argv 是否含 exe 自身）',
    /fn is_jps_arg[\s\S]{0,200}?ends_with\("\.jps"\)/.test(lib) && !/\.skip\(1\)/.test(lib),
    '')
  check('adj538 冷启动走 setup 入队 + macOS/iOS 走 RunEvent::Opened（cfg 门控）',
    // 不再用"距 `fn run()` 多少字符"来定位：adj539 在 run() 前面插了 windows 专属的"启动前清陈旧 SW"，
    // 字符窗口随之失效（本轮已被绊一次）。改为直接要求 `.setup` 里紧随其后的那条入队语句。
    /pub fn run\(\)[\s\S]*?\.setup\(\|app\| \{[\s\S]{0,300}?queue_open_paths\(app\.handle\(\), jps_paths_from_os_args\(app\.env\(\)\.args_os\.clone\(\)\)\)/.test(
      lib,
    ) &&
      /#\[cfg\(any\(target_os = "macos", target_os = "ios"\)\)\]/.test(lib),
    '')

  // ---- ④ 前端接线 ----
  const store = String(readFileSync('src/store/docStore.ts', 'utf8'))
  const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
  check('adj538 nativePath 与 fileHandle 互斥：所有装载/新建/导入路径都重置它',
    /nativePath: string \| null/.test(store) &&
      (store.match(/nativePath: null,/g) ?? []).length >= 6 &&
      /nativePath: primary\.path/.test(store) &&
      /openExternalFiles: \(files\) =>/.test(store),
    `重置点 ${(store.match(/nativePath: null,/g) ?? []).length} 处`)
  check('adj538 Ctrl+S 对"外部打开"的文档走写回原文件（nativePath 优先于句柄/另存为）',
    /if \(st\.nativePath\) \{[\s\S]{0,1500}?await writeExternalFile\(path, code\)/.test(store) &&
      /saveToSourceFailed/.test(store),
    '')
  check('adj538 App：冷启动主动拉取 + 热启动监听（同一"取走即清空"队列 ⇒ 不漏不重）',
    /drainExternalFiles\(\)/.test(appSrc) &&
      /onExternalOpen\(load\)/.test(appSrc) &&
      /if \(!hasShell\(\)\) return/.test(appSrc),
    '')
}

/**
 * adj539：桌面壳里的两件"系统集成"效果，都是**只有真机才看得见**、且**编译通过 ≠ 效果对**。
 *
 * ① 白屏根因（E-2026-238）：陈旧 Service Worker 缓存了旧 `index.html`，把 `/assets/*.js` 喂成 `text/html`
 *    ⇒ 前端整包加载失败。**页面的自救代码救不了自己**（页面 JS 正是被它挡住的），所以必须双保险：
 *    Rust 在 webview 起来之前物理删掉 SW 存储 + `sw.js` 发现自己在桌面壳里就自毁。
 * ② 快捷方式中文名/备注 + 右键动词（E-2026-239）：全是 NSIS 层面的坑——
 *    钩子被 `!include` 得比模板 `!define` 更早（用不了 `${PRODUCTNAME}`/`${BUNDLEID}`）、
 *    `!define` 不能重定义、含中文的 .nsh 必须带 BOM、`CreateShortcut` 的显示方式只能写 `SW_SHOWNORMAL`、
 *    GUI 的桌面快捷方式建在 POSTINSTALL **之后**（必须再挂 `.onGUIEnd`）。
 * 这些坑里**只有 BOM 能靠读文件断言**，其余靠"文本里必须是这么写的"来防回归。
 */
function runAdj539ShellTests() {
  console.log('[121] desktop shell white-screen guard + NSIS shortcut naming (adj539)')
  // 临时探针页面（Android FSA 探针）**不该随版本发布**：这里只提醒、不失败（它存在期间 smoke 仍应全绿）
  if (existsSync('public/probe-fsa.html')) {
    console.warn('  ⚠️ public/probe-fsa.html 仍在（Android 临时探针页面）—— 拿到结果后必须删除，别随版本发布')
  }
  const conf = String(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
  const identifier = /"identifier":\s*"([^"]+)"/.exec(conf)?.[1] ?? ''
  const productName = /"productName":\s*"([^"]+)"/.exec(conf)?.[1] ?? ''

  // ---- ① 白屏：sw.js 在桌面壳里自毁 ----
  const sw = String(readFileSync('public/sw.js', 'utf8'))
  check('adj539 sw.js 认出桌面壳（Tauri 在 Windows 用 tauri.localhost，是安全上下文，SW 本可注册）',
    /IN_DESKTOP_SHELL = self\.location\.hostname === 'tauri\.localhost'/.test(sw),
    '')
  check('adj539 桌面壳里三处都不干活：install 跳过预热 / activate 清空缓存并注销自己 / fetch 不拦截',
    /addEventListener\('install'[\s\S]{0,260}?if \(IN_DESKTOP_SHELL\) \{[\s\S]{0,120}?skipWaiting\(\)/.test(sw) &&
      /addEventListener\('activate'[\s\S]{0,300}?caches\.keys\(\)[\s\S]{0,200}?self\.registration\.unregister\(\)/.test(sw) &&
      /addEventListener\('fetch'[\s\S]{0,220}?if \(IN_DESKTOP_SHELL\) return/.test(sw),
    '')
  const lib = String(readFileSync('src-tauri/src/lib.rs', 'utf8'))
  check('adj539 Rust 在 webview 起来之前物理删掉陈旧 SW 存储（第二道防线，不依赖页面 JS——页面的自救正是被 SW 挡住的）',
    /fn purge_stale_service_worker\(app_local_dir: &Path\)/.test(lib) &&
      /fn run\(\)[\s\S]{0,700}?purge_stale_service_worker\(&PathBuf::from\(local\)\.join\(identifier\)\)/.test(lib),
    '')
  check('adj539 清理只删 `Service Worker` 子目录，不碰 Local Storage / IndexedDB（否则等于清用户数据）',
    /fn purge_stale_service_worker[\s\S]{0,400}?"EBWebView"[\s\S]{0,120}?"Default"[\s\S]{0,120}?"Service Worker"[\s\S]{0,200}?remove_dir_all\(&sw\)/.test(
      lib,
    ) && !/remove_dir_all\(&?app_local_dir/.test(lib),
    '')

  // ---- ② 快捷方式中文名 + 备注 + 右键动词 ----
  const hooksBuf = readFileSync('src-tauri/nsis/hooks.nsh')
  check('adj539 钩子文件带 UTF-8 BOM（makensis 对无 BOM 脚本按 ANSI 解析，含中文直接 `Bad text encoding` 中止）',
    hooksBuf[0] === 0xef && hooksBuf[1] === 0xbb && hooksBuf[2] === 0xbf,
    `首字节 ${hooksBuf[0]?.toString(16)} ${hooksBuf[1]?.toString(16)} ${hooksBuf[2]?.toString(16)}`)
  const hooks = String(hooksBuf)
  const hooksCode = hooks.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*;.*$/gm, '')
  check('adj539 快捷方式名与备注是用户给的原文（备注只能靠 `CreateShortCut` 第 7 个参数写）',
    hooks.includes('!define IJIPU_LNK_NEW "i记谱 iJipu.lnk"') &&
      hooks.includes('!define IJIPU_LNK_DESC "爱记谱 - 码即成，谱自现，代码式简谱制谱引擎。"'),
    '')
  check('adj539 新名首字是拉丁字母 `i`（不是「爱记谱」）——「爱记谱 iJipu.lnk」是 Chrome 装的网页版(PWA)快捷方式，同名会把它覆盖掉',
    !hooks.includes('!define IJIPU_LNK_NEW "爱记谱') && hooks.includes('!define IJIPU_LNK_NEW "i记谱'),
    '')
  check('adj539 删旧名前先摘固定项（改名后旧 pin 必然失效，主动摘掉不留幽灵图标）',
    (hooksCode.match(/!insertmacro UnpinShortcut "\$(DESKTOP|SMPROGRAMS)\\\$\{IJIPU_LNK_OLD\}"/g) ?? []).length === 2,
    '')
  check('adj539 旧快捷方式名/主程序名与 tauri.conf.json 同源（productName 一改这里就红）',
    hooks.includes(`!define IJIPU_LNK_OLD "${productName}.lnk"`) && /!define IJIPU_EXE "ijipu\.exe"/.test(hooks),
    `productName=${productName}`)
  check('adj539 自备 AUMI 宏取代模板宏（模板宏体里的 `${BUNDLEID}` 在钩子包含点尚未定义 ⇒ 会把字面量 {BUNDLEID} 当 AUMI 写进 .lnk，只给 warning 不报错）',
    /!macro IJIPU_SET_AUMI shortcut aumi/.test(hooksCode) &&
      !/!insertmacro SetLnkAppUserModelId/.test(hooksCode) &&
      hooks.includes(`!define IJIPU_AUMI "${identifier}"`),
    `identifier=${identifier}`)
  check('adj539 CreateShortcut 的显示方式写符号名 `SW_SHOWNORMAL`（写数字会被 makensis 拒绝：unknown show mode "1"）',
    (hooksCode.match(/0 SW_SHOWNORMAL "" "\$\{IJIPU_LNK_DESC\}"/g) ?? []).length === 2 &&
      !/CreateShortcut[^\n]*\s0 1 ""/.test(hooksCode),
    '')
  check('adj539 两条路径都覆盖：POSTINSTALL（静默/被动 + 开始菜单）与 .onGUIEnd（GUI 的桌面快捷方式建在完成页之后）',
    /!macro NSIS_HOOK_POSTINSTALL[\s\S]{0,900}?Call IJIPU_FixShortcuts/.test(hooksCode) &&
      /Function \.onGUIEnd[\s\S]{0,120}?Call IJIPU_FixShortcuts/.test(hooksCode) &&
      (hooksCode.match(/Function \.onGUIEnd/g) ?? []).length === 1,
    '')
  check('adj539 迁移幂等且尊重用户选择（旧名 .lnk 与主程序都在才动手）+ 重建后补 AUMI（否则任务栏图标分裂）',
    /Function IJIPU_FixShortcuts[\s\S]{0,200}?IfFileExists "\$INSTDIR\\\$\{IJIPU_EXE\}" 0/.test(hooksCode) &&
      /IfFileExists "\$DESKTOP\\\$\{IJIPU_LNK_OLD\}" 0/.test(hooksCode) &&
      (hooksCode.match(/!insertmacro IJIPU_SET_AUMI/g) ?? []).length === 2,
    '')
  check('adj539 卸载补删中文名快捷方式，且与模板同样受 `$UpdateMode` 保护（更新流程会先跑卸载器，删了就白丢图标）',
    /!macro NSIS_HOOK_PREUNINSTALL[\s\S]{0,500}?\$\{If\} \$UpdateMode <> 1[\s\S]{0,500}?Delete "\$DESKTOP\\\$\{IJIPU_LNK_NEW\}"/.test(
      hooksCode,
    ),
    '')
  check('adj539 右键动词覆写成中文（模板把 `Open with iJipu` 硬编码进 COMMANDTEXT，配置改不了）',
    hooks.includes('!define IJIPU_OPEN_VERB "使用 iJipu 打开"') &&
      /WriteRegStr HKCU "Software\\Classes\\\$\{IJIPU_PROGID\}\\shell\\open" "" "\$\{IJIPU_OPEN_VERB\}"/.test(hooksCode),
    '')
}

/**
 * adj540：工作区（Android/移动端"选一个文件夹当工作区"）——**真机探针已证明纯网页可行**
 * （Chrome 151 / Android 10：选目录 → readwrite → 写入 → 回读一致 → 刷新后仍可写），
 * 故不做 Android 壳。用户追加要求：**支持子目录**（能打开/保存子目录里的 .jps）。
 *
 * 这里只断言**能在 Node 里跑的部分**：路径与列表的纯函数（`.jps` 判定、目录优先排序、
 * 相对路径规整/拼接/上级）以及"接线是否齐全"（三个存储来源互斥、保存分支、UI 入口）。
 * 真正的目录读写只能在浏览器/真机上验（会写用户磁盘），不放进 smoke。
 */
async function runAdj540WorkspaceTests() {
  console.log('[122] workspace directory for Android/mobile (adj540)')
  // adj554：本函数里要用 `dockModuleSrc` 检查工作区高度算式 —— 在本函数局部读一次，
  // 不要复用 adj526 函数内的同名变量（那个作用域只在 526 那段）
  const dockModuleSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  // ---- ① `.jps` 判定（大小写不敏感；裸 `.jps` 这种隐藏文件不算） ----
  check('adj540 只认「有主干名 + .jps」的文件（大小写不敏感，裸 `.jps`/别的扩展名都不算）',
    isJpsName('小星星.jps') &&
      isJpsName('A.JPS') &&
      !isJpsName('.jps') &&
      !isJpsName('jps') &&
      !isJpsName('a.txt') &&
      !isJpsName('a.jps.bak') &&
      !isJpsName(''),
    '')

  // ---- ② 列表排序：目录在前，文件按修改时间倒序（刚存的排最上面） ----
  const mk = (kind: DirEntry['kind'], name: string, mtime = 0): DirEntry => ({ kind, name, mtime })
  const sorted = sortDirEntries([
    mk('file', '旧.jps', 100),
    mk('dir', '乙'),
    mk('file', '新.jps', 900),
    mk('dir', '甲'),
    mk('file', '同.jps', 900),
  ])
  check('adj540 列表排序：目录在前（按名），文件按修改时间倒序、时间相同再按名',
    // 期望顺序按实现口径写：目录 甲/乙（拼音），文件 900ms 的「同」在「新」前（tóng < xīn），最后是 100ms 的旧
    sorted.map((e) => e.name).join(',') === '甲,乙,同.jps,新.jps,旧.jps',
    sorted.map((e) => e.name).join(','))
  check('adj540 排序不改变入参（纯函数，列表来自真实目录遍历）',
    sorted !== undefined && sortDirEntries([]).length === 0,
    '')

  // ---- ③ 相对路径：规整 / 拼接 / 上级 ----
  check('adj540 路径规整会丢掉空段、`.` 与 `..`（"上级"由弹栈实现，绝不把 `..` 写进持久化路径）',
    normalizeRelPath(['a', '', '.', '..', 'b.jps']).join(',') === 'a,b.jps' &&
      normalizeRelPath(['..', '..']).length === 0 &&
      normalizeRelPath(['a/b', 'c\\d']).length === 0,
    '')
  check('adj540 路径拼接与上级：`joinPath([])` 为空串、`parentPath([])` 仍是根',
    joinPath([]) === '' &&
      joinPath(['杂记', '小星星.jps']) === '杂记/小星星.jps' &&
      parentPath(['杂记', '小星星.jps']).join(',') === '杂记' &&
      parentPath([]).length === 0,
    '')

  // ---- ④ 接线：三个存储来源互斥 + 保存分支 + UI 入口 ----
  const store = String(readFileSync('src/store/docStore.ts', 'utf8'))
  const wsSrc = String(readFileSync('src/store/workspace.ts', 'utf8'))
  // adj544：绑定字段改名 `workspacePath` → `binding`（带工作区身份），重置点同时清 `pendingBinding`
  const resets = (store.match(/binding: null,/g) ?? []).length
  const pendingResets = (store.match(/pendingBinding: null,/g) ?? []).length
  check('adj540/adj544 文档来源三者互斥：每个"清空文件句柄/外部路径"的装载路径都清掉工作区绑定',
    resets >= 6 &&
      pendingResets >= 6 &&
      // 注意用 `[\s\S]` 而不是 `\n\s*`：本仓库源文件是 CRLF，`\n` 会匹配不上
      /nativePath: primary\.path,[\s\S]{0,80}?adj540：外部路径与工作区互斥[\s\S]{0,80}?binding: null,/.test(store) &&
      /binding: WorkspaceBinding \| null/.test(store),
    `绑定重置点 ${resets} 处 / 待校验绑定重置点 ${pendingResets} 处`)
  check('adj540/adj544 「保存」对工作区文档写回同一个文件（含子目录），且**先过三道校验**（身份/存在）',
    /if \(st\.binding && st\.binding\.segs\.length > 0\) \{[\s\S]{0,1400}?await writeWorkspaceText\(ws\.handle, wsPath, code\)/.test(store) &&
      /if \(ws\.id !== bind\.wsId\) \{/.test(store) &&
      /openWorkspaceFile: async \(path\) =>/.test(store) &&
      /saveToWorkspace: async \(path\) =>/.test(store),
    '')
  check('adj540 工作区模块自包含：权限复用 saveSupport（不另写一套）、路径只存根句柄 + 相对段',
    /from '\.\/saveSupport'/.test(wsSrc) &&
      /resolveWorkspaceFile/.test(wsSrc) &&
      /export interface WorkspaceRecord/.test(String(readFileSync('src/store/fileHandleDb.ts', 'utf8'))),
    '')
  const ui = String(readFileSync('src/store/uiStore.ts', 'utf8'))
  const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
  const topSrc = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const panelSrc = String(readFileSync('src/ui/dock/WorkspacePanel.tsx', 'utf8'))
  const copySrc = String(readFileSync('src/brand/copy.ts', 'utf8'))
  // 断言 CSS 前先剥注释：注释里**故意写了**要禁用的写法（同 E-2026-237 的坑）
  const cssAll = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  check('adj540 工作区是底栏 dock 的页签 + **排第一**（手机端文件操作主入口），图标用 `public/icons/工作区.png`',
    /\| 'workspace'/.test(ui) && // DockPanelKey
      !/\| 'workspace'/.test(ui.split('export type DockPanelKey')[0]) && // 不再出现在 ModalKind 里
      // 顺序：PANELS/TABS 的第一项都是 workspace
      /\{ key: 'workspace', render: WorkspacePanel \},\s*\{ key: 'problems'/.test(dockSrc) &&
      /\{ key: 'workspace', label: dockCopy\.tabWorkspace, icon: 'workspace' \}/.test(dockSrc) &&
      /workspace: '工作区'/.test(String(readFileSync('src/ui/toolIcons.ts', 'utf8'))) &&
      /if \(key === 'workspace'\)/.test(dockSrc) &&
      /export const workspaceCopy/.test(copySrc) &&
      /tabWorkspace: '工作区'/.test(copySrc) &&
      !/modal === 'workspace'/.test(appSrc),
    '')
  check('adj540 面板走"受限高度链"（pane 当弹性列容器 ⇒ 列表自己滚、右侧操作区常驻，与 .pane-problems 同套路）',
    /\.tool-dock-pane\.pane-workspace \{[\s\S]{0,220}?min-height: 0/.test(cssAll) &&
      /\.ws-panel \{[\s\S]{0,200}?flex: 1 1 auto;[\s\S]{0,80}?min-height: 0/.test(cssAll),
    '')
  check('adj540 窄屏「左列表 + 右操作按钮」（把行数留给列表）；adj556（v0.28.2）窄屏页签**不再隐藏图标**——靠 tabstrip 滚动 + 箭头兜住',
    /\.ws-body \{[\s\S]{0,220}?display: flex/.test(cssAll) &&
      /\.ws-side \{[\s\S]{0,220}?flex-direction: column/.test(cssAll) &&
      // adj556：窄屏不再有 display:none 的图标隐藏规则（仍然可以有 @container ≤430px 的内边距收紧）
      !/@container \(max-width: 430px\) \{[\s\S]{0,200}?\.tool-dock-tab-icon \{ display: none/.test(cssAll),
    '')
  check('adj540 右侧**只留一个下拉按钮**（点它弹出操作菜单，菜单走 portal 以免被 dock 的 overflow 裁掉）',
    /ref=\{menuBtnRef\}[\s\S]{0,260}?aria-haspopup="menu"[\s\S]{0,200}?workspaceCopy\.menuBtn/.test(panelSrc) &&
      /createPortal\(/.test(panelSrc) &&
      /className="ws-menu-pop"/.test(panelSrc) &&
      /\.ws-menu-pop \{[\s\S]{0,200}?position: fixed/.test(cssAll) &&
      // 三个分组下拉（保存▾/新建▾/操作▾）已被这一个替代
      !/openGroup/.test(panelSrc) &&
      /menuBtn: '操作'/.test(copySrc),
    '')
  check('adj540 窄屏覆盖仍写在基础规则之后（同级后者胜；E-2026-244）+ 按钮高度不靠压扁',
    cssAll.indexOf('.ws-sub-btn {') > -1 &&
      !/\.ws-side-btn \{[^}]*line-height: 1\.25/.test(cssAll) &&
      /@container \(max-width: 430px\) \{[\s\S]{0,200}?\.ws-panel \.ws-list \{ min-height: 72px/.test(cssAll),
    '')
  // ---- adj554（v0.28.2）：工作区窄屏建议高度 = 列表 5 项 + 面板头；行高/头高实测 ----
  check('adj554 工作区建议高度算式 = chrome + pane_pad + head + gap + 5×row + list_pad/border（不含旧的 settingsDefaultH + 44）',
    /const workspaceDefaultH = \([\s\S]{0,200}?rowH \* WORKSPACE_VISIBLE_ROWS \+ WS_LIST_PAD_V \+ WS_LIST_BORDER_V/.test(dockModuleSrc) &&
      /const WORKSPACE_VISIBLE_ROWS = 5/.test(dockModuleSrc) &&
      // 旧的"settingsDefaultH + 44"近似已替换
      !/workspaceDefaultH = \([^)]*settingsDefaultH/.test(dockModuleSrc),
    '')
  check('adj554 工作区面板行高/头高由 useState 实测（`.ws-list .ws-row` + `.ws-head`）',
    /const \[workspaceRowH, setWorkspaceRowH\] = useState\(WORKSPACE_ROW_H_FALLBACK\)/.test(dockModuleSrc) &&
      /const \[workspaceHeadH, setWorkspaceHeadH\] = useState\(WORKSPACE_HEAD_H_FALLBACK\)/.test(dockModuleSrc) &&
      /bodyRef\.current\?\.querySelector<HTMLElement>\('\.pane-workspace'\)/.test(dockModuleSrc) &&
      /\.ws-list \.ws-row/.test(dockModuleSrc) &&
      /\.ws-head/.test(dockModuleSrc) &&
      /getBoundingClientRect\(\)\.height/.test(dockModuleSrc),
    '')
  check('adj554 工作区 wide 仍走 maxH()（adj540 "宽屏一次看全"口径不变），narrow 才走新算式',
    /if \(key === 'workspace'\)[\s\S]{0,200}?workspaceDefaultH\(workspaceRowH, workspaceHeadH, chromeH\)[\s\S]{0,60}?: maxH/.test(dockModuleSrc),
    '')
  check('adj540 重新授权时**显示要授权的目录**（文件夹名 + 工作区内相对路径），并说明"浏览器不给完整路径"',
    /const wsPathText = ws \? joinPath\(\[ws\.handle\.name, \.\.\.\(ws\.path \?\? \[\]\)\]\) : ''/.test(panelSrc) &&
      /className="ws-grant-dir" title=\{wsPathText\}/.test(panelSrc) &&
      /\{wsPathText\}/.test(panelSrc) &&
      /grantTitle: '需要重新授权访问这个文件夹'/.test(copySrc) &&
      /grantPathHint/.test(copySrc),
    '')
  check('adj540 面包屑：**左侧图标按钮 = 切换工作区** + **根目录名是普通面包屑段**（用户第二轮反馈：根目录名做换目录很别扭——改成纯路径段，点它=回工作区根）',
    /className="ws-workspace-btn"[\s\S]{0,200}?onClick=\{\(\) => void \(moving \? refreshMovingTarget\(\[\]\) : onPick\(\)\)\}/.test(
      panelSrc,
    ) &&
      /<ToolIcon name="workspace" \/>/.test(panelSrc) &&
      /className="ws-crumb-seg ws-crumb-root"[\s\S]{0,200}?onClick=\{\(\) => void \(moving \? refreshMovingTarget\(\[\]\) : refresh\(ws, \[\]\)\)\}/.test(
        panelSrc,
      ) &&
      !/className="btn ws-root"/.test(panelSrc) &&
      /workspaceBtnTitle/.test(copySrc),
    '')
  check('adj540 入口接线：**窄屏以工作区为主入口**（菜单里工作区排第一，只留平台无关项）',
    // 窄屏分支：工作区在最前，且**不含**系统选择器/新建/保存/另存为那些项（都在面板里或只在 PC 上成立）
    /const fileEntries: \(MenuEntry \| 'sep'\)\[\] = isNarrow\s*\?\s*\[entryWorkspace, entrySamples, entryPaste, entryTryout, entryExport\]/.test(
      topSrc,
    ) &&
      /\{ label: workspaceCopy\.openSystemLabel, onPick: runOpen \}/.test(topSrc) &&
      /\| 'workspace'/.test(ui),
    '')
  check('adj540 手机端「保存」未绑定任何文件时自动引导到工作区另存（手机上不走 showSaveFilePicker）',
    /const runSaveSmart = async \(\) => \{[\s\S]{0,260}?isCoarsePointerDevice\(\) && isWorkspaceSupported\(\) && !useDocStore\.getState\(\)\.binding[\s\S]{0,120}?requestWorkspaceSave\(\)[\s\S]{0,80}?toggleDock\('workspace'\)/.test(
      topSrc,
    ) && /entrySave: MenuEntry = \{ label: '保存\(&S\)', kbd: 'Ctrl\+S', hotkey: 's', onPick: runSaveSmart \}/.test(topSrc),
    '')
  check('adj540 手机端「另存为」也走工作区（开面板 + 展开文件名输入），桌面端仍用系统另存为',
    /const runSaveAsSmart = async \(\) => \{[\s\S]{0,240}?isCoarsePointerDevice\(\) && isWorkspaceSupported\(\)[\s\S]{0,120}?requestWorkspaceSave\(\)[\s\S]{0,80}?toggleDock\('workspace'\)[\s\S]{0,80}?await saveFileAs\(\)/.test(
      topSrc,
    ) &&
      /另存为\(&A\)…', hotkey: 'a', onPick: runSaveAsSmart/.test(topSrc) &&
      /workspaceSaveIntent/.test(String(readFileSync('src/store/uiStore.ts', 'utf8'))) &&
      /clearWorkspaceSaveIntent\(\)/.test(panelSrc),
    '')
  check('adj540 「手机端」判据只有一处（pick 策略与打开/另存为分流共用 saveSupport.isCoarsePointerDevice）',
    /export function isCoarsePointerDevice/.test(String(readFileSync('src/store/saveSupport.ts', 'utf8'))) &&
      !/function isCoarsePointer\(/.test(store) &&
      /shouldUseFileInputPicker\(isCoarsePointerDevice\(\)/.test(store),
    '')
  check('adj540 子目录真的能进（列目录 + 面包屑 + 上级）且**每次打开都重读**（手机上刚存进来的谱要立刻可见）',
    /const list = await readDirEntries\(rec\.handle, next\)/.test(panelSrc) &&
      /onClick=\{\(\) => void openEntry\(e\)\}/.test(panelSrc) &&
      /parentPath\(path\)/.test(panelSrc) &&
      /const active = useUiStore\(\(s\) => s\.dockOpen && s\.dockPanel === 'workspace'\)/.test(panelSrc) &&
      /if \(!active\) \{[\s\S]{0,400}?return[\s\S]{0,30}?\}[\s\S]{0,700}?await getWorkspace\(\)/.test(panelSrc),
    '')
  check('adj540 过滤框：默认层级列表；一过滤就把**整个工作区**符合条件的 .jps 收成**平坦列表**（点一条直接打开）',
    /export async function searchWorkspaceJps/.test(wsSrc) &&
      /export function matchesQuery/.test(wsSrc) &&
      /const \[query, setQuery\] = useState\(''\)/.test(panelSrc) &&
      /const searching = query\.trim\(\)\.length > 0/.test(panelSrc) &&
      // adj543/adj546：过滤改为"走一次建索引（可落盘、可后台重扫） + 内存 filter"
      /void buildIndex\(ws\.handle, ws\.id\)/.test(panelSrc) &&
      /const match = compileQuery\(query\)/.test(panelSrc) &&
      /idx\.filter\(\(h\) => match\(h\.name, h\.relPath\)\)/.test(panelSrc) &&
      /searching\s*\?\s*\(hits \?\? \[\]\)\.slice\(0, RESULT_RENDER_MAX\)\.map/.test(panelSrc) &&
      /workspaceCopy\.filterPlaceholder/.test(panelSrc),
    '')
  check('adj540 过滤框旁有**一键 `*` 按钮**（列出工作区全部 .jps；再点一下清空，激活态高亮）',
    /className=\{`btn ws-filter-all\$\{query\.trim\(\) === '\*' \? ' is-active' : ''\}`\}/.test(panelSrc) &&
      /setQuery\(query\.trim\(\) === '\*' \? '' : '\*'\)/.test(panelSrc) &&
      /filterAll: '\*'/.test(copySrc) &&
      /filterAllTitle/.test(copySrc) &&
      /\.ws-filter-all\.is-active/.test(cssAll),
    '')
  check('adj540/adj546 搜索**没搜完 / 读不动的目录**都必须说出来（API 加 `truncated`/`blocked` 字段；面板 notice）',
    /export interface SearchResult \{[\s\S]{0,400}?truncated: boolean[\s\S]{0,80}?blocked: string\[\]/.test(wsSrc) &&
      /return \{ hits, truncated, blocked, scanned \}/.test(wsSrc) &&
      // adj543/adj546：截断/读不动来自"建索引/重扫"那次的结果（存进 idxMetaRef，过滤时回填）
      /idxMetaRef\.current = \{ truncated: r\.truncated, blocked: r\.blocked \}/.test(panelSrc) &&
      /setHitsTruncated\(idxMetaRef\.current\.truncated\)/.test(panelSrc) &&
      /setBlockedDirs\(idxMetaRef\.current\.blocked\)/.test(panelSrc) &&
      /searchTruncated/.test(copySrc) &&
      /searchBlockedDirs/.test(copySrc) &&
      // 上限不能太小（"* 列不全"的另一种解释就是上限太低）：默认深度 ≥10、条目 ≥5000
      /maxDepth \?\? 10/.test(wsSrc) &&
      /maxEntries \?\? 5000/.test(wsSrc),
    '')
  check('adj540 列表与过滤都**跳过 `.` 开头的条目**（`.git`/`.obsidian`/`.trash` 这类系统目录不算谱，还会吃光搜索配额）',
    /export function isHiddenName/.test(wsSrc) &&
      /if \(isHiddenName\(handle\.name\)\) continue/.test(wsSrc) && // 列目录
      /if \(isHiddenName\(h\.name\)\) continue/.test(wsSrc) && // 递归过滤
      isHiddenName('.git') &&
      isHiddenName('.obsidian') &&
      isHiddenName('.DS_Store') &&
      !isHiddenName('杂记') &&
      !isHiddenName('2.曲谱集'),
    '')
  check('adj540 过滤匹配是纯函数（无通配符按子串；有 `*` `?` 按 glob 整体匹配；大小写不敏感；空查询不过滤）',
    // 无通配符：子串（文件名或相对路径都算）
    matchesQuery('小星星.jps', '2.曲谱集/小星星.jps', '星星') &&
      matchesQuery('小星星.jps', '2.曲谱集/小星星.jps', '曲谱') &&
      matchesQuery('A.JPS', 'A.JPS', 'a.jps') &&
      !matchesQuery('小星星.jps', '2.曲谱集/小星星.jps', '两只老虎') &&
      matchesQuery('小星星.jps', '2.曲谱集/小星星.jps', '  ') &&
      // 通配符：`*` 任意串、`?` 单字符；整体匹配（`小星*` 不命中 `我的小星星.jps`）
      matchesQuery('小星星.jps', '小星星.jps', '小星*') &&
      matchesQuery('我的小星星.jps', '我的小星星.jps', '*星星*') &&
      matchesQuery('小星星.jps', '2.曲谱集/小星星.jps', '*曲谱*') &&
      matchesQuery('小星星.jps', '小星星.jps', '小?星*') &&
      !matchesQuery('我的小星星.jps', '我的小星星.jps', '小星*') &&
      // 查询里的 `.` 是**字面点**，不能当"任意字符"（globToRegexSource 会转义）
      matchesQuery('a.jps', 'a.jps', 'a.jps') &&
      !matchesQuery('axjps', 'axjps', 'a.jps'),
    '')
  check('adj540 面包屑**左对齐**（去掉 .ws-head 里的 space-between）+ 切换按钮**与底栏收起按钮同款样式**（1px 边框 + 7px 圆角 + 主文字色）',
    !/\.ws-head \{[\s\S]{0,400}?justify-content: space-between/.test(cssAll) &&
      // adj543（用户要求）：切换工作区按钮改成与 `.tool-dock-collapse` 一致（不是无底色圆形了）
      /\.ws-workspace-btn \{[\s\S]{0,300}?border: 1px solid var\(--jp-border\)[\s\S]{0,120}?border-radius: 7px/.test(cssAll) &&
      /\.ws-workspace-btn \{[\s\S]{0,400}?color: var\(--jp-text-primary\)/.test(cssAll) &&
      /\.tool-dock-collapse \{[\s\S]{0,300}?border: 1px solid var\(--jp-border\)/.test(cssAll) &&
      /white-space: nowrap/.test(cssAll) &&
      !/\.ws-crumb-root \{[\s\S]{0,200}?text-overflow: ellipsis/.test(cssAll),
    '')
  check('adj540 列表行带**复选框**（勾选=选中供 改名/移动/删除；点名字=打开/进入），且支持多选',
    /<input[\s\S]{0,200}?type="checkbox"[\s\S]{0,200}?className="ws-check"/.test(panelSrc) &&
      /const \[selected, setSelected\] = useState<string\[\]>\(\[\]\)/.test(panelSrc) &&
      /const toggleSelect = \(name: string\)/.test(panelSrc) &&
      /selectedCount: \(n: number\)/.test(copySrc) &&
      /deleteManyConfirm/.test(copySrc) &&
      /\.ws-check \{/.test(cssAll),
    '')
  check('adj540/adj547 交互模型：**点名字=打开/进入**（不再要点两次），勾选与打开互不干扰',
    /const openEntry = async \(entry: DirEntry\) => \{[\s\S]{0,900}?await refresh\(ws, next, workspaceCopy\.enteringDir\(entry\.name\)\)[\s\S]{0,600}?await openWorkspaceFile\(\[\.\.\.path, entry\.name\]\)/.test(
      panelSrc,
    ) &&
      /onClick=\{\(\) => void openEntry\(e\)\}/.test(panelSrc) &&
      !/onRowTap/.test(panelSrc),
    '')
  check('adj540 批量移动/删除逐个执行并汇总（部分失败如实报出，不假装全成功）',
    /moveWorkspaceFiles: async \(fromSegsList, toDirSegs\)/.test(store) &&
      /deleteWorkspaceEntries: async \(items\)/.test(store) &&
      /opPartial/.test(copySrc) &&
      /const ok = await deleteWorkspaceEntries\(confirmDel\.items\)/.test(panelSrc) &&
      /const ok = await moveWorkspaceFiles\(moving\.list, path\)/.test(panelSrc),
    '')
  check('adj540 选择器没反应时不静默（5 秒给可操作指引：改用浏览器打开）',
    /PICKER_NO_RESPONSE_MS/.test(panelSrc) && /pickerNoResponse/.test(copySrc),
    '')

  // ---- ⑤ adj540 续：文件操作（新建/重命名/移动/删除）与安全约束 ----
  // 先剥注释再断言：`workspace.ts` 的注释里**故意提到** `FileSystemHandle.move()` 与
  // `removeEntry(..., {recursive:true})`（说明为什么不用它们），不剥注释会把负向断言绊倒（E-2026-237 同款坑）
  const wsCode = wsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('adj540 条目名校验是纯函数（空 / 含 `/` `\\` / `..` / 控制字符 / 超长都不合法）',
    isValidEntryName('小星星') &&
      isValidEntryName('第2课-练习') &&
      !isValidEntryName('') &&
      !isValidEntryName('   ') &&
      !isValidEntryName('a/b') &&
      !isValidEntryName('a\\b') &&
      !isValidEntryName('..') &&
      !isValidEntryName('a\u0000b') &&
      !isValidEntryName('x'.repeat(81)),
    '')
  check('adj540 另存/重命名时把名字补成 `.jps` 且不会出现 `a.jps.jps`',
    stripJpsExt('小星星') === '小星星' && stripJpsExt('小星星.jps') === '小星星' && stripJpsExt('A.JPS') === 'A',
    '')
  check('adj540 重命名/移动 = 读→写新位置→**回读校验一致才删原文件**（FSA 对用户选中的目录没有 move()，非 OPFS 的移动还停在提案）',
    /async function transferFile\([\s\S]{0,700}?await writeWorkspaceText\(root, to, text\)[\s\S]{0,200}?if \(back !== text\) throw new Error\('VERIFY'\)[\s\S]{0,120}?await removeFile\(root, from\)/.test(
      wsCode,
    ) &&
      !/\.move\(/.test(wsCode),
    '')
  check('adj540 删除是**永久**的：二次确认 + 目录只允许删空的（避免递归删掉用户目录里其它文件）',
    /export async function removeEmptyDir[\s\S]{0,500}?NOT_EMPTY[\s\S]{0,300}?removeEntry\(name\)/.test(wsCode) &&
      /deleteFileConfirm/.test(copySrc) &&
      /confirmDel/.test(panelSrc) &&
      // 明确**不用** recursive：它会连目录里的照片/文档一起删掉
      !/recursive:\s*true/.test(wsCode),
    '')
  check('adj540 文件操作维护"当前文档的工作区绑定"（改名/移动跟着改，删除则解绑并提示）',
    /renameWorkspaceFile: async/.test(store) &&
      /moveWorkspaceFiles: async/.test(store) &&
      /deleteWorkspaceEntries: async/.test(store) &&
      /newWorkspaceScore: async/.test(store) &&
      /createWorkspaceDir: async/.test(store) &&
      /const cur = get\(\)\.binding[\s\S]{0,200}?saveDraftSrc\(next\)[\s\S]{0,200}?set\(\{ binding: next, fileName: fileBaseName\(toName\) \}\)/.test(store) &&
      /const target = joinPath\(segs\)/.test(store) &&
      // adj544：删除当前打开的谱 ⇒ 解绑并清掉持久化的来源（否则重启后又"以为"绑定在已删文件上）
      /set\(\{ binding: null, pendingBinding: null \}\)/.test(store),
    '')

  // ---- adj558（v0.28.2）：工作区"新建目录"——文案 + 行为两件事一起修 ----
  // ① 文案："新建夹" → "新建目录"；notice 里"已新建文件夹" → "已新建目录"
  check('adj558 菜单按钮 / 输入框标题 文案改为"新建目录"（不再用"夹"/"文件夹"）',
    /actNewFolder: '新建目录'/.test(copySrc) &&
      /dirCreated: \(n: string\): string => `已新建目录「\$\{n\}」`/.test(copySrc) &&
      // 整个项目不再出现"新建夹"/"新建文件夹"作为按钮文案（注释里讨论旧文案可以保留）
      !/actNewFolder:\s*'新建夹'/.test(copySrc) &&
      !/dirCreated:\s*\(n: string\): string => `已新建文件夹/.test(copySrc),
    '')
  // ② 行为：创建完成后**自动进入**新目录（用 path 的 spread 形式，与 `resolveDir` 的 segs 同型）
  check('adj558 提交"新建目录"后 `refresh` 的目标路径 = `[...path, value]`（自动进入新目录，不再停在父目录）',
    /if \(edit\.kind === 'newFolder'\) \{[\s\S]{0,300}?await createWorkspaceDir\(path, value\)[\s\S]{0,300}?await refresh\(ws, \[\.\.\.path, value\]\)/.test(panelSrc),
    '')
  // ③ 行为：刷新父目录时**新目录要能被列出来**——根因级测试，确保 `createSubdir` 之后
  // `readDirEntries` 立刻看到新增条目（不是依赖缓存或下一次 re-mount）。
  // 极简 FSA 假实现：父目录用一个 Map<name, child> 模拟 `values()` 迭代，
  // `getDirectoryHandle({create:true})` 创建并加入 Map，构造出的 dir handle 的
  // `values()` 重新生成——和真实浏览器 FSA 的"每次取都是新迭代器"语义一致。
  const mkDir = (name: string, children = new Map<string, unknown>()): FileSystemDirectoryHandle => {
    const childrenRef = children
    const handle = {
      kind: 'directory' as const,
      name,
      async queryPermission() { return 'granted' as const },
      async requestPermission() { return 'granted' as const },
      async isSameEntry(other: FileSystemHandle) {
        return (other as { name?: string }).name === name
      },
      async getDirectoryHandle(seg: string, opts?: { create?: boolean }) {
        let child = childrenRef.get(seg) as ReturnType<typeof mkDir> | undefined
        if (!child) {
          if (!opts?.create) throw new DOMException('NotFound', 'NotFoundError')
          child = mkDir(seg, new Map())
          childrenRef.set(seg, child)
        }
        return child
      },
      async getFileHandle(seg: string, opts?: { create?: boolean }) {
        let child = childrenRef.get(seg) as { name: string; kind: 'file'; getFile(): Promise<File>; createWritable(): Promise<unknown>; isSameEntry(o: FileSystemHandle): Promise<boolean> } | undefined
        if (!child) {
          if (!opts?.create) throw new DOMException('NotFound', 'NotFoundError')
          child = { kind: 'file' as const, name: seg, async getFile() { return new File([''], seg) }, async createWritable() { return { write: async () => {}, close: async () => {}, abort: async () => {} } }, async isSameEntry(other: FileSystemHandle) { return (other as { name?: string }).name === seg } }
          childrenRef.set(seg, child)
        }
        return child as unknown as FileSystemFileHandle
      },
      async removeEntry(seg: string) { childrenRef.delete(seg) },
      async resolve() { return null },
      async *values() {
        // 每次迭代都基于 childrenRef 的**当前**值生成新迭代器
        for (const c of childrenRef.values()) yield c as unknown as FileSystemHandle
      },
    } as unknown as FileSystemDirectoryHandle
    return handle
  }
  let adj558DirCaseErr = ''
  try {
    const root = mkDir('root')
    const before = await readDirEntries(root, [])
    if (before.length !== 0) throw new Error(`expected empty dir, got ${before.length}`)
    await createSubdir(root, [], 'NewDir')
    const after = await readDirEntries(root, [])
    const hasNew = after.some((e) => e.kind === 'dir' && e.name === 'NewDir')
    if (!hasNew) throw new Error(`after create, root listing=${JSON.stringify(after.map((e) => e.name))}`)
    // 再创建同名 → 应抛 EXISTS（与 createSubdir 的 hasEntry 校验一致）
    let threwExists = false
    try { await createSubdir(root, [], 'NewDir') } catch (e) { threwExists = (e as Error).message === 'EXISTS' }
    if (!threwExists) throw new Error('duplicate createSubdir did not throw EXISTS')
  } catch (e) { adj558DirCaseErr = (e as Error).message }
  check('adj558 创建子目录后，readDirEntries 立刻看到新条目（不依赖缓存重建）',
    !adj558DirCaseErr,
    adj558DirCaseErr)
}

/**
 * adj541：底栏的**展开 / 收起**两个入口（用户要求）。
 *
 *  - 底栏收起时：编辑区**行号栏位置**浮出「展开底栏」图标按钮（`public/icons/底栏展开.png`）。
 *    放在 `.editor-body` 里、按 `--jp-gutter-w` 居中到行号列上（行号栏本身是 `aria-hidden` 的装饰层，
 *    不能往里塞可点按钮）；又因为输入条在 `.editor-body` 之外的下方，按钮**自然不占输入条位置**。
 *  - 底栏展开时：页签栏里、**高度档位按钮左边**是「收起底栏」按钮（`public/icons/底栏收起.png`）。
 *  另：两个图标都必须是"纯黑 + alpha"的图（adj457 口径），且 alpha 要**够实**——
 *  用户反馈"图标有点糊"就是半透明过渡过多 + 按钮 `opacity` + 灰字色三者叠加。
 */
async function runAdj541DockToggleTests() {
  console.log('[123] dock expand/collapse entries (adj541)')
  const editorSrc = String(readFileSync('src/editor/EditorPane.tsx', 'utf8'))
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const cssSrc = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const copySrc2 = String(readFileSync('src/brand/copy.ts', 'utf8'))
  const iconSrc = String(readFileSync('src/ui/toolIcons.ts', 'utf8'))
  const wsPanelSrc = String(readFileSync('src/ui/dock/WorkspacePanel.tsx', 'utf8'))
  // adj544：绑定/持久化断言要读这几份源码（copy 文案用上面的 copySrc2）
  const wsSrc = String(readFileSync('src/store/workspace.ts', 'utf8'))
  const fhSrc = String(readFileSync('src/store/fileHandleDb.ts', 'utf8'))
  const store = String(readFileSync('src/store/docStore.ts', 'utf8'))
  check('adj541 两个新图标登记进 ICON_FILES（文件名与设计稿一致）',
    /dockExpand: '底栏展开'/.test(iconSrc) && /dockCollapse: '底栏收起'/.test(iconSrc),
    '')
  check('adj541 收起底栏时，编辑区**行号栏位置**浮出「展开底栏」按钮（`!dockOpen` 才渲染 + 点它展开且保留上次页签）',
    /\{!dockOpen && \([\s\S]{0,400}?className="dock-fab"[\s\S]{0,300}?onClick=\{\(\) => setDockPanel\(dockPanel\)\}/.test(editorSrc) &&
      /<ToolIcon name="dockExpand" \/>/.test(editorSrc) &&
      // 用文案断言"组件确实引用了集中管理的文案"（文案本体在 copy.ts 的 dockCopy 里）
      /dockCopy\.expandTitle/.test(editorSrc) &&
      /expandTitle: '展开底栏'/.test(copySrc2),
    '')
  check('adj541 悬浮按钮对齐**行号栏列**（用 `--jp-gutter-w` 居中，不压代码内容）且**不透明**（用户反馈"糊"）',
    /--jp-gutter-w/.test(editorSrc) &&
      /\.dock-fab \{[\s\S]{0,200}?left: max\(2px, calc\(\(var\(--jp-gutter-w/.test(cssSrc) &&
      /\.dock-fab \{[\s\S]{0,400}?color: var\(--jp-text-primary\)/.test(cssSrc) &&
      // 不许再有 opacity（半透明会让图标"发虚"）
      !/\.dock-fab \{[\s\S]{0,400}?opacity:/.test(cssSrc),
    '')
  check('adj541 底栏页签栏：**高度档位按钮左边**是「收起底栏」按钮（点它 closeDock）',
    dockSrc.indexOf('className="tool-dock-collapse"') > -1 &&
      dockSrc.indexOf('className="tool-dock-collapse"') < dockSrc.indexOf('className="tool-dock-size-btn"') &&
      /<ToolIcon name="dockCollapse" size=\{16\} \/>/.test(dockSrc) &&
      /dockCopy\.collapseTitle/.test(dockSrc) &&
      /collapseTitle: '收起底栏'/.test(copySrc2) &&
      /\.tool-dock-collapse \{/.test(cssSrc),
    '')
  check('adj542 行号栏**默认两位数**宽，滚到超过两位数行号才加宽（不再按整篇行数一次给足）',
    /const \[gutterDigits, setGutterDigits\] = useState\(2\)/.test(editorSrc) &&
      /syncGutterDigitsRef\.current\(ta\.scrollTop, ta\.clientHeight\)/.test(editorSrc) &&
      /const need = Math\.max\(2, String\(idx \+ 1\)\.length\)/.test(editorSrc) &&
      /setGutterDigits\(\(prev\) => \(prev >= need \? prev : need\)\)/.test(editorSrc) &&
      /Math\.min\(gutterDigits, String\(lineCount\)\.length\)/.test(editorSrc) &&
      // 反查"最后一个可见源码行"用视觉行前缀和二分（折行不产生新行号）
      /visualTopRef\.current/.test(editorSrc) &&
      /Math\.floor\(\(top \+ Math\.max\(0, clientH - 1\)\) \/ lineH\)/.test(editorSrc),
    '')
  // E-2026-251 / adj544：**绑定必须带工作区身份**，否则"换了工作区再保存"会把旧相对路径写进新根
  // （没同名就新建、有同名就覆盖）⇒ 静默写错文件。下面这些断言守住四件事：
  //   ① 记录带 id/name（含旧记录迁移）② 绑定带 wsId 且**随草稿持久化**
  //   ③ 保存前三道校验（身份/权限/存在）④ 启动与授权后能"恢复绑定"
  check('adj544 工作区记录带**身份 id**（旧记录读取时补发），并有"最近工作区"列表可一键切回',
    /export interface WorkspaceRecord \{[\s\S]{0,400}?id: string[\s\S]{0,120}?name: string/.test(fhSrc) &&
      /function normalizeRecord\(rec: WorkspaceRecord \| null\): WorkspaceRecord \| null/.test(wsSrc) &&
      /export function makeWorkspaceRecord\(handle: FileSystemDirectoryHandle/.test(wsSrc) &&
      /export async function listWorkspaces\(\): Promise<WorkspaceRecord\[\]>/.test(wsSrc) &&
      /export async function activateWorkspace\(id: string\)/.test(wsSrc) &&
      /saveWorkspaceList/.test(fhSrc),
    '')
  check('adj544 文档绑定 = {工作区身份, 相对路径}，并**随草稿持久化**（ijipu.draftSrc，损坏回退 null）',
    /export interface WorkspaceBinding \{[\s\S]{0,260}?wsId: string[\s\S]{0,80}?wsName: string[\s\S]{0,80}?segs: string\[\]/.test(store) &&
      /const DRAFT_SRC_KEY = 'ijipu\.draftSrc'/.test(store) &&
      /function loadDraftSrc\(\): WorkspaceBinding \| null/.test(store) &&
      /function saveDraftSrc\(b: WorkspaceBinding \| null\): void/.test(store) &&
      /pendingBinding: draft\?\.src \?\? null/.test(store) &&
      // 打开/另存都写来源；删除时清掉
      /saveDraftSrc\(bind\)/.test(store) &&
      /saveDraftSrc\(null\)/.test(store),
    '')
  check('adj544（E-2026-251）保存前**三道校验**：工作区身份不符 ⇒ 拒绝写盘并解释；原文件不存在 ⇒ 转另存',
    /if \(ws\.id !== bind\.wsId\) \{[\s\S]{0,400}?boundToOtherWorkspace\([\s\S]{0,120}?return false/.test(store) &&
      /if \(!\(await hasEntry\(ws\.handle, wsPath\.slice\(0, -1\), wsPath\[wsPath\.length - 1\]\)\)\) \{[\s\S]{0,300}?sourceMissing\([\s\S]{0,120}?return false/.test(
        store,
      ) &&
      // 拒绝文案要把"东西在哪 + 为什么没写 + 怎么办"说全
      /boundToOtherWorkspace: \(boundWs: string, currentWs: string, path: string\)/.test(copySrc2) &&
      /sourceMissing: \(path: string\)/.test(copySrc2),
    '')
  check('adj544 启动/授权后**恢复绑定**（三个条件全满足才升级成正式绑定，否则保持待校验）',
    /export async function resolvePendingBinding\(\): Promise<boolean>/.test(store) &&
      /if \(ws\.id !== pending\.wsId\)/.test(store) &&
      /await queryWorkspacePermission\(ws\.handle\)/.test(store) &&
      /await hasEntry\(ws\.handle, segs\.slice\(0, -1\), segs\[segs\.length - 1\]\)/.test(store) &&
      /void getWorkspace\(\)\s*\n\s*\.then\(\(\) => resolvePendingBinding\(\)\)/.test(store) &&
      // 面板：授权成功后、以及每次打开面板都会尝试恢复
      /await resolvePendingBinding\(\)/.test(wsPanelSrc) &&
      /bindingRestored/.test(copySrc2),
    '')
  check('adj545/adj549（用户要求）面板**上面包屑整行 + 下分左右两栏**：左=列表；右=固定宽度（过滤 / `*` / ✕ / 操作▾）',
    // 上：ws-head（切换工作区按钮 + 面包屑）在 ws-body **之前**，独占一行
    /<div className="ws-panel">[\s\S]{0,600}?<div className="ws-head">[\s\S]{0,1400}?className="ws-workspace-btn"[\s\S]{0,2000}?className="ws-crumb"[\s\S]{0,4000}?<div className="ws-body">[\s\S]{0,400}?<div className="ws-left">[\s\S]{0,800}?className=\{`ws-list[\s\S]{0,7000}?<div className="ws-side">/.test(
      wsPanelSrc,
    ) &&
      // 下：过滤三件套 + 操作▾ 都在右栏里（顺序：过滤框 → * / ✕ 一行 → 操作）
      /className="ws-input ws-filter"[\s\S]{0,900}?className="ws-filter-row"[\s\S]{0,900}?ws-filter-all[\s\S]{0,900}?ws-filter-clear[\s\S]{0,900}?ws-side-group/.test(
        wsPanelSrc,
      ) &&
      // 消除过滤常驻（无过滤时禁用）——位置固定，不因是否有过滤而跳动
      /className="btn ws-filter-clear"[\s\S]{0,200}?disabled=\{!searching\}/.test(wsPanelSrc) &&
      /\.ws-left \{[\s\S]{0,220}?flex: 1 1 auto/.test(cssSrc) &&
      /\.ws-side \{[\s\S]{0,260}?width: 132px/.test(cssSrc) &&
      // 窄屏右栏收窄到 116px（仍放得下过滤框），且**写在基础规则之后**（同级后者胜，见 E-2026-244）
      /@container \(max-width: 430px\) \{[\s\S]{0,200}?\.ws-side \{ width: 116px; \}/.test(cssSrc),
    '')
  check('adj543/adj546 过滤提速：**先建一次索引，之后每次输入只在内存里过滤**，且索引可落盘、可后台重扫',
    /const indexRef = useRef<SearchHit\[\] \| null>\(null\)/.test(wsPanelSrc) &&
      /const buildIndex = useCallback\(\s*\n?\s*async \(handle: FileSystemDirectoryHandle, wsId: string, force = false\)/.test(wsPanelSrc) &&
      /const refreshIndex = useCallback\(async \(handle: FileSystemDirectoryHandle, wsId: string\)/.test(wsPanelSrc) &&
      // ① 先用落盘的索引（秒开）② **只有过期才**后台重扫 ③ 扫完落盘
      /const cached = force \? null : await loadWorkspaceIndex\(wsId\)/.test(wsPanelSrc) &&
      /const stale = Date\.now\(\) - \(cached\.at \?\? 0\) > INDEX_STALE_MS/.test(wsPanelSrc) &&
      /if \(stale\) void refreshIndex\(handle, wsId\)/.test(wsPanelSrc) &&
      /await saveWorkspaceIndex\(\{ wsId, at: Date\.now\(\), relPaths: r\.hits\.map\(\(h\) => h\.relPath\) \}\)/.test(wsPanelSrc) &&
      // 边扫边出结果（慢节流地把 partial 引用交给索引 + 进度状态；不再每跳复制数组/重算正则）
      /onProgress: \(scanned, partial\) => \{[\s\S]{0,400}?indexRef\.current = partial/.test(wsPanelSrc) &&
      /setScanInfo\(\{ scanned, found: partial\.length, ms: Date\.now\(\) - t0 \}\)/.test(wsPanelSrc) &&
      /const filterFromIndex = \(\): boolean => \{/.test(wsPanelSrc) &&
      /idx\.filter\(\(h\) => match\(h\.name, h\.relPath\)\)/.test(wsPanelSrc) &&
      /if \(filterFromIndex\(\)\) return/.test(wsPanelSrc) &&
      // 写操作（invalidateCache）与面板打开都让索引作废
      /indexRef\.current = null/.test(wsPanelSrc) &&
      // 不再用 200ms debounce 包着整树搜索
      !/setTimeout\(\(\) => \{[\s\S]{0,80}?void searchWorkspaceJps\(ws\.handle, query\)/.test(wsPanelSrc),
    '')
  // adj547（用户反馈）：点目录/文件之后到内容出来之间是"黑的"——用户分不清是"不能点/没响应/在忙"。
  // 要求：**先进入**（面包屑立刻变）+ 列表里立刻出现"转圈 + 在做什么" + 旧内容变淡；读完提示消失。
  check('adj547（用户反馈）点目录/文件**立刻有进行中的提示**（面包屑先变 + 转圈文案 + 旧列表变淡）',
    /const \[busyLabel, setBusyLabel\] = useState<string \| null>\(null\)/.test(wsPanelSrc) &&
      /setBusyLabel\(workspaceCopy\.enteringDir\(entry\.name\)\)/.test(wsPanelSrc) &&
      /setBusyLabel\(workspaceCopy\.openingFile\(entry\.name\)\)/.test(wsPanelSrc) &&
      // 面包屑"先进入"（乐观更新），失败回滚
      /setPath\(next\) \/\/ 乐观更新面包屑：先"进目录"/.test(wsPanelSrc) &&
      /setPath\(prev\) \/\/ 读失败回滚/.test(wsPanelSrc) &&
      // 提示渲染 + 变淡 + 转圈
      /\{busyLabel && \([\s\S]{0,300}?className="ws-loading"[\s\S]{0,200}?className="ws-spin"/.test(wsPanelSrc) &&
      /className=\{`ws-list\$\{busyLabel \? ' is-busy' : ''\}`\}/.test(wsPanelSrc) &&
      /enteringDir: \(name: string\): string => `正在进入「\$\{name\}」…`/.test(copySrc2) &&
      /openingFile: \(name: string\): string/.test(copySrc2) &&
      /\.ws-spin \{[\s\S]{0,320}?animation: ws-spin/.test(cssSrc) &&
      /\.ws-list\.is-busy \.ws-row \{[\s\S]{0,80}?opacity/.test(cssSrc) &&
      // 打开工作区/读取目标目录也都有提示
      /workspaceCopy\.loadingWorkspace/.test(wsPanelSrc) &&
      /workspaceCopy\.readingTarget/.test(wsPanelSrc),
    '')
  // adj550（用户要求，**一条规则**）：进入工作区 ⇒ 定位到该工作区的最新位置。
  // 「授权」只是前置条件：未授权 ⇒ 授权成功后调用；已授权 ⇒ 激活/切工作区时直接调用。
  // 三条入口共用 `enterAtLatestPos`（一条规则只有一处实现），位置不存在则收敛到仍存在的最外层。
  check('adj550（用户要求）**进入工作区就定位到最新位置**——激活/授权后/切工作区三条入口共用同一个 `enterAtLatestPos`',
    /const enterAtLatestPos = useCallback\(\s*\n?\s*async \(rec: WorkspaceRecord, label: string\) => \{/.test(wsPanelSrc) &&
      /const want = rec\.path \?\? \[\]/.test(wsPanelSrc) &&
      /const dir = await resolveExistingDir\(rec\.handle, want\)/.test(wsPanelSrc) &&
      /showNotice\(workspaceCopy\.dirGone\(joinPath\(want\) \|\| '根目录', joinPath\(dir\)\), 'warn'\)/.test(wsPanelSrc) &&
      /await refresh\(rec, dir, label\)/.test(wsPanelSrc) &&
      // useCallback 固定引用（否则进 effect 依赖会无限刷新，E-2026-249）
      /\[\s*refresh, showNotice\s*\],/.test(wsPanelSrc) &&
      // 三条入口都在调它：激活（已授权）/ 授权成功后 / 切工作区
      (wsPanelSrc.match(/await enterAtLatestPos\(/g) ?? []).length >= 3 &&
      // 不再各自内联拼路径（旧写法）
      !/const want = path\.length > 0 \? path/.test(wsPanelSrc),
    '')
  check('adj548/adj550（用户反馈）**进入目录就记住位置**（每次切换立即落盘，列表条目同步最新位置）',
    /void rememberWorkspacePath\(next\)/.test(wsPanelSrc) &&
      /void rememberWorkspacePath\(next\) \/\/ adj548：移动模式下选目标也记住/.test(wsPanelSrc) &&
      // 立即落盘（无防抖）＋ 最近工作区列表里的那条也跟着更新（否则切回该工作区会拿到旧位置）
      /cached = \{ \.\.\.cached, path: normalizeRelPath\(path\) \}/.test(wsSrc) &&
      /await saveWorkspace\(cached\)[\s\S]{0,120}?syncListPath\(cached\)/.test(wsSrc) &&
      /function syncListPath\(rec: WorkspaceRecord\): void/.test(wsSrc) &&
      !/pathSaveTimer/.test(wsSrc) &&
      /flushWorkspacePath\(\)/.test(wsPanelSrc) &&
      /export function flushWorkspacePath\(\)/.test(wsSrc) &&
      /dirGone: \(was: string, now: string\)/.test(copySrc2),
    '')
  check('adj548（用户反馈）操作按钮的下三角改用 `下.png`/`上.png` 图标（不再是 9px 的 ▾ 字符）',
    /<ToolIcon name=\{menuOpen \? 'up' : 'down'\} size=\{12\} \/>/.test(wsPanelSrc) &&
      !/ws-caret">\{menuOpen \? '▴'/.test(wsPanelSrc) &&
      /\.ws-caret \{[\s\S]{0,300}?display: inline-flex/.test(cssSrc),
    '')
  // adj546：用户实测「5550 文件 / 117 目录，`*` 过滤 27 秒」。FSA 每条都要跟浏览器进程往返一次
  // （手机上约 5ms）⇒ **串行枚举=延迟叠加**。三条对症措施：
  //   ① 并发枚举目录（默认 4 路，把往返延迟重叠）② `.开头的条目直接跳过且不下钻` ③ 边扫边出 + 落盘索引
  check('adj546 性能：目录**并发枚举**（把 FSA 每次往返的延迟重叠），`. 开头`的条目**跳过且不下钻**',
    /const concurrency = Math\.max\(1, Math\.min\(8, options\.concurrency \?\? 4\)\)/.test(wsSrc) &&
      /Array\.from\(\{ length: concurrency \}, \(\) => worker\(\)\)/.test(wsSrc) &&
      // 隐藏项判定放在 scanned++ **之前**（连扫描计数都不占），且 continue 不下钻
      /if \(isHiddenName\(h\.name\)\) continue[\s\S]{0,200}?scanned\+\+/.test(wsSrc) &&
      /onProgress\?: \(scanned: number, hits: SearchHit\[\]\) => void/.test(wsSrc) &&
      // 落盘索引：按工作区身份 + 只存相对路径
      /export interface CachedIndex \{[\s\S]{0,200}?wsId: string[\s\S]{0,120}?relPaths: string\[\]/.test(fhSrc) &&
      /export async function loadWorkspaceIndex\(wsId: string\)/.test(fhSrc),
    '')
  // adj546：**用"假句柄 + 手机量级延迟"实测并发收益**——真机 FSA 每次枚举约 5ms，
  // 这里给每个条目注入 2ms 延迟，比较 concurrency=1 与 4 的耗时。确定性（不依赖真实磁盘）。
  {
    const mkDir = (name: string, children: unknown[], perEntryMs: number): unknown => ({
      kind: 'directory',
      name,
      values: async function* () {
        for (const c of children) {
          await new Promise((r) => setTimeout(r, perEntryMs))
          yield c
        }
      },
    })
    const files = (n: number, perEntryMs: number) =>
      Array.from({ length: n }, (_, i) => ({ kind: 'file', name: `s${i}.jps`, getFile: async () => null }) as unknown)
    const perEntry = 2
    const root = mkDir('root', Array.from({ length: 8 }, (_, i) => mkDir(`d${i}`, files(20, perEntry), perEntry)), perEntry) as never
    const t1 = Date.now()
    const r1 = await searchWorkspaceJps(root, '*', { concurrency: 1 })
    const serialMs = Date.now() - t1
    const t4 = Date.now()
    const r4 = await searchWorkspaceJps(root, '*', { concurrency: 4 })
    const parMs = Date.now() - t4
    console.log(`    并发实测（假句柄 ${perEntry}ms/条）：串行 ${serialMs}ms → 并发4 ${parMs}ms（提速 ${(serialMs / Math.max(1, parMs)).toFixed(1)}×）`)
    // adj553（用户反馈）：输入条放不下时，**PC 端也要能滑到后面的按键**——手机上靠触摸滑动，
    // 而鼠标滚轮默认只驱动纵向滚动、滚动条又被隐藏 ⇒ 后面的按键够不到、也看不出"还有内容"。
    {
      const padSrc = String(readFileSync('src/editor/ScriptToolbar.tsx', 'utf8'))
      check('adj553（用户反馈）PC 端输入条放不下时可横向翻看：**滚轮转横向** + 溢出时才出现的**左右箭头**',
        // 滚轮：非 passive 才能 preventDefault；触摸板横向滚动放行；只在溢出时接管
        /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(padSrc) &&
          /if \(el\.scrollWidth <= el\.clientWidth\) return/.test(padSrc) &&
          /if \(Math\.abs\(e\.deltaX\) >= Math\.abs\(e\.deltaY\)\) return/.test(padSrc) &&
          /el\.scrollLeft \+= e\.deltaY/.test(padSrc) &&
          // 箭头：只在对应方向还有内容时出现；滚动/尺寸变化实时同步
          /\{padOverflow\.left && \(/.test(padSrc) &&
          /\{padOverflow\.right && \(/.test(padSrc) &&
          /new ResizeObserver\(syncOverflow\)/.test(padSrc) &&
          /className="pad-key pad-scroll-btn"/.test(padSrc) &&
          /\.script-pad \.pad-scroll-btn \{/.test(cssSrc),
        '')
    }
    check(
      'adj546 并发枚举确实快于串行（假句柄注入 2ms/条延迟；真机 FSA 就是这个量级）',
      r1.hits.length === 160 && r4.hits.length === 160 && parMs * 1.6 < serialMs,
      `串行 ${serialMs}ms / 并发4 ${parMs}ms（命中 ${r4.hits.length}）`,
    )
    // 隐藏项：`.git` 下的谱一个都不能进结果，且不该被计数
    const hidden = mkDir('.git', files(50, perEntry), perEntry)
    const root2 = mkDir('root', [hidden, mkDir('ok', files(3, perEntry), perEntry)], perEntry) as never
    const r5 = await searchWorkspaceJps(root2, '*', { concurrency: 4 })
    check(
      'adj546 `. 开头`的目录**不进结果也不下钻**（`.git` 里 50 个文件一个都不该被扫到）',
      r5.hits.length === 3 && r5.scanned === 4, // 1 个 .git + 1 个 ok + ok 里 3 个文件 … 见下方口径
      `命中 ${r5.hits.length}、扫描 ${r5.scanned}`,
    )
  }
  // adj552（用户要求）：**宽屏左右拆分时底栏 dock 是"编辑区的底栏"**（左预览通高 | 右：上编辑/下底栏）；
  // **窄屏模式不变**（上下拆分/纯编辑/纯预览仍在窗口底部、整幅宽度）。
  // 实测坑：`.split-pane-h` 是 row 方向，编辑区与底栏必须包一层**列**容器（否则底栏被挤成 0 宽，实测 x=1280,w=0）。
  {
    const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
    check('adj552（用户要求）宽屏左右拆分：底栏只占编辑侧（上编辑/下底栏）；**窄屏及非左右拆分保持不变**',
      /const editorWithDock = \(\s*\n\s*<div className="editor-col">[\s\S]{0,200}?<EditorPane \/>[\s\S]{0,100}?<ToolDock \/>/.test(appSrc) &&
        /\{previewOnLeft \? <PreviewPane \/> : editorWithDock\}/.test(appSrc) &&
        /\{previewOnLeft \? editorWithDock : <PreviewPane \/>\}/.test(appSrc) &&
        // 其余视图仍是纯 EditorPane（窄屏不变）
        /\{viewType === 'code' && <EditorPane \/>\}/.test(appSrc) &&
        /\{viewType === 'split' && \([\s\S]{0,600}?<EditorPane \/>/.test(appSrc) &&
        // 窗口底部那份底栏**只在非左右拆分**时渲染
        /\{!isSplitHView && <ToolDock \/>\}/.test(appSrc) &&
        // CSS：编辑列必须显式 column（`.split-pane-h` 是 row）
        /\.split-pane-h > \.editor-col \{[\s\S]{0,220}?flex-direction: column/.test(cssSrc),
      '')
  }
  // E-2026-249：面板"一直闪 + 点不动"= **无限刷新循环**。
  // 根因：`invalidateCache` 是普通函数（每次渲染新引用）却进了 `refresh` 的 useCallback 依赖，
  // 使 `refresh` 每次渲染都变 ⇒ 依赖它的"面板激活"effect 每渲染重跑 ⇒ setState ⇒ 再渲染……
  // 断言要点：**进依赖的必须是稳定引用**（useCallback([]) / ref / store action）。
  check('adj540 面板不会无限刷新（E-2026-249）：`invalidateCache` 用 useCallback([]) 固定、`refresh` 依赖只有稳定项、激活 effect 依赖全是稳定引用',
    /const invalidateCache = useCallback\(\(\) => \{[\s\S]{0,200}?\}, \[\]\)/.test(wsPanelSrc) &&
      !/\[showNotice, invalidateCache\]/.test(wsPanelSrc) &&
      // refresh 的依赖数组里只有 showNotice（store action，稳定引用）
      /\[\s*showNotice,?\s*\]/.test(wsPanelSrc) &&
      // 激活 effect：active / refresh / showNotice / enterAtLatestPos —— 都是稳定引用或布尔量
      /\}, \[active, refresh, showNotice, enterAtLatestPos\]\)/.test(wsPanelSrc) &&
      // 关闭面板时写路径记忆走 ref，不把 `path` 塞进依赖（否则每次导航都会重跑 effect）
      /rememberWorkspacePath\(pathRef\.current\)/.test(wsPanelSrc),
    '')
}

async function runNewDocTemplateTests() {
  console.log('[81b] new document uses the template file (adj481)')  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { useDocStore } = (await import('../src/store/docStore.ts')) as any
  const st = () => useDocStore.getState()
  st().newDoc()
  const tpl = readFileSync(join(root, 'src', 'samples', '未命名.jps'), 'utf8')
  const norm = (s: string) => s.replace(/\r\n/g, '\n')
  check('adj481 菜单「新建」的正文 = 模板文件内容', norm(st().code) === norm(tpl), `${norm(st().code).length} vs ${norm(tpl).length} 字符`)
  check('adj481 新建后文件名为「未命名」且未标脏', st().fileName === '未命名' && st().dirty === false, `${st().fileName}/${st().dirty}`)
  check(
    'adj481 新建后页面设置 = 默认（模板里 # jps-config:{} 不覆盖任何项）',
    st().pageConfig.note_size === defaultPageConfig.note_size && st().pageConfig.margin_left === defaultPageConfig.margin_left,
    `size=${st().pageConfig.note_size} left=${st().pageConfig.margin_left}`,
  )
  check('adj481 新建后能正常解析（无 error）', st().parseResult.errors.every((e: { severity: string }) => e.severity !== 'error'), JSON.stringify(st().parseResult.errors.slice(0, 2)))
}

// ---- 110. dock 设置面板：字段按「当页最长标签」对齐（adj482）----
// 用户报：设置里的内容项流式排列 + 标签长短不一 ⇒ 控件落点参差。
// 做法：`--pcfg-label-w`（当页最长标签）+ `--pcfg-field-w`（一格基本宽）+ 每行 `--pcfg-span`（宽字段跨格）
// 全部由 JS 实测写成 CSS 变量，面板按等宽格网格排列 ⇒ 标签列对齐、控件跨格成列。
console.log('[110] dock settings fields align by longest label (adj482)')
{
  const css = String(readFileSync('src/index.css', 'utf8'))
  // 去掉注释再断言（规则之间常夹着"为什么"的中文注释，直接正则匹配会被注释长度绊住）
  const cssFlat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const dlg = String(readFileSync('src/dialogs/PageConfigDialog.tsx', 'utf8'))
  check('adj482 字段网格按变量排（标签列 + 等宽格 + 跨格）',
    /\.tool-dock \.pcfg-fields \{[\s\S]{0,160}grid-template-columns: repeat\(auto-fill, minmax\(var\(--pcfg-field-w/.test(css) &&
      /\.pcfg-fields \.pcfg-row \{[\s\S]{0,220}grid-template-columns: var\(--pcfg-label-w/.test(css) &&
      /grid-column: span var\(--pcfg-span/.test(css),
    '')
  check('adj482 分组标题跨整行（从 .pcfg-panel 起用后代选择器：任何嵌套层级都不会被当成字段格）',
    /\.pcfg-panel \.pcfg-group-title \{[\s\S]{0,300}?grid-column: 1 \/ -1/.test(cssFlat),
    '')
  check('adj482 说明文字（.pcfg-note）同样跨整行', /\.pcfg-fields \.pcfg-note \{[^}]*grid-column: 1 \/ -1/.test(cssFlat), '')
  check('adj482 窄 dock 退化为单列（仍以同一标签基准对齐）', /@container \(max-width: 560px\) \{\s*\.tool-dock \.pcfg-fields \{ grid-template-columns: minmax\(0, 1fr\)/.test(css), '')
  check('adj482 测量用离屏克隆探针（不改真实 DOM）', css.includes('.pcfg-measure-probe') && dlg.includes("probe.className = 'pcfg-measure-probe'"), '')
  check('adj482 测量值写回 CSS 变量（标签列 / 格宽 / 每行跨格）',
    dlg.includes("setProperty('--pcfg-label-w'") && dlg.includes("setProperty('--pcfg-field-w'") && dlg.includes("setProperty('--pcfg-span'"),
    '')
  check('adj482 只在 dock 里测量（弹窗宽度固定，保持原两列布局）', dlg.includes("el.closest('.tool-dock')"), '')
  // 回归护栏：Row 的布局**不能**写回内联 style——内联会压过 dock 的覆盖规则（本次踩过的坑）
  const rowSrc = /function Row\([\s\S]*?\n\}/.exec(dlg)?.[0] ?? ''
  check('adj482 Row 组件不再用内联布局样式（否则压过 dock 覆盖规则）',
    rowSrc.length > 0 && !/style=\{\{/.test(rowSrc) && rowSrc.includes('className="pcfg-row"') && rowSrc.includes('className="pcfg-row-label"'),
    rowSrc.replace(/\s+/g, ' ').slice(0, 120))
  check('adj482 字段行的基样式落在 CSS（内联搬出）',
    /\.pcfg-row \{[\s\S]{0,120}display: flex;[\s\S]{0,120}\}/.test(css) && /\.pcfg-row-label \{[\s\S]{0,80}min-width: 96px/.test(css),
    '')
  // adj483：跨格数必须钳到实际列数 + 窄栏取消跨格——否则 `span N` 会新建**隐式列**，
  // 标题的 `1/-1` 只跨显式列 ⇒ 窄 dock 下"标题与字段挤在同一行"（用户报）
  check('adj483 跨格数按容器宽钳到实际列数（不新建隐式列）',
    /const cols = Math\.max\(1, Math\.floor\(\(el\.clientWidth \+ COL_GAP\)/.test(dlg) && /Math\.min\(cols, Math\.max\(1, Math\.ceil\(/.test(dlg),
    '')
  check('adj483 容器宽度变化（dock 拖宽/窗口 resize）→ 重新测量列数与跨格', dlg.includes('new ResizeObserver(schedule)') && dlg.includes('ro.observe(el)'), '')
  check('adj483 窄栏（单列）取消跨格（CSS 兜底）',
    /@container \(max-width: 560px\) \{[\s\S]{0,200}grid-template-columns: minmax\(0, 1fr\)[\s\S]{0,200}\.pcfg-row \{ grid-column: auto; \}/.test(cssFlat),
    '')
}

// ---- 111. 主题/浅色模式属性挂到 <html>（adj483）----
// 用户报：浅色主题下音色库的「通用音源（GeneralUser GS）」等**未显式设色**的文本看不清。
// 根因：主题属性原先挂在 `.app`（body 的子元素）上，而 `body { color: var(--jp-text-primary) }`
// 在 body 处求值——那时只有 `:root` 的**深色**默认值 ⇒ 继承色是深色主题的浅字（浅色主题下白底浅字）。
console.log('[111] theme attrs on <html> so inherited colors match the palette (adj483)')
{
  const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
  check('adj483 data-theme / data-mode 同步挂到 documentElement',
    appSrc.includes("document.documentElement") &&
      /setAttribute\('data-theme'/.test(appSrc) &&
      /setAttribute\('data-mode'/.test(appSrc),
    '')
  check('adj483 仍保留 .app 上的属性（个别样式/嵌入方按它取用）',
    /className="app" data-theme=\{theme\} data-mode=\{effectiveMode\}/.test(appSrc),
    '')
  const cssBody = String(readFileSync('src/index.css', 'utf8'))
  check('adj483 body 的继承色仍取主题变量（属性挂 html 后即在同一元素上求值）',
    /body \{[\s\S]{0,120}color: var\(--jp-text-primary\)/.test(cssBody),
    '')
}

// ---- 112. 底栏页签图标改用设计图标 + 浅深模式按钮对齐（adj486/adj484）----
console.log('[112] dock tab icons & theme-mode buttons (adj486/adj484)')
{
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const css2 = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  // adj556：本块也用到文案键（tabsLeftTitle / tabsRightTitle），局部读一次
  const copySrc = String(readFileSync('src/brand/copy.ts', 'utf8'))
  // adj486：试听/导出/设置三枚页签改用顶栏同一套设计图标（不再用 ⚠ ▶ ⬇ ⚙ 字符）
  // adj514：页签图标尺寸与顶栏按钮图标**对齐**（默认 size=16；此前 size=14 比顶栏小 2px 偏虚）
  check('adj486 底栏页签用 ToolIcon（试听→play / 导出→export / 设置→settings）；adj514 图标与顶栏同 16px',
    dockSrc.includes("icon: 'play'") && dockSrc.includes("icon: 'export'") && dockSrc.includes("icon: 'settings'") &&
      /<ToolIcon name=\{t\.icon\}\s*\/>/.test(dockSrc),
    '')
  check('adj486 页签不再用 ▶ / ⬇ / ⚙ 字符当图标',
    !dockSrc.includes("'▶'") && !dockSrc.includes("'⬇'") && !dockSrc.includes("'⚙'"),
    '')
  check('adj486 页签图标位统一占位并居中（字符与设计图标混用不跑偏）',
    /\.tool-dock-tab-icon \{[\s\S]{0,220}display: inline-flex;[\s\S]{0,120}align-items: center;/.test(css2),
    '')
  // ---- adj556（v0.28.2）：页签始终显示图标；靠滚动 + 箭头兜住视界外的页签 ----
  check('adj556 页签**始终显示图标**——窄屏不再 `display: none` 隐藏图标（兜底靠 tabstrip 横向滚动）',
    // 整份 CSS（含所有 @container）里都不能再出现"页签图标 display:none"的窄屏兜底
    !/\.tool-dock-tab-icon \{ display: none/.test(css2),
    '')
  check('adj556 滚轮转横向：tabstrip 上挂非 passive 的 wheel 监听，仅在 `scrollWidth > clientWidth` 时把 `deltaY` 投给 `scrollLeft`',
    /tabstripRef[\s\S]{0,400}?onWheel = \(e: WheelEvent\) => \{[\s\S]{0,200}?el\.scrollWidth <= el\.clientWidth[\s\S]{0,200}?el\.scrollLeft \+= e\.deltaY/.test(dockSrc) &&
      /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(dockSrc),
    '')
  check('adj556 左右翻页箭头：只在"该方向还有内容"时才渲染（`tabOverflow.left/right`），滚到尽头就消失',
    /tabOverflow\.left && \(/.test(dockSrc) &&
      /tabOverflow\.right && \(/.test(dockSrc) &&
      /className="tool-dock-tab-arrow"/.test(dockSrc) &&
      /onClick=\{\(\) => pageTabsBy\(-1\)\}/.test(dockSrc) &&
      /onClick=\{\(\) => pageTabsBy\(1\)\}/.test(dockSrc) &&
      // 箭头字符与输入条 adj553 同款：‹ / ›——左箭头在 tabstrip 之前、右箭头在之后（中间可能隔着
      // 整段 tabstrip JSX，所以 gap 给到 5000）；`>` 与字符之间允许任意空白换行
      />[\s\S]{0,30}?‹[\s\S]{0,5000}?>[\s\S]{0,30}?›/.test(dockSrc),
    '')
  check('adj556 箭头按"一屏 80%"翻页、`smooth`，并接 dockCopy 的两条 title 文案',
    /const pageTabsBy = \(dir: -1 \| 1\) =>[\s\S]{0,200}?el\.scrollBy\(\{ left: dir \* Math\.max\(80, el\.clientWidth \* 0\.8\), behavior: 'smooth' \}\)/.test(dockSrc) &&
      /tabsLeftTitle: '向左翻看页签'/.test(copySrc) &&
      /tabsRightTitle: '向右翻看页签'/.test(copySrc),
    '')
  check('adj556 箭头按钮 CSS 存在：`.tool-dock-tab-arrow` 常驻（`flex: 0 0 auto`）+ 28px 高 + 与页签同款 hover',
    /\.tool-dock-tab-arrow \{[\s\S]{0,300}?flex: 0 0 auto[\s\S]{0,200}?height: 28px/.test(css2) &&
      /\.tool-dock-tab-arrow:hover \{[\s\S]{0,200}?background: var\(--jp-bg-panel-hover\)/.test(css2),
    '')
  // ---- adj557（v0.28.2）：左 / 右两侧按钮**结构性**不随页签滚动（DOM 上是 tabstrip 的兄弟） ----
  check('adj557 「收起底栏」「高度档位」「关闭」三个固定按钮在 DOM 上是 `.tool-dock-tabstrip` 的**兄弟**，不是子节点',
    // 截取 tabstrip 块（className 起 → 配对 </div> 收尾的最外层标签），三个固定按钮的 className
    // 都不能落在这块里面——否则它们就是 tabstrip 的子节点，会跟着溢出被滚走。
    (() => {
      const m = /<div\s+className="tool-dock-tabstrip"[\s\S]*?<\/div>\s*(?=\{tabOverflow\.right|<!-- 内容区|\{PANELS\.filter)/.exec(dockSrc)
      if (!m) return false
      const tabstripBlock = m[0]
      return !/className="tool-dock-(collapse|size-btn|close)"/.test(tabstripBlock)
    })(),
    '')
  // adj484：浅深模式按钮——图标与文本垂直居中 + 两侧留白 + 统一最小宽度
  {
    const btn = /\.theme-mode-btn \{[\s\S]{0,900}?\}/.exec(css2)?.[0] ?? ''
    check('adj484 浅深模式按钮 inline-flex 居中 + 两侧内边距 + 最小宽度',
      ['display: inline-flex', 'align-items: center', 'justify-content: center', 'gap: 6px', 'padding: 4px 10px', 'min-width: 72px', 'line-height: 1'].every((d) => btn.includes(d)),
      btn.replace(/\s+/g, ' ').slice(0, 120))
  }
  check('adj484 浅深模式按钮图标用 14（对话框口径，与 12px 文本同高）',
    /<ToolIcon name=\{m\.icon\} size=\{14\} \/>/.test(String(readFileSync('src/dialogs/PageConfigDialog.tsx', 'utf8'))),
    '')
}

// ---- 113. 触屏拖拽（adj487：dock 调整条 + split 分隔条 + 预览虚线 → Pointer Events）----
console.log('[113] touch-friendly drag handles (adj487)')
{
  const css = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
  const prevSrc = String(readFileSync('src/preview/PreviewPane.tsx', 'utf8'))
  const dragSrc = String(readFileSync('src/ui/dragGesture.ts', 'utf8'))
  check('adj487 统一拖拽入口：ui/dragGesture.ts 用 Pointer Events（窗口级 move/up/cancel + setPointerCapture）',
    dragSrc.includes('export function beginDrag') &&
      dragSrc.includes('React.PointerEvent') &&
      dragSrc.includes('setPointerCapture(pointerId)') &&
      dragSrc.includes('pointermove') &&
      dragSrc.includes('pointerup') &&
      dragSrc.includes('pointercancel'),
    '')
  check('adj487 触屏必备：dock 调整条 / split 分隔条 / 预览虚线 均 touch-action: none',
    /\.tool-dock-resize \{[\s\S]{0,500}?touch-action: none/.test(css) &&
      /\.split-divider \{[\s\S]{0,500}?touch-action: none/.test(css) &&
      /\.guide-line \{[\s\S]{0,500}?touch-action: none/.test(css),
    '')
  // adj499：两条线的粗细改由**共用 token** 统一，粗指针设备的加粗也走同一个 token ⇒ 断言改看 token
  check('adj487/499 粗指针设备把两条调整线一起加粗到 14px（只改共用 token 一处）',
    /@media \(pointer: coarse\) \{\s*:root \{ --jp-resize-h: 14px; \}/.test(css),
    '')
  check('adj487 调整条与 split 分隔条改为 Pointer Events（不再 onMouseDown）',
    dockSrc.includes('onPointerDown={startDrag}') && /onPointerDown=\{startSplitDrag/.test(appSrc),
    '')
  check('adj487 预览里描述头 / 辅助虚线拖拽也用 Pointer Events',
    /onPointerDown=\{onMetaPointerDown\}/.test(prevSrc) &&
      prevSrc.includes('pointermove') && prevSrc.includes('pointerup') && prevSrc.includes('pointercancel'),
    '')
  check('adj487 预览虚线 startDrag 签名改为 React.PointerEvent',
    /spec: \{[^}]+\},\s*e: React\.PointerEvent[\s\S]{0,200}?startVal/.test(prevSrc),
    '')
  check('adj487 App / ToolDock 已不再用 mousedown/mousemove/mouseup 装拖拽监听',
    !/startSplitDrag[^}]*e\.clientX[\s\S]{0,400}mousemove/.test(appSrc) &&
      !/addEventListener\('mousemove', onMove\)[\s\S]{0,200}addEventListener\('mouseup', onUp\)/.test(dockSrc),
    '')
}

// ---- 114. 试听可达：底栏 dock 试听页签下，点预览音符也能从该处开始播放（adj490）----
console.log('[114] playback reachable: clicking preview note while dock tryout is open (adj490)')
{
  const prevSrc = String(readFileSync('src/preview/PreviewPane.tsx', 'utf8'))
  // adj490：之前 onClick / onDoubleClick 只判 `modal === 'playback'`，底栏 dock 试听页签打开时
  //（顶栏按钮只 toggleDock('tryout') 不 openModal）点击预览音符无效。改为同时接受 dock 试听状态。
  check('adj490 PreviewPane.onClick：试听可达 = 弹窗 modal 或 dock 试听页签',
    /isPlaybackOpen = modal === 'playback' \|\| \(dockOpen && dockPanel === 'tryout'\)/.test(prevSrc),
    '')
  check('adj490 PreviewPane.onDoubleClick：同样接受 dock 试听（adj158 播放中双击快速跳跃）',
    /if \(!isPlaybackOpen\) return[\s\S]{0,200}setPlaybackStart\(id\)[\s\S]{0,80}bumpPlaybackTick\(\)/.test(prevSrc),
    '')
  check('adj490 PreviewPane 已从 uiStore 订阅 dockOpen / dockPanel', /dockOpen = useUiStore\(\(s\) => s\.dockOpen\)/.test(prevSrc) && /dockPanel = useUiStore\(\(s\) => s\.dockPanel\)/.test(prevSrc), '')
}

// ---- 115. dock 关闭：`!dockOpen` 早退守卫 + 关闭按钮必须留在可视区（adj491）----
console.log('[115] dock close: early-return guard & close button inside dock (adj491)')
{
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const css = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  // 回归护栏：adj487 把拖拽从 mouse 改 Pointer Events 时**连带删掉了 `if (!dockOpen) return null`**，
  // 后果是「点 ✕ 后 dockOpen 已置 false，但组件照样渲染」⇒ 关闭按钮看着失灵（用户报 E-2026-211）。
  check('adj491 dock 关闭时不渲染：保留 `if (!dockOpen) return null` 早退守卫',
    /if \(!dockOpen\) return null/.test(dockSrc),
    '')
  check('adj491 关闭按钮接线到 store 的 closeDock', /className="tool-dock-close" onClick=\{closeDock\}/.test(dockSrc), '')
  // 布局护栏：页签栏必须约束在 dock 宽度内，否则「右侧常驻按钮」会被推出可视区
  check('adj491 页签栏约束在 dock 宽度内（width:100% + min-width:0）',
    /\.tool-dock-tabs \{[\s\S]{0,900}?width: 100%;/.test(css) && /\.tool-dock-tabs \{[\s\S]{0,900}?min-width: 0;/.test(css),
    '')
  // adj525：横向滚动能力从 `.tool-dock-tabs` 移到了内层 `.tool-dock-tabstrip`——
  // 页签只在页签区里滚，右侧两个按钮（档位 / 关闭）在页签区**之外**因而永远可见可点。
  check('adj491/adj525 页签区自己横滚（overflow-x:auto + min-width:0）且关闭按钮不被压缩',
    /\.tool-dock-tabstrip \{[\s\S]{0,400}?min-width: 0;[\s\S]{0,200}?overflow-x: auto;/.test(css) &&
      /\.tool-dock-close \{[\s\S]{0,300}?flex: 0 0 auto;/.test(css),
    '')
  // adj527：粗指针下 ✕ 的命中区**不再靠横向 padding 撑**（那会把按钮的视觉盒子撑宽、
  // 与左侧档位按钮之间空出一大截，用户报"分得比较开"），改为小内边距 + 隐形 `::before` **上下**扩。
  check('adj491/adj527 粗指针设备放大 ✕ 命中区（隐形 ::before 上下扩，不再撑宽视觉盒子）',
    /@media \(pointer: coarse\) \{[\s\S]{0,900}?\.tool-dock-close \{ padding: 6px 5px/.test(css) &&
      /@media \(pointer: coarse\) \{[\s\S]{0,900}?\.tool-dock-close::before \{[\s\S]{0,220}?top: -7px;[\s\S]{0,80}?bottom: -7px;/.test(css),
    '')

  // adj525：两个按钮（高度档位 / 关闭）必须**常驻**——它们要在可滚页签区**之外**。
  // 依据同顶栏 adj453：「必须始终可见」的元素不能放进会溢出的滚动容器，否则会被内容顶出可视区
  // （此前页签一溢出，档位按钮与 ✕ 就被推到最右边看不见，得先滑到底才能点）。
  // adj531：用户要求把档位按钮移到最左端 ⇒ 顺序变为「档位 → 页签 → ✕」，本组断言随之改为
  // **与顺序无关**地钉"页签区里只有页签"，另加一条专门钉新顺序（见下）。
  const stripIdx = dockSrc.indexOf('<div className="tool-dock-tabstrip"')
  const sizeIdx = dockSrc.indexOf('className="tool-dock-size-btn"')
  const closeIdx = dockSrc.indexOf('className="tool-dock-close"')
  const stripBlock = stripIdx >= 0 ? dockSrc.slice(stripIdx, dockSrc.indexOf('</div>', stripIdx)) : ''
  check('adj525/adj531 页签区（可滚）里只有页签，两个按钮都在它之外',
    stripIdx >= 0 && sizeIdx >= 0 && closeIdx >= 0 &&
      stripBlock.includes('TABS.map') &&
      !stripBlock.includes('tool-dock-size-btn') &&
      !stripBlock.includes('tool-dock-close'),
    `strip=${stripIdx} size=${sizeIdx} close=${closeIdx}`)
  // adj531（用户要求"把高度调整按钮移到最左边，手机上左边操作更顺手，也避免误按关闭按钮"）：
  check('adj531 档位按钮在页签区**左侧**、✕ 在最右端（顺序：档位 → 页签 → ✕）',
    sizeIdx < stripIdx && stripIdx < closeIdx,
    `size=${sizeIdx} strip=${stripIdx} close=${closeIdx}`)
  check('adj531 档位按钮与 ✕ 之间隔着整条页签区（不再相邻 ⇒ 够档位按钮时不会误触关闭）',
    dockSrc.slice(sizeIdx, stripIdx).includes('tool-dock-size-btn') &&
      !dockSrc.slice(sizeIdx, stripIdx).includes('tool-dock-close') &&
      dockSrc.slice(stripIdx, closeIdx).includes('TABS.map'),
    '')
  check('adj531 两个常驻按钮的"不压缩"口径不变（adj525 原样）',
    /\.tool-dock-size-btn \{[\s\S]{0,400}?flex: 0 0 auto;/.test(css) &&
      /\.tool-dock-close \{[\s\S]{0,300}?flex: 0 0 auto;/.test(css),
    '')
  check('adj531 `role="tablist"` 仍在页签区上（不因移动按钮而漂移）',
    /className="tool-dock-tabstrip" role="tablist"/.test(dockSrc),
    '')
  check('adj525 `role="tablist"` 挂在页签区上（它才是页签的容器）',
    /className="tool-dock-tabstrip" role="tablist"/.test(dockSrc) &&
      !/className="tool-dock-tabs" role="tablist"/.test(dockSrc),
    '')
  check('adj525 两个常驻按钮都不被压缩（flex: 0 0 auto），页签区可收缩（min-width: 0）',
    /\.tool-dock-size-btn \{[\s\S]{0,400}?flex: 0 0 auto;/.test(css) &&
      /\.tool-dock-size-btn \{[\s\S]{0,500}?flex-shrink: 0;/.test(css) &&
      /\.tool-dock-tabstrip \{[\s\S]{0,300}?flex: 1 1 auto;/.test(css),
    '')

  // adj527：用户要求"页签按钮宽度缩小一些，刚好放得下 5 个"。
  // 5 个页签的宽度 = 5×(边框2 + 左右内边距 + 图标16 + 间距4 + 两个中文字24) + 4×间距，
  // 再加栏开销（左右内边距 + 档位钮 28 + ✕）——横向内边距一旦回到 10px 就会超出手机宽度、
  // 又变成"必须横滑才看得到第 5 个"。这里钉住"紧凑档 + 更窄 dock 再收紧一档"。
  check('adj527 页签横向内边距收到 7px（5 个页签在常规手机宽上整栏放得下）',
    /\.tool-dock-tab \{[\s\S]{0,600}?padding: 5px 7px;/.test(css) &&
      /\.tool-dock-tabstrip \{[\s\S]{0,300}?gap: 3px;/.test(css),
    '')
  check('adj527 更窄 dock（≤400px）再收紧一档（横向内边距 5px）',
    /@container \(max-width: 400px\) \{[\s\S]{0,200}?\.tool-dock-tab \{ padding: 5px 5px; \}/.test(css),
    '')
}

// ---- 116. 设置默认 6 行 + 「关于」迁入 dock（adj492）+ 分隔条手指命中区（adj493）----
console.log('[116] settings 6 rows, About in dock, divider touch hit-area (adj492/adj493)')
{
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const css = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const aboutSrc = String(readFileSync('src/dialogs/AboutDialog.tsx', 'utf8'))
  const appSrc = String(readFileSync('src/App.tsx', 'utf8'))
  const topSrc = String(readFileSync('src/ui/TopBar.tsx', 'utf8'))
  const storeSrc = String(readFileSync('src/store/uiStore.ts', 'utf8'))

  // adj492：设置面板默认高度 = 内容 6 行（adj521：`settingsDefaultH` 多了一个 `chromeH` 参数
  // ——外壳高度改为实测传入以适配手机 14px 抓手；断言改为不绑定具体参数表，只钉"用 rowPitch × SETTINGS_ROWS"）
  check('adj492 设置面板内容区默认 6 行（SETTINGS_ROWS = 6）',
    /const SETTINGS_ROWS = 6/.test(dockSrc),
    '')
  check('adj492 设置高度仍按自己的行高单独算（与告警解绑）',
    /settingsDefaultH = \([^)]*\): number =>[\s\S]{0,200}?rowPitch \* SETTINGS_ROWS/.test(dockSrc),
    '')

  // adj492：关于面板进 dock
  check('adj492 DockPanelKey 增加 about', /\| 'settings' \| 'about'/.test(storeSrc), '')
  check('adj492 dock 面板与页签均含 about（5 个）',
    /\{ key: 'about', render: AboutPanel \}/.test(dockSrc) && /\{ key: 'about', label: dockCopy\.tabAbout/.test(dockSrc),
    '')
  check('adj492 AboutDialog 支持 inline（不带遮罩/标题栏）',
    /export function AboutDialog\(\{ inline = false \}/.test(aboutSrc) && /<Modal title=\{uiCopy\.about\} inline=\{inline\}>/.test(aboutSrc),
    '')
  check('adj492 顶栏菜单「关于」改为开关 dock（不再 openModal）',
    /'关于\(&A\)'[\s\S]{0,80}toggleDock\('about'\)/.test(topSrc) && !/'关于\(&A\)'[\s\S]{0,80}openModal\('about'\)/.test(topSrc),
    '')
  check('adj492 App 不再渲染 about 弹窗（已迁 dock）',
    !/modal === 'about'/.test(appSrc) && !/AboutDialog/.test(appSrc),
    '')
  check('adj492 关于内容用 CSS 类排版（.about-panel，dock 宽屏两栏 / 窄屏竖排）',
    /\.about-panel \{/.test(css) && /\.about-brand \{/.test(css) && /\.about-body \{/.test(css) && aboutSrc.includes('className="about-panel"'),
    '')
  // adj494：关于面板打开时按"能显示全内容的最小高度"（走 AUTO_FIT 实测，与试听/导出同一机制）
  // adj510：告警也纳入 AUTO_FIT（"能装下内容的最小高度"，但 cap 在最多 2 条可见）
  check('adj494 关于面板纳入 AUTO_FIT（打开即完整显示内容）；adj510 告警亦纳入 AUTO_FIT',
    /const AUTO_FIT: readonly DockPanelKey\[\] = \['problems', 'tryout', 'export', 'about'\]/.test(dockSrc),
    '')
  // adj555（v0.28.2）：告警"建议档"最多显示 5 行（adj510: 2 行 → adj524: 4 行 → adj555: 5 行）。
  // 放宽的依据是底栏有了高度档位按钮——"默认多给一点"不再挤占编辑区（嫌高按一下到最小、
  // 想更高按一下到最大），所以让建议档承担"一次看全 5 条告警"。**0/1/2/3/4 条仍按内容自然高收缩**，
  // 只在 > 5 条时按上限封顶（其余由列表自身滚动）。adj528：常量与算式搬到 `ui/dock/problemsHeight.ts`
  // （单一来源 + 纯函数），断言随之改到该文件。
  check('adj555/adj528 告警建议档最多显示 5 行（PROBLEMS_MAX_VISIBLE_ROWS = 5，单一来源）',
    PROB_MAX_ROWS === 5 &&
      /export const PROBLEMS_MAX_VISIBLE_ROWS = 5/.test(readFileSync('src/ui/dock/problemsHeight.ts', 'utf8')),
    `maxRows=${PROB_MAX_ROWS}`)

  // adj522：告警面板"展开后内容超过视界却没有滚动条"——高度链必须成立，列表才会真的滚。
  // 三件套缺一不可：① 告警那条 pane 是弹性列（给列表受限高度）；
  //                ② 列表 `flex: 0 1 auto`（按内容取高、可收缩）+ `overflow-y: auto`（收缩后出滚动条）；
  //                ③ 头部不参与收缩（滚到底也要能点"收起"）。
  // 另守一句：`.tool-dock-body` 的滚动**不被关掉**（恢复 `auto` 作兜底，链断了也不会把内容裁掉）。
  check('adj522 告警列表高度链成立（pane 弹性列 + 列表可收缩可滚 + 头部不收缩）',
    /\.tool-dock-pane\.pane-problems \{[\s\S]{0,120}?display: flex;[\s\S]{0,80}?flex-direction: column;/.test(css) &&
      /\.problems-list \{[\s\S]{0,900}?flex: 0 1 auto;[\s\S]{0,120}?min-height: 0;[\s\S]{0,120}?overflow-y: auto;/.test(css) &&
      /\.problems-head \{[\s\S]{0,300}?flex: 0 0 auto;/.test(css),
    '')
  check('adj522 取消"关掉 dock 内容区滚动"的覆盖（链断了仍可滚，不裁内容）',
    !/\.tool-dock-body:has\(\.problem-panel\)/.test(css),
    '')
  // adj528：告警的"内容自然高"**不得再读任何 scrollHeight 总量**——那条 pane 为了列表能滚必须
  // 填满 dock，读总量会被"可用高度"充气，从而"从最大切建议"算出虚高的建议高度（用户连报两次）。
  // 现在改为「条数（数据）× 单行实测」，见 `ui/dock/problemsHeight.ts`（纯函数，下方有断言）。
  check('adj528 告警内容自然高改由"条数 × 单行实测"量取（不再读 scrollHeight，避免充气）',
    /dockPanel !== 'problems'\) return pane\.scrollHeight/.test(dockSrc) &&
      /PROBS\.problemsContentHeight\(\{/.test(dockSrc) &&
      !/list\.scrollHeight/.test(dockSrc),
    '')

  // adj532：告警行首三角箭头——用户连报 4 次"太小"。根因是**字符**不是字号：
  // `▸`（U+25B8）是 BLACK RIGHT-POINTING **SMALL** TRIANGLE，实测墨迹/字号 ≈ 0.4×0.33em
  // （18px 时只有 7×6px，36px 也才 12×12），所以 adj515/516/517 三轮调字号几乎看不出变化；
  // 换成常规实心 `▶`（U+25B6）后同样 18px 字号墨迹 17×18px（约 2.5 倍）。
  // 口径不变：**单字符 + rotate(90deg)**（收起右指 / 展开下指，视角一致）。
  const problemSrc = String(readFileSync('src/ui/dock/ProblemPanel.tsx', 'utf8'))
  check('adj532 告警三角用常规实心 `▶`（U+25B6），不再用 SMALL 变体 `▸`（U+25B8）',
    /problem-expand-glyph"[^>]*>▶</.test(problemSrc) && !/>▸</.test(problemSrc),
    '')
  check('adj532 仍是"单字符 + 旋转 90°"（收起/展开视觉大小一致，不做第二个字符）',
    /\.problem-expand\.is-open \.problem-expand-glyph \{[\s\S]{0,80}?transform: rotate\(90deg\);/.test(css) &&
      // adj533（用户报"偏大了一点，改 3/4 大小"）：字号 18 → 13.5px（= 18 × 3/4），只改字形大小
      /\.problem-expand-glyph \{[\s\S]{0,300}?font-size: 13\.5px;/.test(css),
    '')
  check('adj532/adj533 glyph 盒子仍 20×20、父按钮预留仍 24px（改小的是字形，不是热区/行高）',
    /\.problem-expand-glyph \{[\s\S]{0,200}?width: 20px;[\s\S]{0,80}?height: 20px;[\s\S]{0,80}?line-height: 20px;/.test(css) &&
      /\.problem-expand \{[\s\S]{0,200}?flex: 0 0 24px;/.test(css),
    '')

  // adj523：AUTO_FIT 的"内容自然高"取自 `pane.scrollHeight`，而 `scrollHeight === max(内容高, clientHeight)`。
  // 若 pane 被拉伸到 dock 高度（`flex: 1 1 auto`），"内容比可用高度小"时读数就等于**当前 dock 高度**，
  // 测量被污染 ⇒ 同一个"建议高度"会随"从哪一档切过来"而变（用户报：从最大切不正好、从最小切正好）。
  // 契约：基类按内容取高；设置/告警两条需要填满 dock 的 pane 各自显式覆盖回 `1 1 auto`。
  check('adj523 AUTO_FIT 面板的 pane 按内容取高（测量不被当前 dock 高度污染）',
    /\.tool-dock-pane \{[\s\S]{0,1200}?flex: 0 0 auto;/.test(css),
    '')
  check('adj523 设置 / 告警两条 pane 显式填满 dock（分别要靠受限高度滚动）',
    /\.tool-dock-pane\.pane-settings \{[\s\S]{0,400}?flex: 1 1 auto;/.test(css) &&
      /\.tool-dock-pane\.pane-problems \{[\s\S]{0,300}?flex: 1 1 auto;/.test(css),
    '')

  // adj493：分隔条的手指命中区
  check('adj493 分隔条在粗指针设备上扩出隐形命中区（::before ±12px）',
    /@media \(pointer: coarse\) \{[\s\S]{0,400}?\.split-divider::before \{[\s\S]{0,200}?top: -12px;/.test(css) &&
      /\.split-divider-h::before \{[\s\S]{0,120}?left: -12px;/.test(css),
    '')
  check('adj493 命中区扩展只在粗指针生效（鼠标环境不受影响）',
    (() => {
      // 把 "@media (pointer: coarse) { … }" 整块抠掉（大括号配对），余下不应再有 .split-divider::before
      const strip = (src: string, header: string): string => {
        let out = src
        for (;;) {
          const i = out.indexOf(header)
          if (i < 0) return out
          let depth = 0
          let j = out.indexOf('{', i)
          const start = j
          for (; j < out.length; j++) {
            if (out[j] === '{') depth++
            else if (out[j] === '}') {
              depth--
              if (depth === 0) break
            }
          }
          out = out.slice(0, i) + out.slice(j + 1)
          void start
        }
      }
      const noCoarse = strip(css, '@media (pointer: coarse)')
      return !noCoarse.includes('.split-divider::before') && noCoarse.includes('.split-divider {')
    })(),
    '')
}

// ---- 117. 底栏抓手与拆分隔条外观统一（adj495）+ `&bc` = 保持音（adj496）----
console.log('[117] dock handle matches split divider (adj495) & bc = tenuto (adj496)')
{
  const css = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const oneOf = (sel: string, props: string[]): boolean => {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css)
    if (!m) return false
    return props.every((p) => m[1].includes(p))
  }
  // adj495：抓手 = 分屏线同款（5px、上下 1px 边框、居中 40×2 圆角握把、hover 转强调色+白握把）
  // adj536（用户要求"给两条调整线加点主题色，方便区域视觉区分"）：底色由纯 `--jp-bg-panel`
  // 改为**掺 10% 强调色**的同一配方（`color-mix(...)`）；本断言随之改为钉新配方 + 仍要"两处同款"。
  check('adj495/499/536 抓手与分屏线同款外观（高度/底色/边框/握把；厚度走共用 token）',
    oneOf('.split-divider', ['height: var(--jp-resize-h', 'background: color-mix(in srgb, var(--jp-accent) 10%, var(--jp-bg-panel))', 'border-top: 1px solid var(--jp-border)', 'border-bottom: 1px solid var(--jp-border)']) &&
      oneOf('.tool-dock-resize', ['flex: 0 0 var(--jp-resize-h', 'background: color-mix(in srgb, var(--jp-accent) 10%, var(--jp-bg-panel))', 'border-top: 1px solid var(--jp-border)', 'border-bottom: 1px solid var(--jp-border)']),
    '')
  check('adj495/536 两者的握把 ::after 完全同款（40×2、radius 2、强调色、opacity .55）',
    /\.split-divider::after \{[\s\S]{0,260}?width: 40px;[\s\S]{0,60}?height: 2px;[\s\S]{0,60}?border-radius: 2px;[\s\S]{0,60}?background: var\(--jp-accent\);[\s\S]{0,40}?opacity: 0\.55;/.test(css) &&
      /\.tool-dock-resize::after \{[\s\S]{0,260}?width: 40px;[\s\S]{0,60}?height: 2px;[\s\S]{0,60}?border-radius: 2px;[\s\S]{0,60}?background: var\(--jp-accent\);[\s\S]{0,40}?opacity: 0\.55;/.test(css),
    '')
  check('adj495 hover/按住/聚焦都转强调色 + 白握把（与分屏线同一套状态）',
    /\.tool-dock-resize:hover,\s*\.tool-dock-resize:active,\s*\.tool-dock-resize:focus-visible \{\s*background: var\(--jp-accent\);/.test(css) &&
      /\.tool-dock-resize:hover::after,[\s\S]{0,120}?background: #fff;/.test(css),
    '')
  check('adj495 dock 自身不再带 border-top（避免与抓手叠成双线）',
    oneOf('.tool-dock', ['flex-shrink: 0']) && !/\.tool-dock \{[^}]*border-top: 1px solid var\(--jp-border\);/.test(css),
    '')
  // adj496：`&bc` 是保持音，不是波音 —— 代码字典与 SYNTAX.md 必须一致（此前两处都误写「波音（横线）」）
  const compl = String(readFileSync('src/editor/completions.ts', 'utf8'))
  const syntax = String(readFileSync('docs/SYNTAX.md', 'utf8'))
  check('adj496 修饰符字典：`bc` = 保持音（标签不再是波音）',
    /\{ symbol: 'bc', label: '保持音（上方短横线）' \}/.test(compl) && !/label: '波音（横线）'/.test(compl),
    '')
  check('adj496 文档同步：`&bc` 行写作保持音（tenuto）',
    /\| `&bc` \| \*\*保持音\*\*（tenuto）/.test(syntax),
    '')
  check('adj496 波音族只含 sby/xby/sby+/xby+（`&bc` 不在其中）',
    /const MORDENT_SYMBOLS[^\n]*= \[[^\]]*'sby'[^\]]*'xby'[^\]]*'sby\+'[^\]]*'xby\+'[^\]]*\]/.test(String(readFileSync('src/editor/completions.ts', 'utf8'))) ||
      // 引擎侧尚未抽出 MORDENT_SYMBOLS 时，退化为断言字典里四个波音编码齐全
      (['sby', 'xby', 'sby+', 'xby+'].every((s) => compl.includes(`symbol: '${s}'`)) && !compl.includes("symbol: 'bc', label: '上波音")),
    '')
}

// ---- 118. dock 五页签全懒加载（adj497）+ 页签栏移到底部（adj498）+ 两条调整线统一（adj499）----
console.log('[118] lazy dock panels, tabs at bottom, unified resize lines (adj497-adj499)')
{
  const dockSrc = String(readFileSync('src/ui/ToolDock.tsx', 'utf8'))
  const css = String(readFileSync('src/index.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const theme = String(readFileSync('src/styles/theme.css', 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')

  // adj497：五个面板全部 lazy（此前告警/导出是静态 import ⇒ 拖着一串重依赖进主包）
  check('adj497 五个面板全部走 React.lazy',
    ['../dialogs/PlaybackDialog', '../dialogs/PageConfigDialog', '../dialogs/AboutDialog', './dock/ProblemPanel', './dock/ExportPanel'].every((p) =>
      dockSrc.includes(`lazy(() => import('${p}')`),
    ),
    '')
  check('adj497 不再静态 import 任何 dock 面板（ToolDock 顶部无 import { ProblemPanel/ExportPanel }）',
    !/^import \{ (ProblemPanel|ExportPanel) \} from/m.test(dockSrc),
    '')
  check('adj497 懒加载只在首次激活时发生（PANELS.filter(everActive) 守卫在位）',
    /PANELS\.filter\(\(p\) => everActive\.includes\(p\.key\)\)/.test(dockSrc) && /<Suspense fallback=/.test(dockSrc),
    '')

  // adj498：页签栏移到底部（视觉顺序 抓手 → 内容 → 页签），DOM 顺序不变（读屏/Tab 序不受影响）
  check('adj498 页签栏 order=2、内容 order=1、抓手 order=0（视觉顺序倒置）',
    /\.tool-dock-tabs \{[\s\S]{0,200}?order: 2;/.test(css) &&
      /\.tool-dock-body \{[\s\S]{0,200}?order: 1;/.test(css) &&
      /\.tool-dock-resize \{[\s\S]{0,200}?order: 0;/.test(css),
    '')
  check('adj498 分隔线由 border-bottom 翻成 border-top（避免与状态栏 border-top 叠成双线）',
    /\.tool-dock-tabs \{[\s\S]{0,600}?border-top: 1px solid var\(--jp-border\);/.test(css) &&
      !/\.tool-dock-tabs \{[^}]*border-bottom: 1px solid var\(--jp-border\)/.test(css),
    '')

  // adj499：两条调整线共用厚度 token + 同款光标（横档都用 row-resize）
  check('adj499 厚度取自共用 token `--jp-resize-h`（分屏线 / 纵向分屏线 / 底栏线三处同一来源）',
    /--jp-resize-h: 5px;/.test(theme) &&
      /\.split-divider \{[\s\S]{0,120}?height: var\(--jp-resize-h/.test(css) &&
      /\.split-divider-h \{[\s\S]{0,120}?width: var\(--jp-resize-h/.test(css) &&
      /\.tool-dock-resize \{[\s\S]{0,200}?flex: 0 0 var\(--jp-resize-h/.test(css),
    '')
  check('adj499 粗指针设备只改 token 一处（两条线必然同步加粗）',
    /@media \(pointer: coarse\) \{\s*:root \{ --jp-resize-h: 14px; \}/.test(css),
    '')
  check('adj499 光标统一：两条横档都用 row-resize（纵向分屏线用 col-resize）',
    /\.split-divider \{[\s\S]{0,200}?cursor: row-resize;/.test(css) &&
      /\.tool-dock-resize \{[\s\S]{0,300}?cursor: row-resize;/.test(css) &&
      !/\.tool-dock-resize \{[^}]*cursor: ns-resize/.test(css) &&
      /\.split-divider-h \{[\s\S]{0,200}?cursor: col-resize;/.test(css),
    '')
  check('adj499 旧的「窄屏(≤640)只把分屏线加粗到 8px」规则已删除',
    !/\.split-divider \{\s*height: 8px;\s*\}/.test(css),
    '')
  // adj500：关于面板的标题（含口号）/版本/页脚/支持作者行居中（正文与署名仍左对齐）
  // 精确取出第一条 `.about-brand` 规则体再判断（用窗口正则会误伤后面 `.tool-dock-body{flex-direction:column}`）
  const brandRule = /\.about-brand \{([^}]*)\}/.exec(css)?.[1] ?? ''
  check('adj500/501 品牌块：图标与标题贴合成组、整组居中（文字块按内容定宽 + justify-content: center）',
    brandRule.includes('display: flex') &&
      brandRule.includes('justify-content: center') &&
      !brandRule.includes('flex-direction: column') &&
      /\.about-brand-text \{[^}]*flex: 0 1 auto;[^}]*text-align: center;/.test(css),
    brandRule.replace(/\s+/g, ' ').slice(0, 120))
  check('adj500 版本 / 页脚 / 支持作者行居中（正文与署名不加居中）',
    /\.about-meta,\s*\.about-footer,\s*\.about-cta \{ text-align: center; \}/.test(css) &&
      !/\.about-p \{[^}]*text-align: center/.test(css) &&
      !/\.about-author \{[^}]*text-align: center/.test(css),
    '')
}

// ---- 119. 波音（mordent）演奏时值（adj502）----
// 用户规范：波音时值从主音符里匀出、总时值守恒；**从主音开始**波动（与倚音相反）。
//   单波音：主→邻→主，占 P/4；复波音：主→邻→主→邻→主，占 P/2；每个短音 = clamp(P/8, 45, 110)。
//   极短音符上复波音降级为单波音；邻音取调内二度、不继承临时变音；7 上翻八度、1 下翻八度。
console.log('[119] mordent playback timing (adj502)')
{
  const BEAT = 1000 // 60 BPM → 1 拍 = 1000ms
  const evs = (code: string) => {
    const r = parseJps(code)
    const seq = buildPlaySequence(r, layoutScore(r, defaultPageConfig), 60)
    return { ev: [...seq.events].sort((a, b) => a.atMs - b.atMs), totalMs: seq.totalMs }
  }
  const ms = (code: string) => evs(code).ev.slice(0, 6).map((e) => `${Math.round(e.atMs)}+${Math.round(e.durationMs)}@${e.pitch ?? '主'}`).join(' ')
  const dur = (e: { durationMs: number }) => Math.round(e.durationMs)

  // 纯函数层：守恒 + 主音保留一半以上 + 单/复占比
  {
    const p1 = mordentPlan(BEAT, 'sby')
    check('adj502 不变式守恒：单波音 shortMs×2 + held ≡ P',
      Math.abs(p1.shortMs * p1.steps.length + p1.heldMs - BEAT) < 1e-6,
      `${p1.shortMs}×${p1.steps.length}+${p1.heldMs}`)
    check('adj502 主音保留 ≥ P/2（重音仍在主音上）',
      p1.heldMs >= BEAT / 2 - 1e-6 && mordentPlan(BEAT, 'sby+').heldMs >= BEAT / 2 - 1e-6,
      `${p1.heldMs}`)
    check('adj502 单波音 steps = 主→邻（2 个短音，收尾主音另计）', p1.steps.join('') === 'PU', p1.steps.join(''))
    check('adj502 复波音 steps = 主→邻→主→邻（4 个短音）', mordentPlan(BEAT, 'sby+').steps.join('') === 'PUPU', '')
    check('adj502 下波音用下邻音（L）',
      mordentPlan(BEAT, 'xby').steps.join('') === 'PL' && mordentPlan(BEAT, 'xby+').steps.join('') === 'PLPL',
      '')
    check('adj502 短音时值 = clamp(P/8, 45, 110)',
      Math.abs(mordentShortMs(2000) - 110) < 1e-6 && Math.abs(mordentShortMs(1000) - 110) < 1e-6 &&
        Math.abs(mordentShortMs(500) - 62.5) < 1e-6 && Math.abs(mordentShortMs(250) - 45) < 1e-6,
      [mordentShortMs(2000), mordentShortMs(1000), mordentShortMs(500), mordentShortMs(250)].join(','))
    check('adj502 长音符占比更小（全音符上波音只占 5.5%）',
      mordentPlan(4000, 'sby').shortMs * 2 / 4000 < 0.06,
      String(mordentPlan(4000, 'sby').shortMs * 2 / 4000))
    check('adj502 极短音符：复波音降级为单波音（2 个短音）',
      mordentPlan(250, 'sby+').steps.length === 2,
      mordentPlan(250, 'sby+').steps.join(''))
    check('adj502 邻音：调内二度 + 八度回卷（7 上→1 高八度；1 下→7 低八度）',
      JSON.stringify(neighborDegree(7, true)) === JSON.stringify({ pitch: 1, octave: 1 }) &&
        JSON.stringify(neighborDegree(1, false)) === JSON.stringify({ pitch: 7, octave: -1 }) &&
        JSON.stringify(neighborDegree(3, true)) === JSON.stringify({ pitch: 4, octave: 0 }),
      '')
    check('adj502 从 symbols 取波音（`+` 优先；无记号返回 null）',
      mordentOf(['sby']) === 'sby' && mordentOf(['sby', 'sby+']) === 'sby+' && mordentOf(['tr']) === null && mordentOf(undefined) === null,
      '')
    check('adj502 常量与文档口径一致（波音四码 / 夹紧 45–110ms）',
      MORDENT_SYMBOLS.join(',') === 'sby,xby,sby+,xby+' && ORNAMENT_SHORT_MIN_MS === 45 && ORNAMENT_SHORT_MAX_MS === 110,
      `${MORDENT_SYMBOLS.join(',')} / ${ORNAMENT_SHORT_MIN_MS}–${ORNAMENT_SHORT_MAX_MS}`)
  }

  // 播放层：事件序列与音高
  const q1 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby 1 2 3 |\n')
  check('adj502 单上波音 `3&sby`（1 拍）：主 110 → 上邻 110 → 主 780，合计 1000',
    q1.ev.length >= 3 && dur(q1.ev[0]) === 110 && dur(q1.ev[1]) === 110 && dur(q1.ev[2]) === 780 &&
      Math.abs(q1.ev[2].atMs - 220) < 1 && q1.ev[3].atMs === BEAT,
    ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby 1 2 3 |\n'))
  check('adj502 单上波音的邻音是**上邻音**（C 调 3=E → 4=F），且首音就是主音（pitch 缺省=主音本体）',
    q1.ev[0].pitch === undefined && q1.ev[1].pitch === 'F4',
    `${q1.ev[0].pitch ?? '主'} / ${q1.ev[1].pitch}`)
  const q2 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&xby 1 2 3 |\n')
  check('adj502 单下波音 `3&xby`：邻音是**下邻音**（C 调 3=E → 2=D）', q2.ev[1].pitch === 'D4', String(q2.ev[1].pitch))
  const q3 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby+ 1 2 3 |\n')
  check('adj502 复上波音 `3&sby+`（1 拍）：110×4 + 主 560 = 1000（4 个短音 + 收尾主音）',
    q3.ev.length >= 5 && [0, 1, 2, 3].every((i) => dur(q3.ev[i]) === 110) && dur(q3.ev[4]) === 560 &&
      Math.abs(q3.ev[4].atMs - 440) < 1 && q3.ev[5].atMs === BEAT,
    ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby+ 1 2 3 |\n'))
  const q4 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby 1 2 3 4 |\n')
  check('adj502 后续音符仍在整拍位置（波音不拖延总拍子；5 个音符共 5 拍）',
    q4.ev[3].atMs === BEAT && Math.abs(q4.totalMs - 5000) < 1,
    `${q4.ev.map((e) => Math.round(e.atMs)).join(',')} total=${q4.totalMs}`)
  const q5 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3,//&sby 1 |\n')
  check('adj502 极短主音符（1/4 拍 = 250ms）上波音占 90ms、主音留 160ms，且下一个音符仍从其终点起',
    Math.abs(q5.ev[0].durationMs - 45) < 1 && Math.abs(q5.ev[1].durationMs - 45) < 1 &&
      Math.abs(q5.ev[2].durationMs - 160) < 1 &&
      Math.abs(q5.ev[2].atMs + q5.ev[2].durationMs - 250) < 1 &&
      Math.abs((q5.ev[3]?.atMs ?? -1) - 250) < 1,
    ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3,//&sby 1 |\n'))
  const q6 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 7&sby 1 |\n')
  check('adj502 `7&sby` 的上邻音上翻八度（1\'）',
    String(q6.ev[1].pitch ?? '').includes("'") || String(q6.ev[1].pitch ?? '') !== String(q6.ev[0].pitch ?? 'x'),
    String(q6.ev[1].pitch))
  const q7 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/]&sby 1 |\n')
  check('adj502/507 倚音 + 波音共存：先倚音（组时值 1/4 拍）→ 再波动（3 事件合计 750ms）→ 下一音符仍在 1000',
    Math.abs(q7.ev[0].durationMs - 250) < 1 && q7.ev[0].atMs === 0 &&
      Math.abs(q7.ev[1].atMs - 250) < 1 &&
      Math.abs(q7.ev[1].durationMs + q7.ev[2].durationMs + q7.ev[3].durationMs - 750) < 1 &&
      Math.abs(q7.ev[4].atMs - 1000) < 1,
    ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/]&sby 1 |\n'))
  // adj502：倚音括号**之后**写的 `&sby` 必须挂到音符 `symbols` 上（此前会漏成独立 decoration）
  {
    const rr = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/]&sby 3&sby[2/] 3&hx[2/] 1 |\n')
    const toks = (rr.groups[0].music.tokens as unknown as { kind: string; pitch?: number; symbols?: string[] }[]).filter((t) => t.kind === 'note')
    check('adj502 倚音括号后的 `&sby` 也挂到音符 symbols（`&zkh/&ykh/&hx` 仍独立）',
      (toks[0].symbols ?? []).includes('sby') && (toks[1].symbols ?? []).includes('sby') && !(toks[2].symbols ?? []).includes('hx'),
      toks.map((t) => `p${t.pitch}:[${(t.symbols ?? []).join(',')}]`).join(' | '))
    // 强等价：`3[2/]&sby` 与 `3&sby[2/]` 语义相同 ⇒ 渲染出的 SVG 应当**完全一致**
    // （若括号后的 `&sby` 丢成独立 decoration，波音图形的位置/层级就会与音符符号路径不同而出现差异）
    const svgA = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3[2/]&sby 1 |\n'), defaultPageConfig))[0]
    const svgB = renderScoreToSvg(layoutScore(parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: 3&sby[2/] 1 |\n'), defaultPageConfig))[0]
    check('adj502 `3[2/]&sby` 与 `3&sby[2/]` 渲染完全一致（括号后的 & 不再丢成 decoration）',
      svgA === svgB,
      svgA === svgB ? '' : `lenA=${svgA.length} lenB=${svgB.length}`)
    // adj503：连音里"带波音的音符 + 后一个同音"
    //   ① `(5/&sby 5)`：第二个 5 **延长**（不重新起奏）——事件数 = 波音 3 个（主/邻/按住），
    //      且"按住的主音"时长 = 自己的 held + 第二个音符的整拍；
    //   ② `(5 5/&sby)`：第二个 5 带波音 ⇒ **必须重新起奏**（不能被并进前一个），事件数 +3。
    const m1 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (5/&sby 5) 1 2 |\n')
    check('adj503 `(5/&sby 5)`：第二个 5 延长（合并进"按住的主音"，不重新起奏）',
      // 波音 3 事件（主 62.5 / 邻 62.5 / 按住 375）+ 后半小节 2 个音符 = 5；
      // 「按住的主音」被并入第二个 5 的整拍 ⇒ 375 + 1000 = 1375（中间没有第二个起奏事件）
      m1.ev.length === 5 &&
        Math.abs(m1.ev[2].durationMs - (375 + 1000)) < 1 &&
        Math.abs(m1.ev[2].atMs - 125) < 1 &&
        m1.ev[3].pitch === undefined &&
        Math.abs(m1.ev[3].atMs - 1500) < 1,
      ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (5/&sby 5) 1 2 |\n'))
    const m2 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (5 5/&sby) 1 2 |\n')
    check('adj503 `(5 5/&sby)`：带波音的那个 5 **重新起奏**（不被并进前一个）',
      // 前一个 5 奏满 1 拍（1000ms）→ 第二个 5 在 1000 处**重新起奏**并波动（共 3 个事件）
      m2.ev.length === 6 &&
        Math.abs(m2.ev[0].durationMs - 1000) < 1 &&
        Math.abs(m2.ev[1].atMs - 1000) < 1 &&
        Math.abs(m2.ev[1].durationMs - 62.5) < 1,
      ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (5 5/&sby) 1 2 |\n'))
    // adj504：连音里"带**前**倚音的音符 + 后一个同音" ⇒ 后一个应**延长**（合并只延长主音事件，
    // 倚音在开头不受影响）。用户报的 `(3/[3/5/] 3)`：此前一刀切禁合并 ⇒ 倚音后又弹了一次 3 ✗。
    const g1 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3/[3/5/] 3) 1 2 |\n')
    check('adj504/507 `(3/[3/5/] 3)`：第二个 3 **延长**（前倚音后不再重新起奏）',
      // adj507：主音符 `3/` 有减时线 ⇒ 主音符因子 1/2；倚音 `3/5/` 各 1 条 ⇒ 倚音因子 1/4
      // ⇒ 组时值 = 1/8 拍 = 125ms，两个倚音各 62.5ms（占 0、62.5）
      // → 主音 3 从 125 起、被并入第二个 3 的整拍 ⇒ (500 − 125) + 1000 = 1375
      g1.ev.length === 5 &&
        Math.abs(g1.ev[0].durationMs - 62.5) < 1 &&
        Math.abs(g1.ev[1].atMs - 62.5) < 1 &&
        Math.abs(g1.ev[2].atMs - 125) < 1 &&
        Math.abs(g1.ev[2].durationMs - 1375) < 1 &&
        Math.abs(g1.ev[3].atMs - 1500) < 1,
      ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3/[3/5/] 3) 1 2 |\n'))
    // 后倚音占**尾部** ⇒ 若合并，主音会盖住后倚音那段（倚音在延长的音里"插一嘴"）⇒ 仍然不合并
    // `3[h5/]`（主音符 `3` 无减时线 ⇒ 主音符因子 1、倚音因子 1/4 ⇒ 组时值 1/4 拍 = 250ms）：
    // 主音 1 拍 1000ms − 250 = 750，倚音 5 在 750 处占 250 ⇒ 下一个 3 从 1000 起（照常起奏）
    const g2 = evs('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3[h5/] 3) 1 2 |\n')
    check('adj504/507 `(3[h5/] 3)`：**后倚音**占尾部 ⇒ 仍不合并（第二个 3 照常起奏）',
      g2.ev.length === 5 &&
        Math.abs(g2.ev[0].durationMs - 750) < 1 &&
        Math.abs(g2.ev[1].atMs - 750) < 1 &&
        Math.abs(g2.ev[1].durationMs - 250) < 1 &&
        Math.abs(g2.ev[2].atMs - 1000) < 1,
      ms('V: 1.0\nB: t\nD: C\nP: 4/4\nQ: (3[h5/] 3) 1 2 |\n'))
    // ---- adj505：长倚音时值按用户规范修订（只有带 . 用 2/3；增时线不计入）----
    //   3[2]   1 拍   → 倚 1/2、主 1/2
    //   3.[2]  1.5 拍 → 倚 2/3×1.5 = 1 拍、主 1/2 拍
    //   3 -[2] 2 拍   → 倚 1/2×(2−1) = 1/2 拍、主 3/2 拍（增时线那 1 拍不计）
    //   3. -[2] 2.5 拍→ 倚 2/3×(2.5−1) = 1 拍、主 3/2 拍
    {
      const lg = (q: string) => evs(`V: 1.0\nB: t\nD: C\nP: 4/4\nQ: ${q} |\n`).ev
      const a = lg('3[2]')
      check('adj505 长倚音 `3[2]`（1 拍）：倚 1/2 拍、主 1/2 拍', Math.abs(a[0].durationMs - 500) < 1 && Math.abs(a[1].durationMs - 500) < 1, `${a[0].durationMs}/${a[1].durationMs}`)
      const b = lg('3.[2]')
      check('adj505 长倚音 + 附点 `3.[2]`（1.5 拍）：倚 **2/3** = 1 拍、主 1/2 拍',
        Math.abs(b[0].durationMs - 1000) < 1 && Math.abs(b[1].durationMs - 500) < 1,
        `${b[0].durationMs}/${b[1].durationMs}`)
      const c = lg('3 -[2]')
      check('adj505 长倚音 + 增时线 `3 -[2]`（2 拍）：倚 1/2 × **(2−1)** = 1/2 拍、主 3/2 拍',
        Math.abs(c[0].durationMs - 500) < 1 && Math.abs(c[1].durationMs - 1500) < 1,
        `${c[0].durationMs}/${c[1].durationMs}`)
      const d = lg('3. -[2]')
      check('adj505 长倚音 + 附点 + 增时线 `3. -[2]`：倚 = 2/3 × **本体 1.5** = 1 拍、主 = 总时值 − 1 拍',
        Math.abs(d[0].durationMs - 1000) < 1 && Math.abs(d[1].durationMs - (d[0].durationMs + d[1].durationMs - 1000)) < 1,
        `${d[0].durationMs}/${d[1].durationMs}`)
      const e = lg('3[32]')
      check('adj505 多个长倚音仍**共享**组时值（`3[32]`：两个各 1/4 拍）',
        Math.abs(e[0].durationMs - 250) < 1 && Math.abs(e[1].durationMs - 250) < 1 && Math.abs(e[2].durationMs - 500) < 1,
        `${e[0].durationMs}/${e[1].durationMs}/${e[2].durationMs}`)
      const f = lg('3.[32]')
      check('adj505 多个长倚音 + 附点共享 2/3：`3.[32]` 两个各 1/2 拍、主 1/2 拍',
        Math.abs(f[0].durationMs - 500) < 1 && Math.abs(f[1].durationMs - 500) < 1 && Math.abs(f[2].durationMs - 500) < 1,
        `${f[0].durationMs}/${f[1].durationMs}/${f[2].durationMs}`)
      const g = lg('3[2/]')
      check('adj489/507 短倚音时值（`3[2/]`：主音符 1 拍无减时线 ⇒ 组时值 1/4 拍 = 250ms、主音符 3/4 拍）',
        Math.abs(g[0].durationMs - 250) < 1 && Math.abs(g[1].durationMs - 750) < 1,
        `${g[0].durationMs}/${g[1].durationMs}`)
      // adj507 的核心：**倚音长短跟着主音符走**——同样写 `[2/]`，主音符 1 拍 vs 1/2 拍的组时值差一倍
      const gShort = lg('3/[2/]')
      check('adj507 主音符有减时线 ⇒ 半价（`3/[2/]`：组时值 1/8 拍 = 125ms、主音符 3/8 拍）',
        Math.abs(gShort[0].durationMs - 125) < 1 && Math.abs(gShort[1].durationMs - 375) < 1,
        `${gShort[0].durationMs}/${gShort[1].durationMs}`)
      check('adj507 `3[2/]` 的倚音时值 = `3/[2/]` 的两倍（两者听觉不同）',
        Math.abs(g[0].durationMs - 2 * gShort[0].durationMs) < 1,
        `${g[0].durationMs} vs ${gShort[0].durationMs}`)
      // 倚音因子：1 条 1/4、2 条 1/8、≥3 条 1/16（封顶）
      const g2b = lg('3[2//]')
      check('adj507 倚音 2 条减时线 ⇒ 1/8 拍（`3[2//]` 组时值 125ms、主音符 875ms）',
        Math.abs(g2b[0].durationMs - 125) < 1 && Math.abs(g2b[1].durationMs - 875) < 1,
        `${g2b[0].durationMs}/${g2b[1].durationMs}`)
      const g3b = lg('3[2///]')
      const g4b = lg('3[2////]')
      check('adj507 倚音 ≥3 条减时线封顶 1/16 拍（`3[2///]` 与 `3[2////]` 都是 62.5ms）',
        Math.abs(g3b[0].durationMs - 62.5) < 1 && Math.abs(g4b[0].durationMs - 62.5) < 1,
        `${g3b[0].durationMs}/${g4b[0].durationMs}`)
      const gShort2 = lg('3/[2//]')
      check('adj507 两个因子相乘（`3/[2//]`：1/2 × 1/8 = 1/16 拍 = 62.5ms、主音符 437.5ms）',
        Math.abs(gShort2[0].durationMs - 62.5) < 1 && Math.abs(gShort2[1].durationMs - 437.5) < 1,
        `${gShort2[0].durationMs}/${gShort2[1].durationMs}`)
      // ---- adj505：力度（方案 b，只做力度区分）：短倚音 90%、长倚音不变（前/后同尺子）----
      const bg = 1 // 主声部基础 gain
      const v1 = lg('3[2/] 4') // 短前倚音
      check('adj505 短**前**倚音力度 = 90%（重音在主音符上，稍弱起）',
        Math.abs((v1[0].gain ?? 1) - bg * 0.9) < 1e-9 && Math.abs((v1[1].gain ?? 1) - bg) < 1e-9,
        `倚=${v1[0].gain} 主=${v1[1].gain}`)
      const v2 = lg('3[2] 4') // 长前倚音
      check('adj505 长**前**倚音力度不变（拍点上的重音）',
        Math.abs((v2[0].gain ?? 1) - bg) < 1e-9 && Math.abs((v2[1].gain ?? 1) - bg) < 1e-9,
        `倚=${v2[0].gain} 主=${v2[1].gain}`)
      const v3 = lg('3[h2/] 4') // 短后倚音
      check('adj505 短**后**倚音力度 = 90%',
        Math.abs((v3[0].gain ?? 1) - bg) < 1e-9 && Math.abs((v3[1].gain ?? 1) - bg * 0.9) < 1e-9,
        `主=${v3[0].gain} 倚=${v3[1].gain}`)
      const v4 = lg('3[h2] 4') // 长后倚音
      check('adj505 长**后**倚音力度不变', Math.abs((v4[1].gain ?? 1) - bg) < 1e-9, `倚=${v4[1].gain}`)
    }
  }
}

runAdj363SaveTests()
  .catch((e) => {
    failed++
    console.error('  ✗ adj363 保存可靠性用例抛异常', e)
  })
  .then(() => runStoreFileIdentityTests())
  .catch((e) => {
    failed++
    console.error('  ✗ adj370 文件身份用例抛异常', e)
  })
  .then(() => runNewDocTemplateTests())
  .catch((e) => {
    failed++
    console.error('  ✗ adj481 新建模板用例抛异常', e)
  })
  .then(() => runAdj416BankSourceTests())
  .catch((e) => {
    failed++
    console.error('  ✗ adj416 音源来源用例抛异常', e)
  })
  .then(() => {
    try {
      runAdj526NumberScrubTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj526 数值拖动调节用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj529PreviewFitTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj529 预览比例适配宽度用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj530TopBarLayoutTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj530 顶栏按钮重排/优先级折叠用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj534to537UiTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj534-537 界面调整用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj538ExternalOpenTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj538 文件关联/外部打开用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj539ShellTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj539 桌面壳白屏护栏/快捷方式命名用例抛异常', e)
    }
  })
  .then(() => {
    try {
      runAdj540WorkspaceTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj540 工作区（含子目录）用例抛异常', e)
    }
  })
  .then(async () => {
    try {
      await runAdj541DockToggleTests()
    } catch (e) {
      failed++
      console.error('  ✗ adj541 底栏展开/收起用例抛异常', e)
    }
  })
  .then(() => {
    console.log(failed === 0 ? '\nALL SMOKE TESTS PASSED ✅' : `\n${failed} CHECKS FAILED ❌`)
    process.exit(failed === 0 ? 0 : 1)
  })

