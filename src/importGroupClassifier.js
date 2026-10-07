// Pre-classify newly parsed GDB / shapefile feature collections so the
// new import review tray can silently import the obvious cases and only
// surface ambiguous ones to the user. Pure logic — no DOM, no Cesium.

import {
  buildLevelsByPrefix,
  detectLayerLevelRef,
  isLevelFeatureClass,
  matchLayerToTarget,
} from "./gdbAutoMatch.js";
import { groupFeaturesByFloor } from "./floorSplit.js";
import { buildFloorAltitudeHints } from "./gdbLevelMatch.js";
import { resolveGdbLayerLevel } from "./gdbFloorAssignment.js";
import { isBasemapLayerName } from "./gdbImportBudget.js";

// Partition feature collections into three buckets:
//   metadataOnly — `_level` feature classes; dropped silently (consistent
//                  with today's dialog).
//   autoImport   — `confidence: "high"` matches that need no per-feature
//                  floor splitting. Each gets a decision shaped for
//                  `applyGdbDecisions`.
//   needsReview  — everything else; the tray collects user input on these.
//
// The `needsReview` entries include the auto-match result so the tray can
// preselect building/floor without recomputing the score.
export function partitionForReview(featureCollections, buildings, buildingFootprints = null) {
  const metadataOnly = [];
  const autoImport = [];
  const needsReview = [];
  const levelsByPrefix = buildLevelsByPrefix(featureCollections);
  const candidates = (featureCollections ?? []).map((fc) => ({
    fc,
    match: isLevelFeatureClass(fc?.originalFileName ?? fc?.fileName)
      ? null
      : matchLayerToTarget({
          filename: fc.fileName,
          features: fc.features ?? [],
          buildings,
          buildingFootprints,
        }),
  }));
  const donorsByBuilding = new Map();
  for (const { fc, match } of candidates) {
    if (match?.buildingConfidence !== "high") continue;
    const donors = donorsByBuilding.get(match.buildingIndex) ?? [];
    donors.push(fc);
    donorsByBuilding.set(match.buildingIndex, donors);
  }
  const hintsByBuilding = new Map([...donorsByBuilding].map(([index, donors]) => [
    index,
    buildFloorAltitudeHints(donors, { maxSpreadMeters: 1 }),
  ]));

  for (const { fc, match: buildingMatch } of candidates) {
    if (!buildingMatch) {
      metadataOnly.push(fc);
      continue;
    }

    const levelRef = detectLayerLevelRef(fc.originalFileName ?? fc.fileName, levelsByPrefix);
    const floor = buildingMatch.buildingIndex >= 0
      ? resolveGdbLayerLevel({
          fc,
          building: buildings[buildingMatch.buildingIndex],
          levelRef,
          altitudeHints: hintsByBuilding.get(buildingMatch.buildingIndex),
        })
      : { levelKey: null, confidence: "none" };
    const match = {
      ...buildingMatch,
      levelKey: floor.levelKey,
      confidence: buildingMatch.buildingConfidence === "high" && floor.confidence === "high"
        ? "high"
        : "medium",
    };

    const needsFloorSplit = groupFeaturesByFloor(fc?.features ?? []).length >= 2;

    if (
      match.confidence === "high" &&
      match.buildingIndex >= 0 &&
      match.levelKey != null &&
      !needsFloorSplit &&
      !isBasemapLayerName(fc.originalFileName ?? fc.fileName)
    ) {
      autoImport.push({
        fc,
        target: {
          kind: "building",
          buildingIndex: match.buildingIndex,
          levelKey: match.levelKey,
        },
      });
      continue;
    }

    needsReview.push({ fc, match, needsFloorSplit, levelRef });
  }

  return { metadataOnly, autoImport, needsReview };
}
