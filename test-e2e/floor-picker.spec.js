import { test, expect } from "@playwright/test";
import { prepareCleanApp } from "./helpers.js";

test("floors of a tileset loaded from a URL appear in the floor picker", async ({ page }) => {
  test.setTimeout(120_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page, { language: "en" });
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  // The floor picker stays empty until a building with floors is loaded.
  await expect(page.locator("#levelPillsRow .level-pill")).toHaveCount(0);

  await page.locator("#addDataBtn").click();
  await page.locator("#urlInput").fill("/tiles/sample-indoor/tileset.json");
  await page.locator("#loadUrlBtn").click();
  await expect(page.locator(".bldg-row").first()).toBeVisible({ timeout: 45_000 });

  const picker = page.locator("#levelPillsRow");
  await expect(picker.locator(".level-pill", { hasText: "1F" })).toBeVisible();
  await expect(picker.locator(".level-pill", { hasText: "2F" })).toBeVisible();

  // Picking a floor marks it active.
  await picker.locator(".level-pill", { hasText: "2F" }).click();
  await expect(picker.locator(".level-pill.active")).toHaveText("2F");

  expect(errors).toEqual([]);
});
