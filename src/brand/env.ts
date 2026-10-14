/**
 * brand/env.ts — 运行环境判定的**单一出处**（adj954）
 *
 * ## 为什么要有这个文件（用户 2026-10 要求）
 *
 * 用户原话：「尽量有较统一的公共方法或函数来获取这些信息……主要是方便需要的时候可以获取和判断，
 * 且**判断方式统一、准确**」。
 *
 * 在此之前，同一件事（"是不是桌面壳"）在**五处**各写了一遍内联的 `window.__TAURI__?.core?.invoke`
 * 类型体操：`main.tsx` 的 `isTauriDesktop`、`playback/samplerCache.ts` 的 `isTauri`、
 * `playback/spessaSynthBackend.ts`、`preview/openUrl.ts`、`store/workspace.ts`；
 * 再加上 `brand/platform.ts` 与 `brand/env.ts`（本文件）**两个同名同逻辑的 `isDesktopShell`**。
 * 口径一散，迟早漂移——本文件是合并后的唯一一处。
 *
 * ## 三个**互相独立**的维度（别混成一个枚举 ✗）
 *
 * | 维度 | 取值 | 判据 |
 * |---|---|---|
 * | **壳**（外面套的是什么） | `tauri` / `host` / `web` | `__TAURI__` 有无 → 宿主 iframe → 都不是 |
 * | **宿主**（是哪一家） | `obsidian` / `unknown` / `null` | 宿主桥握手时登记的 `hostKind` |
 * | **设备** | `mobile` / `desktop` | `(pointer: coarse)` + UA 兜底 |
 *
 * 「已安装的 PWA」**不是第四个维度**，而是"壳 = web"下的一个附加标记（`installed`）：
 * 它和"浏览器页签"是同一个壳，只是显示模式不同（`display-mode: standalone`）。
 *
 * ## 几处**易错**的口径，写在这里免得再被混用
 *
 * - **"窄屏"（窗口 ≤1024px）不是"手机"判据**：桌面浏览器把窗口拉窄也会为真；
 *   那个语义在 `store/uiStore.ts` 的 `detectNarrow()` / `isNarrow` 里，只决定"布局走窄屏形态"。
 * - **`isHostFrame()`（在 iframe 里）不等于"在 Obsidian 插件里"**：任何页面 iframe 你都会为真。
 *   要"确实是插件"得看握手成功（`store/hostBridge.ts` 的 `isHostEmbedded()`）。
 * - **`isTauriShell()` 必须允许失败**：极少数宿主（跨源 iframe 等）读 `window` 属性就会抛，
 *   按"不是桌面壳"处理，不许把异常抛给调用方。
 */

/** 外面套的壳：Tauri 桌面壳 / 宿主 iframe（Obsidian 嵌入版等）/ 独立网页（浏览器或已安装 PWA） */
export type RuntimeShell = 'tauri' | 'host' | 'web'

/** 宿主是哪一家（只有 `shell === 'host'` 时才有意义；认不出来就是 `'unknown'`） */
export type HostKind = 'obsidian' | 'unknown'

/** 设备形态（粗指针 = 手机 / 平板） */
export type DeviceKind = 'mobile' | 'desktop'

/** 一次拿全的运行环境快照 */
export interface RuntimeEnv {
  /** 外面套的是什么壳 */
  shell: RuntimeShell
  /** 宿主是哪一家；`shell !== 'host'` 时为 `null` */
  host: HostKind | null
  /** 设备形态 */
  device: DeviceKind
  /** 是否以"已安装应用"（PWA standalone）形态打开；只在 `shell === 'web'` 时有意义 */
  installed: boolean
}

/**
 * Tauri 全局对象里的 `core` 子树（我们只用到 `invoke`）。
 * `withGlobalTauri: true`（`src-tauri/tauri.conf.json`）才会注入这个全局。
 */
type TauriCore = { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }

/** Tauri 全局对象里的 `event` 子树（`store/externalOpen.ts` 用它接"外部打开文件"事件） */
type TauriEvent = { listen?: (name: string, cb: (e: unknown) => void) => Promise<() => void> }

/** 我们实际用到的 Tauri 全局形状（只声明用到的子树，不引 `@tauri-apps/api` 依赖） */
export interface TauriGlobal {
  core?: TauriCore
  event?: TauriEvent
}

/**
 * 取 Tauri 全局对象（不在桌面壳里 / 读属性就抛 ⇒ `null`）。
 *
 * ⚠ **这是全项目唯一允许直接读 `__TAURI__` 的地方**——其它文件一律走本模块的
 * `isTauriShell()` / `tauriInvoke()` / `tauriInvokeOrNull()`（有冒烟闸门守着，见 `scripts/smoke.mts`）。
 */
export function tauriGlobal(): TauriGlobal | null {
  try {
    const g = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
    return g ?? null
  } catch {
    // 跨源 iframe 等环境下访问 window 属性就会抛 —— 按"不是桌面壳"处理
    return null
  }
}

