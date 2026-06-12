// Non-blocking import review tray for GDB / shapefile feature collections.
// Replaces the blocking 5-column modal: silently imports high-confidence
// matches, then surfaces only ambiguous rows grouped by source so the user
// can resolve many layers in a few clicks.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Cartographic, Math as CesiumMath } from "cesium";

import { t } from "./i18n.js";
import { notifyUser } from "./notifications.js";
import { detectSource, summarizeGeometry } from "./gdbAutoMatch.js";
import { partitionForReview } from "./importGroupClassifier.js";
import {
  TARGET_SKIP,
  TARGET_UNASSIGNED,
  FLOOR_ALL,
  buildBuildingSelect,
  buildFloorSelect,
  buildingIndexFromValue,
  stripExt,
} from "./gdbAssignmentControls.js";

// Stable palette cycled by group index so list swatches and map geometries
// match. Picked to stay readable on both dark and light tray themes.
const GROUP_COLORS = ["#FFC090", "#80CBC4", "#C5CAE9", "#F8BBD0", "#A5D6A7", "#FFE082"];

const MAX_MAP_FEATURES_PER_GROUP = 50;

let activeTray = null;

export function openImportReviewTray({
  featureCollections,
  buildings,
  viewer = null,
  mode = "import",
  onImport,
  onSilentImport,
  onUndoAutoImport,
  defaultBuildingIndex = null,
  defaultLevelKey = null,
  onOpenClassicTable,
}) {
  if (activeTray) activeTray.close();

  const { autoImport, needsReview, metadataOnly } = partitionForReview(
    featureCollections,
    buildings,
  );
  void metadataOnly; // dropped silently, matches today's dialog behaviour

  const autoCount = autoImport.length;
  const reviewCount = needsReview.length;

  // Silently apply the high-confidence picks before the tray mounts so the
  // user sees the auto-imported layers in the scene immediately.
  const silentPromise = autoCount > 0 && onSilentImport
    ? Promise.resolve(onSilentImport(autoImport))
    : Promise.resolve();

  silentPromise.then(() => {
    if (autoCount > 0 && reviewCount > 0) {
      notifyUser("info", "import.tray.autoImported", { auto: autoCount, review: reviewCount });
    } else if (autoCount > 0 && reviewCount === 0) {
      notifyUser("info", "import.tray.allAutoImported", { auto: autoCount });
    }
    // TODO: wire an Undo action onto the toast when we have a toast API
    // for actionable messages; for now the user can drag silently-imported
    // layers back via the scene tree. onUndoAutoImport is plumbed so the
    // future UI doesn't require another refactor.
    void onUndoAutoImport;
  });

  if (reviewCount === 0) return null;

  return mountTray({
    needsReview,
    buildings,
    viewer,
    mode,
    onImport,
    onOpenClassicTable,
    defaultBuildingIndex,
    defaultLevelKey,
  });
}

