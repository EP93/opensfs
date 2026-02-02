import { Application } from 'pixi.js'
import {
  loadRegion,
  type ProgressCallback,
  type RegionData,
  type StationFeature,
} from '@/lib/mapLoader'
import type { Viewport } from '@/types/game'
import type { TrainLiveSnapshot } from '@/types/trainTracking'
import { ZoomController } from './controllers/ZoomController'
import { LINE_DEFINITIONS } from './data/lineDefinitions'
import { GameState } from './GameState'
import { TrackGraph } from './graph/TrackGraph'
import { TrainRegistry } from './registries/TrainRegistry'
import { trainTypeRegistry } from './registries/TrainTypeRegistry'
import { DebugOverlaySystem } from './systems/DebugOverlaySystem'
import { SignalSystem } from './systems/SignalSystem'
import { StationMarkerSystem } from './systems/StationMarkerSystem'
import { StationSystem } from './systems/StationSystem'
import { TileSystem } from './systems/TileSystem'
import { TimetableSystem } from './systems/TimetableSystem'
import { TrackReservationSystem } from './systems/TrackReservationSystem'
import { TrackSystem } from './systems/TrackSystem'
import { TrainMovementSystem } from './systems/TrainMovementSystem'
import { TrainSystem } from './systems/TrainSystem'
import { calculateCenter, calculateZoomToFit } from './utils/geo'

/** Loading state */
export interface LoadingState {
  isLoading: boolean
  stage: string
  progress: number
}

/** Game event callbacks */
export interface GameCallbacks {
  onLoadingChange?: (state: LoadingState) => void
  onStateChange?: (state: GameState) => void
  onStationClick?: (station: StationFeature) => void
  onTrainClick?: (trainId: string) => void
  onTrainSnapshot?: ((trains: TrainLiveSnapshot[]) => void) | null
}

export class Game {
  private app: Application | null = null
  private state: GameState
  private viewport: Viewport
  private tileSystem: TileSystem
  private trackSystem: TrackSystem
  private stationMarkerSystem: StationMarkerSystem
  private stationSystem: StationSystem
  private debugOverlaySystem: DebugOverlaySystem
  private zoomController: ZoomController
  private regionData: RegionData | null = null
  private callbacks: GameCallbacks = {}
  private loadingState: LoadingState = { isLoading: false, stage: '', progress: 0 }
  private needsRender = true
  private renderRafId: number | null = null
  private lastTickMs = 0
  private isTickerRunning = false
  private lastPresentedMs = 0
  private avgSimMs = 0
  private avgRenderMs = 0
  private fpsEstimate = 0
  private interactionUntilMs = 0
  private lowPowerMode = false
  private lastTrainSnapshotMs = 0
  private lastTrainSnapshotSize = -1
  private trainSnapshotSubscribers = new Set<(trains: TrainLiveSnapshot[]) => void>()
  private followTrainId: string | null = null
  private followTrainSubscribers = new Set<(trainId: string | null) => void>()

  // Train systems
  private trackGraph: TrackGraph
  private trackReservationSystem: TrackReservationSystem
  private signalSystem: SignalSystem
  private trainRegistry: TrainRegistry
  private trainSystem: TrainSystem
  private trainMovementSystem: TrainMovementSystem
  private timetableSystem: TimetableSystem
  private trainSystemsInitialized = false
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null

