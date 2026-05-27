import test from "node:test";
import assert from "node:assert/strict";

import {
  SESSION_SCHEMA_VERSION,
  SUPPORTED_SESSION_VERSIONS,
  isSupportedSessionVersion,
  parseSessionJson,
  serializeSession,
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

function makeBuilding({ name, tileset }) {
  return {
    name,
    tileset,
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
