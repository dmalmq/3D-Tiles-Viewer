// Cut a PLATEAU 3D Tiles tileset down to the tiles that overlap a set of JIS
// grid cells. Shared by the browser (streaming a subset) and the server
// (downloading a subset to disk).
//
// PLATEAU tilesets are REPLACE-refined HLOD trees with a region volume on
// every tile. We keep only the leaves that touch a selected cell and hang
// them directly under one content-less root whose geometric error forces it
// to always refine. The result: the selected area always renders at full
// detail, and moving the camera no longer swaps coarse and fine tiles.

import { meshBounds, normalizeMeshCodes } from "./plateauGrid.js";

const DEG = 180 / Math.PI;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// Big enough that the synthetic root always exceeds the screen-space error
// threshold and refines to its (leaf) children.
const ALWAYS_REFINE_GEOMETRIC_ERROR = 1e7;
const MAX_EXTERNAL_TILESETS = 500;

export class PlateauSubsetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PlateauSubsetError";
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {string} options.url            Root tileset.json URL.
 * @param {string[]} options.meshCodes    Tertiary mesh codes to keep.
 * @param {(url: string) => Promise<object>} options.fetchJson
 * @returns {Promise<{ tileset: object, contents: Array<{ url: string }>, externalTilesetCount: number }>}
 *   `tileset` has absolute content URIs; callers that store files locally
 *   rewrite them via {@link rewriteContentUris}.
 */
export async function buildPlateauSubset({ url, meshCodes, fetchJson }) {
  const cells = normalizeMeshCodes(meshCodes).map(meshBounds).filter(Boolean);
  if (cells.length === 0) {
    throw new PlateauSubsetError("No valid grid cells selected", "no-cells");
  }

  const leaves = [];
  const state = { externalCount: 0 };
  const rootJson = await fetchJson(url);
  await collectLeaves(rootJson.root, url, IDENTITY, cells, leaves, state, fetchJson);

  const tileset = {
    asset: { version: "1.0", generator: "3D-Tiles-Viewer PLATEAU grid subset" },
    geometricError: ALWAYS_REFINE_GEOMETRIC_ERROR,
    root: {
      boundingVolume: { region: unionRegion(leaves.map(leaf => leaf.region)) ?? cellsRegion(cells) },
      geometricError: ALWAYS_REFINE_GEOMETRIC_ERROR,
      refine: "REPLACE",
      children: leaves.map(leaf => leaf.tile),
    },
  };
  if (rootJson.properties) tileset.properties = rootJson.properties;

  return {
    tileset,
    contents: leaves.map(leaf => ({ url: leaf.tile.content.uri })),
    externalTilesetCount: state.externalCount,
  };
}

/**
 * The whole tileset with every external tileset inlined, so it can be
 * mirrored as a single tileset.json. Keeps the original HLOD tree.
 *
 * @returns {Promise<{ tileset: object, contents: Array<{ url: string }>, externalTilesetCount: number }>}
 */
export async function buildPlateauFullTileset({ url, fetchJson }) {
  const rootJson = await fetchJson(url);
  const state = { externalCount: 0 };
  const contents = [];
  const root = await inlineTile(rootJson.root, url, state, contents, fetchJson);
  const tileset = {
    asset: { version: "1.0", generator: "3D-Tiles-Viewer PLATEAU mirror" },
    geometricError: rootJson.geometricError,
    root,
  };
  if (rootJson.properties) tileset.properties = rootJson.properties;
  return { tileset, contents, externalTilesetCount: state.externalCount };
}

async function inlineTile(tile, baseUrl, state, contents, fetchJson) {
  if (tile.implicitTiling) {
    throw new PlateauSubsetError("Implicit tiling is not supported for downloads", "implicit-tiling");
  }
  const out = { ...tile };
  delete out.content;
  delete out.contents;
  const children = [];
  const renderable = [];

  for (const content of [tile.content, ...(tile.contents ?? [])].filter(Boolean)) {
    const uri = content.uri ?? content.url;
    if (!uri) continue;
    const absolute = new URL(uri, baseUrl).href;
    if (isJsonUri(uri)) {
      if (++state.externalCount > MAX_EXTERNAL_TILESETS) {
        throw new PlateauSubsetError("Too many nested tilesets", "too-many-external");
      }
      const external = await fetchJson(absolute);
      children.push(await inlineTile(external.root, absolute, state, contents, fetchJson));
    } else {
      const copy = { ...content, uri: absolute };
      delete copy.url;
      renderable.push(copy);
      contents.push({ url: absolute });
    }
  }

  if (renderable.length === 1) out.content = renderable[0];
  else if (renderable.length > 1) out.contents = renderable;

  for (const child of tile.children ?? []) {
    children.push(await inlineTile(child, baseUrl, state, contents, fetchJson));
  }
  if (children.length > 0) out.children = children;
  else delete out.children;
  return out;
}

