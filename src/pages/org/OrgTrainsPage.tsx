import { useMemo, useState } from 'react'
import { useTrainSnapshots } from '@/hooks/useTrainSnapshots'
import { useRuntimeStore } from '@/stores/useRuntimeStore'
import { useUIStore } from '@/stores/useUIStore'

function formatDelay(delaySeconds: number): string {
  const minutes = Math.round(delaySeconds / 60)
  if (minutes === 0) return 'On time'
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`
}

export function OrgTrainsPage() {
  const game = useRuntimeStore((s) => s.game)
  const trains = useTrainSnapshots()
  const selectedTrainId = useUIStore((s) => s.selectedTrainId)
  const selectTrain = useUIStore((s) => s.selectTrain)

  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return trains
    return trains.filter((t) => {
      return (
        t.id.toLowerCase().includes(q) ||
        t.lineId.toLowerCase().includes(q) ||
        String(t.trainNumber).includes(q) ||
        t.typeName.toLowerCase().includes(q) ||
        t.originStationId.toLowerCase().includes(q) ||
        t.destinationStationId.toLowerCase().includes(q)
      )
    })
  }, [query, trains])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Trains</h2>
        <p className="mt-1 text-sm text-db-gray-light">
          Live roster (active services). Click a train for details.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trains, lines, IDs…"
          className="w-full rounded border border-db-gray-dark bg-db-gray-dark/30 px-3 py-2 text-sm text-white placeholder:text-db-gray focus:outline-none focus:ring-2 focus:ring-db-red/60"
        />
        <button
          type="button"
          onClick={() => setQuery('')}
          className="rounded border border-db-gray-dark bg-db-gray-dark/30 px-3 py-2 text-sm text-db-gray-light hover:bg-db-gray-dark/60"
        >
          Clear
        </button>
      </div>

      <div className="rounded border border-db-gray-dark overflow-hidden">
        <div className="grid grid-cols-[1.3fr_1.7fr_1.2fr_1fr_0.9fr] gap-2 bg-db-gray-dark/40 px-3 py-2 text-xs text-db-gray-light">
          <div>Service</div>
          <div>Route</div>
          <div>Status</div>
          <div>Speed</div>
          <div className="text-right">Action</div>
        </div>

        <div className="max-h-[65vh] overflow-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-sm text-db-gray text-center">No matching trains.</div>
          )}

          {filtered.map((t) => {
            const isSelected = t.id === selectedTrainId
            const status = `${t.state.replace('_', ' ')} • ${formatDelay(t.delaySeconds)}`
            const route = `${t.originStationId} → ${t.destinationStationId}`
            const departure = t.scheduledDeparture.toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <button
                type="button"
                key={t.id}
                onClick={() => selectTrain(t.id)}
                className={`grid w-full grid-cols-[1.3fr_1.7fr_1.2fr_1fr_0.9fr] items-center gap-2 px-3 py-2 text-left text-sm border-t border-db-gray-dark/60 hover:bg-db-gray-dark/30 ${
                  isSelected ? 'bg-db-gray-dark/40' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="text-white font-medium truncate">
                    {t.lineId} {t.trainNumber}
                  </div>
                  <div className="text-xs text-db-gray truncate">
                    {t.typeName} • {t.units}u • dep {departure}
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-white truncate">{route}</div>
                  <div className="text-xs text-db-gray truncate">{t.id}</div>
                </div>

                <div className="text-db-gray-light capitalize">{status}</div>
                <div className="text-db-gray-light">{Math.round(t.currentSpeedKmh)} km/h</div>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectTrain(t.id)
                      game?.focusOnTrain(t.id)
                    }}
                    className="inline-flex items-center justify-center rounded bg-db-red px-2 py-1 text-xs font-medium text-white hover:bg-db-red/90"
                  >
                    Focus
                  </button>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
