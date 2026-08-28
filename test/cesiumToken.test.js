import test from "node:test";
import assert from "node:assert/strict";

import {
  CESIUM_ION_TOKEN_STORAGE_KEY,
  applyMapAccessToken,
  arcGisProviderOptions,
  getStartupCesiumIonToken,
  ionProviderOptions,
  isJwtAccessToken,
  readSavedCesiumIonToken,
  resolveActiveMapToken,
  saveCesiumIonToken,
} from "../src/cesiumToken.js";

const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJ0ZXN0In0.signature";

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

  assert.equal(getStartupCesiumIonToken(input, storage, ""), "stored-token");
  assert.equal(input.value, "stored-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "stored-token");
});

test("getStartupCesiumIonToken persists a previously filled input when storage is empty", () => {
  const storage = createStorage();
  const input = { value: " filled-token " };

  assert.equal(getStartupCesiumIonToken(input, storage, ""), "filled-token");
  assert.equal(input.value, "filled-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "filled-token");
});

test("getStartupCesiumIonToken falls back to an env token when storage and input are empty", () => {
  const storage = createStorage();
  const input = { value: "" };

  assert.equal(getStartupCesiumIonToken(input, storage, " env-token "), "env-token");
  assert.equal(input.value, "env-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "env-token");
});

test("saveCesiumIonToken trims tokens and ignores empty values", () => {
  const storage = createStorage();

  assert.equal(saveCesiumIonToken(" token ", storage), "token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "token");
  assert.equal(saveCesiumIonToken("   ", storage), "");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "token");
});

test("saveCesiumIonToken strips a Bearer prefix", () => {
  const storage = createStorage();
  assert.equal(saveCesiumIonToken("Bearer abc.def", storage), "abc.def");
});

test("readSavedCesiumIonToken tolerates unavailable storage", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };

  assert.equal(readSavedCesiumIonToken(storage), "");
});

test("isJwtAccessToken recognizes Cesium ion JWTs", () => {
  assert.equal(isJwtAccessToken(SAMPLE_JWT), true);
  assert.equal(isJwtAccessToken("AAPK-not-a-jwt"), false);
  assert.equal(isJwtAccessToken(""), false);
});

test("applyMapAccessToken sets Ion.defaultAccessToken and persists", () => {
  const storage = createStorage();
  const Ion = { defaultAccessToken: "" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.equal(applyMapAccessToken(` ${SAMPLE_JWT} `, { Ion, ArcGisMapService, storage }), SAMPLE_JWT);
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, "eval-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
});

test("applyMapAccessToken applies non-JWT keys to ArcGIS, not only storage", () => {
  const storage = createStorage();
  const Ion = { defaultAccessToken: "" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.equal(
    applyMapAccessToken("  AAPK-map-provider-key  ", { Ion, ArcGisMapService, storage }),
    "AAPK-map-provider-key",
  );
  assert.equal(Ion.defaultAccessToken, "AAPK-map-provider-key");
  assert.equal(ArcGisMapService.defaultAccessToken, "AAPK-map-provider-key");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), "AAPK-map-provider-key");
});

test("applyMapAccessToken ignores empty values so a missing key is not applied", () => {
  const Ion = { defaultAccessToken: "keep-me" };
  const ArcGisMapService = { defaultAccessToken: "keep-arcgis" };
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: "keep-me" });

  assert.equal(applyMapAccessToken("   ", { Ion, ArcGisMapService, storage }), "");
  assert.equal(Ion.defaultAccessToken, "keep-me");
  assert.equal(ArcGisMapService.defaultAccessToken, "keep-arcgis");
});

test("ionProviderOptions passes the token through to Ion imagery", () => {
  assert.deepEqual(ionProviderOptions(` ${SAMPLE_JWT} `), { accessToken: SAMPLE_JWT });
  assert.deepEqual(ionProviderOptions(""), {});
});

test("arcGisProviderOptions passes non-JWT keys and skips JWTs", () => {
  assert.deepEqual(arcGisProviderOptions(" AAPK-key "), { token: "AAPK-key" });
  assert.deepEqual(arcGisProviderOptions(SAMPLE_JWT), {});
  assert.deepEqual(arcGisProviderOptions(""), {});
});

test("resolveActiveMapToken prefers saved storage over Cesium defaults", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: "saved-key" });
  const Ion = { defaultAccessToken: "ion-default" };
  const ArcGisMapService = { defaultAccessToken: "arcgis-default" };

  assert.equal(resolveActiveMapToken({ Ion, ArcGisMapService, storage }), "saved-key");
});