  constructor() {
    this.state = new GameState()
    this.viewport = {
      x: 0,
      y: 0,
      zoom: 1,
      width: 0,
      height: 0,
    }
    this.tileSystem = new TileSystem()
    this.trackSystem = new TrackSystem()
    this.stationMarkerSystem = new StationMarkerSystem()
    this.stationSystem = new StationSystem()
    this.zoomController = new ZoomController()

    // Initialize train systems
    this.trackGraph = new TrackGraph()
    this.trackReservationSystem = new TrackReservationSystem()
    this.signalSystem = new SignalSystem(this.trackReservationSystem)
    this.trainRegistry = new TrainRegistry(trainTypeRegistry)
    this.timetableSystem = new TimetableSystem(this.trackGraph, this.trainRegistry)
    this.trainMovementSystem = new TrainMovementSystem(
      this.trackGraph,
      this.trainRegistry,
      this.timetableSystem,
      this.trackReservationSystem
    )
    this.trainSystem = new TrainSystem(this.trainRegistry, this.trainMovementSystem)
    this.debugOverlaySystem = new DebugOverlaySystem(
      this.trackGraph,
      this.trackReservationSystem,
      this.signalSystem
    )
  }

  setCallbacks(callbacks: GameCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  subscribeTrainSnapshots(callback: (trains: TrainLiveSnapshot[]) => void): () => void {
    this.trainSnapshotSubscribers.add(callback)
    return () => {
      this.trainSnapshotSubscribers.delete(callback)
    }
  }

  subscribeFollowTrain(callback: (trainId: string | null) => void): () => void {
    this.followTrainSubscribers.add(callback)
    return () => {
      this.followTrainSubscribers.delete(callback)
    }
  }

  getFollowTrainId(): string | null {
    return this.followTrainId
  }

  toggleFollowTrain(trainId: string): void {
    if (this.followTrainId === trainId) {
      this.setFollowTrain(null)
    } else {
      this.setFollowTrain(trainId)
    }
  }

  setFollowTrain(trainId: string | null): void {
    if (this.followTrainId === trainId) return
    this.followTrainId = trainId
    this.trainSystem.setProtectedTrainIds([trainId])
    for (const subscriber of this.followTrainSubscribers) {
      subscriber(trainId)
    }

    if (trainId) {
      this.focusOnTrain(trainId)
      this.ensureTickerRunning()
    }
  }

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application()

    await this.app.init({
      background: '#1a1a1a',
      resizeTo: container,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      autoStart: false,
      sharedTicker: true,
    })

    container.appendChild(this.app.canvas)

    this.viewport.width = container.clientWidth
    this.viewport.height = container.clientHeight

    // Layers (bottom -> top):
    this.app.stage.addChild(this.tileSystem.getContainer())
    this.app.stage.addChild(this.trackSystem.getContainer())
    this.app.stage.addChild(this.stationMarkerSystem.getContainer())
    this.app.stage.addChild(this.stationSystem.getContainer())
    this.app.stage.addChild(this.debugOverlaySystem.getContainer())
    this.app.stage.addChild(this.trainSystem.getContainer())

    this.setupInteraction()
    this.setupDebugControls()
    this.startGameLoop()
    this.tileSystem.setOnDirty(() => this.scheduleRender())

    // Load default region
    await this.loadRegion('freiburg')
  }

  async loadRegion(regionId: string): Promise<void> {
    this.setLoadingState(true, 'Initializing...', 0)

    const onProgress: ProgressCallback = (stage, progress) => {
      this.setLoadingState(true, stage, progress)
    }

    try {
      this.regionData = await loadRegion(regionId, onProgress)

      // Load train types from JSON (async)
      this.setLoadingState(true, 'Loading train types...', 0.85)
      await trainTypeRegistry.load()

      // Load station data for labels + hit-testing (markers are streamed separately)
      this.stationSystem.loadStations(this.regionData.stations)

      // Build track graph for pathfinding
      this.setLoadingState(true, 'Building track graph...', 0.9)
      this.trackGraph.buildFromNetwork(this.regionData.network)
      const stats = this.trackGraph.getStats()
      console.log(
        `Track graph built: ${stats.nodeCount} nodes, ${stats.linkCount} links, ${stats.stationCount} stations`
      )

      this.signalSystem.loadNetwork(this.regionData.network)
      this.debugOverlaySystem.loadNetwork(this.regionData.network)

      // Rendering data
      this.trackSystem.loadTracks(this.regionData.tracks, 14, 1)
      this.stationMarkerSystem.loadStations(this.regionData.stations)

      // Initialize timetable system with line definitions
      this.initializeTrainSystems()

      // Center viewport on region
      this.centerOnRegion()

      // Force render
      this.trackSystem.invalidate()
      this.stationMarkerSystem.invalidate()
      this.stationSystem.invalidate()
      this.tileSystem.invalidate()

      this.setLoadingState(false, '', 1)
      this.scheduleRender()
    } catch (error) {
      console.error('Failed to load region:', error)
      this.setLoadingState(false, 'Failed to load region', 0)
      throw error
    }
  }

