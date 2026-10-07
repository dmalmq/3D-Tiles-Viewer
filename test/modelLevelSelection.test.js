import test from "node:test";
import assert from "node:assert/strict";

import { remapActiveLevelIndex } from "../src/modelLevelSelection.js";

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
