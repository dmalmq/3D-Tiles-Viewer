import { DEFAULT_MANIFEST_URL } from "./venueManifest.js";

/** Static same-origin sample — no Express publish server required. */
export const SAMPLE_TILESET_URL = "/tiles/sample-indoor/tileset.json";
export const SAMPLE_SESSION_URL = "/tiles/sample-indoor/session.json";
export const SAMPLE_BUILDING_NAME = "Sample House";
export const SAMPLE_VENUE_ID = "sample-indoor";

/**
 * Decide what the read-only viewer should load from the URL.
 * Query params always win so published `?venue=` / `?session=` / `?manifest=`
 * links keep working. With no params, the public synthetic sample is the default.
 */
export function resolveViewerDatasetFromParams(searchParams) {
  const params = searchParams ?? new URLSearchParams();
  const session = params.get?.("session")?.trim();
  if (session) return { kind: "session", url: session };

  const manifest = params.get?.("manifest")?.trim();
  const venueId = params.get?.("venue")?.trim() || null;
  if (manifest) return { kind: "manifest", url: manifest, venueId };

  if (venueId) return { kind: "manifest", url: DEFAULT_MANIFEST_URL, venueId };

  const tileset = params.get?.("tileset")?.trim();
  if (tileset) return { kind: "tileset", url: tileset };

  return { kind: "sample", url: SAMPLE_SESSION_URL };
}

/** Folder name for a webkitdirectory / File System Access file list. Never a URL. */
export function inferLocalTilesetName(files, fallback = "Local tileset") {
  const first = files?.[0];
  const rel = first?.webkitRelativePath || first?.relativePath || "";
  const folder = String(rel).split(/[/\\]/).find((part) => part && part !== ".");
  if (folder) return folder;
  if (first?.name && first.name !== "tileset.json") return first.name;
  return fallback;
}

/**
 * Local folder viewing must never hit the publish/import APIs.
 * Blob-URL tileset loads and same-origin GETs of the public sample are fine.
 */
export function isLocalDatasetUploadRequest(url, method = "GET") {
  if (!url) return false;
  let path = String(url);
  try {
    path = new URL(url, "http://local.test").pathname;
  } catch {
    /* keep path */
  }
  const verb = String(method || "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  return path.startsWith("/api/") || path.startsWith("/tilesets/") || path.startsWith("/packages/");
}

export function isDirectoryPickerAbort(error) {
  return error?.name === "AbortError";
}

/** Iframe / permission denials should use the webkitdirectory input. Cancel must not. */
export function shouldFallbackToDirectoryInput(error) {
  const name = error?.name;
  return name === "SecurityError" || name === "NotAllowedError";
}
