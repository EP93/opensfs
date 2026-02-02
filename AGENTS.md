# Repository Guidelines

OpenSFS is a browser-based train/railway game built on real-world map + timetable-ish data (primarily OpenStreetMap-derived), rendered with Pixi.js and wrapped in a React UI.

## Project Structure & Module Organization

- `src/` contains the app code:
  - `src/game/` Pixi.js game runtime (core logic, systems, graph/pathfinding). Keep canonical state in `src/game/GameState.ts`.
  - `src/components/` React UI overlays (HUD, sheets, dialogs). `src/components/ui/` is shadcn/ui-style primitives.
  - `src/stores/` Zustand stores used as a UI bridge (avoid putting core simulation state here).
  - `src/lib/` shared helpers (e.g., loaders/utilities), `src/types/` shared TypeScript types.
- `public/` static assets and data (see `public/data/regions/` and `public/data/trains/`).
- `scripts/` Bun scripts for fetching/processing OpenStreetMap railway data.
- `docs/specs/` design notes and specs (start with `docs/specs/game-spec.md`).

## Build, Test, and Development Commands

Use Bun as the package manager/runtime:

- `bun install` install dependencies
- `bun run dev` start Vite dev server (port `4000`)
- `bun run build` typecheck (`tsc -b`) and build production bundle
- `bun run preview` serve the production build locally
- `bun run check` run Biome checks (lint + formatting)
- `bun run check:fix` auto-fix lint/format issues
- Data pipeline (writes to `public/data/regions/`):
  - `bun run fetch-osm [region]`
  - `bun run process-railway [region]`
  - `bun run simplify-tracks [region] [tolerance]`

## Coding Style & Naming Conventions

- Formatting/linting: Biome (`biome.json`), 2-space indentation, single quotes, ~100 char line width.
- TypeScript: strict mode; avoid `any` and non-null assertions; prefer explicit return types on exported APIs.
- Imports: prefer the `@/` alias (maps to `src/`).
- Naming: React components `PascalCase.tsx`, hooks `useThing.ts`, Zustand stores `useThingStore.ts`.

## Testing Guidelines

No automated test runner is configured yet (no `test` script). For changes, run `bun run check` and `bun run build`, then do a quick manual smoke test in `bun run dev`.

## Commit & Pull Request Guidelines

Git history may not exist yet in this checkout; if/when using Git, prefer Conventional Commits like `feat(game): add timetable sim` / `fix(ui): prevent HUD overflow`.

- PRs should include: what/why, how to verify, and screenshots for UI changes.
- Avoid committing generated artifacts (`dist/`, `node_modules/`, and large region GeoJSON under `public/data/regions/` are expected to be local-only).
