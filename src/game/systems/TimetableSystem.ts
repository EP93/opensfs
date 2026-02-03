/**
 * TimetableSystem - Manages train schedules and spawning based on real Fahrplan data.
 */

import type {
  DepartureBoardEntry,
  LineDefinition,
  TaktTemplate,
  TimetableEntry,
  TimetableStop,
} from '@/types/timetable'
import type { TrainState } from '@/types/train'
import type { PlannedStopConstraint, TrackGraph } from '../graph/TrackGraph'
import type { TrainRegistry } from '../registries/TrainRegistry'

/** Timetable system configuration */
export interface TimetableConfig {
  /** How far ahead to generate timetable entries (in minutes) */
  lookAheadMinutes: number
  /** How far ahead to spawn trains (in minutes before departure) */
  spawnAheadMinutes: number
  /** Default turnaround time at terminus (in minutes) */
  turnaroundMinutesDefault: number
  /** Turnaround overrides by station ID */
  turnaroundMinutesByStationId: Record<string, number>
}

const DEFAULT_CONFIG: TimetableConfig = {
  lookAheadMinutes: 120,
  spawnAheadMinutes: 60, // Spawn trains up to 1 hour before departure
  turnaroundMinutesDefault: 6,
  turnaroundMinutesByStationId: {
    'station-node/3080746010': 12, // Basel Bad Bf
    'station-node/21769883': 8, // Freiburg Hbf
    'station-node/2931428598': 8, // Offenburg
    'station-node/2574283615': 12, // Karlsruhe Hbf
  },
}

export class TimetableSystem {
  private lines: Map<string, LineDefinition> = new Map()
  private timetableEntries: Map<string, TimetableEntry> = new Map()
  private spawnedTrains: Set<string> = new Set() // Track which entries have spawned trains
  private config: TimetableConfig
  private sortedByDeparture: Array<{ id: string; departureTimeMs: number }> = []
  private spawnCursor = 0
  private trainIdByEntryId: Map<string, string> = new Map()
  private entryIdByTrainId: Map<string, string> = new Map()
  private platformPlanByLineDir: Map<string, Array<string | null>> = new Map()

  private trackGraph: TrackGraph
  private trainRegistry: TrainRegistry

  constructor(
    trackGraph: TrackGraph,
    trainRegistry: TrainRegistry,
    config: Partial<TimetableConfig> = {}
  ) {
    this.trackGraph = trackGraph
    this.trainRegistry = trainRegistry
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Register a line definition
   */
  registerLine(line: LineDefinition): void {
    this.lines.set(line.id, line)
    this.ensurePlatformPlans(line)
  }

  /**
   * Get a line definition
   */
  getLine(lineId: string): LineDefinition | undefined {
    return this.lines.get(lineId)
  }

  /**
   * Get all registered lines
   */
  getAllLines(): LineDefinition[] {
    return Array.from(this.lines.values())
  }

  getTurnaroundSeconds(stationId: string): number {
    const override = stationId ? this.config.turnaroundMinutesByStationId[stationId] : undefined
    const minutes = typeof override === 'number' ? override : this.config.turnaroundMinutesDefault
    return Math.max(0, minutes) * 60
  }

  /**
   * Generate timetable entries for a given date/time range using Taktfahrplan
   */
  generateTimetable(date: Date): void {
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)

    for (const line of this.lines.values()) {
      this.generateLineEntries(line, startOfDay)
    }

    this.rebuildSpawnIndex()
  }

