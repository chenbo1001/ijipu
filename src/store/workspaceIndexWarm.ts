/**
 * store/workspaceIndexWarm.ts — 工作区索引的**启动后台预热**（adj599，用户要求）
 *
 * 用户口径（原话）："对于工作区的文档索引缓存，可以在打开网站后就在后台异步进行，对历史工作区的
 * 目录进行索引缓存，先当前工作区，再其它工作区，这样在用户点击工作区时，基本就已索引完成，
 * 当然对于新工作区，就只能立即索引缓存，这没法的事。"
 *
 * 落地口径：
 *  · **空闲再动手**（`requestIdleCallback`，不可用退回定时）——不抢首屏；
 *  · **当前工作区优先**，其余按"最近工作区"列表顺序（`listWorkspaces()` 已是最近在前）；
 *  · 逐个工作区**串行**扫（`searchWorkspaceJps` 内部已有并发 8；同时扫两个工作区只会互相抢 IO）；
 *  · 已有**新鲜**落盘索引（`≤ INDEX_STALE_MS`）的直接跳过，不重复扫；过期/没有才扫并落盘；
 *  · **只在已授权时扫**：浏览器里 `queryWorkspacePermission` 返回 `prompt`/`denied` 一律跳过——
 *    `requestPermission` 必须由**用户手势**触发，启动时静默调用会被浏览器拒绝（E-2026-... 同类）；
 *    桌面路径后端没有"授权"这回事，只有"目录还在不在"。
 *  · 期间用户改了文件（写操作会调 `markWorkspaceDataChanged()`）⇒ **本次结果作废、不落盘**，
 *    但循环继续做剩下的工作区（否则用户开一次面板就把整轮预热掐断）；
 *  · 全程**不弹提示**，只 `console.info` 一行——启动时弹一串"索引完成"是噪声。
 *
 * **新工作区**（用户刚选的目录）不在这里预热：它只能当场扫（用户已确认"这没办法的事"），
 * 由 `WorkspacePanel` 的 `ensureIndexFresh()` 负责。
 *
 * 纯逻辑（无 React），面板只借用两件事：`INDEX_STALE_MS`（唯一常量）与
 * `getInflightWarmScan()`（同一个工作区正在预热时复用它，避免叠一份枚举）。
 */
import {
  getWorkspace,
  listWorkspaces,
  queryWorkspacePermission,
  searchWorkspaceJps,
  type SearchResult,
} from './workspace'
import type { WorkspaceRecord } from './fileHandleDb'
import { loadWorkspaceIndex, saveWorkspaceIndex } from './fileHandleDb'

/**
 * 索引"够新鲜"的时限（adj589 引入，adj599 移到本模块**唯一维护**——
 * 面板与预热共用同一个常量，避免"同一常量两处各写一个"漂移）。
 */
export const INDEX_STALE_MS = 30 * 60 * 1000

/** 单次扫描的上限（与面板 `runScan` 同口径：命中 2 万、条目 20 万） */
const WARM_MAX_HITS = 20000
const WARM_MAX_ENTRIES = 200000

/** 全局代际：写操作后 +1 ⇒ 正在跑的预热结果作废（不落盘） */
let gen = 0
/** 正在预热的工作区（`wsId` → 那次扫描的诺言）——面板可复用，避免同一工作区扫两遍 */
const inflight = new Map<string, Promise<SearchResult>>()
/** 是否已经启动过（幂等） */
let started = false

/** 写操作（改名/新建/另存/移动/删除/重扫）之后调用：作废正在跑的预热结果 */
export function markWorkspaceDataChanged(): void {
  gen += 1
}

/**
 * 取某个工作区**正在进行的预热扫描**（没有则 `null`）。
 * 面板的 `runScan` 用它复用同一次枚举——同一份数据没必要跑两遍（E-2026-277 同类教训）。
 */
