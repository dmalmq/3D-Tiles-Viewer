import test from "node:test";
import assert from "node:assert/strict";

import { createPayload } from "../src/gdbLoader.js";

function mkFile(name, relativePath) {
  return {
    name,
    webkitRelativePath: relativePath ?? "",
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

test("single .gpkg file routes to gpkg mode", () => {
  const payload = createPayload(mkFile("Tower.gpkg"));
  assert.equal(payload.mode, "gpkg");
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, "Tower.gpkg");
});

test(".gpkg detection is case-insensitive", () => {
  const payload = createPayload(mkFile("TOWER.GPKG"));
  assert.equal(payload.mode, "gpkg");
});

test("single .zip file still routes to zip mode", () => {
  const payload = createPayload(mkFile("Tokyo.gdb.zip"));
  assert.equal(payload.mode, "zip");
});

test("directory selection still routes to directory mode", () => {
  const files = [
    mkFile("a00000001.gdbtable", "JR.gdb/a00000001.gdbtable"),
    mkFile("a00000001.gdbtablx", "JR.gdb/a00000001.gdbtablx"),
  ];
  const payload = createPayload(files);
  assert.equal(payload.mode, "directory");
});
