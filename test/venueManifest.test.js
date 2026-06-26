import test from "node:test";
import assert from "node:assert/strict";

import {
  parseVenueManifest,
  getDefaultVenueId,
  resolveVenueSessionUrl,
  resolveVenueIdFromParams,
} from "../src/venueManifest.js";

test("parseVenueManifest accepts a valid manifest", () => {
  const manifest = parseVenueManifest(JSON.stringify({
    version: 1,
    defaultVenueId: "east-hub",
    venues: [
      { id: "east-hub", name: "East Hub", sessionUrl: "east-hub.json" },
      { id: "west-campus", name: "West Campus", sessionUrl: "west-campus.json" },
    ],
  }));
  assert.equal(manifest.venues.length, 2);
  assert.equal(getDefaultVenueId(manifest), "east-hub");
  assert.equal(resolveVenueSessionUrl(manifest, "west-campus"), "west-campus.json");
});

test("resolveVenueIdFromParams returns null when absent", () => {
  assert.equal(resolveVenueIdFromParams(new URLSearchParams("")), null);
});

test("parseVenueManifest rejects invalid payloads", () => {
  assert.throws(() => parseVenueManifest("[]"), /manifest object/);
  assert.throws(() => parseVenueManifest(JSON.stringify({ version: 2, venues: [] })), /version/);
  assert.throws(() => parseVenueManifest(JSON.stringify({ version: 1, venues: [] })), /at least one venue/);
});