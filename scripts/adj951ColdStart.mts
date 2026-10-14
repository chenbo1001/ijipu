/**
 * scripts/adj951ColdStart.mts — adj951 **冷启动端到端夹具**（由 `scripts/smoke.mts` 起一个独立进程跑）
 *
 * 复现用户实报：「ob 第一次打开嵌入版 iJipu，点库里的 .jps 打不开，提示『打开新工作区』；
 * 关掉 ob 再打开就正常」。上一轮（adj943 排查）已定位到 `docStore.ts:1604`：
 *
 *   · **模块求值期那次**：`docStore` 模块求值时 `void getWorkspace()`（先发起、后完成）；
 *   · **嵌入版分支那次**：`main.tsx:126` 的 `await getWorkspace()` + `setWorkspace(vault 记录)`（后发起、先完成）。
 *
 * 修复前 `getWorkspace()` 在 `loaded === false` 时各自 `await loadWorkspace()` 一次 ⇒ 两次并发读库；
 * 后完成的那次用**它读到的旧值**（新电脑上是 null）覆写 `cached` ⇒ 宿主推来的 `.jps` 打不开。
 *
 * 本夹具把这条时序**在真实模块上**跑一遍（只有 IndexedDB / 宿主桥 / localStorage / 时钟是桩），
 * 最后打一行 `ADJ951_JSON {...}` 供人读或供 smoke 断言。
 *
 * **为什么必须是独立进程**：`getWorkspace()` 的"首次冷启动"只发生一次（`loaded` 变真之后就没有
 * 加载了），而 smoke 主进程早就 import 过 `docStore` ⇒ 只有另起一个进程才能拿到"首次"那个状态。
 *
 * ⚠ 顺序必须照 `main.tsx` 的真实启动顺序：先 `initHostBridge()`，再求值 store 模块。
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const g = globalThis as unknown as Record<string, any>

/** 宿主（Obsidian 文库）里那份 `.jps` */
const HOST_CODE = 'V: 1.0\nB: 花\nD: C\nP: 4/4\nQ: 1 2 3 4 |\n'
/** 用户在文件列表里点的那份谱（工作区相对路径） */
const FILE_SEGS = ['花.jps']

// ── 1) localStorage 桩（docStore 模块求值要读草稿名/草稿） ──
const kv: Record<string, string> = { 'ijipu.draftName': '花', 'ijipu.draft': HOST_CODE }
g.localStorage = {
  getItem: (k: string) => (k in kv ? kv[k] : null),
  setItem: (k: string, v: string) => {
    kv[k] = String(v)
  },
  removeItem: (k: string) => {
    delete kv[k]
  },
  get length() {
    return Object.keys(kv).length
  },
  key: (i: number) => Object.keys(kv)[i] ?? null,
}

// ── 2) IndexedDB 桩：**第 1 次读 'workspace' 慢、第 2 次快**（正是修复前那种"先发起后完成"） ──
let wsReadCount = 0
let workspaceRow: unknown = null // 换了一台电脑：库里还没有工作区
const WS_READ_DELAYS = [80, 0]

function makeRequest(result: unknown, delay: number) {
  const req: any = { result: undefined, onsuccess: null, onerror: null }
  setTimeout(() => {
    req.result = result
    req.onsuccess?.()
  }, delay)
  return req
}

function makeDb() {
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: (_store: string, mode: string) => {
      const tx: any = { oncomplete: null, onerror: null, error: null }
      tx.objectStore = () => ({
        get: (key: string) => {
          if (key !== 'workspace') return makeRequest(undefined, 0)
          const delay = WS_READ_DELAYS[Math.min(wsReadCount, WS_READ_DELAYS.length - 1)]
          wsReadCount++
          return makeRequest(workspaceRow, delay)
        },
        put: (val: unknown, key: string) => {
          if (key === 'workspace') workspaceRow = val
          if (mode === 'readwrite') setTimeout(() => tx.oncomplete?.(), 0)
        },
      })
      return tx
    },
  }
}

g.indexedDB = {
  open: (name?: string) => {
    // 旧库 `jianpuscript`（改名迁移用）：当作"不存在"（新电脑上本来就没有）
    const old = name === 'jianpuscript'
    const req: any = { result: old ? undefined : makeDb() }
    setTimeout(() => {
      if (old) req.onerror?.()
      else {
        req.onupgradeneeded?.()
        req.onsuccess?.()
      }
    }, 0)
    return req
  },
  deleteDatabase: () => {
    const req: any = { onsuccess: null, onerror: null, onblocked: null }
    setTimeout(() => req.onsuccess?.(), 0)
    return req
  },
}

