/**
 * Map data loader for loading and caching GeoJSON railway data.
 */

import { calculateBounds, type LonLat, type WorldBounds } from '@/game/utils/geo'
import type {
  GeoJSONFeatureCollection,
  GeoJSONLineString,
  GeoJSONMultiLineString,
  GeoJSONPoint,
  RailwayProperties,
  StationProperties,
} from '@/types/geo'
import type { NetworkData } from '@/types/network'

/** Track feature from GeoJSON */
export interface TrackFeature {
  id: string
  railway: string
  name: string | null
  maxspeed: number | null
  electrified: boolean
  usage: string
  operator: string | null
  coordinates: LonLat[]
}

/** Station feature from GeoJSON */
export interface StationFeature {
  id: string
  railway: 'station' | 'halt' | 'stop'
  name: string
  ref: string | null
  operator: string | null
  platforms: number
  uicRef: string | null
  coordinates: LonLat
}

/** Loaded region data */
export interface RegionData {
  id: string
  tracks: TrackFeature[]
  stations: StationFeature[]
  network: NetworkData
  bounds: WorldBounds
}

/** Loading progress callback */
export type ProgressCallback = (stage: string, progress: number) => void

/** Cache for loaded regions */
const regionCache = new Map<string, RegionData>()

/** Snap threshold in degrees (~2 meters at mid-latitudes) */
const SNAP_THRESHOLD = 0.00002

/**
 * Snap track endpoints together to connect junctions properly.
 * Finds endpoints that are very close and merges them to the same coordinate.
 */
function snapTrackEndpoints(tracks: TrackFeature[]): void {
  // Collect all endpoints with references to their tracks
  interface EndpointRef {
    track: TrackFeature
    isStart: boolean // true = first coord, false = last coord
    coord: LonLat
  }

  const endpoints: EndpointRef[] = []

  for (const track of tracks) {
    const coords = track.coordinates
    if (coords.length < 2) continue

    const first = coords[0]
    const last = coords[coords.length - 1]

    if (first) endpoints.push({ track, isStart: true, coord: first })
    if (last) endpoints.push({ track, isStart: false, coord: last })
  }

  // Build clusters of nearby endpoints using union-find approach
  const parent = new Map<EndpointRef, EndpointRef>()

  function find(ep: EndpointRef): EndpointRef {
    let p = parent.get(ep)
    if (!p) {
      parent.set(ep, ep)
      return ep
    }
    while (p !== parent.get(p)) {
      const pp = parent.get(p)
      if (pp) p = pp
      else break
    }
    parent.set(ep, p)
    return p
  }

  function union(a: EndpointRef, b: EndpointRef): void {
    const pa = find(a)
    const pb = find(b)
    if (pa !== pb) {
      parent.set(pa, pb)
    }
  }

  // Find nearby endpoints and union them
  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i]
    if (!a) continue

    for (let j = i + 1; j < endpoints.length; j++) {
      const b = endpoints[j]
      if (!b) continue

      const dx = a.coord[0] - b.coord[0]
      const dy = a.coord[1] - b.coord[1]
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < SNAP_THRESHOLD) {
        union(a, b)
      }
    }
  }

  // Group endpoints by their root
  const clusters = new Map<EndpointRef, EndpointRef[]>()
  for (const ep of endpoints) {
    const root = find(ep)
    let cluster = clusters.get(root)
    if (!cluster) {
      cluster = []
      clusters.set(root, cluster)
    }
    cluster.push(ep)
  }

  // Snap each cluster to the centroid
  for (const cluster of clusters.values()) {
    if (cluster.length <= 1) continue // No snapping needed for single endpoints

    // Calculate centroid
    let sumLon = 0
    let sumLat = 0
    for (const ep of cluster) {
      sumLon += ep.coord[0]
      sumLat += ep.coord[1]
    }
    const centroid: LonLat = [sumLon / cluster.length, sumLat / cluster.length]

    // Update all endpoints in the cluster to the centroid
    for (const ep of cluster) {
      if (ep.isStart) {
        ep.track.coordinates[0] = centroid
      } else {
        ep.track.coordinates[ep.track.coordinates.length - 1] = centroid
      }
    }
  }
}

/**
 * Load railway data for a region
 */
