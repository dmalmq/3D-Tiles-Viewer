export const VENUE_MANIFEST_VERSION = 1;

export function parseVenueManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Venue manifest is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Venue manifest did not contain a manifest object.");
  }
  if (data.version !== VENUE_MANIFEST_VERSION) {
    throw new Error(`Unsupported venue manifest version: ${data.version}`);
  }
  if (!Array.isArray(data.venues) || data.venues.length === 0) {
    throw new Error("Venue manifest must include at least one venue.");
  }
  for (const venue of data.venues) {
    if (!venue?.id || !venue?.name || !venue?.sessionUrl) {
      throw new Error("Each venue requires id, name, and sessionUrl.");
    }
  }
  if (data.defaultVenueId && !data.venues.some((v) => v.id === data.defaultVenueId)) {
    throw new Error(`defaultVenueId "${data.defaultVenueId}" was not found in venues.`);
  }
  return data;
}

export function resolveVenueSessionUrl(manifest, venueId) {
  const venue = manifest?.venues?.find((v) => v.id === venueId);
  return venue?.sessionUrl ?? null;
}

export function getDefaultVenueId(manifest) {
  if (manifest?.defaultVenueId) return manifest.defaultVenueId;
  return manifest?.venues?.[0]?.id ?? null;
}

export function resolveVenueIdFromParams(searchParams) {
  const raw = searchParams?.get?.("venue");
  return raw?.trim() || null;
}

export const DEFAULT_MANIFEST_URL =
  import.meta.env?.VITE_DEFAULT_MANIFEST || "/sessions/venues.json";