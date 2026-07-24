// GeoPackage staging for the GDAL worker. Kept free of gdal3.js/Vite imports
// so the logic is unit-testable under node; the worker passes in the
// Emscripten FS object.

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function sanitizeSegment(value, fallback = "item") {
  const sanitized = String(value || "")
    .replace(/[\\/:*?"<>|\0]/g, "_")
    .trim();
  return sanitized || fallback;
}

function fsExists(fs, path) {
  try {
    return fs.analyzePath(path).exists;
  } catch {
    return false;
  }
}

function ensureDir(fs, path) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (!fsExists(fs, current)) fs.mkdir(current);
  }
}

export async function stageGpkg(fs, importRoot, files) {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new Error("Select one .gpkg file.");
  }

  const descriptor = files[0];
  if (!/\.gpkg$/i.test(descriptor?.name || "")) {
    throw new Error("Select a GeoPackage (.gpkg) file.");
  }

  const targetPath = normalizePath(
    `${importRoot}/${sanitizeSegment(descriptor.name, "data.gpkg")}`
  );
  ensureDir(fs, targetPath.slice(0, targetPath.lastIndexOf("/")));
  const buffer = await descriptor.file.arrayBuffer();
  fs.writeFile(targetPath, new Uint8Array(buffer));
  return targetPath;
}
