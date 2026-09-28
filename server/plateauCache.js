import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlateauFullTileset,
  buildPlateauSubset,
  rewriteContentUris,
} from "../src/plateauTilesetSubset.js";
import { normalizeMeshCodes } from "../src/plateauGrid.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLATEAU_CACHE_DIR = path.join(__dirname, "..", "data", "plateau-cache");

const DOWNLOAD_CONCURRENCY = 8;
const DOWNLOAD_RETRIES = 3;
const PROGRESS_INTERVAL_MS = 250;
const CACHE_KEY_RE = /^[a-f0-9]{20}$/;

// Only PLATEAU hosts: the endpoint writes whatever it fetches to disk, so it
// must not become a general-purpose download proxy.
const ALLOWED_HOSTS = [
  "api.plateauview.mlit.go.jp",
  "assets.cms.plateau.reearth.io",
];

export function isAllowedPlateauUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function plateauCacheKey(sourceUrl, meshCodes) {
  const codes = normalizeMeshCodes(meshCodes);
  return crypto
    .createHash("sha1")
    .update(`${sourceUrl}|${codes.join(",")}`)
    .digest("hex")
    .slice(0, 20);
}

export function plateauCacheUrl(key) {
  return `/plateau-cache/${key}/tileset.json`;
}

function cacheDir(root, key) {
  return path.join(root, key);
}

async function readMeta(root, key) {
  try {
    return JSON.parse(await fs.readFile(path.join(cacheDir(root, key), "meta.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function listPlateauCache({ root = PLATEAU_CACHE_DIR } = {}) {
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CACHE_KEY_RE.test(entry.name)) continue;
    const meta = await readMeta(root, entry.name);
    if (meta?.complete) out.push({ ...meta, url: plateauCacheUrl(entry.name) });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deletePlateauCache(key, { root = PLATEAU_CACHE_DIR } = {}) {
  if (!CACHE_KEY_RE.test(key) || jobs.has(key)) return false;
  await fs.rm(cacheDir(root, key), { recursive: true, force: true });
  return true;
}

// One job per cache key; a second request for the same data attaches to it.
const jobs = new Map();

/**
 * Download a PLATEAU tileset (optionally cut to grid cells) into the cache.
 * `onProgress({ done, total, bytes })` fires while files are fetched.
 * Resolves to the finished meta, including the local `url`.
 */
export function downloadPlateauTileset(
  { sourceUrl, meshCodes = [], label = "" },
  onProgress,
  { root = PLATEAU_CACHE_DIR, fetchImpl = fetch } = {},
) {
  if (!isAllowedPlateauUrl(sourceUrl)) {
    const err = new Error("Only PLATEAU dataset URLs can be downloaded");
    err.status = 400;
    return Promise.reject(err);
  }
  const codes = normalizeMeshCodes(meshCodes);
  const key = plateauCacheKey(sourceUrl, codes);

  let job = jobs.get(key);
  if (!job) {
    const created = { listeners: new Set(), last: null, promise: null };
    created.promise = runDownload({ root, fetchImpl, key, sourceUrl, meshCodes: codes, label }, (progress) => {
      created.last = progress;
      for (const listener of created.listeners) listener(progress);
    }).finally(() => jobs.delete(key));
    jobs.set(key, created);
    job = created;
  }
  if (onProgress) {
    job.listeners.add(onProgress);
    if (job.last) onProgress(job.last);
  }
  return job.promise.finally(() => job.listeners.delete(onProgress));
}

async function runDownload({ root, fetchImpl, key, sourceUrl, meshCodes, label }, emit) {
  const existing = await readMeta(root, key);
  if (existing?.complete) {
    return { ...existing, url: plateauCacheUrl(key), cached: true };
  }

  const fetchOk = (url) => {
    if (!isAllowedPlateauUrl(url)) throw new Error(`Refusing to fetch non-PLATEAU URL ${url}`);
    return fetchWithRetry(fetchImpl, url);
  };
  const fetchJson = async url => (await fetchOk(url)).json();

  const plan = meshCodes.length > 0
    ? await buildPlateauSubset({ url: sourceUrl, meshCodes, fetchJson })
    : await buildPlateauFullTileset({ url: sourceUrl, fetchJson });

  const dir = cacheDir(root, key);
  await fs.mkdir(path.join(dir, "c"), { recursive: true });

  // Stable local names by position; the same plan always maps the same way,
  // so an interrupted download resumes by skipping files already on disk.
  const localByUrl = new Map();
  for (const { url } of plan.contents) {
    if (localByUrl.has(url)) continue;
    const ext = path.extname(new URL(url).pathname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
    localByUrl.set(url, `c/${String(localByUrl.size).padStart(6, "0")}${ext}`);
  }

  const queue = [...localByUrl];
  const total = queue.length;
  let done = 0;
  let bytes = 0;
  let lastEmit = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
    lastEmit = now;
    emit({ done, total, bytes });
  };
  report(true);

  const worker = async () => {
    while (queue.length > 0) {
      const [url, rel] = queue.shift();
      const dest = path.join(dir, rel);
      const size = await fileSize(dest);
      if (size > 0) {
        bytes += size;
      } else {
        const res = await fetchOk(url);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(`${dest}.part`, buf);
        await fs.rename(`${dest}.part`, dest);
        bytes += buf.length;
      }
      done++;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, Math.max(total, 1)) }, worker));
  report(true);

  const tileset = rewriteContentUris(plan.tileset, url => localByUrl.get(url) ?? url);
  await writeJsonAtomic(path.join(dir, "tileset.json"), tileset);

  const meta = {
    key,
    sourceUrl,
    meshCodes,
    label,
    fileCount: total,
    bytes,
    createdAt: new Date().toISOString(),
    complete: true,
  };
  await writeJsonAtomic(path.join(dir, "meta.json"), meta);
  return { ...meta, url: plateauCacheUrl(key), cached: false };
}

async function fetchWithRetry(fetchImpl, url) {
  let lastError;
  for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastError = e;
    }
    if (attempt < DOWNLOAD_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

async function writeJsonAtomic(file, data) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data), "utf8");
  await fs.rename(`${file}.tmp`, file);
}