  /**
   * Spawn an initial set of trains (e.g. starting services for a new game).
   * This does not advance time; it simply creates train instances early so the org has services immediately.
   */
  spawnInitialTrains(
    currentTime: Date,
    options: { windowMinutes: number; perLine: number; maxTotal: number }
  ): number {
    const { windowMinutes, perLine, maxTotal } = options

    if (this.sortedByDeparture.length === 0 && this.timetableEntries.size > 0) {
      this.rebuildSpawnIndex()
    }

    const currentTimeMs = currentTime.getTime()
    const windowEndMs = currentTimeMs + windowMinutes * 60 * 1000

    const perLineCounts = new Map<string, number>()
    let spawned = 0

    for (const item of this.sortedByDeparture) {
      if (spawned >= maxTotal) break
      if (item.departureTimeMs > windowEndMs) break

      const entry = this.timetableEntries.get(item.id)
      if (!entry || entry.canceled) continue
      if (this.spawnedTrains.has(entry.id)) continue
      if (item.departureTimeMs < currentTimeMs) continue

      const count = perLineCounts.get(entry.lineId) ?? 0
      if (count >= perLine) continue

      this.spawnTrain(entry)
      perLineCounts.set(entry.lineId, count + 1)
      spawned++
    }

    return spawned
  }

  private debugLogged = false

  /**
   * Update the timetable system - spawn trains that are due to depart
   */
  update(currentTime: Date): number {
    const spawnThreshold = new Date(
      currentTime.getTime() + this.config.spawnAheadMinutes * 60 * 1000
    )
    let spawnedCount = 0

    // Debug logging (once)
    if (!this.debugLogged) {
      console.log(`Timetable update: ${this.timetableEntries.size} entries`)
      console.log(`Current time: ${currentTime.toLocaleTimeString()}`)
      console.log(`Spawn threshold: ${spawnThreshold.toLocaleTimeString()}`)
      this.debugLogged = true
    }

    if (this.sortedByDeparture.length === 0 && this.timetableEntries.size > 0) {
      this.rebuildSpawnIndex()
    }

    const currentTimeMs = currentTime.getTime()
    const spawnThresholdMs = spawnThreshold.getTime()

    while (this.spawnCursor < this.sortedByDeparture.length) {
      const next = this.sortedByDeparture[this.spawnCursor]
      if (!next) break
      if (next.departureTimeMs > spawnThresholdMs) break

      const entry = this.timetableEntries.get(next.id)

      // Spawn if within threshold and not in the past
      if (
        entry &&
        !entry.canceled &&
        !this.spawnedTrains.has(entry.id) &&
        next.departureTimeMs > currentTimeMs
      ) {
        this.spawnTrain(entry)
        spawnedCount++
      }

      // Move cursor forward; each entry is considered at most once.
      this.spawnCursor++
    }

    return spawnedCount
  }

  /**
   * Get departure board for a station
   */
  getDepartureBoard(stationId: string, currentTime: Date, limit = 10): DepartureBoardEntry[] {
    const entries: DepartureBoardEntry[] = []
    const lookAheadTime = new Date(currentTime.getTime() + this.config.lookAheadMinutes * 60 * 1000)

    for (const entry of this.timetableEntries.values()) {
      if (entry.canceled) continue

      // Find this station in the entry's stops
      const stopIndex = entry.stops.findIndex((s) => s.stationId === stationId)
      if (stopIndex === -1) continue

      const stop = entry.stops[stopIndex]
      if (!stop || stop.departureMinutes === null) continue // Last stop - no departure

      const scheduledTime = this.minutesToDate(entry.date, stop.departureMinutes)

      // Skip if outside time window
      if (scheduledTime < currentTime || scheduledTime > lookAheadTime) continue

      // Find the train if it exists
      const existingTrain = this.findTrainForEntry(entry.id)
      const delay = existingTrain?.delay ?? 0
      const expectedTime = new Date(scheduledTime.getTime() + delay * 1000)

      // Get destination (last stop)
      const lastStop = entry.stops[entry.stops.length - 1]
      const destination = lastStop?.stationName ?? 'Unknown'

      const line = this.lines.get(entry.lineId)

      entries.push({
        lineId: entry.lineId,
        lineDisplay: line?.name ?? entry.lineId,
        destination,
        scheduledTime,
        expectedTime,
        platform: stop.platform,
        delayMinutes: Math.round(delay / 60),
        status: this.getDelayStatus(delay),
        trainId: existingTrain?.id ?? null,
      })
    }

    // Sort by expected time
    entries.sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime())

