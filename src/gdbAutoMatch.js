// Name-based auto-matching for GDB layers -> (building, floor).
//
// This intentionally does not use geometry/position. The previous spatial
// matcher was too eager around nearby buildings, so matching is now based on
// feature source names, layer filenames, building names, and aliases.

import {
  extractFloorNumber,
  levelNameToNumber,
  matchLevelByText,
  groupFeaturesByFloor,
} from "./floorSplit.js";

export {
  extractFloorNumber,
  levelNameToNumber,
  matchLevelByText,
  groupFeaturesByFloor,
};

const BILINGUAL_NAME_ALIASES = [
  ["shinjuku", "新宿"],
  ["shibuya", "渋谷"],
  ["ikebukuro", "池袋"],
  ["tokyo", "東京"],
  ["marunouchi", "丸の内"],
  ["otemachi", "大手町"],
  ["nihonbashi", "日本橋"],
  ["yaesu", "八重洲"],
  ["ginza", "銀座"],
  ["yurakucho", "有楽町"],
  ["akihabara", "秋葉原"],
  ["ueno", "上野"],
  ["shinagawa", "品川"],
  ["takanawa", "高輪"],
  ["roppongi", "六本木"],
  ["akasaka", "赤坂"],
  ["aoyama", "青山"],
  ["harajuku", "原宿"],
  ["ebisu", "恵比寿"],
  ["meguro", "目黒"],
  ["yokohama", "横浜"],
  ["minatomirai", "みなとみらい", "ミナトミライ"],
  ["osaka", "大阪"],
  ["umeda", "梅田"],
  ["namba", "難波", "なんば"],
  ["kyoto", "京都"],
  ["nagoya", "名古屋"],
  ["sapporo", "札幌"],
  ["sendai", "仙台"],
  ["fukuoka", "福岡"],
  ["hakata", "博多"],
  ["lumine", "ルミネ"],
  ["oazo", "オアゾ"],
  ["midtown", "ミッドタウン"],
  ["tower", "タワー"],
  ["station", "駅"],
  ["building", "ビル", "ビルディング"],
];

const BILINGUAL_ALIAS_GROUPS = BILINGUAL_NAME_ALIASES.map((group) =>
  group.map((value) => compactNameText(value)).filter(Boolean)
);
const PLACEHOLDER_SOURCE_VALUES = new Set(["unknown", "unk", "none", "null", "na", "n/a"]);

export function matchLayerToTarget({ filename, features, buildings }) {
  const fileText = stripExt(filename ?? "");
  const source = detectSource(features);
  let best = { buildingIndex: -1, score: 0, text: "" };

  for (let i = 0; i < (buildings ?? []).length; i++) {
    const b = buildings[i];
    const sourceScore = source ? scoreTextAgainstBuilding(source, b) * 2 : 0;
    const fileScore = fileText ? scoreTextAgainstBuilding(fileText, b) : 0;
    const score = sourceScore + fileScore;
    if (score > best.score) {
      best = { buildingIndex: i, score, text: [source, fileText].filter(Boolean).join(" ") };
    }
  }

  if (best.buildingIndex < 0 || best.score <= 0) {
    return { buildingIndex: -1, levelKey: null, confidence: "none" };
  }

  const building = buildings[best.buildingIndex];
  const levelText = [fileText, source].filter(Boolean).join(" ");
  const level = matchLevelByText(levelText, building.levels);
  return {
    buildingIndex: best.buildingIndex,
    levelKey: level ? (level.key ?? "") : null,
    confidence: level ? "high" : "medium",
  };
}

function scoreTextAgainstBuilding(text, building) {
  if (!text || !building) return 0;
  const candidates = buildingCandidateTexts(building);
  let score = 0;
  for (const candidate of candidates) {
    score += scoreTextAgainstCandidate(text, candidate);
  }
  return score;
}

function buildingCandidateTexts(building) {
  const out = [
    building.name,
    ...(Array.isArray(building.aliases) ? building.aliases : []),
  ];
  if (building.linkFilter?.value) out.push(building.linkFilter.value);
  return out.filter(Boolean);
}

function scoreTextAgainstCandidate(text, candidate) {
  const textCompact = compactNameText(text);
  if (!isMeaningfulVariant(textCompact)) return 0;

  const textVariants = buildTextVariants(text);
  const candidateVariants = buildTextVariants(candidate);
  let score = 0;
  const matched = new Set();

  for (const raw of candidateVariants) {
    const variant = compactNameText(raw);
    if (!isMeaningfulVariant(variant) || matched.has(variant)) continue;

    if (textCompact === variant) {
      score += 80 + variant.length;
      matched.add(variant);
      continue;
    }

    if (textCompact.includes(variant)) {
      score += 18 + Math.min(variant.length, 20);
      matched.add(variant);
      continue;
    }

    if (variant.includes(textCompact) && textCompact.length >= 4) {
      score += 10 + Math.min(textCompact.length, 16);
      matched.add(variant);
      continue;
    }

    if (textVariants.has(variant)) {
      score += 14 + Math.min(variant.length, 20);
      matched.add(variant);
    }
  }

  return score;
}

