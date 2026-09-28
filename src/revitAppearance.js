// Presentation controls for Revit-exported tilesets:
//  - per-element and per-category "transparent" / "hidden" overrides, kept on
//    each building as `building.appearance` and applied per feature alongside
//    the link + level filter;
//  - a highlight shader (tint + rim glow) that makes Revit models stand out
//    against PLATEAU context.
//
// Pure helpers only; the DOM card and main.js/viewer.js state wiring live in
// those files.

import {
  Cartesian3,
  Color,
  CustomShader,
  CustomShaderTranslucencyMode,
  UniformType,
} from "cesium";

export const REVIT_OVERRIDE_MODES = new Set(["ghost", "hidden"]);

export const DEFAULT_REVIT_SETTINGS = Object.freeze({
  transparencyPercent: 70,
  highlightPercent: 0,
  highlightColor: "#ff9f1c",
  // "color": glow in highlightColor; "material": glow in each element's own
  // Revit material colour.
  highlightMode: "color",
});

const HIGHLIGHT_MODES = new Set(["color", "material"]);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeRevitSettings(value) {
  const clampPercent = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
  };
  return {
    transparencyPercent: clampPercent(value?.transparencyPercent, DEFAULT_REVIT_SETTINGS.transparencyPercent),
    highlightPercent: clampPercent(value?.highlightPercent, DEFAULT_REVIT_SETTINGS.highlightPercent),
    highlightColor: HEX_COLOR_RE.test(value?.highlightColor ?? "")
      ? value.highlightColor.toLowerCase()
      : DEFAULT_REVIT_SETTINGS.highlightColor,
    highlightMode: HIGHLIGHT_MODES.has(value?.highlightMode) ? value.highlightMode : DEFAULT_REVIT_SETTINGS.highlightMode,
  };
}

// -- Overrides --------------------------------------------------------------

/** `{ features: { [key]: { mode, label } }, categories: { [name]: mode } }` */
export function normalizeRevitAppearance(value) {
  const features = {};
  const categories = {};
  for (const [key, entry] of Object.entries(value?.features ?? {})) {
    if (key && REVIT_OVERRIDE_MODES.has(entry?.mode)) {
      features[key] = { mode: entry.mode, label: String(entry.label || key) };
    }
  }
  for (const [name, mode] of Object.entries(value?.categories ?? {})) {
    if (name && REVIT_OVERRIDE_MODES.has(mode)) categories[name] = mode;
  }
  return { features, categories };
}

export function hasRevitOverrides(appearance) {
  return Object.keys(appearance?.features ?? {}).length > 0
    || Object.keys(appearance?.categories ?? {}).length > 0;
}

function readProperty(feature, name) {
  try {
    const value = feature?.getProperty?.(name);
    return value == null || value === "" ? null : String(value);
  } catch {
    return null;
  }
}

/** Stable across re-exports: prefer the Revit UniqueId, then the ElementId. */
export function getRevitFeatureKey(feature) {
  const uniqueId = readProperty(feature, "revitUniqueId");
  if (uniqueId) return `uid:${uniqueId}`;
  const elementId = readProperty(feature, "revitElementId");
  if (elementId) return `eid:${elementId}`;
  return null;
}

export function getRevitFeatureCategory(feature) {
  return readProperty(feature, "category");
}

export function getRevitFeatureLabel(feature) {
  const name = readProperty(feature, "name");
  const category = readProperty(feature, "category");
  if (name && category) return `${category} · ${name}`;
  return name ?? category ?? readProperty(feature, "revitElementId") ?? "Element";
}

/** An element override wins over its category's override. */
export function resolveRevitFeatureMode(appearance, feature) {
  if (!appearance) return null;
  const key = getRevitFeatureKey(feature);
  const own = key ? appearance.features?.[key]?.mode : null;
  if (own) return own;
  const category = getRevitFeatureCategory(feature);
  return category ? appearance.categories?.[category] ?? null : null;
}

export function setRevitFeatureOverride(appearance, key, mode, label) {
  if (!appearance || !key) return false;
  if (mode == null) {
    delete appearance.features[key];
    return true;
  }
  if (!REVIT_OVERRIDE_MODES.has(mode)) return false;
  appearance.features[key] = { mode, label: label || key };
  return true;
}

export function setRevitCategoryOverride(appearance, category, mode) {
  if (!appearance || !category) return false;
  if (mode == null) {
    delete appearance.categories[category];
    return true;
  }
  if (!REVIT_OVERRIDE_MODES.has(mode)) return false;
  appearance.categories[category] = mode;
  return true;
}

