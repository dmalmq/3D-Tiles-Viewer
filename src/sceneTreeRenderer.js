import {
  filterVisibleBuildings,
  shapefilesForModelLevel,
  unassignedShapefilesAll,
  computeSceneItemCount,
  collectLayerTypes,
} from "./sceneTreeView.js";

const CHEVRON_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="3,2 7,5 3,8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SECTION_CHEVRON_SVG =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="2,4 6,8 10,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ZOOM_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' +
  '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/>' +
  '<path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
  "</svg>";
const EYE_VISIBLE_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_HIDDEN_SVG =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="2"/><path d="M3 13L13 3" stroke-linecap="round"/></svg>';
const ISOLATE_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/></svg>';

const LAYER_TYPE_ORDER = ["space", "unit", "opening", "detail", "level"];

export function renderSceneTree({
  container,
  buildings,
  importedLayers,
  unassignedLayers,
  modelLevels,
  visibleFloorNumbers,
  showModelLevels = true,
  selection = {},
  callbacks = {},
  itemCountEl,
  placeholderEl,
  layerTypeFiltersEl,
  layerTypeFilters,
  onToggleLayerType,
}) {
  void importedLayers;
  if (!container) return { visibleBuildings: [] };

  installSceneTreeDelegates(container);
  container.__sceneTreeCallbacks = callbacks;
  container.innerHTML = "";

  const filterRaw = (selection.filterRaw ?? "").trim().toLowerCase();
  const visibleBuildings = filterVisibleBuildings(buildings, filterRaw);

  updateItemCount(itemCountEl, callbacks, buildings, unassignedLayers, filterRaw, visibleBuildings.length);
  updatePlaceholder(placeholderEl, buildings, unassignedLayers);

  if (buildings.length === 0 && unassignedLayers.length === 0) {
    updateLayerTypeFilters(layerTypeFiltersEl, null, layerTypeFilters, onToggleLayerType);
    return { visibleBuildings };
  }

  if (showModelLevels) {
    container.appendChild(buildModelLevelsSection({
      buildings,
      modelLevels,
      unassignedLayers,
      filterRaw,
      selection,
      callbacks,
      visibleFloorNumbers,
    }));
  }

  let showLayerTypeFilters = false;
  if (visibleBuildings.length > 0) {
    const buildingSection = buildBuildingsSection({
      visibleBuildings,
      selection,
      callbacks,
    });
    container.appendChild(buildingSection);
    showLayerTypeFilters = selection.buildingsSectionExpanded !== false;
  }

  const types = showLayerTypeFilters ? collectLayerTypes(buildings, unassignedLayers) : null;
  updateLayerTypeFilters(layerTypeFiltersEl, types, layerTypeFilters, onToggleLayerType);

  return { visibleBuildings };
}

function updateItemCount(el, callbacks, buildings, unassignedLayers, filterRaw, visibleCount) {
  if (!el) return;
  const info = computeSceneItemCount(buildings, unassignedLayers, filterRaw, visibleCount);
  el.textContent = info.text ? translate(callbacks, info.text.key, info.text.params) : "";
}

function updatePlaceholder(el, buildings, unassignedLayers) {
  if (!el) return;
  const info = computeSceneItemCount(buildings, unassignedLayers, "", 0);
  el.style.display = info.showPlaceholder ? "" : "none";
}

