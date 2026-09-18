/**
 * ui/ScrubValue.tsx — 「按住上下拖」的数值显示（adj526）
 *
 * 顶栏的**预览比率**（`100%`）与**编辑器字号**（`14px`）本身不是输入框（旁边已有 `−`/`+` 按钮），
 * 所以它们只需要"可拖动"这一条路径：按住上下拖 → 数值增减（横向位移转粗调）。
 * 抽成组件是因为要调用 `useNumberScrub`（hook 不能在 `renderBtn` 这种普通函数里调用）。
 *
 * adj529：新增可选的 `onDoubleClick`——顶栏预览比率用它实现
 * "**双击比率值 → 按预览区宽度适配**"（纯一次性动作，不引入任何长期状态）。
 *
 * 无障碍：`role="spinbutton"` + `aria-valuenow/min/max`，方向键 ↑/↓ 也能步进
 * （键盘用户不必依赖拖动）。
 */
import { useNumberScrub } from './numberScrubGesture'

export function ScrubValue({
  value,
  onChange,
  step,
  min,
  max,
  /** 显示文案（如 `14px` / `100%`） */
  text,
  title,
  className,
  /** adj529：双击回调（可选；预览比率用它做"按宽度适配"） */
  onDoubleClick,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  text: string
  title: string
  className?: string
  onDoubleClick?: () => void
}) {
  const scrub = useNumberScrub(value, onChange, { step, min, max })
  return (
    <span
      className={`scrub-value${className ? ` ${className}` : ''}${scrub.scrubbing ? ' is-scrubbing' : ''}`}
      // 无障碍：读屏报"可调节的数值"，并给出范围。
      // adj529：`min`/`max` 是**手动**范围，而当前值可能由"按宽度适配"落在范围之外
      // （窄预览区可到 30%、很宽的预览区可到 400%）——若照抄会让 aria-valuenow 越界（非法 ARIA）。
      // 这里把边界按当前值放宽：读屏读到的范围始终自洽，拖动/方向键的边界仍用手动范围。
      role="spinbutton"
      tabIndex={0}
      aria-valuenow={value}
      aria-valuemin={min === undefined ? undefined : Math.min(min, value)}
      aria-valuemax={max === undefined ? undefined : Math.max(max, value)}
      aria-label={title}
      title={title}
      onPointerDown={scrub.onPointerDown}
      onClickCapture={scrub.onClickCapture}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
        if (!d) return
        e.preventDefault()
        const next = Math.round(value + d)
        onChange(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next)))
      }}
    >
      {text}
    </span>
  )
}
