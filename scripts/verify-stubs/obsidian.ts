/**
 * scripts/verify-stubs/obsidian.ts — 验证用最小 Obsidian 替身
 *
 * 只服务 `scripts/verify-score-crop.mjs` 的浏览器构建：让 `scorePane.ts` 能在真实 Chrome 里跑起来，
 * 从而验证"谱面视图只显示内容部分"（依赖 `getBBox()`，Node 里量不到）。
 * **不参与发布产物**。
 */
export class Notice {
  constructor(public message?: string, public timeout?: number) {
    void message
    void timeout
  }
}

export class Menu {
  addItem(): this {
    return this
  }
  addSeparator(): this {
    return this
  }
  showAtMouseEvent(): void {
    /* 验证时不需要真菜单 */
  }
}

export class Setting {
  constructor(public containerEl?: unknown) {
    void containerEl
  }
  setName(): this { return this }
  setDesc(): this { return this }
  setHeading(): this { return this }
  addButton(): this { return this }
  addDropdown(): this { return this }
  addToggle(): this { return this }
  addText(): this { return this }
  addSlider(): this { return this }
  addExtraButton(): this { return this }
}

export class Modal {
  open(): void { /* 验证时不需要 */ }
  close(): void { /* 验证时不需要 */ }
}

export const Platform = { isDesktopApp: true, isMobileApp: false }

export class FileSystemAdapter {
  getFullPath(p: string): string { return p }
}

/**
 * 以下都是"被当值导入"的宿主符号（即使源码里只用了它的类型，`import { App }` 这种写法
 * 也会让打包器要求一个运行时导出）。验证构建里给最小占位即可 —— 本次只验证裁剪几何。
 */
export class App {}
export class Component {}
export class Events {}
export class ItemView {}
export class Keymap {
  static isModEvent(): boolean { return false }
}
export class MarkdownRenderChild {}
export class MarkdownView {}
export class Plugin {}
export class PluginSettingTab {}
export class TFile {}
export class TFolder {}
export class TextFileView {}
export class WorkspaceLeaf {}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  return tpl.content
}

export function createSpan(o?: { cls?: string; attr?: Record<string, string> }): HTMLSpanElement {
  const el = document.createElement('span')
  if (o?.cls) el.className = o.cls
  for (const [k, v] of Object.entries(o?.attr ?? {})) el.setAttribute(k, v)
  return el
}

export function createEl(tag: string): HTMLElement {
  return document.createElement(tag)
}

export function createDiv(o?: { cls?: string; text?: string }): HTMLDivElement {
  const el = document.createElement('div')
  if (o?.cls) el.className = o.cls
  if (o?.text) el.textContent = o.text
  return el
}
