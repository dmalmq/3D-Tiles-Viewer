import test from "node:test";
import assert from "node:assert/strict";
import {
  Cartesian3,
  Cartographic,
  JulianDate,
  Matrix4,
  Transforms,
} from "cesium";

import {
  POINT_EXTRA_HEIGHT_M,
  SHAPEFILE_FLOOR_CLEARANCE_M,
  SOURCE_LEVEL_LOCAL_Z_SURFACE_LIFT_M,
  applyShapefileLayerHeight,
  buildingLevelWorldHeight,
} from "../src/shapefilePlacement.js";

const LON = 139.7;
const LAT = 35.7;

function makePointLayer() {
  return {
    name: "layer",
    levelKey: "l1",
    heightOffset: 0,
    dataSource: {
      entities: {
        values: [
          {
            position: Cartesian3.fromDegrees(LON, LAT, 0),
          },
        ],
      },
    },
  };
}

function makeAllFloorsPointLayer() {
  const layer = makePointLayer();
  layer.levelKey = null;
  return layer;
}

function makeBuilding({
  baseHeight,
  rootHeight,
  levelFloor = 10,
  levels = [{ key: "l1", name: "1F", floor: levelFloor }],
  linkFilter = null,
  sourceLevelGroups = null,
}) {
  return {
    heightOffset: 0,
    levelBaseElevation: baseHeight,
    levels,
    linkFilter,
    sourceLevelGroups,
    tileset: {
      modelMatrix: Matrix4.IDENTITY,
      root: {
        transform: Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(LON, LAT, rootHeight),
        ),
      },
    },
  };
}

function layerPointHeight(layer) {
  const time = JulianDate.now();
  const position = layer.dataSource.entities.values[0].position.getValue(time);
  return Cartographic.fromCartesian(position).height;
}

test("GDB/shapefile point placement uses tileset-local Z when it matches the WGS84 level anchor", () => {
  const building = makeBuilding({ baseHeight: 100, rootHeight: 100 });
  const layer = makePointLayer();

  applyShapefileLayerHeight(building, layer);

  const expected = 100 + 10 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile point placement trusts tileset-local Z over stale fallback base", () => {
  const building = makeBuilding({ baseHeight: 1000, rootHeight: 0 });
  const layer = makePointLayer();

  applyShapefileLayerHeight(building, layer);

  const expected = 10 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile point placement prefers a level's explicit local plane (localPlaneZ)", () => {
  // RevitGeoSuite package building: levels.json `floor` can sit in a different
  // frame than the tileset geometry (LUMINE1: 1F floor +24.94, true local plane
  // -13.76). Package ingest attaches the reconciled plane as localPlaneZ — it
  // must win over the floor-based fallback.
  const building = makeBuilding({
    baseHeight: 90,
    rootHeight: 90,
    levels: [{ key: "l1", name: "1F", floor: 24.94, localPlaneZ: -13.76 }],
  });
  const layer = makePointLayer();

  applyShapefileLayerHeight(building, layer);

  const expected =
    90 +
    -13.76 +
    SHAPEFILE_FLOOR_CLEARANCE_M +
    POINT_EXTRA_HEIGHT_M;
  assert.ok(
    Math.abs(layerPointHeight(layer) - expected) < 0.001,
    `expected ${expected}, got ${layerPointHeight(layer)}`
  );
});

