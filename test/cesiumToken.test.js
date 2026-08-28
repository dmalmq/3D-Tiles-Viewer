import test from "node:test";
import assert from "node:assert/strict";

import {
  ARCGIS_API_KEY_STORAGE_KEY,
  CARTO_API_KEY_STORAGE_KEY,
  CESIUM_ION_TOKEN_STORAGE_KEY,
  applyMapAccessToken,
  applySavedMapAccessTokens,
  arcGisProviderOptions,
  cartoBasemapUrl,
  classifyMapAccessToken,
  getStartupCesiumIonToken,
  getStartupMapTokens,
  ionProviderOptions,
  isJwtAccessToken,
  readSavedCartoApiKey,
  readSavedCesiumIonToken,
  resolveProviderTokens,
  saveCesiumIonToken,
  shouldReloadWorldTerrain,
} from "../src/cesiumToken.js";

const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJ0ZXN0In0.signature";
const SAMPLE_ARCGIS = "AAPKabcdefghijklmnopqrstuvwxyz012345";
const SAMPLE_CARTO = "carto-dummy-key-not-real";

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("getStartupCesiumIonToken fills the input from a saved ion JWT", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: ` ${SAMPLE_JWT} ` });
  const input = { value: "" };

  assert.equal(getStartupCesiumIonToken(input, storage, ""), SAMPLE_JWT);
  assert.equal(input.value, SAMPLE_JWT);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
});

test("getStartupCesiumIonToken persists a JWT from the input when storage is empty", () => {
  const storage = createStorage();
  const input = { value: ` ${SAMPLE_JWT} ` };

  assert.equal(getStartupCesiumIonToken(input, storage, ""), SAMPLE_JWT);
  assert.equal(input.value, ` ${SAMPLE_JWT} `);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
});

test("getStartupCesiumIonToken falls back to an env JWT when storage and input are empty", () => {
  const storage = createStorage();
  const input = { value: "" };

  assert.equal(getStartupCesiumIonToken(input, storage, ` ${SAMPLE_JWT} `), SAMPLE_JWT);
  assert.equal(input.value, SAMPLE_JWT);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
});

test("getStartupMapTokens stores a Carto env key without treating it as ion", () => {
  const storage = createStorage();
  const input = { value: "" };
  const tokens = getStartupMapTokens(input, storage, SAMPLE_CARTO);

  assert.equal(tokens.ion, "");
  assert.equal(tokens.carto, SAMPLE_CARTO);
  assert.equal(input.value, SAMPLE_CARTO);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), undefined);
  assert.equal(storage.values.get(CARTO_API_KEY_STORAGE_KEY), SAMPLE_CARTO);
});

test("saveCesiumIonToken trims JWTs and ignores empty or non-ion values", () => {
  const storage = createStorage();

  assert.equal(saveCesiumIonToken(` ${SAMPLE_JWT} `, storage), SAMPLE_JWT);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
  assert.equal(saveCesiumIonToken("   ", storage), "");
  assert.equal(saveCesiumIonToken(SAMPLE_CARTO, storage), "");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
});

test("saveCesiumIonToken strips a Bearer prefix from JWTs", () => {
  const storage = createStorage();
  assert.equal(saveCesiumIonToken(`Bearer ${SAMPLE_JWT}`, storage), SAMPLE_JWT);
});

test("readSavedCesiumIonToken tolerates unavailable storage", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };

  assert.equal(readSavedCesiumIonToken(storage), "");
});

test("classifyMapAccessToken gates ion, Carto, and ArcGIS keys", () => {
  assert.deepEqual(classifyMapAccessToken(SAMPLE_JWT), { kind: "ion", token: SAMPLE_JWT });
  assert.deepEqual(classifyMapAccessToken(SAMPLE_CARTO), { kind: "carto", token: SAMPLE_CARTO });
  assert.deepEqual(classifyMapAccessToken(SAMPLE_ARCGIS), { kind: "arcgis", token: SAMPLE_ARCGIS });
  assert.deepEqual(classifyMapAccessToken("  "), { kind: null, token: "" });
});

test("isJwtAccessToken recognizes Cesium ion JWTs", () => {
  assert.equal(isJwtAccessToken(SAMPLE_JWT), true);
  assert.equal(isJwtAccessToken(SAMPLE_ARCGIS), false);
  assert.equal(isJwtAccessToken(""), false);
});

test("applyMapAccessToken sets Ion.defaultAccessToken only for JWTs", () => {
  const storage = createStorage();
  const Ion = { defaultAccessToken: "" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.deepEqual(applyMapAccessToken(` ${SAMPLE_JWT} `, { Ion, ArcGisMapService, storage }), {
    kind: "ion",
    token: SAMPLE_JWT,
  });
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, "eval-token");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
  assert.equal(shouldReloadWorldTerrain({ kind: "ion", token: SAMPLE_JWT }), true);
});

