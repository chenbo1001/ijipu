/**
 * store/editorPrefs.ts — L1「用户个性」偏好的读写（编辑器 + 字体覆盖）
 *
 * 分层原则见 `docs/SETTINGS-AUDIT.md`：
 *  **L0 代码默认 < L1 用户个性（本文件） < L1.5 笔记级 < L2 谱面级(# jps-config) < L3 会话级**
 *
 * 为什么单独成文件：
 *  1. 编辑器字体/字号**属用户个性，不进谱面**——早期版本由顶栏 A−/A+ 直接 `setPageConfig(..., true)`
 *     写进了 `# jps-config`，导致"把 .jps 发给别人、别人的编辑器字体被改"；本次修复把它们
 *     收敛到本文件（唯一读写入口）。
 *  2. 历史遗留值需要兼容：旧值是裸字体名（`Consolas` 等），现在一律经 `normalizeFontStack`
 *     补 fallback 链；旧谱面里误写的 `editorFont/editorFontSize` 由 `migrateLegacyEditorPrefs` 迁移。
 */
import {
  EDITOR_FONT_OPTIONS,
  clampEditorFontSize,
  defaultEditorPrefs,
  defaultFontOverride,
  extractLegacyEditorPrefs,
  normalizeFontStack,
  type EditorPrefs,
  type FontOverride,
} from '@ijipu/engine'

/** L1 缓存键（仅本机；前缀约定 `ijipu.`） */
export const EDITOR_FONT_KEY = 'ijipu.editorFont'
export const EDITOR_FONT_SIZE_KEY = 'ijipu.editorFontSize'
export const FONT_OVERRIDE_KEY = 'ijipu.fontOverride'
/**
 * adj966：网页版 / PWA 的「持久权限」引导**只提示一次**。
 *
 * 属 **L1 用户个性**（"这台机器上我已经知道这件事了"），与具体谱面无关 ⇒ 存 localStorage、不进 `# jps-config`。
 * 文案与判据分别在 `brand/copy.ts` 的 `persistPermissionCopy`、`store/fileHost.ts` 的
 * `shouldGuidePersistPermission`；这里只负责"记住提示过"。
 */
export const PERM_GUIDE_KEY = 'ijipu.permGuideShown'

/** 这台机器上是否已经提示过（存储不可用时按"没提示过"处理：最多多提示一次，不会出错） */
export function hasShownPermGuide(): boolean {
  try {
    return localStorage.getItem(PERM_GUIDE_KEY) === '1'
  } catch {
    return false
  }
}

/** 记下"已提示"（存储不可用时静默——引导只是告知，失败不影响任何功能） */
export function markPermGuideShown(): void {
  try {
    localStorage.setItem(PERM_GUIDE_KEY, '1')
  } catch {
    /* 存储不可用时静默 */
  }
}

/** 历史遗留的等宽字体白名单（旧值可能是任意字体名，仅这些允许继续用） */
const LEGACY_MONO = new Set(['Consolas', 'Courier New', 'monospace'])

function readStr(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStr(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存储不可用时忽略 */
  }
}

/** 读编辑器字体：候选表内直接用；旧裸名（等宽白名单）规范化后使用；否则回落默认 */
export function loadEditorFont(): string {
  const v = readStr(EDITOR_FONT_KEY)
  if (!v) return defaultEditorPrefs.font
  if (EDITOR_FONT_OPTIONS.some((o) => o.value === v)) return v
  if (LEGACY_MONO.has(v)) return normalizeFontStack(v)
  return defaultEditorPrefs.font
}

/** 读编辑器字号（10~26；损坏/越界回落默认） */
export function loadEditorFontSize(): number {
  const raw = readStr(EDITOR_FONT_SIZE_KEY)
  if (raw === null || raw.trim() === '') return defaultEditorPrefs.fontSize
  const n = Number(raw)
  return Number.isFinite(n) ? clampEditorFontSize(n) : defaultEditorPrefs.fontSize
}

export function saveEditorFont(font: string): void {
  writeStr(EDITOR_FONT_KEY, normalizeFontStack(font))
}

export function saveEditorFontSize(px: number): void {
  writeStr(EDITOR_FONT_SIZE_KEY, String(clampEditorFontSize(px)))
}

/** 本机是否已显式设置过编辑器偏好（用于"旧谱面值只在没设过时迁移"） */
export function hasLocalEditorPrefs(): boolean {
  return readStr(EDITOR_FONT_KEY) !== null || readStr(EDITOR_FONT_SIZE_KEY) !== null
}

/** 读"用我的字体覆盖谱面字体"偏好（L1，默认关） */
export function loadFontOverride(): FontOverride {
  const raw = readStr(FONT_OVERRIDE_KEY)
  if (!raw) return { ...defaultFontOverride }
  try {
    const o = JSON.parse(raw) as Partial<FontOverride>
    return { enabled: o.enabled === true, font: normalizeFontStack(o.font ?? defaultFontOverride.font) }
  } catch {
    return { ...defaultFontOverride }
  }
}

export function saveFontOverride(o: FontOverride): void {
  writeStr(FONT_OVERRIDE_KEY, JSON.stringify({ enabled: o.enabled === true, font: normalizeFontStack(o.font) }))
}

/**
 * 一次性迁移：早期版本把 `editorFont/editorFontSize` 写进了谱面 `# jps-config`。
 * 打开这样的谱时，把值搬到本机偏好（**仅当本机从未设置过**，避免覆盖用户当前选择）；
 * 之后任何保存都会以差量写入方式自动清除谱面里的这两个键。
 * @returns 是否发生了迁移
 */
export function migrateLegacyEditorPrefs(code: string, apply: (p: Partial<EditorPrefs>) => void): boolean {
  if (hasLocalEditorPrefs()) return false
  const legacy = extractLegacyEditorPrefs(code)
  if (!legacy) return false
  apply(legacy)
  return true
}
