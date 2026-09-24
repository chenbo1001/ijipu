/**
 * export/printName.ts — **打印 / 另存 PDF 的默认文件名**（adj626，用户要求）
 *
 * 用户口径（原话）："`Ctrl+P` 打印输出为 pdf 时，默认文件名设为第一个描述头 `B:` 的值"
 * （`B:` = 标题，可多次写，第一个是主标题；见 `docs/SYNTAX.md` §2.2）。
 *
 * 为什么落在 `document.title` 上：浏览器与桌面壳（WebView2）都把**文档标题**当作
 * "打印 / 另存为 PDF"的默认文件名，代码里能改的只有它 —— 所以打印期临时把标题换成这里的返回值
 * （见 `export/print.ts`），打印结束再还原（应用标题由 `App` 统一维护）。
 *
 * 纯函数、零 DOM 依赖（便于用 Node 断言）：`B:` 按源码顺序进 `header.titles` ⇒ "第一个 `B:`" 即 `titles[0]`。
 */
import type { ParseResult } from '@ijipu/engine'

/** 兜底名（没有 `B:`、也没有文件名时） */
export const DEFAULT_PRINT_NAME = '未命名'

/** 文件名里不能出现/不宜出现的字符（Windows 保留字符）——换成空格 */
const ILLEGAL_IN_NAME = /[\\/:*?"<>|]/g

/**
 * 剔掉**控制字符**（0x00–0x1F）。为什么用代码而不用正则：正则里写控制字符范围会被 lint
 * 判为 `no-control-regex`（error 级），这里逐字符过滤既避开该规则、意图也更直白。
 */
const stripControlChars = (s: string): string => {
  let out = ''
  for (const ch of s) if (ch.charCodeAt(0) > 0x1f) out += ch
  return out
}

/** 文件名最大长度（避免超长标题撑爆对话框/文件系统） */
const MAX_NAME_LEN = 80

/**
 * 取"这份谱的默认文件名"：
 *  ① **第一个描述头 `B:` 的值**（标题，按源码顺序取第一个非空的）；
 *  ② 没有 `B:` ⇒ 当前文件名（剥掉 `.jps/.md/.txt` 这类后缀——手机端常把 .jps 认成 .md/.txt）；
 *  ③ 都没有 ⇒ `未命名`。
 * 非法字符统一替换为空格并收敛连续空白（`B: 排排坐` 这类值照常可用）。
 */
export function printFileNameOf(titles: readonly string[], fileName: string): string {
  const firstB = titles.find((t) => t.trim() !== '')?.trim() ?? ''
  const raw = firstB !== '' ? firstB : fileName.trim()
  const cleaned = stripControlChars(raw)
    .replace(ILLEGAL_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(jps|md|txt)$/i, '')
    .trim()
  return cleaned === '' ? DEFAULT_PRINT_NAME : cleaned.slice(0, MAX_NAME_LEN)
}

/** 从解析结果 + 文件名直接取（`docStore` 用的薄封装） */
export function printFileNameOfResult(result: ParseResult, fileName: string): string {
  return printFileNameOf(result.header.titles, fileName)
}
