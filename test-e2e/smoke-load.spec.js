import { test, expect } from "@playwright/test";
import { loadSampleTileset, prepareCleanApp, waitForTilesetRenderSignal } from "./helpers.js";

test("app loads and registers the sample tileset", async ({ page }) => {
  test.setTimeout(120_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page);
  await page.goto("/");

  await expect(page.locator("#appHeader")).toBeVisible();
  await expect(page.locator("#cesiumContainer")).toBeVisible();
  await expect(page.locator("#leftPanel")).toBeVisible();

  // Header title in default language (EN unless localStorage already says JA).
  await expect(page.locator('[data-i18n="header.title"]')).toBeVisible();

  // Empty-state placeholder should be visible before any tileset is added.
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  await loadSampleTileset(page);
  await expect(page.locator("#noScenePlaceholder")).toBeHidden();
  await expect(page.locator(".bldg-row .bldg-name").filter({ hasText: "tileset.json" })).toBeVisible();
  await waitForTilesetRenderSignal(page);

  expect(errors).toEqual([]);
});