function buildTextVariants(value) {
  const norm = normalizeNameText(value);
  const compact = compactNameText(value);
  const variants = new Set([compact].filter(Boolean));

  for (const token of norm.split(" ")) {
    const compactToken = compactNameText(token);
    if (isMeaningfulVariant(compactToken)) variants.add(compactToken);
  }

  for (const group of BILINGUAL_ALIAS_GROUPS) {
    if (!group.some((alias) => compact.includes(alias))) continue;
    for (const alias of group) {
      if (isMeaningfulVariant(alias)) variants.add(alias);
    }
  }

  return variants;
}

function normalizeNameText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._/\\()[\]{}<>:;,'"`~!?@#$%^&*=+|]+/g, " ")
    .replace(/[‐‒–—－ー-]+/g, " ")
    .replace(/[・、，。]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactNameText(value) {
  return normalizeNameText(value).replace(/\s+/g, "");
}

function isMeaningfulVariant(value) {
  if (!value) return false;
  if (/[^\x00-\x7F]/.test(value)) return value.length >= 1;
  return value.length >= 3;
}

function stripExt(name) {
  return String(name ?? "").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
}

function detectSource(features) {
  if (!features?.length) return null;
  const counts = new Map();
  for (const f of features) {
    const raw = readProp(f?.properties ?? {}, ["source", "Source", "SOURCE"]);
    if (raw == null || raw === "") continue;
    if (isPlaceholderSource(raw)) continue;
    const key = String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

function isPlaceholderSource(value) {
  const normalized = normalizeNameText(value);
  return PLACEHOLDER_SOURCE_VALUES.has(normalized) || PLACEHOLDER_SOURCE_VALUES.has(compactNameText(value));
}

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

function stripFcExt(name) {
  return String(name ?? "").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
}

export function isLevelFeatureClass(fileName) {
  return /_level$/i.test(stripFcExt(fileName));
}

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
        "name",
        "Name",
        "NAME",
        "LEVEL_NAME",
        "short_name",
        "SHORT_NAME",
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

export function detectLayerLevelRef(fileName, levelsByPrefix) {
  const base = stripFcExt(fileName);
  const m = base.match(/^(.*)_[^_]+$/);
  const prefix = (m ? m[1] : base).toLowerCase();
  return levelsByPrefix?.get(prefix) ?? null;
}

export function matchLevelRefToBuildingLevel(ref, building) {
  if (!ref || !building?.levels?.length) return null;
  const levels = building.levels;
  const candidates = [ref.floor, ref.name].filter(Boolean).map(String);

  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    const byString = levels.find((l) => l.name?.toLowerCase() === lower);
    if (byString) return byString;
  }

  for (const cand of candidates) {
    const refNum = extractFloorNumber(cand);
    if (refNum == null) continue;
    const byNum = levels.find((l) => levelNameToNumber(l.name) === refNum);
    if (byNum) return byNum;
  }

  if (Number.isFinite(ref.ordinal)) {
    const ord = ref.ordinal;
    const byOrdPlus1 = levels.find((l) => levelNameToNumber(l.name) === ord + 1);
    if (byOrdPlus1) return byOrdPlus1;
    const byOrd = levels.find((l) => levelNameToNumber(l.name) === ord);
    if (byOrd) return byOrd;
  }

  return null;
}

export function summarizeGeometry(features) {
  if (!features?.length) return "UNKNOWN";
  let poly = 0;
  let line = 0;
  let point = 0;
  let other = 0;
  for (const f of features) {
    const type = f?.geometry?.type;
    if (!type) {
      other++;
    } else if (type === "Polygon" || type === "MultiPolygon") {
      poly++;
    } else if (type === "LineString" || type === "MultiLineString") {
      line++;
    } else if (type === "Point" || type === "MultiPoint") {
      point++;
    } else {
      other++;
    }
  }
  const kinds = [poly, line, point].filter((count) => count > 0).length;
  if (kinds > 1) return "MIXED";
  if (poly > 0) return "POLYGON";
  if (line > 0) return "LINE";
  if (point > 0) return "POINT";
  return other > 0 ? "UNKNOWN" : "UNKNOWN";
}
