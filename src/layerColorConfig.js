export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const COLUMN_SCAN_CAP = 5000;
const DEFAULT_COLOR_COLUMN_PREFERENCES = [
  "color2",
  "previcolor",
  "color",
  "fill",
  "fillColor",
  "colour",
];

export function isSpaceLayerName(name) {
  return normalizedNameTokens(name).includes("space");
}

export function isUnitLayerName(name) {
  return normalizedNameTokens(name).includes("unit");
}

function normalizedNameTokens(name) {
  const normalized = String(name ?? "")
    .replace(/\.(shp|dbf|prj|geojson|json)$/i, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._/\\()[\]{}<>:;,'"`~!?@#$%^&*=+|]+/g, " ")
    .replace(/[‐‒–—－ー-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.split(" ") : [];
}

export function isShapefileUnitLayer(layer) {
  if ((layer?._origin ?? "gdb") !== "shp") return false;
  return isUnitLayerName(layer?.name);
}

export function getLayerType(name) {
  const tokens = normalizedNameTokens(name);
  if (tokens.includes("space")) return "space";
  if (tokens.includes("unit")) return "unit";
  if (tokens.includes("opening")) return "opening";
  if (tokens.includes("detail")) return "detail";
  if (tokens.includes("level")) return "level";
  return null;
}

export function isColorConfigurableLayer(layer) {
  return isSpaceLayerName(layer?.name) || isUnitLayerName(layer?.name);
}

export function getLayerColumnNames(layer) {
  const out = new Set();
  const feats = layer?.features ?? [];
  const n = Math.min(feats.length, COLUMN_SCAN_CAP);
  for (let i = 0; i < n; i++) {
    const props = feats[i]?.properties;
    if (!props) continue;
    for (const k of Object.keys(props)) out.add(k);
  }
  return [...out].sort();
}

export function chooseDefaultColorColumn(layer, preferences = DEFAULT_COLOR_COLUMN_PREFERENCES) {
  const columns = getLayerColumnNames(layer);
  if (columns.length === 0) return "color2";

  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const preferred of preferences) {
    const match = byLower.get(String(preferred).toLowerCase());
    if (match) return match;
  }
  return columns[0];
}
