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
  /**
   * adj544：**工作区身份**（首次选定该目录时生成的稳定 id）。
   *
   * 为什么需要它：`docStore` 里"这份文档绑定在工作区哪个文件"必须能回答"哪个工作区"。
   * 此前绑定只存相对路径，于是**换了工作区后按保存，会把旧相对路径写进新根**
   * （没同名就新建、有同名就覆盖）——静默写错文件（见 E-2026-251）。
   * FSA 不给稳定磁盘路径，所以身份只能自己发一个 id 并随记录落 IndexedDB。
   */
  id: string
  /** 根目录名（`handle.name`；FSA 只给名字，拿不到完整路径）——用于提示与"最近工作区"列表 */
  name: string
  /** 工作区根目录句柄 */
  handle: FileSystemDirectoryHandle
  /** 上次所在的子目录（相对根；`[]` = 根目录本身） */
  path: string[]
}

/** 最近工作区列表上限（超出丢弃最旧的）——只用于"切换回上次那个"，不需要无限增长 */
const RECENT_MAX = 8

/** 保存工作区（null 清除"当前"，但**保留**最近列表） */
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

/**
 * adj544（用户要求 C）：**记住多个工作区**（最近使用的列表，最近在前）。
 *
 * 为什么需要：① 浏览器重启后要能"切回原工作区"继续编辑原文件；
 * ② FSA 拿不到磁盘路径，用户**重新选同一个文件夹**会得到新句柄+新 id——
 * 有了这个列表，"上次那个工作区"仍然可以直接点回去（句柄还能用/只需重新授权），
 * 不必依赖"重新选目录能不能被认成同一个"。
 */
export async function saveWorkspaceList(list: WorkspaceRecord[]): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(list.slice(0, RECENT_MAX), 'workspaceList')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* 静默降级 */
  }
}

/** 读最近工作区列表（无则空数组） */
export async function loadWorkspaceList(): Promise<WorkspaceRecord[]> {
  try {
    const db = await openDb()
    const val = await new Promise<WorkspaceRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get('workspaceList')
      req.onsuccess = () => resolve((req.result as WorkspaceRecord[] | undefined) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return Array.isArray(val) ? val : []
  } catch {
    return []
  }
}
