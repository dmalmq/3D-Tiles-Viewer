// JIS X 0410 standard grid ("地域メッシュ") helpers. PLATEAU publishes its
// CityGML per tertiary (3次, ~1 km) mesh; we use the same grid to pick which
// part of a municipality's 3D Tiles to load.

const PRIMARY_LAT_SPAN = 2 / 3;
const SECONDARY_LAT_SPAN = 5 / 60;
const SECONDARY_LNG_SPAN = 7.5 / 60;
export const TERTIARY_LAT_SPAN = 30 / 3600;
export const TERTIARY_LNG_SPAN = 45 / 3600;

const MESH_CODE_RE = /^\d{8}$/;

export function isMeshCode(value) {
  return typeof value === "string" && MESH_CODE_RE.test(value);
}

export function meshCodeFor(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Nudge by a tiny epsilon so points computed as exact cell edges (e.g. a
  // neighbour's centre) never land in the wrong cell through float noise.
  const primaryLat = Math.floor(lat / PRIMARY_LAT_SPAN + 1e-12);
  const primaryLng = Math.floor(lng + 1e-12) - 100;
  if (primaryLat < 0 || primaryLat > 99 || primaryLng < 0 || primaryLng > 99) return null;

  const latRem = lat - primaryLat * PRIMARY_LAT_SPAN;
  const lngRem = lng - (primaryLng + 100);
  const secondaryLat = clampIndex(Math.floor(latRem / SECONDARY_LAT_SPAN + 1e-9), 8);
  const secondaryLng = clampIndex(Math.floor(lngRem / SECONDARY_LNG_SPAN + 1e-9), 8);
  const tertiaryLat = clampIndex(Math.floor((latRem - secondaryLat * SECONDARY_LAT_SPAN) / TERTIARY_LAT_SPAN + 1e-9), 10);
  const tertiaryLng = clampIndex(Math.floor((lngRem - secondaryLng * SECONDARY_LNG_SPAN) / TERTIARY_LNG_SPAN + 1e-9), 10);

  return pad2(primaryLat) + pad2(primaryLng) + secondaryLat + secondaryLng + tertiaryLat + tertiaryLng;
}

export function meshBounds(code) {
  if (!isMeshCode(code)) return null;
  const south = Number(code.slice(0, 2)) * PRIMARY_LAT_SPAN
    + Number(code[4]) * SECONDARY_LAT_SPAN
    + Number(code[6]) * TERTIARY_LAT_SPAN;
  const west = Number(code.slice(2, 4)) + 100
    + Number(code[5]) * SECONDARY_LNG_SPAN
    + Number(code[7]) * TERTIARY_LNG_SPAN;
  return {
    south,
    west,
    north: south + TERTIARY_LAT_SPAN,
    east: west + TERTIARY_LNG_SPAN,
  };
}

export function meshCenter(code) {
  const b = meshBounds(code);
  return b ? { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 } : null;
}

/** The cell plus its 8 surrounding cells (fewer at the edge of the grid). */
export function meshNeighborhood(code, radius = 1) {
  const center = meshCenter(code);
  if (!center) return [];
  const out = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const neighbor = meshCodeFor(center.lat + dy * TERTIARY_LAT_SPAN, center.lng + dx * TERTIARY_LNG_SPAN);
      if (neighbor && !out.includes(neighbor)) out.push(neighbor);
    }
  }
  return out;
}

/**
 * Every tertiary cell touching a lat/lng box. Returns null when the box
 * would produce more than `limit` cells, so callers can skip drawing a grid
 * that would be unreadable anyway.
 */
export function meshCodesInBounds({ south, west, north, east }, limit = 2000) {
  const rows = Math.ceil((north - south) / TERTIARY_LAT_SPAN) + 1;
  const cols = Math.ceil((east - west) / TERTIARY_LNG_SPAN) + 1;
  if (!(rows > 0 && cols > 0) || rows * cols > limit) return null;

  const first = meshBounds(meshCodeFor(south, west));
  if (!first) return [];
  const out = [];
  for (let lat = first.south + TERTIARY_LAT_SPAN / 2; lat - TERTIARY_LAT_SPAN / 2 < north; lat += TERTIARY_LAT_SPAN) {
    for (let lng = first.west + TERTIARY_LNG_SPAN / 2; lng - TERTIARY_LNG_SPAN / 2 < east; lng += TERTIARY_LNG_SPAN) {
      const code = meshCodeFor(lat, lng);
      if (code) out.push(code);
    }
  }
  return out;
}

export function normalizeMeshCodes(codes) {
  return [...new Set((codes ?? []).map(c => String(c).trim()).filter(isMeshCode))].sort();
}

/**
 * Points worth reverse-geocoding to find every municipality a set of cells
 * touches: each cell's centre plus its corners, with corners shared between
 * neighbouring cells counted once.
 */
export function meshSamplePoints(codes) {
  const points = new Map();
  const add = (lat, lng) => {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!points.has(key)) points.set(key, { lat, lng });
  };
  for (const code of normalizeMeshCodes(codes)) {
    const b = meshBounds(code);
    add((b.south + b.north) / 2, (b.west + b.east) / 2);
  }
  for (const code of normalizeMeshCodes(codes)) {
    const b = meshBounds(code);
    add(b.south, b.west);
    add(b.south, b.east);
    add(b.north, b.west);
    add(b.north, b.east);
  }
  return [...points.values()];
}

function clampIndex(value, maxExclusive) {
  return Math.min(Math.max(value, 0), maxExclusive - 1);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
