/**
 * brand/shortcuts.ts — **快捷键提示的唯一出处**（adj617，用户要求）
 *
 * 用户口径："上述的这些快捷键应显示在菜单项后面，顶栏、底栏、浮动栏的按钮的提示文本后面。"
 *
 * 为什么单独一张表：同一个键要在**四处**出现——菜单项的 `kbd` 角标、顶栏按钮的 `title`、
 * 底栏页签/档位/收起按钮的 `title`、编辑区左下角「展开底栏」浮动按钮的 `title`，
 * 外加「快捷键速查」对话框的键名列。五处各写一份字符串必然漂移（本项目反复踩的坑：
 * 两份清单必然对不上），所以**键名只在这里定义一次**，各处引用 `KBD.*`，
 * 提示文本一律用 `withKbd()` 拼（保证格式一致：`说明（Ctrl+X）`）。
 *
 * ⚠ 平台限制（实测见 E-2026-300/301）：浏览器把 `Ctrl+T`（新标签页）、`Ctrl+P`（打印）留给了自己，
 * 页面收不到 keydown ⇒ 网页版这两条按不动（桌面壳正常）。速查对话框里已注明。
 *
 * ⚠ 键位调整史（写在这里免得下次又"发现冲突"）：`Ctrl+O` 一度按用户要求改挂「导出」（adj615），
 * 后来又按用户要求**改回「打开文件」**；导出改用 `Ctrl+Y`（adj619b），
 * 而 `Ctrl+Y` 原是"重做" ⇒ **重做挪到跨平台惯例 `Ctrl+Shift+Z`**。
 */
export const KBD = {
  /** adj185 起：文件类 */
  newDoc: 'Ctrl+N',
  /** 打开文件（adj615 一度改挂「导出」，adj619b 按用户要求**改回**打开文件） */
  openDoc: 'Ctrl+O',
  save: 'Ctrl+S',
  /** 重做（adj619b：`Ctrl+Y` 让给「导出」后，重做改用跨平台惯例 `Ctrl+Shift+Z`） */
  redo: 'Ctrl+Shift+Z',
  /** adj563：试听（开关底栏） */
  tryout: 'Ctrl+Q',
  /** adj615/adj619b：导出开关（用户指定 `Ctrl+Y`） */
  export: 'Ctrl+Y',
  /** adj615：打印 */
  print: 'Ctrl+P',
  /** adj614：编辑设置组 */
  wrap: 'Ctrl+L',
  pad: 'Ctrl+K',
  /** adj614：深浅模式循环 */
  theme: 'Ctrl+T',
  /** adj614：视图循环 */
  view: 'Ctrl+M',
  /** adj616：排版辅助虚线开关 */
  guides: 'Ctrl+E',
  /** adj616：工作区 / 导入开关 */
  workspace: 'Ctrl+B',
  import: 'Ctrl+I',
  /** adj618：告警开关 */
  problems: 'Ctrl+`',
  /** 快捷键速查（adj619c：用户要求改成 `Alt+F1`；原先挂在这个物理键的 Shift 档 `Ctrl+~` 上） */
  shortcuts: 'Alt+F1',
  /** adj610：底栏展开/收起、高度档位 */
  dock: 'Ctrl+D',
  dockSize: 'Ctrl+H',
  /** adj608：焦点在底栏里按 Esc = 最小化底栏 */
  dockMin: 'Esc',
} as const

/** 把快捷键拼到提示文本后面：`排版辅助虚线` → `排版辅助虚线（Ctrl+E）` */
export const withKbd = (text: string, kbd: string): string => `${text}（${kbd}）`
