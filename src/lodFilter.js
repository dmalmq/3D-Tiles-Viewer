/**
 * LOD filter for PLATEAU CityGML-based 3D Tiles.
 *
 * When enabled, only the highest-LOD version of each building is shown.
 * Works by:
 *   1. Collecting building IDs from higher-LOD tilesets into a Set
 *   2. Applying a Cesium3DTileStyle to lower-LOD tilesets that hides
 *      buildings present in the higher-LOD set
 *
 * The style is evaluated by Cesium internally during tile processing,
 * so it survives tile unload/reload with no flicker.
 *
 * LOD level: "_lod" feature property (numeric: 1, 2, …).
 * Building ID: "buildingIDAttribute_uro:buildingID".
 */

import { Cesium3DTileStyle } from "cesium";

const ID_PROPERTIES = [
  "buildingIDAttribute_uro:buildingID",
  "uro:buildingID",
  "gml_id",
];

function getBuildingId(feature) {
  for (const prop of ID_PROPERTIES) {
    const val = feature.getProperty(prop);
    if (val != null && val !== "") return String(val);
  }
  return null;
}

function getLodRank(feature) {
  const lod = feature.getProperty("_lod");
  if (lod == null || lod === "") return 0;
  return Number(lod) || 0;
}

/**
 * Sample the first available feature to determine a tileset's LOD level.
 */
function sampleTilesetLod(tileset) {
  const root = tileset.root;
  if (!root) return 0;
  const stack = [root];
  while (stack.length) {
    const tile = stack.pop();
    const content = tile.content;
    if (content && content.featuresLength > 0) {
      return getLodRank(content.getFeature(0));
    }
    if (tile.children) {
      for (const child of tile.children) stack.push(child);
    }
  }
  return 0;
}

/**
 * Collect all building IDs from loaded tiles in a tileset.
 */
function collectBuildingIds(tileset, outSet) {
  const root = tileset.root;
  if (!root) return;
  const stack = [root];
  while (stack.length) {
    const tile = stack.pop();
    const content = tile.content;
    if (content && content.featuresLength) {
      for (let i = 0; i < content.featuresLength; i++) {
        const id = getBuildingId(content.getFeature(i));
        if (id) outSet.add(id);
      }
    }
    if (tile.children) {
      for (const child of tile.children) stack.push(child);
    }
  }
}

export class LodFilter {
  constructor() {
    this.enabled = false;
    /** @type {Map<any, number>} tileset -> sampled LOD rank */
    this._tilesets = new Map();
    /** @type {Map<any, any>} tileset -> original style (to restore on disable) */
    this._originalStyles = new Map();
    this._lastStats = null;
  }

  addTileset(tileset) {
    this._tilesets.set(tileset, -1); // LOD not yet sampled
  }

  removeTileset(tileset) {
    // Restore original style if we replaced it
    if (this._originalStyles.has(tileset)) {
      tileset.style = this._originalStyles.get(tileset);
      this._originalStyles.delete(tileset);
    }
    this._tilesets.delete(tileset);
  }

  /**
   * Scan all tilesets, collect higher-LOD building IDs, then apply
   * a Cesium3DTileStyle to lower-LOD tilesets that hides duplicates.
   */
  apply() {
    this.enabled = true;
    this._clearStyles();

    // Sample LOD levels
    let maxLod = 0;
    for (const [ts] of this._tilesets) {
      const lod = sampleTilesetLod(ts);
      this._tilesets.set(ts, lod);
      if (lod > maxLod) maxLod = lod;
    }

    if (maxLod === 0) return;

    // Collect building IDs from higher-LOD tilesets
    const higherLodIds = new Set();
    for (const [ts, lod] of this._tilesets) {
      if (lod === maxLod) {
        collectBuildingIds(ts, higherLodIds);
      }
    }

    if (higherLodIds.size === 0) return;

    // Apply a hide-style to lower-LOD tilesets
    // The style uses a custom evaluator that Cesium calls automatically
    // on every feature whenever a tile loads — no manual listeners needed.
    let duplicates = 0;
    for (const [ts, lod] of this._tilesets) {
      if (lod < maxLod) {
        this._originalStyles.set(ts, ts.style);

        const style = new Cesium3DTileStyle();
        // Override the show expression with a custom evaluator
        style.show = {
          evaluate: (feature) => {
            const id = getBuildingId(feature);
            if (id && higherLodIds.has(id)) return false;
            return true;
          },
          evaluateColor: undefined,
        };
        ts.style = style;

        // Count duplicates for stats
        collectBuildingIds(ts, new Set()); // just to count
        const tsIds = new Set();
        collectBuildingIds(ts, tsIds);
        for (const id of tsIds) {
          if (higherLodIds.has(id)) duplicates++;
        }
      }
    }

    this._lastStats = {
      buildings: higherLodIds.size,
      duplicates,
    };
  }

  /** Remove custom styles, restoring originals. */
  _clearStyles() {
    for (const [ts, original] of this._originalStyles) {
      ts.style = original;
    }
    this._originalStyles.clear();
  }

  disable() {
    this.enabled = false;
    this._clearStyles();
    this._lastStats = null;
  }

  toggle(on) {
    if (on) this.apply();
    else this.disable();
  }

  stats() {
    return this._lastStats || { buildings: 0, duplicates: 0 };
  }

  destroy() {
    this.disable();
    this._tilesets.clear();
  }
}
