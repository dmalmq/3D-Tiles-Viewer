import test from "node:test";
import assert from "node:assert/strict";

import { extractFloorNumber, extractFloorPrefix, levelNameToNumber } from "../src/floorSplit.js";
import {
  buildFloorAltitudeHints,
  levelTpOffset,
  parseLevelTpMeters,
  resolveFloorLevel,
  splitByFloorLevel,
} from "../src/gdbLevelMatch.js";

// A slice of the Tokyo Station model's levels: elevations are in the model
// frame, where TP±0 sits at -87.355 m.
const level = (name, floor, elementCount = 100) => ({ name, key: name, floor, elementCount });
const LEVELS = [
  level("B4FL_京葉線ホーム（TP-27.30）", -114.655),
  level("B4FL_総武線コンコース（TP-15.80）", -103.155),
  level("B3FL_京葉線コンコース（TP-21.00）", -108.355),
  level("B1F_有楽町線有楽町駅コンコース-2,560", -97.355, 247),
  level("B1FL_八重洲地下街・東京ミッドタウン八重洲(TP-2.0)", -89.355, 1927),
  level("B1FL", -90.865, 756),
  level("B1FL_GRANROOF～GranAge（TP-2.00）", -89.355, 522),
  level("TP±0", -87.355, 7),
  level("1FL", -84.265, 507),
  level("1FL_コンコース（TP+3.45）", -83.905, 2660),
  level("M2FL（TP+4.45）", -82.905, 331),
  level("M2FL_東海道新幹線コンコース（TP+6.10）", -81.255, 102),
];

const point = (floor, altitude) => ({ type: "Feature", properties: { floor, ...(altitude != null ? { altitude } : {}) } });

test("floor codes: mezzanines, prefixed line codes and plain codes", () => {
  assert.equal(extractFloorNumber("M2"), 1.5);
  assert.equal(extractFloorNumber("M2F"), 1.5);
  assert.equal(extractFloorNumber("中2階"), 1.5);
  assert.equal(levelNameToNumber("M2FL（TP+4.45）"), 1.5);
  assert.equal(extractFloorNumber("KB3"), -3);
  assert.equal(extractFloorNumber("SB5"), -5);
  assert.equal(extractFloorPrefix("KB3"), "K");
  assert.equal(extractFloorPrefix("B3"), null);
  assert.equal(extractFloorNumber("F35"), 35);
  assert.equal(extractFloorNumber("35F"), 35);
  assert.equal(extractFloorNumber("B1"), -1);
});

test("TP heights parse in metres and millimetres", () => {
  assert.equal(parseLevelTpMeters("1FL_コンコース（TP+3.45）"), 3.45);
  assert.equal(parseLevelTpMeters("JR東京駅コンコース地下1階（TP-4,130）"), -4.13);
  assert.equal(parseLevelTpMeters("B1F_行幸地下ギャラリー（TP+150）"), 0.15);
  assert.equal(parseLevelTpMeters("TP±0"), 0);
  assert.equal(parseLevelTpMeters("B1FL"), null);
  assert.ok(Math.abs(levelTpOffset(LEVELS) - -87.355) < 1e-9);
});

test("altitude picks the level at the matching TP height", () => {
  const b1 = resolveFloorLevel({ floorValue: "B1", features: [point("B1", -2), point("B1", -2)], levels: LEVELS });
  assert.equal(b1.reason, "altitude");
  assert.match(b1.level.name, /TP-2/);
  const m2 = resolveFloorLevel({ floorValue: "M2", features: [point("M2", 6.1)], levels: LEVELS });
  assert.equal(m2.level.name, "M2FL_東海道新幹線コンコース（TP+6.10）");
});

test("line prefixes pick the line's level", () => {
  const sb4 = resolveFloorLevel({ floorValue: "SB4", levels: LEVELS });
  assert.equal(sb4.level.name, "B4FL_総武線コンコース（TP-15.80）");
  assert.equal(sb4.reason, "line");
  const kb4 = resolveFloorLevel({ floorValue: "KB4", levels: LEVELS });
  assert.equal(kb4.level.name, "B4FL_京葉線ホーム（TP-27.30）");
});

test("without altitude, the plain level wins over line-specific ones", () => {
  assert.equal(resolveFloorLevel({ floorValue: "B1", levels: LEVELS }).level.name, "B1FL");
  assert.equal(resolveFloorLevel({ floorValue: "F1", levels: LEVELS }).level.name, "1FL");
  assert.equal(resolveFloorLevel({ floorValue: "M2", levels: LEVELS }).level.name, "M2FL（TP+4.45）");
});

test("layers without altitude borrow it from sibling layers", () => {
  const withAltitude = { features: [point("B1", -2), point("B1", -2), point("F1", 3.45)] };
  const hints = buildFloorAltitudeHints([withAltitude, { features: [point("B1")] }]);
  const resolved = resolveFloorLevel({ floorValue: "B1", features: [point("B1")], levels: LEVELS, altitudeHints: hints });
  assert.equal(resolved.reason, "altitude");
  assert.match(resolved.level.name, /TP-2/);
  // "1F" and "F1" share a hint.
  const oneF = resolveFloorLevel({ floorValue: "1F", features: [point("1F")], levels: LEVELS, altitudeHints: hints });
  assert.equal(oneF.level.name, "1FL_コンコース（TP+3.45）");
});

test("altitude far from every candidate is ignored", () => {
  const resolved = resolveFloorLevel({ floorValue: "B1", features: [point("B1", 40)], levels: LEVELS });
  assert.equal(resolved.level.name, "B1FL");
  assert.equal(resolved.reason, "canonical");
});

test("split groups features by floor and reports unmatched floors", () => {
  const parts = splitByFloorLevel([point("B1"), point("F1"), point("F9"), point("B1"), point(null)], LEVELS);
  assert.deepEqual(parts.map((p) => [p.floorValue, p.features.length, p.level?.name ?? null]), [
    ["B1", 2, "B1FL"],
    ["F1", 1, "1FL"],
    ["F9", 1, null],
    [null, 1, null],
  ]);
});

test("floor numbers format as short labels", async () => {
  const { formatFloorNumber } = await import("../src/floorSplit.js");
  assert.equal(formatFloorNumber(1), "1F");
  assert.equal(formatFloorNumber(36), "36F");
  assert.equal(formatFloorNumber(-2), "B2F");
  assert.equal(formatFloorNumber(1.5), "M2F");
});
