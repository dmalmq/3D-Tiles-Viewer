import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildTilesetPackZip,
  countSkippedReferences,
  createPackSource,
  downloadPackZip,
  formatByteSize,
  OBJECT_URL_TTL_MS,
  packFileName,
} from "../src/tilesetExport.js";
import { zipEntryMap } from "./zipRead.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_DIR = path.join(root, "public", "tiles", "sample-indoor");
const SAMPLE_FILES = ["tileset.json", "content.glb", "levels.json", "session.json"];

const decoder = new TextDecoder();

async function sampleFileList() {
  return Promise.all(
    SAMPLE_FILES.map(async (name) => {
      const data = new Uint8Array(await fs.readFile(path.join(SAMPLE_DIR, name)));
      return {
        name,
        webkitRelativePath: `sample-indoor/${name}`,
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
      };
    }),
  );
}

test("pack file names are slugged and dated", () => {
  const date = new Date("2026-08-28T10:00:00Z");
  assert.equal(packFileName("Sample House", date), "sample-house-offline-2026-08-28.zip");
  assert.equal(packFileName("sample-indoor", date), "sample-indoor-offline-2026-08-28.zip");
  assert.equal(packFileName("", date), "tileset-offline-2026-08-28.zip");
  assert.equal(packFileName("東京/駅", date), "tileset-offline-2026-08-28.zip");
});

test("byte sizes are human readable", () => {
  assert.equal(formatByteSize(0), "0 B");
  assert.equal(formatByteSize(512), "512 B");
  assert.equal(formatByteSize(2048), "2.0 KB");
  assert.equal(formatByteSize(5 * 1024 * 1024), "5.0 MB");
});

test("unbundled references and unwalked files both count as skipped", () => {
  const warnings = [
    { reason: "contentAbsolute", path: "tileset.json" },
    { reason: "missing", path: "a.glb" },
    // A file that failed to parse was packed but never walked, so anything it
    // referenced is absent: the export is partial, not done.
    { reason: "tilesetParseFailed", path: "sub/child.json" },
    { reason: "gltfParseFailed", path: "a.gltf" },
    { reason: "glbParseFailed", path: "a.glb" },
    { reason: "subtreeParseFailed", path: "a.subtree" },
    { reason: "subtreeExpandFailed", path: "a.subtree" },
    // Unknown reasons are never counted: the filter is a whitelist.
    { reason: "someFutureNote", path: "tileset.json" },
  ];
  assert.equal(countSkippedReferences(warnings), 7);
  assert.equal(countSkippedReferences([]), 0);
  assert.equal(countSkippedReferences(undefined), 0);
});

test("a tileset whose nested content cannot be parsed exports as partial", async () => {
  const encoder = new TextEncoder();
  const files = new Map([
    [
      "tileset.json",
      encoder.encode(JSON.stringify({ root: { content: { uri: "child/tileset.json" } } })),
    ],
    ["child/tileset.json", encoder.encode("{ not json at all")],
  ]);
  const source = {
    label: "broken",
    async read(relPath) {
      return files.get(relPath) ?? null;
    },
  };

  const pack = await buildTilesetPackZip(source, { compress: false });
  assert.equal(pack.fileCount, 2);
  assert.ok(pack.warnings.some((w) => w.reason === "tilesetParseFailed"));
  // Non-zero means the viewer reports viewer.export.partial rather than .done.
  assert.equal(pack.skippedCount, 1);
});

// ── download plumbing ───────────────────────────────────────────────────────

/** Minimal DOM/URL stand-in for downloadPackZip. */
function stubDownloadDom() {
  const objectUrl = "blob:viewer.test/pack";
  const revoked = [];
  const clicks = [];
  const priorDocument = globalThis.document;
  const priorCreate = URL.createObjectURL;
  const priorRevoke = URL.revokeObjectURL;

  URL.createObjectURL = () => objectUrl;
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({
      click() {
        // Record how many revokes had happened by click time.
        clicks.push(revoked.length);
      },
    }),
  };

  return {
    objectUrl,
    revoked,
    clicks,
    restore() {
      URL.createObjectURL = priorCreate;
      URL.revokeObjectURL = priorRevoke;
      if (priorDocument === undefined) delete globalThis.document;
      else globalThis.document = priorDocument;
    },
  };
}

