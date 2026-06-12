import test from "node:test";
import assert from "node:assert/strict";

import { partitionForReview } from "../src/importGroupClassifier.js";

// Common building fixture mirroring the shape main.js produces.
const SHINJUKU_BUILDING = {
  name: "Shinjuku LUMINE",
  aliases: ["新宿ルミネ"],
  levels: [
    { name: "1F", key: "l1" },
    { name: "2F", key: "l2" },
  ],
};

const TOKYO_BUILDING = {
  name: "Tokyo Station",
  aliases: [],
  levels: [
    { name: "1F", key: "t1" },
  ],
};

test("high-confidence single-floor layers go to autoImport with a building decision", () => {
  const fc = {
    fileName: "facility_2F.shp",
    features: [
      { properties: { source: "Shinjuku_LUMINE1", floor: "2F" } },
      { properties: { source: "Shinjuku_LUMINE1", floor: "2F" } },
    ],
  };
  const { autoImport, needsReview, metadataOnly } = partitionForReview(
    [fc],
    [TOKYO_BUILDING, SHINJUKU_BUILDING],
  );
  assert.equal(metadataOnly.length, 0);
  assert.equal(needsReview.length, 0);
  assert.equal(autoImport.length, 1);
  assert.equal(autoImport[0].fc, fc);
  assert.equal(autoImport[0].target.kind, "building");
  assert.equal(autoImport[0].target.buildingIndex, 1);
  assert.equal(autoImport[0].target.levelKey, "l2");
});

test("multi-floor features stay in needsReview with needsFloorSplit flagged", () => {
  const fc = {
    fileName: "facility.shp",
    features: [
      { properties: { source: "Shinjuku_LUMINE1", floor: "1F" } },
      { properties: { source: "Shinjuku_LUMINE1", floor: "2F" } },
    ],
  };
  const { autoImport, needsReview } = partitionForReview(
    [fc],
    [SHINJUKU_BUILDING],
  );
  assert.equal(autoImport.length, 0);
  assert.equal(needsReview.length, 1);
  assert.equal(needsReview[0].needsFloorSplit, true);
});

test("autoImport gate also blocks high-confidence layers with multi-floor features", () => {
  // Defensive: even if the matcher later returns high for a multi-floor
  // file (e.g., filename pins a floor but features actually span several),
  // the needsFloorSplit guard keeps it out of the silent path.
  const features = [
    { properties: { source: "Shinjuku_LUMINE1", floor: "1F" } },
    { properties: { source: "Shinjuku_LUMINE1", floor: "2F" } },
  ];
  // Trick: filename pinning 2F so the matcher could otherwise return high.
  const fc = { fileName: "facility_2F.shp", features };
  const { autoImport, needsReview } = partitionForReview([fc], [SHINJUKU_BUILDING]);
  // Either way the silent import path must reject this row.
  assert.equal(autoImport.length, 0);
  assert.equal(needsReview.length, 1);
  assert.equal(needsReview[0].needsFloorSplit, true);
});

test("low-confidence or unresolvable layers stay in needsReview", () => {
  const fc = {
    fileName: "mystery.shp",
    features: [{ properties: { name: "no source field" } }],
  };
  const { autoImport, needsReview } = partitionForReview([fc], [SHINJUKU_BUILDING]);
  assert.equal(autoImport.length, 0);
  assert.equal(needsReview.length, 1);
  assert.notEqual(needsReview[0].match.confidence, "high");
});

test("_level feature classes are dropped into metadataOnly", () => {
  const fc = {
    fileName: "shinjuku_level.shp",
    features: [{ properties: { name: "1F", elevation: 0 } }],
  };
  const { autoImport, needsReview, metadataOnly } = partitionForReview(
    [fc],
    [SHINJUKU_BUILDING],
  );
  assert.equal(autoImport.length, 0);
  assert.equal(needsReview.length, 0);
  assert.equal(metadataOnly.length, 1);
});

test("handles empty / missing inputs without throwing", () => {
  const empty = partitionForReview([], []);
  assert.deepEqual(empty.autoImport, []);
  assert.deepEqual(empty.needsReview, []);
  assert.deepEqual(empty.metadataOnly, []);

  const undef = partitionForReview(undefined, []);
  assert.deepEqual(undef.autoImport, []);
});
