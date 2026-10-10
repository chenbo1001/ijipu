/**
 * src/playback/spessaCache.ts — SpessaSynth 高质量音源（SF2/SF3 ArrayBuffer）离线缓存（adj331）
 *
 * 音源较大（32MB+），用 IndexedDB 存 ArrayBuffer 实现离线可用（Web / Tauri WebView 均持久化）。
 * 提供解析（resolveHqBank）、预取（prefetchHqLibraryProgress）、删除。
 * adj416：桌面端音源随安装包内置在**安装目录**（`generaluser_gs.sf2`）——直接读文件、
 * 不写 IndexedDB（不重复占 30MB），也不显示「正在下载」提示；Web 端仍走远端下载 + 缓存。
 */
import { loadHqBank, loadBuiltinBank, hasBuiltinBank } from './spessaSynthBackend'
import { planHqBankLoad } from '@ijipu/engine'
import type { HqSampleLibrary } from './spessaSynthBackend'

/** 音源来源（adj416）：builtin=安装目录随包内置（桌面直读）；cache=IndexedDB 缓存；remote=联网下载 */
export type HqBankSource = 'builtin' | 'cache' | 'remote'

/** SF2/SF3 ArrayBuffer 缓存（IndexedDB，键=库 id） */
export class HqCache {
  private db: IDBDatabase | null = null
  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db)
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ijipu-soundfonts-hq', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('banks')) req.result.createObjectStore('banks')
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    })
  }
  private get(id: string): Promise<ArrayBuffer | null> {
    return this.open().then(
      (db) =>
        new Promise<ArrayBuffer | null>((resolve) => {
          const r = db.transaction('banks', 'readonly').objectStore('banks').get(id)
          r.onsuccess = () => resolve(r.result instanceof ArrayBuffer ? r.result : null)
          r.onerror = () => resolve(null)
        }),
    )
  }
  async load(id: string): Promise<ArrayBuffer | null> {
    return this.get(id)
  }
  async has(id: string): Promise<boolean> {
    // 极快：只查键是否存在（getKey，不读全量 32MB）
    const db = await this.open()
    return new Promise<boolean>((resolve) => {
      const r = db.transaction('banks', 'readonly').objectStore('banks').getKey(id)
      r.onsuccess = () => resolve(r.result !== undefined)
      r.onerror = () => resolve(false)
    })
  }
  async save(id: string, ab: ArrayBuffer): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('banks', 'readwrite')
      tx.objectStore('banks').put(ab, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  async remove(id: string): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('banks', 'readwrite')
      tx.objectStore('banks').delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

/** 取音源字节 + 来源（adj416，adj729 增补宿主来源）：
 *  **宿主（插件目录文件）→ IndexedDB 缓存 → 桌面安装目录内置 → 联网下载**。
 *  只有**下载**的结果才写缓存（内置文件已在安装目录，再存一份 30MB 纯属浪费；缓存优先则保留用户导入的音色）。
 *
 *  adj729（用户要求）：嵌入版里宿主会把"插件目录里的音源文件"以 URL 形式给出来
 *  （`hostBridge().bankUrl(id)`）——那是**唯一权威副本**（下载/导入后都放那儿，随文库一起走），
 *  所以放在第一位；取不到（宿主还没这份文件）再走应用自己的老路径。 */
export async function resolveHqBank(
  lib: HqSampleLibrary,
  cache: HqCache,
  hostUrl?: string,
): Promise<{ bank: ArrayBuffer; source: HqBankSource | 'host' }> {
  if (hostUrl) {
    try {
      const res = await fetch(hostUrl)
      if (res.ok) {
        const bank = await res.arrayBuffer()
        if (bank.byteLength > 0) return { bank, source: 'host' }
      }
      // 404 / 空文件 ⇒ 宿主还没这份音源，继续走下面的老路径
    } catch {
      /* 宿主不可达 ⇒ 同样继续 */
    }
  }
  /**
   * adj760（清单 B3）：**顺序由引擎 `planHqBankLoad` 统一决定** ——
   * 应用这边"用户导入的音源"落在 **IndexedDB 缓存**里（`cache`），随包内置的那份是 `builtin`
   * ⇒ 传 `{cache, builtin}` 得到的正是既有行为（缓存 → 内置 → 下载）。
   */
  const cached = await cache.load(lib.id)
  const builtin = cached ? null : await loadBuiltinBank(lib)
  const plan = planHqBankLoad({ cache: !!cached, builtin: !!builtin })
  if (plan === 'cache' && cached) return { bank: cached, source: 'cache' }
  if (plan === 'builtin' && builtin) return { bank: builtin, source: 'builtin' }
  const bank = await loadHqBank(lib)
  await cache.save(lib.id, bank)
  return { bank, source: 'remote' }
}

/** 创建 SpessaSynth 音源缓存实例（惰性，IndexedDB） */
export function createHqCache(): HqCache {
  return new HqCache()
}

/** 预取音源并返回其来源（adj347/348/349/416）：已缓存用 getKey 极快判断；桌面**只探测**
 *  安装目录内置音源的存在性（不读 30MB、不写缓存）；都没有才联网下载并写缓存。
 *  onProgress 仅结束时回调（0~1）。返回来源供 UI 决定是否显示「正在下载」提示。 */
export async function prefetchHqLibraryProgress(
  lib: HqSampleLibrary,
  cache: HqCache,
  onProgress?: (p: number) => void,
): Promise<HqBankSource> {
  // 极快：只查键是否存在（getKey，不读 32MB 全量）
  if (await cache.has(lib.id)) {
    onProgress?.(1)
    return 'cache'
  }
  // 桌面：随包内置（安装目录 generaluser_gs.sf2）→ 直接可用，无需下载
  if (await hasBuiltinBank(lib)) {
    onProgress?.(1)
    return 'builtin'
  }
  // Web（或桌面未随包提供）：后台下载——await res.arrayBuffer() 由浏览器内部线程完成，
  // 主线程不做逐块拼接，尽量不影响 UI
  const bank = await loadHqBank(lib)
  await cache.save(lib.id, bank)
  onProgress?.(1)
  return 'remote'
}
