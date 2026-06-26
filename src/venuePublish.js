import {
  serializeSession,
  filterSessionByVenue,
  buildVenueManifest,
} from "./session.js";
import {
  collectTilesetBundles,
  rewriteSessionTilesetUrls,
  buildTilesetUrlMap,
} from "./tilesetBundle.js";

export function buildPublishPlan(state) {
  const {
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
  } = state;

  const exportableVenues = (venues ?? []).filter((v) =>
    (buildings ?? []).some((b) => b.venueId === v.id),
  );

  if (exportableVenues.length === 0) {
    return { ok: false, reason: "noVenuesWithBuildings" };
  }

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

  const manifest = buildVenueManifest(exportableVenues, {
    baseUrl: "/sessions/",
    defaultVenueId: exportableVenues[0]?.id ?? null,
  });

  const venueBuildings = buildings.filter((b) =>
    exportableVenues.some((v) => v.id === b.venueId),
  );

  return {
    ok: true,
    exportableVenues,
    fullSession,
    manifest,
    venueBuildings,
  };
}

export async function buildPublishFormData(state) {
  const plan = buildPublishPlan(state);
  if (!plan.ok) return plan;

  const { bundles, warnings } = await collectTilesetBundles(plan.venueBuildings);
  const urlByName = buildTilesetUrlMap(plan.venueBuildings, bundles, {});

  const sessions = [];
  for (const venue of plan.exportableVenues) {
    let slice = filterSessionByVenue(plan.fullSession, venue.id);
    slice = rewriteSessionTilesetUrls(slice, urlByName);
    sessions.push({ id: venue.id, data: slice });
  }

  const tilesetCheck = validatePublishedSessions(sessions);
  if (!tilesetCheck.ok) return tilesetCheck;

  const mirror = [];
  const fileUploads = [];

  for (const bundle of bundles) {
    if (bundle.skipUpload) continue;
    if (bundle.mirrorUrl) {
      mirror.push({ key: bundle.key, sourceUrl: bundle.mirrorUrl });
      continue;
    }
    if (bundle.files?.length) {
      for (const file of bundle.files) {
        const rel = file.relativePath || file.webkitRelativePath || file.name;
        fileUploads.push({ bundleKey: bundle.key, file, rel });
      }
    }
  }

  const metadataJson = JSON.stringify({
    manifest: plan.manifest,
    sessions,
    mirror,
    viewerOrigin:
      typeof globalThis.location !== "undefined" ? globalThis.location.origin : null,
  });

  const formData = new FormData();
  appendPublishMetadata(formData, metadataJson);

  for (const { bundleKey, file, rel } of fileUploads) {
    formData.append("files", file, `${bundleKey}/${rel}`);
  }

  return {
    ok: true,
    formData,
    warnings,
    venueCount: plan.exportableVenues.length,
    exportableVenues: plan.exportableVenues,
  };
}

export function buildingNeedsPublishedTileset(building) {
  return (building?.shapefileLayers?.length ?? 0) > 0 || (building?.levels?.length ?? 0) > 0;
}

export function validatePublishedSessions(sessions) {
  const missing = [];
  for (const session of sessions ?? []) {
    for (const b of session.data?.buildings ?? []) {
      if (buildingNeedsPublishedTileset(b) && !b.sourceUrl) {
        missing.push(b.name ?? "Unnamed");
      }
    }
  }
  if (!missing.length) return { ok: true };
  return { ok: false, reason: "tilesetNotBundled", buildings: missing };
}

/** Metadata must be uploaded as a file — text fields are capped at ~1 MB by multer. */
export function createPublishMetadataFile(metadataJson) {
  const type = "application/json";
  if (typeof File !== "undefined") {
    return new File([metadataJson], "metadata.json", { type });
  }
  return new Blob([metadataJson], { type });
}

export function appendPublishMetadata(formData, metadataJson) {
  const entry = createPublishMetadataFile(metadataJson);
  formData.append("metadata", entry, "metadata.json");
}

/** Parse a fetch response body once (streams are single-read). */
export function parsePublishResponse(raw, status) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const snippet = raw.trim().slice(0, 200);
    if (snippet.startsWith("<")) {
      const plain = snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const multer = plain.match(/MulterError:\s*(.+?)(?:\s+at\s|$)/i);
      if (multer) {
        return {
          error: multer[1].replace(/&nbsp;/gi, " ").trim(),
        };
      }
      return {
        error: `Server returned HTML (HTTP ${status}). Start the server with "npm run dev" or "npm run start".`,
      };
    }
    return { error: snippet || `HTTP ${status}` };
  }
}

export async function publishToServer(state, { apiUrl = "/api/publish", token = "" } = {}) {
  const built = await buildPublishFormData(state);
  if (!built.ok) return built;

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: built.formData,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "publishFailed",
      error: `Cannot reach publish API (${err.message}). Use "npm run dev" or "npm run start".`,
    };
  }

  const body = parsePublishResponse(await res.text(), res.status);

  if (!res.ok) {
    return { ok: false, reason: "publishFailed", error: body.error || `HTTP ${res.status}` };
  }

  return {
    ok: true,
    links: body.links,
    warnings: built.warnings,
    venueCount: built.venueCount,
  };
}