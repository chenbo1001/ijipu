/**
 * landing/samples.ts — 首页示例谱（adj877 建、adj883 精简）
 *
 * 用仓库里**已有的示例谱**（`public/samples/*.jps` —— 就是应用「文件 → 打开示例」那一批）：
 * 它们本来就有 smoke 断言守着，不会出现"示例自己就写错了"。
 *
 * adj883（用户口径：「首页示例谱都先不带 `# jps-config:{}` 的设置，尽量简单，
 * 不要一开始就劝退了一帮人」）：原文里带着**给应用看的**两部分，首页要剥掉——
 *   · `# jps-config:{…}`：一长串 JSON（`geci_size`/`metaPos`/`margin_*`…），新手看了只会懵；
 *   · `#===== 描述头定义 =====`：纯装饰的分隔注释。
 * 真正的描述头与歌词（`V:`/`B:`/`Z:`/`D:`/`P:`/`Q:`/`C:`）一律保留 —— 那才是"这段谱在写什么"。
 * ⚠ 只精简**首页展示**用的副本；`public/samples/*.jps` 原文一个字都不动
 *   （应用「打开示例」用的仍是完整谱面，那是要"一打开就是成品"的场景）。
 */
import moly from '../../public/samples/茉莉花.jps?raw'
import songbie from '../../public/samples/送别.jps?raw'

/** 删掉"给应用看的"行：页面设置 JSON 与装饰性分隔注释（见文件头说明） */
export function simplifyJps(src: string): string {
  const isConfig = (l: string) => /^\s*#\s*jps-config\s*:/.test(l)
  const isDecor = (l: string) => /^\s*#/.test(l) && /[=-]{4,}/.test(l)
  return (
    src
      .split('\n')
      .filter((l) => !isConfig(l) && !isDecor(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
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
