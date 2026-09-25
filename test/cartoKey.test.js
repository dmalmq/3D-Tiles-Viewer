import test from "node:test";
import assert from "node:assert/strict";

import { getCartoTileUrl, readSavedCartoKey, saveCartoKey } from "../src/cartoKey.js";

test("CARTO tile requests include the saved key", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  saveCartoKey("  carto-key  ", storage);
  assert.equal(readSavedCartoKey(storage), "carto-key");
  assert.equal(
    getCartoTileUrl(readSavedCartoKey(storage)),
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=carto-key",
  );
});

test("CARTO tile requests are disabled without a key", () => {
  assert.equal(getCartoTileUrl(""), "");
});
