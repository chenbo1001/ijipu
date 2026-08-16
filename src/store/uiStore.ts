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
  openModal: (m: ModalKind) => void
  closeModal: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  modal: null,
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
}))
