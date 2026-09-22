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
 *
 * adj568：桌面端改为存**根目录绝对路径**（`dir`）——原生选择器直接给路径，
 * 子目录同理用"根 + 相对段"在 Rust 侧拼（见 `src-tauri/src/lib.rs` 的 `ws_*` 命令）。
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
  /** 根目录名（FSA 只给名字、拿不到完整路径；桌面版取绝对路径的末级目录名）——用于提示与"最近工作区"列表 */
  name: string
  /**
   * 网页版（FSA）的**根目录句柄**——浏览器不给磁盘路径，句柄是内存对象，只能存 IndexedDB。
   * adj568 起与 `dir` **二选一**（桌面版走 `dir`，此处为 undefined）。
   */
  handle?: FileSystemDirectoryHandle
  /**
   * adj568：**桌面版的根目录绝对路径**。
   *
   * 为什么桌面端要改用路径：Chromium 把「下载 / 桌面 / 文档 / 用户主目录」**整个目录**
   * 列入敏感目录黑名单（`chrome_file_system_access_permission_context.cc` 的 `GenerateBlockPaths()`，
   * BlockType = `kDontBlockChildren`），于是"把「下载」直接设为工作区"在网页层**必然被拒**，
   * 且没有 API 可绕过、报错还与"用户取消"同为一个 `AbortError`（见 E-2026-271）。
   * 桌面壳用**原生选择器**拿路径、用 Rust `std::fs` 读写，既绕开这条 Web 安全策略，
   * 也顺带省掉"重开应用要重新授权目录"这一步。
   */
  dir?: string
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

/**
 * adj546（用户实测：5550 文件 / 117 目录的工作区，`*` 过滤在手机上 27 秒）：
 * **把"全工作区 .jps 索引"落盘**——第一次扫描仍然要那几十秒，但**之后每次过滤都是秒开**
 * （先在内存/库里查，再后台重扫刷新）。
 *
 * 只存**相对路径字符串**（`a/b/c.jps`）：5550 条约 200KB，比存对象小得多；
 * 读出来再 `split('/')` 还原成 `SearchHit`。带 `wsId` 与时间戳，换工作区/太旧就不采用。
 *
 * adj580（用户反馈）：过滤范围改成"**当前目录及其下级**" ⇒ 索引也要**按目录分别缓存**，
 * 于是多一个 `from`（索引起始目录，工作区内相对路径，`''` = 整个工作区）。
 * 读取时 `from` 必须一致才采用（旧记录没有这个字段 ⇒ 只当作"整个工作区"的索引）。
 */
export interface CachedIndex {
  wsId: string
  /** adj580：这份索引覆盖的**起始目录**（工作区内相对路径；`''` = 整个工作区） */
  from: string
  at: number
  /** 区内相对路径（含文件名），如 `2.曲谱集/小星星.jps` */
  relPaths: string[]
}

/**
 * adj590（用户反馈"切换工作区后，新的工作区好像没有索引"）：索引**按工作区各存一份**。
 *
 * 此前固定存一个键 `'workspaceIndex'`（值里带 `wsId`）⇒ 换工作区就把上一个的索引**覆盖**了，
 * 切回去只能整树重扫（真机 20s 量级），用户看到的现象正是"新工作区没有索引 / 老工作区也得重扫"。
 *
 * 现在用**数组键** `['workspaceIndex', at, wsId]`：
 *  · 键里带 `at` ⇒ 清理时只读键就能按新旧排序（不必把上百 KB 的 `relPaths` 都读出来）；
 *  · 键里带 `wsId` ⇒ 每个工作区各存一份，来回切都是秒开；
 *  · 只保留最近 `INDEX_KEEP` 份（单份 ≈ 百 KB 量级；够"几个工作区来回切"，也不会无限长大）。
 * 旧的字符串键照旧能读（迁移：命中即用，下次保存就落到新键上）。
 */
const INDEX_KEY = 'workspaceIndex'
const INDEX_KEEP = 3

/** 索引键（数组键：`[前缀, 时间戳, 工作区id]`） */
type IndexKey = [typeof INDEX_KEY, number, string]
const isIndexKey = (k: IDBValidKey): k is IndexKey => Array.isArray(k) && k[0] === INDEX_KEY && typeof k[2] === 'string'

function getAllKeysOf(db: IDBDatabase): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getValue<T>(db: IDBDatabase, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

/** 索引按工作区各存一份；顺手清掉该工作区的旧记录，并把总份数收在 `INDEX_KEEP` 以内 */
export async function saveWorkspaceIndex(idx: CachedIndex): Promise<void> {
  try {
    const db = await openDb()
    const key: IndexKey = [INDEX_KEY, idx.at, idx.wsId]
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(idx, key)
      // 同一个工作区只留最新一份：键里带时间，同 wsId 的旧键直接删
      const keysReq = store.getAllKeys()
      keysReq.onsuccess = () => {
        for (const k of keysReq.result) {
          if (isIndexKey(k) && k[2] === idx.wsId && k[1] !== idx.at) store.delete(k)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    // 超出保留份数的（最旧的先走）——只读键，不读值
    const keys = (await getAllKeysOf(db)).filter(isIndexKey)
    if (keys.length > INDEX_KEEP) {
      keys.sort((a, b) => b[1] - a[1])
      const drop = keys.slice(INDEX_KEEP)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        for (const k of drop) tx.objectStore(STORE).delete(k)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    }
    db.close()
  } catch {
    /* 静默降级（下次照旧全量扫） */
  }
}

/** 读某个工作区的索引（没有 / 身份或**范围**不符 / 格式不对 ⇒ null）；兼容旧的单槽键 */
export async function loadWorkspaceIndex(wsId: string, from = ''): Promise<CachedIndex | null> {
  try {
    const db = await openDb()
    const mine = (await getAllKeysOf(db)).filter((k): k is IndexKey => isIndexKey(k) && k[2] === wsId)
    mine.sort((a, b) => b[1] - a[1])
    let val = mine.length > 0 ? await getValue<CachedIndex>(db, mine[0]) : undefined
    if (!val) {
      // adj590：兼容 adj546~589 那份"单个键"的记录（迁移路径：命中即用，下次保存落到新键）
      const legacy = await getValue<CachedIndex>(db, INDEX_KEY)
      if (legacy && legacy.wsId === wsId) val = legacy
    }
    db.close()
    // adj580：`from` 也要对得上——旧记录没有该字段（`undefined`）⇒ 只认"整个工作区"这一种范围
    if (!val || val.wsId !== wsId || (val.from ?? '') !== from || !Array.isArray(val.relPaths)) return null
    return val
  } catch {
    return null
  }
}
