# OpenSFS

OpenSFS is a browser-based train/railway tycoon game built on real-world map data and
timetable-ish simulation. It uses OpenStreetMap-derived railway tracks + stations, renders the
world with Pixi.js, and layers a React UI on top.

This repository is focused on:

- Fast 2D map rendering of large railway networks (Pixi.js v8)
- A simulation core that keeps canonical state in `src/game/GameState.ts`
- A data pipeline that turns OpenStreetMap extracts into game-ready region artifacts

Project spec/design notes live in `docs/specs/game-spec.md`.

## Tech stack

- Runtime: Bun
- App: React + Vite + TypeScript (strict)
- Renderer: Pixi.js
- UI state bridge: Zustand (core simulation state is not stored in Zustand)
- Geo ops: Turf.js
- Graph/pathfinding: ngraph.graph + ngraph.path
- Storage: IndexedDB (via idb-keyval)
- Styling: Tailwind CSS + shadcn/ui-style primitives under `src/components/ui/`

## Getting started

### Prerequisites

- Bun installed: https://bun.sh

### Install

```bash
bun install
```

### Generate region data (required for the game to load)

The game loads region artifacts from `public/data/regions/` at runtime (tracks, stations, and a
topological network). These files are generated locally from OpenStreetMap and are intentionally
ignored by Git. See `public/data/regions/README.md` for details.

Quick start (build everything for a region end-to-end):

```bash
# Example (region + simplify tolerance)
bun run build-region-data freiburg 0.0001
```

Available region keys (currently hardcoded):

- `berlin`, `munich`, `hamburg`, `frankfurt`, `cologne`, `freiburg`

Notes:

- The pipeline fetches data from the Overpass API and can take a while.
- You can override the Overpass endpoint via `OVERPASS_API=...`.
- If fetch fails but a previous `public/data/regions/<region>-raw.json` exists, the pipeline will
  continue using that cached raw file.

### Run the dev server

```bash
bun run dev
```

Then open: `http://127.0.0.1:4000`

### Build for production

```bash
bun run build
bun run preview
```

## Useful commands

- `bun run dev` — Vite dev server (port `4000`)
- `bun run check` — Biome lint + formatting checks
- `bun run check:fix` — auto-fix lint/format issues
- `bun run build` — typecheck (`tsc -b`) and build bundle

### Data pipeline commands (OpenStreetMap)

- `bun run fetch-osm [region]` — fetch raw railway data from Overpass
- `bun run process-railway [region]` — produce GeoJSON tracks + stations
- `bun run simplify-tracks [region] [tolerance]` — simplify track geometry for rendering perf
- `bun run build-network [region]` — build a topological network for pathfinding/signals
- `bun run validate-network [region]` — validate the network output
- `bun run build-region-data [region] [tolerance]` — run the full pipeline end-to-end

## Project structure

- `src/game/` — Pixi.js game runtime (core logic, systems, graph/pathfinding)
  - `src/game/GameState.ts` — canonical simulation state
- `src/components/` — React overlays (HUD, sheets, dialogs)
- `src/stores/` — Zustand stores used as a UI bridge (avoid core simulation here)
- `src/lib/` — shared helpers/loaders
- `src/types/` — shared TypeScript types
- `scripts/` — Bun scripts for fetching/processing OpenStreetMap railway data
- `public/data/` — local region + train data inputs (region artifacts are generated)

## License

MIT — see `LICENSE`.
