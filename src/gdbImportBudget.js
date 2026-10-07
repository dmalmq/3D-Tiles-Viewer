// Guards against GDB imports large enough to exhaust the browser tab.
//
// Station GDBs bundle city-scale reference layers (background, blocks,
// roads, building footprints, track centre lines) next to the indoor data.
// They cover several kilometres, are not tied to any one building's levels,
// and dominate the import's memory, so they start out skipped.

const BASEMAP_PREFIXES = ["背景", "街区", "道路", "歩道", "水域", "建築物", "軌道の中心線"];

export const LARGE_IMPORT_FEATURE_COUNT = 15000;

export function isBasemapLayerName(name) {
  const base = String(name ?? "").normalize("NFKC").trim();
  return BASEMAP_PREFIXES.some((prefix) => base.startsWith(prefix));
}

export function countFeatures(featureCollections) {
  let total = 0;
  for (const fc of featureCollections ?? []) total += fc?.features?.length ?? 0;
  return total;
}
