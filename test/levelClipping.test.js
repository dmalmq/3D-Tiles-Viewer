import test from "node:test";
import assert from "node:assert/strict";

import {
  levelTopClipLocalZForBuilding,
  resolveTilesetTopClipLocalZ,
} from "../src/levelClipping.js";

const levels = [
  { name: "1F", floor: 0 },
  { name: "2F", floor: 4 },
  { name: "3F", floor: 8 },
];

test("level top clipping uses the next higher level elevation", () => {
  assert.equal(
    levelTopClipLocalZForBuilding({ levels }, 2),
    8,
  );
});

test("topmost level has no top clipping plane", () => {
  assert.equal(
    levelTopClipLocalZForBuilding({ levels }, 3),
    null,
  );
});

test("shared tileset clipping resolves when sibling heights match", () => {
  const buildings = [
    { levels },
    { levels: [{ name: "1F", floor: 0 }, { name: "2F", floor: 4 }, { name: "3F", floor: 8.005 }] },
  ];

  assert.equal(resolveTilesetTopClipLocalZ(buildings, 2), 8);
});

test("shared tileset clipping is disabled when sibling heights conflict", () => {
  const buildings = [
    { levels },
    { levels: [{ name: "1F", floor: 0 }, { name: "2F", floor: 4 }, { name: "3F", floor: 9 }] },
  ];

  assert.equal(resolveTilesetTopClipLocalZ(buildings, 2), null);
});
