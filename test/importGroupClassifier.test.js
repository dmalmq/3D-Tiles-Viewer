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

test("a single feature floor selects that building's level without a floor in the filename", () => {
  const fc = {
    fileName: "point_facility.shp",
    features: [{ properties: { source: "Shinjuku LUMINE", floor: "2F" } }],
  };
  const result = partitionForReview([fc], [SHINJUKU_BUILDING]);
  assert.equal(result.autoImport.length, 1);
  assert.deepEqual(result.autoImport[0].target, {
    kind: "building", buildingIndex: 0, levelKey: "l2",
  });
});

test("conflicting filename and feature floors require review", () => {
  const fc = {
    fileName: "Shinjuku_1F_unit.shp",
    features: [{ properties: { source: "Shinjuku LUMINE", floor: "2F" } }],
  };
  const result = partitionForReview([fc], [SHINJUKU_BUILDING]);
  assert.equal(result.autoImport.length, 0);
  assert.equal(result.needsReview.length, 1);
  assert.equal(result.needsReview[0].match.levelKey, null);
});

test("feature altitude resolves duplicate floor numbers before silent import", () => {
  const building = {
    name: "Tower",
    aliases: [],
    levels: [
      { key: "upper", name: "B1F upper (TP-2.00)", floor: 98 },
      { key: "lower", name: "B1F lower (TP-10.00)", floor: 90 },
      { key: "datum", name: "TP±0", floor: 100 },
    ],
  };
  const fc = {
    fileName: "Tower_B1_point_facility.shp",
    features: [{ properties: { source: "Tower", floor: "B1", altitude: -10 } }],
  };
  const result = partitionForReview([fc], [building]);
  assert.equal(result.autoImport.length, 1);
  assert.equal(result.autoImport[0].target.levelKey, "lower");
});

test("ambiguous duplicate floors without altitude require review", () => {
  const building = {
    name: "Tower",
    aliases: [],
    levels: [
      { key: "upper", name: "B1F upper", floor: 98 },
      { key: "lower", name: "B1F lower", floor: 90 },
    ],
  };
  const fc = {
    fileName: "Tower_B1_point_facility.shp",
    features: [{ properties: { source: "Tower", floor: "B1" } }],
  };
  const result = partitionForReview([fc], [building]);
  assert.equal(result.autoImport.length, 0);
  assert.equal(result.needsReview.length, 1);
});

test("a unique floor with contradictory TP altitude requires review", () => {
  const building = {
    name: "Tower",
    aliases: [],
    levels: [
      { key: "b1", name: "B1F (TP-2.00)", floor: 98 },
      { key: "datum", name: "TP±0", floor: 100 },
    ],
  };
  const fc = {
    fileName: "Tower_B1_poi.shp",
    features: [{ properties: { source: "Tower", floor: "B1", altitude: -20 } }],
  };
  const result = partitionForReview([fc], [building]);
  assert.equal(result.autoImport.length, 0);
  assert.equal(result.needsReview[0].match.levelKey, null);
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

test("a single-row _level class supplies a level hint in the normal review path", () => {
  const classes = [
    { fileName: "shinjuku_level.shp", features: [{ properties: { name: "2F", ordinal: 1 } }] },
    { fileName: "shinjuku_fixture.shp", features: [{ properties: { source: "Shinjuku LUMINE" } }] },
  ];
  const result = partitionForReview(classes, [SHINJUKU_BUILDING]);
  assert.equal(result.metadataOnly.length, 1);
  assert.equal(result.autoImport[0].target.levelKey, "l2");
});

test("a multi-row _level class does not pin every layer to its first level", () => {
  const classes = [
    {
      fileName: "shinjuku_level.shp",
      features: [
        { properties: { name: "1F", ordinal: 0 } },
        { properties: { name: "2F", ordinal: 1 } },
      ],
    },
    { fileName: "shinjuku_fixture.shp", features: [{ properties: { source: "Shinjuku LUMINE" } }] },
  ];
  const result = partitionForReview(classes, [SHINJUKU_BUILDING]);
  assert.equal(result.autoImport.length, 0);
  assert.equal(result.needsReview.length, 1);
  assert.equal(result.needsReview[0].match.levelKey, null);
});

test("floor altitudes from one building do not decide another building's B1", () => {
  const buildings = [
    { name: "Tower A", aliases: [], levels: [{ key: "a", name: "B1F", floor: 0 }] },
    {
      name: "Tower B", aliases: [], levels: [
        { key: "b-upper", name: "B1F upper (TP-2.00)", floor: 98 },
        { key: "b-lower", name: "B1F lower (TP-10.00)", floor: 90 },
        { key: "datum", name: "TP±0", floor: 100 },
      ],
    },
  ];
  const classes = [
    { fileName: "Tower_A_B1_poi.shp", features: [{ properties: { source: "Tower A", floor: "B1", altitude: -10 } }] },
    { fileName: "Tower_B_B1_poi.shp", features: [{ properties: { source: "Tower B", floor: "B1" } }] },
  ];
  const result = partitionForReview(classes, buildings);
  assert.equal(result.needsReview.length, 1);
  assert.equal(result.needsReview[0].fc, classes[1]);
  assert.equal(result.needsReview[0].match.levelKey, "b-upper", "Tower A's -10 m would have picked b-lower");
});

test("handles empty / missing inputs without throwing", () => {
  const empty = partitionForReview([], []);
  assert.deepEqual(empty.autoImport, []);
  assert.deepEqual(empty.needsReview, []);
  assert.deepEqual(empty.metadataOnly, []);

  const undef = partitionForReview(undefined, []);
  assert.deepEqual(undef.autoImport, []);
});
