/**
 * store/docStore.ts — 文档状态（zustand）
 * 数据流：code → parse（同步）→ parseResult；layout/render 由渲染管线消费。
 */
import { create } from 'zustand'
import { parseJps, defaultPageConfig, mergeJpsConfig, writeJpsConfig } from '../engine'
import type { PageConfig, ParseResult } from '../engine'
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

export type ViewType = 'code' | 'split' | 'preview'

const NEW_FILE_TEMPLATE = [
  '#============================以下为描述头定义==========================',
  'V: 1.0',
  'B: 未命名',
  'Z: 佚名 词曲',
  'D: C',
  'P: 4/4',
  // adj254：本乐谱使用「码上简谱」编制——谱尾署名/广告说明
  'S: 本乐谱使用「码上简谱」编制',
  '#============================以下开始简谱主体==========================',
  'Q: 1 2 3 4 |',
  'C: 这是歌词',
  '',
].join('\n')

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
  /** 更新页面设置；persist=true 时同时写回源码 # jps-config（谱面级持久化，adj83） */
  setPageConfig: (cfg: PageConfig, persist?: boolean) => void
  setCursor: (line: number, col: number) => void
  setSelection: (start: number, end: number) => void
  setActiveNoteId: (id: string | null) => void
  /** adj258：设置预览区同时高亮的音符 id 列表（多声部同步演奏） */
  setActiveNoteIds: (ids: string[]) => void
  jumpCursor: (pos: number, end?: number) => void
  undo: () => void
  redo: () => void
  loadSample: (id: string) => void
  newDoc: () => void
  markSaved: () => void

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
const DRAFT_KEY = 'jianpuscript.draft'
const DRAFT_NAME_KEY = 'jianpuscript.draftName'
const PAGE_CONFIG_KEY = 'jianpuscript.pageConfig'

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
    pageConfig: mergeJpsConfig(code, loadPageConfig()),
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
  viewType: (localStorage.getItem('jianpuscript.viewType') as ViewType) || 'split',
  autoFormat: true,
  // adj83：谱面级设置优先（源码 # jps-config 注释），无则回退公共设置
  pageConfig: mergeJpsConfig(draft?.code ?? defaultSample().code, loadPageConfig()),
  parseResult: parseJps(draft?.code ?? defaultSample().code),
  cursor: { line: 1, col: 0 },
  sel: { start: 0, end: 0 },
  activeNoteId: null,
  activeNoteIds: [],
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
      pageConfig: mergeJpsConfig(code, loadPageConfig()),
      dirty: true,
      ...next,
    })
  },
  setViewType: (v) => {
    localStorage.setItem('jianpuscript.viewType', v)
    set({ viewType: v })
  },
  setAutoFormat: (b) => set({ autoFormat: b }),
  setPageConfig: (cfg, persist) => {
    try {
      localStorage.setItem(PAGE_CONFIG_KEY, JSON.stringify(cfg))
    } catch {
      /* 存储不可用时静默 */
    }
    // adj83：persist（对话框「保存设置」）时把设置写回源码 # jps-config 注释
    // （每首谱用自己的设置）；拖拽实时预览不写源码，避免频繁重解析
    if (persist) {
      const code = get().code
      const newCode = writeJpsConfig(code, cfg)
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
      pageConfig: mergeJpsConfig(s.code, loadPageConfig()),
      dirty: false,
      fileHandle: null,
      activeNoteId: null,
      activeNoteIds: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
  },
  newDoc: () => {
    localStorage.setItem(DRAFT_KEY, NEW_FILE_TEMPLATE)
    localStorage.setItem(DRAFT_NAME_KEY, '未命名')
    // adj161：新建文档不关联磁盘文件——清除句柄
    void saveFileHandle(null)
    // adj214：新建文档强制使用 defaultPageConfig——不再被 localStorage 公共设置
    // 旧值覆盖（此前 loadPageConfig() 会把用户历史设置带进新谱，默认值调整后
    // 新建仍显示旧值）；模板无 # jps-config，merge(null) 即纯默认
    set({
      code: NEW_FILE_TEMPLATE,
      fileName: '未命名',
      parseResult: parseJps(NEW_FILE_TEMPLATE),
      pageConfig: mergeJpsConfig(NEW_FILE_TEMPLATE, null),
      dirty: false,
      fileHandle: null,
      activeNoteId: null,
      activeNoteIds: [],
      cursorJump: null,
      undoStack: [],
      redoStack: [],
      lastEditAt: 0,
      sel: { start: 0, end: 0 },
    })
  },
  markSaved: () => set({ dirty: false }),

  // ---- 文件读写（adj70） ----
  fileHandle: null,
  openFile: async () => {
    const picker = (window as any).showOpenFilePicker
    if (typeof picker !== 'function') return false
    try {
      const [handle] = await picker({
        types: [{ description: 'JianpuScript 乐谱', accept: { 'text/plain': ['.jps'] } }],
        multiple: false,
      })
      const file = await handle.getFile()
      const code = await file.text()
      const name = (file.name || '未命名').replace(/\.jps$/i, '')
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
        pageConfig: mergeJpsConfig(code, loadPageConfig()),
        dirty: false,
        fileHandle: handle,
        activeNoteId: null,
        activeNoteIds: [],
        cursorJump: null,
        undoStack: [],
        redoStack: [],
        lastEditAt: 0,
        sel: { start: 0, end: 0 },
      })
      return true
    } catch {
      return false // 用户取消
    }
  },
  saveFile: async () => {
    const s = get()
    if (s.fileHandle) {
      try {
        const w = await s.fileHandle.createWritable()
        await w.write(s.code)
        await w.close()
        // adj161：保存后以该文件为操作主体（同步文件名，防止句柄与显示名不一致）
        const name = (s.fileHandle.name || '未命名').replace(/\.jps$/i, '')
        try {
          localStorage.setItem(DRAFT_NAME_KEY, name)
        } catch {
          /* 忽略 */
        }
        set({ dirty: false, fileName: name })
        return true
      } catch {
        /* 写入失败（权限失效等）→ 走另存为重新授权 */
      }
    }
    return s.saveFileAs()
  },
  saveFileAs: async () => {
    const picker = (window as any).showSaveFilePicker
    if (typeof picker !== 'function') return false
    try {
      const handle = await picker({
        suggestedName: `${get().fileName || '未命名'}.jps`,
        types: [{ description: 'JianpuScript 乐谱', accept: { 'text/plain': ['.jps'] } }],
      })
      const w = await handle.createWritable()
      await w.write(get().code)
      await w.close()
      // adj161：另存为后新文件成为操作主体——同步文件名 + 持久化句柄，
      // 下次直接按保存即写回该文件
      const name = (handle.name || '未命名').replace(/\.jps$/i, '')
      try {
        localStorage.setItem(DRAFT_NAME_KEY, name)
      } catch {
        /* 忽略 */
      }
      void saveFileHandle(handle)
      set({ dirty: false, fileHandle: handle, fileName: name })
      return true
    } catch {
      return false // 用户取消
    }
  },
}))

// adj161：启动时恢复上次保存/打开的文件句柄（IndexedDB 持久化），
// 之后直接按保存即写回该文件（无需重新选文件）；恢复失败静默（走另存为）
void loadFileHandle().then((h) => {
  if (h) {
    const name = (h.name || '未命名').replace(/\.jps$/i, '')
    useDocStore.setState({ fileHandle: h, fileName: name })
  }
})
