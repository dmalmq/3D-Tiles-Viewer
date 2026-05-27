import { uniquePlateauAreas } from "./plateauCatalog.js";

const VALID_SELECTION_MODES = new Set(["auto", "manual"]);

export function resolveAutoPlateauAreaSelection({
  selectionMode,
  currentAreas = [],
  currentSource = null,
  detected = [],
  fallbackSource = null,
}) {
  // Unknown / missing selection mode falls back to manual — preserves current
  // selection rather than silently mangling state on a typo.
  if (!VALID_SELECTION_MODES.has(selectionMode)) {
    if (selectionMode != null) {
      console.warn(`resolveAutoPlateauAreaSelection: unknown selectionMode "${selectionMode}", treating as "manual"`);
    }
    selectionMode = "manual";
  }

  if (selectionMode === "manual") {
    return {
      areas: currentAreas,
      source: currentSource,
    };
  }

  const areas = uniquePlateauAreas(detected.map(entry => entry?.area ?? entry));
  return {
    areas,
    source: areas.length > 0 ? (fallbackSource ?? detected[0]?.source ?? null) : null,
  };
}
