/**
 * DebugOverlaySystem - Renders debug overlays for the network (signals + reserved blocks).
 */

import { Container, Graphics } from 'pixi.js'
import type { TrackGraph } from '@/game/graph/TrackGraph'
import { worldToScreen } from '@/game/utils/geo'
import type { Viewport } from '@/types/game'
import type { NetworkData } from '@/types/network'
import type { SignalSystem } from './SignalSystem'
import type { TrackReservationSystem } from './TrackReservationSystem'
import type { TrainMovementSystem } from './TrainMovementSystem'

function hashColor(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // Produce a bright-ish RGB.
  const r = 80 + (hash & 0x7f)
  const g = 80 + ((hash >> 8) & 0x7f)
  const b = 80 + ((hash >> 16) & 0x7f)
  return (r << 16) | (g << 8) | b
}

export class DebugOverlaySystem {
  private container: Container
  private graphics: Graphics
  private trackGraph: TrackGraph
  private reservationSystem: TrackReservationSystem
  private signalSystem: SignalSystem
  private movementSystem: TrainMovementSystem | null

  private signalNodeIds: Array<{ signalId: string; nodeId: string }> = []

  private showSignals = false
  private showReservedBlocks = false
  private showTrainRoute = false
  private debugTrainId: string | null = null
  private lastViewport: Viewport | null = null

  constructor(
    trackGraph: TrackGraph,
    reservationSystem: TrackReservationSystem,
    signalSystem: SignalSystem,
    movementSystem: TrainMovementSystem | null = null
  ) {
    this.trackGraph = trackGraph
    this.reservationSystem = reservationSystem
    this.signalSystem = signalSystem
    this.movementSystem = movementSystem

    this.container = new Container()
    this.container.label = 'debug-overlays'
    this.graphics = new Graphics()
    this.container.addChild(this.graphics)
  }

  loadNetwork(network: NetworkData): void {
    this.signalNodeIds = network.signals.map((s) => ({ signalId: s.id, nodeId: s.nodeId }))
    this.invalidate()
  }

  setShowSignals(value: boolean): void {
    this.showSignals = value
    this.invalidate()
  }

  setShowReservedBlocks(value: boolean): void {
    this.showReservedBlocks = value
    this.invalidate()
  }

  setShowTrainRoute(value: boolean): void {
    this.showTrainRoute = value
    this.invalidate()
  }

  setDebugTrainId(trainId: string | null): void {
    this.debugTrainId = trainId
    this.invalidate()
  }

  getShowSignals(): boolean {
    return this.showSignals
  }

  getShowReservedBlocks(): boolean {
    return this.showReservedBlocks
  }

  getShowTrainRoute(): boolean {
    return this.showTrainRoute
  }

  invalidate(): void {
    this.lastViewport = null
  }

  getContainer(): Container {
    return this.container
  }

  render(viewport: Viewport): void {
    if (!this.showSignals && !this.showReservedBlocks && !this.showTrainRoute) {
      this.graphics.clear()
      this.lastViewport = { ...viewport }
      return
    }

    if (this.lastViewport && !this.viewportChanged(viewport)) {
      return
    }
    this.lastViewport = { ...viewport }

    this.graphics.clear()

    const padding = 100
    const minX = -padding
    const maxX = viewport.width + padding
    const minY = -padding
    const maxY = viewport.height + padding

    if (this.showReservedBlocks) {
      this.renderReservedBlocks(viewport, minX, maxX, minY, maxY)
    }

    if (this.showTrainRoute) {
      this.renderTrainRoute(viewport, minX, maxX, minY, maxY)
    }

    if (this.showSignals) {
      this.renderSignals(viewport, minX, maxX, minY, maxY)
    }
  }

  private renderReservedBlocks(
    viewport: Viewport,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): void {
    const reservations = this.reservationSystem.getReservations()
    if (reservations.length === 0) return

    const width = Math.max(1, Math.min(6, viewport.zoom / 0.01))

    for (const { blockId, trainId } of reservations) {
      const coords = this.trackGraph.getTrackCoordinates(blockId)
      if (!coords || coords.length < 2) continue

      const firstCoord = coords[0]
      if (!firstCoord) continue
      const first = worldToScreen(firstCoord, viewport)
      if (
        first[0] < minX - 500 ||
        first[0] > maxX + 500 ||
        first[1] < minY - 500 ||
        first[1] > maxY + 500
      ) {
        // Cheap visibility guard for very long polylines.
      }

      const color = hashColor(trainId)
      this.graphics.setStrokeStyle({ width, color, alpha: 0.65, cap: 'round', join: 'round' })

      this.graphics.moveTo(first[0], first[1])
      for (let i = 1; i < coords.length; i++) {
        const p = coords[i]
        if (!p) continue
        const s = worldToScreen(p, viewport)
        this.graphics.lineTo(s[0], s[1])
      }
      this.graphics.stroke()
    }
  }

  private renderSignals(
    viewport: Viewport,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): void {
    const radius = Math.max(2, Math.min(6, viewport.zoom / 0.01))

    for (const s of this.signalNodeIds) {
      const pos = this.trackGraph.getNodeWorldPosition(s.nodeId)
      if (!pos) continue

      const screen = worldToScreen(pos, viewport)
      if (screen[0] < minX || screen[0] > maxX || screen[1] < minY || screen[1] > maxY) continue

      const aspect = this.signalSystem.getAspect(s.signalId)
      const color = aspect === 'STOP' ? 0xec0016 : 0x00b16a

      this.graphics.circle(screen[0], screen[1], radius)
      this.graphics.fill({ color, alpha: 0.9 })
    }
  }

  private renderTrainRoute(
    viewport: Viewport,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): void {
    const trainId = this.debugTrainId
    if (!trainId) return
    if (!this.movementSystem) return

    const movement = this.movementSystem.getMovementState(trainId)
    if (!movement) return

    const path = movement.path
    if (!path.found || path.segments.length === 0) return

    const width = Math.max(2, Math.min(7, viewport.zoom / 0.012))
    const color = hashColor(trainId)
    this.graphics.setStrokeStyle({ width, color, alpha: 0.85, cap: 'round', join: 'round' })

    for (const seg of path.segments) {
      const coords = seg.link.coordinates
      if (coords.length < 2) continue

      const first = coords[0]
      if (!first) continue
      const firstScreen = worldToScreen(first, viewport)
      if (
        firstScreen[0] < minX - 800 ||
        firstScreen[0] > maxX + 800 ||
        firstScreen[1] < minY - 800 ||
        firstScreen[1] > maxY + 800
      ) {
        // Cheap guard; still draw if potentially visible later in polyline.
      }

      this.graphics.moveTo(firstScreen[0], firstScreen[1])
      for (let i = 1; i < coords.length; i++) {
        const p = coords[i]
        if (!p) continue
        const s = worldToScreen(p, viewport)
        this.graphics.lineTo(s[0], s[1])
      }
      this.graphics.stroke()
    }
  }

  private viewportChanged(viewport: Viewport): boolean {
    if (!this.lastViewport) return true
    const threshold = 0.1
    return (
      Math.abs(viewport.x - this.lastViewport.x) > threshold ||
      Math.abs(viewport.y - this.lastViewport.y) > threshold ||
      Math.abs(viewport.zoom - this.lastViewport.zoom) > 0.0001 ||
      viewport.width !== this.lastViewport.width ||
      viewport.height !== this.lastViewport.height
    )
  }
}
