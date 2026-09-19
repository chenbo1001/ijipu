/**
 * store/workspace.ts — 工作区目录（adj540，Android/移动端「选一个文件夹当工作区」）
 *
 * 为什么需要它：手机上没有"双击 .jps 打开"这回事——系统文件选择器对自定义扩展名态度不一致
 * （按 MIME 隐藏 .jps、只能看到已下载的文件），而「保存」走的 `showSaveFilePicker` 在移动端
 * 还出现过"点了没反应"（adj405）。工作区把"打开/保存"变成**在同一个文件夹里挑文件/写文件**，
 * 一次授权、后续都在这个文件夹里操作。
 *
 * 可行性来自**真机探针实测**（Chrome 151 / Android 10，见 docs/DESKTOP-ASSOC-AND-ANDROID.md §3）：
 * 选目录 → `readwrite` granted → 写入 → 回读一致 → 刷新后句柄仍在 IndexedDB，
 * 只需在用户手势里补一次 `requestPermission` 即可继续写。⇒ **不需要做 Android 壳**。
 *
 * 设计要点：
 *  - **只存根句柄 + 相对路径**（IndexedDB，L1 层：与"这个人怎么用"有关，不写进 .jps）；
 *    子目录句柄每次从根逐级解析，路径是纯数据，便于持久化与面包屑显示。
 *  - 支持**子目录**：`path` 的最后一段是文件名时表示"某个文件"，少一段则是一个目录。
 *  - 文件读写复用 `saveSupport` 的权限判定与写入实现（写后回读校验、错误归类同一口径）。
 *  - 纯逻辑（`.jps` 判定、排序、路径规整/拼接）都是可单测的纯函数，smoke 有断言。
 */
import { saveWorkspace, loadWorkspace, type WorkspaceRecord } from './fileHandleDb'
import { ensureWritePermission } from './saveSupport'

/** 目录里的一项（只列子目录与 .jps 文件——工作区是"谱夹"，不该把别的文件混进来） */
export interface DirEntry {
  kind: 'dir' | 'file'
  name: string
  /** 文件修改时间（ms；目录恒为 0）——用于"新的在上"排序 */
  mtime: number
}

/** 浏览器是否支持选文件夹（Chromium 系；Safari/Firefox 没有 `showDirectoryPicker`） */
export function isWorkspaceSupported(): boolean {
  try {
    return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  } catch {
    return false
  }
}

/**
 * 是否 `.jps` 文件（大小写不敏感）。
 * 只认"有主干名 + .jps 后缀"：裸 `.jps`（隐藏文件）不算——它连名字都没有，打开也没意义。
 */
export function isJpsName(name: string): boolean {
  const i = name.lastIndexOf('.')
  return i > 0 && name.slice(i).toLowerCase() === '.jps'
}

/**
 * 工作区列表排序（纯函数）：**目录在前**，文件按**修改时间倒序**（刚存的排最上面）。
 * 名字用 `localeCompare(..., 'zh-Hans-CN', {numeric:true})`：中文按拼音、`第2课` 排在 `第10课` 前。
 */
export function sortDirEntries(list: readonly DirEntry[]): DirEntry[] {
  const byName = (a: DirEntry, b: DirEntry): number =>
    a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  const dirs = list.filter((e) => e.kind === 'dir').sort(byName)
  const files = list.filter((e) => e.kind === 'file').sort((a, b) => b.mtime - a.mtime || byName(a, b))
  return [...dirs, ...files]
}

/**
 * 规整相对路径（纯函数，**防御性**）：只保留合法段。
 * 丢弃空串与 `.`；`..` 直接丢弃（"返回上级"由 UI 弹栈实现，**绝不允许**把 `..` 写进路径——
 * 否则持久化的路径可能被构造成越出工作区，虽然 FSA 本身也拦，但没必要给它机会）。
 */
