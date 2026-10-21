/**
 * src/playback/bankRegistry.ts — 音色库**注册表**：元数据持久化 + 导入识别 + 一次性迁移（adj1010）
 *
 * ## 它解决什么
 *
 * 以前音源只有"一个默认库"：字节存在 IndexedDB 的 `banks/<默认库 id>` 下，**没有"库"这个实体**。
 * 于是用户导入 FluidR3 时字节被存进了 `generaluser_gs` 这个键（冒名顶替），界面上看到的名字与
 * 音色列表却还是 GeneralUser —— 用户实报的"导入新库后显示的还是 generaluser_gs"。
 *
 * 现在分成两层存储（同一个数据库的两张表）：
 *  · `banks`（v1 就有）：**字节**，键 = 库 id；来源解析（内置/缓存/下载）继续用它；
 *  · `libs`（v2 新增）：**元数据**，键 = 库 id，值 = `BankRecord`（库名、文件名、体积、预设表…）。
 *
 * 这样"库"是可枚举、可添加、可选择的实体，而"取字节"这条老路径一行都不用改。
 *
 * ## 为什么预设表要持久化
 *
 * FluidR3 有 141.5 MB，`readSf2Presets` 虽然只读头部，但每次启动都从 IndexedDB 读 141 MB 回来
 * 再解析是浪费。**导入时解析一次、把结果（约 20 KB）存进 `libs`**，启动只读元数据。
 *
 * ## 纯函数 / IO 的分界
 *
 * `fingerprintOf` / `bankIdOf` / `readBankFile` / `planLegacyMigration` 是纯函数（smoke 直接断言）；
 * `openSoundfontDb` / `BankRegistry` / `migrateLegacyBanks` 才碰 IndexedDB（编排可注入假 IO 测）。
 */
import type { HqSampleLibrary, Sf2Info, Sf2Preset } from '@ijipu/engine'
import { HQ_LIBRARIES, isGitLfsPointer, isSf2, matchKnownLibrary, readSf2Info, readSf2Presets } from '@ijipu/engine'

/** IndexedDB：音色库字节 + 元数据（v1 只有 `banks`；adj1010 起 v2 增 `libs`） */
const DB_NAME = 'ijipu-soundfonts-hq'
const DB_VERSION = 2
const STORE_BANKS = 'banks'
const STORE_LIBS = 'libs'
/** 迁移完成标记（L1 本机偏好键；`ijipu.` 前缀） */
const MIGRATED_KEY = 'ijipu.soundbankLibsV2'

/** 库的来源（界面要如实标：内置 / 下载 / 用户导入 / 宿主插件目录） */
export type BankOrigin = 'bundled' | 'downloaded' | 'imported' | 'host'

/** 一个音色库的**元数据**（字节不在这里，在 `banks` 表） */
export interface BankRecord {
  id: string
  /** 库名（SF2 的 INAM；读不到时回退文件名去扩展名） */
  name: string
  /** 用户选中的原始文件名（覆盖前让用户看清"是哪一份"） */
  fileName: string
  sizeBytes: number
  format: 'sf2' | 'sf3'
  origin: BankOrigin
  /** 导入/登记时间（ms） */
  addedAt: number
  /** 预设表（导入时解析一次；启动不再重读 141 MB）。**轻量登记**时是空数组，见 `presetsKnown` */
  presets: Sf2Preset[]
  /**
   * adj1015：文件现在在哪（扫描"发现"时写的）。
   * 桌面：`install`（随包，只读）/ `appdata`（我的音色库目录，可写）；插件：`plugin`；网页：`cache`。
   */
  location?: 'install' | 'appdata' | 'resource' | 'plugin' | 'cache'
  /** adj1015：本次扫描是否还找得到。`false` ⇒ 界面标"文件不在了"，但**不删记录** */
  present?: boolean
  /** adj1015：预设表**是否已解析**。`false` ⇒ 界面写"音色数未知（选中后读取）"，不猜数字 */
  presetsKnown?: boolean
  /** adj1015：文件修改时间（用于判断"文件换了要不要重新解析"） */
  mtimeMs?: number
}

