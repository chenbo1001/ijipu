/**
 * store/uiStore.ts — UI 状态（模态框、排版辅助、主题、拆分比例、编辑器字号）
 */
import './localStorageMigration'
import { create } from 'zustand'
import { DEFAULT_THEME, DEFAULT_THEME_MODE, type ThemeMode } from '../brand/themes'
// adj366：试听音色选择值的解析/格式化（未设置或空串 = 自动）
import { formatStoredVoice, parseStoredVoice } from './playbackVoice'

export type ModalKind =
  | 'about'
  | 'samples'
  | 'pageConfig'
  | 'playback'
  | 'export'
  | 'shortcuts'
  | 'manual'
  | 'syntax'
  | 'donate'
  | 'soundbanks'

/** 轻量浮动提示（toast）：kind 决定配色；nonce 用于同文案重复触发时重置隐藏计时 */
export type NoticeKind = 'ok' | 'warn' | 'error'
export interface Notice {
  text: string
  kind: NoticeKind
  nonce: number
}

const THEME_KEY = 'ijipu.theme'
const THEME_MODE_KEY = 'ijipu.themeMode'
const SPLIT_KEY = 'ijipu.splitPct'
const EDITOR_FS_KEY = 'ijipu.editorFontSize'
const EDITOR_FONT_KEY = 'ijipu.editorFont'
const PREVIEW_ZOOM_KEY = 'ijipu.previewZoom'
const AUTO_WRAP_KEY = 'ijipu.autoWrap'
const SHOW_SCRIPT_PAD_KEY = 'ijipu.showScriptPad'
const SHOW_GUIDES_KEY = 'ijipu.showGuides'
// adj315：应用级视图偏好——左右拆分排列方向（默认视图已取消，改为记住顶栏上次设置）
const SPLITH_DIR_KEY = 'ijipu.splitHDir'
// adj330：SpessaSynth 高质量采样——音源库 + 全局音色（GM program）
const PLAYBACK_HQ_LIBRARY_KEY = 'ijipu.playbackHqLibrary'
const PLAYBACK_HQ_VOICE_KEY = 'ijipu.playbackHqVoice'
const PLAYBACK_HQ_ENABLED_KEY = 'ijipu.playbackHqEnabled'
// adj347：默认启用的常用音色（初次用户打开试听即可选）——大钢琴/八音盒/小提琴/弦乐/小号/单簧管/长笛
const DEFAULT_HQ_ENABLED: number[] = [0, 10, 40, 48, 56, 71, 73]

function loadBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return def
    return v === '1' || v === 'true'
  } catch {
    return def
  }
}

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

/** adj314：是否移动端/PAD（触屏或窄屏≤1024px）——决定脚本工具条默认开关。PC 大屏默认关 */
function detectTouch(): boolean {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true
  } catch {
    /* 忽略 */
  }
  try {
    if (window.innerWidth <= 1024) return true
  } catch {
    /* 忽略 */
  }
  return false
}

/** adj322：宽/窄屏分界（≤1024px = 窄屏）。matchMedia 支持时用 mq，否则读 innerWidth。
 * 阈值与 detectTouch 一致——统一「≤1024px = 窄屏」语义（触屏设备通常也窄） */
