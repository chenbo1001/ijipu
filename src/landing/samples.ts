/**
 * landing/samples.ts — 首页示例谱（adj877 建；adj883/adj892/adj893 精简；adj898 扩成示例集）
 *
 * ## 示例从哪来
 *
 * · **茉莉花**用仓库里**已有的示例谱**（`public/samples/茉莉花.jps`）——它本来就有 smoke 断言守着；
 * · 其余几段是**为首页手写的**（每个都短、都能一眼看完），并逐条过引擎闸门：
 *   **零错误、零告警**（见 smoke 的 `[164]` 段）。
 *
 * ## 关于"精简"（adj883 / adj892 / adj893 的来龙去脉）
 *
 * adj883（用户口径：「首页示例谱都先不带 `# jps-config:{}` 的设置，尽量简单，
 * 不要一开始就劝退了一帮人」）：剥掉 `# jps-config:{…}` 与装饰性分隔注释。
 * adj892（用户反馈）：「茉莉花应加个 **两端对齐最小小节:3**」——该字段直接决定每行会不会
 * 两端对齐，删了就不像成品 ⇒ 改为**白名单保留**（`KEEP_CONFIG_KEYS`）。
 * adj893（用户要求）：去掉描述头 `S:`（示例里那句"本乐谱使用「爱记谱」编制"是自述冗余）。
 *
 * ⚠ 只精简**首页展示**用的副本；`public/samples/*.jps` 原文一个字都不动
 * （应用「打开示例」用的仍是完整谱面，那是"一打开就是成品"的场景）。
 *
 * ## 手写示例的规矩（用户 adj898 要求）
 *
 * **完整示例谱要规范**：小节拍数与拍号一致、**以 `||` 收尾**、**不得有告警**。
 * 下面每一段都按这条写，并由 smoke 逐个验证（不是"看着差不多"）。
 */
import moly from '../../public/samples/茉莉花.jps?raw'

/**
 * 精简时**保留**的配置项。
 *
 * 判据：**删了它，谱面看起来会明显不同**（不是"内部实现细节"）。
 *   · `align_min_bars`：两端对齐最小小节数 —— 行小节数 < 它就不撑满、行尾留白。
 *     （默认 4；茉莉花设的是 **3**，不保留的话那些 3 小节的行不会对齐。）
 *
 * 暂不保留的（都属"细节"或"冗长"，剥掉不影响"像不像成品"）：
 *   `note_size` / `geci_size` / `height_*`（字号行距微调）、`metaPos`（作者/调号坐标微调）、
 *   `geci_font`（一长串字体栈）、`margin_*`（页边距，谱面/满宽视图下看不出）。
 *   日后若发现某项**删了就明显不像话**，往这里加一行即可 —— 这就是白名单存在的意义。
 */
const KEEP_CONFIG_KEYS = ['align_min_bars'] as const

/** 装饰性分隔注释：`#===== 描述头定义 =====` 这类（`#` 后带一长串 `=` 或 `-`） */
const isDecorComment = (l: string): boolean => /^\s*#/.test(l) && /[=-]{4,}/.test(l)

/**
 * 描述头里的 `S:`（**谱尾说明**，adj893 用户要求去掉）。
 * 示例原文写的是 `S: 本乐谱使用「爱记谱」编制` —— 在示例里属于**自述冗余**；
 * `S:` 本身是可选描述头，删掉**不影响语法与渲染**。
 * ⚠ 判据锚在**行首**（`^\s*S\s*:`）⇒ 不会误伤 `# S: …` 这种注释行，也不会碰歌词 / 曲行。
 */
const isRemarkHeader = (l: string): boolean => /^\s*S\s*:/.test(l)

/** 页面设置行（`# jps-config:{…}`）的判定 */
const isConfigLine = (l: string): boolean => /^\s*#\s*jps-config\s*:/.test(l)

/**
 * 从 `# jps-config:{…}` 里只挑出白名单键，重写成一行。
 * 挑不出东西（该谱没有这些项）或 JSON 坏了 ⇒ 返回 `null`，调用方整行丢掉 ——
 * 首页示例不该因为一个配置块解析不了就整个崩掉。
 */
function keepConfigLine(line: string): string | null {
  const at = line.indexOf('{')
  if (at < 0) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line.slice(at)) as Record<string, unknown>
  } catch {
    return null
  }
  const kept: Record<string, unknown> = {}
  for (const key of KEEP_CONFIG_KEYS) if (key in obj) kept[key] = obj[key]
  return Object.keys(kept).length > 0 ? `# jps-config:${JSON.stringify(kept)}` : null
}