// ───────────────────────────── 纯函数（smoke 直接断言） ─────────────────────────────

/** 指纹采样窗口（头/尾各 64 KB） */
export const FP_WINDOW = 65536

/**
 * 文件指纹（FNV-1a 32 位；采样"长度 + 头 64 KB + 尾 64 KB"）。
 *
 * 为什么不做全量哈希：141 MB 全量算一次要几百毫秒到数秒，而它的用途只是"认得出是不是同一个
 * 文件"。已知库靠 INAM 认领（不靠指纹），指纹只给"认不出的库"当 id 用，采样足够。
 *
 * ⚠ **同一个算法必须能从"只读头尾"复算出来**（见 `fingerprintOfParts`）：
 * 扫描目录时只拿得到头尾两块，导入时拿得到全量 —— 两条路算出的 id 必须一致，
 * 否则"扫描到某文件"与"导入同一文件"会变成两个库（这是本函数被拆成两半的原因）。
 */
export function fingerprintOf(bytes: Uint8Array): string {
  const size = bytes.length
  const head = bytes.subarray(0, Math.min(size, FP_WINDOW))
  const tail = bytes.subarray(Math.max(0, size - FP_WINDOW))
  return fingerprintOfParts(head, tail, size)
}

/**
 * 只用"文件头 + 文件尾"算指纹（与 `fingerprintOf` **逐字节同算法**）。
 *
 * @param head 文件**前** `min(size, 64 KB)` 字节
 * @param tail 文件**后** `min(size, 64 KB)` 字节（不足 64 KB 时就是整个文件）
 * @param sizeBytes 文件真实长度（参与混合；只读头尾时必须显式传）
 */
