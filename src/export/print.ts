/**
 * export/print.ts — 打印（adj615，用户要求：菜单「打印」+ `Ctrl+P`）
 *
 * ## 为什么"就在当前窗口打印"、不开新窗口
 * adj411 撤掉过"开新窗口 + 写 A4 分页 HTML + `window.print()`"那条老路，原因是**新窗口会被拦**
 * （用户实测；桌面壳 WebView2 里 `window.open` 同样不可靠）。所以这里走**打印期专用布局**：
 *  1. 把预览页的每一页 SVG 原样塞进一个 `#jp-print-root` 容器（屏幕上 `display: none`）；
 *  2. 打印时给 `<body>` 加 `.jp-printing` ⇒ `@media print` 里**只留这个容器**（见 `styles` 里的打印段）；
 *  3. `window.print()` 之后由 `afterprint` 收尾（容器与类都清掉；用户取消也会触发）。
 *
 * ## 两条入口都要正确（这是本模块存在的主要理由）
 *  · **应用自己触发**（菜单「打印」/ `Ctrl+P` 被页面收下）→ `docStore.printScore()` 算好页面调 `printPages()`；
 *  · **平台自己弹打印**（浏览器把 `Ctrl+P` 收走时；WebView2 也可能收）→ 那时代码里谁都跑不到，
 *    只有 `beforeprint` 会触发 ⇒ `installPrintHooks(getPages)` 在这里补上页面。
 *    两条路都保证"打出来的是谱面，而不是整个应用界面"。
 *
 * 纯浏览器副作用（DOM + `window.print()`），不读 store——页面字符串由调用方给（与 `export/*` 其它
 * 函数同一姿势：数据从组件/store 层传进来）。
 */
export const PRINT_ROOT_ID = 'jp-print-root'

/** 打印期挂在 `<body>` 上的类（`@media print` 用它隐去应用界面） */
export const PRINT_BODY_CLASS = 'jp-printing'

/** 页面容器里每一页的类名（分页由 `break-after: page` 负责） */
const PRINT_PAGE_CLASS = 'jp-print-page'

/** 是否已经注册过 `beforeprint` / `afterprint`（幂等） */
let hooksInstalled = false

/**
 * adj626：打印期临时改过的 `document.title` 原值（null = 当前没改）。
 *
 * 为什么要改标题：浏览器/桌面壳把**文档标题**当作"打印 → 另存为 PDF"的**默认文件名**，
 * 代码里没有别的入口能设定它。用户口径：默认文件名 = **第一个描述头 `Z:` 的值**
 * （见 `export/printName.ts`）。收尾（`afterprint`）时还原，应用标题仍由 `App` 统一维护。
 */
let savedTitle: string | null = null

/** 打印期把标题换成"这份谱的名字"（幂等：只记一次原值）；名字别用 `use*` 前缀——会被当成 React Hook */
function applyPrintTitle(name?: string): void {
  if (!name) return
  if (savedTitle === null) savedTitle = document.title
  document.title = name
}

/** 还原打印期改过的标题（没改过则不动） */
function restoreTitle(): void {
  if (savedTitle === null) return
  document.title = savedTitle
  savedTitle = null
}

/** 清掉打印容器与标记（打印结束 / 重复打印前都调），并把标题还原 */
export function clearPrintRoot(): void {
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.body.classList.remove(PRINT_BODY_CLASS)
  restoreTitle()
}

/** 把页面 SVG 装进打印容器（先清旧的，避免重复打印叠一份） */
function fillPrintRoot(pages: readonly string[]): void {
  clearPrintRoot()
  if (pages.length === 0) return
  const host = document.createElement('div')
  host.id = PRINT_ROOT_ID
  host.setAttribute('aria-hidden', 'true')
  for (const svg of pages) {
    const page = document.createElement('div')
    page.className = PRINT_PAGE_CLASS
    // 页面来自我们自己的渲染（`renderScoreToSvg`），不是外部输入
    page.innerHTML = svg
    host.appendChild(page)
  }
  document.body.appendChild(host)
}

/**
 * 打印这些页面（同一窗口）。
 * @param pages 每一页的 SVG 字符串（`renderScoreToSvg()` 的产物）
 * @param fileName adj626：打印/另存 PDF 的默认文件名（缺省则不动标题）
 */
export function printPages(pages: readonly string[], fileName?: string): void {
  fillPrintRoot(pages)
  applyPrintTitle(fileName)
  document.body.classList.add(PRINT_BODY_CLASS)
  window.print()
  // `window.print()` 在部分环境是**非阻塞**的（打印预览独立窗口）⇒ 收尾交给 `afterprint`；
  // 不走"print() 之后立刻 clear"（那会把正在排版的容器删掉、标题也会在对话框取名字之前被还原）。
}

/**
 * 注册"平台自己弹打印"时补页面（**幂等**，`App` 挂载时调一次即可）。
 * @param getPages 现取当前文档的打印页（返回空数组 = 这次没什么可打）
 * @param getFileName adj626：现取"另存为 PDF"的默认文件名（第一个 `Z:` 的值，见 `printName.ts`）——
 *   平台把 `Ctrl+P` 收走时页面收不到 keydown，只能靠 `beforeprint` 在这里补上标题
 */
export function installPrintHooks(
  getPages: () => readonly string[],
  getFileName?: () => string | undefined,
): void {
  if (hooksInstalled) return
  hooksInstalled = true
  window.addEventListener('beforeprint', () => {
    // 应用自己触发时容器已经装好，这里再装一次内容相同（幂等）；平台自己弹时全靠这一步
    fillPrintRoot(getPages())
    applyPrintTitle(getFileName?.())
    document.body.classList.add(PRINT_BODY_CLASS)
  })
  window.addEventListener('afterprint', () => clearPrintRoot())
}
