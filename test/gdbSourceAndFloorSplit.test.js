import test from "node:test";
import assert from "node:assert/strict";

import { matchLayerToTarget, splitFeaturesBySource } from "../src/gdbAutoMatch.js";

const feature = (props) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [139.767, 35.681] } });

test("source values that differ only by whitespace or are blank don't split a layer", () => {
  const fc = {
    fileName: "Facility_Merge",
    features: [feature({ source: "1" }), feature({ source: "1 " }), feature({ source: "" }), feature({})],
  };
  assert.deepEqual(splitFeaturesBySource(fc), [fc]);
});

test("real distinct sources still split", () => {
  const fc = { fileName: "rooms", features: [feature({ source: "TowerA" }), feature({ source: "TowerB " })] };
  assert.deepEqual(splitFeaturesBySource(fc).map((part) => part.fileName), ["rooms [TowerA]", "rooms [TowerB]"]);
});

test("a multi-floor layer is not pinned to one level by a numeric source", () => {
  const building = { name: "Facility", levels: [{ name: "1FL", key: "1fl" }, { name: "B1FL", key: "b1fl" }] };
  const match = matchLayerToTarget({
    filename: "Facility_Merge",
    features: [feature({ source: "1", floor: "F1" }), feature({ source: "1", floor: "B1" })],
    buildings: [building],
  });
  assert.equal(match.buildingIndex, 0);
  assert.equal(match.levelKey, null, "left on All floors so import splits it per floor");
});
