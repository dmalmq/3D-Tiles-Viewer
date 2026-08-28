import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { isLocalDatasetUploadRequest } from "../src/viewerDataset.js";
import { prepareCleanApp, waitForTilesetRenderSignal } from "./helpers.js";

const SAMPLE_DIR = path.join(process.cwd(), "public", "tiles", "sample-indoor");

test("viewer.html loads the public synthetic sample without the authoring UI", async ({ page }) => {
  test.setTimeout(120_000);

  const uploads = [];
  page.on("request", (req) => {
    if (isLocalDatasetUploadRequest(req.url(), req.method())) {
      uploads.push(`${req.method()} ${req.url()}`);
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

test("viewer.html ?tileset= loads the static sample and rebuilds floors", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareCleanApp(page);
  await page.goto("/viewer.html?tileset=/tiles/sample-indoor/tileset.json");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("sample-indoor", { timeout: 45_000 });
  await waitForTilesetRenderSignal(page);
  await expect(page.locator("#viewerLayersList")).toContainText("1F");
  await expect(page.locator("#viewerLayersList")).toContainText("2F");
});

test("invalid local folder does not wipe the current tileset", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const emptyDir = testInfo.outputPath("not-a-tileset");
  await fs.mkdir(emptyDir, { recursive: true });
  await fs.writeFile(path.join(emptyDir, "readme.txt"), "not a tileset");

  await prepareCleanApp(page);
  await page.goto("/viewer.html");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House", { timeout: 45_000 });

  await page.locator("#viewerTilesetFolderInput").setInputFiles(SAMPLE_DIR);
  await expect.poll(() => page.evaluate(() => window.__CESIUM_E2E__?.datasetKind)).toBe("local");
  await expect(page.locator("#viewerLayersList")).toContainText("1F");

  await page.locator("#viewerTilesetFolderInput").setInputFiles(emptyDir);
  await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#viewerDatasetSelect")).toHaveValue("local");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("sample-indoor");
  await expect(page.locator("#viewerLayersList")).toContainText("1F");
  expect(await page.evaluate(() => window.__CESIUM_E2E__?.datasetKind)).toBe("local");
});

test("failed switch to public sample restores the shared session UI", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareCleanApp(page);
  await page.goto("/viewer.html?session=/tiles/sample-indoor/session.json");
  await expect(page.locator("#viewerDatasetSelect")).toHaveValue("shared", { timeout: 45_000 });
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House");

  await page.route("**/tiles/sample-indoor/session.json", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 503, body: "unavailable" });
    }
    return route.continue();
  });

  await page.locator("#viewerDatasetSelect").selectOption("sample");
  await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#viewerDatasetSelect")).toHaveValue("shared");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House");
  await expect(page.locator("#viewerVenueBar")).toBeHidden();
});
