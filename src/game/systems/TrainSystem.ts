/**
 * TrainSystem - Renders trains on the map using Pixi.js.
 */

import { Container, Graphics, Text, type TextStyle } from 'pixi.js'
import { type Point, worldToScreen } from '@/game/utils/geo'
import type { Viewport } from '@/types/game'
import type { OperationalState, TrainState } from '@/types/train'
import { hexColorToNumber } from '../data/trainTypes'
import type { TrainRegistry } from '../registries/TrainRegistry'
import type { TrainMovementSystem } from './TrainMovementSystem'

/** Train visual style configuration */
interface TrainStyle {
  bodyWidth: number
  bodyHeight: number
  labelFontSize: number
  speedFontSize: number
  minZoomToShow: number
  minZoomToShowLabel: number
  minZoomToShowSpeed: number
  minZoomToShowConsist: number
  minCarWidthPx: number
  maxTurnRateRadPerSec: number
  carGapMeters: number
}

const DEFAULT_STYLE: TrainStyle = {
  bodyWidth: 8,
  bodyHeight: 3,
  labelFontSize: 10,
  speedFontSize: 8,
  minZoomToShow: 0.0005,
  minZoomToShowLabel: 0.002,
  minZoomToShowSpeed: 0.005,
  minZoomToShowConsist: 0.006,
  minCarWidthPx: 2,
  maxTurnRateRadPerSec: Math.PI * 1.2,
  carGapMeters: 0.6,
}

/** Cached train rendering data */
interface CachedTrain {
  id: string
  graphics: Graphics
  label: Text | null
  speedText: Text | null
  lastState: OperationalState
  lastPosition: Point
  lastHeading: number
  renderHeading: number
  lastMode: 'icon' | 'consist'
  lastLoadSignature: string
  lastZoom: number
  lastVisibleMs: number
}

/** Delay status colors */
const DELAY_COLORS = {
  onTime: 0x00aa00, // Green
  slight: 0xf0a000, // Yellow/Orange
  delayed: 0xec0016, // Red
}

/** State colors (background tint) */
const STATE_COLORS: Record<OperationalState, number> = {
  depot: 0x666666,
  preparing: 0x888888,
  departing: 0x00aa00,
  running: 0x00aa00,
  approaching: 0xf0a000,
  at_station: 0x0066cc,
  terminated: 0x666666,
}

export class TrainSystem {
  private container: Container
  private trainRegistry: TrainRegistry
  private movementSystem: TrainMovementSystem | null
  private style: TrainStyle
  private cachedTrains: Map<string, CachedTrain> = new Map()
  private labelStyle: TextStyle
  private speedStyle: TextStyle
  private selectedTrainId: string | null = null
  private protectedTrainIds: Set<string> = new Set()
  private lastRenderMs = 0

  constructor(
    trainRegistry: TrainRegistry,
    movementSystem: TrainMovementSystem | null = null,
    style: Partial<TrainStyle> = {}
  ) {
    this.trainRegistry = trainRegistry
    this.movementSystem = movementSystem
    this.style = { ...DEFAULT_STYLE, ...style }

    this.container = new Container()
    this.container.label = 'trains'
    this.container.sortableChildren = true

    // Create text styles
    this.labelStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: this.style.labelFontSize,
      fill: 0xffffff,
      fontWeight: 'bold',
      dropShadow: {
        alpha: 0.5,
        blur: 2,
        color: 0x000000,
        distance: 1,
      },
    } as TextStyle

