import {
  Viewer,
  Ion,
  IonImageryProvider,
  OpenStreetMapImageryProvider,
  ArcGisMapServerImageryProvider,
  EllipsoidTerrainProvider,
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
  JulianDate,
  Color,
  ClippingPlane,
  ClippingPlaneCollection,
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
import { openImportReviewTray } from "./importReviewTray.js";
import { classifyImportFiles } from "./importPipeline.js";
import { openColorConfigDialog } from "./colorConfigDialog.js";
import { t, setLanguage, getLanguage, onLanguageChange, applyTranslationsToDom } from "./i18n.js";
import { groupFeaturesByFloor, matchLevelByText, levelNameToNumber, shortLevelName } from "./floorSplit.js";
import { resolveTilesetTopClipLocalZ } from "./levelClipping.js";
import {
  normalizeLevelRecords,
  recordsToLevelsData,
  sourceLevelGroupsFromInspection,
  levelsDataFromSourceLevelGroups,
  deserializeSourceLevelGroups,
} from "./levelMetadata.js";
import {
  serializeSession,
  parseSessionJson,
  downloadSessionJson,
  createSessionRestorePlan,
} from "./session.js";
import { notifyUser } from "./notifications.js";
import {
  chooseDefaultColorColumn,
  getLayerType,
  HEX_COLOR_RE,
  isColorConfigurableLayer,
  isSpaceLayerName,
} from "./layerColorConfig.js";
import {
  applyEntitiesContextState,
  applyEntityContextState,
} from "./contextGhosting.js";
import {
  CONTEXT_GHOST_COLOR,
  applyPlateauLayerStyle as applyPlateauLayerStyleImpl,
  clearPlateauFeatureOverrides,
  countPlateauOverrides,
  createPlateauFeatureSelection,
  findPlateauLayerForFeature,
  getPlateauOverrideMode,
  isPlateauLayer,
  listPlateauLayers,
  listPlateauOverrideEntries,
  pickThroughGhosts as pickThroughGhostsImpl,
  removePlateauFeatureOverride,
  restoreSerializedPlateauOverrides,
  serializePlateauOverrides,
  setPlateauFeatureOverride,
} from "./plateauOverrides.js";
import {
  findLayerParent as findLayerParentImpl,
} from "./sceneTreeView.js";
import { renderSceneTree } from "./sceneTreeRenderer.js";
import {
  initializeTerrainProviders as initTerrainProviders,
  switchImagery as switchImageryImpl,
  switchTerrain as switchTerrainImpl,
  applyUndergroundMode as applyUndergroundModeImpl,
} from "./cesiumInit.js";
import { restoreSession as restoreSessionImpl } from "./sessionRestore.js";
import { exportViewerPackage } from "./venueExport.js";
import { publishToServer } from "./venuePublish.js";
import { openPublishLinksDialog } from "./publishLinksDialog.js";
import { openSessionBackupsDialog, createAutoBackup } from "./sessionBackupsDialog.js";
import { renderVenuesPanel, promptVenueName } from "./venuePanel.js";
import {
  applyShapefileLayerHeight as applyShapefileLayerHeightImpl,
  applyShapefileLayerHeights as applyShapefileLayerHeightsImpl,
} from "./shapefilePlacement.js";

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
// Global model-level list, derived from the union of every building's levels by
// floor number (via levelNameToNumber). User edits to elevation/name are
// preserved across rebuilds. Drives the single global level selector that fans
// out to each building.
let modelLevels = []; // { floorNumber, name, elevation }
let activeModelLevelIndex = -1; // -1 = "All floors"
let venues = []; // [{ id, name, description, _expanded? }]
let activeVenueFilter = null; // venue id or null
let selectedPlateauFeature = null;
let plateauOverridesEnabled = true;

const layerTypeFilters = { space: true, unit: true, opening: true, detail: true, level: true };

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
const COLOR_CONFIG_SWATCHES = [...new Set([...SHP_COLORS, ...Object.values(COLOR2_LOOKUP)])];

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

// Transient module-scope state — short-lived flags that coordinate between
// async UI handlers. Grouped to keep their lifecycle visible at a glance.
const transient = {
  shpColorIdx: 0,
  shpPendingTarget: null,    // { buildingIndex } set by the building-row + button
  gdbBusy: false,            // serialize concurrent gdal3.js loads
  reloadTargetIndex: -1,

  // Search UI state
  searchQuery: "",
  searchResults: [],
  searchSelectedIndex: -1,
  searchOpen: false,
  // UI expansion state
  unassignedTreeExpanded: false,
  buildingsSectionExpanded: true,
  // Async coordination
  lodRefreshTimer: null,
  invalidatedRenderFrame: null,
  languageToggleInitialized: false,
  languageRerenderingBound: false,
  // Drag/click/popover coordination
  dragLayerCtx: null,
  lastClickedLayer: null,
  openPopoverCleanup: null,
};

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
const sceneFilterInput = document.getElementById("sceneFilter");
const sceneItemCountEl = document.getElementById("sceneItemCount");
const noScenePlaceholder = document.getElementById("noScenePlaceholder");
const addDataBtn = document.getElementById("addDataBtn");
const leftAddDataMenu = document.getElementById("leftAddDataMenu");
const urlLoadPopover = document.getElementById("urlLoadPopover");
const leftSettingsBtn = document.getElementById("leftSettingsBtn");
const leftSettingsPopover = document.getElementById("leftSettingsPopover");
const lodFilterToggle = document.getElementById("lodFilterToggle");
const lodFilterStatus = document.getElementById("lodFilterStatus");
const levelListEl = document.getElementById("levelList");
const venuesSectionBody = document.getElementById("venuesSectionBody");
const backupsBtn = document.getElementById("backupsBtn");
const exportViewerBtn = document.getElementById("exportViewerBtn");
const publishBtn = document.getElementById("publishBtn");
const shpInput = document.getElementById("shpInput");
const gdbInput = document.getElementById("gdbInput");
const gdbDirInput = document.getElementById("gdbDirInput");
const loadGdbZipBtn = document.getElementById("loadGdbZipBtn");
const loadGdbFolderBtn = document.getElementById("loadGdbFolderBtn");
const loadShpBtn = document.getElementById("loadShpBtn");
const floatingMenu = document.getElementById("floatingMenu");
const importDataBtn = document.getElementById("importDataBtn");
const importedLayersListEl = document.getElementById("importedLayersList");
const noImportedLayersMsg = document.getElementById("noImportedLayersMsg");
const loadCityGmlBtn = document.getElementById("loadCityGmlBtn");
const cityGmlInput = document.getElementById("cityGmlInput");
const cityGmlListEl = document.getElementById("cityGmlList");
const noCityGmlMsg = document.getElementById("noCityGmlMsg");
const splitConfirmDialog = document.getElementById("splitConfirmDialog");
const splitGroupCountEl = document.getElementById("splitGroupCount");
const splitGroupListEl = document.getElementById("splitGroupList");
const buildingOverlapToggle = document.getElementById("buildingOverlapToggle");
const plateauFloatingCard = document.getElementById("plateauFloatingCard");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingOverlayMessage = document.getElementById("loadingOverlayMessage");
const loadingOverlaySub = document.getElementById("loadingOverlaySubmessage");
const searchInput = document.getElementById("searchInput");
const searchDropdown = document.getElementById("searchDropdown");

let terrainProviders = { worldTerrainProvider: null, plateauTerrainProvider: null };
const savedGlobeBaseColorRef = { value: null };
const lodFilter = new LodFilter();
let autoBackupTimer = null;

function getE2eHook() {
  const hook = window.__CESIUM_E2E__;
  return hook && typeof hook === "object" ? hook : null;
}

function recordE2eEvent(name, payload = {}) {
  const hook = getE2eHook();
  if (!hook) return;
  hook.events = Array.isArray(hook.events) ? hook.events : [];
  hook.events.push({ name, payload, at: Date.now() });
  hook[name] = (hook[name] ?? 0) + 1;
}

function getLinkInspectionOptions() {
  const hook = getE2eHook();
  if (!hook) return {};
  const options = {};
  const safetyTimeoutMs = Number(hook.linkInspectionSafetyTimeoutMs);
  const tailTimeoutMs = Number(hook.linkInspectionTailTimeoutMs);
  if (Number.isFinite(safetyTimeoutMs) && safetyTimeoutMs > 0) {
    options.safetyTimeoutMs = safetyTimeoutMs;
  }
  if (Number.isFinite(tailTimeoutMs) && tailTimeoutMs > 0) {
    options.tailTimeoutMs = tailTimeoutMs;
  }
  return options;
}

// -- Initialize --
function init() {
  initLanguageToggle();

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

  switchTerrain();
  initializeTerrainProviders(savedToken);
  startAutoBackupTimer();

  saveSessionBtn.addEventListener("click", saveSession);
  backupsBtn?.addEventListener("click", () => openSessionBackupsDialog({
    getCurrentSession: buildSessionSnapshot,
    onRestore: restoreFromBackup,
  }));
  exportViewerBtn?.addEventListener("click", handleExportViewerPackage);
  publishBtn?.addEventListener("click", handlePublishToServer);
  loadSessionBtn.addEventListener("click", () => sessionInput.click());
  sessionInput.addEventListener("change", handleLoadSession);
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
  shpInput.addEventListener("change", handleShpSelect);
  gdbInput.addEventListener("change", handleGdbZipSelect);
  gdbDirInput.addEventListener("change", handleGdbDirSelect);
  loadGdbZipBtn.addEventListener("click", () => {
    if (transient.gdbBusy) return;
    gdbInput.click();
  });
  loadGdbFolderBtn.addEventListener("click", () => {
    if (transient.gdbBusy) return;
    gdbDirInput.click();
  });
  loadShpBtn.addEventListener("click", () => {
    // If a building is currently selected, mirror the right-click "Add
    // shapefiles" behavior and drop layers straight into it. Otherwise leave
    // the target unset — handleShpSelect will route to the unassigned bucket
    // so the user can drag layers onto whichever building they want.
    if (selectedBuildingIndex >= 0 && buildings[selectedBuildingIndex]) {
      transient.shpPendingTarget = { buildingIndex: selectedBuildingIndex };
    } else {
      transient.shpPendingTarget = { buildingIndex: -1 };
    }
    shpInput.click();
  });
  loadCityGmlBtn.addEventListener("click", () => cityGmlInput.click());
  cityGmlInput.addEventListener("change", handleCityGmlSelect);
  document.addEventListener("click", hideFloatingMenu);
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideFloatingMenu(); });
  // Clear layer selection when clicking outside any layer row, context menu, or popover.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".shp-tree-item")) return;
    if (e.target.closest(".floating-menu")) return;
    if (e.target.closest(".left-popover")) return;
    if (clearLayerSelection()) renderLevelList();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && clearLayerSelection()) renderLevelList();
  });
  buildingOverlapToggle.addEventListener("change", handleBuildingOverlapToggle);
  importDataBtn.addEventListener("click", () =>
    openImportDataModal(viewer, loadTilesetFromUrl, (layer) => {
      importedLayers.push(layer);
      renderImportedLayersList();
      invalidateAndRerender();
    }, {
      getPreferredImportPosition,
    })
  );

  invalidateAndRerender();
  renderImportedLayersList();
  initSectionCollapse();
  initPanelToggles();
  initThemeToggle();
  bindLanguageRerendering();
  initSearch();
  initHighlight();
  initInfoBoxStyling();
  initLeftActionBar();
  initSceneFilter();
  initLeftPanelResizer();
  initFileDropZone();
}

async function initializeTerrainProviders(savedToken) {
  terrainProviders = await initTerrainProviders(savedToken);
  switchTerrain();
}

function initLeftPanelResizer() {
  const resizer = document.getElementById("leftPanelResizer");
  if (!resizer) return;

  const MIN_W = 220;
  const MAX_W = 600;

  const saved = parseInt(localStorage.getItem("leftPanelWidth") || "", 10);
  if (Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W) {
    document.documentElement.style.setProperty("--panel-width", `${saved}px`);
  }

  let dragging = false;
  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
    document.body.classList.add("panel-resizing");
    e.preventDefault();
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const w = Math.min(MAX_W, Math.max(MIN_W, e.clientX));
    document.documentElement.style.setProperty("--panel-width", `${w}px`);
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { resizer.releasePointerCapture(e.pointerId); } catch { /* pointer already released — ignore */ }
    document.body.classList.remove("panel-resizing");
    const current = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--panel-width"),
      10
    );
    if (Number.isFinite(current)) {
      localStorage.setItem("leftPanelWidth", String(current));
    }
  };
  resizer.addEventListener("pointerup", stop);
  resizer.addEventListener("pointercancel", stop);
}

// Wires the left panel's action bar: + Add Data dropdown + settings gear.
// Each Add Data menu item dispatches to an existing handler (file input
// click or button click) — no new import logic is added here.
function initLeftActionBar() {
  if (!addDataBtn || !leftAddDataMenu) return;

  const positionPopover = (anchorBtn, popoverEl) => {
    const rect = anchorBtn.getBoundingClientRect();
    popoverEl.style.top = `${rect.bottom + 4}px`;
    popoverEl.style.left = `${rect.left}px`;
  };

  const closeAllLeftPopovers = () => {
    leftAddDataMenu.style.display = "none";
    if (urlLoadPopover) urlLoadPopover.style.display = "none";
    if (leftSettingsPopover) leftSettingsPopover.style.display = "none";
  };

  addDataBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = leftAddDataMenu.style.display !== "none";
    closeAllLeftPopovers();
    if (open) return;
    positionPopover(addDataBtn, leftAddDataMenu);
    leftAddDataMenu.style.display = "";
  });

  leftAddDataMenu.querySelectorAll("li[data-action]").forEach((li) => {
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = li.getAttribute("data-action");
      closeAllLeftPopovers();
      switch (action) {
        case "add-url":
          positionPopover(addDataBtn, urlLoadPopover);
          urlLoadPopover.style.display = "";
          urlInput.focus();
          urlInput.select();
          break;
        case "add-folder":
          loadFileBtn.click();
          break;
        case "add-citygml":
          loadCityGmlBtn.click();
          break;
        case "add-gdb-zip":
          loadGdbZipBtn.click();
          break;
        case "add-gdb-folder":
          loadGdbFolderBtn.click();
          break;
        case "add-shp":
          loadShpBtn.click();
          break;
        case "review-gdb":
          openGdbReassignDialog();
          break;
        case "add-catalog":
          importDataBtn.click();
          break;
      }
    });
  });

  if (leftSettingsBtn && leftSettingsPopover) {
    leftSettingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = leftSettingsPopover.style.display !== "none";
      closeAllLeftPopovers();
      if (open) return;
      // Right-align to the gear so the popover doesn't overflow the panel.
      const rect = leftSettingsBtn.getBoundingClientRect();
      leftSettingsPopover.style.top = `${rect.bottom + 4}px`;
      // Defer to measure width.
      leftSettingsPopover.style.display = "";
      leftSettingsPopover.style.left = `${Math.max(8, rect.right - leftSettingsPopover.offsetWidth)}px`;
    });
  }

  // Close popovers on outside click and Escape.
  document.addEventListener("click", (e) => {
    if (
      leftAddDataMenu.contains(e.target) ||
      (urlLoadPopover && urlLoadPopover.contains(e.target)) ||
      (leftSettingsPopover && leftSettingsPopover.contains(e.target)) ||
      addDataBtn.contains(e.target) ||
      (leftSettingsBtn && leftSettingsBtn.contains(e.target))
    ) {
      return;
    }
    closeAllLeftPopovers();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllLeftPopovers();
  });
  // After a tileset URL load attempt, hide the popover.
  if (loadUrlBtn && urlLoadPopover) {
    loadUrlBtn.addEventListener("click", () => {
      urlLoadPopover.style.display = "none";
    });
  }
}