  /**
   * Initialize train systems with line definitions and generate timetable
   */
  private initializeTrainSystems(): void {
    if (this.trainSystemsInitialized) return

    // Register line definitions
    for (const line of LINE_DEFINITIONS) {
      this.timetableSystem.registerLine(line)
      console.log(`Registered line ${line.id} with ${line.route.length} stops`)

      // Test pathfinding for this line
      const firstStation = line.route[0]
      const lastStation = line.route[line.route.length - 1]
      if (firstStation && lastStation) {
        const path = this.trackGraph.findPath(firstStation, lastStation)
        if (path.found) {
          console.log(
            `  Path found: ${path.totalLength.toFixed(0)}m, ${path.stations.length} stations`
          )
        } else {
          console.warn(`  No path found for line ${line.id}!`)
          console.log(`  Origin: ${firstStation}, Destination: ${lastStation}`)
          console.log(
            `  Available stations in graph:`,
            this.trackGraph.getStationIds().slice(0, 10)
          )
        }
      }
    }

    // Generate timetable for current game date
    this.timetableSystem.generateTimetable(this.state.time.date)
    // Spawn initial trains for the player/org to start with.
    this.timetableSystem.spawnInitialTrains(this.state.time.date, {
      windowMinutes: 180,
      perLine: 1,
      maxTotal: 25,
    })

    this.trainSystemsInitialized = true
    console.log(`Train systems initialized with ${LINE_DEFINITIONS.length} lines`)
    console.log(`Game time: ${this.state.time.date.toLocaleTimeString()}`)
  }

  private centerOnRegion(): void {
    if (!this.regionData) return

    const { bounds } = this.regionData
    const center = calculateCenter(bounds)
    const fitZoom = calculateZoomToFit(bounds, this.viewport.width, this.viewport.height, 0.1)

    // Start much more zoomed in (10x the fit-to-bounds zoom) for better initial view
    const zoom = fitZoom * 10

    this.viewport.x = center[0]
    this.viewport.y = center[1]
    this.viewport.zoom = zoom
  }

  private setLoadingState(isLoading: boolean, stage: string, progress: number): void {
    this.loadingState = { isLoading, stage, progress }
    this.callbacks.onLoadingChange?.(this.loadingState)
  }

