/**
 * ui/toolIcons.ts — 按钮图标清单（adj408，adj417 起集中于 `public/icons/`）
 *
 * 图标资源统一放 **`public/icons/*.png`**（中文文件名，线稿，形状编码在 **alpha 通道**）：
 * 集中一个目录，`dist/` 根目录不再散落几十个 png（只剩 html/manifest/sw 与几个目录）。
 * **只放用得到的图标**——没用的不放（需要时再加），避免把整个图标集都塞进产物。
 *
 * 单独成文件（而不是写在 `ToolIcon.tsx` 里）的两个原因：
 *  ① oxlint 的 `react/only-export-components` 不允许组件文件导出非组件；
 *  ② 这份清单还要与 `public/sw.js` 的预热列表对齐、并被 `scripts/smoke.mts` 断言
 *     （图标文件是否真的存在、sw.js 是否漂移）——放这里两边都能 import/读取。
 */
/** 图标所在目录（`public/` 下的一级目录，经 BASE_URL 拼接，兼容子路径部署） */
export const ICON_DIR = 'icons'

/** 图标名 → `public/icons/` 下的文件名（不含扩展名；中文文件名按用户给定的图标集） */
export const ICON_FILES = {
  /** 菜单（汉堡菜单按钮） */
  menu: '菜单',
  /** 编码视图（代码块）——adj458：此前用「文件」图标（key 也叫 file），与按钮语义不符，改用「编码」 */
  code: '编码',
  /** 拆分(左右)——左右两个窗格并排 */
  splitH: '左右',
  /** 拆分(上下)——上下两个窗格叠放 */
  splitV: '上下',
  /** 预览（眼睛）——adj458：图标由「查看」换成「预览」 */
  view: '预览',
  /** 排版（行距调整） */
  layout: '排版',
  /** 试听（播放三角） */
  play: '播放',
  /** 停止（方块） */
  stop: '停止',
  /** 暂停（试听时按一下播放键 → 暂停/继续） */
  pause: '暂停',
  /** 设置（齿轮） */
  settings: '设置',
  /** 导出（adj458：改用专用的「导出」图标——此前借用「下载」，与真正的下载语义混淆） */
  export: '导出',
  /** 折行（自动换行） */
  wrap: '折行',
  /** 字体（Aa） */
  font: '字体',
  /** 支持作者（爱心） */
  heart: '爱心',
  /** 下拉按钮右侧的下拉指示箭头（视图下拉、字体下拉） */
  down: '下',
  /** adj520：底栏高度档位切换按钮（与 `down` 共用图标，但方向向上）—— 即 `public/icons/上.png` */
  up: '上',
  /** 「更多」按钮（窄屏收起的工具按钮入口） */
  more: '更多',
  /** 输入条（简谱输入键盘）——adj458：图标由「键盘」换成「输入」 */
  keyboard: '输入',
  /** adj426：顶栏「深浅模式」三状态按钮——自动（随系统） */
  themeAuto: '自动主题',
  /** adj426：浅色主题 */
  themeLight: '浅色主题',
  /** adj426：深色主题 */
  themeDark: '深色主题',
} as const

export type ToolIconName = keyof typeof ICON_FILES

/** 全部图标文件名（不含扩展名，按图标名顺序）——供 sw.js 预热清单与 smoke 断言对齐 */
export const ICON_FILE_NAMES: readonly string[] = Object.values(ICON_FILES)
