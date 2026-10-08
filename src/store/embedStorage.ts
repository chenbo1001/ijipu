/**
 * store/embedStorage.ts — **嵌入版的持久化存储**（让浏览器 `localStorage` 的语义继续成立）
 *
 * ## 它解决什么（用户实测 bug）
 *
 * 「嵌入版本的全局设置没有保存，ob 重启后恢复为默认」。
 *
 * 根因：`localStorage` 的作用域是 **origin**，而嵌入页面由插件在
 * `http://127.0.0.1:<port>` 上临时托管 —— **端口一变就是"另一个站点"**，
 * 上一轮写进 `ijipu.*` 的全局设置自然读不回来。
 *
 * 两处一起修（双保险）：
 *  ① 插件侧**优先固定端口**（`server.ts` 的 `PREFERRED_PORT`），让 origin 跨会话稳定；
 *  ② **本模块**：把 `localStorage` 换成"**经宿主桥读写插件设置文件**"的实现——
 *     这样即便端口被占、回退到别的端口，设置也**不会丢**（不依赖 origin）。
 *
 * ## 做法：替换 `window.localStorage` 本身
 *
 * 应用里十几个偏好键（`uiStore.ts` 的 `THEME_KEY` / `PREVIEW_ZOOM_KEY` / `playbackHq*` 等）
 * 以及 `editorPrefs`、几个组件的直接 `localStorage.setItem` 调用，**语义都是"同步的键值偏好存储"**。
 * 逐个改调用点既啰嗦又容易漏 ⇒ 这里保持**同步 API 不变**：
 * 启动时把宿主里的数据一次性**预载进内存**（`preloadEmbedStorage()`），
 * 之后 `getItem` 读内存、`setItem` 写内存 + **异步**回写宿主。
 *
 * ## 边界（写清楚，免得后人误解）
 *
 * - **只管 `ijipu.` 前缀的键**（本项目的偏好命名空间）；其它键（第三方/宿主自己的）原样交给
 *   真正的 `localStorage`，不越界。
 * - 嵌入版里 `localStorage` 与宿主存储**同时**写：前者可能因 origin 变化失效，但留着没有坏处
 *   （同一次会话内更快、且万一桥不可用还能兜一层）。
 * - 真正的 `localStorage` 保留在 `realLocalStorage`，`clear()` 只清我们的命名空间。
 */
import { hostBridge, isHostEmbedded } from './hostBridge'

/** 被桥接的键前缀（本项目所有偏好键的统一前缀，见 AGENTS 七之 5） */
const PREFIX = 'ijipu.'

/** 宿主里的快照（内存镜像；`getItem` 的同步来源） */
let snapshot = new Map<string, string>()

/** 真正的 localStorage（替换前保存一份，用于非 `ijipu.` 键与兜底） */
let realLocalStorage: Storage | null = null

/** 是否已经完成替换 */
let installed = false

/**
 * 启动时调用：把宿主里的键值预载进内存，然后替换 `window.localStorage`。
 *
 * **必须在 `createRoot(...).render(...)` 之前 await**——应用的 store 在模块求值阶段就会
 * 读 `localStorage`（主题、缩放、拆分比例…），晚了就会先用默认值把 UI 画出来。
 */
export async function preloadEmbedStorage(): Promise<void> {
  if (!isHostEmbedded() || installed) return
  const bridge = hostBridge()
  if (!bridge) return
  try {
    const all = await bridge.kvAll()
    snapshot = new Map(Object.entries(all))
  } catch {
    // 读不到就当空表：本次会话用默认值，但**不**因此禁用桥接（后续写入仍会落盘）
    snapshot = new Map()
  }
  install()
}

/** 替换 `window.localStorage`（失败则退回"只换这几个调用点"的降级路径——目前无，记日志） */
function install(): void {
  if (installed) return
  realLocalStorage = window.localStorage
  const real = realLocalStorage
  const bridge = hostBridge()

  const store: Storage = {
    get length(): number {
      return snapshot.size
    },
    key(i: number): string | null {
      return [...snapshot.keys()][i] ?? null
    },
    getItem(k: string): string | null {
      if (k.startsWith(PREFIX)) return snapshot.has(k) ? (snapshot.get(k) as string) : null
      return real.getItem(k)
    },
    setItem(k: string, v: string): void {
      const value = String(v)
      // 一律先写真正的 localStorage（同会话更快；桥不可用时还能兜一层）
      try {
        real.setItem(k, value)
      } catch {
        /* 配额/隐私模式等：忽略，以桥为准 */
      }
      if (!k.startsWith(PREFIX)) return
      snapshot.set(k, value)
      bridge?.kvSet(k, value)
    },
    removeItem(k: string): void {
      try {
        real.removeItem(k)
      } catch {
        /* 忽略 */
      }
      if (!k.startsWith(PREFIX)) return
      snapshot.delete(k)
      bridge?.kvRemove(k)
    },
    clear(): void {
      // 只清本项目的命名空间：嵌入版没有"清空整个站点存储"的需求，越界清理风险更大
      for (const k of [...snapshot.keys()]) {
        snapshot.delete(k)
        bridge?.kvRemove(k)
      }
    },
  }

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => store,
    })
    installed = true
    console.info(`[iJipu] 嵌入版存储已接到宿主（预载 ${snapshot.size} 个键）`)
  } catch (e) {
    console.warn('[iJipu] 无法替换 localStorage（设置将只在本会话内保留）', e)
  }
}

/** 当前快照（排错用） */
export function embedStorageSnapshot(): Record<string, string> {
  return Object.fromEntries(snapshot)
}
