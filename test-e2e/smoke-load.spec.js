import { test, expect } from "@playwright/test";

test("app loads with header and empty scene placeholder", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");

  await expect(page.locator("#appHeader")).toBeVisible();
  await expect(page.locator("#cesiumContainer")).toBeVisible();
  await expect(page.locator("#leftPanel")).toBeVisible();

  // Header title in default language (EN unless localStorage already says JA).
  await expect(page.locator('[data-i18n="header.title"]')).toBeVisible();

  // Empty-state placeholder should be visible before any tileset is added.
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  // No JS errors during initial load.
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
