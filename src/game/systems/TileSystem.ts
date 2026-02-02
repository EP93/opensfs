/**
 * TileSystem - Renders OpenStreetMap raster tiles as background
 */

import { Assets, Container, Sprite, type Texture } from 'pixi.js'
import {
  getTileBounds,
  getVisibleTiles,
  lonLatToMercator,
  type TileCoord,
  worldToScreen,
} from '@/game/utils/geo'
import type { Viewport } from '@/types/game'

/** OSM tile server URL pattern */
const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** Maximum concurrent tile requests */
const MAX_CONCURRENT_REQUESTS = 6

/** Tile cache entry */
interface TileCacheEntry {
  src: string
  texture: Texture
  lastUsed: number
}

/** Generate tile cache key */
function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`
}

export class TileSystem {
  private container: Container
  private tileCache = new Map<string, TileCacheEntry>()
  private loadingTiles = new Set<string>()
  private pendingRequests: Array<() => void> = []
  private activeRequests = 0
  private tileSprites = new Map<string, Sprite>()
  private lastViewport: Viewport | null = null
  private lastTileZoom = -1
  private onDirty: (() => void) | null = null

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
    // Skip if viewport hasn't changed significantly
    if (this.lastViewport && !this.viewportChanged(viewport)) {
      return
    }
    this.lastViewport = { ...viewport }

    const visibleTiles = getVisibleTiles(viewport)
    const currentZoom = visibleTiles[0]?.z ?? 0

    // If zoom level changed, clear old sprites
    if (currentZoom !== this.lastTileZoom) {
      this.clearSprites()
      this.lastTileZoom = currentZoom
    }

    // Track which tiles we want to keep
    const visibleKeys = new Set<string>()

    // Update or create sprites for visible tiles
    for (const tile of visibleTiles) {
      const key = tileKey(tile.z, tile.x, tile.y)
      visibleKeys.add(key)

      // Position the tile sprite
      this.updateTileSprite(tile, viewport)

      // Load tile if not in cache
      if (!this.tileCache.has(key) && !this.loadingTiles.has(key)) {
        this.loadTile(tile)
      }
    }

    // Remove sprites that are no longer visible
    for (const [key, sprite] of this.tileSprites) {
      if (!visibleKeys.has(key)) {
        this.container.removeChild(sprite)
        sprite.destroy()
        this.tileSprites.delete(key)
      }
    }

    // Clean up old cache entries periodically
    this.cleanupCache()
  }

  private updateTileSprite(tile: TileCoord, viewport: Viewport): void {
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
  }

  private async loadTile(tile: TileCoord): Promise<void> {
    const key = tileKey(tile.z, tile.x, tile.y)

    if (this.loadingTiles.has(key) || this.tileCache.has(key)) {
      return
    }

    this.loadingTiles.add(key)

    // Queue the request
    const loadFn = async () => {
      try {
        const url = TILE_URL_TEMPLATE.replace('{z}', String(tile.z))
          .replace('{x}', String(tile.x))
          .replace('{y}', String(tile.y))

        const texture = await Assets.load<Texture>({
          src: url,
          parser: 'loadTextures',
        })

        this.tileCache.set(key, {
          src: url,
          texture,
          lastUsed: Date.now(),
        })

        // Update sprite if it exists
        const sprite = this.tileSprites.get(key)
        if (sprite && this.lastViewport) {
          sprite.texture = texture
          this.onDirty?.()
        }
      } catch (error) {
        // Silently fail - tile may not be available
        console.debug(`Failed to load tile ${key}:`, error)
      } finally {
        this.loadingTiles.delete(key)
        this.activeRequests--
        this.processQueue()
      }
    }

    if (this.activeRequests < MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++
      void loadFn()
    } else {
      this.pendingRequests.push(() => {
        this.activeRequests++
        void loadFn()
      })
    }
  }

  private processQueue(): void {
    while (this.pendingRequests.length > 0 && this.activeRequests < MAX_CONCURRENT_REQUESTS) {
      const next = this.pendingRequests.shift()
      next?.()
    }
  }

  private cleanupCache(): void {
    const maxCacheSize = 200
    const maxAge = 60000 // 1 minute

    if (this.tileCache.size <= maxCacheSize) return

    const now = Date.now()
    const entries = [...this.tileCache.entries()]

    // Sort by last used time
    entries.sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    // Remove old entries until we're under the limit
    for (const [key, entry] of entries) {
      if (this.tileCache.size <= maxCacheSize / 2) break
      if (now - entry.lastUsed > maxAge) {
        // Don't destroy textures that are still in use
        if (!this.tileSprites.has(key)) {
          void Assets.unload(entry.src)
          this.tileCache.delete(key)
        }
      }
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
    for (const entry of this.tileCache.values()) {
      void Assets.unload(entry.src)
    }
    this.tileCache.clear()
    this.container.destroy()
  }
}
