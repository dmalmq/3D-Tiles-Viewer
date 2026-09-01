---
name: verify-3d-tiles-viewer
---

# Verify 3D Tiles Viewer

This skill provides a verification harness for **Daniel Malmqvist's 3D Tiles Viewer**, a CesiumJS-based web application for authoring, reviewing, and publishing 3D Tiles datasets. Use this skill when you need to:

- **Prove that code changes work** by driving the real app and capturing screenshots/videos
- **Test user-facing features** in the authoring interface (`index.html`) or read-only viewer (`viewer.html`)
- **Verify UI changes** like language switching, theme toggling, or tileset loading
- **Close the loop** on feature work by demonstrating the end-to-end user experience

This skill wraps the existing Playwright test harness into an agent-friendly CLI (`control-3d-tiles-viewer.mjs`) with composable subcommands for health checks, navigation, interaction, and evidence capture.

## Launch

Start the development server (Vite + Express):

```bash
npm run dev
```

This spawns two processes:
- **Vite dev server** on `http://localhost:5173` (frontend)
- **Express API** on `http://localhost:3001` (backend for publishing, SSE package ingestion)

**Ready when**: `http://localhost:5173/` returns HTTP 200. The page loads `index.html` (authoring interface) by default.

**Teardown**: Kill both processes. The CLI provides a `cleanup` command (see below).

## Doctor

Check if the app is healthy and ready for verification:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs doctor
```

**What it checks**:
- Vite dev server responds on port 5173
- Express API responds on port 3001
- Both return successful HTTP status codes

**Output** (human-readable by default, `--json` for machine-readable):

```
Health Check:
  ✓ Vite dev server: HTTP 200
  ✓ Express API: HTTP 200

Overall: HEALTHY
```

Exit code `0` if healthy, `1` if unhealthy.

## Drive

### Load the Sample Tileset (Authoring Mode)

The app ships with a public sample tileset at `/tiles/sample-indoor/tileset.json`. Load it in the authoring interface:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs load-sample
```

**What it does**:
1. Opens `http://localhost:5173/` (authoring interface)
2. Clicks the **"+ Add Data"** button (`#addDataBtn`)
3. Selects **"Tileset URL…"** from the menu (`[data-action="add-url"]`)
4. Fills the URL input (`#urlInput`) with `/tiles/sample-indoor/tileset.json`
5. Clicks **Load** (`#loadUrlBtn`)
6. Waits for the building row (`.bldg-row .bldg-name`) to appear
7. Waits for `window.__CESIUM_E2E__.tileLoadCount > 0` (tiles rendered)

**Flags**:
- `--keep-open`: Leave the browser open after loading
- `--json`: Output JSON instead of human-readable text

**Observable end state**: A building named "sample-indoor" appears in the left panel's scene tree, and the Cesium viewport renders 3D tiles.

### Load the Viewer Sample

Open the read-only viewer page with the public synthetic sample:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs load-viewer-sample
```

**What it does**:
1. Opens `http://localhost:5173/viewer.html`
2. Waits for the viewer header (`#appHeader`)
3. Waits for the building selector to populate (`#viewerBuildingSelect option:nth-child(2)`)

**Observable end state**: The viewer displays "Sample House" in the building selector and renders the synthetic indoor tileset.

### Switch Language

Toggle between English and Japanese:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs switch-language
```

**What it does**:
1. Opens the authoring interface
2. Clicks the language toggle button (`#languageToggle`)
3. Reads `localStorage.language` before and after

**Observable end state**: UI text switches between English and Japanese (e.g., "3D Tiles Viewer" ↔ "3D タイルビューア").

### Switch Theme

Toggle between light and dark mode:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs switch-theme
```

**What it does**:
1. Opens the authoring interface
2. Clicks the theme toggle button (`#themeToggle`)
3. Reads `localStorage.theme` before and after

**Observable end state**: The app switches between dark and light themes (background, text, and UI elements change color).

### Click a Selector

Click any element by CSS selector:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs click-selector \
  --selector '#addDataBtn' \
  --wait-ms 500 \
  --keep-open
```

**Flags**:
- `--selector <css>`: CSS selector to click (required)
- `--url <url>`: Page URL (default: `http://localhost:5173/`)
- `--wait-ms <ms>`: Wait after clicking (default: none)
- `--keep-open`: Leave browser open

