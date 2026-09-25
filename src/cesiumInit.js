import {
  OpenStreetMapImageryProvider,
  IonImageryProvider,
  ArcGisMapServerImageryProvider,
  UrlTemplateImageryProvider,
  EllipsoidTerrainProvider,
  CesiumTerrainProvider,
  CustomHeightmapTerrainProvider,
  WebMercatorTilingScheme,
  createWorldTerrainAsync,
  Color,
} from "cesium";
import { getCartoTileUrl } from "./cartoKey.js";

const PLATEAU_TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain";

export const UNDERGROUND_BASE_COLOR = Color.fromCssColorString("#1a1a1a");

export async function initializeTerrainProviders(savedToken) {
  const providers = {
    worldTerrainProvider: null,
    plateauTerrainProvider: null,
  };

  if (savedToken) {
    try {
      providers.worldTerrainProvider = await createWorldTerrainAsync();
    } catch (e) {
      console.warn("Failed to load Cesium World Terrain:", e);
    }
  }

  try {
    providers.plateauTerrainProvider = await CesiumTerrainProvider.fromUrl(PLATEAU_TERRAIN_URL);
  } catch (e) {
    console.warn("Failed to load PLATEAU terrain:", e);
  }

  return providers;
}

export async function switchImagery(viewer, choice, { onAfterSwitch, cartoKey = "" } = {}) {
  viewer.imageryLayers.removeAll();
  const osmFallback = () =>
    viewer.imageryLayers.addImageryProvider(
      new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
    );

  switch (choice) {
    case "osm":
      osmFallback();
      break;
    case "ion-bing-aerial":
      try {
        viewer.imageryLayers.addImageryProvider(await IonImageryProvider.fromAssetId(2));
      } catch (e) {
        console.warn("Failed to load Bing Aerial imagery:", e);
        osmFallback();
      }
      break;
    case "ion-sentinel":
      try {
        viewer.imageryLayers.addImageryProvider(await IonImageryProvider.fromAssetId(3954));
      } catch (e) {
        console.warn("Failed to load Sentinel-2 imagery:", e);
        osmFallback();
      }
      break;
    case "esri-street":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer",
          ),
        );
      } catch (e) {
        console.warn("Failed to load Esri World Street Map:", e);
        osmFallback();
      }
      break;
    case "esri-topo":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer",
          ),
        );
      } catch (e) {
        console.warn("Failed to load Esri World Topo Map:", e);
        osmFallback();
      }
      break;
    case "esri-imagery":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
          ),
        );
      } catch (e) {
        console.warn("Failed to load Esri World Imagery:", e);
        osmFallback();
      }
      break;
    case "esri-light-gray":
      try {
        viewer.imageryLayers.addImageryProvider(
          await ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer",
          ),
        );
      } catch (e) {
        console.warn("Failed to load Esri Light Gray Canvas:", e);
        osmFallback();
      }
      break;
    case "carto-positron":
      if (!cartoKey) {
        osmFallback();
        break;
      }
      viewer.imageryLayers.addImageryProvider(
        new UrlTemplateImageryProvider({
          url: getCartoTileUrl(cartoKey),
          subdomains: ["a", "b", "c", "d"],
          maximumLevel: 19,
          credit: "© OpenStreetMap contributors © CARTO",
        }),
      );
      break;
    default:
      osmFallback();
      break;
  }

  onAfterSwitch?.();
}

export function switchTerrain(viewer, choice, providers = {}) {
  const { worldTerrainProvider = null, plateauTerrainProvider = null } = providers;
  switch (choice) {
    case "ellipsoid":
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      break;
    case "cesium-world":
      viewer.terrainProvider = worldTerrainProvider ?? new EllipsoidTerrainProvider();
      break;
    case "gsi-dem5a":
    case "gsi-dem5b":
      viewer.terrainProvider = createGsiTerrainProvider(choice);
      break;
    case "plateau":
      viewer.terrainProvider = plateauTerrainProvider ?? new EllipsoidTerrainProvider();
      break;
    default:
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      break;
  }
}

export function createGsiTerrainProvider(type) {
  const urlTemplate =
    type === "gsi-dem5a"
      ? "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png"
      : "https://cyberjapandata.gsi.go.jp/xyz/dem5b_png/{z}/{x}/{y}.png";
  return new CustomHeightmapTerrainProvider({
    tilingScheme: new WebMercatorTilingScheme(),
    width: 256,
    height: 256,
    callback: async (x, y, level) => {
      const url = urlTemplate.replace("{z}", level).replace("{x}", x).replace("{y}", y);
      try {
        return decodeGsiHeightmap(await loadImage(url));
      } catch {
        return new Float32Array(256 * 256);
      }
    },
  });
}

export function decodeGsiHeightmap(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const heights = new Float32Array(img.width * img.height);
  for (let i = 0; i < heights.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (r === 128 && g === 0 && b === 0) {
      heights[i] = 0;
    } else {
      const raw = r * 65536 + g * 256 + b;
      heights[i] = (raw < 8388608 ? raw : raw - 16777216) / 100;
    }
  }
  return heights;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function applyUndergroundMode(viewer, { isUndergroundActive, savedGlobeBaseColorRef, onContextGhosting }) {
  const layer = viewer.imageryLayers.get(0);
  const globe = viewer.scene.globe;
  if (isUndergroundActive()) {
    if (savedGlobeBaseColorRef.value === null) {
      savedGlobeBaseColorRef.value = Color.clone(globe.baseColor);
    }
    globe.baseColor = UNDERGROUND_BASE_COLOR;
    if (layer) {
      layer.alpha = 0.0;
      layer.brightness = 1.0;
    }
  } else {
    if (savedGlobeBaseColorRef.value !== null) {
      globe.baseColor = savedGlobeBaseColorRef.value;
      savedGlobeBaseColorRef.value = null;
    }
    if (layer) {
      layer.alpha = 1.0;
      layer.brightness = 1.0;
    }
  }
  onContextGhosting?.();
}
