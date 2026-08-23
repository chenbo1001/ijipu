/**
 * store/fileHandleDb.ts — 文件句柄 IndexedDB 持久化（adj161）
 *
 * File System Access API 的 FileSystemFileHandle 是内存对象，无法存入
 * localStorage；保存/另存后把句柄存入 IndexedDB，应用重启后恢复，
 * 实现「下次按保存直接写入上次保存的文件」，无需重新选文件。
 * 权限状态：恢复的句柄在保存时若权限失效（SecurityError），调用方会
 * 回退到另存为对话框重新授权（浏览器会弹出权限询问）。
 */
const DB_NAME = 'jianpuscript'
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
