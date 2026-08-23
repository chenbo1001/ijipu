/**
 * store/uiStore.ts — UI 状态（模态框、排版辅助、主题、拆分比例、编辑器字号）
 */
import { create } from 'zustand'
import { DEFAULT_THEME, DEFAULT_THEME_MODE, type ThemeMode } from '../brand/themes'

export type ModalKind =
  | 'about'
  | 'samples'
  | 'pageConfig'
  | 'playback'
  | 'export'
  | 'shortcuts'

const THEME_KEY = 'jianpuscript.theme'
const THEME_MODE_KEY = 'jianpuscript.themeMode'
const SPLIT_KEY = 'jianpuscript.splitPct'
const EDITOR_FS_KEY = 'jianpuscript.editorFontSize'
const EDITOR_FONT_KEY = 'jianpuscript.editorFont'
const PREVIEW_ZOOM_KEY = 'jianpuscript.previewZoom'

function loadTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function loadThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_MODE_KEY)
    return v === 'light' || v === 'dark' || v === 'auto' ? v : DEFAULT_THEME_MODE
  } catch {
    return DEFAULT_THEME_MODE
  }
}

function loadNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

/** 当前系统浅深色偏好（无 matchMedia 时默认深色） */
function detectSystemLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

interface UiState {
  modal: ModalKind | null
  /** 试听起始音符 id（双击谱面音符定位试听起点，adj88；null = 从头播放） */
  playbackStartId: string | null
  /** 双击谱面音符请求重新播放的计数（adj158：播放中双击快速跳到该处，每次 +1） */
  playbackTick: number
  /** 预览页排版辅助虚线开关 */
  showGuides: boolean
  /** 中国色主题 id */
  theme: string
  /** 浅深色模式：auto=跟随系统 prefers-color-scheme（adj48） */
  themeMode: ThemeMode
  /** 系统当前是否浅色（auto 模式下决定实际浅深色） */
  systemLight: boolean
  /** 拆分视图上（预览）窗格高度占比（%），下（编辑器）窗格占剩余 */
  splitPct: number
  /** 脚本编辑器字号（px） */
  editorFontSize: number
  /** 脚本编辑器字体（adj160：与字号按钮同排，默认等宽代码字体） */
  editorFont: string
  /** 预览缩放（%，50~200，adj51） */
  previewZoom: number
  openModal: (m: ModalKind) => void
  closeModal: () => void
  setPlaybackStart: (id: string | null) => void
  bumpPlaybackTick: () => void
  setShowGuides: (b: boolean) => void
  setTheme: (id: string) => void
  setThemeMode: (m: ThemeMode) => void
  setSystemLight: (b: boolean) => void
  setSplitPct: (pct: number) => void
  setEditorFontSize: (px: number) => void
  setEditorFont: (f: string) => void
  setPreviewZoom: (z: number) => void
}

export const useUiStore = create<UiState>()((set) => ({
  modal: null,
  playbackStartId: null,
  playbackTick: 0,
  showGuides: true,
  theme: loadTheme(),
  themeMode: loadThemeMode(),
  systemLight: detectSystemLight(),
  splitPct: loadNum(SPLIT_KEY, 50),
  editorFontSize: loadNum(EDITOR_FS_KEY, 14),
  editorFont: (() => {
    // adj163：仅接受等宽字体（textarea 与高亮层需逐字符对齐）；
    // adj173：排除带编程连字的字体（Cascadia Code/JetBrains Mono/Fira Code 等），
    // 防止 |:、|| 等连字字形导致显示层与实际层列错位；旧配置存了连字字体回退默认
    const MONO = new Set(['Consolas', 'Courier New', 'monospace'])
    try {
      const v = localStorage.getItem(EDITOR_FONT_KEY)
      if (v && MONO.has(v)) return v
    } catch {
      /* 忽略 */
    }
    return 'Consolas'
  })(),
  previewZoom: loadNum(PREVIEW_ZOOM_KEY, 100),
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null, playbackStartId: null }),
  setPlaybackStart: (id) => set({ playbackStartId: id }),
  bumpPlaybackTick: () => set((s) => ({ playbackTick: s.playbackTick + 1 })),
  setShowGuides: (b) => set({ showGuides: b }),
  setTheme: (id) => {
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      /* 忽略 */
    }
    set({ theme: id })
  },
  setThemeMode: (m) => {
    try {
      localStorage.setItem(THEME_MODE_KEY, m)
    } catch {
      /* 忽略 */
    }
    set({ themeMode: m })
  },
  setSystemLight: (b) => set({ systemLight: b }),
  setSplitPct: (pct) => {
    const v = Math.min(85, Math.max(15, pct))
    try {
      localStorage.setItem(SPLIT_KEY, String(v))
    } catch {
      /* 忽略 */
    }
    set({ splitPct: v })
  },
  setEditorFontSize: (px) => {
    const v = Math.min(26, Math.max(10, Math.round(px)))
    try {
      localStorage.setItem(EDITOR_FS_KEY, String(v))
    } catch {
      /* 忽略 */
    }
    set({ editorFontSize: v })
  },
  setEditorFont: (f) => {
    try {
      localStorage.setItem(EDITOR_FONT_KEY, f)
    } catch {
      /* 忽略 */
    }
    set({ editorFont: f })
  },
  setPreviewZoom: (z) => {
    const v = Math.min(200, Math.max(50, Math.round(z)))
    try {
      localStorage.setItem(PREVIEW_ZOOM_KEY, String(v))
    } catch {
      /* 忽略 */
    }
    set({ previewZoom: v })
  },
}))
