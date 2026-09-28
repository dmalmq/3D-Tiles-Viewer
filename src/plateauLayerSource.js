// Where a PLATEAU layer's tiles come from: the server's local cache, a
// grid-cut subset streamed from PLATEAU, or the whole remote tileset.

import { buildPlateauSubset } from "./plateauTilesetSubset.js";
import { normalizeMeshCodes } from "./plateauGrid.js";

const CACHE_API = "/api/plateau-cache";
const MB = 1024 * 1024;

// Cesium's defaults (512 MB cache) are smaller than a single textured
// PLATEAU ward, so tiles were evicted and re-fetched as the camera turned.
export const PLATEAU_TILESET_OPTIONS = {
  cacheBytes: 1536 * MB,
  maximumCacheOverflowBytes: 1024 * MB,
};

let cacheAvailablePromise = null;

/** True when the Node server with the PLATEAU cache API is reachable. */
export function isPlateauCacheAvailable() {
  if (!cacheAvailablePromise) {
    cacheAvailablePromise = fetch(CACHE_API, { headers: { Accept: "application/json" } })
      .then(res => res.ok && (res.headers.get("content-type") ?? "").includes("json"))
      .catch(() => false);
  }
  return cacheAvailablePromise;
}

/**
 * Ask the server to download a dataset (cut to `meshCodes` when given).
 * `onProgress({ done, total, bytes })` reports file progress.
 * Resolves to the cache entry: `{ url, fileCount, bytes, cached, ... }`.
 */
export async function downloadPlateauToCache({ sourceUrl, meshCodes = [], label = "" }, onProgress) {
  const res = await fetch(CACHE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl, meshCodes: normalizeMeshCodes(meshCodes), label }),
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // Keep the status text.
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "progress") onProgress?.(message);
      else if (message.type === "error") throw new Error(message.error);
      else if (message.type === "done") result = message;
    }
    if (done) break;
  }
  if (!result) throw new Error("Download ended without a result");
  return result;
}

/**
 * Build the grid-cut tileset in the browser and expose it as a blob URL.
 * Content URIs stay absolute, so tiles stream straight from PLATEAU.
 */
export async function createPlateauSubsetUrl({ url, meshCodes }) {
  const subset = await buildPlateauSubset({
    url,
    meshCodes,
    fetchJson: async (jsonUrl) => {
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${jsonUrl}`);
      return res.json();
    },
  });
  if (subset.contents.length === 0) return { url: null, tileCount: 0 };
  const blob = new Blob([JSON.stringify(subset.tileset)], { type: "application/json" });
  return { url: URL.createObjectURL(blob), tileCount: subset.contents.length };
}

/**
 * Load a saved PLATEAU layer. Prefers the local copy, and falls back to
 * PLATEAU itself when the copy is gone (e.g. the session moved machines).
 */
export async function loadSavedPlateauTileset(viewer, loadTilesetFromUrl, sourceConfig) {
  const load = url => loadTilesetFromUrl(viewer, url, { zoom: false, tilesetOptions: PLATEAU_TILESET_OPTIONS });
  const remoteUrl = sourceConfig.remoteUrl ?? sourceConfig.url;
  const meshCodes = normalizeMeshCodes(sourceConfig.meshCodes);

  if (sourceConfig.storage === "local" && sourceConfig.url) {
    try {
      return await load(sourceConfig.url);
    } catch (e) {
      console.warn("Local PLATEAU copy unavailable, streaming from PLATEAU instead:", e);
    }
  }

  if (meshCodes.length > 0) {
    const subset = await createPlateauSubsetUrl({ url: remoteUrl, meshCodes });
    if (!subset.url) throw new Error("No PLATEAU tiles in the saved grid cells");
    return load(subset.url);
  }
  return load(remoteUrl);
}

export function formatMegabytes(bytes) {
  return (bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1);
}
