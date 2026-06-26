import { Color, GeoJsonDataSource } from "cesium";
import { loadTilesetFromUrl, loadTilesetFromFiles, removeCurrentTileset } from "./tilesetLoader.js";
import { getFilesFromDirectoryHandle } from "./fileSystemAccess.js";
import { getDirectoryHandle } from "./directoryStore.js";
import { restoreImportedLayer } from "./importDataModal.js";
import {
  createSessionRestorePlan,
  applySavedModelLevelOverrides,
  isValidActiveModelLevelIndex,
  normalizeRestoredShapefileLayerData,
  normalizeRestoredUnassignedLayerData,
  resolveSessionAssetUrl,
  shouldLoadTilesetFromUrl,
} from "./session.js";

export { shouldLoadTilesetFromUrl };
import { applyShapefileLayerHeights } from "./shapefilePlacement.js";
import { deserializeSourceLevelGroups } from "./levelMetadata.js";
import {
  restoreSerializedPlateauOverrides,
  isPlateauLayer,
} from "./plateauOverrides.js";

async function loadTilesetForBuildingData(bData, ctx) {
  let tileset = null;
  let tilesetUrl = null;
  let loadError = null;

  if (shouldLoadTilesetFromUrl(bData)) {
    tilesetUrl = resolveSessionAssetUrl(bData.sourceUrl);
    try {
      tileset = await loadTilesetFromUrl(ctx.viewer, tilesetUrl, { zoom: false });
    } catch (e) {
      loadError = e?.message || String(e);
      console.warn("Could not restore tileset from URL:", tilesetUrl, e);
    }
  }

  if (!tileset && bData.directoryHandleId) {
    try {
      const handle = await getDirectoryHandle(bData.directoryHandleId);
      if (handle) {
        const files = await getFilesFromDirectoryHandle(handle);
        tileset = await loadTilesetFromFiles(ctx.viewer, files, ctx.fileStatus);
      }
    } catch (e) {
      loadError = loadError ?? (e?.message || String(e));
      console.warn("Could not restore tileset from directory handle:", bData.directoryHandleId, e);
    }
  }

  return { tileset, tilesetUrl, loadError };
}

function inferBuildingName(bData) {
  if (bData.name) return bData.name;
  if (bData._directoryFolderName) return bData._directoryFolderName;
  if (bData.sourceUrl) {
    const stem = bData.sourceUrl.replace(/\/tileset\.json$/i, "").split("/").filter(Boolean).pop();
    if (stem) return stem;
  }
  return "Unnamed";
}

function makeBuildingFromData(bData, tileset, { loadError = null, tilesetUrl = null } = {}) {
  return {
    name: inferBuildingName(bData),
    tileset,
    sourceUrl: bData.sourceUrl ?? null,
    heightOffset: bData.heightOffset ?? 0,
    levelBaseElevation: bData.levelBaseElevation ?? 0,
    activeLevelIndex: bData.activeLevelIndex ?? -1,
    levels: (bData.levels ?? []).map((l) => ({ name: l.name, key: l.key ?? null, floor: l.floor })),
    sourceLevelGroups: deserializeSourceLevelGroups(bData.sourceLevelGroups),
    shapefileLayers: [],
    linkFilter: bData.linkFilter ?? null,
    venueId: bData.venueId ?? null,
    aliases: Array.isArray(bData.aliases) ? bData.aliases : [],
    _tilesetMissing: !tileset,
    _tilesetLoadError: tileset ? null : loadError,
    _tilesetUrl: tilesetUrl ?? (bData.sourceUrl ? resolveSessionAssetUrl(bData.sourceUrl) : null),
    directoryHandleId: bData.directoryHandleId ?? null,
    _directoryFolderName: bData._directoryFolderName ?? null,
  };
}

async function wireTileset(tileset, buildings, bData, ctx, resolvedUrl) {
  if (!tileset) return;

  await tileset.readyPromise;

  const list = Array.isArray(buildings) ? buildings : [buildings];
  tileset._buildings = list;
  tileset._directoryHandleId = list[0]?.directoryHandleId ?? null;
  tileset._directoryFolderName = list[0]?._directoryFolderName ?? null;

  ctx.lodFilter.addTileset(tileset);
  ctx.bindTilesetTileLoad?.(tileset);

  const heightOffset = list[0]?.heightOffset ?? 0;
  if (heightOffset !== 0) ctx.applyHeightOffset?.(tileset, heightOffset);

  ctx.applyFiltersForTileset?.(tileset);
  ctx.refreshLodFilterIfEnabled?.();
  ctx.computePerSiblingBoundingSpheres?.(tileset, resolvedUrl ?? bData.sourceUrl ?? null);
}

async function restoreShapefileLayersForBuilding(building, bData, ctx) {
  for (const slData of bData.shapefileLayers ?? []) {
    await restoreShapefileLayer(building, slData, ctx);
  }
  if (building.shapefileLayers.length) {
    (ctx.applyShapefileLayerHeights ?? applyShapefileLayerHeights)(building, { viewer: ctx.viewer });
  }
}

export async function clearSceneState(ctx) {
  await ctx.clearBuildings?.();
  ctx.clearImportedLayers?.(false);
  ctx.clearUnassignedLayers?.(false);
  ctx.onCleared?.();
}

