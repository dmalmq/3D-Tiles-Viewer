# Feature: Tileset Loading

Load 3D Tiles datasets from various sources: URL, local folder, or persistent File System Access handle.

## Sub-features

1. **Load from URL**: Paste a tileset URL and load it into the scene
2. **Load from folder**: Use the directory picker to load a local tileset
3. **File System Access handle**: Re-open a previously picked folder without re-selecting it
4. **Revit link splitting**: Detect and split multi-link Revit tilesets into per-building layers

## How to get to it (user POV)

### Load from URL

1. Open the authoring interface (`http://localhost:5173/`)
2. Click **"+ Add Data"** (left panel, top action bar)
3. Select **"Tileset URL…"** from the dropdown menu
4. A popover appears with a text input
5. Paste a tileset URL (e.g., `/tiles/sample-indoor/tileset.json`)
6. Click **"Load"**
7. The tileset appears in the left panel's scene tree as a building row (`.bldg-row`)
8. The Cesium viewport renders the 3D tiles

### Load from folder

1. Open the authoring interface
2. Click **"+ Add Data"**
3. Select **"Tileset folder…"** from the dropdown
4. The browser's directory picker opens
5. Select a folder containing a `tileset.json` file
6. The tileset loads and appears in the scene tree

## Driving it with Playwright/CLI

### CLI Command: Load Sample Tileset

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs load-sample
```

This command automates the "Load from URL" flow for the public sample tileset.

### Playwright Recipe

```javascript
// 1. Open the authoring interface
await page.goto('http://localhost:5173/');
await page.waitForSelector('#appHeader', { timeout: 10000 });

// 2. Click "+ Add Data"
await page.locator('#addDataBtn').click();
await page.waitForSelector('#leftAddDataMenu', { state: 'visible' });

// 3. Select "Tileset URL…"
await page.locator('#leftAddDataMenu [data-action="add-url"]').click();

// 4. Wait for the URL popover
await page.waitForSelector('#urlLoadPopover', { state: 'visible' });

// 5. Fill the URL input
await page.locator('#urlInput').fill('/tiles/sample-indoor/tileset.json');

// 6. Click "Load"
await page.locator('#loadUrlBtn').click();

// 7. Wait for the building row to appear
await page.waitForSelector('.bldg-row .bldg-name', { timeout: 45000 });

// 8. Wait for tiles to render (uses e2e hooks)
await page.waitForFunction(() => {
  const hook = window.__CESIUM_E2E__;
  return !!hook && ((hook.tileLoadCount ?? 0) > 0 || (hook.allTilesLoadedCount ?? 0) > 0);
}, null, { timeout: 60000 });
```

### Key Selectors

- `#addDataBtn` — "Add Data" button
- `#leftAddDataMenu` — Dropdown menu with data source options
- `[data-action="add-url"]` — "Tileset URL…" menu item
- `#urlLoadPopover` — URL input popover
- `#urlInput` — Tileset URL text input
- `#loadUrlBtn` — "Load" button
- `.bldg-row` — Building row in the scene tree
- `.bldg-name` — Building name text (e.g., "sample-indoor")

### Observable End State

- **DOM**: A `.bldg-row` element appears with the building name
- **Cesium**: 3D tiles render in the viewport (check `window.__CESIUM_E2E__.tileLoadCount > 0`)
- **Scene tree**: The building has a `+` expand icon and can be clicked to reveal floors

## Gotchas

1. **Async tile loading**: CesiumJS loads tiles asynchronously. Always wait for `window.__CESIUM_E2E__.tileLoadCount > 0` or the building row to appear. Don't assume the tileset is ready just because the HTTP request succeeded.

2. **Revit link splitting**: If the tileset contains multiple Revit links, a modal dialog appears asking whether to split or merge. The dialog has `#splitConfirmDialog`, `#splitConfirmBtn` (split), and `#splitMergeBtn` (keep merged). Wait for this dialog if you expect Revit links.

3. **Invalid URLs**: If the URL is invalid or the tileset fails to load, an error message appears in `#fileStatus` (below the scene tree). Check this element for failure messages.

4. **Port conflicts**: The sample tileset is served from the Vite dev server, so it must be running on port 5173. If the port is unavailable, the load will fail with a network error.

5. **Relative vs. absolute URLs**: The app resolves relative URLs (e.g., `/tiles/sample-indoor/tileset.json`) against the Vite dev server. Absolute URLs (e.g., `https://example.com/tileset.json`) are fetched directly. CORS must be configured for external tilesets.

6. **Folder picker headless mode**: The directory picker (`<input webkitdirectory>`) requires a user gesture and won't work in headless Playwright. Use `setInputFiles()` to simulate folder selection in tests, or run headed (`headless: false`).

7. **File System Access API**: If the user grants persistent permission to a folder, the app can re-open it without re-prompting. This is stored in IndexedDB and survives page reloads, but not across different browsers or private mode sessions.
