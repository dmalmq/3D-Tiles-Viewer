// Offline tileset pack builder.
//
// Walks a loaded 3D Tiles graph the same way a local-folder picker would —
// tileset.json → children → external tilesets → implicit subtrees → tile
// content → glTF buffers/images — and returns a flat list of pack entries whose
// paths are all relative to the pack root. The result opens in the viewer's
// "This device" folder picker with no absolute URLs left behind.
//
// The builder is DOM-free and Cesium-free so it can be unit tested in Node; the
// browser supplies a source adapter (local File list, or same-origin fetch).

import {
  enumerateSubtree,
  externalSubtreeBufferUris,
  parseSubtree,
  substituteTemplate,
} from "./implicitTiling.js";

export const PACK_ROOT_PATH = "tileset.json";

/** Sidecars the viewer reads next to tileset.json when a folder is picked. */
export const PACK_SIDECAR_PATHS = ["levels.json"];

const DEFAULT_MAX_ENTRIES = 100_000;
const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

// ── path helpers ────────────────────────────────────────────────────────────

export function isAbsoluteUri(uri) {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("//") || uri.startsWith("/");
}

function stripQuery(uri) {
  const cut = uri.search(/[?#]/);
  return cut === -1 ? uri : uri.slice(0, cut);
}

/** Collapse `.`/`..` segments. Returns null when the path escapes the root. */
export function normalizePackPath(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.length ? out.join("/") : null;
}

export function dirOf(path) {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut + 1);
}

/** Resolve a relative URI against a pack directory. Null when it escapes. */
export function resolvePackPath(baseDir, uri) {
  return normalizePackPath(`${baseDir}${stripQuery(uri)}`);
}

/** Express `targetPath` relative to `fromDir`, both pack-root-relative. */
export function relativePackPath(fromDir, targetPath) {
  if (!fromDir) return targetPath;
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = targetPath.split("/");
  let i = 0;
  while (i < fromParts.length && i < toParts.length - 1 && toParts[i] === fromParts[i]) i++;
  return "../".repeat(fromParts.length - i) + toParts.slice(i).join("/");
}

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

// ── binary tile format readers ──────────────────────────────────────────────

/** Extract the JSON chunk of a GLB. Returns null when the bytes are not GLB. */
export function parseGlbJson(bytes) {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(4, true) !== 2) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > bytes.length) break;
    if (chunkType === JSON_CHUNK_TYPE) {
      return JSON.parse(textDecoder.decode(bytes.subarray(start, end)).replace(/\0+$/, ""));
    }
    offset = end;
  }
  return null;
}

const LEGACY_HEADER_BYTES = { b3dm: 28, i3dm: 32 };

/**
 * Payload of a legacy b3dm/i3dm tile: either embedded GLB bytes or, for i3dm
 * with `gltfFormat === 0`, a URI pointing at an external glTF.
 */
