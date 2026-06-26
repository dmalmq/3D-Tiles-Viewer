import {
  BoundingSphere,
  Cartesian3,
  HeadingPitchRange,
  JulianDate,
  Math as CesiumMath,
} from "cesium";
import { zoomToTileset } from "./tilesetLoader.js";

const DEFAULT_OFFSET = new HeadingPitchRange(0, CesiumMath.toRadians(-45), 0);

function isUsableSphere(sphere) {
  return (
    sphere &&
    Number.isFinite(sphere.radius) &&
    sphere.radius > 0 &&
    Number.isFinite(sphere.center?.x)
  );
}

function collectShapefilePositions(building, time) {
  const points = [];
  for (const layer of building.shapefileLayers ?? []) {
    for (const entity of layer.dataSource?.entities?.values ?? []) {
      if (!entity.position) continue;
      const pos = entity.position.getValue ? entity.position.getValue(time) : entity.position;
      if (pos) points.push(pos);
    }
  }
  return points;
}

export function computeBuildingBounds(building, time = JulianDate.now()) {
  const spheres = [];

  if (building?._boundingSphere && isUsableSphere(building._boundingSphere)) {
    spheres.push(building._boundingSphere);
  }

  if (building?.tileset?.boundingSphere && isUsableSphere(building.tileset.boundingSphere)) {
    spheres.push(building.tileset.boundingSphere);
  }

  const positions = collectShapefilePositions(building, time);
  if (positions.length) {
    spheres.push(BoundingSphere.fromPoints(positions));
  }

  if (!spheres.length) return null;
  if (spheres.length === 1) return spheres[0];

  let center = new Cartesian3(0, 0, 0);
  let maxRadius = 0;
  for (const sphere of spheres) {
    Cartesian3.add(center, sphere.center, center);
    maxRadius = Math.max(maxRadius, sphere.radius);
  }
  Cartesian3.divideByScalar(center, spheres.length, center);
  for (const sphere of spheres) {
    const dist = Cartesian3.distance(center, sphere.center) + sphere.radius;
    maxRadius = Math.max(maxRadius, dist);
  }
  return new BoundingSphere(center, maxRadius);
}

export function zoomToBuilding(viewer, building) {
  if (!viewer || !building) return false;

  const sphere = computeBuildingBounds(building);
  if (isUsableSphere(sphere)) {
    viewer.camera.flyToBoundingSphere(sphere, {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-45), sphere.radius * 2),
    });
    return true;
  }

  if (building.tileset) {
    zoomToTileset(viewer, building.tileset);
    return true;
  }

  return false;
}

export function zoomToScene(viewer, buildings = []) {
  if (!viewer || !buildings.length) return false;

  const time = viewer.clock?.currentTime ?? JulianDate.now();
  const bounds = buildings
    .map((b) => computeBuildingBounds(b, time))
    .filter(isUsableSphere);

  if (!bounds.length) return false;

  let center = new Cartesian3(0, 0, 0);
  let maxRadius = 0;
  for (const sphere of bounds) {
    Cartesian3.add(center, sphere.center, center);
    maxRadius = Math.max(maxRadius, sphere.radius);
  }
  Cartesian3.divideByScalar(center, bounds.length, center);
  for (const sphere of bounds) {
    const dist = Cartesian3.distance(center, sphere.center) + sphere.radius;
    maxRadius = Math.max(maxRadius, dist);
  }

  viewer.camera.flyToBoundingSphere(new BoundingSphere(center, maxRadius), {
    offset: new HeadingPitchRange(
      DEFAULT_OFFSET.heading,
      DEFAULT_OFFSET.pitch,
      maxRadius * 2,
    ),
  });
  return true;
}