function initSceneFilter() {
  if (!sceneFilterInput) return;
  sceneFilterInput.addEventListener("input", () => {
    renderLevelList();
    renderImportedLayersList();
  });
}

// Document-level drop zone: drop a .zip / .gdb folder anywhere on the app
// and route to the right importer. Per-row drops onto building / level rows
// in the scene tree go through dropFilesOnTarget below and preempt this.
function initFileDropZone() {
  let overlay = null;
  let depth = 0;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "appDropOverlay";
    overlay.innerHTML = `<div class="app-drop-overlay-message"></div>`;
    overlay.querySelector(".app-drop-overlay-message").textContent =
      t("drop.overlayMessage");
    document.body.appendChild(overlay);
    return overlay;
  }

  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files");
  }

  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    ensureOverlay().classList.add("visible");
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    if (depth > 0) depth--;
    if (depth === 0) overlay?.classList.remove("visible");
  });
  window.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay?.classList.remove("visible");
    const items = collectDroppedItems(e.dataTransfer);
    await routeDroppedFiles(items, null);
  });
}

// Collect dropped DataTransferItems synchronously so async file traversal
// has stable references. Returns either a `{ kind: "files", files: File[] }`
// for plain file drops, or `{ kind: "directory", entry }` when a folder
// was dropped (used for .gdb directories).
function collectDroppedItems(dataTransfer) {
  // Try to detect a single dropped directory via webkitGetAsEntry, which
  // only stays valid in this tick.
  for (const item of dataTransfer.items ?? []) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      return { kind: "directory", entry };
    }
  }
  return { kind: "files", files: Array.from(dataTransfer.files ?? []) };
}

// Route arriving files through the single classifier so file-picker
// buttons, drop-on-viewport, and drop-on-tree-row all share semantics.
// `defaults` carries optional { defaultBuildingIndex, defaultLevelKey }
// from the surface that triggered the import.
async function routeDroppedFiles(items, defaults) {
  const classified = classifyImportFiles(items);
  switch (classified.kind) {
    case "gdb-zip":
      await runGdbLoad(classified.file, defaults);
      return;
    case "gdb-dir-files":
      await runGdbLoad(classified.files, defaults);
      return;
    case "gdb-dir-entry": {
      const files = await flattenDirectoryEntry(classified.entry);
      if (files.length === 0) {
        notifyUser("warn", "drop.emptyFolder");
        return;
      }
      await runGdbLoad(files, defaults);
      return;
    }
    case "shp":
      await routeDroppedShapefile(classified.file, defaults);
      return;
    case "unsupported":
      if (classified.reason === "type") {
        notifyUser("warn", "drop.unsupportedType", { name: classified.name ?? "" });
      }
      return;
  }
}

async function flattenDirectoryEntry(rootEntry) {
  const out = [];
  async function visit(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file.relativePath = prefix + entry.name;
      out.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const childPrefix = prefix + entry.name + "/";
      // readEntries returns up to ~100 at a time; loop until empty.
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await visit(child, childPrefix);
      } while (batch.length > 0);
    }
  }
  await visit(rootEntry, "");
  return out;
}

async function routeDroppedShapefile(file, defaults) {
  const buildingIndex = defaults?.defaultBuildingIndex;
  const target = typeof buildingIndex === "number" && buildings[buildingIndex]
    ? { buildingIndex }
    : {};
  await runShpImport(file, target);
}

// Per-row drop handler delegated from the scene tree. Called for any
// [data-drop-target] element when the user releases dragged OS files.
async function dropFilesOnTarget(target, files, event) {
  void event;
  const items = { kind: "files", files: Array.from(files ?? []) };
  const defaults = {};
  if (target?.kind === "building" || target?.kind === "buildingLevel") {
    if (typeof target.bi === "number") defaults.defaultBuildingIndex = target.bi;
    if (target.levelKey != null) defaults.defaultLevelKey = target.levelKey;
  } else if (target?.kind === "modelLevel" && target.floorNumber != null) {
    // Resolve floor number to a building level on a best-effort basis once
    // the user picks a building in the tray.
    defaults.defaultLevelKey = null;
    defaults.defaultFloorNumber = target.floorNumber;
  }
  await routeDroppedFiles(items, defaults);
}

// Persist each panel section's collapsed state in localStorage keyed by the
// section title. Headers without the .collapsible class (e.g. the Scene tree)
// are skipped — those are always expanded. Defaults to expanded unless a
// previous value was stored.
function initSectionCollapse() {
  document.querySelectorAll(".panel-section").forEach((section) => {
    const header = section.querySelector(".panel-section-header.collapsible");
    if (!header) return;
    // Key by the section's stable id attribute (e.g. "importedLayersSection")
    // so renaming a translated header label does not reset the user's saved
    // collapsed state. Sections without an id contribute no persistence.
    const key = section.id ? `section:${section.id}:collapsed` : null;
    if (key && localStorage.getItem(key) === "1") {
      section.classList.add("collapsed");
    }
    header.addEventListener("click", () => {
      section.classList.toggle("collapsed");
      if (key) {
        if (section.classList.contains("collapsed")) {
          localStorage.setItem(key, "1");
        } else {
          localStorage.removeItem(key);
        }
      }
    });
  });
}

