/**
 * ui/dragGesture.ts — 拖拽手势统一入口（adj487）
 *
 * 由来（用户报）：底栏 dock 与编辑区之间的调整条、编辑区与预览区之间的调整条**在手机浏览器上拖不动**。
 * 根因是这些拖拽一律只监听 `mousemove` / `mouseup`——桌面能用，触屏**根本不发鼠标事件**
 * （手指落下只产生 pointer/touch 事件）。这里统一改用 **Pointer Events**：鼠标 / 触屏 / 触控笔同一套代码。
 *
 * 两个必须一起做的要点（少一个就还是拖不动）：
 * 1. **CSS 里给拖拽元素 `touch-action: none`**（见 index.css 的 `.tool-dock-resize` / `.split-divider` /
 *    `.guide-line`）：否则浏览器把手指的移动当成"滚动/缩放"自己消费掉，`pointermove` 压根不派发。
 * 2. **`setPointerCapture`**：抓住指针后，手指（鼠标）划出元素范围仍能收到 `pointermove`，
 *    否则一移出边界拖拽就断。
 *
 * 用法（宿主元素上）：`onPointerDown={(e) => beginDrag(e, { onMove: (dx, dy) => …, onEnd: () => … })}`。
 * 注意 `onMove` 拿到的是**相对按下点的位移**（dx 右为正、dy 下为正），换算成"值"的方向由调用方决定。
 */
import type React from 'react'

export interface DragHandlers {
  /** 按下时调用（返回 `false` 可放弃本次拖拽，比如"当前不可拖"） */
  onStart?: () => boolean | void
  /** 拖动中：`dx` / `dy` 为相对按下点的位移（px，右/下为正） */
  onMove: (dx: number, dy: number) => void
  /** 松手或被系统取消（如来电话、手势打断）时调用 */
  onEnd?: () => void
}

/**
 * 开始一次拖拽：在元素的 `onPointerDown` 里调用。
 * @param e React 的 pointerdown 事件（`currentTarget` = 拖拽宿主元素）
 * @param handlers 移动 / 结束回调
 */
export function beginDrag(e: React.PointerEvent, handlers: DragHandlers): void {
  // 鼠标只认左键；触屏 / 触控笔没有"左键"概念（button 为 0 / -1），一律放行
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (handlers.onStart?.() === false) return
  const el = e.currentTarget as HTMLElement
  const { pointerId } = e
  const x0 = e.clientX
  const y0 = e.clientY
  // 阻止默认行为：避免拖拽时选中文字 / 触发原生拖放（触屏的"滚动"要靠 touch-action，见文件头注释）
  e.preventDefault()
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // 少数环境不支持捕获：退化为 window 监听（触屏有隐式捕获，通常也能收到 move）
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    ev.preventDefault()
    handlers.onMove(ev.clientX - x0, ev.clientY - y0)
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    handlers.onEnd?.()
  }
  // passive: false —— 需要在回调里 preventDefault（默认的 passive 监听会忽略它）
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
