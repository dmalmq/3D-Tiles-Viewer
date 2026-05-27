import * as gdalModule from "gdal3.js";
import wasmUrl from "gdal3.js/dist/package/gdal3WebAssembly.wasm?url";
import dataUrl from "gdal3.js/dist/package/gdal3WebAssembly.data?url";

// gdal3.js installs its own `onmessage` handler whenever it is evaluated in a
// worker. This worker has a separate protocol, so keep GDAL in-process and
// prevent its proxy shim from receiving `loadGdb` messages.
self.onmessage = null;

let _gdalPromise = null;
let _importSeq = 0;

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack,
  };
}

async function getGdal() {
  if (!_gdalPromise) {
    _gdalPromise = (async () => {
      const initFn = findInitFunction(gdalModule) ?? self.initGdalJs;
      if (typeof initFn !== "function") {
        throw new Error(
          "gdal3.js initializer not found. Expected a function, got " + typeof initFn
        );
      }
      return initFn({
        paths: { wasm: wasmUrl, data: dataUrl },
        useWorker: false,
        logHandler: () => {},
        errorHandler: () => {},
      });
    })();
  }
  return _gdalPromise;
}

function findInitFunction(value, depth = 0) {
  if (typeof value === "function") return value;
  if (!value || depth > 4 || typeof value !== "object") return null;
  return findInitFunction(value.default, depth + 1);
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function pathSegments(path) {
  return normalizePath(path).split("/").filter(Boolean);
}

function pathJoin(...parts) {
  return normalizePath(parts.join("/"));
}

function sanitizeSegment(value, fallback = "item") {
  const sanitized = String(value || "")
    .replace(/[\\/:*?"<>|\0]/g, "_")
    .trim();
  return sanitized || fallback;
}

function sanitizeOutputName(value) {
  return sanitizeSegment(value, "layer").replace(/\.+$/g, "").slice(0, 80) || "layer";
}

function fsExists(fs, path) {
  try {
    return fs.analyzePath(path).exists;
  } catch {
    // Emscripten FS can throw on invalid paths — treat as non-existent.
    return false;
  }
}

function ensureDir(fs, path) {
  const parts = pathSegments(path);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (!fsExists(fs, current)) fs.mkdir(current);
  }
}

function ensureParentDir(fs, filePath) {
  const index = filePath.lastIndexOf("/");
  if (index > 0) ensureDir(fs, filePath.slice(0, index));
}

async function writeDescriptorFile(fs, descriptor, targetPath) {
  ensureParentDir(fs, targetPath);
  const buffer = await descriptor.file.arrayBuffer();
  fs.writeFile(targetPath, new Uint8Array(buffer));
}

function unlinkIfExists(fs, path) {
  try {
    if (fsExists(fs, path)) fs.unlink(path);
  } catch {
    // Best-effort cleanup only.
  }
}

function removeTree(fs, path) {
  if (!fsExists(fs, path)) return;

  let stat;
  try {
    stat = fs.stat(path);
  } catch {
    // Path disappeared between exists check and stat — nothing to remove.
    return;
  }

  if (fs.isDir(stat.mode)) {
    for (const child of fs.readdir(path)) {
      if (child === "." || child === "..") continue;
      removeTree(fs, pathJoin(path, child));
    }
    try {
      fs.rmdir(path);
    } catch {
      // Best-effort cleanup only.
    }
    return;
  }

  unlinkIfExists(fs, path);
}

function toVirtualGdbZipName(name) {
  const base = sanitizeSegment(
    String(name || "geodatabase")
      .replace(/\.gdb\.zip$/i, "")
      .replace(/\.zip$/i, ""),
    "geodatabase"
  );
  return `${base}.gdb.zip`;
}

function findGdbRoot(files) {
  const roots = new Map();

  for (const descriptor of files) {
    const segments = pathSegments(descriptor.relativePath || descriptor.name);
    const gdbIndex = segments.findIndex((segment) => /\.gdb$/i.test(segment));
    if (gdbIndex === -1) continue;

    const rootKey = segments.slice(0, gdbIndex + 1).join("/");
    if (!roots.has(rootKey)) {
      roots.set(rootKey, {
        key: rootKey,
        name: segments[gdbIndex],
        segmentCount: gdbIndex + 1,
      });
    }
  }

  if (roots.size === 0) {
    throw new Error("Select a .gdb folder or a parent folder containing exactly one .gdb folder.");
  }

  if (roots.size > 1) {
    const names = Array.from(roots.values()).map((root) => root.key).join(", ");
    throw new Error(`Selected folder contains multiple .gdb folders (${names}). Select one geodatabase at a time.`);
  }

  return Array.from(roots.values())[0];
}

async function stageDirectory(fs, importRoot, files) {
  const root = findGdbRoot(files);
  const stagedRoot = pathJoin(importRoot, sanitizeSegment(root.name, "geodatabase.gdb"));
  ensureDir(fs, stagedRoot);

  let stagedFileCount = 0;
  for (const descriptor of files) {
    const segments = pathSegments(descriptor.relativePath || descriptor.name);
    const rootKey = segments.slice(0, root.segmentCount).join("/");
    if (rootKey !== root.key) continue;

    const relativeSegments = segments.slice(root.segmentCount);
    if (!relativeSegments.length) continue;

    const targetPath = pathJoin(stagedRoot, ...relativeSegments.map((segment) => sanitizeSegment(segment)));
    await writeDescriptorFile(fs, descriptor, targetPath);
    stagedFileCount += 1;
  }

  if (stagedFileCount === 0) {
    throw new Error("The selected .gdb folder contains no files.");
  }

  return stagedRoot;
}

async function stageZip(fs, importRoot, files) {
  if (files.length !== 1) {
    throw new Error("Select one .gdb.zip file or one .zip file containing a .gdb folder.");
  }

  const descriptor = files[0];
  if (!/\.zip$/i.test(descriptor.name || "")) {
    throw new Error("Select a .gdb.zip file or a .zip file containing one .gdb folder.");
  }

  const zipPath = pathJoin(importRoot, toVirtualGdbZipName(descriptor.name));
  await writeDescriptorFile(fs, descriptor, zipPath);
  return zipPath;
}

function normalizeGdalError(error) {
  if (Array.isArray(error)) {
    const message = error.map((entry) => entry?.message ?? String(entry)).filter(Boolean).join("; ");
    return message || "GDAL returned no error detail.";
  }
  const message = error?.message ?? String(error);
  return message || "GDAL returned no error detail.";
}

async function openDataset(Gdal, inputPath, vfsHandlers = []) {
  try {
    const opened = await Gdal.open(inputPath, [], vfsHandlers);
    const datasets = opened?.datasets ?? [];
    const errors = (opened?.errors ?? []).map((entry) => entry?.message ?? String(entry));
    if (datasets.length === 0) {
      throw new Error(errors.length ? errors.join("; ") : "GDAL returned no datasets.");
    }
    return { datasets, warnings: errors };
  } catch (error) {
    throw new Error(normalizeGdalError(error));
  }
}

async function openZipDataset(Gdal, inputPath) {
  const directWarnings = [];
  try {
    return await openDataset(Gdal, inputPath);
  } catch (directError) {
    directWarnings.push(`Direct open failed: ${directError.message}`);
  }

  try {
    const opened = await openDataset(Gdal, inputPath, ["vsizip"]);
    opened.warnings.unshift(...directWarnings);
    return opened;
  } catch (zipError) {
    throw new Error(
      `GDAL could not open the selected zip as a FileGDB. ${directWarnings.join(" ")} /vsizip/ open failed: ${zipError.message}`
    );
  }
}

async function getLayerList(Gdal, dataset, warnings) {
  let info = dataset.info;
  if (!info?.layers) {
    try {
      info = await Gdal.ogrinfo(dataset);
    } catch (error) {
      warnings.push(`ogrinfo failed: ${error?.message ?? error}`);
    }
  }
  if (!info?.layers) {
    try {
      info = await Gdal.getInfo(dataset);
    } catch (error) {
      warnings.push(`getInfo failed: ${error?.message ?? error}`);
      return [];
    }
  }

  return Array.isArray(info?.layers) ? info.layers : [];
}

function hasGeometry(feature) {
  const geometry = feature?.geometry;
  return !!geometry && typeof geometry.type === "string" && geometry.type !== "GeometryCollection"
    ? true
    : !!geometry && geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries) && geometry.geometries.length > 0;
}

async function exportLayer(Gdal, dataset, layer, layerIndex, importId, outputPaths) {
  const layerName = layer?.name;
  if (!layerName) return { featureCollection: null, warning: "Skipped a layer with no name." };

  if (layer.featureCount === 0) {
    return { featureCollection: null, warning: `Layer "${layerName}" has no features.` };
  }

  const outputName = `gdb_${importId}_${layerIndex}_${sanitizeOutputName(layerName)}`;
  const expectedOutputPath = `/output/${outputName}.geojson`;
  outputPaths.add(expectedOutputPath);

  try {
    const outputPath = await Gdal.ogr2ogr(
      dataset,
      [
        "-f", "GeoJSON",
        "-t_srs", "EPSG:4326",
        "-lco", "RFC7946=YES",
        "-nlt", "CONVERT_TO_LINEAR",
        layerName,
      ],
      outputName
    );

    if (outputPath?.local) outputPaths.add(outputPath.local);
    for (const file of outputPath?.all ?? []) {
      if (file?.local) outputPaths.add(file.local);
    }

    const bytes = await Gdal.getFileBytes(outputPath);
    const text = new TextDecoder().decode(bytes);
    const featureCollection = JSON.parse(text);
    const features = Array.isArray(featureCollection?.features)
      ? featureCollection.features
      : [];

    if (!features.length) {
      return { featureCollection: null, warning: `Layer "${layerName}" has no features.` };
    }

    const spatialFeatures = features.filter(hasGeometry);
    if (!spatialFeatures.length) {
      return { featureCollection: null, warning: `Layer "${layerName}" has no geometries.` };
    }

    const dropped = features.length - spatialFeatures.length;
    featureCollection.features = spatialFeatures;
    featureCollection.fileName = `${layerName}.shp`;

    return {
      featureCollection,
      warning: dropped > 0
        ? `Layer "${layerName}" skipped ${dropped} feature(s) without geometry.`
        : null,
    };
  } catch (error) {
    return { featureCollection: null, warning: `Layer "${layerName}" failed: ${error?.message ?? error}` };
  }
}

async function importDatasets(Gdal, datasets, warnings, importId, outputPaths) {
  const featureCollections = [];

  for (const dataset of datasets) {
    try {
      const layers = await getLayerList(Gdal, dataset, warnings);
      if (!layers.length) {
        warnings.push("Dataset has no vector layers.");
        continue;
      }

      for (let i = 0; i < layers.length; i += 1) {
        const result = await exportLayer(Gdal, dataset, layers[i], i, importId, outputPaths);
        if (result.featureCollection) featureCollections.push(result.featureCollection);
        if (result.warning) warnings.push(result.warning);
      }
    } finally {
      try {
        await Gdal.close(dataset);
      } catch {
        // Best-effort close only.
      }
    }
  }

  return featureCollections;
}

async function handleLoadGdb(payload) {
  const Gdal = await getGdal();
  const fs = Gdal.Module.FS;
  const importId = ++_importSeq;
  const importRoot = `/input/gdb-import-${importId}`;
  const outputPaths = new Set();

  ensureDir(fs, importRoot);

  try {
    const files = payload?.files ?? [];
    const mode = payload?.mode;
    let stagedPath;
    let opened;

    if (mode === "zip") {
      stagedPath = await stageZip(fs, importRoot, files);
      opened = await openZipDataset(Gdal, stagedPath);
    } else if (mode === "directory") {
      stagedPath = await stageDirectory(fs, importRoot, files);
      opened = await openDataset(Gdal, stagedPath);
    } else {
      throw new Error("Unknown geodatabase import mode.");
    }

    const warnings = [...opened.warnings];
    const featureCollections = await importDatasets(
      Gdal,
      opened.datasets,
      warnings,
      importId,
      outputPaths
    );

    if (!featureCollections.length) {
      const detail = warnings.length ? ` ${warnings.join(" ")}` : "";
      throw new Error(`No importable spatial layers were found in the selected geodatabase.${detail}`);
    }

    return { featureCollections, warnings };
  } finally {
    for (const outputPath of outputPaths) unlinkIfExists(fs, outputPath);
    removeTree(fs, importRoot);
  }
}

self.addEventListener("message", async (event) => {
  const { id, type, payload } = event.data ?? {};
  if (type !== "loadGdb") return;

  try {
    const result = await handleLoadGdb(payload);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeError(error) });
  }
});
