import { levelNameToNumber } from "./floorSplit.js";

const DEFAULT_TOLERANCE_M = 0.01;

export function levelTopClipLocalZForBuilding(building, activeFloorNumber, options = {}) {
  if (activeFloorNumber == null || !building?.levels?.length) return null;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_M;
  const levels = building.levels
    .filter(level => Number.isFinite(Number(level?.floor)))
    .slice()
    .sort((a, b) => Number(a.floor) - Number(b.floor));

  const active = levels.find(level => levelNameToNumber(level.name) === activeFloorNumber);
  if (!active) return null;

  const activeZ = Number(active.floor);
  const next = levels.find(level => Number(level.floor) > activeZ + tolerance);
  return next ? Number(next.floor) : null;
}

export function resolveTilesetTopClipLocalZ(buildings, activeFloorNumber, options = {}) {
  if (activeFloorNumber == null) return null;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE_M;
  const visibleBuildings = (buildings ?? []).filter(building => building && !building._hidden);
  if (visibleBuildings.length === 0) return null;

  const heights = [];
  for (const building of visibleBuildings) {
    const z = levelTopClipLocalZForBuilding(building, activeFloorNumber, { tolerance });
    if (z == null) return null;
    heights.push(z);
  }

  const first = heights[0];
  return heights.every(z => Math.abs(z - first) <= tolerance) ? first : null;
}
