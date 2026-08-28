import { DEFAULT_MANIFEST_URL } from "./venueManifest.js";

function normalizeAppBase(base) {
  const raw = base == null || base === "" ? "/" : String(base);
  if (/^https?:\/\//i.test(raw) || raw.startsWith("./")) {
    return raw.endsWith("/") ? raw : `${raw}/`;
  }
  const withSlash = raw.endsWith("/") ? raw : `${raw}/`;
  return withSlash.startsWith("/") ? withSlash : `/${withSlash}`;
}

/**
 * Join a same-origin asset path with Vite's configured `base`.
 * Idempotent: paths already under the base are returned unchanged so SAMPLE_*
 * and query params can share one resolve site without double-prefixing.
 */
export function withAppBase(path, base = import.meta.env?.BASE_URL ?? "/") {
  const input = String(path ?? "");
  const normalizedBase = normalizeAppBase(base);
  if (!input) return normalizedBase;
  if (/^https?:\/\//i.test(input) || input.startsWith("blob:") || input.startsWith("data:")) {
    return input;
  }

  if (/^https?:\/\//i.test(normalizedBase)) {
    const baseUrl = new URL(normalizedBase);
    if (input.startsWith(normalizedBase) || input === normalizedBase.slice(0, -1)) return input;
    if (input.startsWith(baseUrl.pathname) && (baseUrl.pathname === "/" || input === baseUrl.pathname || input.startsWith(baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`))) {
      return new URL(input.replace(/^\//, ""), baseUrl.origin + "/").href;
    }
    return new URL(input.replace(/^\/+/, ""), normalizedBase).href;
  }

  if (normalizedBase.startsWith("./")) {
    if (input.startsWith(normalizedBase) || input === normalizedBase.slice(0, -1)) return input;
    return `${normalizedBase}${input.replace(/^\/+/, "").replace(/^\.\//, "")}`;
  }

  if (normalizedBase === "/") {
    if (input.startsWith("/")) return input;
    return `/${input.replace(/^\/+/, "")}`;
  }

  const baseNoSlash = normalizedBase.slice(0, -1);
  if (input === normalizedBase || input === baseNoSlash) return normalizedBase;
  if (input.startsWith(normalizedBase) || input.startsWith(`${baseNoSlash}/`)) return input;
  return `${normalizedBase}${input.replace(/^\/+/, "")}`;
}

/** Express mounts stay at domain root until that policy is decided separately. */
export function isExpressRootPath(url) {
  return /^\/(sessions|tilesets|packages|api)(\/|$)/.test(url);
}

/** Prefix a viewer query-param path once. Absolute URLs and Express roots are left alone. */
export function resolveViewerQueryAssetUrl(url, base = import.meta.env?.BASE_URL ?? "/") {
  if (!url || typeof url !== "string") return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (isExpressRootPath(url)) return url;
  return withAppBase(url, base);
}

/** Static same-origin sample — no Express publish server required. */
export const SAMPLE_TILESET_URL = withAppBase("tiles/sample-indoor/tileset.json");
export const SAMPLE_SESSION_URL = withAppBase("tiles/sample-indoor/session.json");
export const SAMPLE_BUILDING_NAME = "Sample House";

/**
 * Decide what the read-only viewer should load from the URL.
 * Query params always win so published `?venue=` / `?session=` / `?manifest=`
 * links keep working. With no params, the public synthetic sample is the default.
 */
export function resolveViewerDatasetFromParams(searchParams, base = import.meta.env?.BASE_URL ?? "/") {
  const params = searchParams ?? new URLSearchParams();
  const session = params.get?.("session")?.trim();
  if (session) return { kind: "session", url: resolveViewerQueryAssetUrl(session, base) };

  const manifest = params.get?.("manifest")?.trim();
  const venueId = params.get?.("venue")?.trim() || null;
  if (manifest) return { kind: "manifest", url: resolveViewerQueryAssetUrl(manifest, base), venueId };

  if (venueId) return { kind: "manifest", url: DEFAULT_MANIFEST_URL, venueId };

  const tileset = params.get?.("tileset")?.trim();
  if (tileset) return { kind: "tileset", url: resolveViewerQueryAssetUrl(tileset, base) };

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

/** Local folders cannot be reconstructed; shared URLs need query params. */
export function canRestoreDatasetFromSource(kind, searchParams) {
  if (kind === "sample") return true;
  if (kind === "shared") {
    return resolveViewerDatasetFromParams(searchParams).kind !== "sample";
  }
  return false;
}
