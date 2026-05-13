import {
  Viewer,
  Ion,
  IonResource,
  IonImageryProvider,
  OpenStreetMapImageryProvider,
  ArcGisMapServerImageryProvider,
  UrlTemplateImageryProvider,
  EllipsoidTerrainProvider,
  CesiumTerrainProvider,
  CustomHeightmapTerrainProvider,
  WebMercatorTilingScheme,
  createWorldTerrainAsync,
  Cartographic,
  Cartesian2,
  Cartesian3,
  Matrix4,
  BoundingSphere,
  HeadingPitchRange,
  Math as CesiumMath,
  GeoJsonDataSource,
  CustomDataSource,
  PolygonHierarchy,
  ConstantProperty,
  ConstantPositionProperty,
  JulianDate,
  ArcType,
  Color,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cesium3DTileFeature,
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
  loadTilesetFromUrl,
  loadTilesetFromFiles,
  loadTilesetFromDirectoryHandle,
  zoomToTileset,
  removeCurrentTileset,
} from "./tilesetLoader.js";
import {
  isFileSystemAccessSupported,
  getFilesFromDirectoryHandle,
  requestDirectoryPermission,
} from "./fileSystemAccess.js";
import {
  saveDirectoryHandle,
  getDirectoryHandle,
  removeDirectoryHandle,
} from "./directoryStore.js";
import { LodFilter } from "./lodFilter.js";
import { inspectLinks, decideAutoSplit, describeSplitGroups } from "./linkSplitter.js";
import { loadTilesetGlbBuffer, computePerLinkLocalAabbs, unionAabbs } from "./glbBoundsExtractor.js";
import { openImportDataModal, restoreImportedLayer } from "./importDataModal.js";
import { parseCityGml } from "./cityGmlLoader.js";
import { loadGdb } from "./gdbLoader.js";
import { openGdbImportDialog } from "./gdbImportDialog.js";
import { t, setLanguage, getLanguage, onLanguageChange, applyTranslationsToDom } from "./i18n.js";

// -- State --
let viewer;
const buildings = [];
// {
//   name, tileset, heightOffset,
//   levelBaseElevation,
//   levels: [{ name, key, floor, ceiling }],
//   activeLevelIndex,
//   shapefileLayers: [{ name, dataSource, color, levelKey, source, features }],
//   linkFilter: { property, value } | null,
//   sourceLevelGroups: Map<sourceLinkName, [{ name, key, floor }]>,
// }
// Multiple buildings may share the same tileset when split by Revit link;
// siblings are tracked via tileset._buildings (array set by the splitter).
let selectedBuildingIndex = -1;
const importedLayers = [];
// Layers that the user imported without assigning to a building. Each entry
// has the same shape as building.shapefileLayers[*] but with no parent
// building and no levelKey: { name, dataSource, color, features, source }.
const unassignedLayers = [];
let _unassignedTreeExpanded = true;
let selectedPlateauFeature = null;
let plateauOverridesEnabled = true;

const SHP_COLORS = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c","#e67e22","#16a085"];

// Per-feature color lookup for _Space layers (from GDB color2 column).
const COLOR2_LOOKUP = {
  "橙": "#FFC090",
  "トイレ": "#E5E6E6",
  "薄紅": "#FFECE6",
  "緑": "#DDF5D9",
  "濃空": "#C2E5F2",
  "濃鼠": "#C8C9CA",
  "白": "#FFFFFF",
  "薄空": "#C0E0EA",
  "薄鼠": "#A0A1A2",
  "黄": "#F5F5C0",
  "濃紅": "#F2CFC2",
  "ラチ外白": "#FFFFFF",
  "進入制限あり": "#E5E6E6",
};
const COLOR2_DEFAULT = "#808080";
const SPACE_STROKE_COLOR = "#333333";
const OPENING_FILL_COLOR = "#FF0000";

// Per-feature point icons: fixed pixel footprint plus a gentle distance taper
// so icons stay readable close-up and shrink slightly when viewed from afar.
const MARKER_ICON_PX = 32;
const MARKER_SCALE_BY_DISTANCE = new NearFarScalar(50, 1.0, 5000, 0.6);

// Styled point + label rendering for features that carry `name` / `symbol_id`
// but no `image`. The Cartesian2 / scalar instances are allocated once and
// reused across every styled entity.
const MARKER_POINT_PX = 5;
const MARKER_POINT_FILL_COLOR = "#3DB84B";
const MARKER_POINT_OUTLINE_COLOR = "#000000";
const MARKER_LABEL_FONT = "12px sans-serif";
const MARKER_LABEL_PIXEL_OFFSET = new Cartesian2(0, -10);
// Labels overlap into illegible clutter at far zoom — hide them when the
// camera is more than this many meters away. The point itself stays drawn so
// the position is still indicated.
const LABEL_MAX_DISTANCE_M = 300;
const LABEL_DISTANCE_DISPLAY_CONDITION = new DistanceDisplayCondition(0, LABEL_MAX_DISTANCE_M);

// Sit shapefile polygons 50 mm above the floor plane to avoid z-fighting with the floor mesh.
const SHAPEFILE_FLOOR_CLEARANCE_M = 0.05;
// Point markers are vertical primitives (a screen-space circle anchored at a
// 3D position) so 50 mm isn't enough — depth testing clips the bottom of the
// marker into the floor. Lift them an extra 100 mm.
const POINT_EXTRA_HEIGHT_M = 0.10;
let _shpColorIdx = 0;
let _shpPendingTarget = null; // { buildingIndex } set by the building-row + button
let _gdbBusy = false;         // serialize concurrent gdal3.js loads
let _reloadTargetIndex = -1;

const cityGmlLayers = [];
const SURFACE_COLORS = {
  RoofSurface:   Color.fromCssColorString("#c47c3e").withAlpha(0.9),
  WallSurface:   Color.fromCssColorString("#d4ccc4").withAlpha(0.9),
  GroundSurface: Color.fromCssColorString("#6b6b6b").withAlpha(0.9),
  unknown:       Color.fromCssColorString("#aaaaaa").withAlpha(0.8),
};

// -- DOM refs --
const saveSessionBtn = document.getElementById("saveSessionBtn");
const loadSessionBtn = document.getElementById("loadSessionBtn");
const sessionInput = document.getElementById("sessionInput");
const tokenInput = document.getElementById("tokenInput");
const applyTokenBtn = document.getElementById("applyTokenBtn");
const imagerySelect = document.getElementById("imagerySelect");
const urlInput = document.getElementById("urlInput");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const loadFileBtn = document.getElementById("loadFileBtn");
const fileInput = document.getElementById("fileInput");
const fileStatus = document.getElementById("fileStatus");
const terrainSelect = document.getElementById("terrainSelect");
const buildingListEl = document.getElementById("buildingList");
const noBuildingsMsg = document.getElementById("noBuildingsMsg");
const buildingDetailEl = document.getElementById("buildingDetail");
const buildingDetailLabel = document.getElementById("buildingDetailLabel");
const reloadTilesetBanner = document.getElementById("reloadTilesetBanner");
const reloadTilesetBtn = document.getElementById("reloadTilesetBtn");
const zoomExtentsBtn = document.getElementById("zoomExtentsBtn");
const removeAllBtn = document.getElementById("removeAllBtn");
const lodFilterToggle = document.getElementById("lodFilterToggle");
const lodFilterStatus = document.getElementById("lodFilterStatus");
const levelNameInput = document.getElementById("levelNameInput");
const levelCeilingInput = document.getElementById("levelCeilingInput");
const addLevelBtn = document.getElementById("addLevelBtn");
const levelBaseInput = document.getElementById("levelBaseInput");
const levelListEl = document.getElementById("levelList");
const aliasesInput = document.getElementById("aliasesInput");
const shpInput = document.getElementById("shpInput");
const gdbInput = document.getElementById("gdbInput");
const gdbDirInput = document.getElementById("gdbDirInput");
const loadGdbZipBtn = document.getElementById("loadGdbZipBtn");
const loadGdbFolderBtn = document.getElementById("loadGdbFolderBtn");
const reassignGdbBtn = document.getElementById("reassignGdbBtn");
const floatingMenu = document.getElementById("floatingMenu");
const heightSlider = document.getElementById("heightSlider");
const heightOffsetInput = document.getElementById("heightOffset");
const importDataBtn = document.getElementById("importDataBtn");
const importedLayersListEl = document.getElementById("importedLayersList");
const noImportedLayersMsg = document.getElementById("noImportedLayersMsg");
const noSelectionMsgEl = document.getElementById("noSelectionMsg");
const loadCityGmlBtn = document.getElementById("loadCityGmlBtn");
const cityGmlInput = document.getElementById("cityGmlInput");
const cityGmlListEl = document.getElementById("cityGmlList");
const noCityGmlMsg = document.getElementById("noCityGmlMsg");
const splitConfirmDialog = document.getElementById("splitConfirmDialog");
const splitGroupCountEl = document.getElementById("splitGroupCount");
const splitGroupListEl = document.getElementById("splitGroupList");
const buildingOverlapToggle = document.getElementById("buildingOverlapToggle");
const buildingOverlapToggleLabel = document.getElementById("buildingOverlapToggleLabel");
const plateauToolsPanel = document.getElementById("plateauToolsPanel");
const noPlateauSelectionMsg = document.getElementById("noPlateauSelectionMsg");
const plateauSelectedFeatureEl = document.getElementById("plateauSelectedFeature");
const plateauSelectedLabel = document.getElementById("plateauSelectedLabel");
const plateauGhostBtn = document.getElementById("plateauGhostBtn");
const plateauHideBtn = document.getElementById("plateauHideBtn");
const plateauVisibleBtn = document.getElementById("plateauVisibleBtn");
const plateauClearOverridesBtn = document.getElementById("plateauClearOverridesBtn");
const plateauOverrideListEl = document.getElementById("plateauOverrideList");
const noPlateauOverridesMsg = document.getElementById("noPlateauOverridesMsg");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingOverlayMessage = document.getElementById("loadingOverlayMessage");
const loadingOverlaySub = document.getElementById("loadingOverlaySubmessage");

let worldTerrainProvider = null;
const PLATEAU_TERRAIN_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODVhMmQ5OS1hOWZjLTQ3YmYtODlmNi1lNWUwY2MwOGUxYTMiLCJpZCI6MTQ5ODk3LCJpYXQiOjE2ODc5MzQ3NDN9.OG0mc3i7ZxGwHQjlMv3TRjiOvKWpzxglxmJRaUIykTY";
let plateauTerrainProvider = null;
const lodFilter = new LodFilter();

// -- Initialize --
async function init() {
  const savedToken = localStorage.getItem("cesiumIonToken") || "";
  tokenInput.value = savedToken;
  if (savedToken) Ion.defaultAccessToken = savedToken;

  viewer = new Viewer("cesiumContainer", {
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    imageryProvider: new OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
    }),
  });

  if (savedToken) {
    try {
      worldTerrainProvider = await createWorldTerrainAsync();
    } catch (e) {
      console.warn("Failed to load Cesium World Terrain:", e);
    }
  }

  try {
    const plateauResource = await IonResource.fromAssetId(3258112, {
      accessToken: PLATEAU_TERRAIN_TOKEN,
    });
    plateauTerrainProvider = await CesiumTerrainProvider.fromUrl(plateauResource);
  } catch (e) {
    console.warn("Failed to load PLATEAU terrain:", e);
  }
  switchTerrain();

  saveSessionBtn.addEventListener("click", saveSession);
  loadSessionBtn.addEventListener("click", () => sessionInput.click());
  sessionInput.addEventListener("change", handleLoadSession);
  reloadTilesetBtn.addEventListener("click", handleReloadTilesetClick);
  applyTokenBtn.addEventListener("click", applyToken);
  imagerySelect.addEventListener("change", switchImagery);
  terrainSelect.addEventListener("change", switchTerrain);
  loadUrlBtn.addEventListener("click", handleLoadUrl);
  loadFileBtn.addEventListener("click", () => {
    if (isFileSystemAccessSupported()) {
      handleDirectoryPick();
    } else {
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", handleFileSelect);
  lodFilterToggle.addEventListener("change", handleLodFilterToggle);
  zoomExtentsBtn.addEventListener("click", () => {
    if (selectedBuildingIndex !== -1) zoomToBuilding(selectedBuildingIndex);
  });
  removeAllBtn.addEventListener("click", handleRemoveAll);
  addLevelBtn.addEventListener("click", handleAddLevel);
  levelBaseInput.addEventListener("change", () => {
    const b = buildings[selectedBuildingIndex];
    if (!b) return;
    b.levelBaseElevation = parseFloat(levelBaseInput.value) || 0;
    applyShapefileLayerHeights(b);
    if (b.activeLevelIndex !== -1) applyActiveLevelForBuilding(b);
  });
  aliasesInput.addEventListener("change", () => {
    const b = buildings[selectedBuildingIndex];
    if (!b) return;
    b.aliases = parseAliases(aliasesInput.value);
  });
  shpInput.addEventListener("change", handleShpSelect);
  gdbInput.addEventListener("change", handleGdbZipSelect);
  gdbDirInput.addEventListener("change", handleGdbDirSelect);
  loadGdbZipBtn.addEventListener("click", () => {
    if (_gdbBusy) return;
    gdbInput.click();
  });
  loadGdbFolderBtn.addEventListener("click", () => {
    if (_gdbBusy) return;
    gdbDirInput.click();
  });
  reassignGdbBtn.addEventListener("click", () => {
    if (_gdbBusy) return;
    openGdbReassignDialog();
  });
  loadCityGmlBtn.addEventListener("click", () => cityGmlInput.click());
  cityGmlInput.addEventListener("change", handleCityGmlSelect);
  document.addEventListener("click", hideFloatingMenu);
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideFloatingMenu(); });
  heightSlider.addEventListener("input", handleHeightChange);
  heightOffsetInput.addEventListener("change", handleHeightChange);
  buildingOverlapToggle.addEventListener("change", handleBuildingOverlapToggle);
  plateauGhostBtn.addEventListener("click", () => setSelectedPlateauOverride("ghost"));
  plateauHideBtn.addEventListener("click", () => setSelectedPlateauOverride("hidden"));
  plateauVisibleBtn.addEventListener("click", () => setSelectedPlateauOverride(null));
  plateauClearOverridesBtn.addEventListener("click", clearPlateauOverrides);
  importDataBtn.addEventListener("click", () =>
    openImportDataModal(viewer, loadTilesetFromUrl, (layer) => {
      importedLayers.push(layer);
      initializePlateauLayer(layer);
      renderImportedLayersList();
      renderBuildingDetail();
    }, {
      getPreferredImportPosition,
    })
  );

  renderBuildingList();
  renderImportedLayersList();
  initSectionCollapse();
  initPanelToggles();
  initThemeToggle();
  initLanguageToggle();
  initHighlight();
}

