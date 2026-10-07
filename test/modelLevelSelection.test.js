import test from "node:test";
import assert from "node:assert/strict";

import { remapActiveLevelIndex, sortLevelsKeepingActive } from "../src/modelLevelSelection.js";

const levels = (...floors) => floors.map((floorNumber) => ({ floorNumber }));

test("keeps the same floor selected when a lower floor is added", () => {
  // 2F selected at index 1; adding B1 (-1) moves 2F to index 2.
  assert.equal(remapActiveLevelIndex(levels(1, 2), 1, levels(-1, 1, 2)), 2);
});

test("All floors stays All floors", () => {
  assert.equal(remapActiveLevelIndex(levels(1, 2), -1, levels(-1, 1, 2)), -1);
});

test("falls back to All floors when the selected floor disappears", () => {
  assert.equal(remapActiveLevelIndex(levels(1, 2, 3), 2, levels(1, 2)), -1);
});

test("an out-of-range index resets the selection", () => {
  assert.equal(remapActiveLevelIndex(levels(1), 5, levels(1)), -1);
});

test("sorting a building's levels keeps the same level active", () => {
  const levels = [{ name: "1F", floor: 0 }, { name: "2F", floor: 4 }];
  // 2F active; a B1 level is appended and the list is re-sorted.
  levels.push({ name: "B1", floor: -4 });
  const next = sortLevelsKeepingActive(levels, 1);
  assert.deepEqual(levels.map((l) => l.name), ["B1", "1F", "2F"]);
  assert.equal(levels[next].name, "2F");
});

test("no active level stays none after sorting", () => {
  const levels = [{ floor: 4 }, { floor: 0 }];
  assert.equal(sortLevelsKeepingActive(levels, -1), -1);
});
