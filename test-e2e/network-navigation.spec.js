import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { prepareCleanApp } from "./helpers.js";

test("network navigation points restore, export, and render responsively", async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await prepareCleanApp(page, { language: "en" });
  await page.goto("/");

  const sessionPath = testInfo.outputPath("network-session.json");
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, JSON.stringify(makeNetworkSession(), null, 2));

  await page.locator("#sessionInput").setInputFiles(sessionPath);
  await expect(page.locator("#loadingOverlay")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator("#editorBuildingSelect option:checked")).toHaveText("Network QA Tower");
  await expect(page.locator("#networkStatus")).toHaveText("3 nodes · 1 links · 1 authored");

  await expect(page.locator("#networkVisibleToggle")).toBeEnabled();
  await page.locator("#networkSection .toggle-label").click();
  await expect(page.locator("#networkVisibleToggle")).not.toBeChecked();
  await page.locator("#networkSection .toggle-label").click();
  await expect(page.locator("#networkVisibleToggle")).toBeChecked();

  await expect(page.locator("#networkConnectBtn")).toBeEnabled();
  await page.locator("#networkConnectBtn").click();
  await expect(page.locator("#networkConnectBtn")).toHaveClass(/active/);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#networkExportBtn").click();
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath("authored-network-connectors.geojson");
  await download.saveAs(exportPath);

  const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
  expect(exported.features).toHaveLength(1);
  expect(exported.features[0].properties).toMatchObject({
    layerName: "QA_F2_to_F3_link",
    passage_type: 31,
    FLOOR1: "F2",
    FLOOR2: "F3",
    node1: "E2",
    node2: "S3",
    path_cost: null,
    indoor: 1,
  });
  // Stair-path waypoints from the restored session are threaded into the geometry.
  expect(exported.features[0].geometry.coordinates).toEqual([
    [139.70045, 35.60045, 14],
    [139.70065, 35.60065, 16],
    [139.7009, 35.6009, 18],
  ]);

  // Passage-type dropdown offers the verified GDB codes.
  const optionValues = await page.locator("#networkPassageType option").evaluateAll(
    (options) => options.map((option) => option.value),
  );
  expect(optionValues).toEqual(expect.arrayContaining(["11", "21", "31", "41"]));

  await capture(page, testInfo, "network-desktop.png", 1280, 900);
  await capture(page, testInfo, "network-tablet.png", 768, 900);

  await page.locator("#languageToggle").click();
  await expect(page.locator("[data-i18n=\"network.section\"]")).toHaveText("ネットワーク");
  await expect(page.locator("#networkStatus")).toContainText("3 ノード");
  await capture(page, testInfo, "network-mobile-ja.png", 390, 844);

  expect(errors).toEqual([]);
});

async function capture(page, testInfo, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.locator("#networkSection").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

function makeNetworkSession() {
  return {
    version: 4,
    plateauOverridesEnabled: true,
    modelLevels: [
      { floorNumber: 1, name: "F1", elevation: 10 },
      { floorNumber: 2, name: "F2", elevation: 14 },
      { floorNumber: 3, name: "F3", elevation: 18 },
    ],
    activeModelLevelIndex: -1,
    venues: [],
    buildings: [
      {
        name: "Network QA Tower",
        sourceType: "url",
        sourceUrl: "/tiles/tokyo/tileset.json",
        tilesetGroupId: null,
        linkFilter: null,
        venueId: null,
        heightOffset: 0,
        levelBaseElevation: 0,
        aliases: [],
        packageBuildingId: null,
        packageContentHash: null,
        activeLevelIndex: -1,
        levels: [
          { name: "F1", key: "f1", floor: 10, localPlaneZ: 10 },
          { name: "F2", key: "f2", floor: 14, localPlaneZ: 14 },
          { name: "F3", key: "f3", floor: 18, localPlaneZ: 18 },
        ],
        sourceLevelGroups: [],
        shapefileLayers: [],
        networkDatasets: [
          {
            id: "network:e2e",
            name: "QA network",
            sourceName: "Network QA Tower",
            sourcePrefix: "QA",
            visible: true,
            nodes: [
              node("L1", "F1", 139.7, 35.6, 10),
              node("E2", "F2", 139.70045, 35.60045, 14),
              node("S3", "F3", 139.7009, 35.6009, 18),
            ],
            flatLayers: [],
            verticalLayers: [
              {
                name: "QA_F1_to_F2_link",
                prefix: "QA",
                floor1: "F1",
                floor2: "F2",
                connectors: [
                  {
                    id: "imported:L1:E2",
                    sourceLayerName: "QA_F1_to_F2_link",
                    authored: false,
                    floor1: "F1",
                    floor2: "F2",
                    node1: "L1",
                    node2: "E2",
                    passageType: "21",
                    direction: 0,
                    length: 6,
                    startAltitude: 10,
                    endAltitude: 14,
                    start: { lon: 139.7, lat: 35.6 },
                    end: { lon: 139.70045, lat: 35.60045 },
                    properties: {},
                  },
                ],
              },
            ],
            authoredConnectors: [
              {
                id: "authored:E2:S3",
                authored: true,
                sourceLayerName: null,
                sourcePrefix: "QA",
                passageType: 31,
                floor1: "F2",
                floor2: "F3",
                node1: "E2",
                node2: "S3",
                direction: 0,
                start: { lon: 139.70045, lat: 35.60045 },
                end: { lon: 139.7009, lat: 35.6009 },
                waypoints: [{ lon: 139.70065, lat: 35.60065, height: 16 }],
                startAltitude: 14,
                endAltitude: 18,
                startRelativeHeight: null,
                endRelativeHeight: null,
                length: 66.2,
                properties: {},
              },
            ],
            warnings: [],
          },
        ],
        directoryHandleId: null,
        _directoryFolderName: null,
      },
    ],
    importedLayers: [],
    unassignedLayers: [],
  };
}

function node(nodeId, floor, lon, lat, altitude) {
  return {
    nodeId,
    floor,
    lon,
    lat,
    altitude,
    relativeHeight: null,
    properties: { NODEID: nodeId, FLOOR: floor },
  };
}
