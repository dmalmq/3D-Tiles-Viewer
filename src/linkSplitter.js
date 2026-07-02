/**
 * Detect Revit-link grouping in a freshly loaded tileset.
 *
 * The RevitGeoSuite add-in writes two structural-metadata properties on every
 * exported feature:
 *   - sourceLinkName : the RevitLinkInstance name (empty string for host)
 *   - sourceDocument : the Revit document title (host or linked .rvt)
 *
 * inspectLinks walks loaded tile content and groups features by `groupBy`
 * (default "sourceLinkName"), recording a representative label from `labelBy`
 * (default "sourceDocument") so the UI can show meaningful names.
 *
 * Iteration mirrors the DFS pattern in lodFilter.js (collectBuildingIds).
 */

import { t } from "./i18n.js";

const DEFAULT_GROUP_BY = "sourceLinkName";
const DEFAULT_LABEL_BY = "sourceDocument";

export function inspectLinks(tileset, options = {}) {
  const groupBy = options.groupBy ?? DEFAULT_GROUP_BY;
  const labelBy = options.labelBy ?? DEFAULT_LABEL_BY;
  const tailTimeoutMs = options.tailTimeoutMs ?? 500;
  const safetyTimeoutMs = options.safetyTimeoutMs ?? 60000;
  const collectAllProperties = options.collectAllProperties ?? false;

  return new Promise((resolve) => {
    const groups = new Map(); // value -> { count, label, levels }
    const allPropertyCounts = new Map(); // propName -> distinctValueCount (only if collectAllProperties)
    const allPropertyValueSamples = new Map(); // propName -> Set<sample values>
    let tilesInspected = 0;
    let featuresInspected = 0;

    const inspectContent = (content) => {
      const count = content?.featuresLength ?? 0;
      if (count === 0) return;
      tilesInspected++;
      for (let i = 0; i < count; i++) {
        const feature = content.getFeature(i);
        featuresInspected++;
        const groupVal = feature.getProperty(groupBy);
        const levelKey = feature.getProperty("levelKey");
        const levelName = feature.getProperty("levelName");
        const hasLevelMetadata =
          (levelKey != null && levelKey !== "") ||
          (levelName != null && levelName !== "");
        if (groupVal != null || hasLevelMetadata) {
          const key = groupVal != null ? String(groupVal) : "";
          let entry = groups.get(key);
          if (!entry) {
            const label = labelBy ? feature.getProperty(labelBy) : null;
            entry = {
              count: 0,
              label: label != null ? String(label) : null,
              levelNames: new Set(),
              levels: new Map(),
            };
            groups.set(key, entry);
          }
          entry.count++;
          if (levelName != null && levelName !== "") entry.levelNames.add(String(levelName));
          collectLevelMetadata(entry, feature);
        }
        if (collectAllProperties) {
          for (const id of feature.getPropertyIds()) {
            let samples = allPropertyValueSamples.get(id);
            if (!samples) {
              samples = new Set();
              allPropertyValueSamples.set(id, samples);
            }
            if (samples.size < 50) {
              const v = feature.getProperty(id);
              if (v != null) samples.add(String(v));
            }
          }
        }
      }
    };

    // Walk any already-loaded tiles synchronously
    const stack = tileset.root ? [tileset.root] : [];
    while (stack.length) {
      const tile = stack.pop();
      if (tile.content) inspectContent(tile.content);
      if (tile.children) {
        for (const c of tile.children) stack.push(c);
      }
    }

    let tailTimer = null;
    let safetyTimer = null;
    let resolved = false;
    let removeListener = () => {};
    let removeAllLoadedListener = () => {};

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(tailTimer);
      clearTimeout(safetyTimer);
      removeListener();
      removeAllLoadedListener();
      if (collectAllProperties) {
        for (const [k, v] of allPropertyValueSamples) {
          allPropertyCounts.set(k, v.size);
        }
      }
      for (const info of groups.values()) {
        info.levels = finalizeLevels(info.levels);
      }
      resolve({
        groupBy,
        labelBy,
        groups,
        tilesInspected,
        featuresInspected,
        propertyCounts: allPropertyCounts,
        propertySamples: allPropertyValueSamples,
      });
    };

    removeListener = tileset.tileLoad.addEventListener((tile) => {
      inspectContent(tile.content);
      // Start (or refresh) the short tail as soon as any features have arrived.
      // Until then, only the long safety timer is armed — so very large GLBs
      // that take many seconds to stream still get inspected.
      if (featuresInspected > 0) {
        clearTimeout(tailTimer);
        tailTimer = setTimeout(finish, tailTimeoutMs);
      }
    });

    // A tileset without batched features (e.g. plain GLB content with no
    // metadata) never arms the tail timer — without this, such tilesets would
    // sit on the safety timer for its full duration before the building
    // appears in the UI. Once every requested tile is loaded and inspection
    // still found nothing, there is nothing left to wait for.
    if (tileset.allTilesLoaded) {
      removeAllLoadedListener = tileset.allTilesLoaded.addEventListener(() => {
        if (featuresInspected === 0) finish();
      });
    }

    // The synchronous walk above may already have gathered content — if so,
    // start the tail right away.
    if (featuresInspected > 0) {
      tailTimer = setTimeout(finish, tailTimeoutMs);
    } else if (tileset.tilesLoaded) {
      // Already fully loaded with zero features found — resolve immediately.
      setTimeout(finish, 0);
    }
    // Safety upper bound: guarantees the promise resolves even if no tile ever loads
    safetyTimer = setTimeout(finish, safetyTimeoutMs);
  });
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function collectLevelMetadata(entry, feature) {
  const levelKeyRaw = feature.getProperty("levelKey");
  const levelNameRaw = feature.getProperty("levelName");
  const levelKey = levelKeyRaw == null ? "" : String(levelKeyRaw);
  const levelName = levelNameRaw == null ? "" : String(levelNameRaw);
  if (!levelKey && !levelName) return;

  const mapKey = levelKey || levelName;
  let level = entry.levels.get(mapKey);
  if (!level) {
    level = {
      levelKey,
      levelName,
      count: 0,
      elevationSum: 0,
      elevationCount: 0,
      minZMeters: Infinity,
      maxZMeters: -Infinity,
    };
    entry.levels.set(mapKey, level);
  }

  level.count++;
  const elevation = finiteNumber(feature.getProperty("levelElevationMeters"));
  if (elevation != null) {
    level.elevationSum += elevation;
    level.elevationCount++;
  }
  const minZ = finiteNumber(feature.getProperty("minZMeters"));
  if (minZ != null) level.minZMeters = Math.min(level.minZMeters, minZ);
  const maxZ = finiteNumber(feature.getProperty("maxZMeters"));
  if (maxZ != null) level.maxZMeters = Math.max(level.maxZMeters, maxZ);
}

