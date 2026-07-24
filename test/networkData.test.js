import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNetworkDataset,
  collectPassageTypeCodes,
  isNetworkFeatureCollection,
  parseVerticalConnectorLayerName,
  reviveNetworkDataset,
  serializeNetworkDataset,
} from "../src/networkData.js";

const point = (id, floor, lon, lat, props = {}) => ({
  type: "Feature",
  properties: { NODEID: id, FLOOR: floor, ...props },
  geometry: { type: "Point", coordinates: [lon, lat, 0] },
});

const connector = (props = {}) => ({
  type: "Feature",
  properties: {
    passage_type: 21,
    FLOOR1: "B1",
    FLOOR2: "F1",
    node1: 4330,
    node2: 4315,
    ...props,
  },
  geometry: {
    type: "MultiLineString",
    coordinates: [[
      [139.7001, 35.6901, 0],
      [139.7002, 35.6902, 0],
    ]],
  },
});

test("parseVerticalConnectorLayerName extracts source prefix and floors", () => {
  assert.deepEqual(
    parseVerticalConnectorLayerName("ShinjukuSt_B1_to_F1_link"),
    {
      prefix: "ShinjukuSt",
      floor1: "B1",
      floor2: "F1",
      layerName: "ShinjukuSt_B1_to_F1_link",
    },
  );
});

test("isNetworkFeatureCollection recognizes nodes and vertical connectors only", () => {
  assert.equal(isNetworkFeatureCollection({ fileName: "net_junction", features: [] }), true);
  assert.equal(isNetworkFeatureCollection({ fileName: "TokyoSt_B1_to_F35_link", features: [] }), true);
  // Per-floor link layers stay in the normal vector-layer flow so their full
  // polyline geometry, colors, and level assignment are preserved.
  assert.equal(isNetworkFeatureCollection({ fileName: "TokyoSt_B1_link", features: [] }), false);
  assert.equal(isNetworkFeatureCollection({ fileName: "TokyoSt_B1_space", features: [] }), false);
});

test("buildNetworkDataset indexes junction nodes and vertical connectors", () => {
  const dataset = buildNetworkDataset([
    {
      fileName: "net_junction",
      features: [
        point(4330, "B1", 139.7001, 35.6901),
        point(4315, "F1", 139.7002, 35.6902, { altitude: 12.5 }),
      ],
    },
    {
      fileName: "ShinjukuSt_B1_to_F1_link",
      features: [connector()],
    },
  ], { id: "network:1", name: "Shinjuku network" });

  assert.equal(dataset.id, "network:1");
  assert.equal(dataset.sourcePrefix, "ShinjukuSt");
  assert.equal(dataset.nodes.length, 2);
  assert.equal(dataset.nodesById.get("4315").altitude, 12.5);
  assert.equal(dataset.verticalLayers.length, 1);
  assert.equal(dataset.verticalLayers[0].connectors[0].node1, "4330");
  assert.equal(dataset.verticalLayers[0].connectors[0].floor2, "F1");
});

test("buildNetworkDataset preserves authored connectors while rebuilding imports", () => {
  const existing = {
    authoredConnectors: [{ id: "authored:1", node1: "1", node2: "2" }],
  };
  const dataset = buildNetworkDataset([
    { fileName: "net_junction", features: [point(1, "1F", 139, 35)] },
  ], { existing });

  assert.deepEqual(dataset.authoredConnectors, existing.authoredConnectors);
});

test("buildNetworkDataset merges new collections into an existing dataset", () => {
  const first = buildNetworkDataset([
    {
      fileName: "net_junction",
      features: [point(1, "1F", 139.1, 35.1), point(2, "2F", 139.2, 35.2)],
    },
    { fileName: "ShinjukuSt_B1_to_F1_link", features: [connector()] },
  ], { id: "network:1" });

  // Simulate a session restore: the original feature collections are gone,
  // only the dataset itself survives. A later import must not lose them.
  const merged = buildNetworkDataset([
    {
      fileName: "net_junction",
      features: [point(2, "2F", 139.25, 35.25, { altitude: 9 }), point(3, "3F", 139.3, 35.3)],
    },
    { fileName: "ShinjukuSt_F1_to_F2_link", features: [connector({ FLOOR1: "F1", FLOOR2: "F2" })] },
  ], { existing: first });

  assert.equal(merged.nodes.length, 3);
  assert.equal(merged.nodesById.get("1").floor, "1F");
  // Re-imported node wins over the stale copy.
  assert.equal(merged.nodesById.get("2").altitude, 9);
  assert.deepEqual(
    merged.verticalLayers.map((l) => l.name).sort(),
    ["ShinjukuSt_B1_to_F1_link", "ShinjukuSt_F1_to_F2_link"],
  );
});

test("buildNetworkDataset replaces a re-imported vertical layer by name", () => {
  const first = buildNetworkDataset([
    { fileName: "ShinjukuSt_B1_to_F1_link", features: [connector(), connector()] },
  ], { id: "network:1" });
  const merged = buildNetworkDataset([
    { fileName: "ShinjukuSt_B1_to_F1_link", features: [connector()] },
  ], { existing: first });

  assert.equal(merged.verticalLayers.length, 1);
  assert.equal(merged.verticalLayers[0].connectors.length, 1);
});

test("serialize/revive round-trips authored connector waypoints without sharing refs", () => {
  const dataset = buildNetworkDataset([
    { fileName: "net_junction", features: [point(1, "1F", 139, 35)] },
  ], { id: "network:1" });
  dataset.authoredConnectors.push({
    id: "authored:1",
    node1: "1",
    node2: "2",
    waypoints: [{ lon: 139.5, lat: 35.5, height: 12 }],
  });

  const revived = reviveNetworkDataset(JSON.parse(JSON.stringify(serializeNetworkDataset(dataset))));
  assert.deepEqual(revived.authoredConnectors[0].waypoints, [{ lon: 139.5, lat: 35.5, height: 12 }]);

  const cloned = reviveNetworkDataset(serializeNetworkDataset(dataset));
  assert.notEqual(cloned.authoredConnectors[0].waypoints, dataset.authoredConnectors[0].waypoints);
  assert.notEqual(cloned.authoredConnectors[0].waypoints[0], dataset.authoredConnectors[0].waypoints[0]);
});

test("collectPassageTypeCodes returns sorted distinct numeric codes", () => {
  const dataset = buildNetworkDataset([
    {
      fileName: "ShinjukuSt_B1_to_F1_link",
      features: [
        connector({ passage_type: 31 }),
        connector({ passage_type: 11 }),
        connector({ passage_type: "20" }),
        connector({ passage_type: null }),
      ],
    },
  ], { id: "network:1" });
  dataset.authoredConnectors.push({ id: "a", passageType: 41 });

  assert.deepEqual(collectPassageTypeCodes([dataset]), [11, 20, 31, 41]);
});
