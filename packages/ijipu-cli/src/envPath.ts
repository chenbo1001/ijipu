/**
 * envPath.ts — 把「iJipu 安装目录」**注册进 / 解除出当前用户 PATH** 的纯逻辑（adj944）
 *
 * 用户需求（2026-10 原话）：「需要在全局设置里添加一个注册 iJipu CLI 的提示和按钮，
 * 未注册时显示「注册」、已注册时显示「解除」；**只有注册后，才能在打开终端时就能 `ijipu cli`**」。
 * 用户已选定方案：**注册 = 把「安装目录本身」写进当前用户 PATH**（不建 bin 垫片 ✓）。
 *
 * ## 为什么这一段逻辑放这里（而不是 Rust 里、也不是应用侧各写一份）
 *  · PATH 的增删**是字符串口径**（分号切分 / 大小写无关比较 / 末尾分隔符 / 幂等 / 长度上限），
 *    抽成纯函数才能被 `scripts/smoke.mts` **成对断言 + 负对照**守住；
 *    （`npm run test:rust` 在本机因测试宿主加载失败跑不起来 —— 见 `docs/ERRORS-LOG.md` E-2026-427，
 *     所以"只靠 Rust 单测"的口径在本仓库是**守不住**的 ✗。）
 *  · **只有一份实现**：应用界面（`src/store/cliPath.ts` 注入 Tauri IO）与命令行
 *    （`ijipu cli register|unregister|status`，宿主注入注册表 IO）调用的是**同一组函数** ✓；
 *  · 真正"碰系统"的部分（读写注册表 / 写前备份 / 回读校验 / 广播 `WM_SETTINGCHANGE`）全在
 *    Rust（`src-tauri/src/cli_path.rs`），这里只做字符串与编排 ⇒ 两端不会各写一套 ✗。
 *
 * ## 口径（逐条对应用户要求）
 *  · **幂等**：已经注册过（含**大小写不同**、末尾多/少一个斜杠、被引号包住）⇒ 不重复追加 ✓；
 *  · **只动自己那一条**：解除时其余条目**逐字保留**（不 trim、不去重、不整理别人的项 ✓）；
 *  · **长度上限** `PATH_MAX_CHARS = 2047`：超过 ⇒ **拒绝写入**并给出可执行建议 ✓；
 *  · **状态读系统实况**：`readPath()` 每次现读注册表 ⇒ 用户手动改过 PATH 也如实反映 ✓
 *    （**不许**记在自己的配置里 ✗）。
 */

/**
 * PATH 值的**经典长度上限**（字符）。
 *
 * 由来：老版本 Windows 的 `PATH` 环境变量上限是 2047 字符（环境块里的单个值），
 * 现在虽然放宽了，但**超过它就有"某些老程序读不全 / 变量被截断"的风险**——
 * 与其写了之后出现"有些终端能看到、有些看不到"这种最难查的症状，不如**写前就拒绝**并让用户
 * 自己清理 ✓（用户要求：超过 2047 ⇒ 不写、明确报错、给出可执行建议）。
 *
 * ⚠ 这个数字在 Rust 侧（`src-tauri/src/cli_path.rs`）有一份**防御性副本**，
 *   两处一致由 `scripts/smoke.mts` 的 `adj944` 闸门逐字核对（跨语言没法共用常量，那就机器守住 ✓）。
 */
export const PATH_MAX_CHARS = 2047

