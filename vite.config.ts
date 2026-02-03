import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    host: '127.0.0.1',
    proxy: {
      '/osm-tiles': {
        target: 'https://tile.openstreetmap.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/osm-tiles/, ''),
        headers: {
          'User-Agent': 'opensfs-dev',
        },
      },
    },
  },
  preview: {
    proxy: {
      '/osm-tiles': {
        target: 'https://tile.openstreetmap.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/osm-tiles/, ''),
        headers: {
          'User-Agent': 'opensfs-preview',
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
