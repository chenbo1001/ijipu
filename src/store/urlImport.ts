/**
 * store/urlImport.ts — 从 URL 文本串导入源码（adj900，用户要求）
 *
 * ## 用途
 *
 * 官网首页示例区的「在应用里试听这段」按钮，把**用户正在看的那段 .jps 源码**
 * 用查询串带进应用（`/app/?jps=<encodeURIComponent(源码)>`）。
 *
 * ## 为什么用 URL 文本串，而不是写 localStorage 草稿
 *
 * · **无残留**：不去改用户的 `ijipu.draft*`。localStorage 那条路必须自己清 `ijipu.draftSrc`，
 *   漏了就会让应用以为示例仍绑着用户上次打开的文件 —— 之后他按 Ctrl+S 就可能
 *   把示例写进自己的谱里（`docStore` 里记过这个坑）；
 * · **可分享**：链接自带谱，发给别人打开就是同一段（这是白捡的好处）；
 * · **渐进增强**：首页那个入口是 `<a href>`，**没有 JS 也能进应用**。
 *
 * ## 载入动作复用现成的「文本串导入」
 *
 * 应用里本来就有 `docStore.importSource`（adj406，粘贴源码导入），该做的它都做了：
 * 清洗内容、清磁盘句柄、**清来源绑定**、与工作区解绑、标记 dirty。
 * 所以这里**不另写一套载入逻辑**，只负责"把源码从 URL 里取出来 / 用完把参数抹掉"。
 */

/** 查询串里承载源码的键名 */
export const JPS_PARAM = 'jps'

/**
 * URL 长度上限：超过就不导入。
 *
 * 浏览器本身能吞很长的 URL，但**经过代理 / CDN / 日志**时可能被截断，
 * 而截断后的半段源码比"不导入"更糟 —— 用户会拿到一段坏谱，还以为是自己的问题。
 * 首页那几个示例都只有几百字符，离这个上限很远；
 * 真遇到超长的（有人把整本书贴进链接），退回"正常打开应用"即可。
 */
export const JPS_PARAM_MAX_LEN = 8000

/**
 * 从 `location.search` 取出待导入的源码；没有 / 空串 / 超长一律返回 `null`
 * （调用方据此"什么都不做"，按正常启动走）。
 *
 * ⚠ 返回值**有意** `trim()` 掉首尾空白：网址里常带无意义的尾随换行
 * （压行时多一个 `%0A`），而源码首尾的空行对 `.jps` 语义毫无影响。
 * 纯函数 ⇒ 可在 Node 里直接断言（不依赖 `window`）。
 */
export function readJpsFromSearch(search: string): string | null {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get(JPS_PARAM)
  } catch {
    return null
  }
  if (raw === null) return null
  if (raw.length > JPS_PARAM_MAX_LEN) return null
  const code = raw.trim()
  return code === '' ? null : code
}

/**
 * 去掉 `jps` 参数后的查询串（没有别的参数时返回空串，调用方拼回 `pathname`）。
 *
 * 为什么要清掉：不清的话用户**一刷新就又被打回示例**，
 * 他在应用里改的那几笔全白改 —— 而且会以为"链接参数根本没生效"。
 */
export function withoutJpsParam(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(JPS_PARAM)
  const rest = params.toString()
  return rest === '' ? '' : `?${rest}`
}
