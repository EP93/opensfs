/**
 * Validate that line definitions can be routed on a built network.
 *
 * Usage: bun run scripts/validate-lines.ts [region]
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LINE_DEFINITIONS } from '../src/game/data/lineDefinitions'
import { type PlannedStopConstraint, TrackGraph } from '../src/game/graph/TrackGraph'
import type { NetworkData } from '../src/types/network'

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'rheintal'
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')
  const networkPath = path.join(dataDir, `${regionKey}-network.json`)

  console.log(`Reading network from ${networkPath}...`)
  const content = await readFile(networkPath, 'utf-8')
  const network = JSON.parse(content) as NetworkData

  const trackGraph = new TrackGraph()
  trackGraph.buildFromNetwork(network)

  let failed = 0

  for (const line of LINE_DEFINITIONS) {
    const directions: Array<{ key: string; route: string[] }> = line.bidirectional
      ? [
          { key: 'fwd', route: line.route },
          { key: 'rev', route: [...line.route].reverse() },
        ]
      : [{ key: 'fwd', route: line.route }]

    for (const dir of directions) {
      const plannedStops: PlannedStopConstraint[] = dir.route.map((stationId) => ({
        stationId,
        platform: null,
      }))

      const destinationStationId = dir.route[dir.route.length - 1] ?? null
      const { path: pathResult, chosenStopNodeIds } = trackGraph.buildPathForPlannedStops(
        plannedStops,
        destinationStationId ?? undefined
      )

      if (!pathResult.found) {
        failed++
        console.error(`[FAIL] ${line.id} (${dir.key}): no path found`)
        continue
      }

      const crossoverLike = pathResult.segments.reduce(
        (sum, seg) =>
          sum +
          (trackGraph.isCrossoverLikeTraversal(seg.fromNodeId, seg.toNodeId, seg.link) ? 1 : 0),
        0
      )

      const platforms = chosenStopNodeIds.map((nodeId) => trackGraph.getStopPlatformRef(nodeId))
      const platformsDisplay = platforms.map((p) => p ?? '—').join(',')

      console.log(
        `[OK] ${line.id} (${dir.key}): ${pathResult.totalLength.toFixed(0)}m, crossover-like ${String(crossoverLike)}, platforms ${platformsDisplay}`
      )
    }
  }

  if (failed > 0) {
    console.error(`\n${String(failed)} line-direction(s) failed.`)
    process.exit(1)
  }

  console.log('\nAll lines routable.')
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
