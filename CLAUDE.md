# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start Vite dev server (localhost:5173)
npm run build     # production build → dist/
npm run preview   # serve dist/ locally
```

No test runner or linter is configured.

## Architecture

Single-page Vite app. Entry: `index.html` → `src/main.js`. Cesium is installed as an npm package (`cesium`) and served by `vite-plugin-cesium`, which handles the static asset copying (Workers, Assets, ThirdParty) automatically.

### src/ modules

| File | Responsibility |
|------|---------------|
| `main.js` | All UI wiring, state, imagery/terrain switching, tileset list, floor levels, shapefile layers, height offset |
| `tilesetLoader.js` | `loadTilesetFromUrl`, `loadTilesetFromFiles`, `zoomToTileset`, `removeCurrentTileset` |
| `lodFilter.js` | `LodFilter` class — hides lower-LOD duplicates in PLATEAU CityGML tilesets |

### Local tile serving

Static 3D Tiles placed under `public/tiles/<name>/` are served by Vite at `/tiles/<name>/tileset.json`. The `vite.config.js` adds `Access-Control-Allow-Origin: *` to support cross-origin tile requests.

### Local file loading (blob URL rewriting)

`loadTilesetFromFiles` handles the `webkitdirectory` file picker. It reads `tileset.json`, rewrites every `content.uri`/`content.url` in the tile tree to `blob:` URLs pointing at the selected files, then feeds the rewritten JSON to `Cesium3DTileset.fromUrl`. This bypasses Cesium's fetch layer for local files. Blob URLs are stored on `tileset._blobCleanup` and revoked in `removeCurrentTileset`.

### LOD filter

`LodFilter` is specific to PLATEAU CityGML 3D Tiles that carry `_lod` and `buildingIDAttribute_uro:buildingID` feature properties. It detects the highest LOD tileset, collects its building IDs, then injects a `Cesium3DTileStyle` with a custom `show` evaluator on lower-LOD tilesets to suppress duplicates. The style is re-evaluated by Cesium automatically on tile load, so no event listeners are needed.

### Imagery / Terrain

`switchImagery()` and `switchTerrain()` in `main.js` are the only entry points for provider changes. Imagery providers all fall back to OSM on error. Terrain defaults to Cesium World Terrain (Ion) if a token is present; otherwise falls back to `EllipsoidTerrainProvider`. Japan DEM terrain uses `CustomHeightmapTerrainProvider` with canvas-based PNG decoding of GSI tiles (`cyberjapandata.gsi.go.jp`).

### Floor Levels + Clipping

`levels[]` stores `{ name, ceiling }` where `ceiling` is metres above the model datum. `levelBaseElevation` holds the WGS84 height of that datum, auto-estimated from the first loaded tileset's bounding sphere (`center_height − radius`) and user-editable. `applyClipToTileset()` computes the geodetic surface normal at the tileset center and builds a `ClippingPlaneCollection` in world (ECEF) coordinates: `normal = −up`, `distance = dot(up, ceilingPoint)`. This clips everything above the ceiling plane while leaving terrain untouched.

### Shapefile Layers

Loaded via `shpjs` (dynamic import) from a `.zip` file. Returns a GeoJSON FeatureCollection rendered with `GeoJsonDataSource`. After load, `polygon.perPositionHeight = false` and `polygon.height` is set to the layer's elevation value (metres WGS84 absolute), making all polygons float as flat overlays at that height regardless of any z-values in the shapefile.

### Cesium Ion token

Stored in `localStorage` under key `cesiumIonToken`. Applied to `Ion.defaultAccessToken` on load and on "Apply Token" click. Required only for Ion-backed imagery (Bing, Sentinel-2) and Cesium World Terrain.

