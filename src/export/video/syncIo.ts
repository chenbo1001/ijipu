/**
 * export/video/syncIo.ts — 对拍边车文件（`赤伶.jps.sync.json`）的**落盘**
 *
 * 用户 2026-10-24：「保存没有实现」——第一版只写了本机缓存（L1），没有真的写文件。
 * 现在：
 *  · 桌面壳（Tauri）：走两个原生命令
 *      - `sync_read_file(path)` ⇒ `string | null`（**文件不存在是正常状态**，返回 null 不报错）
 *      - `sync_write_file(path, text)` ⇒ 允许新建 + **写完回读校验**（与 `.jps` 保存同口径）
 *  · 网页 / 开发模式：没有文件系统 ⇒ 返回 `{ ok: false, error }`，调用方降级为 L1 并**如实提示**，
 *    绝不假装"已保存到文件"。
 *
 * 为什么单独一层：`SyncDialog` 不该知道 `window.__TAURI__` 长什么样；
 * 且以后命令行 `--sync` 与相机位"打开时读 sidecar"都要用同一套调用。
 */
import { isTauriShell } from '../../brand/env'

interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

/** 取桌面壳的 invoke（非桌面壳返回 null，不抛） */
function core(): TauriCore | null {
  if (!isTauriShell()) return null
  const w = window as unknown as { __TAURI__?: { core?: TauriCore } }
  return w.__TAURI__?.core ?? null
}

export type SidecarRead = { ok: true; text: string | null } | { ok: false; error: string }
export type SidecarWrite = { ok: true } | { ok: false; error: string }

/** 读 sidecar（文件不存在 ⇒ `{ ok: true, text: null }`） */
export async function readSidecarText(path: string): Promise<SidecarRead> {
  const c = core()
  if (c === null) return { ok: false, error: '网页模式没有文件系统' }
  try {
    const text = await c.invoke('sync_read_file', { path })
    return { ok: true, text: typeof text === 'string' ? text : null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * adj1154：按 sidecar 记的路径**自动读伴奏字节**（桌面壳 `sync_read_audio`）。
 *
 * 读不到就返回 `null`（不是异常）：网页/开发模式、文件被移走、扩展名不在白名单里，
 * 都退回相机位的「加载伴奏…」手动入口；绝不因此挡住相机位。
 */
export async function readSidecarAudio(path: string): Promise<ArrayBuffer | null> {
  const c = core()
  if (c === null) return null
  try {
    const buf = await c.invoke('sync_read_audio', { path })
    return buf instanceof ArrayBuffer ? buf : null
  } catch {
    return null
  }
}

/** 写 sidecar（新建/覆盖；Rust 侧回读校验过） */
export async function writeSidecarText(path: string, text: string): Promise<SidecarWrite> {
  const c = core()
  if (c === null) return { ok: false, error: '网页模式没有文件系统' }
  try {
    await c.invoke('sync_write_file', { path, text })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * adj1129：网页 / 开发模式没有同目录写入 ⇒ **下载一份真的文件**。
 *
 * 用户实报「点保存提示存本机缓存，没看到对拍文件」——只写 localStorage 等于没给文件。
 * 下载下来的 `xxx.jps.sync.json` 放回谱文件旁边就能被读到（桌面版打开时会读它）。
 */
export function downloadSidecarText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  // 有些 WebView/Chrome 版本要求 <a> 在文档里才真正触发下载（实测 headless 下必须挂上）
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 会让部分实现拿不到数据，挪到下一个任务
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
