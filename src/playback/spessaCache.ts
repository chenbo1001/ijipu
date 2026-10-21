/**
 * src/playback/spessaCache.ts — SpessaSynth 高质量音源（SF2/SF3 ArrayBuffer）离线缓存（adj331）
 *
 * 音源较大（32MB+），用 IndexedDB 存 ArrayBuffer 实现离线可用（Web / Tauri WebView 均持久化）。
 * 提供解析（resolveHqBank）、预取（prefetchHqLibraryProgress）、删除。
 * adj416：桌面端音源随安装包内置在**安装目录**（`generaluser_gs.sf2`）——直接读文件、
 * 不写 IndexedDB（不重复占 30MB），也不显示「正在下载」提示；Web 端仍走远端下载 + 缓存。
 * adj953：嵌入版（Obsidian）里音源在**插件目录**、由宿主给出取用地址 ⇒ **预取也先问宿主**
 * （`prefetchHqLibraryProgress` 的第 4 个参数）——否则缓存一空就去联网下 32MB，用户每次都看到下载提示。
 */
import { loadHqBank, loadBuiltinBank, hasBuiltinBank } from './spessaSynthBackend'
import { planHqBankLoad } from '@ijipu/engine'
import type { HqSampleLibrary } from './spessaSynthBackend'
// adj1010：字节读写与数据库版本号收敛在注册表里（同一个库只能有一处 `indexedDB.open`）
import { deleteBankBytes, hasBankBytes, readBankBytes, saveBankBytes } from './bankRegistry'

/** 音源来源（adj416）：builtin=安装目录随包内置（桌面直读）；cache=IndexedDB 缓存；remote=联网下载；
 *  **host（adj953）=宿主（Obsidian 插件目录）给的那份**——嵌入版里它才是"随文库一起走"的权威副本 */
export type HqBankSource = 'builtin' | 'cache' | 'remote'

/**
 * SF2/SF3 ArrayBuffer 缓存（IndexedDB，键=库 id）。
 *
 * adj1010：底层读写**收敛到 `bankRegistry.ts`**（同一个数据库、同一个版本号只能有一处
 * `indexedDB.open`——两处版本不一致会抛 `VersionError`）。本类只保留调用方需要的那四个方法，
 * 接口一字未变，所以 `resolveHqBank` / `prefetchHqLibraryProgress` 一行都不用改。
 */
export class HqCache {
  load(id: string): Promise<ArrayBuffer | null> {
    return readBankBytes(id)
  }
  /** 极快：只查键是否存在（getKey，不读全量 141MB） */
  has(id: string): Promise<boolean> {
    return hasBankBytes(id)
  }
  save(id: string, ab: ArrayBuffer): Promise<void> {
    return saveBankBytes(id, ab)
  }
  remove(id: string): Promise<void> {
    return deleteBankBytes(id)
  }
}

/**
 * adj953：**宿主（插件目录）那份音源**的可选追加来源。
 *
 * 原来这个类型只用于 `resolveHqBank` 的返回值；现在预取也会给出 `'host'`，
 * 于是把它提成公共类型（`HqBankSource` 仍是"应用自己那三条来源"，不与宿主混为一谈）。
 */
export type ResolvedHqBankSource = HqBankSource | 'host'

/**
 * adj953：**从宿主地址取音源字节**——`resolveHqBank` 与 `prefetchHqLibraryProgress`
 * **共用这一个实现**（AGENTS §六之二·4「数值/判据必须同源」，不许两处各写一套取字节逻辑）。
 *
 * 取不到就返回 `null`（404 / 空文件 / 网络错 / 宿主不可达），调用方继续走后面的顺序——
 * **绝不抛错**：宿主失败只该让这一条路失效，不该让整条预取失败。
 */
async function fetchHostBank(hostUrl: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(hostUrl)
    if (!res.ok) return null
    const bank = await res.arrayBuffer()
    // 0 字节视为损坏文件（导入中途、同步未完成…）⇒ 当"没有"处理
    return bank.byteLength > 0 ? bank : null
  } catch {
    return null
  }
}

/** 取音源字节 + 来源（adj416，adj729 增补宿主来源）：
 *  **宿主（插件目录文件）→ IndexedDB 缓存 → 桌面安装目录内置 → 联网下载**。
 *  只有**下载**的结果才写缓存（内置文件已在安装目录，再存一份 30MB 纯属浪费；缓存优先则保留用户导入的音色）。
 *
 *  adj953 备注：**预取**（`prefetchHqLibraryProgress`）把那两条对调成
 *  **缓存 → 宿主 → 内置 → 联网**——因为预取要回答的是"本地有没有、要不要下载"，
 *  缓存命中就该一眼结束；这里的"加载"要的是**跟着文库走的权威副本**，所以宿主仍在最前。
 *  两条路共用同一个取宿主字节的实现（`fetchHostBank`），只有"谁先谁后"不同。
 *
 *  adj729（用户要求）：嵌入版里宿主会把"插件目录里的音源文件"以 URL 形式给出来
 *  （`hostBridge().bankUrl(id)`）——那是**唯一权威副本**（下载/导入后都放那儿，随文库一起走），
 *  所以放在第一位；取不到（宿主还没这份文件）再走应用自己的老路径。 */
