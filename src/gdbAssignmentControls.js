// Shared building/floor `<select>` builders + value helpers used by the
// GDB import dialog and the new import review tray. Extracted from
// gdbImportDialog.js so both surfaces stay in sync on option semantics
// (skip / unassigned / specific building, all-floors / specific level).

import { t } from "./i18n.js";

export const TARGET_SKIP = "__skip__";
export const TARGET_UNASSIGNED = "__unassigned__";
export const FLOOR_ALL = "__all__";

export function buildBuildingSelect(buildings, initialValue) {
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

export function buildFloorSelect(buildings, buildingValue, initialValue) {
  const sel = document.createElement("select");
  const optAll = document.createElement("option");
  optAll.value = FLOOR_ALL;
  optAll.textContent = t("gdb.dialog.option.allFloors");
  sel.appendChild(optAll);
  const bi = buildingIndexFromValue(buildings, buildingValue);
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

export function buildingIndexFromValue(buildings, value) {
  if (value === TARGET_SKIP || value === TARGET_UNASSIGNED || value === "" || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < buildings.length ? n : null;
}

export function stripExt(name) {
  return String(name ?? "").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
}
