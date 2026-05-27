import test from "node:test";
import assert from "node:assert/strict";

import {
  PLATEAU_ID_PROPERTIES,
  clearPlateauFeatureOverrides,
  countPlateauOverrides,
  createPlateauFeatureSelection,
  deserializePlateauOverrides,
  findPlateauLayerForFeature,
  getFeatureProperty,
  getFeatureTileset,
  getPlateauFeatureKey,
  getPlateauFeatureLabel,
  getPlateauOverride,
  getPlateauOverrideMode,
  isPlateauLayer,
  listPlateauLayers,
  listPlateauOverrideEntries,
  pickThroughGhosts,
  removePlateauFeatureOverride,
  restoreSerializedPlateauOverrides,
  serializePlateauOverrides,
  setPlateauFeatureOverride,
} from "../src/plateauOverrides.js";

// --- isPlateauLayer -------------------------------------------------------

test("isPlateauLayer accepts both PLATEAU kind values", () => {
  assert.equal(
    isPlateauLayer({ type: "tileset", sourceConfig: { kind: "plateau-buildings" } }),
    true,
  );
  assert.equal(
    isPlateauLayer({ type: "tileset", sourceConfig: { kind: "plateau-3dtiles" } }),
    true,
  );
});

test("isPlateauLayer rejects non-PLATEAU layers", () => {
  assert.equal(isPlateauLayer(null), false);
  assert.equal(isPlateauLayer({}), false);
  assert.equal(isPlateauLayer({ type: "tileset" }), false);
  assert.equal(
    isPlateauLayer({ type: "tileset", sourceConfig: { kind: "osm-buildings" } }),
    false,
  );
  assert.equal(
    isPlateauLayer({ type: "geojson", sourceConfig: { kind: "plateau-buildings" } }),
    false,
  );
});

test("listPlateauLayers filters to PLATEAU tileset layers", () => {
  const plateau = makePlateauLayer({ id: "plateau" });
  const nonPlateau = { type: "tileset", sourceConfig: { kind: "osm-buildings" } };
  assert.deepEqual(listPlateauLayers([nonPlateau, plateau, null]), [plateau]);
});

test("findPlateauLayerForFeature resolves picked feature tilesets", () => {
  const tileset = { style: null, makeStyleDirty() {} };
  const layer = makePlateauLayer({ data: tileset });
  const feature = { content: { tileset } };
  assert.equal(findPlateauLayerForFeature([layer], feature), layer);
  assert.equal(findPlateauLayerForFeature([layer], { content: { tileset: {} } }), null);
});

// --- (de)serialize --------------------------------------------------------

