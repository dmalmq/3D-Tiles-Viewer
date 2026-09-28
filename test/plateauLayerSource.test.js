import test from "node:test";
import assert from "node:assert/strict";

import { PLATEAU_TILESET_OPTIONS, loadSavedPlateauTileset } from "../src/plateauLayerSource.js";
import { meshBounds } from "../src/plateauGrid.js";

const RAD = Math.PI / 180;
const b = meshBounds("53394611");
const REGION = [b.west * RAD, b.south * RAD, b.east * RAD, b.north * RAD, 0, 50];
const REMOTE = "https://assets.cms.plateau.reearth.io/x/tileset.json";

function withFetch(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    asset: { version: "1.0" },
    root: {
      boundingVolume: { region: REGION },
      geometricError: 10,
      children: [{ boundingVolume: { region: REGION }, geometricError: 0, content: { uri: "a.b3dm" } }],
    },
  }));
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("saved local copies load from the cache URL with PLATEAU tileset options", async () => {
  const calls = [];
  const loader = async (viewer, url, options) => {
    calls.push({ url, options });
    return { url };
  };
  await loadSavedPlateauTileset(null, loader, {
    storage: "local",
    url: "/plateau-cache/abc/tileset.json",
    remoteUrl: REMOTE,
    meshCodes: ["53394611"],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/plateau-cache/abc/tileset.json");
  assert.equal(calls[0].options.tilesetOptions, PLATEAU_TILESET_OPTIONS);
});

test("a missing local copy falls back to re-cutting the grid subset from PLATEAU", () => withFetch(async () => {
  const urls = [];
  const loader = async (viewer, url) => {
    urls.push(url);
    if (url.startsWith("/plateau-cache/")) throw new Error("404");
    return { url };
  };
  const result = await loadSavedPlateauTileset(null, loader, {
    storage: "local",
    url: "/plateau-cache/gone/tileset.json",
    remoteUrl: REMOTE,
    meshCodes: ["53394611"],
  });
  assert.equal(urls.length, 2);
  assert.match(result.url, /^blob:/);
}));

test("older sessions without storage info load the plain URL", async () => {
  const urls = [];
  await loadSavedPlateauTileset(null, async (viewer, url) => urls.push(url), { url: REMOTE });
  assert.deepEqual(urls, [REMOTE]);
});
