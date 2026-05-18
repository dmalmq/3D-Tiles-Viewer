import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLevelsByPrefix,
  detectLayerLevelRef,
  isLevelFeatureClass,
  matchLayerToTarget,
  matchLevelRefToBuildingLevel,
} from "../src/gdbAutoMatch.js";

test("matchLayerToTarget uses source names, aliases, and floor text", () => {
  const buildings = [
    {
      name: "Tokyo Station",
      aliases: ["Marunouchi"],
      levels: [
        { name: "B1F", key: "b1" },
        { name: "1F", key: "1f" },
      ],
    },
    {
      name: "Shinjuku LUMINE",
      aliases: ["新宿ルミネ"],
      levels: [
        { name: "1F", key: "l1" },
        { name: "2F", key: "l2" },
      ],
    },
  ];

  const match = matchLayerToTarget({
    filename: "facility_2F.shp",
    features: [
      { properties: { source: "Shinjuku_LUMINE1" } },
      { properties: { source: "Shinjuku_LUMINE1" } },
    ],
    buildings,
  });

  assert.equal(match.buildingIndex, 1);
  assert.equal(match.levelKey, "l2");
  assert.equal(match.confidence, "high");
});

test("matchLayerToTarget falls back to unassigned when no useful name matches", () => {
  const match = matchLayerToTarget({
    filename: "generic_fixture.shp",
    features: [{ properties: { source: "unknown" } }],
    buildings: [{ name: "Known Building", aliases: [], levels: [] }],
  });

  assert.deepEqual(match, { buildingIndex: -1, levelKey: null, confidence: "none" });
});

test("level metadata feature classes resolve matching building levels", () => {
  const collections = [
    {
      fileName: "station_level.shp",
      features: [{ properties: { ordinal: "0", name: "1F" } }],
    },
    {
      fileName: "station_fixture.shp",
      features: [{ properties: { floor: "1F" } }],
    },
  ];
  const byPrefix = buildLevelsByPrefix(collections);
  const ref = detectLayerLevelRef("station_fixture.shp", byPrefix);

  assert.equal(isLevelFeatureClass("station_level.shp"), true);
  assert.equal(ref.name, "1F");
  assert.equal(ref.ordinal, 0);
  assert.equal(
    matchLevelRefToBuildingLevel(ref, {
      levels: [
        { name: "B1F", key: "b1" },
        { name: "1F", key: "1f" },
      ],
    }).key,
    "1f",
  );
});
