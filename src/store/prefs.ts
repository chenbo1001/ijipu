/**
 * store/prefs.ts — 桌面壳的**本机配置后端**（adj1085）
 *
 * 用户口径（2026-10-23）：
 *   「桌面壳下，本机个人目录下应该创建一个 ijipu 目录用来保存本机配置……而不是依赖浏览器缓存；
 *     网站/PWA 保存到浏览器缓存，插件保存到插件目录，这应该是三端保存的区别。」
 *
 * 落地方式（**不改 80+ 个调用点**）：
 *   启动时先从 `%APPDATA%\iJipu\settings.json` 预载到内存，再把 `window.localStorage` 换成
 *   一个"只接管 `ijipu.` 前缀"的 `Storage` 门面（与插件版 `embedStorage.ts` 同一手法）。
 *   于是 `uiStore` / `docStore` / `editorPrefs` / `practiceMarks` / `bankRegistry` 里所有
 *   同步读写**原样可用**，只是落点从 WebView2 的缓存目录换成了用户配置目录。
 *
 * 失败口径：
 *   · 读不到 / Tauri 命令没有（旧版 exe）⇒ **不替换**，退回浏览器存储，界面照常启动；
 *   · 写盘失败 ⇒ 保留内存值、下次变更再试，并在控制台留痕（不阻塞操作）。
 *
 * ⚠ **命令行出片窗口不走这里**：它是第二个进程，写配置会和主窗口互相覆盖。
 *   出片窗口在 `main.tsx` 里更早就 return 了，只读它需要的默认值。
 */
import { tauriCore } from '../brand/env'
import {
  PREFS_PREFIX,
  createPrefsFacade,
  importLegacyPrefs,
  prefsValuesOf,
  type PrefsSnapshot,
} from './prefsCore'

/** 与 `src-tauri/src/prefs.rs` 的 `PrefsLoaded` 一一对应 */
type LoadedPrefs = {
  exists: boolean
  recovered: boolean
  values: Record<string, string>
}

let installed = false
let snapshot: PrefsSnapshot = new Map()
let timer: ReturnType<typeof setTimeout> | null = null
let dirty = false
let saveChain: Promise<void> = Promise.resolve()
/** 最近一次落盘失败的原因（排错/状态栏用；成功即清空） */
let lastError: string | null = null

/**
 * 「本机配置已就绪」的闸门。
 *
 * 为什么需要：`main.tsx` 末尾还有**另一个顶层 IIFE**（外部改动轮询），它在模块求值时
 * 就会启动，并 `import('./store/docStore')` —— 而 docStore 静态 import 了 uiStore。
 * 于是它会和"读配置文件"赛跑：冷启动时 IPC 稍慢，uiStore 就先用**浏览器 localStorage**
 * 里的旧值求值了（实测：配置文件写 dark，界面却是 light；刷新一次才对）。
 * 那个 IIFE 在动 store 之前先 `await prefsReady`，这个竞态就没了。
 *
 * 非桌面壳/读失败也会 resolve —— 只保证"等待结束"，不保证"已经接管"。
 */
let markReady: () => void = () => {}
export const prefsReady: Promise<void> = new Promise((resolve) => {
  markReady = resolve
})

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = tauriCore()?.invoke
  if (fn === undefined) throw new Error('当前环境没有 Tauri 通道（不是桌面壳）')
  return (await fn(cmd, args)) as T
}

/** 防抖落盘：连续改设置（拖滑块、切主题）时不要每次都写文件 */
const SAVE_DEBOUNCE_MS = 300

