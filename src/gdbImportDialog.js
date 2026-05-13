// Multi-building GDB import review dialog.
//
// Lifecycle:
//   openGdbImportDialog({ featureCollections, buildings, onImport })
//   - Auto-matches each FeatureCollection to a (buildingIndex, levelKey).
//   - Renders a table the user can review and edit.
//   - Bulk-action bar: assign building / assign floor / mark skip for all
//     selected rows.
//   - On Import: invokes onImport(assignments) where assignments is an array
//     of { fc, target } — target is one of:
//         { kind: "skip" }
//         { kind: "unassigned" }
//         { kind: "building", buildingIndex, levelKey }
//
// The dialog itself does not touch the viewer or the buildings array; the
// caller (main.js) does that in onImport.

import { Cartographic, Math as CesiumMath } from 'cesium';
import { t } from './i18n.js';
import {
  matchLayerToTarget,
  summarizeGeometry,
  buildLevelsByPrefix,
  isLevelFeatureClass,
  detectLayerLevelRef,
  matchLevelRefToBuildingLevel,
  matchLevelByText,
  groupFeaturesByFloor,
} from './gdbAutoMatch.js';

const TARGET_SKIP = '__skip__';
const TARGET_UNASSIGNED = '__unassigned__';
const FLOOR_ALL = '__all__';

// Project each building's ECEF bounding sphere to a flat lon/lat disk used
// by matchLayerSpatial. Prefers the per-building refinement `_boundingSphere`
// (set by computePerSiblingBoundingSpheres when a single tileset has been
// split into multiple Revit-link siblings — without this, every sibling
// would share the same tileset.boundingSphere and the disks would be
// indistinguishable). Falls back to tileset.boundingSphere for standalone
// tilesets that haven't been split. Returns an array parallel to buildings[]
// of { lon, lat, dLon, dLat } | null entries (degrees).
function buildBuildingFootprintsForDialog(buildings) {
  return (buildings ?? []).map((b) => {
    const sphere = b?._boundingSphere ?? b?.tileset?.boundingSphere;
    if (!sphere?.center) return null;
    const radius = Number(sphere.radius);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    const carto = Cartographic.fromCartesian(sphere.center);
    if (!carto) return null;
    const lat = CesiumMath.toDegrees(carto.latitude);
    const lon = CesiumMath.toDegrees(carto.longitude);
    const dLat = radius / 111000;
    const dLon = radius / (111000 * Math.max(0.01, Math.cos(carto.latitude)));
    return { lon, lat, dLon, dLat };
  });
}

