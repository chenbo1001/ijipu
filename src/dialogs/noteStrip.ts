/**
 * dialogs/noteStrip.ts — 波形上方那条「**音符格子排**」的几何（纯函数，可断言）
 *
 * 用户 2026-10-24 的想法：
 *  > 「这一排里显示两个图形：a 是谱面主音符分解出来的格子排，显示在波形上面，
 *  >  每个格子对应一个主音符，宽度也与主音符长度对应，点击一个格子，谱面色块相应回到对应的主音符位置」
 *  > 「格子排与波形图在宽度上同步缩放」
 *  > 「添加锚点后，相应格子左侧与锚点对齐；加两个锚点，两个锚点处都要对齐」
 *
 * 为什么它能"保证谱面与波形对齐一致"：格子用的是**和波形同一套时间轴**
 * （`audioMs = offsetMs + 拍 × beatMs`，与对拍解算完全同源），
 * 所以"锚点落在拍上"这件事在格子排里是**直接看得见**的——不用再猜。
 *
 * 本文件只做数学：拍 → 音频毫秒 → 屏幕百分比。渲染在 `SyncDialog` 里。
 */

/** 一个音符（只取几何需要的两个量） */
export interface NoteCellInput {
  /** 起点拍（从曲首算，可带小数） */
  beat: number
  /** 时值（拍） */
  beats: number
  /** adj1144：MIDI 音高（半音整数），用来画"亮柱高度 = 音高" */
  midi?: number
}

/** 排上的一格（已换算到音频时间轴） */
export interface StripCell {
  beat: number
  beats: number
  /** 音频绝对毫秒（文件时刻） */
  audioMs: number
  /** 宽度（毫秒） */
  widthMs: number
  /** adj1144：MIDI 音高（缺省 = 不知道音高 ⇒ 按最低画） */
  midi?: number
}

/** 拍 → 音频毫秒（与 `engine` 的 `audioMsOfBeat` 同一口径；这里不引引擎，保持本文件零依赖） */
function audioMsOfBeat(fit: { beatMs: number; offsetMs: number }, beat: number): number {
  return fit.offsetMs + beat * fit.beatMs
}

/**
 * 音符列表 → 格子排。
 *
 * 会把**完全在 0 之前**（负时刻）的格子丢掉——那是"谱面起点早于音频"的病态情况，
 * 画出来只会让人以为音频里有东西。
 */
export function stripCellsOf(
  notes: readonly NoteCellInput[],
  fit: { beatMs: number; offsetMs: number },
): StripCell[] {
  const out: StripCell[] = []
  for (const n of notes) {
    if (!Number.isFinite(n.beat) || !Number.isFinite(n.beats) || n.beats <= 0) continue
    const audioMs = audioMsOfBeat(fit, n.beat)
    const widthMs = n.beats * fit.beatMs
    if (audioMs + widthMs <= 0) continue
    out.push({
      beat: n.beat,
      beats: n.beats,
      audioMs,
      widthMs,
      ...(typeof n.midi === 'number' && Number.isFinite(n.midi) ? { midi: n.midi } : {}),
    })
  }
  return out
}

/**
 * adj1144（用户 2026-10-25）：
 * 「下半部格子的高度，取整首曲子的最低音占格子的 1/10 高，最高音占格子整个高度，
 *   音符按十二律等分（一个八度 12 份）」——把 MIDI 音高换算成 **0~1 的高度比例**。
 *
 * - 最低音 ⇒ 0.1；最高音 ⇒ 1.0；中间按**半音**线性等分（十二平均律，一个八度 12 份）；
 * - 全曲只有一个音高（或没有音高信息）⇒ 0.1（"最低音"那条），不会画成满格；
 * - 结果**量化到 0.001**，减少无意义的重渲染差异。
 */
export function pitchHeightOf(midi: number | undefined, minMidi: number, maxMidi: number): number {
  if (typeof midi !== 'number' || !Number.isFinite(midi)) return 0.1
  const span = maxMidi - minMidi
  const raw = span > 0 ? 0.1 + 0.9 * ((midi - minMidi) / span) : 0.1
  return Math.min(1, Math.max(0.1, Math.round(raw * 1000) / 1000))
}

/**
 * adj1146（用户 2026-10-25：「第 20 小节没有号……我的意见是要有」）：
 * 把"小节起点 + 它的号"整理成**要画的标签**，并把**缺掉的号补回来**。
 *
 * 为什么会缺号（用户问「还有没其它情况会导致几个小节连在一起」）：
 *  ① **空小节**（只有 `&` 修饰符 / 什么都没有）：播放走查是"按事件"记起点，一个事件都没有的小节
 *     就没人给它记时刻 ⇒ 号被跳过（本谱 #20 就是这种）；
 *  ② **间奏块**（`{jz N}` / `8{jz 16}`）：额外拍不产生小节线，几个小节会挤在同一段静默里；
 *  ③ **重复记号**（`|/ ` 重复上一小节 / `|: :|` 反复段）：同一个小节号会出现两次（这是对的，不该去重）；
 *  ④ **临时拍号**（`P: 2/4` 之后又回 4/4）：小节**长度**变了，但号的连续性不受影响
 *     —— 只要按"每根小节线一个号"来数就对。
 *
 * 补号规则：`no` 比上一个大 1 以上 ⇒ 中间缺的号**挂在后一根线**上（同一 x，上下错开画），
 * 这样"号一个不少"，但**不会凭空造出一条假的小节线**。
 */
export interface BarLabel {
  /** 小节号（1 起） */
  no: number
  /** 它挂在哪根小节线上（拍；与 `barStartBeats` 同一口径） */
  beat: number
  /** 同一根线上第几个（0 = 正常位置，>0 = 补号，往上错开） */
  stack: number
}

export function barLabelsOf(beats: readonly number[], noOf: (i: number) => number): BarLabel[] {
  const out: BarLabel[] = []
  let prevNo = 0
  for (let i = 0; i < beats.length; i++) {
    const no = noOf(i)
    if (no > prevNo + 1) {
      // 缺号：都挂在这一根线上（不造线），按顺序往上叠
      for (let k = prevNo + 1; k < no; k++) out.push({ no: k, beat: beats[i], stack: no - k })
    }
    out.push({ no, beat: beats[i], stack: 0 })
    prevNo = Math.max(prevNo, no)
  }
  return out
}
export function cellRectPct(
  cell: { audioMs: number; widthMs: number },
  v0: number,
  winMs: number,
): { leftPct: number; widthPct: number } | null {
  if (!(winMs > 0)) return null
  const start = Math.max(cell.audioMs, v0)
  const end = Math.min(cell.audioMs + cell.widthMs, v0 + winMs)
  if (end <= start) return null
  const leftPct = ((start - v0) / winMs) * 100
  const widthPct = ((end - start) / winMs) * 100
  // 极窄的格子给一个最小可视宽度（否则缩到整曲时每个音符只有 0.2px，看着像"没有"）
  return { leftPct, widthPct: Math.max(widthPct, 0.05) }
}
