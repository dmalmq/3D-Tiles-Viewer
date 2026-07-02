import test from "node:test";
import assert from "node:assert/strict";

import {
  CESIUM_ION_TOKEN_STORAGE_KEY,
  getStartupCesiumIonToken,
  readSavedCesiumIonToken,
  saveCesiumIonToken,
} from "../src/cesiumToken.js";

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("getStartupCesiumIonToken fills the input from saved storage", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: " stored-token " });
  const input = { value: "" };

  assert.equal(getStartupCesiumIonToken(input, storage), "stored-token");
  assert.equal(input.value, "stored-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "stored-token");
});

test("getStartupCesiumIonToken persists a previously filled input when storage is empty", () => {
  const storage = createStorage();
  const input = { value: " filled-token " };

  assert.equal(getStartupCesiumIonToken(input, storage), "filled-token");
  assert.equal(input.value, "filled-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "filled-token");
});

test("saveCesiumIonToken trims tokens and ignores empty values", () => {
  const storage = createStorage();

  assert.equal(saveCesiumIonToken(" token ", storage), "token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "token");
  assert.equal(saveCesiumIonToken("   ", storage), "");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "token");
});

test("readSavedCesiumIonToken tolerates unavailable storage", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };

  assert.equal(readSavedCesiumIonToken(storage), "");
});
