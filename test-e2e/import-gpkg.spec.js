import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { prepareCleanApp } from "./helpers.js";

const fixturePath = fileURLToPath(new URL("./fixtures/tower.gpkg", import.meta.url));

test("a .gpkg picked from the Add Data menu reaches the import review tray", async ({ page }) => {
  test.setTimeout(180_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  // The .gpkg goes through the same hidden input as .gdb.zip.
  await page.locator("#gdbInput").setInputFiles(fixturePath);

  // GDAL WASM boot + conversion can take a while on first run.
  const tray = page.locator("#importReviewTray");
  await expect(tray).toBeVisible({ timeout: 120_000 });

  // Both fixture layers should arrive as rows (unit + level).
  await expect(tray.getByText(/unit/i).first()).toBeVisible();
  await expect(tray.getByText(/level/i).first()).toBeVisible();

  expect(errors).toEqual([]);
});
