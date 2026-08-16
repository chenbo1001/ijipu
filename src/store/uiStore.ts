/**
 * store/uiStore.ts — UI 状态（模态框、排版辅助、主题）
 */
import { create } from 'zustand'
import { DEFAULT_THEME } from '../brand/themes'

export type ModalKind =
  | 'about'
  | 'samples'
  | 'pageConfig'
  | 'playback'
  | 'export'
  | 'shortcuts'

const THEME_KEY = 'jianpuscript.theme'

function loadTheme(): string {
  try {
    return localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

interface UiState {
  modal: ModalKind | null
  /** 预览页排版辅助虚线开关 */
  showGuides: boolean
  /** 中国色主题 id */
  theme: string
  openModal: (m: ModalKind) => void
  closeModal: () => void
  setShowGuides: (b: boolean) => void
  setTheme: (id: string) => void
}

export const useUiStore = create<UiState>()((set) => ({
  modal: null,
  showGuides: true,
  theme: loadTheme(),
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
  setShowGuides: (b) => set({ showGuides: b }),
  setTheme: (id) => {
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      /* 忽略 */
    }
    set({ theme: id })
  },
}))
