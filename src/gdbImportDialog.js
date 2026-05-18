// Multi-building GDB import review dialog.
//
// The checkbox column means "import/apply this row now". For a fresh GDB
// import, unchecked renderable rows are returned as unassigned/staged work so
// they remain visible under the Scene tree's GDB staging group.

import { t } from "./i18n.js";
import {
  matchLayerToTarget,
  summarizeGeometry,
  buildLevelsByPrefix,
  isLevelFeatureClass,
  detectLayerLevelRef,
  matchLevelRefToBuildingLevel,
  matchLevelByText,
  groupFeaturesByFloor,
} from "./gdbAutoMatch.js";

const TARGET_SKIP = "__skip__";
const TARGET_UNASSIGNED = "__unassigned__";
const FLOOR_ALL = "__all__";

export function openGdbImportDialog({ featureCollections, buildings, onImport, mode = "import" }) {
  const levelsByPrefix = buildLevelsByPrefix(featureCollections);
  let filterText = "";
  let submitting = false;

  const assignments = (featureCollections ?? []).map((fc) => {
    if (mode === "reassign" && fc._existingEntry) {
      const parent = fc._existingEntry.parent;
      const layer = fc._existingEntry.layer;
      const buildingValue = parent.kind === "building"
        ? String(parent.buildingIndex)
        : TARGET_UNASSIGNED;
      const levelValue =
        parent.kind === "building" && layer.levelKey != null
          ? String(layer.levelKey)
          : FLOOR_ALL;
      return {
        fc,
        buildingValue,
        levelValue,
        confidence: "high",
        selected: false,
        buildingManual: false,
        floorManual: false,
        floorResolved: levelValue !== FLOOR_ALL,
        levelRef: detectLayerLevelRef(fc?.fileName, levelsByPrefix),
        subRows: null,
        metadataOnly: false,
      };
    }

    const metadataOnly = isLevelFeatureClass(fc?.fileName);
    const match = metadataOnly
      ? { buildingIndex: -1, levelKey: null, confidence: "none" }
      : matchLayerToTarget({
          filename: fc.fileName,
          features: fc.features ?? [],
          buildings,
        });

    const buildingValue = metadataOnly
      ? TARGET_SKIP
      : match.buildingIndex >= 0
        ? String(match.buildingIndex)
        : TARGET_UNASSIGNED;

    const subRows = metadataOnly ? null : buildSubRows(fc, buildingValue);
    const assignment = {
      fc,
      buildingValue,
      levelValue: subRows ? FLOOR_ALL : (match.levelKey != null ? String(match.levelKey) : FLOOR_ALL),
      confidence: metadataOnly ? "none" : match.confidence,
      selected: false,
      buildingManual: false,
      floorManual: false,
      floorResolved: !metadataOnly && !subRows && match.buildingIndex >= 0 && match.levelKey != null,
      levelRef: metadataOnly ? null : detectLayerLevelRef(fc?.fileName, levelsByPrefix),
      subRows,
      metadataOnly,
    };
    if (!subRows) resolveFloorFromMetadata(assignment);
    return assignment;
  });

  const overlay = document.createElement("div");
  overlay.id = "gdbImportOverlay";

  const modal = document.createElement("div");
  modal.id = "gdbImportModal";
  overlay.appendChild(modal);

  const header = document.createElement("div");
  header.className = "gdb-import-header";
  const title = document.createElement("span");
  title.className = "gdb-import-title";
  title.textContent = t(mode === "reassign" ? "gdb.dialog.reassignTitle" : "gdb.dialog.title");
  const closeBtn = document.createElement("button");
  closeBtn.className = "gdb-import-close";
  closeBtn.type = "button";
  closeBtn.textContent = "x";
  closeBtn.title = t("modal.close");
  closeBtn.addEventListener("click", closeDialog);
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const subtitle = document.createElement("p");
  subtitle.className = "gdb-import-subtitle";
  subtitle.textContent = t(
    mode === "reassign" ? "gdb.dialog.reassignSubtitle" : "gdb.dialog.subtitle",
    { count: assignments.length },
  );
  modal.appendChild(subtitle);

  const filterRow = document.createElement("div");
  filterRow.className = "gdb-import-filter";
  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.placeholder = t("gdb.dialog.filter.placeholder");
  filterInput.addEventListener("input", () => {
    filterText = filterInput.value.trim().toLowerCase();
    renderRows();
  });
  filterRow.appendChild(filterInput);
  modal.appendChild(filterRow);

  const bulkBar = document.createElement("div");
  bulkBar.className = "gdb-import-bulkbar";

  const selectAllLabel = document.createElement("label");
  selectAllLabel.className = "gdb-import-bulk-selall";
  const selectAllCb = document.createElement("input");
  selectAllCb.type = "checkbox";
  selectAllCb.addEventListener("change", () => {
    for (const row of visibleLeafRows()) row.selected = selectAllCb.checked;
    renderRows();
  });
  selectAllLabel.appendChild(selectAllCb);
  selectAllLabel.appendChild(document.createTextNode(" " + t("gdb.dialog.bulk.selectAll")));
  bulkBar.appendChild(selectAllLabel);

  const bulkBuildingLabel = document.createElement("label");
  bulkBuildingLabel.className = "gdb-import-bulk-field";
  bulkBuildingLabel.appendChild(document.createTextNode(t("gdb.dialog.bulk.applyBuilding") + ": "));
  const bulkBuildingSel = buildBuildingSelect("");
  bulkBuildingSel.addEventListener("change", () => {
    if (!bulkBuildingSel.value) return;
    for (const row of leafRows().filter((r) => r.selected)) {
      setRowBuilding(row, bulkBuildingSel.value, true);
    }
    bulkBuildingSel.value = "";
    renderRows();
  });
  bulkBuildingLabel.appendChild(bulkBuildingSel);
  bulkBar.appendChild(bulkBuildingLabel);

  const bulkFloorLabel = document.createElement("label");
  bulkFloorLabel.className = "gdb-import-bulk-field";
  bulkFloorLabel.appendChild(document.createTextNode(t("gdb.dialog.bulk.applyFloor") + ": "));
  let bulkFloorSel = document.createElement("select");
  bulkFloorLabel.appendChild(bulkFloorSel);
  bulkBar.appendChild(bulkFloorLabel);

  const bulkSkipBtn = document.createElement("button");
  bulkSkipBtn.className = "secondary-btn compact";
  bulkSkipBtn.type = "button";
  bulkSkipBtn.textContent = t("gdb.dialog.bulk.markSkip");
  bulkSkipBtn.addEventListener("click", () => {
    for (const row of leafRows().filter((r) => r.selected)) {
      setRowBuilding(row, TARGET_SKIP, true);
    }
    renderRows();
  });
  bulkBar.appendChild(bulkSkipBtn);
  modal.appendChild(bulkBar);

  const tableWrap = document.createElement("div");
  tableWrap.className = "gdb-import-table-wrap";
  const table = document.createElement("table");
  table.className = "gdb-import-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th class="gdb-col-check"></th>
      <th class="gdb-col-layer">${t("gdb.dialog.col.layer")}</th>
      <th class="gdb-col-match">${t("gdb.dialog.col.match")}</th>
      <th class="gdb-col-building">${t("gdb.dialog.col.building")}</th>
      <th class="gdb-col-floor">${t("gdb.dialog.col.floor")}</th>
    </tr>`;
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  modal.appendChild(tableWrap);

  const footer = document.createElement("div");
  footer.className = "gdb-import-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary-btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = t("gdb.dialog.cancel");
  cancelBtn.addEventListener("click", closeDialog);
  const importBtn = document.createElement("button");
  importBtn.className = "secondary-btn primary-btn";
  importBtn.type = "button";
  importBtn.textContent = t(mode === "reassign" ? "gdb.dialog.apply" : "gdb.dialog.importSelected");
  importBtn.addEventListener("click", handleImport);
  footer.appendChild(cancelBtn);
  footer.appendChild(importBtn);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDialog();
  });
  renderRows();

  function buildBuildingSelect(initialValue) {
    const sel = document.createElement("select");
    if (initialValue === "") {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = t("gdb.dialog.option.choose");
      sel.appendChild(empty);
    }
    const optUn = document.createElement("option");
    optUn.value = TARGET_UNASSIGNED;
    optUn.textContent = t("gdb.dialog.option.unassigned");
    sel.appendChild(optUn);
    const optSkip = document.createElement("option");
    optSkip.value = TARGET_SKIP;
    optSkip.textContent = t("gdb.dialog.option.skip");
    sel.appendChild(optSkip);
    buildings.forEach((b, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = b.name;
      sel.appendChild(opt);
    });
    sel.value = initialValue;
    return sel;
  }

  function buildFloorSelect(buildingValue, initialValue) {
    const sel = document.createElement("select");
    const optAll = document.createElement("option");
    optAll.value = FLOOR_ALL;
    optAll.textContent = t("gdb.dialog.option.allFloors");
    sel.appendChild(optAll);
    const bi = buildingIndexFromValue(buildingValue);
    if (bi != null) {
      for (const lvl of buildings[bi].levels ?? []) {
        const opt = document.createElement("option");
        opt.value = lvl.key ?? "";
        opt.textContent = lvl.name;
        sel.appendChild(opt);
      }
      sel.disabled = false;
    } else {
      sel.disabled = true;
    }
    sel.value = initialValue;
    return sel;
  }

  function rebuildBulkFloorSelect() {
    const commonBuilding = sharedBuildingOfSelected();
    const newSel = buildFloorSelect(commonBuilding ?? "", FLOOR_ALL);
    newSel.addEventListener("change", () => {
      if (commonBuilding == null) return;
      for (const row of leafRows().filter((r) => r.selected && r.buildingValue === commonBuilding)) {
        row.levelValue = newSel.value;
        row.floorManual = true;
        row.floorResolved = newSel.value !== FLOOR_ALL;
      }
      renderRows();
    });
    bulkFloorLabel.replaceChild(newSel, bulkFloorSel);
    bulkFloorSel = newSel;
  }

  function renderRows() {
    tbody.innerHTML = "";
    for (const a of assignments) {
      if (!isVisible(a)) continue;
      appendAssignmentRow(a);
      if (a.subRows) {
        for (const sr of a.subRows) appendSubRow(a, sr);
      }
    }
    const visible = visibleLeafRows();
    selectAllCb.checked = visible.length > 0 && visible.every((row) => row.selected);
    selectAllCb.indeterminate = visible.some((row) => row.selected) && !selectAllCb.checked;
    rebuildBulkFloorSelect();
  }

  function appendAssignmentRow(a) {
    const tr = document.createElement("tr");
    tr.className = "gdb-import-row";
    if (a.buildingValue === TARGET_SKIP || a.metadataOnly) tr.classList.add("row-skip");

    const cbTd = document.createElement("td");
    cbTd.className = "gdb-col-check";
    if (!a.metadataOnly && !a.subRows) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!a.selected;
      cb.addEventListener("change", () => {
        a.selected = cb.checked;
        renderRows();
      });
      cbTd.appendChild(cb);
    }
    tr.appendChild(cbTd);

    tr.appendChild(buildLayerNameCell(a.fc, a.subRows));
    tr.appendChild(buildConfidenceCell(a.confidence));

    const bTd = document.createElement("td");
    bTd.className = "gdb-col-building";
    const bSel = buildBuildingSelect(a.buildingValue);
    bSel.disabled = a.metadataOnly;
    bSel.addEventListener("change", () => {
      setRowBuilding(a, bSel.value, true);
      if (a.subRows) {
        for (const sr of a.subRows) {
          if (!sr.buildingManual) setRowBuilding(sr, bSel.value, false);
        }
      } else {
        a.selected = true;
      }
      renderRows();
    });
    bTd.appendChild(bSel);
    tr.appendChild(bTd);

    const fTd = document.createElement("td");
    fTd.className = "gdb-col-floor";
    if (a.subRows) {
      const badge = document.createElement("span");
      badge.className = "gdb-per-feature-badge";
      badge.textContent = t("gdb.dialog.floor.perFeatureBadge", { count: a.subRows.length });
      fTd.appendChild(badge);
    } else {
      fTd.appendChild(buildRowFloorSelect(a));
    }
    tr.appendChild(fTd);

    tbody.appendChild(tr);
  }

  function appendSubRow(parent, sr) {
    const tr = document.createElement("tr");
    tr.className = "gdb-import-row subrow";
    if (sr.buildingValue === TARGET_SKIP) tr.classList.add("row-skip");

    const cbTd = document.createElement("td");
    cbTd.className = "gdb-col-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!sr.selected;
    cb.addEventListener("change", () => {
      sr.selected = cb.checked;
      renderRows();
    });
    cbTd.appendChild(cb);
    tr.appendChild(cbTd);

    const nameTd = document.createElement("td");
    nameTd.className = "gdb-col-layer";
    const pill = document.createElement("span");
    pill.className = "gdb-floor-value-pill";
    pill.textContent = sr.floorValue
      ? `floor="${sr.floorValue}"`
      : t("gdb.dialog.floor.noFloor");
    const countSpan = document.createElement("span");
    countSpan.className = "gdb-layer-meta";
    countSpan.textContent = " " + t("gdb.dialog.floor.subRowCount", { count: sr.count });
    nameTd.appendChild(pill);
    countSpan.appendChild(document.createTextNode(` · ${stripExt(parent.fc.fileName ?? "layer")}`));
    nameTd.appendChild(countSpan);
    tr.appendChild(nameTd);

    tr.appendChild(buildConfidenceCell(sr.confidence));

    const bTd = document.createElement("td");
    bTd.className = "gdb-col-building";
    const bSel = buildBuildingSelect(sr.buildingValue);
    bSel.addEventListener("change", () => {
      sr.selected = true;
      setRowBuilding(sr, bSel.value, true);
      renderRows();
    });
    bTd.appendChild(bSel);
    tr.appendChild(bTd);

    const fTd = document.createElement("td");
    fTd.className = "gdb-col-floor";
    fTd.appendChild(buildRowFloorSelect(sr));
    tr.appendChild(fTd);

    tbody.appendChild(tr);
  }

  function buildLayerNameCell(fc, hasSubRows) {
    const nameTd = document.createElement("td");
    nameTd.className = "gdb-col-layer";
    const nameMain = document.createElement("div");
    nameMain.className = "gdb-layer-name";
    nameMain.textContent = stripExt(fc.fileName ?? "layer");
    const nameSub = document.createElement("div");
    nameSub.className = "gdb-layer-meta";
    const geom = summarizeGeometry(fc.features ?? []);
    nameSub.textContent = t("gdb.dialog.featureCount", {
      count: (fc.features ?? []).length,
      geom: geomLabel(geom),
    });
    if (hasSubRows) {
      nameSub.appendChild(document.createTextNode(" · " + t("gdb.dialog.parentRowHint")));
    }
    nameTd.appendChild(nameMain);
    nameTd.appendChild(nameSub);
    return nameTd;
  }

  function buildConfidenceCell(confidence) {
    const td = document.createElement("td");
    td.className = "gdb-col-match";
    const dot = document.createElement("span");
    dot.className = `gdb-conf-dot gdb-conf-${confidence}`;
    dot.title = t(`gdb.confidence.${confidence}`);
    td.appendChild(dot);
    return td;
  }

  function buildRowFloorSelect(row) {
    const fSel = buildFloorSelect(row.buildingValue, row.levelValue);
    const unresolved =
      buildingIndexFromValue(row.buildingValue) != null &&
      row.levelValue === FLOOR_ALL &&
      !row.floorResolved;
    if (unresolved) {
      fSel.classList.add("gdb-floor-unresolved");
      fSel.title = t("gdb.dialog.floor.unresolvedTitle");
    }
    fSel.addEventListener("change", () => {
      row.levelValue = fSel.value;
      row.floorManual = true;
      row.floorResolved = fSel.value !== FLOOR_ALL;
      row.selected = true;
      renderRows();
    });
    return fSel;
  }

  function setRowBuilding(row, buildingValue, manual) {
    row.buildingValue = buildingValue;
    row.buildingManual = manual;
    row.floorManual = false;
    row.levelValue = FLOOR_ALL;
    row.floorResolved = false;
    row.confidence = buildingIndexFromValue(buildingValue) == null ? "none" : "medium";
    if (row.floorValue) resolveSubRowFloor(row);
    else resolveFloorFromMetadata(row);
  }

  function resolveFloorFromMetadata(row) {
    if (row.floorManual) return;
    const bi = buildingIndexFromValue(row.buildingValue);
    if (bi == null) return;
    const building = buildings[bi];
    if (row.levelRef) {
      const matched = matchLevelRefToBuildingLevel(row.levelRef, building);
      if (matched) {
        row.levelValue = matched.key ?? "";
        row.floorResolved = true;
        row.confidence = "high";
        return;
      }
    }
    const byFilename = matchLevelByText(stripExt(row.fc?.fileName ?? ""), building.levels);
    if (byFilename) {
      row.levelValue = byFilename.key ?? "";
      row.floorResolved = true;
      row.confidence = "high";
    }
  }

  function resolveSubRowFloor(row) {
    if (row.floorManual) return;
    const bi = buildingIndexFromValue(row.buildingValue);
    if (bi == null || !row.floorValue) return;
    const matched = matchLevelByText(row.floorValue, buildings[bi].levels);
    if (matched) {
      row.levelValue = matched.key ?? "";
      row.floorResolved = true;
      row.confidence = "high";
    }
  }

  function buildSubRows(fc, parentBuildingValue) {
    const groups = groupFeaturesByFloor(fc?.features ?? []);
    if (groups.length < 2) return null;
    return groups.map((g) => {
      const row = {
        floorValue: g.floorValue,
        key: g.key,
        count: g.features.length,
        buildingValue: parentBuildingValue,
        levelValue: FLOOR_ALL,
        confidence: g.floorValue ? "medium" : "none",
        floorResolved: false,
        buildingManual: false,
        floorManual: false,
        selected: false,
      };
      resolveSubRowFloor(row);
      return row;
    });
  }

  async function handleImport() {
    if (submitting) return;
    const decisions = [];
    for (const a of assignments) {
      if (a.metadataOnly) continue;
      if (a.subRows) {
        const baseName = stripExt(a.fc.fileName ?? "layer");
        for (const sr of a.subRows) {
          const subset = (a.fc.features ?? []).filter((f) => normalizedFloorKey(f) === sr.key);
          if (subset.length === 0) continue;
          const suffix = sr.floorValue ?? t("gdb.dialog.floor.noFloor");
          decisions.push(...decisionsForRow(
            { fileName: a.fc.fileName, features: subset, _existingEntry: a.fc._existingEntry },
            sr,
            `${baseName} (${suffix})`,
          ));
        }
        continue;
      }
      decisions.push(...decisionsForRow(a.fc, a, undefined));
    }
    submitting = true;
    importBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    try {
      await onImport(decisions);
      removeDialog();
    } catch (e) {
      console.error(e);
      alert(t("alert.failedGdb", { message: e?.message ?? String(e) }));
      submitting = false;
      importBtn.disabled = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
    }
  }

  function decisionsForRow(fc, row, nameOverride) {
    if (row.buildingValue === TARGET_SKIP) {
      return [{ fc, target: { kind: "skip" }, nameOverride, selected: !!row.selected }];
    }
    if (mode === "reassign" && !row.selected) return [];
    if (mode === "import" && !row.selected) {
      return [{ fc, target: { kind: "unassigned" }, nameOverride, selected: false }];
    }
    if (row.buildingValue === TARGET_UNASSIGNED) {
      return [{ fc, target: { kind: "unassigned" }, nameOverride, selected: true }];
    }
    const bi = buildingIndexFromValue(row.buildingValue);
    if (bi == null) {
      return [{ fc, target: { kind: "unassigned" }, nameOverride, selected: row.selected }];
    }
    const levelKey = row.levelValue === FLOOR_ALL ? null : row.levelValue;
    return [{
      fc,
      target: { kind: "building", buildingIndex: bi, levelKey },
      nameOverride,
      selected: row.selected,
    }];
  }

  function leafRows() {
    const out = [];
    for (const a of assignments) {
      if (a.metadataOnly) continue;
      if (a.subRows) out.push(...a.subRows);
      else out.push(a);
    }
    return out;
  }

  function visibleLeafRows() {
    const out = [];
    for (const a of assignments) {
      if (!isVisible(a) || a.metadataOnly) continue;
      if (a.subRows) out.push(...a.subRows);
      else out.push(a);
    }
    return out;
  }

  function sharedBuildingOfSelected() {
    let seen = null;
    for (const row of leafRows().filter((r) => r.selected)) {
      if (buildingIndexFromValue(row.buildingValue) == null) return null;
      if (seen === null) seen = row.buildingValue;
      else if (seen !== row.buildingValue) return null;
    }
    return seen;
  }

  function isVisible(a) {
    if (!filterText) return true;
    return stripExt(a.fc.fileName ?? "").toLowerCase().includes(filterText);
  }

  function buildingIndexFromValue(value) {
    if (value === TARGET_SKIP || value === TARGET_UNASSIGNED || value === "" || value == null) return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < buildings.length ? n : null;
  }

  function geomLabel(geom) {
    switch (geom) {
      case "POLYGON": return t("gdb.dialog.geom.polygon");
      case "LINE": return t("gdb.dialog.geom.line");
      case "POINT": return t("gdb.dialog.geom.point");
      case "MIXED": return t("gdb.dialog.geom.mixed");
      default: return geom;
    }
  }

  function normalizedFloorKey(feature) {
    const props = feature?.properties ?? {};
    let raw = props.floor ?? props.Floor ?? props.FLOOR;
    if (raw == null) {
      for (const k of Object.keys(props)) {
        if (k.toLowerCase() === "floor") {
          raw = props[k];
          break;
        }
      }
    }
    if (raw == null || raw === "") return "";
    return String(raw).trim().toLowerCase();
  }

  function stripExt(name) {
    return String(name ?? "").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
  }

  function closeDialog() {
    if (submitting) return;
    removeDialog();
  }

  function removeDialog() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
}
