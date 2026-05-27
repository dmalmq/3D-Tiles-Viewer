import test from "node:test";
import assert from "node:assert/strict";

import { resolveAutoPlateauAreaSelection } from "../src/plateauAreaSelection.js";

const shinjuku = { code: "13104", label: "東京都 新宿区" };
const shibuya = { code: "13113", label: "東京都 渋谷区" };

test("auto PLATEAU area detection replaces previous areas with the latest result", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    currentAreas: [shinjuku],
    currentSource: "map",
    detected: [{ area: shibuya, source: "map" }],
    fallbackSource: "map",
  });

  assert.deepEqual(next.areas, [shibuya]);
  assert.equal(next.source, "map");
});

test("auto PLATEAU area detection clears stale areas when nothing is detected", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    currentAreas: [shinjuku],
    currentSource: "map",
    detected: [],
    fallbackSource: "map",
  });

  assert.deepEqual(next.areas, []);
  assert.equal(next.source, null);
});

test("manual PLATEAU area selection is not overwritten by detection", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "manual",
    currentAreas: [shinjuku],
    currentSource: "manual",
    detected: [{ area: shibuya, source: "map" }],
    fallbackSource: "map",
  });

  assert.deepEqual(next.areas, [shinjuku]);
  assert.equal(next.source, "manual");
});

test("fallbackSource takes precedence over the first detected entry's source", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    detected: [{ area: shibuya, source: "map" }],
    fallbackSource: "geolocation",
  });

  assert.equal(next.source, "geolocation");
});

test("when fallbackSource is null, the first detected entry's source is used", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    detected: [{ area: shibuya, source: "map" }],
    fallbackSource: null,
  });

  assert.equal(next.source, "map");
});

test("duplicate detected areas are de-duplicated by area code", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    detected: [
      { area: shibuya, source: "map" },
      { area: { ...shibuya }, source: "map" },
      { area: shinjuku, source: "map" },
    ],
    fallbackSource: "map",
  });

  assert.equal(next.areas.length, 2);
  assert.deepEqual(next.areas.map(a => a.code).sort(), ["13104", "13113"]);
});

test("detected entries may be plain area objects (no wrapper)", () => {
  const next = resolveAutoPlateauAreaSelection({
    selectionMode: "auto",
    detected: [shibuya],
    fallbackSource: "map",
  });

  assert.deepEqual(next.areas, [shibuya]);
  assert.equal(next.source, "map");
});

test("unknown selectionMode falls back to manual (preserves current state)", () => {
  // Squelch the validation warning that this code path emits.
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const next = resolveAutoPlateauAreaSelection({
      selectionMode: "automatic", // typo
      currentAreas: [shinjuku],
      currentSource: "manual",
      detected: [{ area: shibuya, source: "map" }],
      fallbackSource: "map",
    });
    assert.deepEqual(next.areas, [shinjuku]);
    assert.equal(next.source, "manual");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown selectionMode/);
  } finally {
    console.warn = origWarn;
  }
});
