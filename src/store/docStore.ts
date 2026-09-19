/**
 * store/docStore.ts — 文档状态（zustand）
 * 数据流：code → parse（同步）→ parseResult；layout/render 由渲染管线消费。
 */
import './localStorageMigration'
import { create } from 'zustand'
import { parseJps, defaultPageConfig, applyFontOverride, mergeJpsConfig, mergeConfigEdits, writeJpsConfig } from '@ijipu/engine'
import type { PageConfig, ParseResult } from '@ijipu/engine'
import { SAMPLES, defaultSample } from '../samples'
import {
  recordEdit,
  undoHistory,
  redoHistory,
  DEFAULT_HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryState,
} from '../editor/history'
import { saveFileHandle, loadFileHandle } from './fileHandleDb'
import {
  classifySaveError,
  createSavePhaseLog,
  fileBaseName,
  fileInputAccept,
  isCoarsePointerDevice,
  isUserCancel,
  saveTextToHandle,
  shouldUseFileInputPicker,
  type SavePhaseLog,
} from './saveSupport'
import { useUiStore } from './uiStore'
import { loadFontOverride, migrateLegacyEditorPrefs } from './editorPrefs'
import { normalizePastedSource } from './importSource'
// adj538：桌面壳的「外部打开」（双击 .jps）——纯网页下这些函数一律惰性/空转，见该模块注释
import { pickPrimary, writeExternalFile, type ExternalFile } from './externalOpen'
// adj540：工作区目录（Android/移动端"选一个文件夹当工作区"，纯网页，不需要壳）
import {
  createSubdir,
  getWorkspace,
  hasEntry,
  isValidEntryName,
  joinPath,
  moveFile,
  normalizeRelPath,
  readWorkspaceText,
  rememberWorkspacePath,
  removeEmptyDir,
  removeFile,
  renameFile,
  writeWorkspaceText,
} from './workspace'

/** adj200：用户是否已主导过文件状态（新建/打开/保存/另存为）。「启动恢复」异步读 IndexedDB，
 *  必须只在用户还未进行任何文件操作时应用，避免它在用户新建/另存为之后才完成，从而把
 *  fileHandle / fileName 覆盖回旧文件（旧值 A）。 */
let fileStateTouched = false
import { uiCopy, savePhaseCopy, pasteImportCopy, externalOpenCopy, workspaceCopy } from '../brand/copy'

export type ViewType = 'code' | 'split' | 'splitH' | 'splitHE' | 'preview'

interface DocState {
  code: string
  fileName: string
  /** 是否未保存（本地草稿对比） */
  dirty: boolean
  viewType: ViewType
  /** 自动格式化（输入防抖后格式化） */
  autoFormat: boolean
  pageConfig: PageConfig
  parseResult: ParseResult
  /** 编辑器光标（行/列，1-based 行，0-based 列） */
  cursor: { line: number; col: number }
  /** 编辑器选区（0-based，历史记录与恢复用） */
  sel: { start: number; end: number }
  /** 当前高亮音符 id（notepos 契约），编辑器↔谱面联动 */
  activeNoteId: string | null
  /** adj258：播放高亮——同一组多声部同时演奏的音符 id 列表，预览区同时高亮 */
  activeNoteIds: string[]
  /** adj263：播放当前 ms（PlaybackDialog RAF 驱动），PreviewPane 用其渲染平滑移动的整列竖向色框 */
  currentMs: number
  /** adj282：播放轨道（事件 atMs 单调，含反复展开），PreviewPane 跟随色块定位用。
   *  adj299：group 唯一标识曲行（多声部 Q1 与单声部行可共用 voice 号，必须用 group 定位）；
   *  adj427：色块改为**按音色（instrument）着色**——不同音色不同颜色，播放中切换音色能看到变色；
   *  voice 保留用于「主声部保持既有红色」的判定
   *  adj429：`yTopMin` / `yBottomMax` = 色块按曲行几何动态定界的上下绝对 y（多声部/临时段自动避开重叠、压歌词）
   *  adj432：`playVoice` = 段内声部角色（bz upper = 'accomp' / dsb upper = 'main' / dsb lower = 'second'）→ 预览层颜色区分
   *  adj451：`gain` = 该拍段所属事件的**力度倍率**（与音频事件同源，缺省 1）——目前由 adj427 写入
   *  （重叠伴奏/第二声部 0.75），**预留给强弱单（渐强/渐弱）与力度记号**：后续算出逐音力度后，
   *  音频与色块轨道自动同步，无需再改数据结构 */
  playheadTrack: { atMs: number; durationMs: number; pageIndex: number; x: number; y: number; width: number; voice: number; group: number; instrument?: string; yTopMin?: number; yBottomMax?: number; playVoice?: 'accomp' | 'main' | 'second'; gain?: number }[]
  /** adj262：多声部 voiceBlocks（纯曲部 yTop/yBottom/x）——播放时渲染竖向色框覆盖整列 */
  voiceBlocks: { x: number; yTop: number; yBottom: number; pageIndex: number; voices: number[] }[]
  /** adj291：布局后的「全局音符 index → 物理页 page」映射（自动分页一致）——光标联动定位音符 id.page */
  noteIndexToPage: Map<number, number> | null
  /** 编辑器光标跳转请求（点击谱面音符 / 撤销重做恢复选区时触发） */
  cursorJump: { start: number; end: number; nonce: number } | null

  /** 撤销历史（栈顶 = 最近一步） */
  undoStack: HistoryEntry[]
  /** 重做历史 */
  redoStack: HistoryEntry[]
  /** 历史合并时间戳（内部） */
  lastEditAt: number
  /** 历史步数上限（默认 50） */
  historyLimit: number

  setCode: (code: string) => void
  setViewType: (v: ViewType) => void
  setAutoFormat: (b: boolean) => void
  /**
   * 更新页面设置；persist=true 时同时写回源码 # jps-config（谱面级持久化，adj83；默认差量写入）。
   * adj454：`base` = 本次编辑**开始前**的生效配置快照（对话框打开时 / 虚线按下时）——
   * 传了它就只把「用户本次真正改动」的字段写进谱面（本机缓存来源的值不再被固化）；
   * 不传则退回旧行为（写回整份生效配置的差量）。
   */
  setPageConfig: (cfg: PageConfig, persist?: boolean, base?: PageConfig) => void
  setCursor: (line: number, col: number) => void
  setSelection: (start: number, end: number) => void
  setActiveNoteId: (id: string | null) => void
  /** adj258：设置预览区同时高亮的音符 id 列表（多声部同步演奏） */
  setActiveNoteIds: (ids: string[]) => void
  /** adj262：设置多声部 voiceBlocks（layout 后由 PlaybackDialog 写入） */
  setVoiceBlocks: (vbs: { x: number; yTop: number; yBottom: number; pageIndex: number; voices: number[] }[]) => void
  /** adj291：设置布局后的音符 index→页映射（PreviewPane 布局后回填，EditorPane 光标联动用） */
  setNoteIndexToPage: (m: Map<number, number> | null) => void
  /** adj282：设置播放轨道（PlaybackDialog 播放时写入、停止时清空） */
  setPlayheadTrack: (t: { atMs: number; durationMs: number; pageIndex: number; x: number; y: number; width: number; voice: number; group: number }[]) => void
  /** adj263：设置播放当前 ms（RAF 驱动，PreviewPane 渲染平滑色框） */
  setCurrentMs: (ms: number) => void
  jumpCursor: (pos: number, end?: number) => void
  undo: () => void
  redo: () => void
  loadSample: (id: string) => void
  newDoc: () => void
  markSaved: () => void
  /** adj406：粘贴源码导入（返回 false = 内容为空、未替换） */
  importSource: (raw: string) => boolean

