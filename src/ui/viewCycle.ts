/**
 * ui/viewCycle.ts — 视图模式的**切换顺序**与"下一个是谁"（adj614，用户要求 `Ctrl+M` 循环切换）
 *
 * 为什么单独一个模块：这个"顺序"有两个消费方——顶栏「视图」下拉（`VIEWS` 的展示顺序）与
 * `Ctrl+M` 的循环。**同一份顺序只能有一处定义**（两份清单必然漂移，E-2026-076 同类教训：
 * 顶栏折叠优先级、图标清单都栽过），所以顺序与算法都放这里，`VIEWS` 按它排、`App` 按它切；
 * `scripts/smoke.mts` 直接断言"`VIEWS` 的键序 == `VIEW_CYCLE`"（谁改了顺序都能当场发现）。
 *
 * 两个口径与顶栏下拉**完全一致**（不能各写一份）：
 *  · `splitHE` 与 `splitH` 是同一个「左右拆分」条目的两种方向（顶栏 `normViewKey` 的口径）
 *    ⇒ 循环时按当前 `splitHDir` 选方向，不会在"编辑器在左 / 预览在左"之间来回算成一档两档；
 *  · **窄屏没有「左右拆分」**（窄屏上下拆分才对）⇒ 循环时跳过它，与下拉里"窄屏不列出左右拆分"
 *    是同一个过滤。
 */
import type { ViewType } from '../store/docStore'

/** 循环顺序（= 顶栏「视图」下拉的展示顺序）：编码 → 拆分(上下) → 左右拆分 → 预览 */
export const VIEW_CYCLE: readonly ViewType[] = ['code', 'split', 'splitH', 'preview']

/** 归一化：左右拆分的两个方向视为**同一档**（`splitHE` = 编辑器在左） */
export function normViewType(k: ViewType): ViewType {
  return k === 'splitHE' ? 'splitH' : k
}

/**
 * 按 `Ctrl+M` 走到**下一个**视图（到末尾回到「编码」）。
 *
 * @param cur 当前视图（可以是 `splitHE`）
 * @param opts.narrow 是否窄屏（窄屏跳过「左右拆分」）
 * @param opts.splitHDir 左右拆分的方向偏好（`editorLeft` ⇒ `splitHE`，否则 `splitH`）
 */
export function nextViewType(
  cur: ViewType,
  opts: { narrow: boolean; splitHDir: 'previewLeft' | 'editorLeft' },
): ViewType {
  const order = opts.narrow ? VIEW_CYCLE.filter((v) => v !== 'splitH') : VIEW_CYCLE
  const at = order.indexOf(normViewType(cur))
  // 当前视图不在循环表里（理论上不会）⇒ 从第一档开始
  const next = at < 0 ? VIEW_CYCLE[0] : order[(at + 1) % order.length]
  return next === 'splitH' && opts.splitHDir === 'editorLeft' ? 'splitHE' : next
}