function initPanelToggles() {
  document.getElementById("leftPanelToggle").addEventListener("click", () => {
    document.body.classList.toggle("left-collapsed");
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
  if (transient.languageToggleInitialized) return;
  transient.languageToggleInitialized = true;
  document.getElementById("languageToggle").addEventListener("click", () => {
    setLanguage(getLanguage() === "ja" ? "en" : "ja");
    updateLanguageToggleLabel();
  });
}

function bindLanguageRerendering() {
  if (transient.languageRerenderingBound) return;
  transient.languageRerenderingBound = true;
  onLanguageChange(() => {
    invalidateAndRerender();
    renderImportedLayersList();
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

    const plateauLayer = findPlateauLayerForFeature(importedLayers, picked);
    if (plateauLayer) {
      selectPlateauFeature(plateauLayer, picked);
    } else {
      selectedPlateauFeature = null;
      renderPlateauFloatingCard();
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
    terrainProviders.worldTerrainProvider = await createWorldTerrainAsync();
  } catch (e) {
    console.warn("Failed to load terrain with new token:", e);
  }
  switchImagery();
  switchTerrain();
}

// -- Imagery / terrain (shared helpers in cesiumInit.js) --
async function switchImagery() {
  await switchImageryImpl(viewer, imagerySelect.value, { onAfterSwitch: applyUndergroundMode });
}

function switchTerrain() {
  switchTerrainImpl(viewer, terrainSelect.value, terrainProviders);
}

// -- PLATEAU manual feature overrides --
// Pure helpers and the override-style application live in plateauOverrides.js.
// What remains here is the wiring to module-scope state (importedLayers,
// selectedPlateauFeature, plateauOverridesEnabled, activeModelLevelIndex) and
// the DOM-bound floating card.

function getPlateauLayers() {
  return listPlateauLayers(importedLayers);
}

function hasPlateauLayers() {
  return getPlateauLayers().length > 0;
}

function isContextGhosted() {
  return activeModelLevelIndex >= 0;
}

function pickThroughGhosts(position) {
  return pickThroughGhostsImpl(position, {
    drillPick: (p) => viewer.scene.drillPick(p),
    layerForFeature: (feature) => findPlateauLayerForFeature(importedLayers, feature),
  });
}

function applyPlateauLayerStyle(layer) {
  applyPlateauLayerStyleImpl(layer, {
    overridesEnabled: plateauOverridesEnabled,
    contextGhosted: isContextGhosted(),
  });
}

function refreshAllPlateauOverrideStyles() {
  for (const layer of getPlateauLayers()) {
    applyPlateauLayerStyle(layer);
  }
}

function getPlateauOverrideCount() {
  return countPlateauOverrides(importedLayers);
}

function shouldShowPlateauToolsPanel() {
  return hasPlateauLayers() && (!!selectedPlateauFeature || getPlateauOverrideCount() > 0);
}

function selectPlateauFeature(layer, feature) {
  const selection = createPlateauFeatureSelection(layer, feature);
  if (!selection) return;
  selectedPlateauFeature = selection;
  renderPlateauFloatingCard();
}

function setSelectedPlateauOverride(mode) {
  const selected = selectedPlateauFeature;
  if (!selected) return;
  const layer = importedLayers.find((l) => l.id === selected.layerId) || selected.layer;
  if (!isPlateauLayer(layer)) return;
  if (!setPlateauFeatureOverride(layer, selected.featureKey, mode, selected.label)) return;

  applyPlateauLayerStyle(layer);
  renderPlateauFloatingCard();
}

function clearPlateauOverrides() {
  clearPlateauFeatureOverrides(importedLayers);
  refreshAllPlateauOverrideStyles();
  selectedPlateauFeature = null;
  renderPlateauFloatingCard();
}

function restorePlateauOverride(layerId, featureKey) {
  const layer = importedLayers.find((l) => l.id === layerId);
  if (!isPlateauLayer(layer)) return;
  removePlateauFeatureOverride(layer, featureKey);
  applyPlateauLayerStyle(layer);
  if (selectedPlateauFeature?.layerId === layerId && selectedPlateauFeature.featureKey === featureKey) {
    selectedPlateauFeature = null;
  }
  renderPlateauFloatingCard();
}

function updateBuildingOverlapToggle() {
  if (buildingOverlapToggle) buildingOverlapToggle.checked = plateauOverridesEnabled;
}

function handleBuildingOverlapToggle() {
  plateauOverridesEnabled = buildingOverlapToggle.checked;
  refreshAllPlateauOverrideStyles();
  renderPlateauFloatingCard();
}

// Populate the floating PLATEAU card. Visible whenever a feature is picked or
// at least one override exists; hidden otherwise. Replaces the old
// renderPlateauFeatureControls() which targeted the right panel.
function renderPlateauFloatingCard() {
  updateBuildingOverlapToggle();
  if (!plateauFloatingCard) return;

  const showTools = shouldShowPlateauToolsPanel();
  if (!showTools) {
    plateauFloatingCard.hidden = true;
    plateauFloatingCard.innerHTML = "";
    return;
  }
  plateauFloatingCard.hidden = false;
  plateauFloatingCard.innerHTML = "";

  // Header with title + close
  const header = document.createElement("div");
  header.className = "card-header";
  const title = document.createElement("span");
  title.textContent = t("plateau.manualTitle");
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.className = "card-close-btn";
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.title = t("modal.close");
  closeBtn.addEventListener("click", () => {
    selectedPlateauFeature = null;
    renderPlateauFloatingCard();
  });
  header.appendChild(closeBtn);
  plateauFloatingCard.appendChild(header);

  const selected = selectedPlateauFeature;
  if (selected) {
    const layer = importedLayers.find((l) => l.id === selected.layerId) || selected.layer;
    const mode = getPlateauOverrideMode(layer, selected.featureKey);

    const nameDiv = document.createElement("div");
    nameDiv.className = "plateau-feature-name";
    nameDiv.textContent = selected.label || selected.featureKey;
    nameDiv.title = selected.featureKey;
    plateauFloatingCard.appendChild(nameDiv);

    const actions = document.createElement("div");
    actions.className = "plateau-feature-actions";
    const mkBtn = (labelKey, modeValue) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "secondary-btn compact";
      b.textContent = t(labelKey);
      b.classList.toggle("active", mode === modeValue);
      b.addEventListener("click", () => setSelectedPlateauOverride(modeValue));
      return b;
    };
    actions.appendChild(mkBtn("plateau.transparent", "ghost"));
    actions.appendChild(mkBtn("plateau.hideFeature", "hidden"));
    actions.appendChild(mkBtn("plateau.visible", null));
    plateauFloatingCard.appendChild(actions);
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-msg";
    empty.textContent = t("plateau.noFeatureSelected");
    plateauFloatingCard.appendChild(empty);
  }

  // Overrides list
  const overridesHeader = document.createElement("div");
  overridesHeader.className = "plateau-overrides-header";
  const overridesTitle = document.createElement("span");
  overridesTitle.textContent = t("plateau.overridesTitle");
  overridesHeader.appendChild(overridesTitle);
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "secondary-btn compact";
  clearBtn.textContent = t("plateau.clearAll");
  clearBtn.addEventListener("click", clearPlateauOverrides);
  overridesHeader.appendChild(clearBtn);
  plateauFloatingCard.appendChild(overridesHeader);

  const overridesList = document.createElement("ul");
  overridesList.id = "plateauOverrideList";
  let count = 0;
  for (const { layer, featureKey, entry } of listPlateauOverrideEntries(importedLayers)) {
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
    overridesList.appendChild(li);
  }
  plateauFloatingCard.appendChild(overridesList);

  if (count === 0) {
    const emptyOverrides = document.createElement("p");
    emptyOverrides.className = "empty-msg";
    emptyOverrides.textContent = t("plateau.noOverrides");
    plateauFloatingCard.appendChild(emptyOverrides);
  }
  clearBtn.disabled = count === 0;
}

// -- LOD filter --
function handleLodFilterToggle() {
  if (!lodFilterToggle.checked && transient.lodRefreshTimer) {
    clearTimeout(transient.lodRefreshTimer);
    transient.lodRefreshTimer = null;
  }
  lodFilter.toggle(lodFilterToggle.checked);
  updateLodFilterStatus();
}

function refreshLodFilterIfEnabled() {
  if (!lodFilterToggle.checked) {
    updateLodFilterStatus();
    return;
  }
  lodFilter.apply();
  updateLodFilterStatus();
}

function scheduleLodFilterRefresh() {
  if (!lodFilterToggle.checked || transient.lodRefreshTimer) return;
  transient.lodRefreshTimer = setTimeout(() => {
    transient.lodRefreshTimer = null;
    refreshLodFilterIfEnabled();
  }, 250);
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
function cleanupUntrackedTileset(tileset) {
  if (!tileset) return;
  const isTracked =
    buildings.some((b) => b.tileset === tileset) ||
    importedLayers.some((layer) => layer.type === "tileset" && layer.data === tileset);
  if (isTracked) return;
  lodFilter.removeTileset(tileset);
  removeCurrentTileset(viewer, tileset);
}

async function handleLoadUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  setButtonLoading(loadUrlBtn, true, t("models.loadUrl.loading"));
  let tileset = null;
  try {
    const levelsData = await detectLevelsFromUrl(url);
    tileset = await loadTilesetFromUrl(viewer, url);
    const name = url.split("/").filter(Boolean).pop() || url;
    await addBuilding(tileset, name, levelsData, url);
  } catch (e) {
    cleanupUntrackedTileset(tileset);
    notifyUser("error", "alert.failedLoad", { message: e.message });
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
    let tileset = null;
    try {
      const files = await getFilesFromDirectoryHandle(dirHandle);
      const levelsData = await detectLevelsFromFiles(files);
      tileset = await loadTilesetFromFiles(viewer, files, fileStatus);
      const name = dirHandle.name || "Local tileset";
      await addBuilding(tileset, name, levelsData, null, dirId, dirHandle.name);
    } catch (e) {
      cleanupUntrackedTileset(tileset);
      fileStatus.textContent = "";
      notifyUser("error", "alert.failedLoad", { message: e.message });
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

  transient.reloadTargetIndex = selectedBuildingIndex;
  fileInput.click();
}

// -- Load from file picker --
async function handleFileSelect(e) {
  const files = e.target.files;
  if (!files.length) {
    fileInput.value = "";
    return;
  }

  if (transient.reloadTargetIndex !== -1) {
    const targetIdx = transient.reloadTargetIndex;
    transient.reloadTargetIndex = -1;
    await attachTilesetToBuilding(targetIdx, files);
    fileInput.value = "";
    return;
  }

  setButtonLoading(loadFileBtn, true, t("models.browse.loading"));
  let tileset = null;
  try {
    const levelsData = await detectLevelsFromFiles(files);
    tileset = await loadTilesetFromFiles(viewer, files, fileStatus);
    const firstPath = files[0].webkitRelativePath || files[0].relativePath || files[0].name;
    const name = firstPath.split("/")[0] || "Local tileset";
    await addBuilding(tileset, name, levelsData, null);
  } catch (e) {
    cleanupUntrackedTileset(tileset);
    fileStatus.textContent = "";
    notifyUser("error", "alert.failedLoad", { message: e.message });
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
    venueId: null,
    _expanded: true,
  };
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
    scheduleLodFilterRefresh();
  });
}

async function addBuilding(tileset, name, levelsData, sourceUrl = null, directoryHandleId = null, directoryFolderName = null) {
  lodFilter.addTileset(tileset);
  const explicitLevelsData = normalizeLevelRecords(levelsData?.levels ?? []).length
    ? levelsData
    : null;
  let levelBaseElevation = computeLevelBaseElevation(tileset, explicitLevelsData);
  tileset._directoryHandleId = directoryHandleId;
  tileset._directoryFolderName = directoryFolderName;

  // Detect Revit link split before showing the building in the list
  let inspection = null;
  let split = null;
  let sourceLevelGroups = new Map();
  let inspectedLevelsData = null;
  try {
    inspection = await inspectLinks(tileset, getLinkInspectionOptions());
    recordE2eEvent("linkInspectionComplete", {
      tilesInspected: inspection.tilesInspected,
      featuresInspected: inspection.featuresInspected,
    });
    sourceLevelGroups = sourceLevelGroupsFromInspection(inspection);
    inspectedLevelsData = levelsDataFromSourceLevelGroups(sourceLevelGroups);
    if (!explicitLevelsData && inspectedLevelsData) {
      levelBaseElevation = computeLevelBaseElevation(tileset, inspectedLevelsData);
    }
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
      const filteredLevelsData = explicitLevelsData
        ? { ...explicitLevelsData, levels: explicitLevelsData.levels.filter(l => entry.levelNames.has(l.levelName)) }
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
    const wholeTilesetLevelsData = explicitLevelsData ?? inspectedLevelsData;
    if (wholeTilesetLevelsData) populateLevelsForBuilding(b, wholeTilesetLevelsData);
    buildings.push(b);
    tileset._buildings = [b];
    createdBuildings = [b];
  }

  bindTilesetTileLoad(tileset);
  applyFiltersForTileset(tileset);
  refreshLodFilterIfEnabled();

  selectedBuildingIndex = buildings.indexOf(createdBuildings[0]);
  invalidateAndRerender();
  recordE2eEvent("buildingRegistered", {
    name,
    buildingCount: buildings.length,
  });

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

  invalidateAndRerender();
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
  invalidateAndRerender();
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
  rebuildModelLevels();
  invalidateAndRerender();
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
  clearUnassignedLayers(false);
  selectedBuildingIndex = -1;
  activeModelLevelIndex = -1;
  rebuildModelLevels();
  fileStatus.textContent = "";
  invalidateAndRerender();
}

function syncRemoveAllBtnAndLod() {
  updateLodFilterStatus();
}

function renderImportedLayersList() {
  importedLayersListEl.innerHTML = "";
  const filterRaw = (sceneFilterInput?.value ?? "").trim().toLowerCase();
  const visibleLayers = filterRaw
    ? importedLayers.filter(l => (l.label ?? l.name ?? "").toLowerCase().includes(filterRaw))
    : importedLayers;
  noImportedLayersMsg.style.display = visibleLayers.length === 0 ? "block" : "none";

  visibleLayers.forEach((layer) => {
    const i = importedLayers.indexOf(layer);
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
      applyImportedLayerLevelContext(layer);
      invalidateAndRerender();
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
    invalidateAndRerender();
  }
}

function clearImportedLayers(rerender = true) {
  for (let i = importedLayers.length - 1; i >= 0; i--) {
    removeImportedLayer(i, false);
  }
  selectedPlateauFeature = null;
  if (rerender) {
    renderImportedLayersList();
    invalidateAndRerender();
  }
}

function clearUnassignedLayers(rerender = true) {
  for (const layer of unassignedLayers.splice(0)) {
    if (layer.dataSource) viewer.dataSources.remove(layer.dataSource, true);
  }
  transient.unassignedTreeExpanded = false;
  clearLayerSelection();
  if (rerender) invalidateAndRerender();
}

// -- Levels --
function populateLevelsForBuilding(building, data) {
  building.levels = [];
  for (const l of normalizeLevelRecords(data?.levels ?? [])) {
    building.levels.push({
      name: l.name,
      key: l.key,
      floor: l.floor,
    });
  }
  // levels.json is ordered bottom→top; sort defensively by floor elevation
  building.levels.sort((a, b) => a.floor - b.floor);
  building.activeLevelIndex = -1;
  rebuildModelLevels();
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
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // levels.json is optional — tilesets without it use auto-detected levels.
    return null;
  }
}

function handleAddLevel(building, name, floor) {
  if (!building) return;
  if (!name || !Number.isFinite(floor)) return;
  building.levels.push({ name, key: null, floor });
  building.levels.sort((a, b) => a.floor - b.floor);
  rebuildModelLevels();
  invalidateAndRerender();
}

// Rebuild the global modelLevels list from the union of all buildings' levels
// by floor number. Preserves any user-edited name/elevation across rebuilds.
// Clamps activeModelLevelIndex if it now points past the end.
function rebuildModelLevels() {
  const preserved = new Map(modelLevels.map(m => [m.floorNumber, m]));
  const seen = new Map(); // floorNumber → derived defaults
  for (const b of buildings) {
    if (!b.levels) continue;
    for (const lvl of b.levels) {
      const fn = levelNameToNumber(lvl.name);
      if (fn == null) continue;
      if (!seen.has(fn)) {
        seen.set(fn, {
          name: shortLevelName(lvl.name),
          elevation: (b.levelBaseElevation ?? 0) + (lvl.floor ?? 0),
        });
      }
    }
  }
  const next = [];
  for (const [fn, derived] of seen) {
    const existing = preserved.get(fn);
    next.push(existing
      ? { floorNumber: fn, name: existing.name, elevation: existing.elevation }
      : { floorNumber: fn, name: derived.name, elevation: derived.elevation });
  }
  next.sort((a, b) => a.floorNumber - b.floorNumber);
  modelLevels = next;
  if (activeModelLevelIndex >= modelLevels.length) activeModelLevelIndex = -1;
}

// Set the global active model level and fan out to each building's
// activeLevelIndex by floor-number match. Buildings without a matching level
// fall back to -1 (no per-building filter for them).
function selectModelLevel(modelLevelIndex) {
  activeModelLevelIndex = modelLevelIndex;
  if (modelLevelIndex < 0) {
    for (const b of buildings) {
      if (b.activeLevelIndex !== -1) {
        b.activeLevelIndex = -1;
        applyActiveLevelForBuilding(b);
      }
    }
  } else {
    const targetFn = modelLevels[modelLevelIndex]?.floorNumber;
    for (const b of buildings) {
      let matchIdx = -1;
      if (targetFn != null) {
        matchIdx = b.levels.findIndex(l => levelNameToNumber(l.name) === targetFn);
      }
      if (b.activeLevelIndex !== matchIdx) {
        b.activeLevelIndex = matchIdx;
        applyActiveLevelForBuilding(b);
      }
    }
  }
  invalidateAndRerender();
}

// Wrapper preserved for existing UI call sites. Maps a per-building level
// click to its floor number and updates the global model level.
function selectLevel(buildingIndex, levelIndex) {
  const source = buildings[buildingIndex];
  if (!source) return;
  selectedBuildingIndex = buildingIndex;
  if (levelIndex === -1) {
    selectModelLevel(-1);
    return;
  }
  const lvl = source.levels[levelIndex];
  if (!lvl) return;
  const fn = levelNameToNumber(lvl.name);
  if (fn == null) {
    // Unmappable level (no floor-number synonym): apply per-building only.
    source.activeLevelIndex = levelIndex;
    applyActiveLevelForBuilding(source);
    invalidateAndRerender();
    return;
  }
  const mli = modelLevels.findIndex(m => m.floorNumber === fn);
  if (mli === -1) {
    rebuildModelLevels();
    const mli2 = modelLevels.findIndex(m => m.floorNumber === fn);
    if (mli2 === -1) return;
    selectModelLevel(mli2);
    return;
  }
  selectModelLevel(mli);
}

function applyActiveLevelForBuilding(building) {
  if (!building.tileset) return;
  applyFiltersForTileset(building.tileset);
  applyLevelToShapefilesForBuilding(building);
}

function activeModelFloorNumber() {
  return activeModelLevelIndex < 0
    ? null
    : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;
}

function applyLevelTopClipForTileset(tileset) {
  if (!tileset) return;
  const clipZ = resolveTilesetTopClipLocalZ(
    tileset._buildings || [],
    activeModelFloorNumber(),
  );
  const existing = tileset._levelTopClippingPlanes;

  if (clipZ == null) {
    if (existing) existing.enabled = false;
    return;
  }

  if (!existing) {
    const plane = new ClippingPlane(new Cartesian3(0, 0, -1), clipZ);
    const clippingPlanes = new ClippingPlaneCollection({
      planes: [plane],
      edgeWidth: 0,
    });
    tileset._levelTopClipPlane = plane;
    tileset._levelTopClippingPlanes = clippingPlanes;
    tileset.clippingPlanes = clippingPlanes;
    return;
  }

  if (tileset.clippingPlanes !== existing) {
    tileset.clippingPlanes = existing;
  }
  existing.enabled = true;
  const plane = tileset._levelTopClipPlane || existing.get(0);
  plane.normal = new Cartesian3(0, 0, -1);
  plane.distance = clipZ;
  tileset._levelTopClipPlane = plane;
}

function applyLevelClippingForAllTilesets() {
  const seen = new Set();
  for (const building of buildings) {
    const tileset = building.tileset;
    if (!tileset || seen.has(tileset)) continue;
    seen.add(tileset);
    applyLevelTopClipForTileset(tileset);
  }
}



function isUndergroundActive() {
  if (activeModelLevelIndex < 0) return false;
  const ml = modelLevels[activeModelLevelIndex];
  return !!ml && ml.floorNumber < 0;
}

function applyLevelContextVisibility() {
  applyLevelClippingForAllTilesets();
  applyUndergroundMode();
}

function applyUndergroundMode() {
  applyUndergroundModeImpl(viewer, {
    isUndergroundActive,
    savedGlobeBaseColorRef,
    onContextGhosting: applyContextGhostingForAllLayers,
  });
}

function applyDataSourceContextGhosting(dataSource, ghosted, layerVisible = true) {
  applyEntitiesContextState(dataSource?.entities?.values, {
    ghosted,
    ghostStyle: CONTEXT_GHOST_COLOR,
    layerVisible,
  });
}

function applyGenericTilesetContextGhosting(layer, ghosted) {
  if (!layer?.data || isPlateauLayer(layer)) return;
  disableImportedTilesetLevelClip(layer.data);
  if (!layer._contextOriginalStyleCaptured) {
    layer._contextOriginalStyle = layer.data.style;
    layer._contextOriginalStyleCaptured = true;
  }
  layer.data.style = ghosted
    ? new Cesium3DTileStyle({ color: 'color("white", 0.18)' })
    : layer._contextOriginalStyle;
  layer.data.makeStyleDirty?.();
}

function disableImportedTilesetLevelClip(tileset) {
  const existing = tileset?._levelTopClippingPlanes;
  if (existing) existing.enabled = false;
}

function applyImportedLayerLevelContext(layer) {
  const ghosted = isContextGhosted();
  if (isPlateauLayer(layer)) {
    if (layer.data) layer.data.show = !!layer.visible && !isUndergroundActive();
    disableImportedTilesetLevelClip(layer.data);
    applyPlateauLayerStyle(layer);
    return;
  }
  if (layer?.type === "datasource" && layer.data) {
    layer.data.show = !!layer.visible;
    applyDataSourceContextGhosting(layer.data, ghosted, layer.visible);
  } else if (layer?.type === "entities" && Array.isArray(layer.data)) {
    applyEntitiesContextState(layer.data, {
      ghosted,
      ghostStyle: CONTEXT_GHOST_COLOR,
      layerVisible: layer.visible,
    });
  } else if (layer?.type === "tileset" && layer.data) {
    layer.data.show = !!layer.visible;
    applyGenericTilesetContextGhosting(layer, ghosted);
  }
}

function applyContextGhostingForAllLayers() {
  for (const layer of importedLayers) applyImportedLayerLevelContext(layer);
  for (const layer of cityGmlLayers) applyCityGmlLayerContextGhosting(layer);
}

function cityGmlPolygonToHierarchy(polygon) {
  const positions = Cartesian3.fromDegreesArrayHeights(polygon.positions.flat());
  const holes = (polygon.holes ?? []).map(
    hole => new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(hole.flat()))
  );
  return new PolygonHierarchy(positions, holes);
}

function applyCityGmlLayerContextGhosting(layer) {
  const ghosted = isContextGhosted();
  for (const item of layer.entities ?? []) {
    item.entity.polygon.hierarchy = new ConstantProperty(cityGmlPolygonToHierarchy(item.polygon));
    applyEntityContextState(item.entity, {
      ghosted,
      ghostStyle: CONTEXT_GHOST_COLOR,
      layerVisible: true,
    });
  }
}

function applyFiltersForTileset(tileset) {
  if (!tileset) return;
  applyLevelTopClipForTileset(tileset);
  if (!tileset.root) return;
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
function getFeatureFloorNumber(building, lvlName) {
  if (lvlName == null) return null;
  const cache = building._levelNameToFloor ??= new Map();
  if (cache.has(lvlName)) return cache.get(lvlName);
  const fn = levelNameToNumber(lvlName);
  cache.set(lvlName, fn);
  return fn;
}

function applyFiltersToContent(tileset, content) {
  const count = content?.featuresLength ?? 0;
  if (count === 0) return;

  const siblings = tileset._buildings || [];
  if (siblings.length === 0) return;

  const linkProperty = siblings[0]?.linkFilter?.property ?? null;
  const activeFn = activeModelLevelIndex < 0
    ? null
    : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;

  const states = siblings.map(b => ({
    building: b,
    linkValue: b.linkFilter?.value ?? null,
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
    if (activeFn === null) {
      // "All floors" — show everything.
      feature.show = true;
    } else {
      const lvl = feature.getProperty("levelName");
      const cat = feature.getProperty("category");
      if (lvl === "Unassigned" && cat === "Mass") {
        feature.show = false;
      } else {
        const fn = getFeatureFloorNumber(owning.building, lvl);
        if (fn == null) feature.show = false; // unmappable → hidden when filtering
        else if (fn <= activeFn && cat === "Ceilings") feature.show = false;
        else feature.show = fn <= activeFn;
      }
    }
  }
}

function applyLevelToShapefilesForBuilding(building) {
  const activeFn = activeModelLevelIndex < 0
    ? null
    : modelLevels[activeModelLevelIndex]?.floorNumber ?? null;
  for (const layer of building.shapefileLayers) {
    if (layer._hidden) {
      layer.dataSource.show = false;
      continue;
    }
    const lType = getLayerType(layer.name);
    if (lType && !layerTypeFilters[lType]) {
      layer.dataSource.show = false;
      continue;
    }
    if (activeFn === null) {
      layer.dataSource.show = true;
      continue;
    }
    if (layer.levelKey == null) {
      // Unassigned shapefiles only show on "All floors".
      layer.dataSource.show = false;
      continue;
    }
    const lvl = building.levels.find(l => (l.key ?? "") === layer.levelKey);
    const fn = lvl ? levelNameToNumber(lvl.name) : null;
    layer.dataSource.show = fn === activeFn;
  }
}

// Apply the user-controlled hide flag for a single layer. For
// building-attached layers, run the full per-building filter so the level
// rule still combines correctly. For global unassigned-bucket layers, just
// toggle dataSource.show directly.
function applyLayerVisibility(building, layer) {
  if (building) {
    applyLevelToShapefilesForBuilding(building);
  } else if (layer.dataSource) {
    const lType = getLayerType(layer.name);
    const typeHidden = lType && !layerTypeFilters[lType];
    layer.dataSource.show = !layer._hidden && !typeHidden;
  }
}

function refreshAllLayerTypeVisibility() {
  for (const b of buildings) {
    applyLevelToShapefilesForBuilding(b);
  }
  for (const l of unassignedLayers) {
    const lType = getLayerType(l.name);
    const typeHidden = lType && !layerTypeFilters[lType];
    if (l.dataSource) l.dataSource.show = !l._hidden && !typeHidden;
  }
}

function handleLayerTypeToggle(type) {
  layerTypeFilters[type] = !layerTypeFilters[type];
  refreshAllLayerTypeVisibility();
  invalidateAndRerender();
}

function applyShapefileLayerHeight(building, layer) {
  applyShapefileLayerHeightImpl(building, layer, { viewer });
}

function applyShapefileLayerHeights(building) {
  applyShapefileLayerHeightsImpl(building, { viewer });
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

// Module-level drag state. dataTransfer can't read its payload during
// dragover (only on drop), so the source row is stashed in transient.dragLayerCtx instead.

// Multi-select state. _selectedLayers holds layer object references (which
// survive renderLevelList() rebuilds). transient.lastClickedLayer is the anchor for
// Shift+click range selection.
const _selectedLayers = new Set();

function clearLayerSelection() {
  if (_selectedLayers.size === 0 && transient.lastClickedLayer == null) return false;
  _selectedLayers.clear();
  transient.lastClickedLayer = null;
  return true;
}

function setSingleLayerSelection(layer) {
  _selectedLayers.clear();
  _selectedLayers.add(layer);
}

function toggleLayerSelection(layer) {
  if (_selectedLayers.has(layer)) _selectedLayers.delete(layer);
  else _selectedLayers.add(layer);
}

function selectLayerRange(target) {
  // DOM order gives us the visible sequence of rows. Use __layerRef which we
  // stash on each .shp-tree-item at render time.
  const visible = Array.from(document.querySelectorAll(".shp-tree-item"))
    .map((el) => el.__layerRef)
    .filter(Boolean);
  const anchor = transient.lastClickedLayer && visible.includes(transient.lastClickedLayer)
    ? transient.lastClickedLayer
    : visible[0];
  const i1 = visible.indexOf(anchor);
  const i2 = visible.indexOf(target);
  if (i1 < 0 || i2 < 0) {
    setSingleLayerSelection(target);
    return;
  }
  const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
  _selectedLayers.clear();
  for (let i = lo; i <= hi; i++) _selectedLayers.add(visible[i]);
}

// Find a layer's current parent (buildingIndex or "unassigned").
function findLayerParent(layer) {
  return findLayerParentImpl(buildings, unassignedLayers, layer);
}

// Convert the current selection into drag entries (each with fromBi).
function buildDragEntriesFromSelection() {
  const out = [];
  for (const layer of _selectedLayers) {
    const fromBi = findLayerParent(layer);
    if (fromBi == null) continue;
    out.push({ layer, fromBi });
  }
  return out;
}

// Re-render the four UI surfaces that need to refresh after any state change
// touching buildings, levels, imported layers, or PLATEAU overrides. Prefer
// this over calling the individual render functions to avoid drift between
// call sites. requestAnimationFrame coalesces bursts from drag/drop, sliders,
// session restore, and language changes into one paint.
function invalidateAndRerender() {
  if (transient.invalidatedRenderFrame != null) return;
  transient.invalidatedRenderFrame = requestAnimationFrame(() => {
    transient.invalidatedRenderFrame = null;
    renderInvalidatedSurfaces();
  });
}

function renderInvalidatedSurfaces() {
  renderVenuesSection();
  renderLevelList();
  syncRemoveAllBtnAndLod();
  renderPlateauFloatingCard();
  applyLevelContextVisibility();
}

function getBuildingsForSceneTree() {
  if (!activeVenueFilter) return buildings;
  return buildings.filter((b) => b.venueId === activeVenueFilter);
}

function renderVenuesSection() {
  renderVenuesPanel({
    container: venuesSectionBody,
    venues,
    buildings,
    activeVenueFilter,
    onAddVenue: handleAddVenue,
    onUpdateVenue: () => {
      renderVenuesSection();
      invalidateAndRerender();
    },
    onDeleteVenue: handleDeleteVenue,
    onToggleBuildingAssignment: (building, venueId, assigned) => {
      building.venueId = assigned ? venueId : null;
      invalidateAndRerender();
      renderVenuesSection();
    },
    onSetVenueFilter: (venueId) => {
      activeVenueFilter = venueId;
      renderVenuesSection();
      invalidateAndRerender();
    },
    onExportViewer: handleExportViewerPackage,
  });
}

function renderLevelList() {
  const filterRaw = (sceneFilterInput?.value ?? "").trim().toLowerCase();

  renderSceneTree({
    container: levelListEl,
    buildings: getBuildingsForSceneTree(),
    importedLayers,
    unassignedLayers,
    modelLevels,
    selection: {
      filterRaw,
      activeModelLevelIndex,
      selectedBuildingIndex,
      selectedLayers: _selectedLayers,
      unassignedTreeExpanded: transient.unassignedTreeExpanded,
      buildingsSectionExpanded: transient.buildingsSectionExpanded,
    },
    callbacks: getSceneTreeCallbacks(),
    itemCountEl: sceneItemCountEl,
    placeholderEl: noScenePlaceholder,
    layerTypeFiltersEl: document.getElementById("layerTypeFilters"),
    layerTypeFilters,
    onToggleLayerType: handleLayerTypeToggle,
  });
}

function getSceneTreeCallbacks() {
  return {
    t,
    selectModelLevel,
    toggleModelLevelExpanded,
    toggleUnassignedExpanded,
    toggleBuildingsSection,
    toggleBuildingExpanded,
    selectBuilding,
    zoomBuilding: zoomToBuilding,
    removeBuilding: handleRemoveBuilding,
    reloadBuilding: handleSceneTreeReloadBuilding,
    selectLevel,
    showModelLevelContextMenu,
    showBuildingContextMenu: handleSceneTreeBuildingContextMenu,
    showLevelContextMenu: handleSceneTreeLevelContextMenu,
    selectLayer: handleSceneTreeLayerSelect,
    toggleLayerVisibility: handleSceneTreeLayerVisibility,
    removeLayer: handleSceneTreeLayerRemove,
    showLayerContextMenu: handleSceneTreeLayerContextMenu,
    openLayerFloorPicker: handleSceneTreeOpenLayerFloorPicker,
    startLayerDrag: handleSceneTreeLayerDragStart,
    endLayerDrag: handleSceneTreeLayerDragEnd,
    dropWouldBeNoop,
    dropLayer: handleSceneTreeLayerDrop,
    dropFilesOnTarget,
  };
}

function toggleModelLevelExpanded(modelLevelIndex) {
  const level = modelLevels[modelLevelIndex];
  if (!level) return;
  level._expanded = !level._expanded;
  renderLevelList();
}

function toggleUnassignedExpanded() {
  transient.unassignedTreeExpanded = !transient.unassignedTreeExpanded;
  renderLevelList();
}

function toggleBuildingsSection() {
  transient.buildingsSectionExpanded = !transient.buildingsSectionExpanded;
  renderLevelList();
}

function toggleBuildingExpanded(buildingIndex) {
  const building = buildings[buildingIndex];
  if (!building?.levels?.length) return;
  building._expanded = !(building._expanded !== false);
  renderLevelList();
}

function handleSceneTreeReloadBuilding(buildingIndex) {
  selectedBuildingIndex = buildingIndex;
  handleReloadTilesetClick();
}

function handleSceneTreeBuildingContextMenu(event, buildingIndex) {
  const building = buildings[buildingIndex];
  if (!building) return;
  showBuildingContextMenu(event, building, buildingIndex);
}

function handleSceneTreeLevelContextMenu(event, buildingIndex, levelIndex) {
  const building = buildings[buildingIndex];
  if (!building) return;
  showLevelContextMenu(event, building, buildingIndex, levelIndex);
}

function handleSceneTreeLayerSelect({ layer, buildingIndex }, event) {
  if (!layer) return;
  if (event.shiftKey) {
    selectLayerRange(layer);
    event.preventDefault();
  } else if (event.ctrlKey || event.metaKey) {
    toggleLayerSelection(layer);
    transient.lastClickedLayer = layer;
    event.preventDefault();
  } else {
    setSingleLayerSelection(layer);
    transient.lastClickedLayer = layer;
    if (typeof buildingIndex === "number" && buildingIndex >= 0) {
      selectedBuildingIndex = buildingIndex;
    }
  }
  renderLevelList();
}

function handleSceneTreeLayerVisibility({ layer, buildingIndex }) {
  if (!layer) return;
  const building = typeof buildingIndex === "number" ? buildings[buildingIndex] : null;
  layer._hidden = !layer._hidden;
  applyLayerVisibility(building, layer);
  invalidateAndRerender();
}

function handleSceneTreeLayerRemove({ layer, buildingIndex }) {
  if (!layer) return;
  if (typeof buildingIndex === "number") {
    const building = buildings[buildingIndex];
    if (building) removeShapefileLayer(building, layer);
  } else {
    removeUnassignedLayer(layer);
  }
}

function handleSceneTreeLayerContextMenu(event, { layer, buildingIndex }) {
  if (!layer) return;
  if (typeof buildingIndex === "number") {
    const building = buildings[buildingIndex];
    if (building) showMoveToFloorMenu(event, building, layer);
  } else {
    showMoveUnassignedToBuildingMenu(event, layer);
  }
}

function handleSceneTreeLayerDragStart({ event, row, layer, fromBi }) {
  if (!layer) return;
  const entries = _selectedLayers.has(layer) && _selectedLayers.size > 1
    ? buildDragEntriesFromSelection()
    : [{ layer, fromBi }];
  transient.dragLayerCtx = { entries };
  row?.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  try {
    event.dataTransfer.setData(
      "text/plain",
      entries.length > 1 ? `${entries.length} layers` : (layer.name ?? "layer"),
    );
  } catch { /* some browsers reject setData under unusual drag conditions — non-fatal */ }
}

function handleSceneTreeLayerDragEnd({ row }) {
  row?.classList.remove("dragging");
  transient.dragLayerCtx = null;
  levelListEl.querySelectorAll(".drop-target-active").forEach((el) => {
    el.classList.remove("drop-target-active");
  });
}

// Floating context menu that lets the user transfer an unassigned layer to a
// specific building and floor.
function showMoveUnassignedToBuildingMenu(event, layer) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");
  appendConfigureColorsMenuItem(ul, layer);
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

// True when every dragged entry already lives at the proposed target — drop
// would be a no-op, so we don't preventDefault on dragover and the cursor
// shows the "not allowed" icon.
function dropWouldBeNoop(target) {
  if (!target) return true;
  if (!transient.dragLayerCtx) return true;
  const entries = transient.dragLayerCtx.entries;
  if (target.kind === "unassigned") {
    return entries.every((e) => e.fromBi === "unassigned");
  }
  if (target.kind === "modelLevel") {
    return entries.every((e) => {
      if (e.fromBi === "unassigned") return false;
      const b = buildings[e.fromBi];
      if (!b) return false;
      const lvl = b.levels.find(l => (l.key ?? "") === (e.layer.levelKey ?? ""));
      const currentFn = lvl ? levelNameToNumber(lvl.name) : null;
      return currentFn === target.floorNumber;
    });
  }
  return entries.every((e) => {
    if (e.fromBi !== target.bi) return false;
    const currentKey = e.layer.levelKey ?? null;
    const targetKey = target.levelKey ?? null;
    return currentKey === targetKey;
  });
}

async function handleSceneTreeLayerDrop(target) {
  if (!target) return;
  if (!transient.dragLayerCtx) return;
  const entries = transient.dragLayerCtx.entries;
  transient.dragLayerCtx = null;

  const touchedBuildings = new Set();

  for (const { layer, fromBi } of entries) {
    if (target.kind === "unassigned") {
      if (fromBi === "unassigned") continue;
      transferToUnassigned(layer, fromBi);
      continue;
    }
    if (target.kind === "modelLevel") {
      // Drop on a global model-level row: for the source building, find a
      // level whose floor number matches the target and move the layer there.
      if (fromBi === "unassigned") continue; // staged -> use right-click instead
      const srcBuilding = buildings[fromBi];
      if (!srcBuilding) continue;
      const targetFn = target.floorNumber;
      const lvl = srcBuilding.levels.find(l => levelNameToNumber(l.name) === targetFn);
      if (!lvl) continue; // this building has no equivalent floor
      moveShapefileToLevel(srcBuilding, layer, lvl.key ?? "");
      touchedBuildings.add(fromBi);
      continue;
    }
    const { bi: toBi, levelKey } = target;
    if (fromBi === "unassigned") {
      // Drag-from-staging is the natural import point. Split by feature
      // `floor` column when present so multi-floor layers fan out to their
      // matching levels instead of all piling onto one.
      _selectedLayers.delete(layer);
      const createdLayers = await dropStagedLayerOnBuilding(layer, toBi, levelKey);
      for (const created of createdLayers) _selectedLayers.add(created);
      touchedBuildings.add(toBi);
      continue;
    }
    if (fromBi === toBi) {
      moveShapefileToLevel(buildings[toBi], layer, levelKey);
      touchedBuildings.add(toBi);
      continue;
    }
    transferBetweenBuildings(layer, fromBi, toBi, levelKey);
    touchedBuildings.add(toBi);
  }
  for (const bi of touchedBuildings) applyShapefileLayerHeights(buildings[bi]);
  // Selection survives drag-from-buildings cases (layer objects are the same).
  // For from-unassigned cases we already re-targeted above.
  invalidateAndRerender();
}

// -- Shapefile Layers --
function handleAddShapefilesToBuilding(buildingIndex) {
  transient.shpPendingTarget = { buildingIndex };
  shpInput.click();
}

// -- Geodatabase (.gdb) Layers --
async function handleGdbZipSelect(e) {
  const file = e.target.files[0];
  gdbInput.value = "";
  if (!file) return;
  await routeDroppedFiles({ kind: "files", files: [file] }, null);
}

async function handleGdbDirSelect(e) {
  const files = e.target.files; // FileList from a webkitdirectory pick.
  gdbDirInput.value = "";
  if (!files.length) return;
  await routeDroppedFiles({ kind: "files", files: Array.from(files) }, null);
}

// Drop a staged layer onto a building. If the source features carry a `floor`
// property with multiple distinct values, split into one child layer per
// floor — each matched to a building level via matchLevelByText, falling back
// to the drop target's levelKey when the floor string doesn't resolve.
//
// Returns the array of newly-created layer objects in the target building so
// the caller can update the multi-select set.
async function dropStagedLayerOnBuilding(stagedLayer, toBi, targetLevelKey) {
  const target = buildings[toBi];
  if (!target) return [];

  const groups = groupFeaturesByFloor(stagedLayer.features ?? []);
  // No features, or every feature lacks a floor column / shares one floor →
  // honor the user's drop target as a single layer.
  if (groups.length <= 1) {
    const moved = moveUnassignedLayerToBuilding(stagedLayer, toBi, targetLevelKey);
    return moved ? [moved] : [];
  }

  // Multiple distinct floor values → split. Remove the staged source first
  // so we don't leak its dataSource (we'll build a new dataSource per group).
  const baseName = (stagedLayer.name ?? "layer").replace(/\.(shp|dbf|prj|geojson|json)$/i, "");
  removeUnassignedLayer(stagedLayer);

  const created = [];
  for (const g of groups) {
    const matched = g.floorValue
      ? matchLevelByText(g.floorValue, target.levels)
      : null;
    const suffix = g.floorValue || t("level.allFloors");
    const nameOverride = `${baseName} (${suffix})`;
    if (matched) {
      const layer = await addFeatureCollectionLayer(
        target,
        { fileName: baseName, features: g.features },
        {
          levelKeyOverride: matched.key ?? "",
          origin: stagedLayer._origin ?? "gdb",
          nameOverride,
        },
      );
      if (layer) created.push(layer);
    } else {
      // No level resolved for this floor value — push back to staging as a
      // per-floor sub-row so the user can drag it manually. Hidden by default.
      await addUnassignedLayer(
        { fileName: nameOverride, features: g.features },
        { nameOverride },
      );
    }
  }
  applyLevelToShapefilesForBuilding(target);
  return created;
}

// Parse a .gdb input, then hand it to the review dialog. Selected rows import
// immediately; unselected renderable rows return as staged GDB work.
async function runGdbLoad(input, defaults = null) {
  if (transient.gdbBusy) return;
  transient.gdbBusy = true;
  showLoadingOverlay(t("gdb.loading"));
  let parsed;
  try {
    parsed = await loadGdb(input);
  } catch (err) {
    console.error(err);
    notifyUser("error", "alert.failedGdb", { message: err?.message ?? String(err) });
    hideLoadingOverlay();
    transient.gdbBusy = false;
    return;
  }

  const { featureCollections, warnings } = parsed;
  if (warnings?.length) console.warn("[.gdb] warnings:", warnings);
  if (featureCollections?.length) {
    openImportReviewTray({
      featureCollections,
      buildings,
      viewer,
      mode: "import",
      onImport: applyGdbDecisions,
      onSilentImport: applyGdbDecisions,
      defaultBuildingIndex: defaults?.defaultBuildingIndex ?? null,
      defaultLevelKey: defaults?.defaultLevelKey ?? null,
      onOpenClassicTable: () =>
        openGdbImportDialog({ featureCollections, buildings, onImport: applyGdbDecisions }),
    });
  }
  hideLoadingOverlay();
  transient.gdbBusy = false;
}

async function applyGdbDecisions(decisions) {
  const touchedBuildings = new Set();
  let duplicateSkipped = 0;

  for (const { fc, target, nameOverride } of decisions ?? []) {
    if (target.kind === "skip") continue;

    if (target.kind === "unassigned") {
      const layer = await addUnassignedLayer(fc, { nameOverride });
      if (!layer) duplicateSkipped++;
      continue;
    }

    if (target.kind === "building") {
      const building = buildings[target.buildingIndex];
      if (!building) continue;
      const layer = await addFeatureCollectionLayer(building, fc, {
        levelKeyOverride: target.levelKey,
        origin: "gdb",
        nameOverride,
      });
      if (layer) {
        touchedBuildings.add(target.buildingIndex);
      } else {
        duplicateSkipped++;
      }
    }
  }

  for (const bi of touchedBuildings) {
    const building = buildings[bi];
    applyLevelToShapefilesForBuilding(building);
    applyShapefileLayerHeights(building);
  }
  if (unassignedLayers.length > 0) transient.unassignedTreeExpanded = true;
  invalidateAndRerender();
  reportGdbDuplicateSkips(duplicateSkipped);
}

function openGdbReassignDialog() {
  const entries = collectGdbLayersForReassign();
  if (entries.length === 0) {
    notifyUser("info", "gdb.reassign.empty");
    return;
  }
  const featureCollections = entries.map((entry) => ({
    fileName: entry.layer.name,
    features: entry.layer.features,
    _existingEntry: entry,
  }));
  openImportReviewTray({
    featureCollections,
    buildings,
    viewer,
    mode: "reassign",
    onImport: applyReassignDecisions,
    onOpenClassicTable: () =>
      openGdbImportDialog({
        featureCollections,
        buildings,
        onImport: applyReassignDecisions,
        mode: "reassign",
      }),
  });
}

function collectGdbLayersForReassign() {
  const out = [];
  for (let bi = 0; bi < buildings.length; bi++) {
    for (const layer of buildings[bi].shapefileLayers) {
      if (!isGdbLayer(layer)) continue;
      out.push({ layer, parent: { kind: "building", buildingIndex: bi } });
    }
  }
  for (const layer of unassignedLayers) {
    if (!isGdbLayer(layer)) continue;
    out.push({ layer, parent: { kind: "unassigned" } });
  }
  return out;
}

async function applyReassignDecisions(decisions) {
  const touchedBuildings = new Set();
  let duplicateSkipped = 0;

  for (const { fc, target } of decisions ?? []) {
    const entry = fc?._existingEntry;
    if (!entry?.layer) continue;
    const { layer, parent } = entry;

    if (target.kind === "skip") {
      removeExistingGdbLayer(entry);
      if (parent.kind === "building") touchedBuildings.add(parent.buildingIndex);
      continue;
    }

    if (target.kind === "unassigned") {
      if (parent.kind === "building") {
        if (transferToUnassigned(layer, parent.buildingIndex)) touchedBuildings.add(parent.buildingIndex);
        else duplicateSkipped++;
      }
      continue;
    }

    if (target.kind !== "building") continue;
    const toBi = target.buildingIndex;
    if (parent.kind === "unassigned") {
      const moved = moveUnassignedLayerToBuilding(layer, toBi, target.levelKey);
      if (moved) touchedBuildings.add(toBi);
      else duplicateSkipped++;
    } else if (parent.buildingIndex === toBi) {
      if (moveShapefileToLevel(buildings[toBi], layer, target.levelKey)) touchedBuildings.add(toBi);
      else duplicateSkipped++;
    } else {
      if (transferBetweenBuildings(layer, parent.buildingIndex, toBi, target.levelKey)) {
        touchedBuildings.add(parent.buildingIndex);
        touchedBuildings.add(toBi);
      } else {
        duplicateSkipped++;
      }
    }
  }

  for (const bi of touchedBuildings) {
    const building = buildings[bi];
    if (!building) continue;
    applyLevelToShapefilesForBuilding(building);
    applyShapefileLayerHeights(building);
  }
  invalidateAndRerender();
  reportGdbDuplicateSkips(duplicateSkipped);
}

function reportGdbDuplicateSkips(count) {
  if (count > 0) notifyUser("info", "gdb.import.duplicatesSkipped", { count });
}

function isGdbLayer(layer) {
  return (layer?._origin ?? "gdb") === "gdb";
}

function normalizeGdbLayerName(name) {
  return String(name ?? "")
    .replace(/\.(shp|dbf|prj|geojson|json)$/i, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._/\\()[\]{}<>:;,'"`~!?@#$%^&*=+|]+/g, " ")
    .replace(/[‐‒–—－ー-]+/g, " ")
    .replace(/[・、，。]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameGdbLayerIdentity(layer, name, levelKey) {
  return (
    isGdbLayer(layer) &&
    normalizeGdbLayerName(layer.name) === normalizeGdbLayerName(name) &&
    (layer.levelKey ?? null) === (levelKey ?? null)
  );
}

function hasEquivalentGdbLayer(building, name, levelKey, excludeLayer = null) {
  return (building?.shapefileLayers ?? []).some(
    (layer) => layer !== excludeLayer && sameGdbLayerIdentity(layer, name, levelKey),
  );
}

function hasEquivalentUnassignedLayer(name, excludeLayer = null) {
  const normalized = normalizeGdbLayerName(name);
  return unassignedLayers.some(
    (layer) => layer !== excludeLayer && isGdbLayer(layer) && normalizeGdbLayerName(layer.name) === normalized,
  );
}

function removeExistingGdbLayer(entry) {
  const layer = entry?.layer;
  if (!layer) return false;
  if (entry.parent?.kind === "unassigned") {
    removeUnassignedLayer(layer);
    return true;
  }
  if (entry.parent?.kind === "building") {
    const building = buildings[entry.parent.buildingIndex];
    if (!building) return false;
    removeShapefileLayer(building, layer);
    return true;
  }
  return false;
}

// Move a layer from its current building to the unassigned bucket. Reuses the
// existing Cesium dataSource — only re-parents, drops the levelKey, and hides
// the layer (the staging bucket is invisible by design).
function transferToUnassigned(layer, currentBi) {
  const b = buildings[currentBi];
  const i = b.shapefileLayers.indexOf(layer);
  if (i === -1) return false;
  if (isGdbLayer(layer) && hasEquivalentUnassignedLayer(layer.name, layer)) return false;
  b.shapefileLayers.splice(i, 1);
  delete layer.levelKey;
  if (layer.dataSource) layer.dataSource.show = false;
  unassignedLayers.push(layer);
  return true;
}

// Move a layer between two buildings, applying the new building's height
// offset / level so it renders at the right elevation.
function transferBetweenBuildings(layer, fromBi, toBi, newLevelKey) {
  const from = buildings[fromBi];
  const i = from.shapefileLayers.indexOf(layer);
  if (i === -1) return false;
  if (isGdbLayer(layer) && hasEquivalentGdbLayer(buildings[toBi], layer.name, newLevelKey, layer)) {
    return false;
  }
  from.shapefileLayers.splice(i, 1);
  layer.levelKey = newLevelKey;
  buildings[toBi].shapefileLayers.push(layer);
  applyShapefileLayerHeight(buildings[toBi], layer);
  return true;
}

async function handleShpSelect(e) {
  const file = e.target.files[0];
  shpInput.value = "";
  if (!file) {
    transient.shpPendingTarget = null;
    return;
  }
  const buildingIndex = transient.shpPendingTarget?.buildingIndex ?? null;
  transient.shpPendingTarget = null;
  await runShpImport(file, { buildingIndex });
}

// Parse a single shapefile .zip and either attach it to the given building
// or land it in the unassigned bucket. Shared by the file-picker flow and
// the OS drag-drop flow so both honour the same heuristics.
async function runShpImport(file, { buildingIndex } = {}) {
  if (!file) return;
  try {
    const { default: shp } = await import("shpjs");
    const raw = await shp(await file.arrayBuffer());
    const fcs = Array.isArray(raw) ? raw : [raw];
    const b = typeof buildingIndex === "number" ? buildings[buildingIndex] : null;
    if (b) {
      for (const fc of fcs) await addFeatureCollectionLayer(b, fc);
      applyLevelToShapefilesForBuilding(b);
      if (selectedBuildingIndex !== buildingIndex) selectBuilding(buildingIndex);
      else invalidateAndRerender();
    } else {
      // No building target — land in the unassigned bucket so the user can
      // drag the layer(s) onto whichever building they want.
      for (const fc of fcs) await addUnassignedLayer(fc, { origin: "shp" });
      transient.unassignedTreeExpanded = true;
      invalidateAndRerender();
    }
  } catch (err) {
    notifyUser("error", "alert.failedShp", { message: err.message });
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
  const origin = opts.origin ?? "shp";
  if (origin === "gdb" && hasEquivalentGdbLayer(building, name, levelKey)) {
    return null;
  }
  const color = SHP_COLORS[transient.shpColorIdx++ % SHP_COLORS.length];
  const cesiumColor = Color.fromCssColorString(color);
  const dataSource = await GeoJsonDataSource.load(
    { type: "FeatureCollection", features },
    { fill: cesiumColor.withAlpha(1.0), stroke: cesiumColor, strokeWidth: 2, clampToGround: false }
  );
  const layer = { name, dataSource, color, levelKey, source, features, heightOffset: 0, _origin: origin, colorColumn: null, colorMappings: null };
  applyEntityStyling(dataSource, name, layer);
  viewer.dataSources.add(dataSource);
  building.shapefileLayers.push(layer);
  applyShapefileLayerHeight(building, layer);
  return layer;
}

// Add a FeatureCollection to the global unassigned bucket. The dataSource is
// loaded into the viewer but its `show` property is set to false — the layer
// stays invisible until the user drags it onto a building, at which point the
// transfer flips `show` back on.
async function addUnassignedLayer(fc, opts = {}) {
  const name = opts.nameOverride ?? (fc.fileName ?? "layer").replace(/\.(shp|dbf|prj)$/i, "");
  if (hasEquivalentUnassignedLayer(name)) {
    return null;
  }
  const features = fc.features ?? [];
  const source = detectShapefileSource(features);
  const color = SHP_COLORS[transient.shpColorIdx++ % SHP_COLORS.length];
  const cesiumColor = Color.fromCssColorString(color);
  const dataSource = await GeoJsonDataSource.load(
    { type: "FeatureCollection", features },
    { fill: cesiumColor.withAlpha(1.0), stroke: cesiumColor, strokeWidth: 2, clampToGround: false }
  );
  const origin = opts.origin ?? "gdb";
  const layer = { name, dataSource, color, features, source, heightOffset: 0, _origin: origin, colorColumn: null, colorMappings: null };
  applyEntityStyling(dataSource, name, layer);
  viewer.dataSources.add(dataSource);
  unassignedLayers.push(layer);
  // Render staged layers ghosted so the user can see what's pending in 3D
  // rather than guessing from the panel alone. Bail out when the staging
  // bucket gets unreasonably large — many entities + ghost-restyling thrash
  // the Cesium scene more than the discoverability win is worth.
  if (unassignedLayers.length > 100) {
    dataSource.show = false;
  } else {
    dataSource.show = true;
    applyDataSourceContextGhosting(dataSource, true, true);
  }
  return layer;
}

// Transfer an unassigned layer into a building's shapefileLayers, applying the
// chosen level. The Cesium dataSource is reused; only ownership changes.
function moveUnassignedLayerToBuilding(layer, buildingIndex, levelKey) {
  const building = buildings[buildingIndex];
  if (!building) return null;
  const idx = unassignedLayers.indexOf(layer);
  if (idx === -1) return null;
  if (isGdbLayer(layer) && hasEquivalentGdbLayer(building, layer.name, levelKey, layer)) {
    return null;
  }
  unassignedLayers.splice(idx, 1);
  const moved = {
    name: layer.name,
    dataSource: layer.dataSource,
    color: layer.color,
    levelKey: levelKey ?? null,
    source: layer.source,
    features: layer.features,
    heightOffset: layer.heightOffset ?? 0,
    _origin: layer._origin ?? "gdb",
    colorColumn: layer.colorColumn ?? null,
    colorMappings: layer.colorMappings ?? null,
  };
  building.shapefileLayers.push(moved);
  moved.dataSource.show = true;
  // Restore the original (non-ghosted) materials cached when the layer was
  // first added to the unassigned bucket.
  applyDataSourceContextGhosting(moved.dataSource, false, true);
  applyShapefileLayerHeight(building, moved);
  applyLevelToShapefilesForBuilding(building);
  invalidateAndRerender();
  return moved;
}

function removeUnassignedLayer(layer) {
  const idx = unassignedLayers.indexOf(layer);
  if (idx === -1) return;
  viewer.dataSources.remove(layer.dataSource, true);
  unassignedLayers.splice(idx, 1);
  invalidateAndRerender();
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

function safeColorFromHex(hex, fallbackHex = COLOR2_DEFAULT) {
  try {
    return Color.fromCssColorString(hex);
  } catch {
    // Invalid CSS color string — use fallback to keep rendering.
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

    if (shouldApplyConfiguredColors) {
      const raw = entity.properties?.[colorColumn]?.getValue?.();
      const key = String(raw ?? "").trim();
      // Explicit user mapping wins; otherwise, if the column value is itself a
      // hex literal, use it directly; otherwise fall back to neutral gray.
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

function removeShapefileLayer(building, layer) {
  const idx = building.shapefileLayers.indexOf(layer);
  if (idx === -1) return;
  viewer.dataSources.remove(layer.dataSource, true);
  building.shapefileLayers.splice(idx, 1);
  invalidateAndRerender();
}

function moveShapefileToLevel(building, layer, newLevelKey) {
  if (isGdbLayer(layer) && hasEquivalentGdbLayer(building, layer.name, newLevelKey, layer)) {
    return false;
  }
  layer.levelKey = newLevelKey;
  applyShapefileLayerHeight(building, layer);
  applyLevelToShapefilesForBuilding(building);
  invalidateAndRerender();
  return true;
}

// -- Floating context menu --
// Move a layer to the model-level with the given floor number. If the source
// building has a matching level, swap in place; otherwise transfer the layer
// to the first building that does host this floor.
function moveLayerToModelLevel(srcBuilding, fromBi, layer, floorNumber) {
  const inPlace = srcBuilding.levels.find(l => levelNameToNumber(l.name) === floorNumber);
  if (inPlace) {
    moveShapefileToLevel(srcBuilding, layer, inPlace.key ?? "");
    return;
  }
  for (let bi = 0; bi < buildings.length; bi++) {
    if (bi === fromBi) continue;
    const target = buildings[bi];
    const targetLvl = target.levels.find(l => levelNameToNumber(l.name) === floorNumber);
    if (!targetLvl) continue;
    if (transferBetweenBuildings(layer, fromBi, bi, targetLvl.key ?? "")) {
      applyLevelToShapefilesForBuilding(target);
      applyLevelToShapefilesForBuilding(srcBuilding);
      invalidateAndRerender();
    }
    return;
  }
}

function syncColorConfigToAllOfType(layerType, column, mappings, sourceLayer) {
  for (const b of buildings) {
    for (const l of b.shapefileLayers) {
      if (getLayerType(l.name) === layerType) {
        l.color = sourceLayer.color;
        l.colorColumn = column;
        l.colorMappings = mappings;
        applyEntityStyling(l.dataSource, l.name, l);
      }
    }
  }
  for (const l of unassignedLayers) {
    if (getLayerType(l.name) === layerType) {
      l.color = sourceLayer.color;
      l.colorColumn = column;
      l.colorMappings = mappings;
      applyEntityStyling(l.dataSource, l.name, l);
    }
  }
}

function appendConfigureColorsMenuItem(ul, layer) {
  if (!isColorConfigurableLayer(layer)) return;
  const colorsLi = document.createElement("li");
  colorsLi.textContent = t("ctx.layer.configureColors");
  colorsLi.addEventListener("click", (e) => {
    e.stopPropagation();
    hideFloatingMenu();
    const useSpaceDefaults = isSpaceLayerName(layer.name);
    const defaultColumn = useSpaceDefaults ? "color2" : chooseDefaultColorColumn(layer);
    openColorConfigDialog({
      layer,
      defaultColumn,
      defaultMappings: useSpaceDefaults ? COLOR2_LOOKUP : {},
      defaultSwatches: COLOR_CONFIG_SWATCHES,
      onApply: ({ column, mappings }) => {
        const lType = getLayerType(layer.name);
        if (lType === "space" || lType === "unit") {
          syncColorConfigToAllOfType(lType, column, mappings, layer);
        } else {
          layer.colorColumn = column;
          layer.colorMappings = mappings;
          applyEntityStyling(layer.dataSource, layer.name, layer);
        }
      },
    });
  });
  ul.appendChild(colorsLi);
}

// Click-handler for the inline floor chip on layer rows. For layers attached
// to a building, opens a flat popover listing All Floors + every model-level;
// for unassigned layers, delegates to the building+floor picker that
// right-click previously surfaced.
function handleSceneTreeOpenLayerFloorPicker({ layer, buildingIndex }, event) {
  if (!layer) return;
  if (typeof buildingIndex === "number") {
    const building = buildings[buildingIndex];
    if (building) showLayerFloorPicker(event, building, layer);
  } else {
    showMoveUnassignedToBuildingMenu(event, layer);
  }
}

function showLayerFloorPicker(event, building, layer) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");

  const fromBi = buildings.indexOf(building);
  const currentLvl = layer.levelKey != null
    ? building.levels.find((l) => (l.key ?? "") === layer.levelKey)
    : null;
  const currentFn = currentLvl ? levelNameToNumber(currentLvl.name) : null;

  const buildItem = (label, action, disabled) => {
    const li = document.createElement("li");
    li.textContent = label;
    if (disabled) {
      li.classList.add("disabled");
    } else {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        hideFloatingMenu();
        action();
      });
    }
    ul.appendChild(li);
  };
  buildItem(
    t("level.allFloors"),
    () => moveShapefileToLevel(building, layer, null),
    layer.levelKey == null,
  );
  for (let mli = modelLevels.length - 1; mli >= 0; mli--) {
    const ml = modelLevels[mli];
    buildItem(
      ml.name,
      () => moveLayerToModelLevel(building, fromBi, layer, ml.floorNumber),
      currentFn === ml.floorNumber,
    );
  }

  floatingMenu.appendChild(ul);
  positionFloatingMenu(event);
}

function showMoveToFloorMenu(event, building, layer) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");

  // Adjust height (opens slider popover)
  const adjustLi = document.createElement("li");
  adjustLi.textContent = t("ctx.layer.adjustHeight");
  adjustLi.addEventListener("click", (e) => {
    e.stopPropagation();
    hideFloatingMenu();
    openSliderPopover({
      anchor: event,
      label: t("popover.layerHeight"),
      min: -50, max: 50, step: 0.1,
      value: layer.heightOffset ?? 0,
      onChange: (v) => {
        layer.heightOffset = v;
        applyShapefileLayerHeight(building, layer);
      },
    });
  });
  ul.appendChild(adjustLi);

  // Reset height offset
  const resetLi = document.createElement("li");
  resetLi.textContent = t("ctx.layer.resetHeight");
  if ((layer.heightOffset ?? 0) === 0) {
    resetLi.classList.add("disabled");
  } else {
    resetLi.addEventListener("click", (e) => {
      e.stopPropagation();
      hideFloatingMenu();
      layer.heightOffset = 0;
      applyShapefileLayerHeight(building, layer);
      invalidateAndRerender();
    });
  }
  ul.appendChild(resetLi);

  appendConfigureColorsMenuItem(ul, layer);

  // Remove
  const removeLi = document.createElement("li");
  removeLi.textContent = t("ctx.layer.remove");
  removeLi.addEventListener("click", (e) => {
    e.stopPropagation();
    hideFloatingMenu();
    removeShapefileLayer(building, layer);
  });
  ul.appendChild(removeLi);

  floatingMenu.appendChild(ul);
  positionFloatingMenu(event);
}

function positionFloatingMenu(event) {
  floatingMenu.style.left = `${event.pageX}px`;
  floatingMenu.style.top = `${event.pageY}px`;
  floatingMenu.style.display = "";
}

function hideFloatingMenu() {
  floatingMenu.style.display = "none";
  floatingMenu.innerHTML = "";
}

// Single open popover at a time (clicking elsewhere closes it).
function closeContextPopover() {
  if (transient.openPopoverCleanup) {
    transient.openPopoverCleanup();
    transient.openPopoverCleanup = null;
  }
}

function mountContextPopover(event, contentEl) {
  closeContextPopover();
  const popover = document.createElement("div");
  popover.className = "left-popover";
  // Hold position-related styles inline since the popover is absolutely positioned
  // near the cursor click. Default top-left until measured.
  popover.style.position = "fixed";
  popover.style.left = `${event.pageX}px`;
  popover.style.top = `${event.pageY}px`;
  popover.appendChild(contentEl);
  document.body.appendChild(popover);
  // Re-position so the popover stays inside the viewport.
  const rect = popover.getBoundingClientRect();
  const margin = 8;
  if (rect.right > window.innerWidth - margin) {
    popover.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
  }
  if (rect.bottom > window.innerHeight - margin) {
    popover.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
  }

  const onDocClick = (e) => {
    if (!popover.contains(e.target)) closeContextPopover();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeContextPopover();
  };
  // Defer to next tick so the click that opened the popover doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
  }, 0);

  transient.openPopoverCleanup = () => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
    if (popover.parentNode) popover.parentNode.removeChild(popover);
  };
  return popover;
}

// Open a small popover with one or two labelled inputs and OK / Cancel.
// fields: [{ key, label, type: "text"|"number", value, step }]
function openInputPopover({ anchor, fields, onOk }) {
  const content = document.createElement("div");
  const inputs = {};

  for (const f of fields) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    content.appendChild(label);

    const input = document.createElement("input");
    input.type = f.type || "text";
    if (f.type === "number" && f.step != null) input.step = String(f.step);
    input.value = f.value ?? "";
    content.appendChild(input);
    inputs[f.key] = input;
  }

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "6px";
  actions.style.marginTop = "10px";
  actions.style.justifyContent = "flex-end";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary-btn compact";
  cancelBtn.textContent = t("popover.cancel");
  cancelBtn.addEventListener("click", closeContextPopover);

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "primary-btn compact";
  okBtn.textContent = t("popover.ok");
  okBtn.style.width = "auto";
  okBtn.style.flex = "0 0 auto";
  const submit = () => {
    const values = {};
    for (const key in inputs) values[key] = inputs[key].value;
    onOk(values);
    closeContextPopover();
  };
  okBtn.addEventListener("click", submit);

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  content.appendChild(actions);

  mountContextPopover(anchor, content);

  // Focus first input, submit on Enter.
  const firstInput = fields.length > 0 ? inputs[fields[0].key] : null;
  if (firstInput) {
    firstInput.focus();
    firstInput.select();
  }
  for (const key in inputs) {
    inputs[key].addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }
}

// Slider + number popover for live-updating numeric values (e.g. tileset shift).
function openSliderPopover({ anchor, label, min, max, step, value, onChange }) {
  const content = document.createElement("div");

  const labelEl = document.createElement("label");
  labelEl.className = "field-label";
  labelEl.textContent = label;
  content.appendChild(labelEl);

  const row = document.createElement("div");
  row.className = "slider-row";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);

  const num = document.createElement("input");
  num.type = "number";
  num.step = String(step);
  num.value = String(value);
  num.className = "w-number";

  const apply = (v) => {
    const parsed = parseFloat(v);
    if (!Number.isFinite(parsed)) return;
    slider.value = String(parsed);
    num.value = String(parsed);
    onChange(parsed);
  };
  slider.addEventListener("input", () => apply(slider.value));
  num.addEventListener("change", () => apply(num.value));

  row.appendChild(slider);
  row.appendChild(num);
  content.appendChild(row);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "6px";
  actions.style.marginTop = "10px";
  actions.style.justifyContent = "flex-end";

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "primary-btn compact";
  doneBtn.style.width = "auto";
  doneBtn.style.flex = "0 0 auto";
  doneBtn.textContent = t("popover.ok");
  doneBtn.addEventListener("click", closeContextPopover);
  actions.appendChild(doneBtn);
  content.appendChild(actions);

  mountContextPopover(anchor, content);
}

// Building row context menu: zoom, add shapefiles, add level, set base
// elevation, shift tileset, remove model. Each popover-style action uses
// openInputPopover to collect the value before mutating state.
function showBuildingContextMenu(event, building, bi) {
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");
  const mk = (label, handler, disabled = false) => {
    const li = document.createElement("li");
    li.textContent = label;
    if (disabled) {
      li.classList.add("disabled");
    } else {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        hideFloatingMenu();
        handler();
      });
    }
    ul.appendChild(li);
  };
  mk(t("building.zoomTitle"), () => zoomToBuilding(bi), !building.tileset);
  mk(t("building.addShapefilesTitle"), () => handleAddShapefilesToBuilding(bi));
  mk(t("ctx.building.addLevel"), () => {
    const top = building.levels?.length
      ? building.levels[building.levels.length - 1].floor
      : 0;
    openInputPopover({
      anchor: event,
      fields: [
        { key: "name", label: t("popover.levelName"), type: "text", value: "" },
        { key: "floor", label: t("popover.elevation"), type: "number", value: top, step: 0.1 },
      ],
      onOk: ({ name, floor }) => {
        const trimmed = (name ?? "").trim();
        const v = parseFloat(floor);
        if (!trimmed || !Number.isFinite(v)) return;
        building._expanded = true;
        handleAddLevel(building, trimmed, v);
      },
    });
  });
  mk(t("ctx.building.setBaseElev"), () => {
    openInputPopover({
      anchor: event,
      fields: [
        { key: "base", label: t("popover.baseElevation"), type: "number", value: building.levelBaseElevation, step: 0.1 },
      ],
      onOk: ({ base }) => {
        building.levelBaseElevation = parseFloat(base) || 0;
        applyShapefileLayerHeights(building);
        if (building.activeLevelIndex !== -1) applyActiveLevelForBuilding(building);
        invalidateAndRerender();
      },
    });
  });
  mk(t("ctx.building.shiftTileset"), () => {
    openSliderPopover({
      anchor: event,
      label: t("popover.tilesetShift"),
      min: -100, max: 100, step: 0.5,
      value: building.heightOffset ?? 0,
      onChange: (v) => setBuildingHeightOffset(building, v),
    });
  }, !building.tileset);

  if (venues.length > 0) {
    const assignLi = document.createElement("li");
    assignLi.className = "menu-has-submenu";
    assignLi.textContent = t("ctx.building.assignVenue");
    const sub = document.createElement("ul");
    const mkSub = (label, venueId) => {
      const item = document.createElement("li");
      item.textContent = label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        hideFloatingMenu();
        building.venueId = venueId;
        renderVenuesSection();
        invalidateAndRerender();
      });
      sub.appendChild(item);
    };
    mkSub(t("venue.unassigned"), null);
    for (const venue of venues) mkSub(venue.name, venue.id);
    assignLi.appendChild(sub);
    ul.appendChild(assignLi);
  }

  // separator
  const sep = document.createElement("li");
  sep.className = "menu-sep";
  ul.appendChild(sep);

  mk(t("building.removeTitle"), () => handleRemoveBuilding(bi));

  floatingMenu.appendChild(ul);
  positionFloatingMenu(event);
}

function showModelLevelContextMenu(event, mli) {
  const ml = modelLevels[mli];
  if (!ml) return;
  floatingMenu.innerHTML = "";
  const ul = document.createElement("ul");
  const mk = (label, handler) => {
    const li = document.createElement("li");
    li.textContent = label;
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      hideFloatingMenu();
      handler();
    });
    ul.appendChild(li);
  };
  mk(t("ctx.level.editName"), () => {
    openInputPopover({
      anchor: event,
      fields: [{ key: "name", label: t("popover.levelName"), type: "text", value: ml.name }],
      onOk: ({ name }) => {
        const trimmed = (name ?? "").trim();
        if (!trimmed) return;
        ml.name = trimmed;
        invalidateAndRerender();
      },
    });
  });
  mk(t("ctx.level.editElev"), () => {
    openInputPopover({
      anchor: event,
      fields: [{ key: "elev", label: t("popover.elevation"), type: "number", value: ml.elevation, step: 0.1 }],
      onOk: ({ elev }) => {
        const v = parseFloat(elev);
        if (!Number.isFinite(v)) return;
        const delta = v - ml.elevation;
        ml.elevation = v;
        // Propagate the delta to every building's matching level so shapefile
        // heights and 3D Tiles cuts stay aligned.
        for (const b of buildings) {
          const lvl = b.levels.find(l => levelNameToNumber(l.name) === ml.floorNumber);
          if (lvl) {
            lvl.floor += delta;
            applyShapefileLayerHeights(b);
          }
        }
        invalidateAndRerender();
      },
    });
  });
  floatingMenu.appendChild(ul);
  positionFloatingMenu(event);
}

