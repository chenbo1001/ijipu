/**
 * store/docStore.ts — 文档状态（zustand）
 * 数据流：code → parse（同步）→ parseResult；layout/render 由渲染管线消费。
 */
import { create } from 'zustand'
import { parseJps, defaultPageConfig } from '../engine'
import type { PageConfig, ParseResult } from '../engine'
import { SAMPLES, defaultSample } from '../samples'

export type ViewType = 'code' | 'split' | 'preview'

const NEW_FILE_TEMPLATE = [
  '#============================以下为描述头定义==========================',
  'V: 1.0',
  'B: 未命名',
  'Z: 佚名 词曲',
  'D: C',
  'P: 4/4',
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
  /** 当前高亮音符 id（notepos 契约），编辑器↔谱面联动 */
  activeNoteId: string | null
  /** 编辑器光标跳转请求（点击谱面音符时触发） */
  cursorJump: { pos: number; nonce: number } | null

  setCode: (code: string) => void
  setViewType: (v: ViewType) => void
  setAutoFormat: (b: boolean) => void
  setPageConfig: (cfg: PageConfig) => void
  setCursor: (line: number, col: number) => void
  setActiveNoteId: (id: string | null) => void
  jumpCursor: (pos: number) => void
  loadSample: (id: string) => void
  newDoc: () => void
  markSaved: () => void
}

/** 本地草稿（localStorage，自动保存） */
const DRAFT_KEY = 'jianpuscript.draft'
const DRAFT_NAME_KEY = 'jianpuscript.draftName'

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

const draft = loadDraft()

export const useDocStore = create<DocState>()((set) => ({
  code: draft?.code ?? defaultSample().code,
  fileName: draft?.name ?? defaultSample().name,
  dirty: false,
  viewType: (localStorage.getItem('jianpuscript.viewType') as ViewType) || 'split',
  autoFormat: true,
  pageConfig: { ...defaultPageConfig },
  parseResult: parseJps(draft?.code ?? defaultSample().code),
  cursor: { line: 1, col: 0 },
  activeNoteId: null,
  cursorJump: null,

  setCode: (code) => {
    try {
      localStorage.setItem(DRAFT_KEY, code)
    } catch {
      /* 存储不可用时静默 */
    }
    set({ code, parseResult: parseJps(code), dirty: true })
  },
  setViewType: (v) => {
    localStorage.setItem('jianpuscript.viewType', v)
    set({ viewType: v })
  },
  setAutoFormat: (b) => set({ autoFormat: b }),
  setPageConfig: (cfg) => set({ pageConfig: cfg }),
  setCursor: (line, col) => set({ cursor: { line, col } }),
  setActiveNoteId: (id) => set({ activeNoteId: id }),
  jumpCursor: (pos) =>
    set((s) => ({ cursorJump: { pos, nonce: (s.cursorJump?.nonce ?? 0) + 1 } })),
  loadSample: (id) => {
    const s = SAMPLES.find((x) => x.id === id) ?? defaultSample()
    localStorage.setItem(DRAFT_KEY, s.code)
    localStorage.setItem(DRAFT_NAME_KEY, s.name)
    set({
      code: s.code,
      fileName: s.name,
      parseResult: parseJps(s.code),
      dirty: false,
      activeNoteId: null,
      cursorJump: null,
    })
  },
  newDoc: () => {
    localStorage.setItem(DRAFT_KEY, NEW_FILE_TEMPLATE)
    localStorage.setItem(DRAFT_NAME_KEY, '未命名')
    set({
      code: NEW_FILE_TEMPLATE,
      fileName: '未命名',
      parseResult: parseJps(NEW_FILE_TEMPLATE),
      dirty: false,
      activeNoteId: null,
      cursorJump: null,
    })
  },
  markSaved: () => set({ dirty: false }),
}))
