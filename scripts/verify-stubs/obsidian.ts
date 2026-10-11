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

/**
 * adj866：**记录型 `Menu`** —— 真实宿主里由 Obsidian 弹出；验证页里没有宿主 UI，
 * 于是把"菜单被打开了、里面有哪些项、每项打没打勾"记进 `globalThis.__ijipuMenus`，
 * 供探针断言（只记录，不渲染）。这样"⋯ 更多 到底弹了什么"能在真实浏览器里被验证，
 * 而不是只靠源码正则。
 */
type RecordedMenuItem = { title: string; checked: boolean | null; isLabel: boolean; onClick: (() => void) | null }

export class Menu {
  private items: RecordedMenuItem[] = []
  addItem(cb: (item: MenuItem) => unknown): this {
    const it = new MenuItem()
    cb(it)
    this.items.push({ title: it.title, checked: it.checked, isLabel: it.isLabel, onClick: it.onClickCb })
    return this
  }
  addSeparator(): this {
    this.items.push({ title: '———', checked: null, isLabel: true, onClick: null })
    return this
  }
  private push(): void {
    const g = globalThis as unknown as { __ijipuMenus?: RecordedMenuItem[][] }
    if (!Array.isArray(g.__ijipuMenus)) g.__ijipuMenus = []
    g.__ijipuMenus.push(this.items)
  }
  showAtPosition(): this {
    this.push()
    return this
  }
  showAtMouseEvent(): this {
    this.push()
    return this
  }
}

/** 菜单项（与 Obsidian 的 `MenuItem` 同名同形；验证只关心这几样） */
export class MenuItem {
  title = ''
  checked: boolean | null = null
  isLabel = false
  onClickCb: (() => void) | null = null
  setTitle(t: string): this { this.title = t; return this }
  setIcon(): this { return this }
  setIsLabel(v: boolean): this { this.isLabel = v; return this }
  setChecked(v: boolean | null): this { this.checked = v; return this }
  setDisabled(): this { return this }
  setSection(): this { return this }
  onClick(cb: () => void): this { this.onClickCb = cb; return this }
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
