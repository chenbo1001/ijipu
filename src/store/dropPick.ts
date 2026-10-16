/**
 * store/dropPick.ts — **拖放时"该打开哪一个"的纯判据**（adj968）
 *
 * 单独一个模块（而不是塞在 `dropOpen.ts` 里）有两个原因：
 *  ① `dropOpen.ts` 要 import `docStore` / `uiStore`（它们一加载就读 `localStorage`），
 *     **Node 里跑不起来** ⇒ 纯判据必须与它分开，`npm run smoke` 才能直接断言；
 *  ② 与 `externalOpen.pickPrimary`（双击多选取第一个）**同源**：两处都在回答"一次给了好几个文件，打开哪个"，
 *     口径必须一致（只认 `.jps`、取第一个、其余如实报数）。
 */

/** 拖进来的一堆文件里，我们要哪一个 */
export interface DropPick {
  /** 要打开的那个 `.jps` 文件名（一个都不认识就是 `null`） */
  primary: string | null
  /** 其余 `.jps` 的个数（一次拖放只打开第一个） */
  extraCount: number
  /** 非 `.jps` 的个数（只用来如实报数，不做任何处理） */
  ignored: number
}

/**
 * 从拖动列表里挑出要打开的文件：**只认 `.jps`**（大小写不敏感），多个就取第一个。
 *
 * 为什么"只认扩展名、不认 MIME"：`.jps` 是自定义扩展名，各系统的 MIME 记录不一致
 * （与 `saveSupport.fileInputAccept` 那条口径同源），按文件名后缀判定才稳。
 */
export function classifyDropNames(names: readonly string[]): DropPick {
  const jps = names.filter((n) => n.toLowerCase().endsWith('.jps'))
  return { primary: jps[0] ?? null, extraCount: Math.max(0, jps.length - 1), ignored: names.length - jps.length }
}
