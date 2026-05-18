// Floor-aware splitting for staged shapefile/GDB feature collections.
//
// A staged layer may contain features that belong to multiple floors,
// distinguished by a `floor` property (e.g. "1F", "B1"). When the user
// drops such a layer onto a building, we split it into per-floor child
// layers and match each group to the corresponding building level.

// Build the synonym table: floor number → all textual forms we expect.
function buildFloorSynonyms() {
  const map = new Map();
  for (let n = 1; n <= 60; n++) {
    const variants = [`${n}f`, `f${n}`, `${n}階`, `${n}fl`, `${n}floor`, `floor${n}`, `${n}`];
    if (n === 1) variants.push("gf", "g階", "ground");
    map.set(n, variants);
  }
  for (let n = 1; n <= 10; n++) {
    map.set(-n, [
      `b${n}`, `b${n}f`, `b${n}fl`, `b${n}floor`,
      `${n}b`, `bf${n}`,
      `地下${n}階`, `地下${n}f`, `地下${n}fl`,
      `basement${n}`,
    ]);
  }
  return map;
}

const FLOOR_SYNONYMS = buildFloorSynonyms();

const SYNONYM_LOOKUP = (() => {
  const lookup = new Map();
  for (const [num, variants] of FLOOR_SYNONYMS) {
    for (const v of variants) lookup.set(v.toLowerCase(), num);
  }
  return lookup;
})();

// Token-equality extractor: split on `_-\s.`, return synonym number for the
// longest token that is itself a known synonym key.
export function extractFloorNumber(text) {
  if (!text) return null;
  const tokens = String(text).toLowerCase().split(/[_\-\s.]+/).filter(Boolean);
  if (!tokens.length) return null;
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  for (const tok of ordered) {
    const num = SYNONYM_LOOKUP.get(tok);
    if (num !== undefined) return num;
  }
  return null;
}

// Return the leading token of a level name, split on `_`, whitespace, and
// (half- or full-width) opening parens. Useful as a clean display name when a
// dataset embeds extra metadata in the level string:
//   "B1FL_long_name(TP+36)" → "B1FL"
//   "B2FL(1FL)"             → "B2FL"
//   "1F"                    → "1F"
export function shortLevelName(name) {
  if (!name) return name;
  const first = String(name).split(/[_\s（(　]+/, 1)[0];
  return first || String(name);
}

export function levelNameToNumber(name) {
  if (!name) return null;
  // Use only the leading token (before any underscore, whitespace, or paren).
  // Level names in some datasets append a "(TP±X.Y)" suffix where bare digits
  // would otherwise be picked up by the bare-digit synonym (e.g.
  // "B2FL(1FL)_…(TP-5.11)" → tokenization grabs the "5" and returns 5).
  // The first token is where the real floor designation lives.
  return extractFloorNumber(shortLevelName(name));
}

// Match a floor display value (e.g. "1F", "B2") to one level inside a
// building. Returns the level object or null.
export function matchLevelByText(text, levels) {
  if (!levels?.length) return null;
  const num = extractFloorNumber(text);
  if (num == null) return null;
  for (const lvl of levels) {
    if (levelNameToNumber(lvl.name) === num) return lvl;
  }
  return null;
}

// Tolerant case-insensitive property reader.
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

// Group features by `properties.floor` value. Returns
//   Array<{ floorValue, key, features }>
// in first-appearance order. `floorValue` is the first non-empty original-case
// string seen; `key` is its lowercased trimmed form (empty for "no floor").
export function groupFeaturesByFloor(features) {
  if (!Array.isArray(features) || features.length === 0) return [];
  const groups = new Map();
  for (const f of features) {
    const raw = readProp(f?.properties ?? {}, ["floor", "Floor", "FLOOR"]);
    const display = raw == null ? null : String(raw).trim();
    const key = display ? display.toLowerCase() : "";
    let group = groups.get(key);
    if (!group) {
      group = { floorValue: display || null, key, features: [] };
      groups.set(key, group);
    } else if (!group.floorValue && display) {
      group.floorValue = display;
    }
    group.features.push(f);
  }
  return [...groups.values()];
}
