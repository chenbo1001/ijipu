/**
 * src/playback/bankDiscovery.ts — 音色库**发现与登记**（adj1015，多音色库 P6）
 *
 * ## 它解决的问题
 *
 * 用户口径：「不能预设用哪个音色库 —— 保证有一个基础库，其余靠**发现本机文件** + 推荐下载 + 导入」。
 * 但"发现"不能直接当"库"用，两者是两件事：
 *  · **发现** = 这次扫描看到了什么（瞬时，含坏文件、重复文件、读不到的文件）；
 *  · **登记** = 把发现到的、认得出来的写进 `libs` 表（带 `location` / `present` / `presetsKnown`）。
 *
 * 分开的好处：扫描可以随时重跑、**不污染库表**；"文件不在了"只是标 `present:false`，
 * **绝不删记录**（用户可能只是拔了盘、换了机器、或者又拷回来了）。
 *
 * ## 三端共用一套编排，IO 各端注入
 *
 * | 端 | scanHost | peekHost | 缓存 |
 * |---|---|---|---|
 * | 桌面 | `sf_soundfont_scan` | `sf_soundfont_peek`（头尾各 64 KB） | IndexedDB |
 * | 插件 | `bankScan`（P9 接） | 宿主 URL 读头 | IndexedDB + 插件目录 |
 * | 网页 | 无（返回 `[]`） | — | IndexedDB |
 *
 * ## 最关键的一条：**扫描与导入必须算出同一个库 id**
 *
 * 扫描只读"头 + 尾"（各 64 KB），导入读全量。两边都走
 * `fingerprintOfParts` / `fingerprintOf`（**同一算法**，见 bankRegistry）——
 * 否则"扫描到一个文件"与"导入同一个文件"会变成两个库，用户会看到重复条目。
 */
import { isSf2, readSf2Info } from '@ijipu/engine'
import {
  baseNameOf,
  bankIdOf,
  createBankRegistry,
  fingerprintOfParts,
  formatOf,
  listBankKeys,
  readBankBytes,
  readBankFile,
  type BankRecord,
} from './bankRegistry'

/** 文件在哪（也决定优先级与界面标签） */
export type BankLocation = 'install' | 'appdata' | 'plugin' | 'cache'

/** 扫描到的一个文件（**瞬时**，不写库表） */
export interface DiscoveredFile {
  location: BankLocation
  fileName: string
  /** 桌面/插件 = 绝对路径或 URL；缓存 = 库 id */
  ref: string
  sizeBytes: number
  mtimeMs?: number
}

/** 认出来之后的候选（同一库可能被多处扫到，去重后只剩一个） */
export interface DiscoveredBank extends DiscoveredFile {
  /** 头里读到的库名（读不到就没有） */
  infoName?: string
  /** 内容指纹（头 + 尾 + 长度；与导入同口径） */
  fingerprint: string
  /** 认领到的库 id（已知库 = 它的 id；否则 `imported_<指纹>`） */
  libId: string
  /** 缓存里扫到的已经解析过预设表；文件扫描的没有（`presetsKnown:false`） */
  presets?: BankRecord['presets']
}

export interface DiscoveryProblem {
  file: string
  location: BankLocation
  reason: string
}

export interface DiscoveryCounts {
  install: number
  appdata: number
  plugin: number
  cache: number
}

export interface DiscoveryResult {
  /** 去重后的候选（按 `libId` 唯一） */
  banks: DiscoveredBank[]
  /** 合并后的完整库表（含没扫到、标了 `present:false` 的旧记录） */
  records: BankRecord[]
  problems: DiscoveryProblem[]
  counts: DiscoveryCounts
  /** 这次**新登记**了几个库 */
  registered: number
}

/** 发现所需的全部 IO（三端各自实现；编排本身不碰 DOM / Tauri / IndexedDB） */
export interface DiscoveryIo {
  /** 扫本机文件（网页端返回空数组） */
  scanHost(): Promise<DiscoveredFile[]>
  /** 读文件头 + 尾（各 ≤64 KB）；读不到返回 null */
  peekHost(file: DiscoveredFile): Promise<{ head: Uint8Array; tail: Uint8Array; sizeBytes: number } | null>
  /** 缓存（IndexedDB）里现有哪些库 id */
  listCacheIds(): Promise<string[]>
  /** 读缓存字节（用于解析预设表；读不到返回 null） */
  readCache(id: string): Promise<ArrayBuffer | null>
  /** 现有 `libs` 记录 */
  listRecords(): Promise<BankRecord[]>
  /** 写回 `libs` 记录 */
  putRecords(records: BankRecord[]): Promise<void>
}

