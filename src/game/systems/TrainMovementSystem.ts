/**
 * TrainMovementSystem - Handles train physics and movement along tracks.
 * Manages acceleration, deceleration, station stops, and pathfinding.
 */

import type { OperationalState, TrainState } from '@/types/train'
import type {
  PathPosition,
  PathResult,
  PlannedStopConstraint,
  TrackGraph,
} from '../graph/TrackGraph'
import type { TrainRegistry } from '../registries/TrainRegistry'
import type { TimetableSystem } from './TimetableSystem'
import type { TrackReservationSystem } from './TrackReservationSystem'

/** Movement system configuration */
export interface MovementConfig {
  /** Minimum dwell time at stations in seconds */
  minDwellTime: number
  /** Station approach distance in meters (when to start braking) */
  stationApproachDistance: number
  /** Blocked-block approach distance in meters (when to start braking) */
  blockApproachDistance: number
  /** Speed tolerance for stopping in km/h */
  stopSpeedThreshold: number
  /** Distance tolerance for stopping at station in meters */
  stopDistanceThreshold: number
  /** Reservation lookahead distance in meters */
  reservationLookaheadDistance: number
  /** Reservation release-behind distance in meters */
  reservationReleaseBehindDistance: number
}

const DEFAULT_CONFIG: MovementConfig = {
  minDwellTime: 30,
  stationApproachDistance: 500,
  blockApproachDistance: 500,
  stopSpeedThreshold: 1,
  stopDistanceThreshold: 5,
  reservationLookaheadDistance: 2000,
  reservationReleaseBehindDistance: 500,
}

/** Internal train movement state */
interface TrainMovementState {
  /** Cached path result */
  path: PathResult
  /** Current offset along path in meters */
  pathOffset: number
  /** Scheduled stop station IDs (including origin + terminus) */
  stopStationIds: string[]
  /** Offsets along the path where each stop occurs (parallel to stopStationIds) */
  stopOffsets: number[]
  /** Chosen stop node IDs (parallel to stopStationIds) */
  chosenStopNodeIds: string[]
  /** Dwell timer (seconds remaining at station) */
  dwellTimer: number
  /** Current stop index within stopStationIds */
  currentStopIndex: number
  /** Next stop index within stopStationIds */
  nextStopIndex: number
  /** Current station ID (if at station) */
  currentStationId: string | null
  /** Offset along the path where we must stop due to a blocked reservation */
  blockedAtOffset: number | null
  /** Block ID that caused the stop */
  blockedBlockId: string | null
  /** Current stopping target (station or blocked block) */
  approachTarget: { kind: 'station' | 'block'; offset: number } | null
  /** Cooldown after yielding to another train (seconds) */
  yieldCooldownSeconds: number
}

export class TrainMovementSystem {
  private config: MovementConfig
  private trackGraph: TrackGraph
  private trainRegistry: TrainRegistry
  private timetableSystem: TimetableSystem
  private reservationSystem: TrackReservationSystem | null

  // Movement state per train
  private movementStates: Map<string, TrainMovementState> = new Map()