### Wait for a Selector

Wait for an element to appear:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs wait-for \
  --selector '.bldg-row' \
  --timeout 10000
```

**Flags**:
- `--selector <css>`: CSS selector to wait for (required)
- `--timeout <ms>`: Timeout in milliseconds (default: 10000)

## Evidence

### Capture Screenshots

Take a screenshot of the current page:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs screenshot \
  --output evidence/my-feature.png \
  --wait-ms 2000
```

**Flags**:
- `--output <path>`: Output path (default: `.cursor/skills/verify-3d-tiles-viewer/evidence/screenshot-<timestamp>.png`)
- `--selector <css>`: Screenshot only this element (default: full page)
- `--full-page`: Capture full scrollable page (default: viewport only)
- `--wait-ms <ms>`: Wait before capturing (for animations to settle)
- `--url <url>`: Page URL (default: `http://localhost:5173/`)

**Evidence location**: All screenshots default to `.cursor/skills/verify-3d-tiles-viewer/evidence/`.

### Record Video

Record a video of interactions:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs video \
  --output evidence/my-feature-demo.webm \
  --duration 10000
```

**Flags**:
- `--output <path>`: Output path (default: `.cursor/skills/verify-3d-tiles-viewer/evidence/video-<timestamp>.webm`)
- `--duration <ms>`: Recording duration in milliseconds (default: 10000)
- `--url <url>`: Page URL (default: `http://localhost:5173/`)

**Evidence location**: Videos are saved to `.cursor/skills/verify-3d-tiles-viewer/evidence/` and survive cleanup.

### Get App State

Inspect the current app state as JSON:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs info --json
```

**Output** (JSON):

```json
{
  "url": "http://localhost:5173/",
  "title": "3D Tiles Viewer",
  "headerVisible": true,
  "leftPanelVisible": true,
  "cesiumContainerVisible": true,
  "buildingCount": 1,
  "language": "en",
  "theme": "dark"
}
```

Use this to verify state changes programmatically.

## Cleanup

Tear down dev server processes:

```bash
# Dry run (preview what would be killed)
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs cleanup --dry-run

# Actually kill processes
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs cleanup
```

**What it does**:
- Finds processes matching `node server/dev.js`, `node server/index.js`, or `vite`
- Kills them by PID (not by name, so it only kills processes from this workspace)
- **Never kills browsers** (Playwright handles that)
- **Never deletes evidence** (screenshots and videos persist)

**Dry run**: Always use `--dry-run` first to preview what will be killed.

## Helpers

### Composable Commands

Chain commands for multi-step verification:

```bash
# Load sample, wait for tiles, then screenshot
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs load-sample && \
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs screenshot \
  --output evidence/sample-loaded.png \
  --wait-ms 3000
```

### JSON Output

All commands support `--json` for machine-readable output. Parse with `jq`:

```bash
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs doctor --json | jq '.healthy'
```

### Environment Variables

Override the base URL if the app runs on a different port:

```bash
BASE_URL=http://localhost:8080 \
./.cursor/skills/verify-3d-tiles-viewer/control-3d-tiles-viewer.mjs doctor
```

### Feature Map

See [`features/README.md`](./features/README.md) for a map of user-facing features and how to drive them.

## Gotchas

1. **Cesium tile loading is async**: Always wait for `window.__CESIUM_E2E__.tileLoadCount > 0` or use the `load-sample` command, which handles this.

2. **Port conflicts**: If ports 5173 or 3001 are in use, `npm run dev` will fail. Use `cleanup` to kill stale processes, or change ports in `server/dev.js` and `playwright.config.js`.

3. **Headless vs. headed**: Most commands run headless for speed. Use `--keep-open` for debugging (opens a real browser).

4. **Evidence survives cleanup**: Screenshots and videos in `.cursor/skills/verify-3d-tiles-viewer/evidence/` are never deleted. Commit them to the repo or attach them to PRs as proof.

5. **tmux sessions**: If you launched the dev server in a tmux session (e.g., `dev-server`), remember to kill it manually or use the `cleanup` command.

6. **File System Access API**: The app uses the File System Access API for local folder loading. This requires a user gesture in a real browser and won't work in headless mode for folder selection (but the viewer's `?tileset=` query param works).
