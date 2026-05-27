import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("save / load session round-trip preserves a loaded tileset", async ({ page }) => {
  test.setTimeout(240_000);

  // Fail loudly if the app shows an alert during the round-trip.
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    await d.accept().catch(() => {});
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("language", "en");
  });
  await page.goto("/");
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  // Open Add Data → Tileset URL…
  await page.locator("#addDataBtn").click();
  const menu = page.locator("#leftAddDataMenu");
  await expect(menu).toBeVisible();
  await menu.locator('[data-action="add-url"]').click();
  await expect(page.locator("#urlLoadPopover")).toBeVisible();
  await page.locator("#urlInput").fill("/tiles/tokyo/tileset.json");
  await page.locator("#loadUrlBtn").click();

  // Wait for the tileset to register in the scene tree.
  // inspectLinks has a 60s safety timeout for tilesets with no per-feature
  // metadata (like this plain GLB sample), so allow up to 90s.
  await expect(page.locator("#levelList > li").first()).toBeVisible({ timeout: 90_000 });

  // Save session — captures the JSON download.
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveSessionBtn").click();
  const download = await downloadPromise;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cesium-e2e-"));
  const sessionPath = path.join(tmpDir, "session.json");
  await download.saveAs(sessionPath);

  const savedJson = JSON.parse(await fs.readFile(sessionPath, "utf8"));
  expect(savedJson.version).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(savedJson.buildings)).toBe(true);
  expect(savedJson.buildings.length).toBeGreaterThan(0);

  // Reload — scene should start empty.
  await page.reload();
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  // Load saved session.
  await page.locator("#sessionInput").setInputFiles(sessionPath);
  await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator("#levelList > li").first()).toBeVisible({ timeout: 30_000 });

  expect(dialogs).toEqual([]);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
