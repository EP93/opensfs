import { Container, Graphics } from 'pixi.js'
import type { TrackGraph } from '@/game/graph/TrackGraph'
import { getTileBounds, lonLatToMercator, type Point } from '@/game/utils/geo'
import type { StationFeature } from '@/lib/mapLoader'
import type { Viewport } from '@/types/game'
import type { NetworkData } from '@/types/network'
import { type ChunkKey, parseChunkKey } from './ChunkKey'
import { buildNetworkChunkIndex, buildStationChunkIndex } from './NetworkChunkIndex'
import { enumerateChunkKeys, getVisibleTileRange, type TileRange } from './ViewportChunkSet'

interface TrackStyle {
  color: number
  widthPx: number
  alpha: number
}

const TRACK_STYLES: Record<string, TrackStyle> & { default: TrackStyle } = {
  rail: { color: 0x4a4a4a, widthPx: 2.5, alpha: 1 },
  light_rail: { color: 0x006f8f, widthPx: 2, alpha: 1 },
  subway: { color: 0xf0d722, widthPx: 2.5, alpha: 1 },
  tram: { color: 0xbe1414, widthPx: 1.5, alpha: 0.8 },
  default: { color: 0x666666, widthPx: 1.5, alpha: 0.7 },
}

interface StationStyle {
  color: number
  radiusPx: number
  minZoom: number
}

const STATION_MARKER_STYLES: Record<string, StationStyle> & { station: StationStyle } = {
  station: { color: 0xec0016, radiusPx: 6, minZoom: 0.0001 },
  halt: { color: 0x006f8f, radiusPx: 4, minZoom: 0.002 },
  stop: { color: 0x666666, radiusPx: 3, minZoom: 0.004 },
}

interface CachedEdge {
  id: string
  railway: string
}

interface CachedStation {
  id: string
  railway: 'station' | 'halt' | 'stop'
  worldCoord: Point
}

interface ChunkEntry {
  key: ChunkKey
  container: Container
  trackGraphics: Graphics
  stationGraphics: Graphics
  originWorld: Point
  tileWorldWidth: number
  tileWorldHeight: number
  isCached: boolean
  lastUsedMs: number
  builtZoom: number
}

export interface StreamingStats {
  loadedChunks: number
  visibleChunks: number
  evictedChunks: number
}

export interface WorldChunkManagerOptions {
  chunkZoom: number
  chunkMarginTiles: number
  maxLoadedChunks: number
  softEvictAfterMs: number
  rebuildZoomThreshold: number
  rebuildBudgetPerUpdate: number
  maxCreatesPerUpdate: number
  cacheBudgetPerUpdate: number
  maxCacheTextureSizePx: number
}

const DEFAULT_OPTIONS: WorldChunkManagerOptions = {
  chunkZoom: 14,
  chunkMarginTiles: 1,
  maxLoadedChunks: 80,
  softEvictAfterMs: 10_000,
  rebuildZoomThreshold: 0.03,
  rebuildBudgetPerUpdate: 3,
  maxCreatesPerUpdate: 8,
  // Caching can easily explode GPU memory; keep it off by default.
  cacheBudgetPerUpdate: 0,
  maxCacheTextureSizePx: 0,
}

function edgeStyle(edge: CachedEdge): TrackStyle {
  return TRACK_STYLES[edge.railway] ?? TRACK_STYLES.default
}

function stationStyle(station: CachedStation): StationStyle {
  return STATION_MARKER_STYLES[station.railway] ?? STATION_MARKER_STYLES.station
}

function zoomSignature(zoom: number): number {
  return Math.max(1e-9, zoom)
}

function zoomChangedEnough(a: number, b: number, threshold: number): boolean {
  const aa = zoomSignature(a)
  const bb = zoomSignature(b)
  return Math.abs(aa - bb) / Math.max(aa, bb) >= threshold
}

function toWorldWidth(px: number, zoom: number): number {
  return px / zoomSignature(zoom)
}

function toWorldRadius(px: number, zoom: number): number {
  return px / zoomSignature(zoom)
}

export class WorldChunkManager {
  private root: Container
  private edgesByChunk: Map<ChunkKey, string[]>
  private stationsByChunk: Map<ChunkKey, string[]>

