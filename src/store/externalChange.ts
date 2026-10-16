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
 *
 * ## adj943（用户实报：弹条说"变了"、差异框说"改动 0 处"）
 *
 * 现象：嵌入版给 `.jps` 输入时弹条出现，点「查看差异」却是「本地 17 行 · 外部 17 行 · 改动 0 处」，
 * 用户再确认"保留本地 / 载入外部"两边内容一模一样。
 *
 * 根因**不是**"弹条那一路没做归一化"——`contentFingerprint` 一直走 `normalizeForDiff`，
 * 纯 CRLF / 行尾空白 / 末尾换行的差异**不会**弹条（临时复现脚本 A 组实测为 `unchanged`）。
 * 真正的问题是**两路的参照物不同**：
 *  · 差异框比的是「**本地缓冲区** vs 文件」（`FileDiffDialog.tsx` 的 `diff.local` / `diff.external`）；
 *  · 弹条比的是「**基准** vs 文件」，而基准只在"写盘**成功结算之后**"才刷新 ⇒
 *    只要"文件已落地、基准还没跟上"，就会出现"文件与本地逐字相同、却仍然弹条"。
 * 可达这条状态的代码路径有两条（都在本仓可见）：
 *  ① **写盘在途**：`docStore.runEmbedAutosave` 是 `await writeWorkspaceText(...)` **之后**才
 *     `setBaseline`，而宿主在 `adapter.write` 落地的那一刻就广播 `fileChanged`
 *     （插件 `src/main.ts` 的 `vault.on('modify')`）⇒ 事件可能先到，读到的是刚写下去的内容；
 *  ② **写盘回读校验不过**：宿主写完还要**逐字节回读**（插件 `src/embed/bridge.ts`），
 *     回读与写入只要有一个字节的差异（换行风格 / 末尾换行这种"归一化看不见"的差异也算），
 *     RPC 就报错 ⇒ 应用侧 `await` 抛 ⇒ `setBaseline` 被跳过，而**文件其实已经写成**。
 *
 * ⇒ 口径（用户拍板）：**归一化后与"我们手里的内容"没有差异，就一律静默刷新基准、永不弹条**。
 * "我们手里的内容"包含三份，任一与文件相同即判 `unchanged`：
 *  ① **基准**（我们最后一次写出去 / 读进来的那份）；
 *  ② **正在写出去的那份**（`markWriteInFlight`，覆盖上面那条"写盘在途"的窗口）；
 *  ③ **本地缓冲区**（`ExternalChangeIO.localText()`，与差异框 `diff.local` 取的是**同一个来源**）。
 * 真外部改动（三份都不一样）**照样弹**——smoke 里单独一条守着，**不许被顺手削弱**。
 * 附带结论：截图那个"弹条 + 改动 0 处"在逻辑上**不可能再出现**（差异框 0 处 = 本地与文件同 ⇒ ③ 命中）。
 */
import { contentFingerprint } from '../diff/textDiff'

/** 基准：我们最后一次"读进来 / 写出去"这个文件时的内容、指纹与当时的 mtime */
export interface FileBaseline {
  /** 工作区身份 + 相对路径（换文件即失效） */
  key: string
  /**
   * adj966f（P2 自动三路合并的**前提**）：基准保留的**原文**。
   *
   * 有它才有"共同祖先"：`diff/merge.ts` 的 `planMerge(base, local, external)` 靠它判
   * 「两边改的是不是同一块」——没有祖先就只能退化成二路逐块采纳（P1）。
   * 内存代价 = 一份谱面文本（可忽略）；`setBaseline` 本来就收到 `text`，此前只是没存。
   */
  text: string
  /** 归一化后的内容指纹（见 `contentFingerprint`） */
  fingerprint: string
  /** 当时的文件 mtime；拿不到就是 `null`（嵌入版） */
  mtime: number | null
}

/** 基准的键：工作区 + 相对路径（两样都不同才算"另一个文件"） */
export function baselineKeyOf(wsId: string, segs: readonly string[]): string {
  return `${wsId}\u0000${segs.join('/')}`
}