/** 同内容多处的取舍顺序：随包 > 我的目录 > 插件 > 缓存 */
const LOCATION_RANK: Record<BankLocation, number> = { install: 0, appdata: 1, plugin: 2, cache: 3 }

/** 位置 → 记录里的 `origin`（语义标签；`location` 另存原始位置） */
function originOf(location: BankLocation): BankRecord['origin'] {
  if (location === 'install') return 'bundled'
  if (location === 'plugin') return 'host'
  if (location === 'cache') return 'downloaded'
  return 'imported'
}

/**
 * 跑一次"发现 + 登记"。
 *
 * 步骤：扫本机文件 → 读头尾认库 → 读缓存认库 → 按库 id 去重 → 合并旧记录（标 `present`）→ 写回。
 */
export async function discoverBanks(io: DiscoveryIo, now: number): Promise<DiscoveryResult> {
  const records = await io.listRecords()
  const byId = new Map(records.map((r) => [r.id, r]))
  const problems: DiscoveryProblem[] = []
  const counts: DiscoveryCounts = { install: 0, appdata: 0, plugin: 0, cache: 0 }
  const found = new Map<string, DiscoveredBank>()

  const keep = (cand: DiscoveredBank): void => {
    const prev = found.get(cand.libId)
    if (!prev) {
      found.set(cand.libId, cand)
      return
    }
    // 同一库在多处出现：位置优先（随包 > 我的 > 插件 > 缓存），但**预设表谁有就用谁的**
    // ——缓存那条是全量解析过的，随包那条只读了头；别因为"位置更优先"把预设表丢掉。
    const winner = LOCATION_RANK[cand.location] < LOCATION_RANK[prev.location] ? cand : prev
    const other = winner === cand ? prev : cand
    found.set(cand.libId, { ...winner, presets: winner.presets ?? other.presets })
  }

  // ① 本机文件：读头尾 → 认库（**不读采样、不解析预设表**）
  for (const file of await io.scanHost()) {
    counts[file.location] = (counts[file.location] ?? 0) + 1
    const peek = await io.peekHost(file)
    if (!peek || peek.head.length === 0) {
      problems.push({ file: file.fileName, location: file.location, reason: '读不到文件内容（权限或文件损坏）' })
      continue
    }
    if (!isSf2(peek.head)) {
      problems.push({ file: file.fileName, location: file.location, reason: '不是 SF2/SF3（文件头不是 RIFF…sfbk）' })
      continue
    }
    const sizeBytes = peek.sizeBytes || file.sizeBytes
    const info = readSf2Info(peek.head)
    const fingerprint = fingerprintOfParts(peek.head, peek.tail, sizeBytes)
    keep({
      ...file,
      sizeBytes,
      infoName: info?.name,
      fingerprint,
      libId: bankIdOf(info, fingerprint),
    })
  }

  // ② 缓存：已经存着字节的库（网页端的主要来源）
  for (const id of await io.listCacheIds()) {
    counts.cache += 1
    /**
     * **已经有记录 ⇒ 绝不读字节**。
     *
     * 为什么必须这样：IndexedDB 的 `get` 会把整个值读出来 —— 一个 141 MB 的库，
     * 每打开一次设置页就读一遍，纯属自找卡顿。缓存里有什么（键）已经由 `listCacheKeys` 告诉我们，
     * 记录里又有名字/体积/预设表 ⇒ 只差"present"这一个事实。
     * 只有**没有记录**的老缓存（迁移前遗留）才需要真读一次、解析后登记。
     */
    const known = byId.get(id)
    if (known) {
      keep({
        location: 'cache',
        fileName: known.fileName,
        ref: id,
        sizeBytes: known.sizeBytes,
        infoName: known.name,
        fingerprint: id.startsWith('imported_') ? id.slice('imported_'.length) : '',
        libId: id,
        presets: known.presets,
      })
      continue
    }
    const bytes = await io.readCache(id)
    if (!bytes) {
      problems.push({ file: `缓存 ${id}`, location: 'cache', reason: '读不出缓存内容' })
      continue
    }
    const parsed = readBankFile(bytes, `${id}.sf2`)
    if (!parsed.ok) {
      problems.push({ file: `缓存 ${id}`, location: 'cache', reason: parsed.error })
      continue
    }
    const rec = parsed.record
    keep({
      location: 'cache',
      fileName: rec.fileName,
      ref: id,
      sizeBytes: rec.sizeBytes,
      infoName: rec.name,
      fingerprint: rec.id.startsWith('imported_') ? rec.id.slice('imported_'.length) : '',
      libId: rec.id,
      presets: rec.presets,
    })
    // 键与内容不符（历史"冒名"缓存）：按内容登记，并在诊断里说一句
    if (rec.id !== id) {
      problems.push({
        file: `缓存 ${id}`,
        location: 'cache',
        reason: `缓存键与内容不符（内容是「${rec.name}」），已按内容登记为 ${rec.id}`,
      })
    }
  }

  // ③ 合并：新候选 → 记录；没扫到的旧记录标 `present:false`（**不删**）
  const next: BankRecord[] = []
  const toWrite: BankRecord[] = []
  let registered = 0
  for (const [libId, d] of found) {
    const existing = byId.get(libId)
    if (existing) {
      const merged: BankRecord = {
        ...existing,
        present: true,
        location: d.location,
        sizeBytes: d.sizeBytes || existing.sizeBytes,
        mtimeMs: d.mtimeMs ?? existing.mtimeMs,
        // 缓存解析到的预设表最完整：用它覆盖（文件扫描拿不到预设表，保持原状）
        presets: d.presets && d.presets.length > 0 ? d.presets : existing.presets,
        presetsKnown:
          (d.presets && d.presets.length > 0) || existing.presetsKnown === true || existing.presets.length > 0,
      }
      next.push(merged)
      if (
        existing.present !== true ||
        existing.location !== merged.location ||
        existing.sizeBytes !== merged.sizeBytes ||
        existing.presetsKnown !== merged.presetsKnown ||
        existing.presets !== merged.presets
      ) {
        toWrite.push(merged)
      }
    } else {
      const rec: BankRecord = {
        id: libId,
        name: d.infoName?.trim() || baseNameOf(d.fileName),
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        format: formatOf(d.fileName),
        origin: originOf(d.location),
        addedAt: now,
        presets: d.presets ?? [],
        presetsKnown: !!d.presets && d.presets.length > 0,
        location: d.location,
        present: true,
        mtimeMs: d.mtimeMs,
      }
      next.push(rec)
      toWrite.push(rec)
      registered += 1
    }
  }
  for (const rec of records) {
    if (found.has(rec.id)) continue
    // 没扫到：保留记录，只标"不在了"；已经标过就不再重复写
    const missing: BankRecord = { ...rec, present: false }
    next.push(missing)
    if (rec.present !== false) toWrite.push(missing)
  }
  if (toWrite.length > 0) await io.putRecords(toWrite)

  return { banks: [...found.values()], records: next, problems, counts, registered }
}

