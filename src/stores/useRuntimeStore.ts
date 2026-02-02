import { create } from 'zustand'
import type { Game } from '@/game/Game'

interface RuntimeStore {
  game: Game | null
  setGame: (game: Game | null) => void
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  game: null,
  setGame: (game) => set({ game }),
}))
