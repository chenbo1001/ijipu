/**
 * store/cardImageStore.ts — 卡片背景图等**大附件**的存取（adj1085 / P1）
 *
 * 为什么要外置：自定义卡片的背景图是 1–3 MB 的 data URL，塞进 `settings.json` 会把整份配置
 * 撑大十几倍，每次改主题都要重写几 MB；也超过浏览器 `localStorage` 的 5 MB 配额。
 *
 * 落点（与三端存储同一套分工）：
 *   · 桌面壳：`%APPDATA%\iJipu\files\<hash>.<ext>`，配置里只存 `ijipu-blob:<名>`；
 *   · 网站/PWA：IndexedDB（`ijipu-assets` 库）；
 *   · Obsidian 插件：**保留 data URL**（插件本身写 `data.json`，不在浏览器缓存里；
 *     宿主桥目前没有写二进制文件的 op，P1 不扩协议）。
 *
 * 读取时统一还原成 data URL：`<img src>`、`Image.decode()`、canvas 都能直接用，
 * 也不必管 object URL 的回收时机。
 */
import { isHostFrame, tauriCore } from '../brand/env'
import { base64ToBytes, bytesToBase64 } from '../export/zip'

export const BLOB_REF_PREFIX = 'ijipu-blob:'

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** 是不是外置附件引用 */
export function isBlobRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(BLOB_REF_PREFIX)
}

/** `ijipu-blob:a1b2.png` → `a1b2.png` */
export function blobNameOf(ref: string): string {
  return ref.slice(BLOB_REF_PREFIX.length)
}

function extOf(mime: string, fallback = 'png'): string {
  const m = /^image\/(png|jpe?g|webp|gif)$/i.exec(mime)
  if (!m) return fallback
  return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
}

