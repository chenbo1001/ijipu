/**
 * store/externalChangeWatch.ts — **外部改动的轮询**（adj966）
 *
 * ## 它解决什么
 *
 * 一份 `.jps` 被同步端（另一台机器 / Obsidian / 网盘同步）改过之后，本端"编辑内容来自缓存"并不知道，
 * 下一次保存就把**最新修改覆盖**掉。插件端有宿主 `modify` 事件（`watch: 'event'`）；
 * 桌面壳与网页版/PWA 没有事件源 —— 这里按 `decideWatch` 给的档位**轮询**：
 * 页面可见时按间隔查一次，回到前台时补查一次；隐藏时不查（省电省 IO）。
 *
 * ## 判据只有一处
 *
 * 「查不查」由 `store/fileHost.ts` 的 `decideWatch` 决定，「变没变」由 `store/externalChange.ts`
 * 的 `probeExternalChange` 决定 —— 本模块**只做编排**（定时、可见性、并发去重、把结果交给回调），
 * 因此所有 IO 与定时器都**注入**：smoke 能在 Node 里用假 IO + 假定时器把时序真跑一遍
 * （与 `workspace.ts` 的 `createWorkspaceLoadStore` 同一手法）。
 *
 * ## 不变量（与 docs/FILE-MODEL.md 一致）
 *
 *  · 有外部改动 ⇒ **只通知、绝不自动写**（弹"保留本地 / 载入外部 / 查看差异"，由用户定）；
 *  · 自己在途写 / 自己刚写完 ⇒ 由 `externalChange` 的基准与"在途写"判为 `unchanged`，**不打扰用户**；
 *  · 读失败（文件被删/被移走）⇒ 静默跳过，交给其它路径提示。
 */
import type { WatchMode } from './fileHost'

/** 可见时的轮询间隔（毫秒）。4 秒：一次读 + 一次指纹比对，代价可忽略，又能及时发现问题 */
export const EXT_POLL_MS = 4000

/** 这一刻该做什么（纯判据：`poll` = 起一次定时；`once` = 只在回到前台查一次；`skip` = 不查） */
export type WatchTick = 'poll' | 'once' | 'skip'

/**
 * 按能力档与页面可见性决定这一刻的动作：
 *  · `event`（宿主会推）/ `none`（受限档）⇒ 永不轮询；
 *  · 没有绑定对象 ⇒ 不查（没东西可比）；
 *  · `poll` + 可见 ⇒ 查；隐藏 ⇒ 不查（等 `visibilitychange` 回来时补一次）；
 *  · `focus-only`（隐藏期间的降级档）⇒ 只在回到前台时查一次。
 */
export function watchTick(mode: WatchMode, visible: boolean, hasBinding: boolean): WatchTick {
  if (!hasBinding) return 'skip'
  if (mode === 'event' || mode === 'none') return 'skip'
  if (mode === 'poll') return visible ? 'poll' : 'skip'
  return 'once'
}

/** 轮询用的 IO（各端适配器提供：FSA 句柄 / 原生路径 / 宿主桥） */
export interface WatchIO {
  /** 基准键（`baselineKeyOf(wsId, segs)`；原生路径/句柄各有自己的键法） */
  key: string
  /** 取 mtime（毫秒）；拿不到返回 `null` ⇒ 判据退化为只比内容 */
  mtimeOf: () => Promise<number | null>
  /** 读"文件此刻的文本" */
  readText: () => Promise<string>
}

