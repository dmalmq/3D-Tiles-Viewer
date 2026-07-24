// At-import building selection for multi-building GDB/GPKG/shapefile datasets.
//
// Pure grouping/filtering logic (unit-tested); the checklist dialog lives in
// importBuildingPickerDialog.js. Groups come from two conventions:
//  - RevitGeoSuite exports: features carry a `source` property per linked model
//    (splitFeaturesBySource has usually already split these into sub-collections).
//  - Japanese indoor-map GDBs (JR stations): layers named <prefix>_<suffix>
//    with per-prefix `<prefix>_level` metadata feature classes.

import { detectSource } from "./gdbAutoMatch.js";

function stripExt(name) {
  return String(name ?? "").replace(/\.(shp|dbf|prj|geojson|json|gpkg)$/i, "");
}

// Shared bucket for layers that don't follow either multi-building convention
// (plain single-token names like RevitGeoSuite's unit/detail/opening/fixture/level).
const DATASET_KEY = "__dataset__";
const DATASET_LABEL = "Dataset";

// "tokyost_B1_space" -> "tokyost"; single-token names carry no prefix.
function filenamePrefix(fileName) {
  const base = stripExt(fileName);
  const idx = base.indexOf("_");
  return idx > 0 ? base.slice(0, idx).toLowerCase() : null;
}

// Real GDBs carry junk `source` attributes ("1", "", whitespace) that must not
// become building groups — only descriptive names qualify.
function isMeaningfulSource(value) {
  const text = String(value ?? "").trim();
  return text.length > 0 && !/^\d+$/.test(text);
}

function groupKeyOf(fc) {
  const source = detectSource(fc?.features ?? []);
  if (isMeaningfulSource(source)) return { key: `source:${source}`, label: String(source).trim() };
  const prefix = filenamePrefix(fc?.fileName);
  if (prefix) return { key: prefix, label: prefix };
  return { key: DATASET_KEY, label: DATASET_LABEL };
}

/**
 * @returns {Array<{ key, label, layerCount, featureCount }>} one entry per
 * detected building group, ordered by descending feature count.
 */
export function enumerateBuildings(featureCollections) {
  const groups = new Map();
  for (const fc of featureCollections ?? []) {
    const { key, label } = groupKeyOf(fc);
    let entry = groups.get(key);
    if (!entry) {
      entry = { key, label, layerCount: 0, featureCount: 0 };
      groups.set(key, entry);
    }
    entry.layerCount += 1;
    entry.featureCount += (fc?.features ?? []).length;
  }

  // Sourceless/prefixless layers (e.g. a lone `level` metadata layer) belong to
  // the dataset's single building when there is exactly one real group — only
  // genuinely multi-building datasets should surface a "shared" bucket.
  const dataset = groups.get(DATASET_KEY);
  if (dataset && groups.size === 2) {
    const real = [...groups.values()].find((g) => g.key !== DATASET_KEY);
    real.layerCount += dataset.layerCount;
    real.featureCount += dataset.featureCount;
    groups.delete(DATASET_KEY);
  }

  return [...groups.values()].sort((a, b) => b.featureCount - a.featureCount);
}

export function filterToBuildings(featureCollections, selectedKeys) {
  const selected = new Set(selectedKeys ?? []);
  return (featureCollections ?? []).filter((fc) => selected.has(groupKeyOf(fc).key));
}
