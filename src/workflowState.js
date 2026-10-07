/**
 * Pure state helpers behind the editor header: which Load → Author → Venue →
 * Publish step is done, and what the venue/building breadcrumb says.
 */

export const WORKFLOW_STEPS = ["load", "author", "venue", "publish"];

/**
 * Which workflow steps are done, and which one the user is on.
 * Load is done once a building exists, Author once every building has floor
 * levels, Venue once every building belongs to a venue. Publish is never
 * "done" — it is the step you end on.
 */
export function computeWorkflowState({ buildings = [], venues = [] } = {}) {
  const venueIds = new Set(venues.map((v) => v.id));
  const done = {
    load: buildings.length > 0,
    author: buildings.length > 0 && buildings.every((b) => (b.levels?.length ?? 0) > 0),
    venue: buildings.length > 0 && venues.length > 0 && buildings.every((b) => venueIds.has(b.venueId)),
    publish: false,
  };
  const current = WORKFLOW_STEPS.find((step) => !done[step]) ?? "publish";
  return { done, current };
}

/** Breadcrumb labels: the filtered venue (or the selected building's), then the building. */
export function computeBreadcrumb({ buildings = [], venues = [], selectedBuildingIndex = -1, activeVenueFilter = null } = {}) {
  const building = buildings[selectedBuildingIndex] ?? null;
  const venueId = activeVenueFilter ?? building?.venueId ?? null;
  const venue = venues.find((v) => v.id === venueId) ?? null;
  return {
    venue: venue?.name || null,
    building: building?.name || null,
  };
}
