/**
 * StationSystem - Renders railway stations from GeoJSON data
 */

import { Container, Text, TextStyle } from 'pixi.js'
import { lonLatToMercator, type Point, worldToScreen } from '@/game/utils/geo'
import type { StationFeature } from '@/lib/mapLoader'
import type { Viewport } from '@/types/game'

/** Station style configuration */
interface StationStyle {
  color: number
  radius: number
  minZoom: number
  showLabel: boolean
  labelMinZoom: number
}

/** Station styles based on railway type */
const STATION_STYLES: Record<string, StationStyle> = {
  station: {
    color: 0xec0016, // DB Red
    radius: 6,
    minZoom: 0.0001,
    showLabel: true,
    labelMinZoom: 0.003,
  },
  halt: {
    color: 0x006f8f, // Petrol
    radius: 4,
    minZoom: 0.002,
    showLabel: true,
    labelMinZoom: 0.005,
  },
  stop: {
    color: 0x666666,
    radius: 3,
    minZoom: 0.004,
    showLabel: true,
    labelMinZoom: 0.008,
  },
}

/** Cached station data */
interface CachedStation {
  id: string
  name: string
  railway: 'station' | 'halt' | 'stop'
  worldCoord: Point
  style: StationStyle
}

export class StationSystem {
  private container: Container
  private labelsContainer: Container
  private stations: CachedStation[] = []
  private lastViewport: Viewport | null = null
  private labelStyle: TextStyle
  private labelsByStationId: Map<string, Text> = new Map()
  private lastLabelRenderMs = 0

  constructor() {
    this.container = new Container()
    this.container.label = 'stations'

    this.labelsContainer = new Container()
    this.labelsContainer.label = 'station-labels'

    this.container.addChild(this.labelsContainer)

    this.labelStyle = new TextStyle({
      fontFamily: 'Arial, sans-serif',
      fontSize: 11,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
      align: 'left',
    })
  }

  /**
   * Load station features and convert coordinates to world space
   */
  loadStations(features: StationFeature[]): void {
    this.stations = []

    for (const feature of features) {
      const worldCoord = lonLatToMercator(feature.coordinates)

      // biome-ignore lint/style/noNonNullAssertion: station type always exists as default
      const style = STATION_STYLES[feature.railway] ?? STATION_STYLES['station']!

      this.stations.push({
        id: feature.id,
        name: feature.name,
        railway: feature.railway,
        worldCoord,
        style,
      })
    }

    // Sort by importance (main stations first so they render on top)
    this.stations.sort((a, b) => {
      const order: Record<string, number> = {
        station: 3,
        halt: 2,
        stop: 1,
      }
      return (order[b.railway] ?? 0) - (order[a.railway] ?? 0)
    })
  }

  /**
   * Render stations based on current viewport
   */
  render(viewport: Viewport): void {
    const now = performance.now()

    // Skip if viewport hasn't changed significantly
    if (this.lastViewport && !this.viewportChanged(viewport)) {
      return
    }

    // Labels are expensive; throttle updates (especially when zoomed out).
    const minIntervalMs = viewport.zoom >= 0.003 ? 120 : 250
    if (now - this.lastLabelRenderMs < minIntervalMs) return
    this.lastLabelRenderMs = now

    this.lastViewport = { ...viewport }

    // Hide all labels; we'll re-enable visible ones below.
    for (const label of this.labelsByStationId.values()) {
      label.visible = false
    }

    // Visible bounds with padding
    const padding = 50
    const minScreenX = -padding
    const maxScreenX = viewport.width + padding
    const minScreenY = -padding
    const maxScreenY = viewport.height + padding

    // Track label positions to avoid overlap
    const labelPositions: Array<{ x: number; y: number; width: number; height: number }> = []

    // Render each station
    for (const station of this.stations) {
      this.renderStation(
        station,
        viewport,
        minScreenX,
        maxScreenX,
        minScreenY,
        maxScreenY,
        labelPositions
      )
    }
  }

  private renderStation(
    station: CachedStation,
    viewport: Viewport,
    minScreenX: number,
    maxScreenX: number,
    minScreenY: number,
    maxScreenY: number,
    labelPositions: Array<{ x: number; y: number; width: number; height: number }>
  ): void {
    const { worldCoord, style, name } = station

    // Check zoom level
    if (viewport.zoom < style.minZoom) return

    const screenPos = worldToScreen(worldCoord, viewport)

    // Visibility check
    if (
      screenPos[0] < minScreenX ||
      screenPos[0] > maxScreenX ||
      screenPos[1] < minScreenY ||
      screenPos[1] > maxScreenY
    ) {
      return
    }

    const scaledRadius = Math.max(2, style.radius * Math.min(3, viewport.zoom / 0.003))

    // Draw label if zoom allows
    if (style.showLabel && viewport.zoom >= style.labelMinZoom && name !== 'Unknown') {
      const labelX = screenPos[0] + scaledRadius + 4
      const labelY = screenPos[1] - 6
      const labelWidth = name.length * 6.5
      const labelHeight = 14

      // Check for overlap with existing labels
      const overlaps = labelPositions.some((pos) =>
        this.rectsOverlap(
          labelX,
          labelY,
          labelWidth,
          labelHeight,
          pos.x,
          pos.y,
          pos.width,
          pos.height
        )
      )

      if (!overlaps) {
        let label = this.labelsByStationId.get(station.id)
        if (!label) {
          label = new Text({ text: name, style: this.labelStyle })
          this.labelsByStationId.set(station.id, label)
          this.labelsContainer.addChild(label)
        } else if (label.text !== name) {
          label.text = name
        }

        label.position.set(labelX, labelY)
        label.visible = true

        labelPositions.push({ x: labelX, y: labelY, width: labelWidth, height: labelHeight })
      }
    }
  }

  private rectsOverlap(
    x1: number,
    y1: number,
    w1: number,
    h1: number,
    x2: number,
    y2: number,
    w2: number,
    h2: number
  ): boolean {
    return !(x1 + w1 < x2 || x2 + w2 < x1 || y1 + h1 < y2 || y2 + h2 < y1)
  }

  private viewportChanged(viewport: Viewport): boolean {
    if (!this.lastViewport) return true
    const threshold = 0.5
    return (
      Math.abs(viewport.x - this.lastViewport.x) > threshold ||
      Math.abs(viewport.y - this.lastViewport.y) > threshold ||
      Math.abs(viewport.zoom - this.lastViewport.zoom) > 0.00001 ||
      viewport.width !== this.lastViewport.width ||
      viewport.height !== this.lastViewport.height
    )
  }

  /**
   * Force a redraw on next render call
   */
  invalidate(): void {
    this.lastViewport = null
  }

  /**
   * Get the container for adding to stage
   */
  getContainer(): Container {
    return this.container
  }

  /**
   * Get station count
   */
  getStationCount(): number {
    return this.stations.length
  }

  /**
   * Find station at screen position
   */
  findStationAt(screenX: number, screenY: number, viewport: Viewport): CachedStation | null {
    const hitRadius = 15 // pixels

    for (const station of this.stations) {
      const screenPos = worldToScreen(station.worldCoord, viewport)
      const dx = screenX - screenPos[0]
      const dy = screenY - screenPos[1]
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance <= hitRadius) {
        return station
      }
    }

    return null
  }

  /**
   * Cleanup
   */
  destroy(): void {
    for (const label of this.labelsByStationId.values()) {
      label.destroy()
    }
    this.labelsByStationId.clear()

    this.labelsContainer.destroy({ children: true })
    this.container.destroy({ children: true })
    this.stations = []
  }
}
