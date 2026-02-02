import { create } from 'zustand'
import type { GameTime, PlayerResources, SelectedEntity, Station, Track, Train } from '@/types/game'

interface GameStore {
  // Derived state from Game class (synced periodically)
  time: GameTime
  resources: PlayerResources
  stations: Map<string, Station>
  tracks: Map<string, Track>
  trains: Map<string, Train>
  selectedEntity: SelectedEntity | null

  // Actions
  setTime: (time: GameTime) => void
  setResources: (resources: PlayerResources) => void
  setStations: (stations: Map<string, Station>) => void
  setTracks: (tracks: Map<string, Track>) => void
  setTrains: (trains: Map<string, Train>) => void
  setSelectedEntity: (entity: SelectedEntity | null) => void

  // Bulk sync from Game state
  syncFromGameState: (state: {
    time: GameTime
    resources: PlayerResources
    stations: Map<string, Station>
    tracks: Map<string, Track>
    trains: Map<string, Train>
    selectedEntity: SelectedEntity | null
  }) => void
}

export const useGameStore = create<GameStore>((set) => ({
  // Initial state
  time: {
    tick: 0,
    speed: 1,
    paused: false,
    date: new Date(2024, 0, 1, 6, 0),
  },
  resources: {
    money: 10_000_000,
    reputation: 50,
  },
  stations: new Map(),
  tracks: new Map(),
  trains: new Map(),
  selectedEntity: null,

  // Actions
  setTime: (time) => {
    set({ time })
  },
  setResources: (resources) => {
    set({ resources })
  },
  setStations: (stations) => {
    set({ stations })
  },
  setTracks: (tracks) => {
    set({ tracks })
  },
  setTrains: (trains) => {
    set({ trains })
  },
  setSelectedEntity: (selectedEntity) => {
    set({ selectedEntity })
  },

  syncFromGameState: (state) => {
    set({
      time: state.time,
      resources: state.resources,
      stations: state.stations,
      tracks: state.tracks,
      trains: state.trains,
      selectedEntity: state.selectedEntity,
    })
  },
}))