/** 增删 PATH 需要的**宿主 IO**（Rust 侧实现；应用界面与命令行各自注入一份） */
export type PathHostIo = {
  /** 本程序（`ijipu.exe`）所在目录 —— 就是写进 PATH 的那一条 */
  installDir(): Promise<string>
  /** `ijipu.exe` 的完整路径（App Paths 用；不注入就跳过 App Paths） */
  exePath?(): Promise<string>
  /** 读 `HKCU\Environment\Path` 的**当前值**（没有这个值 ⇒ null） */
  readPath(): Promise<string | null>
  /** 写 `HKCU\Environment\Path`（宿主负责：写前备份、写入、**回读校验**、广播 `WM_SETTINGCHANGE`） */
  writePath(value: string): Promise<void>
  /** 读 `HKCU\...\App Paths\ijipu.exe` 的默认值（可选能力） */
  readAppPaths?(): Promise<string | null>
  /** 写 App Paths（可选能力） */
  writeAppPaths?(exePath: string): Promise<void>
  /** 删 App Paths 里**我们自己的**那一条（可选能力；不是我们写的不动 ✓） */
  removeAppPaths?(): Promise<void>
}

/** 注册状态（**每次都现读系统**，不是缓存） */
export type CliPathStatus = {
  /** 安装目录（= 要写进 PATH 的条目） */
  installDir: string
  /** 当前用户 PATH 的原值（没有这个值 ⇒ 空串） */
  pathValue: string
  /** 原值长度（给界面显示"离上限还有多少"） */
  pathLength: number
  /** 是否**已注册**（按 PATH 现况判定，不认"我们自己写过的格式" ✓） */
  registered: boolean
  /** App Paths 里当前指向的 exe（没有/拿不到 ⇒ null） */
  appPaths: string | null
}

/** 失败原因（**机器可读**）：界面按它取 `brand/copy.ts` 的文案，命令行按它拼 stderr ✓ */
export type CliPathError = { kind: 'too-long'; length: number; limit: number } | { kind: 'io'; detail: string }

/** 一次注册/解除的结果 */
export type CliPathAction =
  | { ok: true; changed: boolean; status: CliPathStatus }
  | { ok: false; error: CliPathError }

// ---------------------------------------------------------------------------
// 纯函数：字符串进出（有单测/冒烟断言钉着，见 scripts/smoke.mts 的 adj944 段）
// ---------------------------------------------------------------------------

/**
 * 按 `;` 切分 PATH —— **保留空条目**。
 *
 * 为什么刻意保留空串：连续分号（`A;;B`）、末尾分号（`A;`）都是**别人的原样内容**，
 * 顺手过滤掉就等于"改了别人的项" ✗（解除后"其余逐字不动"这条就靠它成立）。
 */
export function splitPathEntries(value: string): string[] {
  return value.split(';')
}

/**
 * 把一个条目归一化成**用于比较**的样子（**只用于比较，绝不回写** ✗）：
 * 去首尾空白、去掉包裹的双引号、去掉末尾的 `\` 或 `/`、统一小写。
 *
 * 这样"别人手动加的同一目录"（大小写不同 / 带引号 / 末尾多个反斜杠）也会被认成**已注册** ✓
 * —— 判据是"目录是不是已经在 PATH 里"，**不是**"是不是我们写过的那个样子" ✓。
 */
export function normalizePathEntry(entry: string): string {
  let s = entry.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1)
  s = s.replace(/[\\/]+$/, '')
  return s.toLowerCase()
}

/** PATH 里是否已有这个目录（大小写无关；空 PATH / 空目录 ⇒ false） */
export function pathHasDir(value: string, dir: string): boolean {
  const want = normalizePathEntry(dir)
  if (want === '') return false
  return splitPathEntries(value).some((e) => normalizePathEntry(e) === want)
}

/** 追加结果：成功给新值（`changed=false` 表示"本来就有，一个字都没动"）；超长则失败 */
export type PathAddResult =
  | { ok: true; value: string; changed: boolean }
  | { ok: false; reason: 'too-long'; length: number; limit: number }

/**
 * 把目录**追加**到 PATH（幂等）。
 *
 * 追加口径：空 PATH ⇒ 就是它自己；末尾已有分号 ⇒ **不再补一个**（不制造 `;;`）；
 * 末尾没有 ⇒ 补一个 `;` 再接上。已经存在（含大小写/引号/末尾斜杠不同）⇒ 原值返回、`changed=false` ✓。
 */
