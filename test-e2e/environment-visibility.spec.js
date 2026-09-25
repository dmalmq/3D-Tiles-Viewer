import { test, expect } from "@playwright/test";
import { prepareCleanApp } from "./helpers.js";

test("editor controls adjust PLATEAU transparency and GDB icon visibility", async ({ page }) => {
  await prepareCleanApp(page);
  await page.goto("/");
  await page.locator('[data-panel="tabEnvironment"]').click();

  const toggle = page.locator("#plateauTransparencyToggle");
  const slider = page.locator("#plateauTransparencySlider");
  const icons = page.locator("#gdbIconsToggle");
  await expect(toggle).not.toBeChecked();
  await expect(slider).toBeDisabled();
  await expect(icons).toBeChecked();

  await page.locator("label.toggle-label").filter({ has: toggle }).click();
  await expect(slider).toBeEnabled();
  await slider.fill("45");
  await expect(page.locator("#plateauTransparencyValue")).toHaveText("45%");
  await page.locator("label.toggle-label").filter({ has: icons }).click();
  await expect(icons).not.toBeChecked();
  await page.locator("label.toggle-label").filter({ has: toggle }).click();
  await expect(slider).toBeDisabled();
});

test("viewer exposes the same visibility controls", async ({ page }) => {
  await prepareCleanApp(page);
  await page.goto("/viewer.html");
  const environment = page.locator("#environmentSection");
  if (await environment.evaluate((element) => element.classList.contains("collapsed"))) {
    await environment.locator(".panel-section-header").click();
  }
  await environment.locator("label.toggle-label:has(#plateauTransparencyToggle)").click();
  await environment.locator("#plateauTransparencySlider").fill("65");
  await expect(environment.locator("#plateauTransparencyValue")).toHaveText("65%");
  await environment.locator("label.toggle-label:has(#gdbIconsToggle)").click();
  await expect(environment.locator("#gdbIconsToggle")).not.toBeChecked();
});