function mountTray({
  needsReview,
  buildings,
  viewer,
  mode,
  onImport,
  onOpenClassicTable,
  defaultBuildingIndex,
  defaultLevelKey,
}) {
  const groups = buildGroups(needsReview, buildings, { defaultBuildingIndex, defaultLevelKey });
  groups.forEach((g, i) => { g.color = GROUP_COLORS[i % GROUP_COLORS.length]; });

  const showMap = !!viewer;
  let focusedGroupKey = groups[0]?.key ?? null;

  const tray = document.createElement("aside");
  tray.id = "importReviewTray";
  tray.className = "import-tray" + (showMap ? " with-map" : "");

  // ── Header ──────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "import-tray-header";
  const title = document.createElement("span");
  title.className = "import-tray-title";
  title.textContent = t(mode === "reassign" ? "import.tray.reassignTitle" : "import.tray.title");
  header.appendChild(title);

  if (onOpenClassicTable) {
    const tableBtn = document.createElement("button");
    tableBtn.type = "button";
    tableBtn.className = "secondary-btn compact";
    tableBtn.textContent = t("import.tray.openAsTable");
    tableBtn.addEventListener("click", () => {
      close();
      onOpenClassicTable();
    });
    header.appendChild(tableBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "import-tray-close";
  closeBtn.textContent = "x";
  closeBtn.title = t("modal.close");
  closeBtn.addEventListener("click", () => close());
  header.appendChild(closeBtn);
  tray.appendChild(header);

  // ── Body — split into a scrollable list + optional map pane. ─────────
  const split = document.createElement("div");
  split.className = "import-tray-split";
  tray.appendChild(split);

  const body = document.createElement("div");
  body.className = "import-tray-body";
  split.appendChild(body);

  let mapPane = null;
  let mapContext = null;
  if (showMap) {
    mapPane = document.createElement("div");
    mapPane.className = "import-tray-map";
    split.appendChild(mapPane);
  }

  // ── Footer ──────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "import-tray-footer";
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "primary-btn compact";
  const skipRestBtn = document.createElement("button");
  skipRestBtn.type = "button";
  skipRestBtn.className = "secondary-btn compact";
  skipRestBtn.textContent = t("import.tray.skipRest");
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary-btn compact";
  cancelBtn.textContent = t("popover.cancel");
  cancelBtn.addEventListener("click", () => close());
  footer.appendChild(skipRestBtn);
  footer.appendChild(cancelBtn);
  footer.appendChild(importBtn);
  tray.appendChild(footer);

  document.body.appendChild(tray);
  requestAnimationFrame(() => tray.classList.add("open"));

  if (mapPane) {
    // Leaflet measures its container on init; defer past the layout reflow.
    requestAnimationFrame(() => {
      mapContext = initMapPane(mapPane, viewer, buildings, groups, {
        onAssignBuildingToFocusedGroup: (buildingIndex) => {
          const group = groups.find((g) => g.key === focusedGroupKey);
          if (!group) return;
          assignBuildingToGroup(group, buildingIndex);
          renderGroups();
        },
      });
      mapContext.renderGroups(groups, focusedGroupKey);
    });
  }

  let submitting = false;

  function close() {
    if (submitting) return;
    mapContext?.destroy();
    if (tray.parentNode) tray.parentNode.removeChild(tray);
    if (activeTray?.tray === tray) activeTray = null;
  }

  function assignBuildingToGroup(group, buildingIndex) {
    const stringIdx = String(buildingIndex);
    for (const m of group.members) {
      if (m.buildingManual) continue;
      m.buildingValue = stringIdx;
      m.levelValue = FLOOR_ALL;
      m.floorManual = false;
    }
    notifyUser("info", "import.tray.assignedFromMap", {
      group: group.label,
      building: buildings[buildingIndex]?.name ?? "?",
    });
  }

  function pendingMemberCount() {
    let n = 0;
    for (const g of groups) {
      for (const m of g.members) {
        if (m.buildingValue !== TARGET_SKIP) n++;
      }
    }
    return n;
  }

  function refreshFooter() {
    importBtn.textContent = t("import.tray.import", { n: pendingMemberCount() });
    importBtn.disabled = pendingMemberCount() === 0;
  }

  function renderGroups() {
    body.innerHTML = "";
    if (groups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "import-tray-empty";
      empty.textContent = t("import.tray.empty");
      body.appendChild(empty);
    }
    for (const group of groups) {
      body.appendChild(buildGroupNode(group));
    }
    refreshFooter();
    mapContext?.renderGroups(groups, focusedGroupKey);
  }

  function setFocusedGroup(key) {
    if (focusedGroupKey === key) return;
    focusedGroupKey = key;
    renderGroups();
    const group = groups.find((g) => g.key === key);
    if (group) mapContext?.focusGroup(group);
  }

  function buildGroupNode(group) {
    const node = document.createElement("section");
    node.className = "import-tray-group" + (group.collapsed ? " collapsed" : "");
    if (group.key === focusedGroupKey) node.classList.add("focused");

    // First head row: chevron + swatch + label + summary.
    const head = document.createElement("header");
    head.className = "import-tray-group-head";
    head.addEventListener("click", () => setFocusedGroup(group.key));

    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "import-tray-chevron";
    chevron.textContent = group.collapsed ? "›" : "⌄";
    chevron.title = t(group.collapsed ? "import.tray.expand" : "import.tray.collapse");
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      group.collapsed = !group.collapsed;
      renderGroups();
    });
    head.appendChild(chevron);

    const swatch = document.createElement("span");
    swatch.className = "import-tray-group-swatch";
    swatch.style.background = group.color;
    head.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "import-tray-group-label";
    label.textContent = group.label;
    label.title = group.label;
    head.appendChild(label);

    const summary = document.createElement("span");
    summary.className = "import-tray-group-summary";
    summary.textContent = group.geometrySummary
      ? t("import.tray.groupSummary", {
          count: group.members.length,
          geom: group.geometrySummary,
        })
      : t("import.tray.groupCount", { count: group.members.length });
    head.appendChild(summary);
    node.appendChild(head);

    // Second head row: pickers + Accept/Skip icon buttons (compact, always
    // visible — collapsed groups can still be assigned and accepted without
    // expanding). The propagation logic mirrors what bulk assignment did
    // before but inline.
    const pickerRow = document.createElement("div");
    pickerRow.className = "import-tray-group-pickers";

    const groupBuildingValue = sharedBuildingValue(group);
    const buildingSel = buildBuildingSelect(buildings, groupBuildingValue ?? "");
    buildingSel.title = t("import.tray.applyBuilding");
    buildingSel.addEventListener("change", () => {
      for (const m of group.members) {
        if (m.buildingManual) continue;
        m.buildingValue = buildingSel.value;
        m.levelValue = FLOOR_ALL;
        m.floorManual = false;
      }
      renderGroups();
    });
    pickerRow.appendChild(buildingSel);

    const groupFloorValue = sharedFloorValue(group);
    const floorSel = buildFloorSelect(buildings, groupBuildingValue ?? "", groupFloorValue ?? FLOOR_ALL);
    floorSel.title = t("import.tray.applyFloor");
    floorSel.addEventListener("change", () => {
      for (const m of group.members) {
        if (m.floorManual) continue;
        if (m.buildingValue !== groupBuildingValue) continue;
        m.levelValue = floorSel.value;
      }
      renderGroups();
    });
    pickerRow.appendChild(floorSel);

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "import-tray-icon-btn accept";
    acceptBtn.textContent = "✓";
    acceptBtn.title = t("import.tray.group.acceptTitle");
    acceptBtn.disabled =
      buildingIndexFromValue(buildings, buildingSel.value) == null &&
      buildingSel.value !== TARGET_UNASSIGNED;
    acceptBtn.addEventListener("click", () => submitGroup(group));
    pickerRow.appendChild(acceptBtn);

    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "import-tray-icon-btn skip";
    skipBtn.textContent = "✗";
    skipBtn.title = t("import.tray.group.skip");
    skipBtn.addEventListener("click", () => {
      for (const m of group.members) {
        m.buildingValue = TARGET_SKIP;
        m.buildingManual = true;
      }
      renderGroups();
    });
    pickerRow.appendChild(skipBtn);

    node.appendChild(pickerRow);

    // Member rows (visible when expanded).
    if (!group.collapsed) {
      const memberList = document.createElement("ul");
      memberList.className = "import-tray-members";
      for (const m of group.members) {
        memberList.appendChild(buildMemberRow(m, group));
      }
      node.appendChild(memberList);
    }
    return node;
  }

  function buildMemberRow(member, group) {
    const li = document.createElement("li");
    li.className = "import-tray-member";
    if (member.buildingValue === TARGET_SKIP) li.classList.add("skipped");

    // Click → zoom the map to this layer's bounds. Hover → ephemeral
    // highlight that doesn't change the group focus.
    li.addEventListener("click", (e) => {
      // Ignore clicks that come from interacting with the row's <select>s.
      if (e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return;
      setFocusedGroup(group.key);
      mapContext?.focusMember(member);
    });
    li.addEventListener("mouseenter", () => mapContext?.highlightMember(member, true));
    li.addEventListener("mouseleave", () => mapContext?.highlightMember(member, false));

    const name = document.createElement("span");
    name.className = "import-tray-member-name";
    name.textContent = stripExt(member.fc.fileName ?? "");
    name.title = name.textContent;
    li.appendChild(name);

    const confidence = document.createElement("span");
    confidence.className = `import-tray-confidence conf-${member.match?.confidence ?? "none"}`;
    confidence.title = t(`import.tray.confidence.${member.match?.confidence ?? "none"}`);
    li.appendChild(confidence);

    const buildingSel = buildBuildingSelect(buildings, member.buildingValue);
    buildingSel.addEventListener("change", () => {
      member.buildingValue = buildingSel.value;
      member.buildingManual = true;
      member.levelValue = FLOOR_ALL;
      member.floorManual = false;
      renderGroups();
    });
    li.appendChild(buildingSel);

    const floorSel = buildFloorSelect(buildings, member.buildingValue, member.levelValue);
    floorSel.addEventListener("change", () => {
      member.levelValue = floorSel.value;
      member.floorManual = true;
      refreshFooter();
    });
    li.appendChild(floorSel);

    void group;
    return li;
  }

  function buildDecisionsFor(members) {
    const decisions = [];
    for (const m of members) {
      if (m.buildingValue === TARGET_SKIP) continue;
      if (m.buildingValue === TARGET_UNASSIGNED) {
        decisions.push({ fc: m.fc, target: { kind: "unassigned" } });
        continue;
      }
      const bi = buildingIndexFromValue(buildings, m.buildingValue);
      if (bi == null) continue;
      decisions.push({
        fc: m.fc,
        target: {
          kind: "building",
          buildingIndex: bi,
          levelKey: m.levelValue === FLOOR_ALL ? null : m.levelValue,
        },
      });
    }
    return decisions;
  }

  async function submitDecisions(decisions, removeGroups) {
    if (submitting) return;
    if (decisions.length === 0) return;
    submitting = true;
    importBtn.disabled = true;
    skipRestBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await onImport(decisions);
      for (const g of removeGroups) {
        const idx = groups.indexOf(g);
        if (idx >= 0) groups.splice(idx, 1);
      }
      if (groups.length === 0) {
        close();
      } else {
        submitting = false;
        importBtn.disabled = false;
        skipRestBtn.disabled = false;
        cancelBtn.disabled = false;
        renderGroups();
      }
    } catch (e) {
      submitting = false;
      importBtn.disabled = false;
      skipRestBtn.disabled = false;
      cancelBtn.disabled = false;
      notifyUser("error", "alert.failedGdb", { message: e?.message ?? String(e) });
    }
  }

  function submitGroup(group) {
    const decisions = buildDecisionsFor(group.members);
    if (decisions.length === 0) {
      notifyUser("warn", "import.tray.nothingToImport");
      return;
    }
    submitDecisions(decisions, [group]);
  }

  importBtn.addEventListener("click", () => {
    const decisions = [];
    const groupsToRemove = [];
    for (const g of groups) {
      const d = buildDecisionsFor(g.members);
      if (d.length > 0) {
        decisions.push(...d);
        groupsToRemove.push(g);
      }
    }
    if (decisions.length === 0) {
      notifyUser("warn", "import.tray.nothingToImport");
      return;
    }
    submitDecisions(decisions, groupsToRemove);
  });

  skipRestBtn.addEventListener("click", () => {
    for (const g of groups) {
      for (const m of g.members) {
        if (m.buildingValue !== TARGET_SKIP) {
          m.buildingValue = TARGET_SKIP;
        }
      }
    }
    close();
  });

  renderGroups();

  const handle = { tray, close };
  activeTray = handle;
  return handle;
}