export function normalizeRelPath(segs: readonly string[]): string[] {
  return segs.filter((s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\'))
}

/** 面包屑/提示用的一行路径（`杂记/小星星.jps`；根目录为空串） */
export function joinPath(segs: readonly string[]): string {
  return segs.join('/')
}

/** 上一级目录（根目录再上一级仍是根：`[]`） */
export function parentPath(segs: readonly string[]): string[] {
  return segs.slice(0, Math.max(0, segs.length - 1))
}

// ---- 会话内缓存：对话框与保存流程会反复取同一个工作区，避免每次都读库 ----
let cached: WorkspaceRecord | null = null
let loaded = false

/** 取当前工作区（首次会读 IndexedDB；返回的 `path` 已规整） */
export async function getWorkspace(): Promise<WorkspaceRecord | null> {
  if (!loaded) {
    cached = await loadWorkspace()
    loaded = true
  }
  return cached
}

/** 设/清工作区（同步更新缓存并落库） */
export async function setWorkspace(rec: WorkspaceRecord | null): Promise<void> {
  cached = rec
  loaded = true
  await saveWorkspace(rec)
}

/** 记住"上次所在子目录"（只是更新记录里的 path，不改根句柄） */
export async function rememberWorkspacePath(path: readonly string[]): Promise<void> {
  if (!cached) return
  cached = { handle: cached.handle, path: normalizeRelPath(path) }
  await saveWorkspace(cached)
}

/** 让用户选一个文件夹当工作区（必须由**用户手势**触发）；用户取消返回 null */
export async function pickWorkspaceDir(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (opts?: { id?: string; mode?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  if (typeof picker !== 'function') return null
  try {
    return await picker({ id: 'ijipu-workspace', mode: 'readwrite', startIn: 'documents' })
  } catch (e) {
    // AbortError = 用户取消（正常路径，调用方静默处理）；其余错误如实抛出
    if ((e as { name?: string })?.name === 'AbortError') return null
    throw e
  }
}

/**
 * **只查**工作区根目录的读写授权状态（不发请求）。
 * UI 在挂载时用它决定显示「继续访问（授权）」按钮还是直接列目录——
 * `requestPermission` 必须由用户手势触发，**不能在挂载时静默调用**（会被浏览器拒绝/忽略）。
 */
export async function queryWorkspacePermission(
  dir: FileSystemDirectoryHandle,
): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  const h = dir as unknown as { queryPermission?: (o: { mode: string }) => Promise<PermissionState> }
  if (typeof h.queryPermission !== 'function') return 'unknown'
  try {
    const state = await h.queryPermission({ mode: 'readwrite' })
    return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'unknown'
  }
}

/** **申请**工作区根目录的读写授权（必须在用户手势内调用；真机实测刷新后是 prompt → granted） */
export async function requestWorkspacePermission(
  dir: FileSystemDirectoryHandle,
): Promise<'granted' | 'denied' | 'unknown'> {
  return ensureWritePermission(dir)
}

/** 逐级解析相对路径，拿到目录句柄（`create` 时缺失的中间目录会被创建） */
async function resolveDir(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const seg of normalizeRelPath(path)) {
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  return dir
}

/** 解析到**文件**句柄（`path` 最后一段是文件名） */
export async function resolveWorkspaceFile(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
  create = false,
): Promise<FileSystemFileHandle> {
  const segs = normalizeRelPath(path)
  if (segs.length === 0) throw new Error('empty workspace path')
  const dir = await resolveDir(root, segs.slice(0, -1), create)
  return dir.getFileHandle(segs[segs.length - 1], { create })
}

/** 读工作区里的一个 .jps 文本 */
export async function readWorkspaceText(root: FileSystemDirectoryHandle, path: readonly string[]): Promise<string> {
  const fh = await resolveWorkspaceFile(root, path)
  const file = await fh.getFile()
  return file.text()
}

/**
 * 写入工作区里的一个 .jps，并**回读校验**（与桌面写回 `write_external_file` 同一口径：
 * 宁可报错也不谎报已保存）。
 */
export async function writeWorkspaceText(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
  text: string,
): Promise<void> {
  const perm = await ensureWritePermission(root)
  if (perm === 'denied') throw new Error('permission denied')
  const fh = await resolveWorkspaceFile(root, path, true)
  const w = await (fh as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
  await w.write(text)
  await w.close()
  const back = await (await fh.getFile()).text()
  if (back !== text) throw new Error('回读内容与预期不一致')
}

/**
 * 列出某个目录下的**子目录 + .jps 文件**（其它文件忽略：工作区是谱夹，
 * 真机实测的目录里混着几十个无关文件，全列出来反而找不到谱）。
 * 文件修改时间读失败时按 0 处理（不因为一个读不到就整列失败）。
 */
export async function readDirEntries(
  root: FileSystemDirectoryHandle,
  path: readonly string[] = [],
): Promise<DirEntry[]> {
  const dir = await resolveDir(root, path)
  const out: DirEntry[] = []
  for await (const handle of dir.values()) {
    if (handle.kind === 'directory') {
      out.push({ kind: 'dir', name: handle.name, mtime: 0 })
      continue
    }
    if (!isJpsName(handle.name)) continue
    let mtime = 0
    try {
      mtime = (await (handle as FileSystemFileHandle).getFile()).lastModified
    } catch {
      /* 读不到时间不影响列出 */
    }
    out.push({ kind: 'file', name: handle.name, mtime })
  }
  return sortDirEntries(out)
}
