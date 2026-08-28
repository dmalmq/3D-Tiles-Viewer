import test, { afterEach } from "node:test";
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
  clearInMemoryMapAccessTokens,
} from "../src/cesiumToken.js";

const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJ0ZXN0In0.signature";
const SAMPLE_ARCGIS = "AAPKabcdefghijklmnopqrstuvwxyz012345";
const SAMPLE_CARTO = "carto-dummy-key-not-real";

// Cesium 1.140 ships these as library demo credentials: Ion.defaultAccessToken is
// a JWT and ArcGisMapService.defaultAccessToken is an AAPT eval key. Neither was
// pasted by the user, so neither may be classified as a saved key.
const CESIUM_DEMO_ION_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJjZXNpdW0tZGVtbyJ9.library-default";
const CESIUM_DEMO_ARCGIS_AAPT = "AAPTdemoevalkeyshippedwithcesium00";

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

const STALE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJzdGFsZSJ9.signature";
const STALE_ARCGIS = "AAPTstalestalestalestalestale00000";
const STALE_CARTO = "carto-dummy-stale-key-not-real";

// Readable localStorage that refuses every write: quota, privacy mode, SecurityError.
function createReadOnlyStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (key) => values.delete(key),
    values,
  };
}

afterEach(() => {
  clearInMemoryMapAccessTokens();
});

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

  assert.deepEqual(resolveProviderTokens({ storage }), {
    ion: SAMPLE_JWT,
    carto: SAMPLE_CARTO,
    arcgis: SAMPLE_ARCGIS,
  });
});

test("empty storage ignores the Cesium demo Ion JWT and ArcGIS eval key", () => {
  const storage = createStorage();
  const Ion = { defaultAccessToken: CESIUM_DEMO_ION_JWT };
  const ArcGisMapService = { defaultAccessToken: CESIUM_DEMO_ARCGIS_AAPT };

  const resolved = resolveProviderTokens({ Ion, ArcGisMapService, storage });
  assert.deepEqual(resolved, { ion: "", carto: "", arcgis: "" });

  // No demo JWT means initializeTerrainProviders never calls createWorldTerrainAsync,
  // and no demo AAPT reaches ArcGisMapServerImageryProvider.fromUrl.
  assert.equal(isJwtAccessToken(resolved.ion), false);
  assert.deepEqual(ionProviderOptions(resolved.ion), {});
  assert.deepEqual(arcGisProviderOptions(resolved.arcgis), {});
});

test("applySavedMapAccessTokens does not adopt Cesium demo defaults into session memory", () => {
  const storage = createStorage();
  const Ion = { defaultAccessToken: CESIUM_DEMO_ION_JWT };
  const ArcGisMapService = { defaultAccessToken: CESIUM_DEMO_ARCGIS_AAPT };

  const resolved = applySavedMapAccessTokens({ Ion, ArcGisMapService, storage });
  assert.deepEqual(resolved, { ion: "", carto: "", arcgis: "" });

  // The library defaults stay untouched, but they never become saved user keys.
  assert.equal(Ion.defaultAccessToken, CESIUM_DEMO_ION_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, CESIUM_DEMO_ARCGIS_AAPT);
  assert.equal(storage.values.size, 0);
  assert.deepEqual(resolveProviderTokens({ storage }), { ion: "", carto: "", arcgis: "" });
});

