import {
  Cesium3DTileset,
  HeadingPitchRange,
  Math as CesiumMath,
} from "cesium";
import { t } from "./i18n.js";
import { getFilesFromDirectoryHandle } from "./fileSystemAccess.js";

/**
 * Load a Cesium3DTileset from a URL.
 * e.g. http://localhost:5173/tiles/my-model/tileset.json
 */
export async function loadTilesetFromUrl(viewer, url) {
  let tileset = null;
  try {
    tileset = await Cesium3DTileset.fromUrl(url);
    viewer.scene.primitives.add(tileset);
    await viewer.zoomTo(tileset);
    return tileset;
  } catch (e) {
    if (tileset) viewer.scene.primitives.remove(tileset);
    throw e;
  }
}

/**
 * Load 3D Tiles from a folder selected via the file picker (webkitdirectory).
 *
 * Reads tileset.json, rewrites all content URIs to blob URLs pointing at the
 * selected files, then loads the rewritten JSON. This avoids fetch/XHR
 * interception issues since Cesium gets direct blob URLs for every resource.
 */
export async function loadTilesetFromFiles(viewer, fileList, statusEl) {
  let tilesetJsonFile = null;
  let tilesetJsonPath = null;

  // Index files by path relative to the tileset.json directory
  const filesByName = new Map();
  for (const file of fileList) {
    const relPath = file.webkitRelativePath || file.relativePath || file.name;
    if (file.name === "tileset.json" && !tilesetJsonPath) {
      tilesetJsonFile = file;
      tilesetJsonPath = relPath;
    }
    filesByName.set(relPath, file);
  }

  if (!tilesetJsonFile) {
    throw new Error(t("tileset.noJson"));
  }

  if (statusEl) statusEl.textContent = t("tileset.foundN", { count: fileList.length });

  const baseDir = tilesetJsonPath.substring(
    0,
    tilesetJsonPath.lastIndexOf("/") + 1
  );

  const blobUrls = new Map();
  let tilesetBlobUrl = null;
  let tileset = null;

  try {
    // Build blob URL map keyed by path relative to tileset.json
    for (const [relPath, file] of filesByName) {
      const pathFromBase = relPath.startsWith(baseDir)
        ? relPath.substring(baseDir.length)
        : relPath;
      if (pathFromBase !== "tileset.json") {
        blobUrls.set(pathFromBase, URL.createObjectURL(file));
      }
    }

    // Parse tileset.json and rewrite all content URIs to blob URLs
    const jsonText = await tilesetJsonFile.text();
    const tilesetJson = JSON.parse(jsonText);
    rewriteContentUris(tilesetJson.root, blobUrls);

    // Create a blob URL from the rewritten JSON
    const rewrittenBlob = new Blob([JSON.stringify(tilesetJson)], {
      type: "application/json",
    });
    tilesetBlobUrl = URL.createObjectURL(rewrittenBlob);

    tileset = await Cesium3DTileset.fromUrl(tilesetBlobUrl);
    viewer.scene.primitives.add(tileset);
    if (statusEl) statusEl.textContent = t("tileset.loaded", { path: tilesetJsonPath });
    await viewer.zoomTo(tileset);

    tileset._blobCleanup = { blobUrls, tilesetBlobUrl };
    return tileset;
  } catch (e) {
    if (tileset) viewer.scene.primitives.remove(tileset);
    revokeBlobCleanup(blobUrls, tilesetBlobUrl);
    throw e;
  }
}

function revokeBlobCleanup(blobUrls, tilesetBlobUrl) {
  if (tilesetBlobUrl) URL.revokeObjectURL(tilesetBlobUrl);
  for (const url of blobUrls.values()) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Recursively walk the tileset tree and replace content uri/url strings
 * with their corresponding blob URLs.
 */
function rewriteContentUris(tile, blobUrls) {
  if (!tile) return;

  // Handle tile.content.uri or tile.content.url
  if (tile.content) {
    const key = tile.content.uri != null ? "uri" : "url";
    const originalPath = tile.content[key];
    if (originalPath && blobUrls.has(originalPath)) {
      tile.content[key] = blobUrls.get(originalPath);
    }
  }

  // Handle tile.contents (array form, used in some tilesets)
  if (Array.isArray(tile.contents)) {
    for (const content of tile.contents) {
      const key = content.uri != null ? "uri" : "url";
      const originalPath = content[key];
      if (originalPath && blobUrls.has(originalPath)) {
        content[key] = blobUrls.get(originalPath);
      }
    }
  }

  // Recurse into children
  if (Array.isArray(tile.children)) {
    for (const child of tile.children) {
      rewriteContentUris(child, blobUrls);
    }
  }
}

/**
 * Load 3D Tiles from a FileSystemDirectoryHandle (Chrome File System Access API).
 */
export async function loadTilesetFromDirectoryHandle(viewer, dirHandle, statusEl) {
  const files = await getFilesFromDirectoryHandle(dirHandle);
  return loadTilesetFromFiles(viewer, files, statusEl);
}

/**
 * Fly the camera to encompass the full bounding volume of the tileset.
 */
export function zoomToTileset(viewer, tileset) {
  if (!tileset) return;
  viewer.zoomTo(
    tileset,
    new HeadingPitchRange(
      0,
      CesiumMath.toRadians(-45),
      tileset.boundingSphere.radius * 2.0
    )
  );
}

/**
 * Remove a tileset from the scene and clean up blob URLs.
 */
export function removeCurrentTileset(viewer, tileset) {
  if (!tileset) return;
  viewer.scene.primitives.remove(tileset);

  if (tileset._blobCleanup) {
    const { blobUrls, tilesetBlobUrl } = tileset._blobCleanup;
    revokeBlobCleanup(blobUrls, tilesetBlobUrl);
    tileset._blobCleanup = null;
  }
}
