import test from "node:test";
import assert from "node:assert/strict";

import { computeBreadcrumb, computeWorkflowState } from "../src/workflowState.js";

test("an empty session is on the Load step", () => {
  const state = computeWorkflowState({ buildings: [], venues: [] });
  assert.deepEqual(state.done, { load: false, author: false, venue: false, publish: false });
  assert.equal(state.current, "load");
});

test("buildings without levels move the user to Author", () => {
  const state = computeWorkflowState({
    buildings: [{ name: "A", levels: [{ name: "1F" }] }, { name: "B", levels: [] }],
  });
  assert.equal(state.done.load, true);
  assert.equal(state.done.author, false);
  assert.equal(state.current, "author");
});

test("Venue is done only when every building is in an existing venue", () => {
  const venues = [{ id: "campus", name: "Campus" }];
  const partly = computeWorkflowState({
    buildings: [
      { name: "A", levels: [{ name: "1F" }], venueId: "campus" },
      { name: "B", levels: [{ name: "1F" }], venueId: null },
    ],
    venues,
  });
  assert.equal(partly.current, "venue");

  const stale = computeWorkflowState({
    buildings: [{ name: "A", levels: [{ name: "1F" }], venueId: "deleted" }],
    venues,
  });
  assert.equal(stale.done.venue, false);

  const all = computeWorkflowState({
    buildings: [{ name: "A", levels: [{ name: "1F" }], venueId: "campus" }],
    venues,
  });
  assert.equal(all.done.venue, true);
  assert.equal(all.current, "publish");
});

test("breadcrumb prefers the venue filter, then the selected building's venue", () => {
  const venues = [{ id: "a", name: "Campus A" }, { id: "b", name: "Campus B" }];
  const buildings = [{ name: "Tower", venueId: "a" }];

  assert.deepEqual(
    computeBreadcrumb({ buildings, venues, selectedBuildingIndex: 0 }),
    { venue: "Campus A", building: "Tower" }
  );
  assert.deepEqual(
    computeBreadcrumb({ buildings, venues, selectedBuildingIndex: 0, activeVenueFilter: "b" }),
    { venue: "Campus B", building: "Tower" }
  );
  assert.deepEqual(
    computeBreadcrumb({ buildings, venues, selectedBuildingIndex: -1 }),
    { venue: null, building: null }
  );
});