/** 编排依赖（全部注入：定时器、可见性、当前绑定、结果回调） */
export interface WatchDeps {
  /** 当前能力档对应的监视方式（`decideWatch` 的结果） */
  mode: () => WatchMode
  /** 页面是否可见 —— ⚠ **适配器契约**：`onVisible` 回调被调用时，本函数必须已经返回**新的**可见性
   *（浏览器的 `visibilitychange` 在 `document.visibilityState` 更新之后才触发 ⇒ 真实适配器天然满足） */
  visible: () => boolean
  /** 是否已绑定一个文件（没绑定就没什么可查） */
  hasBinding: () => boolean
  /** 取当前绑定的 IO；没有返回 `null` */
  io: () => WatchIO | null
  /** 此刻编辑器里的内容（按取值函数传——判定要用"这一刻"的内容，见 `externalChange.ts`） */
  localText: () => string
  /** 判定为"真外部改动"时回调（传文件现在的原始文本，差异框与"载入外部"都用它） */
  onExternal: (externalText: string) => void
  /** 起一个周期定时（返回取消函数） */
  startInterval: (fn: () => void, ms: number) => () => void
  /** 订阅"回到前台/可见性变化"（返回取消函数） */
  onVisible: (fn: () => void) => () => void
  /** 供 smoke 注入真实比对函数；生产传 `probeExternalChange` */
  probe: (io: {
    key: string
    localText: () => string
    mtimeOf: (() => Promise<number | null>) | null
    readText: () => Promise<string>
  }) => Promise<{ kind: 'unchanged' } | { kind: 'external'; externalText: string }>
  /**
   * adj966c（用户实报「保存还是比较慢」）：**正在写盘时不要查**。
   *
   * 为什么：轮询会真的去读那个文件。Windows 上"读句柄还没放"的时候，写盘的**原子替换（close/commit）**
   * 可能被拖慢甚至短暂重试 —— 而 commit 恰恰是保存里最慢的一段（历史上实测过 7.1s）。
   * 写盘期间本来就"必然不同"，查了也没意义 ⇒ 直接让路。
   * 生产传 `() => getWriteInFlight() !== null`（写盘发出前登记、写成功后刷基准时自动清掉）。
   */
  paused?: () => boolean
}

/** 启动轮询；返回停止函数（组件卸载 / 换绑定时调用） */
export function startExternalWatch(deps: WatchDeps): () => void {
  let busy = false
  let stopped = false
  /**
   * adj966b（**用户实报**：「选择了保留本地后，还会再检测到差异再提示，**一直提示**」）：
   * 记住"**已经就这一份外部内容提示过**"。理由：用户看过差异、选了「保留本地」之后，
   * 若那次写回没成功（只读文件 / 文件被移走 / 权限掉了），基准仍是旧的 ⇒ 下一次轮询又判"外部改动"
   * ⇒ 弹个没完 ✗。**同一份外部内容只提示一次**；内容真又变了（不同文本）才再提示 ✓。
   * 正常路径（写回成功 ⇒ 基准刷新）本来就不会重复，这只是写不回去时的保险。
   */
  let prompted: string | null = null

  async function tick(): Promise<void> {
    if (stopped || busy) return
    if (deps.paused?.()) return // 正在写盘：让路（见 `paused` 的说明）
    if (watchTick(deps.mode(), deps.visible(), deps.hasBinding()) === 'skip') return
    const io = deps.io()
    if (!io) return
    busy = true
    try {
      const verdict = await deps.probe({
        key: io.key,
        localText: deps.localText,
        mtimeOf: io.mtimeOf,
        readText: io.readText,
      })
      if (!stopped && verdict.kind === 'external') {
        if (verdict.externalText === prompted) return // 同一份外部内容：已经提示过，别再打扰
        prompted = verdict.externalText
        deps.onExternal(verdict.externalText)
      }
    } catch {
      // 读不到（刚被删 / 被移走 / 权限掉了）⇒ 静默跳过，交给保存路径与其它提示
    } finally {
      busy = false
    }
  }

  const stopTimer = deps.startInterval(() => void tick(), EXT_POLL_MS)
  const stopVisible = deps.onVisible(() => {
    if (watchTick(deps.mode(), deps.visible(), deps.hasBinding()) !== 'skip') void tick()
  })
  return () => {
    stopped = true
    stopTimer()
    stopVisible()
  }
}
