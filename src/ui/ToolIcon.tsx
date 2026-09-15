/**
 * ui/ToolIcon.tsx — 按钮图标（adj408，adj417 起图标集中于 `public/icons/`）
 *
 * 图标资源统一放 **`public/icons/*.png`**（中文文件名，线稿，形状编码在 **alpha 通道**）；
 * 名称映射见 `ui/toolIcons.ts`（同时被 `public/sw.js` 预热清单与 smoke 断言使用）。
 *
 * ## 上色方式：CSS mask + `background-color: currentColor`
 * 只取 PNG 的 **alpha 通道**当形状，颜色完全交给 CSS —— 这样解决两件事：
 *  ① **统一颜色/灰度**（用户要求）：这批图标的原始颜色并不一致（有的近乎纯黑、有的偏灰、
 *     有的是实心填充），直接用 `<img>` 会把这种杂乱照搬到界面上；走 mask 后**所有图标只剩
 *     一个颜色**，即当前文字色。
 *  ② **自动跟随主题与状态**：亮/暗主题、按钮悬停、以及 `.active`（激活态把 color 换成强调色）
 *     图标都自动同色 —— 不需要为每种状态准备一套图片，也不会出现"深色主题下黑图标看不见"
 *     （原始 PNG 是黑线稿，直接铺在深色底上等于隐形）。
 *
 * 用法：`<ToolIcon name="layout" />`、`<ToolIcon name="collapse" rotate={90} />`。
 */
import type { CSSProperties } from 'react'
import { ICON_DIR, ICON_FILES } from './toolIcons'
import type { ToolIconName } from './toolIcons'

/**
 * 按钮图标：以 CSS mask 绘制，颜色 = 当前 `color`（因此随主题/激活态走）。
 * @param name 图标名（见 ui/toolIcons.ts 的 ICON_FILES）
 * @param size 边长（px）；顶栏按钮 16、对话框按钮 14
 * @param rotate 旋转角度（度）——上下拆分用「收起」图标转 90°
 */
export function ToolIcon({ name, size = 16, rotate = 0 }: { name: ToolIconName; size?: number; rotate?: number }) {
  // encodeURI：文件名是中文，转成 %XX 后对各类 URL 解析都安全（mask url() 同样吃百分号编码）
  const url = encodeURI(`${import.meta.env.BASE_URL}${ICON_DIR}/${ICON_FILES[name]}.png`)
  const style: CSSProperties & Record<string, string | number> = {
    width: size,
    height: size,
    '--tool-icon': `url("${url}")`,
  }
  if (rotate) style.transform = `rotate(${rotate}deg)`
  return <span className="tool-icon" aria-hidden="true" style={style} />
}
