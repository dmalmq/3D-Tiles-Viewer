import { Cartographic, Math as CesiumMath } from "cesium";
import {
  COLOR2_DEFAULT,
  COLOR2_LOOKUP,
  HEX_COLOR_RE,
  isColorConfigurableLayer,
  isSpaceLayerName,
  OPENING_FILL_COLOR,
  SPACE_STROKE_COLOR,
} from "./layerColorConfig.js";
import { featuresForVectorLayerRender } from "./geojsonHeight.js";

function propertyValue(property) {
  return property?.getValue ? property.getValue() : property;
}

function entityProperties(entity) {
  const value = propertyValue(entity?.properties);
  return value && typeof value === "object" ? { ...value } : {};
}

function cartesianCoordinate(position) {
  const cartographic = Cartographic.fromCartesian(position);
  if (!cartographic) return null;
  return [
    CesiumMath.toDegrees(cartographic.longitude),
    CesiumMath.toDegrees(cartographic.latitude),
    cartographic.height,
  ];
}

function coordinatesFromPositions(positions) {
  const coordinates = [];
  for (const position of positions ?? []) {
    const coordinate = cartesianCoordinate(position);
    if (coordinate) coordinates.push(coordinate);
  }
  return coordinates;
}

function closedRing(positions) {
  const ring = coordinatesFromPositions(positions);
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.some((value, index) => value !== last[index])) ring.push([...first]);
  return ring;
}

function polygonCoordinates(hierarchy) {
  if (!hierarchy?.positions?.length) return null;
  return [
    closedRing(hierarchy.positions),
    ...(hierarchy.holes ?? [])
      .map((hole) => closedRing(hole.positions))
      .filter((ring) => ring.length > 0),
  ];
}

function entityGeometry(entity) {
  if (entity?.polygon) {
    const hierarchy = propertyValue(entity.polygon.hierarchy);
    const coordinates = polygonCoordinates(hierarchy);
    return coordinates ? { type: "Polygon", coordinates } : null;
  }
  if (entity?.polyline) {
    const coordinates = coordinatesFromPositions(propertyValue(entity.polyline.positions));
    return coordinates.length > 0 ? { type: "LineString", coordinates } : null;
  }
  if (entity?.position) {
    const coordinate = cartesianCoordinate(propertyValue(entity.position));
    return coordinate ? { type: "Point", coordinates: coordinate } : null;
  }
  return null;
}

function cssColor(property) {
  const value = propertyValue(property);
  const color = value?.color ?? value;
  return typeof color?.toCssColorString === "function" ? color.toCssColorString() : null;
}

function configuredFeatureStyle(layer, properties) {
  const isSpace = isSpaceLayerName(layer?.name);
  const colorColumn = layer?.colorColumn || (isSpace ? "color2" : null);
  const colorMappings = layer?.colorMappings || (isSpace ? COLOR2_LOOKUP : {});
  if (colorColumn && (isSpace || isColorConfigurableLayer(layer))) {
    const key = String(properties?.[colorColumn] ?? "").trim();
    const color = colorMappings[key] || (HEX_COLOR_RE.test(key) ? key : COLOR2_DEFAULT);
    return { color, outlineColor: isSpace ? SPACE_STROKE_COLOR : null };
  }
  if (/_opening/i.test(layer?.name ?? "")) {
    return { color: OPENING_FILL_COLOR, outlineColor: null };
  }
  const previcolor = String(properties?.previcolor ?? "").trim();
  return HEX_COLOR_RE.test(previcolor)
    ? { color: previcolor, outlineColor: null }
    : { color: null, outlineColor: null };
}

function featureFromEntity(entity, layer) {
  const geometry = entityGeometry(entity);
  if (!geometry) return null;
  const properties = entityProperties(entity);
  const configured = configuredFeatureStyle(layer, properties);
  const materialOwner = entity.polygon ?? entity.polyline;
  const color = cssColor(materialOwner?.material) ?? configured.color;
  const outlineColor = cssColor(entity.polygon?.outlineColor) ?? configured.outlineColor;
  if (color) properties.__viewerColor = color;
  if (outlineColor) properties.__viewerOutlineColor = outlineColor;
  return { type: "Feature", geometry, properties };
}

/**
 * Uses the live Cesium entities after `applyShapefileLayerHeight` and
 * `applyEntityStyling` ran. The exported geometry and colors therefore match
 * what the operator sees in 3D-Tiles-Viewer.
 */
export function featuresForWebsiteLayer(layer) {
  const entities = layer?.dataSource?.entities?.values;
  if (Array.isArray(entities) && entities.length > 0) {
    const features = entities
      .map((entity) => featureFromEntity(entity, layer))
      .filter(Boolean);
    if (features.length > 0) return { features, placed: true };
  }

  const raw = featuresForVectorLayerRender(layer?.features ?? [], layer?._origin);
  const features = raw.map((feature) => {
    const properties = { ...(feature?.properties ?? {}) };
    const style = configuredFeatureStyle(layer, properties);
    if (style.color) properties.__viewerColor = style.color;
    if (style.outlineColor) properties.__viewerOutlineColor = style.outlineColor;
    return { ...feature, properties };
  });
  return { features, placed: false };
}
