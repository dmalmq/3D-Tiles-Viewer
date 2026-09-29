import test from "node:test";
import assert from "node:assert/strict";

import {
  availableScales,
  exportDimensions,
  exportFileName,
  maxRenderSize,
  normalizeSavedViews,
} from "../src/viewExport.js";

test("export size follows the view's shape and device pixel ratio", () => {
  assert.deepEqual(exportDimensions(1600, 900, 2), { width: 3200, height: 1800 });
  assert.deepEqual(exportDimensions(1600, 900, 2, 1.5), { width: 4800, height: 2700 });
});

test("scales that exceed the GPU's render size are not offered", () => {
  assert.deepEqual(availableScales(1600, 900, 1, 8192), [1, 2, 3, 4]);
  assert.deepEqual(availableScales(1600, 900, 1, 4096), [1, 2]);
  assert.deepEqual(availableScales(5000, 3000, 1, 4096), [1], "always offer 1×");
  assert.equal(maxRenderSize({ maximumRenderbufferSize: 16384, maximumViewportWidth: 8192 }), 8192);
  assert.equal(maxRenderSize({}), 8192);
});

test("file names are safe and descriptive", () => {
  const date = new Date("2026-09-28T09:15:00Z");
  assert.equal(exportFileName("tokyo 3dtiles 3", "North / entrance", 3200, 1800, date), "tokyo_3dtiles_3_North_-_entrance_3200x1800_202609280915.png");
  assert.equal(exportFileName("", "", 100, 50, date), "view_100x50_202609280915.png");
});

test("saved views are validated", () => {
  const views = normalizeSavedViews([
    { id: "a", name: "Aerial", position: [1, 2, 3], heading: 0.5, pitch: -0.7, roll: 0 },
    { name: "no position" },
    { position: [1, "x", 3] },
    { position: ["4", "5", "6"] },
  ]);
  assert.equal(views.length, 2);
  assert.deepEqual(views[0], { id: "a", name: "Aerial", position: [1, 2, 3], heading: 0.5, pitch: -0.7, roll: 0 });
  assert.deepEqual(views[1].position, [4, 5, 6]);
  assert.equal(views[1].name, "View 2");
  assert.deepEqual(normalizeSavedViews("nope"), []);
});
