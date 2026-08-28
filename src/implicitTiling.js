// 3D Tiles 1.1 implicit tiling helpers.
//
// The offline pack builder has to enumerate the files an implicit tileset
// actually references: subtree files, then the content URIs each subtree marks
// available. That means parsing the binary `.subtree` format and its
// availability bitstreams — Cesium does the same walk at runtime, but it never
// exposes the resolved file list.
//
// Spec: https://github.com/CesiumGS/3d-tiles/tree/main/specification/ImplicitTiling

const SUBTREE_MAGIC = "subt";
const SUBTREE_HEADER_BYTES = 24;

/**
 * Upper bound on the tiles one subtree may describe. A malformed or hostile
 * `subtreeLevels` (say 40 levels of octree) would otherwise ask the walker to
 * visit 2^120 nodes and hang the tab; such a subtree fails with a warning
 * instead.
 */
export const MAX_SUBTREE_NODES = 1_000_000;

/** Children per tile for each subdivision scheme. */
export function branchingFactor(subdivisionScheme) {
  return String(subdivisionScheme).toUpperCase() === "OCTREE" ? 8 : 4;
}

function dimensions(subdivisionScheme) {
  return String(subdivisionScheme).toUpperCase() === "OCTREE" ? 3 : 2;
}

/** Number of tiles in levels 0..levels-1 of a full b-ary tree. */
function nodesInLevels(levels, factor) {
  return (Math.pow(factor, levels) - 1) / (factor - 1);
}

/**
 * Decode a Morton index into x/y[/z]. Bit 0 of the index is bit 0 of x,
 * bit 1 is bit 0 of y, and (octree only) bit 2 is bit 0 of z.
 */
export function mortonDecode(index, dims, bits) {
  if (bits * dims > 30) {
    throw new Error(`Implicit subtree too deep to enumerate: ${bits} levels`);
  }
  const out = [0, 0, 0];
  for (let bit = 0; bit < bits; bit++) {
    for (let d = 0; d < dims; d++) {
      out[d] |= ((index >> (bit * dims + d)) & 1) << bit;
    }
  }
  return { x: out[0], y: out[1], z: out[2] };
}

/** Substitute {level}/{x}/{y}/{z} in an implicit URI template. */
export function substituteTemplate(template, { level, x, y, z = 0 }) {
  return String(template)
    .replace(/\{level\}/g, String(level))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{z\}/g, String(z));
}

function readUint64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Subtree chunk length exceeds Number.MAX_SAFE_INTEGER");
  }
  return Number(value);
}

/**
 * Split a `.subtree` file into its JSON chunk and internal binary chunk.
 *
 * @param {Uint8Array} bytes
 * @returns {{json: object, binary: Uint8Array|null}}
 */
