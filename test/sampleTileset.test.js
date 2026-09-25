import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSessionJson, shouldLoadTilesetFromUrl } from "../src/session.js";
import { SAMPLE_BUILDING_NAME, SAMPLE_TILESET_URL, withAppBase } from "../src/viewerDataset.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sampleDir = join(root, "public", "tiles", "sample-indoor");

test("synthetic indoor sample files are present and small", () => {
  const files = readdirSync(sampleDir);
  assert.ok(files.includes("tileset.json"));
  assert.ok(files.includes("content.glb"));
  assert.ok(files.includes("session.json"));
  const total = files.reduce((sum, name) => sum + statSync(join(sampleDir, name)).size, 0);
  assert.ok(total < 500_000, `sample should stay tiny, got ${total} bytes`);
});

test("sample tileset.json is 3D Tiles 1.1 with same-origin glb content", () => {
  const tileset = JSON.parse(readFileSync(join(sampleDir, "tileset.json"), "utf8"));
  assert.equal(tileset.asset.version, "1.1");
  assert.match(String(tileset.asset.extras?.attribution ?? ""), /[Ss]ynthetic/);
  assert.equal(tileset.root.content.uri, "content.glb");
  assert.equal(tileset.root.geometricError, 0);
  assert.equal(tileset.root.transform.length, 16);
});

test("sample session points the viewer at the static tileset URL", () => {
  const session = parseSessionJson(readFileSync(join(sampleDir, "session.json"), "utf8"));
  assert.equal(session.buildings[0].name, SAMPLE_BUILDING_NAME);
  assert.equal(session.buildings[0].sourceUrl, "/tiles/sample-indoor/tileset.json");
  assert.equal(withAppBase(session.buildings[0].sourceUrl), SAMPLE_TILESET_URL);
  assert.equal(shouldLoadTilesetFromUrl(session.buildings[0]), true);
  assert.equal(session.buildings[0].directoryHandleId, null);
  assert.ok(session.buildings[0].levels.length >= 2);
});
