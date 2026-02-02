/**
 * Validate Topological Rail Network
 *
 * Usage: bun run scripts/validate-network.ts [region]
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NetworkData, NetworkNodeKind } from '../src/types/network'

function buildAdjacency(edges: NetworkData['edges']): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  const add = (from: string, to: string): void => {
    const list = adj.get(from)
    if (list) list.push(to)
    else adj.set(from, [to])
  }
  for (const e of edges) {
    add(e.fromNodeId, e.toNodeId)
    add(e.toNodeId, e.fromNodeId)
  }
  return adj
}

function countComponents(nodes: NetworkData['nodes'], adj: Map<string, string[]>): number {
  const visited = new Set<string>()
  let components = 0

  for (const n of nodes) {
    if (visited.has(n.id)) continue
    components++
    const queue: string[] = [n.id]
    visited.add(n.id)

    while (queue.length > 0) {
      const cur = queue.pop()
      if (!cur) continue
      const neighbors = adj.get(cur)
      if (!neighbors) continue
      for (const next of neighbors) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
  }

  return components
}

function mainNetworkStats(network: NetworkData): void {
  const adj = buildAdjacency(network.edges)

  const kindById = new Map<string, NetworkNodeKind>()
  for (const n of network.nodes) kindById.set(n.id, n.kind)

  const degreeById = new Map<string, number>()
  for (const [id, neighbors] of adj.entries()) {
    degreeById.set(id, neighbors.length)
  }

  const components = countComponents(network.nodes, adj)
  const stationsMissingStops = network.stations.filter((s) => s.stopNodeIds.length === 0)

  const danglingTrackNodes: string[] = []
  for (const n of network.nodes) {
    if (n.kind !== 'track') continue
    const degree = degreeById.get(n.id) ?? 0
    if (degree !== 1) continue
    danglingTrackNodes.push(n.id)
  }

  console.log(`\nNetwork: ${network.region} (v${String(network.version)})`)
  console.log(`  Nodes: ${String(network.nodes.length)}`)
  console.log(`  Edges: ${String(network.edges.length)}`)
  console.log(`  Stations: ${String(network.stations.length)}`)
  console.log(`  Signals: ${String(network.signals.length)}`)
  console.log(`  Connected components: ${String(components)}`)
  console.log(`  Stations with 0 stop targets: ${String(stationsMissingStops.length)}`)
  if (stationsMissingStops.length > 0) {
    console.log(`  Sample missing stop stations:`)
    for (const s of stationsMissingStops.slice(0, 10)) {
      console.log(`    - ${s.id} (${s.name})`)
    }
  }

  console.log(`  Dangling track nodes (degree=1): ${String(danglingTrackNodes.length)}`)
  if (danglingTrackNodes.length > 0) {
    console.log(`  Sample dangling nodes:`)
    for (const id of danglingTrackNodes.slice(0, 10)) {
      console.log(`    - ${id}`)
    }
  }
}

async function main(): Promise<void> {
  const regionKey = process.argv[2] ?? 'berlin'
  const dataDir = path.join(process.cwd(), 'public', 'data', 'regions')
  const networkPath = path.join(dataDir, `${regionKey}-network.json`)

  console.log(`Reading network from ${networkPath}...`)
  const content = await readFile(networkPath, 'utf-8')
  const network = JSON.parse(content) as NetworkData

  mainNetworkStats(network)
}

main().catch((error: unknown) => {
  console.error('Error:', error)
  process.exit(1)
})
