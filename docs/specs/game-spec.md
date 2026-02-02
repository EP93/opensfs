# OpenSFS - Browser-Based Railway Tycoon

## Project Overview
OpenSFS is a browser-based railway tycoon game using real OpenStreetMap railway data for Germany. Built with React + Vite + TypeScript and Pixi.js for 2D rendering.

## Tech Stack
- **Runtime**: Bun
- **Framework**: React 18 + Vite
- **Language**: TypeScript (strict mode)
- **Rendering**: Pixi.js v8
- **State Management**: Zustand (UI bridge) + Internal game state
- **Geo Operations**: Turf.js
- **Graph/Pathfinding**: ngraph.graph + ngraph.path
- **Styling**: Tailwind CSS
- **Storage**: IndexedDB via idb-keyval

## Project Structure
```
opensfs/
├── public/data/regions/     # Preprocessed GeoJSON per region
├── src/
│   ├── main.tsx            # React Entry Point
│   ├── App.tsx             # App Shell
│   ├── game/               # Pixi.js Game Logic
│   │   ├── Game.ts         # Main game class
│   │   ├── GameState.ts    # Internal game state
│   │   ├── systems/        # Game systems (trains, signals, etc.)
│   │   ├── entities/       # Game entities
│   │   ├── utils/          # Utilities
│   │   └── assets/sprites/ # Sprite assets
│   ├── components/         # React UI Overlays
│   ├── stores/             # Zustand Stores
│   ├── hooks/              # React Hooks
│   ├── lib/                # Shared utilities
│   └── types/              # TypeScript types
├── scripts/                # Bun Scripts for Data Processing
│   ├── fetch-osm.ts        # Fetch OSM data via Overpass API
│   ├── process-railway.ts  # Extract tracks + stations
│   └── simplify-tracks.ts  # Simplify geometry
└── ...config files
```

## Commands
```bash
bun install          # Install dependencies
bun run dev          # Start dev server
bun run build        # Build for production
bun run lint         # Run ESLint
bun run fetch-osm    # Fetch OSM data (add region: berlin, munich, hamburg, frankfurt, cologne)
bun run process-railway  # Process raw OSM to GeoJSON
bun run simplify-tracks  # Simplify track geometry
bun run build-network    # Build topology network for pathfinding/signals
bun run validate-network # Validate topology network (components, dangling nodes, etc.)
bun run build-region-data # Run the full region pipeline end-to-end
```

## Architecture Notes

### Game Engine (Pixi.js)
- `Game.ts` is the main entry point, managing the Pixi Application
- `GameState.ts` holds all game data (stations, tracks, trains, time)
- The game loop runs in Pixi's ticker
- Viewport controls (pan/zoom) are handled via pointer events

### State Management
- Game state lives in `GameState.ts` (not Zustand)
- Zustand stores (`useGameStore`, `useUIStore`) are for React UI only
- State syncs from Game -> Zustand periodically for React re-renders

### Coordinate Systems
- OSM data uses WGS84 (lat/lon)
- Game world uses projected coordinates (Web Mercator-like)
- Screen coordinates from Pixi viewport

### Color Scheme (Deutsche Bahn inspired)
- Primary: #EC0016 (DB Red)
- Secondary: #1E1E1E (Dark Gray)
- Accent: #006F8F (Petrol for S-Bahn)
- Background: #F5F5F5 (Light Gray)
- Tracks: #4A4A4A
- Water: #A8D5E5

## Data Pipeline
1. `fetch-osm.ts` - Downloads raw OSM data from Overpass API
2. `process-railway.ts` - Converts to GeoJSON with normalized properties
3. `simplify-tracks.ts` - Reduces coordinate count for performance
4. `build-network.ts` - Builds topological network graph from raw OSM topology (node/way IDs)

## Type Conventions
- Use strict TypeScript (noImplicitAny, strictNullChecks, etc.)
- Prefer explicit return types for public functions
- Use branded types for IDs where appropriate
- Always handle null/undefined explicitly

## Performance Considerations
- Use spatial indexing for large track datasets
- Implement level-of-detail (LOD) for zoom levels
- Batch Pixi.js draw calls where possible
- Consider Web Workers for heavy computations