function showLevelContextMenu(event, building, bi, levelIndex) {
  floatingMenu.innerHTML = "";
  const level = building.levels[levelIndex];
  if (!level) return;
  const ul = document.createElement("ul");
  const mk = (label, handler) => {
    const li = document.createElement("li");
    li.textContent = label;
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      hideFloatingMenu();
      handler();
    });
    ul.appendChild(li);
  };
  mk(t("ctx.level.editName"), () => {
    openInputPopover({
      anchor: event,
      fields: [{ key: "name", label: t("popover.levelName"), type: "text", value: level.name }],
      onOk: ({ name }) => {
        const trimmed = (name ?? "").trim();
        if (!trimmed) return;
        level.name = trimmed;
        rebuildModelLevels();
        invalidateAndRerender();
      },
    });
  });
  mk(t("ctx.level.editElev"), () => {
    openInputPopover({
      anchor: event,
      fields: [{ key: "floor", label: t("popover.elevation"), type: "number", value: level.floor, step: 0.1 }],
      onOk: ({ floor }) => {
        const v = parseFloat(floor);
        if (!Number.isFinite(v)) return;
        level.floor = v;
        building.levels.sort((a, b) => a.floor - b.floor);
        applyShapefileLayerHeights(building);
        if (building.activeLevelIndex !== -1) applyActiveLevelForBuilding(building);
        rebuildModelLevels();
        invalidateAndRerender();
      },
    });
  });
  mk(t("level.removeTitle"), () => {
    const wasActive = building.activeLevelIndex === levelIndex;
    building.levels.splice(levelIndex, 1);
    if (wasActive || building.activeLevelIndex >= building.levels.length) {
      building.activeLevelIndex = -1;
      applyActiveLevelForBuilding(building);
    } else if (building.activeLevelIndex > levelIndex) {
      building.activeLevelIndex--;
    }
    applyShapefileLayerHeights(building);
    rebuildModelLevels();
    invalidateAndRerender();
  });

  floatingMenu.appendChild(ul);
  positionFloatingMenu(event);
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
    const cityGmlEntities = [];
    for (const poly of polygons) {
      const flatPos = poly.positions.flat();
      if (flatPos.length < 9) continue;
      const entity = dataSource.entities.add({
        polygon: {
          hierarchy: cityGmlPolygonToHierarchy(poly),
          perPositionHeight: true,
          material: SURFACE_COLORS[poly.surfaceType],
          outline: true,
          outlineColor: Color.BLACK.withAlpha(0.4),
          outlineWidth: 1,
        },
      });
      cityGmlEntities.push({ entity, polygon: poly });
    }

    await viewer.dataSources.add(dataSource);
    const layer = { name: file.name, dataSource, entities: cityGmlEntities };
    cityGmlLayers.push(layer);
    applyCityGmlLayerContextGhosting(layer);
    viewer.zoomTo(dataSource);
    renderCityGmlList();
  } catch (err) {
    notifyUser("error", "alert.failedGml", { message: err.message });
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
function buildSessionSnapshot() {
  return serializeSession({
    imagery: imagerySelect.value,
    terrain: terrainSelect.value,
    plateauOverridesEnabled,
    modelLevels,
    activeModelLevelIndex,
    venues,
    buildings,
    importedLayers,
    unassignedLayers,
    isPlateauLayer,
    serializePlateauOverrides,
  });
}

function saveSession() {
  if (buildings.length === 0 && importedLayers.length === 0 && unassignedLayers.length === 0) {
    notifyUser("info", "alert.nothingToSave");
    return;
  }
  downloadSessionJson(buildSessionSnapshot());
}

function createSessionRestoreContext() {
  return {
    viewer,
    buildings,
    importedLayers,
    unassignedLayers,
    lodFilter,
    modelLevels,
    fileStatus,
    clearBuildings: async () => handleRemoveAll(),
    clearImportedLayers,
    clearUnassignedLayers,
    onCleared: () => {
      venues.length = 0;
      activeVenueFilter = null;
    },
    setPlateauOverridesEnabled: (v) => { plateauOverridesEnabled = v; },
    setSelectedPlateauFeature: (v) => { selectedPlateauFeature = v; },
    setImageryChoice: (v) => { imagerySelect.value = v; },
    switchImagery: async (choice) => {
      imagerySelect.value = choice;
      await switchImagery();
    },
    setTerrainChoice: (v) => { terrainSelect.value = v; },
    switchTerrain: (choice) => {
      terrainSelect.value = choice;
      switchTerrain();
    },
    restoreVenues: (savedVenues) => {
      venues.length = 0;
      for (const v of savedVenues ?? []) {
        venues.push({
          id: v.id,
          name: v.name,
          description: v.description ?? "",
          _expanded: false,
        });
      }
    },
    onProgress: (current, total) => {
      if (current === 0) {
        showLoadingOverlay(t("loading.session.title"), t("loading.session.progress", { current, total }));
      } else {
        updateLoadingOverlay(t("loading.session.progress", { current, total }));
      }
    },
    setSelectedBuildingIndex: (idx) => { selectedBuildingIndex = idx; },
    getModelLevels: () => modelLevels,
    rebuildModelLevels,
    selectModelLevel,
    bindTilesetTileLoad,
    applyHeightOffset,
    applyFiltersForTileset,
    refreshLodFilterIfEnabled,
    computePerSiblingBoundingSpheres,
    applyEntityStyling,
    applyShapefileLayerHeight,
    applyShapefileLayerHeights,
    applyLevelToShapefilesForBuilding,
    detectShapefileSource,
    onComplete: () => {
      renderImportedLayersList();
      refreshAllPlateauOverrideStyles();
      invalidateAndRerender();
    },
  };
}

async function restoreSession(data) {
  const restorePlan = createSessionRestorePlan(data);
  showLoadingOverlay(
    t("loading.session.title"),
    t("loading.session.progress", { current: 0, total: restorePlan.primaryItemCount }),
  );
  try {
    await restoreSessionImpl(data, createSessionRestoreContext());
  } finally {
    hideLoadingOverlay();
  }
}

async function handleLoadSession(e) {
  const file = e.target.files[0];
  sessionInput.value = "";
  if (!file) return;
  try {
    await createAutoBackup(buildSessionSnapshot, t("backup.beforeLoad", { name: file.name }));
    const data = parseSessionJson(await file.text());
    await restoreSession(data);
  } catch (err) {
    notifyUser("error", "alert.failedSession", { message: err.message });
  } finally {
    hideLoadingOverlay();
  }
}

async function restoreFromBackup(entry) {
  await createAutoBackup(buildSessionSnapshot, t("backup.beforeRestore"));
  await restoreSession(entry.session);
}

function handleAddVenue() {
  const venue = promptVenueName();
  if (!venue) return;
  let id = venue.id;
  let n = 1;
  while (venues.some((v) => v.id === id)) {
    id = `${venue.id}-${++n}`;
  }
  venue.id = id;
  venues.push(venue);
  renderVenuesSection();
}

async function handleDeleteVenue(venue) {
  await createAutoBackup(buildSessionSnapshot, t("backup.beforeDelete", { name: venue.name }));
  for (const b of buildings) {
    if (b.venueId === venue.id) b.venueId = null;
  }
  const idx = venues.findIndex((v) => v.id === venue.id);
  if (idx !== -1) venues.splice(idx, 1);
  if (activeVenueFilter === venue.id) activeVenueFilter = null;
  renderVenuesSection();
  invalidateAndRerender();
}

function getPublishState() {
  return {
    venues,
    imagery: imagerySelect.value,
    terrain: terrainSelect.value,
    plateauOverridesEnabled,
    modelLevels,
    activeModelLevelIndex,
    buildings,
    importedLayers,
    unassignedLayers,
    isPlateauLayer,
    serializePlateauOverrides,
  };
}

function handleExportViewerPackage() {
  const result = exportViewerPackage({
    ...getPublishState(),
    baseUrl: "",
  });
  if (!result.ok) {
    notifyUser("info", "venue.exportEmpty");
    return;
  }
  notifyUser("info", "venue.exportDone", { count: result.venueCount });
}

async function handlePublishToServer() {
  if (!publishBtn) return;
  publishBtn.disabled = true;
  showLoadingOverlay(t("publish.inProgress"), "");
  try {
    const result = await publishToServer(getPublishState(), {
      token: import.meta.env.VITE_PUBLISH_TOKEN || "",
    });
    if (!result.ok) {
      if (result.reason === "noVenuesWithBuildings") {
        notifyUser("info", "venue.exportEmpty");
      } else if (result.reason === "tilesetNotBundled") {
        notifyUser("error", "publish.tilesetNotBundled", {
          buildings: (result.buildings ?? []).join(", "),
        });
      } else {
        notifyUser("error", "publish.failed", { message: result.error ?? result.reason });
      }
      return;
    }
    openPublishLinksDialog({ links: result.links, warnings: result.warnings });
    notifyUser("info", "publish.success", { count: result.venueCount });
  } catch (err) {
    notifyUser("error", "publish.failed", { message: err.message });
  } finally {
    publishBtn.disabled = false;
    hideLoadingOverlay();
  }
}

function startAutoBackupTimer() {
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  autoBackupTimer = setInterval(async () => {
    if (buildings.length === 0 && importedLayers.length === 0 && unassignedLayers.length === 0) return;
    await createAutoBackup(buildSessionSnapshot, t("backup.autoSave"));
  }, 5 * 60 * 1000);
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
  let tileset = null;
  let attached = false;
  try {
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
    attached = true;
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
    refreshLodFilterIfEnabled();
    invalidateAndRerender();
  } catch (e) {
    if (!attached) cleanupUntrackedTileset(tileset);
    fileStatus.textContent = "";
    notifyUser("error", "alert.failedLoad", { message: e.message });
  } finally {
    setButtonLoading(loadFileBtn, false);
  }
}

// -- Height offset (called from the building context menu's "Shift tileset…" popover) --
function setBuildingHeightOffset(building, value) {
  if (!building) return;
  const siblings = building.tileset?._buildings || [building];
  for (const sibling of siblings) sibling.heightOffset = value;
  applyHeightOffset(building.tileset, value);
  for (const sibling of siblings) applyShapefileLayerHeights(sibling);
  invalidateAndRerender();
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

// -- Header search --
function initSearch() {
  searchInput.addEventListener("input", handleSearchInput);
  searchInput.addEventListener("keydown", handleSearchKeydown);
  document.addEventListener("click", handleSearchOutsideClick);
}

function getSearchableEntities() {
  const out = [];
  const time = viewer?.clock?.currentTime ?? JulianDate.now();

  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    for (const layer of b.shapefileLayers) {
      for (const entity of layer.dataSource.entities.values) {
        if (!hasPointGeometry(entity)) continue;
        const props = entity.properties?.getValue(time);
        const symbolId = props?.symbol_id ?? null;
        const name = props?.name ?? null;
        if (symbolId == null && name == null) continue;
        out.push({
          entity,
          symbolId: String(symbolId ?? ""),
          name: String(name ?? ""),
          buildingIndex: bi,
          building: b,
          layer,
        });
      }
    }
  }

  for (const layer of unassignedLayers) {
    for (const entity of layer.dataSource.entities.values) {
      if (!hasPointGeometry(entity)) continue;
      const props = entity.properties?.getValue(time);
      const symbolId = props?.symbol_id ?? null;
      const name = props?.name ?? null;
      if (symbolId == null && name == null) continue;
      out.push({
        entity,
        symbolId: String(symbolId ?? ""),
        name: String(name ?? ""),
        buildingIndex: -1,
        building: null,
        layer,
      });
    }
  }

  return out;
}

function hasPointGeometry(entity) {
  return entity.position != null || entity.point != null || entity.billboard != null;
}

function handleSearchInput() {
  const raw = searchInput.value.trim();
  transient.searchQuery = raw;
  if (!raw) {
    closeSearchDropdown();
    return;
  }
  const q = raw.toLowerCase();
  const all = getSearchableEntities();
  transient.searchResults = all
    .filter((item) => item.symbolId.toLowerCase().includes(q) || item.name.toLowerCase().includes(q))
    .slice(0, 25);
  transient.searchSelectedIndex = transient.searchResults.length > 0 ? 0 : -1;
  transient.searchOpen = true;
  renderSearchDropdown();
}

function handleSearchKeydown(e) {
  if (!transient.searchOpen) {
    if (e.key === "ArrowDown" && transient.searchResults.length > 0) {
      e.preventDefault();
      transient.searchOpen = true;
      renderSearchDropdown();
    }
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      if (transient.searchResults.length > 0) {
        transient.searchSelectedIndex = (transient.searchSelectedIndex + 1) % transient.searchResults.length;
        renderSearchDropdown();
      }
      break;
    case "ArrowUp":
      e.preventDefault();
      if (transient.searchResults.length > 0) {
        transient.searchSelectedIndex = (transient.searchSelectedIndex - 1 + transient.searchResults.length) % transient.searchResults.length;
        renderSearchDropdown();
      }
      break;
    case "Enter":
      e.preventDefault();
      if (transient.searchSelectedIndex >= 0 && transient.searchSelectedIndex < transient.searchResults.length) {
        selectSearchResult(transient.searchResults[transient.searchSelectedIndex]);
      } else if (transient.searchResults.length > 0) {
        selectSearchResult(transient.searchResults[0]);
      }
      break;
    case "Escape":
      e.preventDefault();
      closeSearchDropdown();
      searchInput.blur();
      break;
  }
}

function renderSearchDropdown() {
  if (!transient.searchOpen) {
    searchDropdown.style.display = "none";
    return;
  }
  if (transient.searchResults.length === 0) {
    searchDropdown.innerHTML = "";
    const noMatch = document.createElement("div");
    noMatch.className = "search-dropdown-empty";
    noMatch.textContent = t("search.noMatches");
    searchDropdown.appendChild(noMatch);
    searchDropdown.style.display = "";
    return;
  }

  searchDropdown.innerHTML = "";
  for (let i = 0; i < transient.searchResults.length; i++) {
    const item = transient.searchResults[i];
    const row = document.createElement("div");
    row.className = "search-dropdown-row" + (i === transient.searchSelectedIndex ? " selected" : "");
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      selectSearchResult(item);
    });
    row.addEventListener("mouseenter", () => {
      transient.searchSelectedIndex = i;
      searchDropdown.querySelectorAll(".search-dropdown-row").forEach((r, idx) => {
        r.classList.toggle("selected", idx === i);
      });
      row.scrollIntoView({ block: "nearest", behavior: "instant" });
    });

    const title = document.createElement("div");
    title.className = "search-dropdown-title";
    title.textContent = item.symbolId || item.name || t("search.untitledPoint");

    const subtitle = document.createElement("div");
    subtitle.className = "search-dropdown-subtitle";
    subtitle.textContent = buildSearchSubtitle(item);

    row.appendChild(title);
    row.appendChild(subtitle);
    searchDropdown.appendChild(row);
  }
  searchDropdown.style.display = "";

  if (transient.searchSelectedIndex >= 0) {
    const selectedRow = searchDropdown.querySelector(".search-dropdown-row.selected");
    if (selectedRow) {
      selectedRow.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }
}

