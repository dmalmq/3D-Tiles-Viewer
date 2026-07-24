const NODE_LAYER_RE = /(^|_)net_junction$/i;
const LINK_LAYER_RE = /_link$/i;
const VERTICAL_LINK_RE = /^(.+)_([^_]+)_to_([^_]+)_link$/i;

const NODE_ID_FIELDS = ["NODEID", "nodeid", "NodeID"];
const FLOOR_FIELDS = ["FLOOR", "floor", "Floor"];

export function getFeatureCollectionLayerName(fc) {
  return String(fc?.fileName ?? fc?.name ?? "network").replace(/\.(shp|dbf|prj)$/i, "");
}

export function parseVerticalConnectorLayerName(name) {
  const layerName = String(name ?? "").trim();
  const match = layerName.match(VERTICAL_LINK_RE);
  if (!match) return null;
  return {
    prefix: match[1],
    floor1: match[2],
    floor2: match[3],
    layerName,
  };
}

export function isNetworkNodeLayerName(name) {
  return NODE_LAYER_RE.test(String(name ?? ""));
}

export function isNetworkLinkLayerName(name) {
  return LINK_LAYER_RE.test(String(name ?? ""));
}

// Only junction points and vertical (_A_to_B_) connector layers belong to the
// network dataset. Per-floor link layers stay in the normal vector-layer flow
// so their full polyline geometry, colors, and level assignment are preserved.
export function isNetworkFeatureCollection(fc) {
  const name = getFeatureCollectionLayerName(fc);
  return isNetworkNodeLayerName(name) || parseVerticalConnectorLayerName(name) != null;
}

// Builds a network dataset from feature collections, merging into `existing`
// when given: nodes are upserted by NODEID and vertical layers replaced by
// name, so importing more layers after a session restore loses nothing.
export function buildNetworkDataset(featureCollections, options = {}) {
  const existing = options.existing ?? null;
  const nodes = (existing?.nodes ?? []).map((node) => ({ ...node }));
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const verticalLayers = cloneLayers(existing?.verticalLayers);
  const warnings = [];
  let sourcePrefix = existing?.sourcePrefix ?? null;

  for (const fc of featureCollections ?? []) {
    const layerName = getFeatureCollectionLayerName(fc);
    if (isNetworkNodeLayerName(layerName)) {
      indexNodes(fc.features ?? [], nodes, nodesById, warnings);
      continue;
    }

    const vertical = parseVerticalConnectorLayerName(layerName);
    if (!vertical) continue;
    sourcePrefix ??= vertical.prefix;
    const layer = {
      name: layerName,
      prefix: vertical.prefix,
      floor1: vertical.floor1,
      floor2: vertical.floor2,
      connectors: buildConnectors(fc.features ?? [], layerName, vertical),
    };
    const replaceAt = verticalLayers.findIndex((l) => l.name === layerName);
    if (replaceAt >= 0) verticalLayers[replaceAt] = layer;
    else verticalLayers.push(layer);
  }

  return {
    id: options.id ?? existing?.id ?? `network:${sourcePrefix ?? "dataset"}`,
    name: options.name ?? existing?.name ?? "Indoor network",
    sourceName: options.sourceName ?? existing?.sourceName ?? null,
    sourcePrefix,
    visible: existing?.visible ?? true,
    nodes,
    nodesById,
    flatLayers: cloneLayers(existing?.flatLayers),
    verticalLayers,
    authoredConnectors: existing?.authoredConnectors ?? [],
    warnings,
  };
}

// Distinct numeric passage_type codes across imported and authored connectors,
// sorted ascending — drives the passage-type dropdown so it always offers the
// codes actually used by the loaded network.
export function collectPassageTypeCodes(datasets) {
  const codes = new Set();
  for (const dataset of datasets ?? []) {
    const layers = [...(dataset?.verticalLayers ?? []), { connectors: dataset?.authoredConnectors ?? [] }];
    for (const layer of layers) {
      for (const connector of layer.connectors ?? []) {
        const code = finiteNumber(connector?.passageType);
        if (code != null) codes.add(code);
      }
    }
  }
  return [...codes].sort((a, b) => a - b);
}

export function reviveNetworkDataset(saved) {
  if (!saved) return null;
  const nodes = Array.isArray(saved.nodes) ? saved.nodes.map((node) => ({ ...node })) : [];
  return {
    id: saved.id ?? `network:${saved.sourcePrefix ?? "dataset"}`,
    name: saved.name ?? "Indoor network",
    sourceName: saved.sourceName ?? null,
    sourcePrefix: saved.sourcePrefix ?? null,
    visible: saved.visible !== false,
    nodes,
    nodesById: new Map(nodes.map((node) => [node.nodeId, node])),
    flatLayers: cloneLayers(saved.flatLayers),
    verticalLayers: cloneLayers(saved.verticalLayers),
    authoredConnectors: Array.isArray(saved.authoredConnectors)
      ? saved.authoredConnectors.map(cloneConnector)
      : [],
    warnings: Array.isArray(saved.warnings) ? saved.warnings.slice() : [],
  };
}