function initSectionCollapse() {
  document.querySelectorAll(".section-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.closest(".panel-section").classList.toggle("collapsed");
    });
  });
}

function initPanelToggles() {
  document.getElementById("leftPanelToggle").addEventListener("click", () => {
    document.body.classList.toggle("left-collapsed");
  });
  document.getElementById("rightPanelToggle").addEventListener("click", () => {
    document.body.classList.toggle("right-collapsed");
  });
}

// -- Theme toggle --
function initThemeToggle() {
  const saved = localStorage.getItem("theme");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");

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

// -- Language toggle --
function initLanguageToggle() {
  document.documentElement.setAttribute("data-language", getLanguage());
  applyTranslationsToDom(document.body);
  updateLanguageToggleLabel();
  document.getElementById("languageToggle").addEventListener("click", () => {
    setLanguage(getLanguage() === "ja" ? "en" : "ja");
    updateLanguageToggleLabel();
  });
  onLanguageChange(() => {
    renderBuildingList();
    renderBuildingDetail();
    renderImportedLayersList();
    renderLevelList();
    renderCityGmlList();
    updateLodFilterStatus();
  });
}

function updateLanguageToggleLabel() {
  document.getElementById("languageToggleLabel").textContent =
    getLanguage() === "ja" ? "A" : "あ";
}

function getPreferredImportPosition() {
  const selectedTileset = buildings[selectedBuildingIndex]?.tileset;
  const firstBuildingTileset = buildings.find(b => b.tileset)?.tileset;
  const firstImportedTileset = importedLayers.find(l => l.type === "tileset" && l.data?.boundingSphere)?.data;
  const tileset = selectedTileset || firstBuildingTileset || firstImportedTileset;
  if (!tileset?.boundingSphere?.center) return null;

  const cartographic = Cartographic.fromCartesian(tileset.boundingSphere.center);
  return {
    lat: CesiumMath.toDegrees(cartographic.latitude),
    lng: CesiumMath.toDegrees(cartographic.longitude),
    source: tileset === selectedTileset ? "selectedModel" : "model",
  };
}

// -- Hover highlight --
const HIGHLIGHT_COLOR = Color.fromCssColorString("#BB86FC");

function initHighlight() {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  let prevTileFeature = null;
  let prevTileColor = new Color();
  let prevEntity = null;

  handler.setInputAction((click) => {
    // Restore previous highlight
    if (prevTileFeature) {
      prevTileFeature.color = prevTileColor.clone();
      prevTileFeature = null;
    }
    if (prevEntity) {
      _restoreEntityHighlight(prevEntity);
      prevEntity = null;
    }

    const picked = pickThroughGhosts(click.position);

    const plateauLayer = findPlateauLayerForFeature(picked);
    if (plateauLayer) {
      selectPlateauFeature(plateauLayer, picked);
    } else {
      selectedPlateauFeature = null;
      renderBuildingDetail();
    }

    if (picked instanceof Cesium3DTileFeature) {
      prevTileFeature = picked;
      Color.clone(picked.color, prevTileColor);
      picked.color = HIGHLIGHT_COLOR.withAlpha(0.85);
    } else if (picked?.id?.polygon) {
      prevEntity = picked.id;
      _applyEntityHighlight(prevEntity);
    }
  }, ScreenSpaceEventType.LEFT_CLICK);
}

function _applyEntityHighlight(entity) {
  const poly = entity.polygon;
  entity._hlMat    = poly.material;
  entity._hlOut    = poly.outline;
  entity._hlOutCol = poly.outlineColor;
  entity._hlOutW   = poly.outlineWidth;

  poly.material     = HIGHLIGHT_COLOR.withAlpha(0.45);
  poly.outline      = true;
  poly.outlineColor = HIGHLIGHT_COLOR;
  poly.outlineWidth = 2;
}

function _restoreEntityHighlight(entity) {
  if (!("_hlMat" in entity)) return;
  const poly = entity.polygon;
  poly.material     = entity._hlMat;
  poly.outline      = entity._hlOut;
  poly.outlineColor = entity._hlOutCol;
  poly.outlineWidth = entity._hlOutW;
  delete entity._hlMat;
}

// -- Loading indicators --
function setButtonLoading(btn, isLoading, loadingLabel) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    if (btn.dataset._origHtml == null) btn.dataset._origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span>${loadingLabel}</span>`;
  } else {
    btn.disabled = false;
    if (btn.dataset._origHtml != null) {
      btn.innerHTML = btn.dataset._origHtml;
      delete btn.dataset._origHtml;
    }
  }
}

function showLoadingOverlay(message, submessage = "") {
  loadingOverlayMessage.textContent = message;
  loadingOverlaySub.textContent = submessage;
  loadingOverlay.hidden = false;
}

function updateLoadingOverlay(submessage) {
  loadingOverlaySub.textContent = submessage;
}

function hideLoadingOverlay() {
  loadingOverlay.hidden = true;
}

// -- Token --
async function applyToken() {
  const token = tokenInput.value.trim();
  if (!token) return;
  Ion.defaultAccessToken = token;
  localStorage.setItem("cesiumIonToken", token);
  try {
    worldTerrainProvider = await createWorldTerrainAsync();
  } catch (e) {
    console.warn("Failed to load terrain with new token:", e);
  }
  switchImagery();
  switchTerrain();
}

// -- Imagery --
async function switchImagery() {
  viewer.imageryLayers.removeAll();
  const choice = imagerySelect.value;
  switch (choice) {
    case "osm":
      viewer.imageryLayers.addImageryProvider(
        new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
      );
      break;
    case "ion-bing-aerial":
      try {
        viewer.imageryLayers.addImageryProvider(await IonImageryProvider.fromAssetId(2));
      } catch (e) {
        console.warn("Failed to load Bing Aerial imagery:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "ion-sentinel":
      try {
        viewer.imageryLayers.addImageryProvider(await IonImageryProvider.fromAssetId(3954));
      } catch (e) {
        console.warn("Failed to load Sentinel-2 imagery:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "esri-street":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer"
          )
        );
      } catch (e) {
        console.warn("Failed to load Esri World Street Map:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "esri-topo":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer"
          )
        );
      } catch (e) {
        console.warn("Failed to load Esri World Topo Map:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "esri-imagery":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
          )
        );
      } catch (e) {
        console.warn("Failed to load Esri World Imagery:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "esri-light-gray":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer"
          )
        );
      } catch (e) {
        console.warn("Failed to load Esri Light Gray Canvas:", e);
        viewer.imageryLayers.addImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
      }
      break;
    case "carto-positron":
      viewer.imageryLayers.addImageryProvider(
        new UrlTemplateImageryProvider({
          url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          subdomains: ["a", "b", "c", "d"],
          maximumLevel: 19,
          credit: "© OpenStreetMap contributors © CARTO",
        })
      );
      break;
  }
}

// -- Terrain --
function switchTerrain() {
  const choice = terrainSelect.value;
  switch (choice) {
    case "ellipsoid":
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      break;
    case "cesium-world":
      viewer.terrainProvider = worldTerrainProvider ?? new EllipsoidTerrainProvider();
      break;
    case "gsi-dem5a":
    case "gsi-dem5b":
      viewer.terrainProvider = createGsiTerrainProvider(choice);
      break;
    case "plateau":
      viewer.terrainProvider = plateauTerrainProvider ?? new EllipsoidTerrainProvider();
      break;
  }
}

function createGsiTerrainProvider(type) {
  const urlTemplate =
    type === "gsi-dem5a"
      ? "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png"
      : "https://cyberjapandata.gsi.go.jp/xyz/dem5b_png/{z}/{x}/{y}.png";
  return new CustomHeightmapTerrainProvider({
    tilingScheme: new WebMercatorTilingScheme(),
    width: 256,
    height: 256,
    callback: async (x, y, level) => {
      const url = urlTemplate.replace("{z}", level).replace("{x}", x).replace("{y}", y);
      try {
        return decodeGsiHeightmap(await loadImage(url));
      } catch {
        return new Float32Array(256 * 256);
      }
    },
  });
}

function decodeGsiHeightmap(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const heights = new Float32Array(img.width * img.height);
  for (let i = 0; i < heights.length; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (r === 128 && g === 0 && b === 0) {
      heights[i] = 0;
    } else {
      const raw = r * 65536 + g * 256 + b;
      heights[i] = (raw < 8388608 ? raw : raw - 16777216) / 100;
    }
  }
  return heights;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// -- PLATEAU manual feature overrides --
const PLATEAU_GHOST_COLOR = Color.fromCssColorString("rgba(255, 255, 255, 0.18)");
const PLATEAU_ID_PROPERTIES = [
  "buildingIDAttribute_uro:buildingID",
  "uro:buildingID",
  "gml_id",
  "id",
  "featureId",
  "featureID",
  "fid",
];
const PLATEAU_LABEL_PROPERTIES = [
  ...PLATEAU_ID_PROPERTIES,
  "name",
  "type",
  "class",
  "function",
  "measuredHeight",
  "_lod",
];

function isPlateauLayer(layer) {
  return layer?.type === "tileset" &&
    ["plateau-buildings", "plateau-3dtiles"].includes(layer.sourceConfig?.kind);
}

function getPlateauLayers() {
  return importedLayers.filter(isPlateauLayer);
}

function hasPlateauLayers() {
  return getPlateauLayers().length > 0;
}

function initializePlateauLayer(layer) {
  if (!isPlateauLayer(layer) || !layer.data) return;
  if (!(layer.plateauOverrides instanceof Map)) {
    layer.plateauOverrides = deserializePlateauOverrides(layer.plateauOverrides);
  }
  if (!layer._plateauOriginalStyleCaptured) {
    layer._plateauOriginalStyle = layer.data.style;
    layer._plateauOriginalStyleCaptured = true;
  }
}

function deserializePlateauOverrides(saved = []) {
  const map = new Map();
  if (!Array.isArray(saved)) return map;
  for (const entry of saved) {
    if (!entry?.featureKey || !["ghost", "hidden"].includes(entry.mode)) continue;
    map.set(entry.featureKey, {
      mode: entry.mode,
      label: entry.label || entry.featureKey,
    });
  }
  return map;
}

function serializePlateauOverrides(layer) {
  initializePlateauLayer(layer);
  return [...(layer.plateauOverrides ?? new Map()).entries()].map(([featureKey, entry]) => ({
    featureKey,
    mode: entry.mode,
    label: entry.label || featureKey,
  }));
}

function getFeatureTileset(feature) {
  if (!feature) return null;
  if (feature.tileset) return feature.tileset;
  if (feature.content?.tileset) return feature.content.tileset;
  if (feature.primitive?.content?.tileset) return feature.primitive.content.tileset;
  if (feature.primitive?._content?.tileset) return feature.primitive._content.tileset;
  return feature.primitive?.root ? feature.primitive : null;
}

function findPlateauLayerForFeature(feature) {
  if (!feature || typeof feature.getProperty !== "function") return null;
  const tileset = getFeatureTileset(feature);
  if (!tileset) return null;
  return getPlateauLayers().find((layer) => layer.data === tileset) || null;
}

function pickThroughGhosts(position) {
  const list = viewer.scene.drillPick(position) ?? [];
  for (const p of list) {
    const layer = findPlateauLayerForFeature(p);
    if (layer && getPlateauOverride(layer, p)?.mode === "ghost") continue;
    return p;
  }
  return list[0];
}

function getFeatureProperty(feature, propertyName) {
  try {
    const value = feature.getProperty(propertyName);
    if (value != null && value !== "") return String(value);
  } catch {
    return null;
  }
  return null;
}

function getPlateauFeatureKey(feature) {
  for (const propertyName of PLATEAU_ID_PROPERTIES) {
    const value = getFeatureProperty(feature, propertyName);
    if (value) return `${propertyName}:${value}`;
  }

  const contentUrl = feature.content?.url
    || feature.primitive?.content?.url
    || feature.primitive?._content?.url
    || "";
  const featureId = feature.featureId ?? feature._batchId;
  if (contentUrl || featureId != null) {
    return `feature:${contentUrl}:${featureId ?? "unknown"}`;
  }

  return null;
}

function getPlateauFeatureLabel(feature, featureKey) {
  for (const propertyName of PLATEAU_LABEL_PROPERTIES) {
    const value = getFeatureProperty(feature, propertyName);
    if (value) return value;
  }
  return featureKey;
}

function getPlateauOverride(layer, feature) {
  const featureKey = getPlateauFeatureKey(feature);
  return featureKey ? layer.plateauOverrides?.get(featureKey) : null;
}

function applyPlateauLayerStyle(layer) {
  if (!isPlateauLayer(layer) || !layer.data) return;
  if (!(layer.plateauOverrides instanceof Map)) {
    layer.plateauOverrides = deserializePlateauOverrides(layer.plateauOverrides);
  }
  if (!layer._plateauOriginalStyleCaptured) {
    layer._plateauOriginalStyle = layer.data.style;
    layer._plateauOriginalStyleCaptured = true;
  }

  const hasOverrides = layer.plateauOverrides.size > 0;
  if (!plateauOverridesEnabled || !hasOverrides) {
    layer.data.style = layer._plateauOriginalStyle;
    layer.data.makeStyleDirty();
    layer._plateauOverrideStyleApplied = false;
    return;
  }

  const style = new Cesium3DTileStyle();
  style.show = {
    evaluate: (feature) => getPlateauOverride(layer, feature)?.mode !== "hidden",
  };
  style.color = {
    evaluateColor: (feature, result) => {
      const mode = getPlateauOverride(layer, feature)?.mode;
      if (mode === "ghost") return Color.clone(PLATEAU_GHOST_COLOR, result);
      return Color.clone(Color.WHITE, result);
    },
  };
  layer.data.style = style;
  layer.data.makeStyleDirty();
  layer._plateauOverrideStyleApplied = true;
}

function refreshAllPlateauOverrideStyles() {
  for (const layer of getPlateauLayers()) {
    initializePlateauLayer(layer);
    applyPlateauLayerStyle(layer);
  }
}

function getPlateauOverrideCount() {
  let count = 0;
  for (const layer of getPlateauLayers()) {
    initializePlateauLayer(layer);
    count += layer.plateauOverrides.size;
  }
  return count;
}

function shouldShowPlateauToolsPanel() {
  return hasPlateauLayers() && (!!selectedPlateauFeature || getPlateauOverrideCount() > 0);
}

function selectPlateauFeature(layer, feature) {
  initializePlateauLayer(layer);
  const featureKey = getPlateauFeatureKey(feature);
  if (!featureKey) return;
  selectedPlateauFeature = {
    layerId: layer.id,
    layer,
    featureKey,
    label: getPlateauFeatureLabel(feature, featureKey),
  };
  renderBuildingDetail();
}

function setSelectedPlateauOverride(mode) {
  const selected = selectedPlateauFeature;
  if (!selected) return;
  const layer = importedLayers.find((l) => l.id === selected.layerId) || selected.layer;
  if (!isPlateauLayer(layer)) return;
  initializePlateauLayer(layer);

  if (mode === null) {
    layer.plateauOverrides.delete(selected.featureKey);
  } else {
    layer.plateauOverrides.set(selected.featureKey, {
      mode,
      label: selected.label || selected.featureKey,
    });
  }

  applyPlateauLayerStyle(layer);
  renderPlateauFeatureControls();
}

function clearPlateauOverrides() {
  for (const layer of getPlateauLayers()) {
    initializePlateauLayer(layer);
    layer.plateauOverrides.clear();
    applyPlateauLayerStyle(layer);
  }
  selectedPlateauFeature = null;
  renderBuildingDetail();
}

function restorePlateauOverride(layerId, featureKey) {
  const layer = importedLayers.find((l) => l.id === layerId);
  if (!isPlateauLayer(layer)) return;
  initializePlateauLayer(layer);
  layer.plateauOverrides.delete(featureKey);
  applyPlateauLayerStyle(layer);
  if (selectedPlateauFeature?.layerId === layerId && selectedPlateauFeature.featureKey === featureKey) {
    selectedPlateauFeature = null;
  }
  renderBuildingDetail();
}

function updateBuildingOverlapToggle() {
  buildingOverlapToggleLabel.style.display = hasPlateauLayers() ? "" : "none";
  buildingOverlapToggle.checked = plateauOverridesEnabled;
}

function handleBuildingOverlapToggle() {
  plateauOverridesEnabled = buildingOverlapToggle.checked;
  refreshAllPlateauOverrideStyles();
  renderPlateauFeatureControls();
}

function renderPlateauFeatureControls() {
  updateBuildingOverlapToggle();

  const showTools = shouldShowPlateauToolsPanel();
  plateauToolsPanel.style.display = showTools ? "" : "none";
  if (!showTools) return;

  const selected = selectedPlateauFeature;
  noPlateauSelectionMsg.style.display = selected ? "none" : "block";
  plateauSelectedFeatureEl.style.display = selected ? "" : "none";

  if (selected) {
    const layer = importedLayers.find((l) => l.id === selected.layerId) || selected.layer;
    const mode = layer?.plateauOverrides?.get(selected.featureKey)?.mode ?? null;
    plateauSelectedLabel.textContent = selected.label || selected.featureKey;
    plateauSelectedLabel.title = selected.featureKey;
    plateauGhostBtn.classList.toggle("active", mode === "ghost");
    plateauHideBtn.classList.toggle("active", mode === "hidden");
    plateauVisibleBtn.classList.toggle("active", mode === null);
  }

  plateauOverrideListEl.innerHTML = "";
  let count = 0;
  for (const layer of getPlateauLayers()) {
    initializePlateauLayer(layer);
    for (const [featureKey, entry] of layer.plateauOverrides) {
      count++;
      const li = document.createElement("li");
      li.className = "plateau-override-item";

      const nameSpan = document.createElement("span");
      nameSpan.className = "plateau-override-name";
      nameSpan.textContent = entry.label || featureKey;
      nameSpan.title = `${layer.label}: ${featureKey}`;

      const modeSpan = document.createElement("span");
      modeSpan.className = "plateau-override-mode";
      modeSpan.textContent = t(entry.mode === "hidden" ? "plateau.mode.hidden" : "plateau.mode.ghost");

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "plateau-override-restore-btn";
      restoreBtn.textContent = t("plateau.visible");
      restoreBtn.addEventListener("click", () => restorePlateauOverride(layer.id, featureKey));

      li.appendChild(nameSpan);
      li.appendChild(modeSpan);
      li.appendChild(restoreBtn);
      plateauOverrideListEl.appendChild(li);
    }
  }

  noPlateauOverridesMsg.style.display = count === 0 ? "block" : "none";
  plateauClearOverridesBtn.disabled = count === 0;
}

// -- LOD filter --
function handleLodFilterToggle() {
  lodFilter.toggle(lodFilterToggle.checked);
  updateLodFilterStatus();
}

function updateLodFilterStatus() {
  if (!lodFilterToggle.checked || buildings.length === 0) {
    lodFilterStatus.textContent = "";
    return;
  }
  const s = lodFilter.stats();
  lodFilterStatus.textContent = t("models.lodStatus", s);
}

// -- Load from URL --
async function handleLoadUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  setButtonLoading(loadUrlBtn, true, t("models.loadUrl.loading"));
  try {
    const [levelsData, tileset] = await Promise.all([
      detectLevelsFromUrl(url),
      loadTilesetFromUrl(viewer, url),
    ]);
    const name = url.split("/").filter(Boolean).pop() || url;
    await addBuilding(tileset, name, levelsData, url);
  } catch (e) {
    alert(t("alert.failedLoad", { message: e.message }));
  } finally {
    setButtonLoading(loadUrlBtn, false);
  }
}

// -- Load from directory picker (Chrome File System Access API) --
async function handleDirectoryPick() {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const dirId = crypto.randomUUID();
    await saveDirectoryHandle(dirId, dirHandle);

    setButtonLoading(loadFileBtn, true, t("models.browse.loading"));
    try {
      const files = await getFilesFromDirectoryHandle(dirHandle);
      const [levelsData, tileset] = await Promise.all([
        detectLevelsFromFiles(files),
        loadTilesetFromFiles(viewer, files, fileStatus),
      ]);
      const name = dirHandle.name || "Local tileset";
      await addBuilding(tileset, name, levelsData, null, dirId, dirHandle.name);
    } catch (e) {
      fileStatus.textContent = "";
      alert(t("alert.failedLoad", { message: e.message }));
    } finally {
      setButtonLoading(loadFileBtn, false);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn("showDirectoryPicker error:", e);
    }
  }
}

async function handleReloadTilesetClick() {
  const target = buildings[selectedBuildingIndex];
  if (!target) return;

  if (target.directoryHandleId) {
    try {
      const handle = await getDirectoryHandle(target.directoryHandleId);
      if (handle) {
        const perm = await requestDirectoryPermission(handle);
        if (perm === 'granted') {
          await attachTilesetToBuilding(selectedBuildingIndex, null, handle);
          return;
        }
      }
    } catch (e) {
      console.warn("Could not request permission for stored handle:", e);
    }
  }

  if (isFileSystemAccessSupported()) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const dirId = crypto.randomUUID();
      await saveDirectoryHandle(dirId, dirHandle);
      await attachTilesetToBuilding(selectedBuildingIndex, null, dirHandle, dirId, dirHandle.name);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn("showDirectoryPicker failed, falling back to file input:", e);
    }
  }

  _reloadTargetIndex = selectedBuildingIndex;
  fileInput.click();
}

// -- Load from file picker --
async function handleFileSelect(e) {
  const files = e.target.files;
  if (!files.length) {
    fileInput.value = "";
    return;
  }

  if (_reloadTargetIndex !== -1) {
    const targetIdx = _reloadTargetIndex;
    _reloadTargetIndex = -1;
    await attachTilesetToBuilding(targetIdx, files);
    fileInput.value = "";
    return;
  }

  setButtonLoading(loadFileBtn, true, t("models.browse.loading"));
  try {
    const [levelsData, tileset] = await Promise.all([
      detectLevelsFromFiles(files),
      loadTilesetFromFiles(viewer, files, fileStatus),
    ]);
    const name = files[0].webkitRelativePath.split("/")[0] || "Local tileset";
    await addBuilding(tileset, name, levelsData, null);
  } catch (e) {
    fileStatus.textContent = "";
    alert(t("alert.failedLoad", { message: e.message }));
  } finally {
    setButtonLoading(loadFileBtn, false);
    fileInput.value = "";
  }
}

// -- Building management --
function computeLevelBaseElevation(tileset, levelsData) {
  const cart = Cartographic.fromCartesian(tileset.boundingSphere.center);
  // When levels.json is available, derive H_origin = WGS84 height of local Z=0 by
  // subtracting the local Z of the bounding sphere centre from cart.height.
  // The local Z axis of a properly-georeferenced tileset is aligned with geodetic "up",
  // so 1 unit in local Z ≈ 1 m of WGS84 height.
  // Without levels.json fall back to the old (rougher) estimate: center_height - radius.
  if (levelsData) {
    const nonUnassigned = levelsData.levels.filter(l => l.levelKey !== "unassigned");
    const zBounds = nonUnassigned.filter(l =>
      Number.isFinite(Number(l.minZMeters)) && Number.isFinite(Number(l.maxZMeters))
    );
    if (zBounds.length > 0) {
      const allMinZ = Math.min(...zBounds.map(l => Number(l.minZMeters)));
      const allMaxZ = Math.max(...zBounds.map(l => Number(l.maxZMeters)));
      const zCenter = (allMinZ + allMaxZ) / 2;
      return Math.round((cart.height - zCenter) * 10) / 10;
    }
  }
  return Math.round((cart.height - tileset.boundingSphere.radius) * 10) / 10;
}

// Parse the comma-separated aliases input into a clean string[]: trim each,
// drop empties, preserve order, de-duplicate.
function parseAliases(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const part of String(text).split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function makeBuildingObject({ name, tileset, sourceUrl, levelBaseElevation, linkFilter = null, sourceLevelGroups = null, directoryHandleId = null, directoryFolderName = null, aliases = [] }) {
  return {
    name,
    tileset,
    sourceUrl,
    heightOffset: 0,
    levelBaseElevation,
    levels: [],
    activeLevelIndex: -1,
    shapefileLayers: [],
    linkFilter,
    sourceLevelGroups,
    _tilesetMissing: false,
    directoryHandleId,
    _directoryFolderName: directoryFolderName,
    aliases,
  };
}

function normalizeLevelRecords(levels = []) {
  return (levels ?? [])
    .filter(l => (l.levelKey ?? l.key) !== "unassigned")
    .map(l => ({
      name: l.levelName ?? l.name,
      key: l.levelKey ?? l.key ?? null,
      floor: Number(l.levelElevationMeters ?? l.floor ?? 0),
      minZMeters: Number.isFinite(Number(l.minZMeters)) ? Number(l.minZMeters) : null,
      maxZMeters: Number.isFinite(Number(l.maxZMeters)) ? Number(l.maxZMeters) : null,
      elementCount: Number.isFinite(Number(l.elementCount)) ? Number(l.elementCount) : null,
    }))
    .filter(l => l.name && Number.isFinite(l.floor))
    .sort((a, b) => a.floor - b.floor);
}

function recordsToLevelsData(levels) {
  return {
    levels: normalizeLevelRecords(levels).map(l => ({
      levelName: l.name,
      levelKey: l.key,
      levelElevationMeters: l.floor,
      minZMeters: l.minZMeters,
      maxZMeters: l.maxZMeters,
      elementCount: l.elementCount,
    })),
  };
}

function sourceLevelGroupsFromInspection(inspection) {
  const groups = new Map();
  if (!inspection?.groups) return groups;
  for (const [source, info] of inspection.groups) {
    const levels = normalizeLevelRecords(info.levels ?? []);
    if (levels.length > 0) groups.set(String(source), levels);
  }
  return groups;
}

function serializeSourceLevelGroups(groups) {
  if (!groups || groups.size === 0) return [];
  return [...groups.entries()].map(([source, levels]) => ({
    source,
    levels: normalizeLevelRecords(levels),
  }));
}

function deserializeSourceLevelGroups(data) {
  const groups = new Map();
  for (const entry of data ?? []) {
    const source = entry?.source == null ? "" : String(entry.source);
    const levels = normalizeLevelRecords(entry?.levels ?? []);
    if (levels.length > 0) groups.set(source, levels);
  }
  return groups;
}

/**
 * Bind a single tileLoad listener per tileset that applies the combined
 * link + level filter for all sibling buildings sharing this tileset.
 */
function bindTilesetTileLoad(tileset) {
  if (!tileset || tileset._linkAwareTileLoadBound) return;
  tileset._linkAwareTileLoadBound = true;
  tileset.tileLoad.addEventListener(tile => {
    applyFiltersToContent(tileset, tile.content);
  });
}

async function addBuilding(tileset, name, levelsData, sourceUrl = null, directoryHandleId = null, directoryFolderName = null) {
  lodFilter.addTileset(tileset);
  const levelBaseElevation = computeLevelBaseElevation(tileset, levelsData);
  tileset._directoryHandleId = directoryHandleId;
  tileset._directoryFolderName = directoryFolderName;

  // Detect Revit link split before showing the building in the list
  let inspection = null;
  let split = null;
  let sourceLevelGroups = new Map();
  try {
    inspection = await inspectLinks(tileset);
    sourceLevelGroups = sourceLevelGroupsFromInspection(inspection);
    tileset._sourceLevelGroups = sourceLevelGroups;
    split = decideAutoSplit(inspection);
    if (split) {
      const choice = await promptSplitConfirm(split, name);
      if (choice !== "split") split = null;
    }
  } catch (e) {
    console.warn("Link inspection failed:", e);
  }

  let createdBuildings;
  if (split) {
    const groupEntries = describeSplitGroups(split, name);
    const siblings = [];
    for (const entry of groupEntries) {
      const sourceLevels = normalizeLevelRecords(entry.levels ?? []);
      // Filter levels.json to only those with elements in this link group.
      const filteredLevelsData = levelsData
        ? { ...levelsData, levels: levelsData.levels.filter(l => entry.levelNames.has(l.levelName)) }
        : null;
      const sourceLevelsData = sourceLevels.length ? recordsToLevelsData(sourceLevels) : null;
      const levelsForBase = sourceLevelsData ?? filteredLevelsData;
      const siblingLevelBaseElevation =
        levelsForBase && levelsForBase.levels.length
          ? computeLevelBaseElevation(tileset, levelsForBase)
          : levelBaseElevation;
      const b = makeBuildingObject({
        name: entry.displayName,
        tileset,
        sourceUrl,
        levelBaseElevation: siblingLevelBaseElevation,
        linkFilter: { property: split.groupBy, value: entry.value },
        sourceLevelGroups,
        directoryHandleId,
        directoryFolderName,
      });
      if (sourceLevelsData) populateLevelsForBuilding(b, sourceLevelsData);
      else if (filteredLevelsData) populateLevelsForBuilding(b, filteredLevelsData);
      siblings.push(b);
      buildings.push(b);
    }
    tileset._buildings = siblings;
    createdBuildings = siblings;
  } else {
    const b = makeBuildingObject({ name, tileset, sourceUrl, levelBaseElevation, sourceLevelGroups, directoryHandleId, directoryFolderName });
    if (levelsData) populateLevelsForBuilding(b, levelsData);
    buildings.push(b);
    tileset._buildings = [b];
    createdBuildings = [b];
  }

  bindTilesetTileLoad(tileset);
  applyFiltersForTileset(tileset);

  selectedBuildingIndex = buildings.indexOf(createdBuildings[0]);
  renderBuildingList();
  renderBuildingDetail();

  // Compute per-link bounding spheres in the background; until they're ready,
  // zoomToBuilding falls back to tileset.boundingSphere.
  computePerSiblingBoundingSpheres(tileset, sourceUrl);
}

async function computePerSiblingBoundingSpheres(tileset, sourceUrl) {
  try {
    const buf = await loadTilesetGlbBuffer(tileset, sourceUrl);
    if (!buf) return;
    const aabbs = computePerLinkLocalAabbs(buf);
    if (aabbs.size === 0) return;
    const localToWorld = new Matrix4();
    Matrix4.multiplyTransformation(
      tileset.modelMatrix,
      tileset.root.transform,
      localToWorld
    );
    const wholeAabb = unionAabbs(aabbs);
    for (const sibling of tileset._buildings || []) {
      const linkValue = sibling.linkFilter?.value ?? null;
      const aabb = linkValue == null ? wholeAabb : aabbs.get(linkValue);
      if (!aabb) continue;
      sibling._boundingSphere = aabbToWorldSphere(aabb, localToWorld);
    }
  } catch (e) {
    console.warn("Per-link bounds computation failed:", e);
  }
}

function aabbToWorldSphere(aabb, localToWorld) {
  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push(
      Matrix4.multiplyByPoint(
        localToWorld,
        new Cartesian3(
          (i & 1) ? aabb.max[0] : aabb.min[0],
          (i & 2) ? aabb.max[1] : aabb.min[1],
          (i & 4) ? aabb.max[2] : aabb.min[2]
        ),
        new Cartesian3()
      )
    );
  }
  return BoundingSphere.fromPoints(corners);
}

function zoomToBuilding(i) {
  const b = buildings[i];
  if (!b || !b.tileset) return;
  selectedBuildingIndex = i;

  const sphere = b._boundingSphere;
  const sphereIsUsable =
    sphere
    && Number.isFinite(sphere.radius)
    && sphere.radius > 0
    && Number.isFinite(sphere.center?.x);

  if (sphereIsUsable) {
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), sphere.radius * 2.0),
    });
  } else {
    zoomToTileset(viewer, b.tileset);
  }

  renderBuildingList();
  renderBuildingDetail();
}

/**
 * Open the split-confirm dialog and resolve with "split" or "merge".
 */
function promptSplitConfirm(split, baseName) {
  return new Promise((resolve) => {
    if (!splitConfirmDialog) {
      // Fallback if dialog markup is missing
      const ok = confirm(
        t("split.confirmFallback", { count: split.groups.size })
      );
      resolve(ok ? "split" : "merge");
      return;
    }
    const groupEntries = describeSplitGroups(split, baseName);
    splitGroupCountEl.textContent = String(groupEntries.length);
    splitGroupListEl.innerHTML = "";
    for (const entry of groupEntries) {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.displayName;
      const countSpan = document.createElement("span");
      countSpan.className = "group-count";
      countSpan.textContent = t("split.elements", { count: entry.count });
      li.appendChild(nameSpan);
      li.appendChild(countSpan);
      splitGroupListEl.appendChild(li);
    }
    const onClose = () => {
      splitConfirmDialog.removeEventListener("close", onClose);
      const value = splitConfirmDialog.returnValue || "merge";
      resolve(value === "split" ? "split" : "merge");
    };
    splitConfirmDialog.addEventListener("close", onClose);
    splitConfirmDialog.returnValue = "";
    splitConfirmDialog.showModal();
  });
}

function selectBuilding(i) {
  selectedBuildingIndex = i;
  if (buildings[i]) buildings[i]._levelTreeExpanded = true;
  renderBuildingList();
  renderBuildingDetail();
}

function handleRemoveBuilding(index) {
  const b = buildings[index];
  if (!b) return;
  for (const layer of b.shapefileLayers) {
    viewer.dataSources.remove(layer.dataSource, true);
  }
  const tileset = b.tileset;
  const siblings = tileset?._buildings;
  const isLastSibling = !siblings || siblings.length <= 1;

  if (tileset && isLastSibling) {
    lodFilter.removeTileset(tileset);
    removeCurrentTileset(viewer, tileset);
    if (tileset._directoryHandleId) {
      removeDirectoryHandle(tileset._directoryHandleId).catch(() => {});
    }
  } else if (siblings) {
    const sibIdx = siblings.indexOf(b);
    if (sibIdx !== -1) siblings.splice(sibIdx, 1);
    applyFiltersForTileset(tileset);
  }
  buildings.splice(index, 1);

  if (buildings.length === 0) {
    selectedBuildingIndex = -1;
  } else if (selectedBuildingIndex >= buildings.length) {
    selectedBuildingIndex = buildings.length - 1;
  } else if (selectedBuildingIndex > index) {
    selectedBuildingIndex--;
  }
  fileStatus.textContent = "";
  renderBuildingList();
  renderBuildingDetail();
}

function handleRemoveAll() {
  const destroyedTilesets = new Set();
  for (const b of buildings) {
    for (const layer of b.shapefileLayers) {
      viewer.dataSources.remove(layer.dataSource, true);
    }
    if (b.tileset && !destroyedTilesets.has(b.tileset)) {
      destroyedTilesets.add(b.tileset);
      lodFilter.removeTileset(b.tileset);
      removeCurrentTileset(viewer, b.tileset);
      if (b.tileset._directoryHandleId) {
        removeDirectoryHandle(b.tileset._directoryHandleId).catch(() => {});
      }
    }
  }
  buildings.length = 0;
  selectedBuildingIndex = -1;
  fileStatus.textContent = "";
  renderBuildingList();
  renderBuildingDetail();
}

function renderBuildingList() {
  buildingListEl.innerHTML = "";
  noBuildingsMsg.style.display = buildings.length === 0 ? "block" : "none";
  removeAllBtn.disabled = buildings.length === 0;

  buildings.forEach((b, i) => {
    const li = document.createElement("li");
    li.className = "building-item"
      + (i === selectedBuildingIndex ? " selected" : "")
      + (b._tilesetMissing ? " missing-tileset" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "building-name";
    nameSpan.textContent = b.name;
    nameSpan.title = b.name;
    nameSpan.addEventListener("click", () => selectBuilding(i));

    let chip = null;
    if (b.linkFilter) {
      chip = document.createElement("span");
      chip.className = "building-link-chip";
      chip.textContent = b.linkFilter.value === "" ? t("building.chip.host") : t("building.chip.link");
      chip.title = `${b.linkFilter.property}: ${b.linkFilter.value || "(host)"}`;
    }

    const badge = document.createElement("span");
    badge.className = "building-level-badge";
    badge.textContent = b._tilesetMissing
      ? t("building.noModelBadge")
      : b.activeLevelIndex === -1
        ? t("building.allBadge")
        : b.levels[b.activeLevelIndex]?.name ?? t("building.allBadge");

    const removeBtn = document.createElement("button");
    removeBtn.className = "building-remove-btn";
    removeBtn.textContent = t("generic.removeX");
    removeBtn.title = t("building.removeTitle");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleRemoveBuilding(i);
    });

    li.appendChild(nameSpan);
    if (chip) li.appendChild(chip);
    li.appendChild(badge);
    li.appendChild(removeBtn);
    buildingListEl.appendChild(li);
  });

  updateLodFilterStatus();
}

function renderImportedLayersList() {
  importedLayersListEl.innerHTML = "";
  noImportedLayersMsg.style.display = importedLayers.length === 0 ? "block" : "none";

  importedLayers.forEach((layer, i) => {
    const li = document.createElement("li");
    li.className = "imported-layer-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = layer.visible;
    checkbox.title = t("layer.toggleTitle");
    checkbox.addEventListener("change", () => {
      layer.visible = checkbox.checked;
      if (layer.type === "tileset") {
        layer.data.show = layer.visible;
      } else if (layer.type === "entities") {
        layer.data.forEach(e => (e.show = layer.visible));
      } else if (layer.type === "datasource") {
        layer.data.show = layer.visible;
      }
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "imported-layer-name";
    nameSpan.textContent = layer.label;
    nameSpan.title = layer.label;

    const removeBtn = document.createElement("button");
    removeBtn.className = "imported-layer-remove-btn";
    removeBtn.textContent = t("generic.removeX");
    removeBtn.title = t("layer.removeTitle");
    removeBtn.addEventListener("click", () => removeImportedLayer(i));

    li.appendChild(checkbox);
    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    importedLayersListEl.appendChild(li);
  });
}

function removeImportedLayer(index, rerender = true) {
  const layer = importedLayers[index];
  if (!layer) return;
  if (layer.type === "tileset") {
    removeCurrentTileset(viewer, layer.data);
  } else if (layer.type === "entities") {
    layer.data.forEach(e => viewer.entities.remove(e));
  } else if (layer.type === "datasource") {
    viewer.dataSources.remove(layer.data, true);
  }
  if (selectedPlateauFeature?.layerId === layer.id) {
    selectedPlateauFeature = null;
  }
  importedLayers.splice(index, 1);
  if (rerender) {
    renderImportedLayersList();
    renderBuildingDetail();
  }
}

function clearImportedLayers(rerender = true) {
  for (let i = importedLayers.length - 1; i >= 0; i--) {
    removeImportedLayer(i, false);
  }
  selectedPlateauFeature = null;
  if (rerender) {
    renderImportedLayersList();
    renderBuildingDetail();
  }
}

function renderBuildingDetail() {
  const b = buildings[selectedBuildingIndex];
  if (!b) {
    buildingDetailEl.style.display = "none";
    noSelectionMsgEl.style.display = shouldShowPlateauToolsPanel() ? "none" : "";
    renderPlateauFeatureControls();
    return;
  }
  buildingDetailEl.style.display = "";
  noSelectionMsgEl.style.display = "none";
  buildingDetailLabel.textContent = b.name;
  if (b._tilesetMissing) {
    reloadTilesetBanner.style.display = "";
    const msgEl = reloadTilesetBanner.querySelector(".reload-tileset-msg");
    const btnEl = reloadTilesetBtn;
    if (b.directoryHandleId) {
      msgEl.textContent = t("right.grant.message", { folder: b._directoryFolderName || "unknown" });
      btnEl.textContent = t("right.grant.button");
    } else {
      msgEl.textContent = t("right.reload.message");
      btnEl.textContent = t("right.reload.button");
    }
  } else {
    reloadTilesetBanner.style.display = "none";
  }
  zoomExtentsBtn.disabled = !b.tileset;
  levelBaseInput.value = b.levelBaseElevation;
  heightSlider.value = b.heightOffset;
  heightOffsetInput.value = b.heightOffset;
  aliasesInput.value = (b.aliases ?? []).join(", ");
  renderLevelList();
  renderPlateauFeatureControls();
}

// -- Levels --
function populateLevelsForBuilding(building, data) {
  building.levels = [];
  for (const l of data.levels) {
    if (l.levelKey === "unassigned") continue;
    building.levels.push({
      name: l.levelName,
      key: l.levelKey,
      floor: l.levelElevationMeters,
    });
  }
  // levels.json is ordered bottom→top; sort defensively by floor elevation
  building.levels.sort((a, b) => a.floor - b.floor);
  building.activeLevelIndex = -1;
}

async function detectLevelsFromFiles(files) {
  for (const file of files) {
    if (file.name.toLowerCase() === "levels.json") {
      return JSON.parse(await file.text());
    }
  }
  return null;
}

async function detectLevelsFromUrl(tilesetUrl) {
  const base = tilesetUrl.toLowerCase().endsWith("tileset.json")
    ? tilesetUrl.slice(0, -"tileset.json".length)
    : tilesetUrl.replace(/\/?$/, "/");
  try {
    const res = await fetch(base + "levels.json");
    if (res.ok) return res.json();
  } catch {}
  return null;
}

function handleAddLevel() {
  const b = buildings[selectedBuildingIndex];
  if (!b) return;
  const name = levelNameInput.value.trim();
  const floor = parseFloat(levelCeilingInput.value);
  if (!name || isNaN(floor)) return;
  b.levels.push({ name, key: null, floor });
  b.levels.sort((a, b) => a.floor - b.floor);
  levelNameInput.value = "";
  levelCeilingInput.value = "";
  renderLevelList();
}

function selectLevel(buildingIndex, levelIndex) {
  const b = buildings[buildingIndex];
  if (!b) return;
  b.activeLevelIndex = levelIndex;
  b._levelTreeExpanded = true;
  selectedBuildingIndex = buildingIndex;
  applyActiveLevelForBuilding(b);
  renderBuildingList();
  renderBuildingDetail();
}

function applyActiveLevelForBuilding(building) {
  if (!building.tileset) return;
  applyFiltersForTileset(building.tileset);
  applyLevelToShapefilesForBuilding(building);
}

function applyFiltersForTileset(tileset) {
  if (!tileset || !tileset.root) return;
  const stack = [tileset.root];
  while (stack.length) {
    const tile = stack.pop();
    if (tile.content) applyFiltersToContent(tileset, tile.content);
    if (tile.children) {
      for (const c of tile.children) stack.push(c);
    }
  }
  for (const b of (tileset._buildings || [])) {
    applyLevelToShapefilesForBuilding(b);
  }
}

/**
 * Apply combined link + level filter to one tile content.
 *
 * Each sibling building tied to this tileset has an optional linkFilter
 * { property, value }. A feature is owned by the sibling whose linkFilter.value
 * matches the feature's property; if no sibling matches (or no link filter is
 * set), it falls back to the first sibling. The owning sibling's level filter
 * (activeLevelIndex / levels) then decides feature.show.
 */
function applyFiltersToContent(tileset, content) {
  const count = content?.featuresLength ?? 0;
  if (count === 0) return;

  const siblings = tileset._buildings || [];
  if (siblings.length === 0) return;

  const linkProperty = siblings[0]?.linkFilter?.property ?? null;

  const states = siblings.map(b => ({
    building: b,
    linkValue: b.linkFilter?.value ?? null,
    allowed: b.activeLevelIndex === -1
      ? null
      : new Set(b.levels.slice(0, b.activeLevelIndex + 1).map(l => l.name)),
    hidden: !!b._hidden,
  }));

  for (let i = 0; i < count; i++) {
    const feature = content.getFeature(i);
    let owning;
    if (linkProperty) {
      const raw = feature.getProperty(linkProperty);
      const valStr = raw == null ? "" : String(raw);
      owning = states.find(s => s.linkValue === valStr) || null;
    } else {
      owning = states[0];
    }
    if (!owning || owning.hidden) {
      feature.show = false;
      continue;
    }
    if (owning.allowed === null) {
      feature.show = true;
    } else {
      const lvl = feature.getProperty("levelName");
      feature.show = !lvl || lvl === "Unassigned" || owning.allowed.has(lvl);
    }
  }
}

function applyLevelToShapefilesForBuilding(building) {
  const activeKey = building.activeLevelIndex !== -1
    ? building.levels[building.activeLevelIndex].key
    : null;
  for (const layer of building.shapefileLayers) {
    layer.dataSource.show =
      activeKey === null ||
      layer.levelKey === null ||
      layer.levelKey === activeKey;
  }
}

function findShapefileLevel(building, layer) {
  if (layer.levelKey == null) return null;
  const levels = resolveShapefileLevels(building, layer);
  const match = levels.find(l => (l.key ?? "") === layer.levelKey);
  if (match) return match;
  // Fall back to building.levels in case the source-specific list is missing the key
  return building.levels.find(l => (l.key ?? "") === layer.levelKey) ?? null;
}

function shapefileLayerHeight(building, layer) {
  const lvl = findShapefileLevel(building, layer);
  return building.levelBaseElevation + (building.heightOffset ?? 0) + (lvl ? lvl.floor : 0) + SHAPEFILE_FLOOR_CLEARANCE_M;
}

function shapefileLayerLocalZ(building, layer) {
  const lvl = findShapefileLevel(building, layer);
  return (lvl ? lvl.floor : 0) + SHAPEFILE_FLOOR_CLEARANCE_M;
}

function shapefileWorldToLocal(building) {
  const tileset = building?.tileset;
  if (!tileset?.root?.transform) return null;

  const localToWorld = new Matrix4();
  Matrix4.multiplyTransformation(
    tileset.modelMatrix ?? Matrix4.IDENTITY,
    tileset.root.transform,
    localToWorld
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
    hierarchy.positions.map(position =>
      projectPositionToLocalZ(position, worldToLocal, targetLocalZ, fallbackHeight)
    ),
    (hierarchy.holes ?? [])
      .map(hole => projectHierarchyToLocalZ(hole, worldToLocal, targetLocalZ, fallbackHeight))
      .filter(Boolean)
  );
}

function applyShapefileLayerHeight(building, layer) {
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
        fallbackHeight
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
        projectPositionToLocalZ(pos, worldToLocal, targetLocalZ, fallbackHeight)
      );
      entity.polyline.positions = new ConstantProperty(projected);
    } else if (entity.position) {
      // Point / MultiPoint entities. GeoJsonDataSource sets entity.position
      // from the 2D GeoJSON coordinate (height 0), so without this branch
      // points would render at ellipsoid 0 regardless of the layer's level.
      // Lifted by POINT_EXTRA_HEIGHT_M above the polygon clearance so the
      // marker isn't depth-clipped into the floor mesh.
      const pos = entity.position.getValue
        ? entity.position.getValue(time)
        : entity.position;
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

function applyShapefileLayerHeights(building) {
  for (const layer of building.shapefileLayers) applyShapefileLayerHeight(building, layer);
}

function detectLevelByFilename(filename, levels) {
  const base = (filename ?? "").replace(/\.(shp|dbf|prj)$/i, "").toLowerCase();
  if (!base || !levels?.length) return null;
  // Sort longest level name first so e.g. "B2F" wins over "F"
  const sorted = [...levels].sort((a, b) => b.name.length - a.name.length);
  return sorted.find(l => base.includes(l.name.toLowerCase())) ?? null;
}

// Find the dominant `properties.source` across features (e.g. "Shinjuku_LUMINE1").
// Returns null if no feature carries a source tag.
function detectShapefileSource(features) {
  const counts = new Map();
  for (const f of features ?? []) {
    const raw = f?.properties?.source;
    if (raw == null || raw === "") continue;
    const key = String(raw);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

// Pick the level list to use for a shapefile layer's placement:
//   1. building.sourceLevelGroups[layer.source] if available (split sibling or merged
//      with multi-link metadata)
//   2. building.levels (global or current sibling's levels)
function resolveShapefileLevels(building, layer) {
  const source = layer?.source;
  if (source != null && building?.sourceLevelGroups instanceof Map) {
    const sourceLevels = building.sourceLevelGroups.get(source);
    if (sourceLevels?.length) return sourceLevels;
  }
  return building?.levels ?? [];
}

function renderLevelList() {
  levelListEl.innerHTML = "";
  if (buildings.length === 0 && unassignedLayers.length === 0) return;

  buildings.forEach((b, bi) => {
    const expanded = b._levelTreeExpanded === undefined
      ? (bi === selectedBuildingIndex)
      : b._levelTreeExpanded;

    const buildingLi = document.createElement("li");
    buildingLi.className = "level-tree-building"
      + (bi === selectedBuildingIndex ? " selected" : "");

    // Header row: chevron + name + optional chip
    const header = document.createElement("div");
    header.className = "level-tree-header";

    const chevron = document.createElement("span");
    chevron.className = "level-tree-chevron" + (expanded ? " expanded" : "");
    chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="3,2 7,5 3,8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      b._levelTreeExpanded = !expanded;
      renderLevelList();
    });
    header.appendChild(chevron);

    const nameSpan = document.createElement("span");
    nameSpan.className = "level-tree-name";
    nameSpan.textContent = b.name;
    nameSpan.title = b.name;
    header.appendChild(nameSpan);

    if (b.linkFilter) {
      const chip = document.createElement("span");
      chip.className = "building-link-chip";
      chip.textContent = b.linkFilter.value === "" ? t("building.chip.host") : t("building.chip.link");
      chip.title = `${b.linkFilter.property}: ${b.linkFilter.value || "(host)"}`;
      header.appendChild(chip);
    }

    const zoomBtn = document.createElement("button");
    zoomBtn.className = "level-tree-zoom-btn";
    zoomBtn.title = t("building.zoomTitle");
    zoomBtn.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
      '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      "</svg>";
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      zoomToBuilding(bi);
    });
    header.appendChild(zoomBtn);

    const addBtn = document.createElement("button");
    addBtn.className = "level-add-btn";
    addBtn.textContent = "+";
    addBtn.title = t("building.addShapefilesTitle");
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleAddShapefilesToBuilding(bi);
    });
    header.appendChild(addBtn);

    header.addEventListener("click", () => {
      selectBuilding(bi);
    });
    buildingLi.appendChild(header);

    if (expanded) {
      const childUl = document.createElement("ul");
      childUl.className = "level-tree-children";

      // -- "All floors" row --
      const allLi = document.createElement("li");
      allLi.className = "level-item";
      const allFloorsExpanded = b._allFloorsExpanded !== false;
      const allShapefiles = b.shapefileLayers.filter(l => l.levelKey == null);
      appendLevelChevron(allLi, allShapefiles.length > 0 ? allFloorsExpanded : null, () => {
        b._allFloorsExpanded = !allFloorsExpanded;
        renderLevelList();
      });
      const allLabel = document.createElement("label");
      const allRadio = document.createElement("input");
      allRadio.type = "radio";
      allRadio.name = `levelRadio-${bi}`;
      allRadio.checked = b.activeLevelIndex === -1;
      allRadio.addEventListener("change", () => selectLevel(bi, -1));
      allLabel.appendChild(allRadio);
      allLabel.append(" " + t("level.allFloors"));
      allLi.appendChild(allLabel);
      childUl.appendChild(allLi);
      if (allFloorsExpanded && allShapefiles.length > 0) {
        childUl.appendChild(buildShapefileChildren(b, bi, allShapefiles));
      }

      // -- Per-floor rows --
      b.levels.forEach((level, i) => {
        const li = document.createElement("li");
        li.className = "level-item";

        const levelExpanded = level._expanded !== false;
        const levelShapefiles = b.shapefileLayers.filter(
          l => (l.levelKey ?? "") === (level.key ?? "") && l.levelKey != null
        );
        appendLevelChevron(li, levelShapefiles.length > 0 ? levelExpanded : null, () => {
          level._expanded = !levelExpanded;
          renderLevelList();
        });

        const label = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `levelRadio-${bi}`;
        radio.checked = b.activeLevelIndex === i;
        radio.addEventListener("change", () => selectLevel(bi, i));
        label.appendChild(radio);
        label.append(` ${level.name}`);

        const floorSpan = document.createElement("span");
        floorSpan.className = "level-ceiling";
        floorSpan.textContent = `${level.floor.toFixed(1)} m`;

        const removeBtn = document.createElement("button");
        removeBtn.className = "level-remove-btn";
        removeBtn.textContent = t("generic.removeX");
        removeBtn.title = t("level.removeTitle");
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const wasActive = b.activeLevelIndex === i;
          b.levels.splice(i, 1);
          if (wasActive || b.activeLevelIndex >= b.levels.length) {
            b.activeLevelIndex = -1;
            applyActiveLevelForBuilding(b);
          } else if (b.activeLevelIndex > i) {
            b.activeLevelIndex--;
          }
          applyShapefileLayerHeights(b);
          renderLevelList();
          renderBuildingList();
        });

        li.appendChild(label);
        li.appendChild(floorSpan);
        li.appendChild(removeBtn);
        childUl.appendChild(li);

        if (levelExpanded && levelShapefiles.length > 0) {
          childUl.appendChild(buildShapefileChildren(b, bi, levelShapefiles));
        }
      });

      buildingLi.appendChild(childUl);
    }

    levelListEl.appendChild(buildingLi);
  });

  if (unassignedLayers.length > 0) {
    levelListEl.appendChild(buildUnassignedNode());
  }
}

// Build the pseudo-building node for the unassigned-layers bucket. Mirrors the
// building tree's chevron + name + child list structure but with no level rows
// (layers sit directly under it) and no add/remove building buttons.
function buildUnassignedNode() {
  const li = document.createElement("li");
  li.className = "level-tree-building unassigned-group";
  const header = document.createElement("div");
  header.className = "level-tree-header";

  const chevron = document.createElement("span");
  chevron.className = "level-tree-chevron" + (_unassignedTreeExpanded ? " expanded" : "");
  chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="3,2 7,5 3,8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  chevron.addEventListener("click", (e) => {
    e.stopPropagation();
    _unassignedTreeExpanded = !_unassignedTreeExpanded;
    renderLevelList();
  });
  header.appendChild(chevron);

  const nameSpan = document.createElement("span");
  nameSpan.className = "level-tree-name";
  nameSpan.textContent = t("gdb.unassigned.groupName");
  nameSpan.title = t("gdb.unassigned.groupName");
  header.appendChild(nameSpan);
  li.appendChild(header);

  if (_unassignedTreeExpanded && unassignedLayers.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "shp-children";
    for (const layer of unassignedLayers) {
      const row = document.createElement("li");
      row.className = "shp-tree-item";

      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.background = layer.color;

      const layerName = document.createElement("span");
      layerName.className = "shp-tree-name";
      layerName.textContent = layer.name;
      layerName.title = layer.name;

      const removeBtn = document.createElement("button");
      removeBtn.className = "shp-tree-remove-btn";
      removeBtn.textContent = t("generic.removeX");
      removeBtn.title = t("shp.removeTitle");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeUnassignedLayer(layer);
      });

      row.appendChild(swatch);
      row.appendChild(layerName);
      row.appendChild(removeBtn);
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMoveUnassignedToBuildingMenu(e, layer);
      });
      ul.appendChild(row);
    }
    li.appendChild(ul);
  }
  return li;
}

// Floating context menu that lets the user transfer an unassigned layer to a
// specific building and floor.
function showMoveUnassignedToBuildingMenu(event, layer) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");
  if (buildings.length === 0) {
    const li = document.createElement("li");
    li.textContent = t("gdb.unassigned.moveTitle");
    li.classList.add("disabled");
    ul.appendChild(li);
  }
  buildings.forEach((b, bi) => {
    const li = document.createElement("li");
    li.className = "submenu-parent";
    li.textContent = b.name;
    const sub = document.createElement("ul");
    sub.className = "submenu";
    const addFloorEntry = (label, levelKey) => {
      const f = document.createElement("li");
      f.textContent = label;
      f.addEventListener("click", (e) => {
        e.stopPropagation();
        hideFloatingMenu();
        moveUnassignedLayerToBuilding(layer, bi, levelKey);
      });
      sub.appendChild(f);
    };
    addFloorEntry(t("level.allFloors"), null);
    for (const lvl of b.levels) {
      addFloorEntry(lvl.name, lvl.key ?? "");
    }
    li.appendChild(sub);
    ul.appendChild(li);
  });
  floatingMenu.appendChild(ul);
  floatingMenu.style.left = `${event.pageX}px`;
  floatingMenu.style.top = `${event.pageY}px`;
  floatingMenu.style.display = "";
}

// -- renderLevelList helpers --

function appendLevelChevron(li, expanded, onToggle) {
  const chev = document.createElement("span");
  chev.className = "level-tree-chevron" + (expanded ? " expanded" : "");
  if (expanded === null) {
    // No children to expand — render an invisible placeholder so the row keeps its alignment.
    chev.style.visibility = "hidden";
  } else {
    chev.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="3,2 7,5 3,8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    chev.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle();
    });
  }
  li.appendChild(chev);
}

function buildShapefileChildren(building, buildingIndex, layers) {
  const ul = document.createElement("ul");
  ul.className = "shp-children";
  for (const layer of layers) {
    const li = document.createElement("li");
    li.className = "shp-tree-item";

    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.background = layer.color;

    const nameSpan = document.createElement("span");
    nameSpan.className = "shp-tree-name";
    nameSpan.textContent = layer.name;
    nameSpan.title = layer.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "shp-tree-remove-btn";
    removeBtn.textContent = t("generic.removeX");
    removeBtn.title = t("shp.removeTitle");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeShapefileLayer(building, layer);
    });

    li.appendChild(swatch);
    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    li.addEventListener("click", () => selectBuilding(buildingIndex));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMoveToFloorMenu(e, building, layer);
    });
    ul.appendChild(li);
  }
  return ul;
}

// -- Shapefile Layers --
function handleAddShapefilesToBuilding(buildingIndex) {
  _shpPendingTarget = { buildingIndex };
  shpInput.click();
}

// -- Geodatabase (.gdb) Layers --
async function handleGdbZipSelect(e) {
  const file = e.target.files[0];
  gdbInput.value = "";
  if (!file) return;
  await runGdbLoad(file);
}

async function handleGdbDirSelect(e) {
  const files = e.target.files; // FileList from a webkitdirectory pick.
  gdbDirInput.value = "";
  if (!files.length) return;
  await runGdbLoad(files);
}

// Parse a .gdb input, then hand the parsed FeatureCollections to the review
// dialog. The dialog returns one assignment per layer; we then dispatch each
// to either a building, the unassigned bucket, or skip.
async function runGdbLoad(input) {
  if (_gdbBusy) return;
  _gdbBusy = true;
  showLoadingOverlay(t("gdb.loading"));
  let parsed;
  try {
    parsed = await loadGdb(input);
  } catch (err) {
    console.error(err);
    alert(t("alert.failedGdb", { message: err?.message ?? String(err) }));
    hideLoadingOverlay();
    _gdbBusy = false;
    return;
  }
  hideLoadingOverlay();
  _gdbBusy = false;

  const { featureCollections, warnings } = parsed;
  if (warnings?.length) console.warn("[.gdb] warnings:", warnings);
  if (!featureCollections?.length) return;

  openGdbImportDialog({
    featureCollections,
    buildings,
    onImport: async (decisions) => {
      await applyGdbDecisions(decisions);
    },
  });
}

async function applyGdbDecisions(decisions) {
  const touchedBuildings = new Set();
  for (const { fc, target, nameOverride } of decisions) {
    if (target.kind === "skip") continue;
    if (target.kind === "unassigned") {
      await addUnassignedLayer(fc, { nameOverride });
      continue;
    }
    if (target.kind === "building") {
      const b = buildings[target.buildingIndex];
      if (!b) continue;
      await addFeatureCollectionLayer(b, fc, {
        levelKeyOverride: target.levelKey,
        origin: "gdb",
        nameOverride,
      });
      touchedBuildings.add(target.buildingIndex);
    }
  }
  for (const bi of touchedBuildings) {
    applyLevelToShapefilesForBuilding(buildings[bi]);
  }
  // If no building was selected before this import, pick the first touched
  // one so the Floor Levels panel actually shows the new layers.
  if (selectedBuildingIndex === -1 && touchedBuildings.size > 0) {
    const firstTouched = [...touchedBuildings][0];
    selectBuilding(firstTouched);
  } else {
    renderLevelList();
  }
}

// -- GDB reassign-existing-layers --
// Gathers every GDB-origin layer (whether attached to a building or sitting in
// the Unassigned bucket) and opens the import dialog in 'reassign' mode so the
// user can bulk-move them.
function openGdbReassignDialog() {
  const entries = collectGdbLayersForReassign();
  if (entries.length === 0) {
    alert(t("gdb.reassign.empty"));
    return;
  }
  const featureCollections = entries.map((e) => ({
    fileName: e.layer.name,
    features: e.layer.features,
    _existingEntry: e,
  }));
  openGdbImportDialog({
    featureCollections,
    buildings,
    onImport: applyReassignDecisions,
    mode: "reassign",
  });
}

function collectGdbLayersForReassign() {
  const out = [];
  for (let bi = 0; bi < buildings.length; bi++) {
    for (const layer of buildings[bi].shapefileLayers) {
      if (layer._origin !== "gdb") continue;
      out.push({ layer, parent: { kind: "building", buildingIndex: bi } });
    }
  }
  for (const layer of unassignedLayers) {
    if (layer._origin !== "gdb") continue;
    out.push({ layer, parent: { kind: "unassigned" } });
  }
  return out;
}

async function applyReassignDecisions(decisions) {
  const touched = new Set();
  for (const { fc, target } of decisions) {
    const entry = fc._existingEntry;
    if (!entry) continue;
    const layer = entry.layer;
    const currentBi = entry.parent.kind === "building" ? entry.parent.buildingIndex : -1;
    const currentLevelKey = layer.levelKey ?? null;

    if (target.kind === "skip") {
      removeAnyLayer(layer);
      continue;
    }
    if (target.kind === "unassigned") {
      if (currentBi === -1) continue; // already there
      transferToUnassigned(layer, currentBi);
      continue;
    }
    if (target.kind === "building") {
      const newBi = target.buildingIndex;
      const newLevel = target.levelKey ?? null;
      if (newBi === currentBi && newLevel === currentLevelKey) continue;
      if (currentBi === -1) {
        moveUnassignedLayerToBuilding(layer, newBi, newLevel);
      } else if (newBi !== currentBi) {
        transferBetweenBuildings(layer, currentBi, newBi, newLevel);
      } else {
        moveShapefileToLevel(buildings[currentBi], layer, newLevel ?? null);
      }
      touched.add(newBi);
    }
  }
  for (const bi of touched) applyLevelToShapefilesForBuilding(buildings[bi]);
  renderLevelList();
}

// Remove a layer from wherever it currently lives (a building's
// shapefileLayers or the unassigned bucket). Used by reassign's "skip" action.
function removeAnyLayer(layer) {
  if (unassignedLayers.indexOf(layer) !== -1) {
    removeUnassignedLayer(layer);
    return;
  }
  for (const b of buildings) {
    if (b.shapefileLayers.indexOf(layer) !== -1) {
      removeShapefileLayer(b, layer);
      return;
    }
  }
}

// Move a layer from its current building to the unassigned bucket. Reuses the
// existing Cesium dataSource — only re-parents and drops the levelKey.
function transferToUnassigned(layer, currentBi) {
  const b = buildings[currentBi];
  const i = b.shapefileLayers.indexOf(layer);
  if (i === -1) return;
  b.shapefileLayers.splice(i, 1);
  delete layer.levelKey;
  unassignedLayers.push(layer);
}

// Move a layer between two buildings, applying the new building's height
// offset / level so it renders at the right elevation.
function transferBetweenBuildings(layer, fromBi, toBi, newLevelKey) {
  const from = buildings[fromBi];
  const i = from.shapefileLayers.indexOf(layer);
  if (i === -1) return;
  from.shapefileLayers.splice(i, 1);
  layer.levelKey = newLevelKey;
  buildings[toBi].shapefileLayers.push(layer);
  applyShapefileLayerHeight(buildings[toBi], layer);
}

async function handleShpSelect(e) {
  const file = e.target.files[0];
  shpInput.value = "";
  if (!file || !_shpPendingTarget) {
    _shpPendingTarget = null;
    return;
  }
  const { buildingIndex } = _shpPendingTarget;
  _shpPendingTarget = null;
  const b = buildings[buildingIndex];
  if (!b) return;
  try {
    const { default: shp } = await import("shpjs");
    const raw = await shp(await file.arrayBuffer());
    const fcs = Array.isArray(raw) ? raw : [raw];
    for (const fc of fcs) await addFeatureCollectionLayer(b, fc);
    applyLevelToShapefilesForBuilding(b);
    if (selectedBuildingIndex !== buildingIndex) selectBuilding(buildingIndex);
    else renderLevelList();
  } catch (err) {
    alert(t("alert.failedShp", { message: err.message }));
  }
}

// Add a single GeoJSON FeatureCollection (from a shapefile or a .gdb feature class)
// to the building, wired through the same level/source resolution as shapefiles.
//
// opts.levelKeyOverride: if provided (including null = "all floors"), skip the
// detectLevelByFilename auto-match and use this value verbatim. Pass undefined
// (or omit) to keep the original auto-detect behavior.
// opts.nameOverride: if provided, use as the layer's display name verbatim
// (e.g. "point_facility (1F)" for a per-floor split sub-layer).
async function addFeatureCollectionLayer(building, fc, opts = {}) {
  const name = opts.nameOverride ?? (fc.fileName ?? "layer").replace(/\.(shp|dbf|prj)$/i, "");
  const features = fc.features ?? [];
  const source = detectShapefileSource(features);
  let levelKey;
  if (Object.prototype.hasOwnProperty.call(opts, "levelKeyOverride")) {
    levelKey = opts.levelKeyOverride;
  } else {
    const levelsForMatch =
      (source != null && building.sourceLevelGroups?.get(source)) || building.levels;
    const matched = detectLevelByFilename(fc.fileName ?? name, levelsForMatch);
    levelKey = matched ? (matched.key ?? "") : null;
  }
  const color = SHP_COLORS[_shpColorIdx++ % SHP_COLORS.length];
  const cesiumColor = Color.fromCssColorString(color);
  const dataSource = await GeoJsonDataSource.load(
    { type: "FeatureCollection", features },
    { fill: cesiumColor.withAlpha(1.0), stroke: cesiumColor, strokeWidth: 2, clampToGround: false }
  );
  applyEntityStyling(dataSource, name);
  viewer.dataSources.add(dataSource);
  const layer = { name, dataSource, color, levelKey, source, features, _origin: opts.origin ?? "shp" };
  building.shapefileLayers.push(layer);
  applyShapefileLayerHeight(building, layer);
  return layer;
}

// Add a FeatureCollection to the global unassigned bucket. The layer is added
// to the viewer at its raw z-values (no building height offset is applied)
// because there is no associated building elevation.
async function addUnassignedLayer(fc, opts = {}) {
  const name = opts.nameOverride ?? (fc.fileName ?? "layer").replace(/\.(shp|dbf|prj)$/i, "");
  const features = fc.features ?? [];
  const source = detectShapefileSource(features);
  const color = SHP_COLORS[_shpColorIdx++ % SHP_COLORS.length];
  const cesiumColor = Color.fromCssColorString(color);
  const dataSource = await GeoJsonDataSource.load(
    { type: "FeatureCollection", features },
    { fill: cesiumColor.withAlpha(1.0), stroke: cesiumColor, strokeWidth: 2, clampToGround: false }
  );
  applyEntityStyling(dataSource, name);
  viewer.dataSources.add(dataSource);
  // Anything reaching the unassigned bucket came from the GDB import dialog —
  // the shapefile path always targets a specific building.
  const layer = { name, dataSource, color, features, source, _origin: "gdb" };
  unassignedLayers.push(layer);
  return layer;
}

// Transfer an unassigned layer into a building's shapefileLayers, applying the
// chosen level. The Cesium dataSource is reused; only ownership changes.
function moveUnassignedLayerToBuilding(layer, buildingIndex, levelKey) {
  const building = buildings[buildingIndex];
  if (!building) return;
  const idx = unassignedLayers.indexOf(layer);
  if (idx === -1) return;
  unassignedLayers.splice(idx, 1);
  const moved = {
    name: layer.name,
    dataSource: layer.dataSource,
    color: layer.color,
    levelKey: levelKey ?? null,
    source: layer.source,
    features: layer.features,
  };
  building.shapefileLayers.push(moved);
  applyShapefileLayerHeight(building, moved);
  applyLevelToShapefilesForBuilding(building);
  renderLevelList();
}

function removeUnassignedLayer(layer) {
  const idx = unassignedLayers.indexOf(layer);
  if (idx === -1) return;
  viewer.dataSources.remove(layer.dataSource, true);
  unassignedLayers.splice(idx, 1);
  renderLevelList();
}

// Map a feature's `image` property value to the URL Vite serves from
// public/icons/marker/. The user's exports carry values like
// "/marker/locker.png", which need an `/icons` prefix. Tolerates absolute
// URLs, already-rooted paths, and bare filenames as a defensive fallback.
function resolveMarkerImageUrl(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/icons/')) return s;
  if (s.startsWith('/marker/')) return '/icons' + s;
  if (s.startsWith('marker/')) return '/icons/' + s;
  return '/icons/marker/' + s.replace(/^\.?\//, '');
}

function resolveColor2(rawValue) {
  const key = String(rawValue ?? "").trim();
  const hex = COLOR2_LOOKUP[key] || COLOR2_DEFAULT;
  try {
    return Color.fromCssColorString(hex);
  } catch {
    return Color.fromCssColorString(COLOR2_DEFAULT);
  }
}

function applyEntityStyling(dataSource, layerName = "") {
  const isSpaceLayer = /_space/i.test(layerName);
  const isOpeningLayer = /_opening/i.test(layerName);

  for (const entity of dataSource.entities.values) {
    // Per-feature icon override for point markers. Independent of the
    // layer-name predicates because the `image` property can appear on any
    // point FC. Polygons/polylines lack `entity.billboard` and skip the
    // branch naturally.
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

    // Styled point + two-line label for features that name themselves via
    // `name` / `symbol_id` columns but don't supply an `image` icon. Replaces
    // the default GeoJsonDataSource pin with a small green circle and stacks
    // symbol_id over name in a label hovering above it.
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

      // Honor literal <br> tags in the source data as real line breaks.
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
        // Keep the text legible when the camera is inside a building.
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      };
    }

    if (isSpaceLayer) {
      const color2Raw = entity.properties?.color2?.getValue?.();
      const c = resolveColor2(color2Raw);
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

function removeShapefileLayer(building, layer) {
  const idx = building.shapefileLayers.indexOf(layer);
  if (idx === -1) return;
  viewer.dataSources.remove(layer.dataSource, true);
  building.shapefileLayers.splice(idx, 1);
  renderLevelList();
}

function moveShapefileToLevel(building, layer, newLevelKey) {
  layer.levelKey = newLevelKey;
  applyShapefileLayerHeight(building, layer);
  applyLevelToShapefilesForBuilding(building);
  renderLevelList();
}

// -- Floating context menu --
function showMoveToFloorMenu(event, building, layer) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");
  const buildItem = (label, levelKey, disabled) => {
    const li = document.createElement("li");
    li.textContent = label;
    if (disabled) {
      li.classList.add("disabled");
    } else {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        hideFloatingMenu();
        moveShapefileToLevel(building, layer, levelKey);
      });
    }
    ul.appendChild(li);
  };
  buildItem(t("level.allFloors"), null, layer.levelKey == null);
  for (const lvl of building.levels) {
    buildItem(lvl.name, lvl.key ?? "", (layer.levelKey ?? "") === (lvl.key ?? ""));
  }
  floatingMenu.appendChild(ul);
  floatingMenu.style.left = `${event.pageX}px`;
  floatingMenu.style.top = `${event.pageY}px`;
  floatingMenu.style.display = "";
}

function hideFloatingMenu() {
  floatingMenu.style.display = "none";
  floatingMenu.innerHTML = "";
}

// -- CityGML Layers --
async function handleCityGmlSelect(e) {
  const file = e.target.files[0];
  cityGmlInput.value = "";
  if (!file) return;
  loadCityGmlBtn.disabled = true;
  loadCityGmlBtn.textContent = t("cityGml.button.loading");
  try {
    const xmlText = await file.text();
    const { polygons, srsWarning } = parseCityGml(xmlText);
    if (srsWarning) console.warn("CityGML:", srsWarning);
    if (polygons.length === 0) throw new Error(t("tileset.noPolygon"));

    const dataSource = new CustomDataSource(file.name);
    for (const poly of polygons) {
      const flatPos = poly.positions.flat();
      if (flatPos.length < 9) continue;
      const positions = Cartesian3.fromDegreesArrayHeights(flatPos);
      const holes = poly.holes.map(
        (h) => new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(h.flat()))
      );
      dataSource.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(positions, holes),
          perPositionHeight: true,
          material: SURFACE_COLORS[poly.surfaceType],
          outline: true,
          outlineColor: Color.BLACK.withAlpha(0.4),
          outlineWidth: 1,
        },
      });
    }

    await viewer.dataSources.add(dataSource);
    cityGmlLayers.push({ name: file.name, dataSource });
    viewer.zoomTo(dataSource);
    renderCityGmlList();
  } catch (err) {
    alert(t("alert.failedGml", { message: err.message }));
  } finally {
    loadCityGmlBtn.disabled = false;
    loadCityGmlBtn.textContent = t("cityGml.button");
  }
}

function removeCityGmlLayer(index) {
  viewer.dataSources.remove(cityGmlLayers[index].dataSource, true);
  cityGmlLayers.splice(index, 1);
  renderCityGmlList();
}

function renderCityGmlList() {
  cityGmlListEl.innerHTML = "";
  noCityGmlMsg.style.display = cityGmlLayers.length === 0 ? "block" : "none";
  cityGmlLayers.forEach((layer, i) => {
    const li = document.createElement("li");
    li.className = "shapefile-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "shapefile-name";
    nameSpan.textContent = layer.name;
    nameSpan.title = layer.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "shapefile-remove-btn";
    removeBtn.textContent = t("generic.removeX");
    removeBtn.title = t("layer.removeTitle");
    removeBtn.addEventListener("click", () => removeCityGmlLayer(i));

    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    cityGmlListEl.appendChild(li);
  });
}

// -- Session save / restore --
function saveSession() {
  if (buildings.length === 0 && importedLayers.length === 0) {
    alert(t("alert.nothingToSave"));
    return;
  }
  const data = {
    version: 2,
    imagery: imagerySelect.value,
    terrain: terrainSelect.value,
    plateauOverridesEnabled,
    buildings: (() => {
      // Assign a stable tilesetGroupId so siblings sharing one tileset can be
      // reunited on restore (they will load the same tileset once).
      const tilesetIds = new Map();
      let nextId = 0;
      const idFor = (tileset) => {
        if (!tileset) return null;
        if (!tilesetIds.has(tileset)) tilesetIds.set(tileset, ++nextId);
        return tilesetIds.get(tileset);
      };
      return buildings.map(b => ({
        name: b.name,
        sourceType: b.sourceUrl ? "url" : "file",
        sourceUrl: b.sourceUrl ?? null,
        tilesetGroupId: idFor(b.tileset),
        linkFilter: b.linkFilter ?? null,
        heightOffset: b.heightOffset,
        levelBaseElevation: b.levelBaseElevation,
        aliases: b.aliases ?? [],
        activeLevelIndex: b.activeLevelIndex,
        levels: b.levels.map(l => ({ name: l.name, key: l.key ?? null, floor: l.floor })),
        sourceLevelGroups: serializeSourceLevelGroups(b.sourceLevelGroups),
        shapefileLayers: b.shapefileLayers.map(sl => ({
          name: sl.name,
          color: sl.color,
          levelKey: sl.levelKey ?? null,
          source: sl.source ?? null,
          features: sl.features ?? [],
          _origin: sl._origin ?? null,
        })),
        directoryHandleId: b.directoryHandleId ?? null,
        _directoryFolderName: b._directoryFolderName ?? null,
      }));
    })(),
    importedLayers: importedLayers
      .filter(l => l.sourceConfig)
      .map(l => {
        const saved = { label: l.label, visible: l.visible, sourceConfig: l.sourceConfig };
        if (isPlateauLayer(l)) saved.plateauOverrides = serializePlateauOverrides(l);
        return saved;
      }),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function handleLoadSession(e) {
  const file = e.target.files[0];
  sessionInput.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (![1, 2].includes(data.version)) throw new Error("Unsupported session version.");
    await restoreSession(data);
  } catch (err) {
    alert(t("alert.failedSession", { message: err.message }));
  } finally {
    hideLoadingOverlay();
  }
}

async function restoreSession(data) {
  handleRemoveAll();
  clearImportedLayers(false);
  selectedPlateauFeature = null;
  plateauOverridesEnabled = data.plateauOverridesEnabled ?? true;
  if (data.imagery) { imagerySelect.value = data.imagery; switchImagery(); }
  if (data.terrain) { terrainSelect.value = data.terrain; switchTerrain(); }

  // Group entries by tilesetGroupId so siblings sharing a tileset are reunited
  const groups = new Map();
  let unique = 0;
  for (const bData of data.buildings ?? []) {
    const key = bData.tilesetGroupId != null
      ? `g:${bData.tilesetGroupId}`
      : `u:${unique++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bData);
  }
  const importedList = data.importedLayers ?? [];
  const total = groups.size + importedList.length;
  let done = 0;
  showLoadingOverlay(
    t("loading.session.title"),
    t("loading.session.progress", { current: 0, total }),
  );
  for (const group of groups.values()) {
    if (group.length === 1) {
      await restoreBuilding(group[0]);
    } else {
      await restoreSiblingGroup(group);
    }
    done++;
    updateLoadingOverlay(t("loading.session.progress", { current: done, total }));
  }
  for (const lData of importedList) {
    try {
      const layer = await restoreImportedLayer(viewer, loadTilesetFromUrl, lData);
      if (layer) {
        if (isPlateauLayer(layer)) {
          layer.plateauOverrides = lData.plateauOverrides ?? [];
          initializePlateauLayer(layer);
        }
        importedLayers.push(layer);
      }
    } catch (e) {
      console.warn("Could not restore imported layer:", lData.label, e);
    }
    done++;
    updateLoadingOverlay(t("loading.session.progress", { current: done, total }));
  }
  selectedBuildingIndex = buildings.length > 0 ? 0 : -1;
  renderBuildingList();
  renderBuildingDetail();
  renderImportedLayersList();
  refreshAllPlateauOverrideStyles();
}

