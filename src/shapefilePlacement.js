import {
  ArcType,
  Cartesian3,
  Cartographic,
  ConstantPositionProperty,
  ConstantProperty,
  JulianDate,
  Matrix4,
  PolygonHierarchy,
} from "cesium";

export const SHAPEFILE_FLOOR_CLEARANCE_M = 0.05;
export const POINT_EXTRA_HEIGHT_M = 0.25;
export const FIXTURE_EXTRA_HEIGHT_M = 0.10;

export function resolveShapefileLevels(building, layer) {
  const source = layer?.source;
  if (source != null && building?.sourceLevelGroups instanceof Map) {
    const sourceLevels = building.sourceLevelGroups.get(source);
    if (sourceLevels?.length) return sourceLevels;
  }
  return building?.levels ?? [];
}

export function findShapefileLevel(building, layer) {
  if (layer.levelKey == null) return null;
  const levels = resolveShapefileLevels(building, layer);
  const match = levels.find((l) => (l.key ?? "") === layer.levelKey);
  if (match) return match;
  return building.levels.find((l) => (l.key ?? "") === layer.levelKey) ?? null;
}

export function shapefileLayerHeight(building, layer) {
  const lvl = findShapefileLevel(building, layer);
  const fixtureExtra = /_fixture/i.test(layer.name) ? FIXTURE_EXTRA_HEIGHT_M : 0;
  return (
    building.levelBaseElevation +
    (building.heightOffset ?? 0) +
    (lvl ? lvl.floor : 0) +
    SHAPEFILE_FLOOR_CLEARANCE_M +
    fixtureExtra +
    (layer.heightOffset ?? 0)
  );
}

export function shapefileLayerLocalZ(building, layer) {
  const lvl = findShapefileLevel(building, layer);
  const fixtureExtra = /_fixture/i.test(layer.name) ? FIXTURE_EXTRA_HEIGHT_M : 0;
  return (lvl ? lvl.floor : 0) + SHAPEFILE_FLOOR_CLEARANCE_M + fixtureExtra + (layer.heightOffset ?? 0);
}

export function shapefileWorldToLocal(building) {
  const tileset = building?.tileset;
  if (!tileset?.root?.transform) return null;

  const localToWorld = new Matrix4();
  Matrix4.multiplyTransformation(
    tileset.modelMatrix ?? Matrix4.IDENTITY,
    tileset.root.transform,
    localToWorld,
  );
  try {
    return Matrix4.inverse(localToWorld, new Matrix4());
  } catch (e) {
    console.warn("Could not invert shapefile local transform:", e);
    return null;
  }
}

function solveEllipsoidHeightForLocalZ(cartographic, worldToLocal, targetLocalZ, fallbackHeight) {
  const surface = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
  const oneMeterUp = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 1);
  const localSurface = Matrix4.multiplyByPoint(worldToLocal, surface, new Cartesian3());
  const localOneMeterUp = Matrix4.multiplyByPoint(worldToLocal, oneMeterUp, new Cartesian3());
  const dzPerMeter = localOneMeterUp.z - localSurface.z;

  if (!Number.isFinite(dzPerMeter) || Math.abs(dzPerMeter) < 1e-8) {
    return fallbackHeight;
  }

  return (targetLocalZ - localSurface.z) / dzPerMeter;
}

function projectPositionToLocalZ(position, worldToLocal, targetLocalZ, fallbackHeight) {
  const cartographic = Cartographic.fromCartesian(position);
  if (!cartographic) return position;
  const height = worldToLocal
    ? solveEllipsoidHeightForLocalZ(cartographic, worldToLocal, targetLocalZ, fallbackHeight)
    : fallbackHeight;
  return Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, height);
}

function projectHierarchyToLocalZ(hierarchy, worldToLocal, targetLocalZ, fallbackHeight) {
  if (!hierarchy?.positions?.length) return null;
  return new PolygonHierarchy(
    hierarchy.positions.map((position) =>
      projectPositionToLocalZ(position, worldToLocal, targetLocalZ, fallbackHeight),
    ),
    (hierarchy.holes ?? [])
      .map((hole) => projectHierarchyToLocalZ(hole, worldToLocal, targetLocalZ, fallbackHeight))
      .filter(Boolean),
  );
}

export function applyShapefileLayerHeight(building, layer, { viewer = null } = {}) {
  const fallbackHeight = shapefileLayerHeight(building, layer);
  const targetLocalZ = shapefileLayerLocalZ(building, layer);
  const worldToLocal = shapefileWorldToLocal(building);
  const time = viewer?.clock?.currentTime ?? JulianDate.now();

  for (const entity of layer.dataSource.entities.values) {
    if (entity.polygon) {
      const hierarchy = entity.polygon.hierarchy?.getValue
        ? entity.polygon.hierarchy.getValue(time)
        : entity.polygon.hierarchy;
      const projectedHierarchy = projectHierarchyToLocalZ(
        hierarchy,
        worldToLocal,
        targetLocalZ,
        fallbackHeight,
      );
      if (!projectedHierarchy) continue;

      entity.polygon.hierarchy = new ConstantProperty(projectedHierarchy);
      entity.polygon.perPositionHeight = true;
      entity.polygon.arcType = ArcType.NONE;
      entity.polygon.height = undefined;
    } else if (entity.polyline) {
      const positions = entity.polyline.positions?.getValue
        ? entity.polyline.positions.getValue(time)
        : entity.polyline.positions;
      if (!Array.isArray(positions)) continue;
      const projected = positions.map((pos) =>
        projectPositionToLocalZ(pos, worldToLocal, targetLocalZ, fallbackHeight),
      );
      entity.polyline.positions = new ConstantProperty(projected);
    } else if (entity.position) {
      const pos = entity.position.getValue ? entity.position.getValue(time) : entity.position;
      if (!pos) continue;
      const projected = projectPositionToLocalZ(
        pos,
        worldToLocal,
        targetLocalZ + POINT_EXTRA_HEIGHT_M,
        fallbackHeight + POINT_EXTRA_HEIGHT_M,
      );
      entity.position = new ConstantPositionProperty(projected);
    }
  }
}

export function applyShapefileLayerHeights(building, options = {}) {
  for (const layer of building.shapefileLayers ?? []) {
    applyShapefileLayerHeight(building, layer, options);
  }
}