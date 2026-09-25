export const CARTO_KEY_STORAGE_KEY = "cartoBasemapKey";

export function readSavedCartoKey(storage) {
  try {
    return ((storage ?? globalThis.localStorage)?.getItem(CARTO_KEY_STORAGE_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function saveCartoKey(value, storage) {
  const key = value.trim();
  if (!key) return "";
  try {
    (storage ?? globalThis.localStorage)?.setItem(CARTO_KEY_STORAGE_KEY, key);
  } catch {
    return key;
  }
  return key;
}

export function getCartoTileUrl(key) {
  return key
    ? `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
    : "";
}