/** 取 Tauri 的 `core` 子树（没有 ⇒ `null`） */
export function tauriCore(): TauriCore | null {
  return tauriGlobal()?.core ?? null
}

/** 是否运行在 **Tauri 桌面应用壳**里（`withGlobalTauri` 注入的全局是唯一判据） */
export function isTauriShell(): boolean {
  return typeof tauriCore()?.invoke === 'function'
}

/**
 * `isTauriShell()` 的**历史别名**。
 *
 * `adj628` 起 `brand/platform.ts` 用的是这个名字，调用点很多（`shortcuts` / `externalOpen` /
 * `cliPath` / `PageConfigDialog` / `siteHome`）⇒ `adj954` 统一到本文件时保留别名，
 * 免得为改个名字制造一大片无谓 diff。**新代码请用 `isTauriShell()`**。
 */
export const isDesktopShell = isTauriShell

/**
 * 调一条 Tauri 命令（**不在桌面壳里 ⇒ 抛错**，由调用方决定怎么降级）。
 *
 * 集中在这里的好处：不必每处再写一遍 `__TAURI__` 的类型体操，
 * 也保证"取 invoke"的口径只有一处（`AGENTS §六之二·4` 数值口径同源的同一条道理）。
 */
export async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = tauriCore()
  if (typeof core?.invoke !== 'function') throw new Error('当前不在桌面版里（没有 Tauri 通道）')
  return (await core.invoke(cmd, args)) as T
}

/**
 * 调一条 Tauri 命令；**不在桌面壳里就返回 `null`**。
 *
 * 用于"能就做、不能就算了"的场合（例如设置窗口标题：浏览器里本来就没有这个 IPC）。
 * ⚠ 不能用来掩盖"桌面壳里真的失败了"——那种要 `tauriInvoke` 让它抛（**不静默失败** ✗）。
 */
export async function tauriInvokeOrNull<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriShell()) return null
  try {
    return await tauriInvoke<T>(cmd, args)
  } catch {
    return null
  }
}

/**
 * 是否被**宿主**套在 iframe 里（Obsidian 嵌入版走这条路）。
 *
 * ⚠ 这条只说明"在某个 iframe 里"，**不说明是哪一家宿主**——要"确实是插件"得看
 * `store/hostBridge.ts` 的 `isHostEmbedded()`（握手成功才是真的）。
 * 跨源访问 `window.parent` 会抛 ⇒ 按"在 iframe 里"处理（抛错本身就说明不是顶层窗口）。
 */
export function isHostFrame(): boolean {
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

/** 宿主种类登记位（握手成功后由 `store/hostBridge.ts` 写入；没握手过就是 `null`） */
let hostKind: HostKind | null = null

/** 登记"宿主是哪一家"（**只应由宿主桥调用**；见 `store/hostBridge.ts` 的 `initHostBridge`） */
export function setHostKind(kind: HostKind): void {
  hostKind = kind
}

/**
 * 是否**触屏 / 移动端**（粗指针 = 手机 / 平板；媒体特性不可用时走 UA 兜底）。
 *
 * 判据只看"指针粗不粗 + UA"，**不含窗口宽度**——窄窗口的桌面 Chrome 不该被当成手机
 * （文件选择器的策略完全不同，见 `store/saveSupport.ts` 的说明）。
 * 需要"窄屏也算"的语义时，调用方自己与 `detectNarrow()` 或起来（见 `store/uiStore.ts` 的 `detectTouch`）。
 */
export function isCoarsePointerDevice(): boolean {
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return true
  } catch {
    /* 媒体特性不可用时走下面的 UA 兜底 */
  }
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  } catch {
    return false
  }
}

/**
 * 是否以**已安装应用**（PWA standalone）的形态打开。
 *
 * 两条判据都要，少一条就有平台漏判：
 *  - `matchMedia('(display-mode: standalone)')`：Android Chrome / WebAPK、桌面 Chrome「安装为应用」；
 *  - `navigator.standalone === true`：iOS Safari 的"添加到主屏幕"，它**不认**上面那条。
 *
 * 依据：`public/manifest.webmanifest` 声明了 `"display": "standalone"`。
 */
export function isStandalonePwa(): boolean {
  try {
    if (typeof window === 'undefined') return false
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

/**
 * 拿一份运行环境快照（三个维度一次给全）。
 *
 * 只做**同步**判定：`host` 用的是"宿主桥握手成功了吗"这个已登记的状态，
 * 而握手本身是异步的（`initHostBridge`）⇒ 在启动早期调用时 `host` 可能是 `null`
 * （那是"还没握完手"，不是"不是宿主"）。要判断"插件里"请用 `isHostEmbedded()`。
 */
export function getRuntimeEnv(): RuntimeEnv {
  const shell: RuntimeShell = isTauriShell() ? 'tauri' : isHostFrame() ? 'host' : 'web'
  return {
    shell,
    host: shell === 'host' ? (hostKind ?? 'unknown') : null,
    device: isCoarsePointerDevice() ? 'mobile' : 'desktop',
    installed: shell === 'web' ? isStandalonePwa() : false,
  }
}
