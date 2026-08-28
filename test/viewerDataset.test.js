import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MANIFEST_URL } from "../src/venueManifest.js";
import {
  SAMPLE_SESSION_URL,
  SAMPLE_TILESET_URL,
  canRestoreDatasetFromSource,
  inferLocalTilesetName,
  isDirectoryPickerAbort,
  isLocalDatasetUploadRequest,
  resolveViewerDatasetFromParams,
  shouldFallbackToDirectoryInput,
  withAppBase,
} from "../src/viewerDataset.js";

test("viewer.html with no query params defaults to the public sample session", () => {
  const plan = resolveViewerDatasetFromParams(new URLSearchParams());
  assert.equal(plan.kind, "sample");
  assert.equal(plan.url, SAMPLE_SESSION_URL);
});

test("session, manifest, venue, and tileset query params take precedence", () => {
  assert.deepEqual(
    resolveViewerDatasetFromParams(new URLSearchParams("session=/sessions/east-hub.json")),
    { kind: "session", url: "/sessions/east-hub.json" },
  );
  assert.deepEqual(
    resolveViewerDatasetFromParams(new URLSearchParams("manifest=/sessions/venues.json&venue=east-hub")),
    { kind: "manifest", url: "/sessions/venues.json", venueId: "east-hub" },
  );
  assert.deepEqual(
    resolveViewerDatasetFromParams(new URLSearchParams("venue=east-hub")),
    { kind: "manifest", url: DEFAULT_MANIFEST_URL, venueId: "east-hub" },
  );
  assert.deepEqual(
    resolveViewerDatasetFromParams(new URLSearchParams(`tileset=${SAMPLE_TILESET_URL}`)),
    { kind: "tileset", url: SAMPLE_TILESET_URL },
  );
});

test("inferLocalTilesetName uses the folder segment from a directory pick", () => {
  assert.equal(
    inferLocalTilesetName([{ webkitRelativePath: "my-site/tileset.json", name: "tileset.json" }]),
    "my-site",
  );
  assert.equal(inferLocalTilesetName([{ name: "tileset.json" }]), "Local tileset");
});

test("local folder viewing must not POST to publish or package APIs", () => {
  assert.equal(isLocalDatasetUploadRequest("/tiles/sample-indoor/tileset.json", "GET"), false);
  assert.equal(isLocalDatasetUploadRequest("/api/publish", "POST"), true);
  assert.equal(isLocalDatasetUploadRequest("/api/import-package", "POST"), true);
  assert.equal(isLocalDatasetUploadRequest("http://localhost:5173/api/publish", "POST"), true);
  assert.equal(isLocalDatasetUploadRequest("/tilesets/dir-1/tileset.json", "GET"), false);
  assert.equal(isLocalDatasetUploadRequest("/tilesets/dir-1/tileset.json", "PUT"), true);
});

test("directory picker abort does not fall through; permission errors do", () => {
  assert.equal(isDirectoryPickerAbort({ name: "AbortError" }), true);
  assert.equal(shouldFallbackToDirectoryInput({ name: "AbortError" }), false);
  assert.equal(shouldFallbackToDirectoryInput({ name: "SecurityError" }), true);
  assert.equal(shouldFallbackToDirectoryInput({ name: "NotAllowedError" }), true);
  assert.equal(shouldFallbackToDirectoryInput({ name: "TypeError" }), false);
});

test("only sample and shared-with-query can be reloaded; local cannot", () => {
  assert.equal(canRestoreDatasetFromSource("local", new URLSearchParams()), false);
  assert.equal(canRestoreDatasetFromSource("sample", new URLSearchParams()), true);
  assert.equal(canRestoreDatasetFromSource("shared", new URLSearchParams()), false);
  assert.equal(
    canRestoreDatasetFromSource("shared", new URLSearchParams("manifest=/sessions/venues.json")),
    true,
  );
  assert.equal(
    canRestoreDatasetFromSource("shared", new URLSearchParams("venue=east-hub")),
    true,
  );
});

test("withAppBase joins Vite BASE_URL without doubling or dropping slashes", () => {
  assert.equal(withAppBase("tiles/sample-indoor/tileset.json", "/"), "/tiles/sample-indoor/tileset.json");
  assert.equal(withAppBase("/tiles/sample-indoor/session.json", "/"), "/tiles/sample-indoor/session.json");
  assert.equal(
    withAppBase("tiles/sample-indoor/tileset.json", "/3D-Tiles-Viewer/"),
    "/3D-Tiles-Viewer/tiles/sample-indoor/tileset.json",
  );
  assert.equal(
    withAppBase("/tiles/sample-indoor/tileset.json", "/3D-Tiles-Viewer"),
    "/3D-Tiles-Viewer/tiles/sample-indoor/tileset.json",
  );
  assert.equal(withAppBase("tiles/x.json", "./"), "./tiles/x.json");
  assert.equal(
    withAppBase("tiles/x.json", "https://cdn.example.test/app/"),
    "https://cdn.example.test/app/tiles/x.json",
  );
});

test("sample URLs use the configured app base (default / in Node)", () => {
  assert.equal(SAMPLE_TILESET_URL, withAppBase("tiles/sample-indoor/tileset.json"));
  assert.equal(SAMPLE_SESSION_URL, withAppBase("tiles/sample-indoor/session.json"));
});