  private setupInteraction(): void {
    if (!this.app) return

    const canvas = this.app.canvas
    canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false })
    canvas.addEventListener('pointerdown', this.handlePointerDown.bind(this))
    canvas.addEventListener('pointermove', this.handlePointerMove.bind(this))
    canvas.addEventListener('pointerup', this.handlePointerUp.bind(this))
    canvas.addEventListener('pointerleave', this.handlePointerUp.bind(this))
  }

  private isDragging = false
  private hasDragged = false
  private lastPointerPos = { x: 0, y: 0 }
  private pointerDownPos = { x: 0, y: 0 }

  private bumpInteraction(): void {
    const now = performance.now()
    this.interactionUntilMs = Math.max(this.interactionUntilMs, now + 450)
  }

  private handleWheel(event: WheelEvent): void {
    event.preventDefault()

    const rect = this.app?.canvas.getBoundingClientRect()
    if (!rect) return

    // Delegate to zoom controller - it will set up the animation
    // Actual viewport changes happen in update(), which will invalidate systems
    this.zoomController.handleWheel(event, this.viewport, rect)
    this.bumpInteraction()
    this.ensureTickerRunning()
  }

  private handlePointerDown(event: PointerEvent): void {
    // Manual camera control cancels follow mode.
    if (this.followTrainId) {
      this.setFollowTrain(null)
    }

    this.isDragging = true
    this.hasDragged = false
    this.lastPointerPos = { x: event.clientX, y: event.clientY }
    this.pointerDownPos = { x: event.clientX, y: event.clientY }
    this.bumpInteraction()
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.isDragging) return

    const dx = event.clientX - this.lastPointerPos.x
    const dy = event.clientY - this.lastPointerPos.y

    // Track if we've moved more than a few pixels (to distinguish click from drag)
    const totalDx = event.clientX - this.pointerDownPos.x
    const totalDy = event.clientY - this.pointerDownPos.y
    if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
      this.hasDragged = true
    }

    // Move viewport (note: y is inverted in world space)
    this.viewport.x -= dx / this.viewport.zoom
    this.viewport.y += dy / this.viewport.zoom

    this.lastPointerPos = { x: event.clientX, y: event.clientY }

    // Force redraw
    this.tileSystem.invalidate()
    this.stationSystem.invalidate()
    this.stationMarkerSystem.invalidate()
    this.trackSystem.invalidate()
    this.bumpInteraction()
    this.scheduleRender()
  }

  private handlePointerUp(event: PointerEvent): void {
    // Check for click (not drag) on a station
    if (!this.hasDragged && (this.callbacks.onStationClick || this.callbacks.onTrainClick)) {
      const rect = this.app?.canvas.getBoundingClientRect()
      if (rect) {
        const screenX = event.clientX - rect.left
        const screenY = event.clientY - rect.top

        if (this.callbacks.onTrainClick) {
          const train = this.trainSystem.findTrainAt(screenX, screenY, this.viewport)
          if (train) {
            this.callbacks.onTrainClick(train.id)
            this.setSelectedTrain(train.id)
            this.isDragging = false
            this.hasDragged = false
            return
          }
        }

        const station = this.stationSystem.findStationAt(screenX, screenY, this.viewport)
        if (station) {
          // Find the full station feature from regionData
          const stationFeature = this.regionData?.stations.find((s) => s.id === station.id)
          if (stationFeature) {
            this.callbacks.onStationClick?.(stationFeature)
          }
        }
      }
    }

    this.isDragging = false
    this.hasDragged = false
  }

  private startGameLoop(): void {
    if (!this.app) return

    // Disable Pixi's automatic render-on-tick. We'll render only when needed.
    this.app.ticker.remove(this.app.render, this.app)

    this.app.ticker.add(this.handleTick, this)
    this.ensureTickerRunning()
  }

  private handleTick(): void {
    const now = performance.now()
    const deltaMs = this.lastTickMs > 0 ? now - this.lastTickMs : 16
    this.lastTickMs = now

    const simStart = performance.now()
    this.update(deltaMs)
    const simMs = performance.now() - simStart
    this.avgSimMs = this.smooth(this.avgSimMs, simMs, 0.06)

    const targetFps = this.getTargetFps(now)
    const minFrameMs = 1000 / targetFps
    const canPresent = now - this.lastPresentedMs >= minFrameMs

    if (this.needsRender && canPresent) {
      this.performRender()
    }

    this.stopTickerIfIdle()
  }

  private ensureTickerRunning(): void {
    if (!this.app || this.isTickerRunning) return
    this.lastTickMs = performance.now()
    this.app.ticker.start()
    this.isTickerRunning = true
  }

  private stopTickerIfIdle(): void {
    if (!this.app || !this.isTickerRunning) return

    const simulationIdle = this.state.time.paused || this.state.time.speed <= 0
    if (!simulationIdle) return
    if (this.zoomController.isAnimating()) return

    this.app.ticker.stop()
    this.isTickerRunning = false
    this.lastTickMs = 0
  }

  private scheduleRender(): void {
    this.needsRender = true

    if (this.isTickerRunning) return
    if (this.renderRafId !== null) return

    this.renderRafId = requestAnimationFrame(() => {
      this.renderRafId = null
      if (this.needsRender) {
        this.performRender()
      }
    })
  }

  private performRender(): void {
    if (!this.app) return
    const now = performance.now()
    const renderStart = performance.now()
    this.render()
    this.app.render()
    const renderMs = performance.now() - renderStart
    this.avgRenderMs = this.smooth(this.avgRenderMs, renderMs, 0.08)

    if (this.lastPresentedMs > 0) {
      const fps = 1000 / Math.max(1, now - this.lastPresentedMs)
      this.fpsEstimate = this.smooth(this.fpsEstimate, fps, 0.1)
    }
    this.lastPresentedMs = now
    this.needsRender = false
  }

  private update(deltaMs: number): void {
    // Update zoom animation
    const zoomChanged = this.zoomController.update(this.viewport)
    if (zoomChanged) {
      this.tileSystem.invalidate()
      this.stationSystem.invalidate()
      this.stationMarkerSystem.invalidate()
      this.trackSystem.invalidate()
      this.trainSystem.invalidate()
      this.bumpInteraction()
      this.needsRender = true
    }

    if (!this.state.time.paused && this.state.time.speed > 0) {
      const gameDeltaSeconds = (deltaMs / 1000) * this.state.time.speed
      if (gameDeltaSeconds <= 0) return

      this.state.time.tick += gameDeltaSeconds
      this.state.time.date = new Date(this.state.time.date.getTime() + gameDeltaSeconds * 1000)

      // Update train systems
      const spawnedCount = this.timetableSystem.update(this.state.time.date)
      const hasActiveTrains = this.trainRegistry.getActiveCount() > 0

      if (hasActiveTrains) {
        this.trainMovementSystem.update(gameDeltaSeconds, this.state.time.date)
      }

      if (spawnedCount > 0 || hasActiveTrains) {
        this.needsRender = true
      }
    }

    this.updateFollowCamera()
    this.maybeEmitTrainSnapshot()
  }

  private updateFollowCamera(): void {
    if (!this.followTrainId) return

    const train = this.trainRegistry.get(this.followTrainId)
    if (!train) {
      this.setFollowTrain(null)
      return
    }

    const threshold = 0.0001
    const dx = train.worldPosition.x - this.viewport.x
    const dy = train.worldPosition.y - this.viewport.y
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return

    this.viewport.x = train.worldPosition.x
    this.viewport.y = train.worldPosition.y
    this.tileSystem.invalidate()
    this.stationSystem.invalidate()
    this.stationMarkerSystem.invalidate()
    this.trackSystem.invalidate()
    this.needsRender = true
  }

  private maybeEmitTrainSnapshot(): void {
    const onTrainSnapshot = this.callbacks.onTrainSnapshot
    if (!onTrainSnapshot && this.trainSnapshotSubscribers.size === 0) return

    const now = performance.now()
    const minIntervalMs = 200
    const trainCount = this.trainRegistry.getActiveCount()
    const shouldEmit =
      now - this.lastTrainSnapshotMs >= minIntervalMs || trainCount !== this.lastTrainSnapshotSize

    if (!shouldEmit) return

    this.lastTrainSnapshotMs = now
    this.lastTrainSnapshotSize = trainCount
    const snapshot = this.getTrainSnapshot()
    onTrainSnapshot?.(snapshot)
    for (const subscriber of this.trainSnapshotSubscribers) {
      subscriber(snapshot)
    }
  }

  getTrainSnapshot(): TrainLiveSnapshot[] {
    const trains = this.trainRegistry.getActive()

    const snapshot: TrainLiveSnapshot[] = trains.map((t) => ({
      id: t.id,
      lineId: t.lineId,
      trainNumber: t.trainNumber,
      typeName: t.consist.typeSpec.name,
      units: t.consist.units,
      totalLengthMeters: t.consist.totalLength,
      totalSeatedCapacity: t.consist.totalSeatedCapacity,
      totalStandingCapacity: t.consist.totalStandingCapacity,
      loadFactor: t.loadFactor,
      state: t.state,
      currentStopIndex: t.currentStopIndex,
      currentSpeedKmh: t.currentSpeed,
      delaySeconds: t.delay,
      scheduledDeparture: t.scheduledDeparture,
      timetableEntryId: t.timetableEntryId,
      originStationId: t.originStationId,
      destinationStationId: t.destinationStationId,
      worldX: t.worldPosition.x,
      worldY: t.worldPosition.y,
      headingRad: t.worldPosition.heading,
      cars: t.consist.cars.map((car) => ({
        number: car.number,
        id: car.id,
        class: car.class,
        kind: car.kind,
        lengthMeters: car.lengthMeters,
        capacity: { ...car.capacity },
        occupancy: { ...car.occupancy },
        status: getCarLoadStatus(car.occupancy.loadRatio),
      })),
    }))

    snapshot.sort((a, b) => {
      const line = a.lineId.localeCompare(b.lineId)
      if (line !== 0) return line
      return a.trainNumber - b.trainNumber
    })

    return snapshot
  }

  getTimetableEntryForTrain(trainId: string) {
    return this.timetableSystem.getEntryForTrain(trainId)
  }

  focusOnTrain(trainId: string): boolean {
    const train = this.trainRegistry.get(trainId)
    if (!train) return false

    this.viewport.x = train.worldPosition.x
    this.viewport.y = train.worldPosition.y
    this.tileSystem.invalidate()
    this.stationSystem.invalidate()
    this.stationMarkerSystem.invalidate()
    this.trackSystem.invalidate()
    this.scheduleRender()
    return true
  }

  setSelectedTrain(trainId: string | null): void {
    this.trainSystem.setSelectedTrainId(trainId)
    this.trainSystem.setProtectedTrainIds([this.followTrainId])
    this.scheduleRender()
  }

  private render(): void {
    this.tileSystem.render(this.viewport)
    this.trackSystem.render(this.viewport)
    this.stationMarkerSystem.render(this.viewport)
    this.stationSystem.render(this.viewport)
    this.debugOverlaySystem.render(this.viewport)
    this.trainSystem.render(this.viewport)
  }

  getState(): GameState {
    return this.state
  }

  getViewport(): Viewport {
    return { ...this.viewport }
  }

  getLoadingState(): LoadingState {
    return { ...this.loadingState }
  }

  getRegionData(): RegionData | null {
    return this.regionData
  }

  getStreamingStats(): { loadedChunks: number; visibleChunks: number; evictedChunks: number } {
    return {
      loadedChunks: this.trackSystem.getLoadedChunkCount(),
      visibleChunks: this.trackSystem.getLastVisibleChunkCount(),
      evictedChunks: 0,
    }
  }

  getPerfStats(): {
    fpsEstimate: number
    avgSimMs: number
    avgRenderMs: number
    targetFps: number
    lowPowerMode: boolean
  } {
    const now = performance.now()
    return {
      fpsEstimate: this.fpsEstimate,
      avgSimMs: this.avgSimMs,
      avgRenderMs: this.avgRenderMs,
      targetFps: this.getTargetFps(now),
      lowPowerMode: this.lowPowerMode,
    }
  }

  setLowPowerMode(enabled: boolean): void {
    if (this.lowPowerMode === enabled) return
    this.lowPowerMode = enabled
    if (!this.app) return

    const resolution = enabled ? 1 : window.devicePixelRatio || 1
    this.app.renderer.resolution = resolution
    this.app.renderer.resize(this.viewport.width, this.viewport.height)
    this.tileSystem.invalidate()
    this.stationSystem.invalidate()
    this.stationMarkerSystem.invalidate()
    this.trackSystem.invalidate()
    this.trainSystem.invalidate()
    this.scheduleRender()
  }

  setTimeSpeed(speed: number): void {
    this.state.setTimeSpeed(speed)
    if (!this.state.time.paused && this.state.time.speed > 0) {
      this.ensureTickerRunning()
    } else {
      this.stopTickerIfIdle()
    }
  }

  togglePause(): void {
    this.state.togglePause()
    if (!this.state.time.paused && this.state.time.speed > 0) {
      this.ensureTickerRunning()
    } else {
      this.stopTickerIfIdle()
    }
  }

  destroy(): void {
    // Only destroy if app exists and hasn't been destroyed
    if (!this.app) return
    if (this.renderRafId !== null) {
      cancelAnimationFrame(this.renderRafId)
      this.renderRafId = null
    }

    this.tileSystem.setOnDirty(null)
    this.tileSystem.destroy()
    this.trackSystem.destroy()
    this.stationMarkerSystem.destroy()
    this.stationSystem.destroy()
    this.debugOverlaySystem.getContainer().destroy({ children: true })
    this.trainSystem.destroy()

    // Clear train registry
    this.trainRegistry.clear()

    try {
      if (this.onKeyDown) {
        window.removeEventListener('keydown', this.onKeyDown)
        this.onKeyDown = null
      }
      this.app.ticker.remove(this.handleTick, this)
      this.app.destroy(true, { children: true })
    } catch {
      // Ignore errors during destroy - may already be destroyed
    }
    this.app = null
  }

  private smooth(prev: number, next: number, alpha: number): number {
    if (!Number.isFinite(prev) || prev === 0) return next
    return prev + (next - prev) * alpha
  }

  private getTargetFps(now: number): number {
    if (this.lowPowerMode) return 30
    if (this.followTrainId) return 60
    if (this.zoomController.isAnimating()) return 60
    if (this.isDragging) return 60
    if (now < this.interactionUntilMs) return 60
    return 30
  }

  private setupDebugControls(): void {
    if (this.onKeyDown) return

    const savedSignals = localStorage.getItem('debug.showSignals') === '1'
    const savedBlocks = localStorage.getItem('debug.showBlocks') === '1'
    this.debugOverlaySystem.setShowSignals(savedSignals)
    this.debugOverlaySystem.setShowReservedBlocks(savedBlocks)

    this.onKeyDown = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      const key = e.key.toLowerCase()
      if (key === 's') {
        const next = !this.debugOverlaySystem.getShowSignals()
        this.debugOverlaySystem.setShowSignals(next)
        localStorage.setItem('debug.showSignals', next ? '1' : '0')
        this.scheduleRender()
        this.ensureTickerRunning()
      } else if (key === 'b') {
        const next = !this.debugOverlaySystem.getShowReservedBlocks()
        this.debugOverlaySystem.setShowReservedBlocks(next)
        localStorage.setItem('debug.showBlocks', next ? '1' : '0')
        this.scheduleRender()
        this.ensureTickerRunning()
      }
    }

    window.addEventListener('keydown', this.onKeyDown)
  }

  /**
   * Get the train registry for external access
   */
  getTrainRegistry(): TrainRegistry {
    return this.trainRegistry
  }

  /**
   * Get the timetable system for departure board queries
   */
  getTimetableSystem(): TimetableSystem {
    return this.timetableSystem
  }

  /**
   * Get the track graph for pathfinding queries
   */
  getTrackGraph(): TrackGraph {
    return this.trackGraph
  }
}

function getCarLoadStatus(loadRatio: number): 'low' | 'medium' | 'high' | 'crowded' {
  if (loadRatio < 0.4) return 'low'
  if (loadRatio < 0.7) return 'medium'
  if (loadRatio < 0.9) return 'high'
  return 'crowded'
}
