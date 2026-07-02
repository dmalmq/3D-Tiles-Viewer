export const CESIUM_ION_TOKEN_STORAGE_KEY = "cesiumIonToken";

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeCesiumIonToken(value) {
  return typeof value === "string" ? value.trim() : "";
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

export function getStartupCesiumIonToken(input, storage = getDefaultStorage()) {
  const token = readSavedCesiumIonToken(storage) || normalizeCesiumIonToken(input?.value);
  if (!token) return "";

  if (input) input.value = token;
  saveCesiumIonToken(token, storage);
  return token;
}
