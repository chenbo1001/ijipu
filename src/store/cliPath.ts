/**
 * store/cliPath.ts — 应用侧「注册 iJipu 命令行入口到当前用户 PATH」的 **IO 接线**（adj944；adj946 改口径）
 *
 * 为什么单独一个文件：**纯逻辑不在这里**（那在 `packages/ijipu-cli/src/envPath.ts`：
 * `binDirOf` / `addDirToPath` / `removeDirFromPath` / `pathHasDir` + 三个编排函数）——
 * 那是桌面端按钮与 `ijipu cli register|unregister|status` **共用的一份实现** ✓
 * （AGENTS §六之二·4「数值口径必须同源」的同一道理：口径只许有一处）。
 * 本文件只做一件事：把 Rust 侧的注册表命令接成 `envPath.ts` 要的 `PathHostIo`。
 *
 * **注册写进 PATH 的是 `<安装目录>\bin`**（命令行入口垫片 `ijipu.cmd` 在那里；目录由
 * `envPath.ts` 的 `binDirOf` 从安装目录推导，**不在这里再拼一遍** ✓）—— 理由见该文件头。
 *
 * Rust 侧的对应命令（`src-tauri/src/cli_path.rs`）：
 *  · `cli_path_status`      → 现读安装目录 / PATH 原值 / 原值类型 / App Paths / 我们的备份
 *  · `cli_path_register`    → 写入**调用方算好的**新值 + 写 App Paths（备份 / 回读校验 / 广播在 Rust）
 *  · `cli_path_unregister`  → 同上 + 删我们自己写的 App Paths
 *
 * ⚠ 网页版没有 `window.__TAURI__` ⇒ 这三条命令**根本不存在**：这里如实返回失败原因，
 *   界面据此显示"网页版不支持"并禁用按钮（**不假装可用** ✓）。
 */
import { isDesktopShell } from '../brand/platform'
// ⚠ 与命令行共用同一份纯逻辑（跨包**相对路径**引用：本仓库对引擎也是"源码级共享"的口径）
import {
  cliPathRegister,
  cliPathStatus,
  cliPathUnregister,
  type CliPathAction,
  type CliPathStatus,
  type PathHostIo,
} from '../../packages/ijipu-cli/src/envPath'

/** 桌面壳的 `invoke`（不在壳里 ⇒ null） */
type ShellInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

function shellInvoke(): ShellInvoke | null {
  try {
    const g = (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__
    const fn = g?.core?.invoke
    return typeof fn === 'function' ? (fn as ShellInvoke) : null
  } catch {
    return null
  }
}

/** Rust `cli_path_status` 的返回（字段名与 `src-tauri/src/cli_path.rs` 的 `CliPathStatus` 一致） */
type RawCliPathStatus = {
  installDir: string
  exePath: string
  pathValue: string | null
  pathKind: string
  appPathsValue: string | null
  backupValue: string | null
}

/** 注册/解除（`register` 会顺带写 App Paths，`unregister` 会顺带删我们自己写的那条） */
export type CliPathMode = 'register' | 'unregister'

/**
 * 造一个 `PathHostIo`（**按动作给 mode**：两者只在"App Paths 怎么写"上不同）。
 *
 * 小优化：Rust 的 status 命令一次就把安装目录/PATH/App Paths 都读回来了，
 * 而 `envPath.ts` 的编排会问好几次 ⇒ 这里**每次动作只调一次 status**，之后走缓存；
 * 写入动作会把缓存清掉（写完必须重新现读，否则界面显示的就不是实况 ✗）。
 */
function tauriPathHost(mode: CliPathMode): PathHostIo {
  let cached: RawCliPathStatus | null = null
  const invoke = shellInvoke()
  if (invoke === null) throw new Error('当前不在桌面版里：无法读写当前用户的 PATH')
  const read = async (): Promise<RawCliPathStatus> => {
    if (cached === null) cached = (await invoke('cli_path_status')) as RawCliPathStatus
    return cached
  }
  return {
    async installDir() {
      return (await read()).installDir
    },
    async exePath() {
      return (await read()).exePath
    },
    async readPath() {
      return (await read()).pathValue
    },
    async readAppPaths() {
      return (await read()).appPathsValue
    },
    async writePath(value) {
      cached = null
      await invoke(mode === 'register' ? 'cli_path_register' : 'cli_path_unregister', { next: value })
    },
  }
}

/** 读一次系统实况（拿不到就返回原因；界面据此显示，**不写死"失败"** ✓） */
export async function readCliPathStatus(): Promise<
  { ok: true; status: CliPathStatus } | { ok: false; reason: string }
> {
  if (!isDesktopShell()) return { ok: false, reason: 'web' }
  try {
    return { ok: true, status: await cliPathStatus(tauriPathHost('register')) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** 注册 / 解除（**幂等**：已注册再点注册不会重复写入，见 `envPath.ts` 的纯函数） */
export async function applyCliPath(mode: CliPathMode): Promise<CliPathAction> {
  if (!isDesktopShell()) {
    return { ok: false, error: { kind: 'io', detail: '网页版没有读写 PATH 的权限（只有桌面版能做）' } }
  }
  try {
    const host = tauriPathHost(mode)
    return mode === 'register' ? await cliPathRegister(host) : await cliPathUnregister(host)
  } catch (e) {
    return { ok: false, error: { kind: 'io', detail: e instanceof Error ? e.message : String(e) } }
  }
}

/**
 * adj945（用户需求）：**用系统默认程序打开安装目录里的 CLI 使用手册**。
 *
 * 为什么走我们自己的 Rust 命令（`cli_manual_open`）、而不是前端直接调 opener 的 `open_path`：
 * 见 `src-tauri/src/cli_manual.rs` 文件头 —— opener 的 `open_path` 除了"允许调用命令"还要
 * "路径落在 scope 里"，前端直接调会因"scope 为空"被拒，而前端那层是静默兜底 ⇒
 * 用户看到的是"点了没反应"（`adj894` 的官网链接就这么藏了一整个版本 ✗）。
 * Rust 侧调 opener **不经 ACL**，且路径由它按 `resource_dir()` 自己算 ✓。
 *
 * 失败一律带**可读原因**（文件不在 / 系统打不开），界面把它显示出来 —— **不静默失败** ✗。
 */
export async function openCliManual(): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const invoke = shellInvoke()
  if (invoke === null) return { ok: false, reason: 'web' }
  try {
    return { ok: true, path: (await invoke('cli_manual_open')) as string }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
