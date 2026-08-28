import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { prepareCleanApp, waitForTilesetRenderSignal } from "./helpers.js";
import { zipEntryMap } from "../test/zipRead.js";

const SAMPLE_DIR = path.join(process.cwd(), "public", "tiles", "sample-indoor");

async function downloadPack(page, testInfo, name) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.locator("#viewerExportTilesetBtn").click(),
  ]);
  const target = testInfo.outputPath(name);
  await download.saveAs(target);
  return {
    suggestedFilename: download.suggestedFilename(),
    entries: zipEntryMap(new Uint8Array(await fs.readFile(target))),
  };
}

test("exports the URL-loaded sample as an offline zip pack", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await prepareCleanApp(page);
  await page.goto("/viewer.html");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House", {
    timeout: 45_000,
  });
  await waitForTilesetRenderSignal(page);

  const exportBtn = page.locator("#viewerExportTilesetBtn");
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeEnabled();

  const pack = await downloadPack(page, testInfo, "url-pack.zip");
  expect(pack.suggestedFilename).toMatch(/^sample-indoor-offline-\d{4}-\d{2}-\d{2}\.zip$/);
  expect([...pack.entries.keys()].sort()).toEqual(["content.glb", "levels.json", "tileset.json"]);

  const tilesetJson = JSON.parse(new TextDecoder().decode(pack.entries.get("tileset.json").data));
  expect(tilesetJson.root.content.uri).toBe("content.glb");

  await expect(page.locator("#viewerExportStatus")).toContainText("3 files");
  expect(await page.evaluate(() => window.__CESIUM_E2E__?.lastTilesetExport?.warnings)).toEqual([]);
});

test("exports a picked local folder and re-opens the pack in the viewer", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await prepareCleanApp(page);
  await page.goto("/viewer.html");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House", {
    timeout: 45_000,
  });

  await page.locator("#viewerTilesetFolderInput").setInputFiles(SAMPLE_DIR);
  await expect.poll(() => page.evaluate(() => window.__CESIUM_E2E__?.datasetKind)).toBe("local");
  await waitForTilesetRenderSignal(page);

  const pack = await downloadPack(page, testInfo, "local-pack.zip");
  expect([...pack.entries.keys()].sort()).toEqual(["content.glb", "levels.json", "tileset.json"]);

  // Round-trip: unpack to a folder and load it back through "This device".
  const roundTripDir = testInfo.outputPath("round-trip");
  await fs.mkdir(roundTripDir, { recursive: true });
  for (const [name, entry] of pack.entries) {
    const dest = path.join(roundTripDir, name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, entry.data);
  }

  await page.evaluate(() => {
    const hook = window.__CESIUM_E2E__;
    if (hook) {
      hook.tileLoadCount = 0;
      hook.allTilesLoadedCount = 0;
    }
  });
  await page.locator("#viewerTilesetFolderInput").setInputFiles(roundTripDir);
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("round-trip", {
    timeout: 45_000,
  });
  await waitForTilesetRenderSignal(page);
  await expect(page.locator("#viewerLayersList")).toContainText("1F");
  await expect(page.locator("#viewerLayersList")).toContainText("2F");
});
