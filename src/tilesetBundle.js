import { getDirectoryHandle } from "./directoryStore.js";
import { getFilesFromDirectoryHandle } from "./fileSystemAccess.js";
import { slugifyVenueId } from "./session.js";

function isPublishedTilesetUrl(url) {
  return typeof url === "string" && (url.startsWith("/tilesets/") || url.startsWith("/tiles/"));
}

function isRemoteUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function tilesetGroupKey(buildingsInGroup) {
  const first = buildingsInGroup[0];
  if (first?.directoryHandleId) return `dir-${first.directoryHandleId}`;
  if (first?.sourceUrl && isPublishedTilesetUrl(first.sourceUrl)) {
    return `existing-${first.sourceUrl}`;
  }
  if (first?.sourceUrl && isRemoteUrl(first.sourceUrl)) {
    return `url-${hashString(first.sourceUrl)}`;
  }
  const name = first?.name ?? "tileset";
  return `bldg-${slugifyVenueId(name)}`;
}

function storageKeyFromGroupKey(groupKey) {
  if (groupKey.startsWith("dir-")) return groupKey.slice(4);
  if (groupKey.startsWith("existing-")) return null;
  if (groupKey.startsWith("url-")) return groupKey.slice(4);
  if (groupKey.startsWith("bldg-")) return groupKey.slice(5);
  return slugifyVenueId(groupKey);
}

export function groupBuildingsByTileset(buildings) {
  const byTileset = new Map();
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const tileset = b.tileset;
    const group = tileset ?? `missing-${i}`;
    if (!byTileset.has(group)) byTileset.set(group, []);
    byTileset.get(group).push({ building: b, index: i });
  }
  return byTileset;
}

export async function collectTilesetBundles(buildings) {
  const groups = groupBuildingsByTileset(buildings);
  const bundles = [];
  const warnings = [];

  for (const [, entries] of groups) {
    const groupBuildings = entries.map((e) => e.building);
    const first = groupBuildings[0];
    if (!first?.tileset && !first?.sourceUrl && !first?.directoryHandleId) {
      warnings.push({ building: first?.name, reason: "noTileset" });
      continue;
    }

    const groupKey = tilesetGroupKey(groupBuildings);
    const key = storageKeyFromGroupKey(groupKey);

    if (groupKey.startsWith("existing-")) {
      bundles.push({
        key: null,
        publicUrl: first.sourceUrl,
        buildingNames: groupBuildings.map((b) => b.name),
        skipUpload: true,
      });
      continue;
    }

    if (first.directoryHandleId) {
      try {
        const handle = await getDirectoryHandle(first.directoryHandleId);
        if (!handle) throw new Error("Directory handle not found");
        const files = await getFilesFromDirectoryHandle(handle);
        if (!files.some((f) => f.name === "tileset.json")) {
          throw new Error("tileset.json not found in folder");
        }
        bundles.push({
          key,
          files,
          buildingNames: groupBuildings.map((b) => b.name),
          skipUpload: false,
        });
      } catch (err) {
        warnings.push({ building: first.name, reason: "directoryUnreadable", detail: err.message });
      }
      continue;
    }

    if (first.sourceUrl && isRemoteUrl(first.sourceUrl)) {
      bundles.push({
        key,
        mirrorUrl: first.sourceUrl,
        buildingNames: groupBuildings.map((b) => b.name),
        skipUpload: false,
      });
      continue;
    }

    if (first.directoryHandleId === null && !first.sourceUrl) {
      warnings.push({ building: first.name, reason: "localFolderNotPersisted" });
    }
  }

  return { bundles, warnings };
}

export function rewriteSessionTilesetUrls(sessionData, urlByBuildingName) {
  const data = structuredClone(sessionData);
  for (const b of data.buildings ?? []) {
    const mapped = urlByBuildingName.get(b.name);
    if (!mapped) continue;
    b.sourceType = "url";
    b.sourceUrl = mapped;
    b.directoryHandleId = null;
    b._directoryFolderName = null;
  }
  return data;
}

export function buildTilesetUrlMap(buildings, bundles, publishedUrls) {
  const urlByName = new Map();
  const nameToBundle = new Map();
  for (const bundle of bundles) {
    for (const name of bundle.buildingNames ?? []) {
      nameToBundle.set(name, bundle);
    }
  }

  for (const b of buildings) {
    const bundle = nameToBundle.get(b.name);
    if (!bundle) continue;
    if (bundle.skipUpload && bundle.publicUrl) {
      urlByName.set(b.name, bundle.publicUrl);
    } else if (bundle.key && publishedUrls[bundle.key]) {
      urlByName.set(b.name, publishedUrls[bundle.key]);
    } else if (bundle.key) {
      urlByName.set(b.name, `/tilesets/${encodeURIComponent(bundle.key)}/tileset.json`);
    }
  }
  return urlByName;
}