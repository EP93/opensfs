/**
 * TrackSystem - Renders railway tracks from GeoJSON data
 */

import { Container, Graphics } from 'pixi.js'
import { type ChunkKey, makeChunkKey } from '@/game/streaming/ChunkKey'
import {
  capTileRange,
  enumerateChunkKeys,
  getVisibleTileRange,
} from '@/game/streaming/ViewportChunkSet'
import { lonLatToMercator, lonLatToTile, type Point, worldToScreen } from '@/game/utils/geo'
import type { TrackFeature } from '@/lib/mapLoader'
import type { Viewport } from '@/types/game'

/** Track style configuration */
interface TrackStyle {
  color: number
  width: number
  alpha: number
}

/** Track styles based on railway type */
type TrackStyleKey = 'rail' | 'light_rail' | 'subway' | 'tram' | 'default'

const TRACK_STYLES = {
  rail: { color: 0x4a4a4a, width: 2.5, alpha: 1 },
  light_rail: { color: 0x006f8f, width: 2, alpha: 1 },
  subway: { color: 0xf0d722, width: 2.5, alpha: 1 },
  tram: { color: 0xbe1414, width: 1.5, alpha: 0.8 },
  default: { color: 0x666666, width: 1.5, alpha: 0.7 },
} satisfies Record<TrackStyleKey, TrackStyle>

interface CachedTrack {
  id: string
  railway: string
  worldCoords: Point[]
}

function getOrCreateSet(map: Map<ChunkKey, Set<string>>, key: ChunkKey): Set<string> {
  const existing = map.get(key)
  if (existing) return existing
  const next = new Set<string>()
  map.set(key, next)
  return next
}

