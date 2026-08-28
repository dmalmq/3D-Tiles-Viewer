import test from "node:test";
import assert from "node:assert/strict";
import { Cartesian3, Color, PolygonHierarchy } from "cesium";

import { buildWebsiteManifest } from "../src/websiteManifest.js";

function state({ venues, buildings }) {
  return { venues, buildings };
}

function pointEntity(longitude, latitude, height, properties) {
  return {
    position: { getValue: () => Cartesian3.fromDegrees(longitude, latitude, height) },
    properties: { getValue: () => properties },
  };
}

function polygonEntity(coordinates, properties, color) {
  return {
    polygon: {
      hierarchy: {
        getValue: () =>
          new PolygonHierarchy(
            coordinates.map(([longitude, latitude, height]) =>
              Cartesian3.fromDegrees(longitude, latitude, height),
            ),
          ),
      },
      material: { getValue: () => ({ color: Color.fromCssColorString(color) }) },
      outlineColor: { getValue: () => Color.fromCssColorString("#333333") },
    },
    properties: { getValue: () => properties },
  };
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
        dataSource: {
          entities: {
            values: [
              pointEntity(139.75, 35.64, 18.65, {
                name: "Lift",
                symbol_id: "elevator",
                image: "/marker/elevator.png",
              }),
              pointEntity(139.7501, 35.6401, 22.25, {
                name: "Stair",
                symbol_id: "stairs_up",
                levelKey: "level-2",
              }),
            ],
          },
        },
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

test("export uses the placed point heights, not raw GDB feature Z", () => {
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [twoLevelBuilding()] }),
  );
  const [doc] = result.layerDocs;

  assert.equal(doc.path, "layers/vertical-circulation.geojson");
  assert.ok(
    Math.abs(doc.json.features[0].geometry.coordinates[2] - 18.65) < 1e-6,
  );
  assert.ok(
    Math.abs(doc.json.features[1].geometry.coordinates[2] - 22.25) < 1e-6,
    "live entity heights are the floor-projected heights shown in the app",
  );
  assert.deepEqual(
    doc.json.features.map((feature) => feature.properties.levelKey),
    ["level-1", "level-2"],
  );
  assert.deepEqual(result.iconSlugs, ["elevator.png"]);
  assert.equal(
    result.warnings.some((warning) => warning.reason === "layerNotPlaced"),
    false,
  );
});

test("export captures configured color2 styling from placed polygon entities", () => {
  const coordinates = [
    [139.75, 35.64, 18.65],
    [139.7501, 35.64, 18.65],
    [139.7501, 35.6401, 18.65],
    [139.75, 35.6401, 18.65],
  ];
  const space = {
    name: "Concourse_Space",
    color: "#3498db",
    levelKey: "level-1",
    _origin: "gdb",
    colorColumn: "color2",
    colorMappings: { "橙": "#FFC090" },
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...coordinates.map((p) => p.slice(0, 2))]] },
        properties: { color2: "橙", name: "Paid area" },
      },
    ],
    dataSource: {
      entities: {
        values: [polygonEntity(coordinates, { color2: "橙", name: "Paid area" }, "#FFC090")],
      },
    },
  };
  const building = twoLevelBuilding({ shapefileLayers: [space] });
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [building] }),
  );
  const [feature] = result.layerDocs[0].json.features;

  assert.equal(feature.properties.color2, "橙");
  assert.equal(feature.properties.__viewerColor, "rgb(255,192,144)");
  assert.equal(feature.properties.__viewerOutlineColor, "rgb(51,51,51)");
  assert.ok(
    feature.geometry.coordinates[0].every((position) => Math.abs(position[2] - 18.65) < 1e-3),
    "the polygon carries the authoring viewer's placed height",
  );
});

test("raw GDB fallback strips source Z, computes color2, and warns", () => {
  const layer = {
    name: "Fallback_Space",
    color: "#3498db",
    levelKey: "level-1",
    _origin: "gdb",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.75, 35.64, -72] },
        properties: { color2: "橙", name: "Raw point" },
      },
    ],
  };
  const building = twoLevelBuilding({ shapefileLayers: [layer] });
  const result = buildWebsiteManifest(
    state({ venues: [{ id: "demo", name: "Demo" }], buildings: [building] }),
  );
  const [feature] = result.layerDocs[0].json.features;

  assert.deepEqual(feature.geometry.coordinates, [139.75, 35.64]);
  assert.equal(feature.properties.__viewerColor, "#FFC090");
  assert.ok(result.warnings.some((warning) => warning.reason === "layerNotPlaced"));
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
  assert.equal(result.manifest.layers.length, 1);
  assert.deepEqual(
    result.warnings.map((w) => [w.reason, w.detail]),
    [["multipleVenues", "Second venue"]],
  );
});