  // ---- 文件读写（adj70：Web File System Access API 打开/保存对话框） ----
  /** 当前已打开文件的句柄（null = 未关联磁盘文件） */
  fileHandle: FileSystemFileHandle | null
  /**
   * adj538：当前文档的**外部路径**（双击 `.jps` / 文件关联打开时由桌面壳给出；浏览器里恒为 null）。
   * 它与 `fileHandle` 是同一件事的两种来源，故**互斥**：设了 nativePath 就清掉 fileHandle，反之亦然。
   * 只存内存、不持久化——重启后原文件可能已被移走/改名，静默写回旧路径比重开一次更危险。
   */
  nativePath: string | null
  /**
   * adj540：当前文档在**工作区**里的相对路径（最后一段是文件名，如 `['杂记','小星星.jps']`）。
   *
   * 与 `fileHandle` / `nativePath` 是"同一个文档存在哪"的三种来源，**三者互斥**：设了谁就清掉另两个，
   * 否则「保存」会写错地方（把工作区文档写回上一个外部文件）。
   * 只存内存：工作区**根句柄**持久化在 IndexedDB（`fileHandleDb.saveWorkspace`），路径丢了只是
   * "下次保存要重新选位置"，而写错文件是不可逆的。
   */
  workspacePath: string[] | null
  /**
   * adj540：从工作区打开一个 `.jps`（`path` 含子目录，最后一段是文件名）。
   * 读失败/无工作区时给提示并返回 false。
   */
  openWorkspaceFile: (path: string[]) => Promise<boolean>
  /**
   * adj540：把当前谱**另存到工作区**的指定位置（`path` 最后一段是文件名，缺失的子目录会创建）。
   * 写入后回读校验；成功即把本文档与该路径绑定（后续「保存」写回它）。
   * 若目标位置**已有同名文件且它不是本文档当前绑定的那个** ⇒ 拒绝并提示（不静默覆盖别人的谱）。
   */
  saveToWorkspace: (path: string[]) => Promise<boolean>
  /** adj540：在工作区里新建子目录 */
  createWorkspaceDir: (dirPath: string[], name: string) => Promise<boolean>
  /** adj540：重命名工作区里的 `.jps`（同目录换名；当前文档绑定会跟着改） */
  renameWorkspaceFile: (dirPath: string[], fromName: string, toName: string) => Promise<boolean>
  /** adj540：把 `.jps` 移到另一个目录（当前文档绑定会跟着改） */
  moveWorkspaceFile: (fromSegs: string[], toDirSegs: string[]) => Promise<boolean>
  /** adj540：删除工作区里的 `.jps`（**永久**；若删的是当前文档则解绑并提示） */
  deleteWorkspaceFile: (segs: string[]) => Promise<boolean>
  /** adj540：删除工作区里的目录（**仅当为空**，避免连带删掉用户目录里其它文件） */
  deleteWorkspaceDir: (dirPath: string[], name: string) => Promise<boolean>
  /**
   * adj538：载入桌面壳送来的外部文件（双击打开）。
   * 取第一个载入编辑器；返回是否载入成功（读失败时给提示并返回 false）。
   */
  openExternalFiles: (files: ExternalFile[]) => boolean
  /** 打开文件对话框：读取 .jps 载入；用户取消返回 false */
  openFile: () => Promise<boolean>
  /** 保存：已有句柄直接写入；否则走另存为对话框 */
  saveFile: () => Promise<boolean>
  /** 另存为对话框：选择保存位置与文件名后写入 */
  saveFileAs: () => Promise<boolean>
}

/** 本地草稿（localStorage，自动保存） */
const DRAFT_KEY = 'ijipu.draft'
const DRAFT_NAME_KEY = 'ijipu.draftName'
const PAGE_CONFIG_KEY = 'ijipu.pageConfig'

function loadDraft(): { code: string; name: string } | null {
  try {
    const code = localStorage.getItem(DRAFT_KEY)
    if (code === null) return null
    const name = localStorage.getItem(DRAFT_NAME_KEY) ?? '未命名'
    return { code, name }
  } catch {
    return null
  }
}

/**
 * adj480 一次性迁移：删除旧版的「本机页面设置」缓存层。
 *
 * 背景（用户确认的目标）：`.jps` 应当**自包含**——"我把源码复制给别人，别人看到的效果一样"。
 * 旧版把"本机页面设置"存在 `localStorage`，并套用到**未自带该设置**的谱面；而 `setPageConfig`
 * 无论是否持久化都会把**整份生效配置**写回缓存（对话框实时预览、取消回写快照都算）⇒ 这一层
 * 实际是"上一份谱的整份配置"，于是"你看到的"取决于本机历史，复制给他人必然不一致。
 *
 * 现在生效配置只有两层：**代码默认值 ← 谱面 `# jps-config`**（新建文档从 adj214 起本就不吃缓存，
 * 故去掉这一层几乎没有便利性损失）。这里只做：删键 + 若旧值与默认不同则提示一次
 * （不静默吞掉用户的历史设置而不告知）。
 */
function migrateLegacyPageConfig(): void {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PAGE_CONFIG_KEY)
    if (raw === null) return
    localStorage.removeItem(PAGE_CONFIG_KEY)
  } catch {
    return
  }
  let diffCount = 0
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const def = defaultPageConfig as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(parsed)) {
      if (k in def && JSON.stringify(def[k]) !== JSON.stringify(v)) diffCount++
    }
  } catch {
    /* 坏值：只删键 */
  }
  if (diffCount > 0) {
    useUiStore
      .getState()
      .showNotice(
        `已停用「本机页面设置」缓存（原 ${diffCount} 项非默认值）：版面设置现在只认谱面自带的 # jps-config，源码没写的项按默认值渲染——这样把谱复制给别人显示才一致`,
        'warn',
      )
  }
}

/**
 * 解析**生效配置**（分层见 docs/SETTINGS-AUDIT.md）：
 *   L0 引擎默认 < L2 谱面源码 # jps-config
 * 之后再叠加 L1 的「用我的字体覆盖谱面字体」（默认关，跨机缺字体时用；它**不随谱走**，
 * 会让"我看到的字体"与别人不同，故只作本机回退）。
 *
 * adj480：**不再有"本机页面设置"这一层**——谱面自包含是分享保真的前提（见 migrateLegacyPageConfig）。
 *
 * 顺带做一次性迁移：早期版本把编辑器偏好写进了谱面（`# jps-config` 里的 editorFont/editorFontSize），
 * 首次解析时搬到本机 L1 偏好（仅当本机从未设置过）；此后任何保存都会以差量写入自动清除它们。
 */
