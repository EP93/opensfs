/**
 * TileSystem - Renders OpenStreetMap raster tiles as background
 */

import { Container, Sprite, Texture, type Texture as TextureType } from 'pixi.js'
import {
  calculateTileZoom,
  getTileBounds,
  getVisibleTiles,
  lonLatToMercator,
  type TileCoord,
  worldToScreen,
} from '@/game/utils/geo'
import type { Viewport } from '@/types/game'

/**
 * Tile URL pattern.
 *
 * Default is a same-origin proxy endpoint (`/osm-tiles/...`) to avoid browser CORS issues with
 * upstream tile servers. Configure `VITE_TILE_URL_TEMPLATE` to override.
 */
const TILE_URL_TEMPLATE =
  (import.meta.env.VITE_TILE_URL_TEMPLATE as string | undefined) ??
  (import.meta.env.DEV
    ? '/osm-tiles/{z}/{x}/{y}.png'
    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')

const DEFAULT_MAX_TILE_ZOOM = 17
const DEFAULT_REQUESTS_PER_SECOND = import.meta.env.DEV ? 6 : 2
const DEFAULT_MAX_CONCURRENT_REQUESTS = import.meta.env.DEV ? 6 : 2
const DEFAULT_FAST_PAN_PX_PER_SEC = 2500
const DEFAULT_FAST_PAN_ZOOM_BIAS = -2
const DEFAULT_TILE_CACHE_MAX_TILES = import.meta.env.DEV ? 300 : 200

const MAX_TILE_ZOOM = clampInt(
  Number(import.meta.env.VITE_TILE_MAX_ZOOM ?? DEFAULT_MAX_TILE_ZOOM),
  0,
  19
)
const REQUESTS_PER_SECOND = clampInt(
  Number(import.meta.env.VITE_TILE_REQUESTS_PER_SECOND ?? DEFAULT_REQUESTS_PER_SECOND),
  1,
  60
)
const MAX_CONCURRENT_REQUESTS = clampInt(
  Number(import.meta.env.VITE_TILE_MAX_CONCURRENT_REQUESTS ?? DEFAULT_MAX_CONCURRENT_REQUESTS),
  1,
  12
)
const TILE_CACHE_MAX_TILES = clampInt(
  Number(import.meta.env['VITE_TILE_CACHE_MAX_TILES'] ?? DEFAULT_TILE_CACHE_MAX_TILES),
  50,
  5000
)
const FAST_PAN_PX_PER_SEC = clampInt(
  Number(import.meta.env.VITE_TILE_FAST_PAN_PX_PER_SEC ?? DEFAULT_FAST_PAN_PX_PER_SEC),
  500,
  50_000
)
const FAST_PAN_ZOOM_BIAS = clampInt(
  Number(import.meta.env.VITE_TILE_FAST_PAN_ZOOM_BIAS ?? DEFAULT_FAST_PAN_ZOOM_BIAS),
  -10,
  0
)

const RESCAN_INTERVAL_MS = 250

/** Tile cache entry */
interface TileCacheEntry {
  src: string
  texture: TextureType
  lastUsed: number
}

interface TileRequest {
  key: string
  tile: TileCoord
  priority: number
  enqueuedAtMs: number
}

/** Generate tile cache key */
function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'

    const cleanup = () => {
      img.onload = null
      img.onerror = null
    }

    img.onload = () => {
      cleanup()
      resolve(img)
    }
    img.onerror = (event) => {
      cleanup()
      reject(event)
    }

    img.src = url
  })
}

async function loadTextureFromUrl(url: string): Promise<TextureType> {
  const img = await loadImage(url)
  // Skip Pixi's global cache for these transient tile textures; we manage a local cache.
  return Texture.from(img, true)
}

export class TileSystem {
  private container: Container
  private tileCache = new Map<string, TileCacheEntry>()
  private failedTilesUntil = new Map<string, number>()
  private pending: TileRequest[] = []
  private queuedTiles = new Set<string>()
  private inFlightTiles = new Set<string>()
  private activeRequests = 0
  private tileSprites = new Map<string, Sprite>()
  private lastViewport: Viewport | null = null
  private lastTileZoom = -1
  private onDirty: (() => void) | null = null
  private lastScanMs = 0
  private lastViewportMs = 0
  private requestTokens = REQUESTS_PER_SECOND
  private lastTokenRefillMs = performance.now()
  private tileZoomHoldUntilMs = 0
  private tileZoomOverride: number | null = null
  private wantedTiles = new Set<string>()
  private lastCacheCleanupMs = 0

  constructor() {
    this.container = new Container()
    this.container.label = 'tiles'
  }

  /**
   * Called when tile textures/sprites change and a new render is needed.
   */
  setOnDirty(onDirty: (() => void) | null): void {
    this.onDirty = onDirty
  }

