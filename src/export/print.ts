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

/** 清掉打印容器与标记（打印结束 / 重复打印前都调） */
export function clearPrintRoot(): void {
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.body.classList.remove(PRINT_BODY_CLASS)
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
 */
export function printPages(pages: readonly string[]): void {
  fillPrintRoot(pages)
  document.body.classList.add(PRINT_BODY_CLASS)
  window.print()
  // `window.print()` 在部分环境是**非阻塞**的（打印预览独立窗口）⇒ 收尾交给 `afterprint`；
  // 不走"print() 之后立刻 clear"（那会把正在排版的容器删掉）。
}

/**
 * 注册"平台自己弹打印"时补页面（**幂等**，`App` 挂载时调一次即可）。
 * @param getPages 现取当前文档的打印页（返回空数组 = 这次没什么可打）
 */
export function installPrintHooks(getPages: () => readonly string[]): void {
  if (hooksInstalled) return
  hooksInstalled = true
  window.addEventListener('beforeprint', () => {
    // 应用自己触发时容器已经装好，这里再装一次内容相同（幂等）；平台自己弹时全靠这一步
    fillPrintRoot(getPages())
    document.body.classList.add(PRINT_BODY_CLASS)
  })
  window.addEventListener('afterprint', () => clearPrintRoot())
}
