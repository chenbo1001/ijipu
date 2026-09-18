/**
 * ui/numberScrubGesture.ts — 数值「按住上下拖」的**手势与 React 接线**（adj526）
 *
 * 纯换算在 `ui/numberScrub.ts`（零 React/DOM，smoke 直接断言）；本文件只做"把手指/鼠标的
 * 位移接到换算上"，并提供两个组件用的小 hook。
 *
 * ## 为什么长按门槛只给触屏
 * 设置面板**本身是可滚动容器**。若给数值直接上 `touch-action: none`（拖拽类手势的必需条件），
 * 用户在数值上起手想把面板往下滑就滑不动了。所以：**触屏走"长按 250ms 进入调节模式"**，
 * 长按期间若先发生位移（> 10px）就判定为"用户在滚页面"，直接放弃本次调节、滚动照常；
 * **鼠标不需要门槛**（面板靠滚轮滚，按住即拖更顺手；顶栏那几处本来就不滚动）。
 *
 * ## 触屏为什么要在长按成功后拦 `touchmove`
 * `touch-action` 在 pointerdown 那一刻就定了、中途改不了；而 `preventDefault()` **pointermove
 * 拦不住浏览器的原生滚动**（原生滚动归 touch 事件管）。所以在长按成功、正式接管的那一刻，
 * 挂一个 `{ passive: false }` 的 `touchmove` 监听并 `preventDefault()`——这才是"从浏览器手里
 * 抢回这次手势"的可靠做法（长按成功时手指还没移动，浏览器尚未开始滚动，因此来得及）。
 */
import { useRef, useState } from 'react'
import type React from 'react'
import { SCRUB_HOLD_MS, SCRUB_MOVE_TOL, scrubTarget } from './numberScrub'
import type { ScrubOptions } from './numberScrub'

export interface ScrubHandlers {
  /** 长按门槛（ms）；缺省：触屏 `SCRUB_HOLD_MS`、鼠标 0（即"按住即可拖"） */
  holdMs?: number
  moveTol?: number
  /** 拖动中（`dx`/`dy` 为相对按下点的位移） */
  onMove: (dx: number, dy: number) => void
  /** 结束；`moved` = 本次是否真的拖动过（用于决定是否吃掉随后的 click） */
  onEnd?: (moved: boolean) => void
}

/**
 * 开始一次"按住拖数值"：在宿主的 `onPointerDown` 里调用。
 * 与 `ui/dragGesture.ts` 的 `beginDrag` 的差别：**本函数不在按下时 preventDefault**，
 * 于是"触屏长按期间想滚页面"仍然可行；只有长按成功（或鼠标直接拖动）后才接管手势。
 */
export function beginScrub(e: React.PointerEvent, handlers: ScrubHandlers): void {
  // 鼠标只认左键（触屏/触控笔 button 为 0 / -1，一律放行）
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  const { pointerId, pointerType } = e
  const x0 = e.clientX
  const y0 = e.clientY
  const holdMs = handlers.holdMs ?? (pointerType === 'touch' ? SCRUB_HOLD_MS : 0)
  const moveTol = handlers.moveTol ?? SCRUB_MOVE_TOL
  let engaged = false
  let moved = false
  let timer = 0

  const blockTouchMove = (ev: TouchEvent) => ev.preventDefault()
  const cleanup = () => {
    window.clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('touchmove', blockTouchMove)
  }
  /** 正式接管这次手势（长按到点；鼠标按下即在拖动时） */
  const engage = () => {
    if (engaged) return
    engaged = true
    window.addEventListener('touchmove', blockTouchMove, { passive: false })
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // 少数环境不支持捕获：window 上的监听仍能收到 move
    }
  }
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const dx = ev.clientX - x0
    const dy = ev.clientY - y0
    if (!engaged) {
      // 长按还没到点就动了 ⇒ 判定为"滚页面"：放弃调节，且**不** preventDefault（滚动照常）
      if (Math.abs(dx) > moveTol || Math.abs(dy) > moveTol) cleanup()
      return
    }
    if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
    moved = true
    ev.preventDefault()
    handlers.onMove(dx, dy)
  }
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    cleanup()
    handlers.onEnd?.(moved)
  }
  if (holdMs <= 0) engage()
  else timer = window.setTimeout(engage, holdMs)
  // passive: false —— 需要在回调里 preventDefault
  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

