import test from "node:test";
import assert from "node:assert/strict";

import { enumerateBuildings, filterToBuildings } from "../src/importBuildingPicker.js";

function fc(fileName, features) {
  return { fileName, features };
}

function feat(props = {}) {
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: [139.7, 35.68] },
  };
}

// JR-style GDB: layers named <prefix>_<suffix> with per-prefix _level metadata.
const jrCollections = [
  fc("tokyost_B1_space", [feat(), feat()]),
  fc("tokyost_1F_space", [feat()]),
  fc("tokyost_level", [feat({ ordinal: 0, name: "B1" })]),
  fc("marunouchi_B1_space", [feat(), feat(), feat()]),
  fc("marunouchi_level", [feat({ ordinal: 0, name: "B1" })]),
];

// RevitGeoSuite-style: one layer whose features carry distinct `source` values.
const sourceCollections = [
  fc("unit [TowerA]", [feat({ source: "TowerA" }), feat({ source: "TowerA" })]),
  fc("unit [TowerB]", [feat({ source: "TowerB" })]),
];

test("enumerateBuildings groups JR-style layers by filename prefix", () => {
  const groups = enumerateBuildings(jrCollections);
  assert.equal(groups.length, 2);

  const byKey = new Map(groups.map((g) => [g.key, g]));
  const tokyo = byKey.get("tokyost");
  assert.ok(tokyo);
  assert.equal(tokyo.layerCount, 3);
  assert.equal(tokyo.featureCount, 4);

  const marunouchi = byKey.get("marunouchi");
  assert.ok(marunouchi);
  assert.equal(marunouchi.layerCount, 2);
});

test("enumerateBuildings groups RevitGeoSuite collections by source", () => {
  const groups = enumerateBuildings(sourceCollections);
  assert.equal(groups.length, 2);
  const labels = groups.map((g) => g.label).sort();
  assert.deepEqual(labels, ["TowerA", "TowerB"]);
});

test("enumerateBuildings treats single-token layer names as one dataset", () => {
  // RevitGeoSuite gpkg layers: unit/detail/opening/fixture/level — one building,
  // NOT five. Prefix grouping only applies to <prefix>_<suffix> names.
  const groups = enumerateBuildings([
    fc("unit", [feat(), feat()]),
    fc("detail", [feat()]),
    fc("level", [feat()]),
  ]);
  assert.equal(groups.length, 1);
});

test("enumerateBuildings ignores numeric or blank source values", () => {
  // Real JR GDBs carry junk `source` attributes like "1" or "" — those must
  // not become building groups; the filename prefix wins instead.
  const groups = enumerateBuildings([
    fc("tokyost_B1_space", [feat({ source: "1" }), feat({ source: "1" })]),
    fc("tokyost_level", [feat({ source: "  " })]),
    fc("marunouchi_B1_space", [feat({ source: "2" })]),
  ]);
  const keys = groups.map((g) => g.key).sort();
  assert.deepEqual(keys, ["marunouchi", "tokyost"]);
});

test("enumerateBuildings folds sourceless metadata layers into a single real group", () => {
  // One sourced building + a sourceless `level` metadata layer is still ONE
  // building — the picker must not appear for single-building exports.
  const groups = enumerateBuildings([
    fc("unit", [feat({ source: "TowerA" }), feat({ source: "TowerA" })]),
    fc("level", [feat()]),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].layerCount, 2);
});

test("enumerateBuildings keeps a shared bucket alongside multiple real groups", () => {
  const groups = enumerateBuildings([
    fc("unit [TowerA]", [feat({ source: "TowerA" })]),
    fc("unit [TowerB]", [feat({ source: "TowerB" })]),
    fc("level", [feat()]),
  ]);
  assert.equal(groups.length, 3);
  assert.ok(groups.some((g) => g.key === "__dataset__"));
});

test("enumerateBuildings returns a single group for single-building data", () => {
  const groups = enumerateBuildings([
    fc("tokyost_B1_space", [feat()]),
    fc("tokyost_level", [feat()]),
  ]);
  assert.equal(groups.length, 1);
});

test("filterToBuildings keeps only selected groups' layers", () => {
  const groups = enumerateBuildings(jrCollections);
  const tokyoKey = groups.find((g) => g.key === "tokyost").key;

  const filtered = filterToBuildings(jrCollections, [tokyoKey]);
  const names = filtered.map((f) => f.fileName).sort();
  assert.deepEqual(names, ["tokyost_1F_space", "tokyost_B1_space", "tokyost_level"]);
});

test("filterToBuildings keeps metadata layers for selected prefixes", () => {
  const filtered = filterToBuildings(jrCollections, ["marunouchi"]);
  assert.ok(filtered.some((f) => f.fileName === "marunouchi_level"));
  assert.ok(!filtered.some((f) => f.fileName.startsWith("tokyost")));
});

test("filterToBuildings with all keys selected returns everything", () => {
  const groups = enumerateBuildings(jrCollections);
  const filtered = filterToBuildings(jrCollections, groups.map((g) => g.key));
  assert.equal(filtered.length, jrCollections.length);
});
