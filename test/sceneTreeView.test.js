import test from "node:test";
import assert from "node:assert/strict";

import {
  filterVisibleBuildings,
  findLayerParent,
  shapefilesForModelLevel,
  unassignedShapefilesAll,
  computeSceneItemCount,
  collectLayerTypes,
} from "../src/sceneTreeView.js";

// --- filterVisibleBuildings ----------------------------------------------

test("filterVisibleBuildings returns all buildings when filter is empty", () => {
  const buildings = [{ name: "Alpha" }, { name: "Beta" }];
  assert.deepEqual(
    filterVisibleBuildings(buildings, ""),
    [{ b: buildings[0], i: 0 }, { b: buildings[1], i: 1 }],
  );
});

test("filterVisibleBuildings matches case-insensitively and preserves indices", () => {
  const buildings = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
  const result = filterVisibleBuildings(buildings, "MA");
  assert.deepEqual(result, [{ b: buildings[2], i: 2 }]);
});

test("filterVisibleBuildings handles buildings with no name", () => {
  const buildings = [{}, { name: "Alpha" }];
  assert.deepEqual(filterVisibleBuildings(buildings, "alpha"), [{ b: buildings[1], i: 1 }]);
});

// --- shapefilesForModelLevel ---------------------------------------------

test("shapefilesForModelLevel collects layers across buildings for one floor number", () => {
  const buildings = [
    {
      levels: [{ key: "L1", name: "1F" }, { key: "L2", name: "2F" }],
      shapefileLayers: [
        { name: "L1-layer", levelKey: "L1" },
        { name: "L2-layer", levelKey: "L2" },
      ],
    },
    {
      levels: [{ key: "L1", name: "1F" }],
      shapefileLayers: [{ name: "L1-other", levelKey: "L1" }],
    },
  ];
  const result = shapefilesForModelLevel(buildings, 1);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.layer.name).sort(), ["L1-layer", "L1-other"]);
});

test("shapefilesForModelLevel skips layers with null levelKey", () => {
  const buildings = [
    {
      levels: [{ key: "L1", name: "1F" }],
      shapefileLayers: [
        { name: "unassigned", levelKey: null },
        { name: "ok", levelKey: "L1" },
      ],
    },
  ];
  assert.deepEqual(
    shapefilesForModelLevel(buildings, 1).map((r) => r.layer.name),
    ["ok"],
  );
});

test("shapefilesForModelLevel filters by layer name (case-insensitive)", () => {
  const buildings = [
    {
      levels: [{ key: "L1", name: "1F" }],
      shapefileLayers: [
        { name: "Walls", levelKey: "L1" },
        { name: "Floors", levelKey: "L1" },
      ],
    },
  ];
  assert.deepEqual(
    shapefilesForModelLevel(buildings, 1, "wall").map((r) => r.layer.name),
    ["Walls"],
  );
});

test("shapefilesForModelLevel tolerates buildings without shapefileLayers", () => {
  const buildings = [{ levels: [{ key: "L1", name: "1F" }] }];
  assert.deepEqual(shapefilesForModelLevel(buildings, 1), []);
});

// --- unassignedShapefilesAll ---------------------------------------------

test("unassignedShapefilesAll combines null-levelKey layers + the staging bucket", () => {
  const buildings = [
    { shapefileLayers: [
      { name: "buildingStaged", levelKey: null },
      { name: "assigned", levelKey: "L1" },
    ]},
  ];
  const staged = [{ name: "globalStaged" }];
  const result = unassignedShapefilesAll(buildings, staged);
  assert.deepEqual(result.map((r) => r.layer.name), ["buildingStaged", "globalStaged"]);
  assert.equal(result[0].buildingIndex, 0);
  assert.equal(result[1].buildingIndex, "unassigned");
});

test("unassignedShapefilesAll filters by name", () => {
  const buildings = [{ shapefileLayers: [{ name: "Foo", levelKey: null }] }];
  const staged = [{ name: "Bar" }];
  assert.deepEqual(
    unassignedShapefilesAll(buildings, staged, "foo").map((r) => r.layer.name),
    ["Foo"],
  );
});

test("unassignedShapefilesAll tolerates missing arrays", () => {
  assert.deepEqual(unassignedShapefilesAll([], null), []);
  assert.deepEqual(unassignedShapefilesAll([], undefined), []);
});

// --- findLayerParent -----------------------------------------------------

test("findLayerParent locates a layer in a building", () => {
  const layer = { id: 1 };
  const buildings = [
    { shapefileLayers: [{ id: 0 }] },
    { shapefileLayers: [layer] },
  ];
  assert.equal(findLayerParent(buildings, [], layer), 1);
});

test("findLayerParent recognises a layer in the unassigned bucket", () => {
  const layer = { id: 1 };
  assert.equal(findLayerParent([], [layer], layer), "unassigned");
});

test("findLayerParent returns null for a stale reference", () => {
  assert.equal(findLayerParent([{ shapefileLayers: [] }], [], { id: 99 }), null);
});

test("findLayerParent prefers the unassigned bucket over buildings if duplicated", () => {
  const layer = { id: 1 };
  const buildings = [{ shapefileLayers: [layer] }];
  // The unassigned check runs first; if a layer somehow appears in both,
  // we treat it as unassigned. Future code should keep the invariant that
  // a layer lives in exactly one place.
  assert.equal(findLayerParent(buildings, [layer], layer), "unassigned");
});

// --- computeSceneItemCount -----------------------------------------------

test("computeSceneItemCount returns placeholder when no buildings or unassigned layers", () => {
  const result = computeSceneItemCount([], [], "", 0);
  assert.equal(result.text, "");
  assert.equal(result.showPlaceholder, true);
});

test("computeSceneItemCount returns total count when no filter", () => {
  const buildings = [{ name: "A" }, { name: "B" }];
  const result = computeSceneItemCount(buildings, [], "", 2);
  assert.deepEqual(result.text, { key: "scene.itemsCount", params: { count: 2 } });
  assert.equal(result.showPlaceholder, false);
});

test("computeSceneItemCount returns filtered count when filter is active", () => {
  const buildings = [{ name: "A" }, { name: "B" }, { name: "C" }];
  const result = computeSceneItemCount(buildings, [], "a", 1);
  assert.deepEqual(result.text, { key: "scene.itemsCountFiltered", params: { filtered: 1, total: 3 } });
  assert.equal(result.showPlaceholder, false);
});

test("computeSceneItemCount treats unassigned layers as non-empty", () => {
  const result = computeSceneItemCount([], [{ name: "staged" }], "", 0);
  assert.deepEqual(result.text, { key: "scene.itemsCount", params: { count: 0 } });
  assert.equal(result.showPlaceholder, false);
});

// --- collectLayerTypes ---------------------------------------------------

test("collectLayerTypes gathers types from buildings and unassigned layers", () => {
  const buildings = [
    { shapefileLayers: [{ name: "foo_space" }, { name: "bar_unit" }] },
  ];
  const unassigned = [{ name: "baz_opening" }];
  const types = collectLayerTypes(buildings, unassigned);
  assert.deepEqual([...types].sort(), ["opening", "space", "unit"]);
});

test("collectLayerTypes returns empty set when no typed layers exist", () => {
  const buildings = [{ shapefileLayers: [{ name: "walls" }] }];
  const types = collectLayerTypes(buildings, []);
  assert.equal(types.size, 0);
});

test("collectLayerTypes tolerates missing arrays", () => {
  assert.equal(collectLayerTypes(null, null).size, 0);
  assert.equal(collectLayerTypes([], undefined).size, 0);
});
