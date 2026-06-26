import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublishOrigin } from "../server/publishOrigin.js";

test("resolvePublishOrigin prefers viewerOrigin from publish metadata", () => {
  const req = { protocol: "http", get: () => "localhost:3001" };
  assert.equal(
    resolvePublishOrigin(req, { viewerOrigin: "http://localhost:5173" }),
    "http://localhost:5173",
  );
});

test("resolvePublishOrigin uses x-forwarded-host when metadata has no origin", () => {
  const req = {
    protocol: "http",
    get: (name) => {
      if (name === "x-forwarded-host") return "localhost:5174";
      if (name === "x-forwarded-proto") return "http";
      if (name === "host") return "localhost:3001";
      return undefined;
    },
  };
  assert.equal(resolvePublishOrigin(req, {}), "http://localhost:5174");
});

test("resolvePublishOrigin falls back to request host", () => {
  const req = { protocol: "http", get: (name) => (name === "host" ? "localhost:3000" : undefined) };
  assert.equal(resolvePublishOrigin(req, {}), "http://localhost:3000");
});