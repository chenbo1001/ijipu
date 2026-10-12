/**
 * preview/followScroll.ts — 播放跟随滚动：**要不要滚、滚到哪**（adj895，用户要求）
 *
 * 用户口径：
 *   「试听时，如果页面宽于预览视界，试听色块总是走到视界后再调整页面位置，这是不对的，
 *     要留有余量，在接近右视界时就应调整，以便给看谱都有个提前看后面谱子的余量；
 *     另外，调整时页面的移动要顺滑些，不要一跳一跳。」
 *
 * ## 为什么原来会"贴到边上才动、而且一跳一跳"
 *
 * 跟随滚动原来**借用了单击音符那条居中逻辑**（`PreviewPane` 里同一个 effect），
 * 而那条逻辑被 `adj723y` 加了一道保护：**音符已完整可见就不滚**
 * —— 那是为了修"双击播放失效"（单击会把音符挪走 ⇒ 第二次点击落空 ⇒ 浏览器不派发 `dblclick`）。
 * 副作用正是用户看到的：**只有等色块冲出视界才会触发**；而触发时又是
 * `scroller.scrollLeft = target` 直接赋值 ⇒ 瞬移 ⇒ "一跳一跳"。
 *
 * ## 本模块的口径：**安全区**（横向）
 *
 * ```
 *   ┌───────────── 视口 ─────────────┐
 *   │      │←安全带→│                │
 *   │ 25%  │        │      75%       │
 *   └──────┴────────┴────────────────┘
 * ```
 *
 *   · 目标点**落在安全带内 ⇒ 不滚**（返回 `null`）。这一条也是"顺滑"的前提：
 *     只有真的越界才滚，所以滚动调用是**低频**的，不会逐帧打断浏览器的平滑滚动。
 *   · **越出右界 ⇒ 把它拉回带内左端（25%）**：眼前立刻露出右侧约 3/4 视口的谱，
 *     **这就是"提前看后面"的余量** —— 而不是等它贴到最右边才开始动。
 *   · 越出左界 ⇒ 对称地拉回带内右端。
 *   · 目标再钳到**可滚上限**内（`scrollWidth - clientWidth`，即浏览器自己的上限）。
 *
 * 纵向**不在这里**：页面纵向是"逐行推进"，语义与横向不同（用户本轮只提横向）。
 * 若日后也要余量，按同一模型加一个 `followScrollTargetY` 即可，别把这套逻辑写进组件里。
 */

/** 安全带下沿（占视口宽的比例）：目标点小于它就算"太靠左" */
export const FOLLOW_SAFE_LOW = 0.25
/** 安全带上沿（占视口宽的比例）：目标点大于它就算"太靠右" ⇒ **提前**触发 */
export const FOLLOW_SAFE_HIGH = 0.75

export interface FollowScrollInput {
  /** 目标点（色块左缘）在**视口坐标**里的 x —— 0 = 视口左缘。由 `getBoundingClientRect()` 直接得到 */
  xInView: number
  /** 视口宽（`clientWidth`，已排除滚动条） */
  viewW: number
  /** 可滚内容总宽（`scrollWidth`）——浏览器自己的上限就是 `scrollWidth - clientWidth`，用它最稳 */
  scrollW: number
  /** 当前 `scrollLeft` */
  scrollLeft: number
}

/**
 * 算出应当滚到的 `scrollLeft`；**不需要滚时返回 `null`**（调用方据此"什么都不做"）。
 * 纯函数：不读 DOM、不写 DOM，可直接在 Node 里断言。
 */
export function followScrollTargetX(input: FollowScrollInput): number | null {
  const { xInView, viewW, scrollW, scrollLeft } = input
  // 内容不比视口宽（或量歪了）⇒ 横向压根没有可滚的余地，别动
  if (!(viewW > 0) || !(scrollW > viewW)) return null
  const low = viewW * FOLLOW_SAFE_LOW
  const high = viewW * FOLLOW_SAFE_HIGH
  // 在安全带里 ⇒ 保持不动（顺滑的关键：绝大多数帧都走这里）
  if (xInView >= low && xInView <= high) return null
  // 越界：把目标点拉回带内（右越界 → 拉到 low，右前方因此空出 3/4 视口；左越界对称）
  const want = xInView > high ? low : high
  const maxScroll = scrollW - viewW
  return Math.max(0, Math.min(scrollLeft + (xInView - want), maxScroll))
}
