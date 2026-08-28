import { test, expect } from "@playwright/test";
import path from "node:path";
import { prepareCleanApp, waitForTilesetRenderSignal } from "./helpers.js";

const SAMPLE_DIR = path.join(process.cwd(), "public", "tiles", "sample-indoor");

test("viewer.html loads the public synthetic sample without the authoring UI", async ({ page }) => {
  test.setTimeout(120_000);

  const uploads = [];
  page.on("request", (req) => {
    const method = req.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (/\/api\//.test(req.url()) || /\/packages\//.test(req.url())) {
      uploads.push(`${method} ${req.url()}`);
    }
  });

  await prepareCleanApp(page);
  await page.goto("/viewer.html");

  await expect(page.locator("#appHeader")).toBeVisible();
  await expect(page.locator("#addDataBtn")).toHaveCount(0);
  await expect(page.locator("#viewerDatasetSelect")).toHaveValue("sample");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House", { timeout: 45_000 });
  await waitForTilesetRenderSignal(page);
  expect(await page.evaluate(() => window.__CESIUM_E2E__?.datasetKind)).toBe("sample");

  await page.evaluate(() => {
    const hook = window.__CESIUM_E2E__;
    if (!hook) return;
    hook.tileLoadCount = 0;
    hook.allTilesLoadedCount = 0;
  });
  await page.locator("#viewerTilesetFolderInput").setInputFiles(SAMPLE_DIR);
  await expect.poll(() => page.evaluate(() => window.__CESIUM_E2E__?.datasetKind)).toBe("local");
  await expect(page.locator("#viewerDatasetSelect")).toHaveValue("local");
  await expect(page.locator("#viewerBuildingSelect option")).toHaveCount(2, { timeout: 45_000 });
  await waitForTilesetRenderSignal(page);
  await expect(page.locator("#viewerLayersList")).toContainText("1F");
  await expect(page.locator("#viewerLayersList")).toContainText("2F");

  expect(uploads).toEqual([]);
});
