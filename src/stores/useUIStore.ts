import { create } from 'zustand'
import type { StationFeature } from '@/lib/mapLoader'

type Panel = 'stations' | 'trains' | 'schedule' | 'finances' | 'settings' | null

interface UIStore {
  // Selected station
  selectedStation: StationFeature | null
  selectedTrainId: string | null

  // Panel state
  activePanel: Panel
  isPanelOpen: boolean

  // Modal state
  activeModal: string | null
  modalData: unknown

  // Tooltip state
  tooltip: {
    visible: boolean
    x: number
    y: number
    content: string
  }

  // Loading states
  isLoading: boolean
  loadingMessage: string

  // Actions
  setActivePanel: (panel: Panel) => void
  togglePanel: (panel: Panel) => void
  closePanel: () => void

  openModal: (modalId: string, data?: unknown) => void
  closeModal: () => void

  showTooltip: (x: number, y: number, content: string) => void
  hideTooltip: () => void

  setLoading: (isLoading: boolean, message?: string) => void

  selectStation: (station: StationFeature | null) => void
  clearSelectedStation: () => void
  selectTrain: (trainId: string | null) => void
  clearSelectedTrain: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  // Initial state
  selectedStation: null,
  selectedTrainId: null,
  activePanel: null,
  isPanelOpen: false,
  activeModal: null,
  modalData: null,
  tooltip: {
    visible: false,
    x: 0,
    y: 0,
    content: '',
  },
  isLoading: false,
  loadingMessage: '',

  // Actions
  setActivePanel: (panel) => {
    set({ activePanel: panel, isPanelOpen: panel !== null })
  },

  togglePanel: (panel) => {
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
      isPanelOpen: state.activePanel !== panel,
    }))
  },

  closePanel: () => {
    set({ activePanel: null, isPanelOpen: false })
  },

  openModal: (modalId, data) => {
    set({ activeModal: modalId, modalData: data })
  },

  closeModal: () => {
    set({ activeModal: null, modalData: null })
  },

  showTooltip: (x, y, content) => {
    set({
      tooltip: { visible: true, x, y, content },
    })
  },

  hideTooltip: () => {
    set((state) => ({
      tooltip: { ...state.tooltip, visible: false },
    }))
  },

  setLoading: (isLoading, message = '') => {
    set({ isLoading, loadingMessage: message })
  },

  selectStation: (station) => {
    set({ selectedStation: station })
  },

  clearSelectedStation: () => {
    set({ selectedStation: null })
  },

  selectTrain: (trainId) => {
    set({ selectedTrainId: trainId })
  },

  clearSelectedTrain: () => {
    set({ selectedTrainId: null })
  },
}))
