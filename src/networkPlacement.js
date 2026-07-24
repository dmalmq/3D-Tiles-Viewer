import {
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  CustomDataSource,
  PolylineDashMaterialProperty,
} from "cesium";

import { levelNameToNumber, matchLevelByText } from "./floorSplit.js";
import {
  SHAPEFILE_FLOOR_CLEARANCE_M,
  buildingLevelWorldHeight,
  projectPositionToLocalZ,
  shapefileLayerLocalZ,
  shapefileWorldToLocal,
} from "./shapefilePlacement.js";

const NODE_COLOR = Color.fromCssColorString("#56c7ff");
const NODE_SELECTED_COLOR = Color.fromCssColorString("#f8d66d");
const CONNECTOR_COLOR = Color.fromCssColorString("#56c7ff");
const AUTHORED_CONNECTOR_COLOR = Color.fromCssColorString("#f8d66d");

export function isNodeVisibleForFloor(node, activeFloorNumber) {
  if (activeFloorNumber == null) return true;
  return levelNameToNumber(node?.floor) === activeFloorNumber;
}

export function isConnectorVisibleForFloor(connector, activeFloorNumber) {
  if (activeFloorNumber == null) return true;
  return (
    levelNameToNumber(connector?.floor1) === activeFloorNumber ||
    levelNameToNumber(connector?.floor2) === activeFloorNumber
  );
}

export function resolveNetworkEndpointHeight({ building, connector, node, endpoint }) {
  const altitude = finiteNumber(endpoint === "start"
    ? connector?.startAltitude ?? connector?.start_altitude
    : connector?.endAltitude ?? connector?.end_altitude);
  if (altitude != null) return { height: altitude, source: "connectorAltitude" };

  const nodeAltitude = finiteNumber(node?.altitude);
  if (nodeAltitude != null) return { height: nodeAltitude, source: "nodeAltitude" };

  const floor = endpoint === "start" ? connector?.floor1 : connector?.floor2;
  const floorHeight = floorPlaneHeight(building, node?.floor ?? floor);
  const relative = finiteNumber(endpoint === "start"
    ? connector?.startRelativeHeight ?? connector?.start_relative_height
    : connector?.endRelativeHeight ?? connector?.end_relative_height);
  if (relative != null) return { height: floorHeight + relative, source: "connectorRelativeHeight" };

  const nodeRelative = finiteNumber(node?.relativeHeight);
  if (nodeRelative != null) return { height: floorHeight + nodeRelative, source: "nodeRelativeHeight" };

  return { height: floorHeight, source: "floorPlane" };
}

export function createNetworkDataSource(building, dataset, options = {}) {
  const dataSource = new CustomDataSource(dataset.name ?? "Indoor network");
  dataSource.__networkDatasetId = dataset.id;
  dataSource.show = dataset.visible !== false && !building?._hidden;

  const activeFloorNumber = options.activeFloorNumber ?? null;
  const worldToLocal = shapefileWorldToLocal(building);
  for (const node of dataset.nodes ?? []) {
    addNodeEntity(dataSource, building, dataset, node, activeFloorNumber, worldToLocal);
  }
  for (const connector of allImportedConnectors(dataset)) {
    addConnectorEntity(dataSource, building, dataset, connector, activeFloorNumber, worldToLocal, false);
  }
  for (const connector of dataset.authoredConnectors ?? []) {
    addConnectorEntity(dataSource, building, dataset, connector, activeFloorNumber, worldToLocal, true);
  }
  return dataSource;
}

export function updateNetworkDataSourceVisibility(building, dataset, activeFloorNumber) {
  const dataSource = dataset?.dataSource;
  if (!dataSource) return;
  dataSource.show = dataset.visible !== false && !building?._hidden;
  for (const entity of dataSource.entities.values) {
    if (entity.networkNodeRef) {
      entity.show = isNodeVisibleForFloor(entity.networkNodeRef.node, activeFloorNumber);
    } else if (entity.networkConnectorRef) {
      entity.show = isConnectorVisibleForFloor(entity.networkConnectorRef.connector, activeFloorNumber);
    }
  }
}

