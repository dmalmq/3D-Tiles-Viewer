import test from "node:test";
import assert from "node:assert/strict";

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
    },
  });
}

if (!globalThis.navigator) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en" },
  });
}

const { decideAutoSplit, inspectLinks } = await import("../src/linkSplitter.js");

function makeTileset(rows) {
  const content = {
    featuresLength: rows.length,
    getFeature(index) {
      const row = rows[index];
      return {
        getProperty: (name) => row[name],
        getPropertyIds: () => Object.keys(row),
      };
    },
  };

  return {
    root: { content, children: [] },
    tileLoad: {
      addEventListener: () => () => {},
    },
  };
}

test("inspectLinks resolves immediately for a fully loaded tileset with no features", async () => {
  const tileset = makeTileset([]);
  tileset.tilesLoaded = true;

  const started = Date.now();
  const inspection = await inspectLinks(tileset, { safetyTimeoutMs: 60000 });
  assert.ok(Date.now() - started < 1000, "should not wait for the safety timer");
  assert.equal(inspection.groups.size, 0);
});

test("inspectLinks resolves on allTilesLoaded when no features were found", async () => {
  const tileset = makeTileset([]);
  let fireAllLoaded = null;
  tileset.allTilesLoaded = {
    addEventListener(fn) {
      fireAllLoaded = fn;
      return () => {};
    },
  };

  const started = Date.now();
  const pending = inspectLinks(tileset, { safetyTimeoutMs: 60000 });
  assert.ok(fireAllLoaded, "listener should be registered");
  fireAllLoaded();
  const inspection = await pending;
  assert.ok(Date.now() - started < 1000, "should not wait for the safety timer");
  assert.equal(inspection.groups.size, 0);
});

test("inspectLinks keeps level metadata when sourceLinkName is absent", async () => {
  const inspection = await inspectLinks(makeTileset([
    {
      levelKey: "level-1",
      levelName: "1F",
      levelElevationMeters: 0,
      minZMeters: 0,
      maxZMeters: 4,
    },
    {
      levelKey: "level-2",
      levelName: "2F",
      levelElevationMeters: 4,
      minZMeters: 4,
      maxZMeters: 8,
    },
  ]), { tailTimeoutMs: 0, safetyTimeoutMs: 50 });

  assert.equal(inspection.groups.size, 1);
  assert.equal(decideAutoSplit(inspection), null);

  const host = inspection.groups.get("");
  assert.equal(host.count, 2);
  assert.deepEqual(
    host.levels.map(l => [l.levelKey, l.levelName, l.levelElevationMeters]),
    [
      ["level-1", "1F", 0],
      ["level-2", "2F", 4],
    ],
  );
});
