import {
  serializeSession,
  filterSessionByVenue,
  buildVenueManifest,
  downloadSessionJson,
} from "./session.js";

export function exportViewerPackage({
  venues,
  imagery,
  terrain,
  plateauOverridesEnabled,
  modelLevels,
  activeModelLevelIndex,
  buildings,
  importedLayers,
  unassignedLayers,
  isPlateauLayer,
  serializePlateauOverrides,
  baseUrl = "",
}) {
  const fullSession = serializeSession({
    imagery,
    terrain,
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

  const exportableVenues = (venues ?? []).filter((v) =>
    (buildings ?? []).some((b) => b.venueId === v.id),
  );

  if (exportableVenues.length === 0) {
    return { ok: false, reason: "noVenuesWithBuildings" };
  }

  const manifest = buildVenueManifest(exportableVenues, {
    baseUrl,
    defaultVenueId: exportableVenues[0]?.id ?? null,
  });

  downloadSessionJson(manifest, "venues.json");
  for (const venue of exportableVenues) {
    const slice = filterSessionByVenue(fullSession, venue.id);
    downloadSessionJson(slice, `${venue.id}.json`);
  }

  return { ok: true, venueCount: exportableVenues.length };
}