export function addDirToPath(value: string, dir: string): PathAddResult {
  if (pathHasDir(value, dir)) return { ok: true, value, changed: false }
  const next = value === '' ? dir : value.endsWith(';') ? `${value}${dir}` : `${value};${dir}`
  if (next.length > PATH_MAX_CHARS) {
    return { ok: false, reason: 'too-long', length: next.length, limit: PATH_MAX_CHARS }
  }
  return { ok: true, value: next, changed: true }
}

/**
 * 从 PATH 里**摘掉**这个目录（幂等），返回新值。
 *
 * · 只摘**匹配的条目**（比较口径同 `normalizePathEntry`），其余条目**逐字保留**（含空条目）✓；
 * · 目录不在里面 ⇒ 原值**逐字返回**（调用方按"新旧相等"判断不必写注册表 ✓）；
 * · 不因"移除"而失败（它只会变短，不会撞长度上限 ✓）。
 */
export function removeDirFromPath(value: string, dir: string): string {
  const want = normalizePathEntry(dir)
  if (want === '') return value
  return splitPathEntries(value)
    .filter((e) => normalizePathEntry(e) !== want)
    .join(';')
}

// ---------------------------------------------------------------------------
// 编排：读实况 → 算新值 → 写 → 再读实况回来（IO 由宿主注入）
// ---------------------------------------------------------------------------

/** 读**系统实况**（每次都现读；界面与命令行共用这一条 ✓） */
export async function cliPathStatus(host: PathHostIo): Promise<CliPathStatus> {
  const installDir = await host.installDir()
  const raw = await host.readPath()
  const pathValue = raw ?? ''
  const appPaths = host.readAppPaths ? await host.readAppPaths() : null
  return {
    installDir,
    pathValue,
    pathLength: pathValue.length,
    registered: pathHasDir(pathValue, installDir),
    appPaths,
  }
}

/** 把异常统一成 `{ kind: 'io' }`（**带上原因原文**，界面/命令行都要能显示"为什么失败" ✓） */
function asIoError(e: unknown): CliPathError {
  return { kind: 'io', detail: e instanceof Error ? e.message : String(e) }
}

/** 注册（幂等）：把安装目录追加进 PATH，顺带写 App Paths；返回**写后现读**的实况 */
export async function cliPathRegister(host: PathHostIo): Promise<CliPathAction> {
  try {
    const before = await cliPathStatus(host)
    const edit = addDirToPath(before.pathValue, before.installDir)
    if (!edit.ok) {
      return { ok: false, error: { kind: 'too-long', length: edit.length, limit: edit.limit } }
    }
    if (edit.changed) await host.writePath(edit.value)
    // App Paths 是**可选**便利（"运行"对话框 / 资源管理器地址栏也能敲 ijipu）：
    // 每次都写一遍 ⇒ 应用换目录后自动纠正 ✓；没有该能力的环境跳过 ✓。
    if (host.writeAppPaths && host.exePath) await host.writeAppPaths(await host.exePath())
    return { ok: true, changed: edit.changed, status: await cliPathStatus(host) }
  } catch (e) {
    return { ok: false, error: asIoError(e) }
  }
}

/** 解除（幂等）：只摘掉安装目录那一条，其余逐字不动；顺带删我们自己写的 App Paths */
export async function cliPathUnregister(host: PathHostIo): Promise<CliPathAction> {
  try {
    const before = await cliPathStatus(host)
    const next = removeDirFromPath(before.pathValue, before.installDir)
    if (next !== before.pathValue) await host.writePath(next)
    if (host.removeAppPaths) await host.removeAppPaths()
    return { ok: true, changed: next !== before.pathValue, status: await cliPathStatus(host) }
  } catch (e) {
    return { ok: false, error: asIoError(e) }
  }
}
