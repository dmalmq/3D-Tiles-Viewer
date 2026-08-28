// Pure (de)serialization for session JSON. The actual reload/restore
// orchestration lives in main.js — this module only owns the on-disk shape.

import { serializeSourceLevelGroups } from "./levelMetadata.js";
import { serializeNetworkDataset } from "./networkData.js";

import { levelNameToNumber, shortLevelName } from "./floorSplit.js";
import { buildingLevelWorldHeight } from "./shapefilePlacement.js";
import { withAppBase } from "./viewerDataset.js";

// Bump when changing the JSON shape in a non-backward-compatible way. Old
// session files that match a previously-supported version remain loadable.
export const SESSION_SCHEMA_VERSION = 4;
export const SUPPORTED_SESSION_VERSIONS = [1, 2, 3, 4];
export const SAVED_MODEL_LEVEL_ELEVATION_TOLERANCE_M = 25;

export function isSupportedSessionVersion(v) {
  return SUPPORTED_SESSION_VERSIONS.includes(v);
}

export function shouldLoadTilesetFromUrl(bData) {
  return typeof bData?.sourceUrl === "string" && bData.sourceUrl.length > 0;
}

/** Turn app-root paths (/tiles/..., /tilesets/..., /sessions/...) into same-origin URLs under Vite `base`. */
export function resolveSessionAssetUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (url.startsWith("/")) {
    const rooted = withAppBase(url);
    if (typeof globalThis.location !== "undefined" && globalThis.location?.href) {
      return new URL(rooted, globalThis.location.href).href;
    }
    return rooted;
  }
  return url;
}

// Serialize the live in-memory state into the JSON shape persisted to disk.
// The caller supplies the relevant slices of main.js state; this function does
// not touch the DOM, Cesium, or any module-scope state.
export function serializeSession({
  imagery,
  terrain,
  plateauOverridesEnabled,
  modelLevels,
  activeModelLevelIndex,
  venues = [],
  buildings,
  importedLayers,
  unassignedLayers,
  isPlateauLayer,
  serializePlateauOverrides,
}) {
  // Assign a stable tilesetGroupId so siblings sharing one tileset can be
  // reunited on restore (they will load the same tileset once).
  const tilesetIds = new Map();
  let nextId = 0;
  const idFor = (tileset) => {
    if (!tileset) return null;
    if (!tilesetIds.has(tileset)) tilesetIds.set(tileset, ++nextId);
    return tilesetIds.get(tileset);
  };

  return {
    version: SESSION_SCHEMA_VERSION,
    imagery,
    terrain,
    plateauOverridesEnabled,
    modelLevels: modelLevels.map((m) => ({
      floorNumber: m.floorNumber,
      name: m.name,
      elevation: m.elevation,
    })),
    activeModelLevelIndex,
    venues: serializeVenues(venues),
    buildings: buildings.map((b) => serializeBuilding(b, idFor)),
    importedLayers: importedLayers
      .filter((l) => l.sourceConfig)
      .map((l) => {
        const saved = {
          label: l.label,
          visible: l.visible,
          sourceConfig: l.sourceConfig,
          venueId: l.venueId ?? null,
        };
        if (isPlateauLayer(l)) saved.plateauOverrides = serializePlateauOverrides(l);
        return saved;
      }),
    unassignedLayers: unassignedLayers.map(serializeUnassignedLayer),
  };
}

function serializeVenues(venues) {
  return (venues ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description ?? "",
  }));
}

function serializeBuilding(b, idFor) {
  return {
    name: b.name,
    sourceType: b.sourceUrl ? "url" : "file",
    sourceUrl: b.sourceUrl ?? null,
    tilesetGroupId: idFor(b.tileset),
    linkFilter: b.linkFilter ?? null,
    venueId: b.venueId ?? null,
    heightOffset: b.heightOffset,
    levelBaseElevation: b.levelBaseElevation,
    aliases: b.aliases ?? [],
    packageBuildingId: b.packageBuildingId ?? null,
    packageContentHash: b.packageContentHash ?? null,
    activeLevelIndex: b.activeLevelIndex,
    levels: b.levels.map((l) => ({ name: l.name, key: l.key ?? null, floor: l.floor, localPlaneZ: l.localPlaneZ ?? null })),
    sourceLevelGroups: serializeSourceLevelGroups(b.sourceLevelGroups),
    shapefileLayers: b.shapefileLayers.map(serializeShapefileLayer),
    networkDatasets: (b.networkDatasets ?? []).map(serializeNetworkDataset),
    directoryHandleId: b.directoryHandleId ?? null,
    _directoryFolderName: b._directoryFolderName ?? null,
  };
}

function serializeShapefileLayer(sl) {
  return {
    name: sl.name,
    color: sl.color,
    levelKey: sl.levelKey ?? null,
    source: sl.source ?? null,
    features: sl.features ?? [],
    heightOffset: sl.heightOffset ?? 0,
    _origin: sl._origin ?? null,
    _hidden: !!sl._hidden,
    colorColumn: sl.colorColumn ?? null,
    colorMappings: sl.colorMappings ?? null,
  };
}

function serializeUnassignedLayer(l) {
  return {
    name: l.name,
    color: l.color,
    source: l.source ?? null,
    features: l.features ?? [],
    heightOffset: l.heightOffset ?? 0,
    _origin: l._origin ?? "gdb",
    _hidden: !!l._hidden,
    colorColumn: l.colorColumn ?? null,
    colorMappings: l.colorMappings ?? null,
  };
}

