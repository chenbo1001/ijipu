/**
 * store/uiStore.ts — UI 状态（模态框等）
 */
import { create } from 'zustand'

export type ModalKind =
  | 'about'
  | 'samples'
  | 'pageConfig'
  | 'playback'
  | 'export'
  | 'shortcuts'

interface UiState {
  modal: ModalKind | null
  /** 预览页排版辅助虚线开关 */
  showGuides: boolean
  openModal: (m: ModalKind) => void
  closeModal: () => void
  setShowGuides: (b: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  modal: null,
  showGuides: true,
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
  setShowGuides: (b) => set({ showGuides: b }),
}))
