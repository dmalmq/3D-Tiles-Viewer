/**
 * Pure half of the website export: app state in, `venue-web` v1 manifest and
 * layer documents out. Kept free of Cesium and DOM imports so it stays testable.
 */
import { normalizeLevelRecords } from "./levelMetadata.js";
import { slugifyVenueId } from "./slug.js";

import { featuresForWebsiteLayer } from "./websiteLayerExport.js";
export const WEBSITE_BUNDLE_VERSION = 1;

export const WEBSITE_BUNDLE_README = `# venue-web bundle

Drop this folder onto a static site and point the viewer at venue.json.
Every path inside venue.json is relative to this folder.

If this bundle was built from client, workplace, or station data it is for
LOCAL VIEWING ONLY. Do not commit it to a public website and do not upload it
to a CDN. Open it from disk in a viewer that reads local folders instead.
`;

function layerSlug(name, used) {
  const base = slugifyVenueId(name || "layer");
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

function collectLevels(buildings) {
  const merged = new Map();
  for (const building of buildings) {
    for (const level of normalizeLevelRecords(building.levels ?? [])) {
      const key = level.key ?? level.name;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...level, mergedKey: key });
        continue;
      }
      if (level.minZMeters != null) {
        existing.minZMeters =
          existing.minZMeters == null
            ? level.minZMeters
            : Math.min(existing.minZMeters, level.minZMeters);
      }
      if (level.maxZMeters != null) {
        existing.maxZMeters =
          existing.maxZMeters == null
            ? level.maxZMeters
            : Math.max(existing.maxZMeters, level.maxZMeters);
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.floor - b.floor)
    .map((level) => ({
      levelKey: level.mergedKey,
      levelName: level.name,
      levelElevationMeters: level.floor,
      minZMeters: level.minZMeters,
      maxZMeters: level.maxZMeters,
    }));
}

function geometryKind(features) {
  const type = features.find((f) => f?.geometry?.type)?.geometry?.type ?? "Point";
  if (type.includes("Polygon")) return "polygon";
  if (type.includes("LineString")) return "line";
  return "point";
}

export function buildingFolder(building) {
  return slugifyVenueId(building?.name ?? "building");
}

/**
 * @returns {{ ok: false, reason: string } | {
 *   ok: true, venue: object, manifest: object,
 *   layerDocs: { path: string, json: object }[],
 *   iconSlugs: string[], buildings: object[], warnings: object[]
 * }}
 */
export function buildWebsiteManifest(state, options = {}) {
  const { venues = [], buildings = [] } = state;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const warnings = [];

  const exportable = venues.filter((venue) =>
    buildings.some((building) => building.venueId === venue.id),
  );
  if (exportable.length === 0) {
    return { ok: false, reason: "noVenuesWithBuildings" };
  }

  const venue = exportable[0];
  if (exportable.length > 1) {
    warnings.push({
      reason: "multipleVenues",
      detail: exportable.slice(1).map((v) => v.name).join(", "),
    });
  }

  const venueBuildings = buildings.filter((b) => b.venueId === venue.id);
  const levels = collectLevels(venueBuildings);
  const levelKeys = new Set(levels.map((level) => level.levelKey));

  const usedSlugs = new Set();
  const layerDocs = [];
  const layers = [];
  const iconSlugs = new Set();

  for (const building of venueBuildings) {
    for (const source of building.shapefileLayers ?? []) {
      const exportedLayer = featuresForWebsiteLayer(source);
      const features = exportedLayer.features;
      if (features.length === 0) continue;
      const slug = layerSlug(source.name, usedSlugs);
      const levelKey =
        source.levelKey != null && levelKeys.has(source.levelKey) ? source.levelKey : null;
      if (!exportedLayer.placed) {
        warnings.push({
          reason: "layerNotPlaced",
          detail: source.name ?? slug,
        });
      }

      const exported = features.map((feature) => {
        const properties = { ...(feature.properties ?? {}) };
        if (properties.levelKey == null && levelKey != null) {
          properties.levelKey = levelKey;
        }
        if (typeof properties.image === "string" && properties.image) {
          iconSlugs.add(properties.image.replace(/^\.?\//, "").replace(/^marker\//, ""));
        }
        return { ...feature, properties };
      });

      layerDocs.push({
        path: `layers/${slug}.geojson`,
        json: { type: "FeatureCollection", features: exported },
      });
      layers.push({
        id: slug,
        name: source.name ?? slug,
        uri: `layers/${slug}.geojson`,
        geometry: geometryKind(exported),
        color: source.color ?? null,
        defaultVisible: !source._hidden,
      });
    }
  }

  const manifest = {
    format: "venue-web",
    version: WEBSITE_BUNDLE_VERSION,
    id: venue.id,
    name: venue.name,
    generator: "3D-Tiles-Viewer",
    generatedAt,
    synthetic: options.synthetic === true,
    levels,
    buildings: venueBuildings.map((building) => ({
      id: buildingFolder(building),
      name: building.name ?? "Building",
      tilesets: [{ levelKey: null, uri: `tiles/${buildingFolder(building)}/tileset.json` }],
    })),
    layers,
    iconBase: "icons/marker/",
    camera: null,
  };

  return { ok: true, venue, manifest, layerDocs, iconSlugs: [...iconSlugs], buildings: venueBuildings, warnings };
}
