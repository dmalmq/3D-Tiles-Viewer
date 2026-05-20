import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDefaultColorColumn,
  getLayerColumnNames,
  isColorConfigurableLayer,
  isShapefileUnitLayer,
} from "../src/layerColorConfig.js";

test("shapefile layers ending in _unit are color configurable", () => {
  assert.equal(isShapefileUnitLayer({ name: "mall_unit", _origin: "shp" }), true);
  assert.equal(isShapefileUnitLayer({ name: "mall_UNIT.shp", _origin: "shp" }), true);
  assert.equal(isShapefileUnitLayer({ name: "mall_unit (1F)", _origin: "shp" }), true);
  assert.equal(isShapefileUnitLayer({ name: "mall_units", _origin: "shp" }), false);
  assert.equal(isShapefileUnitLayer({ name: "mall_unit", _origin: "gdb" }), false);
});

test("existing _space layers remain color configurable", () => {
  assert.equal(isColorConfigurableLayer({ name: "tenant_space", _origin: "gdb" }), true);
  assert.equal(isColorConfigurableLayer({ name: "tenant Space (1F)", _origin: "gdb" }), true);
  assert.equal(isColorConfigurableLayer({ name: "Tenant-Space.shp", _origin: "gdb" }), true);
  assert.equal(isColorConfigurableLayer({ name: "tenant_unit", _origin: "gdb" }), true);
  assert.equal(isColorConfigurableLayer({ name: "tenant Unit (1F)", _origin: "gdb" }), true);
  assert.equal(isColorConfigurableLayer({ name: "tenant_unit", _origin: "shp" }), true);
  assert.equal(isColorConfigurableLayer({ name: "tenant_room", _origin: "shp" }), false);
  assert.equal(isColorConfigurableLayer({ name: "spaceship", _origin: "gdb" }), false);
  assert.equal(isColorConfigurableLayer({ name: "units", _origin: "gdb" }), false);
});

test("default color column prefers known color-like columns", () => {
  const layer = {
    features: [
      { properties: { id: 1, category: "shop", previcolor: "#979797" } },
      { properties: { color2: "薄紅", custom: "A" } },
    ],
  };

  assert.deepEqual(
    getLayerColumnNames(layer),
    ["category", "color2", "custom", "id", "previcolor"],
  );
  assert.equal(chooseDefaultColorColumn(layer), "color2");
  assert.equal(
    chooseDefaultColorColumn({ features: [{ properties: { name: "A", previcolor: "#fff" } }] }),
    "previcolor",
  );
  assert.equal(
    chooseDefaultColorColumn({ features: [{ properties: { zone: "A", type: "retail" } }] }),
    "type",
  );
});
