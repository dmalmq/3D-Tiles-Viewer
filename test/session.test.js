import test from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_SCHEMA_VERSION,
  SUPPORTED_SESSION_VERSIONS,
  applySavedModelLevelOverrides,
  buildVenueManifest,
  createSessionRestorePlan,
  filterSessionByVenue,
  groupSessionBuildingsByTileset,
  isSupportedSessionVersion,
  isValidActiveModelLevelIndex,
  normalizeRestoredShapefileLayerData,
  normalizeRestoredUnassignedLayerData,
  parseSessionJson,
  serializeSession,
  slugifyVenueId,
  resolveSessionAssetUrl,
  shouldLoadTilesetFromUrl,
} from "../src/session.js";

const baseState = () => ({
  imagery: "carto-positron",
  terrain: "plateau",
  plateauOverridesEnabled: true,
  modelLevels: [
    { floorNumber: 1, name: "1F", elevation: 0 },
    { floorNumber: 2, name: "2F", elevation: 4.2 },
  ],
  activeModelLevelIndex: 0,
  buildings: [],
  importedLayers: [],
  unassignedLayers: [],
  isPlateauLayer: () => false,
  serializePlateauOverrides: () => [],
});

test("serializeSession stamps the current schema version", () => {
  const data = serializeSession(baseState());
  assert.equal(data.version, SESSION_SCHEMA_VERSION);
});

test("buildings sharing a tileset get the same tilesetGroupId", () => {
  const shared = {};
  const state = baseState();
  state.buildings = [
    makeBuilding({ name: "A", tileset: shared }),
    makeBuilding({ name: "B", tileset: shared }),
    makeBuilding({ name: "C", tileset: {} }),
  ];
  const data = serializeSession(state);
  assert.equal(data.buildings[0].tilesetGroupId, data.buildings[1].tilesetGroupId);
  assert.notEqual(data.buildings[0].tilesetGroupId, data.buildings[2].tilesetGroupId);
});

test("a building with no tileset gets a null tilesetGroupId", () => {
  const state = baseState();
  state.buildings = [makeBuilding({ name: "ghost", tileset: null })];
  const data = serializeSession(state);
  assert.equal(data.buildings[0].tilesetGroupId, null);
});

test("imported layers without a sourceConfig are dropped", () => {
  const state = baseState();
  state.importedLayers = [
    { label: "keeper", visible: true, sourceConfig: { type: "plateau" } },
    { label: "ephemeral", visible: true /* no sourceConfig */ },
  ];
  const data = serializeSession(state);
  assert.deepEqual(
    data.importedLayers.map((l) => l.label),
    ["keeper"],
  );
});

test("PLATEAU layers get their overrides serialized", () => {
  const state = baseState();
  state.importedLayers = [
    { label: "plateau", visible: true, sourceConfig: { type: "plateau" }, _isPlateau: true },
  ];
  state.isPlateauLayer = (l) => !!l._isPlateau;
  state.serializePlateauOverrides = () => [{ id: "abc", state: "hidden" }];
  const data = serializeSession(state);
  assert.deepEqual(data.importedLayers[0].plateauOverrides, [{ id: "abc", state: "hidden" }]);
});

test("parseSessionJson rejects non-JSON input", () => {
  assert.throws(() => parseSessionJson("not json"), /not valid JSON/);
});

test("parseSessionJson rejects empty / non-object payloads", () => {
  assert.throws(() => parseSessionJson("null"), /did not contain a session object/);
  assert.throws(() => parseSessionJson("42"), /did not contain a session object/);
});

test("parseSessionJson rejects unsupported versions", () => {
  assert.throws(
    () => parseSessionJson(JSON.stringify({ version: 99 })),
    /Unsupported session version/,
  );
});

test("parseSessionJson accepts each supported version", () => {
  for (const v of SUPPORTED_SESSION_VERSIONS) {
    const parsed = parseSessionJson(JSON.stringify({ version: v }));
    assert.equal(parsed.version, v);
  }
});

test("isSupportedSessionVersion is true for supported, false otherwise", () => {
  for (const v of SUPPORTED_SESSION_VERSIONS) assert.equal(isSupportedSessionVersion(v), true);
  assert.equal(isSupportedSessionVersion(0), false);
  assert.equal(isSupportedSessionVersion(99), false);
});

test("groupSessionBuildingsByTileset reunites saved sibling groups", () => {
  const a = { name: "A", tilesetGroupId: 1 };
  const b = { name: "B", tilesetGroupId: 1 };
  const c = { name: "C" };
  const d = { name: "D" };
  assert.deepEqual(groupSessionBuildingsByTileset([a, b, c, d]), [[a, b], [c], [d]]);
});

test("createSessionRestorePlan reports primary restore progress items", () => {
  const data = {
    buildings: [
      { name: "A", tilesetGroupId: 1 },
      { name: "B", tilesetGroupId: 1 },
      { name: "C" },
    ],
    importedLayers: [{ label: "imported" }],
    unassignedLayers: [{ name: "staged" }],
  };
  const plan = createSessionRestorePlan(data);
  assert.equal(plan.buildingGroups.length, 2);
  assert.equal(plan.importedLayers.length, 1);
  assert.equal(plan.unassignedLayers.length, 1);
  assert.equal(plan.primaryItemCount, 3);
});

