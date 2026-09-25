import { test, expect } from "@playwright/test";

test("applying a CARTO key sends it with map tile requests and restores it on reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.locator("#cartoKeyInput").fill("sample-carto-key");

  const tileRequest = page.waitForRequest((request) =>
    request.url().includes("basemaps.cartocdn.com/light_all/") &&
    request.url().includes("key=sample-carto-key"),
  );
  await page.locator("#applyCartoKeyBtn").click();
  await tileRequest;

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#cartoKeyInput")).toHaveValue("sample-carto-key");
  await page.screenshot({ path: "test-results/carto-settings.png" });

  const viewerTileRequest = page.waitForRequest((request) =>
    request.url().includes("basemaps.cartocdn.com/light_all/") &&
    request.url().includes("key=sample-carto-key"),
  );
  await page.goto("/viewer.html");
  await viewerTileRequest;
});
