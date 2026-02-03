/**
 * Train Registry - Central registry for active train instances.
 * Manages train lifecycle and provides query methods.
 */

import type { OperationalState, TrainState, TrainTypeId, WorldPosition } from '@/types/train'
import type { PathResult } from '../graph/TrackGraph'
import type { TrainTypeRegistry } from './TrainTypeRegistry'

/** Train creation options */
export interface TrainCreateOptions {
  /** Train type ID */
  typeId: TrainTypeId
  /** Number of units */
  units: number
  /** Line ID */
  lineId: string
  /** Train number */
  trainNumber: number
  /** Origin station ID */
  originStationId: string
  /** Destination station ID */
  destinationStationId: string
  /** Path from origin to destination */
  path: PathResult
  /** Scheduled departure time */
  scheduledDeparture: Date
  /** Timetable entry ID backing this service */
  timetableEntryId: string
}

export class TrainRegistry {
  private trains: Map<string, TrainState> = new Map()
  private trainIdCounter = 0
  private trainTypeRegistry: TrainTypeRegistry

  // Indices for fast lookups
  private byLine: Map<string, Set<string>> = new Map()
  private byStation: Map<string, Set<string>> = new Map()
  private byState: Map<OperationalState, Set<string>> = new Map()

  constructor(trainTypeRegistry: TrainTypeRegistry) {
    this.trainTypeRegistry = trainTypeRegistry

    // Initialize state indices
    const states: OperationalState[] = [
      'depot',
      'preparing',
      'departing',
      'running',
      'approaching',
      'at_station',
      'turnaround',
      'terminated',
    ]
    for (const state of states) {
      this.byState.set(state, new Set())
    }
  }

  /**
   * Generate a DB-style train ID
   * Format: {LineId}-{TrainNumber}-{Date}
   */
  private generateTrainId(lineId: string, trainNumber: number, date: Date): string {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
    return `${lineId}-${trainNumber}-${dateStr}-${this.trainIdCounter++}`
  }

  /**
   * Create a new train
   */
  create(options: TrainCreateOptions): TrainState | null {
    const {
      typeId,
      units,
      lineId,
      trainNumber,
      originStationId,
      destinationStationId,
      path,
      scheduledDeparture,
      timetableEntryId,
    } = options

    if (!path.found) {
      console.warn(
        `Cannot create train: no path from ${originStationId} to ${destinationStationId}`
      )
      return null
    }

    const consist = this.trainTypeRegistry.createConsist(typeId, units)
    const trainId = this.generateTrainId(lineId, trainNumber, scheduledDeparture)

    // Get initial position (at origin station)
    const firstSegment = path.segments[0]
    if (!firstSegment) {
      console.warn(`Cannot create train: empty path`)
      return null
    }

    const initialWorldPosition: WorldPosition = {
      x: firstSegment.link.coordinates[0]?.[0] ?? 0,
      y: firstSegment.link.coordinates[0]?.[1] ?? 0,
      heading: 0,
    }

    const train: TrainState = {
      id: trainId,
      consist,
      lineId,
      trainNumber,
      scheduledDeparture,
      timetableEntryId,
      lastStopNodeId: null,
      availableForServiceAt: null,
      trackPosition: {
        trackId: firstSegment.link.trackId,
        offset: 0,
        direction: 1,
      },
      worldPosition: initialWorldPosition,
      currentSpeed: 0,
      targetSpeed: 0,
      state: 'preparing',
      currentStopIndex: 0,
      delay: 0,
      passengers: 0,
      loadFactor: 0,
      originStationId,
      destinationStationId,
      path: path.segments.map((s) => s.link.trackId),
      pathIndex: 0,
      pathSegmentOffset: 0,
    }

    this.initializeLoad(train)
    this.trains.set(trainId, train)
    this.addToIndices(train)

    return train
  }

