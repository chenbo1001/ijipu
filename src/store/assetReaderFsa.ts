/**
 * store/assetReaderFsa.ts — **网页版**的读图通道（adj965，方案 `docs/OVERLAY-PLAN.md`「OVL」EP-14 前半）
 *
 * ## 为什么需要它
 *
 * 水印/背景图要按"相对本谱的路径"读字节，而各端的读法不同（方案 §四.1 的缺口表）：
 *   · 桌面端：Rust 的 `read_asset_file` / `ws_read_binary`（`overlayAssets.ts` 里那条）
 *   · 插件：宿主桥 `readAsset`（EP-09）
 *   · **网页版：工作区目录句柄（本文件）** —— 没有它，`npm run dev` 里图片**永远不显示**，
 *     而日常验证恰恰都在网页版做（用户 2026-10-15 实报"背景没有显示"就是撞在这条上）。
 *
 * ## 做法
 *
 * 工作区记录里存着**目录句柄** ⇒ 从它逐级 `getDirectoryHandle` 下钻到"本谱所在目录 + 图片的子目录"，
 * 再 `getFileHandle(name)` → `getFile()` → `arrayBuffer()` 拿到原始字节，
 * 交给 `assetSource` 的白名单/上限与 `assetDecode` 的解码/降采样（与其它端**同一套**）。
 *
 * ## 边界
 *
 *  · 只认 `base.kind === 'workspace'`（桌面端绝对路径那条不归它管 ⇒ 返回 `null`，让上层给提示）；
 *  · **未授权**（`NotAllowedError`）要说清怎么办 —— 授权申请必须在用户手势内，读图不是手势，
 *    这里只能如实报错，不假装"图不在"（两者用户该做的事完全不同）；
 *  · `..` 这类上跳段直接拒绝（`getDirectoryHandle` 本身不接受 `..`，但仍显式挡一道）。
 */
import type { AssetReader } from './assetSource'

/** 图片文件路径 → 目录段 + 文件名（`img/图.png` ⇒ `['img']` + `图.png`） */
function splitAssetPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((s) => s !== '' && s !== '.')
  const name = parts.pop() ?? ''
  return { dirs: parts, name }
}

/**
 * 网页版读图（`File System Access` 目录句柄）。
 *
 * 用到的能力都来自传入的句柄，**本文件不碰任何 DOM 全局** ⇒ 冒烟里能用假句柄直接断言。
 */
export const fsaAssetReader: AssetReader = async (path, base) => {
  if (base.kind !== 'workspace') return null
  const root = base.rec.handle as FileSystemDirectoryHandle | undefined
  if (root === undefined) return null

  const { dirs, name } = splitAssetPath(path)
  if (name === '' || dirs.some((d) => d === '..')) return null

  try {
    // 先下钻到**本谱所在的目录**（`segs` 末段是 `.jps` 自己），再进图片自己的子目录
    let dir: FileSystemDirectoryHandle = root
    for (const seg of [...base.segs.slice(0, -1), ...dirs]) {
      dir = await dir.getDirectoryHandle(seg)
    }
    const fileHandle = await dir.getFileHandle(name)
    const file = await fileHandle.getFile()
    const buf = await file.arrayBuffer()
    return {
      bytes: new Uint8Array(buf),
      mime: file.type !== '' ? file.type : 'application/octet-stream',
      mtime: file.lastModified,
    }
  } catch (e) {
    // 未授权与"文件不在"是两件事，用户要做的事也不同 ⇒ 分开说（不静默、也不误报）
    if (e instanceof Error && e.name === 'NotAllowedError') {
      throw new Error('工作区未授权：请先在「工作区」面板里重新授权这个目录')
    }
    if (e instanceof Error && e.name === 'NotFoundError') return null
    throw e
  }
}
