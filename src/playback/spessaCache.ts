/**
 * src/playback/spessaCache.ts — SpessaSynth 高质量音源（SF2/SF3 ArrayBuffer）离线缓存（adj331）
 *
 * 音源较大（32MB+），用 IndexedDB 存 ArrayBuffer 实现离线可用（Web / Tauri WebView 均持久化）。
 * 提供下载（prefetchHqLibrary）、查询（hqLibraryCached）、删除。
 */
import { loadHqBank, detectTauri } from './spessaSynthBackend'
import type { HqSampleLibrary } from './spessaSynthBackend'

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
    return (await this.get(id)) != null
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

/** 下载音源库并写入缓存（未缓存则联网下载 ArrayBuffer 存 IndexedDB） */
export async function prefetchHqLibrary(lib: HqSampleLibrary, cache: HqCache): Promise<void> {
  if (await cache.has(lib.id)) return
  const res = await fetch(lib.source)
  if (!res.ok) throw new Error(`音源「${lib.name}」下载失败: HTTP ${res.status}`)
  await cache.save(lib.id, await res.arrayBuffer())
}

/** 查询音源库是否已缓存 */
export async function hqLibraryCached(lib: HqSampleLibrary, cache: HqCache): Promise<boolean> {
  return cache.has(lib.id)
}

/** 创建 SpessaSynth 音源缓存实例（惰性，IndexedDB） */
export function createHqCache(): HqCache {
  return new HqCache()
}

/** 预下载音源库为 ArrayBuffer 并写缓存（adj347/348）：
 *  已缓存直接返回；桌面（Tauri）优先读内置资源（本地找到音色库→直接用）；本地未找到
 *  或 Web 环境则用 fetch 后台下载（浏览器内部线程完成，主线程不逐块处理，尽量不影响 UI），
 *  完成后写入 IndexedDB 缓存，后续可直接用（不再重复下载）。onProgress 仅在结束时回调（0~1）。 */
export async function prefetchHqLibraryProgress(
  lib: HqSampleLibrary,
  cache: HqCache,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
  const hit = await cache.load(lib.id)
  if (hit) {
    onProgress?.(1)
    return hit
  }
  // 桌面：读内置资源（若应用目录已放置独立音色库）→ 缺失则走下方远端下载
  try {
    if (detectTauri()) {
      const bank = await loadHqBank(lib)
      await cache.save(lib.id, bank)
      onProgress?.(1)
      return bank
    }
  } catch {
    /* 本地未找到音源 → 走 Web 流式下载并缓存 */
  }
  // Web：后台下载——await res.arrayBuffer() 由浏览器内部线程完成，主线程不做逐块拼接，尽量不影响 UI
  const res = await fetch(lib.source)
  if (!res.ok) throw new Error(`音源「${lib.name}」下载失败: HTTP ${res.status}`)
  const bank = await res.arrayBuffer()
  await cache.save(lib.id, bank)
  onProgress?.(1)
  return bank
}
