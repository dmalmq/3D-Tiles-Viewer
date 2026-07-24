import test from "node:test";
import assert from "node:assert/strict";

import { stageGpkg } from "../src/gpkgStaging.js";

function fakeFs() {
  const dirs = new Set(["/"]);
  const files = new Map();
  return {
    dirs,
    files,
    analyzePath(path) {
      return { exists: dirs.has(path) || files.has(path) };
    },
    mkdir(path) {
      dirs.add(path);
    },
    writeFile(path, bytes) {
      files.set(path, bytes);
    },
  };
}

function mkDescriptor(name, bytes = [1, 2, 3]) {
  return {
    name,
    relativePath: name,
    file: { arrayBuffer: async () => Uint8Array.from(bytes).buffer },
  };
}

test("stages a single .gpkg file into the import root", async () => {
  const fs = fakeFs();
  const staged = await stageGpkg(fs, "/input/gdb-import-1", [mkDescriptor("Tower.gpkg")]);
  assert.equal(staged, "/input/gdb-import-1/Tower.gpkg");
  assert.ok(fs.files.has("/input/gdb-import-1/Tower.gpkg"));
});

test("sanitizes hostile file names", async () => {
  const fs = fakeFs();
  const staged = await stageGpkg(fs, "/input/gdb-import-2", [mkDescriptor('a:b*c?.gpkg')]);
  assert.ok(staged.startsWith("/input/gdb-import-2/"));
  assert.ok(!/[:*?]/.test(staged));
  assert.ok(staged.endsWith(".gpkg"));
});

test("rejects multiple files", async () => {
  const fs = fakeFs();
  await assert.rejects(
    stageGpkg(fs, "/input/x", [mkDescriptor("a.gpkg"), mkDescriptor("b.gpkg")]),
    /one \.gpkg/i
  );
});

test("rejects non-gpkg extensions", async () => {
  const fs = fakeFs();
  await assert.rejects(stageGpkg(fs, "/input/x", [mkDescriptor("a.zip")]), /\.gpkg/i);
});
