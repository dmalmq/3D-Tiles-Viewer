const originalGraphicVisibility = new WeakMap();

export function setGdbLayerIconsVisible(layer, visible) {
  if (!layer?.dataSource || (layer._origin ?? "gdb") !== "gdb") return;
  for (const entity of layer.dataSource.entities.values) {
    if (!entity.position || entity.polygon || entity.polyline) continue;
    for (const graphic of [entity.billboard, entity.point, entity.label]) {
      if (!graphic) continue;
      if (!originalGraphicVisibility.has(graphic)) originalGraphicVisibility.set(graphic, graphic.show);
      graphic.show = visible ? originalGraphicVisibility.get(graphic) : false;
    }
  }
}
