import { test, expect } from "@playwright/test";
import { prepareCleanApp } from "./helpers.js";

test("import tray groups stay readable and scroll when many groups overflow", async ({ page }) => {
  test.setTimeout(120_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#appHeader")).toBeVisible();

  await page.evaluate(async () => {
    const { openImportReviewTray } = await import("/src/importReviewTray.js");

    const fcs = [];
    for (let i = 0; i < 25; i++) {
      fcs.push({
        fileName: `Source${String(i + 1).padStart(2, "0")}_layer.gdb`,
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.76, 35.68] },
            properties: { source: `SourceGroup${String(i + 1).padStart(2, "0")}` },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [139.761, 35.681] },
            properties: { source: `SourceGroup${String(i + 1).padStart(2, "0")}` },
          },
        ],
      });
    }

    openImportReviewTray({
      featureCollections: fcs,
      buildings: [],
      viewer: null,
      mode: "import",
      onImport: () => {},
      onSilentImport: () => {},
      onUndoAutoImport: () => {},
      onOpenClassicTable: () => {},
    });
  });

  const tray = page.locator("#importReviewTray");
  await expect(tray).toBeVisible({ timeout: 5000 });

  const body = tray.locator(".import-tray-body");
  await expect(body).toBeVisible();

  const overflowY = await body.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
  expect(overflowY.overflowY).toBe("auto");
  expect(overflowY.scrollHeight).toBeGreaterThan(overflowY.clientHeight);

  const groups = tray.locator(".import-tray-group");
  const groupCount = await groups.count();
  expect(groupCount).toBeGreaterThanOrEqual(10);

  const firstGroupHead = groups.first().locator(".import-tray-group-head");
  const headHeight = await firstGroupHead.evaluate((el) => el.getBoundingClientRect().height);
  expect(headHeight).toBeGreaterThanOrEqual(28);

  const firstLabel = groups.first().locator(".import-tray-group-label");
  await expect(firstLabel).toBeVisible();
  const labelBox = await firstLabel.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(labelBox.height).toBeGreaterThanOrEqual(10);
  expect(labelBox.width).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});
