import { expect } from "@playwright/test";

export async function prepareCleanApp(page, { language = "en", e2eHooks = true } = {}) {
  await page.addInitScript(({ language, e2eHooks }) => {
    localStorage.clear();
    if (language) localStorage.setItem("language", language);
    if (e2eHooks) {
      window.__CESIUM_E2E__ = {
        tileLoadCount: 0,
        allTilesLoadedCount: 0,
        tilesetReadyCount: 0,
        linkInspectionSafetyTimeoutMs: 5000,
        linkInspectionTailTimeoutMs: 100,
      };
    }
  }, { language, e2eHooks });
}

export async function loadSampleTileset(page) {
  await page.locator("#addDataBtn").click();
  const menu = page.locator("#leftAddDataMenu");
  await expect(menu).toBeVisible();
  await menu.locator('[data-action="add-url"]').click();

  await expect(page.locator("#urlLoadPopover")).toBeVisible();
  await page.locator("#urlInput").fill("/tiles/tokyo/tileset.json");
  await page.locator("#loadUrlBtn").click();

  const buildingName = page.locator(".bldg-row .bldg-name").filter({ hasText: "tileset.json" }).first();
  await expect(buildingName).toBeVisible({ timeout: 45_000 });
  return buildingName;
}

export async function waitForTilesetRenderSignal(page) {
  await page.waitForFunction(() => {
    const hook = window.__CESIUM_E2E__;
    return !!hook && ((hook.tileLoadCount ?? 0) > 0 || (hook.allTilesLoadedCount ?? 0) > 0);
  }, null, { timeout: 60_000 });
}

export async function addAndRenameLevel(page, editedName = "1F Edited") {
  const buildingRow = page.locator(".bldg-row").filter({ hasText: "tileset.json" }).first();
  await buildingRow.click({ button: "right" });
  await page.locator("#floatingMenu li").filter({ hasText: "Add level" }).click();

  const addPopover = page.locator(".left-popover").filter({ hasText: "OK" }).last();
  await addPopover.locator("input").nth(0).fill("1F");
  await addPopover.locator("input").nth(1).fill("0");
  await addPopover.getByRole("button", { name: "OK" }).click();

  const levelRow = page.locator(".bldg-level-row").filter({ hasText: "1F" }).first();
  await expect(levelRow).toBeVisible();
  await levelRow.click({ button: "right" });
  await page.locator("#floatingMenu li").filter({ hasText: "Edit name" }).click();

  const editPopover = page.locator(".left-popover").filter({ hasText: "OK" }).last();
  await editPopover.locator("input").first().fill(editedName);
  await editPopover.getByRole("button", { name: "OK" }).click();

  const editedLevel = page.locator(".bldg-level-row .level-name-text").filter({ hasText: editedName }).first();
  await expect(editedLevel).toBeVisible();
}