test("the download object URL survives well past the click", async () => {
  const dom = stubDownloadDom();
  try {
    const result = downloadPackZip(new Uint8Array([1, 2, 3]), "pack.zip");
    assert.equal(result.fileName, "pack.zip");
    assert.equal(result.byteLength, 3);
    assert.equal(result.objectUrl, dom.objectUrl);
    assert.equal(result.revokeAfterMs, OBJECT_URL_TTL_MS);
    assert.ok(OBJECT_URL_TTL_MS >= 5_000, "grace period must be seconds, not a tick");
    assert.deepEqual(dom.clicks, [0]);

    // The old code revoked on a 0ms timer, i.e. during this very macrotask turn.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(dom.revoked, []);

    result.revoke();
    assert.deepEqual(dom.revoked, [dom.objectUrl]);
    result.revoke();
    assert.deepEqual(dom.revoked, [dom.objectUrl], "revoking twice releases once");
  } finally {
    dom.restore();
  }
});

test("the download object URL is released once its grace period elapses", async () => {
  const dom = stubDownloadDom();
  try {
    const result = downloadPackZip(new Uint8Array([9]), "pack.zip", { revokeAfterMs: 5 });
    assert.equal(result.revokeAfterMs, 5);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(dom.revoked, [dom.objectUrl]);
    result.revoke();
    assert.deepEqual(dom.revoked, [dom.objectUrl]);
  } finally {
    dom.restore();
  }
});

test("createPackSource prefers picked local files over a URL", async () => {
  const files = await sampleFileList();
  const fromFiles = createPackSource({ files, tilesetUrl: "/tiles/sample-indoor/tileset.json" });
  assert.equal(fromFiles.label, "sample-indoor");
  assert.ok(await fromFiles.read("content.glb"));

  const fromUrl = createPackSource(
    { tilesetUrl: "/tiles/sample-indoor/tileset.json" },
    { fetchImpl: async () => ({ ok: false }), origin: "http://viewer.test/viewer.html" },
  );
  assert.equal(fromUrl.label, "sample-indoor");

  assert.equal(createPackSource({ files: [], tilesetUrl: null }), null);
  assert.equal(createPackSource(null), null);
});

test("the picked sample folder exports as a self-contained zip", async () => {
  const files = await sampleFileList();
  const pack = await buildTilesetPackZip(createPackSource({ files }), {
    date: new Date("2026-08-28T10:00:00Z"),
  });

  assert.equal(pack.fileName, "sample-indoor-offline-2026-08-28.zip");
  assert.equal(pack.fileCount, 3);
  assert.equal(pack.skippedCount, 0);

  const entries = zipEntryMap(pack.zipBytes);
  assert.deepEqual([...entries.keys()].sort(), ["content.glb", "levels.json", "tileset.json"]);

  // tileset.json survives the zip round-trip and stays folder-relative.
  const tilesetJson = JSON.parse(decoder.decode(entries.get("tileset.json").data));
  assert.equal(tilesetJson.root.content.uri, "content.glb");

  // content.glb is byte-identical to the file on disk.
  const onDisk = new Uint8Array(await fs.readFile(path.join(SAMPLE_DIR, "content.glb")));
  assert.deepEqual([...entries.get("content.glb").data], [...onDisk]);
});

test("a URL-loaded tileset exports the same pack over fetch", async () => {
  const served = new Map();
  for (const name of ["tileset.json", "content.glb", "levels.json"]) {
    served.set(
      `http://viewer.test/tiles/sample-indoor/${name}`,
      new Uint8Array(await fs.readFile(path.join(SAMPLE_DIR, name))),
    );
  }
  const fetchImpl = async (url) => {
    const body = served.get(url);
    if (!body) return { ok: false, status: 404 };
    return {
      ok: true,
      async arrayBuffer() {
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      },
    };
  };

  const source = createPackSource(
    { tilesetUrl: "/tiles/sample-indoor/tileset.json" },
    { fetchImpl, origin: "http://viewer.test/viewer.html" },
  );
  const pack = await buildTilesetPackZip(source);

  assert.deepEqual(
    [...zipEntryMap(pack.zipBytes).keys()].sort(),
    ["content.glb", "levels.json", "tileset.json"],
  );
  assert.equal(pack.skippedCount, 0);
});