function initMapPane(mapPane, viewer, buildings, groups, { onAssignBuildingToFocusedGroup }) {
  const cam = viewer?.camera?.positionCartographic;
  const initialLat = cam ? CesiumMath.toDegrees(cam.latitude) : 35.6812;
  const initialLng = cam ? CesiumMath.toDegrees(cam.longitude) : 139.7671;
  const initialAlt = cam?.height ?? 5000;
  const initialZoom = Math.max(4, Math.min(17, Math.round(14 - Math.log2(initialAlt / 500))));

  const map = L.map(mapPane, { zoomControl: true, attributionControl: false })
    .setView([initialLat, initialLng], initialZoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OSM",
    maxZoom: 19,
  }).addTo(map);

  // Building markers. Clicking one assigns it to the currently focused group.
  const buildingLayer = L.layerGroup().addTo(map);
  const buildingPositions = [];
  buildings.forEach((b, i) => {
    const center = b?.tileset?.boundingSphere?.center;
    if (!center) return;
    const carto = Cartographic.fromCartesian(center);
    if (!carto) return;
    const lat = CesiumMath.toDegrees(carto.latitude);
    const lng = CesiumMath.toDegrees(carto.longitude);
    buildingPositions.push({ buildingIndex: i, lat, lng });
    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: "#0696D7",
      weight: 2,
      fillColor: "#0696D7",
      fillOpacity: 0.35,
    }).addTo(buildingLayer);
    marker.bindTooltip(b.name, { direction: "top", offset: [0, -8] });
    marker.on("click", () => onAssignBuildingToFocusedGroup?.(i));
  });

  // Group geometry layer — rebuilt each call to renderGroups().
  const groupLayer = L.layerGroup().addTo(map);
  let highlightedKey = null;

  function clearGroupLayer() {
    groupLayer.clearLayers();
  }

  function buildGroupGeoJSON(group) {
    const features = [];
    let limit = 0;
    for (const m of group.members) {
      for (const f of m.fc?.features ?? []) {
        if (!f?.geometry) continue;
        features.push({ type: "Feature", geometry: f.geometry, properties: {} });
        if (++limit >= MAX_MAP_FEATURES_PER_GROUP) break;
      }
      if (limit >= MAX_MAP_FEATURES_PER_GROUP) break;
    }
    return { type: "FeatureCollection", features };
  }

  function renderGroups(currentGroups, focusedKey) {
    // Render only the focused group on the map. Showing every group at once
    // turned out to be visual noise — the user wants to see exactly what
    // they're about to assign. Hover on a member row briefly highlights
    // that specific layer via the highlight overlay.
    clearGroupLayer();
    highlightedKey = focusedKey;
    const focused = currentGroups.find((g) => g.key === focusedKey);
    if (!focused) return;
    const layer = L.geoJSON(buildGroupGeoJSON(focused), {
      style: {
        color: focused.color,
        weight: 3,
        opacity: 1,
        fillOpacity: 0.45,
        fillColor: focused.color,
      },
      pointToLayer: (_feat, latlng) =>
        L.circleMarker(latlng, {
          radius: 7,
          color: "#222",
          fillColor: focused.color,
          weight: 1,
          opacity: 1,
          fillOpacity: 0.95,
        }),
    });
    groupLayer.addLayer(layer);
  }

  function fitTo(geojson, animate = true) {
    const gj = L.geoJSON(geojson);
    if (gj.getLayers().length === 0) return false;
    const bounds = gj.getBounds();
    if (!bounds.isValid()) return false;
    map.fitBounds(bounds.pad(0.4), { maxZoom: 17, animate });
    return true;
  }

  function focusGroup(group) {
    if (!group) return;
    fitTo(buildGroupGeoJSON(group), true);
    renderGroups(groups, group.key);
  }

  function focusMember(member) {
    if (!member) return;
    fitTo(buildMemberGeoJSON(member), true);
  }

  function highlightMember(member, on) {
    // Ephemeral overlay so hovering a row doesn't disturb the focus state.
    if (highlightOverlay) {
      groupLayer.removeLayer(highlightOverlay);
      highlightOverlay = null;
    }
    if (!on || !member) return;
    const overlay = L.geoJSON(buildMemberGeoJSON(member), {
      style: { color: "#fff", weight: 3, opacity: 1, fillColor: "#fff", fillOpacity: 0.35 },
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { radius: 9, color: "#fff", weight: 2, fillColor: "#fff", fillOpacity: 0.7 }),
    });
    groupLayer.addLayer(overlay);
    highlightOverlay = overlay;
  }
  let highlightOverlay = null;

  // Initial view: prefer the focused group's geometry; fall back to all
  // groups; then to building footprints; then the camera default.
  const initialFocus = groups[0];
  if (!fitTo(buildGroupGeoJSON(initialFocus ?? { members: [] }), false)) {
    const all = { type: "FeatureCollection", features: [] };
    for (const g of groups) all.features.push(...buildGroupGeoJSON(g).features);
    if (!fitTo(all, false) && buildingPositions.length > 0) {
      const bounds = L.latLngBounds(buildingPositions.map((b) => [b.lat, b.lng]));
      map.fitBounds(bounds.pad(0.4), { maxZoom: 17, animate: false });
    }
  }

  return {
    renderGroups,
    focusGroup,
    focusMember,
    highlightMember,
    destroy: () => {
      try { map.remove(); } catch { /* already torn down */ }
    },
    get highlightedKey() { return highlightedKey; },
  };
}

