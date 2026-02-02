import { useEffect, useMemo } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useFollowTrainId } from '@/hooks/useFollowTrain'
import { useTrainSnapshots } from '@/hooks/useTrainSnapshots'
import { useRuntimeStore } from '@/stores/useRuntimeStore'
import { useUIStore } from '@/stores/useUIStore'
import type { TimetableEntry, TimetableStop } from '@/types/timetable'

function formatDelay(delaySeconds: number): string {
  const minutes = Math.round(delaySeconds / 60)
  if (minutes === 0) return 'On time'
  return minutes > 0 ? `+${minutes} min` : `${minutes} min`
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function loadBarClass(loadRatio: number): string {
  if (loadRatio < 0.4) return 'bg-emerald-500'
  if (loadRatio < 0.7) return 'bg-yellow-500'
  if (loadRatio < 0.9) return 'bg-orange-500'
  return 'bg-db-red'
}

function getNextStopIndex(entry: TimetableEntry, currentStopIndex: number, state: string): number {
  if (entry.stops.length === 0) return -1

  // While preparing/at origin or standing at station, treat the "next" stop as the current one.
  if (state === 'preparing' || state === 'at_station') {
    return Math.min(currentStopIndex, entry.stops.length - 1)
  }

  // Otherwise next stop is the one after the last reached stop.
  return Math.min(currentStopIndex + 1, entry.stops.length - 1)
}

function stopDisplayName(stop: TimetableStop): string {
  return stop.stationName !== 'Unknown' ? stop.stationName : stop.stationId
}

export function TrainDetailsSheet() {
  const game = useRuntimeStore((s) => s.game)
  const trains = useTrainSnapshots()
  const followTrainId = useFollowTrainId()
  const selectedTrainId = useUIStore((s) => s.selectedTrainId)
  const clearSelectedTrain = useUIStore((s) => s.clearSelectedTrain)

  const selected = useMemo(() => {
    if (!selectedTrainId) return null
    return trains.find((t) => t.id === selectedTrainId) ?? null
  }, [selectedTrainId, trains])

  const timetableEntry = useMemo(() => {
    if (!game || !selectedTrainId) return null
    return game.getTimetableEntryForTrain(selectedTrainId)
  }, [game, selectedTrainId])

  const nextStopIndex = useMemo(() => {
    if (!selected || !timetableEntry) return null
    return getNextStopIndex(timetableEntry, selected.currentStopIndex, selected.state)
  }, [selected, timetableEntry])

  const nextStop = useMemo(() => {
    if (!timetableEntry || nextStopIndex === null || nextStopIndex < 0) return null
    return timetableEntry.stops[nextStopIndex] ?? null
  }, [timetableEntry, nextStopIndex])

  useEffect(() => {
    if (!game) return
    game.setSelectedTrain(selectedTrainId)
  }, [game, selectedTrainId])

  const open = selectedTrainId !== null
  const isFollowing = selectedTrainId !== null && followTrainId === selectedTrainId

  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          clearSelectedTrain()
          game?.setSelectedTrain(null)
          if (selectedTrainId && game?.getFollowTrainId() === selectedTrainId) {
            game.setFollowTrain(null)
          }
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-[460px] bg-db-dark border-db-gray-dark max-h-[100dvh] overflow-y-auto"
        onInteractOutside={(event) => {
          // Keep the train sheet open while the user interacts with the map/time controls.
          event.preventDefault()
        }}
      >
        <SheetHeader>
          <SheetTitle className="text-white text-xl">Train</SheetTitle>
          <SheetDescription className="text-db-gray-light">
            {selected ? `${selected.lineId} ${selected.trainNumber}` : selectedTrainId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {!selected && selectedTrainId && (
            <div className="text-sm text-db-gray">
              Waiting for live data for <span className="font-mono">{selectedTrainId}</span>…
            </div>
          )}

          {selected && (
            <>
              {timetableEntry && nextStop && (
                <section className="rounded border border-db-gray-dark bg-db-gray-dark/10 p-3">
                  <div className="text-xs text-db-gray-light">Next stop</div>
                  <div className="mt-1 flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-white font-medium truncate">
                        {stopDisplayName(nextStop)}
                      </div>
                      <div className="text-xs text-db-gray font-mono truncate">
                        {nextStop.stationId}
                      </div>
                    </div>
                    <div className="text-right text-xs text-db-gray-light font-mono">
                      arr {formatMinutes(nextStop.arrivalMinutes)} • dep{' '}
                      {formatMinutes(nextStop.departureMinutes)} • Gleis {nextStop.platform ?? '—'}
                    </div>
                  </div>
                </section>
              )}

              {timetableEntry && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                    Route
                  </h3>
                  <div className="rounded border border-db-gray-dark bg-db-gray-dark/10 overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 bg-db-gray-dark/40 px-3 py-2 text-xs text-db-gray-light">
                      <div>Stop</div>
                      <div className="text-right">Arr</div>
                      <div className="text-right">Dep</div>
                      <div className="text-right">Gleis</div>
                    </div>

                    <div className="max-h-[30vh] overflow-auto">
                      {timetableEntry.stops.map((stop, index) => {
                        const isActive = index === nextStopIndex
                        return (
                          <div
                            key={`${stop.stationId}-${String(index)}`}
                            className={`grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-sm border-t border-db-gray-dark/60 ${
                              isActive ? 'bg-db-gray-dark/40' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-white truncate">{stopDisplayName(stop)}</div>
                              <div className="text-xs text-db-gray font-mono truncate">
                                {stop.stationId}
                              </div>
                            </div>
                            <div className="text-right text-db-gray-light font-mono text-xs">
                              {formatMinutes(stop.arrivalMinutes)}
                            </div>
                            <div className="text-right text-db-gray-light font-mono text-xs">
                              {formatMinutes(stop.departureMinutes)}
                            </div>
                            <div className="text-right text-db-gray-light font-mono text-xs">
                              {stop.platform ?? '—'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                  Service
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Type</dt>
                    <dd className="text-white text-right">{selected.typeName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Units</dt>
                    <dd className="text-white text-right">{selected.units}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">State</dt>
                    <dd className="text-white text-right capitalize">
                      {selected.state.replace('_', ' ')}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Speed</dt>
                    <dd className="text-white text-right">
                      {Math.round(selected.currentSpeedKmh)} km/h
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Delay</dt>
                    <dd className="text-white text-right">{formatDelay(selected.delaySeconds)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Load</dt>
                    <dd className="text-white text-right">{formatPercent(selected.loadFactor)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Departure</dt>
                    <dd className="text-white text-right font-mono">
                      {selected.scheduledDeparture.toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                  Consist
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Length</dt>
                    <dd className="text-white text-right">
                      {selected.totalLengthMeters.toFixed(1)} m
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Seated</dt>
                    <dd className="text-white text-right">{selected.totalSeatedCapacity}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">Standing</dt>
                    <dd className="text-white text-right">{selected.totalStandingCapacity}</dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                  Cars
                </h3>
                <div className="rounded border border-db-gray-dark bg-db-gray-dark/10 overflow-hidden">
                  {selected.cars.map((car) => {
                    const capacityTotal =
                      car.capacity.seatedFirstClass +
                      car.capacity.seatedSecondClass +
                      car.capacity.standing
                    return (
                      <div
                        key={`${car.number}-${car.id}`}
                        className="border-t border-db-gray-dark/60 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-4 text-sm">
                          <div className="text-white">
                            Car {car.number} • {car.class}
                          </div>
                          <div className="text-db-gray-light text-xs">
                            {car.occupancy.total}/{capacityTotal}
                          </div>
                        </div>
                        <div className="mt-2 h-2 rounded bg-db-gray-dark/60 overflow-hidden">
                          <div
                            className={`h-full ${loadBarClass(car.occupancy.loadRatio)}`}
                            style={{ width: `${Math.round(car.occupancy.loadRatio * 100)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-db-gray-light">
                          <div>
                            {car.capacity.seatedFirstClass + car.capacity.seatedSecondClass} seated
                            • {car.capacity.standing} standing
                          </div>
                          <div>{formatPercent(car.occupancy.loadRatio)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                  Endpoints
                </h3>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">From</dt>
                    <dd className="text-white text-right">
                      <div className="text-sm">
                        {timetableEntry?.stops[0] ? stopDisplayName(timetableEntry.stops[0]) : '—'}
                      </div>
                      <div className="font-mono text-xs text-db-gray break-all">
                        {selected.originStationId}
                      </div>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-db-gray">To</dt>
                    <dd className="text-white text-right">
                      <div className="text-sm">
                        {(() => {
                          const lastStop = timetableEntry?.stops[timetableEntry.stops.length - 1]
                          return lastStop ? stopDisplayName(lastStop) : '—'
                        })()}
                      </div>
                      <div className="font-mono text-xs text-db-gray break-all">
                        {selected.destinationStationId}
                      </div>
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-db-gray-light uppercase tracking-wide">
                  Actions
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => selectedTrainId && game?.toggleFollowTrain(selectedTrainId)}
                    className="rounded bg-db-red px-3 py-2 text-sm font-medium text-white hover:bg-db-red/90"
                  >
                    {isFollowing ? 'Stop following' : 'Follow on map'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearSelectedTrain()
                      game?.setSelectedTrain(null)
                      if (selectedTrainId && game?.getFollowTrainId() === selectedTrainId) {
                        game.setFollowTrain(null)
                      }
                    }}
                    className="rounded bg-db-gray-dark/80 px-3 py-2 text-sm font-medium text-db-gray-light hover:bg-db-gray-dark"
                  >
                    Close
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