const NARROW_MQ = '(max-width: 1024px)'
function detectNarrow(): boolean {
  try {
    if (window.matchMedia(NARROW_MQ).matches) return true
  } catch {
    /* 忽略 */
  }
  try {
    return window.innerWidth <= 1024
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
  /** 编辑器自动折行（adj233 默认关闭；adj234 曾默认开启——用户确认保持默认关闭，
   *  关闭时 wrap=off 横向滚动对位正确；开启时 break-word 空格后折行） */
  autoWrap: boolean
  /** adj314：嵌入式简谱输入工具条显示开关（移动端/PAD 默认开、PC 默认关） */
  showScriptPad: boolean
  /** adj322：当前是否窄屏（视口宽度 ≤1024px）。由 matchMedia 同步更新,
   *  用于：① 进入拆分视图时按视口选上下/左右；② 拆分类视图下视口跨阈值实时切换。 */
  isNarrow: boolean
  /** adj315：左右拆分的排列方向（previewLeft=左预览右编辑 / editorLeft=左编辑右预览） */
  splitHDir: 'previewLeft' | 'editorLeft'
  /** adj330：SpessaSynth 音源库 id（HQ_LIBRARIES，空=默认库） */
  playbackHqLibrary: string
  /** adj330：SpessaSynth 全局音色（GM program；null=按声部名自动路由） */
  playbackHqVoice: number | null
  /** adj332：已启用（收藏）的音色 GM program 集合——试听只列这些，避免 128 项全列 */
  playbackHqEnabled: number[]
  /** 轻量浮动提示（null = 无提示） */
  notice: Notice | null
  /** adj379：检测到 SW 新版本（页面仍在跑旧 bundle）——右下角提示「点击刷新」 */
  updateReady: boolean
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
  setAutoWrap: (b: boolean) => void
  setShowScriptPad: (b: boolean) => void
  /** adj322：宽窄屏变化同步（matchMedia 'change' 回调） */
  setIsNarrow: (b: boolean) => void
  setSplitHDir: (d: 'previewLeft' | 'editorLeft') => void
  /** adj330：SpessaSynth 试听偏好 setter */
  setPlaybackHqLibrary: (id: string) => void
  setPlaybackHqVoice: (program: number | null) => void
  /** adj332：切换某音色是否启用（收藏），试听只列启用的 */
  togglePlaybackHqVoice: (program: number) => void
  /** adj340：批量设置已启用音色集合（导入音色配置用） */
  setPlaybackHqEnabled: (programs: number[]) => void
  /** adj379：设置「检测到新版本」状态（PWA 更新提示） */
  setUpdateReady: (b: boolean) => void
  showNotice: (text: string, kind?: NoticeKind) => void
  clearNotice: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  modal: null,
  playbackStartId: null,
  playbackTick: 0,
  showGuides: loadBool(SHOW_GUIDES_KEY, true),
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
  // adj311：自动折行改为默认开启——Textarea 与显示层折行同步已修复
  //（mirror div 与 textarea 折行点一致），开启后长行软折行对位正确无横向滚动
  autoWrap: loadBool(AUTO_WRAP_KEY, true),
  // adj314：脚本工具条默认按设备——移动端/PAD（触屏或≤1024px）默认开、PC 默认关
  showScriptPad: loadBool(SHOW_SCRIPT_PAD_KEY, detectTouch()),
  // adj322：宽/窄屏（≤1024px 视为窄屏）—— matchMedia 实时同步
  isNarrow: detectNarrow(),
  // adj315：左右拆分排列方向（previewLeft=左预览右编辑，默认）
  splitHDir: (() => {
    try {
      const v = localStorage.getItem(SPLITH_DIR_KEY)
      return v === 'editorLeft' ? 'editorLeft' : 'previewLeft'
    } catch {
      return 'previewLeft'
    }
  })(),
  // adj330：SpessaSynth 音源库 id（空=默认库）+ 全局音色（GM program，null=自动）
  playbackHqLibrary: (() => {
    try {
      return localStorage.getItem(PLAYBACK_HQ_LIBRARY_KEY) ?? ''
    } catch {
      return ''
    }
  })(),
  playbackHqVoice: (() => {
    try {
      // adj366：未设置/空串/非法值 → null（自动）；直接 Number(null)/Number('') 会得到 0（大钢琴）
      return parseStoredVoice(localStorage.getItem(PLAYBACK_HQ_VOICE_KEY))
    } catch {
      return null
    }
  })(),
  // adj332/347：已启用音色集合（试听只列这些）；首次/损坏回退默认常用音色
  playbackHqEnabled: (() => {
    try {
      const raw = localStorage.getItem(PLAYBACK_HQ_ENABLED_KEY)
      if (raw === null) return DEFAULT_HQ_ENABLED // 首次：默认常用音色
      const v = JSON.parse(raw)
      return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n >= 0 && n < 128) : DEFAULT_HQ_ENABLED
    } catch {
      return DEFAULT_HQ_ENABLED
    }
  })(),
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null, playbackStartId: null }),
  setPlaybackStart: (id) => set({ playbackStartId: id }),
  bumpPlaybackTick: () => set((s) => ({ playbackTick: s.playbackTick + 1 })),
  setShowGuides: (b) => {
    try {
      localStorage.setItem(SHOW_GUIDES_KEY, b ? '1' : '0')
    } catch {
      /* 忽略 */
    }
    set({ showGuides: b })
  },
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
  setAutoWrap: (b) => {
    try {
      localStorage.setItem(AUTO_WRAP_KEY, b ? '1' : '0')
    } catch {
      /* 忽略 */
    }
    set({ autoWrap: b })
  },
  setShowScriptPad: (b) => {
    try {
      localStorage.setItem(SHOW_SCRIPT_PAD_KEY, b ? '1' : '0')
    } catch {
      /* 忽略 */
    }
    set({ showScriptPad: b })
  },
  // adj322：宽窄屏实时同步（不持久化——视口宽度本身是运行时状态）
  setIsNarrow: (b) => set({ isNarrow: b }),
  setSplitHDir: (d) => {
    try {
      localStorage.setItem(SPLITH_DIR_KEY, d)
    } catch {
      /* 忽略 */
    }
    set({ splitHDir: d })
  },
  // adj330：SpessaSynth 音源库 / 全局音色持久化
  setPlaybackHqLibrary: (id) => {
    try {
      localStorage.setItem(PLAYBACK_HQ_LIBRARY_KEY, id)
    } catch {
      /* 忽略 */
    }
    set({ playbackHqLibrary: id })
  },
  setPlaybackHqVoice: (program) => {
    try {
      // adj366：自动 = 空串（parseStoredVoice 回读为 null）
      localStorage.setItem(PLAYBACK_HQ_VOICE_KEY, formatStoredVoice(program))
    } catch {
      /* 忽略 */
    }
    set({ playbackHqVoice: program })
  },
  // adj332：切换音色启用（收藏），持久化数组
  togglePlaybackHqVoice: (program) =>
    set((s) => {
      const has = s.playbackHqEnabled.includes(program)
      const next = has ? s.playbackHqEnabled.filter((n) => n !== program) : [...s.playbackHqEnabled, program]
      try {
        localStorage.setItem(PLAYBACK_HQ_ENABLED_KEY, JSON.stringify(next))
      } catch {
        /* 忽略 */
      }
      return { playbackHqEnabled: next }
    }),
  // adj340：批量设置已启用音色（导入），持久化
  setPlaybackHqEnabled: (programs) => {
    const next = programs.filter((n) => Number.isInteger(n) && n >= 0 && n < 128)
    try {
      localStorage.setItem(PLAYBACK_HQ_ENABLED_KEY, JSON.stringify(next))
    } catch {
      /* 忽略 */
    }
    set({ playbackHqEnabled: next })
  },
  notice: null,
  showNotice: (text, kind = 'ok') =>
    set((s) => ({ notice: { text, kind, nonce: (s.notice?.nonce ?? 0) + 1 } })),
  clearNotice: () => set({ notice: null }),
  // adj379：SW 新版本提示状态（部署新版后页面仍跑旧 bundle 时置 true）
  updateReady: false,
  setUpdateReady: (b) => set({ updateReady: b }),
}))
