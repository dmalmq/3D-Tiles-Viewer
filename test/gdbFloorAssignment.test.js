import test from "node:test";
import assert from "node:assert/strict";

import { planGdbFloorParts, resolveGdbLayerLevel } from "../src/gdbFloorAssignment.js";
import { buildFloorAltitudeHints } from "../src/gdbLevelMatch.js";

const building = {
  levels: [
    { key: "one", name: "1F", floor: 0 },
    { key: "two", name: "2F", floor: 4 },
  ],
};

test("a single floor-bearing group plans a building level", () => {
  const parts = planGdbFloorParts([{ properties: { floor: "2F" } }], building.levels);
  assert.deepEqual(parts.map(({ floorValue, levelKey }) => [floorValue, levelKey]), [["2F", "two"]]);
});

test("an unknown floor in a mixed layer stays unassigned", () => {
  const parts = planGdbFloorParts([
    { properties: { floor: "2F" } },
    { properties: { floor: "9F" } },
  ], building.levels);
  assert.deepEqual(parts.map(({ floorValue, levelKey }) => [floorValue, levelKey]), [
    ["2F", "two"],
    ["9F", null],
  ]);
});

test("a duplicate floor without altitude stays unassigned", () => {
  const levels = [
    { key: "upper", name: "B1F upper", floor: 98 },
    { key: "lower", name: "B1F lower", floor: 90 },
  ];
  const parts = planGdbFloorParts([{ properties: { floor: "B1" } }], levels);
  assert.equal(parts[0].levelKey, null);
});

test("a unique floor with contradictory TP altitude stays unassigned", () => {
  const levels = [
    { key: "b1", name: "B1F (TP-2.00)", floor: 98 },
    { key: "datum", name: "TP±0", floor: 100 },
  ];
  const features = [{ properties: { floor: "B1", altitude: -20 } }];
  assert.equal(planGdbFloorParts(features, levels)[0].levelKey, null);
});

test("conflicting altitude donors cannot decide an ambiguous floor", () => {
  const donors = [
    { features: [{ properties: { floor: "B1", altitude: -2 } }] },
    { features: [{ properties: { floor: "B1", altitude: -10 } }] },
  ];
  const hints = buildFloorAltitudeHints(donors, { maxSpreadMeters: 1 });
  assert.deepEqual([...hints], []);
});

test("metadata suggests a level when the feature has no floor", () => {
  const result = resolveGdbLayerLevel({
    fc: { fileName: "station_fixture.shp", features: [{ properties: {} }] },
    building,
    levelRef: { name: "2F", floor: null, ordinal: 1 },
  });
  assert.deepEqual(result, { levelKey: "two", confidence: "high", reason: "namedFloor" });
});
