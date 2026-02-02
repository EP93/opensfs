/**
 * Build all data artifacts for a region (fetch + process + simplify + network + validate).
 *
 * Usage: bun run scripts/build-region-data.ts [region] [tolerance]
 *
 * Example:
 *   bun run build-region-data freiburg 0.0001
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function getArg(index: number): string | undefined {
  return process.argv[index]
}

async function runStep(title: string, args: string[]): Promise<void> {
  console.log(`\n==> ${title}`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(args[0] ?? '', args.slice(1), {
      cwd: process.cwd(),
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Step failed (${title}): ${args.join(' ')} (exit ${String(code)})`))
    })
  })
}

async function main(): Promise<void> {
  const region = getArg(2) ?? 'berlin'
  const tolerance = getArg(3) ?? '0.0001'
  const rawPath = path.join(process.cwd(), 'public', 'data', 'regions', `${region}-raw.json`)
  const hasExistingRaw = existsSync(rawPath)

  console.log(`Building region data: ${region}`)
  console.log(`Simplify tolerance: ${tolerance}`)

  try {
    await runStep('Fetch OSM (Overpass)', ['bun', 'run', 'fetch-osm', region])
  } catch (error) {
    if (!hasExistingRaw) throw error
    console.warn(`\nFetch failed, but ${rawPath} exists. Continuing with existing raw file.`)
  }
  await runStep('Process railway GeoJSON', ['bun', 'run', 'process-railway', region])
  await runStep('Simplify tracks GeoJSON', ['bun', 'run', 'simplify-tracks', region, tolerance])
  await runStep('Build topological network', ['bun', 'run', 'build-network', region])
  await runStep('Validate topological network', ['bun', 'run', 'validate-network', region])

  console.log(`\nDone: ${region}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