function scheduleSave(): void {
  dirty = true
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushPrefsNow()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * 立刻落盘（窗口隐藏/关闭前调用）。
 * 失败不抛：把原因记下来，下次变更继续重试 —— 丢一次写盘不该中断用户操作。
 */
export async function flushPrefsNow(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (!dirty) return
  dirty = false
  const values = prefsValuesOf(snapshot)
  const run = saveChain.then(async () => {
    await invoke('prefs_save', { valuesJson: JSON.stringify(values) })
    lastError = null
  })
  saveChain = run.catch((e: unknown) => {
    dirty = true
    lastError = e instanceof Error ? e.message : String(e)
    console.warn('[iJipu] 本机配置写盘失败（值仍在本会话内存里）：', e)
  })
  await saveChain
}

/**
 * 启动时调用：读配置 → （首次）从 WebView2 localStorage 迁移 → 替换 `window.localStorage`。
 *
 * **必须早于任何 store 模块求值**（它们会在模块顶层读主题/缩放/草稿）。
 *
 * @returns `true` = 已接管（桌面壳且读写正常）；`false` = 保持浏览器存储
 */
export async function preloadDesktopPrefs(): Promise<boolean> {
  if (installed) {
    markReady()
    return true
  }
  const fn = tauriCore()?.invoke
  if (fn === undefined) {
    markReady()
    return false
  }
  try {
    const loaded = await invoke<LoadedPrefs>('prefs_load')
    snapshot = new Map(Object.entries(loaded.values ?? {}))
    if (!loaded.exists) {
      /**
       * 首次升级/首次安装：把 WebView2 里现有的 `ijipu.*` 搬进文件。
       *
       * **源不删**：万一新文件写失败，旧版本回退还能读到设置；等这一版用稳了再谈清理。
       */
      const legacy = importLegacyPrefs(window.localStorage)
      for (const [k, v] of legacy) snapshot.set(k, v)
      if (snapshot.size > 0) {
        dirty = true
        await flushPrefsNow()
      }
    } else if (loaded.recovered) {
      console.warn('[iJipu] 本机配置主文件损坏，已回退到上一份备份（settings.bak.json）')
    }
    install()
    return true
  } catch (e) {
    console.warn('[iJipu] 本机配置预载失败，暂时回退浏览器存储：', e)
    return false
  } finally {
    // 无论成功/失败都放行：等待方只关心"可以继续动 store 了"，不关心接管与否
    markReady()
  }
}

/** 替换 `window.localStorage`（只接管 `ijipu.` 前缀） */
function install(): void {
  if (installed) return
  const real = window.localStorage
  const facade = createPrefsFacade(real, snapshot, scheduleSave)
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => facade,
    })
  } catch (e) {
    // Gecko/受限环境里 defineProperty 可能失败：宁可继续用浏览器存储，也不要让设置写丢
    console.warn('[iJipu] 无法接管 localStorage，继续使用浏览器存储：', e)
    return
  }
  installed = true
  console.info(`[iJipu] 本机配置已接管 localStorage（${snapshot.size} 个键，落点：用户配置目录/iJipu/settings.json）`)

  /**
   * 关窗/切走前补一次落盘。
   * `beforeunload` 里的异步 invoke 不一定来得及，但"最后一次变更"通常已在 300ms 内落过；
   * 这里主要是兜住"改完立刻关窗"那一下。
   */
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPrefsNow()
  })
  window.addEventListener('beforeunload', () => {
    void flushPrefsNow()
  })
}

/** 配置目录（给设置页的"打开配置目录"/排错用；没有接管时回 `null`） */
export async function desktopPrefsPath(): Promise<string | null> {
  if (!installed) return null
  try {
    return await invoke<string>('prefs_path')
  } catch {
    return null
  }
}

/** 排错探针：接管状态 + 最近一次写盘错误 */
export function desktopPrefsStatus(): { installed: boolean; keys: number; error: string | null } {
  return { installed, keys: snapshot.size, error: lastError }
}

/** 仅供测试/排错：当前快照里以某前缀开头的键（不暴露整份配置） */
export function prefsKeysWithPrefix(prefix = PREFS_PREFIX): string[] {
  return [...snapshot.keys()].filter((k) => k.startsWith(prefix)).sort()
}
