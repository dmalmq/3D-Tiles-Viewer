import {
  Viewer,
  Ion,
  Cartographic,
  Cartesian3,
  Cartesian2,
  Matrix4,
  BoundingSphere,
  HeadingPitchRange,
  Math as CesiumMath,
  Color,
  ClippingPlane,
  ClippingPlaneCollection,
  Cesium3DTileStyle,
  NearFarScalar,
  VerticalOrigin,
  HorizontalOrigin,
  LabelStyle,
  DistanceDisplayCondition,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./style.css";
import {
  initializeTerrainProviders,
  switchImagery as switchImageryProvider,
  switchTerrain as switchTerrainProvider,
  applyUndergroundMode as applyUndergroundModeImpl,
} from "./cesiumInit.js";
import { restoreSession, clearSceneState } from "./sessionRestore.js";
import { parseSessionJson } from "./session.js";
import {
  parseVenueManifest,
  getDefaultVenueId,
  resolveVenueSessionUrl,
  resolveVenueIdFromParams,
  DEFAULT_MANIFEST_URL,
} from "./venueManifest.js";
import { renderSceneTree } from "./sceneTreeRenderer.js";
import { LodFilter } from "./lodFilter.js";
import {
  applyPlateauLayerStyle as applyPlateauLayerStyleImpl,
  isPlateauLayer,
} from "./plateauOverrides.js";
import { resolveTilesetTopClipLocalZ } from "./levelClipping.js";
import { levelNameToNumber, shortLevelName } from "./floorSplit.js";
import { removeCurrentTileset } from "./tilesetLoader.js";
import { zoomToBuilding as flyToBuilding, zoomToScene } from "./sceneZoom.js";
import { resolveSessionAssetUrl } from "./session.js";
import { loadTilesetGlbBuffer, computePerLinkLocalAabbs, unionAabbs } from "./glbBoundsExtractor.js";
import { applyEntitiesContextState } from "./contextGhosting.js";
import {
  COLOR2_DEFAULT,
  COLOR2_LOOKUP,
  getLayerType,
  HEX_COLOR_RE,
  isColorConfigurableLayer,
  isSpaceLayerName,
  OPENING_FILL_COLOR,
  SPACE_STROKE_COLOR,
} from "./layerColorConfig.js";
import { t, setLanguage, getLanguage, onLanguageChange, applyTranslationsToDom } from "./i18n.js";
import { notifyUser } from "./notifications.js";
import {
  buildingLevelWorldHeight,
  applyShapefileLayerHeight,
  applyShapefileLayerHeights,
} from "./shapefilePlacement.js";
import {
  createNetworkDataSource,
  updateNetworkDataSourceVisibility,
} from "./networkPlacement.js";
import { readSavedCesiumIonToken } from "./cesiumToken.js";

// -- State --
let viewer;
const buildings = [];
const importedLayers = [];
const unassignedLayers = [];
let modelLevels = [];
let activeModelLevelIndex = -1;
let selectedBuildingIndex = -1;
let plateauOverridesEnabled = true;
let manifest = null;
let venues = [];
let currentVenueId = null;

const layerTypeFilters = { space: true, unit: true, opening: true, detail: true, level: true };
const lodFilter = new LodFilter();
let terrainProviders = { worldTerrainProvider: null, plateauTerrainProvider: null };
const savedGlobeBaseColorRef = { value: null };

const transient = {
  unassignedTreeExpanded: true,
  buildingsSectionExpanded: true,
  invalidatedRenderFrame: null,
  lodRefreshTimer: null,
  searchQuery: "",
  searchResults: [],
  searchSelectedIndex: -1,
  searchOpen: false,
};


const MARKER_ICON_PX = 32;
const MARKER_SCALE_BY_DISTANCE = new NearFarScalar(50, 1.0, 5000, 0.6);
const MARKER_POINT_PX = 5;
const MARKER_POINT_FILL_COLOR = "#3DB84B";
const MARKER_POINT_OUTLINE_COLOR = "#000000";
const MARKER_LABEL_FONT = "12px sans-serif";
const MARKER_LABEL_PIXEL_OFFSET = new Cartesian2(0, -10);
const LABEL_DISTANCE_DISPLAY_CONDITION = new DistanceDisplayCondition(0, 300);
// -- DOM --
const viewerLoadSessionBtn = document.getElementById("viewerLoadSessionBtn");
const viewerSessionInput = document.getElementById("viewerSessionInput");
const viewerSessionBanner = document.getElementById("viewerSessionBanner");
const viewerVenueBar = document.getElementById("viewerVenueBar");
const viewerVenueSelect = document.getElementById("viewerVenueSelect");
const viewerBuildingSelectEl = document.getElementById("viewerBuildingSelect");
const viewerBuildingZoomBtn = document.getElementById("viewerBuildingZoomBtn");
const viewerNoBuildingsMsg = document.getElementById("viewerNoBuildings");
const viewerLayersListEl = document.getElementById("viewerLayersList");
const viewerNoLayersMsg = document.getElementById("viewerNoLayers");
const importedLayersListEl = document.getElementById("importedLayersList");
const noImportedLayersMsg = document.getElementById("noImportedLayersMsg");
const imagerySelect = document.getElementById("imagerySelect");
const terrainSelect = document.getElementById("terrainSelect");
const lodFilterToggle = document.getElementById("lodFilterToggle");
const lodFilterStatus = document.getElementById("lodFilterStatus");
const searchInput = document.getElementById("searchInput");
const searchDropdown = document.getElementById("searchDropdown");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingOverlayMessage = document.getElementById("loadingOverlayMessage");
const loadingOverlaySub = document.getElementById("loadingOverlaySubmessage");

// -- Init --
function init() {
  initLanguageToggle();
  initThemeToggle();
  initPanelToggles();
  initSectionCollapse();

  const savedToken = readSavedCesiumIonToken();
  if (savedToken) Ion.defaultAccessToken = savedToken;

  viewer = new Viewer("cesiumContainer", {
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    // Skip the default Ion base layer (needs a token); switchImagery() below
    // applies whatever the imagery select shows.
    baseLayer: false,
  });

  switchImagery();
  initializeTerrainProviders(savedToken).then((providers) => {
    terrainProviders = providers;
    switchTerrain();
  });

  viewerLoadSessionBtn.addEventListener("click", () => viewerSessionInput.click());
  viewerSessionInput.addEventListener("change", handleLoadSessionFile);
  viewerVenueSelect.addEventListener("change", () => switchVenue(viewerVenueSelect.value));
  viewerBuildingSelectEl.addEventListener("change", () => {
    const val = parseInt(viewerBuildingSelectEl.value, 10);
    selectedBuildingIndex = val >= 0 ? val : -1;
    applyBuildingSelectionFilter();
    invalidateAndRerender();
    if (selectedBuildingIndex >= 0) zoomToBuilding(selectedBuildingIndex);
  });
  viewerBuildingZoomBtn.addEventListener("click", () => {
    if (selectedBuildingIndex >= 0) zoomToBuilding(selectedBuildingIndex);
  });
  imagerySelect.addEventListener("change", () => switchImagery());
  terrainSelect.addEventListener("change", switchTerrain);
  lodFilterToggle.addEventListener("change", handleLodFilterToggle);
  initSearch();
  onLanguageChange(() => invalidateAndRerender());

  void bootstrapFromUrl();
}

function initLanguageToggle() {
  document.documentElement.setAttribute("data-language", getLanguage());
  applyTranslationsToDom(document.body);
  document.getElementById("languageToggleLabel").textContent = getLanguage() === "ja" ? "A" : "あ";
  document.getElementById("languageToggle").addEventListener("click", () => {
    setLanguage(getLanguage() === "ja" ? "en" : "ja");
    document.getElementById("languageToggleLabel").textContent = getLanguage() === "ja" ? "A" : "あ";
  });
}

function initThemeToggle() {
  if (localStorage.getItem("theme") === "light") document.documentElement.setAttribute("data-theme", "light");
  document.getElementById("themeToggle").addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("theme", "light");
    }
  });
}

