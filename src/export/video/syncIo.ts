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