function buildSearchSubtitle(item) {
  if (item.buildingIndex === -1) {
    return t("search.subtitleUnassigned", { layer: item.layer.name });
  }
  const b = item.building;
  const floorName = item.layer.levelKey == null
    ? t("level.allFloors")
    : (b.levels.find(l => (l.key ?? "") === item.layer.levelKey)?.name ?? item.layer.levelKey ?? "");
  return `${b.name} · ${item.layer.name} · ${floorName}`;
}

function closeSearchDropdown() {
  transient.searchOpen = false;
  searchDropdown.style.display = "none";
}

function selectSearchResult(item) {
  closeSearchDropdown();
  searchInput.value = "";
  transient.searchQuery = "";
  transient.searchResults = [];
  transient.searchSelectedIndex = -1;

  if (item.buildingIndex !== -1) {
    let targetLevelIndex = -1;
    if (item.layer.levelKey != null) {
      targetLevelIndex = item.building.levels.findIndex(
        (l) => (l.key ?? "") === item.layer.levelKey
      );
      if (targetLevelIndex === -1) targetLevelIndex = -1;
    }
    selectLevel(item.buildingIndex, targetLevelIndex);
  }

  const entity = item.entity;
  if (!entity) return;

  viewer.selectedEntity = entity;

  const offset = new HeadingPitchRange(0, CesiumMath.toRadians(-45), 80);
  viewer.flyTo(entity, { offset }).catch(() => {});
}