export function getInflightWarmScan(wsId: string): Promise<SearchResult> | null {
  return inflight.get(wsId) ?? null
}

/** 空闲时执行（不可用退回 1.5s 定时——两者都有"先让当前帧画完"的效果） */
function onIdle(cb: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof ric === 'function') ric(cb, { timeout: 5000 })
  else window.setTimeout(cb, 1500)
}

/** 让出主线程一拍（工作区之间用，避免连续枚举把输入卡住） */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

/** 工作区的可读标识（日志用；路径后端显示路径、FSA 显示目录名） */
function labelOf(rec: WorkspaceRecord): string {
  return rec.dir ?? rec.name ?? rec.id
}

/**
 * 为**一个**工作区把索引准备好（跳过新鲜的 / 没授权的）。
 * `myGen` 是本次开始时的代际：若期间发生过写操作（`gen` 变大）⇒ 结果不可信，**不落盘**。
 * 返回"这个工作区现在是否已有可用索引"（仅用于日志统计）。
 */
async function warmOne(rec: WorkspaceRecord, myGen: number): Promise<boolean> {
  /**
   * 权限门槛：**`prompt` 一律跳过**（`requestPermission` 必须由用户手势触发，启动时静默申请会被拒绝）；
   * `unknown` 则**照试**——它表示环境没有 `queryPermission` 可问（读目录本身不会弹窗，
   * 状态不对只会抛 `NotAllowedError`，下面 catch 掉就是）；`denied`（目录已不在）也跳过。
   */
  const perm = await queryWorkspacePermission(rec)
  if (perm === 'denied' || perm === 'prompt') return false
  const cached = await loadWorkspaceIndex(rec.id, '')
  if (cached && cached.relPaths.length > 0 && Date.now() - (cached.at ?? 0) <= INDEX_STALE_MS) return true

  const t0 = Date.now()
  const p = searchWorkspaceJps(rec, '', { maxHits: WARM_MAX_HITS, maxEntries: WARM_MAX_ENTRIES, preferFirst: [] })
  inflight.set(rec.id, p)
  try {
    const r = await p
    if (myGen !== gen) return false // 扫描期间动过文件 ⇒ 这份结果不代表磁盘现状
    await saveWorkspaceIndex({ wsId: rec.id, from: '', at: Date.now(), relPaths: r.hits.map((h) => h.relPath) })
    console.info(
      `[iJipu] 后台预热索引：${labelOf(rec)} → 扫描 ${r.scanned} 项 / 命中 ${r.hits.length} 个 / ${Date.now() - t0}ms`,
    )
    return true
  } catch {
    // 失败（句柄失效 / 目录被删 / 权限被撤）就跳过：用户真去点它时面板会如实提示
    return false
  } finally {
    inflight.delete(rec.id)
  }
}

/**
 * 启动后台预热（**幂等**：重复调用只跑第一次）。
 * 在 `App` 挂载时调一次即可。
 */
export function startWorkspaceIndexWarmup(): void {
  if (started) return
  started = true
  onIdle(() => {
    void (async () => {
      try {
        const cur = await getWorkspace()
        const list = await listWorkspaces()
        // 当前工作区优先；其余按"最近在前"的顺序（列表里已包含当前那个，去重）
        const ordered: WorkspaceRecord[] = [...(cur ? [cur] : []), ...list.filter((r) => r.id !== cur?.id)]
        if (ordered.length === 0) return
        for (const rec of ordered) {
          const myGen = gen // 每个工作区取当时的代际：一次写操作只作废"正在跑的那一个"
          const ready = await warmOne(rec, myGen)
          console.info(`[iJipu] 后台预热：${labelOf(rec)} ${ready ? '已就绪' : '跳过（未授权 / 失败 / 结果作废）'}`)
          await yieldToMain()
        }
      } catch {
        /* 预热是尽力而为：任何意外都不该影响应用启动 */
      }
    })()
  })
}
