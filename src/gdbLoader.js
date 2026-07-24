/**
 * Public FileGDB / GeoPackage importer API.
 *
 * `loadGdb` accepts the existing UI inputs (a zip or `.gpkg` `File`, or a
 * directory `FileList`) and delegates GDAL work to a module worker. The worker
 * receives explicit file descriptors so `webkitRelativePath` survives
 * structured cloning.
 */

let _worker = null;
let _nextRequestId = 1;
const _pending = new Map();

function getWorker() {
  if (_worker) return _worker;

  _worker = new Worker(new URL("./gdbWorker.js", import.meta.url), { type: "module" });

  _worker.addEventListener("message", (event) => {
    const { id, ok, result, error } = event.data ?? {};
    if (!id || !_pending.has(id)) return;

    const { resolve, reject } = _pending.get(id);
    _pending.delete(id);

    if (ok) {
      resolve(result);
      return;
    }

    const err = new Error(error?.message ?? "GDAL worker failed.");
    if (error?.name) err.name = error.name;
    if (error?.stack) err.stack = error.stack;
    reject(err);
  });

  const rejectAll = (message, originalError) => {
    for (const { reject } of _pending.values()) {
      reject(originalError ?? new Error(message));
    }
    _pending.clear();
    _worker = null;
  };

  _worker.addEventListener("error", (event) => {
    const location = event.filename
      ? ` (${event.filename}:${event.lineno || 0}:${event.colno || 0})`
      : "";
    rejectAll(event.message ? `${event.message}${location}` : "GDAL worker failed.", event.error);
  });

  _worker.addEventListener("messageerror", () => {
    rejectAll("GDAL worker returned an unreadable message.");
  });

  return _worker;
}

function isFileLike(value) {
  return value && typeof value.name === "string" && typeof value.arrayBuffer === "function";
}

function isZipName(name) {
  return /\.zip$/i.test(name || "");
}

function isGpkgName(name) {
  return /\.gpkg$/i.test(name || "");
}

function toFileArray(input) {
  if (isFileLike(input)) return [input];
  if (input && typeof input.length === "number") return Array.from(input);
  if (Array.isArray(input)) return input;
  return [];
}

export function createPayload(input) {
  const files = toFileArray(input).filter(isFileLike);
  if (!files.length) {
    throw new Error("No geodatabase files were selected.");
  }

  const isSingleFile = files.length === 1 && !files[0].webkitRelativePath;
  const isSingleZip = isSingleFile && isZipName(files[0].name);
  const isSingleGpkg = isSingleFile && isGpkgName(files[0].name);

  const mode = isSingleGpkg ? "gpkg" : isSingleZip ? "zip" : "directory";
  if (mode === "zip" && !isZipName(files[0].name)) {
    throw new Error("Select a .gdb.zip file or a .zip file containing one .gdb folder.");
  }

  return {
    mode,
    files: files.map((file) => ({
      file,
      name: file.name,
      relativePath: file.webkitRelativePath || file.relativePath || file.name,
    })),
  };
}

/**
 * @param {File|FileList} input A `.gdb.zip`/`.zip`/`.gpkg` File, or a FileList
 *                              from a webkitdirectory pick of a `.gdb` folder.
 * @returns {Promise<{ featureCollections: object[], warnings: string[] }>}
 */
export function loadGdb(input) {
  const id = _nextRequestId++;
  const payload = createPayload(input);
  const worker = getWorker();

  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    worker.postMessage({ id, type: "loadGdb", payload });
  });
}
