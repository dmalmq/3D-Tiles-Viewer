import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mirrorTilesetFromUrl, writeTilesetFiles } from "./tilesetMirror.js";
import { resolvePublishOrigin } from "./publishOrigin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const DATA_ROOT = path.join(ROOT, "data");
const SESSIONS_DIR = path.join(DATA_ROOT, "sessions");
const TILESETS_DIR = path.join(DATA_ROOT, "tilesets");

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
      viewer: `${origin}/viewer.html`,
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
app.use(express.static(DIST));

app.use((req, res) => {
  res.status(404).send("Not found");
});

await ensureDirs();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cesium app server listening on http://0.0.0.0:${PORT}`);
  if (PUBLISH_TOKEN) console.log("Publish API requires PUBLISH_TOKEN");
});