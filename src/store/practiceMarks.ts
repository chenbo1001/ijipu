/**
 * store/practiceMarks.ts — **试听练习段**（一段音符的起止标记 + 循环）
 *
 * ## 为什么要有它（用户 2026-10-18 需求）
 *
 * 「在试唱演奏练习时，我们经常针对一小段反复练，这在试听时，就需要标注出反复练习段的起止点，
 *   然后重复试唱演奏」⇒ 试听对话框要有"选段 + 起止标记 + 循环"的能力。
 *
 * ## 三条口径（用户逐条给出）
 *
 * · **按文档生效**：标记「针对做标记的 `.jps` 文件 / `.jps` 代码块有效」⇒ 存 **L1 本机缓存**，
 *   键里带文档身份（工作区绑定 / 原生路径 / 文件名三者之一，见 `docKeyOf`）；
 *   **不写进谱面**（不进 `# jps-config`：它不是"谱长什么样"，而是"我怎么练"）。
 * · **列表第一项恒为「无」**：等于"演奏全曲"，**不可删除**；其余用户标记可删。
 * · **允许跨行**：起止音符可以在不同行（甚至不同页）——所以几何按**行**切段（见 `markBandsOf`），
 *   一行一段带/线。
 *
 * ## 纯函数 + 窄存储接口
 *
 * 本模块只有两种东西：**纯数据变换**（可 Node 断言）与 **localStorage 读写**（try/catch 兜底）。
 * UI 与播放都不在这里。
 */

/** 一个"练习段"：两个音符 id（引擎的 `page_voice_group_index` 串）之间的一段 */
export interface PracticeMark {
  /** 唯一 id（本机生成；下拉列表用它做 key） */
  id: string
  /** 显示名（默认「段 N」；用户可改名——本版先固定生成，保留字段） */
  name: string
  /** 起始音符 id */
  startId: string
  /** 结束音符 id（与 `startId` 相同 = 只有一个音） */
  endId: string
}

/** 存标记的键前缀（`ijipu.` 前缀 + 文档身份） */
const KEY_PREFIX = 'ijipu.practiceMarks.'

/**
 * 文档身份：**同一份谱**在三条来源里取一个（三者互斥，见 `docStore` 的说明）。
 *
 * · 工作区文件 ⇒ `ws:<工作区 id>/<相对段>`（换目录/换名都能分开）
 * · 原生路径打开 ⇒ `native:<绝对路径>`
 * · 其它（网页里的句柄文件 / 未保存草稿）⇒ `name:<文件名>`
 *
 * ⚠ 只用文件名时，两份同名但内容不同的谱会共用标记 —— 这是已知取舍：
 * 内容随每次编辑变，拿内容哈希当键会让"改一个字标记就丢"，那更糟。
 */
export function docKeyOf(src: {
  fileName: string
  binding?: { wsId: string; segs: readonly string[] } | null
  nativePath?: string | null
}): string {
  if (src.binding && src.binding.segs.length > 0) return `ws:${src.binding.wsId}/${src.binding.segs.join('/')}`
  if (src.nativePath) return `native:${src.nativePath}`
  return `name:${src.fileName}`
}

const storageKeyOf = (docKey: string): string => `${KEY_PREFIX}${docKey}`

/** 读该文档的标记列表（损坏/缺失 → 空数组，绝不抛） */
export function loadMarks(docKey: string): PracticeMark[] {
  return parseMarks(rawOf(docKey))
}

function rawOf(docKey: string): string | null {
  try {
    return localStorage.getItem(storageKeyOf(docKey))
  } catch {
    return null
  }
}

/** **纯函数**：把存储里的 JSON 解析成标记列表（逐项校验，坏项丢弃） */
export function parseMarks(raw: string | null): PracticeMark[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: PracticeMark[] = []
    for (const v of arr) {
      if (!v || typeof v !== 'object') continue
      const o = v as Partial<PracticeMark>
      if (typeof o.startId !== 'string' || typeof o.endId !== 'string') continue
      if (o.startId === '' || o.endId === '') continue
      out.push({
        id: typeof o.id === 'string' && o.id !== '' ? o.id : nextMarkId(out.length + 1),
        name: typeof o.name === 'string' && o.name !== '' ? o.name : `段 ${out.length + 1}`,
        startId: o.startId,
        endId: o.endId,
      })
    }
    return out
  } catch {
    return []
  }
}

