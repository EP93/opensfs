/**
 * Geographic coordinate utilities for converting between WGS84 and screen coordinates.
 * Uses Web Mercator projection (EPSG:3857).
 */

import type { Viewport } from '@/types/game'

/** WGS84 coordinate [longitude, latitude] */
export type LonLat = [number, number]

/** Screen/world coordinate [x, y] */
export type Point = [number, number]

/** Bounding box in world coordinates */
export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Earth's radius in meters (WGS84 semi-major axis) */
const EARTH_RADIUS = 6378137

/** Maximum latitude for Web Mercator projection */
const MAX_LATITUDE = 85.051128779806604

/**
 * Convert longitude to Web Mercator x coordinate
 */
export function lonToMercatorX(lon: number): number {
  return (lon * Math.PI * EARTH_RADIUS) / 180
}

/**
 * Convert latitude to Web Mercator y coordinate
 */
export function latToMercatorY(lat: number): number {
  const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))
  const latRad = (clampedLat * Math.PI) / 180
  const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2))
  return y * EARTH_RADIUS
}

/**
 * Convert [lon, lat] to Web Mercator [x, y]
 */
export function lonLatToMercator(lonLat: LonLat): Point {
  return [lonToMercatorX(lonLat[0]), latToMercatorY(lonLat[1])]
}

/**
 * Convert Web Mercator x to longitude
 */
export function mercatorXToLon(x: number): number {
  return (x * 180) / (Math.PI * EARTH_RADIUS)
}

/**
 * Convert Web Mercator y to latitude
 */
export function mercatorYToLat(y: number): number {
  const yNorm = y / EARTH_RADIUS
  const lat = (2 * Math.atan(Math.exp(yNorm)) - Math.PI / 2) * (180 / Math.PI)
  return lat
}

/**
 * Convert Web Mercator [x, y] to [lon, lat]
 */
export function mercatorToLonLat(point: Point): LonLat {
  return [mercatorXToLon(point[0]), mercatorYToLat(point[1])]
}

/**
 * Project world coordinates to screen coordinates given a viewport.
 * The viewport defines the center position (x, y) and zoom level.
 */
export function worldToScreen(worldPoint: Point, viewport: Viewport): Point {
  const screenX = (worldPoint[0] - viewport.x) * viewport.zoom + viewport.width / 2
  // Invert Y because screen coordinates grow downward
  const screenY = -(worldPoint[1] - viewport.y) * viewport.zoom + viewport.height / 2
  return [screenX, screenY]
}

/**
 * Project screen coordinates to world coordinates given a viewport.
 */
export function screenToWorld(screenPoint: Point, viewport: Viewport): Point {
  const worldX = (screenPoint[0] - viewport.width / 2) / viewport.zoom + viewport.x
  // Invert Y because screen coordinates grow downward
  const worldY = -(screenPoint[1] - viewport.height / 2) / viewport.zoom + viewport.y
  return [worldX, worldY]
}

/**
 * Convert [lon, lat] directly to screen coordinates
 */
export function lonLatToScreen(lonLat: LonLat, viewport: Viewport): Point {
  const mercator = lonLatToMercator(lonLat)
  return worldToScreen(mercator, viewport)
}

/**
 * Convert screen coordinates to [lon, lat]
 */
export function screenToLonLat(screenPoint: Point, viewport: Viewport): LonLat {
  const worldPoint = screenToWorld(screenPoint, viewport)
  return mercatorToLonLat(worldPoint)
}

/**
 * Calculate the bounding box in world coordinates for an array of [lon, lat] coordinates
 */
