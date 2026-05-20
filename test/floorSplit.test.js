import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFloorNumber,
  groupFeaturesByFloor,
  levelNameToNumber,
  matchLevelByText,
} from "../src/floorSplit.js";

test("extractFloorNumber recognizes above-ground and basement floor tokens", () => {
  assert.equal(extractFloorNumber("1F"), 1);
  assert.equal(extractFloorNumber("floor_12"), 12);
  assert.equal(extractFloorNumber("B2"), -2);
  assert.equal(extractFloorNumber("B2F"), -2);
  assert.equal(extractFloorNumber("地下3階"), -3);
});

test("levelNameToNumber ignores trailing elevation suffix numbers", () => {
  assert.equal(levelNameToNumber("B2FL(1FL)_通路(TP-5.11)"), -2);
  assert.equal(levelNameToNumber("4F 東棟 (TP-15.80)"), 4);
});

test("matchLevelByText maps text floor references to building levels", () => {
  const levels = [
    { name: "B1F", key: "basement-1" },
    { name: "1F", key: "level-1" },
    { name: "2F", key: "level-2" },
  ];

  assert.equal(matchLevelByText("地下1階", levels).key, "basement-1");
  assert.equal(matchLevelByText("fixture_2f", levels).key, "level-2");
  assert.equal(matchLevelByText("roof", levels), null);
});

test("groupFeaturesByFloor preserves source groups and handles missing floor values", () => {
  const features = [
    { properties: { floor: "1F", id: 1 } },
    { properties: { Floor: "1f", id: 2 } },
    { properties: { FLOOR: "B1", id: 3 } },
    { properties: { id: 4 } },
  ];

  const groups = groupFeaturesByFloor(features);

  assert.deepEqual(
    groups.map((group) => [group.key, group.features.length]),
    [["1f", 2], ["b1", 1], ["", 1]],
  );
  assert.equal(groups[0].floorValue, "1F");
  assert.equal(groups[2].floorValue, null);
});
