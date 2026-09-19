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

/**
 * adj540（用户要求）：是否"隐藏条目"——**名字以 `.` 开头**。
 *
 * 为什么列表与过滤都要跳过：用户的谱夹旁边常混着 `.git`、`.obsidian`、`.trash`、`.thumbnails`
 * 这类系统目录（还有 `.DS_Store` 之类文件），它们既不是谱、数量还多（会把递归过滤的配额吃光），
 * 列出来只会干扰"找谱"。这与系统文件管理器"默认不显示隐藏文件"的口径一致。
 */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

/** 上一级目录（根目录再上一级仍是根：`[]`） */
export function parentPath(segs: readonly string[]): string[] {
  return segs.slice(0, Math.max(0, segs.length - 1))
}

/**
 * 把 **glob**（`*` = 任意串、`?` = 单个字符）转成正则源码片段（纯函数）。
 * 其它字符一律转义——尤其是 `.`：查询里写 `小星星.jps` 时那个点是**字面点**，不能当"任意字符"。
 */
export function globToRegexSource(glob: string): string {
  return glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
}

/**
 * adj540：过滤匹配（纯函数）——**大小写不敏感**，同时看文件名与相对路径
 * （于是「练习」能命中 `2.曲谱集/练习曲/小星星.jps`，符合"在工作区里找谱"的直觉）。
 *
 * 两种口径（用户要求支持通配符）：
 *  · **不含 `*` `?`** ⇒ 子串匹配（最好用，`星星` 就能找到 `小星星.jps`）；
 *  · **含 `*` `?`** ⇒ 当 glob 用（`小星*`、`*练习*`、`第?课`），此时**从头尾匹配**（`小星*` 不会命中
 *    `我的小星星.jps`——用户既然写了通配符，就按他给的形状来）。
 * 空白查询返回 `true`（不过滤）。
 */
export function matchesQuery(name: string, relPath: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const targets = [name.toLowerCase(), relPath.toLowerCase()]
  if (!/[*?]/.test(q)) return targets.some((t) => t.includes(q))
  const re = new RegExp(`^${globToRegexSource(q)}$`)
  return targets.some((t) => re.test(t))
}

/** 扁平搜索结果：一个 `.jps` 的位置与显示名（`relPath` 用于告诉用户它在哪个子目录下） */
export interface SearchHit {
  /** 文件名（含 `.jps`） */
  name: string
  /** 工作区内的相对路径（含文件名；用于显示与打开） */
  relPath: string
  /** 所在目录的相对段（打开时用它拼路径） */
  dirSegs: string[]
}

/** 搜索结果 + **是否被上限截断**（截断必须让用户看见，否则就成了"我的文件不见了"） */
export interface SearchResult {
  hits: SearchHit[]
  /** true = 因深度/条目/命中数上限而**没搜完**（"没搜到"与"没搜完"对用户是两件事） */
  truncated: boolean
}

/**
 * adj540（用户要求）：把**整个工作区（含所有子目录）**里符合条件的 `.jps` 收成一个**平坦列表**，
 * 供"过滤即快速打开"用——层级浏览适合整理，找某一份谱还是平坦列表快。
 *
 * 防呆（真实目录可能很大）：限制**深度**（默认 10 层）、**访问条目数**（默认 5000）、**命中数**（默认 500）；
 * 某一层读不动（权限/竞态）就跳过该层，而不是整次搜索失败。
 * ⚠️ 因为上限提前结束时返回 `truncated: true`，调用方**必须**把这个事实告诉用户
 * （否则用户会以为"工作区里就没有这些谱"）。
 */
