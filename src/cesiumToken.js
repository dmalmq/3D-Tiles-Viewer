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
  if (!normalized) return { token: "", persisted: false };
  try {
    if (typeof storage?.setItem !== "function") return { token: normalized, persisted: false };
    storage.setItem(key, normalized);
    return { token: normalized, persisted: true };
  } catch {
    // Saving the token is a convenience: a blocked write must not prevent the
    // token from being applied. It does mean storage is now stale for this key,
    // so the caller has to keep the value in session memory instead.
    return { token: normalized, persisted: false };
  }
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
  const { token: normalized, persisted } = writeStorageItem(storage, key, token);
  if (!normalized) return "";
  try {
    storage?.setItem?.(MAP_API_KEY_LAST_KIND_STORAGE_KEY, kind);
  } catch {
    // Display-only hint for the paste field.
  }
  return rememberSessionToken(kind, normalized, persisted);
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

const sessionTokens = { ion: "", carto: "", arcgis: "" };
const sessionWriteFailed = { ion: false, carto: false, arcgis: false };
let sessionLastKind = "";

export function clearInMemoryMapAccessTokens() {
  sessionTokens.ion = "";
  sessionTokens.carto = "";
  sessionTokens.arcgis = "";
  sessionWriteFailed.ion = false;
  sessionWriteFailed.carto = false;
  sessionWriteFailed.arcgis = false;
  sessionLastKind = "";
}

/**
 * Hold a just-applied token for this session. `persisted === false` means the
 * localStorage write was refused (quota, privacy mode, SecurityError), so the
 * session value has to outrank the older value still sitting in storage.
 */
function rememberSessionToken(kind, token, persisted) {
  if (!token || !(kind in sessionTokens)) return "";
  sessionTokens[kind] = token;
  sessionWriteFailed[kind] = !persisted;
  sessionLastKind = kind;
  return token;
}

/** Seed session memory from an already-trusted value without claiming a failed write. */
function holdSessionToken(kind, token) {
  if (!(kind in sessionTokens)) return;
  if (token && classifyMapAccessToken(token).kind === kind) sessionTokens[kind] = token;
}

function sessionTokenForKind(kind) {
  const token = sessionTokens[kind] || "";
  return classifyMapAccessToken(token).kind === kind ? token : "";
}

function readSavedTokenForKind(kind, storage) {
  if (kind === "ion") return readSavedCesiumIonToken(storage);
  if (kind === "carto") return readSavedCartoApiKey(storage);
  if (kind === "arcgis") return readSavedArcGisApiKey(storage);
  return "";
}

/**
 * Storage stays the source of truth while its writes succeed. Once a write for
 * this kind failed, the session token wins so a stale localStorage value cannot
 * replace the key that was just applied.
 */
function effectiveTokenForKind(kind, storage) {
  const session = sessionTokenForKind(kind);
  if (session && sessionWriteFailed[kind]) return session;
  return readSavedTokenForKind(kind, storage) || session;
}

function lastAppliedKind(storage) {
  if (sessionLastKind && sessionWriteFailed[sessionLastKind]) return sessionLastKind;
  return readStorageItem(storage, MAP_API_KEY_LAST_KIND_STORAGE_KEY) || sessionLastKind;
}

function displayValueFromTokens(tokens, storage) {
  const lastKind = lastAppliedKind(storage);
  return tokens[lastKind] || tokens.ion || tokens.carto || tokens.arcgis || "";
}

/**
 * Persist env/input keys into storage when possible, but always return the
 * classified tokens so startup can seed Ion / ArcGIS / Carto memory even if
 * localStorage throws. A Carto or ArcGIS value never overwrites a saved ion JWT.
 */
function persistEnvAndInput(input, storage, envTokens) {
  const tokens = {
    ion: effectiveTokenForKind("ion", storage),
    carto: effectiveTokenForKind("carto", storage),
    arcgis: effectiveTokenForKind("arcgis", storage),
  };

  const fromInput = classifyMapAccessToken(input?.value);
  if (fromInput.kind) {
    saveClassifiedToken(fromInput.kind, fromInput.token, storage);
    tokens[fromInput.kind] = fromInput.token;
  }

  if (!tokens.ion && isJwtAccessToken(envTokens.ion)) {
    tokens.ion = saveClassifiedToken("ion", envTokens.ion, storage);
  }
  if (!tokens.carto && classifyMapAccessToken(envTokens.carto).kind === "carto") {
    tokens.carto = saveClassifiedToken("carto", envTokens.carto, storage);
  }
  if (!tokens.arcgis && isArcGisApiKey(envTokens.arcgis)) {
    tokens.arcgis = saveClassifiedToken("arcgis", envTokens.arcgis, storage);
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

  return { kind, token: normalized };
}

export function applySavedMapAccessTokens(
  { Ion, ArcGisMapService, storage = getDefaultStorage() } = {},
  tokens,
) {
  const resolved = tokens ?? resolveProviderTokens({ storage });
  if (resolved.ion && Ion) Ion.defaultAccessToken = resolved.ion;
  if (resolved.arcgis && ArcGisMapService) ArcGisMapService.defaultAccessToken = resolved.arcgis;
  holdSessionToken("ion", resolved.ion);
  holdSessionToken("carto", resolved.carto);
  holdSessionToken("arcgis", resolved.arcgis);
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

/**
 * Only session memory and localStorage count as user keys. Ion.defaultAccessToken
 * and ArcGisMapService.defaultAccessToken ship with Cesium as demo credentials
 * (a library JWT and an AAPT eval key), so reading them back would turn an empty
 * storage into a phantom "pasted key" and drive World Terrain / ArcGIS requests
 * with credentials the user never supplied.
 */
export function resolveProviderTokens({ storage = getDefaultStorage() } = {}) {
  return {
    ion: effectiveTokenForKind("ion", storage),
    carto: effectiveTokenForKind("carto", storage),
    arcgis: effectiveTokenForKind("arcgis", storage),
  };
}

export function shouldReloadWorldTerrain(applied) {
  return applied?.kind === "ion" && Boolean(applied.token);
}