test("deserializePlateauOverrides drops malformed entries", () => {
  const map = deserializePlateauOverrides([
    { featureKey: "a", mode: "ghost", label: "A" },
    { featureKey: "b", mode: "hidden" },
    { featureKey: "c", mode: "bogus" }, // bad mode
    { mode: "ghost" }, // missing featureKey
    null,
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get("a").mode, "ghost");
  assert.equal(map.get("a").label, "A");
  assert.equal(map.get("b").label, "b"); // falls back to featureKey
});

test("deserializePlateauOverrides accepts empty / non-array input", () => {
  assert.equal(deserializePlateauOverrides().size, 0);
  assert.equal(deserializePlateauOverrides(null).size, 0);
  assert.equal(deserializePlateauOverrides("not an array").size, 0);
});

test("serialize -> deserialize round-trips a PLATEAU layer's overrides", () => {
  const layer = makePlateauLayer({
    plateauOverrides: [
      { featureKey: "a", mode: "ghost", label: "Alpha" },
      { featureKey: "b", mode: "hidden", label: "Beta" },
    ],
  });
  const serialized = serializePlateauOverrides(layer);
  assert.deepEqual(serialized, [
    { featureKey: "a", mode: "ghost", label: "Alpha" },
    { featureKey: "b", mode: "hidden", label: "Beta" },
  ]);
  const restored = deserializePlateauOverrides(serialized);
  assert.equal(restored.size, 2);
  assert.equal(restored.get("a").mode, "ghost");
});

test("restoreSerializedPlateauOverrides normalizes saved overrides", () => {
  const layer = makePlateauLayer({
    plateauOverrides: new Map([["old", { mode: "ghost", label: "Old" }]]),
  });
  restoreSerializedPlateauOverrides(layer, [
    { featureKey: "new", mode: "hidden", label: "New" },
    { featureKey: "bad", mode: "invalid" },
  ]);
  assert.equal(layer.plateauOverrides instanceof Map, true);
  assert.equal(layer.plateauOverrides.size, 1);
  assert.equal(layer.plateauOverrides.get("new").mode, "hidden");
  assert.equal(layer.plateauOverrides.has("old"), false);
});

// --- feature property extraction -----------------------------------------

test("getFeatureProperty returns null on missing / blank / throwing", () => {
  assert.equal(getFeatureProperty(null, "x"), null);
  assert.equal(getFeatureProperty({}, "x"), null); // no getProperty fn
  assert.equal(
    getFeatureProperty({ getProperty: () => null }, "x"),
    null,
  );
  assert.equal(
    getFeatureProperty({ getProperty: () => "" }, "x"),
    null,
  );
  assert.equal(
    getFeatureProperty({ getProperty: () => { throw new Error("oops"); } }, "x"),
    null,
  );
});

test("getFeatureProperty coerces non-string values to strings", () => {
  assert.equal(getFeatureProperty({ getProperty: () => 42 }, "x"), "42");
  assert.equal(getFeatureProperty({ getProperty: () => false }, "x"), "false");
});

// --- feature key / label --------------------------------------------------

test("getPlateauFeatureKey prefers higher-priority ID properties", () => {
  const feature = {
    getProperty: (name) => {
      if (name === "uro:buildingID") return "B-001";
      if (name === "gml_id") return "G-099";
      return null;
    },
  };
  // uro:buildingID is listed before gml_id in PLATEAU_ID_PROPERTIES.
  const idx = PLATEAU_ID_PROPERTIES.indexOf("uro:buildingID");
  assert.ok(idx < PLATEAU_ID_PROPERTIES.indexOf("gml_id"));
  assert.equal(getPlateauFeatureKey(feature), "uro:buildingID:B-001");
});

test("getPlateauFeatureKey falls back to content URL + featureId", () => {
  const feature = {
    getProperty: () => null,
    content: { url: "https://example.test/tile.glb" },
    featureId: 7,
  };
  assert.equal(
    getPlateauFeatureKey(feature),
    "feature:https://example.test/tile.glb:7",
  );
});

test("getPlateauFeatureKey returns null when nothing identifies the feature", () => {
  assert.equal(getPlateauFeatureKey({ getProperty: () => null }), null);
});

test("getPlateauFeatureLabel falls back to the featureKey itself", () => {
  const feature = { getProperty: () => null };
  assert.equal(getPlateauFeatureLabel(feature, "fallback-key"), "fallback-key");
});

test("getPlateauFeatureLabel prefers `name` over ID-only fields", () => {
  const feature = {
    getProperty: (n) => (n === "uro:buildingID" ? "ID-1" : n === "name" ? "Tokyo Tower" : null),
  };
  // The ID matches first in the lookup order, so the label IS the ID — that's the contract.
  assert.equal(getPlateauFeatureLabel(feature, "k"), "ID-1");
});

test("createPlateauFeatureSelection returns stable selection metadata", () => {
  const layer = makePlateauLayer({ id: "plateau-layer" });
  const feature = { getProperty: (name) => (name === "uro:buildingID" ? "B-10" : null) };
  assert.deepEqual(createPlateauFeatureSelection(layer, feature), {
    layerId: "plateau-layer",
    layer,
    featureKey: "uro:buildingID:B-10",
    label: "B-10",
  });
  assert.equal(createPlateauFeatureSelection(layer, { getProperty: () => null }), null);
  assert.equal(createPlateauFeatureSelection({ type: "geojson" }, feature), null);
});

// --- getPlateauOverride --------------------------------------------------

test("getPlateauOverride looks up by the feature's key", () => {
  const overrides = new Map([["uro:buildingID:B-9", { mode: "ghost", label: "B-9" }]]);
  const layer = { plateauOverrides: overrides };
  const feature = { getProperty: (n) => (n === "uro:buildingID" ? "B-9" : null) };
  assert.equal(getPlateauOverride(layer, feature)?.mode, "ghost");
});

test("getPlateauOverride returns undefined when the feature isn't overridden", () => {
  const layer = { plateauOverrides: new Map() };
  const feature = { getProperty: (n) => (n === "uro:buildingID" ? "B-9" : null) };
  assert.equal(getPlateauOverride(layer, feature), undefined);
});

test("override collection helpers mutate only PLATEAU layers", () => {
  const first = makePlateauLayer({ id: "first", label: "First" });
  const second = makePlateauLayer({ id: "second", label: "Second" });
  const nonPlateau = { type: "tileset", sourceConfig: { kind: "osm-buildings" } };

  assert.equal(setPlateauFeatureOverride(first, "a", "ghost", "Alpha"), true);
  assert.equal(setPlateauFeatureOverride(second, "b", "hidden", "Beta"), true);
  assert.equal(setPlateauFeatureOverride(nonPlateau, "c", "ghost", "Gamma"), false);
  assert.equal(setPlateauFeatureOverride(first, "invalid", "bogus", "Bad"), false);
  assert.equal(countPlateauOverrides([first, second, nonPlateau]), 2);
  assert.equal(getPlateauOverrideMode(first, "a"), "ghost");

  assert.deepEqual(
    listPlateauOverrideEntries([first, second]).map(({ layer, featureKey, entry }) => ({
      layerId: layer.id,
      featureKey,
      mode: entry.mode,
      label: entry.label,
    })),
    [
      { layerId: "first", featureKey: "a", mode: "ghost", label: "Alpha" },
      { layerId: "second", featureKey: "b", mode: "hidden", label: "Beta" },
    ],
  );

  assert.equal(removePlateauFeatureOverride(first, "a"), true);
  assert.equal(getPlateauOverrideMode(first, "a"), null);
  assert.equal(countPlateauOverrides([first, second]), 1);

  clearPlateauFeatureOverrides([first, second, nonPlateau]);
  assert.equal(countPlateauOverrides([first, second]), 0);
});

// --- getFeatureTileset ----------------------------------------------------

test("getFeatureTileset walks the Cesium nesting variants", () => {
  const tileset = { ref: "t" };
  assert.equal(getFeatureTileset({ tileset }), tileset);
  assert.equal(getFeatureTileset({ content: { tileset } }), tileset);
  assert.equal(getFeatureTileset({ primitive: { content: { tileset } } }), tileset);
  assert.equal(getFeatureTileset({ primitive: { _content: { tileset } } }), tileset);
  // Root-shaped primitive (a tileset itself).
  const tilesetLike = { root: {} };
  assert.equal(getFeatureTileset({ primitive: tilesetLike }), tilesetLike);
  assert.equal(getFeatureTileset(null), null);
  assert.equal(getFeatureTileset({}), null);
});

// --- pickThroughGhosts ----------------------------------------------------

test("pickThroughGhosts skips ghosted features and returns the one behind", () => {
  const ghostLayer = { plateauOverrides: new Map([["uro:buildingID:G", { mode: "ghost" }]]) };
  const solidLayer = { plateauOverrides: new Map() };

  const ghostedFeature = { getProperty: (n) => (n === "uro:buildingID" ? "G" : null) };
  const solidFeature = { getProperty: (n) => (n === "uro:buildingID" ? "S" : null) };

  const result = pickThroughGhosts({ x: 0, y: 0 }, {
    drillPick: () => [ghostedFeature, solidFeature],
    layerForFeature: (f) => (f === ghostedFeature ? ghostLayer : solidLayer),
  });
  assert.equal(result, solidFeature);
});

test("pickThroughGhosts returns the first feature if nothing is ghosted", () => {
  const layer = { plateauOverrides: new Map() };
  const first = { getProperty: () => "x" };
  const second = { getProperty: () => "y" };
  const result = pickThroughGhosts({ x: 0, y: 0 }, {
    drillPick: () => [first, second],
    layerForFeature: () => layer,
  });
  assert.equal(result, first);
});

test("pickThroughGhosts handles an empty drill-pick result", () => {
  const result = pickThroughGhosts({ x: 0, y: 0 }, {
    drillPick: () => [],
    layerForFeature: () => null,
  });
  assert.equal(result, undefined);
});

// --- test helpers ---------------------------------------------------------

function makePlateauLayer({
  id = "plateau",
  label = "PLATEAU",
  data = { style: null, makeStyleDirty() {} },
  plateauOverrides = [],
} = {}) {
  return {
    id,
    label,
    type: "tileset",
    sourceConfig: { kind: "plateau-buildings" },
    data,
    plateauOverrides,
  };
}