// ───────────────────────────── 三端 IO 适配 ─────────────────────────────

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** 取 Tauri invoke（非桌面环境返回 null） */
function tauriInvoke(): TauriInvoke | null {
  const w = globalThis as unknown as { window?: { __TAURI__?: { core?: { invoke?: TauriInvoke } } } }
  const fn = w.window?.__TAURI__?.core?.invoke
  return typeof fn === 'function' ? fn : null
}

/** Rust `Vec<u8>` 经 IPC 过来是数字数组 / `ArrayBuffer` 两种形态都要接 */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  if (Array.isArray(v)) return new Uint8Array(v as number[])
  return new Uint8Array(0)
}

/** 桌面端扫描结果（Rust 字段是 snake_case） */
interface RawScanEntry {
  path?: string
  file_name?: string
  size_bytes?: number
  mtime_ms?: number
  origin?: string
}

/**
 * 应用侧的发现 IO：桌面走 Tauri 命令，网页端没有"目录"（只有 IndexedDB 缓存）。
 *
 * 插件（Obsidian 嵌入版）此刻**没有** `bankScan`（P9 补）⇒ 返回空数组；
 * 但它的缓存与插件目录导入仍能通过 IndexedDB + `importSoundbank` 生效。
 */
export function createAppDiscoveryIo(): DiscoveryIo {
  const registry = createBankRegistry()
  const inv = tauriInvoke()
  return {
    async scanHost() {
      if (!inv) return []
      try {
        const raw = ((await inv('sf_soundfont_scan')) ?? []) as RawScanEntry[]
        return raw
          .filter((e) => typeof e.path === 'string' && e.path !== '')
          .map((e) => ({
            location: e.origin === 'install' ? ('install' as const) : ('appdata' as const),
            fileName: e.file_name ?? baseNameOf(e.path ?? ''),
            ref: e.path as string,
            sizeBytes: Number(e.size_bytes ?? 0),
            mtimeMs: Number(e.mtime_ms ?? 0),
          }))
      } catch {
        // 扫描失败不该让整页崩：当成"没扫到"，界面给"重新扫描"即可
        return []
      }
    },
    async peekHost(file) {
      if (!inv) return null
      try {
        const r = (await inv('sf_soundfont_peek', { path: file.ref })) as {
          head?: unknown
          tail?: unknown
          size_bytes?: number
        }
        return {
          head: toBytes(r?.head),
          tail: toBytes(r?.tail),
          sizeBytes: Number(r?.size_bytes ?? file.sizeBytes),
        }
      } catch {
        return null
      }
    },
    listCacheIds: () => listBankKeys(),
    readCache: (id) => readBankBytes(id),
    listRecords: () => registry.list(),
    async putRecords(records) {
      for (const rec of records) await registry.put(rec)
    },
  }
}