async function restoreBuilding(bData) {
  let tileset = null;
  if (bData.sourceType === "url" && bData.sourceUrl) {
    try {
      tileset = await loadTilesetFromUrl(viewer, bData.sourceUrl);
    } catch (e) {
      console.warn("Could not restore tileset from URL:", bData.sourceUrl, e);
    }
  }
  if (!tileset && bData.directoryHandleId) {
    try {
      const handle = await getDirectoryHandle(bData.directoryHandleId);
      if (handle) {
        const files = await getFilesFromDirectoryHandle(handle);
        tileset = await loadTilesetFromFiles(viewer, files, fileStatus);
      }
    } catch (e) {
      console.warn("Could not restore tileset from directory handle:", bData.directoryHandleId, e);
    }
  }
  const building = {
    name: bData.name ?? "Unnamed",
    tileset,
    sourceUrl: bData.sourceUrl ?? null,
    heightOffset: bData.heightOffset ?? 0,
    levelBaseElevation: bData.levelBaseElevation ?? 0,
    activeLevelIndex: bData.activeLevelIndex ?? -1,
    levels: (bData.levels ?? []).map(l => ({ name: l.name, key: l.key ?? null, floor: l.floor })),
    sourceLevelGroups: deserializeSourceLevelGroups(bData.sourceLevelGroups),
    shapefileLayers: [],
    linkFilter: bData.linkFilter ?? null,
    aliases: Array.isArray(bData.aliases) ? bData.aliases : [],
    _tilesetMissing: !tileset,
    directoryHandleId: bData.directoryHandleId ?? null,
    _directoryFolderName: bData._directoryFolderName ?? null,
  };
  if (tileset) {
    tileset._buildings = [building];
    tileset._directoryHandleId = building.directoryHandleId;
    tileset._directoryFolderName = building._directoryFolderName;
    lodFilter.addTileset(tileset);
    bindTilesetTileLoad(tileset);
    if (building.heightOffset !== 0) applyHeightOffset(tileset, building.heightOffset);
    applyFiltersForTileset(tileset);
    computePerSiblingBoundingSpheres(tileset, bData.sourceUrl ?? null);
  }
  for (const slData of bData.shapefileLayers ?? []) {
    await restoreShapefileLayer(building, slData);
  }
  buildings.push(building);
}