// ── 3) window + **假宿主**（嵌入版桥：回 welcome、答 read/exists/list） ──
let dispatchHostMessage: ((ev: any) => void) | null = null
const hostParent: any = {
  postMessage: (msg: any) => {
    if (!msg || msg.ch !== 'ijipu') return
    if (msg.type === 'hello') {
      setTimeout(
        () =>
          dispatchHostMessage?.({
            data: {
              ch: 'ijipu',
              type: 'welcome',
              vaultName: '测试文库',
              theme: 'dark',
              followTheme: true,
              root: '',
              capabilities: { write: true, rename: true, remove: true, trash: true },
            },
            source: hostParent,
          }),
        0,
      )
      return
    }
    if (typeof msg.id === 'number') {
      const result =
        msg.op === 'read'
          ? { text: HOST_CODE }
          : msg.op === 'exists'
            ? { exists: true }
            : msg.op === 'list'
              ? { dirs: [], files: [] }
              : {}
      setTimeout(() => dispatchHostMessage?.({ data: { ch: 'ijipu', id: msg.id, ok: true, result }, source: hostParent }), 0)
    }
  },
}
const win: any = {
  parent: hostParent,
  location: { pathname: '/adj951token/' },
  addEventListener: (t: string, fn: any) => {
    if (t === 'message') dispatchHostMessage = fn
  },
  removeEventListener: () => undefined,
  setTimeout,
  clearTimeout,
  innerWidth: 1440,
  matchMedia: () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }),
}
g.window = win

// ── 4) 按 main.tsx 的真实顺序跑：桥先就绪 → 求值 store 模块（①） → 嵌入版分支（②） ──
//    ⚠ 顶层 await 不能用在 CJS 产物里（rolldown 限制）⇒ 包一层 main()
async function main(): Promise<void> {
  const { initHostBridge } = await import('../src/store/hostBridge')
  const bridge = await initHostBridge()
  if (!bridge) throw new Error('假宿主握手失败（夹具自身问题）')

  const { useDocStore } = await import('../src/store/docStore') // 模块求值 ⇒ ① `void getWorkspace()`
  const { useUiStore } = await import('../src/store/uiStore')
  const wsMod = await import('../src/store/workspace')

  const rec = wsMod.makeVaultWorkspaceRecord(bridge.welcome.vaultName, bridge.welcome.root)
  const cur = await wsMod.getWorkspace() // ② main.tsx:126
  const didSetVault = !(cur && wsMod.isVaultWorkspace(cur))
  if (didSetVault) await wsMod.setWorkspace(rec) // ② main.tsx:127

  await sleep(200) // 等"先发起、后完成"的那次读库落地（修复前它在这里把缓存覆写回 null）
  const wsAfterRace = await wsMod.getWorkspace()

  // 宿主推 `.jps`：main.tsx 的 openFile 处理器最终就是调这一句
  const opened = await useDocStore.getState().openWorkspaceFile(FILE_SEGS)
  const notice = useUiStore.getState().notice
  const fileName = useDocStore.getState().fileName

  // 负对照：把缓存落到"修复前那个终态"（晚到者覆写后的 null）⇒ 同一个 openWorkspaceFile 必须判红
  await wsMod.setWorkspace(null)
  const wsAtLegacyState = await wsMod.getWorkspace()
  const openedAtLegacyState = await useDocStore.getState().openWorkspaceFile(FILE_SEGS)
  const noticeAtLegacyState = useUiStore.getState().notice

  console.log(
    'ADJ951_JSON ' +
      JSON.stringify({
        loadReads: wsReadCount,
        didSetVault,
        wsAfterRaceName: wsAfterRace?.name ?? null,
        opened,
        fileName,
        notice: notice ? { kind: notice.kind, text: notice.text } : null,
        wsAtLegacyState: wsAtLegacyState?.name ?? null,
        openedAtLegacyState,
        noticeAtLegacyState: noticeAtLegacyState ? { kind: noticeAtLegacyState.kind, text: noticeAtLegacyState.text } : null,
      }),
  )
}

void main().catch((e) => {
  console.error('ADJ951_FIXTURE_ERROR', e)
  process.exitCode = 1
})
