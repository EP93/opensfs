/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TILE_URL_TEMPLATE?: string
  readonly VITE_TILE_MAX_ZOOM?: string
  readonly VITE_TILE_REQUESTS_PER_SECOND?: string
  readonly VITE_TILE_MAX_CONCURRENT_REQUESTS?: string
  readonly VITE_TILE_FAST_PAN_PX_PER_SEC?: string
  readonly VITE_TILE_FAST_PAN_ZOOM_BIAS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
