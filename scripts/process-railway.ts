/**
 * Process Raw OSM Data into Game-Ready GeoJSON
 *
 * Usage: bun run scripts/process-railway.ts [region]
 *
 * Converts raw Overpass data into structured GeoJSON for tracks and stations
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Feature, FeatureCollection, LineString, MultiLineString, Point } from 'geojson'
import osmtogeojson from 'osmtogeojson'

interface ProcessedData {
  tracks: FeatureCollection
  stations: FeatureCollection
}

interface RawElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  geometry?: Array<{ lat: number; lon: number }>
  tags?: Record<string, string>
}

interface RawData {
  elements: RawElement[]
}

async function processRegion(regionKey: string): Promise<ProcessedData> {
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')
  const rawPath = path.join(dataDir, `${regionKey}-raw.json`)

  console.log(`Reading raw data from ${rawPath}...`)
  const rawContent = await readFile(rawPath, 'utf-8')
  const rawData = JSON.parse(rawContent) as RawData

  console.log(`Processing ${String(rawData.elements.length)} elements...`)

  // Convert to GeoJSON using osmtogeojson
  const geojson = osmtogeojson(rawData)

  // Separate tracks (LineStrings) and stations (Points)
  const tracks: FeatureCollection<LineString | MultiLineString> = {
    type: 'FeatureCollection',
    features: geojson.features.filter(
      (f): f is Feature<LineString | MultiLineString> =>
        (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') &&
        f.properties?.['railway'] !== undefined
    ),
  }

  const stations: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: geojson.features.filter(
      (f): f is Feature<Point> =>
        f.geometry.type === 'Point' &&
        (f.properties?.['railway'] === 'station' ||
          f.properties?.['railway'] === 'halt' ||
          f.properties?.['railway'] === 'stop')
    ),
  }

  // Clean up and normalize properties
  for (const feature of tracks.features) {
    const props = feature.properties ?? {}
    const id = props['@id'] as string | undefined
    const railway = props['railway'] as string | undefined
    const name = props['name'] as string | undefined
    const maxspeed = props['maxspeed'] as string | undefined
    const electrified = props['electrified'] as string | undefined
    const usage = props['usage'] as string | undefined
    const operator = props['operator'] as string | undefined

    feature.properties = {
      id: id ?? `track-${String(feature.id ?? Math.random().toString(36).slice(2))}`,
      railway,
      name: name ?? null,
      maxspeed: maxspeed ? parseInt(maxspeed, 10) : null,
      electrified: electrified !== 'no',
      usage: usage ?? 'main',
      operator: operator ?? null,
    }
  }

  for (const feature of stations.features) {
    const props = feature.properties ?? {}
    const id = props['@id'] as string | undefined
    const railway = props['railway'] as string | undefined
    const name = props['name'] as string | undefined
    const ref = props['ref'] as string | undefined
    const operator = props['operator'] as string | undefined
    const platforms = props['platforms'] as string | undefined
    const uicRef = props['uic_ref'] as string | undefined

    feature.properties = {
      id: id ?? `station-${String(feature.id ?? Math.random().toString(36).slice(2))}`,
      railway,
      name: name ?? 'Unknown Station',
      ref: ref ?? null,
      operator: operator ?? null,
      platforms: platforms ? parseInt(platforms, 10) : 1,
      uicRef: uicRef ?? null,
    }
  }

  console.log(
    `Processed ${String(tracks.features.length)} tracks and ${String(stations.features.length)} stations`
  )

  return { tracks, stations }
}

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'berlin'
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')

  console.log(`Processing railway data for region: ${regionKey}`)

  const { tracks, stations } = await processRegion(regionKey)

  // Save processed data
  const tracksPath = path.join(dataDir, `${regionKey}-tracks.geojson`)
  await writeFile(tracksPath, JSON.stringify(tracks, null, 2))
  console.log(`Saved tracks to ${tracksPath}`)

  const stationsPath = path.join(dataDir, `${regionKey}-stations.geojson`)
  await writeFile(stationsPath, JSON.stringify(stations, null, 2))
  console.log(`Saved stations to ${stationsPath}`)

  // Create combined file for quick loading
  const combinedPath = path.join(dataDir, `${regionKey}.geojson`)
  const combined: FeatureCollection = {
    type: 'FeatureCollection',
    features: [...tracks.features, ...stations.features],
  }
  await writeFile(combinedPath, JSON.stringify(combined, null, 2))
  console.log(`Saved combined data to ${combinedPath}`)

  console.log('Done!')
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