function initPanelToggles() {
  document.getElementById("leftPanelToggle").addEventListener("click", () => {
    document.body.classList.toggle("left-collapsed");
  });
}

function initSectionCollapse() {
  document.querySelectorAll(".panel-section").forEach((section) => {
    const header = section.querySelector(".panel-section-header.collapsible");
    if (!header) return;
    const key = section.id ? `section:${section.id}:collapsed` : null;
    if (key && localStorage.getItem(key) === "1") section.classList.add("collapsed");
    header.addEventListener("click", () => {
      section.classList.toggle("collapsed");
      if (key) {
        if (section.classList.contains("collapsed")) localStorage.setItem(key, "1");
        else localStorage.removeItem(key);
      }
    });
  });
}

// -- Venue / session bootstrap --
async function bootstrapFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const manifestUrl = params.get("manifest");
  const sessionUrl = params.get("session");
  const venueId = resolveVenueIdFromParams(params);
  try {
    if (sessionUrl) {
      viewerVenueBar.hidden = true;
      await loadSessionFromUrl(sessionUrl);
      return;
    }
    if (manifestUrl) {
      await loadManifest(manifestUrl, venueId);
      return;
    }
    if (venueId) {
      await loadManifest(DEFAULT_MANIFEST_URL, venueId);
      return;
    }
    await tryLoadDefaultManifest();
  } catch (err) {
    showBanner(t("viewer.loadFailed", { message: err.message }), true);
    notifyUser("error", "alert.failedSession", { message: err.message });
  }
}

async function tryLoadDefaultManifest() {
  try {
    const res = await fetch(DEFAULT_MANIFEST_URL);
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadManifest(DEFAULT_MANIFEST_URL);
  } catch (err) {
    if (err.message?.includes("404")) return;
    throw err;
  }
}

async function loadManifest(url, preferredVenueId = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  manifest = parseVenueManifest(await res.text());
  venues = manifest.venues.slice();
  populateVenueSelect();
  viewerVenueBar.hidden = venues.length === 0;
  const targetId = preferredVenueId && venues.some((v) => v.id === preferredVenueId)
    ? preferredVenueId
    : getDefaultVenueId(manifest);
  if (targetId) await switchVenue(targetId);
}

async function loadSessionFromUrl(url) {
  showBanner(t("viewer.loadingSession"));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await restoreSession(parseSessionJson(await res.text()), buildRestoreContext());
  hideBanner();
}