export async function restoreSession(data, ctx) {
  await clearSceneState(ctx);

  ctx.setPlateauOverridesEnabled?.(data.plateauOverridesEnabled ?? true);
  ctx.setSelectedPlateauFeature?.(null);

  if (data.imagery) {
    ctx.setImageryChoice?.(data.imagery);
    await ctx.switchImagery?.(data.imagery);
  }
  if (data.terrain) {
    ctx.setTerrainChoice?.(data.terrain);
    ctx.switchTerrain?.(data.terrain);
  }

  ctx.restoreVenues?.(data.venues ?? []);

  const restorePlan = createSessionRestorePlan(data);
  let done = 0;
  const total = restorePlan.primaryItemCount;
  ctx.onProgress?.(0, total);

  for (const group of restorePlan.buildingGroups) {
    if (group.length === 1) {
      await restoreBuilding(group[0], ctx);
    } else {
      await restoreSiblingGroup(group, ctx);
    }
    done++;
    ctx.onProgress?.(done, total);
  }

  for (const lData of restorePlan.importedLayers) {
    try {
      const layer = await restoreImportedLayer(ctx.viewer, loadTilesetFromUrl, lData);
      if (layer) {
        if (isPlateauLayer(layer)) {
          restoreSerializedPlateauOverrides(layer, lData.plateauOverrides ?? []);
        }
        layer.venueId = lData.venueId ?? null;
        ctx.importedLayers.push(layer);
      }
    } catch (e) {
      console.warn("Could not restore imported layer:", lData.label, e);
    }
    done++;
    ctx.onProgress?.(done, total);
  }

  for (const u of restorePlan.unassignedLayers) {
    try {
      await restoreUnassignedLayer(u, ctx);
    } catch (e) {
      console.warn("Could not restore unassigned layer:", u?.name, e);
    }
  }

  ctx.setSelectedBuildingIndex?.(ctx.buildings.length > 0 ? 0 : -1);
  ctx.rebuildModelLevels?.();
  const modelLevels = ctx.getModelLevels?.() ?? ctx.modelLevels;
  applySavedModelLevelOverrides(modelLevels, data.modelLevels);
  if (isValidActiveModelLevelIndex(data.activeModelLevelIndex, modelLevels)) {
    ctx.selectModelLevel?.(data.activeModelLevelIndex);
  }
  ctx.onComplete?.();
}

export async function restoreBuilding(bData, ctx) {
  const { tileset, tilesetUrl, loadError } = await loadTilesetForBuildingData(bData, ctx);
  const building = makeBuildingFromData(bData, tileset, { loadError, tilesetUrl });

  await wireTileset(tileset, building, bData, ctx, tilesetUrl);
  await restoreShapefileLayersForBuilding(building, bData, ctx);
  ctx.buildings.push(building);
}

export async function restoreSiblingGroup(group, ctx) {
  const first = group[0];
  const { tileset, tilesetUrl, loadError } = await loadTilesetForBuildingData(first, ctx);

  const reloadGroup = tileset ? null : {};
  const siblings = group.map((bData) => {
    const b = makeBuildingFromData(bData, tileset, { loadError, tilesetUrl });
    b._reloadGroup = reloadGroup;
    ctx.buildings.push(b);
    return b;
  });

  await wireTileset(tileset, siblings, first, ctx, tilesetUrl);

  for (let i = 0; i < group.length; i++) {
    await restoreShapefileLayersForBuilding(siblings[i], group[i], ctx);
  }
}

export async function restoreShapefileLayer(building, slData, ctx) {
  const layerData = normalizeRestoredShapefileLayerData(slData, {
    fallbackSource: ctx.detectShapefileSource?.(slData?.features),
  });
  if (!layerData) return;

  const geojson = { type: "FeatureCollection", features: layerData.features };
  const cesiumColor = Color.fromCssColorString(layerData.color);
  const dataSource = await GeoJsonDataSource.load(geojson, {
    fill: cesiumColor.withAlpha(1.0),
    stroke: cesiumColor,
    strokeWidth: 2,
    clampToGround: false,
  });
  const layer = { ...layerData, dataSource };
  ctx.applyEntityStyling?.(dataSource, layer.name, layer);
  ctx.viewer.dataSources.add(dataSource);
  building.shapefileLayers.push(layer);
  ctx.applyLevelToShapefilesForBuilding?.(building);
}

export async function restoreUnassignedLayer(u, ctx) {
  const layerData = normalizeRestoredUnassignedLayerData(u, {
    fallbackSource: ctx.detectShapefileSource?.(u?.features),
  });
  if (!layerData) return;

  const geojson = { type: "FeatureCollection", features: layerData.features };
  const cesiumColor = Color.fromCssColorString(layerData.color);
  const dataSource = await GeoJsonDataSource.load(geojson, {
    fill: cesiumColor.withAlpha(1.0),
    stroke: cesiumColor,
    strokeWidth: 2,
    clampToGround: false,
  });
  const layer = { ...layerData, dataSource };
  ctx.applyEntityStyling?.(dataSource, layer.name, layer);
  dataSource.show = !layer._hidden;
  ctx.viewer.dataSources.add(dataSource);
  ctx.unassignedLayers.push(layer);
}