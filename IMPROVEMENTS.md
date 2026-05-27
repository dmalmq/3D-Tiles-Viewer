# Improvement Recovery Plan

A phased plan to finish the May 2026 code-review improvements from the current
partial implementation. Earlier phases create the safety net and structural
foundation that later work depends on. Each phase should remain mergeable on its
own.

---

## Current status

Observed on the current branch after the first implementation pass:

- `npm run lint` passes with warnings.
- `npm test` passes.
- `npm run e2e` does **not** pass: the language-toggle smoke test clicks
  `#languageToggle`, but the header remains in English.
- The Playwright smoke suite exists, but it does not yet cover the full original
  critical paths: sample tileset render signal and session round-trip with an
  edited level name.
- `src/main.js` is still above the Phase 1 target of 3,000 lines.
- Phase 1 extraction work is started but not complete.
- Phase 2 state unification is not complete: `importedLayers[]`,
  `unassignedLayers[]`, and `building.shapefileLayers[]` still coexist.
- Phase 3 error handling is partial: `notifyUser()` exists, but silent or
  developer-only catches remain in `src/`.
- `npm audit` reports transitive advisories through `cesium` / `@cesium/engine`
  and `vite`.

Do not continue large `main.js` decomposition work until Phase 0A and Phase 0
are green.

---

## Phase 0A — Stabilize current implementation

**Goal:** make the current partially implemented safety net trustworthy before
continuing refactors.

### 0A.1 Fix language-toggle initialization

The current e2e failure suggests the app registers `#languageToggle` only after
slow async Cesium terrain setup. Header controls should be interactive before
any terrain or external-resource initialization can delay startup.

Required change:

- Initialize the language toggle and static DOM translations before awaited
  Cesium terrain setup, or move terrain setup behind a non-blocking async task.
- Preserve the current language behavior:
  - saved `localStorage.language` wins;
  - otherwise browser language decides;
  - clicking toggles `en` ↔ `ja`;
  - `#languageToggleLabel` updates after each toggle.

### 0A.2 Make Playwright smoke tests match the intended critical paths

The e2e suite should verify behavior, not only markup presence.

Required tests:

1. **Load app + sample tileset**
   - Open `/`.
   - Load `/tiles/tokyo/tileset.json` through the same UI path a user uses.
   - Confirm the tileset registers in the scene tree.
   - Confirm a render signal: canvas pixel check or a tile-load hook exposed only
     for tests.
2. **Toggle language**
   - Force `localStorage.language = "en"`.
   - Open `/`.
   - Click `#languageToggle`.
   - Assert `header.title` and `header.save` switch to Japanese.
   - Assert `localStorage.language === "ja"`.
   - Click again and assert English returns.
3. **Save/load session round-trip**
   - Load the sample tileset.
   - Edit a level name through the UI.
   - Save Session and capture the download.
   - Reload the app.
   - Load the saved session.
   - Assert the edited level name persisted.

### 0A.3 Keep stabilization behavior-scoped

Only fix initialization timing and test coverage in this phase. Do not perform
scene-tree extraction, layer-model unification, or broad error-handling rewrites
here.

**Exit criteria:** `npm run e2e` passes locally and the tests cover the three
critical paths above.

---

## Phase 0 — Safety net

**Goal:** make later refactors verifiable. No intended behavior changes beyond
the Phase 0A startup fix.

### 0.1 ESLint baseline

Status: mostly done.

Remaining work:

- Keep `eslint` + `@eslint/js` + flat config.
- Keep rules for `no-unused-vars`, `no-undef`, `no-implicit-globals`,
  `no-unused-expressions`, `eqeqeq`, `no-var`, and `prefer-const`.
- Keep `npm run lint`.
- Do not run broad autofixes in the same PR as structural refactors.
- Either leave current warnings as a documented baseline or clean them in a small
  lint-only follow-up.

### 0.2 Playwright smoke tests

Status: started, not complete. Finish this through Phase 0A.

### 0.3 Pure-module edge-case tests

Status: mostly done.

Keep coverage for:

- `contextGhosting.test.js` — entities with no matching geometry types,
  idempotent `rememberEntityContextStyle`, and originally hidden entities.