function buildMemberGeoJSON(member) {
  const features = [];
  for (const f of member?.fc?.features ?? []) {
    if (!f?.geometry) continue;
    features.push({ type: "Feature", geometry: f.geometry, properties: {} });
  }
  return { type: "FeatureCollection", features };
}

function sharedBuildingValue(group) {
  let val = null;
  for (const m of group.members) {
    if (val === null) val = m.buildingValue;
    else if (m.buildingValue !== val) return null;
  }
  return val;
}

function sharedFloorValue(group) {
  let val = null;
  for (const m of group.members) {
    if (val === null) val = m.levelValue;
    else if (m.levelValue !== val) return null;
  }
  return val;
}

function buildGroups(needsReview, buildings, { defaultBuildingIndex, defaultLevelKey }) {
  const groupsByKey = new Map();
  for (const item of needsReview) {
    const key = deriveGroupKey(item.fc);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, { key, label: key, members: [], collapsed: false, geometrySummary: "" });
    }
    const member = buildMember(item, buildings, { defaultBuildingIndex, defaultLevelKey });
    groupsByKey.get(key).members.push(member);
  }
  const groups = Array.from(groupsByKey.values());
  for (const g of groups) {
    g.geometrySummary = summarizeGroupGeometry(g.members);
    // Collapse groups with many members so the user sees a compact list of
    // group heads first. Small groups stay expanded so single-layer items
    // are immediately reviewable.
    if (g.members.length > 4) g.collapsed = true;
  }
  return groups;
}

