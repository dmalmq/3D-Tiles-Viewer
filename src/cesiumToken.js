export const CESIUM_ION_TOKEN_STORAGE_KEY = "cesiumIonToken";
export const CARTO_API_KEY_STORAGE_KEY = "cartoApiKey";
export const ARCGIS_API_KEY_STORAGE_KEY = "arcGisApiKey";
export const MAP_API_KEY_LAST_KIND_STORAGE_KEY = "mapApiKeyLastKind";

const CARTO_POSITRON_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStorageItem(storage, key) {
  try {
    return normalizeCesiumIonToken(storage?.getItem?.(key));
  } catch {
    return "";
  }
}

function writeStorageItem(storage, key, value) {
  const normalized = normalizeCesiumIonToken(value);
  if (!normalized) return "";
  try {
    storage?.setItem?.(key, normalized);
  } catch {
    // Saving the token is a convenience. A blocked storage write should not
    // prevent the current token from being applied for this session.
  }
  return normalized;
}

function readViteEnvTokens() {
  try {
    const env = import.meta.env;
    return {
      ion: normalizeCesiumIonToken(env?.VITE_CESIUM_ION_TOKEN || env?.VITE_CESIUM_ACCESS_TOKEN || ""),
      carto: normalizeCesiumIonToken(env?.VITE_CARTO_API_KEY || ""),
      arcgis: normalizeCesiumIonToken(env?.VITE_ARCGIS_API_KEY || ""),
    };
  } catch {
    return { ion: "", carto: "", arcgis: "" };
  }
}

export function normalizeCesiumIonToken(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^Bearer\s+/i, "");
}

export function isJwtAccessToken(value) {
  const token = normalizeCesiumIonToken(value);
  if (!token) return false;
  return token.startsWith("eyJ") && token.split(".").length === 3;
}

export function isArcGisApiKey(value) {
  const token = normalizeCesiumIonToken(value);
  return /^AAP[KT]/i.test(token);
}

export function classifyMapAccessToken(value) {
  const token = normalizeCesiumIonToken(value);
  if (!token) return { kind: null, token: "" };
  if (isJwtAccessToken(token)) return { kind: "ion", token };
  if (isArcGisApiKey(token)) return { kind: "arcgis", token };
  return { kind: "carto", token };
}

function storageKeyForKind(kind) {
  if (kind === "ion") return CESIUM_ION_TOKEN_STORAGE_KEY;
  if (kind === "carto") return CARTO_API_KEY_STORAGE_KEY;
  if (kind === "arcgis") return ARCGIS_API_KEY_STORAGE_KEY;
  return "";
}

function saveClassifiedToken(kind, token, storage) {
  const key = storageKeyForKind(kind);
  if (!key) return "";
  const saved = writeStorageItem(storage, key, token);
  if (saved) {
    try {
      storage?.setItem?.(MAP_API_KEY_LAST_KIND_STORAGE_KEY, kind);
    } catch {
      // Display-only hint for the paste field.
    }
  }
  return saved;
}

