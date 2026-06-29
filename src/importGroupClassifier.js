// Pre-classify newly parsed GDB / shapefile feature collections so the
// new import review tray can silently import the obvious cases and only
// surface ambiguous ones to the user. Pure logic — no DOM, no Cesium.

import { matchLayerToTarget, isLevelFeatureClass } from "./gdbAutoMatch.js";
import { groupFeaturesByFloor } from "./floorSplit.js";

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

  for (const fc of featureCollections ?? []) {
    if (isLevelFeatureClass(fc?.fileName)) {
      metadataOnly.push(fc);
      continue;
    }

    const match = matchLayerToTarget({
      filename: fc.fileName,
      features: fc.features ?? [],
      buildings,
      buildingFootprints,
    });

    const needsFloorSplit = groupFeaturesByFloor(fc?.features ?? []).length >= 2;

    if (
      match.confidence === "high" &&
      match.buildingIndex >= 0 &&
      match.levelKey != null &&
      !needsFloorSplit
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

    needsReview.push({ fc, match, needsFloorSplit });
  }

  return { metadataOnly, autoImport, needsReview };
}