  /**
   * Reassign an existing train to a new service (service chaining).
   * Ensures indices (line/state/station) stay correct.
   */
  reassignService(
    trainId: string,
    updates: {
      lineId: string
      trainNumber: number
      timetableEntryId: string
      originStationId: string
      destinationStationId: string
      scheduledDeparture: Date
      path: PathResult
      state?: OperationalState
    }
  ): boolean {
    const train = this.trains.get(trainId)
    if (!train) return false

    if (!updates.path.found || updates.path.segments.length === 0) {
      console.warn(`Cannot reassign train: empty path for ${trainId}`)
      return false
    }

    // Line index
    if (updates.lineId !== train.lineId) {
      this.byLine.get(train.lineId)?.delete(trainId)
      let lineSet = this.byLine.get(updates.lineId)
      if (!lineSet) {
        lineSet = new Set()
        this.byLine.set(updates.lineId, lineSet)
      }
      lineSet.add(trainId)
    }

    const nextState = updates.state ?? 'preparing'
    if (nextState !== train.state) {
      this.byState.get(train.state)?.delete(trainId)
      this.byState.get(nextState)?.add(trainId)
    }

    // Ensure station index points to the new origin (train must already be at this station).
    for (const stationSet of this.byStation.values()) {
      stationSet.delete(trainId)
    }
    let originSet = this.byStation.get(updates.originStationId)
    if (!originSet) {
      originSet = new Set()
      this.byStation.set(updates.originStationId, originSet)
    }
    originSet.add(trainId)

    const firstSegment = updates.path.segments[0]
    if (!firstSegment) {
      console.warn(`Cannot reassign train: empty path for ${trainId}`)
      return false
    }
    const firstWorld = firstSegment.link.coordinates[0]

    train.lineId = updates.lineId
    train.trainNumber = updates.trainNumber
    train.timetableEntryId = updates.timetableEntryId
    train.originStationId = updates.originStationId
    train.destinationStationId = updates.destinationStationId
    train.scheduledDeparture = updates.scheduledDeparture

    // Reset service/runtime fields.
    train.currentStopIndex = 0
    train.delay = 0
    train.currentSpeed = 0
    train.targetSpeed = 0
    train.state = nextState
    train.availableForServiceAt = null

    train.trackPosition = {
      trackId: firstSegment.link.trackId,
      offset: 0,
      direction: 1,
    }
    train.worldPosition = {
      x: firstWorld?.[0] ?? train.worldPosition.x,
      y: firstWorld?.[1] ?? train.worldPosition.y,
      heading: 0,
    }

    train.path = updates.path.segments.map((s) => s.link.trackId)
    train.pathIndex = 0
    train.pathSegmentOffset = 0

    this.initializeLoad(train)

    return true
  }

  /**
   * Get a train by ID
   */
  get(trainId: string): TrainState | undefined {
    return this.trains.get(trainId)
  }

  /**
   * Get all trains
   */
  getAll(): TrainState[] {
    return Array.from(this.trains.values())
  }

  /**
   * Get trains on a specific line
   */
  getByLine(lineId: string): TrainState[] {
    const ids = this.byLine.get(lineId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.trains.get(id))
      .filter((t): t is TrainState => t !== undefined)
  }

  /**
   * Get trains at or approaching a station
   */
  getByStation(stationId: string): TrainState[] {
    const ids = this.byStation.get(stationId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.trains.get(id))
      .filter((t): t is TrainState => t !== undefined)
  }