function resolveConfig(code: string): PageConfig {
  if (code) {
    migrateLegacyEditorPrefs(code, (p) => {
      const ui = useUiStore.getState()
      if (p.font) ui.setEditorFont(p.font)
      if (typeof p.fontSize === 'number') ui.setEditorFontSize(p.fontSize)
    })
  }
  return applyFontOverride(mergeJpsConfig(code, null), loadFontOverride())
}
migrateLegacyPageConfig()
const draft = loadDraft()

/** 撤销/重做：将历史快照恢复到文档（code/解析/脏标记/选区/光标跳转） */
function restoreEntry(
  entry: HistoryEntry,
  historyNext: HistoryState,
  set: (partial: Partial<DocState>) => void,
  s: DocState,
) {
  const code = entry.code
  const selStart = Math.max(0, Math.min(entry.selStart, code.length))
  const selEnd = Math.max(0, Math.min(entry.selEnd, code.length))
  try {
    localStorage.setItem(DRAFT_KEY, code)
  } catch {
    /* 存储不可用时静默 */
  }
  set({
    code,
    parseResult: parseJps(code),
    // adj454：撤销/重做也必须走 resolveConfig——此前直接用 mergeJpsConfig 少了 L1「字体覆盖」
    // 这一层，开了该开关时撤销一步会让覆盖短暂失效（其它入口都走 resolveConfig）
    pageConfig: resolveConfig(code),
    dirty: true,
    sel: { start: selStart, end: selEnd },
    ...historyNext,
    cursorJump: { start: selStart, end: selEnd, nonce: (s.cursorJump?.nonce ?? 0) + 1 },
  })
}

