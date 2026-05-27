// Per-entity original-style cache used to toggle entities between their
// normal and "ghosted" (faded) appearance. Backed by a WeakMap so cached
// styles are reclaimed when the underlying entity is destroyed.
const originalStyles = new WeakMap();

export function rememberEntityContextStyle(entity) {
  if (!entity) return null;
  const existing = originalStyles.get(entity);
  if (existing) return existing;
  const original = {
    show: entity.show,
    polygonMaterial: entity.polygon?.material,
    polylineMaterial: entity.polyline?.material,
    cylinderMaterial: entity.cylinder?.material,
    pointColor: entity.point?.color,
    billboardColor: entity.billboard?.color,
  };
  originalStyles.set(entity, original);
  return original;
}

export function applyEntityContextState(entity, { ghosted, ghostStyle, layerVisible = true } = {}) {
  if (!entity) return;
  const original = rememberEntityContextStyle(entity);
  const style = ghosted ? ghostStyle : null;

  if (entity.polygon) entity.polygon.material = style ?? original.polygonMaterial;
  if (entity.polyline) entity.polyline.material = style ?? original.polylineMaterial;
  if (entity.cylinder) entity.cylinder.material = style ?? original.cylinderMaterial;
  if (entity.point) entity.point.color = style ?? original.pointColor;
  if (entity.billboard) entity.billboard.color = style ?? original.billboardColor;

  const originallyVisible = original.show !== false;
  entity.show = !!layerVisible && originallyVisible;
}

export function applyEntitiesContextState(entities, options = {}) {
  for (const entity of entities ?? []) {
    applyEntityContextState(entity, options);
  }
}