  /**
   * Get trains by operational state
   */
  getByState(state: OperationalState): TrainState[] {
    const ids = this.byState.get(state)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.trains.get(id))
      .filter((t): t is TrainState => t !== undefined)
  }

  /**
   * Get active trains (not in depot or terminated)
   */
  getActive(): TrainState[] {
    return this.getAll().filter((t) => t.state !== 'depot' && t.state !== 'terminated')
  }

  /**
   * Get active train count (not in depot or terminated) without allocations.
   */
  getActiveCount(): number {
    const depotCount = this.byState.get('depot')?.size ?? 0
    const terminatedCount = this.byState.get('terminated')?.size ?? 0
    return this.trains.size - depotCount - terminatedCount
  }

  /**
   * Update train state
   */
  update(trainId: string, updates: Partial<TrainState>): boolean {
    const train = this.trains.get(trainId)
    if (!train) return false

    // Remove from old state index
    if (updates.state && updates.state !== train.state) {
      this.byState.get(train.state)?.delete(trainId)
      this.byState.get(updates.state)?.add(trainId)
    }

    // Apply updates
    Object.assign(train, updates)
    return true
  }

  /**
   * Update train's current station (for index)
   */
  updateStationIndex(
    trainId: string,
    oldStationId: string | null,
    newStationId: string | null
  ): void {
    if (oldStationId) {
      this.byStation.get(oldStationId)?.delete(trainId)
    }
    if (newStationId) {
      let stationSet = this.byStation.get(newStationId)
      if (!stationSet) {
        stationSet = new Set()
        this.byStation.set(newStationId, stationSet)
      }
      stationSet.add(trainId)
    }
  }

  /**
   * Remove a train
   */
  remove(trainId: string): boolean {
    const train = this.trains.get(trainId)
    if (!train) return false

    this.removeFromIndices(train)
    this.trains.delete(trainId)
    return true
  }

  /**
   * Remove all terminated trains
   */
  removeTerminated(): number {
    const terminated = this.getByState('terminated')
    for (const train of terminated) {
      this.remove(train.id)
    }
    return terminated.length
  }

  /**
   * Get train count
   */
  get count(): number {
    return this.trains.size
  }

  /**
   * Get count by state
   */
  getCountByState(): Map<OperationalState, number> {
    const counts = new Map<OperationalState, number>()
    for (const [state, ids] of this.byState) {
      counts.set(state, ids.size)
    }
    return counts
  }

  /**
   * Clear all trains
   */
  clear(): void {
    this.trains.clear()
    this.byLine.clear()
    this.byStation.clear()
    for (const stateSet of this.byState.values()) {
      stateSet.clear()
    }
    this.trainIdCounter = 0
  }

  initializeLoad(train: TrainState): void {
    const base = computeBaseLoadFactor(train, train.scheduledDeparture)
    applyLoadToTrain(train, base)
  }

  updateLoadAtStation(trainId: string, currentTime: Date, stopIndex: number): void {
    const train = this.trains.get(trainId)
    if (!train) return

    const deltaSeed = hashStringToFloat(`${train.id}:${stopIndex}`)
    const delta = (deltaSeed - 0.5) * 0.2
    const nextLoad = clamp(train.loadFactor + delta, 0.05, 1.1)
    applyLoadToTrain(train, nextLoad, currentTime)
  }

  // Private helper methods

  private addToIndices(train: TrainState): void {
    // Add to line index
    let lineSet = this.byLine.get(train.lineId)
    if (!lineSet) {
      lineSet = new Set()
      this.byLine.set(train.lineId, lineSet)
    }
    lineSet.add(train.id)

    // Add to state index
    this.byState.get(train.state)?.add(train.id)

    // Add to station index (origin station initially)
    let stationSet = this.byStation.get(train.originStationId)
    if (!stationSet) {
      stationSet = new Set()
      this.byStation.set(train.originStationId, stationSet)
    }
    stationSet.add(train.id)
  }

  private removeFromIndices(train: TrainState): void {
    this.byLine.get(train.lineId)?.delete(train.id)
    this.byState.get(train.state)?.delete(train.id)

    // Remove from all station indices
    for (const stationSet of this.byStation.values()) {
      stationSet.delete(train.id)
    }
  }
}

function computeBaseLoadFactor(train: TrainState, currentTime: Date): number {
  const category = train.consist.typeSpec.serviceCategories[0] ?? 'RE'
  let min = 0.55
  let max = 0.75

  if (category === 'Freight') {
    min = 0.05
    max = 0.2
  } else if (['RE', 'RB', 'S', 'IR', 'TER'].includes(category)) {
    min = 0.6
    max = 0.85
  } else if (['ICE', 'IC', 'EC', 'TGV'].includes(category)) {
    min = 0.55
    max = 0.75
  }

  const seed = hashStringToFloat(train.id)
  let base = min + (max - min) * seed

  const hour = currentTime.getHours()
  const isRush =
    (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18) || (hour >= 11 && hour <= 13)
  if (isRush) base += 0.08
  if (hour >= 22 || hour <= 5) base -= 0.08

  return clamp(base, 0.05, 1.0)
}

