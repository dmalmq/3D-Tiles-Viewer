import test from "node:test";
import assert from "node:assert/strict";

import {
  createAuthoredConnector,
  findDuplicateConnector,
} from "../src/networkAuthoring.js";

const building = {
  levelBaseElevation: 0,
  levels: [
    { key: "f1", name: "F1", floor: 0 },
    { key: "f2", name: "F2", floor: 4 },
  ],
};

const node = (nodeId, floor, altitude = null) => ({
  nodeId,
  floor,
  lon: 139.7,
  lat: floor === "F1" ? 35.6 : 35.6002,
  altitude,
});

test("createAuthoredConnector rejects same-floor endpoints", () => {
  const result = createAuthoredConnector({
    dataset: { authoredConnectors: [] },
    building,
    startNode: node("1", "F1"),
    endNode: node("2", "F1"),
    passageType: "21",
    id: "authored:test",
  });

  assert.deepEqual(result, { ok: false, reason: "sameFloor" });
});

test("createAuthoredConnector fills node ids, floors, heights, type, and length", () => {
  const result = createAuthoredConnector({
    dataset: { sourcePrefix: "TokyoSt", authoredConnectors: [] },
    building,
    startNode: node("1", "F1", 3.45),
    endNode: node("2", "F2", 7.45),
    passageType: "31",
    id: "authored:test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.connector.id, "authored:test");
  assert.equal(result.connector.node1, "1");
  assert.equal(result.connector.node2, "2");
  assert.equal(result.connector.floor1, "F1");
  assert.equal(result.connector.floor2, "F2");
  // passage_type is an Integer field in the source GDBs — coerce on creation.
  assert.equal(result.connector.passageType, 31);
  assert.equal(result.connector.startAltitude, 3.45);
  assert.equal(result.connector.endAltitude, 7.45);
  assert.deepEqual(result.connector.waypoints, []);
  assert.ok(result.connector.length > 4);
});

test("createAuthoredConnector threads waypoints into geometry and 3D length", () => {
  const straight = createAuthoredConnector({
    dataset: { authoredConnectors: [] },
    building,
    startNode: node("1", "F1", 0),
    endNode: node("2", "F2", 4),
    passageType: "11",
    id: "authored:straight",
  });
  const waypoints = [
    { lon: 139.7003, lat: 35.6001, height: 2 },
    { lon: 139.7003, lat: 35.60015, height: 3 },
  ];
  const detour = createAuthoredConnector({
    dataset: { authoredConnectors: [] },
    building,
    startNode: node("1", "F1", 0),
    endNode: node("2", "F2", 4),
    passageType: "11",
    id: "authored:detour",
    waypoints,
  });

  assert.equal(detour.ok, true);
  assert.deepEqual(detour.connector.waypoints, waypoints);
  // Stored waypoints are cloned so later mutation of the input can't corrupt the connector.
  assert.notEqual(detour.connector.waypoints, waypoints);
  assert.notEqual(detour.connector.waypoints[0], waypoints[0]);
  // The stair path through the waypoints is longer than the straight diagonal.
  assert.ok(detour.connector.length > straight.connector.length + 10);
});

test("findDuplicateConnector treats reversed node pairs as duplicates", () => {
  const dataset = {
    authoredConnectors: [{ node1: "1", node2: "2" }],
    verticalLayers: [{ connectors: [{ node1: "3", node2: "4" }] }],
  };

  assert.deepEqual(findDuplicateConnector(dataset, "2", "1"), { kind: "authored", connector: dataset.authoredConnectors[0] });
  assert.deepEqual(findDuplicateConnector(dataset, "4", "3"), { kind: "imported", connector: dataset.verticalLayers[0].connectors[0] });
  assert.equal(findDuplicateConnector(dataset, "9", "10"), null);
});
