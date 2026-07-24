import test from "node:test";
import assert from "node:assert/strict";

import { classifyImportFiles } from "../src/importPipeline.js";

function mkFile(name) {
  return { name };
}

test("single .gdb.zip routes to gdb-zip", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("Tokyo.gdb.zip")] });
  assert.equal(out.kind, "gdb-zip");
});

test("single .gdb folder zipped without the .gdb extension still routes to gdb-zip via path", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("Some.gdb.archived.zip")] });
  assert.equal(out.kind, "gdb-zip");
});

test("a plain .zip is treated as a shapefile", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("walls_1F.zip")] });
  assert.equal(out.kind, "shp");
});

test("multiple files (typical webkitdirectory selection) routes to gdb-dir-files", () => {
  const out = classifyImportFiles({
    kind: "files",
    files: [mkFile("a.gdbtable"), mkFile("b.gdbindex")],
  });
  assert.equal(out.kind, "gdb-dir-files");
});

test("a directory entry from a drop routes to gdb-dir-entry", () => {
  const entry = { isDirectory: true, name: "tokyo.gdb" };
  const out = classifyImportFiles({ kind: "directory", entry });
  assert.equal(out.kind, "gdb-dir-entry");
  assert.equal(out.entry, entry);
});

test("single .gpkg routes to gpkg", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("Tower.gpkg")] });
  assert.equal(out.kind, "gpkg");
  assert.equal(out.file.name, "Tower.gpkg");
});

test(".gpkg detection is case-insensitive", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("TOWER.GPKG")] });
  assert.equal(out.kind, "gpkg");
});

test("a file set containing cesium-package.json routes to cesium-package", () => {
  const files = [
    { name: "cesium-package.json", relativePath: "Tower-cesium/cesium-package.json" },
    { name: "tileset.json", relativePath: "Tower-cesium/tiles/tileset.json" },
    { name: "content.glb", relativePath: "Tower-cesium/tiles/content.glb" },
    { name: "tower.gpkg", relativePath: "Tower-cesium/gis/tower.gpkg" },
  ];
  const out = classifyImportFiles({ kind: "files", files });
  assert.equal(out.kind, "cesium-package");
  assert.equal(out.files.length, 4);
});

test("cesium-package detection wins over the gdb directory fallback", () => {
  const files = [
    { name: "cesium-package.json", relativePath: "pkg/cesium-package.json" },
    { name: "a.gdbtable", relativePath: "pkg/gis/some.gdb/a.gdbtable" },
  ];
  const out = classifyImportFiles({ kind: "files", files });
  assert.equal(out.kind, "cesium-package");
});

test("unknown single-file extensions flag unsupported with the name preserved", () => {
  const out = classifyImportFiles({ kind: "files", files: [mkFile("data.xlsx")] });
  assert.equal(out.kind, "unsupported");
  assert.equal(out.reason, "type");
  assert.equal(out.name, "data.xlsx");
});

test("empty / missing inputs flag unsupported without throwing", () => {
  assert.equal(classifyImportFiles(null).kind, "unsupported");
  assert.equal(classifyImportFiles({ kind: "files", files: [] }).kind, "unsupported");
});
