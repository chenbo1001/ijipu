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
  isUserCancel,
  saveTextToHandle,
  shouldUseFileInputPicker,
  type SavePhaseLog,
} from './saveSupport'
import { useUiStore } from './uiStore'
import { loadFontOverride, migrateLegacyEditorPrefs } from './editorPrefs'
import { normalizePastedSource } from './importSource'

/** adj200：用户是否已主导过文件状态（新建/打开/保存/另存为）。「启动恢复」异步读 IndexedDB，
 *  必须只在用户还未进行任何文件操作时应用，避免它在用户新建/另存为之后才完成，从而把
 *  fileHandle / fileName 覆盖回旧文件（旧值 A）。 */
let fileStateTouched = false
import { uiCopy, savePhaseCopy, pasteImportCopy } from '../brand/copy'

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
  /**
   * 把**当前生效的全部设置**固化进谱面 `# jps-config`（全量写入）。
   * 差量写入下，与默认值相同的项不落盘；需要"这份谱在任何机器/任何人手里都长一样"时用它。
   */
  persistFullConfig: () => void
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

function loadPageConfig(): PageConfig {
  try {
    const raw = localStorage.getItem(PAGE_CONFIG_KEY)
    if (raw) return { ...defaultPageConfig, ...(JSON.parse(raw) as Partial<PageConfig>) }
  } catch {
    /* 损坏的配置忽略，用默认 */
  }
  return { ...defaultPageConfig }
}

/**
 * 解析**生效配置**（分层见 docs/SETTINGS-AUDIT.md）：
 *   L0 引擎默认 < L1 公共设置(localStorage pageConfig) < L2 谱面源码 # jps-config
 * 之后再叠加 L1 的「用我的字体覆盖谱面字体」（默认关，跨机缺字体时用）。
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
  return applyFontOverride(mergeJpsConfig(code, loadPageConfig()), loadFontOverride())
}
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
    try {
      localStorage.setItem(PAGE_CONFIG_KEY, JSON.stringify(cfg))
    } catch {
      /* 存储不可用时静默 */
    }
    // adj83：persist（对话框「保存设置」/ 拖拽虚线松手）时把设置写回源码 # jps-config 注释
    // （每首谱用自己的设置）；拖拽实时预览不写源码，避免频繁重解析。
    // adj-font：改为**差量写入**（只写与默认不同的字段；无差量则删除设置行），
    // 避免把旧默认永久钉在文件里；编辑器偏好已不在 PageConfig 中，不会再被写入。
    // adj454：传了 base（本次编辑开始前的生效配置）时，只把**用户本次改动**并入源码层
    // （mergeConfigEdits）——此前直接写整份生效配置，会把本机公共设置（缓存）固化进别人的谱。
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
  persistFullConfig: () => {
    const code = get().code
    const cfg = get().pageConfig
    const newCode = writeJpsConfig(code, cfg, { mode: 'full' })
    if (newCode === code) return
    try {
      localStorage.setItem(DRAFT_KEY, newCode)
    } catch {
      /* 存储不可用时静默 */
    }
    set({ code: newCode, parseResult: parseJps(newCode), dirty: true })
    useUiStore.getState().showNotice('已把当前全部设置固化到谱面（# jps-config）')
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
    // adj214：新建文档强制使用 defaultPageConfig——不再被 localStorage 公共设置
    // 旧值覆盖（此前 loadPageConfig() 会把用户历史设置带进新谱，默认值调整后
    // 新建仍显示旧值）；模板无 # jps-config，merge(null) 即纯默认
    set({
      code: template,
      fileName: '未命名',
      parseResult: parseJps(template),
      // adj214：新建文档强制使用 defaultPageConfig（不吃公共设置），仅叠加 L1 字体覆盖
      pageConfig: applyFontOverride(mergeJpsConfig(template, null), loadFontOverride()),
      dirty: false,
      fileHandle: null,
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
  openFile: async () => {
    fileStateTouched = true
    const picker = (window as any).showOpenFilePicker
    // adj281：非安全上下文（http:// 或 file://）或非 Chromium 内核下无 showOpenFilePicker，
    // 降级用 <input type=file> 读取 .jps 文本——打开本质只读文本，不依赖文件系统 API
    // adj405：**移动端一律走 input 路径**——真机上已安装的 PWA 里 showOpenFilePicker 可能
    // "点了没反应"（浏览器同一地址却正常），且 Android 拿不到可写回句柄（移动端保存走「导出」）。
    if (shouldUseFileInputPicker(isCoarsePointer(), typeof picker === 'function')) return openFileViaInput()
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
      set({ fileHandle: handle, fileName: name, dirty: get().code !== code })
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

// ---- adj281：降级打开（无 Web File System Access API 时） ----
// 非安全上下文（http://、file://）或非 Chromium 内核下没有 showOpenFilePicker；
// 打开本身只需读取 .jps 文本，改用标准 <input type="file"> 任何环境都可用。
// 该环境无法写回磁盘，故 fileHandle 置 null，并提示改走「导出」保存成果。

/**
 * adj399：是否触屏/移动端（粗指针 = 手机/PAD，判据与 uiStore 的工具条默认开关一致，另加 UA 兜底）。
 * 移动端文件管理器**按 MIME 过滤**：`.jps` 是自定义扩展，系统没有对应 MIME 记录
 * （Android SAF / iOS 文件 App 会当作未知类型隐藏或置灰），
 * 因此无论 accept 里写扩展名还是 `application/octet-stream`，用户都**看不到自己的 .jps 文件**
 * （用户反馈：手机端打开对话框里 .jps 不出现）。故移动端一律不设 accept，全部文件可见。
 */
function isCoarsePointer(): boolean {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true
  } catch {
    /* 媒体特性不可用时走 UA 兜底 */
  }
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  } catch {
    return false
  }
}

function openFileViaInput(): Promise<boolean> {
  return new Promise((resolve) => {
    const mobile = isCoarsePointer()
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