/** 写该文档的标记列表（空数组 ⇒ 删键；存储不可用时静默） */
export function saveMarks(docKey: string, marks: readonly PracticeMark[]): void {
  try {
    if (marks.length === 0) localStorage.removeItem(storageKeyOf(docKey))
    else localStorage.setItem(storageKeyOf(docKey), JSON.stringify(marks))
  } catch {
    /* 忽略 */
  }
}

/** 本机生成标记 id（时间戳 + 计数，够用且不引入依赖） */
export function nextMarkId(seq = 1): string {
  return `m${Date.now().toString(36)}${seq.toString(36)}`
}

/** 下拉列表里「无」那一项的取值（不在标记数组里，**不可删除**） */
export const PRACTICE_MARK_NONE = ''

/**
 * 给新标记起个默认名：`段 N`（N = 现有条数 + 1；重名不追究——列表里还有 id 区分）。
 */
export function defaultMarkName(existing: readonly PracticeMark[]): string {
  return `段 ${existing.length + 1}`
}

/** 一行上的标记带（预览层画"底色/底线"用；一行一段，跨行就给多段） */
export interface MarkBand {
  /** 这一行（页面内的行号，从 0 起——与 `page.rows` 一致） */
  row: number
  /** 左缘（该行里第一个被标记音符的 x） */
  x0: number
  /** 右缘（该行里最后一个被标记音符的 `rightX`） */
  x1: number
  /** 该行的音符基线 y（画在它下方一点） */
  y: number
}

/** 音符 id 的末段（音符序号）；解析不出来给 null */
export function noteIndexInIdOf(id: string): number | null {
  const m = /^(\d+)_(\d+)_(\d+)_(\d+)$/.exec(id)
  return m ? Number(m[4]) : null
}

/**
 * **纯函数**：算出某一段标记在**某一页**上的若干"带"。
 *
 * 为什么要按行切：跨行（甚至跨页）标记在视觉上是**多段**——每行各画一段带/线，
 * 而不是一条横穿页面的斜线（与连音线的"跨行两半"同一思路）。
 *
 * @param notes 该页的音符（`page.notes`，已是按 x 递增的放置结果）
 * @param startId/endId 起止音符 id（`page_voice_group_index` 串）
 * @param rowYOf 取某个音符所在行的基线 y（由调用方给，避免本模块依赖 layout 内部）
 */
export function markBandsOf(
  notes: readonly { id: { index: number }; x: number; rightX: number; y: number }[],
  startId: string,
  endId: string,
  rowYOf: (n: { y: number }) => number = (n) => n.y,
): MarkBand[] {
  const s = noteIndexInIdOf(startId)
  const e = noteIndexInIdOf(endId)
  if (s === null || e === null) return []
  const lo = Math.min(s, e)
  const hi = Math.max(s, e)
  const picked: { x: number; rightX: number; y: number }[] = []
  for (const n of notes) {
    const idx = n.id.index
    if (idx >= lo && idx <= hi) picked.push(n)
  }
  if (picked.length === 0) return []
  // 按行分组（用 rowYOf 的返回值为键；同行的 y 完全相同）
  const byRow = new Map<number, { x0: number; x1: number; y: number }>()
  for (const n of picked) {
    const y = rowYOf(n)
    const cur = byRow.get(y)
    if (!cur) byRow.set(y, { x0: n.x, x1: n.rightX, y })
    else {
      cur.x0 = Math.min(cur.x0, n.x)
      cur.x1 = Math.max(cur.x1, n.rightX)
    }
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, band], i) => ({ row: i, x0: band.x0, x1: band.x1, y }))
}
