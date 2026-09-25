import test from "node:test";
import assert from "node:assert/strict";
import { setGdbLayerIconsVisible } from "../src/gdbIconVisibility.js";

test("GDB icon switch hides point graphics without hiding shapes or shapefile markers", () => {
  const marker = { position: {}, billboard: { show: true }, point: { show: true }, label: { show: false } };
  const polygon = { position: {}, polygon: {}, label: { show: true } };
  const layer = { _origin: "gdb", dataSource: { entities: { values: [marker, polygon] } } };
  const shapefile = { _origin: "shp", dataSource: { entities: { values: [marker] } } };

  setGdbLayerIconsVisible(layer, false);
  assert.equal(marker.billboard.show, false);
  assert.equal(marker.point.show, false);
  assert.equal(marker.label.show, false);
  assert.equal(polygon.label.show, true);
  setGdbLayerIconsVisible(shapefile, true);
  assert.equal(marker.billboard.show, false);
  setGdbLayerIconsVisible(layer, true);
  assert.equal(marker.billboard.show, true);
  assert.equal(marker.point.show, true);
  assert.equal(marker.label.show, false);
});
