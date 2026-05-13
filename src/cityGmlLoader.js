/**
 * Parses a CityGML XML string and extracts all gml:Polygon surfaces.
 * Returns { polygons, srsWarning }.
 * Each polygon: { positions: [[lon,lat,h],...], holes: [[[lon,lat,h],...]], surfaceType, buildingId }
 * surfaceType: "RoofSurface" | "WallSurface" | "GroundSurface" | "unknown"
 */
export function parseCityGml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("CityGML XML parse error: " + parseError.textContent.slice(0, 300));
  }

  const envelope = byLocal(doc, "Envelope")[0];
  const srsName = envelope?.getAttribute("srsName") ?? "";
  const { isLatFirst, isProjected } = detectCrs(srsName);
  const srsWarning = isProjected
    ? `CRS "${srsName}" appears to be a projected coordinate system — building positions may be incorrect`
    : null;

  const polygons = [];
  const buildingEls = [
    ...byLocal(doc, "Building"),
    ...byLocal(doc, "BuildingPart"),
  ];

  for (const bldg of buildingEls) {
    const buildingId = bldg.getAttribute("gml:id") ?? "";
    for (const poly of byLocal(bldg, "Polygon")) {
      const surfaceType = detectSurfaceType(poly);

      const exteriorEl = byLocal(poly, "exterior")[0];
      const extRingEl = exteriorEl ? byLocal(exteriorEl, "LinearRing")[0] : null;
      const exterior = extRingEl ? parseRing(extRingEl, isLatFirst) : null;
      if (!exterior || exterior.length < 3) continue;

      const holes = [];
      for (const interiorEl of byLocal(poly, "interior")) {
        const holeRingEl = byLocal(interiorEl, "LinearRing")[0];
        if (!holeRingEl) continue;
        const hole = parseRing(holeRingEl, isLatFirst);
        if (hole && hole.length >= 3) holes.push(hole);
      }

      polygons.push({ positions: exterior, holes, surfaceType, buildingId });
    }
  }

  return { polygons, srsWarning };
}

function byLocal(parent, localName) {
  return [...parent.getElementsByTagNameNS("*", localName)];
}

function detectCrs(srsName) {
  if (!srsName) return { isLatFirst: true, isProjected: false };
  // CRS84 = lon-first geographic (used by some GeoJSON-style GML)
  if (srsName.includes("CRS84") || srsName.includes("CRS:84")) {
    return { isLatFirst: false, isProjected: false };
  }
  // EPSG:6697 (JGD2011), 4326 (WGS84), 4019 (GRS80) — all geographic lat-first
  if (/6697|4326|4019/.test(srsName)) {
    return { isLatFirst: true, isProjected: false };
  }
  // Japanese plane rectangular systems (EPSG 2443-2461, 30169-30176) — projected meters
  if (/EPSG::(244[3-9]|245[0-9]|246[01]|3016[0-9]|3017[0-6])/.test(srsName)) {
    return { isLatFirst: false, isProjected: true };
  }
  // Default: assume geographic lat-first (PLATEAU convention)
  return { isLatFirst: true, isProjected: false };
}

function detectSurfaceType(polyEl) {
  let node = polyEl.parentElement;
  while (node) {
    switch (node.localName) {
      case "RoofSurface":
      case "OuterCeilingSurface":
        return "RoofSurface";
      case "WallSurface":
      case "ClosureSurface":
        return "WallSurface";
      case "GroundSurface":
      case "OuterFloorSurface":
        return "GroundSurface";
      case "Building":
      case "BuildingPart":
        return "unknown";
    }
    node = node.parentElement;
  }
  return "unknown";
}

function parseRing(linearRingEl, isLatFirst) {
  const posListEl = byLocal(linearRingEl, "posList")[0];
  if (posListEl) {
    const dim = parseInt(posListEl.getAttribute("srsDimension") ?? "3");
    return parsePosListText(posListEl.textContent, dim, isLatFirst);
  }
  // Fall back to individual <pos> elements
  const posEls = byLocal(linearRingEl, "pos");
  if (posEls.length) {
    return posEls.map((el) => {
      const nums = el.textContent.trim().split(/\s+/).map(Number);
      const [a = 0, b = 0, c = 0] = nums;
      return isLatFirst ? [b, a, c] : [a, b, c];
    });
  }
  return null;
}

function parsePosListText(text, dim, isLatFirst) {
  const nums = text.trim().split(/\s+/).map(Number);
  const positions = [];
  for (let i = 0; i + dim - 1 < nums.length; i += dim) {
    const a = nums[i];
    const b = nums[i + 1];
    const c = dim >= 3 ? nums[i + 2] : 0;
    // isLatFirst: a=lat, b=lon → Cesium needs [lon, lat, h]
    positions.push(isLatFirst ? [b, a, c] : [a, b, c]);
  }
  return positions;
}
