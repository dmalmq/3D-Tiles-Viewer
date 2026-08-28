// "Export tileset" glue: turn whatever the viewer currently has loaded into a
// self-contained offline pack (zip) the user can re-open with the local-folder
// picker. Blob download only — nothing is uploaded.

import { buildTilesetPack, createFileListSource, createUrlSource } from "./tilesetPack.js";
import { createZip } from "./zipWriter.js";

/** Warning reasons that mean a referenced file did not make it into the pack. */
const SKIPPED_REASONS = new Set([
  "missing",
  "readFailed",
  "contentAbsolute",
  "contentOutsidePack",
  "gltfResourceAbsolute",
  "gltfResourceOutsidePack",
  "schemaAbsolute",
  "schemaOutsidePack",
  "subtreeAbsolute",
  "subtreeOutsidePack",
  "subtreeBufferAbsolute",
  "subtreeBufferOutsidePack",
  "subtreeBufferMissing",
  "implicitSubtreesMissing",
  "implicitTemplateQuery",
]);

export function countSkippedReferences(warnings) {
  return (warnings ?? []).filter((w) => SKIPPED_REASONS.has(w.reason)).length;
}

export function packFileName(label, date = new Date()) {
  const slug =
    String(label ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tileset";
  return `${slug}-offline-${date.toISOString().slice(0, 10)}.zip`;
}

export function formatByteSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Pick the pack source for whatever the viewer holds right now.
 *
 * @param {{files?: File[]|null, tilesetUrl?: string|null}} loaded
 * @returns {{read: Function, label: string}|null}
 */
export function createPackSource(loaded, options = {}) {
  if (loaded?.files?.length) return createFileListSource(loaded.files);
  if (loaded?.tilesetUrl) return createUrlSource(loaded.tilesetUrl, options);
  return null;
}

/**
 * Build the pack and its zip. Pure enough to unit test: the caller supplies the
 * source, so no DOM or network assumptions leak in here.
 */
export async function buildTilesetPackZip(source, options = {}) {
  const date = options.date ?? new Date();
  const pack = await buildTilesetPack(source, options);
  const zipBytes = await createZip(pack.entries, {
    compress: options.compress ?? true,
    date,
  });
  return {
    ...pack,
    zipBytes,
    fileName: options.fileName ?? packFileName(pack.label, date),
    fileCount: pack.entries.length,
    skippedCount: countSkippedReferences(pack.warnings),
  };
}

/** Trigger a browser download for the packed bytes. */
export function downloadPackZip(zipBytes, fileName) {
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke after the click has been dispatched; Safari needs the tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { fileName, byteLength: zipBytes.length };
}