function updateLayerTypeFilters(el, types, layerTypeFilters, onToggleLayerType) {
  if (!el) return;
  if (!types || types.size === 0) {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.innerHTML = "";
  for (const type of LAYER_TYPE_ORDER) {
    if (!types.has(type)) continue;
    const btn = document.createElement("button");
    btn.className = "layer-type-filter" + (layerTypeFilters?.[type] ? " active" : "");
    btn.textContent = "_" + type;
    btn.dataset.type = type;
    btn.addEventListener("click", () => onToggleLayerType?.(type));
    el.appendChild(btn);
  }
  el.style.display = "";
}

function installSceneTreeDelegates(container) {
  if (container.__sceneTreeDelegatesInstalled) return;
  container.__sceneTreeDelegatesInstalled = true;

  container.addEventListener("click", (event) => {
    const actionEl = closestWithin(event.target, container, "[data-scene-action]");
    if (!actionEl) return;
    handleSceneAction(container, actionEl, event);
  });

  container.addEventListener("contextmenu", (event) => {
    const contextEl = closestWithin(event.target, container, "[data-scene-context]");
    if (!contextEl) return;
    event.preventDefault();
    event.stopPropagation();
    handleSceneContext(container, contextEl, event);
  });

  container.addEventListener("dragstart", (event) => {
    const row = closestWithin(event.target, container, "[data-drag-layer]");
    if (!row) return;
    const callbacks = getCallbacks(container);
    callbacks.startLayerDrag?.({
      event,
      row,
      layer: row.__sceneTreeContext?.layer,
      fromBi: row.__sceneTreeContext?.fromBi,
    });
  });

  container.addEventListener("dragend", (event) => {
    const row = closestWithin(event.target, container, "[data-drag-layer]");
    const callbacks = getCallbacks(container);
    callbacks.endLayerDrag?.({ event, row });
  });

  container.addEventListener("dragover", (event) => {
    const targetEl = closestWithin(event.target, container, "[data-drop-target]");
    if (!targetEl) return;
    const target = targetEl.__dropTarget;
    const callbacks = getCallbacks(container);
    const isFileDrag = Array.from(event.dataTransfer?.types ?? []).includes("Files");
    if (isFileDrag) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      targetEl.classList.add("drop-target-active");
      return;
    }
    if (callbacks.dropWouldBeNoop?.(target)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    targetEl.classList.add("drop-target-active");
  });

  container.addEventListener("dragleave", (event) => {
    const targetEl = closestWithin(event.target, container, "[data-drop-target]");
    if (!targetEl || targetEl.contains(event.relatedTarget)) return;
    targetEl.classList.remove("drop-target-active");
  });

  container.addEventListener("drop", async (event) => {
    const targetEl = closestWithin(event.target, container, "[data-drop-target]");
    if (!targetEl) return;
    const target = targetEl.__dropTarget;
    const callbacks = getCallbacks(container);

    // OS file drop on a tree row preempts the intra-tree layer drag path so
    // the document-level drop listener doesn't also fire.
    const isFileDrag = Array.from(event.dataTransfer?.types ?? []).includes("Files");
    if (isFileDrag) {
      event.preventDefault();
      event.stopPropagation();
      targetEl.classList.remove("drop-target-active");
      // Stash files before any await — DataTransfer entries don't survive past this tick.
      const files = Array.from(event.dataTransfer.files ?? []);
      await callbacks.dropFilesOnTarget?.(target, files, event);
      return;
    }

    if (callbacks.dropWouldBeNoop?.(target)) return;
    event.preventDefault();
    event.stopPropagation();
    targetEl.classList.remove("drop-target-active");
    await callbacks.dropLayer?.(target, event);
  });
}

function handleSceneAction(container, el, event) {
  const callbacks = getCallbacks(container);
  const ctx = el.__sceneTreeContext ?? {};
  switch (el.dataset.sceneAction) {
    case "select-model-level":
      callbacks.selectModelLevel?.(ctx.modelLevelIndex);
      break;
    case "toggle-model-level":
      callbacks.toggleModelLevelExpanded?.(ctx.modelLevelIndex);
      break;
    case "toggle-unassigned":
      callbacks.toggleUnassignedExpanded?.();
      break;
    case "toggle-buildings-section":
      callbacks.toggleBuildingsSection?.();
      break;
    case "toggle-building":
      callbacks.toggleBuildingExpanded?.(ctx.buildingIndex);
      break;
    case "select-building":
      callbacks.selectBuilding?.(ctx.buildingIndex);
      break;
    case "zoom-building":
      event.stopPropagation();
      callbacks.zoomBuilding?.(ctx.buildingIndex);
      break;
    case "isolate-building":
      event.stopPropagation();
      callbacks.isolateBuilding?.(ctx.buildingIndex);
      break;
    case "remove-building":
      event.stopPropagation();
      callbacks.removeBuilding?.(ctx.buildingIndex);
      break;
    case "reload-building":
      event.stopPropagation();
      callbacks.reloadBuilding?.(ctx.buildingIndex);
      break;
    case "select-level":
      callbacks.selectLevel?.(ctx.buildingIndex, ctx.levelIndex);
      break;
    case "select-layer":
      callbacks.selectLayer?.(ctx, event);
      break;
    case "toggle-layer-visibility":
      event.stopPropagation();
      callbacks.toggleLayerVisibility?.(ctx);
      break;
    case "remove-layer":
      event.stopPropagation();
      callbacks.removeLayer?.(ctx);
      break;
    case "open-floor-picker":
      event.stopPropagation();
      callbacks.openLayerFloorPicker?.(ctx, event);
      break;
  }
}

function handleSceneContext(container, el, event) {
  const callbacks = getCallbacks(container);
  const ctx = el.__sceneTreeContext ?? {};
  switch (el.dataset.sceneContext) {
    case "model-level":
      callbacks.showModelLevelContextMenu?.(event, ctx.modelLevelIndex);
      break;
    case "building":
      callbacks.showBuildingContextMenu?.(event, ctx.buildingIndex);
      break;
    case "building-level":
      callbacks.showLevelContextMenu?.(event, ctx.buildingIndex, ctx.levelIndex);
      break;
    case "layer":
      callbacks.showLayerContextMenu?.(event, ctx);
      break;
  }
}

function buildModelLevelsSection({ buildings, modelLevels, unassignedLayers, filterRaw, selection, callbacks, visibleFloorNumbers }) {
  const section = document.createElement("li");
  section.className = "panel-section model-levels-section";

  const list = document.createElement("ul");
  list.className = "ml-list";
  list.appendChild(buildAllFloorsRow(selection, callbacks));

  for (let mli = modelLevels.length - 1; mli >= 0; mli--) {
    const ml = modelLevels[mli];
    if (visibleFloorNumbers && !visibleFloorNumbers.has(ml.floorNumber)) continue;
    const shapefiles = shapefilesForModelLevel(buildings, ml.floorNumber, filterRaw);
    if (filterRaw && shapefiles.length === 0) continue;
    const expanded = filterRaw ? true : ml._expanded === true;
    list.appendChild(buildModelLevelRow(ml, mli, shapefiles.length, expanded, selection));
    if (expanded && shapefiles.length > 0) {
      list.appendChild(buildLayerChildren(shapefiles, { flat: true, callbacks, selectedLayers: selection.selectedLayers }));
    }
  }

  const unassigned = unassignedShapefilesAll(buildings, unassignedLayers, filterRaw);
  if (unassigned.length > 0) {
    const expanded = filterRaw ? true : !!selection.unassignedTreeExpanded;
    list.appendChild(buildUnassignedRow(expanded, callbacks));
    if (expanded) {
      list.appendChild(buildLayerChildren(unassigned, { flat: true, callbacks, selectedLayers: selection.selectedLayers }));
    }
  }

  section.appendChild(list);
  return section;
}

function buildAllFloorsRow(selection, callbacks) {
  const row = document.createElement("li");
  row.className = "level-item ml-row all-floors" + (selection.activeModelLevelIndex === -1 ? " selected" : "");
  appendChevron(row, null);
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "modelLevelRadio";
  radio.checked = selection.activeModelLevelIndex === -1;
  radio.tabIndex = -1;
  row.appendChild(radio);
  appendText(row, "span", "level-name-text", translate(callbacks, "level.allFloors"));
  setAction(row, "select-model-level", { modelLevelIndex: -1 });
  return row;
}

function buildModelLevelRow(ml, modelLevelIndex, shapefileCount, expanded, selection) {
  const row = document.createElement("li");
  row.className = "level-item ml-row" + (selection.activeModelLevelIndex === modelLevelIndex ? " selected" : "");
  appendChevron(
    row,
    shapefileCount > 0 ? expanded : null,
    "toggle-model-level",
    { modelLevelIndex },
  );

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "modelLevelRadio";
  radio.checked = selection.activeModelLevelIndex === modelLevelIndex;
  radio.tabIndex = -1;
  row.appendChild(radio);
  appendText(row, "span", "level-name-text", ml.name);
  appendText(row, "span", "level-ceiling", `${ml.elevation.toFixed(1)} m`);
  setAction(row, "select-model-level", { modelLevelIndex });
  setContext(row, "model-level", { modelLevelIndex });
  setDropTarget(row, { kind: "modelLevel", floorNumber: ml.floorNumber });
  return row;
}

function buildUnassignedRow(expanded, callbacks) {
  const row = document.createElement("li");
  row.className = "level-item ml-row unassigned-row";
  appendChevron(row, expanded, "toggle-unassigned");
  appendText(row, "span", "level-name-text", translate(callbacks, "gdb.unassigned.groupName"));
  setAction(row, "toggle-unassigned");
  setDropTarget(row, { kind: "unassigned" });
  return row;
}

function buildBuildingsSection({ visibleBuildings, selection, callbacks }) {
  if (selection.selectedBuildingIndex >= 0) {
    visibleBuildings = visibleBuildings.filter(({ i }) => i === selection.selectedBuildingIndex);
  }
  const section = document.createElement("li");
  section.className = "panel-section buildings-section" + (selection.buildingsSectionExpanded ? "" : " collapsed");

  const header = document.createElement("div");
  header.className = "panel-section-header collapsible";
  const chevron = document.createElement("span");
  chevron.className = "panel-section-chevron";
  chevron.innerHTML = SECTION_CHEVRON_SVG;
  header.appendChild(chevron);
  appendText(header, "span", "", translate(callbacks, "panel.buildings"));
  appendText(header, "span", "panel-section-count", String(visibleBuildings.length));
  setAction(header, "toggle-buildings-section");
  section.appendChild(header);

  if (!selection.buildingsSectionExpanded) return section;

  const list = document.createElement("ul");
  list.className = "bldg-list";

  for (const { b, i: buildingIndex } of visibleBuildings) {
    list.appendChild(buildBuildingRow(b, buildingIndex, selection, callbacks));
    if (b.levels?.length && b._expanded !== false) {
      const levelList = document.createElement("ul");
      levelList.className = "level-tree-children";
      for (let levelIndex = b.levels.length - 1; levelIndex >= 0; levelIndex--) {
        const level = b.levels[levelIndex];
        levelList.appendChild(buildBuildingLevelRow(b, buildingIndex, level, levelIndex, selection, callbacks));
        const layers = b.shapefileLayers.filter((layer) => (layer.levelKey ?? "") === (level.key ?? ""));
        if (layers.length > 0) {
          levelList.appendChild(buildLayerChildren(
            layers.map((layer) => ({ building: b, buildingIndex, layer })),
            { flat: false, callbacks, selectedLayers: selection.selectedLayers },
          ));
        }
      }
      list.appendChild(levelList);
    }
  }

  section.appendChild(list);
  return section;
}

function buildBuildingRow(building, buildingIndex, selection, callbacks) {
  const row = document.createElement("li");
  row.className = "bldg-row" + (buildingIndex === selection.selectedBuildingIndex ? " selected" : "");
  const hasLevelChildren = (building.levels?.length ?? 0) > 0;
  const expanded = hasLevelChildren && building._expanded !== false;
  appendChevron(row, hasLevelChildren ? expanded : null, "toggle-building", { buildingIndex });
  appendText(row, "span", "bldg-name", building.name);

  if (building.linkFilter) {
    const chip = appendText(
      row,
      "span",
      "building-link-chip",
      building.linkFilter.value === "" ? translate(callbacks, "building.chip.host") : translate(callbacks, "building.chip.link"),
    );
    chip.title = `${building.linkFilter.property}: ${building.linkFilter.value || "(host)"}`;
  }

  const zoomBtn = document.createElement("button");
  zoomBtn.className = "level-tree-zoom-btn";
  zoomBtn.title = translate(callbacks, "building.zoomTitle");
  zoomBtn.innerHTML = ZOOM_SVG;
  setAction(zoomBtn, "zoom-building", { buildingIndex });
  row.appendChild(zoomBtn);

  if (callbacks.isolateBuilding) {
    const isolated = buildingIndex === selection.isolatedBuildingIndex;
    const isolateBtn = document.createElement("button");
    isolateBtn.className = "level-tree-zoom-btn" + (isolated ? " active" : "");
    isolateBtn.title = translate(callbacks, isolated ? "building.unisolateTitle" : "building.isolateTitle");
    isolateBtn.innerHTML = ISOLATE_SVG;
    setAction(isolateBtn, "isolate-building", { buildingIndex });
    row.appendChild(isolateBtn);
  }

  if (callbacks.removeBuilding) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "level-remove-btn";
    removeBtn.textContent = translate(callbacks, "generic.removeX");
    removeBtn.title = translate(callbacks, "building.removeTitle");
    setAction(removeBtn, "remove-building", { buildingIndex });
    row.appendChild(removeBtn);
  }

  setAction(row, "select-building", { buildingIndex });
  if (callbacks.showBuildingContextMenu) setContext(row, "building", { buildingIndex });
  if (callbacks.dropLayer || callbacks.dropFilesOnTarget) {
    setDropTarget(row, { bi: buildingIndex, levelKey: null });
  }

  if (building._tilesetMissing) {
    row.appendChild(buildReloadBanner(building, buildingIndex, callbacks));
  }

  return row;
}

