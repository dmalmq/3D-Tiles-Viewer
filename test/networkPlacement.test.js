import test from "node:test";
import assert from "node:assert/strict";

import {
  connectorPathDegrees,
  isConnectorVisibleForFloor,
  isNodeVisibleForFloor,
  resolveNetworkEndpointHeight,
} from "../src/networkPlacement.js";
import { SHAPEFILE_FLOOR_CLEARANCE_M } from "../src/shapefilePlacement.js";

const building = {
  levelBaseElevation: 100,
  heightOffset: 0,
  levels: [
    { key: "b1", name: "B1", floor: -5 },
    { key: "f1", name: "F1", floor: 0 },
  ],
};

test("resolveNetworkEndpointHeight prefers connector altitude fields", () => {
  const height = resolveNetworkEndpointHeight({
    building,
    connector: { startAltitude: 3.45, floor1: "B1" },
    node: { floor: "B1", altitude: -10 },
    endpoint: "start",
  });

  assert.deepEqual(height, { height: 3.45, source: "connectorAltitude" });
});

test("resolveNetworkEndpointHeight falls back to node altitude", () => {
  const height = resolveNetworkEndpointHeight({
    building,
    connector: { floor2: "F1" },
    node: { floor: "F1", altitude: 12.25 },
    endpoint: "end",
  });

  assert.deepEqual(height, { height: 12.25, source: "nodeAltitude" });
});

test("resolveNetworkEndpointHeight uses building floor plane when altitude is missing", () => {
  const height = resolveNetworkEndpointHeight({
    building,
    connector: { floor1: "B1" },
    node: { floor: "B1", altitude: null },
    endpoint: "start",
  });

  assert.equal(height.source, "floorPlane");
  assert.equal(height.height, 95 + SHAPEFILE_FLOOR_CLEARANCE_M);
});

test("connectorPathDegrees threads waypoints between resolved endpoints", () => {
  const connector = {
    start: { lon: 139.7, lat: 35.6 },
    end: { lon: 139.701, lat: 35.601 },
    waypoints: [{ lon: 139.7004, lat: 35.6004, height: 7 }],
  };

  assert.deepEqual(connectorPathDegrees(connector, 2, 12), [
    { lon: 139.7, lat: 35.6, height: 2 },
    { lon: 139.7004, lat: 35.6004, height: 7 },
    { lon: 139.701, lat: 35.601, height: 12 },
  ]);
  assert.deepEqual(connectorPathDegrees({ ...connector, waypoints: undefined }, 2, 12), [
    { lon: 139.7, lat: 35.6, height: 2 },
    { lon: 139.701, lat: 35.601, height: 12 },
  ]);
});

test("network floor visibility includes endpoints and inter-floor connectors", () => {
  assert.equal(isNodeVisibleForFloor({ floor: "B1" }, null), true);
  assert.equal(isNodeVisibleForFloor({ floor: "B1" }, -1), true);
  assert.equal(isNodeVisibleForFloor({ floor: "B1" }, 1), false);

  assert.equal(isConnectorVisibleForFloor({ floor1: "B1", floor2: "F1" }, null), true);
  assert.equal(isConnectorVisibleForFloor({ floor1: "B1", floor2: "F1" }, -1), true);
  assert.equal(isConnectorVisibleForFloor({ floor1: "B1", floor2: "F1" }, 1), true);
  assert.equal(isConnectorVisibleForFloor({ floor1: "B1", floor2: "F1" }, 2), false);
});
