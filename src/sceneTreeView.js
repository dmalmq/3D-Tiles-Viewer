// Pure data helpers used by the scene-tree renderer in main.js. The DOM
// creation and event wiring still live in main.js (renderLevelList and its
// neighbours); a full extraction needs a viewContext refactor we have not
// taken on yet. Splitting out the filter/projection logic here is the cheap
// half: it's pure, testable, and unblocks future cleanup of renderLevelList.

import { levelNameToNumber } from "./floorSplit.js";

// Buildings whose name matches the filter (case-insensitive substring).
// Returns [{ b, i }] preserving original building indices.
// When `filterRaw` is empty/falsy, returns all buildings.
export function filterVisibleBuildings(buildings, filterRaw) {
  if (!filterRaw) return buildings.map((b, i) => ({ b, i }));
  const needle = String(filterRaw).toLowerCase();
  return buildings
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => (b.name ?? "").toLowerCase().includes(needle));
}

// All building-attached shapefile layers whose host-building level resolves
// to the given floor number. Returns [{ building, buildingIndex, layer }].
// `filterRaw` narrows by layer name.
export function shapefilesForModelLevel(buildings, floorNumber, filterRaw = "") {
  const needle = filterRaw ? String(filterRaw).toLowerCase() : "";
  const out = [];
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (!b.shapefileLayers) continue;
    for (const layer of b.shapefileLayers) {
      if (layer.levelKey == null) continue;
      const lvl = b.levels?.find((l) => (l.key ?? "") === layer.levelKey);
      const fn = lvl ? levelNameToNumber(lvl.name) : null;
      if (fn !== floorNumber) continue;
      if (needle && !(layer.name ?? "").toLowerCase().includes(needle)) continue;
      out.push({ building: b, buildingIndex: bi, layer });
    }
  }
  return out;
}

// Every layer that is currently "unassigned" to any level: building-attached
// layers with levelKey == null + the global unassignedLayers staging bucket.
// `buildingIndex` is the numeric index or the string "unassigned" for staged.
export function unassignedShapefilesAll(buildings, unassignedLayers, filterRaw = "") {
  const needle = filterRaw ? String(filterRaw).toLowerCase() : "";
  const matches = (name) => !needle || (name ?? "").toLowerCase().includes(needle);
  const out = [];
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    if (!b.shapefileLayers) continue;
    for (const layer of b.shapefileLayers) {
      if (layer.levelKey != null) continue;
      if (!matches(layer.name)) continue;
      out.push({ building: b, buildingIndex: bi, layer });
    }
  }
  for (const layer of unassignedLayers ?? []) {
    if (!matches(layer.name)) continue;
    out.push({ building: null, buildingIndex: "unassigned", layer });
  }
  return out;
}

// Resolve a layer's current parent. Returns:
//   "unassigned" — staged in the global unassignedLayers bucket
//   <number>     — buildings[index].shapefileLayers contains it
//   null         — not found anywhere (stale reference)
export function findLayerParent(buildings, unassignedLayers, layer) {
  if (unassignedLayers && unassignedLayers.indexOf(layer) !== -1) return "unassigned";
  for (let bi = 0; bi < buildings.length; bi++) {
    if (buildings[bi].shapefileLayers?.indexOf(layer) !== -1) return bi;
  }
  return null;
}