/** Replace every content URI in the tree with `mapUrl(uri)`. */
export function rewriteContentUris(tileset, mapUrl) {
  const copy = structuredClone(tileset);
  const visit = (tile) => {
    if (tile.content?.uri) tile.content.uri = mapUrl(tile.content.uri);
    for (const content of tile.contents ?? []) {
      if (content.uri) content.uri = mapUrl(content.uri);
    }
    for (const child of tile.children ?? []) visit(child);
  };
  visit(copy.root);
  return copy;
}

async function collectLeaves(tile, baseUrl, parentTransform, cells, out, state, fetchJson) {
  if (!tile) return;
  if (tile.implicitTiling) {
    throw new PlateauSubsetError("Implicit tiling is not supported for grid subsets", "implicit-tiling");
  }

  const region = tile.boundingVolume?.region;
  // Regions are absolute (EPSG:4979), so they can be tested without applying
  // transforms. Tiles with only box/sphere volumes are kept conservatively.
  if (region && !cells.some(cell => regionIntersectsCell(region, cell))) return;

  const transform = tile.transform ? multiply(parentTransform, tile.transform) : parentTransform;
  const contents = [tile.content, ...(tile.contents ?? [])].filter(Boolean);
  const children = tile.children ?? [];

  for (const content of contents) {
    const uri = content.uri ?? content.url;
    if (!uri || !isJsonUri(uri)) continue;
    // External tileset: its root replaces this tile's content.
    if (++state.externalCount > MAX_EXTERNAL_TILESETS) {
      throw new PlateauSubsetError("Too many nested tilesets", "too-many-external");
    }
    const externalUrl = new URL(uri, baseUrl).href;
    const external = await fetchJson(externalUrl);
    await collectLeaves(external.root, externalUrl, transform, cells, out, state, fetchJson);
  }

  if (children.length > 0) {
    for (const child of children) {
      await collectLeaves(child, baseUrl, transform, cells, out, state, fetchJson);
    }
    return;
  }

  const renderable = contents.filter(content => {
    const uri = content.uri ?? content.url;
    return uri && !isJsonUri(uri);
  });
  for (const content of renderable) {
    const leaf = {
      boundingVolume: tile.boundingVolume,
      geometricError: 0,
      refine: "REPLACE",
      content: { uri: new URL(content.uri ?? content.url, baseUrl).href },
    };
    if (content.boundingVolume) leaf.content.boundingVolume = content.boundingVolume;
    if (transform !== IDENTITY) leaf.transform = transform;
    out.push({ tile: leaf, region: region ?? null });
  }
}

export function regionIntersectsCell(region, cell) {
  const [west, south, east, north] = region.map(v => v * DEG);
  return west <= cell.east && east >= cell.west && south <= cell.north && north >= cell.south;
}

function unionRegion(regions) {
  const valid = regions.filter(Boolean);
  if (valid.length === 0) return null;
  const out = [...valid[0]];
  for (const r of valid.slice(1)) {
    out[0] = Math.min(out[0], r[0]);
    out[1] = Math.min(out[1], r[1]);
    out[2] = Math.max(out[2], r[2]);
    out[3] = Math.max(out[3], r[3]);
    out[4] = Math.min(out[4], r[4]);
    out[5] = Math.max(out[5], r[5]);
  }
  return out;
}

function cellsRegion(cells) {
  const toRad = v => v / DEG;
  return [
    toRad(Math.min(...cells.map(c => c.west))),
    toRad(Math.min(...cells.map(c => c.south))),
    toRad(Math.max(...cells.map(c => c.east))),
    toRad(Math.max(...cells.map(c => c.north))),
    -100,
    1000,
  ];
}

function isJsonUri(uri) {
  return /\.json(?:$|[?#])/i.test(uri);
}

// Column-major 4x4 multiply (3D Tiles convention).
function multiply(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}
