/**
 * store/hostBridge.ts — **宿主桥客户端**（嵌入版专用）：让 iJipu 以 Obsidian 文库为工作区
 *
 * ## 它解决什么
 *
 * 嵌入版运行在 Obsidian 的 iframe 里——是**浏览器上下文**，拿不到 Node/Electron 能力，
 * 也**不该**弹"选文件夹"授权（文库本身就是工作区）。于是插件侧提供一个桥
 * （`obsidian-ijipu/src/embed/bridge.ts`），把文件操作落到 Obsidian 的 `vault.adapter.*`。
 *
 * ## 识别与降级
 *
 * 启动时向 `window.parent` 发 `hello`（带 URL 里的一次性 token），等 `welcome`：
 *  · **收到** ⇒ 嵌入环境，启用 `'vault'` 后端（`root` = 文库根或设置的子目录）；
 *  · **3 秒内没收到**（普通浏览器/桌面壳/独立页签）⇒ 返回 `null`，
 *    一切照旧走原有的 `fsa`/`path` 后端 —— **同一份产物在浏览器里照常可用**。
 *
 * ## 协议（与插件侧一一对应）
 *
 * 请求 `{ ch:'ijipu', id, op, args }` → 响应 `{ ch:'ijipu', id, ok, result|error }`；
 * 宿主 → 应用事件 `{ ch:'ijipu', type:'welcome'|'theme'|'openFile', ... }`。
 */
import { normalizeRelPath } from './workspace'
import { fromBase64 } from '@ijipu/engine'

/** 与插件侧共用的通道标识 */
const CHANNEL = 'ijipu'
/** 握手超时（ms）——超过即判定"不是嵌入环境" */
const HELLO_TIMEOUT_MS = 3000
/** 单次请求超时（ms）——本地回环，正常都在毫秒级 */
const REQUEST_TIMEOUT_MS = 15000

export interface HostWelcome {
  vaultName: string
  theme: 'dark' | 'light'
  /** adj724b：宿主是否希望"跟随宿主主题"（对应插件设置里的「跟随 Obsidian 主题」） */
  followTheme?: boolean
  /** 工作区根（vault 相对路径；`''` = 文库根） */
  root: string
  capabilities: { write: boolean; rename: boolean; remove: boolean; trash: boolean }
  /**
   * adj729（用户要求）：**音色库文件的取用地址**（`{ <库 id>: url }`）。
   *
   * 插件把下载/导入的音源放在**自己的目录**里（`<配置目录>/plugins/<插件 id>/soundfonts/<id>.sf2`），
   * 并在这个字段里给出它的 URL ⇒ 应用直接取用，**不再自己下载、也不再各存一份**，
   * 于是"音源随文库一起走"对两端同时成立。
   */
  bankUrls?: Record<string, string>
}

/** 宿主推来的事件回调 */
export interface HostEvents {
  /** 宿主要求打开某个文件（双击 `.jps` 时用） */
  openFile?: (path: string) => void
  /** 主题变化（跟随 Obsidian） */
  theme?: (mode: 'dark' | 'light') => void
  /**
   * adj728（用户要求）：**宿主让应用打开「设置 → 音色库」**。
   *
   * 用于插件侧"试听失败"提示上的按钮：自动下载音源在部分网络不可达，
   * 用户需要被送到能**手动导入**的地方（设置 → 音色库 → 导入音色文件）。
   */
  openSoundbankSettings?: () => void
  /**
   * adj724b：宿主告知**某个 `.jps` 在 Obsidian 那边被改了**（外部编辑、同步、其它插件…）。
   *
   * 应用据此比对自己手里的内容，不一致才提示"是否重新载入"——
   * 我们自己每次即时保存也会让 Obsidian 触发 modify，那种情况内容必然一致、不该打扰用户。
   */
  fileChanged?: (path: string) => void
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }

/** 单例状态 */
let bridge: HostBridge | null = null

export function hostBridge(): HostBridge | null {
  return bridge
}