async function switchVenue(venueId) {
  if (!manifest || !venueId || venueId === currentVenueId) return;
  const sessionUrl = resolveVenueSessionUrl(manifest, venueId);
  if (!sessionUrl) throw new Error(t("viewer.noSessionUrl"));
  showBanner(t("viewer.loadingVenue", { name: venues.find((v) => v.id === venueId)?.name ?? venueId }));
  showLoadingOverlay(t("viewer.loadingVenue", { name: "" }), "");
  try {
    await clearSceneState(buildRestoreContext());
    const res = await fetch(sessionUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await restoreSession(parseSessionJson(await res.text()), buildRestoreContext());
    currentVenueId = venueId;
    viewerVenueSelect.value = venueId;
    hideBanner();
  } finally {
    hideLoadingOverlay();
  }
}

function populateVenueSelect() {
  viewerVenueSelect.innerHTML = "";
  for (const venue of venues) {
    const opt = document.createElement("option");
    opt.value = venue.id;
    opt.textContent = venue.name;
    viewerVenueSelect.appendChild(opt);
  }
}

async function handleLoadSessionFile(e) {
  const file = e.target.files[0];
  viewerSessionInput.value = "";
  if (!file) return;
  try {
    showLoadingOverlay(t("loading.session.title"), "");
    await restoreSession(parseSessionJson(await file.text()), buildRestoreContext());
    currentVenueId = null;
    hideBanner();
  } catch (err) {
    notifyUser("error", "alert.failedSession", { message: err.message });
  } finally {
    hideLoadingOverlay();
  }
}

function showBanner(message, isError = false) {
  viewerSessionBanner.textContent = message;
  viewerSessionBanner.hidden = false;
  viewerSessionBanner.classList.toggle("viewer-banner-error", isError);
}

function hideBanner() {
  viewerSessionBanner.hidden = true;
  viewerSessionBanner.textContent = "";
}

function showLoadingOverlay(message, submessage = "") {
  loadingOverlayMessage.textContent = message;
  loadingOverlaySub.textContent = submessage;
  loadingOverlay.hidden = false;
}

function hideLoadingOverlay() {
  loadingOverlay.hidden = true;
}

// -- Restore context (delegates to sessionRestore.js) --
function buildRestoreContext() {
  return {
    viewer,
    buildings,
    importedLayers,
    unassignedLayers,
    modelLevels,
    lodFilter,
    fileStatus: null,
    clearBuildings: clearBuildings,
    clearImportedLayers: (rerender) => clearImportedLayers(rerender),
    clearUnassignedLayers: (rerender) => clearUnassignedLayers(rerender),
    setPlateauOverridesEnabled: (v) => { plateauOverridesEnabled = v; },
    setSelectedPlateauFeature: () => {},
    setImageryChoice: (v) => { imagerySelect.value = v; },
    switchImagery: (v) => switchImagery(v),
    setTerrainChoice: (v) => { terrainSelect.value = v; },
    switchTerrain: (v) => switchTerrain(v),
    restoreVenues: () => {},
    setSelectedBuildingIndex: () => { selectedBuildingIndex = -1; },
    rebuildModelLevels,
    getModelLevels: () => modelLevels,
    selectModelLevel,
    bindTilesetTileLoad,
    applyHeightOffset,
    applyFiltersForTileset,
    refreshLodFilterIfEnabled,
    computePerSiblingBoundingSpheres,
    applyEntityStyling,
    applyShapefileLayerHeight: (building, layer) =>
      applyShapefileLayerHeight(building, layer, { viewer }),
    applyShapefileLayerHeights: (building) =>
      applyShapefileLayerHeights(building, { viewer }),
    applyLevelToShapefilesForBuilding,
    restoreNetworkDatasetsForBuilding,
    detectShapefileSource,
    onProgress: (done, total) => {
      loadingOverlaySub.textContent = t("loading.session.progress", { current: done, total });
    },
    onComplete: () => {
      refreshPlateauStyles();
      showMissingTilesetWarnings();
      zoomToScene(viewer, buildings);
      invalidateAndRerender();
    },
    onCleared: () => invalidateAndRerender(),
  };
}

async function clearBuildings() {
  const destroyed = new Set();
  for (const b of buildings) {
    for (const layer of b.shapefileLayers) viewer.dataSources.remove(layer.dataSource, true);
    removeNetworkDataSources(b);
    if (b.tileset && !destroyed.has(b.tileset)) {
      destroyed.add(b.tileset);
      lodFilter.removeTileset(b.tileset);
      removeCurrentTileset(viewer, b.tileset);
    }
  }
  buildings.length = 0;
  selectedBuildingIndex = -1;
  activeModelLevelIndex = -1;
  rebuildModelLevels();
}

function clearImportedLayers(rerender = true) {
  for (let i = importedLayers.length - 1; i >= 0; i--) {
    const layer = importedLayers[i];
    if (layer.type === "tileset") removeCurrentTileset(viewer, layer.data);
    else if (layer.type === "entities") layer.data.forEach((e) => viewer.entities.remove(e));
    else if (layer.type === "datasource") viewer.dataSources.remove(layer.data, true);
    importedLayers.splice(i, 1);
  }
  if (rerender) invalidateAndRerender();
}

function clearUnassignedLayers(rerender = true) {
  for (const layer of unassignedLayers.splice(0)) {
    if (layer.dataSource) viewer.dataSources.remove(layer.dataSource, true);
  }
  if (rerender) invalidateAndRerender();
}

// -- Basemap --
async function switchImagery(choice = imagerySelect.value) {
  await switchImageryProvider(viewer, choice, { onAfterSwitch: applyUndergroundMode });
}

function switchTerrain(choice = terrainSelect.value) {
  switchTerrainProvider(viewer, choice, terrainProviders);
  applyUndergroundMode();
}

function isUndergroundActive() {
  if (activeModelLevelIndex < 0) return false;
  return (modelLevels[activeModelLevelIndex]?.floorNumber ?? 0) < 0;
}

function applyUndergroundMode() {
  applyUndergroundModeImpl(viewer, {
    isUndergroundActive,
    savedGlobeBaseColorRef,
    onContextGhosting: applyImportedLayerContexts,
  });
}

// -- Levels / clipping / filters --
function rebuildModelLevels() {
  const preserved = new Map(modelLevels.map((m) => [m.floorNumber, m]));
  const seen = new Map();
  for (const b of buildings) {
    for (const lvl of b.levels ?? []) {
      const fn = levelNameToNumber(lvl.name);
      if (fn == null || seen.has(fn)) continue;
      seen.set(fn, { name: shortLevelName(lvl.name), elevation: buildingLevelWorldHeight(b, lvl) });
    }
  }
  modelLevels = [...seen].map(([fn, derived]) => {
    const existing = preserved.get(fn);
    return existing
      ? { floorNumber: fn, name: existing.name, elevation: existing.elevation }
      : { floorNumber: fn, name: derived.name, elevation: derived.elevation };
  }).sort((a, b) => a.floorNumber - b.floorNumber);
  if (activeModelLevelIndex >= modelLevels.length) activeModelLevelIndex = -1;
}

function selectModelLevel(modelLevelIndex) {
  activeModelLevelIndex = modelLevelIndex;
  for (const b of buildings) {
    let matchIdx = -1;
    if (modelLevelIndex >= 0) {
      const targetFn = modelLevels[modelLevelIndex]?.floorNumber;
      matchIdx = b.levels.findIndex((l) => levelNameToNumber(l.name) === targetFn);
    }
    if (b.activeLevelIndex !== matchIdx) {
      b.activeLevelIndex = matchIdx;
      applyActiveLevelForBuilding(b);
    }
  }
  invalidateAndRerender();
}

function selectLevel(buildingIndex, levelIndex) {
  selectedBuildingIndex = buildingIndex;
  if (levelIndex === -1) return selectModelLevel(-1);
  const lvl = buildings[buildingIndex]?.levels[levelIndex];
  if (!lvl) return;
  const fn = levelNameToNumber(lvl.name);
  if (fn == null) {
    buildings[buildingIndex].activeLevelIndex = levelIndex;
    applyActiveLevelForBuilding(buildings[buildingIndex]);
    return invalidateAndRerender();
  }
  let mli = modelLevels.findIndex((m) => m.floorNumber === fn);
  if (mli === -1) { rebuildModelLevels(); mli = modelLevels.findIndex((m) => m.floorNumber === fn); }
  if (mli !== -1) selectModelLevel(mli);
}

function applyActiveLevelForBuilding(building) {
  if (!building.tileset) return;
  applyFiltersForTileset(building.tileset);
  applyLevelToShapefilesForBuilding(building);
}

function applyLevelTopClipForTileset(tileset) {
  const clipZ = resolveTilesetTopClipLocalZ(tileset._buildings || [], activeModelLevelIndex < 0 ? null : modelLevels[activeModelLevelIndex]?.floorNumber ?? null);
  const existing = tileset._levelTopClippingPlanes;
  if (clipZ == null) { if (existing) existing.enabled = false; return; }
  if (!existing) {
    const plane = new ClippingPlane(new Cartesian3(0, 0, -1), clipZ);
    const clippingPlanes = new ClippingPlaneCollection({ planes: [plane], edgeWidth: 0 });
    tileset._levelTopClipPlane = plane;
    tileset._levelTopClippingPlanes = clippingPlanes;
    tileset.clippingPlanes = clippingPlanes;
    return;
  }
  if (tileset.clippingPlanes !== existing) tileset.clippingPlanes = existing;
  existing.enabled = true;
  const plane = tileset._levelTopClipPlane || existing.get(0);
  plane.normal = new Cartesian3(0, 0, -1);
  plane.distance = clipZ;
  tileset._levelTopClipPlane = plane;
}

function applyFiltersForTileset(tileset) {
  if (!tileset) return;
  applyLevelTopClipForTileset(tileset);
  if (!tileset.root) return;
  const stack = [tileset.root];
  while (stack.length) {
    const tile = stack.pop();
    if (tile.content) applyFiltersToContent(tileset, tile.content);
    if (tile.children) for (const c of tile.children) stack.push(c);
  }
  for (const b of tileset._buildings || []) applyLevelToShapefilesForBuilding(b);
}

function applyFiltersToContent(tileset, content) {
  const count = content?.featuresLength ?? 0;
  if (!count) return;
  const siblings = tileset._buildings || [];
  if (!siblings.length) return;
  const linkProperty = siblings[0]?.linkFilter?.property ?? null;
  const activeFn = activeModelLevelIndex < 0 ? null : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;
  for (let i = 0; i < count; i++) {
    const feature = content.getFeature(i);
    let owning = siblings[0];
    if (linkProperty) {
      const valStr = feature.getProperty(linkProperty) == null ? "" : String(feature.getProperty(linkProperty));
      owning = siblings.find((s) => s.linkFilter?.value === valStr) || siblings[0];
    }
    if (!owning || owning._hidden) { feature.show = false; continue; }
    if (activeFn === null) { feature.show = true; continue; }
    const lvl = feature.getProperty("levelName");
    const cat = feature.getProperty("category");
    if (lvl === "Unassigned" && cat === "Mass") { feature.show = false; continue; }
    const fn = levelNameToNumber(lvl);
    if (fn == null) feature.show = false;
    else if (fn <= activeFn && cat === "Ceilings") feature.show = false;
    else feature.show = fn <= activeFn;
  }
}

function applyLevelToShapefilesForBuilding(building) {
  const activeFn = activeModelLevelIndex < 0 ? null : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;
  for (const layer of building.shapefileLayers) {
    if (layer._hidden || (getLayerType(layer.name) && !layerTypeFilters[getLayerType(layer.name)])) {
      layer.dataSource.show = false;
      continue;
    }
    if (activeFn === null) { layer.dataSource.show = true; continue; }
    if (layer.levelKey == null) { layer.dataSource.show = false; continue; }
    const lvl = building.levels.find((l) => (l.key ?? "") === layer.levelKey);
    layer.dataSource.show = levelNameToNumber(lvl?.name) === activeFn;
  }
  applyNetworkVisibilityForBuilding(building);
}

function restoreNetworkDatasetsForBuilding(building) {
  for (const dataset of building.networkDatasets ?? []) {
    if (!dataset.nodesById) {
      dataset.nodesById = new Map((dataset.nodes ?? []).map((node) => [node.nodeId, node]));
    }
    if (dataset.dataSource) viewer.dataSources.remove(dataset.dataSource, true);
    dataset.dataSource = createNetworkDataSource(building, dataset, {
      activeFloorNumber: activeModelFloorNumber(),
    });
    viewer.dataSources.add(dataset.dataSource);
  }
  applyNetworkVisibilityForBuilding(building);
}

function removeNetworkDataSources(building) {
  for (const dataset of building.networkDatasets ?? []) {
    if (dataset.dataSource) {
      viewer.dataSources.remove(dataset.dataSource, true);
      dataset.dataSource = null;
    }
  }
}

function applyNetworkVisibilityForBuilding(building) {
  for (const dataset of building.networkDatasets ?? []) {
    updateNetworkDataSourceVisibility(building, dataset, activeModelFloorNumber());
  }
}

function activeModelFloorNumber() {
  return activeModelLevelIndex < 0 ? null : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;
}

function bindTilesetTileLoad(tileset) {
  if (!tileset || tileset._linkAwareTileLoadBound) return;
  tileset._linkAwareTileLoadBound = true;
  tileset.tileLoad.addEventListener((tile) => {
    applyFiltersToContent(tileset, tile.content);
    scheduleLodFilterRefresh();
  });
}

function applyHeightOffset(tileset, offsetMeters) {
  if (!tileset) return;
  const cartographic = Cartographic.fromCartesian(tileset.boundingSphere.center);
  const surface = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
  const offset = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, offsetMeters);
  tileset.modelMatrix = Matrix4.fromTranslation(Cartesian3.subtract(offset, surface, new Cartesian3()));
}