export async function loadRegion(
  regionId: string,
  onProgress?: ProgressCallback
): Promise<RegionData> {
  // Check cache first
  const cached = regionCache.get(regionId)
  if (cached) {
    onProgress?.('cached', 1)
    return cached
  }

  onProgress?.('loading tracks', 0.1)

  // Load tracks (use simplified version for performance)
  const tracksResponse = await fetch(`/data/regions/${regionId}-tracks-simplified.geojson`)
  if (!tracksResponse.ok) {
    // Fall back to non-simplified if simplified doesn't exist
    const fallbackResponse = await fetch(`/data/regions/${regionId}-tracks.geojson`)
    if (!fallbackResponse.ok) {
      throw new Error(`Failed to load tracks for region: ${regionId}`)
    }
  }

  onProgress?.('parsing tracks', 0.3)
  const tracksData = (await (tracksResponse.ok
    ? tracksResponse
    : await fetch(`/data/regions/${regionId}-tracks.geojson`)
  ).json()) as GeoJSONFeatureCollection<
    GeoJSONLineString | GeoJSONMultiLineString,
    RailwayProperties
  >

  onProgress?.('loading stations', 0.5)

  // Load stations
  const stationsResponse = await fetch(`/data/regions/${regionId}-stations.geojson`)
  if (!stationsResponse.ok) {
    throw new Error(`Failed to load stations for region: ${regionId}`)
  }

  onProgress?.('parsing stations', 0.7)
  const stationsData = (await stationsResponse.json()) as GeoJSONFeatureCollection<
    GeoJSONPoint,
    StationProperties
  >

  onProgress?.('loading network', 0.75)

  const networkResponse = await fetch(`/data/regions/${regionId}-network.json`)
  if (!networkResponse.ok) {
    throw new Error(
      `Failed to load network for region: ${regionId}. Run: bun run build-network ${regionId}`
    )
  }

  onProgress?.('parsing network', 0.8)
  const networkData = (await networkResponse.json()) as NetworkData

  onProgress?.('processing', 0.82)

  // Parse tracks
  const tracks: TrackFeature[] = []
  const allCoordinates: LonLat[] = []

  for (const feature of tracksData.features) {
    const props = feature.properties

    // Handle both LineString and MultiLineString
    let coordinates: LonLat[]
    if (feature.geometry.type === 'LineString') {
      coordinates = feature.geometry.coordinates as LonLat[]
    } else if (feature.geometry.type === 'MultiLineString') {
      // Flatten MultiLineString into single array (we'll render each segment)
      coordinates = feature.geometry.coordinates.flat() as LonLat[]
    } else {
      continue
    }

    if (coordinates.length < 2) continue

    const maxspeedVal = props?.['maxspeed']
    const electrifiedVal = props?.['electrified']

    tracks.push({
      id: (props?.['id'] as string | undefined) ?? `track-${String(feature.id)}`,
      railway: (props?.['railway'] as string | undefined) ?? 'rail',
      name: (props?.['name'] as string | undefined) ?? null,
      maxspeed: typeof maxspeedVal === 'number' ? maxspeedVal : null,
      electrified: typeof electrifiedVal === 'boolean' ? electrifiedVal : electrifiedVal !== 'no',
      usage: (props?.['usage'] as string | undefined) ?? 'main',
      operator: (props?.['operator'] as string | undefined) ?? null,
      coordinates,
    })

    allCoordinates.push(...coordinates)
  }

  // Snap track endpoints to connect junctions
  snapTrackEndpoints(tracks)

  // Parse stations
  const stations: StationFeature[] = []

  for (const feature of stationsData.features) {
    const props = feature.properties
    const coordinates = feature.geometry.coordinates as LonLat

    const platformsVal = props?.['platforms']
    const railwayType = props?.['railway'] as string | undefined

    stations.push({
      id: (props?.['id'] as string | undefined) ?? `station-${String(feature.id)}`,
      railway:
        railwayType === 'station' || railwayType === 'halt' || railwayType === 'stop'
          ? railwayType
          : 'station',
      name: (props?.['name'] as string | undefined) ?? 'Unknown',
      ref: (props?.['ref'] as string | undefined) ?? null,
      operator: (props?.['operator'] as string | undefined) ?? null,
      platforms: typeof platformsVal === 'number' ? platformsVal : 1,
      uicRef: (props?.['uicRef'] as string | undefined) ?? null,
      coordinates,
    })

    allCoordinates.push(coordinates)
  }

  // Calculate bounds
  const bounds = calculateBounds(allCoordinates)

  onProgress?.('done', 1)

  const regionData: RegionData = {
    id: regionId,
    tracks,
    stations,
    network: networkData,
    bounds,
  }

  // Cache the result
  regionCache.set(regionId, regionData)

  return regionData
}

/**
 * Check if a region is loaded
 */
export function isRegionLoaded(regionId: string): boolean {
  return regionCache.has(regionId)
}

/**
 * Clear cached region data
 */
export function clearRegionCache(regionId?: string): void {
  if (regionId) {
    regionCache.delete(regionId)
  } else {
    regionCache.clear()
  }
}

/**
 * Get available regions (hardcoded for now)
 */
export function getAvailableRegions(): Array<{ id: string; name: string }> {
  return [
    { id: 'berlin', name: 'Berlin-Brandenburg' },
    { id: 'munich', name: 'Munich Region' },
    { id: 'hamburg', name: 'Hamburg Region' },
    { id: 'frankfurt', name: 'Frankfurt Region' },
    { id: 'cologne', name: 'Cologne-Bonn Region' },
    { id: 'freiburg', name: 'Freiburg Region' },
  ]
}
