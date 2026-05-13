// Auto-matching for GDB layers → (building, floor).
//
// The matcher takes a parsed FeatureCollection and a list of buildings and
// returns its best guess at which building + floor the layer belongs in.
// Signals used, in order of preference:
//   1. properties.source on features (a Revit link name — already used by the
//      existing shapefile path via detectShapefileSource).
//   2. Substring match of the filename against building.name or building.aliases[].
//   3. Floor name / synonym match against the chosen building's levels.
//
// Both English and Japanese floor name forms are recognized via FLOOR_SYNONYMS.

// Floor synonym table. Maps a floor number to every textual form we expect to
// see in filenames or properties. Numbers are signed (positive = above ground,
// negative = below). Keep entries lowercased; matching is case-insensitive.
function buildFloorSynonyms() {
  const map = new Map(); // number -> Array<string>
  // Above-ground 1..60
  for (let n = 1; n <= 60; n++) {
    const variants = [
      `${n}f`,
      `f${n}`,
      `${n}階`,
      `${n}fl`,
      `${n}floor`,
      `floor${n}`,
      `${n}`,            // bare digit token, e.g. "5" in "Marubiru_5_Floor"
    ];
    if (n === 1) variants.push("gf", "g階", "ground");
    map.set(n, variants);
  }
  // Below-ground -1..-10
  for (let n = 1; n <= 10; n++) {
    map.set(-n, [
      `b${n}`,
      `b${n}f`,
      `${n}b`,
      `bf${n}`,
      `地下${n}階`,
      `地下${n}f`,
      `basement${n}`,
    ]);
  }
  return map;
}

export const FLOOR_SYNONYMS = buildFloorSynonyms();

// Build a reverse lookup: synonym (lowercase) -> floor number.
function buildSynonymLookup() {
  const lookup = new Map();
  for (const [num, variants] of FLOOR_SYNONYMS) {
    for (const v of variants) lookup.set(v.toLowerCase(), num);
  }
  return lookup;
}
const SYNONYM_LOOKUP = buildSynonymLookup();

// Extract a floor number from a string by token-equality: split on `_-\s.`
// and return the synonym number for the longest token that is itself a known
// synonym key. Token-only matching avoids cross-token false matches when bare
// digits are in play (so "M2" does NOT match floor-2 via the embedded "2",
// and a year like "2023" doesn't match floor-23). Single-token inputs like
// "B1F" or "5F" still work because they ARE synonym keys.
export function extractFloorNumber(text) {
  if (!text) return null;
  const tokens = String(text).toLowerCase().split(/[_\-\s.]+/).filter(Boolean);
  if (!tokens.length) return null;
  // Longest-first so "b1f" beats "1f" when both appear.
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  for (const tok of ordered) {
    const num = SYNONYM_LOOKUP.get(tok);
    if (num !== undefined) return num;
  }
  return null;
}

// Given a level's display name (e.g. "1F", "B1", "2階"), return its numeric
// form so it can be compared against extractFloorNumber output.
export function levelNameToNumber(name) {
  if (!name) return null;
  return extractFloorNumber(String(name));
}

// Find the best level within a building for a given filename/text.
// Returns the level object or null.
export function matchLevelByText(text, levels) {
  if (!levels?.length) return null;
  const num = extractFloorNumber(text);
  if (num == null) return null;
  for (const lvl of levels) {
    if (levelNameToNumber(lvl.name) === num) return lvl;
  }
  return null;
}

