/**
 * store/importSource.ts — 「粘贴源码导入」的文本清洗（纯函数，便于单测）
 *
 * adj406：手机端打开 .jps 越来越依赖系统文件选择器，而各家文件管理器/网盘对**自定义扩展名**
 * 的态度不一致（有的按 MIME 隐藏 .jps，有的根本看不到云端文件）。给一条**完全不依赖选择器**的
 * 入口：把谱面源码粘进来即可。真实的粘贴内容往往带着"壳"，这里统一洗掉：
 *  - BOM（\uFEFF）；
 *  - 包裹的 Markdown 代码围栏（```jps / ``` 开头结尾）——从笔记里复制代码块时最常见；
 *  - CRLF/CR → LF；首尾空行与行尾空白。
 * 只做这些"显然不是谱面内容"的处理，不改动谱面正文（缩进/空格由格式化器负责）。
 */

/** 去掉 Markdown 代码围栏：整段被 ``` 或 ```jps 包裹时只取中间内容 */
function stripCodeFence(text: string): string {
  const lines = text.split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first < 0) return text
  const open = /^\s*```+\s*([A-Za-z0-9_+-]*)\s*$/.exec(lines[first])
  if (!open) return text
  const lang = open[1].toLowerCase()
  // 只认空语言或 jps/txt 这类"谱面源码"围栏，避免误伤正常内容里的 ``` 段落
  if (lang !== '' && lang !== 'jps' && lang !== 'txt' && lang !== 'text') return text
  let last = lines.length - 1
  while (last > first && lines[last].trim() === '') last--
  if (last <= first || !/^\s*```+\s*$/.test(lines[last])) return text
  return lines.slice(first + 1, last).join('\n')
}

/** 清洗粘贴进来的谱面源码（详见文件头说明） */
export function normalizePastedSource(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '')
  text = text.replace(/\r\n?/g, '\n')
  text = stripCodeFence(text)
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}
