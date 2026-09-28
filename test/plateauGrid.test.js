import test from "node:test";
import assert from "node:assert/strict";

import {
  meshBounds,
  meshCodeFor,
  meshCodesInBounds,
  meshNeighborhood,
  meshSamplePoints,
  normalizeMeshCodes,
} from "../src/plateauGrid.js";

test("tertiary mesh code matches the JIS X 0410 cell for Tokyo Station", () => {
  assert.equal(meshCodeFor(35.681236, 139.767125), "53394611");
});

test("mesh bounds contain the point that produced the code", () => {
  const b = meshBounds("53394611");
  assert.ok(b.south <= 35.681236 && 35.681236 < b.north);
  assert.ok(b.west <= 139.767125 && 139.767125 < b.east);
  assert.ok(Math.abs(b.north - b.south - 30 / 3600) < 1e-12);
  assert.ok(Math.abs(b.east - b.west - 45 / 3600) < 1e-12);
});

test("every cell's own centre maps back to the same code", () => {
  for (const code of ["53394611", "53394699", "53394600", "53393599", "52350000"]) {
    const b = meshBounds(code);
    assert.equal(meshCodeFor((b.south + b.north) / 2, (b.west + b.east) / 2), code);
  }
});

test("neighbourhood crosses secondary and primary mesh boundaries", () => {
  // 53394699 sits on the north-east corner of its secondary mesh.
  const around = meshNeighborhood("53394699");
  assert.equal(around.length, 9);
  assert.ok(around.includes("53394699"));
  assert.ok(around.includes("53395700"), "diagonal neighbour in the next secondary mesh");
  // 53394600 is the south-west corner of its secondary mesh.
  const sw = meshNeighborhood("53394600");
  assert.ok(sw.includes("53393599"), "diagonal neighbour in the previous secondary mesh");
});

test("cells in bounds cover the box and respect the limit", () => {
  const box = { south: 35.675, west: 139.7625, north: 35.6916, east: 139.79 };
  const codes = meshCodesInBounds(box);
  assert.equal(codes.length, 6);
  assert.ok(codes.includes("53394611"));
  assert.equal(meshCodesInBounds({ south: 34, west: 138, north: 36, east: 140 }, 100), null);
});

test("sample points share corners between neighbouring cells", () => {
  const points = meshSamplePoints(["53394611", "53394612"]);
  // 2 centres + 6 distinct corners.
  assert.equal(points.length, 8);
});

test("mesh codes are validated, deduplicated and sorted", () => {
  assert.deepEqual(normalizeMeshCodes(["53394612", "bad", "53394611", "53394612", 5339461]), ["53394611", "53394612"]);
});