export function parseLegacyTileContent(kind, bytes) {
  const headerBytes = LEGACY_HEADER_BYTES[kind];
  if (!headerBytes || bytes.length < headerBytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bodyStart =
    headerBytes +
    view.getUint32(12, true) +
    view.getUint32(16, true) +
    view.getUint32(20, true) +
    view.getUint32(24, true);
  if (bodyStart >= bytes.length) return null;
  const body = bytes.subarray(bodyStart);

  if (kind === "i3dm" && view.getUint32(28, true) === 0) {
    return { kind: "uri", uri: textDecoder.decode(body).replace(/\0+$/, "").trim() };
  }
  return { kind: "glb", bytes: body };
}

/** Inner tile byte ranges of a cmpt composite. */
export function splitComposite(bytes) {
  if (bytes.length < 16) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tilesLength = view.getUint32(12, true);
  const inner = [];
  let offset = 16;
  for (let i = 0; i < tilesLength && offset + 12 <= bytes.length; i++) {
    const byteLength = view.getUint32(offset + 8, true);
    if (byteLength <= 0 || offset + byteLength > bytes.length) break;
    inner.push(bytes.subarray(offset, offset + byteLength));
    offset += byteLength;
  }
  return inner;
}

function magicOf(bytes) {
  if (bytes.length < 4) return "";
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

// ── sources ─────────────────────────────────────────────────────────────────

/**
 * Pack source backed by a picked folder (webkitdirectory / File System Access).
 * The pack root is the directory holding the shallowest tileset.json.
 */
export function createFileListSource(fileList) {
  const files = Array.from(fileList ?? []);
  const pathOf = (file) => String(file.webkitRelativePath || file.relativePath || file.name);

  let rootPath = null;
  for (const file of files) {
    const path = pathOf(file);
    if (!/(^|\/)tileset\.json$/i.test(path)) continue;
    if (rootPath === null || path.split("/").length < rootPath.split("/").length) rootPath = path;
  }
  if (rootPath === null) throw new Error("No tileset.json found in the selected folder.");

  const baseDir = rootPath.slice(0, rootPath.lastIndexOf("/") + 1);
  const byPath = new Map();
  for (const file of files) {
    const path = pathOf(file);
    if (baseDir && !path.startsWith(baseDir)) continue;
    byPath.set(path.slice(baseDir.length), file);
  }

  return {
    label: baseDir.replace(/\/$/, "") || "tileset",
    async read(relPath) {
      const file = byPath.get(relPath);
      if (!file) return null;
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}

/**
 * Pack source backed by a tileset URL. Only files at or below the tileset.json
 * directory on the same origin are fetched — third-party tiles are never
 * scraped into the pack.
 */
export function createUrlSource(tilesetUrl, { fetchImpl, origin } = {}) {
  const pageOrigin = origin ?? globalThis.location?.href ?? "http://localhost/";
  const rootUrl = new URL(tilesetUrl, pageOrigin);
  const baseUrl = new URL("./", rootUrl);
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) throw new Error("No fetch implementation available for URL export.");

  const label =
    baseUrl.pathname.split("/").filter(Boolean).pop() ?? rootUrl.hostname ?? "tileset";

  return {
    label,
    async read(relPath) {
      const target = new URL(relPath, baseUrl);
      if (target.origin !== baseUrl.origin) return null;
      if (!target.pathname.startsWith(baseUrl.pathname)) return null;
      const res = await doFetch(target.href);
      if (!res?.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// ── walker ──────────────────────────────────────────────────────────────────

function addWarning(warnings, reason, path, detail) {
  warnings.push(detail === undefined ? { reason, path } : { reason, path, detail });
}

/**
 * Resolve one URI found inside `fromPath`. Returns the pack path, or null when
 * the URI is absolute / escapes the pack (both recorded as warnings).
 */
function resolveReference(uri, fromPath, warnings, reasonPrefix) {
  if (typeof uri !== "string" || uri.length === 0) return null;
  if (isAbsoluteUri(uri)) {
    addWarning(warnings, `${reasonPrefix}Absolute`, fromPath, uri);
    return null;
  }
  const resolved = resolvePackPath(dirOf(fromPath), uri);
  if (!resolved) {
    addWarning(warnings, `${reasonPrefix}OutsidePack`, fromPath, uri);
    return null;
  }
  return resolved;
}

function contentKindFor(path) {
  return extensionOf(path) === "json" ? "tileset" : extensionOf(path) === "gltf" ? "gltf" : "content";
}

function tileContents(tile) {
  const list = [];
  if (tile.content && typeof tile.content === "object") list.push(tile.content);
  if (Array.isArray(tile.contents)) {
    for (const content of tile.contents) {
      if (content && typeof content === "object") list.push(content);
    }
  }
  return list;
}

function contentUriKey(content) {
  return content.uri != null ? "uri" : "url";
}

/**
 * Collect every file an offline copy of the tileset needs.
 *
 * @param {{read: (relPath: string) => Promise<Uint8Array|null>, label?: string}} source
 * @param {{maxEntries?: number, sidecars?: string[], maxSubtreeNodes?: number}} [options]
 * @returns {Promise<{entries: Array<{path: string, data: Uint8Array}>,
 *                    warnings: Array<{reason: string, path: string, detail?: string}>,
 *                    totalBytes: number, label: string}>}
 */
export async function buildTilesetPack(source, options = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sidecars = options.sidecars ?? PACK_SIDECAR_PATHS;
  const maxSubtreeNodes = options.maxSubtreeNodes;

  const entries = [];
  const warnings = [];
  const emitted = new Map();
  const queued = new Set();
  const queue = [];

  const emit = (path, data) => {
    if (emitted.has(path)) return;
    if (entries.length >= maxEntries) {
      throw new Error(`Tileset pack exceeds ${maxEntries} files; refusing to continue.`);
    }
    const entry = { path, data };
    emitted.set(path, entry);
    entries.push(entry);
  };

  const enqueue = (item) => {
    if (!item?.path) return;
    const key = `${item.kind}:${item.path}`;
    if (queued.has(key)) return;
    queued.add(key);
    queue.push(item);
  };

  const read = async (path, fromPath) => {
    let bytes = null;
    try {
      bytes = await source.read(path);
    } catch (err) {
      addWarning(warnings, "readFailed", path, err?.message ?? String(err));
      return null;
    }
    if (!bytes) {
      addWarning(warnings, "missing", path, fromPath ?? undefined);
      return null;
    }
    return bytes;
  };

  const rootBytes = await read(PACK_ROOT_PATH, null);
  if (!rootBytes) throw new Error("No tileset.json found for the loaded tileset.");
  emit(PACK_ROOT_PATH, walkTilesetJson(rootBytes, PACK_ROOT_PATH, { enqueue, warnings }));
  queued.add(`tileset:${PACK_ROOT_PATH}`);

  while (queue.length > 0) {
    const item = queue.shift();
    if (item.kind !== "subtree" && emitted.has(item.path)) continue;
    const bytes = await read(item.path, item.fromPath);
    if (!bytes) continue;

    if (item.kind === "tileset") {
      emit(item.path, walkTilesetJson(bytes, item.path, { enqueue, warnings }));
    } else if (item.kind === "gltf") {
      emit(item.path, walkGltfJson(bytes, item.path, { enqueue, warnings }));
    } else if (item.kind === "subtree") {
      emit(item.path, bytes);
      await walkSubtree(bytes, item, {
        source,
        read,
        enqueue,
        emit,
        warnings,
        maxSubtreeNodes,
      });
    } else if (item.kind === "content") {
      emit(item.path, bytes);
      walkContentBinary(bytes, item.path, { enqueue, warnings });
    } else {
      emit(item.path, bytes);
    }
  }

  for (const sidecar of sidecars) {
    if (emitted.has(sidecar)) continue;
    let bytes = null;
    try {
      bytes = await source.read(sidecar);
    } catch {
      bytes = null;
    }
    if (bytes) emit(sidecar, bytes);
  }

  const totalBytes = entries.reduce((sum, e) => sum + e.data.length, 0);
  return { entries, warnings, totalBytes, label: source.label ?? "tileset" };
}

/**
 * Walk a tileset JSON, queue everything it references and return the bytes to
 * pack. URIs are rewritten only when the packed layout needs it (query strings,
 * `./` prefixes, `..` normalisation).
 */
function walkTilesetJson(bytes, path, { enqueue, warnings }) {
  let json;
  try {
    json = JSON.parse(textDecoder.decode(bytes));
  } catch (err) {
    addWarning(warnings, "tilesetParseFailed", path, err?.message ?? String(err));
    return bytes;
  }

  const fromDir = dirOf(path);
  let rewritten = false;

  const linkContent = (content) => {
    const key = contentUriKey(content);
    const resolved = resolveReference(content[key], path, warnings, "content");
    if (!resolved) return;
    enqueue({ kind: contentKindFor(resolved), path: resolved, fromPath: path });
    const rel = relativePackPath(fromDir, resolved);
    if (rel !== content[key]) {
      content[key] = rel;
      rewritten = true;
    }
  };

  /**
   * Implicit URI templates resolve against the tileset that declares them.
   * Absolute templates (`https://cdn/tiles/{level}/{x}/{y}.subtree`) cannot be
   * packed at all, and substituting one would forge a bogus relative path such
   * as `https:/cdn/tiles/0/0/0.subtree`, so they are reported once here and the
   * template is dropped instead of walked.
   */
  const checkTemplate = (template, reasonPrefix) => {
    if (typeof template !== "string" || template.length === 0) return false;
    if (/[?#]/.test(template)) addWarning(warnings, "implicitTemplateQuery", path, template);
    if (isAbsoluteUri(template)) {
      addWarning(warnings, `${reasonPrefix}Absolute`, path, template);
      return false;
    }
    return true;
  };

  const linkImplicit = (tile, implicit) => {
    const subtreeTemplate = implicit?.subtrees?.uri;
    if (typeof subtreeTemplate !== "string" || !subtreeTemplate) {
      addWarning(warnings, "implicitSubtreesMissing", path, JSON.stringify(implicit ?? null));
      return;
    }
    const subtreeUsable = checkTemplate(subtreeTemplate, "subtree");
    const contentTemplates = tileContents(tile).map((content) => {
      const template = content[contentUriKey(content)];
      return checkTemplate(template, "content") ? template : null;
    });
    if (!subtreeUsable) return;
    const plan = {
      tilesetPath: path,
      tilesetDir: fromDir,
      subdivisionScheme: implicit.subdivisionScheme ?? "QUADTREE",
      subtreeLevels: implicit.subtreeLevels ?? 1,
      subtreeTemplate,
      contentTemplates,
    };
    const root = { level: 0, x: 0, y: 0, z: 0 };
    const rootPath = resolveReference(
      substituteTemplate(subtreeTemplate, root),
      path,
      warnings,
      "subtree",
    );
    if (!rootPath) return;
    enqueue({ kind: "subtree", path: rootPath, fromPath: path, plan, root });
  };

  const visitTile = (tile) => {
    if (!tile || typeof tile !== "object") return;
    const implicit = tile.implicitTiling ?? tile.extensions?.["3DTILES_implicit_tiling"];
    if (implicit) {
      linkImplicit(tile, implicit);
    } else {
      for (const content of tileContents(tile)) linkContent(content);
    }
    if (Array.isArray(tile.children)) tile.children.forEach(visitTile);
  };

  visitTile(json.root);

  if (typeof json.schemaUri === "string") {
    const resolved = resolveReference(json.schemaUri, path, warnings, "schema");
    if (resolved) {
      enqueue({ kind: "binary", path: resolved, fromPath: path });
      const rel = relativePackPath(fromDir, resolved);
      if (rel !== json.schemaUri) {
        json.schemaUri = rel;
        rewritten = true;
      }
    }
  }

  return rewritten ? textEncoder.encode(JSON.stringify(json)) : bytes;
}

function walkGltfJson(bytes, path, { enqueue, warnings }) {
  let json;
  try {
    json = JSON.parse(textDecoder.decode(bytes));
  } catch (err) {
    addWarning(warnings, "gltfParseFailed", path, err?.message ?? String(err));
    return bytes;
  }

  const fromDir = dirOf(path);
  let rewritten = false;
  for (const list of [json.buffers, json.images]) {
    for (const item of list ?? []) {
      if (!item || typeof item.uri !== "string" || item.uri.startsWith("data:")) continue;
      const resolved = resolveReference(item.uri, path, warnings, "gltfResource");
      if (!resolved) continue;
      enqueue({ kind: "binary", path: resolved, fromPath: path });
      const rel = relativePackPath(fromDir, resolved);
      if (rel !== item.uri) {
        item.uri = rel;
        rewritten = true;
      }
    }
  }
  return rewritten ? textEncoder.encode(JSON.stringify(json)) : bytes;
}

/** Queue external resources referenced from binary tile content (glb/b3dm/i3dm/cmpt). */
function walkContentBinary(bytes, path, ctx) {
  const magic = magicOf(bytes);
  if (magic === "glTF") {
    queueGlbResources(bytes, path, ctx);
    return;
  }
  if (magic === "b3dm" || magic === "i3dm") {
    const payload = parseLegacyTileContent(magic, bytes);
    if (!payload) return;
    if (payload.kind === "uri") {
      const resolved = resolveReference(payload.uri, path, ctx.warnings, "content");
      if (resolved) ctx.enqueue({ kind: contentKindFor(resolved), path: resolved, fromPath: path });
      return;
    }
    queueGlbResources(payload.bytes, path, ctx);
    return;
  }
  if (magic === "cmpt") {
    for (const inner of splitComposite(bytes)) walkContentBinary(inner, path, ctx);
  }
}

function queueGlbResources(bytes, path, { enqueue, warnings }) {
  let json;
  try {
    json = parseGlbJson(bytes);
  } catch (err) {
    addWarning(warnings, "glbParseFailed", path, err?.message ?? String(err));
    return;
  }
  if (!json) return;
  for (const list of [json.buffers, json.images]) {
    for (const item of list ?? []) {
      if (!item || typeof item.uri !== "string" || item.uri.startsWith("data:")) continue;
      const resolved = resolveReference(item.uri, path, warnings, "gltfResource");
      if (resolved) enqueue({ kind: "binary", path: resolved, fromPath: path });
    }
  }
}

/**
 * Expand one implicit subtree: pack its external buffers, then queue the tile
 * content and child subtrees its availability bitstreams mark as present.
 */
async function walkSubtree(bytes, item, { read, enqueue, emit, warnings, maxSubtreeNodes }) {
  const { plan, root, path } = item;
  let parsed;
  try {
    parsed = parseSubtree(bytes);
  } catch (err) {
    addWarning(warnings, "subtreeParseFailed", path, err?.message ?? String(err));
    return;
  }

  const buffers = [];
  const declared = parsed.json?.buffers ?? [];
  for (let i = 0; i < declared.length; i++) {
    const uri = declared[i]?.uri;
    if (typeof uri !== "string" || !uri) {
      buffers[i] = parsed.binary;
      continue;
    }
    const resolved = resolveReference(uri, path, warnings, "subtreeBuffer");
    if (!resolved) {
      buffers[i] = null;
      continue;
    }
    const bufferBytes = await read(resolved, path);
    if (bufferBytes) emit(resolved, bufferBytes);
    buffers[i] = bufferBytes;
  }
  if (declared.length === 0 && parsed.binary) buffers[0] = parsed.binary;
  if (externalSubtreeBufferUris(parsed.json).length > 0 && buffers.some((b) => !b)) {
    addWarning(warnings, "subtreeBufferMissing", path);
  }

  let expanded;
  try {
    expanded = enumerateSubtree({
      subtreeJson: parsed.json,
      buffers,
      subdivisionScheme: plan.subdivisionScheme,
      subtreeLevels: plan.subtreeLevels,
      root,
      maxNodes: maxSubtreeNodes,
    });
  } catch (err) {
    addWarning(warnings, "subtreeExpandFailed", path, err?.message ?? String(err));
    return;
  }

  for (const tile of expanded.contentTiles) {
    const template =
      tile.contentIndex < plan.contentTemplates.length
        ? plan.contentTemplates[tile.contentIndex]
        : plan.contentTemplates[0];
    if (typeof template !== "string" || !template) continue;
    const contentPath = resolveReference(
      substituteTemplate(template, tile),
      plan.tilesetPath,
      warnings,
      "content",
    );
    if (!contentPath) continue;
    enqueue({ kind: contentKindFor(contentPath), path: contentPath, fromPath: path });
  }

  for (const childRoot of expanded.childSubtreeRoots) {
    const childPath = resolveReference(
      substituteTemplate(plan.subtreeTemplate, childRoot),
      plan.tilesetPath,
      warnings,
      "subtree",
    );
    if (!childPath) continue;
    enqueue({ kind: "subtree", path: childPath, fromPath: path, plan, root: childRoot });
  }
}