/** 便捷入口：用应用默认 IO 跑一次发现（设置页/启动时调） */
export async function scanAndRegister(now: number = Date.now()): Promise<DiscoveryResult> {
  return discoverBanks(createAppDiscoveryIo(), now)
}

/**
 * adj1020：打开"我的音色库目录"（桌面端专用）。
 *
 * 去掉随包音色库之后，用户最常见的动作是"把 .sf2 拖进那个目录再重新扫描"，
 * 而 `%APPDATA%\…\soundfonts` 并不好找 ⇒ 给一个按钮直接打开它。
 *
 * @returns 打开的目录；非桌面环境返回 `null`（网页版没有"目录"这个概念）
 */
export async function openUserSoundfontDir(): Promise<string | null> {
  const inv = tauriInvoke()
  if (!inv) return null
  const p = await inv('sf_soundfont_open_dir')
  return typeof p === 'string' ? p : ''
}

/** Tauri 事件 API 的最小形状（`window.__TAURI__.event`，不引 npm 包） */
interface TauriEventApi {
  listen(event: string, handler: (e: { payload?: unknown }) => void): Promise<() => void>
}

function tauriEvents(): TauriEventApi | null {
  const w = globalThis as unknown as { window?: { __TAURI__?: { event?: TauriEventApi } } }
  const ev = w.window?.__TAURI__?.event
  return ev && typeof ev.listen === 'function' ? ev : null
}

/**
 * adj1021：**桌面端自己下载**音色库（Rust 走系统 curl，绕过浏览器 CORS），
 * 落到"我的音色库目录"，边下边回报已收字节。
 *
 * 为什么必须绕开浏览器：多数音源站不返回 `Access-Control-Allow-Origin`，
 * `fetch` 会被直接拦死（FluidR3 的 SourceForge 页甚至连文件流都不是）。
 *
 * @returns 非桌面环境返回 `null`（调用方回退到浏览器下载）
 */
export async function downloadBankToDisk(
  id: string,
  url: string,
  onProgress?: (bytes: number) => void,
): Promise<{ ok: true; path: string } | { ok: false; error: string } | null> {
  const inv = tauriInvoke()
  if (!inv) return null
  const events = tauriEvents()
  let unlisten: (() => void) | null = null
  try {
    if (events && onProgress) {
      unlisten = await events.listen('ijipu://sf-download', (e) => {
        const p = e.payload as { id?: unknown; bytes?: unknown } | undefined
        if (p?.id !== id) return
        onProgress(Number(p.bytes ?? 0))
      })
    }
    const p = await inv('sf_soundfont_download', { id, url })
    return { ok: true, path: typeof p === 'string' ? p : '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    unlisten?.()
  }
}