async function restoreSiblingGroup(group) {
  const first = group[0];
  let tileset = null;
  if (first.sourceType === "url" && first.sourceUrl) {
    try {
      tileset = await loadTilesetFromUrl(viewer, first.sourceUrl);
    } catch (e) {
      console.warn("Could not restore shared tileset from URL:", first.sourceUrl, e);
    }
  }
  if (!tileset && first.directoryHandleId) {
    try {
      const handle = await getDirectoryHandle(first.directoryHandleId);
      if (handle) {
        const files = await getFilesFromDirectoryHandle(handle);
        tileset = await loadTilesetFromFiles(viewer, files, fileStatus);
      }
    } catch (e) {
      console.warn("Could not restore shared tileset from directory handle:", first.directoryHandleId, e);
    }
  }
  const reloadGroup = tileset ? null : {};
  const siblings = [];
  for (const bData of group) {
    const b = {
      name: bData.name ?? "Unnamed",
      tileset,
      sourceUrl: bData.sourceUrl ?? null,
      heightOffset: bData.heightOffset ?? 0,
      levelBaseElevation: bData.levelBaseElevation ?? 0,
      activeLevelIndex: bData.activeLevelIndex ?? -1,
      levels: (bData.levels ?? []).map(l => ({ name: l.name, key: l.key ?? null, floor: l.floor })),
      sourceLevelGroups: deserializeSourceLevelGroups(bData.sourceLevelGroups),
      shapefileLayers: [],
      linkFilter: bData.linkFilter ?? null,
      aliases: Array.isArray(bData.aliases) ? bData.aliases : [],
      _tilesetMissing: !tileset,
      _reloadGroup: reloadGroup,
      directoryHandleId: bData.directoryHandleId ?? null,
      _directoryFolderName: bData._directoryFolderName ?? null,
    };
    siblings.push(b);
    buildings.push(b);
  }
  if (tileset) {
    tileset._buildings = siblings;
    tileset._directoryHandleId = first.directoryHandleId;
    tileset._directoryFolderName = first._directoryFolderName;
    lodFilter.addTileset(tileset);
    bindTilesetTileLoad(tileset);
    if (siblings[0].heightOffset !== 0) applyHeightOffset(tileset, siblings[0].heightOffset);
    applyFiltersForTileset(tileset);
    computePerSiblingBoundingSpheres(tileset, first.sourceUrl ?? null);
  }
  for (let i = 0; i < group.length; i++) {
    for (const slData of group[i].shapefileLayers ?? []) {
      await restoreShapefileLayer(siblings[i], slData);
    }
  }
}

