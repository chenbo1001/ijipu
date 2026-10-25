/**
 * store/syncSidecar.ts — 「对拍边车文件」的**定位与读取**（adj1150）
 *
 * 为什么单独抽出来：对拍台（`SyncDialog`）与相机位（`DynamicFrameOverlay`）都要
 * "按当前谱找到同目录的 `xxx.jps.sync.json`"——两边各写一份路径推导，迟早会漂。
 * 这里只做三件事：定位路径、读文本、解析成 `SyncDoc`；**不碰 React、不读 store 的 hook**，
 * 调用方把 `nativePath` / `binding` 传进来（这样 Node 侧也能直接断言路径规则）。
 */
import {
  joinPath,
  parseSyncDoc,
  sidecarPathOf,
  type SyncDoc,
} from '../export/video/syncDoc'
import { readSidecarText } from '../export/video/syncIo'
import { listWorkspaces } from './workspace'
import type { WorkspaceBinding } from './docStore'

/**
 * 当前谱的 sidecar **绝对路径**；没有磁盘落点（网页/示例/粘贴稿）返回 `null`。
 *
 * 两条来源（与保存同口径）：
 *  · `nativePath`：桌面「打开」的谱；
 *  · `binding`：从**工作区**打开的谱（桌面的路径后端有 `dir` 绝对路径）。
 */
export async function resolveSidecarPath(
  nativePath: string | null,
  binding: WorkspaceBinding | null,
): Promise<string | null> {
  if (nativePath !== null && nativePath !== '') return sidecarPathOf(nativePath)
  if (binding === null) return null
  try {
    const list = await listWorkspaces()
    const rec = list.find((r) => r.id === binding.wsId)
    const dir = typeof rec?.dir === 'string' && rec.dir !== '' ? rec.dir : ''
    if (dir === '') return null
    return sidecarPathOf(joinPath(dir, binding.segs.join('\\')))
  } catch {
    return null
  }
}

/** 读并解析一份 sidecar；文件不存在 / 读失败 / 内容坏了都返回 `null`（不抛） */
export async function loadSidecarDocAt(path: string | null): Promise<SyncDoc | null> {
  if (path === null) return null
  const r = await readSidecarText(path)
  if (!r.ok || r.text === null) return null
  const parsed = parseSyncDoc(r.text)
  return parsed.doc
}

/** 按当前谱定位 + 读取 sidecar（相机位"打开时自己找"的那一条） */
export async function loadSidecarFor(
  nativePath: string | null,
  binding: WorkspaceBinding | null,
): Promise<SyncDoc | null> {
  return loadSidecarDocAt(await resolveSidecarPath(nativePath, binding))
}