function handleSearchOutsideClick(e) {
  if (!transient.searchOpen) return;
  if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
    closeSearchDropdown();
  }
}

// -- Cesium InfoBox iframe theme injection --
function styleInfoBoxIframe() {
  const iframe = document.querySelector(".cesium-infoBox-iframe");
  if (!iframe) return;

  let attempts = 0;
  const maxAttempts = 20; // 20 x 50ms = 1s

  const inject = () => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !doc.body) {
        if (++attempts < maxAttempts) {
          setTimeout(inject, 50);
        }
        return;
      }

      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      const bg = isLight ? "#fcfcff" : "#121218";
      const bgAlt = isLight ? "#f4f4f7" : "#0f0f14";
      const text = isLight ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.87)";
      const muted = isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)";
      const border = isLight ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.07)";
      const accent = "#0696D7";

      const styleId = "app-theme-info-box";
      let style = doc.getElementById(styleId);
      if (!style) {
        style = doc.createElement("style");
        style.id = styleId;
        doc.head.appendChild(style);
      }

      style.textContent = `
        html, body, body > div, body > div > div, .cesium-infoBox-description {
          background: ${bg} !important;
          color: ${text} !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif !important;
          font-size: 12px !important;
        }
        table, tbody, thead, tr, td, th {
          background: transparent !important;
          color: ${text} !important;
          border-color: ${border} !important;
        }
        tr {
          background: ${bg} !important;
        }
        tr:nth-child(even) {
          background: ${bgAlt} !important;
        }
        tr:nth-child(odd) {
          background: ${bg} !important;
        }
        td, th {
          padding: 4px 6px !important;
          border-bottom: 1px solid ${border} !important;
          font-size: 12px !important;
        }
        td:first-child {
          color: ${muted} !important;
          width: 40% !important;
          font-weight: 500 !important;
        }
        td:last-child {
          color: ${text} !important;
          word-break: break-all !important;
        }
        a {
          color: ${accent} !important;
        }
      `;
    } catch {
      // Cross-origin iframe — silently skip
    }
  };

  inject();
}

// Watch for the info box becoming visible or its iframe being recreated.
function initInfoBoxStyling() {
  const infoBox = document.querySelector(".cesium-infoBox");
  if (!infoBox) return;

  // Trigger when the info box becomes visible.
  const classObserver = new MutationObserver(() => {
    if (infoBox.classList.contains("cesium-infoBox-visible")) {
      styleInfoBoxIframe();
    }
  });
  classObserver.observe(infoBox, { attributes: true, attributeFilter: ["class"] });

  // Trigger when the iframe element is replaced (Cesium recreates it).
  const childObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.classList && node.classList.contains("cesium-infoBox-iframe")) {
          styleInfoBoxIframe();
          break;
        }
      }
    }
  });
  childObserver.observe(infoBox, { childList: true, subtree: true });
}

init();
