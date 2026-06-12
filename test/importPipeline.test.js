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
