# Feature: Viewer Mode

The read-only viewer (`viewer.html`) for consuming published tilesets and shared sessions.

## Sub-features

1. **Public sample loading**: Automatically loads a synthetic indoor tileset on first visit
2. **Dataset selector**: Switch between public sample, shared URL, and local folder
3. **Building and layer navigation**: Select buildings and toggle layer visibility
4. **Query param loading**: Load tilesets/sessions via `?tileset=` or `?session=` URL params
5. **No authoring UI**: Publish, export, and editing features are hidden

## How to get to it (user POV)

### Load the Viewer

1. Open `http://localhost:5173/viewer.html` in a browser
2. The page loads with the **public sample** tileset pre-selected
3. The left panel shows:
   - **Dataset selector**: Dropdown with "Public sample", "This device…", etc.
   - **Building selector**: Dropdown with "Sample House" (from the synthetic tileset)
   - **Layers panel**: List of floor layers (1F, 2F, etc.)
   - **Environment panel**: Imagery and terrain selectors (collapsed by default)
4. The Cesium viewport renders the 3D tiles
5. No "Add Data", "Publish", or "Export" buttons are visible (authoring UI is hidden)

### Switch to Local Folder

1. In the viewer, open the **Dataset selector** (top of left panel)
2. Select **"This device…"**
3. Click the **"Choose folder"** button
4. The browser's directory picker opens
5. Select a folder containing a `tileset.json` file
6. The tileset loads and replaces the public sample
7. The dataset selector now shows "This device…" as selected

### Load a Tileset via Query Param

1. Open `http://localhost:5173/viewer.html?tileset=/tiles/sample-indoor/tileset.json`
2. The viewer loads with the specified tileset instead of the public sample
3. The dataset selector shows "Loaded from URL"

### Load a Session via Query Param

1. Open `http://localhost:5173/viewer.html?session=/tiles/sample-indoor/session.json`
2. The viewer loads the session JSON, which includes:
   - Tileset URLs or local handles
   - Floor metadata, venue groups, layer colors
   - Imagery and terrain preferences
3. The dataset selector shows "Loaded from URL"

## Driving it with Playwright/CLI

### CLI Command

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs load-viewer-sample
```

This opens `viewer.html` and waits for the public sample to load.

### Playwright Recipe: Load Viewer Sample

```javascript
// 1. Open viewer.html
await page.goto('http://localhost:5173/viewer.html');
await page.waitForSelector('#appHeader', { timeout: 10000 });

// 2. Wait for the building selector to populate
await page.waitForSelector('#viewerBuildingSelect option:nth-child(2)', { timeout: 45000 });

// 3. Verify the sample tileset is selected
const dataset = await page.locator('#viewerDatasetSelect').inputValue();
expect(dataset).toBe('sample');

// 4. Verify the building is "Sample House"
const building = await page.locator('#viewerBuildingSelect option:nth-child(2)').textContent();
expect(building).toBe('Sample House');

// 5. Verify layers are visible
await expect(page.locator('#viewerLayersList')).toContainText('1F');
await expect(page.locator('#viewerLayersList')).toContainText('2F');
```

### Playwright Recipe: Load Tileset via Query Param

```javascript
// 1. Open viewer.html with ?tileset=
await page.goto('http://localhost:5173/viewer.html?tileset=/tiles/sample-indoor/tileset.json');

// 2. Wait for the building selector to populate
await page.waitForSelector('#viewerBuildingSelect option:nth-child(2)', { timeout: 45000 });

// 3. Verify the building name (from the tileset's root tile)
const building = await page.locator('#viewerBuildingSelect option:nth-child(2)').textContent();
expect(building).toBe('sample-indoor');

// 4. Verify floors were auto-detected
await expect(page.locator('#viewerLayersList')).toContainText('1F');
await expect(page.locator('#viewerLayersList')).toContainText('2F');
```

### Key Selectors

- `#viewerDatasetSelect` — Dataset selector dropdown
- `#viewerBuildingSelect` — Building selector dropdown
- `#viewerBuildingZoomBtn` — Zoom to building button
- `#viewerLayersList` — List of floor layers
- `#viewerOpenFolderBtn` — "Choose folder" button
- `#viewerTilesetFolderInput` — Hidden file input for folder picker
- `#viewerNoBuildings` — Empty state message ("No buildings loaded")
- `#viewerNoLayers` — Empty state message ("No layers")
- `#importedLayersList` — List of imported PLATEAU layers (if any)
- `#environmentSection` — Collapsible environment panel

### Observable End State

**After loading the public sample**:
- `#viewerDatasetSelect` value is `"sample"`
- `#viewerBuildingSelect` has at least 2 options (first is empty, second is "Sample House")
- `#viewerLayersList` contains `<li>` elements for each floor (1F, 2F)
- Cesium viewport renders the synthetic indoor tileset
- `window.__CESIUM_E2E__.datasetKind` equals `"sample"` (if e2e hooks are enabled)

**After loading a local folder**:
- `#viewerDatasetSelect` value is `"local"`
- `#viewerBuildingSelect` updates with buildings from the selected folder
- `#viewerLayersList` updates with floors from the selected tileset
- `window.__CESIUM_E2E__.datasetKind` equals `"local"`

## Gotchas

1. **Folder picker headless mode**: The directory picker (`#viewerTilesetFolderInput`) requires a user gesture. In Playwright, use `setInputFiles()` to simulate folder selection:
   ```javascript
   await page.locator('#viewerTilesetFolderInput').setInputFiles('/path/to/tileset/folder');
   ```
   This only works in headed mode or with `setInputFiles()` (not in real headless browsers).

2. **Query param precedence**: If both `?tileset=` and `?session=` are present, `?session=` takes precedence. The session JSON can include its own tileset URLs, which override `?tileset=`.

3. **Relative URL resolution**: Query param URLs starting with `/` (e.g., `?tileset=/tiles/sample-indoor/tileset.json`) are resolved against the Vite dev server. Set `base` in `vite.config.js` if the app is hosted under a subpath (e.g., GitHub Pages).

4. **No authoring features**: The viewer does not have:
   - "Add Data" button
   - "Publish" or "Export" buttons
   - Floor editing (add/edit/delete levels)
   - Venue management
   - Indoor network authoring
   If you need these features, use the authoring interface (`index.html`).

5. **Auto-detected floors**: When loading a tileset without a session JSON, the viewer attempts to auto-detect floors from feature properties (e.g., `_floor`, `level`, `storey`). If no floors are found, all features are grouped into a single "All" layer.

6. **Dataset selector state**: The dataset selector state is stored in memory (not `localStorage`). Refreshing the page resets to the public sample unless `?tileset=` or `?session=` is present.

7. **Invalid folder handling**: If the selected folder does not contain a valid `tileset.json`, an error message appears in the loading overlay, and the current tileset remains loaded (the viewer does not clear the scene).

8. **E2E hooks**: The viewer exposes `window.__CESIUM_E2E__` for testing. Check `datasetKind` to verify which dataset is loaded:
   - `"sample"` — Public sample
   - `"shared"` — Loaded from `?tileset=` or `?session=`
   - `"local"` — Loaded from local folder picker