function buildReloadBanner(building, buildingIndex, callbacks) {
  const banner = document.createElement("div");
  banner.className = "scene-reload-banner";
  const message = document.createElement("p");
  message.className = "reload-tileset-msg";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn full-width";
  if (building.directoryHandleId) {
    message.textContent = translate(callbacks, "right.grant.message", { folder: building._directoryFolderName || "unknown" });
    button.textContent = translate(callbacks, "right.grant.button");
  } else {
    message.textContent = translate(callbacks, "right.reload.message");
    button.textContent = translate(callbacks, "right.reload.button");
  }
  setAction(button, "reload-building", { buildingIndex });
  banner.appendChild(message);
  banner.appendChild(button);
  return banner;
}

function buildBuildingLevelRow(building, buildingIndex, level, levelIndex, selection, callbacks) {
  const row = document.createElement("li");
  row.className = "level-item bldg-level-row" +
    (buildingIndex === selection.selectedBuildingIndex && building.activeLevelIndex === levelIndex ? " selected" : "");
  appendChevron(row, null);
  appendText(row, "span", "level-name-text", level.name);
  appendText(row, "span", "level-ceiling", `${Number(level.floor ?? 0).toFixed(1)} m`);
  setAction(row, "select-level", { buildingIndex, levelIndex });
  if (callbacks.showLevelContextMenu) {
    setContext(row, "building-level", { buildingIndex, levelIndex });
  }
  if (callbacks.dropLayer || callbacks.dropFilesOnTarget) {
    setDropTarget(row, { bi: buildingIndex, levelKey: level.key ?? "" });
  }
  return row;
}

