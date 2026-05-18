# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # start Vite dev server (localhost:5173)
npm run build     # production build → dist/
npm run preview   # serve dist/ locally
npm test          # node --test against test/*.test.js (floorSplit, gdbAutoMatch)
```

No linter is configured. Tests cover only the pure helper modules; the rest is exercised via the browser.

## Environment variables

- `VITE_PLATEAU_TERRAIN_TOKEN` — overrides the bundled public PLATEAU terrain token.
- `VITE_DEV_ALLOW_CORS=false` — disables the dev server's permissive `Access-Control-Allow-Origin: *` header (default on).

## Architecture overview

Single-page Vite + CesiumJS app. Entry: `index.html` → `src/main.js`. Cesium ships via npm and is wired into the dev/build pipeline by `vite-plugin-cesium`, which copies Cesium's `Workers`, `Assets`, and `ThirdParty` directories.

`vite.config.js` also sets `worker.format = "es"` and `optimizeDeps.exclude = ["gdal3.js"]` — both required so `gdbWorker.js` can load GDAL as an ES module worker.

`main.js` is the single orchestrator: it owns all scene state, wires every UI element, and is the only place where Cesium primitives are added/removed. Other `src/` modules are library-style helpers it calls into.

## src/ modules

| File | Responsibility |
|------|---------------|
| `main.js` | Central state + UI orchestration. Owns `buildings[]`, `importedLayers[]`, `modelLevels[]`, selection state, imagery/terrain switching, search, session save/load, panel layout, theme, and language wiring. |
| `tilesetLoader.js` | `loadTilesetFromUrl`, `loadTilesetFromFiles`, `loadTilesetFromDirectoryHandle`, `zoomToTileset`, `removeCurrentTileset`. Manages blob-URL rewriting for local files and revokes them on removal via `tileset._blobCleanup`. |
| `lodFilter.js` | `LodFilter` class — for PLATEAU CityGML tilesets, samples `_lod`, gathers building IDs from the highest-LOD tileset, and injects a `Cesium3DTileStyle` `show` evaluator on lower-LOD tilesets to suppress duplicates. |
| `linkSplitter.js` | Inspects loaded tiles for Revit `sourceLinkName` / `sourceDocument` metadata. If ≥2 link groups are found, the UI prompts to split one tileset into multiple `buildings[]` entries that share the tileset but apply per-link feature filters. |
| `glbBoundsExtractor.js` | Reads `EXT_structural_metadata` + per-primitive POSITION min/max from a tileset's GLB to compute per-Revit-link AABBs without walking vertices. Used to estimate per-link bounding boxes for split buildings. |
| `cityGmlLoader.js` | `parseCityGml(xmlText)` — extracts `gml:Polygon` surfaces (with holes + roof/wall/ground tags) from `gml:Building` / `gml:BuildingPart`. Detects lat-first vs. projected CRS and emits a warning if projected. Rendered in `main.js` with `perPositionHeight = true`. |
| `floorSplit.js` | `extractFloorNumber`, `shortLevelName`, `levelNameToNumber`, `matchLevelByText`, `groupFeaturesByFloor`. Bilingual (JP + EN) floor-label parser used by GDB auto-matching and level resolution. Has unit tests. |
| `gdbLoader.js` | Public `loadGdb(input, buildings, onProgress, mode)` API. Lazily spins up `gdbWorker.js`, sends file descriptors + relative paths, returns parsed `featureCollections`. |
| `gdbWorker.js` | Web Worker. Uses `gdal3.js` to open `.gdb` folders (or zipped variants), enumerate feature classes, extract GeoJSON + per-class bbox, returns `{ featureCollections, errors }`. |
| `gdbAutoMatch.js` | Heuristic name matcher: scores GDB layer filenames + feature `source` property against `buildings[]` and per-building `levels[]`. Returns `{ buildingIndex, levelKey, confidence: "high"\|"medium"\|"none" }`. Also flags `_level` metadata-only feature classes. Has unit tests. |
| `gdbImportDialog.js` | Modal for reviewing/assigning GDB layers to buildings + floors. Used in both `"import"` and `"reassign"` modes. Supports per-feature floor splits, bulk actions, "Unassigned", "Skip". |
| `importDataModal.js` | PLATEAU + OSM catalog picker with Leaflet map preview. Fetches PLATEAU prefecture/municipality lists, lets the user pick area + categories, calls `loadTilesetFromUrl()` + an `onLayerAdded` callback. Uses GSI reverse-geocoder for area autodetect. |
| `i18n.js` | `t(key, params)`, `setLanguage`, `getLanguage`, `onLanguageChange`, `applyTranslationsToDom`. Resolves `data-i18n*` attributes (`data-i18n`, `-html`, `-title`, `-placeholder`, `-aria-label`). Language saved in `localStorage["language"]`. |
| `i18nStrings.js` | `MESSAGES = { en, ja }` — every UI string (header, panels, dialogs, errors, PLATEAU labels, GDB messages). |
| `fileSystemAccess.js` | Chrome File System Access API wrapper: `isFileSystemAccessSupported`, `requestDirectoryPermission`, `getFilesFromDirectoryHandle` (recursive, sets `relativePath`). |
| `directoryStore.js` | IndexedDB (`cesium-app` DB → `directoryHandles` store) for persisting `FileSystemDirectoryHandle` references across sessions. |

## Central state model

`buildings[]` in `main.js` is the primary scene graph. Each entry:

```js
{
  name,                            // user-facing label (or Revit link name after a split)
  tileset,                         // Cesium3DTileset
  heightOffset,                    // metres applied to entire tileset
  levelBaseElevation,              // WGS84 datum height (m); auto-estimated, user-editable
  levels: [{ name, key, floor, ceiling }],  // ceiling = metres above datum
  activeLevelIndex,                // -1 = all floors
  shapefileLayers: [{ name, dataSource, color, levelKey, source, features }],
  linkFilter: { property, value } | null,   // Revit-link split filter
  sourceLevelGroups: Map<linkName, levels[]>,
  sourceUrl, directoryHandleId, directoryFolderName, aliases
}
```

Other top-level state:

- `importedLayers[]` — PLATEAU catalog layers and unassigned shapefile/GDB layers (not tied to a building).
- `modelLevels[]` — global merged level list keyed by floor number; drives the cross-building floor selector.
- `selectedBuildingIndex`, `activeModelLevelIndex` — selection state.
- `lodFilter` — single `LodFilter` instance for the whole session.
- `selectedPlateauFeature`, `plateauOverridesEnabled` — PLATEAU per-feature override state.

## Tileset loading paths

- **URL** → `loadTilesetFromUrl`.
- **`webkitdirectory` file picker** → `loadTilesetFromFiles` reads `tileset.json`, rewrites every `content.uri`/`content.url` in the tile tree to `blob:` URLs pointing at the selected files, then feeds the rewritten JSON to `Cesium3DTileset.fromUrl`. Blob URLs are stored on `tileset._blobCleanup` and revoked by `removeCurrentTileset`.
- **File System Access API** → `loadTilesetFromDirectoryHandle`. The chosen `FileSystemDirectoryHandle` is persisted via `directoryStore.js` so sessions can reopen the folder after a reload.

Sample tiles placed under `public/tiles/<name>/` are served at `/tiles/<name>/tileset.json`; the dev server sends `Access-Control-Allow-Origin: *` so they can be loaded cross-origin (unless `VITE_DEV_ALLOW_CORS=false`).

## Revit-link splitting

`linkSplitter.inspectLinks` walks already-loaded tiles synchronously and subscribes to `tileset.tileLoad` for the rest, grouping features by `sourceLinkName`. If ≥2 groups are found, `main.js` shows a dialog asking whether to split. Accepting creates one `buildings[]` entry per link, each with its own `linkFilter` (`{ property, value }`); the underlying tileset is shared, but each building's UI/picking respects its filter. `glbBoundsExtractor.js` is then used to derive per-link AABBs without iterating vertices, by reading `EXT_structural_metadata` + per-primitive POSITION min/max.

## Floor levels + clipping

`levels[]` stores `{ name, key, floor, ceiling }`; `ceiling` is metres above the model datum. `levelBaseElevation` is the WGS84 altitude of that datum, auto-estimated from the first loaded tileset's bounding sphere (`center_height − radius`) and user-editable.

When a level is activated for a building, `applyClipToTileset(tileset, ceiling)` builds a `ClippingPlaneCollection` in world (ECEF) coordinates: the geodetic up-vector at the tileset center is read from `Matrix4.getColumn(tileset.modelMatrix, 2)`; the plane has `normal = -up` and `distance = dot(up, ceilingPoint)`, hiding everything above the ceiling. Terrain is unaffected.

## Imagery / Terrain

`switchImagery()` and `switchTerrain()` in `main.js` are the only entry points for provider changes. Imagery providers all fall back to OSM on error. Terrain defaults to Cesium World Terrain (Ion) if a token is present; otherwise it falls back to `EllipsoidTerrainProvider`. Japan DEM (GSI) terrain uses `CustomHeightmapTerrainProvider` with canvas-based PNG decoding of GSI tiles (`cyberjapandata.gsi.go.jp`). PLATEAU terrain uses the bundled token or `VITE_PLATEAU_TERRAIN_TOKEN` if set.

## Shapefile + GDB layers

- **Shapefile (.zip)** — Loaded via dynamic `import("shpjs")`, returned as a GeoJSON FeatureCollection rendered with `GeoJsonDataSource`. After load, `polygon.perPositionHeight = false` and `polygon.height = layer elevation`, so all polygons float flat at the same absolute WGS84 altitude regardless of any z-values in the shapefile.
- **FileGDB (`.gdb` folder or zip)** — `gdbLoader.loadGdb` → `gdbWorker.js` (GDAL) → `gdbImportDialog.js` for review → assignment to `buildings[]` / levels via `gdbAutoMatch.js`. Feature classes whose names end with `_level` are metadata-only (used to extract level definitions) and are skipped during import.
- Layers that are left unassigned land in `importedLayers[]` and can be reassigned later via the "GDB reassign" menu action (`mode = "reassign"`).

## PLATEAU integration

`importDataModal.js` lets the user pick PLATEAU 3D Tiles, OSM trees, or OSM buildings on a Leaflet map. Imported PLATEAU layers register with `main.js` and become pickable — clicking a feature opens a floating info card.

Per-feature overrides (hide / "ghost" via `PLATEAU_GHOST_COLOR = rgba(255,255,255,0.18)` / restore) are stored on each layer's `_overrides` map and applied by `applyPlateauLayerStyle`. The header's "Ghost overlapping PLATEAU" toggle (`buildingOverlapToggle` in the DOM) binds to `plateauOverridesEnabled`, which gates whether these overrides take effect.

`pickThroughGhosts(position)` lets clicks pass through ghosted features so the user can still pick what's behind them. The `LodFilter` is a separate mechanism — it suppresses lower-LOD duplicate buildings entirely, not as ghosts.

## i18n

Two languages (English / Japanese) toggled from the header. DOM elements declare their string via `data-i18n*` attributes; `applyTranslationsToDom` resolves them on language change. JS-side strings call `t("key", { name })`. Code that dynamically renders UI (e.g., scene tree, dialogs) should subscribe via `onLanguageChange(fn)` to re-render itself.

## Persistence

| Where | Key | Purpose |
|-------|-----|---------|
| localStorage | `cesiumIonToken` | Cesium Ion access token. |
| localStorage | `language` | Current UI language (`"en"` / `"ja"`). |
| localStorage | `theme` | `"dark"` / `"light"`. |
| localStorage | `leftPanelWidth` | Resizer position in pixels. |
| localStorage | `<section-collapsed-...>` | Collapsed state per panel section, keyed by section title text. |
| IndexedDB | `cesium-app` / `directoryHandles` | Persisted `FileSystemDirectoryHandle` references. |
| File download | Session JSON via Save Session | `buildings[]` metadata + shapefile/GDB features. **Does not include tileset bytes** — Load Session re-requests folders/URLs. |

The Cesium Ion token is applied to `Ion.defaultAccessToken` on load and again when the user clicks "Apply Token". It's required for Ion-backed imagery (Bing, Sentinel-2) and Cesium World Terrain.

## Notable pitfalls

- **Blob URL lifetime.** File-loaded tilesets keep their blob URLs alive via `tileset._blobCleanup`. If that reference is dropped without going through `removeCurrentTileset`, tile fetches break.
- **LOD filter timing.** `LodFilter.apply()` samples `_lod` from the first feature of each loaded tile; it needs tiles to be loaded. `refreshLodFilterIfEnabled` resamples on geometry changes (e.g., after a new tileset is added).
- **Floor-name parsing is greedy.** `floorSplit.extractFloorNumber` will happily turn a bare digit in a feature class name into a floor number. When extending it, mind the existing tests in `test/floorSplit.test.js`.
- **Session JSON is metadata-only.** Tileset bytes are never serialized; users must re-pick folders or have the URL still reachable. Newly added persistent fields on a building need to be added to the save/load round-trip in `main.js`.
- **Section collapse keys depend on title text.** Renaming a section title in `i18nStrings.js` will reset its remembered collapsed state.
- **Heavy state lives in `main.js`.** Before adding new top-level state, check whether an existing field on the relevant `buildings[]` entry (or `importedLayers[]`) can hold it; the file is large and parallel state pathways are easy to break.
