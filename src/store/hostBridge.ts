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
}

/** 宿主推来的事件回调 */
export interface HostEvents {
  /** 宿主要求打开某个文件（双击 `.jps` 时用） */
  openFile?: (path: string) => void
  /** 主题变化（跟随 Obsidian） */
  theme?: (mode: 'dark' | 'light') => void
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
let hostWillOpenAt = 0

/** 标记"宿主马上会推一个文件"，并返回一个释放函数 */
export function notifyHostWillOpenFile(): () => void {
  hostWillOpenAt = Date.now()
  return () => {
    hostWillOpenAt = 0
  }
}

/** 自动恢复绑定是否该**让路**给宿主的 openFile（`RELEASE_MS` 窗口内为真） */
export function shouldYieldBindingRestore(): boolean {
  return hostWillOpenAt !== 0 && Date.now() - hostWillOpenAt < 2000
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
