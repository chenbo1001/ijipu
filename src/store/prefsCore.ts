/**
 * store/prefsCore.ts — 本机配置的**纯逻辑**（adj1085）
 *
 * 为什么单独一层：`prefs.ts` 要碰 Tauri 与 `window`，而"哪些键归我们管、`Storage` 门面怎么代理"
 * 是可以在 Node 里直接断言的纯逻辑。`npm run smoke` 的 CLI 断言引这里（不碰 DOM/Tauri）。
 *
 * 语义与 `localStorage` **完全一致**（同步、字符串进出）；只有一点不同：
 * `ijipu.` 前缀的键由我们的**快照**说了算，其余键原样交给真正的 `localStorage`。
 */
export const PREFS_PREFIX = 'ijipu.'

/** 我们接管的键在内存里的样子（值一律字符串，与 `localStorage` 同口径） */
export type PrefsSnapshot = Map<string, string>

/**
 * 全部可见的键：真实存储里的键 + 快照里新增的键（去重）。
 *
 * 为什么要合并而不是只回快照：`localStorageMigration` 之类的旧代码会 `for (... localStorage.length)`
 * 遍历；只回快照会让真实存储里尚未迁移的键（旧前缀）直接消失。
 */
export function mergedKeys(real: Storage, snapshot: PrefsSnapshot): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < real.length; i += 1) {
    const k = real.key(i)
    if (k !== null && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  for (const k of snapshot.keys()) {
    if (!seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return out
}

/**
 * 造一个 `Storage` 门面（替换 `window.localStorage` 用）。
 *
 * @param real    真正的 localStorage（非 `ijipu.` 键原样转发）
 * @param snapshot 本机配置的内存快照（读写都走它）
 * @param changed  快照变化时调用（调用方据此防抖落盘）
 */
export function createPrefsFacade(
  real: Storage,
  snapshot: PrefsSnapshot,
  changed: () => void,
): Storage {
  return {
    get length(): number {
      return mergedKeys(real, snapshot).length
    },
    key(index: number): string | null {
      return mergedKeys(real, snapshot)[index] ?? null
    },
    getItem(key: string): string | null {
      if (!key.startsWith(PREFS_PREFIX)) return real.getItem(key)
      return snapshot.has(key) ? (snapshot.get(key) as string) : null
    },
    setItem(key: string, value: string): void {
      const s = String(value)
      if (!key.startsWith(PREFS_PREFIX)) {
        real.setItem(key, s)
        return
      }
      // 值没变就不触发落盘（启动时 store 会回写一遍默认值，不该因此写文件）
      if (snapshot.get(key) === s) return
      snapshot.set(key, s)
      changed()
    },
    removeItem(key: string): void {
      if (!key.startsWith(PREFS_PREFIX)) {
        real.removeItem(key)
        return
      }
      if (snapshot.delete(key)) changed()
    },
    clear(): void {
      // 只清本项目命名空间：非 `ijipu.` 的键不归我们管（与插件版同一口径）
      if (snapshot.size === 0) return
      snapshot.clear()
      changed()
    },
  }
}

/** 把真 `localStorage` 里现有的 `ijipu.*` 抄进快照（首次迁移用；不改动源） */
export function importLegacyPrefs(real: Storage): PrefsSnapshot {
  const out: PrefsSnapshot = new Map()
  for (let i = 0; i < real.length; i += 1) {
    const k = real.key(i)
    if (k === null || !k.startsWith(PREFS_PREFIX)) continue
    const v = real.getItem(k)
    if (v !== null) out.set(k, v)
  }
  return out
}

/** 快照 → 可分发的普通对象（落盘用） */
export function prefsValuesOf(snapshot: PrefsSnapshot): Record<string, string> {
  return Object.fromEntries(snapshot)
}