- `plateauAreaSelection.test.js` — invalid `selectionMode`, empty `detected`,
  and `fallbackSource` precedence.
- `plateauCatalog.test.js` — empty/malformed catalog inputs and dataset
  preference tie-breaking.
- `session.test.js` — schema version validation and representative round-trips.
- `sceneTreeView.test.js` — pure helper behavior until the full renderer
  extraction lands.

**Exit criteria:** `npm run lint`, `npm test`, and `npm run e2e` all pass on the
branch.

---

## Phase 1 — Decompose `main.js`

**Goal:** shrink `main.js` below 3,000 lines by extracting cohesive feature
modules. Keep this phase as mechanical as possible after Phase 0 is green.

Each sub-step should be a separate PR.

### 1.1 Finish `invalidateAndRerender()`

Status: introduced, not complete.

Required work:

- Replace remaining ad-hoc render call clusters with `invalidateAndRerender()`
  where they update the same state surface.
- Debounce with `requestAnimationFrame` so bursts coalesce.
- Keep the function responsible for:
  - `renderLevelList()`;
  - `renderPlateauFloatingCard()`;
  - `applyLevelContextVisibility()`;
  - `syncRemoveAllBtnAndLod()`.

### 1.2 Extract scene tree renderer

Status: done.

- `renderSceneTree()` accepts container, state, selection, callbacks, and optional
  DOM elements for item count, placeholder, and layer type filters.
- DOM construction moved out of `main.js` into `sceneTreeRenderer.js`.
- `main.js` remains the owner of application state and callback wiring.
- Event delegation on the scene-tree container replaces per-row `addEventListener` calls.
- Existing drag/drop, context menu, expand/collapse, selection, and layer visibility
  behavior preserved.
- `sceneTreeView.test.js` extended with pure helper tests; Playwright smoke tests
  cover DOM-level behavior.

### 1.3 Finish session boundary

Status: done.

- `SESSION_SCHEMA_VERSION` and explicit supported-version validation in place.
- Pure serialization/deserialization in `src/session.js`.
- Session restore helpers extracted: `createSessionRestorePlan`, `applySavedModelLevelOverrides`,
  `normalizeRestoredShapefileLayerData`, `normalizeRestoredUnassignedLayerData`.
- Live restore orchestration remains in `main.js` (depends on Cesium/DOM).
- Backward compatibility maintained for currently supported session versions.

### 1.4 Finish PLATEAU override boundary

Status: done.

- Override storage, feature-key extraction, style application, and `pickThroughGhosts`
  in `src/plateauOverrides.js`.
- Mutation helpers extracted: `setPlateauFeatureOverride`, `removePlateauFeatureOverride`,
  `clearPlateauFeatureOverrides`, `countPlateauOverrides`, `listPlateauOverrideEntries`.
- DOM creation remains in `main.js` (depends on scene-tree and notification refactors).
- No duplicated PLATEAU override logic in `main.js`.

### 1.5 Finish transient state grouping

Status: done.

- Short-lived async/UI coordination flags grouped in one `transient` object.
- Search state (`searchQuery`, `searchResults`, `searchSelectedIndex`, `searchOpen`)
  moved into `transient`.
- UI expansion state (`unassignedTreeExpanded`, `buildingsSectionExpanded`) moved into `transient`.
- Async coordination flags (`lodRefreshTimer`, `invalidatedRenderFrame`,
  `languageToggleInitialized`, `languageRerenderingBound`) moved into `transient`.
- Drag/popover state (`dragLayerCtx`, `lastClickedLayer`, `openPopoverCleanup`) moved into `transient`.
- Durable application state (`buildings`, `modelLevels`, `importedLayers`) remains separate.

**Exit criteria:** `main.js` is below 3,000 lines, `npm run lint`, `npm test`,
and `npm run e2e` pass, and the smoke flows show no behavior regression.

---

## Phase 2 — Unify state and tighten boundaries

**Goal:** remove parallel state pathways and stop callers reaching through module
internals.

### 2.1 Unify imported and shapefile layer state

Status: not done.

Canonical layer shape:

```js
{
  id,
  name,
  color,
  dataSource,
  features,
  source,
  levelKey,
  parent: { kind: "building", index } | { kind: "unassigned" } | { kind: "imported" }
}
```

