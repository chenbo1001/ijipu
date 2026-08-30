/**
 * store/localStorageMigration.ts — 品牌重命名数据迁移（jianpuscript → iJipu）
 *
 * v0.5.0 曾刻意保留 `jianpuscript.` 前缀以「零数据迁移、零兼容破坏」；
 * 本次彻底改名 ijipu 后，需把 localStorage 旧前缀键与 IndexedDB 旧库的
 * 文件句柄搬运到新前缀/新库，否则老用户草稿 / 页面配置 / 主题 / 缩放 /
 * 文件授权全部读不到（读新键返回默认值）。
 *
 * 安装要点：
 * - 被 docStore / uiStore 副作用 import，且放在 store 文件所有 import 的最前，
 *   以保证在「store 读取 localStorage」（loadDraft / loadTheme / loadNum 等）
 *   之前执行搬运 —— ES module 保证依赖模块的顶层语句先于本模块顶层语句运行。
 * - 迁移为幂等一次性：搬运后删除旧键 / 旧库，下次刷新无旧数据可搬即无事发生。
 * - 本模块只做搬运，不 import 任何 store（避免循环依赖），纯 Web API。
 *
 * 注意：`.jps` 后缀作为格式标识保持不动（改名时明确保留）。
 */
const OLD_PREFIX = 'jianpuscript.'
const NEW_PREFIX = 'ijipu.'

/** 迁移 localStorage：jianpuscript.* → ijipu.*，搬运后删除旧键（幂等） */
function migrateLocalStorage(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(OLD_PREFIX)) continue
      const newKey = NEW_PREFIX + key.slice(OLD_PREFIX.length)
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(key)!)
      }
      localStorage.removeItem(key)
    }
  } catch {
    /* 存储不可用时静默（跳过迁移，读新键回退默认值） */
  }
}

/** 迁移 IndexedDB 文件句柄：jianpuscript 库 → ijipu 库（幂等；write 成功才删旧库） */
function migrateFileHandleDb(): Promise<void> {
  const OLD_DB = 'jianpuscript'
  const NEW_DB = 'ijipu'
  const STORE = 'fileHandle'
  return new Promise((resolve) => {
    const fail = () => resolve()
    try {
      const openReq = indexedDB.open(OLD_DB, 1)
      openReq.onupgradeneeded = () => {
        /* 旧库不存在 / 首次打开——无迁移数据，直接走 new 库 */
      }
      openReq.onsuccess = () => {
        const oldDb = openReq.result
        if (!oldDb.objectStoreNames.contains(STORE)) {
          oldDb.close()
          indexedDB.deleteDatabase(OLD_DB)
          resolve()
          return
        }
        const tx = oldDb.transaction(STORE, 'readonly')
        const getReq = tx.objectStore(STORE).get('last')
        getReq.onsuccess = () => {
          const handle = getReq.result as FileSystemFileHandle | undefined
          oldDb.close()
          if (!handle) {
            indexedDB.deleteDatabase(OLD_DB)
            resolve()
            return
          }
          // 把句柄写入新库；FileSystemFileHandle 为可结构化克隆对象，可跨库重存
          const newOpenReq = indexedDB.open(NEW_DB, 1)
          newOpenReq.onupgradeneeded = () => {
            const db = newOpenReq.result
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
          }
          newOpenReq.onsuccess = () => {
            const newDb = newOpenReq.result
            const wtx = newDb.transaction(STORE, 'readwrite')
            wtx.objectStore(STORE).put(handle, 'last')
            wtx.oncomplete = () => {
              newDb.close()
              indexedDB.deleteDatabase(OLD_DB)
              resolve()
            }
            wtx.onerror = () => {
              newDb.close()
              resolve() // 写新库失败：保留旧库更安全（下次刷新重试）
            }
          }
          newOpenReq.onerror = fail
        }
        getReq.onerror = () => {
          oldDb.close()
          resolve()
        }
      }
      openReq.onerror = fail
    } catch {
      fail()
    }
  })
}

// 同步执行 localStorage 迁移；IndexedDB 迁移为异步，fire-and-forget
migrateLocalStorage()
void migrateFileHandleDb()
