import test from "node:test";
import assert from "node:assert/strict";

import {
  NETWORK_CONNECTOR_FIELDS,
  buildAuthoredConnectorsGeoJson,
  connectorLayerName,
} from "../src/networkExport.js";

const connector = {
  id: "authored:1",
  passageType: "31",
  floor1: "B1",
  floor2: "F1",
  node1: "10",
  node2: "20",
  direction: 0,
  length: 25,
  startAltitude: -2.7,
  endAltitude: 3.45,
  start: { lon: 139.7, lat: 35.6 },
  end: { lon: 139.7001, lat: 35.6001 },
};

test("connectorLayerName uses source prefix and connector floors", () => {
  assert.equal(
    connectorLayerName({ sourcePrefix: "TokyoSt" }, connector),
    "TokyoSt_B1_to_F1_link",
  );
});

test("buildAuthoredConnectorsGeoJson exports exact connector field names", () => {
  const geojson = buildAuthoredConnectorsGeoJson({
    sourcePrefix: "TokyoSt",
    authoredConnectors: [connector],
  });

  assert.equal(geojson.type, "FeatureCollection");
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].properties.layerName, "TokyoSt_B1_to_F1_link");
  for (const field of NETWORK_CONNECTOR_FIELDS) {
    assert.ok(Object.hasOwn(geojson.features[0].properties, field), field);
  }
  assert.deepEqual(geojson.features[0].geometry.coordinates, [
    [139.7, 35.6, -2.7],
    [139.7001, 35.6001, 3.45],
  ]);
});

test("exported passage_type is numeric and path_cost is not fabricated", () => {
  const geojson = buildAuthoredConnectorsGeoJson({
    sourcePrefix: "TokyoSt",
    authoredConnectors: [connector],
  });
  const props = geojson.features[0].properties;

  // passage_type is an Integer field in the GDB; "31" would break an ArcGIS merge.
  assert.equal(props.passage_type, 31);
  // Real datasets carry path costs in routing units (e.g. 46662, 860000), not
  // meters — exporting length here would be wrong by orders of magnitude.
  assert.equal(props.path_cost, null);
  assert.equal(props.length, 25);
});

test("exported geometry threads waypoints between the endpoints", () => {
  const geojson = buildAuthoredConnectorsGeoJson({
    sourcePrefix: "TokyoSt",
    authoredConnectors: [{
      ...connector,
      waypoints: [
        { lon: 139.70003, lat: 35.60002, height: -1 },
        { lon: 139.70007, lat: 35.60006, height: 2 },
      ],
    }],
  });

  assert.deepEqual(geojson.features[0].geometry.coordinates, [
    [139.7, 35.6, -2.7],
    [139.70003, 35.60002, -1],
    [139.70007, 35.60006, 2],
    [139.7001, 35.6001, 3.45],
  ]);
});
