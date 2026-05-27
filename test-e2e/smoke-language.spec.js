import { test, expect } from "@playwright/test";

test("language toggle swaps EN and JA header labels", async ({ page }) => {
  // Force a known starting language so the toggle goes EN → JA.
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("language", "en");
  });
  await page.goto("/");

  const headerTitle = page.locator('[data-i18n="header.title"]');
  await expect(headerTitle).toHaveText("3D Tiles Viewer");

  await page.locator("#languageToggle").click();

  await expect(headerTitle).toHaveText("3D Tiles ビューア");
  await expect(page.locator('[data-i18n="header.save"]')).toHaveText("保存");

  // Persisted.
  const stored = await page.evaluate(() => localStorage.getItem("language"));
  expect(stored).toBe("ja");

  // Toggle back.
  await page.locator("#languageToggle").click();
  await expect(headerTitle).toHaveText("3D Tiles Viewer");
});
