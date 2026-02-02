import { lonLatToTile, screenToLonLat } from '@/game/utils/geo'
import type { Viewport } from '@/types/game'
import { type ChunkKey, makeChunkKey } from './ChunkKey'

export interface TileRange {
  z: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function getVisibleTileRange(viewport: Viewport, z: number, marginTiles = 0): TileRange {
  const topLeft = screenToLonLat([0, 0], viewport)
  const bottomRight = screenToLonLat([viewport.width, viewport.height], viewport)

  const minLon = Math.min(topLeft[0], bottomRight[0])
  const maxLon = Math.max(topLeft[0], bottomRight[0])
  const minLat = Math.min(topLeft[1], bottomRight[1])
  const maxLat = Math.max(topLeft[1], bottomRight[1])

  const nw = lonLatToTile(minLon, maxLat, z)
  const se = lonLatToTile(maxLon, minLat, z)

  const n = 2 ** z
  const minX = clampInt(Math.min(nw.x, se.x) - marginTiles, 0, n - 1)
  const maxX = clampInt(Math.max(nw.x, se.x) + marginTiles, 0, n - 1)
  const minY = clampInt(Math.min(nw.y, se.y) - marginTiles, 0, n - 1)
  const maxY = clampInt(Math.max(nw.y, se.y) + marginTiles, 0, n - 1)

  return { z, minX, maxX, minY, maxY }
}

/**
 * Clamp a potentially huge visible tile rectangle to a maximum number of tiles.
 * This is a safety valve for very zoomed-out views that would otherwise enumerate
 * millions of chunk keys and blow up CPU/memory.
 */
export function capTileRange(range: TileRange, maxTiles: number): TileRange {
  const width = range.maxX - range.minX + 1
  const height = range.maxY - range.minY + 1
  if (width <= 0 || height <= 0) return range
  if (width * height <= maxTiles) return range

  const targetArea = Math.max(1, maxTiles)
  const scale = Math.sqrt(targetArea / (width * height))
  const nextWidth = Math.max(1, Math.floor(width * scale))
  const nextHeight = Math.max(1, Math.floor(height * scale))

  const midX = Math.floor((range.minX + range.maxX) / 2)
  const midY = Math.floor((range.minY + range.maxY) / 2)

  const halfW = Math.floor(nextWidth / 2)
  const halfH = Math.floor(nextHeight / 2)

  const n = 2 ** range.z
  const minX = clampInt(midX - halfW, 0, n - 1)
  const maxX = clampInt(minX + nextWidth - 1, 0, n - 1)
  const minY = clampInt(midY - halfH, 0, n - 1)
  const maxY = clampInt(minY + nextHeight - 1, 0, n - 1)

  return { ...range, minX, maxX, minY, maxY }
}

export function enumerateChunkKeys(range: TileRange): ChunkKey[] {
  const out: ChunkKey[] = []
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      out.push(makeChunkKey(range.z, x, y))
    }
  }
  return out
}
