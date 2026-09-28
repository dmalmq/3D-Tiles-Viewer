import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3 } from "cesium";

import {
  DEFAULT_MIN_ZOOM,
  applyGdbLayerZoomVisibility,
  markerMinZoom,
  normalizeIconDetail,
  webZoomToCameraDistance,
} from "../src/gdbZoomVisibility.js";

const constant = (value) => ({ getValue: () => value });

function marker(props, { label = false } = {}) {
  return {
    position: constant(Cartesian3.fromDegrees(139.767, 35.681, 10)),
    properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, constant(v)])),
    billboard: {},
    ...(label ? { label: {} } : {}),
  };
}

test("each zoom level halves the distance", () => {
  const z18 = webZoomToCameraDistance(18, 35.68);
  assert.ok(Math.abs(webZoomToCameraDistance(17, 35.68) / z18 - 2) < 1e-9);
  // Roughly street level: a few hundred metres at zoom 18.
  assert.ok(z18 > 300 && z18 < 600, `z18 = ${z18}`);
});

test("marker zoom comes from min_zoom_level, then label_category, then the default", () => {
  const read = (props) => (name) => props[name];
  assert.equal(markerMinZoom(read({ min_zoom_level: 17 })), 17);
  assert.equal(markerMinZoom(read({ label_category: "駅名注記" })), 15);
  assert.equal(markerMinZoom(read({ label_category: "店舗・施設POI名注記" })), 19);
  assert.equal(markerMinZoom(read({})), DEFAULT_MIN_ZOOM);
});

test("important markers stay visible from further away", () => {
  const landmark = marker({ min_zoom_level: 16 });
  const toilet = marker({ min_zoom_level: 20 });
  const layer = { _origin: "gdb", dataSource: { entities: { values: [landmark, toilet] } } };
  applyGdbLayerZoomVisibility(layer, 0);
  const far = (e) => e.billboard.distanceDisplayCondition.far;
  assert.ok(far(landmark) > far(toilet) * 15);
});

test("icon detail shifts every marker and labels keep their own cap", () => {
  const shop = marker({ min_zoom_level: 18 }, { label: true });
  const layer = { _origin: "gdb", dataSource: { entities: { values: [shop] } } };
  applyGdbLayerZoomVisibility(layer, 0, { labelMaxDistance: 300 });
  const base = shop.billboard.distanceDisplayCondition.far;
  applyGdbLayerZoomVisibility(layer, 1, { labelMaxDistance: 300 });
  assert.ok(Math.abs(shop.billboard.distanceDisplayCondition.far / base - 2) < 0.01);
  assert.equal(shop.label.distanceDisplayCondition.far, 300);
});

test("shapefile layers are left alone", () => {
  const m = marker({ min_zoom_level: 18 });
  applyGdbLayerZoomVisibility({ _origin: "shp", dataSource: { entities: { values: [m] } } }, 0);
  assert.equal(m.billboard.distanceDisplayCondition, undefined);
});

test("icon detail is clamped to half steps", () => {
  assert.equal(normalizeIconDetail("1.3"), 1.5);
  assert.equal(normalizeIconDetail(9), 3);
  assert.equal(normalizeIconDetail("x"), 0);
});
