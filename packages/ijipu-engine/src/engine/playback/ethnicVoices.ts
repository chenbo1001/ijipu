/**
 * engine/playback/ethnicVoices.ts — 民族乐器名的**拟声映射**（adj1019）
 *
 * ## 为什么需要它
 *
 * GM 的 128 个 program 里**没有**二胡、琵琶、古筝、唢呐这些乐器。用户照常写
 * `Y: 二胡` / `@琵琶@` 时，旧行为会落到"认不出 ⇒ 钢琴 0"——听起来完全不对。
 * 这里给一张**明确的对应表**：民族乐器名 → 最接近的 GM program。
 *
 * ## 为什么所有地方都要带「拟」
 *
 * 这些映射**只是"像"，不是"是"**：Fiddle 不是二胡、Koto 不是古筝。
 * 如果界面上只显示 `二胡 → 110`，用户会以为音源里真有二胡采样，拿去做正式作品才发现不对。
 * 所以：**凡是显示映射结果的地方，一律用 `ethnicLabel()` 的 `二胡（拟）`**。
 *
 * 要真实民乐，请用外部音源（Ample China / Kong Audio 等 VST），应用侧只负责排谱与导出 MIDI。
 *
 * ## 两条维护约束
 *
 * 1. `program` 按 **MIDI 标准**取（决定听到的声音）；显示名取 `GM_VOICES` 的中文名。
 *    ⚠ `GM_VOICES` 是个别条目与标准有偏差的老表（如 45/46 的竖琴/定音鼓错位），
 *    所以**声音按 program 走、显示按表走**，两者可能看着不一致——这是老问题，不在本模块修。
 * 2. 表里**只放 GM 里没有的名字**（二胡/琵琶…）；`长笛`/`小提琴` 这类 GM 已有的名字
 *    必须继续走 `GM_VOICES`，smoke 有负对照守着。
 */
import { GM_VOICES } from './gmVoices'

/** 一条拟声映射 */
export interface EthnicAlias {
  /** 谱面里可写的中文名（尽量收常见写法） */
  name: string
  /** 落到哪个 GM program（0–127，按 MIDI 标准） */
  program: number
  /** 可选的一句说明（为什么选它 / 它的局限） */
  note?: string
}

/**
 * 民族乐器 → GM program（**拟声**）。
 *
 * 选型原则：优先"发声方式相同"（弓弦→弓弦、拨弦→拨弦、双簧→双簧），
 * 其次才是音域。所以二胡→110(Fiddle)、琵琶→105(Banjo)、唢呐→111(Shanai)。
 */
export const ETHNIC_ALIASES: EthnicAlias[] = [
  // ── 弓弦 ──
  { name: '二胡', program: 110, note: '弓弦；没有滑音与揉弦技巧' },
  { name: '高胡', program: 110 },
  { name: '中胡', program: 110 },
  { name: '板胡', program: 110 },
  { name: '京胡', program: 110 },
  { name: '马头琴', program: 110 },
  // ── 拨弦 ──
  { name: '琵琶', program: 105, note: '短促颗粒感接近' },
  { name: '柳琴', program: 105 },
  { name: '月琴', program: 105 },
  { name: '阮', program: 105 },
  { name: '中阮', program: 105 },
  { name: '三弦', program: 106 },
  { name: '古筝', program: 107, note: '拨弦+余韵最接近' },
  { name: '筝', program: 107 },
  { name: '古琴', program: 107 },
  { name: '箜篌', program: 46 },
  { name: '扬琴', program: 15, note: '同是击弦' },
  // ── 吹管 ──
  { name: '笛子', program: 73 },
  { name: '竹笛', program: 73 },
  { name: '曲笛', program: 73 },
  { name: '梆笛', program: 72, note: '梆笛音区高' },
  { name: '箫', program: 77 },
  { name: '洞箫', program: 77 },
  { name: '南箫', program: 77 },
  { name: '尺八', program: 77 },
  { name: '唢呐', program: 111, note: '同样是双簧哨片' },
  { name: '海笛', program: 111 },
  { name: '管子', program: 111 },
  { name: '笙', program: 20 },
  { name: '芦笙', program: 20 },
  { name: '葫芦丝', program: 20 },
  { name: '埙', program: 79 },
  { name: '陶笛', program: 79 },
  { name: '排箫', program: 75 },
  // ── 打击 ──
  { name: '堂鼓', program: 116 },
  { name: '大鼓', program: 116 },
  { name: '排鼓', program: 116 },
  { name: '木鱼', program: 115 },
  { name: '梆子', program: 115 },
  { name: '编钟', program: 14 },
  { name: '编磬', program: 14 },
  { name: '锣', program: 118, note: '锣没有专门采样，只能用近似的打击音' },
  { name: '大锣', program: 118 },
  { name: '小锣', program: 118 },
  { name: '镲', program: 119 },
  { name: '钹', program: 119 },
]

/** 按名字查拟声映射（全名匹配；不做模糊匹配，避免"笛"误吞"长笛"） */
export function ethnicAliasOf(name: string | undefined | null): EthnicAlias | undefined {
  if (!name) return undefined
  const key = name.trim()
  if (key === '') return undefined
  return ETHNIC_ALIASES.find((a) => a.name === key)
}

/**
 * **显示名**：`二胡（拟）`。
 *
 * 所有界面（音色选择器的说明、音色库面板的提示）都必须用它，而不是裸名字 ——
 * 裸名字会让人以为音源里真有这件乐器。
 */
export function ethnicLabel(alias: Pick<EthnicAlias, 'name'>): string {
  return `${alias.name}（拟）`
}

/**
 * 显示"它到底会用什么音色"：取 `GM_VOICES` 的 `N 名称`（如 `110 民族琴`）。
 * 取不到就退化成 `program N`（表里没有这个号也不该崩）。
 */
export function ethnicGmLabel(alias: Pick<EthnicAlias, 'program'>): string {
  const v = GM_VOICES.find((x) => x.program === alias.program)
  return v ? v.label : `program ${alias.program}`
}