/** 删掉"给应用看的"与"示例里多余的自述"：页面设置只留白名单项，装饰注释与 `S:` 整行去掉 */
export function simplifyJps(src: string): string {
  const out: string[] = []
  for (const line of src.split('\n')) {
    if (isConfigLine(line)) {
      const kept = keepConfigLine(line)
      if (kept !== null) out.push(kept)
      continue
    }
    if (isDecorComment(line)) continue
    if (isRemarkHeader(line)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * 小星星 —— **最小示例**：4 小节、两句歌词，把"一行文本就是一段旋律"讲完。
 * 拍数：每小节 4 拍（`-` 是增时线，占 1 拍）；歌词 14 字对上 14 个音符（`-` 不配字）。
 * ⚠ 这段与 `index.html` 里块内**预置的源码必须逐字一致**（用户第一眼看到的就是它）。
 */
const XIAO_XING_XING = [
  'B: 小星星',
  'D: C',
  'P: 4/4',
  "Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - ||",
  'C: 一 闪 一 闪 亮 晶 晶 满 天 都 是 小 星 星',
].join('\n') + '\n'

/** 修饰符示例：前倚音 `1[65]`、连音线 `( )`、颤音 `&tr` —— 每小节 4 拍 */
const ORNAMENTS = [
  'B: 倚音、连音与颤音',
  'D: C',
  'P: 4/4',
  "Q: 1[65] ( 3 4 ) 5 | 5&tr 3 ( 2 1 ) ||",
].join('\n') + '\n'

/** 反复与跳房子：`|:` `:|]` 反复、`["1."` / `["2."` 两遍的房子、`||]` 收尾 —— 每小节 4 拍 */
const VOLTA = [
  'B: 反复与跳房子',
  'D: C',
  'P: 4/4',
  "Q: |: 1 2 3 4 | 5 6 7 1' |[\"1.\" 1 2 3 4 :|][\"2.\" 5 4 3 2 ||]",
].join('\n') + '\n'

/** 临时伴奏 `{bz … }`：段内是伴奏声部（画在主旋律上方）；末小节 4 拍再收尾 */
const TEMP_BZ = [
  'B: 临时伴奏',
  'D: C',
  'P: 4/4',
  "Q: 3 4 | {bz 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 - - -||",
].join('\n') + '\n'

/**
 * 临时多声部 `{dsb … }`：段内是上声部，该段覆盖范围的主旋律自动成为下声部。
 * ⚠ 末小节是 `5 - - -`（**4 拍**）：用户原稿写的是 `5 -`（2 拍），
 * 引擎按 4/4 判它"第 4 小节共 2 拍，与拍号不符"⇒ 与"示例不得有告警"的口径冲突，
 * 故补足到 4 拍（与相邻的「临时伴奏」保持一致）。
 */
const TEMP_DSB = [
  'B: 临时多声部',
  'D: C',
  'P: 4/4',
  "Q: 3 4 | {dsb 1 2 3 4 | 5 6 7 1'} 5 6 7 1' | 1' 7 6 5 | 5 - - -||",
].join('\n') + '\n'

/**
 * 多声部：两条 `Q` 轨各自一个声部（`Q1:` / `Q2:`），每小节 4 拍。
 * `align_min_bars: 2` 是随谱走的页面设置（L2）—— 两小节的行就撑满两端对齐。
 */
const MULTI_VOICE = [
  'B: 多声部',
  'D: C',
  'P: 4/4',
  "Q1: 1 2 3 4 | 5 6 7 1' ||",
  'Q2: 1, 2, 3, 4, | 5, 6, 7, 1 ||',
  '# jps-config:{"align_min_bars":2}',
].join('\n') + '\n'

/**
 * 顺序即首页示例按钮的顺序。
 * 从**最小**的开始（小星星），再给一个**完整成品**（茉莉花），其余按"想演示的能力"排。
 */
export const BRAND_SAMPLES: readonly { label: string; src: string }[] = [
  { label: '小星星', src: XIAO_XING_XING },
  { label: '茉莉花（完整）', src: simplifyJps(moly) },
  { label: '倚音与连音', src: ORNAMENTS },
  { label: '跳房子与反复', src: VOLTA },
  { label: '临时伴奏 {bz}', src: TEMP_BZ },
  { label: '临时多声部 {dsb}', src: TEMP_DSB },
  { label: '多声部', src: MULTI_VOICE },
] as const
