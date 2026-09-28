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

test("a marker's zoom sets its label range; icons wait for the sampler", () => {
  const landmark = marker({ min_zoom_level: 16 });
  const toilet = marker({ min_zoom_level: 20 });
  const layer = { _origin: "gdb", dataSource: { entities: { values: [landmark, toilet] } } };
  applyGdbLayerZoomVisibility(layer, 0);
  assert.ok(landmark._gdbBaseFar > toilet._gdbBaseFar * 15);
  assert.equal(toilet.billboard.distanceDisplayCondition.far, 1, "hidden until it wins a cell");
  toilet._gdbSampled = true;
  applyGdbLayerZoomVisibility(layer, 0);
  assert.ok(toilet.billboard.distanceDisplayCondition.far > 10000);
});

test("icon detail shifts label ranges, which keep their cap", () => {
  const shop = marker({ min_zoom_level: 18 }, { label: true });
  const layer = { _origin: "gdb", dataSource: { entities: { values: [shop] } } };
  applyGdbLayerZoomVisibility(layer, 0, { labelMaxDistance: 5000 });
  const base = shop._gdbBaseFar;
  assert.equal(shop.label.distanceDisplayCondition.far, 1, "hidden until sampled");
  shop._gdbLabelSampled = true;
  applyGdbLayerZoomVisibility(layer, 1, { labelMaxDistance: 5000 });
  assert.ok(Math.abs(shop._gdbBaseFar / base - 2) < 0.01);
  assert.ok(Math.abs(shop.label.distanceDisplayCondition.far - shop._gdbBaseFar) < 1);
  applyGdbLayerZoomVisibility(layer, 1, { labelMaxDistance: 300 });
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

test("sampling keeps the most important marker per cell", async () => {
  const { sampleMarkersByCell } = await import("../src/gdbZoomVisibility.js");
  const at = (key, lat, lng, minZoom, hasImage = true, rank = 0.5) => ({ key, lat, lng, minZoom, hasImage, rank });
  const markers = [
    at("shop", 35.6810, 139.7670, 20),
    at("exit", 35.6811, 139.7671, 17),
    at("dot", 35.6811, 139.7672, 17, false),
    at("far", 35.6900, 139.7800, 20),
  ];
  // 200 m cells: the first three share a cell; the exit wins (lower zoom,
  // and a picture icon beats a plain dot at the same zoom).
  assert.deepEqual([...sampleMarkersByCell(markers, 200)].sort(), ["exit", "far"]);
  // Tiny cells: everyone gets their own.
  assert.equal(sampleMarkersByCell(markers, 1).size, 4);
  // Sampling off.
  assert.equal(sampleMarkersByCell(markers, 0).size, 0);
});

test("ties are broken the same way every time", async () => {
  const { sampleMarkersByCell } = await import("../src/gdbZoomVisibility.js");
  const markers = [
    { key: "a", lat: 35.681, lng: 139.767, minZoom: 19, hasImage: true, rank: 0.7 },
    { key: "b", lat: 35.681, lng: 139.767, minZoom: 19, hasImage: true, rank: 0.2 },
  ];
  assert.deepEqual([...sampleMarkersByCell(markers, 100)], ["b"]);
  assert.deepEqual([...sampleMarkersByCell([...markers].reverse(), 100)], ["b"]);
});
