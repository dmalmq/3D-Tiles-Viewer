import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, JulianDate } from "cesium";

function ensureLocalStorage() {
  if (globalThis.localStorage) return;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

test("computeBuildingBounds uses shapefile entity positions when tileset is missing", async () => {
  ensureLocalStorage();
  const { computeBuildingBounds } = await import("../src/sceneZoom.js");
  const time = JulianDate.now();
  const building = {
    tileset: null,
    shapefileLayers: [
      {
        dataSource: {
          entities: {
            values: [
              { position: Cartesian3.fromDegrees(139.76, 35.68, 40) },
              { position: Cartesian3.fromDegrees(139.77, 35.69, 45) },
            ],
          },
        },
      },
    ],
  };

  const sphere = computeBuildingBounds(building, time);
  assert.ok(sphere);
  assert.ok(sphere.radius > 0);
});

test("computeBuildingBounds prefers building bounding sphere when present", async () => {
  ensureLocalStorage();
  const { computeBuildingBounds } = await import("../src/sceneZoom.js");
  const custom = { center: Cartesian3.fromDegrees(139.76, 35.68, 30), radius: 120 };
  const building = {
    _boundingSphere: custom,
    tileset: null,
    shapefileLayers: [],
  };

  const sphere = computeBuildingBounds(building);
  assert.equal(sphere, custom);
});