    this.speedStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: this.style.speedFontSize,
      fill: 0xffffff,
      fontWeight: 'normal',
    } as TextStyle
  }

  /**
   * Render trains based on current viewport
   */
  render(viewport: Viewport): void {
    const now = performance.now()
    const deltaSeconds = this.lastRenderMs > 0 ? (now - this.lastRenderMs) / 1000 : 0
    this.lastRenderMs = now

    // Get all active trains
    const trains = this.trainRegistry.getActive()

    // Skip rendering if zoom is too low
    if (viewport.zoom < this.style.minZoomToShow) {
      this.container.visible = false
      return
    }
    this.container.visible = true

    // Track which trains we've rendered this frame
    const renderedTrainIds = new Set<string>()

    for (const train of trains) {
      this.renderTrain(train, viewport, deltaSeconds, now)
      renderedTrainIds.add(train.id)
    }

    // Remove trains that are no longer active
    for (const [trainId, cached] of this.cachedTrains) {
      if (!renderedTrainIds.has(trainId)) {
        this.removeCachedTrain(cached)
        this.cachedTrains.delete(trainId)
      }
    }

    // Evict long-offscreen trains to avoid accumulating render objects.
    const offscreenEvictMs = 15_000
    const toEvict: string[] = []
    for (const [trainId, cached] of this.cachedTrains) {
      if (!renderedTrainIds.has(trainId)) continue
      if (this.selectedTrainId === trainId) continue
      if (this.protectedTrainIds.has(trainId)) continue
      if (now - cached.lastVisibleMs < offscreenEvictMs) continue
      toEvict.push(trainId)
    }

    for (const trainId of toEvict) {
      const cached = this.cachedTrains.get(trainId)
      if (!cached) continue
      this.removeCachedTrain(cached)
      this.cachedTrains.delete(trainId)
    }
  }

  /**
   * Render a single train
   */
  private renderTrain(
    train: TrainState,
    viewport: Viewport,
    deltaSeconds: number,
    nowMs: number
  ): void {
    // Convert world position to screen
    const worldPos: Point = [train.worldPosition.x, train.worldPosition.y]
    const screenPos = worldToScreen(worldPos, viewport)

    // Check if visible
    const padding = 50
    if (
      screenPos[0] < -padding ||
      screenPos[0] > viewport.width + padding ||
      screenPos[1] < -padding ||
      screenPos[1] > viewport.height + padding
    ) {
      // Hide if not visible
      const cached = this.cachedTrains.get(train.id)
      if (cached) {
        cached.graphics.visible = false
        if (cached.label) cached.label.visible = false
        if (cached.speedText) cached.speedText.visible = false
      }
      return
    }

    // Get or create cached train
    let cached = this.cachedTrains.get(train.id)
    if (!cached) {
      cached = this.createCachedTrain(train, nowMs)
      this.cachedTrains.set(train.id, cached)
    }
    cached.lastVisibleMs = nowMs

    const targetHeading = train.worldPosition.heading
    if (!Number.isFinite(cached.renderHeading)) {
      cached.renderHeading = targetHeading
    } else if (deltaSeconds > 0) {
      const delta = angleDelta(cached.renderHeading, targetHeading)
      const maxStep = this.style.maxTurnRateRadPerSec * deltaSeconds
      const step = clamp(delta, -maxStep, maxStep)
      cached.renderHeading = normalizeAngle(cached.renderHeading + step)
    } else {
      cached.renderHeading = targetHeading
    }

    const useConsist = viewport.zoom >= this.style.minZoomToShowConsist
    const mode: CachedTrain['lastMode'] = useConsist ? 'consist' : 'icon'
    const loadSignature = useConsist
      ? train.consist.cars.map((car) => Math.round((car.occupancy.loadRatio ?? 0) * 100)).join(',')
      : ''

    const useCurvedConsist = useConsist && this.movementSystem !== null

    if (!useCurvedConsist) {
      if (
        mode !== cached.lastMode ||
        (useConsist &&
          (cached.lastLoadSignature !== loadSignature ||
            cached.lastZoom !== viewport.zoom ||
            cached.lastState !== train.state))
      ) {
        if (useConsist) {
          this.drawTrainConsist(cached.graphics, train, viewport.zoom)
        } else {
          this.drawTrainBody(cached.graphics, train)
        }
        cached.lastMode = mode
        cached.lastLoadSignature = loadSignature
        cached.lastZoom = viewport.zoom
        cached.lastState = train.state
      } else if (!useConsist && cached.lastState !== train.state) {
        this.updateTrainAppearance(cached, train)
        cached.lastState = train.state
      }
    }

    if (useCurvedConsist) {
      this.drawTrainConsistCurved(cached.graphics, train, viewport)
      cached.lastMode = 'consist'
      cached.lastLoadSignature = loadSignature
      cached.lastZoom = viewport.zoom
      cached.lastState = train.state

      cached.graphics.x = 0
      cached.graphics.y = 0
      cached.graphics.rotation = 0
      cached.graphics.scale.set(1)
      cached.graphics.visible = true
      cached.graphics.zIndex = this.selectedTrainId === train.id ? 2 : 0
      cached.graphics.alpha = this.selectedTrainId && this.selectedTrainId !== train.id ? 0.35 : 1
    } else {
      // Update position and rotation
      cached.graphics.x = screenPos[0]
      cached.graphics.y = screenPos[1]
      cached.graphics.rotation = -cached.renderHeading // Negate for screen coordinates
      cached.graphics.visible = true
      cached.graphics.zIndex = this.selectedTrainId === train.id ? 2 : 0
      cached.graphics.alpha = this.selectedTrainId && this.selectedTrainId !== train.id ? 0.35 : 1

      // Scale based on zoom
      const scale = Math.min(3, Math.max(0.5, viewport.zoom / 0.002))
      cached.graphics.scale.set(scale)
    }

    const scale = useConsist ? 1 : Math.min(3, Math.max(0.5, viewport.zoom / 0.002))

    // Update label
    if (cached.label) {
      if (viewport.zoom >= this.style.minZoomToShowLabel) {
        cached.label.x = screenPos[0]
        cached.label.y = screenPos[1] - 15 * scale
        cached.label.visible = true
        cached.label.scale.set(Math.min(1, scale))
        cached.label.alpha = this.selectedTrainId && this.selectedTrainId !== train.id ? 0.35 : 1
        cached.label.zIndex = this.selectedTrainId === train.id ? 3 : 1
      } else {
        cached.label.visible = false
      }
    }

    // Update speed text
    if (cached.speedText) {
      if (viewport.zoom >= this.style.minZoomToShowSpeed && train.state !== 'at_station') {
        cached.speedText.text = `${Math.round(train.currentSpeed)} km/h`
        cached.speedText.x = screenPos[0]
        cached.speedText.y = screenPos[1] + 12 * scale
        cached.speedText.visible = true
        cached.speedText.scale.set(Math.min(1, scale * 0.8))
        cached.speedText.alpha =
          this.selectedTrainId && this.selectedTrainId !== train.id ? 0.35 : 1
        cached.speedText.zIndex = this.selectedTrainId === train.id ? 3 : 1
      } else {
        cached.speedText.visible = false
      }
    }

    cached.lastPosition = worldPos
    cached.lastHeading = train.worldPosition.heading
  }

  /**
   * Create cached train graphics
   */
  private createCachedTrain(train: TrainState, nowMs: number): CachedTrain {
    const graphics = new Graphics()

    // Draw train body
    this.drawTrainBody(graphics, train)

    this.container.addChild(graphics)

    // Create label
    const label = new Text({
      text: train.lineId,
      style: this.labelStyle,
    })
    label.anchor.set(0.5, 1)
    label.zIndex = 1
    this.container.addChild(label)

    // Create speed text
    const speedText = new Text({
      text: '0 km/h',
      style: this.speedStyle,
    })
    speedText.anchor.set(0.5, 0)
    speedText.zIndex = 1
    this.container.addChild(speedText)

    return {
      id: train.id,
      graphics,
      label,
      speedText,
      lastState: train.state,
      lastPosition: [train.worldPosition.x, train.worldPosition.y],
      lastHeading: train.worldPosition.heading,
      renderHeading: Number.NaN,
      lastMode: 'icon',
      lastLoadSignature: '',
      lastZoom: 0,
      lastVisibleMs: nowMs,
    }
  }

  /**
   * Draw train body shape
   */
  private drawTrainBody(graphics: Graphics, train: TrainState): void {
    const { bodyWidth, bodyHeight } = this.style
    const halfWidth = bodyWidth / 2
    const halfHeight = bodyHeight / 2

    // Get train color from type spec
    const primaryColor = hexColorToNumber(train.consist.typeSpec.appearance.primaryColor)
    const secondaryColor = hexColorToNumber(train.consist.typeSpec.appearance.secondaryColor)
    const stateColor = STATE_COLORS[train.state]

    graphics.clear()

    // Draw body outline
    graphics.setStrokeStyle({ width: 1, color: 0x000000 })

    // Main body rectangle
    graphics.roundRect(-halfWidth, -halfHeight, bodyWidth, halfHeight * 2, 1.2)
    graphics.fill({ color: primaryColor })
    graphics.stroke()

    // Roof stripe
    const stripeHeight = Math.max(0.6, bodyHeight * 0.25)
    graphics.rect(-halfWidth, -halfHeight, bodyWidth, stripeHeight)
    graphics.fill({ color: secondaryColor, alpha: 0.9 })

    // Direction indicator (front of train)
    graphics.moveTo(halfWidth, -halfHeight)
    graphics.lineTo(halfWidth + 3, 0)
    graphics.lineTo(halfWidth, halfHeight)
    graphics.closePath()
    graphics.fill({ color: primaryColor })
    graphics.stroke()

    // State indicator (small circle at back)
    graphics.circle(-halfWidth + 2, 0, 1.5)
    graphics.fill({ color: stateColor })

    // Delay indicator
    const delayColor = this.getDelayColor(train.delay)
    graphics.circle(halfWidth - 2, 0, 1.5)
    graphics.fill({ color: delayColor })
  }

  private drawTrainConsist(graphics: Graphics, train: TrainState, zoom: number): void {
    const cars = train.consist.cars
    if (cars.length === 0) {
      this.drawTrainBody(graphics, train)
      return
    }

    const gap = this.style.carGapMeters
    const renderLength = Math.max(0, train.consist.totalLength - gap * Math.max(0, cars.length - 1))
    const halfLength = renderLength / 2
    const baseWidth = train.consist.typeSpec.specifications.width
    const secondaryColor = hexColorToNumber(train.consist.typeSpec.appearance.secondaryColor)
    const accentColor = hexColorToNumber(train.consist.typeSpec.appearance.accentColor)
    const widthPx = Math.max(this.style.minCarWidthPx, baseWidth * zoom)

    graphics.clear()
    graphics.setStrokeStyle({ width: 1, color: 0x000000 })

    let cursor = 0
    for (const car of cars) {
      const carLengthPx = car.lengthMeters * zoom
      const centerX = (cursor + car.lengthMeters / 2 - halfLength) * zoom
      const halfL = carLengthPx / 2
      const halfW = widthPx / 2
      const loadColor = getLoadColor(car.occupancy.loadRatio ?? 0)
      const corner = Math.min(2, Math.max(0.8, widthPx * 0.25), carLengthPx * 0.2)

      graphics.roundRect(centerX - halfL, -halfW, carLengthPx, widthPx, corner)
      graphics.fill({ color: loadColor })
      graphics.stroke()

      // Roof stripe
      const stripeHeight = Math.max(1, widthPx * 0.2)
      graphics.rect(centerX - halfL, -halfW, carLengthPx, stripeHeight)
      graphics.fill({ color: secondaryColor, alpha: 0.9 })

      // Window band
      const windowHeight = Math.max(1, widthPx * 0.35)
      const windowY = -windowHeight / 2
      graphics.rect(centerX - halfL + 1, windowY, Math.max(1, carLengthPx - 2), windowHeight)
      graphics.fill({ color: 0x111111, alpha: 0.7 })

      // Class band
      const classBandColor = car.class === 'first' ? 0xcaa04a : accentColor
      graphics.rect(centerX - halfL, halfW - 1.2, carLengthPx, 1.2)
      graphics.fill({ color: classBandColor, alpha: 0.9 })

      cursor += car.lengthMeters - gap
    }

    // Direction indicator at the front
    graphics.moveTo(halfLength * zoom, -widthPx / 2)
    graphics.lineTo(halfLength * zoom + 4, 0)
    graphics.lineTo(halfLength * zoom, widthPx / 2)
    graphics.closePath()
    graphics.fill({ color: 0xffffff })
    graphics.stroke()

    // State + delay indicators
    const stateColor = STATE_COLORS[train.state]
    const delayColor = this.getDelayColor(train.delay)
    graphics.circle(-halfLength * zoom + 2, 0, 1.5)
    graphics.fill({ color: stateColor })
    graphics.circle(halfLength * zoom - 2, 0, 1.5)
    graphics.fill({ color: delayColor })
  }

  private drawTrainConsistCurved(graphics: Graphics, train: TrainState, viewport: Viewport): void {
    if (!this.movementSystem) {
      this.drawTrainConsist(graphics, train, viewport.zoom)
      return
    }

    const frontOffset = this.movementSystem.getPathOffset(train.id)
    if (frontOffset === null) {
      this.drawTrainConsist(graphics, train, viewport.zoom)
      return
    }

    const cars = train.consist.cars
    const gap = this.style.carGapMeters
    const renderLength = Math.max(0, train.consist.totalLength - gap * Math.max(0, cars.length - 1))
    const baseWidth = train.consist.typeSpec.specifications.width
    const secondaryColor = hexColorToNumber(train.consist.typeSpec.appearance.secondaryColor)
    const accentColor = hexColorToNumber(train.consist.typeSpec.appearance.accentColor)
    const widthPx = Math.max(this.style.minCarWidthPx, baseWidth * viewport.zoom)

    graphics.clear()
    graphics.setStrokeStyle({ width: 1, color: 0x000000 })

    let cursor = 0
    for (const car of cars) {
      const carCenterFromFront = cursor + car.lengthMeters / 2
      const carOffset = Math.max(0, frontOffset - carCenterFromFront)
      const carPos = this.movementSystem.getPathPositionForOffset(train.id, carOffset)
      if (!carPos) continue

      const screenPos = worldToScreen(carPos.worldPosition, viewport)
      const angle = -carPos.heading
      const loadColor = getLoadColor(car.occupancy.loadRatio ?? 0)
      const carLengthPx = car.lengthMeters * viewport.zoom
      const halfW = widthPx / 2

      drawOrientedRect(
        graphics,
        screenPos[0],
        screenPos[1],
        angle,
        carLengthPx,
        widthPx,
        loadColor,
        1,
        true
      )

      // Roof stripe
      const stripeHeight = Math.max(1, widthPx * 0.2)
      const stripeOffset = -halfW + stripeHeight / 2
      drawOrientedRect(
        graphics,
        screenPos[0] + Math.cos(angle + Math.PI / 2) * stripeOffset,
        screenPos[1] + Math.sin(angle + Math.PI / 2) * stripeOffset,
        angle,
        carLengthPx,
        stripeHeight,
        secondaryColor,
        0.9,
        false
      )

      // Window band
      const windowHeight = Math.max(1, widthPx * 0.35)
      drawOrientedRect(
        graphics,
        screenPos[0],
        screenPos[1],
        angle,
        Math.max(1, carLengthPx - 2),
        windowHeight,
        0x111111,
        0.7,
        false
      )

      // Class band
      const classBandColor = car.class === 'first' ? 0xcaa04a : accentColor
      const classBandHeight = 1.2
      const classOffset = halfW - classBandHeight / 2
      drawOrientedRect(
        graphics,
        screenPos[0] + Math.cos(angle + Math.PI / 2) * classOffset,
        screenPos[1] + Math.sin(angle + Math.PI / 2) * classOffset,
        angle,
        carLengthPx,
        classBandHeight,
        classBandColor,
        0.9,
        false
      )

      cursor += car.lengthMeters - gap
    }

    const stateColor = STATE_COLORS[train.state]
    const delayColor = this.getDelayColor(train.delay)
    const frontPos = this.movementSystem.getPathPositionForOffset(train.id, frontOffset)
    const backPos = this.movementSystem.getPathPositionForOffset(
      train.id,
      Math.max(0, frontOffset - renderLength)
    )
    if (backPos) {
      const screenPos = worldToScreen(backPos.worldPosition, viewport)
      graphics.circle(screenPos[0], screenPos[1], 1.5)
      graphics.fill({ color: stateColor })
    }
    if (frontPos) {
      const screenPos = worldToScreen(frontPos.worldPosition, viewport)
      graphics.circle(screenPos[0], screenPos[1], 1.5)
      graphics.fill({ color: delayColor })
    }
  }

  /**
   * Update train appearance (called when state changes)
   */
  private updateTrainAppearance(cached: CachedTrain, train: TrainState): void {
    this.drawTrainBody(cached.graphics, train)
  }

  /**
   * Get delay indicator color
   */
  private getDelayColor(delaySeconds: number): number {
    if (delaySeconds < 60) return DELAY_COLORS.onTime
    if (delaySeconds < 300) return DELAY_COLORS.slight // < 5 min
    return DELAY_COLORS.delayed
  }

  /**
   * Remove a cached train
   */
  private removeCachedTrain(cached: CachedTrain): void {
    this.container.removeChild(cached.graphics)
    cached.graphics.destroy()

    if (cached.label) {
      this.container.removeChild(cached.label)
      cached.label.destroy()
    }

    if (cached.speedText) {
      this.container.removeChild(cached.speedText)
      cached.speedText.destroy()
    }
  }

  /**
   * Force a redraw on next render (no-op for train system, trains are always redrawn)
   */
  invalidate(): void {
    // Trains are always redrawn each frame, so this is a no-op
  }

  setSelectedTrainId(trainId: string | null): void {
    this.selectedTrainId = trainId
  }

  setProtectedTrainIds(trainIds: Array<string | null>): void {
    this.protectedTrainIds.clear()
    for (const id of trainIds) {
      if (!id) continue
      this.protectedTrainIds.add(id)
    }
  }

  /**
   * Get the container for adding to stage
   */
  getContainer(): Container {
    return this.container
  }

  /**
   * Get train count being rendered
   */
  getTrainCount(): number {
    return this.cachedTrains.size
  }

  /**
   * Find train at screen position (for click detection)
   */
  findTrainAt(screenX: number, screenY: number, viewport: Viewport): TrainState | null {
    const hitRadius = 20 // Pixels

    for (const train of this.trainRegistry.getActive()) {
      const worldPos: Point = [train.worldPosition.x, train.worldPosition.y]
      const screenPos = worldToScreen(worldPos, viewport)

      if (viewport.zoom >= this.style.minZoomToShowConsist && this.movementSystem) {
        const frontOffset = this.movementSystem.getPathOffset(train.id)
        if (frontOffset !== null) {
          const gap = this.style.carGapMeters
          const widthPx = Math.max(
            this.style.minCarWidthPx,
            train.consist.typeSpec.specifications.width * viewport.zoom
          )
          let cursor = 0
          for (const car of train.consist.cars) {
            const carCenterFromFront = cursor + car.lengthMeters / 2
            const carOffset = Math.max(0, frontOffset - carCenterFromFront)
            const pos = this.movementSystem.getPathPositionForOffset(train.id, carOffset)
            if (!pos) continue
            const center = worldToScreen(pos.worldPosition, viewport)
            const radius = Math.max(widthPx, (car.lengthMeters * viewport.zoom) / 2)
            const dx = screenX - center[0]
            const dy = screenY - center[1]
            if (Math.sqrt(dx * dx + dy * dy) <= radius) return train

            cursor += car.lengthMeters - gap
          }
        }
      } else {
        const dx = screenX - screenPos[0]
        const dy = screenY - screenPos[1]
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance < hitRadius) {
          return train
        }
      }
    }

    return null
  }

  /**
   * Cleanup
   */
  destroy(): void {
    for (const cached of this.cachedTrains.values()) {
      this.removeCachedTrain(cached)
    }
    this.cachedTrains.clear()
    this.container.destroy()
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeAngle(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from)
}

