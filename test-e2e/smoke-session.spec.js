import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  addAndRenameLevel,
  loadSampleTileset,
  prepareCleanApp,
  waitForTilesetRenderSignal,
} from "./helpers.js";

test("save / load session round-trip preserves a loaded tileset and edited level", async ({ page }) => {
  test.setTimeout(240_000);

  // Fail loudly if the app shows an alert during the round-trip.
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    await d.accept().catch(() => {});
  });
  await prepareCleanApp(page);
  await page.goto("/");
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  await loadSampleTileset(page);
  await waitForTilesetRenderSignal(page);

  const editedLevelName = "1F E2E Edited";
  await addAndRenameLevel(page, editedLevelName);

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
  expect(savedJson.buildings.flatMap((b) => b.levels.map((l) => l.name))).toContain(editedLevelName);

  // Reload — scene should start empty.
  await page.reload();
  await expect(page.locator("#noScenePlaceholder")).toBeVisible();

  // Load saved session.
  await page.locator("#sessionInput").setInputFiles(sessionPath);
  await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator("#levelList > li").first()).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator(".bldg-level-row .level-name-text").filter({ hasText: editedLevelName }).first()
  ).toBeVisible();

  expect(dialogs).toEqual([]);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
