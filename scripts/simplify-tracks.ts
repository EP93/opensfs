/**
 * Simplify Track Geometry for Better Performance
 *
 * Usage: bun run scripts/simplify-tracks.ts [region] [tolerance]
 *
 * Uses Douglas-Peucker algorithm to reduce coordinate count while preserving shape
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { simplify } from '@turf/turf'
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson'

interface SimplifyOptions {
  tolerance: number
  highQuality: boolean
}

async function simplifyTracks(
  regionKey: string,
  options: SimplifyOptions
): Promise<{ original: number; simplified: number }> {
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')
  const tracksPath = path.join(dataDir, `${regionKey}-tracks.geojson`)

  console.log(`Reading tracks from ${tracksPath}...`)
  const content = await readFile(tracksPath, 'utf-8')
  const tracks = JSON.parse(content) as FeatureCollection

  let originalCoords = 0
  let simplifiedCoords = 0

  const simplifiedFeatures = tracks.features.map((feature) => {
    if (feature.geometry.type === 'LineString') {
      originalCoords += feature.geometry.coordinates.length

      const simplified = simplify(feature as Feature<LineString>, {
        tolerance: options.tolerance,
        highQuality: options.highQuality,
      })

      simplifiedCoords += simplified.geometry.coordinates.length
      return simplified
    } else if (feature.geometry.type === 'MultiLineString') {
      originalCoords += feature.geometry.coordinates.reduce(
        (sum: number, line: number[][]) => sum + line.length,
        0
      )

      const simplified = simplify(feature as Feature<MultiLineString>, {
        tolerance: options.tolerance,
        highQuality: options.highQuality,
      })

      simplifiedCoords += simplified.geometry.coordinates.reduce(
        (sum: number, line: number[][]) => sum + line.length,
        0
      )
      return simplified
    }
    return feature
  })

  const simplifiedTracks: FeatureCollection = {
    type: 'FeatureCollection',
    features: simplifiedFeatures,
  }

  // Save simplified tracks
  const outputPath = path.join(dataDir, `${regionKey}-tracks-simplified.geojson`)
  await writeFile(outputPath, JSON.stringify(simplifiedTracks, null, 2))
  console.log(`Saved simplified tracks to ${outputPath}`)

  return { original: originalCoords, simplified: simplifiedCoords }
}

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'berlin'
  const tolerance = parseFloat(process.argv[3] ?? '0.0001') // ~10m at equator

  console.log(`Simplifying tracks for region: ${regionKey}`)
  console.log(`Tolerance: ${String(tolerance)}`)

  const stats = await simplifyTracks(regionKey, {
    tolerance,
    highQuality: true,
  })

  const reduction = ((1 - stats.simplified / stats.original) * 100).toFixed(1)
  console.log(`\nSimplification stats:`)
  console.log(`  Original coordinates: ${String(stats.original)}`)
  console.log(`  Simplified coordinates: ${String(stats.simplified)}`)
  console.log(`  Reduction: ${reduction}%`)

  console.log('Done!')
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
