import { useEffect, useRef } from 'react'
import { useGame } from '@/hooks/useGame'
import { useUIStore } from '@/stores/useUIStore'
import { HUD } from './HUD'

export function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { game, initGame, destroyGame, isInitialized } = useGame()
  const selectStation = useUIStore((state) => state.selectStation)
  const selectTrain = useUIStore((state) => state.selectTrain)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    void initGame(container)

    return () => {
      destroyGame()
    }
  }, [initGame, destroyGame])

  // Set up station click callback
  useEffect(() => {
    if (game) {
      game.setCallbacks({
        onStationClick: selectStation,
        onTrainClick: selectTrain,
      })
    }
  }, [game, selectStation, selectTrain])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      {!isInitialized && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-db-red border-t-transparent" />
            <p className="text-db-gray-light">Loading game engine...</p>
          </div>
        </div>
      )}
      {isInitialized && <HUD game={game} />}
    </div>
  )
}