function finalizeLevels(levels) {
  return [...levels.values()]
    .map(level => ({
      levelKey: level.levelKey,
      levelName: level.levelName,
      levelElevationMeters: level.elevationCount
        ? level.elevationSum / level.elevationCount
        : 0,
      elementCount: level.count,
      minZMeters: Number.isFinite(level.minZMeters) ? level.minZMeters : null,
      maxZMeters: Number.isFinite(level.maxZMeters) ? level.maxZMeters : null,
    }))
    .sort((a, b) => a.levelElevationMeters - b.levelElevationMeters);
}

/**
 * Decide whether the inspection result represents a multi-link tileset that
 * should be split. Returns null when only a single (or zero) groups were found.
 */
export function decideAutoSplit(inspection) {
  if (!inspection || !inspection.groups || inspection.groups.size < 2) {
    return null;
  }
  return {
    groupBy: inspection.groupBy,
    labelBy: inspection.labelBy,
    groups: inspection.groups,
  };
}

/**
 * Format a list of split groups for display. Returns an array of
 * { value, label, count, displayName } sorted with the host (empty value) first.
 */
export function describeSplitGroups(split, fallbackBaseName = "") {
  const entries = [];
  for (const [value, info] of split.groups) {
    let displayName;
    if (info.label && info.label !== "") {
      displayName = info.label;
    } else if (value !== "") {
      displayName = value;
    } else {
      displayName = fallbackBaseName
        ? `${fallbackBaseName} (${t("split.hostFallback")})`
        : t("split.hostFallback");
    }
    entries.push({
      value,
      label: info.label,
      count: info.count,
      displayName,
      levelNames: info.levelNames || new Set(),
      levels: info.levels || [],
    });
  }
  entries.sort((a, b) => {
    if (a.value === "") return -1;
    if (b.value === "") return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return entries;
}
