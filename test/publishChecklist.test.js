import test from "node:test";
import assert from "node:assert/strict";

import { computePublishChecklist } from "../src/publishChecklist.js";

const byId = (result) => Object.fromEntries(result.items.map((item) => [item.id, item]));

test("publishing is blocked until a venue has buildings", () => {
  const empty = computePublishChecklist({ buildings: [], venues: [] });
  assert.equal(empty.canPublish, false);
  assert.equal(byId(empty).venues.status, "block");

  const unassigned = computePublishChecklist({
    buildings: [{ name: "A", tileset: {}, levels: [{ name: "1F" }], venueId: null }],
    venues: [{ id: "campus", name: "Campus" }],
  });
  assert.equal(unassigned.canPublish, false);
  assert.equal(byId(unassigned).outside.status, "warn");
});

test("a complete venue passes every check", () => {
  const result = computePublishChecklist({
    buildings: [{ name: "A", tileset: {}, levels: [{ name: "1F" }], venueId: "campus" }],
    venues: [{ id: "campus", name: "Campus" }],
    unassignedLayers: [],
  });
  assert.equal(result.canPublish, true);
  assert.equal(result.hasWarnings, false);
  assert.ok(result.items.every((item) => item.status === "ok"));
  assert.deepEqual(byId(result).venues.params, { count: 1 });
});

test("missing models, levels and stray layers are warnings, not blockers", () => {
  const result = computePublishChecklist({
    buildings: [
      { name: "A", tileset: null, levels: [], venueId: "campus" },
      { name: "B", tileset: {}, levels: [{ name: "1F" }], venueId: "campus" },
      { name: "C", tileset: {}, levels: [{ name: "1F" }], venueId: "gone" },
    ],
    venues: [{ id: "campus", name: "Campus" }],
    unassignedLayers: [{ name: "stray" }, { name: "stray2" }],
  });
  const items = byId(result);
  assert.equal(result.canPublish, true);
  assert.equal(result.hasWarnings, true);
  assert.equal(items.models.params.names, "A");
  assert.equal(items.levels.params.names, "A");
  assert.equal(items.outside.params.count, 1);
  assert.equal(items.layers.params.count, 2);
});

test("long building lists are shortened", () => {
  const buildings = ["A", "B", "C", "D", "E"].map((name) => ({ name, tileset: null, levels: [], venueId: "v" }));
  const result = computePublishChecklist({ buildings, venues: [{ id: "v", name: "V" }] });
  assert.equal(byId(result).models.params.names, "A, B, C +2");
});

test("checks every building while none are in a venue", () => {
  const result = computePublishChecklist({
    buildings: [{ name: "Tower", tileset: {}, _tilesetMissing: true, levels: [] }],
    venues: [],
  });
  const items = byId(result);
  assert.equal(items.models.status, "warn");
  assert.equal(items.models.params.names, "Tower");
  assert.equal(items.levels.status, "warn");
});
