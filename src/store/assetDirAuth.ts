/**
 * store/assetDirAuth.ts — 「资源目录」授权（adj969，**用户实报**）
 *
 * ## 这条修的是什么
 *
 * 网页 / PWA 里用**文件方式**（拖入 / 文件选择器 / 最近文件）打开的 `.jps`，若它写了
 * **相对本谱的**背景图 / 水印图（`img/底纹.png`），图必然读不到：
 * 浏览器**不给文件句柄的父目录**（`FileSystemFileHandle` 上没有任何"我在哪个目录"的 API，
 * 这是 Web 的硬限制，不是我们漏写了）⇒ `App.tsx` 算"基准"时只能落到"没有基准" ⇒ 解析失败。
 *
 * 出路只有一条：让用户**额外授权一次所在文件夹**（`showDirectoryPicker()`），于是我们同时拿到
 * "这个文件"与"它所在的目录"两个句柄 ⇒ 相对路径有了基准。
 *
 * ## 为什么不能只信"用户选的那个目录"
 *
 * 网页层拿不到任何路径，无法证明"用户选的目录就是这份谱所在的目录"。若直接采信，
 * 用户选错目录时会**静默画出另一个目录里的同名图**（比"图不显示"更坏：看不出来是错的）。
 * ⇒ 判据：在所选目录里按**同名**取文件，并要求 **字节数 + 修改时间**都与当前这份 `.jps` 一致。
 *   两条都对才认（同一份文件的两个视图，正常情况下必然一致）。
 *
 * ## 与"工作区"的区别（为什么不复用工作区那一套）
 *
 * 工作区是"以某个根为界的一个域"（可含子目录、列表、索引、最近列表）；这里只是
 * "**某一份谱所在的那个目录**"。所以句柄单独存一个键、不参与工作区列表，换工作区也不影响它。
 *
 * ## 什么时候会弹选择器（以及为什么"打开之后直接弹"做不到）
 *
 * `showDirectoryPicker()` **必须在用户手势里**调（否则抛 `SecurityError`）。而浏览器里的
 * **transient activation 是一次性的**：`showOpenFilePicker()` 会把它**用掉**
 * （`verify:app-ui` 真浏览器实测：打开之后 `navigator.userActivation.isActive === false`）
 * ⇒ 打开之后**再弹文件夹对话框必然被拒**。因此：
 *  · 「打开 / 拖入」这条路 ⇒ 装载完文档后**立刻在顶部确认条问一句**（用户 2026-10-17 拍板的那一档），
 *    用户点「授权所在文件夹」那一下才是合法手势 ⇒ 选择器在**点击处理**里弹；
 *  · 设置面板里的「授权所在文件夹」按钮 ⇒ 点它本身是手势；
 *  · 启动时恢复草稿那条路（不是手势）⇒ **一律不弹**，只在设置页签里提示（`ask:false`）。
 */
import type { AssetBase } from './assetSource'
import { loadAssetDir, saveAssetDir } from './fileHandleDb'
import { isHostFrame } from '../brand/env'
import { overlayCopy as C } from '../brand/copy'
import { useUiStore } from './uiStore'

/**
 * 当前这份谱的**文件身份**（用于核对"所选目录里是不是就是这一份"）。
 *
 * 三个字段都来自浏览器给的文件视图（`File.name` / `size` / `lastModified`），不需要读内容。
 */
export interface AssetFileRef {
  name: string
  size: number
  mtime: number
}

/** `ensureAssetDir` 的结果（每种都要能翻译成一句人话，见 `brand/copy.ts` 的 `overlayCopy`） */
export type AssetDirOutcome =
  /** 已经有可用基准（本次或上次授权过，且核对通过） */
  | 'ready'
  /** 这份谱根本不需要目录基准（没写相对路径的图 / 写的是 `data:` / 写的是双链） */
  | 'not-needed'
  /** 连"这份文件是谁"都拿不到（未保存的新谱、句柄读不动） */
  | 'no-ref'
  /** 不允许弹（非手势路径），记忆里也没有可用的 ⇒ 只提示 */
  | 'need-grant'
  /** adj969：已经在**确认条**里问过一句，等用户点按钮（`askAssetDirOnOpen` 的返回值） */
  | 'asked'
  /** 用户在选择器里取消 */
  | 'declined'
  /** 所选目录里没有这份谱（或不是同一份）⇒ 不采信 */
  | 'mismatch'
  /** 当前环境不支持选文件夹（无 API，或处在跨源子框架里） */
  | 'unsupported'
  /** 其它失败（权限、内核策略…） */
  | 'failed'