function buildLayerChildren(entries, { flat, callbacks, selectedLayers }) {
  const list = document.createElement("ul");
  list.className = "shp-children";
  for (const entry of entries) {
    list.appendChild(buildLayerRow(entry, { flat, callbacks, selectedLayers }));
  }
  return list;
}

function buildLayerRow({ building, buildingIndex, layer }, { flat, callbacks, selectedLayers }) {
  const row = document.createElement("li");
  row.className = "shp-tree-item";
  if (selectedLayers?.has(layer)) row.classList.add("selected");

  if (flat) {
    const eyeBtn = document.createElement("button");
    eyeBtn.className = "shp-visibility-btn" + (layer._hidden ? " hidden" : "");
    eyeBtn.title = translate(callbacks, layer._hidden ? "shp.show" : "shp.hide");
    eyeBtn.innerHTML = layer._hidden ? EYE_HIDDEN_SVG : EYE_VISIBLE_SVG;
    setAction(eyeBtn, "toggle-layer-visibility", { buildingIndex, layer });
    row.appendChild(eyeBtn);
  }

  const swatch = document.createElement("span");
  swatch.className = "color-swatch";
  swatch.style.background = layer.color;
  row.appendChild(swatch);
  appendText(row, "span", "shp-tree-name", layer.name);

  if (callbacks.openLayerFloorPicker) {
    row.appendChild(buildLayerFloorChip(layer, building, buildingIndex, callbacks));
  }

  if (callbacks.removeLayer) {
    const removeBtn = document.createElement("button");
    removeBtn.className = "shp-tree-remove-btn";
    removeBtn.textContent = translate(callbacks, "generic.removeX");
    removeBtn.title = translate(callbacks, "shp.removeTitle");
    setAction(removeBtn, "remove-layer", { buildingIndex, layer });
    row.appendChild(removeBtn);
  }

  const fromBi = building ? buildingIndex : "unassigned";
  row.__layerRef = layer;
  setAction(row, "select-layer", { buildingIndex, layer });
  if (callbacks.showLayerContextMenu) setContext(row, "layer", { buildingIndex, layer });
  if (callbacks.startLayerDrag) setDragLayer(row, layer, fromBi);
  return row;
}

