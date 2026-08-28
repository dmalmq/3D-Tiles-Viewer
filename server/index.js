import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorTilesetFromUrl, writeTilesetFiles } from "./tilesetMirror.js";
import { resolvePublishOrigin } from "./publishOrigin.js";
import { storePackage, prunePackagesForBuilding, sanitizePackageId, resolveUploadRelativePath } from "./packageStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATA_ROOT = path.join(ROOT, "data");
const SESSIONS_DIR = path.join(DATA_ROOT, "sessions");
const TILESETS_DIR = path.join(DATA_ROOT, "tilesets");
const PACKAGES_DIR = path.join(DATA_ROOT, "packages");

const PORT = Number(process.env.PORT) || 3000;
const PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || "";
const MB = 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * MB,
    fieldSize: Number.MAX_SAFE_INTEGER,
    fields: 20,
    files: 50_000,
    parts: 50_000,
  },
});

// Pushed Cesium packages carry a multi-hundred-MB content.glb — never buffer
// those in memory; multer streams each part straight to a temp file instead.
const packageUpload = multer({
  storage: multer.diskStorage({}),
  limits: {
    fileSize: 4096 * MB,
    files: 5_000,
    parts: 5_000,
  },
});

const app = express();

function isMetadataUpload(file) {
  if (!file) return false;
  if (file.fieldname === "metadata") return true;
  const name = file.originalname || "";
  return name === "metadata.json" || name.endsWith("/metadata.json");
}

function readPublishMetadata(req) {
  for (const file of req.files ?? []) {
    if (!isMetadataUpload(file)) continue;
    if (file.buffer?.length) return file.buffer.toString("utf8");
  }

  const text = req.body?.metadata;
  if (typeof text === "string" && text.length > 0) return text;
  return null;
}

async function ensureDirs() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  await fs.mkdir(TILESETS_DIR, { recursive: true });
  await fs.mkdir(PACKAGES_DIR, { recursive: true });
}

// --- Server-sent events: notify the running authoring app about new packages ---
const sseClients = new Set();

function broadcastEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

function checkPublishAuth(req, res) {
  if (!PUBLISH_TOKEN) return true;
  const header = req.headers.authorization || "";
  if (header === `Bearer ${PUBLISH_TOKEN}`) return true;
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

app.post("/api/publish", upload.any(), async (req, res) => {
  if (!checkPublishAuth(req, res)) return;

  try {
    const metaField = readPublishMetadata(req);
    if (!metaField) {
      res.status(400).json({ error: "Missing metadata field" });
      return;
    }

    const metadata = JSON.parse(metaField);
    const { manifest, sessions = [], mirror = [] } = metadata;
    if (!manifest?.venues?.length) {
      res.status(400).json({ error: "Manifest must include at least one venue" });
      return;
    }

    const urlByKey = new Map();

    const filesByKey = new Map();
    for (const file of req.files ?? []) {
      if (isMetadataUpload(file)) continue;
      const name = file.originalname || file.fieldname;
      const slash = name.indexOf("/");
      if (slash <= 0) continue;
      const key = name.slice(0, slash);
      const rel = name.slice(slash + 1);
      if (!filesByKey.has(key)) filesByKey.set(key, []);
      filesByKey.get(key).push({ relativePath: rel, buffer: file.buffer });
    }

    for (const [key, files] of filesByKey) {
      urlByKey.set(key, await writeTilesetFiles(key, files));
    }

    for (const entry of mirror) {
      if (!entry?.key || !entry?.sourceUrl) continue;
      if (urlByKey.has(entry.key)) continue;
      urlByKey.set(entry.key, await mirrorTilesetFromUrl(entry.key, entry.sourceUrl));
    }

    await writeJsonAtomic(path.join(SESSIONS_DIR, "venues.json"), manifest);

    for (const session of sessions) {
      if (!session?.id || !session?.data) continue;
      await writeJsonAtomic(path.join(SESSIONS_DIR, `${session.id}.json`), session.data);
    }

    const origin = resolvePublishOrigin(req, metadata);
    const tilesets = Object.fromEntries(urlByKey);
    const links = {
      viewer: `${origin}/viewer.html?manifest=/sessions/venues.json`,
      venues: manifest.venues.map((v) => ({
        id: v.id,
        name: v.name,
        url: `${origin}/viewer.html?venue=${encodeURIComponent(v.id)}`,
      })),
      tilesets,
      tilesetCount: Object.keys(tilesets).length,
    };

    res.json({ ok: true, links });
  } catch (err) {
    console.error("Publish failed:", err);
    res.status(500).json({ error: err.message || "Publish failed" });
  }
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 30_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Receives a RevitGeoSuite Cesium package (multipart; part names are paths
// relative to the package root, cesium-package.json first). Stored under
// data/packages/<packageId>/ and announced over /api/events.
app.post("/api/import-package", packageUpload.any(), async (req, res) => {
  if (!checkPublishAuth(req, res)) return;

  const uploaded = req.files ?? [];
  const cleanupUploads = async () => {
    await Promise.all(uploaded.map((f) => f.path && fs.rm(f.path, { force: true }).catch(() => {})));
  };

  try {
    const manifestUpload = uploaded.find(
      (f) => resolveUploadRelativePath(f) === "cesium-package.json"
    );
    if (!manifestUpload) {
      res.status(400).json({ error: "The upload is missing cesium-package.json" });
      return;
    }

    const manifestText = await fs.readFile(manifestUpload.path, "utf8");
    const manifest = JSON.parse(manifestText);
    if (manifest?.schema !== "revitgeosuite.cesium-package") {
      res.status(400).json({ error: `Unexpected manifest schema "${manifest?.schema}"` });
      return;
    }

    const packageId = sanitizePackageId(manifest.packageId);
    if (!packageId) {
      res.status(400).json({ error: "Manifest packageId is missing or invalid" });
      return;
    }

    const files = uploaded.map((f) => ({
      relativePath: resolveUploadRelativePath(f),
      sourcePath: f.path,
    }));
    await storePackage(PACKAGES_DIR, packageId, files);

    const buildingId = manifest.building?.id ?? null;
    if (buildingId) {
      await prunePackagesForBuilding(PACKAGES_DIR, buildingId, 2);
    }

    const packageUrl = `/packages/${encodeURIComponent(packageId)}/`;
    broadcastEvent({
      type: "package-received",
      packageId,
      url: packageUrl,
      building: manifest.building ?? null,
    });

    res.json({ ok: true, packageId, packageUrl, building: manifest.building ?? null });
  } catch (err) {
    console.error("Package import failed:", err);
    await cleanupUploads();
    res.status(500).json({ error: err.message || "Package import failed" });
  }
});

app.use((err, req, res, next) => {
  if (!req.path.startsWith("/api")) {
    next(err);
    return;
  }
  console.error("API error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Server error" });
});

app.use("/sessions", express.static(SESSIONS_DIR, { fallthrough: false }));
app.use("/tilesets", express.static(TILESETS_DIR, { fallthrough: false }));
app.use("/packages", express.static(PACKAGES_DIR, { fallthrough: false }));
app.use(express.static(DIST));

app.use((req, res) => {
  res.status(404).send("Not found");
});

await ensureDirs();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cesium app server listening on http://0.0.0.0:${PORT}`);
  if (PUBLISH_TOKEN) console.log("Publish API requires PUBLISH_TOKEN");
});