/** 按住不放时连续触发（用于 `−`/`+` 步进钮） */
export function beginHoldRepeat(
  e: React.PointerEvent,
  opts: { delayMs?: number; everyMs?: number; onTick: () => void },
): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const delayMs = opts.delayMs ?? 420
  const everyMs = opts.everyMs ?? 90
  let interval = 0
  const cleanup = () => {
    window.clearTimeout(timer)
    window.clearInterval(interval)
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
  }
  const timer = window.setTimeout(() => {
    interval = window.setInterval(opts.onTick, everyMs)
  }, delayMs)
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

export interface NumberScrub {
  /** 挂到调节宿主（数值输入框 / 值的 span）上 */
  onPointerDown: (e: React.PointerEvent) => void
  /** 挂在 `onClickCapture`：拖动过就吃掉这次 click（避免刚调完又聚焦/弹键盘） */
  onClickCapture: (e: React.MouseEvent) => void
  /** 正在拖动（供样式加高亮） */
  scrubbing: boolean
}

/**
 * 「按住上下拖数值」的 hook。
 * @param value 当前值（用作**按下那一刻**的基准，拖动过程中不会被自身的更新带偏）
 * @param onChange 目标值回调（各字段自己的钳制仍在 `onChange` 里生效）
 * @param opts 步长 / 范围 / 是否粗调 / 长按门槛
 */
export function useNumberScrub(
  value: number,
  onChange: (v: number) => void,
  opts: ScrubOptions & { holdMs?: number } = {},
): NumberScrub {
  const [scrubbing, setScrubbing] = useState(false)
  const startRef = useRef(value)
  const movedRef = useRef(false)
  // 把最新值/回调放进 ref：手势跨越多次渲染，必须始终拿到"此刻"的
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const optsRef = useRef(opts)
  optsRef.current = opts

  return {
    scrubbing,
    onPointerDown: (e: React.PointerEvent) => {
      startRef.current = valueRef.current
      movedRef.current = false
      const host = e.currentTarget as HTMLElement
      beginScrub(e, {
        holdMs: optsRef.current.holdMs,
        onMove: (dx, dy) => {
          if (!movedRef.current) {
            movedRef.current = true
            setScrubbing(true)
            // 进入调节即收起键盘，避免"边调边弹出输入法"（触屏尤其明显）
            if (document.activeElement === host) host.blur()
            document.body.style.userSelect = 'none'
          }
          onChangeRef.current(scrubTarget(startRef.current, dx, dy, optsRef.current))
        },
        onEnd: () => {
          if (movedRef.current) {
            setScrubbing(false)
            document.body.style.userSelect = ''
          }
        },
      })
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (movedRef.current) {
        e.preventDefault()
        e.stopPropagation()
        movedRef.current = false
      }
    },
  }
}

/**
 * `−`/`+` 步进钮的 hook：点一下走一步，**按住连续走**（长按 420ms 后每 90ms 一步），
 * 松手后那次 click 被吃掉（避免"连按结束时又多走一步"）。
 */
export function useHoldRepeat(onTick: () => void): {
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
} {
  const tickedRef = useRef(false)
  return {
    onPointerDown: (e: React.PointerEvent) => {
      tickedRef.current = false
      beginHoldRepeat(e, {
        onTick: () => {
          tickedRef.current = true
          onTick()
        },
      })
    },
    onClick: (e: React.MouseEvent) => {
      if (tickedRef.current) {
        e.preventDefault()
        tickedRef.current = false
        return
      }
      onTick()
    },
  }
}