export function fingerprintOfParts(head: Uint8Array, tail: Uint8Array, sizeBytes: number): string {
  let h = 0x811c9dc5
  const mix = (b: number): void => {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const headLen = Math.min(sizeBytes, FP_WINDOW)
  for (let i = 0; i < headLen; i++) mix(head[i] ?? 0)
  // 尾部起点与 `fingerprintOf` 完全一致：max(头长, size-窗口)
  const tailStart = Math.max(headLen, sizeBytes - FP_WINDOW)
  if (sizeBytes > tailStart && tail.length > 0) {
    const tailBeginInFile = sizeBytes - tail.length
    const from = Math.max(0, tailStart - tailBeginInFile)
    for (let i = from; i < tail.length; i++) mix(tail[i])
  }
  mix(sizeBytes & 0xff)
  mix((sizeBytes >>> 8) & 0xff)
  mix((sizeBytes >>> 16) & 0xff)
  mix((sizeBytes >>> 24) & 0xff)
  return h.toString(16).padStart(8, '0')
}

/**
 * 库 id：**先按库名认领已知库，认不出才用指纹生成 `imported_<8 位>`**。
 *
 * 为什么不按文件名：用户下载到的可能叫 `FluidR3_GM.sf2`、`fluid (1).sf2`；
 * 而"同一库不同版本"（GeneralUser 2.0.3 / v1.471）必须归到同一个 id 才有覆盖语义。
 */
export function bankIdOf(info: Sf2Info | null, fingerprint: string): string {
  return matchKnownLibrary(info) ?? `imported_${fingerprint}`
}

/** 从文件名猜格式（只用于展示/记录；真正的判定是 `isSf2`） */
export function formatOf(fileName: string): 'sf2' | 'sf3' {
  return /\.sf3$/i.test(fileName) ? 'sf3' : 'sf2'
}

/** 文件名 → 兜底库名（`FluidR3_GM.sf2` → `FluidR3_GM`） */
export function baseNameOf(fileName: string): string {
  return fileName.replace(/\.(sf2|sf3)$/i, '') || fileName
}

/** 读文件的结果：要么给出可登记的记录，要么给出**能照做**的错误 */
export type BankFileReadResult =
  | { ok: true; record: BankRecord }
  | { ok: false; error: string }

/**
 * 把一个 `.sf2/.sf3` 文件的字节读成 `BankRecord`（纯函数，不落盘、不弹窗）。
 *
 * 三种拒绝都有明确原因（都对应真实会发生的情形）：
 *  · **Git LFS 指针**：用户从第三方仓库"右键另存 raw"拿到的 134 字节文本；
 *  · **不是 SF2**：`.txt` 改名、下载中断留下的半截文件；
 *  · **读不出音色表**：结构坏到没有 `pdta/phdr`（能打开却没有一个音色，导入也没意义）。
 */
export function readBankFile(
  bytes: ArrayBuffer,
  fileName: string,
  opts?: { origin?: BankOrigin; now?: number },
): BankFileReadResult {
  const view = new Uint8Array(bytes)
  if (isGitLfsPointer(view)) {
    return {
      ok: false,
      error: '这个文件是 Git LFS 指针（不是音源本体，只有 100 多字节）。请到下载页点「下载」拿真正的 .sf2，再导入。',
    }
  }
  if (!isSf2(view)) {
    return { ok: false, error: '不是有效的 SF2/SF3 文件（文件头不是 RIFF…sfbk）。请确认下载完整、且不是改后缀名得来的。' }
  }
  const info = readSf2Info(view)
  const presets = readSf2Presets(view) ?? []
  if (presets.length === 0) {
    return { ok: false, error: '这个 SF2 里读不出音色表（没有 pdta/phdr），导入后也无法选音色。' }
  }
  const fingerprint = fingerprintOf(view)
  return {
    ok: true,
    record: {
      id: bankIdOf(info, fingerprint),
      name: info?.name?.trim() || baseNameOf(fileName),
      fileName,
      sizeBytes: bytes.byteLength,
      format: formatOf(fileName),
      origin: opts?.origin ?? 'imported',
      addedAt: opts?.now ?? Date.now(),
      presets,
    },
  }
}

// ───────────────────────────── 列表行（界面用；纯数据，smoke 可断言） ─────────────────────────────

/** 音色库列表的一行（**已安装**的库；推荐/未下载的库不进这里） */
export interface BankRow {
  lib: HqSampleLibrary
  /** 元数据（已安装的库一定有） */
  record: BankRecord | null
  /** 是否属于 `HQ_LIBRARIES` 的已知库（否则是用户导入的新库） */
  known: boolean
}

/**
 * 把"只剩元数据、引擎里没有这条"的用户库包成 `HqSampleLibrary`，好让列表/界面一视同仁。
 * `source` 留空、`autoDownload:false` ⇒ 界面上不会出现"下载并导入"这种注定失败的按钮。
 */
export function libViewOfRecord(rec: BankRecord): HqSampleLibrary {
  return {
    id: rec.id,
    name: rec.name,
    source: '',
    sizeBytes: rec.sizeBytes,
    format: rec.format,
    autoDownload: false,
    license: undefined,
    downloadPage: undefined,
    presetCount: rec.presets.length,
  }
}

/**
 * **已安装**的音色库列表（adj1018，用户口径修正）。
 *
 * 口径：**只有"真的有文件"的库才算已安装**。没下载/没导入的已知库（如 FluidR3）
 * **不出现**在这里——它们只属于「推荐/可选」区，用户看完介绍自己决定下不下。
 *
 * 顺序：已知库按清单顺序在前，用户导入的库按名字排在后（顺序稳定，不因导入抖动）。
 */
export function buildBankRows(
  records: readonly BankRecord[],
  libs: readonly HqSampleLibrary[] = HQ_LIBRARIES,
): BankRow[] {
  const installed = records.filter((r) => r.present !== false)
  const byId = new Map(installed.map((r) => [r.id, r]))
  const rows: BankRow[] = []
  for (const lib of libs) {
    const rec = byId.get(lib.id)
    if (!rec) continue // 没安装的已知库**不出现在已安装列表**
    rows.push({ lib, record: rec, known: true })
    byId.delete(lib.id)
  }
  const extra = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const rec of extra) rows.push({ lib: libViewOfRecord(rec), record: rec, known: false })
  return rows
}

