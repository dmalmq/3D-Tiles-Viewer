# Improvement Plan

A phased plan to address findings from the May 2026 code review. Phases are ordered so that earlier work creates the safety net and structural foundation that later work depends on. Each phase should be mergeable on its own.

---

## Phase 0 — Safety net (prerequisite)

**Goal:** make the later refactors verifiable. No behavior changes.

Without this, every change to `main.js` is a leap of faith. Land this first.

### 0.1 Add ESLint with a minimal config
- Add `eslint` + `@eslint/js` as devDependencies; flat config in `eslint.config.js`.
- Rules to start: `no-unused-vars`, `no-undef`, `no-implicit-globals`, `no-unused-expressions`, `eqeqeq`, `no-var`, `prefer-const`.
- Add `npm run lint` script. Do **not** auto-fix the codebase in this PR — surface the warnings, then clean up in a follow-up.
- Optional: pre-commit hook via `simple-git-hooks` or document running locally.

### 0.2 Add Playwright smoke tests
Playwright is already in `devDependencies`. Add 3 critical-path tests:
1. **Load app + sample tileset** — open `/`, click sample tileset, confirm a tileset renders (canvas pixel check or wait for `tileset.tileLoad` event via exposed hook).
2. **Toggle language** — switch EN→JA, confirm a known header label changes.
3. **Save / load session round-trip** — load sample tileset, edit a level name, Save Session (download), reload, Load Session (upload), assert level name persisted.

Add `npm run e2e` script. Run in CI if/when CI is added.

### 0.3 Edge-case tests for new pure modules
Quick wins. Add to existing test files:
- `contextGhosting.test.js` — entity with no matching geometry types; double-call to `rememberEntityContextStyle`; falsy original-visibility.
- `plateauAreaSelection.test.js` — invalid `selectionMode` string; empty `detected`; `fallbackSource` precedence.
- `plateauCatalog.test.js` — empty catalog; malformed dataset entries; tie-breaking in `comparePlateauDatasetPreference`.

**Exit criteria:** `npm run lint`, `npm test`, `npm run e2e` all pass on master.

---

## Phase 1 — Decompose `main.js`

**Goal:** shrink `main.js` from ~5,300 lines to ~2,500 by extracting cohesive feature modules. Pure mechanical moves, no logic change.

Each sub-step is a separate PR.

### 1.1 Introduce `invalidateAndRerender()`
Single function in `main.js` that calls `renderLevelList()`, `renderPlateauFloatingCard()`, `applyLevelContextVisibility()`, and `syncRemoveAllBtnAndLod()`. Replace the 6+ ad-hoc trios. Debounce with `requestAnimationFrame` to coalesce bursts. Land this first — it makes the next extractions safer.

### 1.2 Extract scene tree view → `src/sceneTreeView.js`
Move `renderLevelList()` and its helpers (~250 lines, currently `main.js:2562+`). Export `renderSceneTree({ buildings, importedLayers, modelLevels, selection, callbacks })`. Use event delegation on the tree container instead of per-element `addEventListener` inside `createElement` loops — fixes the listener-leak smell and shrinks the function.

### 1.3 Extract session save/load → `src/session.js`
Move `main.js:4543–4750` to `src/session.js`. Export `saveSession(state)` and `loadSession(json)`. Define an explicit `SESSION_SCHEMA_VERSION` constant and a per-building round-trip serializer/deserializer so adding a new building field is a one-line change in one file. Cover with a unit test that round-trips a representative state.

### 1.4 Extract PLATEAU overrides → `src/plateauOverrides.js`
Move `main.js:893–1256` (override storage, `applyPlateauLayerStyle`, `pickThroughGhosts`, `renderPlateauFloatingCard` minus its DOM creation). Keep DOM creation in `main.js` for now and pass it pure data — the goal here is to extract the *logic*, not all the UI.

### 1.5 Wrap transient module-scope flags
Replace `_shpColorIdx`, `_shpPendingTarget`, `_gdbBusy`, `_reloadTargetIndex`, `savedGlobeBaseColor`, search state, etc. with a single `const transient = { ... }` object at the top of `main.js`. Makes lifecycle visible at a glance and prepares for future testing.

**Exit criteria:** `main.js` under 3,000 lines. Smoke tests still green. No behavior diff (verify by running through the smoke tests manually as well).

---

## Phase 2 — Unify state & tighten boundaries

**Goal:** remove parallel state pathways and stop callers reaching into module internals.

