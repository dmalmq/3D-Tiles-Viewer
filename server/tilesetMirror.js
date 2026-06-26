import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.join(__dirname, "..", "data");

export function tilesetPublicUrl(key) {
  return `/tilesets/${encodeURIComponent(key)}/tileset.json`;
}

export function tilesetStorageDir(key) {
  return path.join(DATA_ROOT, "tilesets", key);
}

function resolveUri(baseUrl, uri) {
  if (!uri || /^https?:\/\//i.test(uri) || uri.startsWith("data:")) return uri;
  const base = new URL(baseUrl);
  return new URL(uri, base).href;
}

function collectContentUris(tile, baseUrl, out) {
  if (!tile) return;
  if (tile.content) {
    const uri = tile.content.uri ?? tile.content.url;
    if (uri) out.add(resolveUri(baseUrl, uri));
  }
  if (Array.isArray(tile.contents)) {
    for (const content of tile.contents) {
      const uri = content.uri ?? content.url;
      if (uri) out.add(resolveUri(baseUrl, uri));
    }
  }
  if (Array.isArray(tile.children)) {
    for (const child of tile.children) {
      collectContentUris(child, baseUrl, out);
    }
  }
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

export async function mirrorTilesetFromUrl(key, sourceUrl) {
  const destDir = tilesetStorageDir(key);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  const rootRes = await fetch(sourceUrl);
  if (!rootRes.ok) throw new Error(`Failed to fetch tileset ${sourceUrl}: HTTP ${rootRes.status}`);
  const tilesetJson = await rootRes.json();
  const baseUrl = sourceUrl;

  const assetUrls = new Set([sourceUrl]);
  collectContentUris(tilesetJson.root, baseUrl, assetUrls);

  const root = new URL(baseUrl);
  const rootDir = root.href.slice(0, root.href.lastIndexOf("/") + 1);
  const urlToRel = new Map();
  for (const assetUrl of assetUrls) {
    const u = new URL(assetUrl);
    let rel;
    if (u.href === sourceUrl || u.pathname.endsWith("/tileset.json")) {
      rel = "tileset.json";
    } else if (u.href.startsWith(rootDir)) {
      rel = decodeURIComponent(u.href.slice(rootDir.length));
    } else {
      rel = decodeURIComponent(u.pathname.split("/").pop() || "asset");
    }
    urlToRel.set(assetUrl, rel);
  }

  for (const [assetUrl, rel] of urlToRel) {
    const destPath = path.join(destDir, rel.split("/").join(path.sep));
    await downloadToFile(assetUrl, destPath);
  }

  return tilesetPublicUrl(key);
}

export async function writeTilesetFiles(key, files) {
  const destDir = tilesetStorageDir(key);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });

  for (const { relativePath, buffer } of files) {
    const safe = relativePath.replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
    const destPath = path.join(destDir, safe.split("/").join(path.sep));
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, buffer);
  }

  const tilesetPath = path.join(destDir, "tileset.json");
  try {
    await fs.access(tilesetPath);
  } catch {
    throw new Error(`Tileset bundle "${key}" is missing tileset.json`);
  }

  return tilesetPublicUrl(key);
}