/**
 * **曾经装过、现在文件不在了**的库（记录与预设表都还留着）。
 *
 * 为什么单列一组而不是混进已安装列表：它们"现在用不了"，但**不能自动删记录**
 * （用户可能只是拔了盘、换了机器、或者把文件挪走了）；放回去再扫描一次就能恢复。
 */
export function missingBankRows(
  records: readonly BankRecord[],
  libs: readonly HqSampleLibrary[] = HQ_LIBRARIES,
): BankRow[] {
  const gone = new Map(records.filter((r) => r.present === false).map((r) => [r.id, r]))
  const rows: BankRow[] = []
  for (const lib of libs) {
    const rec = gone.get(lib.id)
    if (!rec) continue
    rows.push({ lib, record: rec, known: true })
    gone.delete(lib.id)
  }
  for (const rec of [...gone.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push({ lib: libViewOfRecord(rec), record: rec, known: false })
  }
  return rows
}

/** 这一行显示几个音色：**只有真的解析过才算数**，否则用已知库的实测值（还不知道就是 null） */
export function presetCountOf(row: BankRow): number | null {
  const rec = row.record
  if (rec && (rec.presetsKnown === true || rec.presets.length > 0)) return rec.presets.length
  return row.lib.presetCount ?? null
}

/** 迁移的输入：`banks` 表里的一个旧键 + 它解析出来的元数据 */export interface LegacyBankEntry {
  /** 旧键（v1 时代就是库 id，但可能是"冒名"的，如 FluidR3 存在 generaluser_gs 下） */
  key: string
  fileName: string
  sizeBytes: number
  fingerprint: string
  info: Sf2Info | null
  presets: Sf2Preset[]
}

export interface MigrationPlan {
  /** 需要搬键的条目（`from` 旧键 → `to` 新 id） */
  moves: { from: string; to: string }[]
  /** 要登记的库元数据（同一个 id 只登记一次） */
  records: BankRecord[]
}

/**
 * 一次性迁移的**决策部分**（纯函数）：v1 的"只有字节、没有元数据"的键 → v2 的 `libs` 记录。
 *
 * 三条真实场景都要对：
 *  ① 键就是 generaluser_gs、内容也真是 GeneralUser ⇒ 只登记、不搬；
 *  ② 键是 generaluser_gs、内容却是 FluidR3（**用户现在这台机器就是**）⇒ 搬到 fluidr3_gm；
 *  ③ 内容谁也认不出 ⇒ 搬到 `imported_<指纹>`。
 */
export function planLegacyMigration(entries: readonly LegacyBankEntry[], now: number): MigrationPlan {
  const moves: { from: string; to: string }[] = []
  const records: BankRecord[] = []
  const claimed = new Set<string>()
  for (const e of entries) {
    const id = bankIdOf(e.info, e.fingerprint)
    if (id !== e.key) moves.push({ from: e.key, to: id })
    // 两个旧键认领到同一个库（如两份不同版本的 GeneralUser）：只登记第一个，避免覆盖
    if (claimed.has(id)) continue
    claimed.add(id)
    records.push({
      id,
      name: e.info?.name?.trim() || baseNameOf(e.fileName),
      fileName: e.fileName,
      sizeBytes: e.sizeBytes,
      format: formatOf(e.fileName),
      // 老缓存里的字节是"用户自己导入/下载来的"，不是随包内置，如实标 imported
      origin: 'imported',
      addedAt: now,
      presets: e.presets,
    })
  }
  return { moves, records }
}

// ───────────────────────────── IndexedDB 打开（全模块唯一） ─────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * 打开音色库数据库（v1 → v2：保留 `banks`，新增 `libs`）。
 *
 * 全模块**只有这一处** `indexedDB.open`：两处各自 open、版本号不一致会抛 `VersionError`。
 */
export function openSoundfontDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_BANKS)) db.createObjectStore(STORE_BANKS)
      if (!db.objectStoreNames.contains(STORE_LIBS)) db.createObjectStore(STORE_LIBS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  // 打开失败（隐私模式/配额）⇒ 清掉缓存，下次还能重试（别把失败永久钉住）
  dbPromise = p.catch((e) => {
    dbPromise = null
    throw e
  })
  return dbPromise
}

