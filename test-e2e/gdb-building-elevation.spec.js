import { test, expect } from "@playwright/test";
import { prepareCleanApp } from "./helpers.js";

test("reviewed GDB floor rows resolve against their selected building", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  await page.evaluate(async () => {
    const { openImportReviewTray } = await import("/src/importReviewTray.js");
    const feature = (floor) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [139.76, 35.68] },
      properties: { source: "Tower A", ...(floor ? { floor } : {}) },
    });
    openImportReviewTray({
      featureCollections: [{
        fileName: "Tower_A_units.shp",
        features: [feature("1F"), feature("2F"), feature(null)],
      }],
      buildings: [
        { name: "Tower A", levels: [{ key: "a1", name: "1F" }, { key: "a2", name: "2F" }] },
        { name: "Tower B", levels: [{ key: "b1", name: "1F" }, { key: "b2", name: "2F" }] },
      ],
      viewer: null,
      onImport: (decisions) => { window.__gdbDecisions = decisions; },
      onSilentImport: () => {},
    });
  });

  const tray = page.locator("#importReviewTray");
  const rows = tray.locator(".import-tray-member");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator("select").nth(1)).toHaveValue("a1");
  await expect(rows.nth(1).locator("select").nth(1)).toHaveValue("a2");
  await expect(rows.nth(2).locator("select").nth(1)).toHaveValue("__all__");

  await rows.nth(0).locator("select").first().selectOption("1");
  await expect(rows.nth(0).locator("select").nth(1)).toHaveValue("b1");
  await expect(rows.nth(1).locator("select").nth(1)).toHaveValue("a2");
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(rows.nth(0)).toBeVisible();
    const trayBox = await tray.boundingBox();
    const floorBox = await rows.nth(0).locator("select").nth(1).boundingBox();
    expect(trayBox.x).toBeGreaterThanOrEqual(0);
    expect(trayBox.x + trayBox.width).toBeLessThanOrEqual(width);
    expect(floorBox.x + floorBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/gdb-building-elevation-${width}.png` });
  }

  await tray.locator(".import-tray-footer .primary-btn").click();
  const decisions = await page.evaluate(() => window.__gdbDecisions?.map((decision) => ({
    floor: decision.fc.features[0]?.properties?.floor ?? null,
    buildingIndex: decision.target.buildingIndex,
    levelKey: decision.target.levelKey,
  })));
  expect(decisions).toEqual([
    { floor: "1F", buildingIndex: 1, levelKey: "b1" },
    { floor: "2F", buildingIndex: 0, levelKey: "a2" },
    { floor: null, buildingIndex: 0, levelKey: null },
  ]);
  expect(errors).toEqual([]);
});