export function resolveConnectorEndpointPosition(building, dataset, connector, endpoint, worldToLocal = null) {
  const nodeId = endpoint === "start" ? connector.node1 : connector.node2;
  const node = nodeId ? dataset.nodesById?.get(String(nodeId)) : null;
  const coord = node ?? (endpoint === "start" ? connector.start : connector.end);
  if (!coord) return null;
  const height = resolveNetworkEndpointHeight({ building, connector, node, endpoint });
  if (height.source === "floorPlane" && worldToLocal) {
    const floor = node?.floor ?? (endpoint === "start" ? connector.floor1 : connector.floor2);
    const localZ = floorLocalZ(building, floor);
    const surface = Cartesian3.fromDegrees(coord.lon, coord.lat, 0);
    const projected = projectPositionToLocalZ(surface, worldToLocal, localZ, height.height);
    const projectedHeight = Cartographic.fromCartesian(projected)?.height;
    return {
      cartesian: projected,
      height: Number.isFinite(projectedHeight) ? projectedHeight : height.height,
    };
  }
  return {
    cartesian: Cartesian3.fromDegrees(coord.lon, coord.lat, height.height),
    height: height.height,
  };
}

function addNodeEntity(dataSource, building, dataset, node, activeFloorNumber, worldToLocal) {
  const connector = { floor1: node.floor, startAltitude: node.altitude };
  const position = resolveConnectorEndpointPosition(
    building,
    { ...dataset, nodesById: new Map([[node.nodeId, node]]) },
    { ...connector, node1: node.nodeId, start: node },
    "start",
    worldToLocal,
  );
  if (!position) return;
  const entity = dataSource.entities.add({
    position: position.cartesian,
    point: {
      pixelSize: 8,
      color: NODE_COLOR.withAlpha(0.95),
      outlineColor: Color.BLACK,
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    show: isNodeVisibleForFloor(node, activeFloorNumber),
  });
  entity.networkNodeRef = { datasetId: dataset.id, nodeId: node.nodeId, node };
}

// The lon/lat/height path of a connector: resolved endpoints with any authored
// stair-path waypoints threaded in between.
export function connectorPathDegrees(connector, startHeight, endHeight) {
  return [
    { lon: connector.start.lon, lat: connector.start.lat, height: startHeight },
    ...(connector.waypoints ?? []).map((w) => ({ lon: w.lon, lat: w.lat, height: w.height ?? 0 })),
    { lon: connector.end.lon, lat: connector.end.lat, height: endHeight },
  ];
}

function addConnectorEntity(dataSource, building, dataset, connector, activeFloorNumber, worldToLocal, authored) {
  const start = resolveConnectorEndpointPosition(building, dataset, connector, "start", worldToLocal);
  const end = resolveConnectorEndpointPosition(building, dataset, connector, "end", worldToLocal);
  if (!start || !end) return;
  connector.startAltitude ??= start.height;
  connector.endAltitude ??= end.height;
  const positions = [
    start.cartesian,
    ...(connector.waypoints ?? []).map((w) => Cartesian3.fromDegrees(w.lon, w.lat, w.height ?? 0)),
    end.cartesian,
  ];
  const color = authored ? AUTHORED_CONNECTOR_COLOR : CONNECTOR_COLOR;
  const material = authored
    ? new PolylineDashMaterialProperty({ color, dashLength: 12 })
    : color.withAlpha(0.9);
  const entity = dataSource.entities.add({
    polyline: {
      positions: new ConstantProperty(positions),
      width: authored ? 4 : 3,
      material,
      clampToGround: false,
    },
    show: isConnectorVisibleForFloor(connector, activeFloorNumber),
  });
  entity.networkConnectorRef = { datasetId: dataset.id, connector };
}

function allImportedConnectors(dataset) {
  return [
    ...(dataset.verticalLayers ?? []).flatMap((layer) => layer.connectors ?? []),
    ...(dataset.flatLayers ?? []).flatMap((layer) => layer.connectors ?? []),
  ];
}

function floorPlaneHeight(building, floor) {
  const level = matchLevelByText(floor, building?.levels);
  const base = level ? buildingLevelWorldHeight(building, level) : finiteNumber(building?.levelBaseElevation) ?? 0;
  return base + (finiteNumber(building?.heightOffset) ?? 0) + SHAPEFILE_FLOOR_CLEARANCE_M;
}

function floorLocalZ(building, floor) {
  const level = matchLevelByText(floor, building?.levels);
  return shapefileLayerLocalZ(building, { levelKey: level?.key ?? null, source: null, heightOffset: 0 });
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function networkNodeSelectedColor() {
  return NODE_SELECTED_COLOR;
}
