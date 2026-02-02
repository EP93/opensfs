import { useEffect, useState } from 'react'
import type { Game, LoadingState } from '@/game/Game'
import type { GameState } from '@/game/GameState'
import { getAvailableRegions } from '@/lib/mapLoader'

interface HUDProps {
  game: Game | null
}

const TIME_SPEEDS = [
  { speed: 0, label: '⏸' },
  { speed: 1, label: '1x' },
  { speed: 2, label: '2x' },
  { speed: 4, label: '4x' },
  { speed: 10, label: '10x' },
  { speed: 60, label: '1m/s' },
]

export function HUD({ game }: HUDProps) {
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [, forceUpdate] = useState(0)
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    stage: '',
    progress: 0,
  })
  const perf = game?.getPerfStats() ?? null
  const streaming = game?.getStreamingStats() ?? null
  type PerfWithMemory = Performance & { memory?: { usedJSHeapSize: number } }
  const jsHeapMb = (() => {
    const perfWithMemory = performance as PerfWithMemory
    const heap = perfWithMemory.memory?.usedJSHeapSize
    if (typeof heap !== 'number' || heap <= 0) return null
    return Math.round(heap / 1024 / 1024)
  })()

  useEffect(() => {
    if (!game) return

    // Set up callbacks
    game.setCallbacks({
      onLoadingChange: setLoadingState,
    })

    // Set initial game state
    setGameState(game.getState())

    // Poll game state for updates - force re-render to pick up changes
    const interval = setInterval(() => {
      forceUpdate((n) => n + 1)
    }, 100)

    return () => clearInterval(interval)
  }, [game])

  const handleSpeedChange = (speed: number) => {
    if (!game) return
    if (speed === 0) {
      if (!game.getState().time.paused) {
        game.togglePause()
      }
    } else {
      if (game.getState().time.paused) {
        game.togglePause()
      }
      game.setTimeSpeed(speed)
    }
  }

  const formatMoney = (amount: number): string => {
    if (amount >= 1_000_000) {
      return `€${(amount / 1_000_000).toFixed(1)}M`
    }
    if (amount >= 1_000) {
      return `€${(amount / 1_000).toFixed(0)}K`
    }
    return `€${amount.toFixed(0)}`
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Loading overlay */}
      {loadingState.isLoading && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-db-dark p-6 text-center">
            <div className="mb-4 h-8 w-8 mx-auto animate-spin rounded-full border-4 border-db-red border-t-transparent" />
            <p className="text-db-gray-light capitalize">{loadingState.stage}</p>
            <div className="mt-2 h-2 w-48 bg-db-gray-dark rounded overflow-hidden">
              <div
                className="h-full bg-db-red transition-all duration-300"
                style={{ width: `${loadingState.progress * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Top HUD bar */}
      <div className="pointer-events-auto absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-gradient-to-b from-black/60 to-transparent">
        {/* Left: Time display */}
        <div className="flex items-center gap-4">
          {gameState && (
            <>
              <div className="text-white font-mono">
                <div className="text-2xl font-bold">{gameState.getFormattedTime()}</div>
                <div className="text-xs text-db-gray-light">{gameState.getFormattedDate()}</div>
              </div>

              {/* Time controls */}
              <div className="flex gap-1">
                {TIME_SPEEDS.map(({ speed, label }) => {
                  const isActive =
                    speed === 0
                      ? gameState.time.paused
                      : !gameState.time.paused && gameState.time.speed === speed
                  return (
                    <button
                      type="button"
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-db-red text-white'
                          : 'bg-db-gray-dark/80 text-db-gray-light hover:bg-db-gray-dark'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Right: Resources */}
        <div className="flex items-center gap-6">
          {gameState && (
            <>
              <div className="text-right">
                <div className="text-xs text-db-gray-light">Balance</div>
                <div className="text-xl font-bold text-green-400">
                  {formatMoney(gameState.resources.money)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-db-gray-light">Reputation</div>
                <div className="text-xl font-bold text-db-petrol">
                  {gameState.resources.reputation}%
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom HUD bar - Stats */}
      {game && !loadingState.isLoading && (
        <div className="pointer-events-auto absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-gradient-to-t from-black/60 to-transparent text-xs text-db-gray-light">
          <div className="flex gap-4">
            {game.getRegionData() && (
              <>
                <span>
                  Region:{' '}
                  {getAvailableRegions().find((r) => r.id === game.getRegionData()?.id)?.name ??
                    game.getRegionData()?.id}
                </span>
                <span>Tracks: {game.getRegionData()?.tracks.length.toLocaleString()}</span>
                <span>Stations: {game.getRegionData()?.stations.length.toLocaleString()}</span>
              </>
            )}
            {perf && (
              <>
                <span>
                  FPS: {Number.isFinite(perf.fpsEstimate) ? perf.fpsEstimate.toFixed(0) : '—'}/
                  {perf.targetFps}
                </span>
                <span>Render: {perf.avgRenderMs.toFixed(1)}ms</span>
                <span>Sim: {perf.avgSimMs.toFixed(1)}ms</span>
                {jsHeapMb !== null && jsHeapMb > 0 && <span>Heap: {jsHeapMb}MB</span>}
              </>
            )}
            {streaming && <span>Chunks: {streaming.loadedChunks}</span>}
          </div>
          <div>
            {perf && (
              <button
                type="button"
                onClick={() => game.setLowPowerMode(!perf.lowPowerMode)}
                className="mr-3 rounded bg-db-gray-dark/70 px-2 py-1 text-db-gray-light hover:bg-db-gray-dark"
              >
                {perf.lowPowerMode ? 'Low Power: ON' : 'Low Power: OFF'}
              </button>
            )}
            <span>Scroll to zoom • Drag to pan</span>
          </div>
        </div>
      )}
    </div>
  )
}
