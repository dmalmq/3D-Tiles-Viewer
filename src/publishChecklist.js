/**
 * Pre-publish checklist shown in the Publish dialog. Pure: it only reads the
 * session state and returns items with an i18n key per status, so the dialog
 * can render it and the tests can exercise it without a DOM.
 *
 * status: "ok" | "warn" | "block". A "block" item stops publishing (the
 * publish/export code would refuse anyway); "warn" items are allowed through.
 */

const MAX_NAMES = 3;

function nameList(items) {
  const names = items.map((b) => b.name || "?");
  if (names.length <= MAX_NAMES) return names.join(", ");
  return `${names.slice(0, MAX_NAMES).join(", ")} +${names.length - MAX_NAMES}`;
}

export function computePublishChecklist({ buildings = [], venues = [], unassignedLayers = [] } = {}) {
  const venueIds = new Set(venues.map((v) => v.id));
  const publishableVenues = venues.filter((v) => buildings.some((b) => b.venueId === v.id));
  const inVenue = buildings.filter((b) => venueIds.has(b.venueId));
  const outside = buildings.filter((b) => !venueIds.has(b.venueId));
  // Until buildings are in a venue, check all of them so the list never
  // reports "ok" just because there was nothing to look at.
  const checked = inVenue.length > 0 ? inVenue : buildings;
  // A restored session can list a building whose tileset folder still has to
  // be re-picked (_tilesetMissing); that model is not loaded either.
  const withoutModel = checked.filter((b) => !b.tileset || b._tilesetMissing);
  const withoutLevels = checked.filter((b) => (b.levels?.length ?? 0) === 0);

  const items = [
    publishableVenues.length > 0
      ? { id: "venues", status: "ok", key: "publish.check.venues.ok", params: { count: publishableVenues.length } }
      : { id: "venues", status: "block", key: "publish.check.venues.block", action: "venues" },
    outside.length === 0
      ? { id: "outside", status: "ok", key: "publish.check.outside.ok" }
      : { id: "outside", status: "warn", key: "publish.check.outside.warn", params: { count: outside.length }, action: "venues" },
    withoutModel.length === 0
      ? { id: "models", status: "ok", key: "publish.check.models.ok" }
      : { id: "models", status: "warn", key: "publish.check.models.warn", params: { names: nameList(withoutModel) } },
    withoutLevels.length === 0
      ? { id: "levels", status: "ok", key: "publish.check.levels.ok" }
      : { id: "levels", status: "warn", key: "publish.check.levels.warn", params: { names: nameList(withoutLevels) }, action: "scene" },
    unassignedLayers.length === 0
      ? { id: "layers", status: "ok", key: "publish.check.layers.ok" }
      : { id: "layers", status: "warn", key: "publish.check.layers.warn", params: { count: unassignedLayers.length }, action: "scene" },
  ];

  return {
    items,
    canPublish: !items.some((item) => item.status === "block"),
    hasWarnings: items.some((item) => item.status === "warn"),
  };
}