/** 已启用（且核对通过）的资源目录 */
interface EnabledDir {
  dir: FileSystemDirectoryHandle
  /** 会话内身份——只用于解析缓存键（目录句柄没有可打印的路径，见 `assetSource.ts` 的 `cacheKeyOf`） */
  id: string
  /** 这份授权**针对哪个文件**核对通过的（`assetFileKeyOf`） */
  forFile: string
}

let enabled: EnabledDir | null = null
let seq = 0
let revision = 0
const listeners = new Set<() => void>()

/**
 * 记住的句柄在内存里也留一份 Promise：`ensureAssetDir` 每次打开文档都会被调一次，
 * 每次都开一遍 IndexedDB 是白花的开销。
 */
let remembered: Promise<FileSystemDirectoryHandle | null> | null = null

/** 已经为哪一份文件**自动问过**（`assetFileKeyOf`；同一份谱在一次会话里只自动问一次） */
let askedFor: string | null = null

/** 文件身份键（`name` + 字节数 + 修改时间）——"是不是同一份"的判据，也是"这份授权给谁用"的记名 */
export function assetFileKeyOf(ref: AssetFileRef): string {
  return `${ref.name}|${ref.size}|${ref.mtime}`
}

/** 读当前已启用的资源目录（没有 ⇒ null） */
export function getEnabledAssetDir(): EnabledDir | null {
  return enabled
}

/** 给 `assetSource` 的基准对象（没有可用目录 ⇒ null，调用方据此走 `fileNoDir` 那一档） */
export function getAssetBase(): AssetBase | null {
  return enabled === null ? null : { kind: 'picked', dir: enabled.dir, id: enabled.id }
}