async function computePerSiblingBoundingSpheres(tileset, sourceUrl) {
  try {
    const buf = await loadTilesetGlbBuffer(tileset, resolveSessionAssetUrl(sourceUrl));
    if (!buf) return;
    const aabbs = computePerLinkLocalAabbs(buf);
    if (!aabbs.size) return;
    const localToWorld = new Matrix4();
    Matrix4.multiplyTransformation(tileset.modelMatrix, tileset.root.transform, localToWorld);
    const wholeAabb = unionAabbs(aabbs);
    for (const sibling of tileset._buildings || []) {
      const aabb = sibling.linkFilter?.value == null ? wholeAabb : aabbs.get(sibling.linkFilter.value);
      if (!aabb) continue;
      const corners = [];
      for (let i = 0; i < 8; i++) {
        corners.push(Matrix4.multiplyByPoint(localToWorld, new Cartesian3(
          (i & 1) ? aabb.max[0] : aabb.min[0], (i & 2) ? aabb.max[1] : aabb.min[1], (i & 4) ? aabb.max[2] : aabb.min[2],
        ), new Cartesian3()));
      }
      sibling._boundingSphere = BoundingSphere.fromPoints(corners);
    }
  } catch (e) {
    console.warn("Per-link bounds computation failed:", e);
  }
}

