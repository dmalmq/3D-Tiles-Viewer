// PLATEAU manual feature overrides — per-feature hide / "ghost" toggles
// applied as a Cesium3DTileStyle on top of the catalog's normal style.
//
// This module owns the *logic* of override storage, feature identification,
// and style application. The DOM-bound floating card and the wiring to
// main.js state (importedLayers, selectedPlateauFeature, etc.) stay in
// main.js for now.

import { Cesium3DTileStyle, Color } from "cesium";

export const PLATEAU_GHOST_COLOR = Color.fromCssColorString("rgba(255, 255, 255, 0.18)");
export const CONTEXT_GHOST_COLOR = Color.fromCssColorString("rgba(255, 255, 255, 0.18)");

export const PLATEAU_ID_PROPERTIES = [
  "buildingIDAttribute_uro:buildingID",
  "uro:buildingID",
  "gml_id",
  "id",
  "featureId",
  "featureID",
  "fid",
];

export const PLATEAU_LABEL_PROPERTIES = [
  ...PLATEAU_ID_PROPERTIES,
  "name",
  "type",
  "class",
  "function",
  "measuredHeight",
  "_lod",
];

const VALID_OVERRIDE_MODES = new Set(["ghost", "hidden"]);

export function isPlateauLayer(layer) {
  return (
    layer?.type === "tileset" &&
    ["plateau-buildings", "plateau-3dtiles"].includes(layer.sourceConfig?.kind)
  );
}

export function listPlateauLayers(layers) {
  return (layers ?? []).filter(isPlateauLayer);
}

// Walks the various places Cesium stows a tileset reference depending on how
// a feature was picked.
export function getFeatureTileset(feature) {
  if (!feature) return null;
  if (feature.tileset) return feature.tileset;
  if (feature.content?.tileset) return feature.content.tileset;
  if (feature.primitive?.content?.tileset) return feature.primitive.content.tileset;
  if (feature.primitive?._content?.tileset) return feature.primitive._content.tileset;
  return feature.primitive?.root ? feature.primitive : null;
}

export function findPlateauLayerForFeature(layers, feature) {
  const tileset = getFeatureTileset(feature);
  if (!tileset) return null;
  return listPlateauLayers(layers).find((layer) => layer.data === tileset) ?? null;
}

export function getFeatureProperty(feature, propertyName) {
  if (!feature || typeof feature.getProperty !== "function") return null;
  try {
    const value = feature.getProperty(propertyName);
    if (value != null && value !== "") return String(value);
  } catch {
    // Cesium feature property access can throw on malformed metadata — treat as missing.
    return null;
  }
  return null;
}

export function getPlateauFeatureKey(feature) {
  for (const propertyName of PLATEAU_ID_PROPERTIES) {
    const value = getFeatureProperty(feature, propertyName);
    if (value) return `${propertyName}:${value}`;
  }

  const contentUrl =
    feature?.content?.url ||
    feature?.primitive?.content?.url ||
    feature?.primitive?._content?.url ||
    "";
  const featureId = feature?.featureId ?? feature?._batchId;
  if (contentUrl || featureId != null) {
    return `feature:${contentUrl}:${featureId ?? "unknown"}`;
  }

  return null;
}

export function getPlateauFeatureLabel(feature, featureKey) {
  for (const propertyName of PLATEAU_LABEL_PROPERTIES) {
    const value = getFeatureProperty(feature, propertyName);
    if (value) return value;
  }
  return featureKey;
}

export function getPlateauOverride(layer, feature) {
  const featureKey = getPlateauFeatureKey(feature);
  return featureKey ? layer.plateauOverrides?.get(featureKey) : null;
}

export function getPlateauOverrideMode(layer, featureKey) {
  if (!featureKey) return null;
  initializePlateauLayer(layer);
  return layer?.plateauOverrides?.get(featureKey)?.mode ?? null;
}

export function createPlateauFeatureSelection(layer, feature) {
  if (!isPlateauLayer(layer)) return null;
  initializePlateauLayer(layer);
  const featureKey = getPlateauFeatureKey(feature);
  if (!featureKey) return null;
  return {
    layerId: layer.id,
    layer,
    featureKey,
    label: getPlateauFeatureLabel(feature, featureKey),
  };
}

// Convert the on-disk array form into the in-memory Map used at runtime.
export function deserializePlateauOverrides(saved = []) {
  const map = new Map();
  if (!Array.isArray(saved)) return map;
  for (const entry of saved) {
    if (!entry?.featureKey || !VALID_OVERRIDE_MODES.has(entry.mode)) continue;
    map.set(entry.featureKey, {
      mode: entry.mode,
      label: entry.label || entry.featureKey,
    });
  }
  return map;
}

