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
// adj954：环境判定统一走 brand/env.ts（此前这里指向 brand/platform.ts，那份已合并删除）
import { isDesktopShell, tauriInvoke } from '../brand/env'
// ⚠ 与命令行共用同一份纯逻辑（跨包**相对路径**引用：本仓库对引擎也是"源码级共享"的口径）
import {
  cliPathRegister,
  cliPathStatus,
  cliPathUnregister,
  type CliPathAction,
  type CliPathStatus,
  type PathHostIo,
} from '../../packages/ijipu-cli/src/envPath'

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
 *
 * adj954：`invoke` 的取用改走 `brand/env.ts` 的 `tauriInvoke`（原先这里自己读 `__TAURI__`）。
 */
function tauriPathHost(mode: CliPathMode): PathHostIo {
  let cached: RawCliPathStatus | null = null
  if (!isDesktopShell()) throw new Error('当前不在桌面版里：无法读写当前用户的 PATH')
  const read = async (): Promise<RawCliPathStatus> => {
    if (cached === null) cached = await tauriInvoke<RawCliPathStatus>('cli_path_status')
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
      await tauriInvoke(mode === 'register' ? 'cli_path_register' : 'cli_path_unregister', { next: value })
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
 * adj957（用户裁定）：**`openCliManual()` 已删除** ——
 *
 * 原先它用系统默认程序打开随包放在安装目录里的 `docs/iJipu-CLI-手册.md`（Rust 命令 `cli_manual_open`）。
 * 用户口径：那几份 MD **不必随包分发**，命令行手册在**应用内**看就行（与操作手册/语法说明同一个
 * `DocDialog`，见 `dialogs/DocDialog.tsx`）⇒ 随包 MD、`cli_manual.rs`、`tauri.conf.json` 的资源映射、
 * `scripts/check-installer.mjs` 的相关闸门**一并撤掉**。
 *
 * 顺带解决了一个真缺陷：Windows **默认没有 `.md` 关联程序**，那个按钮在多数机器上会弹
 * 「你要如何打开此文件」——而 DocDialog 是应用内渲染，不依赖任何外部关联。
 */