function detectShapefileSource(features) {
  const counts = new Map();
  for (const f of features ?? []) {
    const key = f?.properties?.source;
    if (key == null || key === "") continue;
    counts.set(String(key), (counts.get(String(key)) ?? 0) + 1);
  }
  let best = null, max = 0;
  for (const [k, v] of counts) if (v > max) { max = v; best = k; }
  return best;
}

function resolveMarkerImageUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/icons/")) return s;
  if (s.startsWith("/marker/")) return "/icons" + s;
  if (s.startsWith("marker/")) return "/icons/" + s;
  return "/icons/marker/" + s.replace(/^\.?\//, "");
}

function safeColorFromHex(hex, fallbackHex = COLOR2_DEFAULT) {
  try {
    return Color.fromCssColorString(hex);
  } catch {
    return Color.fromCssColorString(fallbackHex);
  }
}

function applyEntityStyling(dataSource, layerName = "", layer = null) {
  const isSpaceLayer = isSpaceLayerName(layer?.name ?? layerName);
  const isOpeningLayer = /_opening/i.test(layerName);
  const colorColumn = layer?.colorColumn || (isSpaceLayer ? "color2" : null);
  const colorMappings = layer?.colorMappings || (isSpaceLayer ? COLOR2_LOOKUP : {});
  const shouldApplyConfiguredColors = !!colorColumn && (isSpaceLayer || isColorConfigurableLayer(layer));

  for (const entity of dataSource.entities.values) {
    const imageRaw = entity.properties?.image?.getValue?.();
    if (entity.billboard && imageRaw) {
      const url = resolveMarkerImageUrl(imageRaw);
      if (url) {
        entity.billboard.image = url;
        entity.billboard.width = MARKER_ICON_PX;
        entity.billboard.height = MARKER_ICON_PX;
        entity.billboard.verticalOrigin = VerticalOrigin.BOTTOM;
        entity.billboard.scaleByDistance = MARKER_SCALE_BY_DISTANCE;
      }
    }

    const nameRaw = entity.properties?.name?.getValue?.();
    const symbolIdRaw = entity.properties?.symbol_id?.getValue?.();
    if (entity.billboard && !imageRaw && (nameRaw || symbolIdRaw)) {
      entity.billboard = undefined;
      entity.point = {
        pixelSize: MARKER_POINT_PX,
        color: Color.fromCssColorString(MARKER_POINT_FILL_COLOR),
        outlineColor: Color.fromCssColorString(MARKER_POINT_OUTLINE_COLOR),
        outlineWidth: 2,
        scaleByDistance: MARKER_SCALE_BY_DISTANCE,
      };
      const labelText = [symbolIdRaw, nameRaw]
        .filter(Boolean)
        .map((s) => String(s).replace(/<br\s*\/?>/gi, "\n"))
        .join("\n");
      entity.label = {
        text: labelText,
        font: MARKER_LABEL_FONT,
        fillColor: Color.BLACK,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: MARKER_LABEL_PIXEL_OFFSET,
        scaleByDistance: MARKER_SCALE_BY_DISTANCE,
        distanceDisplayCondition: LABEL_DISTANCE_DISPLAY_CONDITION,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      };
    }

    if (shouldApplyConfiguredColors) {
      const raw = entity.properties?.[colorColumn]?.getValue?.();
      const key = String(raw ?? "").trim();
      let hex = colorMappings[key];
      if (!hex && HEX_COLOR_RE.test(key)) hex = key;
      if (!hex) hex = COLOR2_DEFAULT;
      const c = safeColorFromHex(hex, COLOR2_DEFAULT);
      if (entity.polygon) {
        entity.polygon.material = c.withAlpha(1.0);
        entity.polygon.outlineColor = Color.fromCssColorString(SPACE_STROKE_COLOR);
      } else if (entity.polyline) {
        entity.polyline.material = c.withAlpha(1.0);
      }
      continue;
    }

    if (isOpeningLayer) {
      const c = Color.fromCssColorString(OPENING_FILL_COLOR);
      if (entity.polygon) {
        entity.polygon.material = c.withAlpha(1.0);
      } else if (entity.polyline) {
        entity.polyline.material = c.withAlpha(1.0);
      }
      continue;
    }

    if (!entity.polygon) continue;
    const hexRaw = entity.properties?.previcolor?.getValue?.();
    if (hexRaw) {
      try {
        const c = Color.fromCssColorString(String(hexRaw).trim());
        entity.polygon.material = c.withAlpha(1.0);
        entity.polygon.outlineColor = new Color(c.red * 0.5, c.green * 0.5, c.blue * 0.5, 1.0);
      } catch (e) {
        console.warn("previcolor parse failed:", hexRaw, e);
      }
    }
  }
}

