// Zoom-dependent visibility for GDB point markers: far away only the
// important icons show, and more appear as the camera gets closer.
//
// Each marker gets a web-map zoom level at which it should appear:
//   - the feature's own `min_zoom_level` (as in Facility_Merge), else
//   - a zoom by `label_category` (station names early, shop labels late), else
//   - DEFAULT_MIN_ZOOM.
// That zoom is converted to the camera distance at which a web map at that
// zoom would show the same ground resolution, and applied as a Cesium
// DistanceDisplayCondition. The "icon detail" setting shifts every marker by
// that many zoom levels (+1 = visible from twice as far).

import { Cartographic, DistanceDisplayCondition, JulianDate, Math as CesiumMath } from "cesium";

export const DEFAULT_MIN_ZOOM = 19;
export const ICON_DETAIL_MIN = -2;
export const ICON_DETAIL_MAX = 3;

// point_facility's label categories, from landmarks down to single shops.
const LABEL_CATEGORY_MIN_ZOOM = {
  駅名注記: 15,
  ランドマーク名注記: 16,
  地名注記: 16,
  出口名注記: 17,
  "通り・交差点名注記": 17,
  方面注記: 18,
  施設名注記: 18,
  "店舗・施設POI名注記": 19,
  ラベルだけ店舗名注記: 20,
};

// Screen height and vertical field of view the zoom → distance conversion
// assumes; close enough for a typical viewer window.
const REFERENCE_VIEWPORT_PX = 1000;
const REFERENCE_FOV_RAD = Math.PI / 3;
const WEB_MERCATOR_EQUATOR_MPP = 156543.03392;

export function normalizeIconDetail(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(ICON_DETAIL_MAX, Math.max(ICON_DETAIL_MIN, Math.round(n * 2) / 2));
}

/** Camera distance (m) matching the ground resolution of web-map `zoom`. */
export function webZoomToCameraDistance(zoom, latitudeDeg = 35) {
  const metersPerPixel = (WEB_MERCATOR_EQUATOR_MPP * Math.cos(CesiumMath.toRadians(latitudeDeg))) / 2 ** zoom;
  return (metersPerPixel * REFERENCE_VIEWPORT_PX) / (2 * Math.tan(REFERENCE_FOV_RAD / 2));
}

/** @param {(name: string) => any} read property reader */
export function markerMinZoom(read) {
  const own = Number(read("min_zoom_level"));
  if (Number.isFinite(own) && own > 0) return own;
  const category = read("label_category");
  const byCategory = category != null ? LABEL_CATEGORY_MIN_ZOOM[String(category).trim()] : undefined;
  return byCategory ?? DEFAULT_MIN_ZOOM;
}

const conditionCache = new Map();
function conditionFor(far) {
  const key = Math.round(far);
  if (!conditionCache.has(key)) conditionCache.set(key, new DistanceDisplayCondition(0, key));
  return conditionCache.get(key);
}

/**
 * Apply zoom visibility to every point marker of a GDB layer.
 * @param {object} layer  { _origin, dataSource }
 * @param {number} detail icon-detail offset in zoom levels
 * @param {{ labelMaxDistance?: number }} [options]
 */
export function applyGdbLayerZoomVisibility(layer, detail, { labelMaxDistance = Infinity } = {}) {
  if (!layer?.dataSource || (layer._origin ?? "gdb") !== "gdb") return;
  const offset = normalizeIconDetail(detail);
  const now = JulianDate.now();
  for (const entity of layer.dataSource.entities.values) {
    if (!entity.position || entity.polygon || entity.polyline) continue;
    if (entity._gdbMinZoom == null) {
      const bag = entity.properties;
      entity._gdbMinZoom = markerMinZoom((name) => bag?.[name]?.getValue?.(now));
      const position = entity.position.getValue?.(now);
      const carto = position ? Cartographic.fromCartesian(position) : null;
      entity._gdbLatitude = carto ? CesiumMath.toDegrees(carto.latitude) : 35;
    }
    const far = webZoomToCameraDistance(entity._gdbMinZoom - offset, entity._gdbLatitude);
    if (entity.billboard) entity.billboard.distanceDisplayCondition = conditionFor(far);
    if (entity.point) entity.point.distanceDisplayCondition = conditionFor(far);
    if (entity.label) entity.label.distanceDisplayCondition = conditionFor(Math.min(far, labelMaxDistance));
  }
}
