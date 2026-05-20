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