  private edgeCache: Map<string, CachedEdge>
  private stationCache: Map<string, CachedStation>
  private trackGraph: TrackGraph

  private chunks: Map<ChunkKey, ChunkEntry> = new Map()
  private visibleChunksCount = 0
  private lastVisibleChunkKeys: ChunkKey[] = []
  private evictedChunksTotal = 0

  private zoomAnimating = false
  private rebuildQueue: ChunkKey[] = []
  private rebuildQueued: Set<ChunkKey> = new Set()

  private options: WorldChunkManagerOptions

  constructor(
    network: NetworkData,
    stations: StationFeature[],
    trackGraph: TrackGraph,
    options: Partial<WorldChunkManagerOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }

    this.root = new Container()
    this.root.label = 'world-chunks'

    this.edgesByChunk = buildNetworkChunkIndex(network, this.options.chunkZoom)
    this.stationsByChunk = buildStationChunkIndex(stations, this.options.chunkZoom)

    this.trackGraph = trackGraph
    this.edgeCache = new Map()
    this.stationCache = new Map()

    for (const edge of network.edges) {
      this.edgeCache.set(edge.id, {
        id: edge.id,
        railway: edge.railway,
      })
    }

    for (const station of stations) {
      this.stationCache.set(station.id, {
        id: station.id,
        railway: station.railway,
        worldCoord: lonLatToMercator(station.coordinates),
      })
    }
  }

  getContainer(): Container {
    return this.root
  }

  getStats(): StreamingStats {
    return {
      loadedChunks: this.chunks.size,
      visibleChunks: this.visibleChunksCount,
      evictedChunks: this.evictedChunksTotal,
    }
  }

  setZoomAnimating(isAnimating: boolean): void {
    if (this.zoomAnimating === isAnimating) return
    this.zoomAnimating = isAnimating

    for (const chunk of this.chunks.values()) {
      if (isAnimating) {
        // Avoid generating huge intermediate textures while zooming.
        this.setChunkCached(chunk, false)
      }
    }

    if (!isAnimating) {
      // Zoom ended; refresh what we can (budgeted).
      for (const key of this.lastVisibleChunkKeys) {
        this.enqueueRebuild(key)
      }
    }
  }

  update(viewport: Viewport): void {
    const now = performance.now()

    const range = getVisibleTileRange(
      viewport,
      this.options.chunkZoom,
      this.options.chunkMarginTiles
    )
    const effectiveRange = capTileRange(range, this.options.maxLoadedChunks)
    const needed = enumerateChunkKeys(effectiveRange)
    this.visibleChunksCount = needed.length
    this.lastVisibleChunkKeys = needed
    const neededSet = new Set(needed)

    let createsRemaining = this.options.maxCreatesPerUpdate
    for (const key of needed) {
      const existing = this.chunks.get(key)
      if (existing) {
        existing.lastUsedMs = now
        if (
          !this.zoomAnimating &&
          zoomChangedEnough(existing.builtZoom, viewport.zoom, this.options.rebuildZoomThreshold)
        ) {
          this.enqueueRebuild(key)
        }
        continue
      }

      if (createsRemaining <= 0) continue
      const created = this.createChunk(key, viewport.zoom, now)
      this.root.addChild(created.container)
      this.chunks.set(key, created)
      createsRemaining--
    }

    // Soft eviction for chunks outside the needed set.
    for (const [key, chunk] of this.chunks) {
      if (neededSet.has(key)) continue
      if (now - chunk.lastUsedMs <= this.options.softEvictAfterMs) continue
      this.evictChunk(key)
    }

    // Hard cap eviction (LRU, never evict needed chunks).
    if (this.chunks.size > this.options.maxLoadedChunks) {
      const candidates: ChunkEntry[] = []
      for (const [key, chunk] of this.chunks) {
        if (neededSet.has(key)) continue
        candidates.push(chunk)
      }
      candidates.sort((a, b) => a.lastUsedMs - b.lastUsedMs)
      for (const c of candidates) {
        if (this.chunks.size <= this.options.maxLoadedChunks) break
        this.evictChunk(c.key)
      }
    }

    // Budgeted rebuilds (avoid stalling after zoom).
    if (!this.zoomAnimating) {
      this.processRebuildQueue(viewport.zoom, now)
      this.applyCaching(neededSet, viewport.zoom)
    } else {
      // Never cache during zoom animations.
      for (const chunk of this.chunks.values()) {
        this.setChunkCached(chunk, false)
      }
    }
  }

  destroy(): void {
    for (const key of Array.from(this.chunks.keys())) {
      this.evictChunk(key)
    }
    this.root.destroy({ children: true })
  }

  private createChunk(key: ChunkKey, zoom: number, now: number): ChunkEntry {
    const parsed = parseChunkKey(key)
    const bounds = parsed ? getTileBounds(parsed.x, parsed.y, parsed.z) : null
    const originWorld = bounds ? lonLatToMercator(bounds.nw) : ([0, 0] as Point)
    const seWorld = bounds ? lonLatToMercator(bounds.se) : ([0, 0] as Point)
    const tileWorldWidth = Math.abs(seWorld[0] - originWorld[0])
    const tileWorldHeight = Math.abs(seWorld[1] - originWorld[1])

    const container = new Container()
    container.label = `chunk:${key}`
    container.cacheAsTexture(false)
    container.position.set(originWorld[0], originWorld[1])

    const trackGraphics = new Graphics()
    trackGraphics.label = `tracks:${key}`
    container.addChild(trackGraphics)

    const stationGraphics = new Graphics()
    stationGraphics.label = `stations:${key}`
    container.addChild(stationGraphics)

    const entry: ChunkEntry = {
      key,
      container,
      trackGraphics,
      stationGraphics,
      originWorld,
      tileWorldWidth,
      tileWorldHeight,
      isCached: false,
      lastUsedMs: now,
      builtZoom: zoomSignature(zoom),
    }

    // Build budgeted (avoids big main-thread spikes during initial load).
    this.enqueueRebuild(key)

    return entry
  }

  private buildChunk(chunk: ChunkEntry, zoom: number): void {
    this.drawTracks(chunk.trackGraphics, chunk.key, chunk.originWorld, zoom)
    this.drawStations(chunk.stationGraphics, chunk.key, chunk.originWorld, zoom)
    chunk.builtZoom = zoomSignature(zoom)
  }

  private drawTracks(graphics: Graphics, key: ChunkKey, originWorld: Point, zoom: number): void {
    graphics.clear()

    const edgeIds = this.edgesByChunk.get(key)
    if (!edgeIds || edgeIds.length === 0) return

    const zoomFactor = clamp(zoom / 0.005, 0.5, 2)

    for (const id of edgeIds) {
      const edge = this.edgeCache.get(id)
      if (!edge) continue
      const worldCoords = this.trackGraph.getTrackCoordinates(id)
      if (!worldCoords || worldCoords.length < 2) continue

      const style = edgeStyle(edge)
      const pxWidth = style.widthPx * zoomFactor
      const width = toWorldWidth(pxWidth, zoom)

      graphics.setStrokeStyle({
        width,
        color: style.color,
        alpha: style.alpha,
        cap: 'round',
        join: 'round',
      })

      const first = worldCoords[0]
      if (!first) continue
      graphics.moveTo(first[0] - originWorld[0], first[1] - originWorld[1])

      for (let i = 1; i < worldCoords.length; i++) {
        const p = worldCoords[i]
        if (!p) continue
        graphics.lineTo(p[0] - originWorld[0], p[1] - originWorld[1])
      }

      graphics.stroke()
    }
  }

  private drawStations(graphics: Graphics, key: ChunkKey, originWorld: Point, zoom: number): void {
    graphics.clear()

    const stationIds = this.stationsByChunk.get(key)
    if (!stationIds || stationIds.length === 0) return

    const zoomFactor = clamp(zoom / 0.003, 0.5, 3)
    const outlineWidth = toWorldWidth(1, zoom)

    for (const id of stationIds) {
      const station = this.stationCache.get(id)
      if (!station) continue

      const style = stationStyle(station)
      if (zoom < style.minZoom) continue

      const radiusPx = Math.max(2, style.radiusPx * zoomFactor)
      const radius = toWorldRadius(radiusPx, zoom)
      const localX = station.worldCoord[0] - originWorld[0]
      const localY = station.worldCoord[1] - originWorld[1]

      graphics.circle(localX, localY, radius)
      graphics.fill({ color: style.color })
      graphics.setStrokeStyle({ width: outlineWidth, color: 0xffffff })
      graphics.circle(localX, localY, radius)
      graphics.stroke()
    }
  }

  private enqueueRebuild(key: ChunkKey): void {
    if (this.rebuildQueued.has(key)) return
    this.rebuildQueued.add(key)
    this.rebuildQueue.push(key)
  }

  private processRebuildQueue(zoom: number, now: number): void {
    let budget = this.options.rebuildBudgetPerUpdate

    while (budget > 0 && this.rebuildQueue.length > 0) {
      const key = this.rebuildQueue.shift()
      if (!key) break
      this.rebuildQueued.delete(key)

      const chunk = this.chunks.get(key)
      if (!chunk) continue
      chunk.lastUsedMs = now
      this.setChunkCached(chunk, false)
      this.buildChunk(chunk, zoom)
      budget--
    }
  }

  private applyCaching(neededSet: Set<ChunkKey>, zoom: number): void {
    // Disable caching on non-visible chunks so their cached textures can be released.
    for (const [key, chunk] of this.chunks) {
      if (!neededSet.has(key) && chunk.isCached) {
        this.setChunkCached(chunk, false)
      }
    }

    let budget = this.options.cacheBudgetPerUpdate
    for (const key of this.lastVisibleChunkKeys) {
      if (budget <= 0) break
      const chunk = this.chunks.get(key)
      if (!chunk) continue
      if (chunk.isCached) continue
      if (!this.shouldCacheChunk(chunk, zoom)) continue
      this.setChunkCached(chunk, true)
      budget--
    }
  }

  private shouldCacheChunk(chunk: ChunkEntry, zoom: number): boolean {
    const pxW = chunk.tileWorldWidth * zoomSignature(zoom)
    const pxH = chunk.tileWorldHeight * zoomSignature(zoom)
    if (!Number.isFinite(pxW) || !Number.isFinite(pxH)) return false
    return pxW <= this.options.maxCacheTextureSizePx && pxH <= this.options.maxCacheTextureSizePx
  }

  private setChunkCached(chunk: ChunkEntry, cached: boolean): void {
    if (chunk.isCached === cached) return
    chunk.container.cacheAsTexture(cached)
    chunk.isCached = cached
  }

  private evictChunk(key: ChunkKey): void {
    const chunk = this.chunks.get(key)
    if (!chunk) return

    this.rebuildQueued.delete(key)
    this.root.removeChild(chunk.container)
    chunk.container.destroy({ children: true })
    this.chunks.delete(key)
    this.evictedChunksTotal++
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function capTileRange(range: TileRange, maxTiles: number): TileRange {
  const width = Math.max(0, range.maxX - range.minX + 1)
  const height = Math.max(0, range.maxY - range.minY + 1)
  const tileCount = width * height
  if (tileCount <= maxTiles) return range

  const n = 2 ** range.z
  const centerX = Math.floor((range.minX + range.maxX) / 2)
  const centerY = Math.floor((range.minY + range.maxY) / 2)

  const side = Math.max(1, Math.floor(Math.sqrt(Math.max(1, maxTiles))))
  const half = Math.floor(side / 2)

  let minX = clamp(centerX - half, 0, n - 1)
  let maxX = clamp(centerX + half, 0, n - 1)
  let minY = clamp(centerY - half, 0, n - 1)
  let maxY = clamp(centerY + half, 0, n - 1)

  // If we're clamped at an edge, try to preserve the requested side length by shifting.
  if (maxX - minX + 1 < side) {
    if (minX === 0) {
      maxX = clamp(minX + side - 1, 0, n - 1)
    } else if (maxX === n - 1) {
      minX = clamp(maxX - (side - 1), 0, n - 1)
    }
  }
  if (maxY - minY + 1 < side) {
    if (minY === 0) {
      maxY = clamp(minY + side - 1, 0, n - 1)
    } else if (maxY === n - 1) {
      minY = clamp(maxY - (side - 1), 0, n - 1)
    }
  }

  return { ...range, minX, maxX, minY, maxY }
}
