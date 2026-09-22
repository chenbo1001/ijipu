/**
 * ui/HelpBadge.tsx — 通用「?」提示徽标（adj585，用户要求）
 *
 * 背景：底栏各面板里的**长说明**此前走"PC 悬浮 `title` + 触屏常驻一块文字"两条路
 * （旧版用一个只在粗指针设备上显示的类把同一段文字又铺一遍）。触屏那条会**长期占掉手机端
 * 本就不多的高度**——用户在工作区页签上点名："手机端空间有限，过多的提示占用了较大空间，
 * 我的想法是如果需要了解一些信息点击选择工作区后面的 `?` 即可浮现提示信息，而把空间让给工作区列表"。
 *
 * 现在的口径：
 *  · PC —— `?` 上仍是原生 `title` 悬浮提示（与旧版一致，鼠标扫一眼就看到）；
 *  · 任何设备 —— **点 `?` 就地展开/收起**这条说明，于是常驻文字全部撤掉，高度让给真正要用的区域
 *    （工作区列表、粘贴框）；再点一次收起。
 *
 * 为什么用 `<button>` 而不是原来的 `<span role="img">`：键盘可达、可聚焦、`aria-expanded`
 * 能如实表达展开态；原来那个 span 只能靠悬浮，触屏上根本触发不了。
 *
 * 说明块渲染成徽标的**兄弟节点**——父容器（`.ws-choose-title` / `.import-label`）是 flex row
 * 且带 `flex-wrap: wrap`，配合 `.help-hint { flex: 0 0 100% }` 让它独占下一行（见 index.css）。
 */
import { useState } from 'react'

export function HelpBadge({
  hint,
  hintClassName,
}: {
  /** 提示正文；给数组时每项一段（用于"用法 + 限制"这类多条说明） */
  hint: string | string[]
  /** 需要时附加到说明块上的类名（如黑名单提示的强调样式） */
  hintClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const lines = (Array.isArray(hint) ? hint : [hint]).filter((t) => t)
  return (
    <>
      <button
        type="button"
        className="help-badge"
        title={lines.join('\n')}
        aria-label={lines[0]}
        aria-expanded={open}
        onClick={(e) => {
          // 徽标可能落在可点区域（清单行 / 标题块）里 ⇒ 别让点击冒泡成"选中/切换"
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      {open && (
        <div className={`help-hint${hintClassName ? ' ' + hintClassName : ''}`}>
          {lines.map((t, i) => (
            <div key={i} className="help-hint-line">
              {t}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