function showMissingTilesetWarnings() {
  const missing = buildings.filter((b) => b._tilesetMissing);
  if (!missing.length) return;
  for (const b of missing) {
    const url = b._tilesetUrl ?? "(no URL)";
    const err = b._tilesetLoadError ?? "unknown error";
    console.error(`[viewer] Tileset failed: ${b.name} — ${err} — ${url}`);
    notifyUser("error", "viewer.tilesetLoadFailed", { name: b.name, url, error: err });
  }
  const names = missing.map((b) => b.name).join(", ");
  const detail = missing
    .map((b) => {
      if (b._tilesetLoadError && b._tilesetUrl) {
        return `${b.name}: ${b._tilesetLoadError} (${b._tilesetUrl})`;
      }
      if (b._tilesetUrl) return `${b.name}: ${b._tilesetUrl}`;
      return b.name;
    })
    .join("; ");
  showBanner(t("viewer.tilesetMissingDetail", { names, detail }), true);
}

// -- PLATEAU (read-only styles) --
function refreshPlateauStyles() {
  for (const layer of importedLayers) {
    if (!isPlateauLayer(layer)) continue;
    applyPlateauLayerStyleImpl(layer, { overridesEnabled: plateauOverridesEnabled, contextGhosted: activeModelLevelIndex >= 0 });
  }
}

function applyImportedLayerContexts() {
  const ghosted = activeModelLevelIndex >= 0;
  for (const layer of importedLayers) {
    if (isPlateauLayer(layer)) {
      if (layer.data) layer.data.show = !!layer.visible && !isUndergroundActive();
      applyPlateauLayerStyleImpl(layer, { overridesEnabled: plateauOverridesEnabled, contextGhosted: ghosted });
    } else if (layer.type === "datasource" && layer.data) {
      layer.data.show = !!layer.visible;
      applyEntitiesContextState(layer.data.entities.values, { ghosted, layerVisible: layer.visible });
    } else if (layer.type === "tileset" && layer.data) {
      layer.data.show = !!layer.visible;
      if (!layer._contextOriginalStyleCaptured) { layer._contextOriginalStyle = layer.data.style; layer._contextOriginalStyleCaptured = true; }
      layer.data.style = ghosted ? new Cesium3DTileStyle({ color: 'color("white", 0.18)' }) : layer._contextOriginalStyle;
      layer.data.makeStyleDirty?.();
    }
  }
}