### 2.1 Unify `importedLayers[]` and `building.shapefileLayers[]`
Today they diverge in shape (`levelKey` only on the latter). Pick one canonical shape:

```js
{ id, name, color, dataSource, features, source, levelKey?, parent: { kind: "building" | "unassigned", index? } }
```

Store all layers in a single `layers[]` and derive per-building / unassigned views with a filter. Collapses rendering, visibility toggles, color assignment, and reassign code to one path. Session save/load (now in `src/session.js` from Phase 1) needs a migration for old session JSON.

### 2.2 Tighten `plateauCatalog` boundary
Wrap the normalized catalog in a small object:

```js
class PlateauCatalog {
  listAreas() { ... }
  listChoicesFor(areas, options) { ... }
  listCategoryChoicesFor(areas, options) { ... }
  urlFor(dataset) { ... }
}
```

`importDataModal.js` stops reaching into `.areaOptions` / raw `datasets`. Future API shape changes become a one-file diff. Add basic shape validation in `normalizePlateauCatalog` — log once, don't crash.

### 2.3 Move `contextGhosting` cache to a `WeakMap`
Replace `entity._contextOriginalStyle = ...` with a module-private `WeakMap<entity, originalStyle>`. Removes the hidden-key smell and the leak risk when entities are destroyed. Existing tests should cover this with minimal change.

**Exit criteria:** one `layers[]` array, one `PlateauCatalog` query surface, no hidden keys on Cesium entities.

---

## Phase 3 — Error handling & user-visible failures

**Goal:** users see meaningful messages when things break.

### 3.1 Add a `notifyUser` helper
Small module `src/notifications.js` exporting `notifyUser(severity, key, params)` where `severity ∈ {info, warn, error}` and `key` is an i18n key. Renders a transient toast in the bottom-right (or wherever fits the existing UI). All copy goes through `i18nStrings.js`.

### 3.2 Replace silent catches
Walk the 15+ `try { ... } catch (e) { console.warn(...) }` sites in `main.js` and route each to `notifyUser` with an appropriate i18n key. The bare `} catch {}` at `main.js:1873` gets a key too — even "could not load level metadata" is better than nothing. Keep `console.warn` for developers; add user-visible toasts on top.

### 3.3 Add input validation at module boundaries
- `plateauAreaSelection.resolveAutoPlateauAreaSelection` — guard against typo'd `selectionMode`, log a warning and fall back to manual.
- `normalizePlateauCatalog` — validate `data.datasets` is iterable; return empty catalog with a warning if not.
- `loadSession` — validate `SESSION_SCHEMA_VERSION`; surface a clear error if the JSON is from a future or incompatible version.

**Exit criteria:** no `} catch {}` in `src/`. Every user-facing failure path goes through `notifyUser`.

---

## Phase 4 — Polish

**Goal:** small fixes that don't fit anywhere else.

### 4.1 Stable section-collapse IDs
Section-collapse keys currently depend on translated title text (`section:<title>:collapsed`). Reword a label in `i18nStrings.js` and remembered state resets. Move to `data-section-id="building-list"` style attributes; key on the data attribute.

### 4.2 Reset `savedGlobeBaseColor` on unload
Or move into the `transient` object from 1.5 and clear it when the underground/level-context mode exits.

### 4.3 Bump aging deps
- `leaflet` is on `^1.9.4` (released 2023). Check for security advisories; if clean, leave for now.
- Re-audit `cesium`, `vite`, `gdal3.js` quarterly.

### 4.4 Consider Prettier
After ESLint settles. Single `npm run format` to stop bike-shedding. Run once across the codebase as a single noisy commit.

**Exit criteria:** none specific — this phase is opportunistic.

---

## Sequencing notes

- **Don't skip Phase 0.** The biggest risk in this plan is silent regressions during the `main.js` decomposition. Smoke tests + lint are cheap insurance.
- **Phases 1 and 2 are mostly independent** but 2.1 (unify layer arrays) is much easier *after* 1.3 (session extracted), because the migration is a one-file change.
- **Phase 3 is independent of Phase 1/2** and could be done in parallel by a second hand if it ever happens.
- **Phase 4 can be drizzled in** between other PRs.

## Out of scope

- Full TypeScript migration. Worth its own conversation, not bundled here.
- Rewriting the Cesium picking / clipping math. It works; leave it alone unless a bug surfaces.
- Mobile/responsive layout. Current design is desktop-first and the user hasn't asked.
