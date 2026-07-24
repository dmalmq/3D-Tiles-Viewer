// Storage for pushed RevitGeoSuite Cesium packages (data/packages/<packageId>/).
// Uploaded file names come from the network, so every path is sanitized before
// touching disk, files are staged in a .tmp-<id> directory, and the final
// package appears via one atomic rename.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function sanitizePackageRelativePath(value) {
  const normalized = String(value ?? "").replace(/\\/g, "/");
  if (!normalized || normalized.endsWith("/")) return null;
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return null;
    if (/[<>:"|?*\0]/.test(segment)) return null;
  }
  return segments.join("/");
}

/**
 * Recover a multipart part's package-relative path. The push protocol sends the
 * path as BOTH the field name and the filename, but multer strips filenames to
 * their basename (and .NET encodes the path via RFC 5987 `filename*`), so a
 * path-bearing field name is the authoritative source.
 */
export function resolveUploadRelativePath(file) {
  const fieldname = file?.fieldname ?? "";
  if (/[/\\]/.test(fieldname)) return fieldname;
  return file?.originalname || fieldname;
}

export function sanitizePackageId(value) {
  const id = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : null;
}

/**
 * Write a pushed package's files under `<packagesRoot>/<packageId>/`.
 * Files land in a temp sibling first; the rename at the end makes the package
 * visible only when complete. An existing package with the same id is replaced.
 */
export async function storePackage(packagesRoot, packageId, files) {
  const id = sanitizePackageId(packageId);
  if (!id) throw new Error(`Invalid package id "${packageId}".`);

  const finalDir = path.join(packagesRoot, id);
  const tmpDir = path.join(packagesRoot, `.tmp-${crypto.randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    for (const file of files ?? []) {
      const relative = sanitizePackageRelativePath(file.relativePath);
      if (!relative) throw new Error(`Invalid package file path "${file.relativePath}".`);
      const target = path.join(tmpDir, ...relative.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (file.sourcePath) {
        // Disk-staged upload (multer diskStorage): move, don't re-read into memory.
        try {
          await fs.rename(file.sourcePath, target);
        } catch {
          await fs.copyFile(file.sourcePath, target);
          await fs.rm(file.sourcePath, { force: true });
        }
      } else {
        await fs.writeFile(target, file.buffer ?? Buffer.alloc(0));
      }
    }

    // Windows: deleting finalDir and immediately renaming onto the same path
    // hits EPERM while the delete is still pending. Move the old package aside
    // first (rename is atomic), swing the new one in, then discard the old.
    const trashDir = path.join(packagesRoot, `.tmp-trash-${crypto.randomUUID()}`);
    let hadPrevious = true;
    try {
      await fs.rename(finalDir, trashDir);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      hadPrevious = false;
    }

    try {
      await renameWithRetry(tmpDir, finalDir);
    } catch (err) {
      // Restore the previous package so a failed replace doesn't lose data.
      if (hadPrevious) await fs.rename(trashDir, finalDir).catch(() => {});
      throw err;
    }

    if (hadPrevious) await fs.rm(trashDir, { recursive: true, force: true }).catch(() => {});
    return finalDir;
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function renameWithRetry(from, to, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const retryable = err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOTEMPTY";
      if (!retryable) throw err;
      if (i >= attempts - 1) {
        // Directory renames keep failing (e.g. a virus scanner holds a file
        // inside) — fall back to copying, which only needs read access.
        await fs.cp(from, to, { recursive: true });
        await fs.rm(from, { recursive: true, force: true }).catch(() => {});
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** i));
    }
  }
}

async function readPackageBuildingId(packagesRoot, dirName) {
  try {
    const text = await fs.readFile(
      path.join(packagesRoot, dirName, "cesium-package.json"),
      "utf8"
    );
    return JSON.parse(text)?.building?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Keep only the newest `keep` packages for a building id (retention backs the
 * client-side Undo after a re-push). Returns the removed package directory names.
 */
export async function prunePackagesForBuilding(packagesRoot, buildingId, keep = 2) {
  if (!buildingId) return [];

  let entries;
  try {
    entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
    const id = await readPackageBuildingId(packagesRoot, entry.name);
    if (id !== buildingId) continue;
    const stat = await fs.stat(path.join(packagesRoot, entry.name));
    candidates.push({ name: entry.name, mtimeMs: stat.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed = [];
  for (const stale of candidates.slice(keep)) {
    await fs.rm(path.join(packagesRoot, stale.name), { recursive: true, force: true });
    removed.push(stale.name);
  }
  return removed;
}
