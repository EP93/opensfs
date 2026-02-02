# OpenSFS

Browser-based railway tycoon game using real OpenStreetMap railway data for Germany.

## Quick Reference

- **Stack**: Bun + Vite + React 18 + TypeScript (strict) + Pixi.js v8 + Zustand + Tailwind
- **Game Spec**: See `docs/specs/game-spec.md`

## Commands

```bash
bun run dev              # Start dev server (port 4000)
bun run build            # Build for production
bun run lint             # Run Biome linter
bun run check            # Run Biome (lint + format check)
bun run check:fix        # Auto-fix lint and format issues
bun run fetch-osm        # Fetch OSM data
bun run process-railway  # Process to GeoJSON
bun run simplify-tracks  # Simplify geometry
```

## Conventions

- Strict TypeScript (noImplicitAny, strictNullChecks, noUncheckedIndexedAccess)
- Game state lives in `src/game/GameState.ts`, Zustand stores are for React UI only
- OSM data uses WGS84 (lat/lon), game uses projected coordinates
- DB color scheme: Primary #EC0016, Accent #006F8F, Tracks #4A4A4A
