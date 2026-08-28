export const CESIUM_ION_TOKEN_STORAGE_KEY = "cesiumIonToken";

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readViteEnvToken() {
  try {
    const env = import.meta.env;
    return normalizeCesiumIonToken(
      env?.VITE_CESIUM_ION_TOKEN || env?.VITE_CESIUM_ACCESS_TOKEN || env?.VITE_ARCGIS_API_KEY || "",
    );
  } catch {
    return "";
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

export function readSavedCesiumIonToken(storage = getDefaultStorage()) {
  try {
    return normalizeCesiumIonToken(storage?.getItem?.(CESIUM_ION_TOKEN_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function saveCesiumIonToken(token, storage = getDefaultStorage()) {
  const normalized = normalizeCesiumIonToken(token);
  if (!normalized) return "";

  try {
    storage?.setItem?.(CESIUM_ION_TOKEN_STORAGE_KEY, normalized);
  } catch {
    // Saving the token is a convenience. A blocked storage write should not
    // prevent the current token from being applied for this session.
  }

  return normalized;
}

export function getStartupCesiumIonToken(input, storage = getDefaultStorage(), envToken = readViteEnvToken()) {
  const token =
    readSavedCesiumIonToken(storage) ||
    normalizeCesiumIonToken(input?.value) ||
    normalizeCesiumIonToken(envToken);
  if (!token) return "";

  if (input) input.value = token;
  saveCesiumIonToken(token, storage);
  return token;
}

/**
 * Persist the token and push it onto the Cesium globals that actually fetch
 * basemap tiles. JWTs are Cesium ion access tokens; other keys are treated as
 * ArcGIS / map-provider API keys so Esri "API key required" watermarks clear.
 */
export function applyMapAccessToken(token, { Ion, ArcGisMapService, storage = getDefaultStorage() } = {}) {
  const normalized = saveCesiumIonToken(token, storage);
  if (!normalized) return "";

  if (Ion) Ion.defaultAccessToken = normalized;
  if (ArcGisMapService && !isJwtAccessToken(normalized)) {
    ArcGisMapService.defaultAccessToken = normalized;
  }

  return normalized;
}

export function ionProviderOptions(token) {
  const normalized = normalizeCesiumIonToken(token);
  return normalized ? { accessToken: normalized } : {};
}

export function arcGisProviderOptions(token) {
  const normalized = normalizeCesiumIonToken(token);
  return normalized && !isJwtAccessToken(normalized) ? { token: normalized } : {};
}

export function resolveActiveMapToken({ Ion, ArcGisMapService, storage = getDefaultStorage() } = {}) {
  return (
    readSavedCesiumIonToken(storage) ||
    normalizeCesiumIonToken(Ion?.defaultAccessToken) ||
    normalizeCesiumIonToken(ArcGisMapService?.defaultAccessToken)
  );
}
