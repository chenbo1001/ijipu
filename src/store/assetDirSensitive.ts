/**
 * store/assetDirSensitive.ts — **"这个目录浏览器不让授权"的判定**（纯函数，零 DOM，可 Node 断言）
 *
 * ## 为什么要有它（用户 2026-10-18 实报 + 拍板）
 *
 * 用户把 `.jps` 和背景图**放在桌面**上打开：第一次背景不显示，点「授权所在文件夹」也毫无反应；
 * 后来"加一次工作区"就正常了。原因是 **Chromium 的内置敏感目录名单**：
 * `showDirectoryPicker()` 对 **桌面 / 文档 / 下载** 这三个目录**直接抛 `AbortError`**
 * —— 与"用户取消"**同一个错误**，所以我们**区分不出来**，只能表现为"点了没反应"✗。
 *
 * 用户原话：「这个提示"这个目录浏览器不让授权，请把谱和图放到别的文件夹，或改用工作区"，**可以**，
 * 这样**可以告诉用户为什么不显示**」。
 *
 * ## 判据（只对**直接父目录**判，不向上递归）
 *
 * 名单命中的是这三个目录**本身**：谱放在 `…\Desktop\望月.jps` ⇒ 被拦；
 * 放在 `…\Desktop\谱\望月.jps`（桌面的**子目录**）⇒ **能选**（Chromium 只拦那三个目录本身）✓。
 * 所以这里取"文件名的上一段"来比，**不**用 `includes` 扫整条路径（否则子目录也会被误判）。
 *
 * 两个限制（如实写在代码里，别让后来人以为是 bug）：
 *  · 目录名按 **ASCII** 匹配（`Desktop` / `Documents` / `Downloads`）：Windows 上中文系统里
 *    文件夹的**真实名**仍是 ASCII，界面才显示"桌面/下载"，所以匹配 ASCII 是对的；
 *  · 只认**英文名**：用户若把桌面目录改名成 `我的桌面`，Chromium 的名单是按**原路径**登记的，
 *    改名后通常也不再拦（那种情况本来就选得动），所以不必覆盖。
 */

/** Chromium 拦掉的三个目录（小写 ASCII；即使用户把 OneDrive 接管成 `…\OneDrive\Desktop` 也命中） */
export interface SensitiveDir {
  /** 匹配用的目录名（小写） */
  key: 'desktop' | 'documents' | 'downloads'
  /** 给人看的名字（进提示语） */
  label: string
}

export const SENSITIVE_DIRS: readonly SensitiveDir[] = [
  { key: 'desktop', label: '桌面' },
  { key: 'documents', label: '文档' },
  { key: 'downloads', label: '下载' },
]

/**
 * 路径 → **直接父目录名**（小写；`''` = 取不到）。
 *
 * 同时认 Windows 与 POSIX 分隔符（桌面壳 `nativePath` 是 Windows 形态，但单元测试/其他端都可能给 `/`）。
 * 末尾的分隔符先去掉，避免 `…\Desktop\` 取到空段。
 */
export function parentDirNameOf(path: string | null | undefined): string {
  const raw = typeof path === 'string' ? path.trim() : ''
  if (raw === '') return ''
  const norm = raw.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = norm.split('/')
  // 最后一段是文件名 ⇒ 上一段才是目录
  parts.pop()
  return (parts.pop() ?? '').trim().toLowerCase()
}

/**
 * 这份谱是不是就在**被拦的目录**里（桌面 / 文档 / 下载）。
 *
 * @param nativePath 桌面壳给的**真实文件路径**（浏览器端永远是 `null` —— 网页层拿不到路径，
 *   那种情形也根本没有"被拦"这个问题：网页端是从用户手势里直接选目录的）。
 * @returns 命中时返回给人看的目录名（`'桌面'` / `'文档'` / `'下载'`），否则 `null`。
 */
export function sensitiveDirLabelOf(nativePath: string | null | undefined): string | null {
  const dir = parentDirNameOf(nativePath)
  if (dir === '') return null
  return SENSITIVE_DIRS.find((d) => d.key === dir)?.label ?? null
}
