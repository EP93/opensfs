# Region data (generated)

Files in this folder are generated locally from OpenStreetMap and are intentionally ignored by Git.

Typical flow:

- `bun run fetch-osm [region]`
- `bun run process-railway [region]`
- `bun run simplify-tracks [region] [tolerance]`
- `bun run build-region-data [region]`

Keep `.gitkeep` so the folder exists in a fresh clone.
