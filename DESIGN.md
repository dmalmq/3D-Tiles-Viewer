# Cesium Editor Design System

## 1. Product Surface

RevitGeoSuite's Cesium viewer is an operational 3D/GIS editing tool. Interfaces prioritize scanning, repeated action, and low visual noise over marketing composition. The 3D view is the hero; chrome sits around it or floats over it in small, quiet cards.

## 2. Tokens

Both themes share token names. Dark is the default (`:root`); `html[data-theme="light"]` swaps the palette.

- Backgrounds: `--bg-base`, `--bg-panel`, `--bg-elevated` (floating cards, menus), `--bg-subtle` (wells, segmented controls), `--bg-hover`, `--bg-active`, `--bg-input`, `--bg-input-focus`.
- Borders: `--border`, `--border-input`, `--border-focus`.
- Accent: `--accent` (rings, underlines, selection), `--accent-strong` / `--accent-strong-hover` (filled buttons and selected pills, white text on top), `--accent-text` (accent-coloured text), `--accent-dim` (tinted backgrounds), `--on-accent`.
- Text: `--text-primary`, `--text-secondary`, `--text-muted`.
- Status: `--success`, `--danger`, `--danger-hover`, `--warning`, `--warning-dim`.
- Elevation: `--shadow-raise` (selected segment), `--shadow-float` (viewport overlays), `--shadow-dialog` (menus, dialogs), `--scrim`.
- Geometry: `--panel-width` (320px), `--header-height` (52px), `--radius-lg` (14px), `--radius` (10px), `--radius-sm` (8px).

## 3. Typography

`--font-sans` is Figtree (bundled via `@fontsource-variable/figtree`) with system and Japanese fallbacks; `--font-mono` is the system monospace stack, used for floor codes, keyboard hints and IDs. Base text is 14px with 1.4 line-height; secondary copy is 12–13px. Section headers use 12px semibold uppercase with 0.04em letter spacing.

## 4. Layout

- **Header**: logo tile · venue/building breadcrumb · Load → Author → Venue → Publish stepper · search (`/` or Ctrl/⌘+K) · backups, language, theme · Save · More menu (load session, exports) · Publish.
- **Left panel**: Add data card (button + drop hint), then tabs Scene · Layers · Network · Look & feel, then a footer with Settings.
- **Viewport overlays**: the floor picker floats bottom-right; the map-style picker floats bottom-left and stays collapsed to the current map until opened.
- Panel sections use the existing `panel-section`, `panel-section-header`, and `section-body` structure. Avoid cards inside cards.

## 5. Components

- Buttons: `primary-btn`, `secondary-btn`, `secondary-btn compact`, `icon-btn`; header buttons use `header-btn`, `header-icon-btn`, `header-primary-btn`. Menus use `header-menu` + `header-menu-item`.
- Toggles: `toggle-label`, `toggle-track`, `toggle-thumb` (36×22 switch).
- Form rows: `field-label`, `input-row`, select/input styles (36px tall), and `status-text`.
- Scene tree rows: use the existing compact row classes and inline SVG icons.
- Notifications: use `notifyUser` and the toast styles for feedback.
- Touch targets in floating chrome are at least 40px.

## 6. States

Controls need visible disabled, hover, active, and selected states. Selected pills and filled buttons use `--accent-strong` with white text; keyboard focus shows a 2px `--border-focus` outline. Error states use `--danger`; warning states use `--warning`.

## 7. Network Editor

Network controls live in their own left-panel tab. Use the existing secondary button and select patterns, avoid large explanatory copy, and expose only the essential workflow: toggle connect mode, choose passage type, see selected endpoint/status, and export authored connectors.
