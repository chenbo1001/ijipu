/**
 * store/externalChange.ts — **"文件内容被别处改了没有"的判据与基准**（adj927）
 *
 * ## 它解决什么（用户报的问题）
 *
 * 嵌入版（Obsidian iframe 里）是**随输随存**：每次编辑 400ms 后写回文库里的 `.jps`
 * （见 `docStore.ts` 的 `scheduleEmbedAutosave`），而这一次写盘也会让 Obsidian 触发 `modify`
 * ⇒ 插件把 `fileChanged` 推回来（`obsidian-ijipu/src/main.ts:766`）。**这是我们自己写的**，
 * 不该打扰用户。
 *
 * 旧写法（`main.tsx` 的 `fileChanged`）拿"磁盘内容 vs **当前编辑器缓冲区**"比
 * （`disk === st.code`）。可缓冲区**每敲一个字都在变**，而宿主推来的事件不是零延迟——
 * 事件一到，"当前缓冲区"早就不是我们刚写下去的那份了 ⇒ **假提示**（用户报的"经常提示外部变更"）。
 *
 * ## 新口径（用户拍板：从"时间戳不同就提示"改成"内容真的变了才提示"）
 *
 * 参照物换成**基准**（`FileBaseline`）：我们最后一次**写出去**或**读进来**的那份内容指纹
 * （外加当时的 mtime）。判定分两段：
 *  ① **快筛**：基准 mtime 与实际 mtime 都知道且一模一样 ⇒ 文件根本没被写过 ⇒ 判"没变"，**不读文件**；
 *  ② **决策**：mtime 不同（或拿不到 mtime）⇒ 读一次内容比指纹 ⇒ **指纹一致 = 没变**（静默刷新基准，
 *     不提示）；**指纹不同 = 真外部改动**（Obsidian 里编辑 / Sync 同步进来）⇒ 提示。
 * 写盘成功后**立刻**把基准刷成"刚写下去的内容"（③），于是"自己随输随存"永远落在"指纹一致"那一支。
 *
 * ⚠ **嵌入版目前拿不到 mtime**：宿主推 `fileChanged` 时只带 `path`
 * （`hostBridge.ts` 的 `HostEvents.fileChanged`），插件侧那条链路本次不改 ⇒ 实际走的是第②段
 * （每次事件读一次内容，本地回环、毫秒级；用户已确认"谱子短，时间可以接受"）。
 * 第①段快筛的代码与断言都在（`probeExternalChange` 的 `mtimeOf` 就是那个插口），
 * 将来宿主把 mtime 一起推来即可自动生效——**别把快筛删掉**。
 */
import { contentFingerprint } from '../diff/textDiff'

/** 基准：我们最后一次"读进来 / 写出去"这个文件时的内容指纹与当时的 mtime */
export interface FileBaseline {
  /** 工作区身份 + 相对路径（换文件即失效） */
  key: string
  /** 归一化后的内容指纹（见 `contentFingerprint`） */
  fingerprint: string
  /** 当时的文件 mtime；拿不到就是 `null`（嵌入版） */
  mtime: number | null
}

/** 基准的键：工作区 + 相对路径（两样都不同才算"另一个文件"） */
export function baselineKeyOf(wsId: string, segs: readonly string[]): string {
  return `${wsId}\u0000${segs.join('/')}`
}

/** 会话级基准（L3：内存，重开即重建，不持久化——持久化反而会把过期基准当准） */
let baseline: FileBaseline | null = null

/**
 * 记下基准（**自己写完立刻刷**，见 `docStore.ts` 的三处写盘成功点与 `openWorkspaceFile`）。
 * `mtime` 拿不到就传 `null`（嵌入版宿主不回传）。
 */
export function setBaseline(key: string, text: string, mtime: number | null = null): void {
  baseline = { key, fingerprint: contentFingerprint(text), mtime }
}

/** 当前基准（排错/断言用；换绑定时不清，靠 `key` 比对失效） */
export function getBaseline(): FileBaseline | null {
  return baseline
}

/** 清掉基准（例如绑定的文件被删除/移走） */
export function clearBaseline(): void {
  baseline = null
}

/** 判据的输入（**纯数据**，无 IO ⇒ 可以在 Node 里直接断言） */
export interface ChangeProbe {
  /** 基准记下的 mtime；没有就是 `null` */
  baselineMtime: number | null
  /** 文件现在的 mtime；拿不到就是 `null` */
  actualMtime: number | null
  /** 基准内容指纹 */
  baselineFingerprint: string
  /** 文件现在的内容指纹；**还没读过内容时为 `null`** */
  actualFingerprint: string | null
}

