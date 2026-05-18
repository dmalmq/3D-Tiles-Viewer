# 3D Tiles Viewer

A single-page web application for viewing 3D Tiles datasets, built with [Vite](https://vitejs.dev/) and [CesiumJS](https://cesium.com/platform/cesiumjs/).

## Features

- Load 3D Tiles tilesets from a URL, a local folder picker, or a persistent folder via the File System Access API
- Switch between multiple imagery and terrain providers (OSM, Bing, Sentinel-2, Cesium World Terrain, GSI Japan DEM, PLATEAU terrain)
- Per-building floor-level lists with clipping-plane interior cutaways and a cross-building floor selector
- Auto-detect Revit-linked tilesets and split them into per-link buildings with feature-level filters
- PLATEAU + OSM catalog picker with a Leaflet map preview (3D Tiles, trees, OSM buildings)
- LOD filtering to suppress duplicate buildings across PLATEAU CityGML LODs
- Per-feature "ghost" / hide overrides on PLATEAU layers, with click-through picking
- Shapefile (.zip) overlay rendered as flat-height polygons
- FileGDB (`.gdb` folder or zip) import via GDAL, with auto-match to buildings and floors and a reassignment dialog
- Bilingual UI (English / Japanese) and dark / light themes
- Session save/load to JSON (metadata only — folders and URLs are re-resolved on load)

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run the focused unit tests:

```bash
npm test
```

Preview the production build:

```bash
npm run preview
```

## Configuration

- `VITE_PLATEAU_TERRAIN_TOKEN`: overrides the bundled public PLATEAU terrain token.
- `VITE_DEV_ALLOW_CORS=false`: disables the Vite dev server's permissive CORS header.

## Tech Stack

- Vite + `vite-plugin-cesium`
- CesiumJS
- shpjs (shapefile parsing)
- gdal3.js (FileGDB parsing in a Web Worker)
- Leaflet (catalog map preview)

## License

Private — all rights reserved.
