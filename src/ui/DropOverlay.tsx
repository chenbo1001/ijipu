/**
 * ui/DropOverlay.tsx — **拖放高亮层**（adj968，用户要求"把 `.jps` 拖进应用就能打开"）
 *
 * 它只做两件事：
 *  ① 装上拖放（`store/dropOpen.ts` 的 `attachDropOpen`）—— 网页端听页面里的 HTML5 事件、
 *     桌面壳听原生 `ijipu://drag-hover`（WebView2 由原生层接管拖放，页面收不到）；
 *  ② 有文件在窗口上方时盖一层高亮 + 一句"松开即打开 xxx.jps"。
 *
 * 为什么不把"打开"也放这里：打开是**状态变更**，归 `docStore.openDropped`（一处收口）；
 * 本组件只负责"看得见的反馈"，拖走后立刻卸载干净（`attachDropOpen` 返回的卸载函数）。
 */
import { useEffect, useState } from 'react'
import { dropOpenCopy } from '../brand/copy'
import { attachDropOpen } from '../store/dropOpen'

export function DropOverlay() {
  /** `null` = 没在拖；`''` = 在拖但还读不到文件名（`store/dropOpen.ts` 的约定） */
  const [hint, setHint] = useState<string | null>(null)
  useEffect(() => attachDropOpen(setHint), [])
  if (hint === null) return null
  return (
    <div className="drop-overlay" role="status" aria-live="polite">
      <div className="drop-overlay-card">
        <div className="drop-overlay-main">
          {hint === '' ? dropOpenCopy.releaseGeneric : dropOpenCopy.releaseToOpen(hint)}
        </div>
        <div className="drop-overlay-sub">{dropOpenCopy.overlayHint}</div>
      </div>
    </div>
  )
}
