/**
 * ui/numberScrub.ts — 数值「按住上下拖」的**纯换算**（adj526）
 *
 * 由来（用户报，手机端）：设置里的数字输入框在手机上**不显示原生上下小按钮**，
 * 而部分字段又有范围限制，配合"输入即钳制"导致数字**根本改不动**
 * （想输 `50`，打到 `5` 就被钳成 `10`）。用户提出用**一种统一的方式**调所有数值
 * （设置的 px 框、顶栏预览比率 `%`、编辑器字号 `px`）：**按住数值 → 上下滑动 → 数值增减**。
 *
 * 本文件只放**纯换算**（零 React / 零 DOM，`scripts/smoke.mts` 直接断言）：
 * 手势接线（长按门槛、触屏接管、React hook）在 `ui/numberScrubGesture.ts`。
 */

/** 上下每移动多少 px 改变**一个步长** */
export const SCRUB_PX_PER_STEP = 8
/** 横向位移超过它 → 切"粗调"（×`SCRUB_COARSE_FACTOR`），便于快速跨越大幅区间 */
export const SCRUB_COARSE_TOL = 24
/** 粗调倍数 */
export const SCRUB_COARSE_FACTOR = 10
/** 触屏长按多久进入调节模式（鼠标为 0 = 按住即可拖） */
export const SCRUB_HOLD_MS = 250
/** 长按期间位移超过它 ⇒ 判定为"滚页面"，放弃本次调节 */
export const SCRUB_MOVE_TOL = 10

export interface ScrubOptions {
  /** 步长（默认 1；如预览缩放 = 10） */
  step?: number
  /** 上下每多少 px 一个步长（默认 `SCRUB_PX_PER_STEP`） */
  pxPerStep?: number
  /** 是否启用横向粗调（默认 true；区间很小的字段应关掉，否则一划就跳过头） */
  coarse?: boolean
  min?: number
  max?: number
}

/**
 * 位移 → 目标值（**纯函数**）。
 * · 上拖（`dy < 0`）= 增大；下拖 = 减小；
 * · 横向位移超 `SCRUB_COARSE_TOL` ⇒ 按 `SCRUB_COARSE_FACTOR` 倍步进（粗调）；
 * · 给了 `min`/`max` 就钳制；**完全不给就只做"相对增量"**——这是本项目多数谱面字段的常态
 *   （设置里允许填极值，见引擎 `GUIDE_LIMITS_EX.height_shengbu` 的注释），
 *   因此不必给每个字段硬凑一个区间。
 */
export function scrubTarget(start: number, dx: number, dy: number, opts: ScrubOptions = {}): number {
  const step = opts.step ?? 1
  const pxPerStep = opts.pxPerStep ?? SCRUB_PX_PER_STEP
  const coarse = (opts.coarse ?? true) && Math.abs(dx) > SCRUB_COARSE_TOL
  const steps = Math.round(-dy / pxPerStep) * (coarse ? SCRUB_COARSE_FACTOR : 1)
  let v = Math.round(start + steps * step)
  if (opts.min !== undefined) v = Math.max(opts.min, v)
  if (opts.max !== undefined) v = Math.min(opts.max, v)
  return v
}
