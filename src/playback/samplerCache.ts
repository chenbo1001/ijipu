/**
 * src/playback/samplerCache.ts — 采样音色库离线缓存实现（浏览器 IndexedDB + Tauri 文件系统，adj323）
 *
 * 实现 engine 的 SamplerCache 接口：
 *  - 桌面 Tauri（window.__TAURI__ 存在）→ 读写应用数据目录（soundfonts/<id>.js，跨重启保留）
 *  - 浏览器 → IndexedDB（WebView 内持久化，Web 与桌面均生效）
 * 提供 prefetch 预缓存（WIFI 下批量下载）与缓存状态查询。
 *
 * adj344（试听简化）：试听已固定 SpessaSynth 高保真，midi-js 采样（SamplerBackend）不再作为
 * 试听用途，本模块不再被 PlaybackDialog 引用（保留兼容，供未来需恢复 midi-js 采样试听时复用）。
 */
import type { SamplerCache, SamplerLibrary } from '@ijipu/engine'

/** 是否运行在 Tauri 桌面环境（window.__TAURI__ 由 withGlobalTauri 注入） */
function isTauri(): boolean {
  try {
    return typeof (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__?.core?.invoke === 'function'
  } catch {
    return false
  }
}

/** 调用 Tauri 自定义 command（桌面端读写缓存文件） */
async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const inv = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__?.core?.invoke
  if (typeof inv !== 'function') throw new Error('Tauri invoke 不可用')
  return inv(cmd, args)
}

// ---- Tauri 文件系统缓存（桌面，读写成文本文件） ----
class TauriFsCache implements SamplerCache {
  async loadText(libId: string): Promise<string | null> {
    const v = await tauriInvoke('sf_cache_read', { libId })
    return typeof v === 'string' ? v : null
  }
  async saveText(libId: string, text: string): Promise<void> {
    await tauriInvoke('sf_cache_write', { libId, text })
  }
  async has(libId: string): Promise<boolean> {
    const v = await tauriInvoke('sf_cache_read', { libId })
    return v != null
  }
  async remove(libId: string): Promise<void> {
    await tauriInvoke('sf_cache_remove', { libId })
  }
}

// ---- 浏览器 IndexedDB 缓存 ----
class IndexedDbCache implements SamplerCache {
  private db: IDBDatabase | null = null
  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db)
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ijipu-soundfonts', 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('libraries')) req.result.createObjectStore('libraries')
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    })
  }
  private get(libId: string): Promise<string | null> {
    return this.open().then(
      (db) =>
        new Promise<string | null>((resolve) => {
          const tx = db.transaction('libraries', 'readonly')
          const r = tx.objectStore('libraries').get(libId)
          r.onsuccess = () => resolve(typeof r.result === 'string' ? r.result : null)
          r.onerror = () => resolve(null)
        }),
    )
  }
  async loadText(libId: string): Promise<string | null> {
    return this.get(libId)
  }
  async has(libId: string): Promise<boolean> {
    return (await this.get(libId)) != null
  }
  async saveText(libId: string, text: string): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put(text, libId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  async remove(libId: string): Promise<void> {
    const db = await this.open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').delete(libId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

/** 创建缓存实现（Tauri 桌面 → 文件系统；否则 → IndexedDB） */
export function createSamplerCache(): SamplerCache {
  return isTauri() ? new TauriFsCache() : new IndexedDbCache()
}

/** 预缓存一个采样库（未缓存则联网下载并写出；已缓存跳过） */
export async function prefetchLibrary(lib: SamplerLibrary, cache: SamplerCache): Promise<void> {
  if (await cache.has(lib.id)) return
  const res = await fetch(lib.source)
  if (!res.ok) throw new Error(`音色库「${lib.name}」下载失败: HTTP ${res.status}`)
  await cache.saveText(lib.id, await res.text())
}

/** 查询某采样库是否已缓存 */
export async function libraryCached(lib: SamplerLibrary, cache: SamplerCache): Promise<boolean> {
  return cache.has(lib.id)
}