// Match a feature collection to one of the buildings.
// Inputs:
//   filename   - the FeatureCollection's fileName (e.g. "Shinjuku_LUMINE1_1F.shp")
//   features   - the raw feature array (for properties.source and spatial signals)
//   buildings  - the buildings[] list (each with name, levels, optional aliases)
//   footprints - optional, array parallel to buildings[] giving each building's
//                projected lon/lat disk. When present, the matcher uses it as a
//                high-priority signal (geometric truth) over filename/alias.
// Output: { buildingIndex, levelKey, confidence }
//   buildingIndex: index into buildings, or -1 if no match
//   levelKey: matched level's key, "" for All Floors, null when no floor match
//   confidence: "high" | "medium" | "none"
export function matchLayerToTarget({ filename, features, buildings, footprints = null }) {
  const base = stripExt(filename ?? "").toLowerCase();

  // Strategy 1: source property on features (Revit link name).
  const source = detectSource(features);
  if (source) {
    const srcLower = source.toLowerCase();
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (matchesBuilding(srcLower, b)) {
        const lvl = matchLevelByText(base || srcLower, b.levels);
        return {
          buildingIndex: i,
          levelKey: lvl ? (lvl.key ?? "") : null,
          confidence: lvl ? "high" : "medium",
        };
      }
    }
  }

  // Strategy 2: spatial overlap. Geometric truth — wins over filename/alias
  // when both are available. levelKey is left to the dialog's per-prefix
  // _Floor / _level resolution (resolveFloorFromOrdinal).
  if (footprints) {
    const spatial = matchLayerSpatial(features, footprints);
    if (spatial.buildingIndex >= 0 && spatial.voteShare > 0.5) {
      return {
        buildingIndex: spatial.buildingIndex,
        levelKey: null,
        confidence: "high",
      };
    }
  }

  // Strategy 3: filename contains a building name or alias.
  if (base) {
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (matchesBuilding(base, b)) {
        const lvl = matchLevelByText(base, b.levels);
        return {
          buildingIndex: i,
          levelKey: lvl ? (lvl.key ?? "") : null,
          confidence: lvl ? "high" : "medium",
        };
      }
    }
  }

  // No match.
  return { buildingIndex: -1, levelKey: null, confidence: "none" };
}

function stripExt(name) {
  return name.replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
}

// Case-insensitive substring match of `haystack` against a building's
// name or any of its aliases.
function matchesBuilding(haystack, building) {
  if (!building?.name) return false;
  if (haystack.includes(building.name.toLowerCase())) return true;
  const aliases = Array.isArray(building.aliases) ? building.aliases : [];
  for (const a of aliases) {
    if (a && haystack.includes(String(a).toLowerCase())) return true;
  }
  return false;
}

// Coarse centroid of a GeoJSON feature in [lon, lat] degrees. Walks the
// geometry's nested coordinate arrays and returns the unweighted mean of
// every [lon, lat] pair encountered. Handles Point / LineString / Polygon
// and the Multi* variants by recursive flattening. Returns null when the
// geometry has no usable coordinates or coordinates fall outside the valid
// WGS84 range (defensive against parser/CRS glitches).
export function featureCentroid(feature) {
  const coords = feature?.geometry?.coordinates;
  if (coords == null) return null;
  let sumLon = 0;
  let sumLat = 0;
  let count = 0;
  const visit = (node) => {
    if (!Array.isArray(node)) return;
    // A leaf coordinate is [lon, lat] or [lon, lat, alt] — numbers, not arrays.
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const lon = node[0];
      const lat = node[1];
      if (Number.isFinite(lon) && Number.isFinite(lat) &&
          lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
        sumLon += lon;
        sumLat += lat;
        count++;
      }
      return;
    }
    for (const child of node) visit(child);
  };
  visit(coords);
  if (count === 0) return null;
  return { lon: sumLon / count, lat: sumLat / count };
}

// Vote across a layer's features for the building whose lon/lat disk
// contains each feature centroid. Tie-break per centroid (a centroid inside
// multiple disks): pick the building with the SMALLEST disk area — this
// prefers the most specific building when a big building (e.g. JRTokyoSt)
// encompasses several smaller adjacent ones. Secondary tie-break (genuinely
// same-sized disks): closest center. If no disk contains a centroid, that
// feature casts no vote.
//
// Inputs:
//   features    — FeatureCollection.features array
//   footprints  — array parallel to buildings[], entries shaped
//                 { lon, lat, dLon, dLat } or null when no sphere is known
//   maxSamples  — cap on features sampled (evenly spaced, default 50)
//
// Returns { buildingIndex, voteShare } where voteShare is the winning
// building's fraction of cast votes ∈ [0, 1]. buildingIndex is -1 when no
// votes were cast (no usable footprints, or all centroids fell outside).
export function matchLayerSpatial(features, footprints, maxSamples = 50) {
  if (!Array.isArray(features) || features.length === 0) return { buildingIndex: -1, voteShare: 0 };
  if (!Array.isArray(footprints) || !footprints.some((f) => f)) return { buildingIndex: -1, voteShare: 0 };

  // Evenly-spaced sample indices to keep cost bounded on very large layers.
  const step = Math.max(1, Math.floor(features.length / maxSamples));
  const votes = new Map(); // buildingIndex -> count
  let cast = 0;

  for (let i = 0; i < features.length; i += step) {
    const c = featureCentroid(features[i]);
    if (!c) continue;
    let best = -1;
    let bestArea = Infinity;
    let bestDistSq = Infinity;
    for (let bi = 0; bi < footprints.length; bi++) {
      const fp = footprints[bi];
      if (!fp) continue;
      const dLon = c.lon - fp.lon;
      const dLat = c.lat - fp.lat;
      // Inside the disk if (dLon/fp.dLon)^2 + (dLat/fp.dLat)^2 <= 1.
      const nx = dLon / fp.dLon;
      const ny = dLat / fp.dLat;
      if (nx * nx + ny * ny > 1) continue;
      // Primary: smallest containing disk (area in degrees² is proportional
      // to true area for buildings in the same metro region).
      // Secondary: closest center for genuinely same-sized adjacent disks.
      const area = fp.dLon * fp.dLat;
      const dSq = dLon * dLon + dLat * dLat;
      if (area < bestArea || (area === bestArea && dSq < bestDistSq)) {
        bestArea = area;
        bestDistSq = dSq;
        best = bi;
      }
    }
    if (best >= 0) {
      votes.set(best, (votes.get(best) ?? 0) + 1);
      cast++;
    }
  }

  if (cast === 0) return { buildingIndex: -1, voteShare: 0 };
  let winner = -1;
  let winnerVotes = 0;
  for (const [bi, v] of votes) {
    if (v > winnerVotes) {
      winnerVotes = v;
      winner = bi;
    }
  }
  return { buildingIndex: winner, voteShare: winnerVotes / cast };
}