  /**
   * Render tiles based on current viewport
   */
  render(viewport: Viewport): void {
    const now = performance.now()
    const prevViewport = this.lastViewport
    const prevViewportMs = this.lastViewportMs

    // Skip if viewport hasn't changed significantly
    if (
      this.lastViewport &&
      !this.viewportChanged(viewport) &&
      now - this.lastScanMs < RESCAN_INTERVAL_MS
    ) {
      if (now - this.lastCacheCleanupMs > 1000) {
        this.cleanupCache()
        this.lastCacheCleanupMs = now
      }
      this.processQueue(now)
      return
    }
    this.lastScanMs = now

    const { tileZoom, suppressNewRequests } = this.chooseTileZoom(
      viewport,
      now,
      prevViewport,
      prevViewportMs
    )
    this.lastViewport = { ...viewport }

    const visibleTiles = getVisibleTiles(viewport, tileZoom)
    const currentZoom = visibleTiles[0]?.z ?? 0

    // If zoom level changed, clear old sprites
    if (currentZoom !== this.lastTileZoom) {
      this.clearSprites()
      this.clearPending()
      this.lastTileZoom = currentZoom
    }

    // Track which tiles we want to keep
    const visibleKeys = new Set<string>()

    // Update or create sprites for visible tiles
    for (const tile of visibleTiles) {
      const key = tileKey(tile.z, tile.x, tile.y)
      visibleKeys.add(key)

      // Position the tile sprite
      const sprite = this.updateTileSprite(tile, viewport)

      // Load tile if not in cache
      if (!this.tileCache.has(key) && !this.inFlightTiles.has(key)) {
        if (suppressNewRequests) {
          // Moving too fast: wait until the camera slows down before requesting more tiles.
          continue
        }
        const priority = this.spritePriority(sprite, viewport)
        this.enqueueOrUpdate(tile, key, priority, now)
      }
    }

    this.wantedTiles = visibleKeys
    this.syncPendingToWanted(visibleKeys)

    // Remove sprites that are no longer visible
    for (const [key, sprite] of this.tileSprites) {
      if (!visibleKeys.has(key)) {
        this.container.removeChild(sprite)
        sprite.destroy()
        this.tileSprites.delete(key)
      }
    }

    // Clean up old cache entries periodically
    if (now - this.lastCacheCleanupMs > 1000) {
      this.cleanupCache()
      this.lastCacheCleanupMs = now
    }

    this.processQueue(now)
  }

  private chooseTileZoom(
    viewport: Viewport,
    now: number,
    prevViewport: Viewport | null,
    prevViewportMs: number
  ): { tileZoom: number; suppressNewRequests: boolean } {
    const base = calculateTileZoom(viewport.zoom)
    let desired = Math.min(base, MAX_TILE_ZOOM)

    let suppressNewRequests = false
    if (prevViewport && prevViewportMs > 0) {
      const dt = (now - prevViewportMs) / 1000
      if (dt > 1e-6) {
        const dxPx = (viewport.x - prevViewport.x) * viewport.zoom
        const dyPx = (viewport.y - prevViewport.y) * viewport.zoom
        const speedPxPerSec = Math.hypot(dxPx, dyPx) / dt

        if (speedPxPerSec >= FAST_PAN_PX_PER_SEC * 2) {
          suppressNewRequests = true
        }

        if (speedPxPerSec >= FAST_PAN_PX_PER_SEC) {
          desired = Math.max(0, Math.min(desired, base + FAST_PAN_ZOOM_BIAS))
          this.tileZoomHoldUntilMs = now + 1200
          this.tileZoomOverride = desired
        }
      }
    }

    if (this.tileZoomOverride !== null && now < this.tileZoomHoldUntilMs) {
      desired = Math.min(desired, this.tileZoomOverride)
    } else {
      this.tileZoomOverride = null
    }

    this.lastViewportMs = now
    return { tileZoom: desired, suppressNewRequests }
  }

  private updateTileSprite(tile: TileCoord, viewport: Viewport): Sprite {
    const key = tileKey(tile.z, tile.x, tile.y)
    const cached = this.tileCache.get(key)

    let sprite = this.tileSprites.get(key)

    if (!sprite) {
      sprite = new Sprite()
      sprite.label = key
      this.tileSprites.set(key, sprite)
      this.container.addChild(sprite)
    }

    if (cached) {
      sprite.texture = cached.texture
      cached.lastUsed = Date.now()
    }

    // Calculate tile position and size
    const bounds = getTileBounds(tile.x, tile.y, tile.z)
    const nwMercator = lonLatToMercator(bounds.nw)
    const seMercator = lonLatToMercator(bounds.se)

    const screenNW = worldToScreen(nwMercator, viewport)
    const screenSE = worldToScreen(seMercator, viewport)

    sprite.x = screenNW[0]
    sprite.y = screenNW[1]
    sprite.width = screenSE[0] - screenNW[0]
    sprite.height = screenSE[1] - screenNW[1]

    return sprite
  }

