import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deletePlateauCache,
  downloadPlateauTileset,
  isAllowedPlateauUrl,
  listPlateauCache,
  plateauCacheKey,
} from "../server/plateauCache.js";
import { meshBounds } from "../src/plateauGrid.js";

const RAD = Math.PI / 180;
const b = meshBounds("53394611");
const REGION = [b.west * RAD, b.south * RAD, b.east * RAD, b.north * RAD, 0, 50];
const ROOT_URL = "https://assets.cms.plateau.reearth.io/x/tileset.json";

function fakeFetch(calls) {
  const docs = {
    [ROOT_URL]: {
      asset: { version: "1.0" },
      geometricError: 100,
      root: {
        boundingVolume: { region: REGION },
        geometricError: 100,
        content: { uri: "data/parent.b3dm" },
        children: [{ boundingVolume: { region: REGION }, geometricError: 0, content: { uri: "data/leaf.b3dm" } }],
      },
    },
  };
  return async (url) => {
    calls.push(url);
    if (docs[url]) return new Response(JSON.stringify(docs[url]), { headers: { "content-type": "application/json" } });
    if (url.endsWith(".b3dm")) return new Response(Buffer.from(`bytes:${url}`));
    return new Response("nope", { status: 404 });
  };
}

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "plateau-cache-"));
}

test("only PLATEAU https hosts are accepted", () => {
  assert.equal(isAllowedPlateauUrl("https://api.plateauview.mlit.go.jp/datacatalog/x/tileset.json"), true);
  assert.equal(isAllowedPlateauUrl("https://assets.cms.plateau.reearth.io/a/tileset.json"), true);
  assert.equal(isAllowedPlateauUrl("http://assets.cms.plateau.reearth.io/a/tileset.json"), false);
  assert.equal(isAllowedPlateauUrl("https://evil.example.com/tileset.json"), false);
  assert.equal(isAllowedPlateauUrl("https://plateau.reearth.io.evil.com/tileset.json"), false);
  assert.equal(isAllowedPlateauUrl("not a url"), false);
});

test("cache key ignores mesh code order", () => {
  assert.equal(plateauCacheKey(ROOT_URL, ["53394612", "53394611"]), plateauCacheKey(ROOT_URL, ["53394611", "53394612"]));
  assert.notEqual(plateauCacheKey(ROOT_URL, ["53394611"]), plateauCacheKey(ROOT_URL, []));
});

test("grid download writes a local tileset and is served from cache the second time", async () => {
  const root = await tempRoot();
  const calls = [];
  const progress = [];
  const first = await downloadPlateauTileset(
    { sourceUrl: ROOT_URL, meshCodes: ["53394611"], label: "test" },
    p => progress.push(p),
    { root, fetchImpl: fakeFetch(calls) },
  );
  assert.equal(first.cached, false);
  assert.equal(first.fileCount, 1, "grid subsets keep only leaves");
  assert.match(first.url, /^\/plateau-cache\/[a-f0-9]{20}\/tileset\.json$/);
  assert.deepEqual(progress.at(-1), { done: 1, total: 1, bytes: first.bytes });

  const tileset = JSON.parse(await fs.readFile(path.join(root, first.key, "tileset.json"), "utf8"));
  const uri = tileset.root.children[0].content.uri;
  assert.equal(uri, "c/000000.b3dm");
  assert.equal(await fs.readFile(path.join(root, first.key, uri), "utf8"), `bytes:https://assets.cms.plateau.reearth.io/x/data/leaf.b3dm`);

  const again = await downloadPlateauTileset(
    { sourceUrl: ROOT_URL, meshCodes: ["53394611"] },
    null,
    { root, fetchImpl: fakeFetch(calls) },
  );
  assert.equal(again.cached, true);

  const listed = await listPlateauCache({ root });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].label, "test");

  assert.equal(await deletePlateauCache(first.key, { root }), true);
  assert.equal((await listPlateauCache({ root })).length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("whole-area download keeps parent tiles", async () => {
  const root = await tempRoot();
  const result = await downloadPlateauTileset({ sourceUrl: ROOT_URL }, null, { root, fetchImpl: fakeFetch([]) });
  assert.equal(result.fileCount, 2);
  await fs.rm(root, { recursive: true, force: true });
});

test("non-PLATEAU sources are rejected before any fetch", async () => {
  const calls = [];
  await assert.rejects(
    downloadPlateauTileset({ sourceUrl: "https://example.com/tileset.json" }, null, { root: os.tmpdir(), fetchImpl: fakeFetch(calls) }),
    /Only PLATEAU/,
  );
  assert.equal(calls.length, 0);
});

test("invalid cache keys are not deleted", async () => {
  assert.equal(await deletePlateauCache("../../etc"), false);
});