export async function searchWorkspaceJps(
  root: FileSystemDirectoryHandle,
  query: string,
  limits: { maxDepth?: number; maxEntries?: number; maxHits?: number } = {},
): Promise<SearchResult> {
  const maxDepth = limits.maxDepth ?? 10
  const maxEntries = limits.maxEntries ?? 5000
  const maxHits = limits.maxHits ?? 500
  const hits: SearchHit[] = []
  let visited = 0
  let truncated = false
  /** 是否已达上限（达到即置 `truncated`，让调用方能把"没搜完"说出来） */
  const limited = (): boolean => {
    if (hits.length >= maxHits || visited >= maxEntries) {
      truncated = true
      return true
    }
    return false
  }
  const walk = async (dir: FileSystemDirectoryHandle, dirSegs: string[], depth: number): Promise<void> => {
    if (depth > maxDepth) {
      truncated = true
      return
    }
    if (limited()) return
    let children: FileSystemHandle[] = []
    try {
      for await (const h of dir.values()) children.push(h)
    } catch {
      return // 某一层读不动就跳过，不影响其它目录
    }
    for (const h of children) {
      if (limited()) return
      visited++
      // adj540（用户要求）：**跳过 `.` 开头的条目**（`.git`/`.obsidian`/`.trash` 这类系统目录
      // 既不是谱又会把配额吃光；隐藏条目一律不进结果）
      if (isHiddenName(h.name)) continue
      if (h.kind === 'directory') {
        await walk(h as FileSystemDirectoryHandle, [...dirSegs, h.name], depth + 1)
        continue
      }
      if (!isJpsName(h.name)) continue
      const relPath = joinPath([...dirSegs, h.name])
      if (!matchesQuery(h.name, relPath, query)) continue
      hits.push({ name: h.name, relPath, dirSegs })
    }
  }
  await walk(root, [], 1)
  return { hits, truncated }
}

/**
 * 条目名是否合法（纯函数，新建/重命名时校验）：
 * 不能为空、不能含路径分隔符（`/` `\`）或 `..`、不能含控制字符、长度 ≤ 80。
 * 这些字符在 FSA 里本就非法（`getFileHandle` 会抛），但**先在 UI 拦住**才能给出人话提示。
 */
export function isValidEntryName(name: string): boolean {
  const n = name.trim()
  if (n.length === 0 || n.length > 80) return false
  if (n === '.' || n === '..') return false
  if (/[/\\]/.test(n)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(n)) return false
  return true
}

/** 去掉 `.jps` 后缀（新建/另存时把用户输入的名字补成 `xxx.jps`，避免出现 `a.jps.jps`） */
export function stripJpsExt(name: string): string {
  return isJpsName(name) ? name.slice(0, name.length - 4) : name
}

/** 某个名字在目录里是否已被占用（文件或目录都算；用于"重名就明确报错而不是静默覆盖"） */
export async function hasEntry(
  root: FileSystemDirectoryHandle,
  dirPath: readonly string[],
  name: string,
): Promise<boolean> {
  const dir = await resolveDir(root, dirPath)
  for await (const h of dir.values()) if (h.name === name) return true
  return false
}

/** 目录是否**完全为空**（列**所有**条目，不只看 `.jps`——删目录前必须确认真空） */
export async function isDirEmpty(root: FileSystemDirectoryHandle, path: readonly string[]): Promise<boolean> {
  const dir = await resolveDir(root, path)
  for await (const _ of dir.values()) return false
  return true
}

/** 新建子目录（同名已存在 ⇒ 抛错，交给调用方提示；不静默复用） */
export async function createSubdir(
  root: FileSystemDirectoryHandle,
  dirPath: readonly string[],
  name: string,
): Promise<void> {
  if (await hasEntry(root, dirPath, name)) throw new Error('EXISTS')
  const dir = await resolveDir(root, dirPath)
  await dir.getDirectoryHandle(name, { create: true })
}

/** 新建（或写入）一个 `.jps`（同名已存在 ⇒ 抛错，避免"另存"覆盖已有谱） */
export async function createFile(
  root: FileSystemDirectoryHandle,
  dirPath: readonly string[],
  name: string,
  text: string,
): Promise<void> {
  if (await hasEntry(root, dirPath, name)) throw new Error('EXISTS')
  await writeWorkspaceText(root, [...dirPath, name], text)
}