export const useDocStore = create<DocState>()((set, get) => ({
  code: draft?.code ?? defaultSample().code,
  fileName: draft?.name ?? defaultSample().name,
  dirty: false,
  // adj315：视图记住顶栏上次设置——持久化 localStorage，下次打开恢复上一次的视图
  viewType: (localStorage.getItem('ijipu.viewType') as ViewType) || 'split',
  autoFormat: true,
  // adj83：谱面级设置优先（源码 # jps-config 注释），无则回退公共设置
  pageConfig: resolveConfig(draft?.code ?? defaultSample().code),
  parseResult: parseJps(draft?.code ?? defaultSample().code),
  cursor: { line: 1, col: 0 },
  sel: { start: 0, end: 0 },
  activeNoteId: null,
  activeNoteIds: [],
  currentMs: 0,
  playheadTrack: [],
  voiceBlocks: [],
  noteIndexToPage: null,
  cursorJump: null,
  undoStack: [],
  redoStack: [],
  lastEditAt: 0,
  historyLimit: DEFAULT_HISTORY_LIMIT,

  setCode: (code) => {
    const s = get()
    if (code === s.code) return // 无变化不产生历史
    const current: HistoryEntry = { code: s.code, selStart: s.sel.start, selEnd: s.sel.end }
    const { next } = recordEdit(
      { undoStack: s.undoStack, redoStack: s.redoStack, lastEditAt: s.lastEditAt },
      current,
      Date.now(),
      s.historyLimit,
    )
    try {
      localStorage.setItem(DRAFT_KEY, code)
    } catch {
      /* 存储不可用时静默 */
    }
    // adj83：源码 # 设置变化时同步 pageConfig（谱面级设置优先，无则回退公共）
    set({
      code,
      parseResult: parseJps(code),
      pageConfig: resolveConfig(code),
      dirty: true,
      ...next,
    })
  },
  setViewType: (v) => {
    // adj315：视图持久化——记住顶栏上次设置，重启恢复
    localStorage.setItem('ijipu.viewType', v)
    set({ viewType: v })
  },
  setAutoFormat: (b) => set({ autoFormat: b }),
  setPageConfig: (cfg, persist, base) => {
    // adj480：**不再写本机缓存**。生效配置只有「代码默认 ← 谱面」两层，页面设置属于谱面（L2）：
    //  · 预览态（persist=false）：只更新内存，不落盘（此前会把"当前文档的整份生效配置"写进
    //    localStorage，等于把本机设置变成"上一份谱的配置"，是分享不一致的根源）；
    //  · 持久态（persist=true）：写回源码 # jps-config —— 差量写入（只写与默认不同的字段），
    //    于是"我看到的非默认部分"都在谱面里 ⇒ 文件自包含 ⇒ 复制给别人效果一致。
    // adj454：传了 base（本次编辑开始前的生效配置）时，只把**用户本次改动**并入源码层
    // （mergeConfigEdits）；没传 base 时退回"整份生效配置按差量写"——两者在无缓存层后等价。
    if (persist) {
      const code = get().code
      const newCode = base
        ? writeJpsConfig(code, mergeConfigEdits(code, base, cfg))
        : writeJpsConfig(code, cfg)
      if (newCode !== code) {
        try {
          localStorage.setItem(DRAFT_KEY, newCode)
        } catch {
          /* 存储不可用时静默 */
        }
        set({ code: newCode, pageConfig: cfg, parseResult: parseJps(newCode), dirty: true })
        return
      }
    }
    set({ pageConfig: cfg })
  },
  setCursor: (line, col) => set({ cursor: { line, col } }),
  setSelection: (start, end) => set({ sel: { start, end } }),
  setActiveNoteId: (id) => set({ activeNoteId: id }),
  setActiveNoteIds: (ids) => set({ activeNoteIds: ids }),
  setVoiceBlocks: (vbs) => set({ voiceBlocks: vbs }),
  setNoteIndexToPage: (m) => set({ noteIndexToPage: m }),
  setPlayheadTrack: (t) => set({ playheadTrack: t }),
  setCurrentMs: (ms) => set({ currentMs: ms }),
  jumpCursor: (pos, end) =>
    set((s) => ({
      cursorJump: { start: pos, end: end ?? pos, nonce: (s.cursorJump?.nonce ?? 0) + 1 },
    })),
  undo: () => {
    const s = get()
    const current: HistoryEntry = { code: s.code, selStart: s.sel.start, selEnd: s.sel.end }
    const { next, restored } = undoHistory(
      { undoStack: s.undoStack, redoStack: s.redoStack, lastEditAt: s.lastEditAt },
      current,
    )
    if (restored) restoreEntry(restored, next, set, s)
  },
  redo: () => {
    const s = get()
    const current: HistoryEntry = { code: s.code, selStart: s.sel.start, selEnd: s.sel.end }
    const { next, restored } = redoHistory(
      { undoStack: s.undoStack, redoStack: s.redoStack, lastEditAt: s.lastEditAt },
      current,
    )
    if (restored) restoreEntry(restored, next, set, s)
  },
  loadSample: (id) => {
    const s = SAMPLES.find((x) => x.id === id) ?? defaultSample()
    localStorage.setItem(DRAFT_KEY, s.code)
    localStorage.setItem(DRAFT_NAME_KEY, s.name)
    // adj161：载入示例不是磁盘文件——清除文件句柄，避免误写回旧文件
    void saveFileHandle(null)
    set({
      code: s.code,
      fileName: s.name,
      parseResult: parseJps(s.code),
      pageConfig: resolveConfig(s.code),
      dirty: false,
      fileHandle: null,
      nativePath: null,
      // adj540：三者互斥——与工作区里的任何文件解绑
      workspacePath: null,
      activeNoteId: null,
      activeNoteIds: [],
      playheadTrack: [],
      voiceBlocks: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
  },
  newDoc: () => {
    fileStateTouched = true
    const template = defaultSample().code
    localStorage.setItem(DRAFT_KEY, template)
    localStorage.setItem(DRAFT_NAME_KEY, '未命名')
    // adj161：新建文档不关联磁盘文件——清除句柄
    void saveFileHandle(null)
    // adj214：新建文档强制使用 defaultPageConfig——不再被本机历史设置覆盖
    // （当时的问题是新建谱仍显示旧的本机设置；adj480 更进一步：本机页面设置层已整体取消）
    // 模板无 # jps-config，merge(null) 即纯默认
    set({
      code: template,
      fileName: '未命名',
      parseResult: parseJps(template),
      // adj214：新建文档强制使用 defaultPageConfig（不吃公共设置），仅叠加 L1 字体覆盖
      pageConfig: applyFontOverride(mergeJpsConfig(template, null), loadFontOverride()),
      dirty: false,
      fileHandle: null,
      nativePath: null,
      // adj540：三者互斥——与工作区里的任何文件解绑
      workspacePath: null,
      activeNoteId: null,
      activeNoteIds: [],
      playheadTrack: [],
      voiceBlocks: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
  },
  markSaved: () => set({ dirty: false }),

  /**
   * adj406：粘贴源码导入——不依赖系统文件选择器的兜底入口
   * （手机端网盘/微信里的 .jps 常看不到：选择器只列本机文件，未知扩展还可能被按类型隐藏）。
   * 与「打开文件」的区别：不关联磁盘句柄（保存仍走「导出」），内容按文本清洗后替换当前文档。
   */
  importSource: (raw) => {
    const code = normalizePastedSource(raw)
    if (!code) return false
    fileStateTouched = true
    try {
      localStorage.setItem(DRAFT_KEY, code)
      localStorage.setItem(DRAFT_NAME_KEY, pasteImportCopy.name)
    } catch {
      /* 存储不可用时静默 */
    }
    // adj161：粘贴导入不是磁盘文件——清除句柄，避免误写回旧文件
    void saveFileHandle(null)
    set({
      code,
      fileName: pasteImportCopy.name,
      parseResult: parseJps(code),
      pageConfig: resolveConfig(code),
      dirty: true, // 内容尚未落到任何文件，提醒用户用「导出」保存
      fileHandle: null,
      nativePath: null,
      // adj540：三者互斥——与工作区里的任何文件解绑
      workspacePath: null,
      activeNoteId: null,
      activeNoteIds: [],
      playheadTrack: [],
      voiceBlocks: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
    return true
  },

  // ---- 文件读写（adj70） ----
  fileHandle: null,
  nativePath: null,
  // adj540：工作区相对路径（见类型注释；同样只存内存）
  workspacePath: null,
  /**
   * adj538：桌面壳送来"要打开的文件"（双击 `.jps`）——与"打开对话框"共用同一段装载逻辑，
   * 差别只有两点：① 文本已由 Rust 侧读好；② 记下 `nativePath`（后续 Ctrl+S 写回原文件）。
   */
  openExternalFiles: (files) => {
    const { primary, extraCount } = pickPrimary(files)
    if (!primary) return false
    const ui = useUiStore.getState()
    if (primary.error) {
      // 读失败（权限/文件被移走/不是文本）如实提示，不静默
      ui.showNotice(externalOpenCopy.openFailed(primary.name, primary.error), 'error')
      return false
    }
    fileStateTouched = true
    const name = fileBaseName(primary.name)
    try {
      localStorage.setItem(DRAFT_KEY, primary.code)
      localStorage.setItem(DRAFT_NAME_KEY, name)
    } catch {
      /* 存储不可用时静默 */
    }
    // 与「打开对话框」同款装载：解析 + 页面设置 + 清空历史/联动状态；
    // 数据源是外部路径 ⇒ 清掉 FSA 句柄（两者互斥），避免"保存写到了上一个文件"
    disconnectFileHandle()
    set({
      code: primary.code,
      fileName: name,
      parseResult: parseJps(primary.code),
      pageConfig: resolveConfig(primary.code),
      dirty: false,
      nativePath: primary.path,
      // adj540：外部路径与工作区互斥
      workspacePath: null,
      activeNoteId: null,
      activeNoteIds: [],
      voiceBlocks: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
    ui.showNotice(
      extraCount > 0 ? externalOpenCopy.openedWithExtra(name, extraCount) : externalOpenCopy.opened(name),
      'ok',
    )
    return true
  },
  openFile: async () => {
    fileStateTouched = true
    const picker = (window as any).showOpenFilePicker
    // adj281：非安全上下文（http:// 或 file://）或非 Chromium 内核下无 showOpenFilePicker，
    // 降级用 <input type=file> 读取 .jps 文本——打开本质只读文本，不依赖文件系统 API
    // adj405：**移动端一律走 input 路径**——真机上已安装的 PWA 里 showOpenFilePicker 可能
    // "点了没反应"（浏览器同一地址却正常），且 Android 拿不到可写回句柄（移动端保存走「导出」）。
    if (shouldUseFileInputPicker(isCoarsePointerDevice(), typeof picker === 'function')) return openFileViaInput()
    try {
      const [handle] = await picker({
        types: [{ description: 'iJipu 乐谱', accept: { 'text/plain': ['.jps'] } }],
        multiple: false,
      })
      const file = await handle.getFile()
      const code = await file.text()
      const name = fileBaseName(file.name)
      try {
        localStorage.setItem(DRAFT_KEY, code)
        localStorage.setItem(DRAFT_NAME_KEY, name)
      } catch {
        /* 存储不可用时静默 */
      }
      // adj161：打开的文件成为操作主体，句柄持久化（下次保存直接写回）
      void saveFileHandle(handle)
      // adj212：打开文件时同步 pageConfig——此前漏了 mergeJpsConfig，
      // 其它浏览器打开带 # jps-config 的谱时页面设置仍是打开前的旧值
      set({
        code,
        fileName: name,
        parseResult: parseJps(code),
        pageConfig: resolveConfig(code),
        dirty: false,
        fileHandle: handle,
        // adj538：改用对话框打开 ⇒ 与"外部路径"解绑（两者互斥，否则保存会写回上一个外部文件）
        nativePath: null,
        // adj540：同理与工作区解绑（三者互斥）
        workspacePath: null,
        activeNoteId: null,
        activeNoteIds: [],
        voiceBlocks: [],
        cursorJump: null,
        undoStack: [],
        redoStack: [],
        lastEditAt: 0,
        sel: { start: 0, end: 0 },
      })
      // adj370：打开成功给出明确反馈（含实际文件名与句柄名），避免"打开了没打开"无从判断
      const ui = useUiStore.getState()
      console.info(`[iJipu] 打开文件：name=${name} handle=${handle.name}`)
      ui.showNotice(`${uiCopy.openOkPrefix}${name}.jps`, 'ok')
      return true
    } catch (e) {
      // adj370：打开失败不再静默——此前 catch 直接 return false，用户只看到"没反应"；
      // 用户主动取消（AbortError）仍静默
      if (isUserCancel(e)) return false
      const reason = e instanceof Error ? `${e.name}${e.message ? `: ${e.message}` : ''}` : String(e)
      console.warn('[iJipu] 打开文件失败', e)
      useUiStore.getState().showNotice(`${uiCopy.openFailedPrefix}${reason}`, 'error')
      return false
    }
  },

  // ---- adj540：工作区（Android/移动端的"文件夹当工作区"；含子目录） ----
  openWorkspaceFile: async (path) => {
    fileStateTouched = true
    const ui = useUiStore.getState()
    const segs = normalizeRelPath(path)
    if (segs.length === 0) return false
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    try {
      const code = await readWorkspaceText(ws.handle, segs)
      const name = fileBaseName(segs[segs.length - 1])
      try {
        localStorage.setItem(DRAFT_KEY, code)
        localStorage.setItem(DRAFT_NAME_KEY, name)
      } catch {
        /* 存储不可用时静默 */
      }
      // 数据源是工作区 ⇒ 断开磁盘句柄（三者互斥），避免"保存写到了上一个文件"
      disconnectFileHandle()
      set({
        code,
        fileName: name,
        parseResult: parseJps(code),
        pageConfig: resolveConfig(code),
        dirty: false,
        fileHandle: null,
        nativePath: null,
        workspacePath: segs,
        activeNoteId: null,
        activeNoteIds: [],
        voiceBlocks: [],
        cursorJump: null,
        undoStack: [],
        redoStack: [],
        lastEditAt: 0,
        sel: { start: 0, end: 0 },
      })
      // 记住所在子目录：下次打开对话框直接落回原处（用户要求支持子目录）
      void rememberWorkspacePath(segs.slice(0, -1))
      console.info(`[iJipu] 从工作区打开：${joinPath(segs)}`)
      ui.showNotice(workspaceCopy.opened(joinPath(segs)), 'ok')
      return true
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}${e.message ? `: ${e.message}` : ''}` : String(e)
      console.warn('[iJipu] 从工作区打开失败', e)
      ui.showNotice(workspaceCopy.openFailed(joinPath(segs), reason), 'error')
      return false
    }
  },
  saveToWorkspace: async (path) => {
    fileStateTouched = true
    const ui = useUiStore.getState()
    const segs = normalizeRelPath(path)
    if (segs.length === 0) return false
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    const cancelHint = armSavingHint()
    try {
      const code = get().code
      // 重名保护：目标位置已有同名文件、且**不是本文档当前绑定的那个** ⇒ 拒绝（不静默覆盖别人的谱）
      const cur = get().workspacePath
      const same = !!cur && joinPath(cur) === joinPath(segs)
      if (!same && (await hasEntry(ws.handle, segs.slice(0, -1), segs[segs.length - 1]))) {
        ui.showNotice(workspaceCopy.exists(segs[segs.length - 1]), 'warn')
        return false
      }
      await writeWorkspaceText(ws.handle, segs, code)
      const name = fileBaseName(segs[segs.length - 1])
      set({
        fileName: name,
        fileHandle: null,
        nativePath: null,
        workspacePath: segs,
        // 写入期间用户可能继续输入 ⇒ 内容变了就保留未保存标记（与句柄路径同一口径）
        dirty: get().code !== code,
      })
      void saveFileHandle(null)
      void rememberWorkspacePath(segs.slice(0, -1))
      console.info(`[iJipu] 另存到工作区：${joinPath(segs)}`)
      ui.showNotice(workspaceCopy.saved(joinPath(segs)), 'ok')
      return true
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}${e.message ? `: ${e.message}` : ''}` : String(e)
      console.warn('[iJipu] 另存到工作区失败', e)
      ui.showNotice(workspaceCopy.saveFailed(joinPath(segs), reason), 'error')
      return false
    } finally {
      cancelHint()
    }
  },
  createWorkspaceDir: async (dirPath, name) => {
    const ui = useUiStore.getState()
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    if (!isValidEntryName(name)) {
      ui.showNotice(workspaceCopy.invalidName, 'warn')
      return false
    }
    try {
      await createSubdir(ws.handle, dirPath, name)
      console.info(`[iJipu] 工作区新建目录：${joinPath([...dirPath, name])}`)
      ui.showNotice(workspaceCopy.dirCreated(name), 'ok')
      return true
    } catch (e) {
      console.warn('[iJipu] 新建目录失败', e)
      ui.showNotice(workspaceOpErrorText(name, e), 'error')
      return false
    }
  },
  renameWorkspaceFile: async (dirPath, fromName, toName) => {
    const ui = useUiStore.getState()
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    if (!isValidEntryName(toName)) {
      ui.showNotice(workspaceCopy.invalidName, 'warn')
      return false
    }
    const dir = normalizeRelPath(dirPath)
    const from = [...dir, fromName]
    const to = [...dir, toName]
    try {
      await renameFile(ws.handle, dir, fromName, toName)
      // 正在编辑的就是这个文件 ⇒ 绑定跟着改名（否则「保存」会指向一个已不存在的名字）
      const cur = get().workspacePath
      if (cur && joinPath(cur) === joinPath(from)) set({ workspacePath: to, fileName: fileBaseName(toName) })
      console.info(`[iJipu] 工作区重命名：${joinPath(from)} → ${joinPath(to)}`)
      ui.showNotice(workspaceCopy.renamed(fromName, toName), 'ok')
      return true
    } catch (e) {
      console.warn('[iJipu] 重命名失败', e)
      ui.showNotice(workspaceOpErrorText(toName, e), 'error')
      return false
    }
  },
  moveWorkspaceFile: async (fromSegs, toDirSegs) => {
    const ui = useUiStore.getState()
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    const from = normalizeRelPath(fromSegs)
    const toDir = normalizeRelPath(toDirSegs)
    if (from.length === 0) return false
    const name = from[from.length - 1]
    if (joinPath(from.slice(0, -1)) === joinPath(toDir)) return true // 原地不动
    try {
      await moveFile(ws.handle, from, toDir)
      const cur = get().workspacePath
      if (cur && joinPath(cur) === joinPath(from)) set({ workspacePath: [...toDir, name] })
      console.info(`[iJipu] 工作区移动：${joinPath(from)} → ${joinPath([...toDir, name])}`)
      ui.showNotice(workspaceCopy.moved(name, joinPath(toDir)), 'ok')
      return true
    } catch (e) {
      console.warn('[iJipu] 移动失败', e)
      ui.showNotice(workspaceOpErrorText(name, e), 'error')
      return false
    }
  },
  deleteWorkspaceFile: async (segs) => {
    const ui = useUiStore.getState()
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    const target = normalizeRelPath(segs)
    if (target.length === 0) return false
    const name = target[target.length - 1]
    try {
      await removeFile(ws.handle, target)
      // 正在编辑的就是这个文件 ⇒ 解绑（内容仍留在编辑器里，可用「保存到此处」重新落盘）
      const cur = get().workspacePath
      const unbound = !!cur && joinPath(cur) === joinPath(target)
      if (unbound) {
        set({ workspacePath: null })
        ui.showNotice(workspaceCopy.deletedOpenFile(name), 'warn')
      } else {
        ui.showNotice(workspaceCopy.deleted(name), 'ok')
      }
      console.info(`[iJipu] 工作区删除文件：${joinPath(target)}（${unbound ? '并解绑当前文档' : '非当前文档'}）`)
      return true
    } catch (e) {
      console.warn('[iJipu] 删除文件失败', e)
      ui.showNotice(workspaceOpErrorText(name, e), 'error')
      return false
    }
  },
  deleteWorkspaceDir: async (dirPath, name) => {
    const ui = useUiStore.getState()
    const ws = await getWorkspace()
    if (!ws) {
      ui.showNotice(workspaceCopy.noWorkspace, 'warn')
      return false
    }
    const dir = normalizeRelPath(dirPath)
    try {
      await removeEmptyDir(ws.handle, dir, name)
      // 当前文档正在这个目录里 ⇒ 解绑（目录都没了）
      const cur = get().workspacePath
      const prefix = joinPath([...dir, name])
      if (cur && (joinPath(cur) === prefix || joinPath(cur).startsWith(`${prefix}/`))) {
        set({ workspacePath: null })
        ui.showNotice(workspaceCopy.deletedOpenFile(name), 'warn')
      } else {
        ui.showNotice(workspaceCopy.deleted(name), 'ok')
      }
      console.info(`[iJipu] 工作区删除目录：${prefix}`)
      return true
    } catch (e) {
      console.warn('[iJipu] 删除目录失败', e)
      ui.showNotice(workspaceOpErrorText(name, e), 'error')
      return false
    }
  },
  saveFile: async () => {
    fileStateTouched = true
    // adj363：并发合并——连按两次 Ctrl+S 会同时对同一句柄 createWritable()，
    // 后一次可能 InvalidStateError 失败（间歇性「保存没生效」），此处复用进行中的保存
    if (saveInFlight) return saveInFlight
    const task = doSaveFile()
    saveInFlight = task
    try {
      return await task
    } catch {
      // doSaveFile 内部已归类提示；此处兜底避免未处理 rejection
      useUiStore.getState().showNotice(uiCopy.saveFailed, 'error')
      return false
    } finally {
      saveInFlight = null
    }
  },
  saveFileAs: async () => {
    fileStateTouched = true
    const ui = useUiStore.getState()
    const picker = (window as any).showSaveFilePicker
    if (typeof picker !== 'function') {
      // 当前 WebView/浏览器不支持 File System Access API → 无法保存到磁盘
      ui.showNotice(uiCopy.saveUnsupported, 'error')
      return false
    }
    try {
      // adj357：未命名文件保存/另存时，默认用描述头第一个 B: 标题作为文件名（省得输入）
      const nm = get().fileName
      const isNamed = !!nm && nm !== '未命名'
      const bTitle = get().parseResult.header.titles[0]
      const defaultName = isNamed ? nm : bTitle && bTitle !== '未命名' ? bTitle : '未命名'
      const handle = await picker({
        suggestedName: `${defaultName}.jps`,
        types: [{ description: 'iJipu 乐谱', accept: { 'text/plain': ['.jps'] } }],
      })
      // adj364：最快路径写入（刚选定的句柄权限本就授予；仅权限失败时才申请并重试）
      const code = get().code
      // adj371：文件名乐观更新——选完文件名字就定了，先切到新名（写盘可能要几秒），
      // 未保存标记与句柄仍等写盘成功后才落定；失败回滚。
      const prevName = get().fileName
      const name = fileBaseName(handle.name)
      const optimistic = prevName !== name
      if (optimistic) applyOptimisticName(name)
      // adj365：选完文件后才武装「保存中…」提示（选文件期间提示会误导）
      const t0 = performance.now()
      const cancelHint = armSavingHint()
      const phaseLog = collectSavePhases()
      try {
        await saveTextToHandle(handle, code, { trace: phaseLog.trace })
      } catch (e) {
        if (optimistic) rollbackOptimisticName(prevName)
        throw e
      } finally {
        cancelHint()
      }
      const tStore = performance.now()
      phaseLog.tail('store', performance.now() - tStore)
      void saveFileHandle(handle)
      // adj363：写入期间用户可能继续输入，内容已变则保留未保存标记
      const tUi = performance.now()
      set({ fileHandle: handle, fileName: name, dirty: get().code !== code, nativePath: null, workspacePath: null })
      phaseLog.tail('ui', performance.now() - tUi)
      reportSaved(t0, phaseLog, name)
      return true
    } catch (e) {
      const kind = classifySaveError(e)
      // adj363：只有 AbortError 是「用户取消」（静默）；NotAllowedError 是缺少用户手势/权限，
      // 此前被当成取消静默吞掉 → 按保存毫无反应、文件未变（用户反馈的「保存没生效」）
      if (kind === 'cancel') return false
      ui.showNotice(kind === 'permission' ? uiCopy.saveAsNoGesture : uiCopy.saveAsFailed, 'error')
      return false
    }
  },
}))

// ---- adj363/adj364：保存到磁盘的可靠性补强 ----
// 用户反馈「按保存有时没生效，必须另存为才有效」。根因链条：
//   ① 恢复自 IndexedDB 的句柄重启后写权限失效 → createWritable() 抛 NotAllowedError；
//   ② 旧代码静默回退 saveFileAs()，但 showSaveFilePicker() 必须在**用户手势**内调用，
//      前面的 await 已消耗手势 → 选择器再抛 NotAllowedError；
//   ③ 旧代码把 NotAllowedError 当「用户取消」静默吞掉 → 按保存毫无反应、文件未变。
// 现在：只有 AbortError 算取消，其余失败一律给出可操作提示；权限/文件失效时断开句柄，
// 下次「保存」直接走另存为。
//
// adj364（用户续报「Ctrl+S / 菜单保存响应很慢」）：上一版把「主动查权限 + 写入后回读」放进
// 了每次保存的必经路径，每次都多出 2~3 次文件系统往返（权限为 prompt 时 requestPermission
// 还要等权限提示）→ 保存明显变慢。现改为 **失败才申请权限**：先直接写（一次往返），
// 只有因权限失败才申请权限并重试一次（saveTextToHandle 内部处理），回读校验默认关闭。
// 于是权限正常的保存与旧版一样快，同时保留「不会静默不生效」。

/** 进行中的保存（并发合并用） */
let saveInFlight: Promise<boolean> | null = null

/** adj365：慢保存的即时反馈阈值——超过该毫秒数仍未写完才提示「保存中…」（快保存不闪烁） */
const SAVE_HINT_DELAY_MS = 150
/** adj365：超过该毫秒数视为慢保存——控制台记录耗时，提示里带上实际耗时（便于定位是写盘慢还是反馈慢） */
const SAVE_SLOW_MS = 400
/** adj369：提交（原子替换文件）超过该毫秒数 = 异常——附上「文件被占用」的可操作提示 */
const SAVE_SLOW_COMMIT_MS = 2000

/** adj365：武装「保存中…」提示，返回清理函数（保存结束即撤销未触发的计时器） */
function armSavingHint(): () => void {
  const ui = useUiStore.getState()
  const timer = window.setTimeout(() => ui.showNotice(uiCopy.saving, 'warn'), SAVE_HINT_DELAY_MS)
  return () => window.clearTimeout(timer)
}

/** adj367：阶段耗时收集器（阶段名文案集中在 brand/copy.ts 的 savePhaseCopy） */
function collectSavePhases(): SavePhaseLog {
  return createSavePhaseLog((phase) => savePhaseCopy[phase])
}

/**
 * adj365/adj367/adj369：保存成功提示。
 *  - <400ms：仅「已保存」；
 *  - ≥400ms：给出总耗时 + **最耗时那一段**（如「已保存 · 7.1s（提交文件 7140ms）」），完整阶段明细
 *    进 `console.info`（便于判断延迟出在文件系统哪一步还是主线程）；
 *  - adj369：「提交文件」是瓶颈且 ≥2s 时附一句可操作提示——这一步是**浏览器把临时文件原子替换成目标文件**，
 *    应用代码不参与，常见原因是目标文件被云同步客户端 / 杀毒软件 / 其它程序占用（替换被反复重试）。
 */
function reportSaved(t0: number, log?: SavePhaseLog, savedName?: string): void {
  const ms = Math.round(performance.now() - t0)
  // adj370：提示带上实际写入的文件名，一眼确认"保存到了哪个文件"
  const who = savedName ? `：${savedName}.jps` : ''
  if (ms < SAVE_SLOW_MS) {
    useUiStore.getState().showNotice(`${uiCopy.saveOk}${who}`, 'ok')
    return
  }
  const detail = log?.text() ?? ''
  const worst = log?.worst() ?? null
  const worstSex = worst ? `（${worst.label} ${Math.round(worst.ms)}ms）` : ''
  const commitStuck = worst?.phase === 'commit' && worst.ms >= SAVE_SLOW_COMMIT_MS
  console.info(
    `[iJipu] 保存耗时 ${ms}ms → ${savedName ?? '?'}.jps（${detail || '无阶段明细'} · 收尾 ${Math.max(0, ms - (log?.total() ?? 0))}ms）`,
  )
  // 带排查建议时用 warn（toast 停留 4s，够读完），否则 ok（1.8s）
  useUiStore
    .getState()
    .showNotice(
      `${uiCopy.saveOk}${who} · ${(ms / 1000).toFixed(1)}s${worstSex}${commitStuck ? ` · ${uiCopy.saveSlowCommitHint}` : ''}`,
      commitStuck ? 'warn' : 'ok',
    )
}

/** 「保存」主流程：有可用句柄直接写回；否则走另存为 */
async function doSaveFile(): Promise<boolean> {
  const st = useDocStore.getState()
  // adj538：双击 `.jps` 打开（externalPath 有值）⇒ Ctrl+S **写回原文件**（用户确认的桌面标准行为）。
  // 写入与回读校验都在 Rust 侧（`write_external_file`），与 FSA 路径同口径；失败如实提示、
  // **不自动弹另存为**——外部文件写失败多是"被移走/改名/无权限"，静默换个对话框反而更迷惑，
  // 提示里已写明可改用「另存为」。
  if (st.nativePath) {
    const path = st.nativePath
    const ui = useUiStore.getState()
    const t0 = performance.now()
    const cancelHint = armSavingHint()
    try {
      const code = useDocStore.getState().code
      await writeExternalFile(path, code)
      // 写入期间用户可能继续输入 ⇒ 内容变了就保留未保存标记（与句柄路径同一口径）
      useDocStore.setState({ dirty: useDocStore.getState().code !== code })
      console.info(`[iJipu] 保存到原文件：${path}（${Math.round(performance.now() - t0)}ms）`)
      ui.showNotice(externalOpenCopy.savedToSource(st.fileName), 'ok')
      return true
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn('[iJipu] 保存到原文件失败', e)
      ui.showNotice(externalOpenCopy.saveToSourceFailed(st.fileName, reason), 'error')
      return false
    } finally {
      cancelHint()
    }
  }
  // adj540：工作区文档 ⇒ 写回工作区里的**同一个文件**（含子目录），与桌面 nativePath 同语义。
  // 权限用根目录句柄申请（工作区授权是目录级的），必须在用户手势内完成 ⇒ 放在这里、写入之前。
  if (st.workspacePath && st.workspacePath.length > 0) {
    const wsPath = st.workspacePath
    const ui = useUiStore.getState()
    const t0 = performance.now()
    const cancelHint = armSavingHint()
    try {
      const ws = await getWorkspace()
      if (!ws) {
        ui.showNotice(workspaceCopy.noWorkspace, 'warn')
        return false
      }
      const code = useDocStore.getState().code
      await writeWorkspaceText(ws.handle, wsPath, code)
      useDocStore.setState({ dirty: useDocStore.getState().code !== code })
      console.info(`[iJipu] 保存到工作区：${joinPath(wsPath)}（${Math.round(performance.now() - t0)}ms）`)
      ui.showNotice(workspaceCopy.saved(joinPath(wsPath)), 'ok')
      return true
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      console.warn('[iJipu] 保存到工作区失败', e)
      ui.showNotice(workspaceCopy.saveFailed(joinPath(wsPath), reason), 'error')
      return false
    } finally {
      cancelHint()
    }
  }
  const handle = useDocStore.getState().fileHandle
  if (!handle) return useDocStore.getState().saveFileAs()
  const ui = useUiStore.getState()
  const t0 = performance.now()
  const cancelHint = armSavingHint()
  const phaseLog = collectSavePhases()
  // adj371：文件名「乐观更新」——写盘（尤其 close() 的原子替换）可能要好几秒，
  // 名称在按下保存时就已知，先切过去，未保存标记仍保留到写盘成功；失败则回滚。
  const prevName = useDocStore.getState().fileName
  const name = fileBaseName(handle.name)
  const optimistic = prevName !== name
  if (optimistic) applyOptimisticName(name)
  try {
    const code = useDocStore.getState().code
    // adj364：最快路径——直接写；权限失效时才申请权限并重试（不再每次前置查权限/回读）
    await saveTextToHandle(handle, code, { trace: phaseLog.trace })
    const tStore = performance.now()
    phaseLog.tail('store', performance.now() - tStore)
    // 句柄与显示名保持一致（句柄持久化已在获取/打开该文件时完成，保存热路径不再重复写库）
    const tUi = performance.now()
    useDocStore.setState({ dirty: useDocStore.getState().code !== code })
    phaseLog.tail('ui', performance.now() - tUi)
    reportSaved(t0, phaseLog, name)
    return true
  } catch (e) {
    if (optimistic) rollbackOptimisticName(prevName)
    const kind = classifySaveError(e)
    if (kind === 'cancel') return false
    if (kind === 'permission' || kind === 'gone') {
      // 句柄已失效：断开它——下次「保存」直接弹另存为（全新用户手势，选择器不会被拒），
      // 不会再卡在同一条静默失败的路径上；本次先尝试直接转另存为
      disconnectFileHandle()
      return useDocStore.getState().saveFileAs()
    }
    ui.showNotice(
      kind === 'busy' ? uiCopy.saveBusy : kind === 'verify' ? uiCopy.saveVerifyFailed : uiCopy.saveFailed,
      'error',
    )
    return false
  } finally {
    cancelHint()
  }
}

/** adj371：乐观切名（同步写草稿名，保证下次启动「句柄名 ↔ 草稿名」仍对得上） */
function applyOptimisticName(name: string): void {
  try {
    localStorage.setItem(DRAFT_NAME_KEY, name)
  } catch {
    /* 忽略 */
  }
  useDocStore.setState({ fileName: name })
}

/** adj371：写盘失败时回滚乐观切名 */
function rollbackOptimisticName(prevName: string): void {
  try {
    localStorage.setItem(DRAFT_NAME_KEY, prevName)
  } catch {
    /* 忽略 */
  }
  useDocStore.setState({ fileName: prevName })
}

/** 断开与磁盘文件的关联（句柄失效时：下次保存 = 另存为） */
function disconnectFileHandle(): void {
  useDocStore.setState({ fileHandle: null })
  void saveFileHandle(null)
}

/**
 * adj540：把工作区 IO 抛出的**错误码**翻译成给用户看的一句话。
 * 这些是"预期内的失败"（重名 / 目录非空 / 校验不一致），必须给人话，不能把原始异常抛给用户。
 */
function workspaceOpErrorText(name: string, e: unknown): string {
  const code = e instanceof Error ? e.message : String(e)
  if (code === 'EXISTS') return workspaceCopy.exists(name)
  if (code === 'NOT_EMPTY') return workspaceCopy.dirNotEmpty(name)
  if (code === 'VERIFY') return workspaceCopy.verifyFailed(name)
  return workspaceCopy.opFailed(name, code)
}

// ---- adj281：降级打开（无 Web File System Access API 时） ----
// 非安全上下文（http://、file://）或非 Chromium 内核下没有 showOpenFilePicker；
// 打开本身只需读取 .jps 文本，改用标准 <input type="file"> 任何环境都可用。
// 该环境无法写回磁盘，故 fileHandle 置 null，并提示改走「导出」保存成果。

/**
 * adj399/adj540：是否触屏/移动端 —— 判据已收敛到 `saveSupport.isCoarsePointerDevice()`
 * （「打开/另存为」在手机端要**以工作区优先**，两处必须用同一个判断，见该函数注释）。
 */
function openFileViaInput(): Promise<boolean> {
  return new Promise((resolve) => {
    const mobile = isCoarsePointerDevice()
    const input = document.createElement('input')
    input.type = 'file'
    // adj281：桌面降级路径保留过滤（未知扩展在桌面浏览器上按文件名后缀匹配，能正常筛出 .jps）；
    // adj399：移动端（粗指针）不设 accept——见 fileInputAccept 注释（MIME 过滤会把 .jps 藏起来）
    const accept = fileInputAccept(mobile)
    if (accept !== null) input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    let gotFile = false
    let hinted = false
    /**
     * adj401：手机端**放弃选择**（关掉对话框没选文件）时给出可操作指引——
     * 用户实测「列表里能看到 .md 却看不到 .jps」：文件还在网盘/微信里（没落到本机）、
     * 或所选目录/网盘 SAF 按类型隐藏了未知扩展。这三条指引覆盖全部情况。
     * 只在移动端、且用户确实没选到文件时提示一次，不打扰正常流程。
     */
    const hintMobile = () => {
      if (!mobile || hinted) return
      hinted = true
      useUiStore.getState().showNotice(uiCopy.openPickHint, 'warn')
    }
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(ok)
    }
    // 用户取消（现代 Chrome/Edge/Firefox 触发 cancel 事件）
    input.addEventListener('cancel', () => {
      hintMobile()
      finish(false)
    })
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) {
        finish(false)
        return
      }
      gotFile = true
      try {
        const code = await file.text()
        const name = fileBaseName(file.name)
        try {
          localStorage.setItem(DRAFT_KEY, code)
          localStorage.setItem(DRAFT_NAME_KEY, name)
        } catch {
          /* 存储不可用时静默 */
        }
        useDocStore.setState({
          code,
          fileName: name,
          parseResult: parseJps(code),
          pageConfig: resolveConfig(code),
          dirty: false,
          // adj281：降级环境无写回权限，不关联磁盘句柄（保存走 saveFileAs → 会提示 saveUnsupported）
          fileHandle: null,
          // adj538：同理与"外部路径"解绑
          nativePath: null,
          // adj540：降级打开也没有工作区绑定（下次保存走另存为/导出）
          workspacePath: null,
          activeNoteId: null,
          activeNoteIds: [],
          voiceBlocks: [],
          cursorJump: null,
          undoStack: [],
          redoStack: [],
          lastEditAt: 0,
          sel: { start: 0, end: 0 },
        })
        useUiStore.getState().showNotice(uiCopy.openFallbackNotice, 'warn')
        finish(true)
      } catch {
        finish(false)
      }
    })
    // 兜底：老内核无 cancel 事件时，窗口从文件选择框重新获焦且未选文件 → 视为取消
    const onFocus = () => {
      setTimeout(() => {
        if (!gotFile) {
          hintMobile() // adj401：老内核走这条兜底，同样给「找不到 .jps」的指引
          finish(false)
        }
      }, 300)
    }
    window.addEventListener('focus', onFocus)
    input.click()
    // adj405：兜底——个别移动外壳/PWA 里 `input.click()` 静默失败（既不弹选择器、也不触发
    // change/cancel，用户看到的就是"点了没反应"）。若 4 秒后仍无任何动静且页面始终有焦点
    // （说明我们从未被选择器抢走焦点），给一条可操作提示，别让用户干等。
    window.setTimeout(() => {
      if (settled || gotFile) return
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return
      useUiStore.getState().showNotice(uiCopy.openPickerSilent, 'warn')
    }, 4000)
  })
}

// adj161：启动时恢复上次保存/打开的文件句柄（IndexedDB 持久化），
// 之后直接按保存即写回该文件（无需重新选文件）；恢复失败静默（走另存为）
void loadFileHandle().then((h) => {
  if (!h || fileStateTouched) return
  const name = fileBaseName(h.name)
  // adj363：句柄与草稿必须属于同一文件才恢复。句柄持久化是异步 fire-and-forget，
  // 若「新建/载入示例」后立刻退出应用，清空句柄的写入可能没落盘，下次启动会恢复出旧句柄，
  // 此时草稿已是另一份谱 → 按保存会把新谱写进旧文件。草稿名（DRAFT_NAME_KEY）始终标识
  // 草稿所属文件，与句柄名不一致即视为不同文件，不恢复句柄（下次保存走另存为）。
  const draftName = useDocStore.getState().fileName
  if (draftName && draftName !== name) return
  useDocStore.setState({ fileHandle: h, fileName: name })
})
