import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { type Connect, defineConfig, type Plugin } from 'vite'

type TileFetchResult = {
  status: number
  statusText: string
  body: Buffer
  contentType: string | null
}

function osmTilesCachePlugin(): Plugin {
  const cacheRoot = path.resolve(process.cwd(), '.cache/osm-tiles')
  const upstreamBase = 'https://tile.openstreetmap.org'
  const userAgent = 'opensfs-dev'
  const inflight = new Map<string, Promise<TileFetchResult>>()

  async function fetchTile(z: number, x: number, y: number): Promise<TileFetchResult> {
    const url = `${upstreamBase}/${z}/${x}/${y}.png`
    const resp = await fetch(url, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': userAgent,
      },
    })
    const body = Buffer.from(await resp.arrayBuffer())
    return {
      status: resp.status,
      statusText: resp.statusText,
      body,
      contentType: resp.headers.get('content-type'),
    }
  }

  async function serveCachedTile(res: ServerResponse, filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath)
    } catch {
      return false
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=604800')

    await new Promise<void>((resolve) => {
      const stream = fs.createReadStream(filePath)
      stream.on('error', () => {
        res.statusCode = 500
        res.end()
        resolve()
      })
      stream.on('end', resolve)
      stream.pipe(res)
    })
    return true
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }

    const rawUrl = req.url ?? ''
    const pathOnly = rawUrl.split('?', 1)[0] ?? ''
    const stripped = pathOnly.startsWith('/osm-tiles')
      ? pathOnly.replace(/^\/osm-tiles/, '')
      : pathOnly
    const match = /^\/?(\d+)\/(\d+)\/(\d+)\.png$/.exec(stripped)
    if (!match) {
      res.statusCode = 404
      res.end()
      return
    }

    const z = Number(match[1])
    const x = Number(match[2])
    const y = Number(match[3])
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 19) {
      res.statusCode = 400
      res.end()
      return
    }
    const maxIndex = 2 ** z - 1
    if (x < 0 || y < 0 || x > maxIndex || y > maxIndex) {
      res.statusCode = 400
      res.end()
      return
    }

    const filePath = path.join(cacheRoot, String(z), String(x), `${y}.png`)
    if (await serveCachedTile(res, filePath)) return

    const key = `${z}/${x}/${y}`
    let promise = inflight.get(key)
    if (!promise) {
      promise = fetchTile(z, x, y).finally(() => {
        inflight.delete(key)
      })
      inflight.set(key, promise)
    }

    let fetched: TileFetchResult
    try {
      fetched = await promise
    } catch {
      res.statusCode = 502
      res.end()
      return
    }

    res.statusCode = fetched.status
    if (fetched.contentType) res.setHeader('Content-Type', fetched.contentType)
    res.setHeader('Cache-Control', fetched.status === 200 ? 'public, max-age=604800' : 'no-store')
    res.end(fetched.body)

    if (fetched.status !== 200) return
    if (fetched.contentType && !fetched.contentType.includes('image/png')) return

    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
      await fsp.writeFile(tmpPath, fetched.body)
      await fsp.rename(tmpPath, filePath)
    } catch {
      // Best-effort cache write.
    }
  }

  function applyMiddlewares(server: { middlewares: Connect.Server }): void {
    server.middlewares.use('/osm-tiles', (req, res, next) => {
      void handleRequest(req as IncomingMessage, res as ServerResponse).catch(next)
    })
  }

  return {
    name: 'opensfs-osm-tiles-cache',
    apply: 'serve',
    configureServer(server) {
      applyMiddlewares(server)
    },
    configurePreviewServer(server) {
      applyMiddlewares(server)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), osmTilesCachePlugin()],
  server: {
    port: 4000,
    host: '127.0.0.1',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
