/**
 * Fetch OSM Railway Data via Overpass API
 *
 * Usage: bun run scripts/fetch-osm.ts [region]
 *
 * Downloads railway tracks and stations for a given region (default: berlin)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Predefined regions with bounding boxes
const REGIONS: Record<string, { name: string; bbox: [number, number, number, number] }> = {
  berlin: {
    name: 'Berlin-Brandenburg',
    bbox: [13.0, 52.3, 13.8, 52.7], // [minLon, minLat, maxLon, maxLat]
  },
  munich: {
    name: 'Munich Region',
    bbox: [11.3, 47.9, 11.8, 48.3],
  },
  hamburg: {
    name: 'Hamburg Region',
    bbox: [9.7, 53.4, 10.3, 53.7],
  },
  frankfurt: {
    name: 'Frankfurt Region',
    bbox: [8.4, 49.9, 8.9, 50.3],
  },
  cologne: {
    name: 'Cologne-Bonn Region',
    bbox: [6.8, 50.8, 7.2, 51.1],
  },
  freiburg: {
    name: 'Freiburg Region',
    bbox: [7.5, 47.5, 8.5, 48.5], // Expanded to include Basel, Offenburg, Villingen, Elzach
  },
}

const DEFAULT_OVERPASS_APIS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
]

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetriableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
}

async function fetchOverpassData(
  query: string,
  apiUrl: string,
  attempt: number
): Promise<OverpassResponse> {
  const controller = new AbortController()
  const timeoutMs = 240_000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })

    if (!response.ok) {
      const status = response.status
      const text = await response.text().catch(() => '')
      const prefix = text ? `: ${text.slice(0, 200)}` : ''
      if (isRetriableStatus(status)) {
        throw new Error(
          `Overpass API error (retriable): ${String(status)} ${response.statusText}${prefix}`
        )
      }
      throw new Error(`Overpass API error: ${String(status)} ${response.statusText}${prefix}`)
    }

    return (await response.json()) as OverpassResponse
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('retriable')) throw error
    if (message.includes('AbortError')) {
      throw new Error(
        `Overpass request timed out after ${String(timeoutMs)}ms (attempt ${String(attempt)})`
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function splitBbox(
  bbox: [number, number, number, number]
): Array<[number, number, number, number]> {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const midLon = (minLon + maxLon) / 2
  const midLat = (minLat + maxLat) / 2
  return [
    [minLon, minLat, midLon, midLat],
    [midLon, minLat, maxLon, midLat],
    [minLon, midLat, midLon, maxLat],
    [midLon, midLat, maxLon, maxLat],
  ]
}

function mergeOverpassResponses(responses: OverpassResponse[]): OverpassResponse {
  const byKey = new Map<string, OverpassElement>()

  for (const res of responses) {
    for (const el of res.elements) {
      const key = `${el.type}:${String(el.id)}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, el)
        continue
      }

      // Merge missing fields; prefer richer objects.
      if (!existing.tags && el.tags) existing.tags = el.tags
      if (!existing.nodes && el.nodes) existing.nodes = el.nodes
      if (!existing.geometry && el.geometry) existing.geometry = el.geometry
      if (existing.geometry && el.geometry && el.geometry.length > existing.geometry.length) {
        existing.geometry = el.geometry
      }
      if (typeof existing.lat !== 'number' && typeof el.lat === 'number') existing.lat = el.lat
      if (typeof existing.lon !== 'number' && typeof el.lon === 'number') existing.lon = el.lon
    }
  }

  return { elements: Array.from(byKey.values()) }
}

function buildQuery(bbox: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const bboxStr = `${String(minLat)},${String(minLon)},${String(maxLat)},${String(maxLon)}`

  return `
[out:json][timeout:180];
(
  // Railway tracks
  way["railway"~"^(rail|light_rail|subway|tram)$"](${bboxStr});

  // Railway stations and stops
  node["railway"~"^(station|halt|stop)$"](${bboxStr});

  // Platform nodes for additional station data
  node["public_transport"="stop_position"]["train"="yes"](${bboxStr});

  // Signals (OpenRailwayMap-compatible OSM tagging)
  node["railway"="signal"](${bboxStr});

  // Switches/points (useful for debugging topology)
  node["railway"="switch"](${bboxStr});

  // Buffer stops (useful for endpoints)
  node["railway"="buffer_stop"](${bboxStr});
);
out geom;
`.trim()
}

async function fetchWithFallback(
  query: string,
  apis: string[],
  options: { retriesPerApi: number }
): Promise<OverpassResponse> {
  let lastError: unknown = null

  for (const apiUrl of apis) {
    for (let attempt = 1; attempt <= options.retriesPerApi; attempt++) {
      try {
        console.log(
          `Fetching from ${apiUrl} (attempt ${String(attempt)}/${String(options.retriesPerApi)})...`
        )
        return await fetchOverpassData(query, apiUrl, attempt)
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)

        // If it's clearly non-retriable, stop immediately.
        if (!message.includes('retriable') && !message.includes('timed out')) {
          throw error
        }

        const backoffMs = Math.min(
          30_000,
          1_000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)
        )
        console.warn(`Fetch failed: ${message}`)
        console.warn(`Retrying in ${String(backoffMs)}ms...`)
        await sleep(backoffMs)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchBboxRecursive(
  bbox: [number, number, number, number],
  apis: string[],
  options: { retriesPerApi: number; maxSplitDepth: number; splitDepth: number }
): Promise<OverpassResponse> {
  const query = buildQuery(bbox)
  try {
    return await fetchWithFallback(query, apis, { retriesPerApi: options.retriesPerApi })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const canSplit = options.splitDepth < options.maxSplitDepth
    const shouldSplit =
      message.includes('504') || message.includes('timed out') || message.includes('retriable')

    if (!shouldSplit || !canSplit) throw error

    console.warn(
      `Overpass request failed at split depth ${String(options.splitDepth)}; splitting bbox and retrying...`
    )

    const parts = splitBbox(bbox)
    const results: OverpassResponse[] = []
    for (const part of parts) {
      const res = await fetchBboxRecursive(part, apis, {
        ...options,
        splitDepth: options.splitDepth + 1,
      })
      results.push(res)
    }

    return mergeOverpassResponses(results)
  }
}

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'berlin'
  const region = REGIONS[regionKey]

  if (!region) {
    console.error(`Unknown region: ${regionKey}`)
    console.error(`Available regions: ${Object.keys(REGIONS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Fetching railway data for ${region.name}...`)
  console.log(`Bounding box: ${region.bbox.map(String).join(', ')}`)

  const envOverpass = process.env['OVERPASS_API']?.trim()
  const apis = envOverpass ? [envOverpass, ...DEFAULT_OVERPASS_APIS] : DEFAULT_OVERPASS_APIS

  const data = await fetchBboxRecursive(region.bbox, apis, {
    retriesPerApi: 3,
    maxSplitDepth: 3,
    splitDepth: 0,
  })

  console.log(`Received ${String(data.elements.length)} elements`)

  // Separate tracks and stations
  const tracks = data.elements.filter(
    (el) => el.type === 'way' && el.tags?.['railway'] !== undefined
  )
  const stations = data.elements.filter(
    (el) =>
      el.type === 'node' &&
      (el.tags?.['railway'] === 'station' ||
        el.tags?.['railway'] === 'halt' ||
        el.tags?.['railway'] === 'stop')
  )

  console.log(`Found ${String(tracks.length)} tracks and ${String(stations.length)} stations`)

  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), 'public', 'data', 'regions')
  await mkdir(outputDir, { recursive: true })

  // Save raw data
  const outputPath = path.join(outputDir, `${regionKey}-raw.json`)
  await writeFile(outputPath, JSON.stringify(data, null, 2))
  console.log(`Saved raw data to ${outputPath}`)

  // Save summary
  const summary = {
    region: regionKey,
    name: region.name,
    bbox: region.bbox,
    fetchedAt: new Date().toISOString(),
    counts: {
      total: data.elements.length,
      tracks: tracks.length,
      stations: stations.length,
    },
  }

  const summaryPath = path.join(outputDir, `${regionKey}-summary.json`)
  await writeFile(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`Saved summary to ${summaryPath}`)

  console.log('Done!')
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