test("a Cesium demo AAPT default never survives a real ArcGIS paste being cleared", () => {
  const storage = createStorage();
  const ArcGisMapService = { defaultAccessToken: CESIUM_DEMO_ARCGIS_AAPT };

  applyMapAccessToken(SAMPLE_ARCGIS, { ArcGisMapService, storage });
  assert.equal(resolveProviderTokens({ storage }).arcgis, SAMPLE_ARCGIS);

  storage.values.clear();
  clearInMemoryMapAccessTokens();
  assert.equal(resolveProviderTokens({ ArcGisMapService, storage }).arcgis, "");
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

test("resolveProviderTokens falls back to an in-memory Carto key when storage is blocked", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  const applied = applyMapAccessToken(SAMPLE_CARTO, { storage });
  assert.equal(applied.kind, "carto");
  assert.equal(applied.token, SAMPLE_CARTO);

  const resolved = resolveProviderTokens({ storage });
  assert.equal(resolved.carto, SAMPLE_CARTO);
  assert.equal(
    cartoBasemapUrl(resolved.carto),
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${SAMPLE_CARTO}`,
  );
  assert.equal(resolved.ion, "");
  assert.equal(resolved.arcgis, "");
});

test("getStartupCesiumIonToken returns a JWT from input when storage writes fail", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const input = { value: ` ${SAMPLE_JWT} ` };

  assert.equal(getStartupCesiumIonToken(input, storage, ""), SAMPLE_JWT);
});

test("getStartupMapTokens seeds Ion, ArcGIS, and Carto in memory when storage writes fail", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const input = { value: SAMPLE_JWT };
  const tokens = getStartupMapTokens(input, storage, {
    ion: "",
    carto: SAMPLE_CARTO,
    arcgis: SAMPLE_ARCGIS,
  });

  assert.equal(tokens.ion, SAMPLE_JWT);
  assert.equal(tokens.carto, SAMPLE_CARTO);
  assert.equal(tokens.arcgis, SAMPLE_ARCGIS);

  const Ion = { defaultAccessToken: "" };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };
  applySavedMapAccessTokens({ Ion, ArcGisMapService, storage }, tokens);

  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, SAMPLE_ARCGIS);
  assert.equal(resolveProviderTokens({ Ion, ArcGisMapService, storage }).carto, SAMPLE_CARTO);
  assert.equal(resolveProviderTokens({ Ion, ArcGisMapService, storage }).ion, SAMPLE_JWT);
});

test("getStartupMapTokens does not send a Carto input to Ion when storage is blocked", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const tokens = getStartupMapTokens({ value: SAMPLE_CARTO }, storage, "");
  assert.equal(tokens.ion, "");
  assert.equal(tokens.carto, SAMPLE_CARTO);

  const Ion = { defaultAccessToken: "" };
  applySavedMapAccessTokens({ Ion, storage }, tokens);
  assert.equal(Ion.defaultAccessToken, "");
});

test("a failed setItem keeps the new ion JWT ahead of a stale saved JWT", () => {
  const storage = createReadOnlyStorage({ [CESIUM_ION_TOKEN_STORAGE_KEY]: STALE_JWT });
  const Ion = { defaultAccessToken: STALE_JWT };

  assert.equal(applyMapAccessToken(SAMPLE_JWT, { Ion, storage }).kind, "ion");
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), STALE_JWT);

  assert.equal(resolveProviderTokens({ Ion, storage }).ion, SAMPLE_JWT);
  // The session slot wins over stale storage even without the Cesium globals.
  assert.equal(resolveProviderTokens({ storage }).ion, SAMPLE_JWT);
  assert.deepEqual(ionProviderOptions(resolveProviderTokens({ storage }).ion), {
    accessToken: SAMPLE_JWT,
  });

  const target = { defaultAccessToken: STALE_JWT };
  applySavedMapAccessTokens({ Ion: target, storage });
  assert.equal(target.defaultAccessToken, SAMPLE_JWT);
  assert.equal(getStartupMapTokens({ value: "" }, storage, "").ion, SAMPLE_JWT);
});

test("a failed setItem keeps the new Carto key ahead of a stale saved key", () => {
  const storage = createReadOnlyStorage({ [CARTO_API_KEY_STORAGE_KEY]: STALE_CARTO });

  assert.equal(applyMapAccessToken(SAMPLE_CARTO, { storage }).kind, "carto");
  assert.equal(storage.values.get(CARTO_API_KEY_STORAGE_KEY), STALE_CARTO);

  const resolved = resolveProviderTokens({ storage });
  assert.equal(resolved.carto, SAMPLE_CARTO);
  assert.equal(
    cartoBasemapUrl(resolved.carto),
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${SAMPLE_CARTO}`,
  );
  assert.equal(applySavedMapAccessTokens({ storage }).carto, SAMPLE_CARTO);
  assert.equal(getStartupMapTokens({ value: "" }, storage, "").carto, SAMPLE_CARTO);
});

test("a failed setItem keeps the new ArcGIS key ahead of a stale saved key", () => {
  const storage = createReadOnlyStorage({ [ARCGIS_API_KEY_STORAGE_KEY]: STALE_ARCGIS });
  const ArcGisMapService = { defaultAccessToken: STALE_ARCGIS };

  assert.equal(applyMapAccessToken(SAMPLE_ARCGIS, { ArcGisMapService, storage }).kind, "arcgis");
  assert.equal(storage.values.get(ARCGIS_API_KEY_STORAGE_KEY), STALE_ARCGIS);

  assert.equal(resolveProviderTokens({ storage }).arcgis, SAMPLE_ARCGIS);
  assert.deepEqual(arcGisProviderOptions(resolveProviderTokens({ storage }).arcgis), {
    token: SAMPLE_ARCGIS,
  });

  const target = { defaultAccessToken: STALE_ARCGIS };
  applySavedMapAccessTokens({ ArcGisMapService: target, storage });
  assert.equal(target.defaultAccessToken, SAMPLE_ARCGIS);
  assert.equal(getStartupMapTokens({ value: "" }, storage, "").arcgis, SAMPLE_ARCGIS);
});

test("session tokens stay on their own provider slot when writes fail", () => {
  const storage = createReadOnlyStorage({
    [CESIUM_ION_TOKEN_STORAGE_KEY]: STALE_JWT,
    [CARTO_API_KEY_STORAGE_KEY]: STALE_CARTO,
    [ARCGIS_API_KEY_STORAGE_KEY]: STALE_ARCGIS,
  });
  const Ion = { defaultAccessToken: STALE_JWT };
  const ArcGisMapService = { defaultAccessToken: "eval-token" };

  applyMapAccessToken(SAMPLE_JWT, { Ion, ArcGisMapService, storage });
  applyMapAccessToken(SAMPLE_CARTO, { Ion, ArcGisMapService, storage });
  const lastApplied = applyMapAccessToken(SAMPLE_ARCGIS, { Ion, ArcGisMapService, storage });

  assert.equal(Ion.defaultAccessToken, SAMPLE_JWT);
  assert.equal(ArcGisMapService.defaultAccessToken, SAMPLE_ARCGIS);
  assert.equal(shouldReloadWorldTerrain(lastApplied), false);
  assert.deepEqual(resolveProviderTokens({ Ion, ArcGisMapService, storage }), {
    ion: SAMPLE_JWT,
    carto: SAMPLE_CARTO,
    arcgis: SAMPLE_ARCGIS,
  });

  const input = { value: "" };
  getStartupMapTokens(input, storage, "");
  assert.equal(input.value, SAMPLE_ARCGIS);
});

test("a successful setItem leaves storage as the source of truth", () => {
  const storage = createStorage();

  assert.equal(applyMapAccessToken(SAMPLE_JWT, { storage }).token, SAMPLE_JWT);
  assert.equal(storage.values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);

  // Another tab rewrites the saved keys; no session slot outranks them.
  storage.values.set(CESIUM_ION_TOKEN_STORAGE_KEY, STALE_JWT);
  storage.values.set(CARTO_API_KEY_STORAGE_KEY, STALE_CARTO);
  assert.deepEqual(resolveProviderTokens({ storage }), {
    ion: STALE_JWT,
    carto: STALE_CARTO,
    arcgis: "",
  });
});

test("a later successful write hands authority back to storage", () => {
  const values = new Map([[CESIUM_ION_TOKEN_STORAGE_KEY, STALE_JWT]]);
  let writesAllowed = false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (!writesAllowed) throw new Error("QuotaExceededError");
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };

  applyMapAccessToken(SAMPLE_JWT, { storage });
  assert.equal(resolveProviderTokens({ storage }).ion, SAMPLE_JWT);

  writesAllowed = true;
  applyMapAccessToken(SAMPLE_JWT, { storage });
  assert.equal(values.get(CESIUM_ION_TOKEN_STORAGE_KEY), SAMPLE_JWT);

  values.set(CESIUM_ION_TOKEN_STORAGE_KEY, STALE_JWT);
  assert.equal(resolveProviderTokens({ storage }).ion, STALE_JWT);
});