// Find the dominant `properties.source` value across features.
function detectSource(features) {
  if (!features?.length) return null;
  const counts = new Map();
  for (const f of features) {
    const raw = f?.properties?.source;
    if (raw == null || raw === "") continue;
    const key = String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

// Tolerant case-insensitive property reader. Returns the first non-null value
// found among the listed property names. Tries exact case first, then a
// lower-cased key search. Empty strings are treated as missing.
function readProp(row, names) {
  if (!row) return null;
  for (const n of names) {
    const v = row[n];
    if (v != null && v !== "") return v;
  }
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const k = lower.get(n.toLowerCase());
    if (k != null && row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

// Strip .shp/.dbf/.prj/.geojson/.json extensions from a filename.
function stripFcExt(name) {
  return (name ?? "").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
}

// Returns true if this FC's filename indicates it is a "*_level" metadata
// feature class (one row holding ordinal/name for that prefix's floor).
export function isLevelFeatureClass(fileName) {
  return /_level$/i.test(stripFcExt(fileName));
}

// Walk featureCollections to build a per-prefix lookup of floor metadata.
// Two complementary signals are gathered:
//   - "*_level" FCs contribute { ordinal, name } from their single row.
//   - "*_Floor" FCs contribute { floor } from the first feature's `floor`
//     column. (_Floor FCs are also real geometry that gets imported as-is —
//     this just additionally reads the metadata column.)
// Returns a Map<prefixLowercase, { ordinal, name, floor }>. Both sources are
// tolerant of varying property casing.
export function buildLevelsByPrefix(featureCollections) {
  const map = new Map();
  const ensure = (prefix) => {
    let entry = map.get(prefix);
    if (!entry) {
      entry = { ordinal: null, name: null, floor: null };
      map.set(prefix, entry);
    }
    return entry;
  };

  for (const fc of featureCollections ?? []) {
    const base = stripFcExt(fc?.fileName);
    if (!base) continue;
    const row = (fc.features ?? [])[0]?.properties ?? {};

    if (/_level$/i.test(base)) {
      const prefix = base.replace(/_level$/i, "").toLowerCase();
      const entry = ensure(prefix);
      const ordinalRaw = readProp(row, ["ordinal", "Ordinal", "ORDINAL", "VERTICAL_ORDER"]);
      const nameRaw = readProp(row, [
        "name", "Name", "NAME", "LEVEL_NAME", "short_name", "SHORT_NAME",
      ]);
      const ordinal = ordinalRaw == null ? null : Number(ordinalRaw);
      if (Number.isFinite(ordinal)) entry.ordinal = ordinal;
      if (nameRaw != null) entry.name = String(nameRaw);
    } else if (/_floor$/i.test(base)) {
      const prefix = base.replace(/_floor$/i, "").toLowerCase();
      const entry = ensure(prefix);
      const floorRaw = readProp(row, ["floor", "Floor", "FLOOR"]);
      if (floorRaw != null) entry.floor = String(floorRaw);
    }
  }
  return map;
}

// For a non-level FC, derive its filename prefix (everything before the last
// "_<category>" segment) and look up the matching entry in levelsByPrefix.
// Returns { ordinal, name } or null.
export function detectLayerLevelRef(fileName, levelsByPrefix) {
  const base = stripFcExt(fileName);
  const m = base.match(/^(.*)_[^_]+$/);
  const prefix = (m ? m[1] : base).toLowerCase();
  return levelsByPrefix?.get(prefix) ?? null;
}

// Match a level reference from the GDB to one level in the chosen 3D Tiles
// building. The ref shape is { ordinal, name, floor } where:
//   - name  : from a "_level" FC's `name` / `short_name` column (e.g. "B2")
//   - floor : from a "_Floor" FC's `floor` column            (e.g. "F5")
//   - ordinal: from a "_level" FC's `ordinal` column         (e.g. -1)
// Strategy, in order:
//   1. Direct case-insensitive string equality of ref.floor / ref.name vs a
//      building level's name. Avoids "M2" → "2F" collision.
//   2. Numeric: extractFloorNumber on the GDB string equals levelNameToNumber
//      on a building level's name.
//   3. Ordinal+1 (Esri convention: 0=1F, -1=B1), then plain ordinal.
// Returns the matched level (with .key) or null.
export function matchLevelRefToBuildingLevel(ref, building) {
  if (!ref || !building?.levels?.length) return null;
  const levels = building.levels;

  const candidates = [ref.floor, ref.name].filter(Boolean).map(String);

  // 1. Exact case-insensitive string equality.
  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    const byString = levels.find((l) => l.name?.toLowerCase() === lower);
    if (byString) return byString;
  }
  // 2. Numeric match.
  for (const cand of candidates) {
    const refNum = extractFloorNumber(cand);
    if (refNum == null) continue;
    const byNum = levels.find((l) => levelNameToNumber(l.name) === refNum);
    if (byNum) return byNum;
  }
  // 3. Ordinal match.
  if (Number.isFinite(ref.ordinal)) {
    const ord = ref.ordinal;
    const byOrdPlus1 = levels.find((l) => levelNameToNumber(l.name) === ord + 1);
    if (byOrdPlus1) return byOrdPlus1;
    const byOrd = levels.find((l) => levelNameToNumber(l.name) === ord);
    if (byOrd) return byOrd;
  }
  return null;
}

// Group features by their own `properties.floor` value. Used when one FC
// (e.g. point_facility) contains features that span multiple floors and
// should be split into per-floor sub-layers at import time.
//
// Returns Array<{ floorValue, key, features }> in first-appearance order.
//   - floorValue: the first non-empty original-case string seen for this
//     group (e.g. "1F", "B1"); null when features have no usable floor prop.
//   - key: normalized grouping key (lowercased, trimmed); empty string for
//     the "(no floor)" group.
//   - features: features that belong to the group, in source order.
//
// Property name casing is tolerated the same way readProp / buildLevelsByPrefix
// already handle it ("floor" / "Floor" / "FLOOR" plus a lowercased fallback).
export function groupFeaturesByFloor(features) {
  if (!Array.isArray(features) || features.length === 0) return [];
  const groups = new Map(); // key -> { floorValue, key, features }
  for (const f of features) {
    const raw = readProp(f?.properties ?? {}, ["floor", "Floor", "FLOOR"]);
    const display = raw == null ? null : String(raw).trim();
    const key = display ? display.toLowerCase() : "";
    let group = groups.get(key);
    if (!group) {
      group = { floorValue: display || null, key, features: [] };
      groups.set(key, group);
    } else if (!group.floorValue && display) {
      // Promote the first non-empty display string we see.
      group.floorValue = display;
    }
    group.features.push(f);
  }
  return [...groups.values()];
}

// Determine the dominant geometry type across a feature collection's features.
// Returns one of "POLYGON" | "LINE" | "POINT" | "MIXED" | "UNKNOWN".
export function summarizeGeometry(features) {
  if (!features?.length) return "UNKNOWN";
  let poly = 0, line = 0, point = 0, other = 0;
  for (const f of features) {
    const t = f?.geometry?.type;
    if (!t) { other++; continue; }
    if (t === "Polygon" || t === "MultiPolygon") poly++;
    else if (t === "LineString" || t === "MultiLineString") line++;
    else if (t === "Point" || t === "MultiPoint") point++;
    else other++;
  }
  const kinds = [poly, line, point].filter(c => c > 0).length;
  if (kinds > 1) return "MIXED";
  if (poly > 0) return "POLYGON";
  if (line > 0) return "LINE";
  if (point > 0) return "POINT";
  return "UNKNOWN";
}
