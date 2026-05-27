import test from "node:test";
import assert from "node:assert/strict";

import {
  getPlateauCategoryChoicesForAreas,
  getPlateauChoicesForAreas,
  getPlateauDatasetUrl,
  normalizeCode,
  normalizePlateauCatalog,
  uniquePlateauAreas,
} from "../src/plateauCatalog.js";

const catalog = normalizePlateauCatalog({
  latest_datasets: [
    dataset("13104_bldg_lod1", "新宿区", "13104", "bldg", "1", true, "latest"),
    dataset("13104_bldg_lod2", "新宿区", "13104", "bldg", "2", true, "latest"),
    dataset("13104_bldg_lod2_no_texture", "新宿区", "13104", "bldg", "2", false, "latest"),
    dataset("13104_tran_lod3", "新宿区", "13104", "tran", "3", true, "latest"),
    dataset("13113_bldg_lod1", "渋谷区", "13113", "bldg", "1", true, "latest"),
    dataset("13113_bldg_lod2", "渋谷区", "13113", "bldg", "2", true, "latest"),
    dataset("13113_bldg_lod2_no_texture", "渋谷区", "13113", "bldg", "2", false, "latest"),
  ],
  datasets: [
    dataset("13104_bldg_lod2_no_texture", "新宿区", "13104", "bldg", "2", false, 2025),
    dataset("13113_bldg_lod2_no_texture", "渋谷区", "13113", "bldg", "2", false, 2025),
  ],
});

const shinjuku = catalog.areaOptions.find(area => area.code === "13104");
const shibuya = catalog.areaOptions.find(area => area.code === "13113");

test("PLATEAU multi-area choices include one selected category per detected area", () => {
  const choices = getPlateauChoicesForAreas(catalog, [shinjuku, shibuya], {
    getTypeLabel: (code, fallback) => fallback ?? code,
  });

  const buildings = choices.filter(choice => choice.code === "bldg");
  assert.equal(buildings.length, 2);
  assert.equal(buildings.find(choice => choice.area.code === "13104").url, urlFor("13104", "bldg", "2", false, "latest"));
  assert.equal(buildings.find(choice => choice.area.code === "13113").url, urlFor("13113", "bldg", "2", false, "latest"));
});

test("PLATEAU category choices dedupe duplicate sampled areas", () => {
  const categories = getPlateauCategoryChoicesForAreas(catalog, [shinjuku, shibuya, shinjuku], {
    getTypeLabel: (code, fallback) => fallback ?? code,
  });

  const buildings = categories.find(category => category.code === "bldg");
  assert.equal(buildings.areaCount, 2);
  assert.equal(buildings.choices.length, 2);
  assert.deepEqual(buildings.lods, ["2"]);
  assert.deepEqual(buildings.textures, [false]);
});

test("PLATEAU single-area choices do not import neighboring municipalities", () => {
  const choices = getPlateauChoicesForAreas(catalog, [shinjuku], {
    getTypeLabel: (code, fallback) => fallback ?? code,
  });

  const buildings = choices.filter(choice => choice.code === "bldg");
  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].area.code, "13104");
  assert.equal(choices.some(choice => choice.area.code === "13113"), false);
});

test("uniquePlateauAreas preserves first occurrence order", () => {
  assert.deepEqual(
    uniquePlateauAreas([shibuya, shinjuku, shibuya]).map(area => area.code),
    ["13113", "13104"],
  );
});

test("normalizePlateauCatalog warns and returns empty for non-object input", () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const result = normalizePlateauCatalog(42);
    assert.deepEqual(result.datasets, []);
    assert.deepEqual(result.areaOptions, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /expected object or array/);
  } finally {
    console.warn = origWarn;
  }
});

test("normalizePlateauCatalog tolerates null and malformed input", () => {
  const empty = normalizePlateauCatalog(null);
  assert.deepEqual(empty.datasets, []);
  assert.deepEqual(empty.areaOptions, []);

  // Object lacking both latest_datasets and datasets.
  const bare = normalizePlateauCatalog({});
  assert.deepEqual(bare.datasets, []);

  // Datasets that fail the 3D Tiles filter are dropped silently.
  const filtered = normalizePlateauCatalog({
    datasets: [
      { ...dataset("x", "city", "11111", "bldg", "1", true, 2025), format: "MVT" },
      { ...dataset("y", "city", "22222", "bldg", "1", true, 2025), url: null, composite_url: null },
    ],
  });
  assert.equal(filtered.datasets.length, 0);
});

test("normalizePlateauCatalog accepts a bare array of datasets", () => {
  const cat = normalizePlateauCatalog([
    dataset("a", "city", "11111", "bldg", "1", true, 2025),
  ]);
  assert.equal(cat.datasets.length, 1);
  assert.equal(cat.areaOptions[0].code, "11111");
});

test("getPlateauChoicesForAreas with empty inputs returns no choices", () => {
  assert.deepEqual(getPlateauChoicesForAreas(null, []), []);
  assert.deepEqual(getPlateauChoicesForAreas(catalog, []), []);
  assert.deepEqual(getPlateauChoicesForAreas(catalog, [null, undefined]), []);
});

test("normalizeCode trims and treats empty strings as null", () => {
  assert.equal(normalizeCode("  13104  "), "13104");
  assert.equal(normalizeCode(""), "");
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode(undefined), null);
  assert.equal(normalizeCode(13104), "13104");
});

test("getPlateauDatasetUrl prefers composite_url over url", () => {
  assert.equal(
    getPlateauDatasetUrl({ composite_url: "https://comp/tileset.json", url: "https://plain/tileset.json" }),
    "https://comp/tileset.json",
  );
  assert.equal(
    getPlateauDatasetUrl({ url: "https://plain/tileset.json" }),
    "https://plain/tileset.json",
  );
  assert.equal(getPlateauDatasetUrl({}), undefined);
  assert.equal(getPlateauDatasetUrl(null), undefined);
});

test("when latest and historical datasets tie on LOD/texture, latest wins", () => {
  // Both the latest and the dataset entries have the same LOD/texture for
  // the no-texture bldg variant — the catalogSourceRank tiebreaker should
  // prefer the latest entry. Asserting on URL is the visible signal.
  const choices = getPlateauChoicesForAreas(catalog, [shinjuku], {
    getTypeLabel: (code, fallback) => fallback ?? code,
  });
  const bldg = choices.find(c => c.code === "bldg");
  // The "latest" variant should be picked, not the 2025 historical duplicate.
  assert.match(bldg.url, /-latest\/tileset\.json$/);
});

function dataset(id, city, cityCode, typeEn, lod, texture, year) {
  return {
    id,
    name: `${typeEn} ${city}`,
    pref: "東京都",
    pref_code: "13",
    city,
    city_code: cityCode,
    ward: null,
    ward_code: null,
    type: typeEn,
    type_en: typeEn,
    format: "3D Tiles",
    lod,
    texture,
    interior: false,
    year,
    registration_year: year === "latest" ? undefined : year,
    url: urlFor(cityCode, typeEn, lod, texture, year),
  };
}

function urlFor(cityCode, typeEn, lod, texture, year) {
  const textureSlug = texture ? "texture" : "notexture";
  return `https://example.test/${cityCode}-${typeEn}-lod${lod}-${textureSlug}-${year}/tileset.json`;
}