export function parseSubtree(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < SUBTREE_HEADER_BYTES) {
    throw new Error("Subtree file is shorter than its 24-byte header");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (magic !== SUBTREE_MAGIC) {
    throw new Error(`Not a subtree file (magic "${magic}")`);
  }
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported subtree version ${version}`);

  const jsonByteLength = readUint64(view, 8);
  const binaryByteLength = readUint64(view, 16);
  const jsonStart = SUBTREE_HEADER_BYTES;
  const jsonEnd = jsonStart + jsonByteLength;
  if (jsonEnd > data.length) throw new Error("Subtree JSON chunk is truncated");

  const jsonText = new TextDecoder().decode(data.subarray(jsonStart, jsonEnd));
  const json = JSON.parse(jsonText.replace(/\0+$/, ""));

  let binary = null;
  if (binaryByteLength > 0) {
    const binaryEnd = jsonEnd + binaryByteLength;
    if (binaryEnd > data.length) throw new Error("Subtree binary chunk is truncated");
    binary = data.subarray(jsonEnd, binaryEnd);
  }
  return { json, binary };
}

/** Relative URIs of buffers the subtree stores outside its own binary chunk. */
export function externalSubtreeBufferUris(subtreeJson) {
  return (subtreeJson?.buffers ?? [])
    .map((buffer) => buffer?.uri)
    .filter((uri) => typeof uri === "string" && uri.length > 0);
}

function bufferViewBytes(subtreeJson, bufferViewIndex, buffers) {
  const bufferView = subtreeJson?.bufferViews?.[bufferViewIndex];
  if (!bufferView) throw new Error(`Subtree bufferView ${bufferViewIndex} is missing`);
  const buffer = buffers[bufferView.buffer];
  if (!buffer) throw new Error(`Subtree buffer ${bufferView.buffer} is unavailable`);
  const start = bufferView.byteOffset ?? 0;
  const end = start + bufferView.byteLength;
  if (end > buffer.length) throw new Error(`Subtree bufferView ${bufferViewIndex} is out of range`);
  return buffer.subarray(start, end);
}

/**
 * Wrap an availability object (`{constant}` or `{bitstream}`) as a predicate.
 * Bit `i` lives in byte `i >> 3` at bit position `i & 7`, per spec.
 */
function availabilityReader(availability, subtreeJson, buffers) {
  if (!availability) return () => false;
  if (availability.constant != null) {
    const value = availability.constant === 1;
    return () => value;
  }
  if (availability.bitstream == null) return () => false;
  const bits = bufferViewBytes(subtreeJson, availability.bitstream, buffers);
  return (index) => (((bits[index >> 3] ?? 0) >> (index & 7)) & 1) === 1;
}

function contentAvailabilityList(subtreeJson) {
  const value = subtreeJson?.contentAvailability;
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * Enumerate everything one subtree points at.
 *
 * @param {object} args
 * @param {object} args.subtreeJson parsed subtree JSON chunk
 * @param {Array<Uint8Array|null>} args.buffers buffers by index (internal chunk included)
 * @param {string} args.subdivisionScheme QUADTREE | OCTREE
 * @param {number} args.subtreeLevels levels covered by this subtree
 * @param {{level: number, x: number, y: number, z?: number}} args.root subtree root coordinate
 * @param {number} [args.maxNodes] node-visit cap for this subtree
 * @returns {{contentTiles: Array<{level:number,x:number,y:number,z:number,contentIndex:number}>,
 *            childSubtreeRoots: Array<{level:number,x:number,y:number,z:number}>}}
 */
export function enumerateSubtree({
  subtreeJson,
  buffers,
  subdivisionScheme,
  subtreeLevels,
  root,
  maxNodes = MAX_SUBTREE_NODES,
}) {
  const factor = branchingFactor(subdivisionScheme);
  const dims = dimensions(subdivisionScheme);
  const levels = Number.isFinite(subtreeLevels) ? Math.max(1, Math.floor(subtreeLevels)) : 1;
  const cap = Number.isFinite(maxNodes) && maxNodes > 0 ? Math.floor(maxNodes) : MAX_SUBTREE_NODES;
  // Tiles inside the subtree plus the child-subtree ring below it.
  const nodeCount = nodesInLevels(levels, factor) + Math.pow(factor, levels);
  if (!(nodeCount <= cap)) {
    throw new Error(
      `Subtree spans ${levels} ${factor === 8 ? "OCTREE" : "QUADTREE"} levels ` +
        `(${nodeCount} nodes), ` +
        `over the ${cap}-node cap`,
    );
  }
  const rootZ = root.z ?? 0;

  const contentReaders = contentAvailabilityList(subtreeJson).map((availability) =>
    availabilityReader(availability, subtreeJson, buffers),
  );
  const childReader = availabilityReader(subtreeJson?.childSubtreeAvailability, subtreeJson, buffers);

  const contentTiles = [];
  for (let relLevel = 0; relLevel < levels; relLevel++) {
    const levelOffset = nodesInLevels(relLevel, factor);
    const levelSize = Math.pow(factor, relLevel);
    for (let localIndex = 0; localIndex < levelSize; localIndex++) {
      const globalBit = levelOffset + localIndex;
      for (let c = 0; c < contentReaders.length; c++) {
        if (!contentReaders[c](globalBit)) continue;
        const local = mortonDecode(localIndex, dims, relLevel);
        const scale = Math.pow(2, relLevel);
        contentTiles.push({
          level: root.level + relLevel,
          x: root.x * scale + local.x,
          y: root.y * scale + local.y,
          z: rootZ * scale + local.z,
          contentIndex: c,
        });
      }
    }
  }

  const childSubtreeRoots = [];
  const childCount = Math.pow(factor, levels);
  const childScale = Math.pow(2, levels);
  for (let localIndex = 0; localIndex < childCount; localIndex++) {
    if (!childReader(localIndex)) continue;
    const local = mortonDecode(localIndex, dims, levels);
    childSubtreeRoots.push({
      level: root.level + levels,
      x: root.x * childScale + local.x,
      y: root.y * childScale + local.y,
      z: rootZ * childScale + local.z,
    });
  }

  return { contentTiles, childSubtreeRoots };
}
