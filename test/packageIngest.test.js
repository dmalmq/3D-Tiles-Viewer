import test from "node:test";
import assert from "node:assert/strict";

import {
  parsePackageManifestText,
  indexPackageFiles,
  buildGisDecisions,
  computeLevelLocalPlanes,
} from "../src/packageIngest.js";

function manifestJson(overrides = {}) {
  return JSON.stringify({
    schema: "revitgeosuite.cesium-package",
    version: 1,
    packageId: "pkg-1",
    building: { id: "tower-abc123", name: "Tower", aliases: ["タワー"] },
    tiles: { tileset: "tiles/tileset.json", levels: "tiles/levels.json" },
    gis: { format: "geopackage", artifacts: [{ path: "gis/tower.gpkg" }] },
    levelMap: [
      { gisLevelId: "lvl-1", tilesLevelKey: "1f", name: "1F" },
      { gisLevelId: "lvl-2", tilesLevelKey: "2f", name: "2F" },
    ],
    ...overrides,
  });
}

test("parsePackageManifestText validates schema and version", () => {
  const manifest = parsePackageManifestText(manifestJson());
  assert.equal(manifest.building.id, "tower-abc123");

  assert.throws(() => parsePackageManifestText('{"schema":"other","version":1}'), /schema/i);
  assert.throws(
    () => parsePackageManifestText('{"schema":"revitgeosuite.cesium-package","version":99}'),
    /version/i
  );
  assert.throws(() => parsePackageManifestText("not json"), /json/i);
});

function mkFile(relativePath, content = "") {
  const name = relativePath.split("/").pop();
  return { name, relativePath, text: async () => content };
}

test("indexPackageFiles resolves package-relative paths from a dropped folder", async () => {
  const files = [
    mkFile("Tower-cesium/cesium-package.json", manifestJson()),
    mkFile("Tower-cesium/tiles/tileset.json", "{}"),
    mkFile("Tower-cesium/tiles/content.glb"),
    mkFile("Tower-cesium/tiles/levels.json", "{}"),
    mkFile("Tower-cesium/gis/tower.gpkg"),
  ];

  const pkg = await indexPackageFiles(files);
  assert.equal(pkg.manifest.packageId, "pkg-1");
  assert.equal(pkg.resolve("tiles/tileset.json").name, "tileset.json");
  assert.equal(pkg.resolve("gis/tower.gpkg").name, "tower.gpkg");
  assert.equal(pkg.resolve("missing/nope.txt"), null);

  const tileFiles = pkg.listUnder("tiles/");
  assert.equal(tileFiles.length, 3);
});

test("indexPackageFiles works when files are dropped without a wrapping folder", async () => {
  const files = [
    mkFile("cesium-package.json", manifestJson()),
    mkFile("tiles/tileset.json", "{}"),
  ];
  const pkg = await indexPackageFiles(files);
  assert.equal(pkg.resolve("tiles/tileset.json").name, "tileset.json");
});

test("indexPackageFiles throws without a manifest", async () => {
  await assert.rejects(indexPackageFiles([mkFile("tiles/tileset.json")]), /cesium-package\.json/i);
});

test("buildGisDecisions maps features to exact level keys via levelMap", () => {
  const manifest = JSON.parse(manifestJson());
  const fc = {
    fileName: "unit",
    features: [
      { type: "Feature", properties: { level_id: "lvl-1" }, geometry: { type: "Polygon", coordinates: [] } },
      { type: "Feature", properties: { level_id: "lvl-1" }, geometry: { type: "Polygon", coordinates: [] } },
      { type: "Feature", properties: { level_id: "lvl-2" }, geometry: { type: "Polygon", coordinates: [] } },
    ],
  };

  const { decisions, unmatchedCount } = buildGisDecisions([fc], manifest, 7);
  assert.equal(unmatchedCount, 0);
  assert.equal(decisions.length, 2);

  const byLevel = new Map(decisions.map((d) => [d.target.levelKey, d]));
  assert.equal(byLevel.get("1f").fc.features.length, 2);
  assert.equal(byLevel.get("2f").fc.features.length, 1);
  assert.equal(byLevel.get("1f").target.kind, "building");
  assert.equal(byLevel.get("1f").target.buildingIndex, 7);
  assert.equal(byLevel.get("1f").nameOverride, "unit (1F)");
});

test("buildGisDecisions routes unknown level ids to unassigned", () => {
  const manifest = JSON.parse(manifestJson());
  const fc = {
    fileName: "unit",
    features: [
      { type: "Feature", properties: { level_id: "lvl-unknown" }, geometry: { type: "Polygon", coordinates: [] } },
    ],
  };

  const { decisions, unmatchedCount } = buildGisDecisions([fc], manifest, 0);
  assert.equal(unmatchedCount, 1);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].target.kind, "unassigned");
});

