import { levelNameToNumber } from "./floorSplit.js";
import { resolveNetworkEndpointHeight } from "./networkPlacement.js";

const EARTH_RADIUS_M = 6_371_000;

export function findDuplicateConnector(dataset, node1, node2) {
  const matches = (connector) => sameNodePair(connector.node1, connector.node2, node1, node2);
  const authored = (dataset?.authoredConnectors ?? []).find(matches);
  if (authored) return { kind: "authored", connector: authored };
  for (const layer of dataset?.verticalLayers ?? []) {
    const imported = (layer.connectors ?? []).find(matches);
    if (imported) return { kind: "imported", connector: imported };
  }
  return null;
}

export function createAuthoredConnector({ dataset, building, startNode, endNode, passageType, id, waypoints }) {
  if (!startNode || !endNode) return { ok: false, reason: "missingNode" };
  if (isSameFloor(startNode.floor, endNode.floor)) return { ok: false, reason: "sameFloor" };
  if (findDuplicateConnector(dataset, startNode.nodeId, endNode.nodeId)) {
    return { ok: false, reason: "duplicate" };
  }

  const shell = {
    floor1: startNode.floor,
    floor2: endNode.floor,
    startAltitude: startNode.altitude,
    endAltitude: endNode.altitude,
  };
  const startHeight = resolveNetworkEndpointHeight({
    building,
    connector: shell,
    node: startNode,
    endpoint: "start",
  }).height;
  const endHeight = resolveNetworkEndpointHeight({
    building,
    connector: shell,
    node: endNode,
    endpoint: "end",
  }).height;
  const path = [
    { lon: startNode.lon, lat: startNode.lat, height: startHeight },
    ...cloneWaypoints(waypoints),
    { lon: endNode.lon, lat: endNode.lat, height: endHeight },
  ];
  const connector = {
    id: id ?? `authored:${startNode.nodeId}:${endNode.nodeId}:${Date.now()}`,
    authored: true,
    sourceLayerName: null,
    sourcePrefix: dataset?.sourcePrefix ?? null,
    passageType: numericCode(passageType),
    floor1: startNode.floor,
    floor2: endNode.floor,
    node1: startNode.nodeId,
    node2: endNode.nodeId,
    direction: 0,
    start: { lon: startNode.lon, lat: startNode.lat },
    end: { lon: endNode.lon, lat: endNode.lat },
    waypoints: path.slice(1, -1),
    startAltitude: startHeight,
    endAltitude: endHeight,
    startRelativeHeight: startNode.relativeHeight ?? null,
    endRelativeHeight: endNode.relativeHeight ?? null,
    length: pathLength3d(path),
    properties: {},
  };
  return { ok: true, connector };
}

function cloneWaypoints(waypoints) {
  return (waypoints ?? [])
    .filter((w) => Number.isFinite(Number(w?.lon)) && Number.isFinite(Number(w?.lat)))
    .map((w) => ({
      lon: Number(w.lon),
      lat: Number(w.lat),
      height: Number.isFinite(Number(w.height)) ? Number(w.height) : 0,
    }));
}

function numericCode(value) {
  if (value == null || value === "") return value ?? null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function isSameFloor(left, right) {
  const leftNumber = levelNameToNumber(left);
  const rightNumber = levelNameToNumber(right);
  if (leftNumber != null && rightNumber != null) return leftNumber === rightNumber;
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function sameNodePair(leftA, leftB, rightA, rightB) {
  const a = String(leftA);
  const b = String(leftB);
  const c = String(rightA);
  const d = String(rightB);
  return (a === c && b === d) || (a === d && b === c);
}

function pathLength3d(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += segmentLength3d(path[i - 1], path[i]);
  }
  return total;
}

function segmentLength3d(from, to) {
  const phi1 = degreesToRadians(from.lat);
  const phi2 = degreesToRadians(to.lat);
  const dPhi = degreesToRadians(to.lat - from.lat);
  const dLambda = degreesToRadians(to.lon - from.lon);
  const a = Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const horizontal = 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.hypot(horizontal, (to.height ?? 0) - (from.height ?? 0));
}

function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180;
}
