import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  sanitizePackageRelativePath,
  sanitizePackageId,
  resolveUploadRelativePath,
  storePackage,
  prunePackagesForBuilding,
} from "../server/packageStore.js";

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pkg-store-test-"));
}

test("sanitizePackageRelativePath accepts normal package paths", () => {
  assert.equal(sanitizePackageRelativePath("cesium-package.json"), "cesium-package.json");
  assert.equal(sanitizePackageRelativePath("tiles/tileset.json"), "tiles/tileset.json");
  assert.equal(sanitizePackageRelativePath("gis\\tower.gpkg"), "gis/tower.gpkg");
});

test("sanitizePackageRelativePath rejects traversal and absolute paths", () => {
  assert.equal(sanitizePackageRelativePath("../evil.txt"), null);
  assert.equal(sanitizePackageRelativePath("tiles/../../evil.txt"), null);
  assert.equal(sanitizePackageRelativePath("/etc/passwd"), null);
  assert.equal(sanitizePackageRelativePath("C:\\windows\\evil"), null);
  assert.equal(sanitizePackageRelativePath(""), null);
  assert.equal(sanitizePackageRelativePath("tiles//"), null);
});

test("sanitizePackageId allows uuid-ish ids and rejects everything else", () => {
  assert.equal(sanitizePackageId("0f8fad5b-d9cb-469f-a165-70867728950e"), "0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.equal(sanitizePackageId("pkg_01"), "pkg_01");
  assert.equal(sanitizePackageId("../x"), null);
  assert.equal(sanitizePackageId("a b"), null);
  assert.equal(sanitizePackageId(""), null);
});

test("resolveUploadRelativePath prefers a path-bearing fieldname over a basenamed originalname", () => {
  // .NET's MultipartFormDataContent sends the path via filename* which multer
  // strips to a basename — the field NAME is the reliable path carrier.
  assert.equal(
    resolveUploadRelativePath({ fieldname: "tiles/tileset.json", originalname: "tileset.json" }),
    "tiles/tileset.json"
  );
  // curl keeps the path in both — same answer either way.
  assert.equal(
    resolveUploadRelativePath({ fieldname: "gis/tower.gpkg", originalname: "gis/tower.gpkg" }),
    "gis/tower.gpkg"
  );
  // Root-level files have no slash anywhere.
  assert.equal(
    resolveUploadRelativePath({ fieldname: "cesium-package.json", originalname: "cesium-package.json" }),
    "cesium-package.json"
  );
  // Windows-style separators in the fieldname still count as path-bearing.
  assert.equal(
    resolveUploadRelativePath({ fieldname: "tiles\\content.glb", originalname: "content.glb" }),
    "tiles\\content.glb"
  );
  // Degenerate uploads fall back to whatever exists.
  assert.equal(resolveUploadRelativePath({ fieldname: "", originalname: "a.txt" }), "a.txt");
});

test("storePackage writes files atomically under the package id", async () => {
  const root = await makeTempRoot();
  const files = [
    { relativePath: "cesium-package.json", buffer: Buffer.from('{"schema":"revitgeosuite.cesium-package"}') },
    { relativePath: "tiles/tileset.json", buffer: Buffer.from("{}") },
  ];

  const dir = await storePackage(root, "pkg-1", files);
  assert.equal(dir, path.join(root, "pkg-1"));
  const manifest = await fs.readFile(path.join(root, "pkg-1", "cesium-package.json"), "utf8");
  assert.match(manifest, /revitgeosuite/);
  await fs.access(path.join(root, "pkg-1", "tiles", "tileset.json"));

  const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith(".tmp-"));
  assert.equal(leftovers.length, 0);
});

test("storePackage moves disk-staged files (multer diskStorage) into place", async () => {
  const root = await makeTempRoot();
  const staged = path.join(root, "staged-upload");
  await fs.writeFile(staged, "GLB-BYTES");

  await storePackage(root, "pkg-disk", [
    { relativePath: "tiles/content.glb", sourcePath: staged },
    { relativePath: "cesium-package.json", buffer: Buffer.from("{}") },
  ]);

  const content = await fs.readFile(path.join(root, "pkg-disk", "tiles", "content.glb"), "utf8");
  assert.equal(content, "GLB-BYTES");
});

test("storePackage replaces an existing package with the same id", async () => {
  const root = await makeTempRoot();
  await storePackage(root, "pkg-1", [{ relativePath: "a.txt", buffer: Buffer.from("old") }]);
  await storePackage(root, "pkg-1", [{ relativePath: "b.txt", buffer: Buffer.from("new") }]);

  const names = await fs.readdir(path.join(root, "pkg-1"));
  assert.deepEqual(names.sort(), ["b.txt"]);
});

test("prunePackagesForBuilding keeps only the newest N packages per building id", async () => {
  const root = await makeTempRoot();
  const mkManifest = (buildingId) =>
    Buffer.from(JSON.stringify({ building: { id: buildingId } }));

  for (const id of ["p1", "p2", "p3"]) {
    await storePackage(root, id, [{ relativePath: "cesium-package.json", buffer: mkManifest("tower") }]);
    // Distinct mtimes so ordering is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await storePackage(root, "other", [{ relativePath: "cesium-package.json", buffer: mkManifest("annex") }]);

  const removed = await prunePackagesForBuilding(root, "tower", 2);
  assert.deepEqual(removed, ["p1"]);

  const remaining = (await fs.readdir(root)).sort();
  assert.deepEqual(remaining, ["other", "p2", "p3"]);
});