function applyLoadToTrain(train: TrainState, loadFactor: number, _currentTime?: Date): void {
  const cars = train.consist.cars
  const totalFirstCap = cars.reduce((sum, c) => sum + c.capacity.seatedFirstClass, 0)
  const totalSecondCap = cars.reduce((sum, c) => sum + c.capacity.seatedSecondClass, 0)
  const totalStandingCap = cars.reduce((sum, c) => sum + c.capacity.standing, 0)
  const totalSeatedCap = totalFirstCap + totalSecondCap
  const totalCapacity = totalSeatedCap + totalStandingCap

  if (totalCapacity <= 0) {
    train.passengers = 0
    train.loadFactor = 0
    for (const car of cars) {
      car.occupancy = {
        seatedFirstClass: 0,
        seatedSecondClass: 0,
        standing: 0,
        total: 0,
        loadRatio: 0,
      }
    }
    return
  }

  const clampedLoad = clamp(loadFactor, 0, 1.1)
  const totalPassengers = Math.round(totalCapacity * clampedLoad)

  const seatedPassengers = Math.min(totalPassengers, totalSeatedCap)
  let firstPassengers =
    totalFirstCap > 0
      ? Math.round(seatedPassengers * (totalFirstCap / Math.max(1, totalSeatedCap)))
      : 0
  firstPassengers = Math.min(firstPassengers, totalFirstCap)
  let secondPassengers = Math.min(totalSecondCap, seatedPassengers - firstPassengers)
  if (secondPassengers < 0) secondPassengers = 0

  if (firstPassengers + secondPassengers < seatedPassengers) {
    const remaining = seatedPassengers - (firstPassengers + secondPassengers)
    if (secondPassengers < totalSecondCap) {
      secondPassengers = Math.min(totalSecondCap, secondPassengers + remaining)
    } else {
      firstPassengers = Math.min(totalFirstCap, firstPassengers + remaining)
    }
  }

  const standingPassengers = Math.min(
    totalStandingCap,
    Math.max(0, totalPassengers - (firstPassengers + secondPassengers))
  )

  const firstAlloc = distribute(
    firstPassengers,
    cars.map((c) => c.capacity.seatedFirstClass)
  )
  const secondAlloc = distribute(
    secondPassengers,
    cars.map((c) => c.capacity.seatedSecondClass)
  )
  const standingAlloc = distribute(
    standingPassengers,
    cars.map((c) => c.capacity.standing)
  )

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    if (!car) continue
    const seatedFirstClass = firstAlloc[i] ?? 0
    const seatedSecondClass = secondAlloc[i] ?? 0
    const standing = standingAlloc[i] ?? 0
    const total = seatedFirstClass + seatedSecondClass + standing
    const carCapacity =
      car.capacity.seatedFirstClass + car.capacity.seatedSecondClass + car.capacity.standing
    const loadRatio = carCapacity > 0 ? total / carCapacity : 0
    car.occupancy = { seatedFirstClass, seatedSecondClass, standing, total, loadRatio }
  }

  train.passengers = cars.reduce((sum, c) => sum + c.occupancy.total, 0)
  train.loadFactor = clampedLoad
}

function distribute(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0)
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    const base = Math.floor(total / weights.length)
    const out = weights.map(() => base)
    let remaining = total - base * weights.length
    for (let i = 0; i < weights.length && remaining > 0; i++) {
      out[i] = (out[i] ?? 0) + 1
      remaining -= 1
    }
    return out
  }

  const raw = weights.map((w) => (w / sum) * total)
  const base = raw.map((v) => Math.floor(v))
  let remaining = total - base.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => ({ i, frac: v - (base[i] ?? 0) })).sort((a, b) => b.frac - a.frac)
  let idx = 0
  while (remaining > 0) {
    const entry = order[idx % order.length]
    if (!entry) break
    base[entry.i] = (base[entry.i] ?? 0) + 1
    remaining -= 1
    idx += 1
  }
  return base
}

function hashStringToFloat(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
