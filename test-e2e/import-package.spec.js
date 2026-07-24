import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { prepareCleanApp } from "./helpers.js";

const gpkgPath = fileURLToPath(new URL("./fixtures/tower.gpkg", import.meta.url));

// GIS-only cesium-package drop with no matching building in the scene:
// the manifest-driven ingest falls back to the review tray (with a warning
// toast) instead of guessing a target. The straight-into-scene path with a
// tileset is covered by the manual end-to-end script (real 170 MB exports).
test("a dropped cesium-package without a matching building falls back to the review tray", async ({ page }) => {
  test.setTimeout(180_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  const gpkgBase64 = readFileSync(gpkgPath).toString("base64");
  const manifest = {
    schema: "revitgeosuite.cesium-package",
    version: 1,
    packageId: "pkg-e2e-1",
    building: { id: "tower-e2e", name: "Tower E2E" },
    gis: { format: "geopackage", artifacts: [{ path: "gis/tower.gpkg" }] },
    levelMap: [{ gisLevelId: "lvl-1f", tilesLevelKey: "1f", name: "1F" }],
  };

  await page.evaluate(async ({ manifestJson, gpkgBase64 }) => {
    const gpkgBytes = Uint8Array.from(atob(gpkgBase64), (c) => c.charCodeAt(0));
    const manifestFile = new File([manifestJson], "cesium-package.json");
    manifestFile.relativePath = "Tower-cesium/cesium-package.json";
    const gpkgFile = new File([gpkgBytes], "tower.gpkg");
    gpkgFile.relativePath = "Tower-cesium/gis/tower.gpkg";

    const dt = new DataTransfer();
    dt.items.add(manifestFile);
    dt.items.add(gpkgFile);
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
  }, { manifestJson: JSON.stringify(manifest), gpkgBase64 });

  // GDAL WASM boot + conversion, then the fallback opens the review tray.
  const tray = page.locator("#importReviewTray");
  await expect(tray).toBeVisible({ timeout: 120_000 });
  await expect(tray.getByText(/unit/i).first()).toBeVisible();

  expect(errors).toEqual([]);
});