  private spritePriority(sprite: Sprite, viewport: Viewport): number {
    const cx = sprite.x + sprite.width / 2
    const cy = sprite.y + sprite.height / 2
    return Math.hypot(cx - viewport.width / 2, cy - viewport.height / 2)
  }

  private enqueueOrUpdate(tile: TileCoord, key: string, priority: number, now: number): void {
    if (this.tileCache.has(key) || this.inFlightTiles.has(key)) return

    const failedUntil = this.failedTilesUntil.get(key)
    if (failedUntil && now < failedUntil) return

    const existing = this.pending.find((r) => r.key === key)
    if (existing) {
      existing.priority = priority
      return
    }

    this.pending.push({ key, tile, priority, enqueuedAtMs: now })
    this.queuedTiles.add(key)
    this.sortPending()
  }

  private sortPending(): void {
    if (this.pending.length <= 1) return
    this.pending.sort((a, b) => {
      const p = a.priority - b.priority
      if (p !== 0) return p
      return a.enqueuedAtMs - b.enqueuedAtMs
    })
  }

  private syncPendingToWanted(wanted: Set<string>): void {
    if (this.pending.length === 0) return
    const next: TileRequest[] = []
    for (const req of this.pending) {
      if (wanted.has(req.key)) {
        next.push(req)
      } else {
        this.queuedTiles.delete(req.key)
      }
    }
    this.pending = next
    this.sortPending()
  }

  private clearPending(): void {
    this.pending = []
    this.queuedTiles.clear()
  }

  private startTileRequest(req: TileRequest, now: number): void {
    const { tile, key } = req

    this.activeRequests++
    this.inFlightTiles.add(key)

    void (async () => {
      try {
        const url = TILE_URL_TEMPLATE.replace('{z}', String(tile.z))
          .replace('{x}', String(tile.x))
          .replace('{y}', String(tile.y))

        const texture = await loadTextureFromUrl(url)

        this.tileCache.set(key, {
          src: url,
          texture,
          lastUsed: Date.now(),
        })

        const sprite = this.tileSprites.get(key)
        if (sprite && this.wantedTiles.has(key)) {
          sprite.texture = texture
          this.onDirty?.()
        }
      } catch (error) {
        console.debug(`Failed to load tile ${key}:`, error)
        this.failedTilesUntil.set(key, now + 15000)
      } finally {
        this.inFlightTiles.delete(key)
        this.activeRequests--
        this.processQueue()
      }
    })()
  }

  private processQueue(now: number = performance.now()): void {
    this.refillTokens(now)
    while (
      this.pending.length > 0 &&
      this.activeRequests < MAX_CONCURRENT_REQUESTS &&
      this.requestTokens >= 1
    ) {
      const nextReq = this.pending.shift()
      if (!nextReq) continue
      this.queuedTiles.delete(nextReq.key)
      this.requestTokens -= 1
      this.startTileRequest(nextReq, now)
    }
  }

  private refillTokens(now: number): void {
    const elapsedSeconds = (now - this.lastTokenRefillMs) / 1000
    if (elapsedSeconds <= 0) return

    const maxTokens = REQUESTS_PER_SECOND * 2
    const next = Math.min(maxTokens, this.requestTokens + elapsedSeconds * REQUESTS_PER_SECOND)
    this.requestTokens = next
    this.lastTokenRefillMs = now
  }

  private cleanupCache(): void {
    if (this.tileCache.size <= TILE_CACHE_MAX_TILES) return

    const entries = [...this.tileCache.entries()]
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    for (const [key, entry] of entries) {
      if (this.tileCache.size <= TILE_CACHE_MAX_TILES) break
      if (this.tileSprites.has(key)) continue
      entry.texture.destroy(true)
      this.tileCache.delete(key)
    }
  }

  private clearSprites(): void {
    for (const sprite of this.tileSprites.values()) {
      this.container.removeChild(sprite)
      sprite.destroy()
    }
    this.tileSprites.clear()
  }

  private viewportChanged(viewport: Viewport): boolean {
    if (!this.lastViewport) return true
    const threshold = 1 // pixels
    const zoomThreshold = 0.00001
    return (
      Math.abs((viewport.x - this.lastViewport.x) * viewport.zoom) > threshold ||
      Math.abs((viewport.y - this.lastViewport.y) * viewport.zoom) > threshold ||
      Math.abs(viewport.zoom - this.lastViewport.zoom) > zoomThreshold ||
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
   * Cleanup
   */
  destroy(): void {
    this.onDirty = null
    this.clearSprites()
    this.clearPending()
    for (const entry of this.tileCache.values()) {
      entry.texture.destroy(true)
    }
    this.tileCache.clear()
    this.failedTilesUntil.clear()
    this.container.destroy()
  }
}
