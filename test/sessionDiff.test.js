import test from "node:test";
import assert from "node:assert/strict";

import { diffSessions } from "../src/sessionDiff.js";

test("diffSessions reports venue and building moves", () => {
  const before = {
    venues: [{ id: "east-hub", name: "East Hub", description: "" }],
    buildings: [{ name: "Tower A", venueId: null, levels: [], shapefileLayers: [] }],
    imagery: "osm",
  };
  const after = {
    venues: [
      { id: "east-hub", name: "East Hub", description: "notes" },
      { id: "west-campus", name: "West Campus", description: "" },
    ],
    buildings: [{ name: "Tower A", venueId: "east-hub", levels: [{ name: "1F" }], shapefileLayers: [] }],
    imagery: "carto-positron",
  };
  const changes = diffSessions(before, after);
  assert.ok(changes.some((c) => c.type === "added" && c.id === "west-campus"));
  assert.ok(changes.some((c) => c.type === "venueMoved" && c.name === "Tower A"));
  assert.ok(changes.some((c) => c.category === "settings" && c.field === "imagery"));
});