function deriveGroupKey(fc) {
  // Reject sources that are too short or purely numeric — those produce
  // useless labels like "1" / "2" that don't help the user identify the
  // group. Fall back to a filename-derived key instead.
  const source = detectSource(fc?.features ?? []);
  if (source && source.length >= 3 && !/^\d+$/.test(source)) return source;
  const name = stripExt(fc?.fileName ?? "");
  const trimmed = name.replace(/_[^_]+$/, "");
  if (trimmed && trimmed.length >= 2) return trimmed;
  if (name) return name;
  return t("import.tray.noSource");
}

function buildMember(item, buildings, { defaultBuildingIndex, defaultLevelKey }) {
  const { fc, match } = item;
  let buildingValue;
  let levelValue = FLOOR_ALL;
  let buildingManual = false;
  let floorManual = false;

  if (typeof defaultBuildingIndex === "number" && buildings[defaultBuildingIndex]) {
    buildingValue = String(defaultBuildingIndex);
    buildingManual = true;
    if (defaultLevelKey != null) {
      levelValue = String(defaultLevelKey);
      floorManual = true;
    }
  } else if (match?.buildingIndex >= 0) {
    buildingValue = String(match.buildingIndex);
    if (match.levelKey != null) levelValue = String(match.levelKey);
  } else {
    buildingValue = TARGET_UNASSIGNED;
  }

  return {
    fc,
    match,
    buildingValue,
    levelValue,
    buildingManual,
    floorManual,
  };
}

function summarizeGroupGeometry(members) {
  const geoms = new Set();
  for (const m of members) {
    const g = summarizeGeometry(m.fc?.features ?? []);
    if (g && g !== "UNKNOWN") geoms.add(g);
  }
  if (geoms.size === 0) return "";
  if (geoms.size === 1) return t(`gdb.dialog.geom.${[...geoms][0].toLowerCase()}`);
  return t("gdb.dialog.geom.mixed");
}
