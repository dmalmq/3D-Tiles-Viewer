import { test, expect } from "@playwright/test";

test("PLATEAU terrain loads from the official elevation service", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cesiumIonToken", "invalid"));
  const metadataResponse = page.waitForResponse(
    (response) => response.url() === "https://tile.plateauview.mlit.go.jp/terrain/layer.json",
    { timeout: 15_000 },
  );
  const tileResponse = page.waitForResponse(
    (response) => response.url().includes("tile.plateauview.mlit.go.jp/terrain/") &&
      response.url().includes(".terrain"),
    { timeout: 20_000 },
  );

  await page.goto("/");
  await expect(page.locator("#terrainSelect")).toHaveValue("plateau");
  expect((await metadataResponse).status()).toBe(200);
  expect((await tileResponse).status()).toBe(200);
});

test("viewer loads PLATEAU terrain from the official elevation service", async ({ page }) => {
  const metadataResponse = page.waitForResponse(
    (response) => response.url() === "https://tile.plateauview.mlit.go.jp/terrain/layer.json",
    { timeout: 15_000 },
  );
  await page.goto("/viewer.html");
  await expect(page.locator("#viewerBuildingSelect option").nth(1)).toHaveText("Sample House");
  const tileResponse = page.waitForResponse(
    (response) => response.url().includes("tile.plateauview.mlit.go.jp/terrain/") &&
      response.url().includes(".terrain"),
    { timeout: 20_000 },
  );

  await page.locator("#terrainSelect").selectOption("plateau");
  await expect(page.locator("#terrainSelect")).toHaveValue("plateau");
  expect((await metadataResponse).status()).toBe(200);
  expect((await tileResponse).status()).toBe(200);
});