/** 是否处于嵌入环境（握手成功过） */
export function isHostEmbedded(): boolean {
  return bridge !== null
}

/**
 * adj729：**该音源在插件目录里的取用地址**（不在嵌入环境 / 宿主还没这份文件时返回 `undefined`）。
 *
 * 用户口径：「音色库下载或导入后，建议放在插件目录中，以便能随文库一起走」——
 * 应用各处取音源时先问它（`resolveHqBank(lib, cache, hostBankUrl(lib.id))`）。
 */
export function hostBankUrl(id: string): string | undefined {
  return bridge?.bankUrl(id)
}

/**
 * adj724b：**宿主即将推一个文件过来**（用户点了库里的 `.jps`）。
 *
 * ## 为什么需要这个开关（用户实测）
 *
 * `docStore` 在**模块加载时**就会自动恢复"上一份草稿的来源绑定"
 * （`resolvePendingBinding()`，见文件末尾），而宿主推来的 `openFile` 是**异步后到**的。
 * 两者都会设置"当前文件"，**谁后到谁赢** ⇒ 用户看到的现象是
 * 「我点了 A，界面却显示 B（上一次那份）」。
 *
 * 于是：宿主推文件**之前**先调这里立个标记，让那条自动恢复**让路**——
 * 由宿主推来的文件来建立绑定关系（它本来就会建立，见 `openWorkspaceFile`）。
 * 之后（`RELEASE_MS` 后）标记自动清除，回到正常语义。
 */
/**
 * adj724b：**宿主即将推一个文件**（用户点了库里的 `.jps`）——当前**不再用于**绑定恢复的让路。
 *
 * 保留它是因为它同时是一份**时序信号**：嵌入版里"宿主推文件"与"应用自身的启动恢复"
 * 是两条并发链，排错时能直接从日志看出先后（`main.tsx` 在推文件前会记一条）。
 *
 * ⚠ 那个"让路守卫"已撤：真正的根因是 `openWorkspaceFile()` **认领绑定太晚**
 * （见 `docStore.ts` 的注释），已在那边用"第一个 await 之前同步认领"修掉。
 * 拿时间窗口去挡是治标，而且会误伤用户**正常**重开应用时的"恢复上次绑定"。
 */
let hostWillOpenAt = 0

/** 标记"宿主马上会推一个文件"；释放即清除（另有 `RELEASE_MS` 兜底） */
export function notifyHostWillOpenFile(): () => void {
  hostWillOpenAt = Date.now()
  return () => {
    hostWillOpenAt = 0
  }
}

/** 兜底窗口（避免宿主链路出错时标记长期滞留） */
const RELEASE_MS = 5000

/** 最近一次"宿主即将推文件"是否仍在窗口内（仅用于诊断/日志，不参与正确性判断） */
export function shouldYieldBindingRestore(): boolean {
  if (hostWillOpenAt === 0) return false
  if (Date.now() - hostWillOpenAt < RELEASE_MS) return true
  hostWillOpenAt = 0
  return false
}

/** 从 `location.pathname` 里取一次性 token（URL 形如 `/<token>/`） */
export function tokenFromLocation(): string {
  const parts = window.location.pathname.split('/').filter((s) => s !== '')
  return parts[0] ?? ''
}

export class HostBridge {
  private seq = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listeners: HostEvents = {}
  /** 宿主回传的环境信息（文库名/主题/工作区根/能力） */
  readonly welcome: HostWelcome
  /** 已发起的请求总数（排错探针用） */
  callCount = 0
  /** 最近若干次 `op`（排错探针用；只留很短一截） */
  readonly recentOps: string[] = []

  constructor(welcome: HostWelcome) {
    // 注意：项目开了 `erasableSyntaxOnly`，**不能用构造函数参数属性**（`constructor(readonly x)`）
    this.welcome = welcome
    window.addEventListener('message', (ev) => this.onMessage(ev))
  }

  /** 注册宿主事件回调（同一类事件只保留最后一个） */
  on(events: HostEvents): void {
    Object.assign(this.listeners, events)
  }

