// Single classification entry point for files arriving from any of the
// existing surfaces — file picker buttons, drag-drop on the viewport, and
// per-row drops on the scene tree. Pure (no DOM, no Cesium); main.js
// dispatches the resulting kind to the right importer with whatever
// defaults are appropriate for the drop target.

export function classifyImportFiles(items) {
  if (!items) return { kind: "unsupported", reason: "noInput" };

  if (items.kind === "directory") {
    return { kind: "gdb-dir-entry", entry: items.entry };
  }

  const files = Array.isArray(items.files) ? items.files : [];
  if (files.length === 0) return { kind: "unsupported", reason: "empty" };

  if (files.length === 1) {
    const f = files[0];
    const name = (f?.name ?? "").toLowerCase();
    if (name.endsWith(".gdb.zip") || name.includes(".gdb")) {
      return { kind: "gdb-zip", file: f };
    }
    if (name.endsWith(".zip")) {
      return { kind: "shp", file: f };
    }
    return { kind: "unsupported", reason: "type", name: f?.name };
  }

  // Multiple files almost always come from a webkitdirectory pick where the
  // user selected a .gdb folder.
  return { kind: "gdb-dir-files", files };
}