// Parse + validate a session JSON string. Throws Error with a user-friendly
// message on any failure. Returns the parsed data on success.
export function parseSessionJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Session file is not valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Session file did not contain a session object.");
  }
  if (!isSupportedSessionVersion(data.version)) {
    throw new Error(`Unsupported session version: ${data.version}`);
  }
  return data;
}

export function groupSessionBuildingsByTileset(buildings = []) {
  const groups = new Map();
  let unique = 0;
  for (const bData of buildings ?? []) {
    const key = bData?.tilesetGroupId != null
      ? `g:${bData.tilesetGroupId}`
      : `u:${unique++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bData);
  }
  return [...groups.values()];
}

export function createSessionRestorePlan(data) {
  const buildingGroups = groupSessionBuildingsByTileset(data?.buildings ?? []);
  const importedLayers = Array.isArray(data?.importedLayers) ? data.importedLayers : [];
  const unassignedLayers = Array.isArray(data?.unassignedLayers) ? data.unassignedLayers : [];
  return {
    buildingGroups,
    importedLayers,
    unassignedLayers,
    primaryItemCount: buildingGroups.length + importedLayers.length,
  };
}

export function applySavedModelLevelOverrides(modelLevels, savedModelLevels, options = {}) {
  if (!Array.isArray(modelLevels) || !Array.isArray(savedModelLevels) || savedModelLevels.length === 0) {
    return modelLevels;
  }
  const maxElevationDelta = options.maxElevationDelta ?? Infinity;
  const byFloorNumber = new Map(savedModelLevels.map((m) => [m.floorNumber, m]));
  for (const modelLevel of modelLevels) {
    const saved = byFloorNumber.get(modelLevel.floorNumber);
    if (!saved) continue;
    if (saved.name) modelLevel.name = saved.name;
    if (
      Number.isFinite(saved.elevation) &&
      (
        !Number.isFinite(modelLevel.elevation) ||
        !Number.isFinite(maxElevationDelta) ||
        Math.abs(saved.elevation - modelLevel.elevation) <= maxElevationDelta
      )
    ) {
      modelLevel.elevation = saved.elevation;
    }
  }
  return modelLevels;
}

export function isValidActiveModelLevelIndex(index, modelLevels) {
  return Number.isFinite(index) && index >= -1 && index < (modelLevels?.length ?? 0);
}

export function normalizeRestoredShapefileLayerData(slData, options = {}) {
  return normalizeRestoredVectorLayerData(slData, {
    ...options,
    includeLevelKey: true,
  });
}

export function normalizeRestoredUnassignedLayerData(layerData, options = {}) {
  return normalizeRestoredVectorLayerData(layerData, {
    ...options,
    includeLevelKey: false,
  });
}

function normalizeRestoredVectorLayerData(layerData, { fallbackSource = null, includeLevelKey } = {}) {
  if (!layerData?.features?.length) return null;
  const normalized = {
    name: layerData.name ?? "layer",
    color: layerData.color ?? "#4fc3f7",
    source: layerData.source ?? fallbackSource ?? null,
    features: layerData.features,
    heightOffset: layerData.heightOffset ?? 0,
    // Saved sessions pre-date the _origin tag — assume GDB (most layers in
    // practice came from the GDB importer) so they show up in the reassign
    // dialog. Newer sessions persist the real origin.
    _origin: layerData._origin ?? "gdb",
    _hidden: !!layerData._hidden,
    colorColumn: layerData.colorColumn ?? null,
    colorMappings: layerData.colorMappings ?? null,
  };
  if (includeLevelKey) normalized.levelKey = layerData.levelKey ?? null;
  return normalized;
}

// Trigger a browser download of the serialized session.
export function deriveModelLevelsFromBuildings(buildings, preserved = [], options = {}) {
  const seen = new Map();
  for (const b of buildings ?? []) {
    if (!b.levels) continue;
    for (const lvl of b.levels) {
      const fn = levelNameToNumber(lvl.name);
      if (fn == null) continue;
      if (!seen.has(fn)) {
        seen.set(fn, {
          name: shortLevelName(lvl.name),
          elevation: buildingLevelWorldHeight(b, lvl),
        });
      }
    }
  }
  const next = [];
  for (const [fn, derived] of seen) {
    next.push({ floorNumber: fn, name: derived.name, elevation: derived.elevation });
  }
  next.sort((a, b) => a.floorNumber - b.floorNumber);
  applySavedModelLevelOverrides(next, preserved, options);
  return next;
}

export function filterSessionByVenue(data, venueId) {
  if (!data || venueId == null) return data;
  const buildings = (data.buildings ?? []).filter((b) => b.venueId === venueId);
  const importedLayers = (data.importedLayers ?? []).filter((l) => l.venueId === venueId);
  const modelLevels = deriveModelLevelsFromBuildings(buildings, data.modelLevels ?? [], {
    maxElevationDelta: SAVED_MODEL_LEVEL_ELEVATION_TOLERANCE_M,
  });
  return {
    ...data,
    version: data.version ?? SESSION_SCHEMA_VERSION,
    venues: (data.venues ?? []).filter((v) => v.id === venueId),
    buildings,
    importedLayers,
    unassignedLayers: [],
    modelLevels,
    activeModelLevelIndex: -1,
  };
}

export function buildVenueManifest(venues, { baseUrl = "", defaultVenueId = null } = {}) {
  const normalizedBase = baseUrl ? baseUrl.replace(/\/?$/, "/") : "";
  const entries = (venues ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    sessionUrl: `${normalizedBase}${v.id}.json`,
  }));
  return {
    version: 1,
    defaultVenueId: defaultVenueId ?? entries[0]?.id ?? null,
    venues: entries,
  };
}

export function slugifyVenueId(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "venue";
}

export function downloadSessionJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `session-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
