import test from "node:test";
import assert from "node:assert/strict";

import {
  filterVisibleBuildings,
  findLayerParent,
  shapefilesForModelLevel,
  unassignedShapefilesAll,
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