// -- LOD filter --
function handleLodFilterToggle() {
  if (!lodFilterToggle.checked && transient.lodRefreshTimer) clearTimeout(transient.lodRefreshTimer);
  lodFilter.toggle(lodFilterToggle.checked);
  updateLodFilterStatus();
}

function refreshLodFilterIfEnabled() {
  if (lodFilterToggle.checked) lodFilter.apply();
  updateLodFilterStatus();
}

function scheduleLodFilterRefresh() {
  if (!lodFilterToggle.checked || transient.lodRefreshTimer) return;
  transient.lodRefreshTimer = setTimeout(() => { transient.lodRefreshTimer = null; refreshLodFilterIfEnabled(); }, 250);
}

function updateLodFilterStatus() {
  lodFilterStatus.textContent = lodFilterToggle.checked && buildings.length
    ? t("models.lodStatus", lodFilter.stats()) : "";
}

// -- Rendering --
function invalidateAndRerender() {
  if (transient.invalidatedRenderFrame != null) return;
  transient.invalidatedRenderFrame = requestAnimationFrame(() => {
    transient.invalidatedRenderFrame = null;
    renderViewerBuildingList();
    renderViewerLayersList();
    renderImportedLayersList();
    applyLevelTopClipForAll();
    applyUndergroundMode();
    applyImportedLayerContexts();
    updateLodFilterStatus();
  });
}

function applyBuildingSelectionFilter() {
  for (let i = 0; i < buildings.length; i++) {
    buildings[i]._hidden = selectedBuildingIndex >= 0 && i !== selectedBuildingIndex;
  }
  const seen = new Set();
  for (const b of buildings) {
    if (!b.tileset || seen.has(b.tileset)) continue;
    seen.add(b.tileset);
    const allHidden = (b.tileset._buildings ?? []).every(s => s._hidden);
    b.tileset.show = !allHidden;
    if (!allHidden) applyFiltersForTileset(b.tileset);
  }
  for (const b of buildings) {
    if (b._hidden) {
      for (const layer of b.shapefileLayers) layer.dataSource.show = false;
      applyNetworkVisibilityForBuilding(b);
    } else {
      applyLevelToShapefilesForBuilding(b);
    }
  }
}

function applyLevelTopClipForAll() {
  const seen = new Set();
  for (const b of buildings) {
    if (!b.tileset || seen.has(b.tileset)) continue;
    seen.add(b.tileset);
    applyLevelTopClipForTileset(b.tileset);
  }
}

function renderViewerBuildingList() {
  viewerNoBuildingsMsg.style.display = buildings.length ? "none" : "";
  viewerBuildingSelectEl.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "-1";
  allOpt.textContent = t("viewer.allBuildings");
  viewerBuildingSelectEl.appendChild(allOpt);
  for (let i = 0; i < buildings.length; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = buildings[i].name;
    viewerBuildingSelectEl.appendChild(opt);
  }
  viewerBuildingSelectEl.value = selectedBuildingIndex >= 0 ? String(selectedBuildingIndex) : "-1";
  viewerBuildingZoomBtn.style.display = selectedBuildingIndex >= 0 ? "" : "none";
}

function getReadOnlySceneTreeCallbacks() {
  return {
    t,
    selectModelLevel,
    toggleModelLevelExpanded: (mli) => { if (modelLevels[mli]) modelLevels[mli]._expanded = !modelLevels[mli]._expanded; invalidateAndRerender(); },
    toggleUnassignedExpanded: () => { transient.unassignedTreeExpanded = !transient.unassignedTreeExpanded; invalidateAndRerender(); },
    toggleBuildingsSection: () => { transient.buildingsSectionExpanded = !transient.buildingsSectionExpanded; invalidateAndRerender(); },
    toggleBuildingExpanded: (bi) => {
      const b = buildingsForLayersTree()[bi];
      if (b) b._expanded = !(b._expanded !== false);
      invalidateAndRerender();
    },
    selectBuilding: (bi) => {
      const list = buildingsForLayersTree();
      const globalIdx = list === buildings ? bi : buildings.indexOf(list[bi]);
      if (globalIdx >= 0) selectedBuildingIndex = globalIdx;
      invalidateAndRerender();
    },
    zoomBuilding: (bi) => zoomToBuilding(buildings.indexOf(buildingsForLayersTree()[bi])),
    selectLevel: (bi, li) => selectLevel(buildings.indexOf(buildingsForLayersTree()[bi]), li),
    toggleLayerVisibility: ({ layer, fromBi }) => {
      if (!layer) return;
      layer._hidden = !layer._hidden;
      if (fromBi >= 0) applyLevelToShapefilesForBuilding(buildings[fromBi]);
      else if (layer.dataSource) layer.dataSource.show = !layer._hidden;
      invalidateAndRerender();
    },
  };
}

function buildingsForLayersTree() {
  return selectedBuildingIndex >= 0 ? [buildings[selectedBuildingIndex]] : buildings;
}

function buildingVisibleFloorNumbers() {
  if (selectedBuildingIndex < 0) return null;
  const b = buildings[selectedBuildingIndex];
  if (!b) return null;
  const nums = new Set();
  for (const l of b.levels ?? []) {
    const fn = levelNameToNumber(l.name);
    if (fn != null) nums.add(fn);
  }
  return nums;
}

