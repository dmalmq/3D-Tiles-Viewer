// Zoom-dependent visibility for GDB point markers: far away only a few,
// well-spaced icons show, and more fill in as the camera gets closer.
//
// Each marker gets a web-map zoom level that says how important it is:
//   - the feature's own `min_zoom_level` (as in Facility_Merge), else
//   - a zoom by `label_category` (station names early, shop labels late), else
//   - DEFAULT_MIN_ZOOM.
// A screen-sized grid then keeps one marker per cell (lowest zoom wins), and
// only those are drawn. Labels use a coarser grid and are also limited to
// the camera distance matching their zoom. The "icon detail" setting makes
// the grid finer or coarser (+1 = twice as many icons across).

import { Cartesian3, Cartographic, DistanceDisplayCondition, JulianDate, Math as CesiumMath } from "cesium";

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
  // Cesium requires far > near, so "hidden" is a 1 m range rather than 0.
  const key = Math.max(1, Math.round(far));
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
      entity._gdbLongitude = carto ? CesiumMath.toDegrees(carto.longitude) : 0;
      entity._gdbPosition = position ?? null;
      entity._gdbRank = stableRank(entity.id);
    }
    entity._gdbBaseFar = webZoomToCameraDistance(entity._gdbMinZoom - offset, entity._gdbLatitude);
    entity._gdbLabelMax = labelMaxDistance;
    applyMarkerCondition(entity);
  }
}

function applyMarkerCondition(entity) {
  // Only markers that win their grid cell are drawn, so icons never pile up.
  // A marker's own zoom (base distance) decides who wins a cell, not whether
  // it may show at all.
  const far = entity._gdbSampled ? SAMPLED_MAX_DISTANCE_M : 1;
  if (entity.billboard) entity.billboard.distanceDisplayCondition = conditionFor(far);
  if (entity.point) entity.point.distanceDisplayCondition = conditionFor(far);
  // Labels need their own, coarser sample (text is wider than an icon) and
  // never reach past the label cap.
  if (entity.label) {
    const labelFar = entity._gdbLabelSampled ? Math.min(entity._gdbBaseFar, entity._gdbLabelMax) : 0;
    entity.label.distanceDisplayCondition = conditionFor(labelFar);
  }
}

// -- Sampling ---------------------------------------------------------------
//
// Zoom distances alone leave a zoomed-out view empty (most facility icons
// only belong on a street-level map) and a close view crowded. The grid
// keeps the most important marker per cell instead: the view is never
// empty, never crowded, and cells shrink as the camera gets closer.

// Target spacing between sampled markers and between labels, in screen pixels.
export const SAMPLE_CELL_PX = 90;
export const LABEL_SAMPLE_CELL_PX = 220;
// Beyond this camera height nothing is sampled (the whole dataset would be a
// handful of pixels).
const SAMPLING_MAX_HEIGHT_M = 8000;
const SAMPLED_MAX_DISTANCE_M = 20000;
const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LNG_EQUATOR = 111320;