  constructor(
    trackGraph: TrackGraph,
    trainRegistry: TrainRegistry,
    timetableSystem: TimetableSystem,
    reservationSystem: TrackReservationSystem | null = null,
    config: Partial<MovementConfig> = {}
  ) {
    this.trackGraph = trackGraph
    this.trainRegistry = trainRegistry
    this.timetableSystem = timetableSystem
    this.reservationSystem = reservationSystem
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize movement state for a train
   */
  initializeTrain(train: TrainState): void {
    const entry = this.timetableSystem.getEntry(train.timetableEntryId)
    const plannedStops: PlannedStopConstraint[] =
      entry?.stops
        .map((s) => ({ stationId: s.stationId, platform: s.platform }))
        .filter((s) => s.stationId.trim().length > 0) ?? []

    const shouldUseStops =
      plannedStops.length >= 2 &&
      plannedStops[0]?.stationId === train.originStationId &&
      plannedStops[plannedStops.length - 1]?.stationId === train.destinationStationId

    const effectiveStops: PlannedStopConstraint[] = shouldUseStops
      ? plannedStops
      : [
          { stationId: train.originStationId, platform: null },
          { stationId: train.destinationStationId, platform: null },
        ]

    let { path, stopOffsets, chosenStopNodeIds } = this.trackGraph.buildPathForPlannedStops(
      effectiveStops,
      train.destinationStationId
    )
    let effectiveStopStationIds = effectiveStops.map((s) => s.stationId)

    // Fallback: if stop-to-stop pathing fails, at least move from origin to terminus.
    if (!path.found) {
      const fallbackStops: PlannedStopConstraint[] = [
        { stationId: train.originStationId, platform: null },
        { stationId: train.destinationStationId, platform: null },
      ]
      const fallback = this.trackGraph.buildPathForPlannedStops(
        fallbackStops,
        train.destinationStationId
      )
      path = fallback.path
      stopOffsets = fallback.stopOffsets
      chosenStopNodeIds = fallback.chosenStopNodeIds
      effectiveStopStationIds = fallbackStops.map((s) => s.stationId)
    }

    if (!path.found) {
      console.warn(`Cannot initialize movement for train ${train.id}: no path found`)
      return
    }

    const currentStopIndex = Math.min(
      Math.max(0, train.currentStopIndex),
      effectiveStopStationIds.length - 1
    )
    const nextStopIndex =
      currentStopIndex < effectiveStopStationIds.length - 1
        ? currentStopIndex + 1
        : currentStopIndex

    const movementState: TrainMovementState = {
      path,
      pathOffset: 0,
      stopStationIds: effectiveStopStationIds,
      stopOffsets,
      chosenStopNodeIds,
      dwellTimer: 0,
      currentStopIndex,
      nextStopIndex,
      currentStationId: effectiveStopStationIds[0] ?? train.originStationId,
      blockedAtOffset: null,
      blockedBlockId: null,
      approachTarget: null,
      yieldCooldownSeconds: 0,
    }

    this.movementStates.set(train.id, movementState)
    this.reservationSystem?.setTrainPath(train.id)
    this.updateWorldPosition(train, movementState)
  }

  /**
   * Update all trains for a time step
   * @param deltaSeconds Time step in seconds
   * @param currentTime Current in-game time
   */
  update(deltaSeconds: number, currentTime: Date): void {
    for (const train of this.trainRegistry.getActive()) {
      this.updateTrain(train, deltaSeconds, currentTime)
    }
  }

  /**
   * Update a single train
   */
  private updateTrain(train: TrainState, deltaSeconds: number, currentTime: Date): void {
    const movement = this.movementStates.get(train.id)
    if (!movement) {
      this.initializeTrain(train)
      return
    }

    movement.yieldCooldownSeconds = Math.max(0, movement.yieldCooldownSeconds - deltaSeconds)

    const pathPos = this.trackGraph.getPositionOnPath(movement.path, movement.pathOffset)
    if (pathPos) {
      this.updateReservations(train.id, movement, pathPos)
    }

    switch (train.state) {
      case 'preparing':
        this.updatePreparing(train, movement, deltaSeconds, currentTime)
        break
      case 'departing':
        this.updateDeparting(train, movement, deltaSeconds)
        break
      case 'running':
        this.updateRunning(train, movement, deltaSeconds)
        break
      case 'approaching':
        this.updateApproaching(train, movement, deltaSeconds, currentTime)
        break
      case 'at_station':
        this.updateAtStation(train, movement, deltaSeconds)
        break
      case 'depot':
      case 'terminated':
        // No movement
        break
    }

    // Update world position
    this.updateWorldPosition(train, movement)
  }

  /**
   * Update train in preparing state
   */
  private updatePreparing(
    train: TrainState,
    _movement: TrainMovementState,
    _deltaSeconds: number,
    currentTime: Date
  ): void {
    // Wait for scheduled departure time.
    if (currentTime >= train.scheduledDeparture) {
      this.transitionState(train, 'departing')
    } else {
      // Ensure we stay stopped until departure.
      train.currentSpeed = 0
      train.targetSpeed = 0
    }
  }

  /**
   * Update train in departing state
   */
  private updateDeparting(
    train: TrainState,
    movement: TrainMovementState,
    deltaSeconds: number
  ): void {
    const typeSpec = train.consist.typeSpec

    // Set target speed based on track speed limit
    const position = this.trackGraph.getPositionOnPath(movement.path, movement.pathOffset)
    const trackMaxSpeed = position?.linkData.maxSpeed ?? 100
    const targetSpeed = Math.min(typeSpec.performance.maxOperationalSpeed, trackMaxSpeed)

    // Accelerate
    this.accelerate(train, targetSpeed, deltaSeconds)

    // Move
    this.move(train, movement, deltaSeconds, movement.blockedAtOffset)

    // Clear current station once moving
    if (train.currentSpeed > this.config.stopSpeedThreshold) {
      const oldStation = movement.currentStationId
      movement.currentStationId = null
      this.trainRegistry.updateStationIndex(train.id, oldStation, null)

      // Check if we should transition to running or approaching
      const target = this.getNextStoppingTarget(movement)
      if (target) {
        const distanceToTarget = target.offset - movement.pathOffset
        const approachDistance =
          target.kind === 'block'
            ? this.config.blockApproachDistance
            : this.config.stationApproachDistance
        if (distanceToTarget < this.getBrakingDistance(train) + approachDistance) {
          movement.approachTarget = target
          this.transitionState(train, 'approaching')
          return
        }
      }

      this.transitionState(train, 'running')
    }
  }

  /**
   * Update train in running state
   */
  private updateRunning(
    train: TrainState,
    movement: TrainMovementState,
    deltaSeconds: number
  ): void {
    const typeSpec = train.consist.typeSpec

    // Get current track speed limit
    const position = this.trackGraph.getPositionOnPath(movement.path, movement.pathOffset)
    const trackMaxSpeed = position?.linkData.maxSpeed ?? 100
    const targetSpeed = Math.min(typeSpec.performance.maxOperationalSpeed, trackMaxSpeed)

    // Adjust speed to match target
    if (train.currentSpeed < targetSpeed) {
      this.accelerate(train, targetSpeed, deltaSeconds)
    } else if (train.currentSpeed > targetSpeed) {
      this.decelerate(train, targetSpeed, deltaSeconds)
    }

    // Move
    this.move(train, movement, deltaSeconds, movement.blockedAtOffset)

    // Check if approaching next station
    const target = this.getNextStoppingTarget(movement)
    if (target) {
      const distanceToTarget = target.offset - movement.pathOffset
      const approachDistance =
        target.kind === 'block'
          ? this.config.blockApproachDistance
          : this.config.stationApproachDistance
      if (distanceToTarget < this.getBrakingDistance(train) + approachDistance) {
        movement.approachTarget = target
        this.transitionState(train, 'approaching')
      }
    }

    // Check if at end of path
    if (movement.pathOffset >= movement.path.totalLength - this.config.stopDistanceThreshold) {
      this.transitionState(train, 'terminated')
    }
  }

  /**
   * Update train in approaching state
   */
  private updateApproaching(
    train: TrainState,
    movement: TrainMovementState,
    deltaSeconds: number,
    currentTime: Date
  ): void {
    const target =
      movement.approachTarget ??
      ({ kind: 'station', offset: movement.stopOffsets[movement.nextStopIndex] ?? 0 } as const)
    const brakingDistance = this.getBrakingDistance(train)
    const distanceToTarget = target.offset - movement.pathOffset

    if (distanceToTarget <= brakingDistance) {
      // Decelerate to stop
      this.decelerate(train, 0, deltaSeconds)
    } else {
      // Maintain speed until braking point
      const typeSpec = train.consist.typeSpec
      const position = this.trackGraph.getPositionOnPath(movement.path, movement.pathOffset)
      const trackMaxSpeed = position?.linkData.maxSpeed ?? 100
      const targetSpeed = Math.min(typeSpec.performance.maxOperationalSpeed, trackMaxSpeed)

      if (train.currentSpeed < targetSpeed) {
        this.accelerate(train, targetSpeed, deltaSeconds)
      }
    }

    // Move
    this.move(train, movement, deltaSeconds, movement.blockedAtOffset)

    // Check if stopped at target
    if (
      train.currentSpeed < this.config.stopSpeedThreshold &&
      distanceToTarget < this.config.stopDistanceThreshold
    ) {
      if (target.kind === 'block') {
        // Stopped for a blocked segment; wait until reservations clear.
        movement.approachTarget = null
        train.currentSpeed = 0
        train.targetSpeed = 0
        this.transitionState(train, 'running')
      } else {
        // Arrived at station
        const arrivedStationId = movement.stopStationIds[movement.nextStopIndex] ?? null
        movement.currentStationId = arrivedStationId
        movement.dwellTimer = this.config.minDwellTime

        // Update station index
        this.trainRegistry.updateStationIndex(train.id, null, arrivedStationId)

        // Update train's current stop index
        if (arrivedStationId) {
          train.currentStopIndex = movement.nextStopIndex
          movement.currentStopIndex = movement.nextStopIndex
        }

        // Find next scheduled stop
        const nextStopIndex = movement.currentStopIndex + 1
        movement.nextStopIndex =
          nextStopIndex < movement.stopStationIds.length ? nextStopIndex : movement.currentStopIndex

        this.trainRegistry.updateLoadAtStation(train.id, currentTime, movement.currentStopIndex)

        // Check if this is the final destination
        if (arrivedStationId === train.destinationStationId) {
          this.transitionState(train, 'terminated')
        } else {
          this.transitionState(train, 'at_station')
        }
      }
    }
  }

  /**
   * Update train at station
   */
  private updateAtStation(
    train: TrainState,
    movement: TrainMovementState,
    deltaSeconds: number
  ): void {
    // Countdown dwell timer
    movement.dwellTimer -= deltaSeconds

    if (movement.dwellTimer <= 0) {
      // Ready to depart
      movement.dwellTimer = 0
      this.transitionState(train, 'departing')
    }
  }

  /**
   * Transition train to a new state
   */
  private transitionState(train: TrainState, newState: OperationalState): void {
    this.trainRegistry.update(train.id, { state: newState })
    train.state = newState

    if (newState === 'terminated') {
      this.reservationSystem?.clearTrain(train.id)
      this.movementStates.delete(train.id)
    }
  }

  /**
   * Accelerate train toward target speed
   */
  private accelerate(train: TrainState, targetSpeed: number, deltaSeconds: number): void {
    const typeSpec = train.consist.typeSpec
    const acceleration = typeSpec.performance.acceleration * 3.6 // Convert m/s² to km/h per second

    const newSpeed = train.currentSpeed + acceleration * deltaSeconds
    train.currentSpeed = Math.min(newSpeed, targetSpeed)
    train.targetSpeed = targetSpeed
  }

  /**
   * Decelerate train toward target speed
   */
  private decelerate(train: TrainState, targetSpeed: number, deltaSeconds: number): void {
    const typeSpec = train.consist.typeSpec
    const deceleration = typeSpec.performance.deceleration * 3.6 // Convert m/s² to km/h per second

    const newSpeed = train.currentSpeed - deceleration * deltaSeconds
    train.currentSpeed = Math.max(newSpeed, targetSpeed)
    train.targetSpeed = targetSpeed
  }

  /**
   * Move train along path
   */
  private move(
    train: TrainState,
    movement: TrainMovementState,
    deltaSeconds: number,
    maxOffset: number | null
  ): void {
    // Convert km/h to m/s and calculate distance
    const speedMs = train.currentSpeed / 3.6
    const distance = speedMs * deltaSeconds

    const desiredOffset = movement.pathOffset + distance
    const limitOffset =
      maxOffset === null ? movement.path.totalLength : Math.max(movement.pathOffset, maxOffset)
    movement.pathOffset = Math.min(desiredOffset, limitOffset)

    // Clamp to path bounds
    movement.pathOffset = Math.max(0, Math.min(movement.pathOffset, movement.path.totalLength))
  }

  private getNextStoppingTarget(
    movement: TrainMovementState
  ): { kind: 'station' | 'block'; offset: number } | null {
    const nextStationOffset =
      movement.stopOffsets[movement.nextStopIndex] ?? Number.POSITIVE_INFINITY
    const blockedOffset = movement.blockedAtOffset ?? Number.POSITIVE_INFINITY

    if (!Number.isFinite(nextStationOffset) && !Number.isFinite(blockedOffset)) return null

    if (blockedOffset < nextStationOffset) {
      return { kind: 'block', offset: blockedOffset }
    }

    if (Number.isFinite(nextStationOffset)) {
      return { kind: 'station', offset: nextStationOffset }
    }

    return null
  }

  private updateReservations(
    trainId: string,
    movement: TrainMovementState,
    position: PathPosition
  ): void {
    if (!this.reservationSystem) return

    const lookahead =
      movement.yieldCooldownSeconds > 0 ? 0 : this.config.reservationLookaheadDistance

    const update = this.reservationSystem.updateTrain(
      trainId,
      movement.path,
      position.segmentIndex,
      movement.pathOffset,
      lookahead,
      this.config.reservationReleaseBehindDistance
    )
    movement.blockedAtOffset = update.blockedAtOffset
    movement.blockedBlockId = update.blockedBlockId

    if (update.blockedAtOffset === null || !update.blockedBlockId || !update.blockedByTrainId) {
      return
    }
    if (update.blockedByTrainId === trainId) return
    if (movement.yieldCooldownSeconds > 0) return

    const blockedDistance = update.blockedAtOffset - movement.pathOffset
    if (blockedDistance > this.config.blockApproachDistance + 250) return

    const otherTrain = this.trainRegistry.get(update.blockedByTrainId)
    if (!otherTrain) return

    const selfTrain = this.trainRegistry.get(trainId)
    if (!selfTrain) return
    const shouldYield = this.comparePriority(selfTrain, otherTrain) > 0
    if (!shouldYield) return

    this.reservationSystem.yieldTrain(trainId, position.linkData.trackId)
    movement.yieldCooldownSeconds = 30
  }

  private comparePriority(a: TrainState, b: TrainState): number {
    const ad = a.scheduledDeparture.getTime()
    const bd = b.scheduledDeparture.getTime()
    if (ad !== bd) return ad - bd
    return a.id.localeCompare(b.id)
  }

  /**
   * Update train's world position from path position
   */
  private updateWorldPosition(train: TrainState, movement: TrainMovementState): void {
    const position = this.trackGraph.getPositionOnPath(movement.path, movement.pathOffset)

    if (position) {
      train.worldPosition = {
        x: position.worldPosition[0],
        y: position.worldPosition[1],
        heading: position.heading,
      }

      // Update track position
      train.trackPosition = {
        trackId: position.linkData.trackId,
        offset: position.segmentOffset,
        direction: 1,
      }
    }
  }

  /**
   * Calculate braking distance at current speed
   */
  private getBrakingDistance(train: TrainState): number {
    const typeSpec = train.consist.typeSpec
    const speedMs = train.currentSpeed / 3.6
    const deceleration = typeSpec.performance.deceleration

    // s = v² / (2a)
    return (speedMs * speedMs) / (2 * deceleration)
  }

  /**
   * Get movement state for a train
   */
  getMovementState(trainId: string): TrainMovementState | undefined {
    return this.movementStates.get(trainId)
  }

  getPathOffset(trainId: string): number | null {
    return this.movementStates.get(trainId)?.pathOffset ?? null
  }

  getPathPositionForOffset(trainId: string, offsetMeters: number): PathPosition | null {
    const movement = this.movementStates.get(trainId)
    if (!movement) return null
    return this.trackGraph.getPositionOnPath(movement.path, offsetMeters)
  }

  /**
   * Clean up movement state for removed trains
   */
  cleanup(): void {
    const activeTrainIds = new Set(this.trainRegistry.getAll().map((t) => t.id))

    for (const trainId of this.movementStates.keys()) {
      if (!activeTrainIds.has(trainId)) {
        this.movementStates.delete(trainId)
      }
    }
  }
}