/**
 * 判定结果：
 *  · `unchanged` —— 内容没变（快筛过了，或指纹一致）⇒ **不提示**（必要时静默刷新基准）；
 *  · `need-read` —— 还定不了，**必须读一次内容**（第②段）；
 *  · `external`  —— 内容真的变了 ⇒ **提示**（Obsidian 里编辑 / Sync 同步都要提示）。
 */
export type ChangeVerdict = 'unchanged' | 'need-read' | 'external'

/**
 * **要不要提示**的纯判据（本模块的核心；正负对照共用它，不许各写一套）。
 *
 * 两段式的顺序是刻意的：先看 mtime（最便宜），再看内容（较贵但准）。
 * 第①段成立的前提是"mtime 一模一样 ⇒ 文件确实没被写过"——这是用户拍板的口径
 * （"mtime 一模一样 ⇒ 直接判没变"）；要防"改写却保留 mtime"的极端写法，
 * 就别把 `actualMtime` 传进来（传 `null` ⇒ 直接走内容判据）。
 */
export function probeFileChange(p: ChangeProbe): ChangeVerdict {
  // ① 快筛：两边 mtime 都知道且一模一样 ⇒ 文件没被写过，内容必然没变（**不读文件**）
  if (p.baselineMtime !== null && p.actualMtime !== null && p.baselineMtime === p.actualMtime) return 'unchanged'
  // ② 还没读过内容 ⇒ 先读一次再定（**不许**在这里直接当外部改动弹提示）
  if (p.actualFingerprint === null) return 'need-read'
  // ③ 指纹一致 ⇒ 内容没变（可能只是被 touch、或 Sync 换了换行符/行尾空白）⇒ 静默
  if (p.actualFingerprint === p.baselineFingerprint) return 'unchanged'
  // ④ 内容真的不一样 ⇒ 提示（真外部改动必须仍然提示）
  return 'external'
}

/** 编排用的 IO（注入 ⇒ "mtime 相同就不读文件"这条性能口径可以在 Node 里断言） */
export interface ExternalChangeIO {
  /** 基准键（`baselineKeyOf`） */
  key: string
  /** 没有基准时的兜底参照：事件那一刻编辑器里的内容（= 旧口径，只在首次/换文件后才用得上） */
  fallbackText: string
  /** 取文件当前 mtime；**拿不到就给 `null`**（嵌入版宿主不回传 mtime） */
  mtimeOf: (() => Promise<number | null>) | null
  /** 读一次文件内容（**只在快筛不成立时才被调用**） */
  readText: () => Promise<string>
  /** 覆盖基准（测试/排错用；不传就用会话里那份） */
  baseline?: FileBaseline | null
}

/** 编排结果 */
export type ExternalChangeResult =
  | { kind: 'unchanged'; /** 是否读了内容（`false` = 走了 mtime 快筛） */ read: boolean }
  | { kind: 'external'; /** 文件现在的**原始文本**（未归一化；差异框与「载入外部」都用它） */ externalText: string }

/**
 * 两段式编排：先快筛，必要时读一次内容比指纹；内容一致就**静默刷新基准**（指纹 + mtime），
 * 内容不同就返回 `external`（**不刷新基准**——用户选"保留本地"之后再收到同一次外部改动，
 * 仍然应该提示，直到他自己写回去或选择载入）。
 */
export async function probeExternalChange(io: ExternalChangeIO): Promise<ExternalChangeResult> {
  const cur = io.baseline !== undefined ? io.baseline : baseline
  // 换文件 / 首次没有基准 ⇒ 用"编辑器里的内容"当临时基准（旧口径兜底），mtime 记 null
  const base: FileBaseline =
    cur && cur.key === io.key ? cur : { key: io.key, fingerprint: contentFingerprint(io.fallbackText), mtime: null }
  let actualMtime: number | null = null
  if (io.mtimeOf) {
    try {
      actualMtime = await io.mtimeOf()
    } catch {
      actualMtime = null // 取不到 mtime 不影响正确性：交给下面第②段
    }
  }
  const first = probeFileChange({
    baselineMtime: base.mtime,
    actualMtime,
    baselineFingerprint: base.fingerprint,
    actualFingerprint: null,
  })
  if (first === 'unchanged') return { kind: 'unchanged', read: false }

  const text = await io.readText()
  const fingerprint = contentFingerprint(text)
  const second = probeFileChange({
    baselineMtime: base.mtime,
    actualMtime,
    baselineFingerprint: base.fingerprint,
    actualFingerprint: fingerprint,
  })
  if (second === 'external') return { kind: 'external', externalText: text }
  // 内容没变 ⇒ 静默刷新基准（mtime 一起刷，下次事件就能走快筛）
  baseline = { key: io.key, fingerprint, mtime: actualMtime }
  return { kind: 'unchanged', read: true }
}
