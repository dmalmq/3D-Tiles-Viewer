import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildTilesetPackZip,
  countSkippedReferences,
  createPackSource,
  formatByteSize,
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

test("only unbundled references count as skipped", () => {
  const warnings = [
    { reason: "contentAbsolute", path: "tileset.json" },
    { reason: "missing", path: "a.glb" },
    { reason: "tilesetParseFailed", path: "sub/child.json" },
  ];
  assert.equal(countSkippedReferences(warnings), 2);
  assert.equal(countSkippedReferences([]), 0);
  assert.equal(countSkippedReferences(undefined), 0);
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