test("GDB/shapefile point placement uses split source-level local Z metadata", () => {
  const building = makeBuilding({
    baseHeight: 75.8,
    rootHeight: 100,
    levels: [{ key: "3f", name: "3F", floor: 39.71800231933594 }],
    linkFilter: { property: "sourceLinkName", value: "Shinjuku_LUMINE1" },
    sourceLevelGroups: new Map([
      [
        "1",
        [{ key: "3f", name: "3F", floor: 39.71800231933594, minZMeters: 25 }],
      ],
      [
        "Shinjuku_LUMINE1",
        [
          {
            key: "3f",
            name: "3F",
            floor: 39.71800231933594,
            minZMeters: 1.018000602722168,
            maxZMeters: 6.948932647705078,
          },
        ],
      ],
    ]),
  });
  const layer = makePointLayer();
  layer.name = "SHINJUKU_LUMINE1_3_unit";
  layer.levelKey = "3f";
  layer.source = "1";

  applyShapefileLayerHeight(building, layer);

  const expected =
    100 +
    1.018000602722168 +
    SOURCE_LEVEL_LOCAL_Z_SURFACE_LIFT_M +
    SHAPEFILE_FLOOR_CLEARANCE_M +
    POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile point placement ignores default source minZ below the level plane", () => {
  const rootHeight = 87.3550033569336;
  const levelFloor = -83.9050064086914;
  const building = makeBuilding({
    baseHeight: 214.2,
    rootHeight,
    levels: [
      {
        key: "1f",
        name: "1FL_コンコース(TP+3.45)",
        floor: levelFloor,
      },
    ],
    linkFilter: { property: "sourceLinkName", value: "" },
    sourceLevelGroups: new Map([
      [
        "",
        [
          {
            key: "1f",
            name: "1FL_コンコース(TP+3.45)",
            floor: levelFloor,
            minZMeters: -88.25340270996094,
            maxZMeters: -78.88400268554688,
          },
        ],
      ],
    ]),
  });
  const layer = makePointLayer();
  layer.levelKey = "1f";
  layer.source = "1";

  applyShapefileLayerHeight(building, layer);

  const expected = rootHeight + levelFloor + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile point placement does not double-add absolute level elevations", () => {
  const building = makeBuilding({ baseHeight: 36, rootHeight: 36, levelFloor: 36 });
  const layer = makePointLayer();

  applyShapefileLayerHeight(building, layer);

  const expected = 36 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile all-floor placement keeps the building base for absolute level sets", () => {
  const building = makeBuilding({ baseHeight: 36, rootHeight: 36, levelFloor: 36 });
  const layer = makeAllFloorsPointLayer();

  applyShapefileLayerHeight(building, layer);

  const expected = 36 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("TP level names derive Shinjuku world heights instead of adding stale base elevation", () => {
  const building = {
    levelBaseElevation: 93.3,
    levels: [
      { key: "tp_0", name: "TP±0", floor: -9.201998710632324 },
      { key: "1f", name: "1F_東口（TP+36,250）", floor: 27.04800033569336 },
    ],
  };

  assert.ok(Math.abs(buildingLevelWorldHeight(building, building.levels[1]) - 36.25) < 0.001);
});

test("buildings without TP labels use sibling TP datum when available", () => {
  const station = {
    levelBaseElevation: 93.3,
    levels: [
      { key: "tp_0", name: "TP±0", floor: -9.201998710632324 },
      { key: "1f_station", name: "1F_東口（TP+36,250）", floor: 27.04800033569336 },
    ],
  };
  const sibling = {
    levelBaseElevation: 79.7,
    levels: [{ key: "1f", name: "1F", floor: 31.79800033569336 }],
  };
  const siblings = [station, sibling];
  station._siblingBuildings = siblings;
  sibling._siblingBuildings = siblings;

  assert.ok(Math.abs(buildingLevelWorldHeight(sibling, sibling.levels[0]) - 41) < 0.001);
});

test("GDB/shapefile fallback uses source-level TP datum instead of stale saved base", () => {
  const building = {
    heightOffset: 0,
    levelBaseElevation: 75.8,
    levels: [{ key: "3f", name: "3F", floor: 39.71800231933594 }],
    sourceLevelGroups: new Map([
      [
        "",
        [
          { key: "tp_0", name: "TP±0", floor: -9.201998710632324 },
          { key: "1f", name: "1F_東口（TP+36,250）", floor: 27.04800033569336 },
        ],
      ],
    ]),
  };
  const layer = makePointLayer();
  layer.levelKey = "3f";

  applyShapefileLayerHeight(building, layer);

  const expected = 48.92000122070313 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});

test("GDB/shapefile source-specific levels still use building TP datum", () => {
  const sourceLevels = [{ key: "b1", name: "B1", floor: -17.0419979095459 }];
  const building = {
    heightOffset: 0,
    levelBaseElevation: 102,
    levels: [
      { key: "b1f_tp", name: "B1F_地下通路(TP+29.660)", floor: -17.0419979095459 },
    ],
    sourceLevelGroups: new Map([["source-a", sourceLevels]]),
  };
  const layer = makePointLayer();
  layer.levelKey = "b1";
  layer.source = "source-a";

  applyShapefileLayerHeight(building, layer);

  const expected = 29.660000514984134 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(layerPointHeight(layer) - expected) < 0.001);
});
