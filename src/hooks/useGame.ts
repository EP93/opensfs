import { useCallback, useRef, useState } from 'react'
import { Game } from '@/game/Game'
import { useRuntimeStore } from '@/stores/useRuntimeStore'

interface UseGameReturn {
  game: Game | null
  isInitialized: boolean
  initGame: (container: HTMLElement) => Promise<void>
  destroyGame: () => void
}

export function useGame(): UseGameReturn {
  const gameRef = useRef<Game | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const initializingRef = useRef(false)
  const mountedRef = useRef(true)

  const initGame = useCallback(async (container: HTMLElement) => {
    // Prevent double initialization (React Strict Mode)
    if (gameRef.current || initializingRef.current) {
      return
    }

    initializingRef.current = true
    mountedRef.current = true

    const game = new Game()

    try {
      await game.init(container)

      // Check if component was unmounted during async init
      if (!mountedRef.current) {
        game.destroy()
        return
      }

      gameRef.current = game
      useRuntimeStore.getState().setGame(game)
      setIsInitialized(true)
    } catch (error) {
      console.error('Failed to initialize game:', error)
      game.destroy()
    } finally {
      initializingRef.current = false
    }
  }, [])

  const destroyGame = useCallback(() => {
    mountedRef.current = false

    if (gameRef.current) {
      gameRef.current.destroy()
      gameRef.current = null
      useRuntimeStore.getState().setGame(null)
      setIsInitialized(false)
    }
  }, [])

  return {
    game: gameRef.current,
    isInitialized,
    initGame,
    destroyGame,
  }
}
