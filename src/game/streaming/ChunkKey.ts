export type ChunkKey = string

export function makeChunkKey(z: number, x: number, y: number): ChunkKey {
  return `${z}/${x}/${y}`
}

export function parseChunkKey(key: ChunkKey): { z: number; x: number; y: number } | null {
  const parts = key.split('/')
  if (parts.length !== 3) return null

  const z = Number(parts[0])
  const x = Number(parts[1])
  const y = Number(parts[2])

  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return { z, x, y }
}
