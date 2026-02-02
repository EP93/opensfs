/**
 * Build Topological Rail Network from Overpass Raw JSON
 *
 * Usage: bun run scripts/build-network.ts [region]
 *
 * Produces `${region}-network.json` used for pathfinding + signalling.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  NetworkData,
  NetworkEdge,
  NetworkNode,
  NetworkNodeKind,
  StationRecord,
} from '../src/types/network'

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  geometry?: Array<{ lat: number; lon: number }>
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements: OverpassElement[]
}

const RAIL_WAY_RE = /^(rail|light_rail|subway|tram)$/

function haversineDistanceMeters(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number }
): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180

  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function parseMaxSpeedKmh(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const numeric = Number.parseFloat(match[1] ?? '')
  if (!Number.isFinite(numeric)) return null
  const isMph = value.toLowerCase().includes('mph')
  const kmh = isMph ? numeric * 1.60934 : numeric
  return Math.round(kmh)
}

function nodeId(osmNodeId: number): string {
  return `osm:n:${String(osmNodeId)}`
}

function edgeId(osmWayId: number, index: number): string {
  return `osm:w:${String(osmWayId)}:${String(index)}`
}

function stationId(osmNodeId: number): string {
  return `station-node/${String(osmNodeId)}`
}

function isStopPosition(tags: Record<string, string> | undefined): boolean {
  return tags?.['public_transport'] === 'stop_position' && tags?.['train'] === 'yes'
}

function isStationRailway(tags: Record<string, string> | undefined): boolean {
  const railway = tags?.['railway']
  return railway === 'station' || railway === 'halt' || railway === 'stop'
}

function getNodeKind(tags: Record<string, string> | undefined): NetworkNodeKind {
  const railway = tags?.['railway']

  if (railway === 'signal') return 'signal'
  if (railway === 'switch') return 'switch'
  if (railway === 'buffer_stop') return 'buffer_stop'

  if (railway === 'stop' || isStopPosition(tags)) return 'stop'
  if (railway === 'station' || railway === 'halt') return 'station'

  return 'track'
}

function getDisplayName(tags: Record<string, string> | undefined): string | null {
  const name = tags?.['name']
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

function getUicRef(tags: Record<string, string> | undefined): string | null {
  const uic = tags?.['uic_ref']
  return typeof uic === 'string' && uic.trim().length > 0 ? uic.trim() : null
}

function gridKey(lon: number, lat: number, cell: number): string {
  return `${String(Math.floor(lon / cell))},${String(Math.floor(lat / cell))}`
}

interface Coord {
  lon: number
  lat: number
}

interface IndexedPoint {
  osmNodeId: number
  coord: Coord
}

function buildGrid(points: IndexedPoint[], cell: number): Map<string, IndexedPoint[]> {
  const grid = new Map<string, IndexedPoint[]>()
  for (const p of points) {
    const key = gridKey(p.coord.lon, p.coord.lat, cell)
    const bucket = grid.get(key)
    if (bucket) {
      bucket.push(p)
    } else {
      grid.set(key, [p])
    }
  }
  return grid
}

function findWithinRadius(
  grid: Map<string, IndexedPoint[]>,
  cell: number,
  center: Coord,
  radiusMeters: number
): Array<{ osmNodeId: number; distanceM: number }> {
  const deg = radiusMeters / 111_111
  const cx = Math.floor(center.lon / cell)
  const cy = Math.floor(center.lat / cell)
  const radiusCells = Math.ceil(deg / cell)

  const out: Array<{ osmNodeId: number; distanceM: number }> = []
  for (let dx = -radiusCells; dx <= radiusCells; dx++) {
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      const bucket = grid.get(`${String(cx + dx)},${String(cy + dy)}`)
      if (!bucket) continue
      for (const p of bucket) {
        const distanceM = haversineDistanceMeters(center, p.coord)
        if (distanceM <= radiusMeters) {
          out.push({ osmNodeId: p.osmNodeId, distanceM })
        }
      }
    }
  }
  return out
}

function findNearestWithinRadius(
  grid: Map<string, IndexedPoint[]>,
  cell: number,
  center: Coord,
  radiusMeters: number
): { osmNodeId: number; distanceM: number } | null {
  const candidates = findWithinRadius(grid, cell, center, radiusMeters)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.distanceM - b.distanceM)
  return candidates[0] ?? null
}

async function buildNetwork(regionKey: string): Promise<NetworkData> {
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')
  const rawPath = path.join(dataDir, `${regionKey}-raw.json`)

  console.log(`Reading raw data from ${rawPath}...`)
  const rawContent = await readFile(rawPath, 'utf-8')
  const rawData = JSON.parse(rawContent) as OverpassResponse

  const nodeTagsById = new Map<number, Record<string, string>>()
  const nodeCoordById = new Map<number, Coord>()
  const railWays: OverpassElement[] = []

  for (const el of rawData.elements) {
    if (el.type === 'node') {
      if (typeof el.lon === 'number' && typeof el.lat === 'number') {
        nodeCoordById.set(el.id, { lon: el.lon, lat: el.lat })
      }
      if (el.tags) {
        nodeTagsById.set(el.id, el.tags)
      }
    } else if (el.type === 'way') {
      if (el.tags?.['railway'] && RAIL_WAY_RE.test(el.tags['railway'])) {
        railWays.push(el)
      }

      const nodes = el.nodes
      const geom = el.geometry
      if (nodes && geom && nodes.length === geom.length) {
        for (let i = 0; i < nodes.length; i++) {
          const nodeId = nodes[i]
          const g = geom[i]
          if (!nodeId || !g) continue
          if (!nodeCoordById.has(nodeId)) {
            nodeCoordById.set(nodeId, { lon: g.lon, lat: g.lat })
          }
        }
      }
    }
  }

  console.log(`Rail ways: ${String(railWays.length)}`)

  const incidentCount = new Map<number, number>()
  const trackNodeIds = new Set<number>()

  for (const way of railWays) {
    const nodes = way.nodes
    if (!nodes || nodes.length < 2) continue
    for (let i = 0; i < nodes.length; i++) {
      const nid = nodes[i]
      if (!nid) continue
      trackNodeIds.add(nid)
    }
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      if (!a || !b) continue
      incidentCount.set(a, (incidentCount.get(a) ?? 0) + 1)
      incidentCount.set(b, (incidentCount.get(b) ?? 0) + 1)
    }
  }

  const isImportantNodeId = (osmNodeId: number): boolean => {
    const tags = nodeTagsById.get(osmNodeId)
    if (getNodeKind(tags) !== 'track') return true
    const valence = incidentCount.get(osmNodeId) ?? 0
    return valence !== 2
  }

  const graphNodeIds = new Set<number>()
  const edges: NetworkEdge[] = []
  for (const way of railWays) {
    const osmWayId = way.id
    const nodesList = way.nodes
    const geom = way.geometry
    if (!nodesList || !geom || nodesList.length !== geom.length) continue
    if (nodesList.length < 2) continue

    let segmentStartIndex = 0
    let segmentIndex = 0

    for (let i = 1; i < nodesList.length; i++) {
      const osmNodeIdAtI = nodesList[i]
      if (!osmNodeIdAtI) continue

      const atEnd = i === nodesList.length - 1
      const shouldBreak = atEnd || isImportantNodeId(osmNodeIdAtI)
      if (!shouldBreak) continue

      const fromNode = nodesList[segmentStartIndex]
      const toNode = osmNodeIdAtI
      if (!fromNode || !toNode) {
        segmentStartIndex = i
        continue
      }

      const geometryLonLat: Array<[number, number]> = []
      for (let j = segmentStartIndex; j <= i; j++) {
        const g = geom[j]
        if (!g) continue
        geometryLonLat.push([g.lon, g.lat])
      }
      if (geometryLonLat.length < 2) {
        segmentStartIndex = i
        continue
      }

      let lengthM = 0
      for (let k = 0; k < geometryLonLat.length - 1; k++) {
        const a = geometryLonLat[k]
        const b = geometryLonLat[k + 1]
        if (!a || !b) continue
        lengthM += haversineDistanceMeters({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] })
      }

      const tags = way.tags ?? {}
      const railway = tags['railway'] ?? 'rail'
      const usage = tags['usage'] ?? 'main'
      const service = tags['service'] ?? null
      const electrified = tags['electrified'] !== 'no'
      const maxSpeedKmh = parseMaxSpeedKmh(tags['maxspeed'])
      const maxSpeedForwardKmh = parseMaxSpeedKmh(tags['maxspeed:forward']) ?? maxSpeedKmh
      const maxSpeedBackwardKmh = parseMaxSpeedKmh(tags['maxspeed:backward']) ?? maxSpeedKmh

      edges.push({
        id: edgeId(osmWayId, segmentIndex++),
        osmWayId,
        fromNodeId: nodeId(fromNode),
        toNodeId: nodeId(toNode),
        railway,
        usage,
        service,
        electrified,
        maxSpeedKmh,
        maxSpeedForwardKmh,
        maxSpeedBackwardKmh,
        lengthM,
        geometry: geometryLonLat,
      })

      graphNodeIds.add(fromNode)
      graphNodeIds.add(toNode)
      segmentStartIndex = i
    }
  }

  for (const [osmNodeId, tags] of nodeTagsById.entries()) {
    if (getNodeKind(tags) !== 'track') graphNodeIds.add(osmNodeId)
  }

  const nodes: NetworkNode[] = []
  for (const osmNodeId of graphNodeIds) {
    const coord = nodeCoordById.get(osmNodeId)
    if (!coord) continue
    const tags = nodeTagsById.get(osmNodeId)
    const kind = getNodeKind(tags)
    const shouldKeepTags = kind !== 'track'
    const base: NetworkNode = {
      id: nodeId(osmNodeId),
      osmNodeId,
      lon: coord.lon,
      lat: coord.lat,
      kind,
    }
    nodes.push(shouldKeepTags && tags ? { ...base, tags } : base)
  }

  nodes.sort((a, b) => a.osmNodeId - b.osmNodeId)

  const stations: StationRecord[] = []
  const stopCandidates: IndexedPoint[] = []
  const trackCandidates: IndexedPoint[] = []

  for (const n of nodes) {
    const coord = { lon: n.lon, lat: n.lat }
    if (n.kind === 'stop') stopCandidates.push({ osmNodeId: n.osmNodeId, coord })
    if (trackNodeIds.has(n.osmNodeId)) trackCandidates.push({ osmNodeId: n.osmNodeId, coord })

    const tags = nodeTagsById.get(n.osmNodeId)
    if (!isStationRailway(tags)) continue

    const name = tags?.['name'] ?? 'Unknown Station'
    stations.push({
      id: stationId(n.osmNodeId),
      name,
      lon: n.lon,
      lat: n.lat,
      stationNodeId: null,
      stopNodeIds: [],
    })
  }

  const stopGridCell = 0.01 // ~1.1km
  const stopGrid = buildGrid(stopCandidates, stopGridCell)

  const trackGridCell = 0.005 // ~550m
  const trackGrid = buildGrid(trackCandidates, trackGridCell)

  const stopRadiusM = 1500
  const stationFallbackRadiusM = 1000

  for (const station of stations) {
    const stationOsmId = Number.parseInt(station.id.split('/')[1] ?? '', 10)
    const selfTags = Number.isFinite(stationOsmId) ? nodeTagsById.get(stationOsmId) : undefined
    const selfIsStop = getNodeKind(selfTags) === 'stop'
    const center = { lon: station.lon, lat: station.lat }
    const stationName = getDisplayName(selfTags) ?? station.name
    const stationUic = getUicRef(selfTags)

    const candidateStops = selfIsStop
      ? [{ osmNodeId: stationOsmId, distanceM: 0 }]
      : findWithinRadius(stopGrid, stopGridCell, center, stopRadiusM)

    // Prefer stop_positions/stop nodes that match station identity (name and/or UIC).
    const strongMatches = candidateStops.filter((c) => {
      const stopTags = nodeTagsById.get(c.osmNodeId)
      const stopName = getDisplayName(stopTags)
      const stopUic = getUicRef(stopTags)
      if (stationUic && stopUic && stopUic === stationUic) return true
      if (stopName && stationName && stopName === stationName) return true
      return false
    })

    const base = strongMatches.length > 0 ? strongMatches : candidateStops

    // Strongly prefer stops that are also part of a railway way node (avoids synthetic connectors).
    const onTrack = base.filter((c) => trackNodeIds.has(c.osmNodeId))
    const rankedBase = onTrack.length > 0 ? onTrack : base

    const ranked = rankedBase.sort((a, b) => a.distanceM - b.distanceM)

    const stopNodeIds = ranked.slice(0, 8).map((c) => nodeId(c.osmNodeId))

    if (stopNodeIds.length > 0) {
      station.stopNodeIds = stopNodeIds
      station.stationNodeId = stopNodeIds[0] ?? null
      continue
    }

    const nearestTrack = findNearestWithinRadius(
      trackGrid,
      trackGridCell,
      center,
      stationFallbackRadiusM
    )
    if (nearestTrack) {
      const nid = nodeId(nearestTrack.osmNodeId)
      station.stopNodeIds = [nid]
      station.stationNodeId = nid
    }
  }

  const signals = nodes
    .filter((n) => n.kind === 'signal')
    .map((n) => {
      const tags = nodeTagsById.get(n.osmNodeId)
      const dirValue = tags?.['direction'] ?? tags?.['railway:signal:direction']
      const dir: 'forward' | 'backward' | 'both' =
        dirValue === 'forward' || dirValue === 'backward' || dirValue === 'both'
          ? (dirValue as 'forward' | 'backward' | 'both')
          : 'both'
      return { id: n.id, nodeId: n.id, direction: dir }
    })

  // Add short connector edges for special nodes not on track topology (rare, but improves robustness)
  const specialCandidates = nodes.filter(
    (n) => n.kind !== 'track' && !trackNodeIds.has(n.osmNodeId)
  )
  if (specialCandidates.length > 0 && trackCandidates.length > 0) {
    const connectorCell = 0.001 // ~110m
    const connectorGrid = buildGrid(trackCandidates, connectorCell)
    let connectorCount = 0

    for (const n of specialCandidates) {
      const nearest = findNearestWithinRadius(
        connectorGrid,
        connectorCell,
        { lon: n.lon, lat: n.lat },
        30
      )
      if (!nearest) continue
      if (nearest.osmNodeId === n.osmNodeId) continue

      const a = { lon: n.lon, lat: n.lat }
      const b = nodeCoordById.get(nearest.osmNodeId)
      if (!b) continue

      const lengthM = haversineDistanceMeters(a, b)
      edges.push({
        id: `connector:${n.id}:${nodeId(nearest.osmNodeId)}`,
        osmWayId: -1,
        fromNodeId: n.id,
        toNodeId: nodeId(nearest.osmNodeId),
        railway: 'connector',
        usage: 'connector',
        service: null,
        electrified: true,
        maxSpeedKmh: 15,
        maxSpeedForwardKmh: 15,
        maxSpeedBackwardKmh: 15,
        lengthM,
        geometry: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      })
      connectorCount++
    }

    if (connectorCount > 0) {
      console.log(`Added connector edges: ${String(connectorCount)}`)
    }
  }

  console.log(
    `Built network: ${String(nodes.length)} nodes, ${String(edges.length)} edges, ${String(stations.length)} stations, ${String(signals.length)} signals`
  )

  return {
    version: 1,
    region: regionKey,
    nodes,
    edges,
    stations,
    signals,
  }
}

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'berlin'
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')

  console.log(`Building network for region: ${regionKey}`)
  const network = await buildNetwork(regionKey)

  const outPath = path.join(dataDir, `${regionKey}-network.json`)
  await writeFile(outPath, JSON.stringify(network))
  console.log(`Saved network to ${outPath}`)
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