function request<T>(store: IDBObjectStore, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const r = fn(store)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

// ───────────────────────────── 字节（banks 表） ─────────────────────────────

/** 库字节是否存在（`getKey`：不读 141 MB 全量） */
export async function hasBankBytes(id: string): Promise<boolean> {
  const db = await openSoundfontDb()
  try {
    const key = await request(db.transaction(STORE_BANKS, 'readonly').objectStore(STORE_BANKS), (s) => s.getKey(id))
    return key !== undefined
  } catch {
    return false
  }
}

/** 读库字节（不存在/读失败 → null，不抛：调用方按"没有"回退下一条来源） */
export async function readBankBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await openSoundfontDb()
  try {
    const v = await request(db.transaction(STORE_BANKS, 'readonly').objectStore(STORE_BANKS), (s) => s.get(id))
    return v instanceof ArrayBuffer ? v : null
  } catch {
    return null
  }
}

/** 写库字节（141 MB 的写入可能因配额失败 ⇒ 抛给调用方，由它明确告知用户） */
export async function saveBankBytes(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openSoundfontDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BANKS, 'readwrite')
    tx.objectStore(STORE_BANKS).put(bytes, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteBankBytes(id: string): Promise<void> {
  const db = await openSoundfontDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BANKS, 'readwrite')
    tx.objectStore(STORE_BANKS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** `banks` 表里的全部键（迁移用） */
export async function listBankKeys(): Promise<string[]> {
  const db = await openSoundfontDb()
  const keys = await request(db.transaction(STORE_BANKS, 'readonly').objectStore(STORE_BANKS), (s) => s.getAllKeys())
  return keys.filter((k): k is string => typeof k === 'string')
}

/** `banks` 表里现存的库 id（界面/诊断用；不读字节） */
export async function listBankIds(): Promise<string[]> {
  return listBankKeys()
}

// ───────────────────────────── 元数据（libs 表） ─────────────────────────────

/** 库元数据表（`libs`）：list / get / put / remove，全部吞掉"读失败"并给出安全默认 */
export class BankRegistry {
  async list(): Promise<BankRecord[]> {
    try {
      const db = await openSoundfontDb()
      const all = await request(db.transaction(STORE_LIBS, 'readonly').objectStore(STORE_LIBS), (s) => s.getAll())
      return (all as unknown[]).filter((r): r is BankRecord => !!r && typeof (r as BankRecord).id === 'string')
    } catch {
      return []
    }
  }

  async get(id: string): Promise<BankRecord | null> {
    try {
      const db = await openSoundfontDb()
      const v = await request(db.transaction(STORE_LIBS, 'readonly').objectStore(STORE_LIBS), (s) => s.get(id))
      return v && typeof (v as BankRecord).id === 'string' ? (v as BankRecord) : null
    } catch {
      return null
    }
  }

  async put(rec: BankRecord): Promise<void> {
    const db = await openSoundfontDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_LIBS, 'readwrite')
      tx.objectStore(STORE_LIBS).put(rec, rec.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /** 删元数据（字节由 `deleteBankBytes` 单独删——两件事别混在一个事务里） */
  async remove(id: string): Promise<void> {
    const db = await openSoundfontDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_LIBS, 'readwrite')
      tx.objectStore(STORE_LIBS).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

/** 创建注册表实例（惰性，纯 IndexedDB） */
export function createBankRegistry(): BankRegistry {
  return new BankRegistry()
}

// ───────────────────────────── 一次性迁移（v1 字节 → v2 元数据） ─────────────────────────────

/** 迁移只用到这几招（便于 smoke 用假 IO 真跑编排） */
export interface LegacyBankIo {
  listLibs(): Promise<BankRecord[]>
  listKeys(): Promise<string[]>
  read(key: string): Promise<ArrayBuffer | null>
  save(key: string, bytes: ArrayBuffer): Promise<void>
  remove(key: string): Promise<void>
  put(rec: BankRecord): Promise<void>
}

/** 迁移结果（诊断/断言用） */
export interface MigrationResult {
  /** 被搬过键的库（旧键 → 新 id） */
  moved: { from: string; to: string }[]
  /** 新登记的库条数 */
  records: number
  /** 是否真的跑了（`libs` 已有内容 / `banks` 为空 ⇒ 跳过） */
  ran: boolean
}

/**
 * 跑一次迁移编排：读旧键 → 解析 → 决策 → 搬字节 → 登记元数据。
 *
 * **幂等且便宜**：`libs` 里已经有记录就直接返回（不读任何字节）；
 * `banks` 为空也直接返回。所以启动时无脑调用一次即可。
 */
export async function migrateLegacyBanks(io: LegacyBankIo, now: number): Promise<MigrationResult> {
  const existing = await io.listLibs()
  if (existing.length > 0) return { moved: [], records: 0, ran: false }
  const keys = await io.listKeys()
  if (keys.length === 0) return { moved: [], records: 0, ran: false }
  const entries: LegacyBankEntry[] = []
  for (const key of keys) {
    const bytes = await io.read(key)
    if (!bytes) continue
    const view = new Uint8Array(bytes)
    // 老缓存里可能是"下载中断留下的垃圾"：解析不出 SF2 就跳过（不搬、不登记）
    if (!isSf2(view)) continue
    entries.push({
      key,
      fileName: `${key}.sf2`,
      sizeBytes: bytes.byteLength,
      fingerprint: fingerprintOf(view),
      info: readSf2Info(view),
      presets: readSf2Presets(view) ?? [],
    })
  }
  if (entries.length === 0) return { moved: [], records: 0, ran: false }
  const plan = planLegacyMigration(entries, now)
  for (const m of plan.moves) {
    const bytes = await io.read(m.from)
    if (!bytes) continue
    await io.save(m.to, bytes)
    await io.remove(m.from)
  }
  for (const rec of plan.records) await io.put(rec)
  return { moved: plan.moves, records: plan.records.length, ran: true }
}

/**
 * 应用启动时调用一次：把 v1 的"冒名"缓存掰正，并登记已有库。
 *
 * 为什么放在 `main.tsx` 的启动链里、而不是某个面板的 `useEffect`：
 * 它是**数据修复**，必须在使用任何库之前跑完；放在面板里会随"没打开设置"而永远不跑。
 * 失败只记日志、绝不阻断启动（音源不可用最多是没有声音，不能连编辑器都进不去）。
 */
export async function ensureBankRegistry(): Promise<MigrationResult> {
  let migrated = false
  try {
    migrated = localStorage.getItem(MIGRATED_KEY) === '1'
  } catch {
    // 无 localStorage（某些嵌入环境早期）：仍靠"libs 非空"这层幂等兜住
  }
  if (migrated) return { moved: [], records: 0, ran: false }
  const reg = createBankRegistry()
  const result = await migrateLegacyBanks(
    {
      listLibs: () => reg.list(),
      listKeys: () => listBankKeys(),
      read: (key) => readBankBytes(key),
      save: (key, bytes) => saveBankBytes(key, bytes),
      remove: (key) => deleteBankBytes(key),
      put: (rec) => reg.put(rec),
    },
    Date.now(),
  )
  if (result.ran || result.records > 0) {
    try {
      localStorage.setItem(MIGRATED_KEY, '1')
    } catch {
      /* 写不进就下次再跑一遍（幂等，不会重复搬） */
    }
  }
  return result
}