/** 订阅变化（`App.tsx` 用它触发"重新解析水印/背景"） */
export function subscribeAssetDir(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 读版本号（`useSyncExternalStore` 的 `getSnapshot`：只在真的变了才换值） */
export function getAssetDirRevision(): number {
  return revision
}

function publish(): void {
  revision++
  for (const fn of listeners) fn()
}

/** 启用（或清空）当前资源目录 */
function enable(dir: FileSystemDirectoryHandle | null, forFile: string): void {
  if (dir === null) {
    if (enabled === null) return
    enabled = null
    publish()
    return
  }
  enabled = { dir, id: `d${++seq}`, forFile }
  publish()
}

/**
 * 当前环境能不能弹文件夹选择器。
 *
 * 两层判据：① 有 `showDirectoryPicker`（WebKit / 部分 WebView 没有）；
 * ② **不在 iframe 里**——跨源子框架弹选择器会被策略直接拒（Obsidian 嵌入版就是这种；
 * 那边"相对本谱的路径"本体就是 vault 里的路径，不该让用户去选一个系统文件夹）。
 */
export function canRequestAssetDir(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') return false
  return !isHostFrame()
}

/** 从文件句柄取"身份"（读不动 ⇒ null：权限没了、文件被删了） */
export async function refOfHandle(handle: FileSystemFileHandle | null): Promise<AssetFileRef | null> {
  if (handle === null) return null
  try {
    const f = await handle.getFile()
    return { name: f.name, size: f.size, mtime: f.lastModified }
  } catch {
    return null
  }
}

/** 从一个 `File` 取"身份"（拖入但拿不到句柄、`<input>` 上传降级这两档走它，见 `docStore.adoptDoc`） */
export function refOfFile(f: File): AssetFileRef {
  return { name: f.name, size: f.size, mtime: f.lastModified }
}

/**
 * 核对"这个目录里是不是就是这一份谱"（本功能的**安全判据**，见文件头）。
 *
 * 只比元信息（同名 + 字节数 + 修改时间），不读内容：两份不同的谱撞上这三样的概率可以忽略，
 * 而为了核对把整份谱读一遍，在拖入大谱时是白花的开销。
 */
async function dirHoldsFile(dir: FileSystemDirectoryHandle, ref: AssetFileRef): Promise<boolean> {
  try {
    const fh = await dir.getFileHandle(ref.name)
    const f = await fh.getFile()
    return f.size === ref.size && f.lastModified === ref.mtime
  } catch {
    return false // 没这个文件 / 没读权限 ⇒ 都不采信
  }
}

/** 目录的读权限：`ask` 为真时**在用户手势内**申请（`requestPermission` 必须如此，否则拿不到） */
async function readPermission(dir: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const h = dir as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>
  }
  if (typeof h.queryPermission !== 'function') return true // 没有权限 API 的环境：交给真正的读取去失败
  try {
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
    if (!ask || typeof h.requestPermission !== 'function') return false
    return (await h.requestPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/** 记住的句柄（进程内只读一次 IndexedDB） */
function rememberedHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (remembered === null) remembered = loadAssetDir()
  return remembered
}

/** 忘掉记住的目录（换文件、核对失败、用户撤销时清掉，免得下次又白核一遍） */
export function forgetAssetDir(): void {
  remembered = Promise.resolve(null)
  void saveAssetDir(null)
  enable(null, '')
}

/**
 * 弹一次文件夹选择器（**必须**在用户手势里）。
 * 返回 `null` = 用户取消；`'unsupported'` = 这个环境弹不了；其余异常往上抛给调用方归类。
 */
async function pickDir(): Promise<FileSystemDirectoryHandle | null | 'unsupported'> {
  if (!canRequestAssetDir()) return 'unsupported'
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (o?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  if (typeof picker !== 'function') return 'unsupported'
  try {
    // `id` 让浏览器记住"上次授权的是哪个目录"，下次从这里开始（Chromium 认；不认就忽略该字段）
    return await picker({ id: 'ijipu-asset-dir', mode: 'read' })
  } catch (e) {
    // 用户取消（AbortError）与"被策略拒"（SecurityError）是两件事，调用方要分别说话
    if (e instanceof Error && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * 核心：保证"当前这份谱"有一个可用的资源目录基准。
 *
 * @param need 这份谱**需不需要**目录基准（判据是引擎的 `localAssetRefs`：写了相对路径的
 *   水印/背景图才算；`data:` 内嵌与 `[[双链]]` 都不算）。由调用方传入，是为了让
 *   `App.tsx` 那个 effect 的依赖保持"逐字段"（带整个 `PageConfig` 对象会让它每改一个字就重跑）。
 * @param ref 当前文件的身份；`null` = 拿不到（未保存的新谱 / 句柄失效）
 * @param ask 是否允许弹选择器（**必须**由"在用户手势里的调用方"传 `true`，见文件头）
 */
async function core(need: boolean, ref: AssetFileRef | null, ask: boolean): Promise<AssetDirOutcome> {
  // 不需要基准就一个字都不做：不读 IO、不弹窗（用户口径：别为没写图的谱折腾）
  if (!need) {
    enable(null, '')
    return 'not-needed'
  }
  if (ref === null) {
    enable(null, '')
    return 'no-ref'
  }
  const key = assetFileKeyOf(ref)
  // 已经为**这一份文件**核对通过 ⇒ 直接用（重排/改设置都会回到这里，不该重复核）
  if (enabled !== null && enabled.forFile === key) return 'ready'

  // ① 先试"上次授权过的那个目录"：跨会话复用（用户口径：文件夹句柄要记住）
  const had = await rememberedHandle()
  if (had !== null) {
    const ok = (await readPermission(had, ask)) && (await dirHoldsFile(had, ref))
    if (ok) {
      enable(had, key)
      return 'ready'
    }
    // 核不过（换了文件 / 文件被改 / 权限被撤）⇒ 清掉，别让它一直挂在那里每次白核
    if (enabled !== null && enabled.dir === had) enable(null, '')
    if (!ask) return 'need-grant'
    forgetAssetDir()
  } else if (!ask) {
    if (enabled !== null) enable(null, '')
    return 'need-grant'
  }

  // ② 弹一次：**只可能来自用户那一下点击**（确认条按钮 / 设置页签按钮，见 `askAssetDirOnOpen` 的说明）
  let picked: FileSystemDirectoryHandle | null | 'unsupported'
  try {
    picked = await pickDir()
  } catch {
    return 'failed'
  }
  if (picked === 'unsupported') return 'unsupported'
  if (picked === null) return 'declined'
  if (!(await dirHoldsFile(picked, ref))) {
    // 选错目录：**不记住**（记住一个错的目录比不记更坏——下次会拿它去读别人家的同名图）
    enable(null, '')
    return 'mismatch'
  }
  remembered = Promise.resolve(picked)
  void saveAssetDir(picked)
  enable(picked, key)
  return 'ready'
}

/**
 * **打开一份谱之后立刻问一句**（用户 2026-10-17 拍板的那一档）。
 *
 * ## 为什么不是"直接弹文件夹对话框"，而是"弹应用内的确认条"
 *
 * **实测（`npm run verify:app-ui`，真浏览器）**：在打开动作之后直接调 `showDirectoryPicker()` 时，
 * `navigator.userActivation.isActive` 已经是 **false** —— 因为 `showOpenFilePicker()` 那次
 * **把"用户手势"用掉了**（transient activation 是**一次性**的，会被弹选择器消费）。
 * 真浏览器里这时再弹文件夹对话框只会抛 `SecurityError`，用户看到的就是"什么都没发生" ✗。
 *
 * ⇒ 唯一可靠的做法：**先把话问出来，用户点「授权所在文件夹」那一下才是合法手势**，
 * 选择器在点击处理里弹。这也正是用户选的那一档的字面意思（"自动问'要不要授权那个文件夹'"）：
 * 问是自动的，弹对话框那一下交给用户点。**取消 = 暂不**，提示仍留在设置页签里等用户回头处理。
 *
 * 只在"确实需要"（写了相对路径的图）且"记忆里没有可用的目录"时才问，不会为没写图的谱骚扰。
 */
export async function askAssetDirOnOpen(need: boolean, ref: AssetFileRef | null): Promise<AssetDirOutcome> {
  if (!need) return 'not-needed'
  if (ref === null) return 'no-ref'
  // 先**只核对记忆**（跨会话复用）：核得过就什么都不问（打开一份谱不该每次都弹东西）
  const out = await core(need, ref, false)
  if (out === 'ready') return 'ready'
  /**
   * 同一份谱在一次会话里只自动问一次（用户点「暂不」之后不该每次重排都再冒出来）。
   * 用户主动去设置页签点按钮不受此限（那是他明确要的）。
   */
  const key = assetFileKeyOf(ref)
  if (askedFor === key) return 'asked'
  askedFor = key
  useUiStore.getState().showAsk({
    text: C.assetDirAsk(ref.name),
    confirmLabel: C.authDirButton,
    // 点这一下 = 新的用户手势 ⇒ 选择器这次一定能弹出来（见上面实测说明）
    onConfirm: () => void requestAssetDirNow(need, ref),
    cancelLabel: C.assetDirLater,
    onCancel: () => {},
  })
  return 'asked'
}

/**
 * 设置页签里那个按钮：**手动**再授权一次。
 * 用户点了按钮就必须有反馈 ⇒ 每种结果都说一句（含"取消了"这种看起来像没反应的）。
 */
export async function requestAssetDirNow(need: boolean, ref: AssetFileRef | null): Promise<AssetDirOutcome> {
  const ui = useUiStore.getState()
  if (!canRequestAssetDir()) {
    ui.showNotice(C.authDirUnsupported, 'warn')
    return 'unsupported'
  }
  ui.showNotice(C.authDirBusy, 'warn')
  const out = await core(need, ref, true)
  switch (out) {
    case 'ready':
      ui.showNotice(C.authDirOk(enabled?.dir.name ?? ''), 'ok')
      break
    case 'declined':
      ui.showNotice(C.authDirCanceled, 'warn')
      break
    case 'mismatch':
      ui.showNotice(C.authDirMismatch(ref?.name ?? ''), 'warn')
      break
    case 'unsupported':
      ui.showNotice(C.authDirUnsupported, 'warn')
      break
    case 'failed':
      ui.showNotice(C.authDirFailed, 'error')
      break
    default:
      // not-needed / no-ref / need-grant：都不是"授权这件事"能解决的，交回提示（页面里本来就有）
      break
  }
  return out
}

/**
 * 非手势路径（启动时恢复草稿、换文档后重排）：**只核对记忆，绝不弹**。
 * 调用方关心的是 `getAssetBase()`，返回值只用于排错。
 */
export async function adoptRememberedAssetDir(need: boolean, ref: AssetFileRef | null): Promise<AssetDirOutcome> {
  return core(need, ref, false)
}
