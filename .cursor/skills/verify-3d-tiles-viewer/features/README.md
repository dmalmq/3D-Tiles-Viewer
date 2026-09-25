# Feature Map: 3D Tiles Viewer

This directory maps user-facing features of the 3D Tiles Viewer to verification recipes. Each file describes:

- **Sub-features**: Discrete capabilities within the feature
- **How to get to it (user POV)**: The user path from app launch
- **Driving it with Playwright/CLI**: Specific selectors, commands, and wait conditions
- **Gotchas**: Edge cases, timing issues, and common pitfalls

## Top Features

1. **[Tileset Loading](./tileset-loading.md)** — Load 3D Tiles from URL, folder, or persistent handle
2. **[Language and Theme Switching](./language-theme.md)** — Toggle between English/Japanese and light/dark mode
3. **[Viewer Mode](./viewer-mode.md)** — Read-only viewer for published tilesets
4. **[Floor Management](./floor-management.md)** — Assign floors, add levels, and enable clipping planes
5. **[Venue Management](./venue-management.md)** — Create, edit, and publish venue groups

## How to Use

1. **Read the feature file** to understand the user path and selectors
2. **Use the CLI** to drive the feature programmatically:
   - `control-3d-tiles-viewer.mjs load-sample` for tileset loading
   - `control-3d-tiles-viewer.mjs switch-language` for language switching
   - `control-3d-tiles-viewer.mjs screenshot` to capture evidence
3. **Verify the end state** by inspecting DOM, localStorage, or visual evidence
4. **Capture proof** (screenshots/videos) for PRs

## Coverage

These features represent the most common user workflows. For specialized features (PLATEAU catalog, GDB import, indoor network authoring), refer to the Playwright tests in `test-e2e/` or extend the CLI with new subcommands.