/**
 * adj966：**句柄 / 原生路径**这两种"系统文件"绑定的基准键（与上面工作区那条并列）。
 *
 * 键必须"换文件即失效"：句柄用**文件名**（同一次会话里同名 `.jps` 极少冲突，且句柄没有合适的字符串身份），
 * 原生路径用**绝对路径**（唯一、稳定，正是"写回同一个文件"的判据）。
 * 三端统一：桌面原生路径 / 网页与 PWA 的 FSA 句柄 / 宿主（插件）走工作区那条 —— 由各端适配器给出同一个键。
 */
export function bindingKeyOf(binding: { kind: 'handle'; name: string } | { kind: 'native'; path: string }): string {
  return binding.kind === 'handle' ? `handle:${binding.name}` : `native:${binding.path}`
}

/** 会话级基准（L3：内存，重开即重建，不持久化——持久化反而会把过期基准当准） */
let baseline: FileBaseline | null = null

/**
 * 记下基准（**自己写完立刻刷**，见 `docStore.ts` 的三处写盘成功点与 `openWorkspaceFile`）。
 * `mtime` 拿不到就传 `null`（嵌入版宿主不回传）。
 *
 * adj966f：**同时留下原文**（`text`）当"共同祖先"——P2 的三路合并靠它判冲突（见 `FileBaseline.text`）。
 */
export function setBaseline(key: string, text: string, mtime: number | null = null): void {
  baseline = { key, text, fingerprint: contentFingerprint(text), mtime }
  // adj943：基准接管了这一份内容 ⇒ "在途写"不必再单独记着
  inFlight = null
}

/** 当前基准（排错/断言用；换绑定时不清，靠 `key` 比对失效） */
export function getBaseline(): FileBaseline | null {
  return baseline
}

/**
 * adj966f：取"这份绑定的**共同祖先原文**"（键对得上才有）——给三路合并当 `base`。
 *
 * 键对不上就返回 `null`：那说明手里这份基准是**别的文件**的（换文件即失效），
 * 拿它当祖先会合出乱七八糟的结果 ⇒ 宁可退化为二路逐块采纳（P1）。
 */
export function getBaselineText(key: string): string | null {
  return baseline && baseline.key === key ? baseline.text : null
}

/** 清掉基准（例如绑定的文件被删除/移走） */
export function clearBaseline(): void {
  baseline = null
  inFlight = null
}

/**
 * **写盘在途**的那份内容（adj943）：`docStore` 三处写盘点在 `await` **之前**登记它，
 * 写完由 `setBaseline` 接管（`setBaseline` 会顺手清掉它）。
 *
 * 为什么需要：写盘"已经在磁盘上落地"与"应用把基准刷成新内容"之间有窗口
 * （宿主的 `fileChanged` 就在 `adapter.write` 落地时广播），期间推来的事件读到的正是
 * **我们自己刚写下去的那份**——不认它就会被当成外部改动（用户实报的假提示）。
 */
let inFlight: { key: string; fingerprint: string } | null = null

/** 记下"我们马上要写下去的这一份"（内容指纹；写完由 `setBaseline` 覆盖） */
export function markWriteInFlight(key: string, text: string): void {
  inFlight = { key, fingerprint: contentFingerprint(text) }
}

