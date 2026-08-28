import test from "node:test";
import assert from "node:assert/strict";

import { buildWebsiteManifest } from "../src/websiteManifest.js";

function state({ venues, buildings }) {
  return { venues, buildings };
}

function twoLevelBuilding(overrides = {}) {
  return {
    name: "Main Hall",
    venueId: "demo",
    levels: [
      { name: "1F", key: "level-1", floor: 0, minZMeters: 0, maxZMeters: 4 },
      { name: "2F", key: "level-2", floor: 4, minZMeters: 4, maxZMeters: 8 },
    ],
    shapefileLayers: [
      {
        name: "Vertical circulation",
        color: "#c93a22",
        levelKey: "level-1",
        _hidden: false,
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.75, 35.64, 1.6] },
            properties: { name: "Lift", symbol_id: "elevator", image: "/marker/elevator.png" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.7501, 35.6401, 1.6] },
            properties: { name: "Stair", symbol_id: "stairs_up", levelKey: "level-2" },
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("buildWebsiteManifest refuses a venue with no buildings", () => {
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [] }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "noVenuesWithBuildings");
});

test("buildWebsiteManifest emits a venue-web manifest for one venue", () => {
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo venue" }], buildings: [twoLevelBuilding()] }),
    { generatedAt: "2026-01-01T00:00:00.000Z" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.manifest.format, "venue-web");
  assert.equal(result.manifest.version, 1);
  assert.equal(result.manifest.id, "demo");
  assert.equal(result.manifest.synthetic, false, "real data is not marked synthetic");
  assert.equal(result.manifest.generatedAt, "2026-01-01T00:00:00.000Z");

  assert.deepEqual(
    result.manifest.levels.map((l) => [l.levelKey, l.levelElevationMeters]),
    [["level-1", 0], ["level-2", 4]],
  );

  assert.deepEqual(result.manifest.buildings, [
    {
      id: "main-hall",
      name: "Main Hall",
      tilesets: [{ levelKey: null, uri: "tiles/main-hall/tileset.json" }],
    },
  ]);

  const [layer] = result.manifest.layers;
  assert.equal(layer.uri, "layers/vertical-circulation.geojson");
  assert.equal(layer.geometry, "point");
  assert.equal(layer.color, "#c93a22");
  assert.equal(layer.defaultVisible, true);
});

test("layer features inherit the layer level and keep their own", () => {
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [twoLevelBuilding()] }),
  );
  const [doc] = result.layerDocs;

  assert.equal(doc.path, "layers/vertical-circulation.geojson");
  assert.equal(doc.json.type, "FeatureCollection");
  assert.deepEqual(
    doc.json.features.map((f) => f.properties.levelKey),
    ["level-1", "level-2"],
    "a feature without a level takes the layer's, one with a level keeps it",
  );
  assert.deepEqual(result.iconSlugs, ["elevator.png"], "icon paths are reduced to slugs");
});

test("hidden layers export but start switched off", () => {
  const building = twoLevelBuilding();
  building.shapefileLayers[0]._hidden = true;
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [building] }),
  );
  assert.equal(result.manifest.layers[0].defaultVisible, false);
});

test("empty layers are skipped and extra venues are reported", () => {
  const empty = twoLevelBuilding({ name: "Annex" });
  empty.shapefileLayers = [{ name: "Nothing", features: [] }];
  const second = twoLevelBuilding({ name: "Other Hall", venueId: "second" });

  const result = buildWebsiteManifest(
    state({
      venues: [
        { id: "demo", name: "Demo" },
        { id: "second", name: "Second venue" },
      ],
      buildings: [twoLevelBuilding(), empty, second],
    }),
  );

  assert.equal(result.manifest.id, "demo");
  assert.equal(result.manifest.layers.length, 1, "a layer with no features is not exported");
  assert.deepEqual(
    result.warnings.map((w) => [w.reason, w.detail]),
    [["multipleVenues", "Second venue"]],
  );
});
