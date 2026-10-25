/**
 * store/syncOwner.ts — 「内存里的 sync doc 属于哪一份文件」的唯一登记处（adj1158）
 *
 * 为什么单独一个小模块：
 *  · `syncExtras` 需要知道 doc 属于哪个文件（换文件时要清掉旧 doc，避免把旧谱的锚点/音量写进新谱）；
 *  · `docStore` 的「另存为」也需要**接管**这份 doc（同一份谱换了路径，不能清掉）；
 *  · 两边直接互相 import 会成环（docStore ↔ syncExtras），所以把 owner 这个纯状态单独放这里。
 *
 * 口径（文件身份）与练习段 localStorage 的 `docKeyOf` 完全一致：工作区 > 原生路径 > 文件名。
 */
import { docKeyOf } from './practiceMarks'

/** 一个"文件身份"输入（结构兼容 `docStore` 的三来源） */
export interface SyncOwnerInput {
  fileName: string
  nativePath: string | null
  binding: { wsId: string; segs: readonly string[] } | null
}

/** 当前 owner 的文件身份（`''` = 还没有加载过任何 doc） */
let owner = ''

/** 这份文件身份（与 `docKeyOf` 同口径） */
export function syncIdentityOf(input: SyncOwnerInput): string {
  return docKeyOf(input)
}

/** 当前 doc 的 owner */
export function syncDocOwnerOf(): string {
  return owner
}

/** 打开/加载时登记 owner */
export function setSyncDocOwner(identity: string): void {
  owner = identity
}

/**
 * 「另存为」成功时调用：同一份谱换了路径，**接管**旧 doc（不触发换文件清理）。
 * 调用时机必须在设置新 `nativePath`/`fileName` 之后、React effect 运行之前。
 */
export function adoptSyncDocOwner(input: SyncOwnerInput): void {
  owner = docKeyOf(input)
}