test("applySavedModelLevelOverrides restores user-edited names and elevations", () => {
  const modelLevels = [
    { floorNumber: 1, name: "1F", elevation: 0 },
    { floorNumber: 2, name: "2F", elevation: 4 },
  ];
  applySavedModelLevelOverrides(modelLevels, [
    { floorNumber: 1, name: "Lobby", elevation: 0.5 },
    { floorNumber: 2, name: "", elevation: Number.NaN },
  ]);
  assert.deepEqual(modelLevels, [
    { floorNumber: 1, name: "Lobby", elevation: 0.5 },
    { floorNumber: 2, name: "2F", elevation: 4 },
  ]);
});

test("isValidActiveModelLevelIndex accepts all-floors and in-range indices", () => {
  const modelLevels = [{ floorNumber: 1 }, { floorNumber: 2 }];
  assert.equal(isValidActiveModelLevelIndex(-1, modelLevels), true);
  assert.equal(isValidActiveModelLevelIndex(0, modelLevels), true);
  assert.equal(isValidActiveModelLevelIndex(1, modelLevels), true);
  assert.equal(isValidActiveModelLevelIndex(2, modelLevels), false);
  assert.equal(isValidActiveModelLevelIndex("1", modelLevels), false);
});

test("normalizeRestoredShapefileLayerData applies defaults and fallback source", () => {
  const features = [{ type: "Feature", properties: {} }];
  assert.deepEqual(
    normalizeRestoredShapefileLayerData({ features }, { fallbackSource: "detected" }),
    {
      name: "layer",
      color: "#4fc3f7",
      levelKey: null,
      source: "detected",
      features,
      heightOffset: 0,
      _origin: "gdb",
      _hidden: false,
      colorColumn: null,
      colorMappings: null,
    },
  );
});

test("normalizeRestoredUnassignedLayerData skips empty feature payloads", () => {
  assert.equal(normalizeRestoredUnassignedLayerData({ features: [] }), null);
  assert.equal(normalizeRestoredUnassignedLayerData(null), null);
});

test("serializeSession v3 includes venues and venueId", () => {
  const state = baseState();
  state.venues = [{ id: "east-hub", name: "East Hub", description: "notes" }];
  state.buildings = [makeBuilding({ name: "Tower A", tileset: {}, venueId: "east-hub" })];
  const data = serializeSession(state);
  assert.equal(data.version, SESSION_SCHEMA_VERSION);
  assert.deepEqual(data.venues, [{ id: "east-hub", name: "East Hub", description: "notes" }]);
  assert.equal(data.buildings[0].venueId, "east-hub");
});

test("filterSessionByVenue keeps only matching buildings and imported layers", () => {
  const data = {
    version: 3,
    venues: [
      { id: "east-hub", name: "East Hub", description: "" },
      { id: "west-campus", name: "West Campus", description: "" },
    ],
    buildings: [
      { name: "A", venueId: "east-hub", levels: [{ name: "1F", floor: 0 }] },
      { name: "B", venueId: "west-campus", levels: [] },
    ],
    importedLayers: [
      { label: "p1", visible: true, sourceConfig: { type: "plateau" }, venueId: "east-hub" },
      { label: "p2", visible: true, sourceConfig: { type: "plateau" }, venueId: "west-campus" },
    ],
    modelLevels: [],
    activeModelLevelIndex: -1,
  };
  const slice = filterSessionByVenue(data, "east-hub");
  assert.equal(slice.buildings.length, 1);
  assert.equal(slice.buildings[0].name, "A");
  assert.equal(slice.importedLayers.length, 1);
  assert.equal(slice.unassignedLayers.length, 0);
});

test("buildVenueManifest maps venue ids to session URLs", () => {
  const manifest = buildVenueManifest(
    [{ id: "east-hub", name: "East Hub" }],
    { baseUrl: "https://example.test/sessions/" },
  );
  assert.equal(manifest.venues[0].sessionUrl, "https://example.test/sessions/east-hub.json");
});

test("slugifyVenueId normalizes display names", () => {
  assert.equal(slugifyVenueId("East Hub Area"), "east-hub-area");
});

test("resolveSessionAssetUrl leaves absolute URLs unchanged", () => {
  assert.equal(resolveSessionAssetUrl("https://x.test/tileset.json"), "https://x.test/tileset.json");
});

test("shouldLoadTilesetFromUrl accepts sourceUrl regardless of sourceType", () => {
  assert.equal(
    shouldLoadTilesetFromUrl({ sourceType: "file", sourceUrl: "/tilesets/abc/tileset.json" }),
    true,
  );
});

function makeBuilding({ name, tileset, venueId = null }) {
  return {
    name,
    tileset,
    venueId,
    sourceUrl: "https://example.test/tileset.json",
    heightOffset: 0,
    levelBaseElevation: 100,
    activeLevelIndex: -1,
    aliases: [],
    linkFilter: null,
    levels: [],
    sourceLevelGroups: new Map(),
    shapefileLayers: [],
    directoryHandleId: null,
    _directoryFolderName: null,
  };
}
