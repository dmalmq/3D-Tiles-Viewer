import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRevitFeatureAppearance,
  findOwningBuilding,
  getRevitFeatureKey,
  getRevitFeatureLabel,
  hasRevitOverrides,
  normalizeRevitAppearance,
  normalizeRevitSettings,
  resolveRevitFeatureMode,
  revitGhostAlpha,
  setRevitCategoryOverride,
  setRevitFeatureOverride,
} from "../src/revitAppearance.js";
import { serializeSession } from "../src/session.js";

function fakeFeature(props) {
  return {
    show: true,
    color: { red: 1, green: 1, blue: 1, alpha: 1 },
    getProperty: (name) => props[name],
  };
}

const mass = fakeFeature({ revitUniqueId: "u-1", revitElementId: 11, category: "Mass", name: "Podium" });
const wall = fakeFeature({ revitUniqueId: "u-2", category: "Walls", name: "Basic Wall" });

test("feature keys prefer the Revit UniqueId, then the ElementId", () => {
  assert.equal(getRevitFeatureKey(mass), "uid:u-1");
  assert.equal(getRevitFeatureKey(fakeFeature({ revitElementId: 42 })), "eid:42");
  assert.equal(getRevitFeatureKey(fakeFeature({})), null);
  assert.equal(getRevitFeatureLabel(mass), "Mass · Podium");
});

test("an element override wins over its category override", () => {
  const appearance = normalizeRevitAppearance();
  setRevitCategoryOverride(appearance, "Mass", "ghost");
  assert.equal(resolveRevitFeatureMode(appearance, mass), "ghost");
  assert.equal(resolveRevitFeatureMode(appearance, wall), null);

  setRevitFeatureOverride(appearance, "uid:u-1", "hidden", "Podium");
  assert.equal(resolveRevitFeatureMode(appearance, mass), "hidden");

  setRevitFeatureOverride(appearance, "uid:u-1", null);
  assert.equal(resolveRevitFeatureMode(appearance, mass), "ghost");
  setRevitCategoryOverride(appearance, "Mass", null);
  assert.equal(hasRevitOverrides(appearance), false);
});

test("invalid modes and malformed saved data are rejected", () => {
  const appearance = normalizeRevitAppearance();
  assert.equal(setRevitFeatureOverride(appearance, "uid:x", "glow"), false);
  assert.equal(setRevitCategoryOverride(appearance, "Mass", "glow"), false);
  assert.deepEqual(
    normalizeRevitAppearance({ features: { a: { mode: "ghost" }, b: { mode: "bad" } }, categories: { Mass: "hidden", Walls: 3 } }),
    { features: { a: { mode: "ghost", label: "a" } }, categories: { Mass: "hidden" } },
  );
});

test("appearance applies hide and transparency on top of filter visibility", () => {
  const f = fakeFeature({});
  applyRevitFeatureAppearance(f, true, "ghost", 0.3);
  assert.equal(f.show, true);
  assert.ok(Math.abs(f.color.alpha - 0.3) < 1e-9);

  applyRevitFeatureAppearance(f, true, null, 0.3);
  assert.equal(f.color.alpha, 1, "clearing an override restores full opacity");

  applyRevitFeatureAppearance(f, true, "hidden", 0.3);
  assert.equal(f.show, false);

  applyRevitFeatureAppearance(f, false, "ghost", 0.3);
  assert.equal(f.show, false, "level filter still wins");
});

test("settings are clamped and colours validated", () => {
  assert.deepEqual(normalizeRevitSettings({ transparencyPercent: 150, highlightPercent: "40", highlightColor: "#ABCDEF" }), {
    transparencyPercent: 100,
    highlightPercent: 40,
    highlightColor: "#abcdef",
  });
  assert.equal(normalizeRevitSettings({ highlightColor: "red" }).highlightColor, "#ff9f1c");
  assert.ok(Math.abs(revitGhostAlpha({ transparencyPercent: 70 }) - 0.3) < 1e-9);
});

test("owning building follows the link filter", () => {
  const a = { name: "A", linkFilter: { property: "sourceLinkName", value: "A.rvt" } };
  const b = { name: "B", linkFilter: { property: "sourceLinkName", value: "B.rvt" } };
  assert.equal(findOwningBuilding([a, b], fakeFeature({ sourceLinkName: "B.rvt" })), b);
  assert.equal(findOwningBuilding([a, b], fakeFeature({ sourceLinkName: "C.rvt" })), null);
  const solo = { name: "solo" };
  assert.equal(findOwningBuilding([solo], mass), solo);
});

test("sessions save building overrides and Revit settings", () => {
  const appearance = normalizeRevitAppearance();
  setRevitCategoryOverride(appearance, "Mass", "ghost");
  const session = serializeSession({
    imagery: "osm",
    terrain: "none",
    plateauOverridesEnabled: true,
    revitSettings: { transparencyPercent: 55, highlightPercent: 30, highlightColor: "#00aaff" },
    modelLevels: [],
    activeModelLevelIndex: -1,
    buildings: [
      { name: "with", levels: [], shapefileLayers: [], appearance },
      { name: "without", levels: [], shapefileLayers: [] },
    ],
    importedLayers: [],
    unassignedLayers: [],
    isPlateauLayer: () => false,
    serializePlateauOverrides: () => [],
  });
  assert.deepEqual(session.revitSettings, { transparencyPercent: 55, highlightPercent: 30, highlightColor: "#00aaff" });
  assert.deepEqual(session.buildings[0].appearance, { features: {}, categories: { Mass: "ghost" } });
  assert.equal("appearance" in session.buildings[1], false);
});
