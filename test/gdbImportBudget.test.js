import test from "node:test";
import assert from "node:assert/strict";

import { countFeatures, isBasemapLayerName } from "../src/gdbImportBudget.js";
import { partitionForReview } from "../src/importGroupClassifier.js";

test("city-scale reference layers from station GDBs are basemap layers", () => {
  for (const name of [
    "背景_グレー_4F.shp",
    "背景_黒",
    "街区_地上表示用.shp",
    "道路縁",
    "道路構成線.shp",
    "歩道.shp",
    "水域.shp",
    "建築物_地上表示用.shp",
    "軌道の中心線_JR_2 [JR]",
  ]) {
    assert.equal(isBasemapLayerName(name), true, name);
  }
});

test("indoor and POI layers are not basemap layers", () => {
  for (const name of [
    "JRTokyoSta_B1_Space.shp",
    "G空間_B1_Facility.shp",
    "Free_shuttle_bus_busstop_Facility.shp",
    "八重洲バスターミナル番号表示.shp",
    "point_facility",
    null,
  ]) {
    assert.equal(isBasemapLayerName(name), false, String(name));
  }
});

test("countFeatures sums features across collections", () => {
  assert.equal(countFeatures([{ features: [{}, {}] }, { features: [{}] }, {}]), 3);
});

test("a basemap layer never imports silently even with a confident match", () => {
  const building = { name: "Tokyo Station", aliases: [], levels: [{ key: "l1", name: "1F" }] };
  const fc = {
    fileName: "建築物_地上表示用.shp",
    features: [{ properties: { source: "Tokyo Station", floor: "1F" } }],
  };
  const result = partitionForReview([fc], [building]);
  assert.equal(result.autoImport.length, 0);
  assert.equal(result.needsReview.length, 1);
});
