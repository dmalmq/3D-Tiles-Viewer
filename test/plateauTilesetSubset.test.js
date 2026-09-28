import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlateauFullTileset,
  buildPlateauSubset,
  rewriteContentUris,
} from "../src/plateauTilesetSubset.js";
import { meshBounds } from "../src/plateauGrid.js";

const RAD = Math.PI / 180;

function regionForCell(code, inset = 0.1) {
  const b = meshBounds(code);
  const dLat = (b.north - b.south) * inset;
  const dLng = (b.east - b.west) * inset;
  return [(b.west + dLng) * RAD, (b.south + dLat) * RAD, (b.east - dLng) * RAD, (b.north - dLat) * RAD, 0, 50];
}

function unionOf(...regions) {
  return [
    Math.min(...regions.map(r => r[0])),
    Math.min(...regions.map(r => r[1])),
    Math.max(...regions.map(r => r[2])),
    Math.max(...regions.map(r => r[3])),
    0,
    50,
  ];
}

// Composite pointer -> inner HLOD tree with a coarse parent and two leaves in
// different cells, mirroring the catalog's "latest" tilesets.
const A = regionForCell("53394611");
const B = regionForCell("53394613");
const INNER_URL = "https://assets.cms.plateau.reearth.io/x/inner/tileset.json";
const ROOT_URL = "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13101-bldg/tileset.json";
const DOCS = {
  [ROOT_URL]: {
    asset: { version: "1.0" },
    geometricError: 500,
    root: { boundingVolume: { region: unionOf(A, B) }, geometricError: 500, content: { uri: INNER_URL } },
  },
  [INNER_URL]: {
    asset: { version: "1.0" },
    geometricError: 400,
    root: {
      boundingVolume: { region: unionOf(A, B) },
      geometricError: 400,
      refine: "REPLACE",
      content: { uri: "data/parent.b3dm" },
      children: [
        { boundingVolume: { region: A }, geometricError: 0, content: { uri: "data/a.b3dm" } },
        { boundingVolume: { region: B }, geometricError: 0, content: { uri: "data/b.b3dm" } },
      ],
    },
  },
};
const fetchJson = async (url) => {
  if (!DOCS[url]) throw new Error(`unexpected fetch ${url}`);
  return structuredClone(DOCS[url]);
};

test("subset keeps only leaves inside the selected cells, flattened under an always-refining root", async () => {
  const { tileset, contents, externalTilesetCount } = await buildPlateauSubset({
    url: ROOT_URL,
    meshCodes: ["53394611"],
    fetchJson,
  });
  assert.equal(externalTilesetCount, 1);
  assert.deepEqual(contents.map(c => c.url), ["https://assets.cms.plateau.reearth.io/x/inner/data/a.b3dm"]);
  assert.equal(tileset.root.children.length, 1);
  assert.equal(tileset.root.content, undefined, "coarse parent content must not be kept");
  assert.ok(tileset.root.geometricError >= 1e6);
  assert.deepEqual(tileset.root.boundingVolume.region, A);
});

test("subset with no overlapping tiles returns no contents", async () => {
  const { contents } = await buildPlateauSubset({ url: ROOT_URL, meshCodes: ["53394699"], fetchJson });
  assert.equal(contents.length, 0);
});

test("subset rejects an empty cell list", async () => {
  await assert.rejects(buildPlateauSubset({ url: ROOT_URL, meshCodes: [], fetchJson }), /No valid grid cells/);
});

test("full tileset inlines external tilesets and keeps the HLOD tree", async () => {
  const { tileset, contents } = await buildPlateauFullTileset({ url: ROOT_URL, fetchJson });
  assert.equal(contents.length, 3);
  const inner = tileset.root.children[0];
  assert.equal(inner.content.uri, "https://assets.cms.plateau.reearth.io/x/inner/data/parent.b3dm");
  assert.equal(inner.children.length, 2);
});

test("content URIs can be rewritten to local files", async () => {
  const { tileset } = await buildPlateauFullTileset({ url: ROOT_URL, fetchJson });
  const local = rewriteContentUris(tileset, url => `c/${url.split("/").pop()}`);
  assert.equal(local.root.children[0].content.uri, "c/parent.b3dm");
  assert.equal(local.root.children[0].children[1].content.uri, "c/b.b3dm");
  assert.equal(tileset.root.children[0].content.uri.startsWith("https://"), true, "original is untouched");
});

test("parent transforms are composed onto flattened leaves", async () => {
  const translate = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
  const url = "https://assets.cms.plateau.reearth.io/t/tileset.json";
  const docs = {
    [url]: {
      asset: { version: "1.0" },
      root: {
        boundingVolume: { region: A },
        geometricError: 10,
        transform: translate(5),
        children: [{ boundingVolume: { region: A }, geometricError: 0, transform: translate(2), content: { uri: "a.b3dm" } }],
      },
    },
  };
  const { tileset } = await buildPlateauSubset({ url, meshCodes: ["53394611"], fetchJson: async u => docs[u] });
  assert.deepEqual(tileset.root.children[0].transform, translate(7));
});

test("implicit tiling is reported instead of silently dropped", async () => {
  const url = "https://assets.cms.plateau.reearth.io/i/tileset.json";
  const doc = { asset: { version: "1.1" }, root: { boundingVolume: { region: A }, geometricError: 10, implicitTiling: {} } };
  await assert.rejects(
    buildPlateauSubset({ url, meshCodes: ["53394611"], fetchJson: async () => doc }),
    /Implicit tiling/,
  );
});
