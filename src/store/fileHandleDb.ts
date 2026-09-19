/**
 * store/fileHandleDb.ts — 文件句柄 IndexedDB 持久化（adj161）
 *
 * 库名 iJipu（原 jianpuscript）。旧库句柄由 localStorageMigration.ts
 * 在启动时搬运到新库（改名零数据丢失）。
 *
 * File System Access API 的 FileSystemFileHandle 是内存对象，无法存入
 * localStorage；保存/另存后把句柄存入 IndexedDB，应用重启后恢复，
 * 实现「下次按保存直接写入上次保存的文件」，无需重新选文件。
 * 权限状态：恢复的句柄在保存时若权限失效（SecurityError），调用方会
 * 回退到另存为对话框重新授权（浏览器会弹出权限询问）。
 */
const DB_NAME = 'ijipu'
const STORE = 'fileHandle'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 保存当前文件句柄（null 清除） */
export async function saveFileHandle(handle: FileSystemFileHandle | null): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handle, 'last')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* IndexedDB 不可用时静默（退化为仅会话内记忆） */
  }
}

/** 恢复上次保存/打开的文件句柄（无则 null） */
export async function loadFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb()
    const val = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get('last')
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return val
  } catch {
    return null
  }
}

/**
 * adj540：**工作区目录**（Android/移动端「选一个文件夹当工作区」）。
 *
 * 同一个库同一个 store，只是换一个键——目录句柄与文件句柄一样是内存对象，只能存 IndexedDB。
 * 为什么连 `path` 一起存：工作区支持**子目录**（用户要求：能打开子目录里的 .jps），
 * 记住"上次浏览/保存到哪个子目录"，重新打开对话框时能直接落回原处。
 *
 * 为什么存**根句柄 + 相对路径**、而不是存一堆子目录句柄：相对路径是纯数据，
 * 便于持久化/比较/显示（面包屑），而句柄链每次都从根解析（`getDirectoryHandle` 逐级下钻）。
 */
export interface WorkspaceRecord {
  /** 工作区根目录句柄 */
  handle: FileSystemDirectoryHandle
  /** 上次所在的子目录（相对根；`[]` = 根目录本身） */
  path: string[]
}

/** 保存工作区（null 清除） */
export async function saveWorkspace(rec: WorkspaceRecord | null): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(rec, 'workspace')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* IndexedDB 不可用时静默（退化为仅会话内记忆） */
  }
}

/** 恢复工作区（无则 null）；句柄可能已失效/被撤销授权，调用方仍需查权限 */
export async function loadWorkspace(): Promise<WorkspaceRecord | null> {
  try {
    const db = await openDb()
    const val = await new Promise<WorkspaceRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get('workspace')
      req.onsuccess = () => resolve((req.result as WorkspaceRecord | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return val
  } catch {
    return null
  }
}
