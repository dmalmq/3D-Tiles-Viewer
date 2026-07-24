export const NETWORK_CONNECTOR_FIELDS = [
  "passage_type",
  "FLOOR1",
  "FLOOR2",
  "RFLAG",
  "path_cost",
  "node1",
  "node2",
  "pathid1",
  "pathid2",
  "barrier",
  "starttime",
  "endtime",
  "width_cost",
  "kai_tak_id",
  "direction",
  "length",
  "start_relative_height",
  "end_relative_height",
  "start_altitude",
  "end_altitude",
  "indoor",
  "Shape_Length",
];

export function connectorLayerName(dataset, connector) {
  const prefix = connector.sourcePrefix ?? dataset?.sourcePrefix ?? "authored";
  return `${prefix}_${connector.floor1}_to_${connector.floor2}_link`;
}

export function buildAuthoredConnectorsGeoJson(input) {
  const datasets = Array.isArray(input) ? input : [input];
  const features = [];
  for (const dataset of datasets) {
    for (const connector of dataset?.authoredConnectors ?? []) {
      features.push({
        type: "Feature",
        properties: connectorProperties(dataset, connector),
        geometry: {
          type: "LineString",
          coordinates: [
            [connector.start.lon, connector.start.lat, connector.startAltitude],
            ...(connector.waypoints ?? []).map((w) => [w.lon, w.lat, w.height]),
            [connector.end.lon, connector.end.lat, connector.endAltitude],
          ],
        },
      });
    }
  }
  return {
    type: "FeatureCollection",
    name: "authored_network_connectors",
    features,
  };
}

export function downloadAuthoredConnectorsGeoJson(datasets, filename = "authored-network-connectors.geojson") {
  const geojson = buildAuthoredConnectorsGeoJson(datasets);
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function connectorProperties(dataset, connector) {
  const props = {
    layerName: connectorLayerName(dataset, connector),
    // Integer field in the source GDBs — a string here breaks the ArcGIS merge.
    passage_type: numericOrNull(connector.passageType ?? connector.properties?.passage_type),
    FLOOR1: connector.floor1 ?? null,
    FLOOR2: connector.floor2 ?? null,
    RFLAG: connector.rflag ?? connector.properties?.RFLAG ?? 1,
    // Real datasets carry path costs in routing units (46662, 860000, ...) —
    // never substitute the metric length; leave it for the GIS side to compute.
    path_cost: numericOrNull(connector.pathCost ?? connector.properties?.path_cost),
    node1: connector.node1 ?? null,
    node2: connector.node2 ?? null,
    pathid1: connector.pathid1 ?? null,
    pathid2: connector.pathid2 ?? null,
    barrier: connector.barrier ?? null,
    starttime: connector.starttime ?? null,
    endtime: connector.endtime ?? null,
    width_cost: connector.widthCost ?? null,
    kai_tak_id: connector.kaiTakId ?? null,
    direction: connector.direction ?? 0,
    length: connector.length ?? null,
    start_relative_height: connector.startRelativeHeight ?? null,
    end_relative_height: connector.endRelativeHeight ?? null,
    start_altitude: connector.startAltitude ?? null,
    end_altitude: connector.endAltitude ?? null,
    indoor: connector.indoor ?? 1,
    Shape_Length: connector.shapeLength ?? connector.length ?? null,
  };
  for (const field of NETWORK_CONNECTOR_FIELDS) props[field] ??= null;
  return props;
}

function numericOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
