// Assign GDB/GeoPackage feature groups to building levels.
//
// A floor code like "B1" usually matches many Revit levels (a station model
// has a "B1F_…" level per metro line and a few "B1FL_…" concourses), and the
// level decides the height icons are drawn at. So after matching the floor
// number, rank the candidates:
//   1. altitude — features with an `altitude` (metres TP) pick the level
//      whose TP height is closest. Level TP heights come from names like
//      "1FL_コンコース（TP+3.45）", calibrated against the level elevations.
//   2. line hint — a prefixed code ("KB3" = Keiyō line B3) prefers levels
//      named after that line.
//   3. canonical — the plain level ("B1FL", "1FL") over line-specific ones,
//      then the level with the most elements.
// Pure: no DOM, no Cesium.

import {
  extractFloorNumber,
  extractFloorPrefix,
  groupFeaturesByFloor,
  levelNameToNumber,
} from "./floorSplit.js";

// Known line prefixes → words that appear in the matching level names.
const LINE_PREFIX_HINTS = {
  K: ["京葉", "keiyo", "keiyou"],
  S: ["総武", "sobu", "soubu"],
};

const ALTITUDE_PROPERTIES = ["altitude", "Altitude", "ALTITUDE", "elevation", "Elevation"];
// A group whose altitude is further than this from every candidate level is
// probably in a different vertical datum; ignore altitude for it.
const MAX_ALTITUDE_GAP_M = 6;
// Without a floor-number match, only accept an altitude match this close.
const ALTITUDE_ONLY_MAX_GAP_M = 1;

/** Parse the TP (Tokyo Peil) height in a level name, in metres. */
export function parseLevelTpMeters(name) {
  const match = /TP\s*([+\-−±])\s*([\d.,]+)/i.exec(String(name ?? ""));
  if (!match) return null;
  if (match[1] === "±") return 0;
  let value = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  // "TP+3.45" is metres; "TP-4,130" and "TP+150" are millimetres.
  if (match[2].includes(",") || value > 50) value /= 1000;
  return match[1] === "+" ? value : -value;
}

/**
 * Offset between level elevations and TP, from the levels whose names carry
 * a TP height (median, so a few odd names don't skew it). Null when fewer
 * than two levels agree.
 */
export function levelTpOffset(levels) {
  const offsets = [];
  for (const level of levels ?? []) {
    const tp = parseLevelTpMeters(level.name);
    if (tp != null && Number.isFinite(level.floor)) offsets.push(level.floor - tp);
  }
  if (offsets.length < 2) return null;
  const offset = median(offsets);
  const agreeing = offsets.filter((o) => Math.abs(o - offset) < 0.5).length;
  return agreeing >= 2 ? offset : null;
}

export function featureGroupAltitude(features) {
  const values = [];
  for (const feature of features ?? []) {
    const props = feature?.properties ?? {};
    for (const name of ALTITUDE_PROPERTIES) {
      const raw = props[name];
      if (raw == null || raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) {
        values.push(n);
        break;
      }
    }
  }
  return values.length ? median(values) : null;
}

/** "KB3", "kb3f" → "K:-3"; "1F", "F1" → ":1". Null when not a floor code. */
export function floorCodeKey(floorValue) {
  const number = extractFloorNumber(floorValue);
  if (number == null) return null;
  return `${extractFloorPrefix(floorValue) ?? ""}:${number}`;
}

/**
 * Median altitude per floor code across a whole import, so layers without
 * an altitude column (e.g. Facility_Merge) can borrow it from layers that
 * have one for the same floors (e.g. point_facility).
 * @param {Array<{ features }>} featureCollections
 * @returns {Map<string, number>} floorCodeKey → altitude
 */