    return entries.slice(0, limit)
  }

  /**
   * Get all timetable entries for a line
   */
  getEntriesForLine(lineId: string): TimetableEntry[] {
    return Array.from(this.timetableEntries.values()).filter((e) => e.lineId === lineId)
  }

  /**
   * Clear all timetable entries
   */
  clearEntries(): void {
    this.timetableEntries.clear()
    this.spawnedTrains.clear()
    this.sortedByDeparture = []
    this.spawnCursor = 0
    this.trainIdByEntryId.clear()
    this.entryIdByTrainId.clear()
  }

  // Private methods

  private generateLineEntries(line: LineDefinition, date: Date): void {
    const { taktTemplate, bidirectional } = line

    // Generate forward direction entries
    this.generateDirectionEntries(line, date, taktTemplate, false)

    // Generate reverse direction entries if bidirectional
    if (bidirectional) {
      this.generateDirectionEntries(line, date, taktTemplate, true)
    }
  }

  private generateDirectionEntries(
    line: LineDefinition,
    date: Date,
    template: TaktTemplate,
    reverse: boolean
  ): void {
    const { firstHour, lastHour, intervalMinutes, departureMinute, operatingDays } = template

    // Check if this day of week operates
    const dayOfWeek = date.getDay()
    if (!operatingDays.includes(dayOfWeek)) return

    let trainNumber = reverse ? 2000 : 1000 // Offset for reverse direction

    for (let hour = firstHour; hour <= lastHour; hour++) {
      const departureMinutes = hour * 60 + departureMinute

      // Generate multiple departures per hour if interval < 60
      const departuresPerHour = Math.floor(60 / intervalMinutes)
      for (let i = 0; i < departuresPerHour; i++) {
        const adjustedDepartureMinutes = departureMinutes + i * intervalMinutes

        if (adjustedDepartureMinutes >= (lastHour + 1) * 60) break

        const entryId = `${line.id}-${trainNumber}-${date.toISOString().slice(0, 10)}`

        const stops = this.generateStops(line, adjustedDepartureMinutes, reverse)

        const entry: TimetableEntry = {
          id: entryId,
          lineId: line.id,
          trainNumber,
          date,
          typeId: line.defaultTypeId,
          units: line.defaultUnits,
          stops,
          canceled: false,
        }

        this.timetableEntries.set(entryId, entry)
        trainNumber++
      }
    }
  }

  private generateStops(
    line: LineDefinition,
    departureMinutes: number,
    reverse: boolean
  ): TimetableStop[] {
    const stops: TimetableStop[] = []
    const route = reverse ? [...line.route].reverse() : line.route
    const stationNames = reverse ? [...line.stationNames].reverse() : line.stationNames
    const journeyTimes = reverse ? [...line.journeyTimes].reverse() : line.journeyTimes
    const dwellTimes = reverse ? [...line.dwellTimes].reverse() : line.dwellTimes

    // Recalculate journey times for reverse direction
    const adjustedJourneyTimes = reverse
      ? this.recalculateJourneyTimesReverse(line.journeyTimes)
      : journeyTimes

    const planKey = this.platformPlanKey(line.id, reverse)
    const platformPlan = this.platformPlanByLineDir.get(planKey)

    for (let i = 0; i < route.length; i++) {
      const stationId = route[i]
      const stationName = stationNames[i]
      const journeyTime = adjustedJourneyTimes[i] ?? 0
      const dwellTime = dwellTimes[i] ?? 0

      if (!stationId || !stationName) continue

      const isFirst = i === 0
      const isLast = i === route.length - 1

      const arrivalMinutes = isFirst ? null : departureMinutes + journeyTime
      const stopDepartureMinutes = isLast ? null : departureMinutes + journeyTime + dwellTime

      stops.push({
        stationId,
        stationName,
        arrivalMinutes,
        departureMinutes: stopDepartureMinutes,
        platform: platformPlan?.[i] ?? null,
        requestStop: false,
      })
    }

    return stops
  }

  private recalculateJourneyTimesReverse(forwardJourneyTimes: number[]): number[] {
    if (forwardJourneyTimes.length < 2) return [0]

    const totalTime = forwardJourneyTimes[forwardJourneyTimes.length - 1] ?? 0
    const reverseTimes: number[] = [0]

    for (let i = forwardJourneyTimes.length - 2; i >= 0; i--) {
      const forwardTime = forwardJourneyTimes[i] ?? 0
      reverseTimes.push(totalTime - forwardTime)
    }

    return reverseTimes
  }

  private ensurePlatformPlans(line: LineDefinition): void {
    this.platformPlanByLineDir.set(
      this.platformPlanKey(line.id, false),
      this.buildPlatformPlanForRoute(line.route)
    )

    if (line.bidirectional) {
      this.platformPlanByLineDir.set(
        this.platformPlanKey(line.id, true),
        this.buildPlatformPlanForRoute([...line.route].reverse())
      )
    }
  }

  private buildPlatformPlanForRoute(route: string[]): Array<string | null> {
    if (route.length === 0) return []

    const plannedStops: PlannedStopConstraint[] = route.map((stationId) => ({
      stationId,
      platform: null,
    }))

    const destinationStationId = route[route.length - 1] ?? null
    if (!destinationStationId) return route.map(() => null)

    const { path, chosenStopNodeIds } = this.trackGraph.buildPathForPlannedStops(
      plannedStops,
      destinationStationId
    )

    if (!path.found || chosenStopNodeIds.length !== route.length) {
      return route.map(() => null)
    }

    return chosenStopNodeIds.map((nodeId) => this.trackGraph.getStopPlatformRef(nodeId))
  }

  private platformPlanKey(lineId: string, reverse: boolean): string {
    return `${lineId}|${reverse ? 'rev' : 'fwd'}`
  }

  private findReusableTrain(
    originStationId: string,
    entry: TimetableEntry,
    departureTime: Date
  ): TrainState | null {
    const candidates = this.trainRegistry
      .getByStation(originStationId)
      .filter((t) => t.state === 'turnaround')
      .filter((t) => t.consist.typeSpec.id === entry.typeId && t.consist.units === entry.units)
      .filter((t) => !t.availableForServiceAt || t.availableForServiceAt <= departureTime)

    if (candidates.length === 0) return null

    candidates.sort((a, b) => {
      const ad = a.availableForServiceAt?.getTime() ?? 0
      const bd = b.availableForServiceAt?.getTime() ?? 0
      if (ad !== bd) return ad - bd
      return a.id.localeCompare(b.id)
    })

    return candidates[0] ?? null
  }

  private spawnTrain(entry: TimetableEntry): void {
    const line = this.lines.get(entry.lineId)
    if (!line) {
      console.warn(`Cannot spawn train: unknown line ${entry.lineId}`)
      return
    }

    const originStationId = entry.stops[0]?.stationId
    const destinationStationId = entry.stops[entry.stops.length - 1]?.stationId

    if (!originStationId || !destinationStationId) {
      console.warn(`Cannot spawn train: missing origin/destination`)
      return
    }

    const firstStop = entry.stops[0]
    const departureTime = this.minutesToDate(entry.date, firstStop?.departureMinutes ?? 0)

    const plannedStops: PlannedStopConstraint[] = entry.stops.map((s) => ({
      stationId: s.stationId,
      platform: s.platform,
    }))

    // Try to reuse a trainset that is already waiting at this origin station.
    const reusable = this.findReusableTrain(originStationId, entry, departureTime)
    if (reusable) {
      const departurePlatform =
        reusable.lastStopNodeId !== null
          ? this.trackGraph.getStopPlatformRef(reusable.lastStopNodeId)
          : null

      const reuseStops: PlannedStopConstraint[] = plannedStops.map((s, i) => ({
        stationId: s.stationId,
        platform: i === 0 ? (departurePlatform ?? s.platform) : s.platform,
      }))

      let { path } = this.trackGraph.buildPathForPlannedStops(reuseStops, destinationStationId)
      if (!path.found) {
        path = this.trackGraph.findPath(originStationId, destinationStationId)
      }

      if (path.found) {
        const ok = this.trainRegistry.reassignService(reusable.id, {
          lineId: entry.lineId,
          trainNumber: entry.trainNumber,
          timetableEntryId: entry.id,
          originStationId,
          destinationStationId,
          scheduledDeparture: departureTime,
          path,
          state: 'preparing',
        })

        if (ok) {
          const previousEntryId = this.entryIdByTrainId.get(reusable.id)
          if (previousEntryId) this.trainIdByEntryId.delete(previousEntryId)

          this.spawnedTrains.add(entry.id)
          this.trainIdByEntryId.set(entry.id, reusable.id)
          this.entryIdByTrainId.set(reusable.id, entry.id)

          console.log(
            `Reassigned train ${reusable.id} to ${entry.lineId} (${originStationId} → ${destinationStationId})`
          )
          return
        }
      }
    }

    // Otherwise spawn a new physical train.
    let { path } = this.trackGraph.buildPathForPlannedStops(plannedStops, destinationStationId)
    if (!path.found) {
      path = this.trackGraph.findPath(originStationId, destinationStationId)
      if (!path.found) {
        console.warn(
          `Cannot spawn train: no path from ${originStationId} to ${destinationStationId}`
        )
        return
      }
    }

    const train = this.trainRegistry.create({
      typeId: entry.typeId,
      units: entry.units,
      lineId: entry.lineId,
      trainNumber: entry.trainNumber,
      originStationId,
      destinationStationId,
      path,
      scheduledDeparture: departureTime,
      timetableEntryId: entry.id,
    })

    if (train) {
      this.spawnedTrains.add(entry.id)
      this.trainIdByEntryId.set(entry.id, train.id)
      this.entryIdByTrainId.set(train.id, entry.id)
      console.log(
        `Spawned train ${train.id} for ${entry.lineId} (${originStationId} → ${destinationStationId})`
      )
    }
  }

  getEntry(entryId: string): TimetableEntry | null {
    return this.timetableEntries.get(entryId) ?? null
  }

  getEntryForTrain(trainId: string): TimetableEntry | null {
    const entryId = this.entryIdByTrainId.get(trainId)
    if (!entryId) return null
    return this.getEntry(entryId)
  }

  private findTrainForEntry(entryId: string): { id: string; delay: number } | null {
    const trainId = this.trainIdByEntryId.get(entryId)
    if (!trainId) return null
    const train = this.trainRegistry.get(trainId)
    if (!train) return null
    return { id: train.id, delay: train.delay }
  }

  private minutesToDate(baseDate: Date, minutes: number): Date {
    const date = new Date(baseDate)
    date.setHours(0, 0, 0, 0)
    date.setMinutes(minutes)
    return date
  }

  private minutesToEpochMs(baseDate: Date, minutes: number): number {
    const date = new Date(baseDate)
    date.setHours(0, 0, 0, 0)
    return date.getTime() + minutes * 60 * 1000
  }

  private getDepartureTimeMs(entry: TimetableEntry): number | null {
    const firstStop = entry.stops[0]
    if (!firstStop || firstStop.departureMinutes === null) return null
    return this.minutesToEpochMs(entry.date, firstStop.departureMinutes)
  }

  private rebuildSpawnIndex(): void {
    const sortable: Array<{ id: string; departureTimeMs: number }> = []

    for (const entry of this.timetableEntries.values()) {
      const departureTimeMs = this.getDepartureTimeMs(entry)
      if (departureTimeMs === null) continue
      sortable.push({ id: entry.id, departureTimeMs })
    }

    sortable.sort((a, b) => {
      const diff = a.departureTimeMs - b.departureTimeMs
      return diff !== 0 ? diff : a.id.localeCompare(b.id)
    })

    this.sortedByDeparture = sortable
    this.spawnCursor = 0
  }

  private getDelayStatus(delaySeconds: number): string {
    if (delaySeconds < 60) return 'On time'
    const minutes = Math.round(delaySeconds / 60)
    if (minutes <= 5) return `+${minutes} min`
    return `Delayed +${minutes} min`
  }
}
