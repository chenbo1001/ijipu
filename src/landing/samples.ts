/**
 * landing/samples.ts — 首页示例谱（adj877 建；adj883 精简；adj892 改为白名单保留）
 *
 * 用仓库里**已有的示例谱**（`public/samples/*.jps` —— 就是应用「文件 → 打开示例」那一批）：
 * 它们本来就有 smoke 断言守着，不会出现"示例自己就写错了"。
 *
 * adj883（用户口径：「首页示例谱都先不带 `# jps-config:{}` 的设置，尽量简单，
 * 不要一开始就劝退了一帮人」）：原文里带着**给应用看的**两部分，首页要剥掉 ——
 *   · `# jps-config:{…}`：一长串 JSON（`metaPos` / `margin_*` / 字体栈…），新手看了只会懵；
 *   · `#===== 描述头定义 =====`：纯装饰的分隔注释。
 *
 * adj892（用户反馈：「首页示例的茉莉花应加个 **两端对齐最小小节:3** 的配置，
 * 否则显示不会两边对齐」）—— **这条纠正了 adj883 的做法**：
 * `align_min_bars` **不是**"内部设置"，它直接决定**每行会不会两端对齐**；
 * 删掉就退回默认 4，茉莉花里那些 3 小节的行便不再撑满，看着不像成品。
 * 所以改成：**白名单保留**少数"影响观看效果"的项，其余照旧剥掉 —— 既对齐，又不劝退。
 *
 * adj893（用户要求）：「把示例里的描述头 `S:` 去掉」——
 * 两份示例都带着 `S: 本乐谱使用「爱记谱」编制`，这句**自述**放在示例谱面上是冗余，
 * 首页展示时一并去掉（`S:` 是可选描述头，删掉不影响语法与渲染）。
 *
 * ⚠ 只精简**首页展示**用的副本；`public/samples/*.jps` 原文一个字都不动
 *   （应用「打开示例」用的仍是完整谱面，那是"一打开就是成品"的场景）。
 */
import moly from '../../public/samples/茉莉花.jps?raw'
import songbie from '../../public/samples/送别.jps?raw'

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
 * 两份示例写的都是 `S: 本乐谱使用「爱记谱」编制` —— 在示例里属于**自述冗余**；
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
 * 顺序即首页示例按钮的顺序，**第 0 个要与 `index.html` 里块内预置的源码一致**
 * （用户第一眼看到的、和点「最小示例」得到的，应当是同一段）。
 * 从最简单的一段开始，别一上来就甩一份长谱。
 */
export const BRAND_SAMPLES: readonly { label: string; src: string }[] = [
  { label: '最小示例', src: "Q: 1 2 3 4 | 5 6 7 1' |\n" },
  { label: '茉莉花', src: simplifyJps(moly) },
  { label: '送别（双行歌词）', src: simplifyJps(songbie) },
] as const
