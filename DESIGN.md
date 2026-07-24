# Cesium Editor Design System

## 1. Product Surface

RevitGeoSuite's Cesium viewer is an operational 3D/GIS editing tool. Interfaces prioritize scanning, repeated action, and low visual noise over marketing composition.

## 2. Tokens

- Backgrounds: `--bg-base`, `--bg-panel`, `--bg-hover`, `--bg-active`, `--bg-input`, `--bg-input-focus`.
- Borders: `--border`, `--border-input`, `--border-focus`.
- Accent: `--accent`, `--accent-hover`, `--accent-dim`.
- Text: `--text-primary`, `--text-secondary`, `--text-muted`.
- Status: `--danger`, `--danger-hover`, `--warning`.
- Geometry: `--panel-width`, `--header-height`, `--radius`, `--radius-sm`.

## 3. Typography

Use the app root font stack: `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Inter`, `sans-serif`. Base text is 13px with 1.4 line-height. Panel headers use 11px uppercase text with 0.06em letter spacing.

## 4. Layout

Keep the editor dense and panel-led. The Cesium viewport remains full bleed; controls live in the fixed header, left panel, popovers, dialogs, or toasts. Panel sections use existing `panel-section`, `panel-section-header`, and `section-body` structure. Avoid cards inside cards.

## 5. Components

- Buttons: use `primary-btn`, `secondary-btn`, `secondary-btn compact`, and `icon-btn`.
- Toggles: use `toggle-label`, `toggle-track`, and `toggle-thumb`.
- Form rows: use `field-label`, `input-row`, select/input styles, and `status-text`.
- Scene tree rows: use the existing compact row classes and inline SVG icons.
- Notifications: use `notifyUser` and the toast styles for feedback.

## 6. States

Controls need visible disabled, hover, active, and selected states using the existing accent and muted text tokens. Error states use `--danger`; warning states use `--warning`.

## 7. Network Editor Additions

Network controls must stay compact in the Scene tab. Use the existing secondary button and select patterns, avoid large explanatory copy, and expose only the essential workflow: toggle connect mode, choose passage type, see selected endpoint/status, and export authored connectors.
