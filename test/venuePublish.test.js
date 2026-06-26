import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublishPlan,
  parsePublishResponse,
  createPublishMetadataFile,
  validatePublishedSessions,
  buildingNeedsPublishedTileset,
} from "../src/venuePublish.js";
import { buildTilesetUrlMap } from "../src/tilesetBundle.js";
import { resolveVenueIdFromParams, DEFAULT_MANIFEST_URL } from "../src/venueManifest.js";

const baseState = () => ({
  imagery: "carto-positron",
  terrain: "plateau",
  plateauOverridesEnabled: true,
  modelLevels: [],
  activeModelLevelIndex: -1,
  venues: [{ id: "east-hub", name: "East Hub", description: "" }],
  buildings: [
    {
      name: "Tower A",
      venueId: "east-hub",
      tileset: {},
      sourceUrl: null,
      directoryHandleId: "dir-1",
      levels: [],
      shapefileLayers: [],
    },
  ],
  importedLayers: [],
  unassignedLayers: [],
  isPlateauLayer: () => false,
  serializePlateauOverrides: () => [],
});

test("buildPublishPlan uses /sessions/ manifest paths", () => {
  const plan = buildPublishPlan(baseState());
  assert.equal(plan.ok, true);
  assert.equal(plan.manifest.venues[0].sessionUrl, "/sessions/east-hub.json");
});

test("buildTilesetUrlMap points published tilesets at /tilesets/", () => {
  const buildings = baseState().buildings;
  const bundles = [
    { key: "dir-1", buildingNames: ["Tower A"], skipUpload: false },
  ];
  const map = buildTilesetUrlMap(buildings, bundles, {});
  assert.equal(map.get("Tower A"), "/tilesets/dir-1/tileset.json");
});

test("resolveVenueIdFromParams reads venue query", () => {
  const params = new URLSearchParams("?venue=east-hub");
  assert.equal(resolveVenueIdFromParams(params), "east-hub");
});

test("DEFAULT_MANIFEST_URL falls back to /sessions/venues.json", () => {
  assert.equal(DEFAULT_MANIFEST_URL, "/sessions/venues.json");
});

test("parsePublishResponse parses JSON bodies", () => {
  const body = parsePublishResponse('{"ok":true,"links":{}}', 200);
  assert.equal(body.ok, true);
});

test("parsePublishResponse surfaces HTML proxy errors without double-reading", () => {
  const body = parsePublishResponse("<!DOCTYPE html><html>", 502);
  assert.match(body.error, /HTML.*502/);
  assert.match(body.error, /npm run dev/);
});

test("parsePublishResponse surfaces plain-text API errors", () => {
  const body = parsePublishResponse("upstream connect error", 503);
  assert.equal(body.error, "upstream connect error");
});

test("parsePublishResponse extracts Multer errors from HTML bodies", () => {
  const body = parsePublishResponse(
    "<!DOCTYPE html><pre>MulterError: Field value too long</pre>",
    500,
  );
  assert.equal(body.error, "Field value too long");
});

test("validatePublishedSessions requires sourceUrl when building has layers", () => {
  const sessions = [
    {
      id: "east-hub",
      data: {
        buildings: [
          { name: "Tower A", sourceUrl: null, shapefileLayers: [{ name: "layer" }], levels: [] },
        ],
      },
    },
  ];
  const result = validatePublishedSessions(sessions);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "tilesetNotBundled");
  assert.deepEqual(result.buildings, ["Tower A"]);
});

test("buildingNeedsPublishedTileset is true when levels exist", () => {
  assert.equal(buildingNeedsPublishedTileset({ levels: [{ name: "1F" }] }), true);
});

test("createPublishMetadataFile uses File when available", () => {
  const file = createPublishMetadataFile('{"ok":true}');
  if (typeof File !== "undefined") {
    assert.ok(file instanceof File);
    assert.equal(file.name, "metadata.json");
  } else {
    assert.ok(file instanceof Blob);
  }
});