function renderViewerLayersList() {
  const treeBuildings = buildingsForLayersTree();
  const hasLayers = treeBuildings.some((b) => b.shapefileLayers?.length) || unassignedLayers.length > 0;
  viewerNoLayersMsg.style.display = hasLayers ? "none" : "";
  renderSceneTree({
    container: viewerLayersListEl,
    buildings: treeBuildings,
    importedLayers: [],
    unassignedLayers,
    modelLevels,
    visibleFloorNumbers: buildingVisibleFloorNumbers(),
    selection: {
      filterRaw: "",
      activeModelLevelIndex,
      selectedBuildingIndex: selectedBuildingIndex >= 0 ? 0 : selectedBuildingIndex,
      selectedLayers: new Set(),
      unassignedTreeExpanded: transient.unassignedTreeExpanded,
      buildingsSectionExpanded: transient.buildingsSectionExpanded,
    },
    callbacks: getReadOnlySceneTreeCallbacks(),
    itemCountEl: null,
    placeholderEl: null,
    layerTypeFiltersEl: document.getElementById("layerTypeFilters"),
    layerTypeFilters,
    onToggleLayerType: (type) => {
      layerTypeFilters[type] = !layerTypeFilters[type];
      for (const b of buildings) applyLevelToShapefilesForBuilding(b);
      invalidateAndRerender();
    },
  });
}

function renderImportedLayersList() {
  importedLayersListEl.innerHTML = "";
  noImportedLayersMsg.style.display = importedLayers.length ? "none" : "";
  importedLayers.forEach((layer) => {
    const li = document.createElement("li");
    li.className = "imported-layer-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible;
    checkbox.addEventListener("change", () => {
      layer.visible = checkbox.checked;
      if (layer.type === "tileset") layer.data.show = layer.visible;
      else if (layer.type === "entities") layer.data.forEach((e) => (e.show = layer.visible));
      else if (layer.type === "datasource") layer.data.show = layer.visible;
      applyImportedLayerContexts();
      invalidateAndRerender();
    });
    const nameSpan = document.createElement("span");
    nameSpan.className = "imported-layer-name";
    nameSpan.textContent = layer.label;
    li.appendChild(checkbox);
    li.appendChild(nameSpan);
    importedLayersListEl.appendChild(li);
  });
}

function zoomToBuilding(i) {
  const b = buildings[i];
  if (!b) return;
  selectedBuildingIndex = i;
  flyToBuilding(viewer, b);
  invalidateAndRerender();
}

// -- Search (read-only navigation) --
function initSearch() {
  searchInput.addEventListener("input", handleSearchInput);
  searchInput.addEventListener("keydown", handleSearchKeydown);
  document.addEventListener("click", (e) => {
    if (transient.searchOpen && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) closeSearchDropdown();
  });
}

function getSearchableEntities() {
  const out = [];
  const time = viewer.clock.currentTime;
  for (let bi = 0; bi < buildings.length; bi++) {
    for (const layer of buildings[bi].shapefileLayers) {
      for (const entity of layer.dataSource.entities.values) {
        if (!entity.position && !entity.point && !entity.billboard) continue;
        const props = entity.properties?.getValue(time);
        if (props?.symbol_id == null && props?.name == null) continue;
        out.push({ entity, symbolId: String(props?.symbol_id ?? ""), name: String(props?.name ?? ""), buildingIndex: bi, building: buildings[bi], layer });
      }
    }
  }
  return out;
}

function handleSearchInput() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return closeSearchDropdown();
  transient.searchResults = getSearchableEntities().filter((item) => item.symbolId.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)).slice(0, 25);
  transient.searchSelectedIndex = transient.searchResults.length ? 0 : -1;
  transient.searchOpen = true;
  renderSearchDropdown();
}

function handleSearchKeydown(e) {
  if (!transient.searchOpen) return;
  if (e.key === "Escape") { e.preventDefault(); return closeSearchDropdown(); }
  if (!transient.searchResults.length) return;
  if (e.key === "ArrowDown") { e.preventDefault(); transient.searchSelectedIndex = (transient.searchSelectedIndex + 1) % transient.searchResults.length; renderSearchDropdown(); }
  if (e.key === "ArrowUp") { e.preventDefault(); transient.searchSelectedIndex = (transient.searchSelectedIndex - 1 + transient.searchResults.length) % transient.searchResults.length; renderSearchDropdown(); }
  if (e.key === "Enter") { e.preventDefault(); selectSearchResult(transient.searchResults[transient.searchSelectedIndex] ?? transient.searchResults[0]); }
}

function renderSearchDropdown() {
  if (!transient.searchOpen) { searchDropdown.style.display = "none"; return; }
  searchDropdown.innerHTML = "";
  if (!transient.searchResults.length) {
    const empty = document.createElement("div");
    empty.className = "search-dropdown-empty";
    empty.textContent = t("search.noMatches");
    searchDropdown.appendChild(empty);
  } else {
    transient.searchResults.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "search-dropdown-row" + (i === transient.searchSelectedIndex ? " selected" : "");
      row.textContent = item.symbolId || item.name || t("search.untitledPoint");
      row.addEventListener("click", () => selectSearchResult(item));
      searchDropdown.appendChild(row);
    });
  }
  searchDropdown.style.display = "";
}

function closeSearchDropdown() {
  transient.searchOpen = false;
  searchDropdown.style.display = "none";
}

function selectSearchResult(item) {
  closeSearchDropdown();
  searchInput.value = "";
  if (item.buildingIndex >= 0) {
    let li = -1;
    if (item.layer.levelKey != null) li = item.building.levels.findIndex((l) => (l.key ?? "") === item.layer.levelKey);
    selectLevel(item.buildingIndex, li);
  }
  viewer.selectedEntity = item.entity;
  viewer.flyTo(item.entity, { offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), 80) }).catch(() => {});
}

init();