function migrateLegacyIonSlot(storage) {
  const raw = readStorageItem(storage, CESIUM_ION_TOKEN_STORAGE_KEY);
  const { kind, token } = classifyMapAccessToken(raw);
  if (!kind || kind === "ion") return;
  const destKey = storageKeyForKind(kind);
  if (destKey && !readStorageItem(storage, destKey)) writeStorageItem(storage, destKey, token);
  try {
    storage?.removeItem?.(CESIUM_ION_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore a blocked migrate; ion readers still skip non-JWTs.
  }
}

export function readSavedCesiumIonToken(storage = getDefaultStorage()) {
  migrateLegacyIonSlot(storage);
  const token = readStorageItem(storage, CESIUM_ION_TOKEN_STORAGE_KEY);
  if (!isJwtAccessToken(token)) return "";
  try {
    if (storage?.getItem?.(CESIUM_ION_TOKEN_STORAGE_KEY) !== token) {
      writeStorageItem(storage, CESIUM_ION_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Normalization is optional.
  }
  return token;
}

export function readSavedCartoApiKey(storage = getDefaultStorage()) {
  migrateLegacyIonSlot(storage);
  const token = readStorageItem(storage, CARTO_API_KEY_STORAGE_KEY);
  return classifyMapAccessToken(token).kind === "carto" ? token : "";
}

export function readSavedArcGisApiKey(storage = getDefaultStorage()) {
  migrateLegacyIonSlot(storage);
  const token = readStorageItem(storage, ARCGIS_API_KEY_STORAGE_KEY);
  return isArcGisApiKey(token) ? token : "";
}

export function saveCesiumIonToken(token, storage = getDefaultStorage()) {
  const { kind, token: normalized } = classifyMapAccessToken(token);
  if (kind !== "ion") return "";
  return saveClassifiedToken("ion", normalized, storage);
}

function envTokensFromLegacyArg(envToken) {
  if (envToken && typeof envToken === "object" && !Array.isArray(envToken)) {
    return {
      ion: normalizeCesiumIonToken(envToken.ion),
      carto: normalizeCesiumIonToken(envToken.carto),
      arcgis: normalizeCesiumIonToken(envToken.arcgis),
    };
  }
  if (typeof envToken === "string") {
    const classified = classifyMapAccessToken(envToken);
    return {
      ion: classified.kind === "ion" ? classified.token : "",
      carto: classified.kind === "carto" ? classified.token : "",
      arcgis: classified.kind === "arcgis" ? classified.token : "",
    };
  }
  return readViteEnvTokens();
}

let inMemoryCartoApiKey = "";

export function clearInMemoryMapAccessTokens() {
  inMemoryCartoApiKey = "";
}

function rememberClassifiedToken(kind, token, storage) {
  const normalized = saveClassifiedToken(kind, token, storage);
  if (kind === "carto" && normalized) inMemoryCartoApiKey = normalized;
  return normalized;
}

function displayValueFromTokens(tokens, storage) {
  const lastKind = readStorageItem(storage, MAP_API_KEY_LAST_KIND_STORAGE_KEY);
  return tokens[lastKind] || tokens.ion || tokens.carto || tokens.arcgis || "";
}

/**
 * Persist env/input keys into storage when possible, but always return the
 * classified tokens so startup can seed Ion / ArcGIS / Carto memory even if
 * localStorage throws. A Carto or ArcGIS value never overwrites a saved ion JWT.
 */
function persistEnvAndInput(input, storage, envTokens) {
  const tokens = {
    ion: readSavedCesiumIonToken(storage),
    carto: readSavedCartoApiKey(storage) || inMemoryCartoApiKey,
    arcgis: readSavedArcGisApiKey(storage),
  };
  if (classifyMapAccessToken(tokens.carto).kind !== "carto") tokens.carto = "";

  const fromInput = classifyMapAccessToken(input?.value);
  if (fromInput.kind) {
    rememberClassifiedToken(fromInput.kind, fromInput.token, storage);
    tokens[fromInput.kind] = fromInput.token;
  }

  if (!tokens.ion && isJwtAccessToken(envTokens.ion)) {
    rememberClassifiedToken("ion", envTokens.ion, storage);
    tokens.ion = envTokens.ion;
  }
  if (!tokens.carto && classifyMapAccessToken(envTokens.carto).kind === "carto") {
    rememberClassifiedToken("carto", envTokens.carto, storage);
    tokens.carto = envTokens.carto;
  }
  if (!tokens.arcgis && isArcGisApiKey(envTokens.arcgis)) {
    rememberClassifiedToken("arcgis", envTokens.arcgis, storage);
    tokens.arcgis = envTokens.arcgis;
  }

  return tokens;
}

export function getStartupCesiumIonToken(input, storage = getDefaultStorage(), envToken = readViteEnvTokens()) {
  const tokens = persistEnvAndInput(input, storage, envTokensFromLegacyArg(envToken));
  if (input && !normalizeCesiumIonToken(input.value)) input.value = displayValueFromTokens(tokens, storage);
  return tokens.ion;
}

export function getStartupMapTokens(input, storage = getDefaultStorage(), envToken = readViteEnvTokens()) {
  const tokens = persistEnvAndInput(input, storage, envTokensFromLegacyArg(envToken));
  if (input && !normalizeCesiumIonToken(input.value)) input.value = displayValueFromTokens(tokens, storage);
  return tokens;
}

/**
 * Persist the paste into the matching provider slot only.
 * JWTs go to Cesium ion, AAPK/AAPT keys to ArcGIS, everything else to Carto.
 * A Carto or ArcGIS paste never overwrites a saved ion JWT.
 */
export function applyMapAccessToken(token, { Ion, ArcGisMapService, storage = getDefaultStorage() } = {}) {
  const { kind, token: normalized } = classifyMapAccessToken(token);
  if (!kind) return { kind: null, token: "" };

  saveClassifiedToken(kind, normalized, storage);

  if (kind === "ion" && Ion) Ion.defaultAccessToken = normalized;
  if (kind === "arcgis" && ArcGisMapService) ArcGisMapService.defaultAccessToken = normalized;
  if (kind === "carto") inMemoryCartoApiKey = normalized;

  return { kind, token: normalized };
}

export function applySavedMapAccessTokens(
  { Ion, ArcGisMapService, storage = getDefaultStorage() } = {},
  tokens,
) {
  const resolved = tokens ?? {
    ion: readSavedCesiumIonToken(storage),
    carto: readSavedCartoApiKey(storage),
    arcgis: readSavedArcGisApiKey(storage),
  };
  if (resolved.ion && Ion) Ion.defaultAccessToken = resolved.ion;
  if (resolved.arcgis && ArcGisMapService) ArcGisMapService.defaultAccessToken = resolved.arcgis;
  if (resolved.carto) inMemoryCartoApiKey = resolved.carto;
  return resolved;
}

export function ionProviderOptions(token) {
  const { kind, token: normalized } = classifyMapAccessToken(token);
  return kind === "ion" ? { accessToken: normalized } : {};
}

export function arcGisProviderOptions(token) {
  const { kind, token: normalized } = classifyMapAccessToken(token);
  return kind === "arcgis" ? { token: normalized } : {};
}

export function cartoBasemapUrl(token, baseUrl = CARTO_POSITRON_URL) {
  const { kind, token: normalized } = classifyMapAccessToken(token);
  if (kind !== "carto") return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}key=${encodeURIComponent(normalized)}`;
}

export function resolveProviderTokens({ Ion, ArcGisMapService, storage = getDefaultStorage() } = {}) {
  const ionFromGlobal = isJwtAccessToken(Ion?.defaultAccessToken) ? normalizeCesiumIonToken(Ion.defaultAccessToken) : "";
  const arcgisFromGlobal = isArcGisApiKey(ArcGisMapService?.defaultAccessToken)
    ? normalizeCesiumIonToken(ArcGisMapService.defaultAccessToken)
    : "";
  const cartoFromMemory =
    classifyMapAccessToken(inMemoryCartoApiKey).kind === "carto"
      ? normalizeCesiumIonToken(inMemoryCartoApiKey)
      : "";
  return {
    ion: readSavedCesiumIonToken(storage) || ionFromGlobal,
    carto: readSavedCartoApiKey(storage) || cartoFromMemory,
    arcgis: readSavedArcGisApiKey(storage) || arcgisFromGlobal,
  };
}

export function shouldReloadWorldTerrain(applied) {
  return applied?.kind === "ion" && Boolean(applied.token);
}
