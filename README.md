<div align="center">

# 3D Tiles Viewer

### CesiumJS-based 3D Tiles authoring and publishing tool

<p>
A single-page web application for loading, reviewing, and publishing 3D Tiles datasets.<br />
Supports Revit link splitting, floor-level clipping, PLATEAU integration, shapefile/GDB/GeoPackage overlays,<br />
indoor network (stairs/escalators/elevators) authoring, venue management, and one-click tileset publishing<br />
— all running in the browser with an optional Node server that can also receive packages pushed from RevitGeoSuite.
</p>

<p>
  <img src="https://img.shields.io/badge/Frontend-Vite_+_CesiumJS-0696D7?style=for-the-badge&logo=cesium&logoColor=ffffff" />
  <img src="https://img.shields.io/badge/Backend-Node.js_+_Express-339933?style=for-the-badge&logo=node.js&logoColor=ffffff" />
  <img src="https://img.shields.io/badge/GIS-GDAL_+_shpjs-4CAF50?style=for-the-badge&logoColor=ffffff" />
</p>

<p>
  <img src="https://img.shields.io/badge/Format-3D_Tiles-0696D7?style=flat-square" />
  <img src="https://img.shields.io/badge/Data-Revit_%7C_PLATEAU_%7C_GDB_%7C_GeoPackage_%7C_Shapefile-0369a1?style=flat-square" />
  <img src="https://img.shields.io/badge/Languages-English_%7C_Japanese-907aa9?style=flat-square" />
  <img src="https://img.shields.io/badge/Theme-Dark_%7C_Light-475569?style=flat-square" />
</p>

</div>

---

## About

Built for AEC and GIS teams working with 3D Tiles from Revit, PLATEAU CityGML, and other sources. The authoring interface lets users load tilesets from URLs or local folders, assign floor levels, overlay shapefiles and GDB layers, group datasets into named venues, and publish self-contained viewer packages to a shared server — so colleagues can open the result in a browser with no installation.

---

## Workflow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. Load  │ →  │ 2. Author│ →  │ 3. Venue │ →  │ 4. Publish
│ Tilesets │    │  & Review│    │  Groups  │    │ & Share  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

- **Load** — Open tilesets from a URL, a local folder picker, or a persisted File System Access handle
- **Author** — Assign floor levels with clipping-plane cutaways, split Revit links, overlay GIS layers
- **Venue** — Group buildings into named venues; filter the scene to a single venue
- **Publish** — Bundle tilesets and session metadata; upload to the Express server for shared access via `viewer.html`

---

## Key Features

- Load 3D Tiles from URL, `webkitdirectory` picker, or persistent File System Access API handle
- Auto-detect Revit-linked tilesets and split them into per-link buildings with feature-level filters
- Per-building floor-level lists with clipping-plane interior cutaways and a cross-building floor selector
- PLATEAU + OSM catalog picker with Leaflet map preview (3D Tiles, trees, OSM buildings)
- LOD filtering to suppress duplicate buildings across PLATEAU CityGML LODs
- Per-feature "ghost" / hide overrides on PLATEAU layers with click-through picking
- Shapefile (`.zip`) overlay rendered as flat-height polygons
- FileGDB (`.gdb` folder or zip) and GeoPackage (`.gpkg`) import via GDAL, with heuristic auto-match to buildings and floors
- Multi-building import picker for datasets that bundle several buildings into one GDB/GPKG/shapefile
- Indoor network authoring: connect stairs, escalators, elevators, slopes, and moving walkways across floors with a floor-to-floor connect mode, waypoint placement along stair geometry, and GeoJSON export of authored connectors
- RevitGeoSuite package ingestion: the server accepts pushed `cesium-package.json` bundles (3D Tiles + GIS floor plans, matched to exact levels via a level-ID map) and streams them into the open session live over SSE, with an undo for accidental overwrites
- Venue management: create, edit, and delete named venues; assign buildings; filter scene by venue
- Publish packages: mirror or upload tilesets + session JSON to the server; share via link
- Session backup / restore with auto-snapshots and a visual diff between session states
- Bilingual UI (English / Japanese) and dark / light themes
- Playwright end-to-end tests alongside Node.js unit tests
- Static public sample: a tiny synthetic indoor tileset that `viewer.html` can load without Express

---

## Stack

### Frontend
![Vite](https://img.shields.io/badge/Vite-646cff?style=for-the-badge&logo=vite&logoColor=ffffff)
![CesiumJS](https://img.shields.io/badge/CesiumJS-0696D7?style=for-the-badge&logo=cesium&logoColor=ffffff)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=ffffff)
![shpjs](https://img.shields.io/badge/shpjs-0369a1?style=for-the-badge)
![gdal3.js](https://img.shields.io/badge/gdal3.js_(Web_Worker)-4CAF50?style=for-the-badge)

### Backend
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=ffffff)
![Express](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=ffffff)
![multer](https://img.shields.io/badge/multer-475569?style=for-the-badge)

---

## Quickstart

```bash
# Install dependencies
npm install

# Development (Vite dev server + Express API on localhost:5173 / :3000)
npm run dev

# Production build
npm run build

# Serve the built app (localhost:3000)
npm start
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port for the production Express server |
| `PUBLISH_TOKEN` | `""` | Optional bearer token to guard publish endpoints |
| `VITE_PLATEAU_TERRAIN_TOKEN` | bundled | Override the public PLATEAU terrain token |
| `VITE_DEV_ALLOW_CORS` | `true` | Set to `false` to disable permissive CORS on the dev server |

---

## Public sample (static, no Express)

A tiny **synthetic indoor** 3D Tiles dataset ships in the repo. Geometry is generated in-repo (`scripts/generate-sample-tileset.js`): a few made-up rooms on two floors. It is not a real building, station, or workplace. License: CC0.

| Resource | Path |
|---|---|
| Tileset | `/tiles/sample-indoor/tileset.json` |
| Session | `/tiles/sample-indoor/session.json` |
| Read-only viewer | `/viewer.html` |

The portfolio embed (and anyone serving this app as static files) should point at **`/tiles/sample-indoor/tileset.json`** for the tileset, and open **`/viewer.html`** for the click-to-load demo. Express is not required.

```bash
npm run dev
# then open http://localhost:5173/viewer.html
```

Or `npm run build` and serve `dist/` with any static file server (`vite preview`, nginx, GitHub Pages, …).

`viewer.html` loads the public sample by default. Use the **Dataset** selector to switch back to the sample, or choose **This device…** / **Choose folder** to open a local 3D Tiles folder (File System Access, with a directory-picker fallback). Local files are read in the browser as blob URLs — nothing is uploaded, published, or copied to a CDN.

Published venue links still work via query params, e.g. `/viewer.html?venue=<id>` or `/viewer.html?session=/sessions/<id>.json`.

---

## Tests

```bash
# Unit tests (floor-label parsing, session diff, venue manifest, network export, …)
npm test

# End-to-end tests (requires a running dev server)
npm run e2e

# Lint
npm run lint
```

---

<div align="center">

Load tilesets → author floors and layers → group into venues → publish and share

</div>
