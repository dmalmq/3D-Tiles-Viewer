import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEntityContextState,
  applyEntitiesContextState,
  rememberEntityContextStyle,
} from "../src/contextGhosting.js";

test("entity context ghosting restores original materials and visibility", () => {
  const entity = {
    show: true,
    polygon: { material: "polygon-original" },
    polyline: { material: "polyline-original" },
    point: { color: "point-original" },
  };

  applyEntityContextState(entity, { ghosted: true, ghostStyle: "ghost" });
  assert.equal(entity.show, true);
  assert.equal(entity.polygon.material, "ghost");
  assert.equal(entity.polyline.material, "ghost");
  assert.equal(entity.point.color, "ghost");

  applyEntityContextState(entity, { ghosted: false, ghostStyle: "ghost" });
  assert.equal(entity.show, true);
  assert.equal(entity.polygon.material, "polygon-original");
  assert.equal(entity.polyline.material, "polyline-original");
  assert.equal(entity.point.color, "point-original");
});

test("entity context ghosting preserves originally hidden entities", () => {
  const entity = {
    show: false,
    polygon: { material: "polygon-original" },
  };

  applyEntityContextState(entity, { ghosted: true, ghostStyle: "ghost" });
  assert.equal(entity.show, false);
  assert.equal(entity.polygon.material, "ghost");

  applyEntityContextState(entity, { ghosted: false, ghostStyle: "ghost" });
  assert.equal(entity.show, false);
  assert.equal(entity.polygon.material, "polygon-original");
});

test("entity context ghosting combines original visibility with layer visibility", () => {
  const visibleEntity = { show: true, polygon: { material: "original" } };
  const hiddenEntity = { show: false, polygon: { material: "original" } };

  applyEntityContextState(visibleEntity, { ghosted: false, layerVisible: false });
  applyEntityContextState(hiddenEntity, { ghosted: false, layerVisible: true });

  assert.equal(visibleEntity.show, false);
  assert.equal(hiddenEntity.show, false);
});

test("rememberEntityContextStyle is idempotent — repeat calls keep the first snapshot", () => {
  const entity = { show: true, polygon: { material: "first" } };
  const snapshot1 = rememberEntityContextStyle(entity);
  // Mutate after the snapshot — a re-snapshot would capture the new value.
  entity.polygon.material = "second";
  const snapshot2 = rememberEntityContextStyle(entity);
  assert.strictEqual(snapshot1, snapshot2);
  assert.equal(snapshot2.polygonMaterial, "first");
});

test("rememberEntityContextStyle returns null for falsy entities", () => {
  assert.equal(rememberEntityContextStyle(null), null);
  assert.equal(rememberEntityContextStyle(undefined), null);
});

test("entity with no matching geometry types is handled without throwing", () => {
  const entity = { show: true };
  assert.doesNotThrow(() => {
    applyEntityContextState(entity, { ghosted: true, ghostStyle: "ghost" });
    applyEntityContextState(entity, { ghosted: false });
  });
  assert.equal(entity.show, true);
});

test("applyEntitiesContextState tolerates falsy and missing entries", () => {
  const entity = { show: true, polygon: { material: "p" } };
  assert.doesNotThrow(() => {
    applyEntitiesContextState([null, undefined, entity], { ghosted: true, ghostStyle: "g" });
  });
  assert.equal(entity.polygon.material, "g");
  // null / undefined arrays should be a no-op rather than a throw.
  assert.doesNotThrow(() => applyEntitiesContextState(undefined, { ghosted: false }));
  assert.doesNotThrow(() => applyEntitiesContextState(null, { ghosted: false }));
});

test("applyEntityContextState restores cylinder and billboard materials too", () => {
  const entity = {
    show: true,
    cylinder: { material: "cyl-original" },
    billboard: { color: "bb-original" },
  };
  applyEntityContextState(entity, { ghosted: true, ghostStyle: "ghost" });
  assert.equal(entity.cylinder.material, "ghost");
  assert.equal(entity.billboard.color, "ghost");
  applyEntityContextState(entity, { ghosted: false });
  assert.equal(entity.cylinder.material, "cyl-original");
  assert.equal(entity.billboard.color, "bb-original");
});
