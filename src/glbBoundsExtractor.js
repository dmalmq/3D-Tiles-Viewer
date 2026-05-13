/**
 * Pull a GLB ArrayBuffer for a loaded Cesium3DTileset and compute per-link
 * axis-aligned bounding boxes from its EXT_structural_metadata + EXT_mesh_features
 * extensions, without iterating any vertex data.
 *
 * Optimisation premise (verified for the user's RevitGeoSuite output):
 *   • Each glTF primitive has a constant `_FEATURE_ID_0` for all its vertices
 *     (one element per primitive, possibly split across primitives by material).
 *   • POSITION accessor min/max is always populated.
 *
 * So per primitive we only read the first uint32 of the feature-ID buffer and
 * the POSITION accessor's min/max — no vertex walks.
 */

const TEXT_DECODER = new TextDecoder("utf-8");

/**
 * Locate the GLB ArrayBuffer for a tileset.
 * - File-loaded tilesets store blob URLs on `tileset._blobCleanup.blobUrls`.
 * - URL-loaded tilesets need a re-fetch of the tileset.json to find content.uri.
 */
export async function loadTilesetGlbBuffer(tileset, sourceUrl) {
  // File-loaded path
  const blobUrls = tileset?._blobCleanup?.blobUrls;
  if (blobUrls && blobUrls.size) {
    for (const [name, url] of blobUrls) {
      if (name.toLowerCase().endsWith(".glb")) {
        const r = await fetch(url);
        return r.arrayBuffer();
      }
    }
  }
  // URL-loaded path
  if (sourceUrl) {
    const tjResp = await fetch(sourceUrl);
    if (!tjResp.ok) return null;
    const tj = await tjResp.json();
    const contentUri = tj?.root?.content?.uri ?? tj?.root?.content?.url;
    if (!contentUri) return null;
    const base = sourceUrl.replace(/[^/]*$/, "");
    const glbUrl = new URL(contentUri, base).toString();
    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return null;
    return glbResp.arrayBuffer();
  }
  return null;
}

function parseGlbChunks(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  if (magic !== "glTF") throw new Error("Not a GLB binary");
  const c0Len = view.getUint32(12, true);
  const jsonBytes = new Uint8Array(arrayBuffer, 20, c0Len);
  const json = JSON.parse(TEXT_DECODER.decode(jsonBytes));
  const c1Start = 20 + c0Len;
  const c1Len = view.getUint32(c1Start, true);
  const binStart = c1Start + 8;
  return { json, view, binStart, binEnd: binStart + c1Len };
}

function readStringPropertyTable(view, binStart, json, propertyTable, propertyName) {
  const prop = propertyTable.properties?.[propertyName];
  if (!prop) return null;
  const valuesBV = json.bufferViews[prop.values];
  const offsetsBV = json.bufferViews[prop.stringOffsets];
  if (!valuesBV || !offsetsBV) return null;
  const valStart = binStart + valuesBV.byteOffset;
  const offStart = binStart + offsetsBV.byteOffset;
  const out = new Array(propertyTable.count);
  for (let i = 0; i < propertyTable.count; i++) {
    const s = view.getUint32(offStart + i * 4, true);
    const e = view.getUint32(offStart + (i + 1) * 4, true);
    out[i] = TEXT_DECODER.decode(
      new Uint8Array(view.buffer, valStart + s, e - s)
    );
  }
  return out;
}

function mergeAabb(target, srcMin, srcMax) {
  for (let i = 0; i < 3; i++) {
    if (srcMin[i] < target.min[i]) target.min[i] = srcMin[i];
    if (srcMax[i] > target.max[i]) target.max[i] = srcMax[i];
  }
}

/**
 * Compute per-link AABBs in GLB-local coordinates.
 * Returns Map<linkValue, { min:[x,y,z], max:[x,y,z] }>.
 */
export function computePerLinkLocalAabbs(arrayBuffer, options = {}) {
  const groupBy = options.groupBy ?? "sourceLinkName";
  const { json, view, binStart } = parseGlbChunks(arrayBuffer);

  const sm = json.extensions?.EXT_structural_metadata;
  if (!sm || !sm.propertyTables?.length) return new Map();
  const pt = sm.propertyTables[0];

  const featureLinkName = readStringPropertyTable(view, binStart, json, pt, groupBy);
  if (!featureLinkName) return new Map();

  const result = new Map();

  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const fidIdx = prim.attributes?._FEATURE_ID_0;
      const posIdx = prim.attributes?.POSITION;
      if (fidIdx == null || posIdx == null) continue;
      const fidAcc = json.accessors[fidIdx];
      const posAcc = json.accessors[posIdx];
      if (!fidAcc || !posAcc || !posAcc.min || !posAcc.max) continue;
      const fidView = json.bufferViews[fidAcc.bufferView];
      if (!fidView) continue;

      const off = binStart + fidView.byteOffset + (fidAcc.byteOffset || 0);
      // _FEATURE_ID_0 is uint32 (componentType 5125) per the writer
      let featureId;
      if (fidAcc.componentType === 5125) {
        featureId = view.getUint32(off, true);
      } else if (fidAcc.componentType === 5123) {
        featureId = view.getUint16(off, true);
      } else if (fidAcc.componentType === 5121) {
        featureId = view.getUint8(off);
      } else {
        continue; // unsupported
      }

      const linkValue = featureLinkName[featureId];
      if (linkValue == null) continue;

      let entry = result.get(linkValue);
      if (!entry) {
        entry = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        };
        result.set(linkValue, entry);
      }
      mergeAabb(entry, posAcc.min, posAcc.max);
    }
  }

  return result;
}

/** Union all per-link AABBs into one AABB. */
export function unionAabbs(aabbs) {
  const merged = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let any = false;
  for (const aabb of aabbs.values()) {
    mergeAabb(merged, aabb.min, aabb.max);
    any = true;
  }
  return any ? merged : null;
}
