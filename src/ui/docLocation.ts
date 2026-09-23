/**
 * ui/docLocation.ts — 「当前文档存在哪」的状态栏文案（adj622）
 *
 * 三种来源（互斥，由 docStore 维护）：
 *   ① `binding`    ——在工作区里打开/保存的谱。给出「工作区/路径/文件名」。
 *   ② `nativePath` ——桌面壳双击 `.jps` 时拿到。给出完整绝对路径（dir/filename 形式）。
 *   ③ `fileHandle` ——浏览器原生文件选择器拿到的句柄。仅有文件名，**没有**目录信息。
 *
 * 返回 `{ display, title }`：display 是状态栏要显示的文本；title 是 hover tooltip
 * （同 display，路径长时被截断可让用户看到完整字符串）。
 *
 * 设计取舍：
 *   · 工作区路径用 `/` 而不是 `\`——避免与 Windows 路径视觉混淆，也匹配用户口径的字面样例
 *     「工作区/路径/文件名」。`nativePath` 里的 `\` 会在拼装时替换为 `/` 保持一致。
 *   · 仅"工作区打开的谱"显示完整路径；浏览器本地文件（fileHandle）拿不到目录 ⇒ 只显文件名。
 *     这不是退化，而是事实——用户口径"工作区/路径/文件名"本身只描述工作区情形。
 *   · 新建未保存文档（既无 binding 也无 nativePath/fileHandle）显示「未命名」。
 *   · `nativePath` 走 `split` + 末段切分，跨平台（Win `\` / POSIX `/`）由 normalize 函数吸收。
 */
import type { WorkspaceBinding } from '../store/docStore'

export interface DocLocation {
  /** 状态栏展示文本（可能很长，被外层 CSS 截断） */
  display: string
  /** hover tooltip（始终完整） */
  title: string
}

/** 单一分隔符——所有路径片段都拼成 `a/b/c` 形式 */
const SEP = '/'

/**
 * 把原生路径里的 `\` 标准化为 `/`，便于跨平台统一展示。
 * 不切盘符前缀——`C:/scores/送别.jps` 仍然带盘符。
 */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, SEP)
}

/**
 * 末段切分：拿「目录部分 + 文件名」两部分；兼容 `\` 与 `/`。
 * `''` 路径或纯分隔符 ⇒ dir `''`、filename `''`。
 */
function splitDirFile(p: string): { dir: string; file: string } {
  const norm = normalizeSlashes(p).replace(/\/+$/, '')
  if (norm === '') return { dir: '', file: '' }
  const idx = norm.lastIndexOf(SEP)
  if (idx < 0) return { dir: '', file: norm }
  return { dir: norm.slice(0, idx), file: norm.slice(idx + 1) }
}

/**
 * 渲染「工作区/路径/文件名」。三段都以 `/` 拼接，中间段缺则跳过（不留多余斜杠）。
 */
function renderWorkspacePath(b: WorkspaceBinding): string {
  const segs = b.segs
  const file = segs[segs.length - 1] ?? ''
  const dirs = segs.slice(0, -1).filter((s) => s !== '')
  const parts = [b.wsName, ...dirs, file].filter((s) => s !== '')
  return parts.join(SEP)
}

export interface DocLocationInput {
  /** 当前 docStore 的三个文件来源；互斥，最多有一个非空 */
  binding: WorkspaceBinding | null
  nativePath: string | null
  /** fileHandle 存在 ⇒ 文件已绑本地磁盘，但拿不到目录 */
  fileHandle: FileSystemFileHandle | null
  /** 文件名（docStore.fileName）——fileHandle 路径用 */
  fileName: string
}

export function formatDocLocation(input: DocLocationInput): DocLocation {
  // ① 工作区绑定——主路径
  if (input.binding) {
    const display = renderWorkspacePath(input.binding)
    return { display, title: display }
  }
  // ② 桌面壳 nativePath
  if (input.nativePath) {
    const { dir, file } = splitDirFile(input.nativePath)
    const display = dir ? `${dir}${SEP}${file}` : file
    return { display, title: display }
  }
  // ③ 浏览器 fileHandle——只有文件名
  if (input.fileHandle) {
    const display = `${input.fileName}.jps`
    return { display, title: display }
  }
  // ④ 全新未保存文档
  return { display: '未命名', title: '未命名（未保存到磁盘）' }
}