async function restoreShapefileLayer(building, slData) {
  if (!slData.features?.length) return;
  const geojson = { type: "FeatureCollection", features: slData.features };
  const cesiumColor = Color.fromCssColorString(slData.color ?? "#4fc3f7");
  const dataSource = await GeoJsonDataSource.load(geojson, {
    fill: cesiumColor.withAlpha(1.0),
    stroke: cesiumColor,
    strokeWidth: 2,
    clampToGround: false,
  });
  applyEntityStyling(dataSource, slData.name ?? "");
  viewer.dataSources.add(dataSource);
  const layer = {
    name: slData.name ?? "layer",
    dataSource,
    color: slData.color ?? "#4fc3f7",
    levelKey: slData.levelKey ?? null,
    source: slData.source ?? detectShapefileSource(slData.features) ?? null,
    features: slData.features,
    // Saved sessions pre-date the _origin tag — assume GDB (most layers in
    // practice came from the GDB importer) so they show up in the reassign
    // dialog. Newer sessions persist the real origin.
    _origin: slData._origin ?? "gdb",
  };
  building.shapefileLayers.push(layer);
  applyShapefileLayerHeight(building, layer);
  applyLevelToShapefilesForBuilding(building);
}

async function attachTilesetToBuilding(buildingIndex, files, dirHandle = null, dirId = null, dirName = null) {
  const target = buildings[buildingIndex];
  if (!target) return;

  // Resolve every placeholder that originated from the same restored split group.
  // For unsplit buildings (no marker), the "siblings" array is just [target].
  const siblings = target._reloadGroup
    ? buildings.filter(b => b._reloadGroup === target._reloadGroup)
    : [target];

  setButtonLoading(loadFileBtn, true, t("models.browse.attaching"));
  setButtonLoading(reloadTilesetBtn, true, t("models.browse.attaching"));
  try {
    let tileset;
    if (dirHandle) {
      tileset = await loadTilesetFromDirectoryHandle(viewer, dirHandle, fileStatus);
    } else {
      tileset = await loadTilesetFromFiles(viewer, files, fileStatus);
    }
    for (const b of siblings) {
      b.tileset = tileset;
      b._tilesetMissing = false;
      delete b._reloadGroup;
      if (dirId) {
        b.directoryHandleId = dirId;
        b._directoryFolderName = dirName;
      }
    }
    tileset._buildings = siblings;
    if (dirId) {
      tileset._directoryHandleId = dirId;
      tileset._directoryFolderName = dirName;
    }
    lodFilter.addTileset(tileset);
    bindTilesetTileLoad(tileset);
    if (siblings[0].heightOffset !== 0) applyHeightOffset(tileset, siblings[0].heightOffset);
    for (const b of siblings) applyShapefileLayerHeights(b);
    applyFiltersForTileset(tileset);
    renderBuildingList();
    renderBuildingDetail();
  } catch (e) {
    fileStatus.textContent = "";
    alert(t("alert.failedLoad", { message: e.message }));
  } finally {
    setButtonLoading(loadFileBtn, false);
    setButtonLoading(reloadTilesetBtn, false);
  }
}

// -- Height offset --
function handleHeightChange(e) {
  const value = parseFloat(e.target.value) || 0;
  heightSlider.value = value;
  heightOffsetInput.value = value;
  const b = buildings[selectedBuildingIndex];
  if (!b) return;
  // Height offset is applied via tileset.modelMatrix, so siblings share it.
  const siblings = b.tileset?._buildings || [b];
  for (const sibling of siblings) sibling.heightOffset = value;
  applyHeightOffset(b.tileset, value);
  for (const sibling of siblings) applyShapefileLayerHeights(sibling);
}

function applyHeightOffset(tileset, offsetMeters) {
  if (!tileset) return;
  const center = tileset.boundingSphere.center;
  const cartographic = Cartographic.fromCartesian(center);
  const surface = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
  const offset = Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, offsetMeters);
  const translation = Cartesian3.subtract(offset, surface, new Cartesian3());
  tileset.modelMatrix = Matrix4.fromTranslation(translation);
}

init();
