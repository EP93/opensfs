import { lonLatToTile } from '@/game/utils/geo'
import type { StationFeature } from '@/lib/mapLoader'
import type { NetworkData } from '@/types/network'
import { type ChunkKey, makeChunkKey } from './ChunkKey'

function getOrCreate(map: Map<ChunkKey, string[]>, key: ChunkKey): string[] {
  const existing = map.get(key)
  if (existing) return existing
  const next: string[] = []
  map.set(key, next)
  return next
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

export function buildNetworkChunkIndex(network: NetworkData, z: number): Map<ChunkKey, string[]> {
  // Use a per-chunk Set to avoid allocating a per-edge Set (which can explode memory on large regions).
  const edgesByChunkSet = new Map<ChunkKey, Set<string>>()
  const n = 2 ** z

  for (const edge of network.edges) {
    if (edge.geometry.length < 2) continue

    const prev = edge.geometry[0]
    if (!prev) continue

    let prevTile = lonLatToTile(prev[0], prev[1], z)
    prevTile = {
      x: Math.max(0, Math.min(n - 1, prevTile.x)),
      y: Math.max(0, Math.min(n - 1, prevTile.y)),
      z,
    }

    const addTile = (x: number, y: number) => {
      const xx = Math.max(0, Math.min(n - 1, x))
      const yy = Math.max(0, Math.min(n - 1, y))
      const key = makeChunkKey(z, xx, yy)
      getOrCreateSet(edgesByChunkSet, key).add(edge.id)
    }

    addTile(prevTile.x, prevTile.y)

    for (let i = 1; i < edge.geometry.length; i++) {
      const cur = edge.geometry[i]
      if (!cur) continue

      let curTile = lonLatToTile(cur[0], cur[1], z)
      curTile = {
        x: Math.max(0, Math.min(n - 1, curTile.x)),
        y: Math.max(0, Math.min(n - 1, curTile.y)),
        z,
      }

      if (curTile.x === prevTile.x && curTile.y === prevTile.y) {
        prevTile = curTile
        continue
      }

      rasterizeSegmentTiles(prevTile.x, prevTile.y, curTile.x, curTile.y, addTile)
      prevTile = curTile
    }
  }

  const edgesByChunk = new Map<ChunkKey, string[]>()
  for (const [key, set] of edgesByChunkSet) {
    const list = Array.from(set)
    list.sort()
    edgesByChunk.set(key, list)
  }

  return edgesByChunk
}

export function buildStationChunkIndex(
  stations: StationFeature[],
  z: number
): Map<ChunkKey, string[]> {
  const stationsByChunk = new Map<ChunkKey, string[]>()
  const n = 2 ** z

  for (const station of stations) {
    const [lon, lat] = station.coordinates
    const t = lonLatToTile(lon, lat, z)
    const x = Math.max(0, Math.min(n - 1, t.x))
    const y = Math.max(0, Math.min(n - 1, t.y))
    getOrCreate(stationsByChunk, makeChunkKey(z, x, y)).push(station.id)
  }

  return stationsByChunk
}
