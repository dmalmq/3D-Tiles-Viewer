import test from "node:test";
import assert from "node:assert/strict";

import {
  levelsDataFromSourceLevelGroups,
  sourceLevelGroupsFromInspection,
} from "../src/levelMetadata.js";

test("source inspection levels become whole-tileset levels", () => {
  const inspection = {
    groups: new Map([
      ["", {
        levels: [
          {
            levelKey: "level-1",
            levelName: "1F",
            levelElevationMeters: 0,
            elementCount: 12,
            minZMeters: 0,
            maxZMeters: 4,
          },
          {
            levelKey: "level-2",
            levelName: "2F",
            levelElevationMeters: 4,
            elementCount: 8,
            minZMeters: 4,
            maxZMeters: 8,
          },
        ],
      }],
    ]),
  };

  const groups = sourceLevelGroupsFromInspection(inspection);
  const data = levelsDataFromSourceLevelGroups(groups);

  assert.deepEqual(
    data.levels.map(l => [l.levelKey, l.levelName, l.levelElevationMeters]),
    [
      ["level-1", "1F", 0],
      ["level-2", "2F", 4],
    ],
  );
});

test("merged source levels combine duplicate bounds and counts", () => {
  const data = levelsDataFromSourceLevelGroups(new Map([
    ["host", [{ name: "1F", key: "1f", floor: 0, minZMeters: 0, maxZMeters: 3, elementCount: 5 }]],
    ["link", [{ name: "1F", key: "1f", floor: 0, minZMeters: -1, maxZMeters: 4, elementCount: 7 }]],
  ]));

  assert.equal(data.levels.length, 1);
  assert.equal(data.levels[0].minZMeters, -1);
  assert.equal(data.levels[0].maxZMeters, 4);
  assert.equal(data.levels[0].elementCount, 12);
});
