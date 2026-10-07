import { detectSource, matchLevelRefToBuildingLevel } from "./gdbAutoMatch.js";
import { extractFloorNumber, groupFeaturesByFloor, levelNameToNumber, matchLevelByText } from "./floorSplit.js";
import {
  featureGroupAltitude,
  levelTpOffset,
  parseLevelTpMeters,
  resolveFloorLevel,
  splitByFloorLevel,
} from "./gdbLevelMatch.js";

function altitudeConflictsWithLevel(features, level, levels) {
  const altitude = featureGroupAltitude(features);
  if (altitude == null || !level) return false;
  const offset = levelTpOffset(levels);
  const expected = parseLevelTpMeters(level.name) ??
    (offset != null && Number.isFinite(level.floor) ? level.floor - offset : null);
  return expected != null && Math.abs(expected - altitude) > 6;
}

export function planGdbFloorParts(features, levels, altitudeHints = null) {
  const groups = groupFeaturesByFloor(features);
  if (groups.length === 0 || (groups.length === 1 && !groups[0].floorValue)) return null;
  return splitByFloorLevel(features, levels, { altitudeHints }).map((part) => ({
    ...part,
    levelKey: part.level && part.reason !== "canonical" &&
      !altitudeConflictsWithLevel(part.features, part.level, levels)
      ? (part.level.key ?? "")
      : null,
  }));
}

export function resolveGdbLayerLevel({ fc, building, levelRef = null, altitudeHints = null }) {
  const levels = building?.levels ?? [];
  const features = fc?.features ?? [];
  const groups = groupFeaturesByFloor(features);
  if (groups.length > 1) return { levelKey: null, confidence: "medium", reason: "multipleFloors" };

  const filename = fc?.originalFileName ?? fc?.fileName ?? "";
  const source = detectSource(features);
  const levelText = [filename, source && !/^\d+$/.test(source.trim()) ? source : null]
    .filter(Boolean)
    .join(" ");
  const filenameLevel = matchLevelByText(levelText, levels);
  const metadataLevel = matchLevelRefToBuildingLevel(levelRef, building);
  const filenameFloor = extractFloorNumber(levelText);
  const metadataFloor = extractFloorNumber(levelRef?.floor ?? levelRef?.name);
  const floorValue = groups[0]?.floorValue ?? null;
  const featureFloor = extractFloorNumber(floorValue);
  const resolved = resolveFloorLevel({ floorValue, features, levels, altitudeHints });

  if (floorValue) {
    if (!resolved) return { levelKey: null, confidence: "none", reason: "unresolvedFloor" };
    if (altitudeConflictsWithLevel(features, resolved.level, levels)) {
      return { levelKey: null, confidence: "medium", reason: "conflictingAltitude" };
    }
    const conflict =
      (featureFloor != null && filenameFloor != null && featureFloor !== filenameFloor) ||
      (featureFloor != null && metadataFloor != null && featureFloor !== metadataFloor) ||
      (levelRef?.name && metadataLevel &&
        String(levelRef.name).toLowerCase() === String(metadataLevel.name).toLowerCase() &&
        metadataLevel !== resolved.level);
    if (resolved.reason === "canonical") {
      return { levelKey: null, confidence: "medium", reason: "ambiguousFloor" };
    }
    return {
      levelKey: conflict ? null : (resolved.level.key ?? ""),
      confidence: conflict ? "medium" : "high",
      reason: conflict ? "conflictingFloor" : resolved.reason,
    };
  }

  if (resolved?.reason === "altitude") {
    const conflict = filenameFloor != null &&
      filenameFloor !== levelNameToNumber(resolved.level.name);
    return {
      levelKey: conflict ? null : (resolved.level.key ?? ""),
      confidence: conflict ? "medium" : "high",
      reason: conflict ? "conflictingFloor" : "altitude",
    };
  }

  const level = metadataLevel ?? filenameLevel;
  if (!level) return { levelKey: null, confidence: "none", reason: "noFloor" };
  const namedFloor = levelNameToNumber(level.name);
  const uniqueNamedFloor = namedFloor != null &&
    levels.filter((candidate) => levelNameToNumber(candidate.name) === namedFloor).length === 1;
  const exactMetadata = levelRef?.name &&
    String(levelRef.name).toLowerCase() === String(metadataLevel?.name).toLowerCase();
  const conflict = filenameFloor != null && metadataFloor != null && filenameFloor !== metadataFloor;
  const confident = !conflict && (uniqueNamedFloor || exactMetadata);
  return {
    levelKey: confident ? (level.key ?? "") : null,
    confidence: confident ? "high" : "medium",
    reason: conflict ? "conflictingFloor" : confident ? "namedFloor" : "ambiguousFloor",
  };
}
