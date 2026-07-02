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
  featureCollectionForVectorLayerRender,
  featuresForVectorLayerRender,
  stripGeoJsonFeatureCoordinateHeights,
} from "../src/geojsonHeight.js";
import {
  POINT_EXTRA_HEIGHT_M,
  SHAPEFILE_FLOOR_CLEARANCE_M,
  applyShapefileLayerHeight,
} from "../src/shapefilePlacement.js";

const LON = 139.7;
const LAT = 35.7;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

test("GDB render copies strip coordinate heights without mutating raw features", () => {
  const features = [
    {
      type: "Feature",
      properties: { kind: "point" },
      geometry: { type: "Point", coordinates: [1, 2, 100] },
    },
    {
      type: "Feature",
      properties: { kind: "multi-point" },
      geometry: { type: "MultiPoint", coordinates: [[1, 2, 3], [4, 5, 6]] },
    },
    {
      type: "Feature",
      properties: { kind: "line" },
      geometry: { type: "LineString", coordinates: [[1, 2, 3], [4, 5, 6, 7]] },
    },
    {
      type: "Feature",
      properties: { kind: "polygon" },
      geometry: { type: "Polygon", coordinates: [[[1, 2, 3], [4, 5, 6], [1, 2, 3]]] },
    },
    {
      type: "Feature",
      properties: { kind: "multi-polygon" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[1, 2, 3], [4, 5, 6], [1, 2, 3]]]],
      },
    },
    {
      type: "Feature",
      properties: { kind: "collection" },
      geometry: {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [7, 8, 9] },
          { type: "MultiLineString", coordinates: [[[1, 2, 3], [4, 5, 6]]] },
        ],
      },
    },
  ];
  const raw = cloneJson(features);

  const flattened = stripGeoJsonFeatureCoordinateHeights(features);

  assert.deepEqual(features, raw);
  assert.deepEqual(flattened[0].geometry.coordinates, [1, 2]);
  assert.deepEqual(flattened[1].geometry.coordinates, [[1, 2], [4, 5]]);
  assert.deepEqual(flattened[2].geometry.coordinates, [[1, 2], [4, 5]]);
  assert.deepEqual(flattened[3].geometry.coordinates, [[[1, 2], [4, 5], [1, 2]]]);
  assert.deepEqual(flattened[4].geometry.coordinates, [[[[1, 2], [4, 5], [1, 2]]]]);
  assert.deepEqual(flattened[5].geometry.geometries[0].coordinates, [7, 8]);
  assert.deepEqual(flattened[5].geometry.geometries[1].coordinates, [[[1, 2], [4, 5]]]);
});

test("vector render feature collections flatten only GDB-origin layers", () => {
  const features = [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [1, 2, 3] },
    },
  ];

  assert.equal(featuresForVectorLayerRender(features, "shp"), features);

  const geojson = featureCollectionForVectorLayerRender(features, "gdb");
  assert.notEqual(geojson.features, features);
  assert.deepEqual(geojson.features[0].geometry.coordinates, [1, 2]);
  assert.deepEqual(features[0].geometry.coordinates, [1, 2, 3]);
});

test("assigned GDB layer placement ignores raw source point height", () => {
  const building = {
    heightOffset: 0,
    levelBaseElevation: 100,
    levels: [{ key: "l1", name: "1F", floor: 10 }],
    tileset: {
      modelMatrix: Matrix4.IDENTITY,
      root: {
        transform: Transforms.eastNorthUpToFixedFrame(
          Cartesian3.fromDegrees(LON, LAT, 100),
        ),
      },
    },
  };
  const layer = {
    name: "gdb_point",
    levelKey: "l1",
    heightOffset: 0,
    _origin: "gdb",
    dataSource: {
      entities: {
        values: [
          {
            position: Cartesian3.fromDegrees(LON, LAT, 9999),
          },
        ],
      },
    },
  };

  applyShapefileLayerHeight(building, layer);

  const position = layer.dataSource.entities.values[0].position.getValue(JulianDate.now());
  const height = Cartographic.fromCartesian(position).height;
  const expected = 100 + 10 + SHAPEFILE_FLOOR_CLEARANCE_M + POINT_EXTRA_HEIGHT_M;
  assert.ok(Math.abs(height - expected) < 0.001);
});
