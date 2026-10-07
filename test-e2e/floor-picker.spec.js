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

test("renaming the selected floor's level away returns the scene to All floors", async ({ page }) => {
  test.setTimeout(120_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page, { language: "en" });
  await page.goto("/");
  await page.locator("#addDataBtn").click();
  await page.locator("#urlInput").fill("/tiles/sample-indoor/tileset.json");
  await page.locator("#loadUrlBtn").click();
  await expect(page.locator(".bldg-row").first()).toBeVisible({ timeout: 45_000 });

  const picker = page.locator("#levelPillsRow");
  await picker.locator(".level-pill", { hasText: "2F" }).click();
  await expect(picker.locator(".level-pill.active")).toHaveText("2F");
  await expect(page.locator(".bldg-level-row.selected")).toHaveText(/2F/);

  // Rename the 2F level to a name with no floor number, so floor 2 vanishes.
  await page.locator(".bldg-level-row", { hasText: "2F" }).first().click({ button: "right" });
  await page.locator("#floatingMenu li", { hasText: "Edit name" }).click();
  const popover = page.locator(".left-popover:visible");
  await popover.locator("input").fill("Mezzanine");
  await popover.getByRole("button", { name: "OK" }).click();

  await expect(picker.locator(".level-pill", { hasText: "2F" })).toHaveCount(0);
  await expect(picker.locator(".level-pill.active")).toHaveText("All floors");
  // The building is no longer clipped to the renamed level either.
  await expect(page.locator(".bldg-level-row.selected")).toHaveCount(0);

  expect(errors).toEqual([]);
});
