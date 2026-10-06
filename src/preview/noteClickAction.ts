/**
 * preview/noteClickAction.ts — 预览区音符点击的**动作判定**（adj723）
 *
 * 抽成纯模块的理由（与 `dialogs/pageConfigReset.ts`、`dialogs/playbackClock.ts` 同）：
 * `npm run smoke` 能直接断言纯函数，而 `.tsx` 组件无法在 Node 里导入。
 *
 * 三种点击的语义（**用户口径**）：
 *  · 单击 → 光标跳到该音符（试听已开着时顺带从此处重播，`adj284`）；
 *  · 双击 → 从此处重播，但**要求试听已开着**，否则不弹窗（`adj88`/`adj166`，避免误触）；
 *  · **`Ctrl+单击` → 显式"从这里试听"**：不管试听是否开着，都打开试听并从此处播放（`adj723`）。
 */

/** 预览区音符点击的类型 */
export type NoteClickKind = 'ctrl-tryout' | 'single'

/** 音符点击要做的事（组件按此分支，不再自己判修饰键） */
export interface NoteClickAction {
  /** 是否把光标跳到该音符（`Ctrl+试听` **不跳**：用户是按"听"不是"改"） */
  jumpCursor: boolean
  /** 是否把该音符设为试听起点 */
  setPlaybackStart: boolean
  /** 是否**打开（并聚焦）试听页签** */
  openTryout: boolean
  /** 是否递增 `playbackTick`（让 `PlaybackDialog` 从起点开始/重播） */
  bumpTick: boolean
}

/**
 * 判定点击种类。
 *
 * 只认 **`ctrlKey`**（不认 `metaKey`）：Mac 的 `Cmd+单击` 是系统级的"在新标签打开/右键"语义，
 * 浏览器与桌面壳都可能先截走；用户明确要求的是 `Ctrl`。`shiftKey`/`altKey` 不参与判定
 * （`Ctrl+Shift+单击` 仍按"Ctrl 试听"处理，不做额外分支）。
 */
export function noteClickKind(ev: { ctrlKey?: boolean }): NoteClickKind {
  return ev.ctrlKey ? 'ctrl-tryout' : 'single'
}

/** 点击种类 → 动作集合（试听是否已开着由调用方另行判断，见 `single` 分支） */
export function noteClickAction(kind: NoteClickKind): NoteClickAction {
  if (kind === 'ctrl-tryout') {
    return { jumpCursor: false, setPlaybackStart: true, openTryout: true, bumpTick: true }
  }
  return { jumpCursor: true, setPlaybackStart: false, openTryout: false, bumpTick: false }
}