Required work:

- Store mutable layer records in one `layers[]` collection.
- Derive building-attached, unassigned, and imported views by filtering
  `layers[]`.
- Update visibility toggles, color assignment, reassign flows, scene-tree
  rendering, and session serialization to use the canonical layer shape.
- Add a migration path for old session JSON that still contains
  `importedLayers`, `unassignedLayers`, and `building.shapefileLayers`.

### 2.2 Finish `plateauCatalog` boundary

Status: done.

- Single query surface: `listAreas()`, `findAreaByCode(code)`, `listChoicesFor(areas, options)`,
  `listCategoryChoicesFor(areas, options)`, `urlFor(dataset)`.
- Production callers use the query methods; no direct `.areaOptions` or `.datasets` access.
- Tests use query methods; raw-field assertions limited to one compatibility test.
- Malformed catalog inputs remain non-fatal: warn once and return an empty catalog.

### 2.3 Keep `contextGhosting` cache private

Status: done.

Required guardrail:

- Do not reintroduce hidden entity keys such as `_contextOriginalStyle`.
- Keep the module-private `WeakMap` and existing idempotency tests.

**Exit criteria:** one canonical layer collection, one PLATEAU catalog query
surface for production code, and no hidden context-style keys on Cesium
entities.

---

## Phase 3 — Error handling and user-visible failures

**Goal:** users see meaningful messages when workflows fail.

### 3.1 Keep `notifyUser`

Status: done.

Required guardrails:

- All user-facing copy goes through `i18nStrings.js`.
- Toasts remain transient and non-blocking.
- Keep severity values to `info`, `warn`, and `error`.

### 3.2 Replace silent or developer-only catches

Status: done.

All bare `catch {}` blocks in `src/` now have explanatory comments documenting
why the failure is intentionally ignored. Workflow-impacting failures use
`notifyUser()` with appropriate i18n keys.

### 3.3 Validate inputs at module boundaries

Status: done.

- `plateauAreaSelection.resolveAutoPlateauAreaSelection` tolerates unknown modes
  and preserves current state on typos.
- `normalizePlateauCatalog` tolerates malformed inputs and warns on non-object input.
- Session version validation is explicit and user-visible on load failure.

**Exit criteria:** no unexplained bare `catch {}` remains in `src/`, and every
workflow-impacting failure path uses `notifyUser`.

---

## Phase 4 — Dependency and polish work

**Goal:** finish small cleanup work that should not be mixed into structural
refactors.

### 4.1 Stable section-collapse keys

Status: mostly done.

Required guardrail:

- Keep collapse state keyed by stable section identity, not translated label
  text.

### 4.2 Reset `savedGlobeBaseColor`

Status: mostly done.

Required guardrail:

- Keep globe base-color restoration tied to exiting underground/level-context
  mode.
- Do not leave captured globe color in durable state.

### 4.3 Dependency audit

Status: not clean.

Current audit paths:

- `cesium -> @cesium/engine -> dompurify`
- `cesium -> @cesium/engine -> protobufjs -> @protobufjs/utf8`
- `vite -> postcss`

Required work:

- Run `npm audit`.
- Prefer safe direct dependency bumps that update transitive packages through
  normal semver.
- Do not force incompatible Cesium/Vite upgrades just to silence audit output.
- Document any remaining advisory that cannot be safely resolved.

### 4.4 Consider Prettier

Do this only after ESLint is stable. If adopted, land formatting as a single
format-only commit.

**Exit criteria:** `npm audit` is clean or documented, and polish changes are
kept separate from behavioral refactors.

---

## Sequencing notes

- Phase 0A is now the immediate blocker.
- Do not treat existing helper files as proof that the matching phase is done;
  use each phase's exit criteria.
- Phase 1 should wait for a green smoke suite.
- Phase 2.1 is easier after session serialization remains isolated.
- Phase 3 can proceed independently once Phase 0A is green.
- Phase 4 work should be small, isolated, and easy to review.

## Out of scope

- Full TypeScript migration.
- Rewriting Cesium picking or clipping math without a concrete bug.
- Mobile/responsive redesign.
- Broad formatting churn mixed with behavior changes.
