/**
 * StationMarkerSystem - Renders station markers efficiently using a single Graphics.
 * Labels + hit-testing are handled by StationSystem.
 */

import { Container, Graphics } from 'pixi.js'
import { lonLatToMercator, type Point, worldToScreen } from '@/game/utils/geo'
import type { StationFeature } from '@/lib/mapLoader'
import type { Viewport } from '@/types/game'

interface StationStyle {
  color: number
  radius: number
  minZoom: number
}

type StationStyleKey = 'station' | 'halt' | 'stop'

const STATION_STYLES = {
  station: { color: 0xec0016, radius: 6, minZoom: 0.0001 },
  halt: { color: 0x006f8f, radius: 4, minZoom: 0.002 },
  stop: { color: 0x666666, radius: 3, minZoom: 0.004 },
} satisfies Record<StationStyleKey, StationStyle>

interface CachedStation {
  id: string
  railway: 'station' | 'halt' | 'stop'
  worldCoord: Point
  style: StationStyle
}

export class StationMarkerSystem {
  private container: Container
  private graphics: Graphics
  private stations: CachedStation[] = []
  private lastViewport: Viewport | null = null

  constructor() {
    this.container = new Container()
    this.container.label = 'station-markers'
    this.graphics = new Graphics()
    this.container.addChild(this.graphics)
  }

  loadStations(features: StationFeature[]): void {
    this.stations = []
    for (const feature of features) {
      const railway: StationStyleKey =
        feature.railway === 'halt' || feature.railway === 'stop' ? feature.railway : 'station'
      const style = STATION_STYLES[railway] ?? STATION_STYLES.station
      this.stations.push({
        id: feature.id,
        railway,
        worldCoord: lonLatToMercator(feature.coordinates),
        style,
      })
    }
  }

  render(viewport: Viewport): void {
    if (this.lastViewport && !this.viewportChanged(viewport)) return
    this.lastViewport = { ...viewport }

    this.graphics.clear()

    const padding = 50
    const minScreenX = -padding
    const maxScreenX = viewport.width + padding
    const minScreenY = -padding
    const maxScreenY = viewport.height + padding

    const outlineWidth = Math.max(0.5, Math.min(2, viewport.zoom / 0.01))
    this.graphics.setStrokeStyle({ width: outlineWidth, color: 0xffffff })

    for (const station of this.stations) {
      if (viewport.zoom < station.style.minZoom) continue
      const screen = worldToScreen(station.worldCoord, viewport)
      if (
        screen[0] < minScreenX ||
        screen[0] > maxScreenX ||
        screen[1] < minScreenY ||
        screen[1] > maxScreenY
      ) {
        continue
      }

      const scaledRadius = Math.max(2, station.style.radius * Math.min(3, viewport.zoom / 0.003))

      this.graphics.circle(screen[0], screen[1], scaledRadius)
      this.graphics.fill({ color: station.style.color })
      this.graphics.circle(screen[0], screen[1], scaledRadius)
      this.graphics.stroke()
    }
  }

  invalidate(): void {
    this.lastViewport = null
  }

  getContainer(): Container {
    return this.container
  }

  destroy(): void {
    this.graphics.destroy()
    this.container.destroy()
    this.stations = []
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
}