// Deterministic per-entity tie-breaker so the same marker wins a cell every
// time and icons don't flicker while panning.
function stableRank(id) {
  let hash = 2166136261;
  for (const ch of String(id)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}

/**
 * Pick one marker per grid cell. Lower min zoom wins (it belongs on a less
 * detailed map), then picture icons over plain dots, then the stable rank.
 * A marker's own `cell` (metres) overrides `cellMeters`, so markers at
 * different distances from the camera can use different grid sizes.
 * @param {Array<{ key, lat, lng, minZoom, hasImage, rank, cell? }>} markers
 * @param {number} [cellMeters]
 * @returns {Set} keys of the winning markers
 */
export function sampleMarkersByCell(markers, cellMeters = 0) {
  const best = new Map();
  for (const m of markers) {
    const size = m.cell ?? cellMeters;
    if (!(size > 0)) continue;
    const x = Math.floor((m.lng * METERS_PER_DEGREE_LNG_EQUATOR * Math.cos(CesiumMath.toRadians(m.lat))) / size);
    const y = Math.floor((m.lat * METERS_PER_DEGREE_LAT) / size);
    const cell = `${size}:${x}:${y}`;
    const current = best.get(cell);
    if (!current || compareMarkers(m, current) < 0) best.set(cell, m);
  }
  return new Set([...best.values()].map((m) => m.key));
}

function compareMarkers(a, b) {
  return a.minZoom - b.minZoom || Number(b.hasImage) - Number(a.hasImage) || a.rank - b.rank;
}

/**
 * Keep a screen-spaced sample of GDB markers visible as the camera moves.
 * @param {object} options
 * @param {import("cesium").Viewer} options.viewer
 * @param {() => object[]} options.getLayers all GDB-capable layers
 * @param {() => number} options.getDetail icon-detail offset (zoom levels)
 */
export function createGdbIconSampler({ viewer, getLayers, getDetail }) {
  const { scene, camera } = viewer;
  let lastSignature = "";
  let pending = false;

  const visibleMarkers = () => {
    const out = [];
    for (const layer of getLayers() ?? []) {
      if (!layer?.dataSource || (layer._origin ?? "gdb") !== "gdb" || layer.dataSource.show === false) continue;
      for (const entity of layer.dataSource.entities.values) {
        if (entity._gdbBaseFar == null) continue;
        const graphic = entity.billboard ?? entity.point;
        if (!graphic || graphic.show?.getValue?.() === false || entity.show === false) continue;
        out.push(entity);
      }
    }
    return out;
  };

  function refresh() {
    pending = false;
    const markers = visibleMarkers();
    const carto = camera.positionCartographic;
    const ground = scene.globe.getHeight(carto) ?? 0;
    const sampling = carto.height - ground <= SAMPLING_MAX_HEIGHT_M;
    const fov = camera.frustum.fovy ?? Math.PI / 3;
    // Metres per screen pixel per metre of distance, scaled by icon detail.
    const pixelScale = (2 * Math.tan(fov / 2)) / Math.max(1, scene.canvas.clientHeight)
      / 2 ** normalizeIconDetail(getDetail());
    const cameraPosition = camera.positionWC;

    const candidates = [];
    for (const e of markers) {
      const distance = e._gdbPosition ? Cartesian3.distance(cameraPosition, e._gdbPosition) : null;
      if (distance == null || distance > SAMPLED_MAX_DISTANCE_M) continue;
      candidates.push({
        key: e,
        lat: e._gdbLatitude,
        lng: e._gdbLongitude,
        minZoom: e._gdbMinZoom,
        hasImage: !!e.billboard,
        rank: e._gdbRank,
        distance,
      });
    }
    // In a tilted view distant markers are packed tighter on screen, so size
    // each marker's cell by its own distance. Distances are rounded to powers
    // of two so neighbouring markers share a grid.
    const cellAt = (distance, px) => 2 ** Math.round(Math.log2(Math.max(1, distance * pixelScale * px)));
    const winners = sampling
      ? sampleMarkersByCell(candidates.map((c) => ({ ...c, cell: cellAt(c.distance, SAMPLE_CELL_PX) })))
      : new Set();
    // Only labels already within their own range compete, so a cell's slot
    // isn't taken by a label that wouldn't be drawn anyway.
    const labelWinners = sampleMarkersByCell(
      candidates
        .filter((c) => c.key.label && c.distance <= Math.min(c.key._gdbBaseFar, c.key._gdbLabelMax))
        .map((c) => ({ ...c, cell: cellAt(c.distance, LABEL_SAMPLE_CELL_PX) })),
    );
    let changed = false;
    for (const layer of getLayers() ?? []) {
      if (!layer?.dataSource || (layer._origin ?? "gdb") !== "gdb") continue;
      for (const entity of layer.dataSource.entities.values) {
        if (entity._gdbBaseFar == null) continue;
        const sampled = winners.has(entity);
        const labelSampled = labelWinners.has(entity);
        if (!!entity._gdbSampled === sampled && !!entity._gdbLabelSampled === labelSampled) continue;
        entity._gdbSampled = sampled;
        entity._gdbLabelSampled = labelSampled;
        applyMarkerCondition(entity);
        changed = true;
      }
    }
    if (changed) scene.requestRender();
  }

  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(refresh);
  };

  camera.changed.addEventListener(schedule);
  camera.moveEnd.addEventListener(schedule);
  // Floor filters and layer toggles change which markers compete; notice
  // them without every caller having to remember to refresh.
  scene.postRender.addEventListener(() => {
    let signature = "";
    for (const layer of getLayers() ?? []) {
      if ((layer?._origin ?? "gdb") !== "gdb" || !layer?.dataSource) continue;
      signature += layer.dataSource.show === false ? "0" : "1";
    }
    if (signature !== lastSignature) {
      lastSignature = signature;
      schedule();
    }
  });

  return { refresh: schedule };
}