export function calculateBounds(coordinates: LonLat[]): WorldBounds {
  if (coordinates.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const coord of coordinates) {
    const [x, y] = lonLatToMercator(coord)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return { minX, minY, maxX, maxY }
}

/**
 * Check if a point is within visible bounds (with some padding)
 */
export function isPointVisible(screenPoint: Point, viewport: Viewport, padding = 50): boolean {
  return (
    screenPoint[0] >= -padding &&
    screenPoint[0] <= viewport.width + padding &&
    screenPoint[1] >= -padding &&
    screenPoint[1] <= viewport.height + padding
  )
}

/**
 * Check if a line segment is potentially visible (rough check using bounding box)
 */
export function isLineVisible(start: Point, end: Point, viewport: Viewport, padding = 50): boolean {
  const minX = Math.min(start[0], end[0])
  const maxX = Math.max(start[0], end[0])
  const minY = Math.min(start[1], end[1])
  const maxY = Math.max(start[1], end[1])

  // Check if bounding boxes overlap
  return (
    maxX >= -padding &&
    minX <= viewport.width + padding &&
    maxY >= -padding &&
    minY <= viewport.height + padding
  )
}

/**
 * Calculate zoom level to fit bounds within viewport
 */
export function calculateZoomToFit(
  bounds: WorldBounds,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0.1 // 10% padding
): number {
  const boundsWidth = bounds.maxX - bounds.minX
  const boundsHeight = bounds.maxY - bounds.minY

  if (boundsWidth === 0 || boundsHeight === 0) {
    return 1
  }

  const paddedWidth = viewportWidth * (1 - padding * 2)
  const paddedHeight = viewportHeight * (1 - padding * 2)

  const zoomX = paddedWidth / boundsWidth
  const zoomY = paddedHeight / boundsHeight

  return Math.min(zoomX, zoomY)
}

/**
 * Calculate center point of bounds in world coordinates
 */
export function calculateCenter(bounds: WorldBounds): Point {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]
}

// ============================================
// OSM Tile Coordinate Utilities
// ============================================

/** Tile coordinates [x, y, zoom] */
export type TileCoord = { x: number; y: number; z: number }

/**
 * Convert longitude/latitude to tile indices at a given zoom level
 * Uses standard OSM/Slippy map tilenames formula
 */
export function lonLatToTile(lon: number, lat: number, zoom: number): TileCoord {
  const n = 2 ** zoom
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)), z: zoom }
}

/**
 * Convert tile indices back to [lon, lat] for the tile's northwest corner
 */
export function tileToLonLat(x: number, y: number, zoom: number): LonLat {
  const n = 2 ** zoom
  const lon = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  const lat = (latRad * 180) / Math.PI
  return [lon, lat]
}

/**
 * Get tile bounds in [lon, lat] for both corners
 */
export function getTileBounds(x: number, y: number, zoom: number): { nw: LonLat; se: LonLat } {
  const nw = tileToLonLat(x, y, zoom)
  const se = tileToLonLat(x + 1, y + 1, zoom)
  return { nw, se }
}

/**
 * Calculate appropriate zoom level based on viewport zoom
 * The viewport zoom is in meters/pixel, we need to map to OSM tile zoom levels (0-19)
 */
export function calculateTileZoom(viewportZoom: number): number {
  // At zoom = 1, we see about 1 meter per pixel
  // OSM tile zoom 0 = whole world in one tile (40075km)
  // Each zoom level doubles the detail
  // Formula: tileZoom ≈ log2(156543.03 * viewportZoom) where 156543.03 is meters/pixel at zoom 0
  const metersPerPixelAtZoom0 = 156543.03
  const tileZoom = Math.log2(metersPerPixelAtZoom0 * viewportZoom)
  return Math.max(0, Math.min(19, Math.round(tileZoom)))
}

/**
 * Get visible tiles for a viewport
 */
export function getVisibleTiles(viewport: Viewport, tileZoomOverride?: number): TileCoord[] {
  const tileZoom = tileZoomOverride ?? calculateTileZoom(viewport.zoom)

  // Calculate lon/lat bounds of visible area
  const topLeft = screenToLonLat([0, 0], viewport)
  const bottomRight = screenToLonLat([viewport.width, viewport.height], viewport)

  // Get tile indices for corners (with 1 tile padding)
  const minTile = lonLatToTile(topLeft[0], topLeft[1], tileZoom)
  const maxTile = lonLatToTile(bottomRight[0], bottomRight[1], tileZoom)

  const tiles: TileCoord[] = []
  const maxTileIndex = 2 ** tileZoom - 1

  // Generate all tiles in visible range
  for (let y = Math.max(0, minTile.y - 1); y <= Math.min(maxTileIndex, maxTile.y + 1); y++) {
    for (let x = Math.max(0, minTile.x - 1); x <= Math.min(maxTileIndex, maxTile.x + 1); x++) {
      tiles.push({ x, y, z: tileZoom })
    }
  }

  return tiles
}
