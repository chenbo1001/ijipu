/**
 * store/recentFiles.ts — **最近打开的 .jps 文件**（菜单「最近…」二级菜单的数据源）
 *
 * 需求（用户）：「在菜单文件组中增加一个打开历史二级菜单，二级菜单下为最近 10 个打开过的
 * jps 文件，按从最近到最早的顺序排列」；二级菜单名定为「**最近…**」。
 *
 * 设计要点：
 *  - **按"最近"排序**：每次打开把该条**提到最前**（同一条只留一份），最多保留 10 条。
 *  - **身份 = 工作区 id + 相对路径**：桌面版与网页版都能用同一套键（网页版拿不到磁盘路径）。
 *    这与 `docStore.binding`（`wsId` + `segs`）同源，故"重新打开"就是再走一次 `openWorkspaceFile`。
 *  - **持久化落到已有的 IndexedDB 库**（`ijipu` / `fileHandle` 仓），与最近工作区列表
 *    （`workspaceList`）放在一处、沿用同一套"不可用时静默降级"的写法。
 *  - 记录里冗余存 `wsName` 与 `name`：菜单要显示文件名，工作区被移除时也要能如实提示，
 *    都不能依赖"当前是否正好在那个工作区"。
 */

import { openDb, RECENT_FILES_KEY, RECENT_FILES_MAX, STORE } from './fileHandleDb'

/** 一条"最近打开"记录 */
export interface RecentJpsFile {
  /** 所属工作区身份（与 `WorkspaceRecord.id` 同一值） */
  wsId: string
  /** 工作区名（菜单提示/失效提示用；与 `WorkspaceRecord.name` 同一值） */
  wsName: string
  /** 工作区内的相对路径（最后一段是文件名） */
  segs: string[]
  /** 文件名（不含扩展名；菜单主文本） */
  name: string
  /** 最近一次打开的时间戳（毫秒）——只用于人读/将来排查，排序靠数组顺序 */
  at: number
}

/** 读"最近打开"列表（无则空数组；损坏/不可用时回退空数组，不抛） */
export async function loadRecentFiles(): Promise<RecentJpsFile[]> {
  try {
    const db = await openDb()
    const val = await new Promise<RecentJpsFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(RECENT_FILES_KEY)
      req.onsuccess = () => resolve((req.result as RecentJpsFile[] | undefined) ?? [])
      req.onerror = () => reject(req.error)
    })
    db.close()
    return Array.isArray(val) ? val.filter(isValidRecent) : []
  } catch {
    return []
  }
}

/** 整体写回（内部用；调用方一般走 `recordRecentFile` / `clearRecentFiles`） */
async function saveRecentFiles(list: RecentJpsFile[]): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(list.slice(0, RECENT_FILES_MAX), RECENT_FILES_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* IndexedDB 不可用时静默（退化为"本次会话内不记忆"） */
  }
}

/** 一条记录的合法性（读盘时过滤坏数据，避免用半个记录去打开文件） */
function isValidRecent(r: unknown): r is RecentJpsFile {
  if (!r || typeof r !== 'object') return false
  const o = r as Partial<RecentJpsFile>
  return (
    typeof o.wsId === 'string' &&
    o.wsId !== '' &&
    typeof o.wsName === 'string' &&
    Array.isArray(o.segs) &&
    o.segs.length > 0 &&
    o.segs.every((s) => typeof s === 'string' && s !== '') &&
    typeof o.name === 'string'
  )
}

/** 两条记录是否指向**同一个文件**（身份 = 工作区 id + 相对路径） */
export function sameRecentFile(a: RecentJpsFile, b: Pick<RecentJpsFile, 'wsId' | 'segs'>): boolean {
  return a.wsId === b.wsId && a.segs.length === b.segs.length && a.segs.every((s, i) => s === b.segs[i])
}

/**
 * **把一次打开并入列表**（纯函数，便于 `smoke` 断言，不碰 IndexedDB）。
 *
 * 口径（用户：「按从最近到最早的顺序排列」「最近 10 个」）：
 *  · 同一条（同工作区 + 同相对路径）**只留一份**，并**提到最前**（`at` 刷新）；
 *  · 超过上限**丢弃最旧**的（尾部）。
 */
export function applyOpenToRecent(
  list: readonly RecentJpsFile[],
  rec: Omit<RecentJpsFile, 'at'>,
  at: number,
  max: number = RECENT_FILES_MAX,
): RecentJpsFile[] {
  const rest = list.filter((r) => !sameRecentFile(r, rec))
  return [{ ...rec, at }, ...rest].slice(0, Math.max(0, max))
}

/**
 * **登记一次打开**：把该条提到最前（已存在则先移除旧的同一条），最多保留 `RECENT_FILES_MAX` 条。
 *
 * @returns 登记后的新列表（供菜单立即刷新；不依赖调用方再读一次库）
 */
export async function recordRecentFile(rec: Omit<RecentJpsFile, 'at'>): Promise<RecentJpsFile[]> {
  const next = applyOpenToRecent(await loadRecentFiles(), rec, Date.now())
  await saveRecentFiles(next)
  return next
}

/** 清空"最近打开"列表（菜单里的「清除最近记录」用） */
export async function clearRecentFiles(): Promise<void> {
  await saveRecentFiles([])
}

/**
 * **按记录重新打开那个文件**（菜单「最近…」的点击动作）。
 *
 * 步骤与「工作区面板里切工作区再点文件」同构，只是收敛成一个动作：
 *  ① 若目标不是**当前**工作区 ⇒ 先 `activateWorkspace` 切过去（它会把它提到"最近工作区"最前）；
 *  ② 申请目录权限（网页版句柄可能失效/被拒 ⇒ 如实提示，不静默失败）；
 *  ③ `openWorkspaceFile(segs)` 读文件进编辑器（它内部会记绑定与"上次所在目录"）。
 *
 * @returns 是否成功打开（失败时已给出提示）
 */
export async function openRecentJpsFile(rec: RecentJpsFile): Promise<boolean> {
  const { activateWorkspace, getWorkspace, requestWorkspacePermission } = await import('./workspace')
  const { useDocStore } = await import('./docStore')
  const { useUiStore } = await import('./uiStore')
  const { workspaceCopy } = await import('../brand/copy')

  const ui = useUiStore.getState()
  const cur = await getWorkspace()
  if (cur?.id !== rec.wsId) {
    const next = await activateWorkspace(rec.wsId)
    if (!next) {
      // 工作区已不在"最近工作区"列表里（被移除/换了机器）⇒ 如实说明，并顺手清掉这条失效记录
      ui.showNotice(workspaceCopy.activateFailed(rec.wsName), 'warn')
      await recordRecentFileSurviving(rec)
      return false
    }
    const perm = await requestWorkspacePermission(next)
    if (perm !== 'granted') {
      ui.showNotice(workspaceCopy.activateFailed(next.name), 'warn')
      return false
    }
  } else if (cur) {
    const perm = await requestWorkspacePermission(cur)
    if (perm !== 'granted') {
      ui.showNotice(workspaceCopy.activateFailed(cur.name), 'warn')
      return false
    }
  }
  return useDocStore.getState().openWorkspaceFile(rec.segs)
}

/** 打开失败（工作区已失效）时把该条从"最近"里剔除，避免菜单一直挂着点不开的项 */
async function recordRecentFileSurviving(rec: RecentJpsFile): Promise<void> {
  const list = await loadRecentFiles()
  await saveRecentFiles(list.filter((r) => !sameRecentFile(r, rec)))
}