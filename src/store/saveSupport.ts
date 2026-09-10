/**
 * store/saveSupport.ts — 「保存到磁盘」底层支撑（adj363）
 *
 * 纯逻辑模块：只操作传入的 FileSystemFileHandle，不碰 store / React / DOM，
 * 因此可在 Node（scripts/smoke.mts）中用假句柄直接断言失败分类与写回校验。
 *
 * 背景（用户反馈「按保存有时没生效、必须另存为才有效」）：
 *  1. 恢复自 IndexedDB 的句柄在应用重启后写入权限可能失效，`createWritable()` 直接抛
 *     NotAllowedError；旧代码把该失败静默转「另存为」，而 `showSaveFilePicker()` 必须在
 *     **用户手势**内调用——前一次 await 已消耗手势，选择器随即抛 NotAllowedError，
 *     旧代码又把 NotAllowedError 当作「用户取消」静默吞掉 → 按保存毫无反应、文件未变。
 *  2. 写入流程本身没有回读校验：close() 成功不代表磁盘内容就是刚写的内容（写入流被中断、
 *     目标被换走等），用户会看到「已保存」但文件没变。
 *
 * 因此本模块的规则：写入前先查询/申请权限；写入后回读校验；只有 AbortError 才算用户取消。
 */

/** 保存失败分类（决定给用户什么提示、句柄是否断开） */
export type SaveFailKind = 'cancel' | 'permission' | 'gone' | 'busy' | 'verify' | 'unknown'

/** 回读校验失败时抛出的异常名（自定义，便于 classifySaveError 归类） */
const VERIFY_ERROR_NAME = 'SaveVerifyError'

/** 带权限方法的句柄视图（lib.dom 未声明 queryPermission/requestPermission，需自行收窄） */
interface PermissionCapableHandle {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
}

function errorName(e: unknown): string {
  const n = (e as { name?: unknown } | null | undefined)?.name
  return typeof n === 'string' ? n : ''
}

/** 是否用户主动取消（只有 AbortError 才算；NotAllowedError 不算——它是权限/手势问题） */
export function isUserCancel(e: unknown): boolean {
  return errorName(e) === 'AbortError'
}

/**
 * 归类保存失败：
 *  - cancel     用户取消（静默）
 *  - permission 权限失效 / 缺少用户手势（提示重新授权）
 *  - gone       文件已被移动或删除（提示另存为）
 *  - busy       文件被占用/只读/写入流状态非法（提示关闭占用程序）
 *  - verify     写入成功但回读内容不一致（提示另存为，绝不谎报已保存）
 */
export function classifySaveError(e: unknown): SaveFailKind {
  switch (errorName(e)) {
    case 'AbortError':
      return 'cancel'
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission'
    case 'NotFoundError':
      return 'gone'
    case 'NoModificationAllowedError':
    case 'InvalidModificationError':
    case 'InvalidStateError':
    case 'NotReadableError':
      return 'busy'
    case VERIFY_ERROR_NAME:
      return 'verify'
    default:
      return 'unknown'
  }
}

/** 构造一个带标准错误名的异常（避免依赖 DOMException 构造函数） */
export function namedError(name: string, message: string): Error {
  const e = new Error(message)
  e.name = name
  return e
}

/** 去掉 UTF-8 BOM（有的编辑器/系统写入时会带 BOM，比对时忽略） */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** 写入内容与磁盘回读内容是否一致（容忍 BOM） */
export function sameContent(a: string, b: string): boolean {
  return stripBom(a) === stripBom(b)
}

/** 文件名去掉 .jps/.md/.txt 后缀（显示名统一不带扩展名） */
export function fileBaseName(name: string | undefined | null): string {
  return (name || '未命名').replace(/\.(jps|md|txt)$/i, '')
}

/**
 * 确认句柄可写：先 queryPermission，未授权时在**用户手势内** requestPermission。
 * 返回最终状态；环境不支持权限 API 时返回 'unknown'（交给真正的写入判定）。
 * 注意：requestPermission 必须在用户手势（Ctrl+S / 菜单点击）尚未被消耗时调用。
 */
export async function ensureWritePermission(
  handle: FileSystemFileHandle,
): Promise<'granted' | 'denied' | 'unknown'> {
  const h = handle as unknown as PermissionCapableHandle
  if (typeof h.queryPermission !== 'function') return 'unknown'
  let state: PermissionState
  try {
    state = await h.queryPermission({ mode: 'readwrite' })
  } catch {
    return 'unknown'
  }
  if (state === 'granted') return 'granted'
  if (typeof h.requestPermission !== 'function') return 'denied'
  try {
    const asked = await h.requestPermission({ mode: 'readwrite' })
    return asked === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/** 回读磁盘内容做校验；读不到（无读权限等）返回 null 表示「无法校验」，不影响保存结论 */
async function readBack(handle: FileSystemFileHandle): Promise<string | null> {
  try {
    const file = await handle.getFile()
    if (typeof file.text !== 'function') return null
    return await file.text()
  } catch {
    return null
  }
}

/**
 * 写入文本；可选回读校验。
 * 失败时抛原始异常（由 classifySaveError 归类）；`verify` 且内容不一致时抛 name='SaveVerifyError'。
 * 写入中途失败会 abort 写入流——createWritable() 默认在临时文件上写、close() 才替换原文件，
 * abort() 丢弃临时文件，避免原文件被截断成空。
 *
 * verify 默认 **关闭**（adj364）：回读要额外 getFile()+text()，每次保存多一到两次文件系统往返，
 * 用户可感知到保存变慢；写入失败本身会抛异常，因此默认走最快路径，仅诊断时开启。
 */
export async function writeTextToHandle(
  handle: FileSystemFileHandle,
  text: string,
  opts?: { verify?: boolean },
): Promise<void> {
  const w = await handle.createWritable()
  try {
    await w.write(text)
    await w.close()
  } catch (e) {
    try {
      await w.abort()
    } catch {
      /* 写入流已失效时 abort 也会抛，忽略 */
    }
    throw e
  }
  if (!opts?.verify) return
  const back = await readBack(handle)
  if (back !== null && !sameContent(back, text)) {
    throw namedError(VERIFY_ERROR_NAME, '写入后回读内容与预期不一致')
  }
}

/**
 * 保存文本到已有句柄（adj364：最快路径优先）。
 *  1. 直接写——与浏览器原生保存等价的一次往返，不做任何前置权限查询；
 *  2. 仅当**因权限失败**（NotAllowedError/SecurityError：句柄重启后权限失效）时，
 *     才申请一次权限并重试一次（此时通常仍在用户手势窗口内，不会静默失败）；
 *  3. 其余失败原样抛出，由调用方按类型提示。
 * 这样「权限正常」（绝大多数情况）的保存速度与旧版一致，不再为权限检查/回读付代价。
 */
export async function saveTextToHandle(
  handle: FileSystemFileHandle,
  text: string,
  opts?: { verify?: boolean },
): Promise<void> {
  try {
    await writeTextToHandle(handle, text, opts)
  } catch (e) {
    if (classifySaveError(e) !== 'permission') throw e
    const perm = await ensureWritePermission(handle)
    if (perm !== 'granted') throw e
    await writeTextToHandle(handle, text, opts)
  }
}