/** FNV-1a 32 位 + 长度：内容哈希做文件名（同图重复选只占一份） */
function hashName(bytes: Uint8Array, ext: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}${bytes.length.toString(16)}.${ext}`
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = tauriCore()?.invoke
  if (fn === undefined) throw new Error('当前环境没有 Tauri 通道')
  return (await fn(cmd, args)) as T
}

/** 有没有桌面附件通道（桌面壳且 Tauri 可用） */
function hasDesktopBlobs(): boolean {
  return typeof window !== 'undefined' && tauriCore()?.invoke !== undefined
}

// ── IndexedDB（网站/PWA） ─────────────────────────────

const DB_NAME = 'ijipu-assets'
const DB_STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('打不开 IndexedDB'))
  })
}

async function idbPut(name: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(blob, name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写 IndexedDB 失败'))
  })
  db.close()
}

async function idbGet(name: string): Promise<Blob | null> {
  const db = await openDb()
  const out = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).get(name)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('读 IndexedDB 失败'))
  })
  db.close()
  return out
}

async function idbDelete(name: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('删 IndexedDB 失败'))
  })
  db.close()
}

// ── 对外 ────────────────────────────────────────────

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

/**
 * Uint8Array → Blob。
 * TS 6 的 `BlobPart` 只认 `ArrayBuffer`（`Uint8Array<ArrayBufferLike>` 会报类型不兼容），
 * 所以复制一份到确定的 ArrayBuffer 里（几 MB 的图，复制一次可接受）。
 */
export function imageBlobOf(bytes: Uint8Array, mime: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new Blob([buffer], { type: mime })
}

/** data URL → 二进制（迁移/导入用；不是 data URL 就回 null） */
export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const mime = m[1] || 'image/png'
  if (m[2]) return { bytes: base64ToBytes(m[3]), mime }
  try {
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime }
  } catch {
    return null
  }
}

/**
 * 存一张图，返回配置里该存的引用。
 * 插件（宿主 iframe）仍返回 data URL；桌面/网页返回 `ijipu-blob:<名>`。
 */
export async function saveCardImage(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mime = blob.type || 'image/png'
  if (isHostFrame()) return bytesToDataUrl(bytes, mime)
  const name = hashName(bytes, extOf(mime))
  if (hasDesktopBlobs()) {
    await invoke('prefs_blob_write', { name, b64: bytesToBase64(bytes) })
  } else {
    await idbPut(name, imageBlobOf(bytes, mime))
  }
  return BLOB_REF_PREFIX + name
}

/** 读引用对应的 data URL；不是引用就原样返回（兼容旧的 data URL / http 图） */
export async function resolveCardImage(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null
  if (!isBlobRef(value)) return value
  const name = blobNameOf(value)
  try {
    if (hasDesktopBlobs()) {
      const b64 = await invoke<string>('prefs_blob_read', { name })
      const ext = (name.split('.').pop() ?? 'png').toLowerCase()
      return bytesToDataUrl(base64ToBytes(b64), EXT_MIME[ext] ?? 'image/png')
    }
    const blob = await idbGet(name)
    if (blob === null) return null
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('读图失败'))
      reader.readAsDataURL(blob)
    })
  } catch (e) {
    console.warn('[iJipu] 卡片背景图读取失败：', e)
    return null
  }
}

/** 删引用对应的附件（顺手换图/删卡片时调用；失败只留痕） */
export async function deleteCardImage(value: string | null | undefined): Promise<void> {
  if (!isBlobRef(value)) return
  const name = blobNameOf(value)
  try {
    if (hasDesktopBlobs()) await invoke('prefs_blob_delete', { name })
    else await idbDelete(name)
  } catch (e) {
    console.warn('[iJipu] 卡片背景图删除失败（不影响当前会话）：', e)
  }
}

/** 导出设置用：把引用读成二进制（读不到 ⇒ null） */
export async function readCardImageBytes(value: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!isBlobRef(value)) {
    const parsed = dataUrlToBytes(value)
    return parsed === null ? null : { name: hashName(parsed.bytes, extOf(parsed.mime)), bytes: parsed.bytes }
  }
  const name = blobNameOf(value)
  try {
    if (hasDesktopBlobs()) {
      const b64 = await invoke<string>('prefs_blob_read', { name })
      return { name, bytes: base64ToBytes(b64) }
    }
    const blob = await idbGet(name)
    if (blob === null) return null
    return { name, bytes: new Uint8Array(await blob.arrayBuffer()) }
  } catch {
    return null
  }
}

/** 导入设置用：按 zip 里的文件名写回附件（桌面/网页都按这个名字存，配置里的引用才对得上） */
export async function writeCardImageBytes(name: string, bytes: Uint8Array): Promise<void> {
  const ext = (name.split('.').pop() ?? 'png').toLowerCase()
  const mime = EXT_MIME[ext] ?? 'image/png'
  if (hasDesktopBlobs()) {
    await invoke('prefs_blob_write', { name, b64: bytesToBase64(bytes) })
  } else {
    await idbPut(name, imageBlobOf(bytes, mime))
  }
}

/**
 * 迁移：旧版把背景图以 data URL 塞在 `ijipu.dynamicCardStyleCustom` 里。
 * 返回新的 JSON 字符串（无需迁移 ⇒ null）。
 */
export async function migrateInlineCardImage(customJson: string): Promise<string | null> {
  let parsed: { backgroundImage?: unknown } & Record<string, unknown>
  try {
    parsed = JSON.parse(customJson) as typeof parsed
  } catch {
    return null
  }
  const bg = parsed.backgroundImage
  if (typeof bg !== 'string' || !bg.startsWith('data:image/')) return null
  const data = dataUrlToBytes(bg)
  if (data === null) return null
  const ref = await saveCardImage(imageBlobOf(data.bytes, data.mime))
  if (ref === bg) return null
  return JSON.stringify({ ...parsed, backgroundImage: ref })
}

/**
 * 启动时调用（**必须早于 uiStore 求值**）：把 localStorage 里的旧内联背景图迁成外置引用。
 * 桌面壳此时 localStorage 已是配置门面 ⇒ 迁移结果会随下一次落盘写进 settings.json。
 *
 * @returns 是否真的迁移了（排错/日志用）
 */
export async function migrateInlineCardImageInLocalStorage(): Promise<boolean> {
  const KEY = 'ijipu.dynamicCardStyleCustom'
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return false
  }
  if (raw === null) return false
  try {
    const next = await migrateInlineCardImage(raw)
    if (next === null) return false
    localStorage.setItem(KEY, next)
    console.info('[iJipu] 卡片背景图已从内联 data URL 迁到外置附件')
    return true
  } catch (e) {
    console.warn('[iJipu] 卡片背景图迁移失败（保留原样）：', e)
    return false
  }
}
