import { test, expect } from "@playwright/test";
import { prepareCleanApp } from "./helpers.js";

test("importing the last group closes the review dialog and its scrim", async ({ page }) => {
  test.setTimeout(120_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  await page.evaluate(async () => {
    const { openImportReviewTray } = await import("/src/importReviewTray.js");
    window.__importedDecisions = 0;
    openImportReviewTray({
      featureCollections: [{
        fileName: "Rooms.gdb",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.76, 35.68] },
          properties: { source: "Annex" },
        }],
      }],
      buildings: [],
      viewer: null,
      mode: "import",
      onImport: async (decisions) => { window.__importedDecisions = decisions.length; },
      onSilentImport: () => {},
      onUndoAutoImport: () => {},
    });
  });

  const tray = page.locator("#importReviewTray");
  await expect(tray).toBeVisible();
  await expect(page.locator(".import-tray-scrim")).toHaveCount(1);

  await tray.locator(".import-tray-footer .primary-btn").click();

  await expect(tray).toHaveCount(0);
  await expect(page.locator(".import-tray-scrim")).toHaveCount(0);
  expect(await page.evaluate(() => window.__importedDecisions)).toBe(1);

  // The app is usable again: the Add data dialog opens.
  await page.locator("#addDataBtn").click();
  await expect(page.locator("#addDataDialog")).toBeVisible();

  expect(errors).toEqual([]);
});