export function restoreSerializedPlateauOverrides(layer, saved = []) {
  if (!isPlateauLayer(layer)) return;
  layer.plateauOverrides = deserializePlateauOverrides(saved);
  initializePlateauLayer(layer);
}

// Convert the in-memory Map back to the disk array form.
export function serializePlateauOverrides(layer) {
  initializePlateauLayer(layer);
  return [...(layer.plateauOverrides ?? new Map()).entries()].map(([featureKey, entry]) => ({
    featureKey,
    mode: entry.mode,
    label: entry.label || featureKey,
  }));
}

export function setPlateauFeatureOverride(layer, featureKey, mode, label) {
  if (!isPlateauLayer(layer) || !featureKey) return false;
  initializePlateauLayer(layer);
  if (mode == null) {
    layer.plateauOverrides.delete(featureKey);
    return true;
  }
  if (!VALID_OVERRIDE_MODES.has(mode)) return false;
  layer.plateauOverrides.set(featureKey, {
    mode,
    label: label || featureKey,
  });
  return true;
}

export function removePlateauFeatureOverride(layer, featureKey) {
  if (!isPlateauLayer(layer) || !featureKey) return false;
  initializePlateauLayer(layer);
  return layer.plateauOverrides.delete(featureKey);
}

export function clearPlateauFeatureOverrides(layers) {
  for (const layer of listPlateauLayers(layers)) {
    initializePlateauLayer(layer);
    layer.plateauOverrides.clear();
  }
}

export function countPlateauOverrides(layers) {
  let count = 0;
  for (const layer of listPlateauLayers(layers)) {
    initializePlateauLayer(layer);
    count += layer.plateauOverrides.size;
  }
  return count;
}

export function listPlateauOverrideEntries(layers) {
  const entries = [];
  for (const layer of listPlateauLayers(layers)) {
    initializePlateauLayer(layer);
    for (const [featureKey, entry] of layer.plateauOverrides) {
      entries.push({ layer, featureKey, entry });
    }
  }
  return entries;
}

// Ensure a PLATEAU layer has the bookkeeping fields the override system
// expects: a Map for current overrides and a captured original Cesium3DTileStyle
// so we can restore it when the override style is removed.
export function initializePlateauLayer(layer) {
  if (!isPlateauLayer(layer) || !layer.data) return;
  if (!(layer.plateauOverrides instanceof Map)) {
    layer.plateauOverrides = deserializePlateauOverrides(layer.plateauOverrides);
  }
  if (!layer._plateauOriginalStyleCaptured) {
    layer._plateauOriginalStyle = layer.data.style;
    layer._plateauOriginalStyleCaptured = true;
  }
}

// Apply (or remove) the override style on a PLATEAU layer.
//   overridesEnabled — global toggle from the UI; false means user wants the
//     normal PLATEAU appearance.
//   contextGhosted — true when an active model level is hiding non-active
//     buildings, in which case PLATEAU should ghost too.
export function applyPlateauLayerStyle(layer, { overridesEnabled, contextGhosted }) {
  if (!isPlateauLayer(layer) || !layer.data) return;
  initializePlateauLayer(layer);

  const hasOverrides = layer.plateauOverrides.size > 0;
  if (!contextGhosted && (!overridesEnabled || !hasOverrides)) {
    layer.data.style = layer._plateauOriginalStyle;
    layer.data.makeStyleDirty();
    layer._plateauOverrideStyleApplied = false;
    return;
  }

  const style = new Cesium3DTileStyle();
  style.show = {
    evaluate: (feature) => {
      const mode = overridesEnabled ? getPlateauOverride(layer, feature)?.mode : null;
      return mode !== "hidden";
    },
  };
  style.color = {
    evaluateColor: (feature, result) => {
      const mode = overridesEnabled ? getPlateauOverride(layer, feature)?.mode : null;
      if (mode === "ghost" || contextGhosted) return Color.clone(PLATEAU_GHOST_COLOR, result);
      return Color.clone(Color.WHITE, result);
    },
  };
  layer.data.style = style;
  layer.data.makeStyleDirty();
  layer._plateauOverrideStyleApplied = true;
}

// Drill-pick that skips any features the user has marked ghosted, so clicks
// "pass through" them to whatever is behind.
//   drillPick — a function that takes a screen position and returns the
//     picked feature list (typically viewer.scene.drillPick.bind(viewer.scene)).
//   layerForFeature — resolves a picked feature to its parent layer (or null).
export function pickThroughGhosts(position, { drillPick, layerForFeature }) {
  const list = drillPick(position) ?? [];
  for (const p of list) {
    const layer = layerForFeature(p);
    if (layer && getPlateauOverride(layer, p)?.mode === "ghost") continue;
    return p;
  }
  return list[0];
}