  /**
   * 告诉宿主"我已装好监听，可以推事件了"。
   *
   * 必须在 `on({ openFile })` **之后**调用——否则宿主推来的 `openFile` 会丢
   * （应用还没装监听）。宿主收到 `ready` 才下发"本页签要打开的文件"。
   */
  signalReady(): void {
    window.parent.postMessage({ ch: CHANNEL, type: 'ready' }, '*')
  }

  // ───────────────────────── adj724b：键值存储（替代 localStorage） ─────────────────────────

  /** 读全部（启动时一次性预载） */
  kvAll(): Promise<Record<string, string>> {
    return this.call<Record<string, string>>('kvAll')
  }

  /** 写一条（宿主侧防抖落盘；应用不等待结果） */
  kvSet(key: string, value: string): void {
    void this.call('kvSet', { key, value }).catch(() => {
      /* 宿主不可用时不阻塞 UI（设置会在下次启动时回落默认） */
    })
  }

  /** 删一条 */
  kvRemove(key: string): void {
    void this.call('kvRemove', { key }).catch(() => {
      /* 同上 */
    })
  }

  // ─────────────────── adj729：音色库（落在**插件目录**，随文库一起走） ───────────────────

  /**
   * 该音源在**宿主（插件目录）**里的取用地址；没有就返回 `undefined`。
   *
   * 用户口径：「音色库下载或导入后，建议放在插件目录中，以便能随文库一起走」——
   * 于是嵌入版应用不再自己下 32 MB、也不再各存一份：直接取宿主给的这个地址。
   */
  bankUrl(id: string): string | undefined {
    const url = this.welcome.bankUrls?.[id]
    return url && url.length > 0 ? url : undefined
  }

  /** 让**宿主**弹文件选择器把音源导入插件目录（嵌入环境专用；32 MB 不跨窗口搬） */
  importSoundbank(id: string): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    return this.call<{ ok: boolean; canceled?: boolean; error?: string }>('importSoundbank', { id })
  }

  // ───────────────── adj965（方案 OVL，EP-09）：水印 / 背景图的**读图**通道 ─────────────────

  /**
   * 读一张图片的字节（**工作区相对路径段**，末段是文件名）。
   *
   * 为什么必须走桥：嵌入版在 iframe 里（浏览器上下文），拿不到 vault 的二进制读；
   * 而"相对本谱的路径"这条口径在插件里就是"vault 里的路径"。
   *
   * 契约与 `AssetReader` 对齐：
   *  · **文件不在** ⇒ `null`（这条通道"读不到"，上层报"未找到图片"）；
   *  · **越界 / 不是图片 / 太大** ⇒ 宿主返回失败 ⇒ 这里**抛错**，把宿主那句能照着做的中文说明带上去。
   */
  async readAsset(segs: readonly string[]): Promise<AssetBytes | null> {
    const r = await this.call<RawAsset | null>('readAsset', { path: hostPathOf(segs) })
    return toAssetBytes(r)
  }

  /**
   * 读一张**双链**写的图片（`[[图片.png]]`）——由**宿主**用 Obsidian 的链接解析去找
   * （vault 全域、可跨目录；`sourceVaultPath` 是"从哪篇笔记里写的"，决定相对链接的基准）。
   */
  async readLinkedAsset(link: string, sourceVaultPath: string): Promise<AssetBytes | null> {
    const r = await this.call<RawAsset | null>('readAsset', { link, source: sourceVaultPath })
    return toAssetBytes(r)
  }

  /**
   * 执行一个宿主操作。
   * 失败时**抛错**（调用方按既有错误路径处理，例如"保存失败"提示）。
   */
  async call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq
    this.callCount++
    this.recentOps.push(op)
    if (this.recentOps.length > 32) this.recentOps.shift()
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`宿主无响应（${op}）`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      window.parent.postMessage({ ch: CHANNEL, id, op, args }, '*')
    })
  }

  private onMessage(ev: MessageEvent): void {
    const data = ev.data as
      | { ch?: string; id?: number; ok?: boolean; result?: unknown; error?: string; type?: string; [k: string]: unknown }
      | undefined
    if (!data || data.ch !== CHANNEL) return
    // 只认父窗口（宿主）发来的消息
    if (ev.source !== window.parent) return

    if (typeof data.id === 'number') {
      const p = this.pending.get(data.id)
      if (!p) return
      this.pending.delete(data.id)
      window.clearTimeout(p.timer)
      if (data.ok) p.resolve(data.result)
      else p.reject(new Error(data.error ?? '宿主返回失败'))
      return
    }
    // 事件型
    if (data.type === 'openFile' && typeof data.path === 'string') this.listeners.openFile?.(data.path)
    if (data.type === 'fileChanged' && typeof data.path === 'string') this.listeners.fileChanged?.(data.path)
    if (data.type === 'theme' && (data.mode === 'dark' || data.mode === 'light')) this.listeners.theme?.(data.mode)
    // adj728：宿主让应用打开「设置 → 音色库」（插件那条试听失败提示的按钮）
    if (data.type === 'openSoundbankSettings') this.listeners.openSoundbankSettings?.()
  }
}