test("applyMapAccessToken sends ArcGIS keys only to ArcGIS", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_JWT });
  const Ion = { defaultAccessToken: SAMPLE_JWT };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.deepEqual(applyMapAccessToken(SAMPLE_ARCGIS, { Ion, ArcGisMapService, storage }), {
    kind: "arcgis",
    token: SAMPLE_ARCGIS,
  });
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, SAMPLE_ARCGIS);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
  assert.equal(storage.values.get(ARCGIS_API_KEY_STORAGE_KEY), SAMPLE_ARCGIS);
  assert.equal(shouldReloadWorldTerrain({ kind: "arcgis", token: SAMPLE_ARCGIS }), false);
});

test("applyMapAccessToken sends Carto keys only to Carto and does not clobber ion", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_JWT });
  const Ion = { defaultAccessToken: SAMPLE_JWT };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.deepEqual(applyMapAccessToken(SAMPLE_CARTO, { Ion, ArcGisMapService, storage }), {
    kind: "carto",
    token: SAMPLE_CARTO,
  });
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, "eval-token");
  assert.equal(readSavedCesiumIonToken(storage), SAMPLE_JWT);
  assert.equal(readSavedCartoApiKey(storage), SAMPLE_CARTO);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);
  assert.equal(shouldReloadWorldTerrain({ kind: "carto", token: SAMPLE_CARTO }), false);
});

test("applyMapAccessToken ignores empty values so a missing key is not applied", () => {
  const Ion = { defaultAccessToken: SAMPLE_JWT };
  const ArcGisMapService = { defaultAccessToken: "keep-arcgis" };
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_JWT });

  assert.deepEqual(applyMapAccessToken("   ", { Ion, ArcGisMapService, storage }), {
    kind: null,
    token: "",
  });
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, "keep-arcgis");
});

test("ionProviderOptions passes JWTs only", () => {
  assert.deepEqual(ionProviderOptions(` ${SAMPLE_JWT} `), { accessToken: SAMPLE_JWT });
  assert.deepEqual(ionProviderOptions(SAMPLE_CARTO), {});
  assert.deepEqual(ionProviderOptions(SAMPLE_ARCGIS), {});
  assert.deepEqual(ionProviderOptions(""), {});
});

test("arcGisProviderOptions passes ArcGIS keys only", () => {
  assert.deepEqual(arcGisProviderOptions(` ${SAMPLE_ARCGIS} `), { token: SAMPLE_ARCGIS });
  assert.deepEqual(arcGisProviderOptions(SAMPLE_JWT), {});
  assert.deepEqual(arcGisProviderOptions(SAMPLE_CARTO), {});
  assert.deepEqual(arcGisProviderOptions(""), {});
});

test("cartoBasemapUrl appends Carto keys only", () => {
  assert.equal(
    cartoBasemapUrl(` ${SAMPLE_CARTO} `),
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${SAMPLE_CARTO}`,
  );
  assert.equal(
    cartoBasemapUrl(SAMPLE_JWT),
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  );
  assert.equal(
    cartoBasemapUrl(SAMPLE_ARCGIS),
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  );
  assert.equal(
    cartoBasemapUrl(""),
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  );
});

test("resolveProviderTokens keeps ion, Carto, and ArcGIS keys on separate slots", () => {
  const storage = createStorage({
    [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_JWT,
    [CARTO_API_KEY_STORAGE_KEY]: SAMPLE_CARTO,
    [ARCGIS_API_KEY_STORAGE_KEY]: SAMPLE_ARCGIS,
  });
  const Ion = { defaultAccessToken: "other" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  assert.deepEqual(resolveProviderTokens({ Ion, ArcGisMapService, storage }), {
    ion: SAMPLE_JWT,
    carto: SAMPLE_CARTO,
    arcgis: SAMPLE_ARCGIS,
  });
});

test("legacy non-JWT cesiumIonToken migrates to Carto without remaining an ion token", () => {
  const storage = createStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_CARTO });
  assert.equal(readSavedCesiumIonToken(storage), "");
  assert.equal(readSavedCartoApiKey(storage), SAMPLE_CARTO);
});

test("applySavedMapAccessTokens restores ion and ArcGIS without writing Carto to Ion", () => {
  const storage = createStorage({
    [CESIUM_ION_TOKEN_STORAGE_KEY]: SAMPLE_JWT,
    [CARTO_API_KEY_STORAGE_KEY]: SAMPLE_CARTO,
    [ARCGIS_API_KEY_STORAGE_KEY]: SAMPLE_ARCGIS,
  });
  const Ion = { defaultAccessToken: "" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  applySavedMapAccessTokens({ Ion, ArcGisMapService, storage });
  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, SAMPLE_ARCGIS);
});