export function buildFloorAltitudeHints(featureCollections) {
  const byKey = new Map();
  for (const fc of featureCollections ?? []) {
    for (const group of groupFeaturesByFloor(fc?.features ?? [])) {
      const key = floorCodeKey(group.floorValue);
      const altitude = key ? featureGroupAltitude(group.features) : null;
      if (altitude == null) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(...Array(group.features.length).fill(altitude));
    }
  }
  return new Map([...byKey].map(([key, values]) => [key, median(values)]));
}

/**
 * @param {object} options
 * @param {Map<string, number>} [options.altitudeHints] from buildFloorAltitudeHints
 * @returns {{ level: object, reason: "altitude"|"line"|"canonical"|"only" } | null}
 */
export function resolveFloorLevel({ floorValue, features = [], levels = [], altitudeHints = null }) {
  if (!levels?.length) return null;
  const number = extractFloorNumber(floorValue);
  const altitude = featureGroupAltitude(features) ?? altitudeHints?.get(floorCodeKey(floorValue)) ?? null;
  const tpOffset = altitude != null ? levelTpOffset(levels) : null;
  const levelTp = (level) => level.floor - tpOffset;

  const candidates = number == null ? [] : levels.filter((l) => levelNameToNumber(l.name) === number);

  if (candidates.length === 0) {
    if (altitude == null || tpOffset == null) return null;
    const nearest = nearestBy(levels, (l) => Math.abs(levelTp(l) - altitude));
    return nearest && Math.abs(levelTp(nearest) - altitude) <= ALTITUDE_ONLY_MAX_GAP_M
      ? { level: nearest, reason: "altitude" }
      : null;
  }
  if (candidates.length === 1) return { level: candidates[0], reason: "only" };

  let pool = candidates;
  const hints = LINE_PREFIX_HINTS[extractFloorPrefix(floorValue)] ?? null;
  if (hints) {
    const hinted = pool.filter((l) => hints.some((h) => String(l.name).toLowerCase().includes(h)));
    if (hinted.length) pool = hinted;
  }

  if (altitude != null && tpOffset != null) {
    const nearest = nearestBy(pool, (l) => Math.abs(levelTp(l) - altitude));
    if (nearest && Math.abs(levelTp(nearest) - altitude) <= MAX_ALTITUDE_GAP_M) {
      return { level: nearest, reason: "altitude" };
    }
  }
  if (hints && pool !== candidates) return { level: pickCanonical(pool, number), reason: "line" };
  return { level: pickCanonical(pool, number), reason: "canonical" };
}

// Prefer a level whose short name is just the floor code ("B1FL"), then the
// busiest level: line-specific levels ("B1F_丸の内線…") tend to be smaller.
function pickCanonical(levels, number) {
  const plain = levels.filter((l) => isPlainFloorName(l.name, number));
  const pool = plain.length ? plain : levels;
  return [...pool].sort((a, b) => (b.elementCount ?? 0) - (a.elementCount ?? 0))[0];
}

// "B1FL" and "M2FL（TP+4.45）" are plain; "B1FL_八重洲地下街" is not.
function isPlainFloorName(name, number) {
  const bare = String(name ?? "").replace(/[（(]\s*TP[^）)]*[）)]/i, "").trim();
  return /^[a-z]*\d+[a-z]*$/i.test(bare) && extractFloorNumber(bare) === number;
}

/**
 * Split a feature collection by its floor values and resolve each group.
 * @returns {Array<{ floorValue, features, level, reason }>} in first-seen
 *   order; `level` is null for groups that did not resolve.
 */
export function splitByFloorLevel(features, levels, { altitudeHints = null } = {}) {
  return groupFeaturesByFloor(features).map((group) => {
    const resolved = group.floorValue
      ? resolveFloorLevel({ floorValue: group.floorValue, features: group.features, levels, altitudeHints })
      : null;
    return {
      floorValue: group.floorValue,
      features: group.features,
      level: resolved?.level ?? null,
      reason: resolved?.reason ?? null,
    };
  });
}

function nearestBy(items, distance) {
  let best = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const d = distance(item);
    if (d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
