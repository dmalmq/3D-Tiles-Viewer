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
import { levelNameToNumber } from "./floorSplit.js";

export const SHAPEFILE_FLOOR_CLEARANCE_M = 0.05;
export const POINT_EXTRA_HEIGHT_M = 0.25;
export const FIXTURE_EXTRA_HEIGHT_M = 0.10;
export const SOURCE_LEVEL_LOCAL_Z_SURFACE_LIFT_M = 0.30;
const ABSOLUTE_LEVEL_ELEVATION_TOLERANCE_M = 25;

export function resolveShapefileLevels(building, layer) {
  const linkLevels = getSourceLevelGroup(building, building?.linkFilter?.value);
  if (linkLevels?.length) return linkLevels;
  const sourceLevels = getSourceLevelGroup(building, layer?.source);
  if (sourceLevels?.length) return sourceLevels;
  return building?.levels ?? [];
}

export function findShapefileLevel(building, layer) {
  if (layer.levelKey == null) return null;
  const levels = resolveShapefileLevels(building, layer);
  const match = findLevelInLevels(levels, layer.levelKey);
  if (match) return match;
  return findLevelInLevels(building.levels, layer.levelKey);
}

function levelKey(level) {
  return level?.key ?? level?.levelKey ?? "";
}

function findLevelInLevels(levels, key) {
  return levels?.find((l) => levelKey(l) === key) ?? null;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function levelFloor(lvl) {
  return finiteNumber(lvl?.floor) ?? 0;
}

function parseTpHeight(name) {
  const match = String(name ?? "").match(/TP\s*([+\-−±]?)\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return null;

  const sign = match[1] === "-" || match[1] === "−" ? -1 : 1;
  const raw = match[2];
  let value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  if (!/[.,]/.test(raw) && raw.length >= 3) value /= 1000;
  return sign * value;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function deriveBaseElevationFromTpLevels(levels) {
  const offsets = [];
  for (const level of levels ?? []) {
    const tpHeight = parseTpHeight(level?.name);
    const floor = finiteNumber(level?.floor);
    if (tpHeight == null || floor == null) continue;
    offsets.push(tpHeight - floor);
  }
  const rough = median(offsets);
  if (rough == null) return null;

  const inliers = offsets.filter((value) => Math.abs(value - rough) <= 2);
  return median(inliers.length ? inliers : offsets);
}

function sourceLevelGroupEntries(sourceLevelGroups) {
  if (!sourceLevelGroups) return [];
  if (sourceLevelGroups instanceof Map) {
    return [...sourceLevelGroups.entries()].map(([source, levels]) => ({
      source: String(source),
      levels,
    }));
  }
  if (Array.isArray(sourceLevelGroups)) {
    return sourceLevelGroups
      .map((entry) => ({
        source: entry?.source == null ? "" : String(entry.source),
        levels: entry?.levels,
      }))
      .filter((entry) => entry.levels);
  }
  if (typeof sourceLevelGroups === "object") {
    return Object.entries(sourceLevelGroups)
      .map(([source, levels]) => ({ source, levels }))
      .filter((entry) => entry.levels);
  }
  return [];
}

function sourceLevelGroupValues(sourceLevelGroups) {
  return sourceLevelGroupEntries(sourceLevelGroups).map((entry) => entry.levels);
}

function getSourceLevelGroup(building, source) {
  if (source == null) return null;
  const sourceKey = String(source);
  return (
    sourceLevelGroupEntries(building?.sourceLevelGroups)
      .find((entry) => entry.source === sourceKey)
      ?.levels ?? null
  );
}

function sourceLevelLocalZ(level) {
  return finiteNumber(level?.minZMeters);
}

function hasSourceLocalFrame(source) {
  return String(source ?? "").trim() !== "";
}

function findSourceLevelLocalMetadata(building, layer, key) {
  if (key == null) return null;

  const entries = sourceLevelGroupEntries(building?.sourceLevelGroups);
  if (!entries.length) return null;

  const candidates = [];
  const seen = new Set();
  const addCandidate = (source) => {
    if (source == null) return;
    const sourceKey = String(source);
    if (seen.has(sourceKey)) return;
    seen.add(sourceKey);
    candidates.push(sourceKey);
  };

  addCandidate(building?.linkFilter?.value);
  addCandidate(layer?.source);
  if (building?.linkFilter == null) addCandidate("");

  let candidateHadLevel = false;
  for (const source of candidates) {
    const levels = entries.find((entry) => entry.source === source)?.levels;
    const match = findLevelInLevels(levels, key);
    if (match) candidateHadLevel = true;
    if (hasSourceLocalFrame(source) && sourceLevelLocalZ(match) != null) return match;
  }
  if (candidateHadLevel) return null;

  const matches = entries
    .filter((entry) => hasSourceLocalFrame(entry.source))
    .map((entry) => findLevelInLevels(entry.levels, key))
    .filter((match) => sourceLevelLocalZ(match) != null);
  return matches.length === 1 ? matches[0] : null;
}

function sourceLevelGroupsTpBaseElevation(building) {
  const bases = [];
  for (const levels of sourceLevelGroupValues(building?.sourceLevelGroups)) {
    const base = deriveBaseElevationFromTpLevels(levels);
    if (base != null) bases.push(base);
  }
  return median(bases);
}

function siblingTpBaseElevation(building) {
  const siblingBases = [];
  const tilesetSiblings = building?.tileset?._buildings;
  const siblings = tilesetSiblings?.length ? tilesetSiblings : (building?._siblingBuildings ?? []);
  for (const sibling of siblings) {
    const levelBase = deriveBaseElevationFromTpLevels(sibling?.levels);
    if (levelBase != null) siblingBases.push(levelBase);
    const sourceGroupBase = sourceLevelGroupsTpBaseElevation(sibling);
    if (sourceGroupBase != null) siblingBases.push(sourceGroupBase);
  }
  return median(siblingBases);
}

function levelBaseElevationForLevels(building, levels) {
  return (
    deriveBaseElevationFromTpLevels(levels) ??
    (levels !== building?.levels ? deriveBaseElevationFromTpLevels(building?.levels) : null) ??
    sourceLevelGroupsTpBaseElevation(building) ??
    siblingTpBaseElevation(building) ??
    finiteNumber(building?.levelBaseElevation) ??
    0
  );
}

function levelSetUsesAbsoluteElevations(building, levels) {
  if (deriveBaseElevationFromTpLevels(levels) != null) return false;
  const base = finiteNumber(building?.levelBaseElevation);
  if (base == null || !levels?.length) return false;

  const floorLevels = levels
    .map((level) => ({ level, floor: finiteNumber(level?.floor) }))
    .filter((entry) => entry.floor != null);
  if (!floorLevels.length) return false;

  const groundLevel = floorLevels.find((entry) => levelNameToNumber(entry.level?.name) === 1);
  if (
    groundLevel &&
    Math.abs(groundLevel.floor - base) <= ABSOLUTE_LEVEL_ELEVATION_TOLERANCE_M
  ) {
    return true;
  }

  const minFloor = Math.min(...floorLevels.map((entry) => entry.floor));
  return Math.abs(minFloor - base) <= ABSOLUTE_LEVEL_ELEVATION_TOLERANCE_M;
}

function layerLevelContext(building, layer) {
  const sourceLevels = resolveShapefileLevels(building, layer);
  const lvl =
    layer.levelKey == null
      ? null
      : findLevelInLevels(sourceLevels, layer.levelKey) ??
        findLevelInLevels(building?.levels, layer.levelKey);
  const levels = sourceLevels?.length ? sourceLevels : building?.levels;
  const absolute = levelSetUsesAbsoluteElevations(building, levels);
  const base = levelBaseElevationForLevels(building, levels);
  const sourceLocalLevel =
    layer.levelKey == null
      ? null
      : findSourceLevelLocalMetadata(building, layer, layer.levelKey);
  return { lvl, levels, absolute, base, sourceLocalLevel };
}

function levelWorldHeight(lvl, absolute, base) {
  if (!lvl) return base;
  const floor = levelFloor(lvl);
  return absolute ? floor : base + floor;
}

function levelLocalZ(lvl, absolute, base) {
  if (!lvl) return 0;
  const floor = levelFloor(lvl);
  return absolute ? floor - base : floor;
}

export function buildingLevelWorldHeight(building, level, levels = building?.levels) {
  const absolute = levelSetUsesAbsoluteElevations(building, levels);
  const base = levelBaseElevationForLevels(building, levels);
  return levelWorldHeight(level, absolute, base);
}

export function shapefileLayerHeight(building, layer) {
  const { lvl, absolute, base } = layerLevelContext(building, layer);
  const fixtureExtra = /_fixture/i.test(layer.name) ? FIXTURE_EXTRA_HEIGHT_M : 0;
  return (
    levelWorldHeight(lvl, absolute, base) +
    (building.heightOffset ?? 0) +
    SHAPEFILE_FLOOR_CLEARANCE_M +
    fixtureExtra +
    (layer.heightOffset ?? 0)
  );
}

export function shapefileLayerLocalZ(building, layer) {
  const { lvl, absolute, base, sourceLocalLevel } = layerLevelContext(building, layer);
  const fixtureExtra = /_fixture/i.test(layer.name) ? FIXTURE_EXTRA_HEIGHT_M : 0;
  const sourceLocalZ = sourceLevelLocalZ(sourceLocalLevel);
  const localZ =
    sourceLocalZ == null
      ? levelLocalZ(lvl, absolute, base)
      : sourceLocalZ + SOURCE_LEVEL_LOCAL_Z_SURFACE_LIFT_M;
  return localZ + SHAPEFILE_FLOOR_CLEARANCE_M + fixtureExtra + (layer.heightOffset ?? 0);
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

function solveEllipsoidHeightForLocalZ(cartographic, worldToLocal, targetLocalZ) {
  const surface = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
  const oneMeterUp = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 1);
  const localSurface = Matrix4.multiplyByPoint(worldToLocal, surface, new Cartesian3());
  const localOneMeterUp = Matrix4.multiplyByPoint(worldToLocal, oneMeterUp, new Cartesian3());
  const dzPerMeter = localOneMeterUp.z - localSurface.z;

  if (!Number.isFinite(dzPerMeter) || Math.abs(dzPerMeter) < 1e-8) {
    return null;
  }

  return (targetLocalZ - localSurface.z) / dzPerMeter;
}

function resolveProjectedHeight(cartographic, worldToLocal, targetLocalZ, fallbackHeight) {
  if (!worldToLocal) return fallbackHeight;

  const solvedHeight = solveEllipsoidHeightForLocalZ(
    cartographic,
    worldToLocal,
    targetLocalZ,
  );
  if (!Number.isFinite(solvedHeight)) return fallbackHeight;

  return solvedHeight;
}

function projectPositionToLocalZ(position, worldToLocal, targetLocalZ, fallbackHeight) {
  const cartographic = Cartographic.fromCartesian(position);
  if (!cartographic) return position;
  const height = resolveProjectedHeight(cartographic, worldToLocal, targetLocalZ, fallbackHeight);
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