/**
 * 握手；成功返回桥单例，失败（超时/不在 iframe 里）返回 `null`。
 *
 * 只在**启动时调一次**——重复调用不会重复建连接。
 */
export async function initHostBridge(): Promise<HostBridge | null> {
  if (bridge) return bridge
  // 不在 iframe 里 ⇒ 不可能是嵌入环境，直接放弃（省掉 3 秒等待）
  if (window.parent === window) return null

  const token = tokenFromLocation()
  if (token === '') return null

  const welcome = await new Promise<HostWelcome | null>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve(null)
    }, HELLO_TIMEOUT_MS)
    const onMsg = (ev: MessageEvent): void => {
      const d = ev.data as { ch?: string; type?: string; [k: string]: unknown } | undefined
      if (!d || d.ch !== CHANNEL || d.type !== 'welcome') return
      if (ev.source !== window.parent) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      resolve({
        vaultName: String(d.vaultName ?? ''),
        theme: d.theme === 'light' ? 'light' : 'dark',
        followTheme: d.followTheme !== false,
        root: String(d.root ?? ''),
        capabilities: (d.capabilities as HostWelcome['capabilities']) ?? {
          write: true,
          rename: true,
          remove: true,
          trash: true,
        },
        // adj729：音色库文件的取用地址（插件目录里那份；见 HostWelcome.bankUrls）
        bankUrls: (d.bankUrls as Record<string, string> | undefined) ?? {},
      })
    }
    window.addEventListener('message', onMsg)
    window.parent.postMessage({ ch: CHANNEL, type: 'hello', token }, '*')
  })

  if (!welcome) return null
  bridge = new HostBridge(welcome)
  return bridge
}

// ─────────────────────────── 与 workspace.ts 对接的薄封装 ───────────────────────────

/** 把工作区相对路径段数组转成宿主认的字符串（宿主侧再归一化一次） */
export function hostPathOf(segs: readonly string[]): string {
  return normalizeRelPath(segs).join('/')
}

/** 宿主 `readAsset` 的原始返回（base64；`null` = 文件不在） */
interface RawAsset {
  base64?: string
  mime?: string
  mtime?: number
}

/** 读图结果（与 `assetSource` 的 `AssetReader` 返回值同形） */
export interface AssetBytes {
  bytes: Uint8Array
  mime: string
  mtime: number
}

/** base64 → 字节（`fromBase64` 是引擎里的纯函数，两端同一份；这里只做形状归一 + 容错） */
function toAssetBytes(r: RawAsset | null): AssetBytes | null {
  if (r === null || typeof r.base64 !== 'string' || r.base64 === '') return null
  return {
    bytes: fromBase64(r.base64),
    mime: typeof r.mime === 'string' && r.mime !== '' ? r.mime : 'application/octet-stream',
    mtime: typeof r.mtime === 'number' ? r.mtime : 0,
  }
}