export function revitGhostAlpha(settings) {
  return 1 - normalizeRevitSettings(settings).transparencyPercent / 100;
}

const scratchColor = new Color();

/**
 * Apply an override to one feature whose filter visibility is already known.
 * Always writes the colour so clearing an override restores the model.
 */
export function applyRevitFeatureAppearance(feature, visible, mode, ghostAlpha) {
  feature.show = visible && mode !== "hidden";
  if (!feature.show) return;
  const alpha = mode === "ghost" ? ghostAlpha : 1;
  if (feature.color?.alpha !== alpha || feature.color?.red !== 1 || feature.color?.green !== 1 || feature.color?.blue !== 1) {
    feature.color = Color.WHITE.withAlpha(alpha, scratchColor);
  }
}

/**
 * Which sibling building owns a feature, mirroring the link filter: a
 * feature belongs to the sibling whose linkFilter value matches its link
 * property, else the first sibling.
 */
export function findOwningBuilding(siblings, feature) {
  if (!siblings?.length) return null;
  const linkProperty = siblings[0]?.linkFilter?.property ?? null;
  if (!linkProperty) return siblings[0];
  const value = readProperty(feature, linkProperty) ?? "";
  return siblings.find((b) => b.linkFilter?.value === value) ?? null;
}

// -- Highlight --------------------------------------------------------------

// Tint towards the glow colour and add a Fresnel rim that glows along
// silhouettes and grazing faces. Strength 0 leaves the model untouched.
//
// In material mode the glow colour is the element's own Revit material
// colour with its saturation boosted: Revit materials are mostly pastels
// (a "green" wall is often ~#DEF5D9), which would otherwise glow near-white.
// Greys have no hue to boost; they glow neutral and more softly.
const HIGHLIGHT_FRAGMENT_SHADER = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float strength = u_revitHighlightStrength;
  if (strength <= 0.0) return;
  vec3 base = material.diffuse;
  float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 vivid = clamp(mix(vec3(luma), base, 3.0), 0.0, 1.0);
  vec3 glowColor = mix(u_revitHighlightColor, vivid, u_revitHighlightUseMaterial);
  // In material mode, colourless materials glow less so tinted ones stand out.
  float chroma = max(vivid.r, max(vivid.g, vivid.b)) - min(vivid.r, min(vivid.g, vivid.b));
  strength *= mix(1.0, mix(0.3, 1.0, smoothstep(0.05, 0.4, chroma)), u_revitHighlightUseMaterial);
  vec3 viewDir = normalize(-fsInput.attributes.positionEC);
  vec3 normal = normalize(fsInput.attributes.normalEC);
  float facing = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.2);
  material.diffuse = mix(base, glowColor, 0.45 * strength);
  material.emissive += glowColor * (0.12 + rim * 1.4) * strength;
}
`;

export function hexToCartesian3(hex) {
  const color = Color.fromCssColorString(HEX_COLOR_RE.test(hex ?? "") ? hex : DEFAULT_REVIT_SETTINGS.highlightColor);
  return new Cartesian3(color.red, color.green, color.blue);
}

export function createRevitHighlightShader(settings = DEFAULT_REVIT_SETTINGS) {
  const normalized = normalizeRevitSettings(settings);
  return new CustomShader({
    // Keep per-feature transparency (feature.color alpha) working.
    translucencyMode: CustomShaderTranslucencyMode.INHERIT,
    uniforms: {
      u_revitHighlightStrength: { type: UniformType.FLOAT, value: normalized.highlightPercent / 100 },
      u_revitHighlightColor: { type: UniformType.VEC3, value: hexToCartesian3(normalized.highlightColor) },
      u_revitHighlightUseMaterial: { type: UniformType.FLOAT, value: normalized.highlightMode === "material" ? 1 : 0 },
    },
    fragmentShaderText: HIGHLIGHT_FRAGMENT_SHADER,
  });
}

export function updateRevitHighlightShader(shader, settings) {
  if (!shader) return;
  const normalized = normalizeRevitSettings(settings);
  shader.setUniform("u_revitHighlightStrength", normalized.highlightPercent / 100);
  shader.setUniform("u_revitHighlightColor", hexToCartesian3(normalized.highlightColor));
  shader.setUniform("u_revitHighlightUseMaterial", normalized.highlightMode === "material" ? 1 : 0);
}