function rasterizeSegmentTiles(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void
): void {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy

  while (true) {
    visit(x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

export class TrackSystem {
  private container: Container
  private graphics: Graphics
  private tracksById: Map<string, CachedTrack> = new Map()
  private trackIdsByChunk: Map<string, string[]> = new Map()
  private lastViewport: Viewport | null = null
  private chunkZoom = 14
  private chunkMarginTiles = 1
  private maxVisibleChunks = 512
  private visibleTrackIds = new Set<string>()
  private lastVisibleChunkCount = 0
  private lastVisibleTrackCount = 0

  constructor() {
    this.container = new Container()
    this.container.label = 'tracks'
    this.graphics = new Graphics()
    this.container.addChild(this.graphics)
  }

  /**
   * Load tracks and build a chunk index from GeoJSON track features.
   *
   * Note: we intentionally render from simplified track features (GeoJSON) rather than
   * the full simulation network geometry to keep rendering smooth and lightweight.
   */
  loadTracks(features: TrackFeature[], chunkZoom = 14, chunkMarginTiles = 1): void {
    this.chunkZoom = chunkZoom
    this.chunkMarginTiles = chunkMarginTiles

    this.tracksById.clear()

    const trackIdsByChunkSet = new Map<ChunkKey, Set<string>>()

    for (const track of features) {
      if (track.coordinates.length < 2) continue

      const worldCoords: Point[] = []
      for (const coord of track.coordinates) {
        worldCoords.push(lonLatToMercator(coord))
      }

      this.tracksById.set(track.id, {
        id: track.id,
        railway: track.railway,
        worldCoords,
      })

      const first = track.coordinates[0]
      if (!first) continue

      let prevTile = lonLatToTile(first[0], first[1], this.chunkZoom)

      const addTile = (x: number, y: number) => {
        const key = makeChunkKey(this.chunkZoom, x, y)
        getOrCreateSet(trackIdsByChunkSet, key).add(track.id)
      }

      addTile(prevTile.x, prevTile.y)

      for (let i = 1; i < track.coordinates.length; i++) {
        const cur = track.coordinates[i]
        if (!cur) continue
        const curTile = lonLatToTile(cur[0], cur[1], this.chunkZoom)

        if (curTile.x === prevTile.x && curTile.y === prevTile.y) {
          prevTile = curTile
          continue
        }

        rasterizeSegmentTiles(prevTile.x, prevTile.y, curTile.x, curTile.y, addTile)
        prevTile = curTile
      }
    }

    this.trackIdsByChunk.clear()
    for (const [key, set] of trackIdsByChunkSet) {
      const list = Array.from(set)
      list.sort()
      this.trackIdsByChunk.set(key, list)
    }

    this.invalidate()
  }

  /**
   * Render tracks based on current viewport
   */
  render(viewport: Viewport): void {
    // Skip if viewport hasn't changed significantly
    if (this.lastViewport && !this.viewportChanged(viewport)) {
      return
    }
    this.lastViewport = { ...viewport }

    this.graphics.clear()

    if (this.tracksById.size === 0) return

    const range = capTileRange(
      getVisibleTileRange(viewport, this.chunkZoom, this.chunkMarginTiles),
      this.maxVisibleChunks
    )
    const keys = enumerateChunkKeys(range)
    this.lastVisibleChunkCount = keys.length

    this.visibleTrackIds.clear()
    for (const key of keys) {
      const list = this.trackIdsByChunk.get(key)
      if (!list) continue
      for (const id of list) this.visibleTrackIds.add(id)
    }
    this.lastVisibleTrackCount = this.visibleTrackIds.size

    // Visible bounds with padding
    const padding = 100
    const minScreenX = -padding
    const maxScreenX = viewport.width + padding
    const minScreenY = -padding
    const maxScreenY = viewport.height + padding

    for (const trackId of this.visibleTrackIds) {
      const track = this.tracksById.get(trackId)
      if (!track || track.worldCoords.length < 2) continue

      const railway = track.railway ?? 'default'
      const style = TRACK_STYLES[railway as TrackStyleKey] ?? TRACK_STYLES.default
      const scaledWidth = Math.max(0.5, style.width * Math.min(2, viewport.zoom / 0.005))

      // Quick cull using first/last points.
      const first = track.worldCoords[0]
      const last = track.worldCoords[track.worldCoords.length - 1]
      const mid =
        track.worldCoords.length > 2
          ? track.worldCoords[Math.floor(track.worldCoords.length / 2)]
          : null
      if (!first || !last) continue
      const s0 = worldToScreen(first, viewport)
      const s1 = worldToScreen(last, viewport)
      const sm = mid ? worldToScreen(mid, viewport) : null
      const segMinX = Math.min(s0[0], s1[0], sm?.[0] ?? s0[0])
      const segMaxX = Math.max(s0[0], s1[0], sm?.[0] ?? s0[0])
      const segMinY = Math.min(s0[1], s1[1], sm?.[1] ?? s0[1])
      const segMaxY = Math.max(s0[1], s1[1], sm?.[1] ?? s0[1])
      if (
        segMaxX < minScreenX ||
        segMinX > maxScreenX ||
        segMaxY < minScreenY ||
        segMinY > maxScreenY
      ) {
        continue
      }

      this.graphics.setStrokeStyle({
        width: scaledWidth,
        color: style.color,
        alpha: style.alpha,
        cap: 'round',
        join: 'round',
      })

      this.graphics.moveTo(s0[0], s0[1])
      for (let i = 1; i < track.worldCoords.length; i++) {
        const p = track.worldCoords[i]
        if (!p) continue
        const screen = worldToScreen(p, viewport)
        this.graphics.lineTo(screen[0], screen[1])
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
   * Get track count
   */
  getTrackCount(): number {
    return this.tracksById.size
  }

  getLoadedChunkCount(): number {
    return this.trackIdsByChunk.size
  }

  getLastVisibleChunkCount(): number {
    return this.lastVisibleChunkCount
  }

  getLastVisibleTrackCount(): number {
    return this.lastVisibleTrackCount
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.graphics.destroy()
    this.container.destroy()
    this.trackIdsByChunk.clear()
    this.tracksById.clear()
    this.visibleTrackIds.clear()
  }
}