function buildLayerFloorChip(layer, building, buildingIndex, callbacks) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "layer-floor-chip";
  let label;
  if (!building) {
    label = translate(callbacks, "chip.unassigned");
    chip.classList.add("unassigned");
    chip.title = translate(callbacks, "chip.titleUnassigned");
  } else if (layer.levelKey == null) {
    label = translate(callbacks, "chip.allFloors");
    chip.title = translate(callbacks, "chip.title");
  } else {
    const lvl = building.levels?.find((l) => (l.key ?? "") === layer.levelKey);
    label = lvl?.name ?? translate(callbacks, "chip.allFloors");
    chip.title = translate(callbacks, "chip.title");
  }
  chip.textContent = label;
  setAction(chip, "open-floor-picker", { buildingIndex, layer });
  return chip;
}

function appendChevron(row, expanded, action, context = {}) {
  const chevron = document.createElement("span");
  chevron.className = "level-tree-chevron" + (expanded ? " expanded" : "");
  if (expanded === null) {
    chevron.style.visibility = "hidden";
  } else {
    chevron.innerHTML = CHEVRON_SVG;
    if (action) setAction(chevron, action, context);
  }
  row.appendChild(chevron);
  return chevron;
}

function appendText(parent, tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text ?? "";
  el.title = text ?? "";
  parent.appendChild(el);
  return el;
}

function setAction(el, action, context = {}) {
  el.dataset.sceneAction = action;
  el.__sceneTreeContext = context;
}

function setContext(el, type, context = {}) {
  el.dataset.sceneContext = type;
  el.__sceneTreeContext = context;
}

function setDropTarget(el, target) {
  el.dataset.dropTarget = "1";
  el.__dropTarget = target;
}

function setDragLayer(el, layer, fromBi) {
  el.draggable = true;
  el.dataset.dragLayer = "1";
  el.__sceneTreeContext = { ...(el.__sceneTreeContext ?? {}), layer, fromBi };
}

function closestWithin(target, container, selector) {
  const el = target?.closest?.(selector);
  return el && container.contains(el) ? el : null;
}

function getCallbacks(container) {
  return container.__sceneTreeCallbacks ?? {};
}

function translate(callbacks, key, params) {
  return callbacks.t ? callbacks.t(key, params) : key;
}