export async function resolveHqBank(
  lib: HqSampleLibrary,
  cache: HqCache,
  hostUrl?: string,
): Promise<{ bank: ArrayBuffer; source: ResolvedHqBankSource }> {
  if (hostUrl) {
    const host = await fetchHostBank(hostUrl)
    if (host) return { bank: host, source: 'host' }
    // 404 / 空文件 / 网络错 ⇒ 宿主还没这份音源，继续走下面的老路径
  }
  /**
   * adj760（清单 B3）：**顺序由引擎 `planHqBankLoad` 统一决定** ——
   * 应用这边"用户导入的音源"落在 **IndexedDB 缓存**里（`cache`），随包内置的那份是 `builtin`
   * ⇒ 传 `{cache, builtin}` 得到的正是既有行为（缓存 → 内置 → 下载）。
   */
  const cached = await cache.load(lib.id)
  const builtin = cached ? null : await loadBuiltinBank(lib)
  const plan = planHqBankLoad({ cache: !!cached, builtin: !!builtin })
  if (plan === 'cache' && cached) return { bank: cached, source: 'cache' }
  if (plan === 'builtin' && builtin) return { bank: builtin, source: 'builtin' }
  const bank = await loadHqBank(lib)
  await cache.save(lib.id, bank)
  return { bank, source: 'remote' }
}

/** 创建 SpessaSynth 音源缓存实例（惰性，IndexedDB） */
export function createHqCache(): HqCache {
  return new HqCache()
}

/** 预取音源并返回其来源（adj347/348/349/416）：已缓存用 getKey 极快判断；桌面**只探测**
 *  安装目录内置音源的存在性（不读 30MB、不写缓存）；都没有才联网下载并写缓存。
 *  onProgress 仅结束时回调（0~1）。返回来源供 UI 决定是否显示「正在下载」提示。
 *
 *  ## adj953：**联网之前先问宿主**（用户实报的 bug 就修在这里）
 *
 *  现象：把带插件的库拷到**另一台电脑**打开，插件目录里明明有
 *  `…/plugins/ijipu/soundfonts/generaluser_gs.sf2`（32.3 MB），嵌入版**每次都提示
 *  「正在后台下载音色库（约30MB，仅首次）」**；网络不通就报「自动下载失败 ⇒ 手动导入」。
 *
 *  根因：**预取链只有"应用自己的缓存 → 安装目录内置 → CDN"，压根不带宿主地址** ✗——
 *  而真正加载（试听/导出）走的是带宿主地址的 `resolveHqBank` ✓，两条路判据不一致。
 *
 *  修法：`hostUrl` 作为**可选第 4 个参数**（第 3 位仍是 `onProgress`，既有调用点不受影响），
 *  顺序变成 **缓存 → 宿主 → 内置 → 联网**（缓存仍在最前，理由见函数体第 ① 步的注释）：
 *   · **冷缓存 + 有宿主** ⇒ 从宿主取字节、**按同一条写缓存路径**写进缓存（`cache.save`，与下载结果
 *     一模一样）、**一次 CDN 请求都不发**，返回 `'host'`；
 *   · **热缓存** ⇒ 直接命中，宿主与 CDN 都 0 次（"第二次打开不再提示"的机器口径）；
 *   · 没宿主地址（网页版 / 独立桌面版）⇒ 与改动前**逐值一致**（缓存 → 内置 → CDN）；
 *   · 宿主取失败（404 / 网络错 / 0 字节）⇒ **如实回退**到后面的顺序，**不让整条预取失败**。
 *
 *  `opts.onRemote`（adj953）：真的要走**联网下载**那一刻回调一次——UI 据此才显示
 *  「正在后台下载音色库（约30MB，仅首次）」。有了它，「正在下载」这句话才**只在下下载时说**：
 *  宿主/缓存/内置三条路都很快，之前一律显示下载提示本身也是假话（用户实报的提示就是它）。
 *
 *  @param hostUrl 宿主（插件目录）给该音源的取用地址；不在嵌入环境 / 宿主还没这份文件时传 `undefined`
 *  @param opts.onRemote 即将联网下载时回调（可选）
 */
export async function prefetchHqLibraryProgress(
  lib: HqSampleLibrary,
  cache: HqCache,
  onProgress?: (p: number) => void,
  hostUrl?: string,
  opts?: { onRemote?: () => void },
): Promise<ResolvedHqBankSource> {
  // ① 极快：只查键是否存在（getKey，不读 32MB 全量）。
  //
  // ⚠ 这一步必须排在**宿主之前**（adj953 实测口径）：缓存里那份本来就是"上一次从宿主取回来"的，
  // 命中就没必要再去宿主搬 32MB；更重要的是——**第二次打开时一次网络调用都不该发生**
  // （宿主那条路也是一次 fetch），否则"下次打开还得等宿主响应"这件事本身就会闪出提示。
  // 顺序也因此与改动前一致：**缓存 → 宿主 → 内置 → 联网**。
  if (await cache.has(lib.id)) {
    onProgress?.(1)
    return 'cache'
  }
  // ② adj953：**联网之前先问宿主（插件目录）**——嵌入版里那份音频"随文库一起走"，是权威副本。
  // 取它与"联网下载"一样写缓存（同一条写缓存路径），于是下次打开命中上面的缓存分支。
  // 宿主取不到（没给地址 / 404 / 网络错 / 0 字节）⇒ 继续往下，**不抛错**。
  if (hostUrl) {
    const host = await fetchHostBank(hostUrl)
    if (host) {
      await cache.save(lib.id, host)
      onProgress?.(1)
      return 'host'
    }
  }
  // ③ 桌面：随包内置（安装目录 generaluser_gs.sf2）→ 直接可用，无需下载
  if (await hasBuiltinBank(lib)) {
    onProgress?.(1)
    return 'builtin'
  }
  // ④ Web（或桌面未随包提供、宿主也没有）：后台下载——await res.arrayBuffer() 由浏览器内部线程完成，
  // 主线程不做逐块拼接，尽量不影响 UI
  opts?.onRemote?.()
  const bank = await loadHqBank(lib)
  await cache.save(lib.id, bank)
  onProgress?.(1)
  return 'remote'
}
