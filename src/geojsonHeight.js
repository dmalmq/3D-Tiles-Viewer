const POSITION_DEPTH_BY_GEOMETRY_TYPE = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

export function isGdbVectorOrigin(origin) {
  return String(origin ?? "").toLowerCase() === "gdb";
}

function stripPositionHeight(position) {
  return Array.isArray(position) ? position.slice(0, 2) : position;
}

function stripNestedCoordinateHeights(coordinates, depth) {
  if (depth === 0) return stripPositionHeight(coordinates);
  if (!Array.isArray(coordinates)) return coordinates;
  return coordinates.map((child) => stripNestedCoordinateHeights(child, depth - 1));
}

export function stripGeoJsonGeometryCoordinateHeights(geometry) {
  if (!geometry || typeof geometry !== "object") return geometry;

  if (geometry.type === "GeometryCollection") {
    return {
      ...geometry,
      geometries: Array.isArray(geometry.geometries)
        ? geometry.geometries.map(stripGeoJsonGeometryCoordinateHeights)
        : geometry.geometries,
    };
  }

  const depth = POSITION_DEPTH_BY_GEOMETRY_TYPE[geometry.type];
  if (depth == null || !Object.prototype.hasOwnProperty.call(geometry, "coordinates")) {
    return { ...geometry };
  }

  return {
    ...geometry,
    coordinates: stripNestedCoordinateHeights(geometry.coordinates, depth),
  };
}

export function stripGeoJsonFeatureCoordinateHeights(features = []) {
  const list = Array.isArray(features) ? features : [];
  return list.map((feature) => {
    if (!feature || typeof feature !== "object") return feature;
    return {
      ...feature,
      geometry: stripGeoJsonGeometryCoordinateHeights(feature.geometry),
    };
  });
}

export function featuresForVectorLayerRender(features = [], origin = null) {
  const list = Array.isArray(features) ? features : [];
  return isGdbVectorOrigin(origin) ? stripGeoJsonFeatureCoordinateHeights(list) : list;
}

export function featureCollectionForVectorLayerRender(features = [], origin = null) {
  return {
    type: "FeatureCollection",
    features: featuresForVectorLayerRender(features, origin),
  };
}
