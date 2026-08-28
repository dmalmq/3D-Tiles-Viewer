import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildTilesetPack,
  createFileListSource,
  createUrlSource,
  normalizePackPath,
  parseGlbJson,
  parseLegacyTileContent,
  relativePackPath,
  splitComposite,
} from "../src/tilesetPack.js";
import {
  enumerateSubtree,
  MAX_SUBTREE_NODES,
  mortonDecode,
  parseSubtree,
  substituteTemplate,
} from "../src/implicitTiling.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_DIR = path.join(root, "public", "tiles", "sample-indoor");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── source helpers ──────────────────────────────────────────────────────────

/** In-memory source: { "path": Uint8Array | string | object }. */
function memorySource(files, label = "memory") {
  const map = new Map(
    Object.entries(files).map(([key, value]) => {
      if (value instanceof Uint8Array) return [key, value];
      if (typeof value === "string") return [key, encoder.encode(value)];
      return [key, encoder.encode(JSON.stringify(value))];
    }),
  );
  const reads = [];
  return {
    label,
    reads,
    async read(relPath) {
      reads.push(relPath);
      return map.get(relPath) ?? null;
    },
  };
}

/** Minimal File stand-in for createFileListSource (webkitdirectory shape). */
function fakeFile(relativePath, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : encoder.encode(bytes);
  return {
    name: relativePath.split("/").pop(),
    webkitRelativePath: relativePath,
    async arrayBuffer() {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
  };
}

function diskSource(dir, label) {
  return {
    label,
    async read(relPath) {
      try {
        return new Uint8Array(await fs.readFile(path.join(dir, relPath)));
      } catch {
        return null;
      }
    },
  };
}

function pathsOf(pack) {
  return pack.entries.map((e) => e.path).sort();
}

function entryJson(pack, entryPath) {
  const entry = pack.entries.find((e) => e.path === entryPath);
  assert.ok(entry, `missing pack entry ${entryPath}`);
  return JSON.parse(decoder.decode(entry.data));
}

function glb(json, binaryLength = 0) {
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = jsonBytes.length + jsonPadding;
  const total = 12 + 8 + jsonChunk + (binaryLength ? 8 + binaryLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonChunk);
  if (binaryLength) {
    view.setUint32(20 + jsonChunk, binaryLength, true);
    view.setUint32(24 + jsonChunk, 0x004e4942, true);
  }
  return out;
}

function b3dm(glbBytes) {
  const out = new Uint8Array(28 + glbBytes.length);
  const view = new DataView(out.buffer);
  out.set(encoder.encode("b3dm"), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, out.length, true);
  out.set(glbBytes, 28);
  return out;
}

function subtreeFile(json, binary = new Uint8Array(0)) {
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadding = (8 - (jsonBytes.length % 8)) % 8;
  const jsonLength = jsonBytes.length + jsonPadding;
  const out = new Uint8Array(24 + jsonLength + binary.length);
  const view = new DataView(out.buffer);
  out.set(encoder.encode("subt"), 0);
  view.setUint32(4, 1, true);
  view.setBigUint64(8, BigInt(jsonLength), true);
  view.setBigUint64(16, BigInt(binary.length), true);
  out.set(jsonBytes, 24);
  out.fill(0x20, 24 + jsonBytes.length, 24 + jsonLength);
  out.set(binary, 24 + jsonLength);
  return out;
}

// ── path primitives ─────────────────────────────────────────────────────────

test("pack paths normalise and reject escapes", () => {
  assert.equal(normalizePackPath("./content/./a.glb"), "content/a.glb");
  assert.equal(normalizePackPath("content/sub/../a.glb"), "content/a.glb");
  assert.equal(normalizePackPath("../outside.glb"), null);
  assert.equal(normalizePackPath("content/../../outside.glb"), null);
});

test("relativePackPath expresses siblings and parents", () => {
  assert.equal(relativePackPath("", "content/a.glb"), "content/a.glb");
  assert.equal(relativePackPath("content/", "content/a.glb"), "a.glb");
  assert.equal(relativePackPath("content/deep/", "content/a.glb"), "../a.glb");
  assert.equal(relativePackPath("a/b/", "c/d.glb"), "../../c/d.glb");
});

// ── the real synthetic sample ───────────────────────────────────────────────

test("packs the synthetic indoor sample from disk with relative paths only", async () => {
  const pack = await buildTilesetPack(diskSource(SAMPLE_DIR, "sample-indoor"));

  assert.deepEqual(pathsOf(pack), ["content.glb", "levels.json", "tileset.json"]);
  assert.deepEqual(pack.warnings, []);
  assert.equal(pack.label, "sample-indoor");
  assert.ok(pack.totalBytes > 0);

  // tileset.json is byte-identical: nothing needed rewriting.
  const onDisk = new Uint8Array(await fs.readFile(path.join(SAMPLE_DIR, "tileset.json")));
  const packed = pack.entries.find((e) => e.path === "tileset.json").data;
  assert.deepEqual([...packed], [...onDisk]);
  assert.equal(entryJson(pack, "tileset.json").root.content.uri, "content.glb");

  for (const entry of pack.entries) {
    assert.ok(!entry.path.startsWith("/"), `${entry.path} must be relative`);
    assert.ok(!entry.path.includes(".."), `${entry.path} must stay inside the pack`);
  }
});

test("a picked folder packs the same files as its URL twin", async () => {
  const names = ["tileset.json", "content.glb", "levels.json", "session.json", "README.md"];
  const files = await Promise.all(
    names.map(async (name) =>
      fakeFile(`sample-indoor/${name}`, new Uint8Array(await fs.readFile(path.join(SAMPLE_DIR, name)))),
    ),
  );

  const pack = await buildTilesetPack(createFileListSource(files));
  // session.json / README.md are not referenced by the tileset graph.
  assert.deepEqual(pathsOf(pack), ["content.glb", "levels.json", "tileset.json"]);
  assert.equal(pack.label, "sample-indoor");
});

test("createFileListSource rejects a folder without tileset.json", () => {
  assert.throws(
    () => createFileListSource([fakeFile("junk/readme.txt", "nope")]),
    /No tileset\.json/,
  );
});

// ── graph walking ───────────────────────────────────────────────────────────

test("walks external tilesets, glTF buffers and images", async () => {
  const source = memorySource({
    "tileset.json": {
      asset: { version: "1.1" },
      root: { content: { uri: "sub/child.json" }, children: [{ content: { uri: "models/a.gltf" } }] },
    },
    "sub/child.json": {
      asset: { version: "1.1" },
      root: { content: { uri: "../models/b.glb" } },
    },
    "models/a.gltf": {
      asset: { version: "2.0" },
      buffers: [{ uri: "a.bin", byteLength: 4 }, { uri: "data:application/octet-stream;base64,AAAA" }],
      images: [{ uri: "textures/wall.png" }],
    },
    "models/a.bin": new Uint8Array([1, 2, 3, 4]),
    "models/textures/wall.png": new Uint8Array([9, 9]),
    "models/b.glb": glb({ asset: { version: "2.0" }, buffers: [{ uri: "b.bin", byteLength: 2 }] }),
    "models/b.bin": new Uint8Array([5, 6]),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), [
    "models/a.bin",
    "models/a.gltf",
    "models/b.bin",
    "models/b.glb",
    "models/textures/wall.png",
    "sub/child.json",
    "tileset.json",
  ]);
  assert.deepEqual(pack.warnings, []);
  // The child tileset keeps its own relative reference to ../models/b.glb.
  assert.equal(entryJson(pack, "sub/child.json").root.content.uri, "../models/b.glb");
});

test("query strings are stripped from packed paths and rewritten in place", async () => {
  const source = memorySource({
    "tileset.json": { root: { content: { uri: "./content.glb?v=7" } } },
    "content.glb": glb({ asset: { version: "2.0" } }),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["content.glb", "tileset.json"]);
  assert.equal(entryJson(pack, "tileset.json").root.content.uri, "content.glb");
});

test("absolute and escaping URIs are reported instead of scraped", async () => {
  const source = memorySource({
    "tileset.json": {
      root: {
        content: { uri: "https://tiles.example.com/remote.glb" },
        children: [{ content: { uri: "../outside/leak.glb" } }, { content: { url: "/absolute/x.glb" } }],
      },
    },
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["tileset.json"]);
  assert.deepEqual(
    pack.warnings.map((w) => w.reason).sort(),
    ["contentAbsolute", "contentAbsolute", "contentOutsidePack"],
  );
  // Untouched: an already-absolute source URI is left exactly as authored.
  assert.equal(
    entryJson(pack, "tileset.json").root.content.uri,
    "https://tiles.example.com/remote.glb",
  );
});

test("missing files are warned about, not fatal", async () => {
  const source = memorySource({
    "tileset.json": { root: { content: { uri: "gone.glb" } } },
  });
  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["tileset.json"]);
  assert.deepEqual(pack.warnings, [{ reason: "missing", path: "gone.glb", detail: "tileset.json" }]);
});

test("b3dm and cmpt payloads contribute their external glTF resources", async () => {
  const inner = b3dm(glb({ asset: { version: "2.0" }, images: [{ uri: "tex/roof.jpg" }] }));
  const composite = new Uint8Array(16 + inner.length);
  const view = new DataView(composite.buffer);
  composite.set(encoder.encode("cmpt"), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, composite.length, true);
  view.setUint32(12, 1, true);
  composite.set(inner, 16);

  const source = memorySource({
    "tileset.json": {
      root: { content: { uri: "tiles/a.b3dm" }, children: [{ content: { uri: "tiles/b.cmpt" } }] },
    },
    "tiles/a.b3dm": b3dm(glb({ asset: { version: "2.0" }, buffers: [{ uri: "a.bin", byteLength: 1 }] })),
    "tiles/a.bin": new Uint8Array([1]),
    "tiles/b.cmpt": composite,
    "tiles/tex/roof.jpg": new Uint8Array([2, 2]),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), [
    "tiles/a.b3dm",
    "tiles/a.bin",
    "tiles/b.cmpt",
    "tiles/tex/roof.jpg",
    "tileset.json",
  ]);
});

test("i3dm with an external glTF URI queues that model", () => {
  const uri = encoder.encode("../models/tree.glb");
  const bytes = new Uint8Array(32 + uri.length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("i3dm"), 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(28, 0, true); // gltfFormat 0 = URI body
  bytes.set(uri, 32);

  assert.deepEqual(parseLegacyTileContent("i3dm", bytes), {
    kind: "uri",
    uri: "../models/tree.glb",
  });
});

test("glb and composite readers reject malformed input without throwing", () => {
  assert.equal(parseGlbJson(new Uint8Array(8)), null);
  assert.deepEqual(splitComposite(new Uint8Array(4)), []);
});

// ── implicit tiling ─────────────────────────────────────────────────────────

test("morton decoding follows the x-first bit interleave", () => {
  assert.deepEqual(mortonDecode(0, 2, 1), { x: 0, y: 0, z: 0 });
  assert.deepEqual(mortonDecode(1, 2, 1), { x: 1, y: 0, z: 0 });
  assert.deepEqual(mortonDecode(2, 2, 1), { x: 0, y: 1, z: 0 });
  assert.deepEqual(mortonDecode(3, 2, 1), { x: 1, y: 1, z: 0 });
  assert.deepEqual(mortonDecode(7, 3, 1), { x: 1, y: 1, z: 1 });
});

test("template substitution fills level/x/y/z", () => {
  assert.equal(
    substituteTemplate("content/{level}/{x}/{y}.glb", { level: 2, x: 3, y: 1 }),
    "content/2/3/1.glb",
  );
});

test("parseSubtree splits the header, JSON and binary chunks", () => {
  const bytes = subtreeFile({ tileAvailability: { constant: 1 } }, new Uint8Array([7, 7]));
  const parsed = parseSubtree(bytes);
  assert.deepEqual(parsed.json, { tileAvailability: { constant: 1 } });
  assert.deepEqual([...parsed.binary], [7, 7]);
  assert.throws(() => parseSubtree(new Uint8Array(24)), /Not a subtree file/);
});

test("implicit quadtree packs available content and child subtrees", async () => {
  // Availability bits (level 0 then level 1, morton order): root, (0,0), (0,1).
  const availability = new Uint8Array([0b00001011, 0b00000001, 0b00000000]);
  const rootSubtree = subtreeFile(
    {
      buffers: [{ byteLength: availability.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 1 },
        { buffer: 0, byteOffset: 1, byteLength: 2 },
      ],
      tileAvailability: { constant: 1 },
      contentAvailability: [{ bitstream: 0 }],
      childSubtreeAvailability: { bitstream: 1 },
    },
    availability,
  );
  const leafSubtree = subtreeFile({
    tileAvailability: { constant: 1 },
    contentAvailability: [{ constant: 0 }],
    childSubtreeAvailability: { constant: 0 },
  });

  const source = memorySource({
    "tileset.json": {
      asset: { version: "1.1" },
      root: {
        content: { uri: "content/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 2,
          availableLevels: 4,
          subtrees: { uri: "subtrees/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "subtrees/0/0/0.subtree": rootSubtree,
    "subtrees/2/0/0.subtree": leafSubtree,
    "content/0/0/0.glb": glb({ asset: { version: "2.0" } }),
    "content/1/0/0.glb": glb({ asset: { version: "2.0" } }),
    "content/1/0/1.glb": glb({ asset: { version: "2.0" } }),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), [
    "content/0/0/0.glb",
    "content/1/0/0.glb",
    "content/1/0/1.glb",
    "subtrees/0/0/0.subtree",
    "subtrees/2/0/0.subtree",
    "tileset.json",
  ]);
  assert.deepEqual(pack.warnings, []);
  // Templates are untouched: the packed layout keeps the same relative shape.
  assert.equal(
    entryJson(pack, "tileset.json").root.content.uri,
    "content/{level}/{x}/{y}.glb",
  );
  // Unavailable tiles are never requested.
  assert.ok(!source.reads.includes("content/1/1/0.glb"));
});

test("implicit subtrees pull in their external availability buffers", async () => {
  const availability = new Uint8Array([0b00000001, 0b00000000, 0b00000000]);
  const rootSubtree = subtreeFile({
    buffers: [{ uri: "availability.bin", byteLength: availability.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 1 },
      { buffer: 0, byteOffset: 1, byteLength: 2 },
    ],
    tileAvailability: { constant: 1 },
    contentAvailability: [{ bitstream: 0 }],
    childSubtreeAvailability: { bitstream: 1 },
  });

  const source = memorySource({
    "tileset.json": {
      root: {
        contents: [{ uri: "content/{level}/{x}/{y}.glb" }],
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 2,
          subtrees: { uri: "subtrees/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "subtrees/0/0/0.subtree": rootSubtree,
    "subtrees/0/0/availability.bin": availability,
    "content/0/0/0.glb": glb({ asset: { version: "2.0" } }),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), [
    "content/0/0/0.glb",
    "subtrees/0/0/0.subtree",
    "subtrees/0/0/availability.bin",
    "tileset.json",
  ]);
});

test("external metadata schema files are packed", async () => {
  const source = memorySource({
    "tileset.json": { schemaUri: "meta/schema.json", root: { content: { uri: "a.glb" } } },
    "meta/schema.json": { id: "schema" },
    "a.glb": glb({ asset: { version: "2.0" } }),
  });
  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["a.glb", "meta/schema.json", "tileset.json"]);
});

// ── URL source ──────────────────────────────────────────────────────────────

test("URL source fetches same-origin siblings and refuses to leave the folder", async () => {
  const served = {
    "http://viewer.test/tiles/sample/tileset.json": '{"root":{"content":{"uri":"content.glb"}}}',
    "http://viewer.test/tiles/sample/content.glb": "GLB",
  };
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const body = served[url];
    if (body === undefined) return { ok: false, status: 404 };
    return { ok: true, async arrayBuffer() { return encoder.encode(body).buffer; } };
  };

  const source = createUrlSource("/tiles/sample/tileset.json", {
    fetchImpl,
    origin: "http://viewer.test/viewer.html",
  });
  assert.equal(source.label, "sample");
  assert.ok(await source.read("content.glb"));
  assert.equal(await source.read("../other/secret.glb"), null);
  assert.equal(await source.read("http://evil.test/tiles.glb"), null);
  assert.ok(!requested.some((url) => url.includes("evil.test") || url.includes("secret")));

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["content.glb", "tileset.json"]);
});

test("a source with no tileset.json fails loudly", async () => {
  await assert.rejects(
    () => buildTilesetPack(memorySource({ "levels.json": "[]" })),
    /No tileset\.json/,
  );
});

test("maxEntries stops runaway packs", async () => {
  const source = memorySource({
    "tileset.json": {
      root: { children: [{ content: { uri: "a.glb" } }, { content: { uri: "b.glb" } }] },
    },
    "a.glb": glb({ asset: { version: "2.0" } }),
    "b.glb": glb({ asset: { version: "2.0" } }),
  });
  await assert.rejects(() => buildTilesetPack(source, { maxEntries: 2 }), /exceeds 2 files/);
});

// ── implicit templates and subtree size limits ──────────────────────────────

test("absolute implicit templates are skipped, not forged into relative paths", async () => {
  const source = memorySource({
    "tileset.json": {
      root: {
        content: { uri: "https://cdn.test/tiles/content/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 2,
          subtrees: { uri: "https://cdn.test/tiles/subtrees/{level}/{x}/{y}.subtree" },
        },
      },
    },
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["tileset.json"]);
  assert.deepEqual(
    pack.warnings.map((w) => w.reason).sort(),
    ["contentAbsolute", "subtreeAbsolute"],
  );
  // The substituted template must never become a pack path like "https:/cdn.test/…".
  assert.ok(!source.reads.some((read) => /cdn\.test|https/.test(read)));
});

test("an absolute implicit content template warns once, not per available tile", async () => {
  const source = memorySource({
    "tileset.json": {
      root: {
        content: { uri: "https://cdn.test/c/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 2,
          subtrees: { uri: "subtrees/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "subtrees/0/0/0.subtree": subtreeFile({
      tileAvailability: { constant: 1 },
      contentAvailability: [{ constant: 1 }],
      childSubtreeAvailability: { constant: 0 },
    }),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["subtrees/0/0/0.subtree", "tileset.json"]);
  assert.deepEqual(pack.warnings, [
    {
      reason: "contentAbsolute",
      path: "tileset.json",
      detail: "https://cdn.test/c/{level}/{x}/{y}.glb",
    },
  ]);
  assert.ok(!source.reads.some((read) => /cdn\.test|https/.test(read)));
});

test("implicit templates that climb out of the pack are still reported per tile", async () => {
  const source = memorySource({
    "sub/tileset.json": {
      root: {
        content: { uri: "../../escape/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 1,
          subtrees: { uri: "s/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "tileset.json": { root: { content: { uri: "sub/tileset.json" } } },
    "sub/s/0/0/0.subtree": subtreeFile({
      tileAvailability: { constant: 1 },
      contentAvailability: [{ constant: 1 }],
      childSubtreeAvailability: { constant: 0 },
    }),
  });

  const pack = await buildTilesetPack(source);
  assert.deepEqual(pathsOf(pack), ["sub/s/0/0/0.subtree", "sub/tileset.json", "tileset.json"]);
  assert.deepEqual(pack.warnings, [
    { reason: "contentOutsidePack", path: "sub/tileset.json", detail: "../../escape/0/0/0.glb" },
  ]);
});

test("enumerateSubtree caps how many nodes one subtree may describe", () => {
  const subtreeJson = {
    tileAvailability: { constant: 1 },
    contentAvailability: [{ constant: 1 }],
    childSubtreeAvailability: { constant: 0 },
  };
  const args = {
    subtreeJson,
    buffers: [],
    subdivisionScheme: "OCTREE",
    root: { level: 0, x: 0, y: 0, z: 0 },
  };

  assert.equal(MAX_SUBTREE_NODES, 1_000_000);
  assert.throws(
    () => enumerateSubtree({ ...args, subtreeLevels: 40 }),
    /Subtree spans 40 OCTREE levels .* over the 1000000-node cap/,
  );
  assert.throws(
    () => enumerateSubtree({ ...args, subtreeLevels: 3, maxNodes: 10 }),
    /over the 10-node cap/,
  );
  // A sane subtree is unaffected: 1 + 4 + 16 tiles, 64 child-subtree slots.
  const expanded = enumerateSubtree({
    ...args,
    subdivisionScheme: "QUADTREE",
    subtreeLevels: 3,
  });
  assert.equal(expanded.contentTiles.length, 21);
  assert.equal(expanded.childSubtreeRoots.length, 0);
});

test("a subtree with absurd subtreeLevels fails with a warning instead of hanging", async () => {
  const source = memorySource({
    "tileset.json": {
      root: {
        content: { uri: "c/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "OCTREE",
          subtreeLevels: 40,
          availableLevels: 40,
          subtrees: { uri: "s/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "s/0/0/0.subtree": subtreeFile({
      tileAvailability: { constant: 1 },
      contentAvailability: [{ constant: 1 }],
      childSubtreeAvailability: { constant: 1 },
    }),
  });

  const startedAt = Date.now();
  const pack = await buildTilesetPack(source);
  assert.ok(Date.now() - startedAt < 5_000, "expansion must fail fast, not grind");
  assert.deepEqual(pathsOf(pack), ["s/0/0/0.subtree", "tileset.json"]);
  assert.deepEqual(
    pack.warnings.map((w) => w.reason),
    ["subtreeExpandFailed"],
  );
  assert.match(pack.warnings[0].detail, /node cap/);
  assert.ok(!source.reads.some((read) => read.startsWith("c/")));
});

test("maxSubtreeNodes tightens the cap for a single pack", async () => {
  const source = memorySource({
    "tileset.json": {
      root: {
        content: { uri: "c/{level}/{x}/{y}.glb" },
        implicitTiling: {
          subdivisionScheme: "QUADTREE",
          subtreeLevels: 4,
          subtrees: { uri: "s/{level}/{x}/{y}.subtree" },
        },
      },
    },
    "s/0/0/0.subtree": subtreeFile({
      tileAvailability: { constant: 1 },
      contentAvailability: [{ constant: 1 }],
      childSubtreeAvailability: { constant: 0 },
    }),
    "c/0/0/0.glb": glb({ asset: { version: "2.0" } }),
  });

  const pack = await buildTilesetPack(source, { maxSubtreeNodes: 8 });
  assert.deepEqual(pathsOf(pack), ["s/0/0/0.subtree", "tileset.json"]);
  assert.deepEqual(
    pack.warnings.map((w) => w.reason),
    ["subtreeExpandFailed"],
  );
});