/** 当前在途写（排错/断言用） */
export function getWriteInFlight(): { key: string; fingerprint: string } | null {
  return inFlight
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
  /**
   * adj943：**正在写出去的那份**的内容指纹；没有就是 `null`/省略。
   * 与文件相同 ⇒ 这份就是我们自己写的 ⇒ `unchanged`（写盘在途的窗口，见文件头说明）。
   */
  inFlightFingerprint?: string | null
  /**
   * adj943：**本地缓冲区此刻**的内容指纹（与差异框 `diff.local` 同一个来源）；拿不到就是 `null`/省略。
   * 与文件相同 ⇒ 差异框必然是"改动 0 处" ⇒ 问用户没有意义 ⇒ `unchanged`（静默刷新基准）。
   */
  localFingerprint?: string | null
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
 *
 * adj943："内容没变"的判据**三份任一同即可**（基准 / 在途写 / 本地缓冲区）——
 * 三份都是"我们手里的内容"，与文件没有任何差异时问用户毫无意义（这也是"差异框 0 处
 * 却弹条"那条矛盾的封堵点：差异框比的就是第三份）。
 * ⚠ 判据本体（归一化 + 比较）只有一处实现：`diff/textDiff.ts` 的 `normalizeForDiff` /
 * `contentFingerprint` / `hasContentChange`；本函数只消费它们的指纹，**不许在这里另写一套归一化**。
 */
export function probeFileChange(p: ChangeProbe): ChangeVerdict {
  // ① 快筛：两边 mtime 都知道且一模一样 ⇒ 文件没被写过，内容必然没变（**不读文件**）
  if (p.baselineMtime !== null && p.actualMtime !== null && p.baselineMtime === p.actualMtime) return 'unchanged'
  // ② 还没读过内容 ⇒ 先读一次再定（**不许**在这里直接当外部改动弹提示）
  if (p.actualFingerprint === null) return 'need-read'
  // ③ 指纹一致 ⇒ 内容没变（可能只是被 touch、或 Sync 换了换行符/行尾空白）⇒ 静默
  if (p.actualFingerprint === p.baselineFingerprint) return 'unchanged'
  // ④ adj943：文件正是**我们插在途中写出去的那份**（写盘已落地、基准还没结算）⇒ 静默
  if (p.inFlightFingerprint != null && p.actualFingerprint === p.inFlightFingerprint) return 'unchanged'
  // ⑤ adj943：文件与**本地缓冲区**一样 ⇒ 差异框必然"改动 0 处" ⇒ 不能弹（用户实报矛盾的封堵点）
  if (p.localFingerprint != null && p.actualFingerprint === p.localFingerprint) return 'unchanged'
  // ⑥ 三份都不一样 ⇒ 内容真的不一样 ⇒ 提示（真外部改动必须仍然提示）
  return 'external'
}

/** 编排用的 IO（注入 ⇒ "mtime 相同就不读文件"这条性能口径可以在 Node 里断言） */
export interface ExternalChangeIO {
  /** 基准键（`baselineKeyOf`） */
  key: string
  /**
   * 本地内容（**编辑器缓冲区**）——取的是**与差异框同一个来源**
   * （`main.tsx` 传 `() => useDocStore.getState().code`，差异框的 `diff.localText` 也是它）。
   *
   * 两处用途：① 没有基准时的兜底参照；② adj943 的"文件与本地一样 ⇒ 不弹"（第⑤条）。
   * 用**取值函数**而不是快照：事件与判定之间用户可能还在敲字，判定要用**此刻**的本地内容
   * （差异框点开时也是此刻取）。
   */
  localText: () => string
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
 *
 * adj943：与文件比对的"我们手里的内容"有三份——基准、在途写（`markWriteInFlight`）、
 * 本地缓冲区（`io.localText()`）；三份任一同即判 `unchanged` 并静默刷新基准（见 `probeFileChange`）。
 */
export async function probeExternalChange(io: ExternalChangeIO): Promise<ExternalChangeResult> {
  const cur = io.baseline !== undefined ? io.baseline : baseline
  // 取"此刻的本地内容"一次：既当没有基准时的兜底参照，也当第⑤条的判据（**同一个来源**）
  const localText = io.localText()
  const localFingerprint = contentFingerprint(localText)
  // 换文件 / 首次没有基准 ⇒ 用"本地内容"当临时基准（旧口径兜底），mtime 记 null
  const base: FileBaseline =
    cur && cur.key === io.key ? cur : { key: io.key, text: localText, fingerprint: localFingerprint, mtime: null }
  // 在途写只认同一把键的那份（换文件后不能拿别的文件的内容当"我们写的"）
  const inFlightFingerprint = inFlight && inFlight.key === io.key ? inFlight.fingerprint : null
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
    inFlightFingerprint,
    localFingerprint,
  })
  if (first === 'unchanged') return { kind: 'unchanged', read: false }

  const text = await io.readText()
  const fingerprint = contentFingerprint(text)
  const second = probeFileChange({
    baselineMtime: base.mtime,
    actualMtime,
    baselineFingerprint: base.fingerprint,
    actualFingerprint: fingerprint,
    inFlightFingerprint,
    localFingerprint,
  })
  if (second === 'external') return { kind: 'external', externalText: text }
  // 内容没变 ⇒ 静默刷新基准（mtime 一起刷，下次事件就能走快筛；原文也刷，见 adj966f）
  baseline = { key: io.key, text, fingerprint, mtime: actualMtime }
  inFlight = null
  return { kind: 'unchanged', read: true }
}
