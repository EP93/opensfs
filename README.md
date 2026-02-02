# OpenSFS

OpenSFS is a browser-based train/railway game rendered with Pixi.js and wrapped in a React UI.
It uses real-world map + timetable-ish data (primarily OpenStreetMap-derived).

## Prereqs

- [Bun](https://bun.sh) (package manager/runtime)

## Develop

- Install: `bun install`
- Dev server: `bun run dev` (Vite on `http://127.0.0.1:4000`)
- Lint/format: `bun run check` / `bun run check:fix`
- Build: `bun run build`

## Data pipeline (OpenStreetMap)

Generated region outputs are intentionally ignored by Git (see `public/data/regions/README.md`).

- Fetch: `bun run fetch-osm [region]`
- Process: `bun run process-railway [region]`
- Simplify: `bun run simplify-tracks [region] [tolerance]`
- Build region bundle: `bun run build-region-data [region]`