export function serializeNetworkDataset(dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    sourceName: dataset.sourceName ?? null,
    sourcePrefix: dataset.sourcePrefix ?? null,
    visible: dataset.visible !== false,
    nodes: (dataset.nodes ?? []).map((node) => ({ ...node })),
    flatLayers: cloneLayers(dataset.flatLayers),
    verticalLayers: cloneLayers(dataset.verticalLayers),
    authoredConnectors: (dataset.authoredConnectors ?? []).map(cloneConnector),
    warnings: (dataset.warnings ?? []).slice(),
  };
}

function indexNodes(features, nodes, nodesById, warnings) {
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const nodeId = normalizeId(readProp(props, NODE_ID_FIELDS));
    const coord = pointCoordinates(feature);
    if (!nodeId || !coord) {
      warnings.push("Skipped network junction without NODEID or point geometry.");
      continue;
    }
    const node = {
      nodeId,
      floor: stringOrNull(readProp(props, FLOOR_FIELDS)),
      lon: coord[0],
      lat: coord[1],
      altitude: finiteNumber(readProp(props, ["altitude", "ALTITUDE"])),
      relativeHeight: finiteNumber(readProp(props, ["relative_height", "relativeHeight"])),
      properties: { ...props },
    };
    const stale = nodesById.get(nodeId);
    if (stale) nodes[nodes.indexOf(stale)] = node;
    else nodes.push(node);
    nodesById.set(nodeId, node);
  }
}

function buildConnectors(features, layerName, vertical) {
  return features.map((feature, index) => {
    const props = feature?.properties ?? {};
    const endpoints = lineEndpoints(feature);
    const floor = stringOrNull(readProp(props, FLOOR_FIELDS));
    const node1 = normalizeId(readProp(props, ["node1", "NODE1", "FNODEID"]));
    const node2 = normalizeId(readProp(props, ["node2", "NODE2", "TNODEID"]));
    return {
      id: `${layerName}:${node1 ?? "start"}:${node2 ?? "end"}:${index}`,
      sourceLayerName: layerName,
      authored: false,
      floor1: stringOrNull(readProp(props, ["FLOOR1", "floor1"])) ?? vertical?.floor1 ?? floor,
      floor2: stringOrNull(readProp(props, ["FLOOR2", "floor2"])) ?? vertical?.floor2 ?? floor,
      node1,
      node2,
      passageType: readProp(props, ["passage_type", "passageType"]),
      direction: readProp(props, ["direction", "DIRECTION"]),
      length: finiteNumber(readProp(props, ["length", "Shape_Length", "SHAPE_Length"])),
      startAltitude: finiteNumber(readProp(props, ["start_altitude", "startAltitude"])),
      endAltitude: finiteNumber(readProp(props, ["end_altitude", "endAltitude"])),
      startRelativeHeight: finiteNumber(readProp(props, ["start_relative_height", "startRelativeHeight"])),
      endRelativeHeight: finiteNumber(readProp(props, ["end_relative_height", "endRelativeHeight"])),
      start: endpoints.start,
      end: endpoints.end,
      properties: { ...props },
    };
  });
}

function cloneLayers(layers) {
  return (layers ?? []).map((layer) => ({
    ...layer,
    connectors: (layer.connectors ?? []).map(cloneConnector),
  }));
}

function cloneConnector(connector) {
  const cloned = { ...connector };
  if (Array.isArray(connector.waypoints)) {
    cloned.waypoints = connector.waypoints.map((waypoint) => ({ ...waypoint }));
  }
  return cloned;
}

export function readProp(row, names) {
  for (const name of names) {
    if (row?.[name] != null && row[name] !== "") return row[name];
  }
  const lower = new Map(Object.keys(row ?? {}).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lower.get(name.toLowerCase());
    if (key != null && row[key] != null && row[key] !== "") return row[key];
  }
  return null;
}

function pointCoordinates(feature) {
  return feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
}

function lineEndpoints(feature) {
  const geometry = feature?.geometry;
  const coords = geometry?.type === "LineString"
    ? geometry.coordinates
    : geometry?.type === "MultiLineString"
      ? geometry.coordinates.flat()
      : [];
  const start = coords[0];
  const end = coords[coords.length - 1];
  return {
    start: coordinateObject(start),
    end: coordinateObject(end),
  };
}

function coordinateObject(coord) {
  return Array.isArray(coord) && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1]))
    ? { lon: Number(coord[0]), lat: Number(coord[1]), z: finiteNumber(coord[2]) }
    : null;
}

function normalizeId(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function stringOrNull(value) {
  return value == null || value === "" ? null : String(value);
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
