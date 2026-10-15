export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Area fills from the MapBackground/* variables of Figma IiM1QNaEzWOM4uZCvsbor5
// ("Setting up a new map design in ArcGIS Pro", frame 5:914). Mirrors
// shp2imdf-converter's backend/config/color_theme.json, which rewrites the old
// color2 names to the new area names; both spellings are drawn the same here.
const AREA = {
  freeArea: "#FFFFFF",
  paidArea: "#F2F7FB",
  paidAreaShinkansen: "#E5EFF7",
  facilities: "#DDEBEC",
  restricted: "#F2F2F2",
  stairsEscalators: "#FFFFFF",
};

export const COLOR2_LOOKUP = {
  "改札外通路": AREA.freeArea,
  "在来線改札内": AREA.paidArea,
  "新幹線改札内": AREA.paidAreaShinkansen,
  "施設": AREA.facilities,
  "進入制限エリア": AREA.restricted,
  "階段・エスカレーター": AREA.stairsEscalators,
  "黄": AREA.paidArea,
  "橙": AREA.paidAreaShinkansen,
  "緑": AREA.paidAreaShinkansen,
  "ラチ外白": AREA.freeArea,
  "薄紅": AREA.paidArea,
  "濃紅": AREA.paidAreaShinkansen,
  "薄空": AREA.facilities,
  "濃空": AREA.facilities,
  "薄鼠": AREA.restricted,
  "白": AREA.stairsEscalators,
  "トイレ": AREA.facilities,
  "濃鼠": AREA.freeArea,
  "道白": AREA.freeArea,
  "進入制限あり": AREA.restricted,
};

// 濃鼠 is a free-area floor except on toilets, which the converter recolours
// as facilities by their category code.
const COLOR2_CATEGORY_OVERRIDES = {
  "濃鼠": { categories: new Set(["B007", "B008", "B009", "B010", "B011", "B012", "B013", "B014"]), hex: AREA.facilities },
};

// Neutral grey for values the table does not know, and the TurquoiseGray 1000
// outline (枠線) every area is drawn with.
export const COLOR2_DEFAULT = "#D9D9D9";
export const SPACE_STROKE_COLOR = "#657678";

export function lookupMappedColor(mappings, key, category) {
  if (mappings === COLOR2_LOOKUP) {
    const override = COLOR2_CATEGORY_OVERRIDES[key];
    if (override?.categories.has(String(category ?? "").trim())) return override.hex;
  }
  return mappings[key];
}
export const OPENING_FILL_COLOR = "#FF0000";

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