/** 删除一个文件 */
export async function removeFile(root: FileSystemDirectoryHandle, path: readonly string[]): Promise<void> {
  const segs = normalizeRelPath(path)
  if (segs.length === 0) throw new Error('empty path')
  const dir = await resolveDir(root, segs.slice(0, -1))
  await dir.removeEntry(segs[segs.length - 1])
}

/**
 * 删除一个目录——**仅当它为空**。
 * 为什么不做递归删除：工作区是用户自己的文件夹，里面可能混着照片/文档等**非 .jps**的东西，
 * `removeEntry(name, {recursive:true})` 会一起抹掉，且 **FSA 没有回收站、删了就没了**。
 * 非空时抛 `NOT_EMPTY`，由 UI 给明确提示（而不是"删了但没反应"）。
 */
export async function removeEmptyDir(
  root: FileSystemDirectoryHandle,
  dirPath: readonly string[],
  name: string,
): Promise<void> {
  const target = [...normalizeRelPath(dirPath), name]
  if (!(await isDirEmpty(root, target))) throw new Error('NOT_EMPTY')
  const dir = await resolveDir(root, normalizeRelPath(dirPath))
  await dir.removeEntry(name)
}

/**
 * **重命名/移动一个 `.jps` 的公共实现**：读出 → 写到新位置 → **确认新文件内容与原文一致** → 才删原文件。
 *
 * 为什么不用 `FileSystemHandle.move()`：本机与规范都确认 **`move()` 目前只对 OPFS 生效**，
 * 用户选中的目录上不可用（非 OPFS 的移动还停在 WICG 提案：
 * https://github.com/whatwg/fs/blob/main/proposals/MovingNonOpfsFiles.md）。
 * 于是只能"复制 + 删除"——而**顺序必须是"先确认新文件正确、再删旧的"**：中途失败宁可留下重复文件，
 * 也不能出现"两个都没了"。`.jps` 是纯文本、体积小，这条路安全。
 */
async function transferFile(
  root: FileSystemDirectoryHandle,
  fromSegs: readonly string[],
  toSegs: readonly string[],
): Promise<void> {
  const from = normalizeRelPath(fromSegs)
  const to = normalizeRelPath(toSegs)
  if (from.length === 0 || to.length === 0) throw new Error('empty path')
  if (joinPath(from) === joinPath(to)) return
  if (await hasEntry(root, to.slice(0, -1), to[to.length - 1])) throw new Error('EXISTS')
  const text = await readWorkspaceText(root, from)
  await writeWorkspaceText(root, to, text) // 内部已做写入后回读校验
  const back = await readWorkspaceText(root, to)
  if (back !== text) throw new Error('VERIFY') // 双保险：不一致就**不删原文件**
  await removeFile(root, from)
}

/** 重命名（同目录换名） */
export async function renameFile(
  root: FileSystemDirectoryHandle,
  dirPath: readonly string[],
  fromName: string,
  toName: string,
): Promise<void> {
  const dir = normalizeRelPath(dirPath)
  await transferFile(root, [...dir, fromName], [...dir, toName])
}

/** 移动到另一个目录（同名） */
export async function moveFile(
  root: FileSystemDirectoryHandle,
  fromSegs: readonly string[],
  toDirSegs: readonly string[],
): Promise<void> {
  const from = normalizeRelPath(fromSegs)
  if (from.length === 0) throw new Error('empty path')
  await transferFile(root, from, [...normalizeRelPath(toDirSegs), from[from.length - 1]])
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
    // adj540（用户要求）：列表也**跳过 `.` 开头的条目**（与过滤口径一致，见 isHiddenName）
    if (isHiddenName(handle.name)) continue
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
