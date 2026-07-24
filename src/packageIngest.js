// RevitGeoSuite Cesium-package ingestion (pure logic).
//
// A package folder carries cesium-package.json plus tiles/ (3D Tiles bundle)
// and gis/ (GeoPackage/shapefile floor plans). The manifest's levelMap pairs
// each GIS `level_id` attribute value with the levels.json level key, so GIS
// layers attach to exact levels with no fuzzy matching. main.js owns the
// Cesium side (tileset load, applyGdbDecisions); this module owns parsing,
// file resolution, and decision building so it stays unit-testable.

export const PACKAGE_MANIFEST_NAME = "cesium-package.json";
const PACKAGE_SCHEMA = "revitgeosuite.cesium-package";
const SUPPORTED_VERSION = 1;

export function parsePackageManifestText(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("cesium-package.json is not valid JSON.");
  }

  if (manifest?.schema !== PACKAGE_SCHEMA) {
    throw new Error(`Unexpected manifest schema "${manifest?.schema}". Expected "${PACKAGE_SCHEMA}".`);
  }
  if (typeof manifest.version !== "number" || manifest.version > SUPPORTED_VERSION) {
    throw new Error(
      `Manifest version ${manifest?.version} is newer than the supported version ${SUPPORTED_VERSION}.`
    );
  }
  return manifest;
}

function normalizePath(path) {
  return String(path ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "");
}

function relativePathOf(file) {
  return normalizePath(file?.webkitRelativePath || file?.relativePath || file?.name);
}

/**
 * Index a dropped/picked package file set: parse the manifest and expose
 * `resolve(packageRelativePath)` + `listUnder(prefix)` keyed relative to the
 * manifest's directory (handles both "pkg-folder/cesium-package.json" drops
 * and bare "cesium-package.json" file sets).
 */
export async function indexPackageFiles(files) {
  const all = Array.isArray(files) ? files : Array.from(files ?? []);
  const manifestFile = all.find((f) => (f?.name ?? "").toLowerCase() === PACKAGE_MANIFEST_NAME);
  if (!manifestFile) {
    throw new Error(`The selected files do not contain ${PACKAGE_MANIFEST_NAME}.`);
  }

  const manifestPath = relativePathOf(manifestFile);
  const rootPrefix = manifestPath.slice(0, manifestPath.length - PACKAGE_MANIFEST_NAME.length);

  const byPackagePath = new Map();
  for (const file of all) {
    const path = relativePathOf(file);
    if (!path.startsWith(rootPrefix)) continue;
    byPackagePath.set(path.slice(rootPrefix.length), file);
  }

  const manifest = parsePackageManifestText(await manifestFile.text());

  return {
    manifest,
    resolve(packageRelativePath) {
      return byPackagePath.get(normalizePath(packageRelativePath)) ?? null;
    },
    listUnder(prefix) {
      const normalized = normalizePath(prefix).replace(/\/?$/, "/");
      const out = [];
      for (const [path, file] of byPackagePath) {
        if (path.startsWith(normalized)) out.push(file);
      }
      return out;
    },
  };
}

// Above this, per-level elevation-vs-geometry gaps are a frame mismatch, not
// slabs dipping below their walking plane.
const LEVEL_FRAME_OFFSET_THRESHOLD_M = 2.5;

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Reconcile each level's walking plane with the tileset-local geometry frame.
 *
 * levels.json `levelElevationMeters` has exact level-to-level spacing but has
 * been observed in a different frame than the tile geometry (Shinjuku_LUMINE1:
 * a constant ~38.7m above it), while `minZMeters` is the true local frame but
 * noisy per level (geometry can dip metres below its plane). When the median
 * elevation-minus-minZ gap says "frame offset", shift the whole ladder by that
 * median; otherwise trust the elevations as-is.
 *
 * @returns {Map<string, number>} levelKey → tileset-local plane Z
 */
export function computeLevelLocalPlanes(levelRecords) {
  const planes = new Map();
  const records = (levelRecords ?? [])
    .map((record) => ({
      key: record?.levelKey ?? record?.key ?? null,
      elevation: Number(record?.levelElevationMeters ?? record?.floor),
      minZ: Number(record?.minZMeters),
    }))
    .filter((record) => record.key && Number.isFinite(record.elevation));
  if (!records.length) return planes;

  const offsets = records
    .map((record) => record.elevation - record.minZ)
    .filter(Number.isFinite);
  const medianOffset = median(offsets);
  const shift =
    medianOffset != null && medianOffset > LEVEL_FRAME_OFFSET_THRESHOLD_M ? medianOffset : 0;

  for (const record of records) {
    planes.set(record.key, record.elevation - shift);
  }
  return planes;
}

/**
 * True when a re-pushed package's payload is identical to what the building was
 * last ingested from — the caller can skip the teardown/re-ingest entirely.
 * Requires both fingerprints; anything missing means "assume changed".
 */
export function packageUnchanged(manifest, existingBuilding) {
  const incoming = manifest?.contentHash;
  const current = existingBuilding?.packageContentHash;
  return Boolean(incoming && current && incoming === current);
}

export function buildLevelKeyByGisId(manifest) {
  const map = new Map();
  for (const entry of manifest?.levelMap ?? []) {
    if (entry?.gisLevelId && entry?.tilesLevelKey) {
      map.set(entry.gisLevelId, { levelKey: entry.tilesLevelKey, name: entry.name ?? "" });
    }
  }
  return map;
}

function readLevelId(feature) {
  const props = feature?.properties ?? {};
  return props.level_id ?? props.LEVEL_ID ?? props.levelId ?? null;
}

function baseLayerName(fc) {
  return String(fc?.fileName ?? "layer").replace(/\.(shp|dbf|prj|geojson|json|gpkg)$/i, "");
}

function isLevelMetadataLayer(fc) {
  return /(^|_)level$/i.test(baseLayerName(fc));
}

/**
 * Turn the package's GIS feature collections into applyGdbDecisions-compatible
 * decisions: features grouped by their `level_id`, mapped through the
 * manifest's levelMap to exact level keys on `buildingIndex`. Features with an
 * unmapped level_id go to the unassigned tray instead of guessing.
 */
export function buildGisDecisions(featureCollections, manifest, buildingIndex) {
  const levelByGisId = buildLevelKeyByGisId(manifest);
  const decisions = [];
  let unmatchedCount = 0;

  for (const fc of featureCollections ?? []) {
    if (isLevelMetadataLayer(fc)) continue;

    const groups = new Map();
    const unmatched = [];
    for (const feature of fc?.features ?? []) {
      const levelId = readLevelId(feature);
      const mapped = levelId != null ? levelByGisId.get(String(levelId)) : null;
      if (!mapped) {
        unmatched.push(feature);
        continue;
      }
      if (!groups.has(mapped.levelKey)) groups.set(mapped.levelKey, { mapped, features: [] });
      groups.get(mapped.levelKey).features.push(feature);
    }

    const name = baseLayerName(fc);
    for (const { mapped, features } of groups.values()) {
      decisions.push({
        fc: { ...fc, fileName: name, features },
        target: { kind: "building", buildingIndex, levelKey: mapped.levelKey },
        nameOverride: mapped.name ? `${name} (${mapped.name})` : name,
      });
    }

    if (unmatched.length > 0) {
      unmatchedCount += unmatched.length;
      decisions.push({
        fc: { ...fc, fileName: name, features: unmatched },
        target: { kind: "unassigned" },
        nameOverride: `${name} (unmatched)`,
      });
    }
  }

  return { decisions, unmatchedCount };
}
