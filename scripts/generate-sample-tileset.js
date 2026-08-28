#!/usr/bin/env node
/**
 * Generate a tiny synthetic indoor 3D Tiles 1.1 tileset (glTF GLB + tileset.json)
 * plus a read-only viewer session. Geometry is invented rooms/floors — not a
 * real building, station, or workplace.
 *
 *   node scripts/generate-sample-tileset.js
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "tiles", "sample-indoor");

const SAMPLE_BUILDING_NAME = "Sample House";
const SAMPLE_VENUE_ID = "sample-indoor";
const SAMPLE_VENUE_NAME = "Synthetic Indoor";
const TILESET_URL = "/tiles/sample-indoor/tileset.json";

// Arbitrary WGS84 placement for globe viewing — not a real site.
const LON_DEG = 139.7032;
const LAT_DEG = 35.6614;
const HEIGHT_M = 40;

const FLOOR_HEIGHT = 3.2;
const SLAB = 0.14;
const WALL = 0.14;
const DOOR_W = 1.05;
const DOOR_H = 2.15;

const COLORS = {
  wall: [0.86, 0.84, 0.80, 1],
  lobby: [0.93, 0.82, 0.62, 1],
  office: [0.62, 0.80, 0.90, 1],
  meeting: [0.70, 0.86, 0.70, 1],
  corridor: [0.78, 0.78, 0.76, 1],
  lounge: [0.90, 0.74, 0.82, 1],
  studio: [0.76, 0.74, 0.90, 1],
  storage: [0.82, 0.78, 0.70, 1],
  stair: [0.55, 0.55, 0.58, 1],
};

function addBox(mesh, x0, y0, z0, x1, y1, z1, color) {
  const faces = [
    { n: [0, 0, 1], q: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], q: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
    { n: [1, 0, 0], q: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], q: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], q: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { n: [0, -1, 0], q: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
  ];
  const base = mesh.positions.length / 3;
  for (const face of faces) {
    for (const [x, y, z] of face.q) {
      mesh.positions.push(x, y, z);
      mesh.normals.push(...face.n);
    }
  }
  for (let f = 0; f < 6; f++) {
    const i = base + f * 4;
    mesh.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  mesh.color = color;
}

function wallWithDoor(mesh, x0, y0, z0, x1, y1, z1, axis, doorCenter, color) {
  const lo = axis === "x" ? Math.min(x0, x1) : Math.min(z0, z1);
  const hi = axis === "x" ? Math.max(x0, x1) : Math.max(z0, z1);
  const d0 = Math.max(lo, doorCenter - DOOR_W / 2);
  const d1 = Math.min(hi, doorCenter + DOOR_W / 2);
  const yDoor = y0 + DOOR_H;
  if (d0 <= lo || d1 >= hi || yDoor >= y1) {
    addBox(mesh, x0, y0, z0, x1, y1, z1, color);
    return;
  }
  if (axis === "x") {
    addBox(mesh, lo, y0, z0, d0, y1, z1, color);
    addBox(mesh, d1, y0, z0, hi, y1, z1, color);
    addBox(mesh, d0, yDoor, z0, d1, y1, z1, color);
  } else {
    addBox(mesh, x0, y0, lo, x1, y1, d0, color);
    addBox(mesh, x0, y0, d1, x1, y1, hi, color);
    addBox(mesh, x0, yDoor, d0, x1, y1, d1, color);
  }
}

function buildGeometry() {
  const primitives = [];
  const mesh = (color) => {
    const m = { positions: [], normals: [], indices: [], color };
    primitives.push(m);
    return m;
  };

  const walls = mesh(COLORS.wall);
  const lobby = mesh(COLORS.lobby);
  const office = mesh(COLORS.office);
  const meeting = mesh(COLORS.meeting);
  const corridor = mesh(COLORS.corridor);
  const lounge = mesh(COLORS.lounge);
  const studio = mesh(COLORS.studio);
  const storage = mesh(COLORS.storage);
  const stair = mesh(COLORS.stair);

  // glTF Y-up: X = east, Y = height, Z = south-ish (becomes -north after 3D Tiles y-up→z-up).
  const y0 = 0;
  const y1 = FLOOR_HEIGHT;
  const y2 = FLOOR_HEIGHT * 2;

  // Floor 1 slabs
  addBox(lobby, 0, y0, 0, 8, y0 + SLAB, 7, COLORS.lobby);
  addBox(office, 8, y0, 0, 14, y0 + SLAB, 7, COLORS.office);
  addBox(meeting, 0, y0, 7, 8, y0 + SLAB, 12, COLORS.meeting);
  addBox(corridor, 8, y0, 7, 14, y0 + SLAB, 12, COLORS.corridor);

  const w1 = y0 + SLAB;
  const h1 = y1;
  // Exterior walls floor 1
  addBox(walls, 0, w1, 0, 14, h1, WALL, COLORS.wall);
  addBox(walls, 0, w1, 12 - WALL, 14, h1, 12, COLORS.wall);
  addBox(walls, 0, w1, 0, WALL, h1, 12, COLORS.wall);
  addBox(walls, 14 - WALL, w1, 0, 14, h1, 12, COLORS.wall);
  // Interior: lobby | office, lobby | meeting, office | corridor, meeting | corridor
  wallWithDoor(walls, 8 - WALL / 2, w1, 0, 8 + WALL / 2, h1, 7, "z", 3.5, COLORS.wall);
  wallWithDoor(walls, 0, w1, 7 - WALL / 2, 8, h1, 7 + WALL / 2, "x", 4, COLORS.wall);
  wallWithDoor(walls, 8 - WALL / 2, w1, 7, 8 + WALL / 2, h1, 12, "z", 9.5, COLORS.wall);
  wallWithDoor(walls, 8, w1, 7 - WALL / 2, 14, h1, 7 + WALL / 2, "x", 11, COLORS.wall);

  // Floor 2 slabs
  addBox(lounge, 0, y1, 0, 8, y1 + SLAB, 6, COLORS.lounge);
  addBox(storage, 8, y1, 0, 14, y1 + SLAB, 6, COLORS.storage);
  addBox(studio, 0, y1, 6, 14, y1 + SLAB, 12, COLORS.studio);

  const w2 = y1 + SLAB;
  const h2 = y2;
  addBox(walls, 0, w2, 0, 14, h2, WALL, COLORS.wall);
  addBox(walls, 0, w2, 12 - WALL, 14, h2, 12, COLORS.wall);
  addBox(walls, 0, w2, 0, WALL, h2, 12, COLORS.wall);
  addBox(walls, 14 - WALL, w2, 0, 14, h2, 12, COLORS.wall);
  wallWithDoor(walls, 8 - WALL / 2, w2, 0, 8 + WALL / 2, h2, 6, "z", 3, COLORS.wall);
  wallWithDoor(walls, 0, w2, 6 - WALL / 2, 14, h2, 6 + WALL / 2, "x", 5, COLORS.wall);

  // Stair in the floor-1 corridor: steps rise toward +Y while walking -Z.
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const zs = 11.2 - t0 * 3.4;
    const ze = 11.2 - t1 * 3.4;
    const ys = y0 + SLAB + t0 * FLOOR_HEIGHT;
    const ye = y0 + SLAB + t1 * FLOOR_HEIGHT + 0.04;
    addBox(stair, 10.2, ys, Math.min(zs, ze), 12.4, ye, Math.max(zs, ze), COLORS.stair);
  }

  return primitives;
}

function buildGlb(primitives) {
  const json = {
    asset: { version: "2.0", generator: "3D-Tiles-Viewer synthetic indoor sample" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: SAMPLE_BUILDING_NAME }],
    meshes: [{ primitives: [] }],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };

  const chunks = [];
  let offset = 0;
  const align4 = (n) => (n + 3) & ~3;

  for (const prim of primitives) {
    const pos = new Float32Array(prim.positions);
    const nrm = new Float32Array(prim.normals);
    const idx = new Uint16Array(prim.indices);
    const posPad = align4(pos.byteLength);
    const nrmPad = align4(nrm.byteLength);
    const idxPad = align4(idx.byteLength);

    const posView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: pos.byteLength, target: 34962 });
    chunks.push({ data: pos, pad: posPad - pos.byteLength });
    offset += posPad;

    const nrmView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: nrm.byteLength, target: 34962 });
    chunks.push({ data: nrm, pad: nrmPad - nrm.byteLength });
    offset += nrmPad;

    const idxView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: idx.byteLength, target: 34963 });
    chunks.push({ data: idx, pad: idxPad - idx.byteLength });
    offset += idxPad;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
      minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
      minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
    }

    const posAcc = json.accessors.length;
    json.accessors.push({
      bufferView: posView, componentType: 5126, count: pos.length / 3, type: "VEC3",
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    });
    const nrmAcc = json.accessors.length;
    json.accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    const idxAcc = json.accessors.length;
    json.accessors.push({ bufferView: idxView, componentType: 5123, count: idx.length, type: "SCALAR" });

    const mat = json.materials.length;
    json.materials.push({
      name: "room",
      pbrMetallicRoughness: {
        baseColorFactor: prim.color,
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      doubleSided: true,
    });
    json.meshes[0].primitives.push({
      attributes: { POSITION: posAcc, NORMAL: nrmAcc },
      indices: idxAcc,
      material: mat,
    });
  }

  json.buffers[0].byteLength = offset;

  const jsonText = JSON.stringify(json);
  const jsonPad = align4(jsonText.length) - jsonText.length;
  const jsonBytes = Buffer.concat([
    Buffer.from(jsonText, "utf8"),
    Buffer.alloc(jsonPad, 0x20),
  ]);

  const binParts = [];
  for (const c of chunks) {
    binParts.push(Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength));
    if (c.pad) binParts.push(Buffer.alloc(c.pad));
  }
  const binBytes = Buffer.concat(binParts);

  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // glTF
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // JSON

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBytes.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // BIN

  return {
    glb: Buffer.concat([header, jsonChunkHeader, jsonBytes, binChunkHeader, binBytes]),
    // glTF AABB (Y-up)
    min: json.accessors.filter((a) => a.min).reduce((acc, a) => ({
      x: Math.min(acc.x, a.min[0]), y: Math.min(acc.y, a.min[1]), z: Math.min(acc.z, a.min[2]),
    }), { x: Infinity, y: Infinity, z: Infinity }),
    max: json.accessors.filter((a) => a.max).reduce((acc, a) => ({
      x: Math.max(acc.x, a.max[0]), y: Math.max(acc.y, a.max[1]), z: Math.max(acc.z, a.max[2]),
    }), { x: -Infinity, y: -Infinity, z: -Infinity }),
  };
}

function lonLatHeightToEcef(lonDeg, latDeg, height) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return {
    x: (n + height) * cosLat * Math.cos(lon),
    y: (n + height) * cosLat * Math.sin(lon),
    z: (n * (1 - e2) + height) * sinLat,
    lon,
    lat,
  };
}

function eastNorthUpToFixed(lonDeg, latDeg, height) {
  const p = lonLatHeightToEcef(lonDeg, latDeg, height);
  const east = [-Math.sin(p.lon), Math.cos(p.lon), 0];
  const north = [
    -Math.sin(p.lat) * Math.cos(p.lon),
    -Math.sin(p.lat) * Math.sin(p.lon),
    Math.cos(p.lat),
  ];
  const up = [
    Math.cos(p.lat) * Math.cos(p.lon),
    Math.cos(p.lat) * Math.sin(p.lon),
    Math.sin(p.lat),
  ];
  // Column-major 4x4: east, north, up, translation
  return [
    east[0], east[1], east[2], 0,
    north[0], north[1], north[2], 0,
    up[0], up[1], up[2], 0,
    p.x, p.y, p.z, 1,
  ];
}

function yUpAabbToZUpBox(min, max) {
  // 3D Tiles 1.1 glTF y-up → z-up: (x, y, z) → (x, -z, y)
  const corners = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        corners.push([x, -z, y]);
      }
    }
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i]);
      hi[i] = Math.max(hi[i], c[i]);
    }
  }
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  const cz = (lo[2] + hi[2]) / 2;
  return [
    cx, cy, cz,
    (hi[0] - lo[0]) / 2, 0, 0,
    0, (hi[1] - lo[1]) / 2, 0,
    0, 0, (hi[2] - lo[2]) / 2,
  ];
}

function buildTileset(box) {
  return {
    asset: {
      version: "1.1",
      tilesetVersion: "synthetic-indoor-1",
      extras: {
        attribution: "Synthetic indoor sample generated in-repo. Not a real building.",
        license: "CC0-1.0",
      },
    },
    geometricError: 80,
    root: {
      boundingVolume: { box },
      geometricError: 0,
      refine: "ADD",
      transform: eastNorthUpToFixed(LON_DEG, LAT_DEG, HEIGHT_M),
      content: { uri: "content.glb" },
    },
  };
}

function buildSession() {
  return {
    version: 4,
    imagery: "carto-positron",
    terrain: "ellipsoid",
    plateauOverridesEnabled: true,
    modelLevels: [
      { floorNumber: 1, name: "1F", elevation: HEIGHT_M },
      { floorNumber: 2, name: "2F", elevation: HEIGHT_M + FLOOR_HEIGHT },
    ],
    activeModelLevelIndex: -1,
    venues: [
      {
        id: SAMPLE_VENUE_ID,
        name: SAMPLE_VENUE_NAME,
        description: "Public synthetic indoor sample. Made-up rooms and floors; not a real site.",
      },
    ],
    buildings: [
      {
        name: SAMPLE_BUILDING_NAME,
        sourceType: "url",
        sourceUrl: TILESET_URL,
        tilesetGroupId: 1,
        linkFilter: null,
        venueId: SAMPLE_VENUE_ID,
        heightOffset: 0,
        levelBaseElevation: HEIGHT_M,
        aliases: [],
        packageBuildingId: null,
        packageContentHash: null,
        activeLevelIndex: -1,
        levels: [
          { name: "1F", key: "1f", floor: 0, localPlaneZ: FLOOR_HEIGHT },
          { name: "2F", key: "2f", floor: FLOOR_HEIGHT, localPlaneZ: FLOOR_HEIGHT * 2 },
        ],
        sourceLevelGroups: [],
        shapefileLayers: [],
        networkDatasets: [],
        directoryHandleId: null,
        _directoryFolderName: null,
      },
    ],
    importedLayers: [],
    unassignedLayers: [],
  };
}

function buildLevels() {
  return {
    levels: [
      { name: "1F", key: "1f", floor: 0, minZMeters: 0, maxZMeters: FLOOR_HEIGHT },
      { name: "2F", key: "2f", floor: FLOOR_HEIGHT, minZMeters: FLOOR_HEIGHT, maxZMeters: FLOOR_HEIGHT * 2 },
    ],
  };
}

async function main() {
  const { glb, min, max } = buildGlb(buildGeometry());
  const tileset = buildTileset(yUpAabbToZUpBox(min, max));
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "content.glb"), glb);
  await fs.writeFile(path.join(OUT_DIR, "tileset.json"), `${JSON.stringify(tileset, null, 2)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "session.json"), `${JSON.stringify(buildSession(), null, 2)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "levels.json"), `${JSON.stringify(buildLevels(), null, 2)}\n`);
  console.log(`Wrote ${OUT_DIR} (${glb.length} byte GLB)`);
}

await main();