function getLoadColor(loadRatio: number): number {
  const ratio = Math.max(0, Math.min(1, loadRatio))
  if (ratio <= 0.7) {
    return lerpColor(0x1fa64b, 0xf0a000, ratio / 0.7)
  }
  return lerpColor(0xf0a000, 0xec0016, (ratio - 0.7) / 0.3)
}

function lerpColor(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  const fr = (from >> 16) & 0xff
  const fg = (from >> 8) & 0xff
  const fb = from & 0xff
  const tr = (to >> 16) & 0xff
  const tg = (to >> 8) & 0xff
  const tb = to & 0xff
  const r = Math.round(fr + (tr - fr) * clamped)
  const g = Math.round(fg + (tg - fg) * clamped)
  const b = Math.round(fb + (tb - fb) * clamped)
  return (r << 16) | (g << 8) | b
}

function drawOrientedRect(
  graphics: Graphics,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  width: number,
  color: number,
  alpha = 1,
  stroke = false
): void {
  const halfL = length / 2
  const halfW = width / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const hx = cos * halfL
  const hy = sin * halfL
  const wx = -sin * halfW
  const wy = cos * halfW

  const p1x = cx - hx - wx
  const p1y = cy - hy - wy
  const p2x = cx + hx - wx
  const p2y = cy + hy - wy
  const p3x = cx + hx + wx
  const p3y = cy + hy + wy
  const p4x = cx - hx + wx
  const p4y = cy - hy + wy

  graphics.moveTo(p1x, p1y)
  graphics.lineTo(p2x, p2y)
  graphics.lineTo(p3x, p3y)
  graphics.lineTo(p4x, p4y)
  graphics.closePath()
  graphics.fill({ color, alpha })
  if (stroke) graphics.stroke()
}