test("buildGisDecisions skips the level layer (metadata only)", () => {
  const manifest = JSON.parse(manifestJson());
  const fc = {
    fileName: "level",
    features: [
      { type: "Feature", properties: { id: "lvl-1" }, geometry: { type: "Polygon", coordinates: [] } },
    ],
  };

  const { decisions } = buildGisDecisions([fc], manifest, 0);
  assert.equal(decisions.length, 0);
});

// Real Shinjuku_LUMINE1 export: levelElevationMeters sits ~38.7m above the
// tileset-local geometry frame (minZMeters). The level ladder spacing is exact,
// so the planes are reconciled by shifting the whole ladder by the median offset.
const lumineLevels = [
  { levelKey: "b2f", levelElevationMeters: 17.44, minZMeters: -21.26 },
  { levelKey: "b1f", levelElevationMeters: 21.14, minZMeters: -17.56 },
  { levelKey: "1f", levelElevationMeters: 24.94, minZMeters: -14.06 },
  { levelKey: "2f", levelElevationMeters: 28.84, minZMeters: -12.56 },
  { levelKey: "3f", levelElevationMeters: 32.86, minZMeters: -5.84 },
  { levelKey: "4f", levelElevationMeters: 36.66, minZMeters: -2.04 },
  { levelKey: "5f", levelElevationMeters: 40.46, minZMeters: 1.76 },
  { levelKey: "6f", levelElevationMeters: 44.16, minZMeters: 5.46 },
  { levelKey: "7f", levelElevationMeters: 48.11, minZMeters: 9.41 },
  { levelKey: "8f", levelElevationMeters: 52.06, minZMeters: 14.06 },
  { levelKey: "roof", levelElevationMeters: 55.76, minZMeters: 17.76 },
];

test("computeLevelLocalPlanes shifts a frame-offset level ladder onto the geometry", () => {
  const planes = computeLevelLocalPlanes(lumineLevels);
  // Median offset ≈ 38.7 → 1F plane ≈ 24.94 - 38.7 = -13.76 (true local ≈ -13.8)
  const oneF = planes.get("1f");
  assert.ok(Math.abs(oneF - -13.76) < 0.3, `1f plane ${oneF}`);
  // Ladder spacing preserved exactly.
  assert.ok(Math.abs(planes.get("2f") - oneF - 3.9) < 0.001);
  assert.ok(Math.abs(planes.get("roof") - (55.76 - 38.7)) < 0.3);
});

test("computeLevelLocalPlanes leaves agreeing frames untouched", () => {
  // Elevations already in the local frame: dips are small (geometry slightly
  // below each plane) → no shift, plane = levelElevationMeters.
  const planes = computeLevelLocalPlanes([
    { levelKey: "1f", levelElevationMeters: -83.9, minZMeters: -88.25 },
    { levelKey: "2f", levelElevationMeters: -79.9, minZMeters: -80.3 },
    { levelKey: "3f", levelElevationMeters: -75.9, minZMeters: -76.2 },
  ]);
  assert.equal(planes.get("1f"), -83.9);
  assert.equal(planes.get("2f"), -79.9);
});

test("computeLevelLocalPlanes handles missing minZ by trusting elevations", () => {
  const planes = computeLevelLocalPlanes([
    { levelKey: "1f", levelElevationMeters: 0 },
    { levelKey: "2f", levelElevationMeters: 4 },
  ]);
  assert.equal(planes.get("1f"), 0);
  assert.equal(planes.get("2f"), 4);
});

test("computeLevelLocalPlanes returns an empty map for no levels", () => {
  assert.equal(computeLevelLocalPlanes([]).size, 0);
  assert.equal(computeLevelLocalPlanes(null).size, 0);
});

test("packageUnchanged is true only when both hashes exist and match", async () => {
  const { packageUnchanged } = await import("../src/packageIngest.js");
  const manifest = { contentHash: "abc123" };
  assert.equal(packageUnchanged(manifest, { packageContentHash: "abc123" }), true);
  assert.equal(packageUnchanged(manifest, { packageContentHash: "different" }), false);
  assert.equal(packageUnchanged(manifest, { packageContentHash: null }), false);
  assert.equal(packageUnchanged({ contentHash: null }, { packageContentHash: "abc123" }), false);
  assert.equal(packageUnchanged({}, {}), false);
  assert.equal(packageUnchanged(manifest, null), false);
});
