import test from "node:test";
import assert from "node:assert/strict";

import { mergeTerrainProviders } from "../src/terrainProviders.js";

test("mergeTerrainProviders does not replace the live object", () => {
  const live = { worldTerrainProvider: "applied-world", plateauTerrainProvider: null };
  const incoming = { worldTerrainProvider: null, plateauTerrainProvider: "plateau" };

  const merged = mergeTerrainProviders(live, incoming);
  assert.equal(merged, live);
  assert.equal(live.worldTerrainProvider, "applied-world");
  assert.equal(live.plateauTerrainProvider, "plateau");
});

test("mergeTerrainProviders does not let a stale init wipe Apply's world terrain", () => {
  const live = { worldTerrainProvider: "applied-world", plateauTerrainProvider: "old-plateau" };
  mergeTerrainProviders(live, { worldTerrainProvider: null, plateauTerrainProvider: "new-plateau" });
  assert.equal(live.worldTerrainProvider, "applied-world");
  assert.equal(live.plateauTerrainProvider, "new-plateau");
});

test("mergeTerrainProviders fills world terrain only when Apply has not set one", () => {
  const live = { worldTerrainProvider: null, plateauTerrainProvider: "plateau" };
  mergeTerrainProviders(live, { worldTerrainProvider: "init-world", plateauTerrainProvider: "plateau" });
  assert.equal(live.worldTerrainProvider, "init-world");
});
