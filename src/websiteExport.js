/**
 * Async half of the website export: gathers the bytes the manifest refers to
 * and hands back a flat file list ready to zip. Tiles come from the directory
 * handles the app already holds, so nothing is read from the publish server.
 */
import { collectTilesetBundles } from "./tilesetBundle.js";
import {
  buildWebsiteManifest,
  buildingFolder,
  WEBSITE_BUNDLE_README,
} from "./websiteManifest.js";

export { buildWebsiteManifest } from "./websiteManifest.js";

async function fetchIcon(slug) {
  const response = await fetch(`/icons/marker/${slug}`);
  if (!response.ok) throw new Error(String(response.status));
  return response.blob();
}

function relativeInsideTileset(file) {
  return (file.relativePath || file.webkitRelativePath || file.name)
    .replace(/\\/g, "/")
    .replace(/^[^/]+\//, "");
}

export async function collectWebsiteBundle(state, options = {}) {
  const plan = buildWebsiteManifest(state, options);
  if (!plan.ok) return plan;

  const files = [];
  const warnings = [...plan.warnings];
  const { bundles, warnings: tileWarnings } = await collectTilesetBundles(plan.buildings);
  warnings.push(...tileWarnings);

  const buildingByName = new Map(plan.buildings.map((b) => [b.name, b]));
  const included = new Set();

  for (const bundle of bundles) {
    if (!bundle.files) {
      warnings.push({
        reason: "tilesetNotLocal",
        detail: (bundle.buildingNames ?? []).join(", "),
      });
      continue;
    }
    for (const name of bundle.buildingNames ?? []) {
      const building = buildingByName.get(name);
      if (!building) continue;
      const dir = buildingFolder(building);
      included.add(dir);
      for (const file of bundle.files) {
        // The File is handed to the zip as-is; reading it here is what blew the
        // heap on real venues.
        files.push({ path: `tiles/${dir}/${relativeInsideTileset(file)}`, data: file });
      }
    }
  }

  plan.manifest.buildings = plan.manifest.buildings.filter((b) => included.has(b.id));
  if (plan.manifest.buildings.length === 0) {
    warnings.push({ reason: "noLocalTiles" });
  }

  for (const slug of plan.iconSlugs) {
    try {
      files.push({ path: `icons/marker/${slug}`, data: await fetchIcon(slug) });
    } catch {
      warnings.push({ reason: "iconMissing", detail: slug });
    }
  }

  for (const doc of plan.layerDocs) {
    files.push({ path: doc.path, data: `${JSON.stringify(doc.json, null, 2)}\n` });
  }
  files.push({ path: "README.md", data: WEBSITE_BUNDLE_README });
  files.push({ path: "venue.json", data: `${JSON.stringify(plan.manifest, null, 2)}\n` });

  return { ok: true, venue: plan.venue, files, warnings };
}