export function openGdbImportDialog({ featureCollections, buildings, onImport, mode = 'import' }) {
  // -- State --
  // Pre-compute the per-prefix level lookup (from "*_level" FCs in the GDB).
  const levelsByPrefix = buildLevelsByPrefix(featureCollections);

  // Pre-compute each building's projected lon/lat disk for spatial matching.
  // Slot `i` is parallel to `buildings[i]`; null when no usable sphere is
  // available (tileset not loaded, missing, etc.).
  const buildingFootprints = buildBuildingFootprintsForDialog(buildings);

  // Live filter text (case-insensitive substring match against filename).
  let filterText = '';

  // assignments[i] = {
  //   fc,
  //   buildingValue,      TARGET_SKIP | TARGET_UNASSIGNED | string(buildingIndex)
  //   levelValue,         FLOOR_ALL | string(levelKey)
  //   confidence,         "high" | "medium" | "none"
  //   selected,           bulk multi-select state
  //   buildingManual,     user has manually changed the per-row building dropdown
  //   floorManual,        user has manually changed the per-row floor dropdown
  //   floorResolved,      a real floor (not FLOOR_ALL) was assigned by auto-match
  //                       or manual pick — drives the "unresolved floor" warning
  //   levelRef,           { ordinal, name } | null — from sibling "*_level" FC
  //   subRows,            undefined | Array<SubRow> — present when this FC's
  //                       features carry per-feature `floor` values spanning
  //                       multiple floors. On Import, the parent expands into
  //                       one decision per sub-row, each with a filtered
  //                       feature subset and the sub-row's own building/level.
  // }
  // SubRow = {
  //   floorValue, key, count,
  //   buildingValue, levelValue, confidence, floorResolved,
  //   buildingManual, floorManual,
  // }
  const assignments = featureCollections.map((fc) => {
    // Reassign mode: every fc carries its current home; skip auto-match entirely.
    if (mode === 'reassign' && fc._existingEntry) {
      const parent = fc._existingEntry.parent;
      const layer = fc._existingEntry.layer;
      let buildingValue;
      let levelValue;
      if (parent.kind === 'unassigned') {
        buildingValue = TARGET_UNASSIGNED;
        levelValue = FLOOR_ALL;
      } else {
        buildingValue = String(parent.buildingIndex);
        levelValue = layer.levelKey != null ? String(layer.levelKey) : FLOOR_ALL;
      }
      return {
        fc,
        buildingValue,
        levelValue,
        confidence: 'high',
        selected: false,
        buildingManual: false,
        floorManual: false,
        floorResolved: levelValue !== FLOOR_ALL,
        levelRef: detectLayerLevelRef(fc?.fileName, levelsByPrefix),
      };
    }

    const isLevelFc = isLevelFeatureClass(fc?.fileName);
    const m = matchLayerToTarget({
      filename: fc.fileName,
      features: fc.features ?? [],
      buildings,
      footprints: buildingFootprints,
    });
    let buildingValue;
    let levelValue;
    if (isLevelFc) {
      // "*_level" feature classes are metadata, not renderable geometry.
      buildingValue = TARGET_SKIP;
      levelValue = FLOOR_ALL;
    } else if (m.buildingIndex >= 0) {
      buildingValue = String(m.buildingIndex);
      levelValue = m.levelKey != null ? String(m.levelKey) : FLOOR_ALL;
    } else {
      // Keep the default import strict: layers that do not match an exported
      // 3D Tiles building are skipped unless the user manually assigns them.
      buildingValue = TARGET_SKIP;
      levelValue = FLOOR_ALL;
    }
    const subRows = isLevelFc ? null : buildSubRows(fc, buildingValue);
    // When sub-rows take over per-feature floor selection, the parent's own
    // levelValue/floorResolved are unused (replaced by a read-only badge).
    if (subRows) {
      levelValue = FLOOR_ALL;
    }
    return {
      fc,
      buildingValue,
      levelValue,
      confidence: isLevelFc ? 'none' : m.confidence,
      selected: false,
      buildingManual: false,
      floorManual: false,
      floorResolved: !isLevelFc && !subRows && m.buildingIndex >= 0 && m.levelKey != null,
      levelRef: isLevelFc ? null : detectLayerLevelRef(fc?.fileName, levelsByPrefix),
      subRows,
    };
  });

  // Pre-fill the floor from the GDB's own level metadata wherever a building
  // is already chosen by the initial auto-match. This runs before the table
  // is rendered, so the user sees the GDB-driven floor selection right away.
  // Skip rows that have sub-rows — they have their own per-floor resolution.
  for (const a of assignments) {
    if (!a.subRows) resolveFloorFromOrdinal(a);
  }

  // -- Overlay + modal --
  const overlay = document.createElement('div');
  overlay.id = 'gdbImportOverlay';

  const modal = document.createElement('div');
  modal.id = 'gdbImportModal';
  overlay.appendChild(modal);

  // Header
  const header = document.createElement('div');
  header.className = 'gdb-import-header';
  const title = document.createElement('span');
  title.className = 'gdb-import-title';
  title.textContent = t(mode === 'reassign' ? 'gdb.dialog.reassignTitle' : 'gdb.dialog.title');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'gdb-import-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('modal.close');
  closeBtn.addEventListener('click', closeDialog);
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'gdb-import-subtitle';
  subtitle.textContent = t('gdb.dialog.subtitle', { count: assignments.length });
  modal.appendChild(subtitle);

  // Filter row — substring filter on filename; affects which rows render and
  // which rows participate in Select-all. Per-row `selected` state is NOT
  // cleared by hiding, so bulk actions still operate on hidden-but-checked rows.
  const filterRow = document.createElement('div');
  filterRow.className = 'gdb-import-filter';
  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.placeholder = t('gdb.dialog.filter.placeholder');
  filterInput.addEventListener('input', () => {
    filterText = filterInput.value.trim().toLowerCase();
    renderRows();
  });
  filterRow.appendChild(filterInput);
  modal.appendChild(filterRow);

  // Bulk-action bar
  const bulkBar = document.createElement('div');
  bulkBar.className = 'gdb-import-bulkbar';

  const selectAllLabel = document.createElement('label');
  selectAllLabel.className = 'gdb-import-bulk-selall';
  const selectAllCb = document.createElement('input');
  selectAllCb.type = 'checkbox';
  selectAllCb.addEventListener('change', () => {
    // Only toggle rows currently visible under the active filter.
    for (const a of assignments) {
      if (!isVisible(a)) continue;
      a.selected = selectAllCb.checked;
    }
    renderRows();
  });

  // Note: renderRows() rebuilds the bulk-floor select at its tail, so any code
  // path that re-renders also refreshes the bulk-floor option list against the
  // current selection.
  selectAllLabel.appendChild(selectAllCb);
  selectAllLabel.appendChild(document.createTextNode(' ' + t('gdb.dialog.bulk.selectAll')));
  bulkBar.appendChild(selectAllLabel);

  const bulkBuildingLabel = document.createElement('label');
  bulkBuildingLabel.className = 'gdb-import-bulk-field';
  bulkBuildingLabel.appendChild(document.createTextNode(t('gdb.dialog.bulk.applyBuilding') + ': '));
  const bulkBuildingSel = buildBuildingSelect();
  bulkBuildingSel.addEventListener('change', () => {
    const v = bulkBuildingSel.value;
    if (!v) return;
    for (const a of assignments) {
      if (!a.selected) continue;
      a.buildingValue = v;
      a.buildingManual = true;
      a.levelValue = FLOOR_ALL;
      a.floorManual = false;
      a.floorResolved = false;
      resolveFloorFromOrdinal(a);
    }
    bulkBuildingSel.value = '';
    rebuildBulkFloorSelect();
    renderRows();
  });
  bulkBuildingLabel.appendChild(bulkBuildingSel);
  bulkBar.appendChild(bulkBuildingLabel);

  const bulkFloorLabel = document.createElement('label');
  bulkFloorLabel.className = 'gdb-import-bulk-field';
  bulkFloorLabel.appendChild(document.createTextNode(t('gdb.dialog.bulk.applyFloor') + ': '));
  let bulkFloorSel = document.createElement('select');
  bulkFloorLabel.appendChild(bulkFloorSel);
  bulkBar.appendChild(bulkFloorLabel);
  rebuildBulkFloorSelect();

  const bulkSkipBtn = document.createElement('button');
  bulkSkipBtn.className = 'secondary-btn compact';
  bulkSkipBtn.type = 'button';
  bulkSkipBtn.textContent = t('gdb.dialog.bulk.markSkip');
  bulkSkipBtn.addEventListener('click', () => {
    for (const a of assignments) {
      if (a.selected) {
        a.buildingValue = TARGET_SKIP;
        a.buildingManual = true;
        a.levelValue = FLOOR_ALL;
        a.floorResolved = false;
      }
    }
    renderRows();
  });
  bulkBar.appendChild(bulkSkipBtn);

  modal.appendChild(bulkBar);

  // Table
  const tableWrap = document.createElement('div');
  tableWrap.className = 'gdb-import-table-wrap';
  const table = document.createElement('table');
  table.className = 'gdb-import-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th class="gdb-col-check"></th>
      <th class="gdb-col-layer">${t('gdb.dialog.col.layer')}</th>
      <th class="gdb-col-match">${t('gdb.dialog.col.match')}</th>
      <th class="gdb-col-building">${t('gdb.dialog.col.building')}</th>
      <th class="gdb-col-floor">${t('gdb.dialog.col.floor')}</th>
    </tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  modal.appendChild(tableWrap);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'gdb-import-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'secondary-btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = t('gdb.dialog.cancel');
  cancelBtn.addEventListener('click', closeDialog);
  const importBtn = document.createElement('button');
  importBtn.className = 'secondary-btn primary-btn';
  importBtn.type = 'button';
  importBtn.textContent = t(mode === 'reassign' ? 'gdb.dialog.apply' : 'gdb.dialog.import');
  importBtn.addEventListener('click', handleImport);
  footer.appendChild(cancelBtn);
  footer.appendChild(importBtn);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  renderRows();

  // -- Helpers --

  function buildBuildingSelect(initialValue) {
    const sel = document.createElement('select');
    // Empty option as a "no-op" for the bulk picker.
    if (initialValue === undefined) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = t('gdb.dialog.option.choose');
      sel.appendChild(empty);
    }
    const optUn = document.createElement('option');
    optUn.value = TARGET_UNASSIGNED;
    optUn.textContent = t('gdb.dialog.option.unassigned');
    sel.appendChild(optUn);
    const optSkip = document.createElement('option');
    optSkip.value = TARGET_SKIP;
    optSkip.textContent = t('gdb.dialog.option.skip');
    sel.appendChild(optSkip);
    buildings.forEach((b, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
    if (initialValue !== undefined) sel.value = initialValue;
    return sel;
  }

  function buildFloorSelect(buildingValue, initialValue) {
    const sel = document.createElement('select');
    // "All floors" is always available.
    const optAll = document.createElement('option');
    optAll.value = FLOOR_ALL;
    optAll.textContent = t('gdb.dialog.option.allFloors');
    sel.appendChild(optAll);
    const bi = buildingIndexFromValue(buildingValue);
    if (bi != null) {
      const b = buildings[bi];
      for (const lvl of b.levels ?? []) {
        const opt = document.createElement('option');
        opt.value = lvl.key ?? '';
        opt.textContent = lvl.name;
        sel.appendChild(opt);
      }
      sel.disabled = false;
    } else {
      // Unassigned / Skip — floor is moot.
      sel.disabled = true;
    }
    if (initialValue !== undefined) sel.value = initialValue;
    return sel;
  }

  function rebuildBulkFloorSelect() {
    // Prefer the explicit bulk-bar building. Fall back to the common building
    // shared by all currently-selected rows, so a user who checks several rows
    // already belonging to the same building can bulk-set their floor in one
    // click without having to also re-pick the building in the bulk bar.
    const sourceBuildingValue =
      (bulkBuildingSel.value && bulkBuildingSel.value !== '')
        ? bulkBuildingSel.value
        : sharedBuildingOfSelected();

    const newSel = buildFloorSelect(sourceBuildingValue ?? '', FLOOR_ALL);
    newSel.addEventListener('change', () => {
      const v = newSel.value;
      const filterBuilding = sourceBuildingValue;
      // sourceBuildingValue is captured in closure — it matches the building
      // the option list was built against, even if bulkBuildingSel changes
      // before the user picks a floor.
      if (filterBuilding == null) return;
      for (const a of assignments) {
        if (!a.selected) continue;
        if (a.buildingValue !== filterBuilding) continue;
        a.levelValue = v;
        a.floorManual = true;
        a.floorResolved = v !== FLOOR_ALL;
      }
      renderRows();
    });
    bulkFloorLabel.replaceChild(newSel, bulkFloorSel);
    bulkFloorSel = newSel;
  }

  // Returns the buildingValue string shared by every currently-selected row,
  // but only when it refers to a real building (not Skip / Unassigned / empty).
  // Returns null when no rows are selected or selection spans multiple buildings.
  function sharedBuildingOfSelected() {
    let seen = null;
    for (const a of assignments) {
      if (!a.selected) continue;
      if (seen === null) seen = a.buildingValue;
      else if (seen !== a.buildingValue) return null;
    }
    if (seen == null) return null;
    return buildingIndexFromValue(seen) != null ? seen : null;
  }

  function buildingIndexFromValue(v) {
    if (v === TARGET_SKIP || v === TARGET_UNASSIGNED || v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= buildings.length) return null;
    return n;
  }

  // Whether a row passes the active filter. Empty filter means all visible.
  function isVisible(a) {
    if (!filterText) return true;
    return stripExt(a.fc.fileName ?? '').toLowerCase().includes(filterText);
  }

  function renderRows() {
    tbody.innerHTML = '';
    assignments.forEach((a, idx) => {
      if (!isVisible(a)) return;
      const tr = document.createElement('tr');
      tr.className = 'gdb-import-row';
      if (a.buildingValue === TARGET_SKIP) tr.classList.add('row-skip');

      // Checkbox
      const cbTd = document.createElement('td');
      cbTd.className = 'gdb-col-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!a.selected;
      cb.addEventListener('change', () => {
        a.selected = cb.checked;
        selectAllCb.checked = visibleAssignments().every((x) => x.selected);
        // Selection changed → the bulk-floor option list may now depend on a
        // different common building (or none). Rebuild so the dropdown
        // matches.
        rebuildBulkFloorSelect();
      });
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);

      // Layer name + feature count
      const nameTd = document.createElement('td');
      nameTd.className = 'gdb-col-layer';
      const nameMain = document.createElement('div');
      nameMain.className = 'gdb-layer-name';
      nameMain.textContent = stripExt(a.fc.fileName ?? 'layer');
      const nameSub = document.createElement('div');
      nameSub.className = 'gdb-layer-meta';
      const geom = summarizeGeometry(a.fc.features ?? []);
      const geomLabel = geomLabelKey(geom);
      nameSub.textContent = t('gdb.dialog.featureCount', {
        count: (a.fc.features ?? []).length,
        geom: geomLabel,
      });
      nameTd.appendChild(nameMain);
      nameTd.appendChild(nameSub);
      tr.appendChild(nameTd);

      // Match confidence dot
      const matchTd = document.createElement('td');
      matchTd.className = 'gdb-col-match';
      const dot = document.createElement('span');
      dot.className = `gdb-conf-dot gdb-conf-${a.confidence}`;
      dot.title = t(`gdb.confidence.${a.confidence}`);
      matchTd.appendChild(dot);
      tr.appendChild(matchTd);

      // Building select
      const bTd = document.createElement('td');
      bTd.className = 'gdb-col-building';
      const bSel = buildBuildingSelect(a.buildingValue);
      bSel.addEventListener('change', () => {
        a.buildingValue = bSel.value;
        a.buildingManual = true;
        // The floor selection is stale: previous levelKey may not exist in the
        // newly chosen building's level list. Reset and re-resolve from the
        // GDB's own level metadata.
        a.floorManual = false;
        a.levelValue = FLOOR_ALL;
        a.floorResolved = false;
        resolveFloorFromOrdinal(a);
        // Cascade the new building down to any sub-rows that aren't manually
        // pinned, then re-match each sub-row's floor against the new level
        // list. Keeps the per-feature splits aligned with the parent.
        if (a.subRows) {
          for (const sr of a.subRows) {
            if (sr.buildingManual) continue;
            sr.buildingValue = a.buildingValue;
            if (!sr.floorManual) {
              sr.levelValue = FLOOR_ALL;
              sr.floorResolved = false;
              sr.confidence = sr.floorValue ? 'medium' : 'none';
              resolveSubRowFloor(sr);
            }
          }
        }
        inferSiblingBuildings(a);
        renderRows();
      });
      bTd.appendChild(bSel);
      tr.appendChild(bTd);

      // Floor cell.
      // - With sub-rows: render a read-only "(per-feature, N floors)" badge;
      //   per-row floor selection happens on each sub-row instead.
      // - Without sub-rows: render the existing floor dropdown, with the
      //   warning highlight when auto-match couldn't pin a floor.
      const fTd = document.createElement('td');
      fTd.className = 'gdb-col-floor';
      if (a.subRows) {
        const badge = document.createElement('span');
        badge.className = 'gdb-per-feature-badge';
        badge.textContent = t('gdb.dialog.floor.perFeatureBadge', { count: a.subRows.length });
        fTd.appendChild(badge);
      } else {
        const fSel = buildFloorSelect(a.buildingValue, a.levelValue);
        const floorUnresolved =
          buildingIndexFromValue(a.buildingValue) != null &&
          a.levelValue === FLOOR_ALL &&
          !a.floorResolved;
        if (floorUnresolved) {
          fSel.classList.add('gdb-floor-unresolved');
          fSel.title = t('gdb.dialog.floor.unresolvedTitle');
        }
        fSel.addEventListener('change', () => {
          a.levelValue = fSel.value;
          a.floorManual = true;
          a.floorResolved = fSel.value !== FLOOR_ALL;
        });
        fTd.appendChild(fSel);
      }
      tr.appendChild(fTd);

      tbody.appendChild(tr);

      if (a.subRows) {
        for (const sr of a.subRows) appendSubRow(a, sr);
      }
    });
    const visible = visibleAssignments();
    selectAllCb.checked = visible.length > 0 && visible.every((x) => x.selected);
    // Keep the bulk-floor option list in sync with any state change that
    // triggered a re-render (building edits, bulk skip, filter changes, etc.).
    rebuildBulkFloorSelect();
  }

  function visibleAssignments() {
    return assignments.filter(isVisible);
  }

  // Render one sub-row (a per-feature.floor split inside a parent layer).
  // Sub-rows have their own building/floor state but inherit the parent's
  // checkbox/selection model — the row's checkbox cell is intentionally
  // blank so bulk actions continue to operate on whole layers.
  function appendSubRow(parent, sr) {
    const tr = document.createElement('tr');
    tr.className = 'gdb-import-row subrow';

    // Empty checkbox cell — sub-rows are not bulk-selectable.
    const cbTd = document.createElement('td');
    cbTd.className = 'gdb-col-check';
    tr.appendChild(cbTd);

    // Floor-value pill + per-sub-row feature count.
    const nameTd = document.createElement('td');
    nameTd.className = 'gdb-col-layer';
    const pill = document.createElement('span');
    pill.className = 'gdb-floor-value-pill';
    pill.textContent = sr.floorValue
      ? `floor="${sr.floorValue}"`
      : t('gdb.dialog.floor.noFloor');
    const countSpan = document.createElement('span');
    countSpan.className = 'gdb-layer-meta';
    countSpan.textContent = ' ' + t('gdb.dialog.floor.subRowCount', { count: sr.count });
    nameTd.appendChild(pill);
    nameTd.appendChild(countSpan);
    tr.appendChild(nameTd);

    // Per-sub-row confidence dot.
    const matchTd = document.createElement('td');
    matchTd.className = 'gdb-col-match';
    const dot = document.createElement('span');
    dot.className = `gdb-conf-dot gdb-conf-${sr.confidence}`;
    dot.title = t(`gdb.confidence.${sr.confidence}`);
    matchTd.appendChild(dot);
    tr.appendChild(matchTd);

    // Building select — independent state from the parent.
    const bTd = document.createElement('td');
    bTd.className = 'gdb-col-building';
    const bSel = buildBuildingSelect(sr.buildingValue);
    bSel.addEventListener('change', () => {
      sr.buildingValue = bSel.value;
      sr.buildingManual = true;
      sr.floorManual = false;
      sr.levelValue = FLOOR_ALL;
      sr.floorResolved = false;
      sr.confidence = sr.floorValue ? 'medium' : 'none';
      resolveSubRowFloor(sr);
      renderRows();
    });
    bTd.appendChild(bSel);
    tr.appendChild(bTd);

    // Floor select — independent state, with the unresolved-warning style
    // when a real building is assigned but no floor matched.
    const fTd = document.createElement('td');
    fTd.className = 'gdb-col-floor';
    const fSel = buildFloorSelect(sr.buildingValue, sr.levelValue);
    const unresolved =
      buildingIndexFromValue(sr.buildingValue) != null &&
      sr.levelValue === FLOOR_ALL &&
      !sr.floorResolved;
    if (unresolved) {
      fSel.classList.add('gdb-floor-unresolved');
      fSel.title = t('gdb.dialog.floor.unresolvedTitle');
    }
    fSel.addEventListener('change', () => {
      sr.levelValue = fSel.value;
      sr.floorManual = true;
      sr.floorResolved = fSel.value !== FLOOR_ALL;
    });
    fTd.appendChild(fSel);
    tr.appendChild(fTd);

    tbody.appendChild(tr);
  }

  function geomLabelKey(geom) {
    switch (geom) {
      case 'POLYGON': return t('gdb.dialog.geom.polygon');
      case 'LINE': return t('gdb.dialog.geom.line');
      case 'POINT': return t('gdb.dialog.geom.point');
      case 'MIXED': return t('gdb.dialog.geom.mixed');
      default: return geom;
    }
  }

  function stripExt(name) {
    return name.replace(/\.(shp|dbf|prj|geojson|json)$/i, '');
  }

  // -- Filename tokenization for sibling building inference --
  function tokenizeFilename(name) {
    return stripExt(name ?? '').toLowerCase().split(/[_\-\s.]+/).filter(Boolean);
  }

  // Index of the token that matches a building's name (or any alias),
  // using case-insensitive containment in either direction. -1 if no match.
  function findBuildingTokenIndex(tokens, building) {
    if (!building) return -1;
    const candidates = [building.name, ...(building.aliases ?? [])]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    for (let i = 0; i < tokens.length; i++) {
      for (const c of candidates) {
        if (tokens[i].includes(c) || c.includes(tokens[i])) return i;
      }
    }
    return -1;
  }

  // The lowercased building-token to match siblings by. Falls back to tokens[0]
  // when no token matches the assigned building's name/aliases.
  function siblingBuildingToken(filename, building) {
    const toks = tokenizeFilename(filename);
    const bi = findBuildingTokenIndex(toks, building);
    return bi >= 0 ? toks[bi] : (toks[0] ?? null);
  }

  // After the user picks a building for one row, propagate that pick to every
  // other row whose filename shares the same building-token, then re-resolve
  // each touched row's floor against the new building's level list.
  // Skips rows the user has manually edited.
  function inferSiblingBuildings(source) {
    if (source.buildingValue === TARGET_SKIP || source.buildingValue === TARGET_UNASSIGNED) return;
    const bi = buildingIndexFromValue(source.buildingValue);
    if (bi == null) return;
    const tok = siblingBuildingToken(source.fc.fileName, buildings[bi]);
    if (!tok) return;
    for (const other of assignments) {
      if (other === source) continue;
      if (other.buildingManual) continue;
      if (!tokenizeFilename(other.fc.fileName).includes(tok)) continue;
      other.buildingValue = source.buildingValue;
      if (!other.floorManual) {
        other.levelValue = FLOOR_ALL;
        other.floorResolved = false;
        resolveFloorFromOrdinal(other);
      }
    }
  }

  // Build sub-rows for an FC whose features carry per-feature `floor` values
  // spanning multiple floors. Returns null when there are <2 distinct floor
  // values (the FC stays as a single layer).
  //
  // Each sub-row inherits the parent's auto-matched building; if that's a
  // real building, the sub-row's level is auto-matched via matchLevelByText
  // against the building's level list.
  function buildSubRows(fc, parentBuildingValue) {
    const features = fc?.features ?? [];
    if (features.length === 0) return null;
    const groups = groupFeaturesByFloor(features);
    if (groups.length < 2) return null;
    const bi = buildingIndexFromValue(parentBuildingValue);
    const building = bi != null ? buildings[bi] : null;
    return groups.map((g) => {
      const matched = (building && g.floorValue)
        ? matchLevelByText(g.floorValue, building.levels)
        : null;
      return {
        floorValue: g.floorValue,
        key: g.key,
        count: g.features.length,
        buildingValue: parentBuildingValue,
        levelValue: matched ? (matched.key ?? '') : FLOOR_ALL,
        confidence: matched ? 'high' : (g.floorValue ? 'medium' : 'none'),
        floorResolved: !!matched,
        buildingManual: false,
        floorManual: false,
      };
    });
  }

  // Re-run per-sub-row level matching after the sub-row's building changed.
  // No-op when the sub-row's floor is manually pinned.
  function resolveSubRowFloor(sr) {
    if (sr.floorManual) return;
    const bi = buildingIndexFromValue(sr.buildingValue);
    if (bi == null) return;
    if (!sr.floorValue) return;
    const matched = matchLevelByText(sr.floorValue, buildings[bi].levels);
    if (matched) {
      sr.levelValue = matched.key ?? '';
      sr.floorResolved = true;
      sr.confidence = 'high';
    }
  }

  // If the row has a real building, set its floor from the GDB's own level
  // metadata when available, or fall back to the layer filename's floor token.
  // No-op when the user has manually pinned the floor.
  function resolveFloorFromOrdinal(a) {
    if (a.floorManual) return;
    const bi = buildingIndexFromValue(a.buildingValue);
    if (bi == null) return;
    const building = buildings[bi];
    if (a.levelRef) {
      const matched = matchLevelRefToBuildingLevel(a.levelRef, building);
      if (matched) {
        a.levelValue = matched.key ?? '';
        a.floorResolved = true;
        return;
      }
    }
    // Filename fallback: catches layers like "Marubiru_5_Floor" when the GDB
    // has no sibling _level metadata, or when the metadata's ordinal/name
    // does not reconcile with the building's level list.
    const byFilename = matchLevelByText(stripExt(a.fc.fileName ?? ''), building.levels);
    if (byFilename) {
      a.levelValue = byFilename.key ?? '';
      a.floorResolved = true;
    }
  }

  function closeDialog() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function handleImport() {
    const decisions = [];
    for (const a of assignments) {
      if (a.buildingValue === TARGET_SKIP) {
        decisions.push({ fc: a.fc, target: { kind: 'skip' } });
        continue;
      }
      // When a parent has per-feature sub-rows, expand to one decision per
      // sub-row, each carrying its own feature subset and naming suffix.
      // Skip / unassigned / no-building on the parent are inherited by the
      // sub-rows via their own buildingValue (initialized from the parent
      // and editable independently).
      if (a.subRows) {
        const baseName = stripExt(a.fc.fileName ?? 'layer');
        for (const sr of a.subRows) {
          const subset = a.fc.features.filter((f) => normalizedFloorKey(f) === sr.key);
          if (subset.length === 0) continue;
          const subFc = { fileName: a.fc.fileName, features: subset };
          const suffix = sr.floorValue ?? t('gdb.dialog.floor.noFloor');
          const nameOverride = `${baseName} (${suffix})`;
          decisions.push(...subRowDecisions(subFc, sr, nameOverride));
        }
        continue;
      }
      if (a.buildingValue === TARGET_UNASSIGNED) {
        decisions.push({ fc: a.fc, target: { kind: 'unassigned' } });
        continue;
      }
      const bi = buildingIndexFromValue(a.buildingValue);
      if (bi == null) {
        decisions.push({ fc: a.fc, target: { kind: 'unassigned' } });
        continue;
      }
      const levelKey = a.levelValue === FLOOR_ALL ? null : a.levelValue;
      decisions.push({ fc: a.fc, target: { kind: 'building', buildingIndex: bi, levelKey } });
    }
    closeDialog();
    Promise.resolve().then(() => onImport(decisions));
  }

  // Wrap a single sub-row's resolution into a decision. Mirrors the parent
  // branch's skip / unassigned / building handling using the sub-row's state.
  function subRowDecisions(subFc, sr, nameOverride) {
    if (sr.buildingValue === TARGET_SKIP) {
      return [{ fc: subFc, target: { kind: 'skip' }, nameOverride }];
    }
    if (sr.buildingValue === TARGET_UNASSIGNED) {
      return [{ fc: subFc, target: { kind: 'unassigned' }, nameOverride }];
    }
    const bi = buildingIndexFromValue(sr.buildingValue);
    if (bi == null) {
      return [{ fc: subFc, target: { kind: 'unassigned' }, nameOverride }];
    }
    const levelKey = sr.levelValue === FLOOR_ALL ? null : sr.levelValue;
    return [{
      fc: subFc,
      target: { kind: 'building', buildingIndex: bi, levelKey },
      nameOverride,
    }];
  }

  // Read a feature's `floor` property and normalize to the same grouping key
  // used by groupFeaturesByFloor (lowercased, trimmed; empty for missing).
  function normalizedFloorKey(feature) {
    const props = feature?.properties ?? {};
    let raw = props.floor ?? props.Floor ?? props.FLOOR;
    if (raw == null) {
      for (const k of Object.keys(props)) {
        if (k.toLowerCase() === 'floor') { raw = props[k]; break; }
      }
    }
    if (raw == null || raw === '') return '';
    return String(raw).trim().toLowerCase();
  }
}
